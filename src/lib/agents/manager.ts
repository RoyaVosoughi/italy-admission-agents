// Agent 10 — Manager: the approver. It trusts no other agent:
//   1. independently re-checks the top universities on official sites (its own searches),
//   2. audits every checkable claim in the report against the evidence,
//   3. approves, orders specific agents to redo specific things, or blocks.
// Its decision is then checked by rules/gates.ts, which it cannot override.
import { runAgentJSON } from "../ai";
import type { Claim } from "../rules/claims";
import type { CheckFailure } from "../rules/report-checks";
import type { EvidenceRecord } from "../store/types";
import { ManagerDecision, type Candidate } from "./types";
import { verifyGroup, type VerifyGroup } from "./verifier";
import type { RunContext } from "./context";

const ROLE = (intake: string, today: string) => `
You are the head of the office and the final approver of a client report (today ${today}, intake ${intake}).
You trust no other agent. Audit every claim listed below against the evidence table.
The ranked table and the cost/fee tables are computed by code from the agents' data, so they are not in
the claim list. Still read them: if a row names a university or programme that does not exist or does not
fit the client's field, order "scout" to drop it.

For each claim set status:
- verified: an evidence item with quoteMatched=yes, official=yes and status verified/changed supports
  the exact value in the claim for ${intake}; list its id(s) in evidenceIds.
- wrong: evidence shows a different value, or the claim misstates its source.
- stale: the claim states a past-year value as if it were ${intake}, without a projected/expected label.
- unverifiable: no usable evidence (fine ONLY if the claim is labelled expected/projected/not yet published).
Claims cited "(client documents)" or "(computed facts)" are the client's own data or values computed by
code: check them against the CLIENT FACTS below (they are correct), not against web evidence. Mark them
verified when they match, wrong when they don't.

Also score the writing 0-100 (writingScore): (1) honesty - chances realistic, weak points stated plainly,
no overselling; (2) usefulness - could the client follow the steps without help, dates and documents
concrete; (3) Iranian specifics - CIMEA, legalisation, embassy/VisaMetric, ISEE Parificato, payment
constraints; (4) consistency - tables, prose and dates agree; (5) clarity of English for a non-native
reader. 85+ = ready for the client. Below 85, order "writer" with concrete fixes.

Then decide:
- approve: no wrong claims, no stale claims, every unverifiable claim is labelled, the report is honest.
- rework: give precise orders. agent = who must redo it:
  "verifier" (search again for target — e.g. a university or DSU body — with a better angle),
  "writer" (fix wording/labels/values in the report; quote the claim and the correct value + URL),
  "scholarship" (re-plan a university's scholarship — wrong deadline/limits),
  "cost" (cost items wrong), "analyst" (rating rests on a wrong fact),
  Ratings in the ranked table are computed by code from the analyst's features: to change a rating, order
  "analyst" and say which factor is misjudged (e.g. "competitiveness should be very_high"); never ask the
  writer to change table values. The cost and fee tables are computed from the cost agent's output: to
  change an item, a total or a fee justification, order "cost", not the writer.
  "scout" (drop target from the shortlist — core facts like programme existence or non-EU access
  cannot be confirmed or are false).
- block: the report cannot be made correct (e.g. no university remains). Give blockReason.
`;

export function spotCheckGroups(top: Candidate[], intake: string): VerifyGroup[] {
  // Different phrasing (Italian) from the verifier's queries, so this is an independent look.
  return top.map((c) => ({
    key: c.university,
    query: `${c.university} ${c.programName ?? c.programArea} laurea magistrale studenti internazionali ${intake} scadenza candidatura requisiti lingua`,
    domains: [],
    facts: [
      { claimId: `${c.id}:mgr-deadline`, claim: `Application deadline for non-EU applicants at ${c.university} (${c.programArea}) for ${intake}`, kbValue: null },
      { claimId: `${c.id}:mgr-language`, claim: `English language requirement at ${c.university} for ${c.programArea}`, kbValue: null },
    ],
  }));
}

export async function runManagerSpotCheck(ctx: RunContext, top: Candidate[]): Promise<Omit<EvidenceRecord, "id">[]> {
  const out: Omit<EvidenceRecord, "id">[] = [];
  for (const g of spotCheckGroups(top, ctx.intake)) {
    try {
      out.push(...(await verifyGroup(ctx, g, "manager")));
    } catch {
      // a network failure on one spot-check leaves those facts unconfirmed; the gate handles that
    }
  }
  return out;
}

export async function runManager(
  ctx: RunContext,
  input: {
    report: string;
    claims: Claim[];
    evidence: Map<string, EvidenceRecord>; // short id → record
    hardFailures: CheckFailure[];
    round: number;
    clientFacts: unknown; // computed by code from the client's documents — the reference for client-data claims
  },
): Promise<ManagerDecision> {
  const evTable = [...input.evidence.entries()]
    .map(
      ([id, e]) =>
        `${id} | ${e.claimId} | ${e.status} | live: ${e.liveValue ?? "—"} | year: ${e.academicYear ?? "?"} | official: ${e.officialUrl ? "yes" : "no"} | quoteMatched: ${e.quoteMatched ? "yes" : "no"} | ${e.url ?? "—"} | by ${e.checkedBy}\n   quote: ${e.quote ?? "—"}`,
    )
    .join("\n");
  const claims = input.claims.map((c) => `${c.id} [${c.section}] ${c.text}`).join("\n");

  const { data, usage } = await runAgentJSON(ManagerDecision, {
    agent: "manager",
    role: ROLE(ctx.intake, ctx.today),
    prompt: [
      `Review round ${input.round}.`,
      `CLIENT FACTS (computed by code, correct):
${JSON.stringify(input.clientFacts)}`,
      `Automatic checks: ${input.hardFailures.map((f) => `${f.rule}: ${f.detail}`).join("; ") || "all passed"}`,
      `Claims to audit (id [section] text):\n${claims || "(none)"}`,
      `Evidence table:\n${evTable || "(no evidence)"}`,
      `Report:\n${input.report}`,
    ].join("\n\n"),
    temperature: 0.1,
    effort: "medium",
    maxOutputTokens: 12_000,
    lessons: await ctx.lessons("manager"),
  });
  ctx.addUsage(usage);
  return data;
}
