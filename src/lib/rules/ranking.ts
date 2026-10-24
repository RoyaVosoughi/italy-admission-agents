// Shortlist selection. "Recommend universities with a high probability of acceptance"
// is enforced here in code: Unlikely options are dropped and Reach options are capped.
import type { Candidate, ChanceRating, ClientProfile, Tier } from "../agents/types";

const TIER_RANK: Record<Tier, number> = { High: 0, Medium: 1, Reach: 2, Unlikely: 3 };

export interface ShortlistOptions {
  max?: number;
  maxReach?: number;
  maxPerUniversity?: number;
}

export interface Ranked {
  candidate: Candidate;
  rating: ChanceRating;
  preferenceBonus: number;
}

export function shortlist(
  candidates: Candidate[],
  ratings: ChanceRating[],
  prefs: ClientProfile["preferences"],
  { max = 8, maxReach = 2, maxPerUniversity = 2 }: ShortlistOptions = {},
): { selected: Ranked[]; dropped: { candidate: Candidate; reason: string }[] } {
  const byId = new Map(ratings.map((r) => [r.candidateId, r]));
  const lc = (s: string) => s.toLowerCase();
  const prefCities = prefs.cities.map(lc);
  const prefRegions = prefs.regions.map(lc);

  const ranked: Ranked[] = [];
  const dropped: { candidate: Candidate; reason: string }[] = [];
  for (const c of candidates) {
    const rating = byId.get(c.id);
    if (!rating) {
      dropped.push({ candidate: c, reason: "no rating" });
      continue;
    }
    if (rating.tier === "Unlikely") {
      dropped.push({ candidate: c, reason: `Unlikely (score ${rating.score})` });
      continue;
    }
    if (prefs.languageOfInstruction !== "either" && c.language !== "unknown" && c.language !== prefs.languageOfInstruction) {
      dropped.push({ candidate: c, reason: `taught in ${c.language}, client wants ${prefs.languageOfInstruction}` });
      continue;
    }
    const bonus = (prefCities.includes(lc(c.city)) ? 5 : 0) + (prefRegions.includes(lc(c.region)) ? 3 : 0);
    ranked.push({ candidate: c, rating, preferenceBonus: bonus });
  }

  ranked.sort(
    (a, b) =>
      TIER_RANK[a.rating.tier] - TIER_RANK[b.rating.tier] ||
      b.rating.score + b.preferenceBonus - (a.rating.score + a.preferenceBonus),
  );

  const selected: Ranked[] = [];
  const perUni = new Map<string, number>();
  let reach = 0;
  for (const r of ranked) {
    const uni = lc(r.candidate.university);
    if (selected.length >= max) {
      dropped.push({ candidate: r.candidate, reason: "shortlist full" });
      continue;
    }
    if ((perUni.get(uni) ?? 0) >= maxPerUniversity) {
      dropped.push({ candidate: r.candidate, reason: `already ${maxPerUniversity} programs at this university` });
      continue;
    }
    if (r.rating.tier === "Reach" && reach >= maxReach) {
      dropped.push({ candidate: r.candidate, reason: `Reach limit (${maxReach}) reached` });
      continue;
    }
    if (r.rating.tier === "Reach") reach++;
    perUni.set(uni, (perUni.get(uni) ?? 0) + 1);
    selected.push(r);
  }
  return { selected, dropped };
}
