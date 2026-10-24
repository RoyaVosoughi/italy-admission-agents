// Admission-chance rubric. The analyst agent extracts features (field match,
// competitiveness…); this file turns them into a score. Keeping the arithmetic in code
// makes every rating explainable ("−10: high competitiveness") and lets the outcome log
// tune WEIGHTS later without touching prompts.
import type { ChanceFeatures, ChanceRating, Tier } from "../agents/types";

export const WEIGHTS = {
  base: 50,
  fieldMatch: { exact: 15, related: 0, weak: -30 },
  gpaVsRequirement: { above2: 15, meets: 8, justBelow: -10, farBelow: -30 },
  gpaGeneric: { excellent: 15, good: 8, fair: 0, weak: -8, poor: -15 }, // when no requirement is published
  language: { met: 10, close: -5, missing: -20 },
  entranceTest: { none: 0, required: -5, unknown: -2 },
  competitiveness: { low: 10, medium: 0, high: -10, very_high: -20, unknown: -3 },
  nonEuQuota: { ample: 5, limited: -5, very_limited: -15, unknown: 0 },
  prerequisites: { met: 5, partial: -8, missing: -25, unknown: -2 },
  caps: { weakField: 45, missingPrerequisites: 45 },
  tiers: { High: 70, Medium: 50, Reach: 30 },
} as const;

export function tierOf(score: number): Tier {
  const t = WEIGHTS.tiers;
  return score >= t.High ? "High" : score >= t.Medium ? "Medium" : score >= t.Reach ? "Reach" : "Unlikely";
}

/**
 * Rubric score → an estimated acceptance percentage with a range. This is NOT a measured probability:
 * it is a smooth conversion of the rubric score (50 ≈ a coin flip), capped at 5–90% because no admission is
 * certain, with a wider range when the evidence left factors unknown. Once real outcomes are recorded
 * (Outcomes tab) the curve can be calibrated against them.
 */
export function acceptanceEstimate(r: { score: number; features: ChanceFeatures }): { pct: number; low: number; high: number } {
  const f = r.features;
  const unknown =
    [f.competitiveness, f.nonEuQuota, f.prerequisites, f.entranceTest].filter((v) => v === "unknown").length + (f.gpaRequirement30 == null ? 1 : 0);
  const pct = Math.round(Math.min(90, Math.max(5, 100 / (1 + Math.exp(-(r.score - 50) / 14)))));
  const spread = 8 + 3 * unknown;
  return { pct, low: Math.max(1, pct - spread), high: Math.min(95, pct + spread) };
}

function gpaPoints(client30: number | null, required30: number | null): { points: number; label: string } {
  if (client30 == null) return { points: -5, label: "GPA unknown" };
  if (required30 != null) {
    const d = client30 - required30;
    const w = WEIGHTS.gpaVsRequirement;
    if (d >= 2) return { points: w.above2, label: `GPA ${client30}/30 well above the ${required30} minimum` };
    if (d >= 0) return { points: w.meets, label: `GPA ${client30}/30 meets the ${required30} minimum` };
    if (d >= -1) return { points: w.justBelow, label: `GPA ${client30}/30 just below the ${required30} minimum` };
    return { points: w.farBelow, label: `GPA ${client30}/30 clearly below the ${required30} minimum` };
  }
  const w = WEIGHTS.gpaGeneric;
  if (client30 >= 27) return { points: w.excellent, label: `GPA ${client30}/30 excellent` };
  if (client30 >= 25) return { points: w.good, label: `GPA ${client30}/30 good` };
  if (client30 >= 23) return { points: w.fair, label: `GPA ${client30}/30 average` };
  if (client30 >= 21) return { points: w.weak, label: `GPA ${client30}/30 below average` };
  return { points: w.poor, label: `GPA ${client30}/30 low` };
}

const IMPROVE: Partial<Record<string, string>> = {
  "language:close": "Retake the language test to clear the program minimum with margin.",
  "language:missing": "Book IELTS/TOEFL now — no Italian application or visa works without it.",
  "fieldMatch:weak": "Choose programs closer to the bachelor's field, or document relevant credits/work.",
  "prerequisites:partial": "List the courses that cover the program's prerequisite credits (CFU) in the application.",
  "prerequisites:missing": "Take bridging courses or choose a program whose prerequisites match the transcript.",
  "entranceTest:required": "Register early for the entrance test (e.g. TOLC/ENGLISH TOLC) and prepare.",
};

export function rateChance(candidateId: string, f: ChanceFeatures, clientGpa30: number | null): ChanceRating {
  const factors: { factor: string; points: number }[] = [];
  const add = (factor: string, points: number) => points !== 0 && factors.push({ factor, points });

  add(`field match: ${f.fieldMatch}`, WEIGHTS.fieldMatch[f.fieldMatch]);
  const g = gpaPoints(clientGpa30, f.gpaRequirement30);
  add(g.label, g.points);
  add(`language requirement: ${f.languageStatus}`, WEIGHTS.language[f.languageStatus]);
  add(`entrance test: ${f.entranceTest}`, WEIGHTS.entranceTest[f.entranceTest]);
  add(`competitiveness: ${f.competitiveness}`, WEIGHTS.competitiveness[f.competitiveness]);
  add(`non-EU quota: ${f.nonEuQuota}`, WEIGHTS.nonEuQuota[f.nonEuQuota]);
  add(`prerequisites: ${f.prerequisites}`, WEIGHTS.prerequisites[f.prerequisites]);

  let score = WEIGHTS.base + factors.reduce((n, x) => n + x.points, 0);
  if (f.fieldMatch === "weak") score = Math.min(score, WEIGHTS.caps.weakField);
  if (f.prerequisites === "missing") score = Math.min(score, WEIGHTS.caps.missingPrerequisites);
  score = Math.max(0, Math.min(100, score));

  const improve = [
    IMPROVE[`language:${f.languageStatus}`],
    IMPROVE[`fieldMatch:${f.fieldMatch}`],
    IMPROVE[`prerequisites:${f.prerequisites}`],
    IMPROVE[`entranceTest:${f.entranceTest}`],
  ].filter((x): x is string => !!x);

  return { candidateId, features: f, score, tier: tierOf(score), factors, improve };
}
