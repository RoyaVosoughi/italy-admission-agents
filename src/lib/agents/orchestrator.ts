// The orchestrator — deterministic code, not an LLM. Creative and judgement work goes to
// agents; ORDER, LOOPS, LIMITS and GATES live here, where they are predictable, debuggable
// and testable. The Manager agent decides what must be redone; this code executes those
// orders within hard limits and applies the approval gate the Manager cannot override.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Usage } from "../ai";
import { readDocument } from "../docs/read";
import { Retriever } from "../rag/retrieve";
import { extractClaims } from "../rules/claims";
import { hostOf, isOfficialUrl } from "../rules/evidence";
import { approvalGate, usableUrls } from "../rules/gates";
import { autoLabel, stripDataKeyTags } from "../report/label";
import { missingCriticalFacts, profileFacts, VISA_FUNDS } from "../rules/profile";
import { shortlist, type Ranked } from "../rules/ranking";
import { checkReport } from "../rules/report-checks";
import { canApplyLine, clientCostTables, feeTable, fillPlaceholders, PLACEHOLDERS, shortlistTable } from "../report/render";
import { exportReport } from "../report/export";
import { getStore } from "../store/file";
import type { EvidenceRecord, Run, Step, Store } from "../store/types";
import { Tavily } from "../tools/tavily";
import { runAnalyst } from "./analyst";
import { runAssessor } from "./assessor";
import { limiter, type RunContext } from "./context";
import { runCost, type CostResult } from "./cost";
import { runCritic } from "./critic";
import { runIntake } from "./intake";
import { runManager, runManagerSpotCheck } from "./manager";
import { runScholarship, type ScholarshipResult } from "./scholarship";
import { runScout } from "./scout";
import { runTranslator } from "./translator";
import { gatherPages, requirementsExcerpt, verifyGroup, type VerifyGroup } from "./verifier";
import { runWriter, type WriterInput } from "./writer";
import type { Candidate, ChanceRating, ManagerDecision } from "./types";

export interface RunInput {
  clientFolder: string; // folder name under immigration files/clients, e.g. "sara-mohammadi"
  documents: string[]; // paths to resume / intake note
  notes?: string;
  tomanPerEur?: number; // today's free-market rate, for the ISEE estimate
  today?: string;
  intake?: string;
  force?: boolean; // run again even if the same documents were already assessed
}

const LIMITS = {
  managerRounds: () => Number(process.env.MAX_MANAGER_ROUNDS ?? 3),
  approveThreshold: () => Number(process.env.APPROVE_THRESHOLD ?? 85),
  prefetchReserve: 16, // credits kept for fact-checking, the scholarship bodies, the embassy and the Manager
  managerWebReserve: 6, // Tavily calls kept back for the Manager's independent spot-check
  verifyUniversities: 8, // every shortlisted university (shortlist max is 8)
  llmConcurrency: () => Number(process.env.LLM_CONCURRENCY ?? 2),
};

/** Same documents + notes + rate + intake = same question. Document names don't matter, their content does. */
export function fingerprintOf(input: RunInput): string {
  const docs = input.documents.map((p) => createHash("sha256").update(readFileSync(p)).digest("hex")).sort();
  const intake = input.intake ?? defaultIntake(input.today ?? new Date().toISOString().slice(0, 10));
  return createHash("sha256")
    .update(JSON.stringify({ docs, notes: (input.notes ?? "").trim(), rate: input.tomanPerEur ?? null, intake }))
    .digest("hex");
}

/**
 * An earlier approved (or needs-input) run of the very same question for this client. Reusing it gives the
 * client the identical answer every time and spends no model calls. Blocked and failed runs are not reused:
 * running those again is the point.
 */
export async function findReusableRun(input: RunInput, store: Store = getStore()): Promise<Run | null> {
  if (input.force) return null;
  const fp = fingerprintOf(input);
  const runs = await store.listRuns();
  return runs.find((r) => r.clientId === input.clientFolder && r.fingerprint === fp && (r.status === "approved" || r.status === "needs_input")) ?? null;
}

export async function startRun(input: RunInput, store: Store = getStore()): Promise<Run> {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const run = await store.createRun({
    clientId: input.clientFolder,
    status: "running",
    inputs: { documents: input.documents, notes: input.notes, today, tomanPerEur: input.tomanPerEur },
    fingerprint: fingerprintOf(input),
  });
  return run;
}

