// Agent 2 — Profile Assessor: the honest critic of the client. Its weaknesses list
// becomes the report's "Gaps and action plan".
import { runAgentJSON } from "../ai";
import type { ProfileFacts } from "../rules/profile";
import { Assessment, type ClientProfile } from "./types";
import { json, type RunContext } from "./context";

const ROLE = `
You are a senior admissions counsellor for Italian public universities. Assess the client's profile
honestly. The computed facts (GPA conversions, CEFR level, embassy minimums) are correct — use them,
do not recompute them.

- eligibleTracks: which degree levels are realistic and why.
- strengths / weaknesses: concrete. Each weakness gets a fix and, when timing matters, by when
  (relative to the intake). Low GPA, missing or insufficient language certificate, field change,
  gap years, missing prerequisites are typical weaknesses.
- degreeClasses: Italian degree classes the client's background fits (LM-xx for master's, L-xx for
  bachelor's), most relevant first.
- searchThemes: 3–6 program areas in English to search for (e.g. "structural engineering",
  "construction management", "geotechnics").
`;

export async function runAssessor(ctx: RunContext, profile: ClientProfile, facts: ProfileFacts): Promise<Assessment> {
  const { data, usage } = await runAgentJSON(Assessment, {
    agent: "assessor",
    role: ROLE,
    prompt: `Client profile:\n${json(profile)}\n\nComputed facts:\n${json(facts)}`,
    temperature: 0.3,
    lessons: await ctx.lessons("assessor"),
  });
  ctx.addUsage(usage);
  return data;
}
