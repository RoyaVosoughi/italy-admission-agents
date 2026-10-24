// Agent 5 — Scholarship Strategist, one call per shortlisted university.
// The LLM copies limits/deadlines from the sources and writes the human steps; code then
// decides ISEE eligibility, calendar risks and "start by" dates.
import { runAgentJSON } from "../ai";
import { checkIsee, estimateIsee, type IseeVerdict } from "../rules/isee";
import { calendarRisks, LEAD_DAYS, planBackwards, type PlannedTask } from "../rules/timeline";
import { ScholarshipPlan, type Candidate, type ClientProfile } from "./types";
import { formatChunks, json, uniqueHits, type RunContext } from "./context";

export interface ScholarshipResult {
  plan: ScholarshipPlan;
  isee: { verdict: IseeVerdict; reason: string; estimate: number | null };
  calendarRisks: string[];
  startBy: PlannedTask[];
}

const ROLE = (intake: string) => `
You are the scholarship strategist. For ONE university, write the step-by-step plan for the regional
DSU scholarship (and any university merit/fee-waiver award in the excerpts) for an Iranian applicant
targeting ${intake}.

- limits: copy the ISEE and ISPE ceilings exactly as the excerpts state them, with the chunk id.
- deadlines: ISO dates for the client's intake. If the excerpts only give last year's dates, shift them
  by one year and set confidence "PROJECTED"; if the excerpts give the new year's date, "CONFIRMED".
  dsuRequiresVisa: true if the bando requires a copy of the visa with the application.
- amounts: fuori sede (non-resident) award, housing/canteen value, fee waiver — as stated.
- steps: in order, concrete and Iranian-specific: Temporary Access Code (no SPID), legalised and
  translated consular family income/asset documents for the ISEE Parificato (sent by post/courier),
  online application, upload of signed form + passport, visa copy if required, rankings and
  acceptance, enrolment, permesso di soggiorno within 8 working days, merit credits (CFU) to keep
  the award in year 2. Each step: due date when known, sourceChunkIds.
- risks: anything that has cost applicants the scholarship (deadline before visa, documents by post).
Use only facts from the excerpts; cite chunk ids.
`;

export async function runScholarship(
  ctx: RunContext,
  profile: ClientProfile,
  candidate: Candidate,
  opts: { tomanPerEur?: number; correction?: string },
): Promise<ScholarshipResult> {
  const r = ctx.retriever;
  const regional = await r.search(`${candidate.region} DSU scholarship deadline ISEE ceiling amount fuori sede international students`, {
    k: 8,
    regions: [candidate.region],
    includeNational: false,
  });
  const uni = await r.search(`${candidate.university} scholarship fee waiver merit award international`, { k: 4, regions: [candidate.region] });
  const national = await r.search("Iranian students DSU application Temporary Access Code ISEE Parificato consular documents", {
    k: 4,
    docTypes: ["national"],
  });

  const { data, usage } = await runAgentJSON(ScholarshipPlan, {
    agent: "scholarship",
    role: ROLE(ctx.intake),
    prompt: [
      `Today: ${ctx.today}. University: ${candidate.university} (${candidate.city}, ${candidate.region}). candidateId: ${candidate.id}`,
      `Client household: ${json(profile.family)}`,
      opts.correction ? `Manager's correction order (must be addressed): ${opts.correction}` : "",
      `Excerpts:\n\n${formatChunks(uniqueHits(regional, uni, national), 28_000)}`,
    ].join("\n\n"),
    temperature: 0.4,
    lessons: await ctx.lessons("scholarship"),
  });
  ctx.addUsage(usage);

  const f = profile.family;
  const estimate =
    opts.tomanPerEur && f.annualIncomeToman != null && f.householdSize
      ? estimateIsee(f.annualIncomeToman / opts.tomanPerEur, (f.assetsToman ?? 0) / opts.tomanPerEur, f.householdSize)
      : null;
  const isee = estimate
    ? { ...checkIsee(estimate, data.limits), estimate: estimate.isee }
    : {
        verdict: "unknown" as const,
        reason: opts.tomanPerEur ? "family income/household size not provided" : "today's toman/EUR rate not provided",
        estimate: null,
      };

  const d = data.deadlines;
  const startBy = d.dsu
    ? planBackwards(
        d.dsu,
        [
          { task: "Request legalised consular family income/asset documents (ISEE Parificato)", leadDays: LEAD_DAYS.consularFamilyDocs },
          { task: "Certified translation + Justice/MFA legalisation", leadDays: LEAD_DAYS.translationLegalisation },
        ],
        ctx.today,
      )
    : [];
  if (d.admission) {
    startBy.push(...planBackwards(d.admission, [{ task: "CIMEA statement of comparability + verification", leadDays: LEAD_DAYS.cimea }], ctx.today));
  }

  return {
    plan: { ...data, candidateId: candidate.id },
    isee,
    calendarRisks: calendarRisks({
      admissionDeadline: d.admission,
      enrolmentDeadline: d.enrolment,
      dsuDeadline: d.dsu,
      dsuRequiresVisa: d.dsuRequiresVisa,
      today: ctx.today,
    }),
    startBy: startBy.sort((a, b) => a.startBy.localeCompare(b.startBy)),
  };
}
