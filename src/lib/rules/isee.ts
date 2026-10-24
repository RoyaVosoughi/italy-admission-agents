// Rough ISEE Parificato estimate and DSU eligibility check.
// The real ISEE Parificato is computed by the DSU body (or a CAF) from legalised consular
// documents, with deductions we can't model. This gives a planning estimate only and the
// report must say so; borderline cases are flagged instead of decided.

/** Italian ISEE equivalence scale (DPCM 159/2013): household size → divisor. */
export function equivalenceScale(householdSize: number): number {
  const table = [0, 1, 1.57, 2.04, 2.46, 2.85];
  if (householdSize <= 5) return table[Math.max(1, Math.round(householdSize))];
  return 2.85 + 0.35 * (Math.round(householdSize) - 5);
}

export interface IseeEstimate {
  isee: number;
  ispe: number;
  scale: number;
  note: string;
}

/** income and assets in EUR (convert from toman at the day's rate before calling). */
export function estimateIsee(annualIncomeEur: number, assetsEur: number, householdSize: number): IseeEstimate {
  const scale = equivalenceScale(householdSize);
  const isp = assetsEur;
  return {
    isee: Math.round(((annualIncomeEur + 0.2 * isp) / scale) * 100) / 100,
    ispe: Math.round((isp / scale) * 100) / 100,
    scale,
    note: "Planning estimate: (income + 20% of assets) / equivalence scale. The DSU body computes the official ISEE Parificato.",
  };
}

export type IseeVerdict = "eligible" | "borderline" | "ineligible" | "unknown";

export function checkIsee(
  est: Pick<IseeEstimate, "isee" | "ispe"> | null,
  limits: { iseeMax: number | null; ispeMax: number | null },
  borderlineShare = 0.1,
): { verdict: IseeVerdict; reason: string } {
  if (!est || limits.iseeMax == null) return { verdict: "unknown", reason: "family income/assets or the ISEE ceiling is unknown" };
  if (est.isee > limits.iseeMax) return { verdict: "ineligible", reason: `estimated ISEE €${est.isee} is above the €${limits.iseeMax} ceiling` };
  if (limits.ispeMax != null && est.ispe > limits.ispeMax) {
    return { verdict: "ineligible", reason: `estimated ISPE €${est.ispe} is above the €${limits.ispeMax} ceiling` };
  }
  const near = (v: number, max: number) => v > max * (1 - borderlineShare);
  if (near(est.isee, limits.iseeMax) || (limits.ispeMax != null && near(est.ispe, limits.ispeMax))) {
    return { verdict: "borderline", reason: "estimate is within 10% of a ceiling — the official calculation decides" };
  }
  return { verdict: "eligible", reason: `estimated ISEE €${est.isee} is below the €${limits.iseeMax} ceiling` };
}
