// Agent 3 — Program Scout. "The model decides, the code executes":
//   1. the LLM writes retrieval queries for the client's themes,
//   2. code runs hybrid search over the regional reports,
//   3. the LLM picks candidates ONLY from the retrieved evidence, citing chunk ids.
import { z } from "zod";
import { runAgentJSON } from "../ai";
import { ScoutOutput, type Assessment, type Candidate, type ClientProfile } from "./types";
import { formatChunks, json, uniqueHits, type RunContext } from "./context";

const QueryPlan = z.object({
  queries: z.array(z.object({ query: z.string(), regions: z.array(z.string()) })).min(3).max(10),
});

const QUERY_ROLE = `
You plan searches over a knowledge base of reports on Italian regions: their public universities,
English-taught programmes, admission calls for international (visa) applicants and DSU scholarships.
Write 4–8 short English search queries that will surface universities and programmes fitting this
client. Mix: program-area queries ("English-taught master's civil engineering admission international"),
and if the client prefers cities/regions, region-specific ones. "regions" may list Italian region names
(Piemonte, Lombardia, Veneto, Emilia-Romagna, Toscana, Lazio, Campania, Puglia, Sicilia, Sardegna,
Liguria, Marche, Umbria, Abruzzo, Molise, Basilicata, Calabria, Friuli-Venezia Giulia,
Trentino-Alto Adige, Valle d'Aosta) to filter on, or be empty for all.
`;

const PICK_ROLE = `
You are the programme scout. From the knowledge-base excerpts ONLY, list 8–16 candidate
university + programme-area options for this client. Prefer:
- programmes in the client's language of instruction (English unless they have Italian B2),
- universities the excerpts describe as open to non-EU applicants who need a visa,
- a spread across regions (different scholarship bodies = different deadlines and chances).
Every candidate must cite the excerpt ids it is based on in sourceChunkIds. If the excerpts mention the
university but not the specific programme, set programName null and needsWebCheck true.
Do not invent universities that are not in the excerpts. programArea must be the client's specific
discipline (e.g. "Civil Engineering"), never a generic label like "Engineering" or "Master's Programmes".
A university whose excerpts show it admits international students to master's programmes in the
client's broad area (e.g. engineering) may be listed even if the excerpts don't name the exact
programme: set programName null and needsWebCheck true — its existence is checked on the official site
afterwards and it is dropped automatically if not found. Aim for at least 8 candidates.
Candidate ids: short slugs like "polito-civil".
`;

export async function runScout(ctx: RunContext, profile: ClientProfile, assessment: Assessment): Promise<Candidate[]> {
  const lessons = await ctx.lessons("scout");
  const plan = await runAgentJSON(QueryPlan, {
    agent: "scout",
    role: QUERY_ROLE,
    prompt: `Target: ${profile.targetLevel} in ${profile.targetFields.join(", ")}\nThemes: ${assessment.searchThemes.join(", ")}\nPreferences: ${json(profile.preferences)}`,
    temperature: 0.2,
    lessons,
  });
  ctx.addUsage(plan.usage);

  const results = [];
  for (const q of plan.data.queries) {
    results.push(await ctx.retriever.search(q.query, { k: 6, regions: q.regions.length ? q.regions : undefined, docTypes: ["regional"] }));
  }
  const hits = uniqueHits(...results);

  const pick = await runAgentJSON(ScoutOutput, {
    agent: "scout",
    role: PICK_ROLE,
    prompt: [
      `Client: ${profile.targetLevel} in ${profile.targetFields.join(", ")}; language of instruction: ${profile.preferences.languageOfInstruction}; Italian level: ${profile.italianLevel}.`,
      `Assessment themes: ${assessment.searchThemes.join(", ")}; degree classes: ${assessment.degreeClasses.map((d) => d.code).join(", ")}.`,
      `Knowledge-base excerpts:\n\n${formatChunks(hits, 40_000)}`,
    ].join("\n\n"),
    temperature: 0.2,
    lessons,
  });
  ctx.addUsage(pick.usage);

  // Drop citations to chunks that were never shown — a cited id must be real.
  const shown = new Set(hits.map((h) => h.chunk.id));
  return pick.data.candidates.map((c) => ({ ...c, sourceChunkIds: c.sourceChunkIds.filter((id) => shown.has(id)) }));
}