/** Runs the whole pipeline for an existing run record. Never throws: errors end up on the run. */
export async function executeRun(runId: string, input: RunInput, store: Store = getStore()): Promise<Run> {
  const run = (await store.getRun(runId))!;
  const today = run.inputs.today;
  const usage = { ...run.usage };
  const web = new Tavily();
  const ctx: RunContext = {
    runId,
    today,
    intake: input.intake ?? defaultIntake(today),
    store,
    retriever: Retriever.load(),
    web,
    lessons: async (agent) => (await store.listLessons(agent)).map((l) => l.lesson),
    addUsage: (u: Usage) => {
      usage.llmCalls += u.calls;
      usage.inputTokens += u.inputTokens;
      usage.outputTokens += u.outputTokens;
    },
  };
  const flushUsage = () => store.updateRun(runId, { usage: { ...usage, tavilyCalls: web.used } });

  let stepNo = 0;
  let lastHardFailures: { rule: string }[] = []; // for the critic's log
  async function step<T>(agent: Step["agent"], label: string, fn: () => Promise<T>, summarise: (t: T) => string): Promise<T> {
    const s: Step = { id: `s${++stepNo}`, agent, label, status: "running", startedAt: new Date().toISOString() };
    await store.upsertStep(runId, s);
    try {
      const out = await fn();
      await store.upsertStep(runId, { ...s, status: "done", finishedAt: new Date().toISOString(), summary: summarise(out), output: out });
      await flushUsage();
      return out;
    } catch (e) {
      await store.upsertStep(runId, { ...s, status: "error", finishedAt: new Date().toISOString(), error: (e as Error).message });
      throw new StepError(label, e as Error);
    }
  }

  try {
    // ---- 1. Intake (pauses if critical facts are missing — data can't be verified into existence)
    const docs = await step("orchestrator", "Read client documents", () => Promise.all(input.documents.map(readDocument)), (d) =>
      d.map((x) => `${x.name} (${x.text.length} chars)`).join(", "),
    );
    const profile = await step("intake", "Extract client profile", () => runIntake(ctx, docs, input.notes), (p) =>
      `${p.displayName}: ${p.targetLevel} in ${p.targetFields.join(", ")}`,
    );
    const missing = missingCriticalFacts(profile);
    if (missing.length) {
      await store.updateRun(runId, { status: "needs_input", needsInput: missing, finishedAt: new Date().toISOString() });
      return (await store.getRun(runId))!;
    }
    const facts = await step("rules", "Compute profile facts", async () => profileFacts(profile), (f) =>
      `GPA ${f.gpa ? `${f.gpa.italian30}/30` : "?"}, English ${f.english.cefr ?? "none"}${f.english.meetsEmbassyMinimum ? " (meets embassy minimum)" : ""}; ${f.issues.length} issue(s)`,
    );

    // ---- 2. Assessment and search
    const assessment = await step("assessor", "Assess profile", () => runAssessor(ctx, profile, facts), (a) =>
      `${a.strengths.length} strengths, ${a.weaknesses.length} weaknesses; themes: ${a.searchThemes.join(", ")}`,
    );
    const candidates = await step("scout", "Find candidate programmes (RAG)", () => runScout(ctx, profile, assessment), (c) =>
      `${c.length} candidates: ${c.map((x) => x.university).join(", ")}`,
    );

    // ---- 3. Admission chances in parallel, then the code-enforced shortlist
    // ---- 3a. What each university's own pages say about admission (verbatim), before anything is rated
    const requirements = new Map<string, string>();
    const webPool = limiter(3);
    await step("verifier", `Read official admission requirements (${candidates.length})`, async () => {
      await Promise.all(
        candidates.map((c) =>
          webPool(async () => {
            if (web.remaining <= LIMITS.prefetchReserve) return;
            const pages = await gatherPages(ctx, candidateGroup(ctx, c)).catch(() => []);
            if (pages.length) requirements.set(c.id, requirementsExcerpt(pages));
          }),
        ),
      );
      return [...requirements.keys()];
    }, (ids) => `${ids.length}/${candidates.length} programmes: requirements read from the university's own pages`);

    const pool = limiter(LIMITS.llmConcurrency());
    const ratings = await step("analyst", `Rate admission chances (${candidates.length})`, () =>
      Promise.all(candidates.map((c) => pool(() => runAnalyst(ctx, profile, facts, c, undefined, requirements.get(c.id))))),
      (r) => r.map((x) => `${x.candidateId}: ${x.tier} ${x.score}`).join("; "),
    );
    let picked = await step("rules", "Select shortlist", async () => shortlist(candidates, ratings, profile.preferences), (s) =>
      `${s.selected.length} selected, ${s.dropped.length} dropped`,
    );
    if (!picked.selected.length) return await finish("blocked", "No realistic option: every candidate was rated Unlikely or excluded.");
    let ranked: Ranked[] = picked.selected;

    // ---- 4. Scholarships (parallel) and costs
    const cities = [...new Set(ranked.map((r) => r.candidate.city))];
    let [scholarships, costs] = await step("scholarship", `Plan scholarships (${ranked.length}) + costs`, () =>
      Promise.all([
        Promise.all(ranked.map((r) => pool(() => runScholarship(ctx, profile, r.candidate, { tomanPerEur: input.tomanPerEur })))),
        pool(() => runCost(ctx, profile, facts, cities)),
      ]),
      ([s, c]) => `${s.length} plans; our fee €${c.fee.total}`,
    );

    // ---- 5. Live verification on official sites
    await step("verifier", "Verify facts on official websites", async () => {
      const groups = buildVerifyGroups(ctx, ranked, scholarships);
      const out: Omit<EvidenceRecord, "id">[] = [];
      for (const g of groups) {
        if (web.remaining < LIMITS.managerWebReserve + 2) break;
        try {
          out.push(...(await verifyGroup(ctx, g, "verifier")));
        } catch (e) {
          // One failed check must not end the run: record the facts as not checked (never dropped for it).
          out.push(...g.facts.map((f) => uncheckedEvidence(runId, f, `web error: ${(e as Error).message.slice(0, 80)}`)));
        }
      }
      await store.addEvidence(out);
      return out;
    }, (ev) => `${ev.filter((e) => e.quoteMatched).length}/${ev.length} facts confirmed with a matching quote`);

    // A programme the scout proposed that official sites don't show is dropped now, by code, rather
    // than late by the Manager. Only when a search actually ran — an unchecked programme isn't dropped.
    const dropped = await step("rules", "Drop programmes not found on official sites", async () => {
      const programme = new Map(
        (await store.listEvidence(runId)).filter((e) => e.claimId.endsWith(":programme")).map((e) => [e.claimId.slice(0, -":programme".length), e]),
      );
      const suspects = ranked.filter((r) => {
        const e = programme.get(r.candidate.id);
        // only when a search really ran: not for budget or network failures
        return r.candidate.needsWebCheck && e?.status === "not_found" && !/budget|web error/.test(e.note ?? "");
      });
      // One missed search is weak proof (real programmes were lost this way): before dropping, search
      // once more in Italian, the language the universities' own catalogues use.
      const out: Ranked[] = [];
      for (const r of suspects) {
        if (web.remaining < LIMITS.managerWebReserve + 2) break; // can't re-check → keep it
        const c = r.candidate;
        const ev = await verifyGroup(
          ctx,
          {
            key: c.university,
            query: `${c.university} corso di laurea magistrale ${c.programName ?? c.programArea} in inglese ammissione studenti internazionali`,
            domains: [],
            facts: [{ claimId: `${c.id}:programme`, claim: programmeExistsClaim(c), kbValue: null }],
          },
          "verifier",
        ).catch(() => []);
        await store.addEvidence(ev);
        if (ev.some((e) => e.quoteMatched && e.officialUrl && (e.status === "verified" || e.status === "changed"))) continue;
        if (ev.length && ev.every((e) => !/web error/.test(e.note ?? ""))) out.push(r);
      }
      ranked = ranked.filter((r) => !out.includes(r));
      scholarships = scholarships.filter((s) => ranked.some((r) => r.candidate.id === s.plan.candidateId));
      return out.map((r) => r.candidate.university);
    }, (d) => (d.length ? `dropped ${d.length}: ${d.join(", ")}` : "all programmes kept"));
    if (!ranked.length) return await finish("blocked", `No programme could be confirmed on official sites (dropped: ${dropped.join(", ")}).`);

    // ---- 6. Writer
    const writerInput = async (): Promise<WriterInput> => ({
      profile,
      facts,
      assessment,
      shortlist: ranked,
      scholarships,
      costs,
      evidence: await store.listEvidence(runId),
    });
    const tables = () => ({
      canApply: canApplyLine(profile.displayName, ranked, profile.existingOffers, ctx.intake),
      shortlist: shortlistTable(ranked, scholarships),
      clientCosts: clientCostTables(costs),
      fee: feeTable(costs),
    });
    // The tables actually inserted last time — needed to swap them back for placeholders
    // even after a rework changed the underlying data.
    let lastTables = tables();
    const write = async (rewrite?: { draft: string; issues: string[] }) => {
      const draft = await runWriter(ctx, await writerInput(), rewrite);
      lastTables = tables();
      // Code, not the writer, guarantees every unconfirmed external fact carries an "expected" label.
      const urls = usableUrls(await store.listEvidence(runId));
      return autoLabel(stripDataKeyTags(insertTables(draft, lastTables)), urls, ctx.intake).text;
    };

    let report = await step("writer", "Write report", () => write(), (r) => `${r.length} chars`);

    // ---- 7. Manager: independent spot-check, audit, decision → rework loop
    await step("manager", "Manager: independent spot-check on official sites", async () => {
      const ev = await runManagerSpotCheck(ctx, ranked.slice(0, 3).map((r) => r.candidate));
      await store.addEvidence(ev);
      return ev;
    }, (ev) => `${ev.filter((e) => e.quoteMatched).length}/${ev.length} confirmed independently`);

    let approved = false;
    let lastWritingScore = 0;
    // Corrections accumulate across Manager rounds so a later re-run doesn't undo an earlier fix.
    const costCorrections: string[] = [];
    const candidateCorrections = new Map<string, string[]>();
    const correctionsFor = (key: string, add: string) => {
      const list = [...(candidateCorrections.get(key) ?? []), add];
      candidateCorrections.set(key, list);
      return list.join(" | ");
    };
    let gateReasons: string[] = [];
    for (let round = 1; round <= LIMITS.managerRounds(); round++) {
      await store.updateRun(runId, { managerRounds: round });
      const evidence = shortIds(await store.listEvidence(runId));
      const claims = extractClaims(report);
      const hard = checkReport(report);
      lastHardFailures = hard.failures;
      const decision = await step("manager", `Manager review (round ${round})`, () =>
        runManager(ctx, {
          report,
          claims,
          evidence,
          hardFailures: hard.failures,
          round,
          clientFacts: {
            profile: { level: profile.targetLevel, fields: profile.targetFields, birthYear: profile.birthYear, languageCerts: profile.languageCerts, family: profile.family },
            computed: facts,
            iseeEstimates: scholarships.map((s) => ({ university: s.plan.candidateId, ...s.isee })),
          },
        }),
        (d) => `${d.verdict}; ${d.claimAudit.filter((a) => a.status === "verified").length}/${claims.length} claims verified; ${d.reworkOrders.length} rework order(s)`,
      );
      lastWritingScore = decision.writingScore;
      await store.addManagerDecision({ ...decision, runId, round });

      const gate = approvalGate({
        decision,
        claims,
        evidenceById: evidence,
        hardFailures: hard.failures,
        threshold: LIMITS.approveThreshold(),
      });
      await step("rules", `Approval gate (round ${round})`, async () => gate, (g) => (g.approved ? "passed" : `${g.reasons.length} reason(s): ${g.reasons.slice(0, 3).join("; ")}`));
      gateReasons = gate.reasons;
      if (gate.approved) {
        approved = true;
        break;
      }
      if (decision.verdict === "block") return await finish("blocked", `Manager blocked the report: ${decision.blockReason ?? "no reason given"}`);
      if (round === LIMITS.managerRounds()) break;

      // Execute rework orders (code validates each one; unknown targets are ignored).
      const writerIssues = await step("orchestrator", `Execute rework orders (round ${round})`, async () => {
        const issues: string[] = [];
        for (const o of decision.reworkOrders) {
          // An order can name several universities ("PoliMi and PoliTo"); one naming none applies to all.
          const named = ranked.filter((r) => matches(r.candidate.university, o.target) || matches(r.candidate.id, o.target));
          const targets = named.length ? named : o.agent === "scout" ? [] : ranked;
          switch (o.agent) {
            case "verifier": {
              if (web.remaining < 2) break;
              const ev = await verifyGroup(ctx, reworkGroup(o.target, o.instruction, ctx.intake), "verifier").catch(() => []);
              await store.addEvidence(ev);
              break;
            }
            case "scholarship":
              for (const t of targets) {
                const fresh = await runScholarship(ctx, profile, t.candidate, {
                  tomanPerEur: input.tomanPerEur,
                  correction: correctionsFor(`scholarship:${t.candidate.id}`, o.instruction),
                });
                scholarships = scholarships.map((s) => (s.plan.candidateId === t.candidate.id ? fresh : s));
              }
              break;
            case "cost":
              costCorrections.push(o.instruction);
              costs = await runCost(ctx, profile, facts, cities, costCorrections);
              break;
            case "analyst":
              if (targets.length) {
                const fresh = new Map<Ranked, ChanceRating>();
                for (const t of targets) fresh.set(t, await runAnalyst(ctx, profile, facts, t.candidate, { instruction: correctionsFor(`analyst:${t.candidate.id}`, o.instruction), previous: t.rating.features }, requirements.get(t.candidate.id)));
                const all = ranked.map((r) => (fresh.has(r) ? { ...r, rating: fresh.get(r)! } : r));
                picked = shortlist(all.map((r) => r.candidate), all.map((r) => r.rating), profile.preferences);
                ranked = picked.selected;
              }
              break;
            case "scout":
              ranked = ranked.filter((r) => !targets.includes(r)); // drop: core facts unconfirmed or false
              break;
            case "writer":
              break;
          }
          issues.push(`[Manager → ${o.agent}: ${o.target}] ${o.instruction}`);
        }
        if (decision.verdict === "approve") issues.push(...gate.reasons.map((r) => `[Approval gate] ${r}`));
        // The writer must see exactly what failed — "1 check failed" alone can't be fixed.
        issues.push(...hard.failures.map((f) => `[Automatic check: ${f.rule}] ${f.detail} → cite it: (client documents) for the client's own data, (KB: id) + "expected" for knowledge-base facts, or an official link`));
        return issues;
      }, (i) => `${i.length} order(s) executed`);
      if (!ranked.length) return await finish("blocked", "Every university was dropped during the Manager's review.");
      scholarships = scholarships.filter((s) => ranked.some((r) => r.candidate.id === s.plan.candidateId));

      report = await step("writer", `Rewrite report (manager round ${round})`, () =>
        write({ draft: stripTables(report, lastTables), issues: writerIssues }),
        (r) => `${r.length} chars`,
      );
    }
    if (!approved) return await finish("blocked", `Not approved after ${LIMITS.managerRounds()} Manager rounds: ${gateReasons.slice(0, 5).join("; ")}`);

    // ---- 8. Translation (checked by code), export, save
    const properNouns = [...new Set(ranked.flatMap((r) => [r.candidate.university]).concat(["Universitaly", "CIMEA"]))];
    const { fa, failures } = await step("translator", "Translate to Persian", () => runTranslator(ctx, report, properNouns), (t) =>
      t.failures.length ? `checks failed: ${t.failures.join("; ")}` : "all translation checks passed",
    );
    if (failures.length) return await finish("blocked", `Persian translation failed its checks: ${failures.join("; ")}`);

    const exported = await step("export", "Save report + .docx", () => exportReport(input.clientFolder, report, fa, today), (e) =>
      e.files.join(", ") + (e.docxError ? ` (docx failed: ${e.docxError})` : ""),
    );
    const saved = await store.saveReport({
      runId,
      clientId: input.clientFolder,
      contentEn: report,
      contentFa: fa,
      files: exported.files,
      writingScore: lastWritingScore,
      status: "approved",
    });
    await store.updateRun(runId, { reportId: saved.id });
    await finish("approved");
    await learn();
    return (await store.getRun(runId))!;
  } catch (e) {
    const msg = e instanceof StepError ? `${e.step}: ${e.cause.message}` : (e as Error).message;
    await store.updateRun(runId, { status: "error", error: msg, finishedAt: new Date().toISOString() });
    // A bad upload (empty or unreadable file) says nothing about how the agents behave: no lesson from it.
    if (!(e instanceof StepError && e.step.startsWith("Read client documents"))) await learn().catch(() => undefined);
    return (await store.getRun(runId))!;
  }

  async function finish(status: Run["status"], error?: string) {
    await flushUsage();
    await store.updateRun(runId, { status, error, finishedAt: new Date().toISOString() });
    if (status === "blocked") await learn().catch(() => undefined);
    return (await store.getRun(runId))!;
  }

  // Self-improvement: the critic turns this run's problems into lessons for specific agents.
  async function learn() {
    const r = (await store.getRun(runId))!;
    const decisions: ManagerDecision[] = await store.listManagerDecisions(runId);
    const ev = await store.listEvidence(runId);
    const log = {
      status: r.status,
      error: r.error,
      steps: r.steps.map((s) => ({ agent: s.agent, label: s.label, status: s.status, summary: s.summary, error: s.error })),
      managerOrders: decisions.flatMap((d) => d.reworkOrders),
      unverifiedFacts: ev.filter((e) => !e.quoteMatched).map((e) => e.claim),
      // which automatic report checks failed last, so lessons go to the agent that caused them
      lastReportCheckFailures: countRules(lastHardFailures),
    };
    const existing = (await store.listLessons()).map((l) => `${l.agent}: ${l.lesson}`);
    await step("critic", "Extract lessons for next time", () => runCritic(ctx, log, existing), (l) => `${l.length} lesson(s)`).catch(() => undefined);
  }
}

