// Deterministic profile facts. Anything computable is computed here, not by an LLM:
// a model asked to "convert 16.5/20 to the Italian scale" will sometimes get it wrong.
import type { ClientProfile } from "../agents/types";

type Cert = ClientProfile["languageCerts"][number];
export type Cefr = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

/** Pass marks for common scales, used when the resume doesn't state one. */
const DEFAULT_MIN_PASS: Record<number, number> = { 20: 10, 4: 2, 100: 50, 30: 18, 110: 66 };

export interface GpaConversion {
  raw: number;
  scale: number;
  minPass: number;
  italian30: number;
  italian110: number;
  germanGrade: number; // modified Bavarian formula, 1.0 best – 4.0 pass
  percent: number;
}

export function convertGpa(raw: number, scale = 20, minPass?: number | null): GpaConversion {
  const min = minPass ?? DEFAULT_MIN_PASS[scale] ?? scale / 2;
  const pos = Math.min(1, Math.max(0, (raw - min) / (scale - min)));
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    raw,
    scale,
    minPass: min,
    italian30: r1(18 + pos * 12),
    italian110: Math.round(66 + pos * 44),
    germanGrade: r1(1 + 3 * (1 - pos)),
    percent: Math.round((raw / scale) * 100),
  };
}

// Score → CEFR bands from the test owners' published concordance tables.
// Duolingo is approximate (its concordance is a range table, not hard cut-offs).
const CEFR_BANDS: Partial<Record<Cert["test"], [number, Cefr][]>> = {
  IELTS: [[8.5, "C2"], [7, "C1"], [5.5, "B2"], [4, "B1"]],
  TOEFL_iBT: [[114, "C2"], [95, "C1"], [72, "B2"], [42, "B1"]],
  Cambridge: [[200, "C2"], [180, "C1"], [160, "B2"], [140, "B1"]],
  PTE: [[85, "C2"], [76, "C1"], [59, "B2"], [43, "B1"]],
  Duolingo: [[140, "C2"], [120, "C1"], [100, "B2"], [75, "B1"]],
};
const CEFR_ORDER: Cefr[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
export const cefrAtLeast = (a: Cefr, b: Cefr) => CEFR_ORDER.indexOf(a) >= CEFR_ORDER.indexOf(b);

export function cefrOf(cert: Cert): Cefr | null {
  const bands = CEFR_BANDS[cert.test];
  if (!bands || cert.overall == null) return null;
  return bands.find(([min]) => cert.overall! >= min)?.[1] ?? "A2";
}

/** Embassy of Italy in Tehran, study-visa checklist item 8 (English-taught courses). */
export const EMBASSY_ENGLISH_MIN: Partial<Record<Cert["test"], number>> = { IELTS: 6, TOEFL_iBT: 78, Cambridge: 169 };
export const EMBASSY_SOURCE = "embassy-visa-checklist (item 8): IELTS 6, TOEFL 78, FCE 169; B2 for Italian";

/**
 * Proof of funds, checklist items 11–14. The checklist text says "€10,179.85 for each month of the
 * academic year" in item 11 but uses €10,179.85 as the total in items 12 and 14 — ambiguous, so the
 * verifier must confirm it on ambteheran.esteri.it before a report states it.
 */
export const VISA_FUNDS = { eur: 10179.85, needsLiveCheck: true, source: "embassy-visa-checklist items 11–14" };

export interface EnglishStatus {
  best: Cert | null;
  cefr: Cefr | null;
  meetsEmbassyMinimum: boolean;
  planned: boolean;
}

export function englishStatus(certs: Cert[]): EnglishStatus {
  const english = certs.filter((c) => c.test in CEFR_BANDS);
  const taken = english.filter((c) => !c.planned && c.overall != null);
  const ranked = taken
    .map((c) => ({ c, level: cefrOf(c) }))
    .sort((a, b) => CEFR_ORDER.indexOf(b.level ?? "A1") - CEFR_ORDER.indexOf(a.level ?? "A1"));
  const best = ranked[0]?.c ?? null;
  const meets = taken.some((c) => {
    const min = EMBASSY_ENGLISH_MIN[c.test];
    return min != null && c.overall! >= min;
  });
  return { best, cefr: ranked[0]?.level ?? null, meetsEmbassyMinimum: meets, planned: english.some((c) => c.planned) };
}

export interface ProfileFacts {
  qualifyingDegree: ClientProfile["education"][number] | null;
  gpa: GpaConversion | null;
  english: EnglishStatus;
  italianB2: boolean;
  twelveYearsSchooling: boolean | null;
  ageAtIntake: number | null;
  issues: string[];
}

/** The degree that admission is judged on: high school for a bachelor, bachelor for a master… */
const QUALIFYING: Record<ClientProfile["targetLevel"], ClientProfile["education"][number]["level"][]> = {
  bachelor: ["high_school"],
  master: ["bachelor"],
  phd: ["master"],
};

export function profileFacts(p: ClientProfile, intakeYear = 2027): ProfileFacts {
  const issues: string[] = [];
  const qualifying =
    p.education.find((e) => QUALIFYING[p.targetLevel].includes(e.level)) ??
    null;
  if (!qualifying) issues.push(`No ${QUALIFYING[p.targetLevel].join("/")} qualification found for a ${p.targetLevel} application.`);
  else if (!qualifying.completed) issues.push(`${qualifying.level} not completed yet — admission will be conditional on graduation.`);

  const gpa = qualifying?.gpa != null ? convertGpa(qualifying.gpa, qualifying.gpaScale ?? 20, qualifying.gpaMinPass) : null;
  if (!gpa) issues.push("GPA of the qualifying degree is unknown.");

  const english = englishStatus(p.languageCerts);
  const italianB2 = cefrAtLeast(p.italianLevel === "none" ? "A1" : p.italianLevel, "B2") && p.italianLevel !== "none";
  if (!english.meetsEmbassyMinimum && !italianB2) {
    issues.push(
      english.planned
        ? "Language test planned but not taken: the embassy needs IELTS 6 / TOEFL 78 / FCE 169 (or Italian B2) at visa time."
        : "No language certificate that meets the embassy minimum (IELTS 6 / TOEFL 78 / FCE 169, or Italian B2).",
    );
  }

  const school = p.education.find((e) => e.level === "high_school");
  const twelve = school?.schoolingYears != null ? school.schoolingYears >= 12 : null;
  if (p.targetLevel === "bachelor" && twelve === false) {
    issues.push("Fewer than 12 years of schooling: Italian bachelor's admission needs 12 (old-system diploma + Pish-Daneshgahi counts).");
  }

  return {
    qualifyingDegree: qualifying,
    gpa,
    english,
    italianB2,
    twelveYearsSchooling: twelve,
    ageAtIntake: p.birthYear ? intakeYear - p.birthYear : null,
    issues,
  };
}

/** Critical facts without which the pipeline must pause and ask (needs_input). */
export function missingCriticalFacts(p: ClientProfile): string[] {
  const missing = [...p.missing];
  const f = profileFacts(p);
  if (!f.qualifyingDegree) missing.push("qualifying degree");
  else if (f.qualifyingDegree.gpa == null) missing.push("GPA of the qualifying degree");
  if (p.languageCerts.length === 0 && p.italianLevel === "none") missing.push("language status (test score or plan)");
  return [...new Set(missing)];
}
