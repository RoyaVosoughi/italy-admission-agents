// Personal-data guard. Used twice: on the finished report (CLAUDE.md: never put national
// ID or phone numbers in a report) and on every outgoing web-search query (client data
// must never leave the machine inside a Tavily request).

const PATTERNS: { kind: string; re: RegExp }[] = [
  // 10 digits not part of a larger number ("28,339.88" or "1234567890123" don't count)
  { kind: "national ID", re: /(?<!\d|\d[.,])\d{3}-?\d{6}-?\d(?!\d|[.,]\d)/g },
  { kind: "mobile number", re: /(?:\+98|0098|\b0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g },
  { kind: "landline number", re: /(?:\+98|0098|\b0)(?:21|2[2-9]|[3-8]\d)[\s-]?\d{8}\b/g },
  { kind: "email address", re: /[\w.+-]+@[\w-]+\.[\w.]+/g },
  { kind: "passport number", re: /\b[A-Z]\d{8}\b/g },
  // CV formats: "Passport: 12345678" (no letter) and "(+98) 912 000 0000" (parenthesised prefix)
  { kind: "passport number", re: /\b(?:passport|پاسپورت)\s*(?:no\.?|number|#)?\s*[:\-]?\s*[A-Z]?\d{6,9}\b/gi },
  { kind: "mobile number", re: /(?:\(\s*\+98\s*\)|\+98|0098)[\s-]*0?\d{2,3}[\s-]?\d{3}[\s-]?\d{4}\b/g },
];

/** Offices publish contact emails; those are fine in a report. */
const ALLOWED_EMAIL = /@(?:[\w-]+\.)*(?:it|eu|esteri\.it|uni-italia\.it)$/i;

export function findPii(text: string): { kind: string; match: string }[] {
  const out: { kind: string; match: string }[] = [];
  // Digits inside web addresses ("…A.%20Y.%2020262027…") are not personal data.
  const scanned = text.replace(/https?:\/\/[^\s)`'"<>|]+/g, " ");
  for (const { kind, re } of PATTERNS) {
    for (const m of scanned.matchAll(re)) {
      if (kind === "email address" && ALLOWED_EMAIL.test(m[0])) continue;
      out.push({ kind, match: m[0] });
    }
  }
  return out;
}

/** Client documents are redacted BEFORE they reach a model: identifiers are not needed to assess a profile. */
export function redactPii(text: string): string {
  let out = text;
  for (const p of findPii(text)) out = out.split(p.match).join("[removed]");
  return out;
}

export function assertNoPii(query: string, names: string[] = []): void {
  const hits = findPii(query).map((h) => h.kind);
  for (const n of names) if (n.length > 2 && query.toLowerCase().includes(n.toLowerCase())) hits.push("client name");
  if (hits.length) throw new Error(`Blocked outgoing query: contains ${[...new Set(hits)].join(", ")}`);
}