class StepError extends Error {
  constructor(
    public step: string,
    public cause: Error,
  ) {
    super(`${step}: ${cause.message}`);
  }
}

/** Intake to plan for: the next September start that is still reachable. */
export function defaultIntake(today: string): string {
  const y = Number(today.slice(0, 4));
  const start = today.slice(5) <= "03-31" ? y : y + 1; // after March, the coming September is too late
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

const countRules = (failures?: { rule: string }[]) =>
  failures?.reduce<Record<string, number>>((acc, f) => ((acc[f.rule] = (acc[f.rule] ?? 0) + 1), acc), {});

const matches = (a: string, b: string) => a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());

function shortIds(evidence: EvidenceRecord[]): Map<string, EvidenceRecord> {
  return new Map(evidence.map((e, i) => [`E${i + 1}`, e]));
}

function reworkGroup(target: string, instruction: string, intake: string): VerifyGroup {
  return {
    key: target,
    query: `${target} ${instruction}`.replace(/\s+/g, " ").slice(0, 300),
    domains: [],
    facts: [{ claimId: `rework:${target.toLowerCase().replace(/\W+/g, "-")}`, claim: `${instruction} (${intake})`, kbValue: null }],
  };
}

const DSU_HOST = /regione|edisu|ergo|esu|ersu|disco|dsu/;

