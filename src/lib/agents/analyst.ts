// Agent 4 — Admission Analyst, one call per candidate (run in parallel by the orchestrator).
// The LLM only extracts features from the evidence; rules/chance.ts computes the score.
import { runAgentJSON } from "../ai";
import { rateChance } from "../rules/chance";
import type { ProfileFacts } from "../rules/profile";
import { ChanceFeatures, type Candidate, type ChanceRating, type ClientProfile } from "./types";
import { formatChunks, json, uniqueHits, type RunContext } from "./context";

const ROLE = `
You are an admissions analyst. For ONE candidate programme, read the evidence and classify each
admission factor for this client. Be conservative: when the evidence is silent, use "unknown" rather
than an optimistic value.

- fieldMatch: compare the PROGRAMME's discipline with the discipline of the client's COMPLETED degree (not with
  what the client wishes to study). exact = same discipline (a law graduate applying to a law master's);
  related = adjacent, prerequisites likely partly covered (a law graduate applying to international relations
  or security studies); weak = unrelated. When the candidate has no specific programme name, never use exact.
- gpaRequirement30: a minimum grade on the Italian /30 scale only if the evidence states one
  (convert /110 by ×30/110). Otherwise null.
- languageStatus: compare the client's certificate with the programme/embassy requirement:
  met, close (within 0.5 IELTS / 5 TOEFL points, or test planned), missing.
- entranceTest: required if TOLC/GMAT/GRE/SAT/own test is mentioned for this route.
- competitiveness / nonEuQuota: from what the evidence says about places, quotas, selectivity.
- prerequisites: credits (CFU) in specific subjects the programme requires vs. the client's degree.
- rationale: 2–4 sentences citing (KB: id) for the facts used.
`;

export async function runAnalyst(
  ctx: RunContext,
  profile: ClientProfile,
  facts: ProfileFacts,
  candidate: Candidate,
  correction?: { instruction: string; previous: ChanceFeatures },
): Promise<ChanceRating> {
  const extra = await ctx.retriever.search(
    `${candidate.university} ${candidate.programArea} admission requirements international applicants deadline language`,
    { k: 6, regions: [candidate.region] },
  );
  const cited = extra.filter((h) => candidate.sourceChunkIds.includes(h.chunk.id));
  const evidence = formatChunks(uniqueHits(cited, extra), 16_000);

  const { data, usage } = await runAgentJSON(ChanceFeatures, {
    agent: "analyst",
    role: ROLE,
    prompt: [
      `Candidate:\n${json(candidate)}`,
      `Client: ${profile.targetLevel}, background ${facts.qualifyingDegree?.field ?? "unknown"}, GPA ${
        facts.gpa ? `${facts.gpa.raw}/${facts.gpa.scale} = ${facts.gpa.italian30}/30` : "unknown"
      }, English ${facts.english.best ? `${facts.english.best.test} ${facts.english.best.overall}` : "none"}${
        facts.english.planned ? " (test planned)" : ""
      }, Italian ${profile.italianLevel}, work: ${profile.workExperience.map((w) => `${w.role} ${w.years}y`).join("; ") || "none"}.`,
      correction
        ? `The Manager disputes your previous rating: ${correction.instruction}\n` +
          `Your previous features: ${json(correction.previous)}\n` +
          `The score is computed by code from these features, so change the specific feature(s) the Manager's point is about ` +
          `(e.g. competitiveness very_high, gpaRequirement30, nonEuQuota) if the evidence or the point is sound; keep the others.`
        : "",
      `Evidence:\n\n${evidence}`,
    ].join("\n\n"),
    temperature: 0.2,
    effort: "medium",
    lessons: await ctx.lessons("analyst"),
  });
  ctx.addUsage(usage);
  return rateChance(candidate.id, data, facts.gpa?.italian30 ?? null);
}
