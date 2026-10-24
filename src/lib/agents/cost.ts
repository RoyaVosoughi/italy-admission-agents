// Agent 6 — Cost Planner. Chooses the cost items and the fee lines; rules/costs.ts does
// the sums, the 30/40/30 staging and the tariff sense-check. Two blocks, never merged.
import { runAgentJSON } from "../ai";
import { agencyFee, summariseClientCosts, type AgencyFee, type ClientCostSummary } from "../rules/costs";
import { VISA_FUNDS, type ProfileFacts } from "../rules/profile";
import { CostPlannerOutput, type ClientProfile, type CostItem } from "./types";
import { formatChunks, uniqueHits, type RunContext } from "./context";

export interface CostResult {
  clientItems: CostItem[];
  clientSummary: ClientCostSummary;
  fee: AgencyFee;
  upliftReasons: string[];
}

const ROLE = `
You are the cost planner. Produce two separate things:

1. clientItems — what the client pays THIRD PARTIES for an Italian public-university application,
   from the cost excerpts: translations + legalisation stamps (TOMAN, Iran side), language test (TOMAN),
   CIMEA (EUR), visa fee, insurance, first-year tuition (Italy public: income-based, often near the floor
   with ISEE), flights/first month (estimates). kind: "cost" for expenses, "cash_flow" for proof of funds
   (the client's own money, NOT a cost), "income" for expected scholarship cash only if clearly eligible.
   reliability: fixed (official fee), variable (real but varies), estimate. needsLiveCheck true for
   anything the excerpts call volatile (IELTS toman price, exchange rate, visa fee, translation tariff,
   proof-of-funds figure). Use min/max ranges as the sources give them. Never convert currencies.
2. agency — our office fee from the agency-pricing excerpts: pick the service lines with their EUR band
   (an Italian university case is normally the University application package, plus document
   preparation if credentials need work). upliftReasons: only reasons listed in the pricing excerpts
   that apply to this client (e.g. no certificate in the destination's language). addOns: optional extras.
`;

const LANGUAGE_TEST_ITEM = /\b(IELTS|TOEFL|Duolingo|PTE|Cambridge|language (test|exam|certificate))\b/i;
const NO_CERT_UPLIFT = /certificate.*language|language.*certificate/i;

/**
 * Client facts decide some items in code: a client who already holds a certificate that meets the
 * embassy minimum pays no language-test fee and is not priced up for "no certificate".
 */
export function applyClientFacts(out: { clientItems: CostItem[]; upliftReasons: string[] }, facts: ProfileFacts) {
  if (!facts.english.meetsEmbassyMinimum && !facts.italianB2) return out;
  return {
    clientItems: out.clientItems.filter((i) => !(i.kind === "cost" && LANGUAGE_TEST_ITEM.test(i.label))),
    upliftReasons: out.upliftReasons.filter((r) => !NO_CERT_UPLIFT.test(r)),
  };
}

export async function runCost(
  ctx: RunContext,
  profile: ClientProfile,
  facts: ProfileFacts,
  cities: string[],
  corrections: string[] = [],
): Promise<CostResult> {
  const r = ctx.retriever;
  const costs = await r.search("client third-party costs translation legalisation IELTS CIMEA visa Italy tuition insurance", {
    k: 8,
    docTypes: ["pricing", "national"],
  });
  const pricing = await r.search("our fee bands university application package complexity uplift staged payment", { k: 6, docTypes: ["pricing"] });
  const visa = await r.search("proof of economic means euros bank statement study visa Tehran", { k: 3, docTypes: ["visa"] });

  const { data, usage } = await runAgentJSON(CostPlannerOutput, {
    agent: "cost",
    role: ROLE,
    prompt: [
      `Client: ${profile.targetLevel}; language certificates: ${profile.languageCerts.map((c) => `${c.test} ${c.overall ?? "planned"}`).join(", ") || "none"}; Italian: ${profile.italianLevel}; target cities: ${cities.join(", ")}.`,
      corrections.length
        ? `Manager's correction orders so far (address ALL of them):\n${corrections.map((c) => `- ${c}`).join("\n")}`
        : "",
      `Embassy proof of funds: €${VISA_FUNDS.eur} (${VISA_FUNDS.source}; needs live check).`,
      `Excerpts:\n\n${formatChunks(uniqueHits(costs, pricing, visa), 24_000)}`,
    ].join("\n\n"),
    temperature: 0.2,
    lessons: await ctx.lessons("cost"),
  });
  ctx.addUsage(usage);
  const { clientItems, upliftReasons } = applyClientFacts({ clientItems: data.clientItems, upliftReasons: data.agency.upliftReasons }, facts);
  return {
    clientItems,
    clientSummary: summariseClientCosts(clientItems),
    fee: agencyFee({ ...data.agency, upliftReasons }, cities),
    upliftReasons,
  };
}