/** Official URLs the knowledge base cites for these chunks. */
function knownOfficialUrls(ctx: RunContext, chunkIds: string[]): string[] {
  return [...new Set(chunkIds.flatMap((id) => ctx.retriever.get(id)?.urls ?? []).filter(isOfficialUrl))];
}

/** What to look up on the web for one candidate programme. The same group is used to read its requirements before
 *  rating and to verify its facts afterwards, so the searches and pages are shared (cached) between the two. */
function candidateGroup(ctx: RunContext, c: Candidate, kbDeadline: string | null = null): VerifyGroup {
  const domains = [
    ...new Set(
      c.sourceChunkIds
        .flatMap((id) => ctx.retriever.get(id)?.urls ?? [])
        .filter(isOfficialUrl)
        .map((u) => hostOf(u)!)
        .filter((h) => !DSU_HOST.test(h)),
    ),
  ].slice(0, 3);
  return {
    key: c.university,
    knownUrls: knownOfficialUrls(ctx, c.sourceChunkIds).filter((u) => !DSU_HOST.test(hostOf(u) ?? "")),
    altQuery: `${c.university} corso di laurea magistrale ${c.programName ?? c.programArea} studenti internazionali scadenza requisiti lingua inglese`,
    query: `${c.university} ${c.programName ?? c.programArea} international students admission ${ctx.intake} application deadline English requirement`,
    domains,
    facts: [
      { claimId: `${c.id}:deadline`, claim: `Application deadline for non-EU (visa) applicants, ${c.programName ?? c.programArea}, ${ctx.intake}`, kbValue: kbDeadline },
      { claimId: `${c.id}:language`, claim: `English language requirement (IELTS/TOEFL minimum) for ${c.programName ?? c.programArea}`, kbValue: null },
      { claimId: `${c.id}:programme`, claim: programmeExistsClaim(c), kbValue: null },
    ],
  };
}

