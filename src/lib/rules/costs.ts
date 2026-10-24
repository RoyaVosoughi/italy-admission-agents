// Cost arithmetic for the two separate report blocks (CLAUDE.md rule 7):
//   client third-party costs — from knowledge/costs.md, never marked up
//   our fee                  — from knowledge/agency-pricing.md, staged 30/40/30
// Sums and staging are code; agents only choose the items and the uplift reasons.
import type { AgencyFeeInput, CostItem } from "../agents/types";

export interface Range {
  min: number;
  max: number;
}

export interface ClientCostSummary {
  iranCostsToman: Range;
  italyCostsEur: Range;
  cashFlowEur: Range; // proof of funds etc. — the client's own money, not an expense
  incomeEur: Range; // scholarship cash, part-time work
  netYear1Eur: Range | null; // Italy-side costs minus income; Iran-side is in toman and stays separate
  needsLiveCheck: string[];
}

const sum = (items: CostItem[]): Range =>
  items.reduce((r, i) => ({ min: r.min + i.min, max: r.max + i.max }), { min: 0, max: 0 });

export function summariseClientCosts(items: CostItem[]): ClientCostSummary {
  const pick = (kind: CostItem["kind"], currency: CostItem["currency"], side?: CostItem["side"]) =>
    items.filter((i) => i.kind === kind && i.currency === currency && (!side || i.side === side));
  const italyCostsEur = sum(pick("cost", "EUR"));
  const incomeEur = sum(pick("income", "EUR"));
  return {
    iranCostsToman: sum(pick("cost", "TOMAN")),
    italyCostsEur,
    cashFlowEur: sum(pick("cash_flow", "EUR")),
    incomeEur,
    netYear1Eur: incomeEur.max > 0 ? { min: italyCostsEur.min - incomeEur.max, max: italyCostsEur.max - incomeEur.min } : null,
    needsLiveCheck: items.filter((i) => i.needsLiveCheck).map((i) => i.label),
  };
}

/** Licensed اعزام دانشجو tariff ceiling = one month's stipend (agency-pricing.md §2). */
export const ITALY_TARIFF_CEILING_EUR = { romeMilanTurin: 1228, other: 1188 };
const BIG_CITIES = ["rome", "roma", "milan", "milano", "turin", "torino"];

export interface AgencyFee {
  lines: { service: string; eur: number }[];
  total: number;
  stages: { label: string; pct: number; eur: number }[];
  position: number; // 0 = bottom of band, 1 = top
  tariffCeiling: number;
  aboveTariffCeiling: boolean;
  addOns: AgencyFeeInput["addOns"];
}

export function agencyFee(input: AgencyFeeInput, cities: string[]): AgencyFee {
  // Each complexity reason pushes the price a quarter of the way up the band.
  const position = Math.min(1, input.upliftReasons.length * 0.25);
  const round10 = (x: number) => Math.round(x / 10) * 10;
  const lines = input.lines.map((l) => ({ service: l.service, eur: round10(l.bandMin + (l.bandMax - l.bandMin) * position) }));
  const total = lines.reduce((n, l) => n + l.eur, 0);
  const pcts = [
    { label: "On signing", pct: 30 },
    { label: "On submission", pct: 40 },
    { label: "On the decision (whatever the decision is)", pct: 30 },
  ];
  // Stages in whole euros so 30/40/30 of the total adds up exactly (€1,150 → 345 / 460 / 345).
  const stages = pcts.map((s) => ({ ...s, eur: Math.round((total * s.pct) / 100) }));
  stages[2].eur = total - stages[0].eur - stages[1].eur; // rounding remainder goes to the last stage
  const ceiling = cities.some((c) => BIG_CITIES.includes(c.toLowerCase()))
    ? ITALY_TARIFF_CEILING_EUR.romeMilanTurin
    : ITALY_TARIFF_CEILING_EUR.other;
  return { lines, total, stages, position, tariffCeiling: ceiling, aboveTariffCeiling: total > ceiling, addOns: input.addOns };
}
