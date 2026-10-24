// Hard checks on the English report. A failure here blocks
// approval no matter what the Manager says (plan §4.2).
import { extractClaims } from "./claims";
import { findPii } from "./pii";

export const REQUIRED_SECTIONS = [
  "Client snapshot",
  "Executive recommendation",
  "Recommended universities",
  "Scholarship guide",
  "Application steps",
  "Document checklist",
  "Cost of the whole process",
  "Our service fee",
  "Gaps and action plan",
  "Sources",
] as const;

export interface CheckFailure {
  rule: string;
  detail: string;
}

const PROMISE = /\b(guarantee[ds]?|guaranteeing|100\s?% (?:chance|certain|sure)|certain(?:ly)? to be (?:admitted|accepted)|assured admission)\b|تضمین/gi;
const NEGATION = /\b(?:not|no|cannot|can't|never|without|nor|neither|does not|do not|is not|we don't)\b[^.]{0,30}$/i;
export const UNVERIFIED_LABEL = /\b(projected|expected|estimate[d]?|not yet published|unverified|to be confirmed|pattern)\b/i;

function sections(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = md.split(/^##\s+/m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf("\n");
    const title = (nl < 0 ? p : p.slice(0, nl)).replace(/^\d+[.)]\s*/, "").trim();
    out.set(title.toLowerCase(), nl < 0 ? "" : p.slice(nl + 1));
  }
  return out;
}

export function checkReport(md: string, opts: { unverifiedClaimIds?: Set<string> } = {}): { pass: boolean; failures: CheckFailure[] } {
  const failures: CheckFailure[] = [];
  const secs = sections(md);
  const titles = [...secs.keys()];

  for (const req of REQUIRED_SECTIONS) {
    if (!titles.some((t) => t.startsWith(req.toLowerCase()))) failures.push({ rule: "missing-section", detail: req });
  }

  for (const m of md.matchAll(PROMISE)) {
    const before = md.slice(Math.max(0, m.index! - 40), m.index!);
    if (!NEGATION.test(before)) failures.push({ rule: "promise", detail: `"${md.slice(Math.max(0, m.index! - 30), m.index! + 30).trim()}"` });
  }

  for (const p of findPii(md)) failures.push({ rule: "pii", detail: `${p.kind}: ${p.match}` });

  const claims = extractClaims(md);
  for (const c of claims.filter((c) => !c.cited)) failures.push({ rule: "uncited-fact", detail: `line ${c.line}: ${c.text.slice(0, 120)}` });
  if (opts.unverifiedClaimIds) {
    for (const c of claims.filter((c) => opts.unverifiedClaimIds!.has(c.id) && !UNVERIFIED_LABEL.test(c.text))) {
      failures.push({ rule: "unverified-not-labelled", detail: `line ${c.line}: ${c.text.slice(0, 120)}` });
    }
  }

  // The two cost blocks must stay separate: no grand total that adds our fee to third-party costs.
  const costs = [...secs.entries()].find(([t]) => t.startsWith("cost of the whole process"))?.[1] ?? "";
  if (/\b(our|agency|service|office)\s+fee/i.test(costs) && /\btotal\b/i.test(costs)) {
    const blended = costs.split("\n").some((l) => /\btotal\b/i.test(l) && /\b(our|agency|service|office)\s+fee/i.test(l));
    if (blended) failures.push({ rule: "blended-costs", detail: "a total in the client-cost section includes our fee" });
  }

  return { pass: failures.length === 0, failures };
}