/** Code decides what must be verified: per university, per DSU body, plus the embassy funds rule. */
function buildVerifyGroups(ctx: RunContext, ranked: Ranked[], scholarships: ScholarshipResult[]): VerifyGroup[] {
  const groups: VerifyGroup[] = [];
  const plan = new Map(scholarships.map((s) => [s.plan.candidateId, s.plan]));
  for (const { candidate: c } of ranked.slice(0, LIMITS.verifyUniversities)) groups.push(candidateGroup(ctx, c, plan.get(c.id)?.deadlines.admission ?? null));
  const seen = new Set<string>();
  for (const s of scholarships) {
    if (seen.has(s.plan.dsuBody)) continue;
    seen.add(s.plan.dsuBody);
    const cand = ranked.find((r) => r.candidate.id === s.plan.candidateId)?.candidate;
    groups.push({
      key: s.plan.dsuBody,
      knownUrls: knownOfficialUrls(ctx, cand?.sourceChunkIds ?? []).filter((u) => DSU_HOST.test(hostOf(u) ?? "")),
      altQuery: `${s.plan.dsuBody} bando borse di studio studenti internazionali scadenza ISEE`,
      query: `${s.plan.dsuBody} bando borsa di studio ${ctx.intake} scadenza ISEE studenti internazionali`,
      domains: [],
      facts: [
        { claimId: `${s.plan.candidateId}:dsu-deadline`, claim: `${s.plan.dsuBody} scholarship application deadline for ${ctx.intake}`, kbValue: s.plan.deadlines.dsu },
        { claimId: `${s.plan.candidateId}:isee`, claim: `${s.plan.dsuBody} ISEE and ISPE ceilings`, kbValue: s.plan.limits.iseeMax != null ? `ISEE €${s.plan.limits.iseeMax}, ISPE €${s.plan.limits.ispeMax ?? "?"}` : null },
      ],
    });
  }
  groups.push({
    key: "Embassy of Italy in Tehran",
    query: "Embassy of Italy Tehran study visa university enrolment document checklist economic requirement",
    domains: ["ambteheran.esteri.it"],
    facts: [{ claimId: "embassy:funds", claim: "Minimum economic means for a study visa (amount, per month or per year)", kbValue: `€${VISA_FUNDS.eur}` }],
  });
  return groups;
}

