// Tables rendered by code and inserted into the writer's draft through placeholders.
// The writer writes the prose; numbers (scores, costs, fee stages) never pass through a model.
import type { CostResult } from "../agents/cost";
import type { ScholarshipResult } from "../agents/scholarship";
import type { Ranked } from "../rules/ranking";
import { COMPUTED_END, COMPUTED_START } from "../rules/claims";
import { acceptanceEstimate } from "../rules/chance";

/** Marks a code-rendered block so the fact checker skips it: its numbers are computed, not quoted. */
const computed = (md: string) => `${COMPUTED_START}\n${md}\n${COMPUTED_END}`;

export const PLACEHOLDERS = {
  shortlist: "{{SHORTLIST_TABLE}}",
  clientCosts: "{{CLIENT_COSTS_TABLE}}",
  fee: "{{FEE_TABLE}}",
} as const;

const eur = (n: number) => `€${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const toman = (n: number) => `${n.toLocaleString("en-US")} toman`;
const range = (min: number, max: number, f: (n: number) => string) => (min === max ? f(min) : `${f(min)} – ${f(max)}`);
const cite = (source: string) => (/^[\w-]+#\d+$/.test(source) ? `(KB: ${source})` : source);

export function shortlistTable(ranked: Ranked[], scholarships: ScholarshipResult[]): string {
  const sch = new Map(scholarships.map((s) => [s.plan.candidateId, s]));
  const rows = ranked.map(({ candidate: c, rating: r }, i) => {
    const s = sch.get(c.id);
    const top = [...r.factors].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 3);
    const e = acceptanceEstimate(r);
    return `| ${i + 1} | ${c.university} (${c.city}) | ${c.programName ?? c.programArea} | ${c.language} | **${r.tier}** · about ${e.pct}% (range ${e.low}–${e.high}%) | ${top
      .map((f) => `${f.points > 0 ? "+" : ""}${f.points} ${f.factor}`)
      .join("; ")} | ${s ? `${s.plan.dsuBody}: ${s.isee.verdict}` : "—"} |`;
  });
  return computed(
    [
      "| # | University | Programme | Language | Admission chance | Main factors | Scholarship (ISEE check) |",
      "|---|---|---|---|---|---|---|",
      ...rows,
      "",
      "*Estimated chance: our admission rubric (score out of 100) converted to a percentage. It is an informed estimate from the client's documents and the published requirements, not a promise; the range is wider when a university has not published a factor.*",
    ].join("\n"),
  );
}

export function clientCostTables(c: CostResult): string {
  const row = (i: CostResult["clientItems"][number]) =>
    `| ${i.label} | ${range(i.min, i.max, i.currency === "EUR" ? eur : toman)} | ${i.reliability}${i.needsLiveCheck ? ", to be confirmed at quote time" : ""} | ${cite(i.source)} |`;
  const table = (title: string, items: CostResult["clientItems"]) =>
    items.length ? [`**${title}**`, "", "| Item | Amount | Reliability | Source |", "|---|---|---|---|", ...items.map(row)].join("\n") : "";
  const s = c.clientSummary;
  // Item rows cite their source; the totals are sums, so the whole block is marked computed.
  return computed([
    table("Iran-side costs (toman)", c.clientItems.filter((i) => i.kind === "cost" && i.currency === "TOMAN")),
    table("Italy-side costs (EUR)", c.clientItems.filter((i) => i.kind === "cost" && i.currency === "EUR")),
    table("Funds you must show — your own money, not a cost", c.clientItems.filter((i) => i.kind === "cash_flow")),
    table("Expected income (if awarded)", c.clientItems.filter((i) => i.kind === "income")),
    [
      "**Totals (estimate, third-party costs only — our fee is in the next section)**",
      "",
      `- Iran side: ${range(s.iranCostsToman.min, s.iranCostsToman.max, toman)}`,
      `- Italy side: ${range(s.italyCostsEur.min, s.italyCostsEur.max, eur)}`,
      s.netYear1Eur ? `- Net position after year 1 (Italy-side costs minus expected income, estimate): ${range(s.netYear1Eur.min, s.netYear1Eur.max, eur)}` : "",
      s.needsLiveCheck.length ? `- To be confirmed at quote time: ${s.needsLiveCheck.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n"));
}

export function feeTable(c: CostResult): string {
  const f = c.fee;
  return computed([
    "| Service | Fee |",
    "|---|---|",
    ...f.lines.map((l) => `| ${l.service} | ${eur(l.eur)} |`),
    `| **Total** | **${eur(f.total)}** |`,
    "",
    "**Staged payments**",
    "",
    ...f.stages.map((s) => `- ${s.label}: ${s.pct}% = ${eur(s.eur)}`),
    c.upliftReasons.length ? `\nPriced toward the top of the band because: ${c.upliftReasons.join("; ")}.` : "",
    f.addOns.length ? `\nOptional add-ons: ${f.addOns.map((a) => `${a.service} (${a.eur})`).join("; ")}.` : "",
    "\nThird-party costs are paid by you directly to each provider; we add no markup. Our fee covers process and effort, not an outcome.",
  ].join("\n"));
}

export function fillPlaceholders(draft: string, tables: Record<keyof typeof PLACEHOLDERS, string>): { text: string; missing: string[] } {
  let text = draft;
  const missing: string[] = [];
  for (const [k, ph] of Object.entries(PLACEHOLDERS) as [keyof typeof PLACEHOLDERS, string][]) {
    if (!text.includes(ph)) missing.push(ph);
    text = text.split(ph).join(tables[k]);
  }
  return { text, missing };
}
