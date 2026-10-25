// Agent 3 — Program Scout. "The model decides, the code executes":
//   1. the LLM writes retrieval queries for the client's themes,
//   2. code runs hybrid search over the regional reports,
//   3. the LLM picks candidates ONLY from the retrieved evidence, citing chunk ids.
import { z } from "zod";
import { runAgentJSON } from "../ai";
import { loadCatalogue, searchProgrammes, tokens, type Programme } from "../catalogue/catalogue";
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

const slug = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const MAX_CANDIDATES = () => Number(process.env.SCOUT_MAX ?? 10);

/**
 * Candidates from the official MUR course list: every English-taught in-person programme in the client's
 * degree classes or subject, ranked by code, so the same resume always gets the same, complete shortlist.
 * Programmes the client already holds an offer for are added too, even when the list (which ends at the
 * last published academic year) does not contain them yet. Returns null when the list is not available.
 */
async function catalogueCandidates(ctx: RunContext, profile: ClientProfile, assessment: Assessment): Promise<Candidate[] | null> {
  const all = loadCatalogue();
  const level = profile.targetLevel === "master" ? "master" : profile.targetLevel === "bachelor" ? "bachelor" : null;
  if (!all || !level) return null;

  const found = searchProgrammes(all, {
    level,
    classCodes: assessment.degreeClasses.map((d) => d.code),
    keywords: [...assessment.searchThemes, ...profile.targetFields],
    language: profile.preferences.languageOfInstruction,
    cities: profile.preferences.cities,
    regions: profile.preferences.regions,
    limit: MAX_CANDIDATES(),
  });
  if (!found.length) return null;

  const evidenceFor = async (university: string, region: string) =>
    (await ctx.retriever.search(`${university} ${region} international students admission scholarship`, { k: 3, regions: [region], docTypes: ["regional"] })).map((h) => h.chunk.id);

  const out: Candidate[] = [];
  for (const { programme: p, reasons } of found) {
    out.push({
      id: `${slug(p.ateneo)}-${slug(p.classCode)}-${slug(p.name).slice(0, 28)}`,
      university: p.university,
      city: p.city,
      region: p.region,
      programArea: p.className,
      programName: p.name,
      language: p.language === "italian" ? "italian" : "english",
      whyFit: `Official MUR course list ${p.year}/${String((p.year + 1) % 100).padStart(2, "0")}: ${p.className} (${p.classCode}), ${
        p.language === "bilingual" ? "taught in Italian and English" : p.language === "english" ? "taught in English" : "taught in Italian"
      }, ${p.access === "accesso libero" ? "open access (no entrance test)" : `limited places (${p.access} admission test)`}, in person. ${reasons.join("; ")}.`,
      sourceChunkIds: await evidenceFor(p.university, p.region),
      needsWebCheck: false, // the programme exists: it is in the official list
    });
  }

  // An admission the client already holds is always part of the picture.
  const clean = (u: string) => tokens(u.replace(/universit\w*|degli studi|studi di|university|of|the/gi, " ")).join(" ");
  for (const offer of profile.existingOffers ?? []) {
    const key = clean(offer.university);
    if (!key || out.some((c) => clean(c.university) === key && offer.programme && tokens(c.programName ?? "").join(" ") === tokens(offer.programme).join(" "))) continue;
    const known: Programme | undefined = all.find((p) => clean(p.university) === key || clean(p.university).includes(key) || key.includes(clean(p.university)));
    if (!known) continue; // cannot place it in a region: the report still mentions the offer
    out.push({
      id: `offer-${slug(known.ateneo)}-${slug(offer.programme ?? "programme").slice(0, 28)}`,
      university: known.university,
      city: known.city,
      region: known.region,
      programArea: offer.programme ?? profile.targetFields.join(", "),
      programName: offer.programme,
      language: "english",
      whyFit: `The client already holds an admission letter from ${known.university}${offer.programme ? ` for ${offer.programme}` : ""}${offer.academicYear ? ` (academic year ${offer.academicYear})` : ""}.`,
      sourceChunkIds: await evidenceFor(known.university, known.region),
      needsWebCheck: true, // new programmes are not in the list yet: confirm on the university's site
    });
  }
  return out;
}

export async function runScout(ctx: RunContext, profile: ClientProfile, assessment: Assessment): Promise<Candidate[]> {
  const fromCatalogue = await catalogueCandidates(ctx, profile, assessment);
  if (fromCatalogue) return fromCatalogue;
  console.warn("  scout: official course list not available (npm run catalogue:build), searching the knowledge base only");
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
