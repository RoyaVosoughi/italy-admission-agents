// Checks that the Farsi translation is complete and didn't change any facts:
// same number of sections, every number of the English report present, and proper
// nouns (universities, portals) kept in Latin script.
import { toAsciiDigits } from "../rag/clean";

const numbersIn = (s: string) =>
  (toAsciiDigits(s).replace(/٬|،/g, ",").match(/\d[\d,.]*\d|\d/g) ?? []).map((n) => n.replace(/[,.](?=\d{3}\b)/g, "").replace(/,/g, "."));

export function checkTranslation(en: string, fa: string, properNouns: string[]): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  const h = (s: string) => (s.match(/^##\s/gm) ?? []).length;
  if (h(en) !== h(fa)) failures.push(`section count differs: EN ${h(en)}, FA ${h(fa)}`);

  const faNums = new Map<string, number>();
  for (const n of numbersIn(fa)) faNums.set(n, (faNums.get(n) ?? 0) + 1);
  const missing = [...new Set(numbersIn(en))].filter((n) => !faNums.has(n));
  if (missing.length) failures.push(`numbers missing in Farsi: ${missing.slice(0, 15).join(", ")}`);

  const lostNames = properNouns.filter((n) => en.includes(n) && !fa.includes(n));
  if (lostNames.length) failures.push(`proper nouns not kept in Latin script: ${lostNames.join(", ")}`);

  const persianChars = (fa.match(/[؀-ۿ]/g) ?? []).length;
  if (persianChars < fa.length * 0.3) failures.push("the Farsi version is mostly not in Persian");

  return { pass: failures.length === 0, failures };
}
