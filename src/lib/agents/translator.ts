// Agent 11 — Translator: full formal Persian, not a summary. Code checks the result
// (sections, numbers, proper nouns) and asks for one corrected version if needed.
import { runAgentText } from "../ai";
import { checkTranslation } from "../rules/translation-checks";
import type { RunContext } from "./context";

const ROLE = `
Translate the report into formal Persian (فارسی رسمی) for the client. Requirements:
- Translate EVERYTHING — every section, table row and step. Not a summary.
- Keep the same markdown structure: the same number of "## " headings, tables, lists.
- Keep proper nouns in Latin script: university names, portals (Universitaly, CIMEA, VisaMetric),
  DSU bodies, programme names, URLs and (KB: …) references.
- Keep every number, date and amount exactly (you may write dates as "4 September 2027" in Latin
  digits). Do not convert currencies.
Output only the translated markdown.
`;

export async function runTranslator(ctx: RunContext, en: string, properNouns: string[]) {
  const lessons = await ctx.lessons("translator");
  let fa = "";
  let failures: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, usage } = await runAgentText({
      agent: "translator",
      role: ROLE,
      prompt: attempt === 0 ? en : `Your translation had these problems:\n${failures.map((f) => `- ${f}`).join("\n")}\n\nTranslate again, completely:\n\n${en}`,
      temperature: 0.3,
      maxOutputTokens: 24_000,
      lessons,
    });
    ctx.addUsage(usage);
    fa = text.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/, "$1").trim();
    const check = checkTranslation(en, fa, properNouns);
    failures = check.failures;
    if (check.pass) break;
  }
  return { fa, failures };
}
