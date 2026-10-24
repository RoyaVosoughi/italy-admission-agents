// Finds the checkable facts in a report: every line with a date, an amount, a test score
// or a grade threshold. The Manager audits exactly this list, so nothing slips through
// because a model "forgot" to mention it.
import { createHash } from "node:crypto";

export type ClaimKind = "date" | "money" | "score" | "grade";

export interface Claim {
  id: string;
  kinds: ClaimKind[];
  text: string;
  section: string;
  line: number;
  cited: boolean;
  /** Cited only to the client's own documents (their GPA, scores): not an external fact to verify. */
  clientOnly: boolean;
  /** Official links in the line. */
  urls: string[];
}

// Markdown links and plain URLs (writers sometimes put the URL in `code` instead of a link).
const LINK = /\]\((https?:\/\/[^)\s]+)\)|(?<!\]\()(https?:\/\/[^\s)`'"<>|]+)/g;
// The client's own data, or values computed from it (GPA conversion, ISEE estimate).
const CLIENT_CITE = /\((?:client documents?|computed facts)(?:\s?[;,][^()]{0,80})?\)/i;

const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const DETECT: Record<ClaimKind, RegExp> = {
  date: new RegExp(`\\b\\d{1,2}\\s${MONTH}(?:\\s\\d{4})?\\b|\\b${MONTH}\\s\\d{1,2},?\\s\\d{4}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b`, "i"),
  money: /€\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:EUR|euros?)\b|\b\d[\d,]*\s?(?:toman|million toman)\b/i,
  score: /\b(?:IELTS|TOEFL|Duolingo|FCE|Cambridge|PTE|TOLC[-\w]*|CILS|CELI)\b[^.\n|]{0,20}?\b\d{1,3}(?:\.\d)?\b/i,
  grade: /\b\d{1,3}(?:\.\d+)?\s?\/\s?(?:30|110|20)\b/,
};

/**
 * A citation is an official link [name](https://…), a knowledge-base reference — (KB: marche#12),
 * (KB: piedmont#3, national-dsu-guide#10) or [piedmont#0] — or "(client documents)" for the client's own data.
 */
// Also accepts short follow-up ids and a label inside the brackets: (KB: veneto#4, #19; projected)
export const CITATION =
  /https?:\/\/[^\s)`'"<>|]+|[([](?:KB:\s?)?[\w-]+#\d+(?:\s?[,;]\s?(?:(?:KB:\s?)?[\w-]+)?#\d+)*(?:\s?[,;]\s?[^()[\]]{0,80})?[)\]]|\((?:client documents?|computed facts)(?:\s?[;,][^()]{0,80})?\)/i;

// Not external facts: our own fee, and the client's own data in the snapshot.
const NO_CLAIM_SECTIONS = /sources|references|our service fee|client snapshot|فارسی|persian/i;

/** Code-rendered blocks (scores, cost sums) are computed, not sourced — wrapped in these markers and skipped. */
export const COMPUTED_START = "<!-- computed -->";
export const COMPUTED_END = "<!-- /computed -->";

export function claimId(text: string): string {
  return "c" + createHash("sha1").update(text.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex").slice(0, 8);
}

export function extractClaims(markdown: string): Claim[] {
  const claims: Claim[] = [];
  let section = "";
  let computed = false;
  markdown.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (line === COMPUTED_START || line === COMPUTED_END) {
      computed = line === COMPUTED_START;
      return;
    }
    if (computed) return;
    const h = line.match(/^#{1,3}\s+(.*)/);
    if (h) {
      if (/^#{1,2}\s/.test(line)) section = h[1];
      return;
    }
    if (!line || NO_CLAIM_SECTIONS.test(section) || /^\|[\s:|-]+\|$/.test(line)) return;
    const kinds = (Object.keys(DETECT) as ClaimKind[]).filter((k) => DETECT[k].test(line));
    if (!kinds.length) return;
    const urls = [...line.matchAll(LINK)].map((m) => (m[1] ?? m[2]).replace(/[.,;]+$/, ""));
    const otherCite = urls.length > 0 || CITATION.test(line.replace(CLIENT_CITE, ""));
    claims.push({
      id: claimId(line),
      kinds,
      text: line,
      section,
      line: i + 1,
      cited: CITATION.test(line),
      clientOnly: CLIENT_CITE.test(line) && !otherCite,
      urls,
    });
  });
  return claims;
}