/** Insert code-rendered tables; if the writer dropped a placeholder, put the table under its section. */
function insertTables(draft: string, tables: Record<keyof typeof PLACEHOLDERS, string>): string {
  const { text, missing } = fillPlaceholders(draft, tables);
  let out = text;
  const sectionOf: Record<string, string> = {
    [PLACEHOLDERS.canApply]: "Executive recommendation",
    [PLACEHOLDERS.shortlist]: "Recommended universities",
    [PLACEHOLDERS.clientCosts]: "Cost of the whole process",
    [PLACEHOLDERS.fee]: "Our service fee",
  };
  for (const ph of missing) {
    const key = (Object.keys(PLACEHOLDERS) as (keyof typeof PLACEHOLDERS)[]).find((k) => PLACEHOLDERS[k] === ph)!;
    const re = new RegExp(`(^##\\s+\\d+\\.\\s*${sectionOf[ph]}[^\\n]*\\n)`, "m");
    out = re.test(out) ? out.replace(re, `$1\n${tables[key]}\n\n`) : out;
  }
  return out;
}

/** Before a rewrite, put the placeholders back so the writer can't edit code-rendered numbers. */
function stripTables(report: string, tables: Record<keyof typeof PLACEHOLDERS, string>): string {
  let out = report;
  for (const k of Object.keys(PLACEHOLDERS) as (keyof typeof PLACEHOLDERS)[]) out = out.split(tables[k]).join(PLACEHOLDERS[k]);
  return out;
}

export type { CostResult };

function uncheckedEvidence(runId: string, f: { claimId: string; claim: string; kbValue: string | null }, note: string): Omit<EvidenceRecord, "id"> {
  return {
    ...f,
    liveValue: null,
    url: null,
    quote: null,
    status: "not_found",
    academicYear: null,
    runId,
    quoteMatched: false,
    officialUrl: false,
    pageHash: null,
    checkedBy: "verifier",
    fetchedAt: null,
    note,
  };
}

/**
 * Existence only — a page heading or course-list line naming the programme is enough proof.
 * (Asking for "exists + taught in English + open to non-EU" in one sentence made the verifier miss
 * real programmes; language is checked as its own fact.)
 */
function programmeExistsClaim(c: { university: string; programName: string | null; programArea: string }): string {
  return `A master's degree programme in ${c.programName ?? c.programArea} (Italian or English name) exists at ${c.university}`;
}
