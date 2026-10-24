// Agent 8 — Report Writer. The only agent besides the translator with free-text output,
// because its reader is a person. Two modes: first draft, and rewrite against issues raised
// by the Manager.
import { runAgentText } from "../ai";
import type { ProfileFacts } from "../rules/profile";
import { REQUIRED_SECTIONS } from "../rules/report-checks";
import type { Ranked } from "../rules/ranking";
import type { EvidenceRecord } from "../store/types";
import { PLACEHOLDERS } from "../report/render";
import type { Assessment, ClientProfile } from "./types";
import type { ScholarshipResult } from "./scholarship";
import type { CostResult } from "./cost";
import { json, type RunContext } from "./context";

export interface WriterInput {
  profile: ClientProfile;
  facts: ProfileFacts;
  assessment: Assessment;
  shortlist: Ranked[];
  scholarships: ScholarshipResult[];
  costs: CostResult;
  evidence: EvidenceRecord[];
}

const ROLE = (intake: string, today: string) => `
You write the client's admission and scholarship report (English). Today is ${today}; the client
targets ${intake}. Write clear, step-by-step prose for a non-expert; explain jargon once.

Structure — use exactly these level-2 headings, numbered, in this order:
${REQUIRED_SECTIONS.map((s, i) => `## ${i + 1}. ${s}`).join("\n")}

Mandatory content:
- "Executive recommendation": open with ONE plain sentence that answers the client's question: which
  universities they can apply to and the estimated chance at each, most likely first, in the form
  "<Name> can apply to <University A> (about 60%), <University B> (about 45%) …" using exactly the
  percentages in the ranked table, then (computed facts). Follow with the main risk and the single most
  important next step. Say that the percentages are estimates, not promises.
- "Recommended universities": put the placeholder ${PLACEHOLDERS.shortlist} on its own line (code
  inserts the ranked table), then 2–4 sentences per university on why it fits and what limits the chance.
- "Cost of the whole process": put ${PLACEHOLDERS.clientCosts} on its own line, plus a short explanation.
- "Our service fee": put ${PLACEHOLDERS.fee} on its own line, plus one sentence on what it covers.
  Never add our fee to the client's third-party costs.
- "Scholarship guide": per university, the numbered steps with dates, ISEE result and calendar risks.
- "Application steps": the Iranian path — CIMEA, translation + legalisation, language test, university
  application, Universitaly pre-enrolment, VisaMetric/embassy visa, permesso di soggiorno.
- "Document checklist": one table sorted by start-by date (longest lead time first).
- "Gaps and action plan": the assessor's weaknesses with fixes and dates.
- "Sources": list every official URL and KB chunk you cited.

Citations — EVERY line you write that states a date, amount, score or grade must end with a citation:
- an official link [short name](https://…) when the evidence table shows the fact as verified/changed
  on that page with a url (use the live value, not the knowledge-base value);
- otherwise the knowledge-base chunk, written exactly like (KB: piedmont#3) or (KB: piedmont#3, national-dsu-guide#10),
  AND a label in the same line: "expected", "projected" or "not yet published for ${intake}";
- the client's own data (their GPA, test scores, dates from their documents): (client documents);
  values computed from it (GPA conversion, ISEE estimate): (computed facts).
Data field names ("scholarships", "assessment", "costs") are NOT sources. A line comparing the ISEE estimate
with a ceiling needs both: (computed facts) for the estimate and (KB: <limits.sourceChunkId>) for the ceiling.
The code-inserted tables are already handled; don't repeat their numbers in prose without a citation.
You cannot change the ranked table: describe each university's chance with the SAME tier and percentage the table shows.
Avoid unsourced superlatives ("Italy's premier…", "best").
Never state a 2026/27 date as a ${intake} date without the label. Never promise admission, visa or
scholarship. Rank honestly; say plainly when a chance is low.
`;

export async function runWriter(
  ctx: RunContext,
  input: WriterInput,
  rewrite?: { draft: string; issues: string[] },
): Promise<string> {
  const ev = input.evidence.map((e) => ({
    fact: e.claimId,
    claim: e.claim,
    status: e.status,
    live: e.liveValue,
    url: e.quoteMatched && e.officialUrl ? e.url : null,
  }));
  const data = {
    client: input.profile,
    computedFacts: input.facts,
    assessment: input.assessment,
    shortlist: input.shortlist.map((r) => ({ candidate: r.candidate, tier: r.rating.tier, score: r.rating.score, factors: r.rating.factors, improve: r.rating.improve })),
    scholarships: input.scholarships,
    costs: { items: input.costs.clientItems, summary: input.costs.clientSummary, ourFee: input.costs.fee },
    evidence: ev,
  };
  const prompt = rewrite
    ? `Revise this draft. Fix every issue below; keep everything else. Keep the placeholders.\n\nIssues:\n${rewrite.issues
        .map((i) => `- ${i}`)
        .join("\n")}\n\nData:\n${json(data)}\n\nDraft:\n${rewrite.draft}`
    : `Data:\n${json(data)}`;
  const { text, usage } = await runAgentText({
    agent: "writer",
    role: ROLE(ctx.intake, ctx.today),
    prompt,
    temperature: rewrite ? 0.4 : 0.6,
    maxOutputTokens: 16_000,
    lessons: await ctx.lessons("writer"),
  });
  ctx.addUsage(usage);
  return text.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/, "$1").trim();
}
