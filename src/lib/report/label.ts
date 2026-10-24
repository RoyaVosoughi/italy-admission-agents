// Honest-by-construction labelling. Any external fact in the report that is not backed by a
// quote-matched official page gets an explicit "expected" label added by code, so a client
// never reads a 2026/27 value as if it were confirmed for their intake — even when the writer
// forgot to say so.
import { extractClaims } from "../rules/claims";
import { UNVERIFIED_LABEL } from "../rules/report-checks";
import { isBacked } from "../rules/gates";

export function labelText(intake: string) {
  return `*(expected — not yet confirmed on an official page for ${intake})*`;
}

export function autoLabel(md: string, usableUrls: Set<string>, intake: string): { text: string; labelled: number } {
  const lines = md.split("\n");
  let labelled = 0;
  for (const c of extractClaims(md)) {
    if (c.clientOnly || UNVERIFIED_LABEL.test(c.text) || isBacked(c, usableUrls)) continue;
    const i = c.line - 1;
    const raw = lines[i];
    // Table row: put the label inside the last cell so the table stays valid.
    lines[i] = /\|\s*$/.test(raw) ? raw.replace(/\s*\|\s*$/, ` ${labelText(intake)} |`) : `${raw} ${labelText(intake)}`;
    labelled++;
  }
  return { text: lines.join("\n"), labelled };
}

/** The writer sometimes "cites" internal data field names — "(assessment)", "(shortlist)" — which mean nothing to a client. */
export function stripDataKeyTags(md: string): string {
  return md.replace(/\s?\((?:assessment|shortlist|client|scholarships?|costs|evidence|computedFacts|profile)\)/gi, "");
}
