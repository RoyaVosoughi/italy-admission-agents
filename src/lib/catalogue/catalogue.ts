// The official list of every degree course in Italy (MUR open data, "Offerta formativa"), reduced to the
// latest academic year. The scout searches THIS list, so the choice of programmes no longer depends on a
// model guessing from scholarship reports. Built by scripts/build-catalogue.ts.
import { existsSync, readFileSync } from "node:fs";
import { regionOfProvince } from "./regions";

export const CATALOGUE_PATH = "data/catalogue/programmes.json";
export const MUR_DATASET_URL = "https://dati-ustat.mur.gov.it/dataset/bed0c71e-9f86-4a0f-a266-963b6f7bbbd2";

export interface Programme {
  ateneo: string; // as written in the MUR file ("Roma La Sapienza")
  university: string; // display name ("Sapienza Università di Roma")
  level: "bachelor" | "master" | "single-cycle";
  classCode: string; // "LM-52"
  className: string; // "Relazioni internazionali"
  name: string; // programme title
  language: "english" | "bilingual" | "italian" | "other";
  access: string; // "accesso libero" | "locale" | "nazionale"
  delivery: string; // "Convenzionale" = in person
  city: string;
  province: string;
  region: string;
  year: number;
}

const DISPLAY: Record<string, string> = {
  "Bari Politecnico": "Politecnico di Bari",
  "Milano Politecnico": "Politecnico di Milano",
  "Torino Politecnico": "Politecnico di Torino",
  "Roma La Sapienza": "Sapienza Università di Roma",
  "Roma Tor Vergata": "Università di Roma Tor Vergata",
  "Roma Tre": "Università Roma Tre",
  "Roma Luiss": "LUISS Guido Carli (Roma)",
  "Roma Link Campus": "Link Campus University (Roma)",
  "Roma UNINT": "UNINT (Roma)",
  "Milano": "Università degli Studi di Milano",
  "Milano Bicocca": "Università di Milano-Bicocca",
  "Milano Bocconi": "Università Bocconi (Milano)",
  "Milano Cattolica": "Università Cattolica del Sacro Cuore (Milano)",
  "Ca' Foscari Venezia": "Ca' Foscari Università di Venezia",
  "Venezia Iuav": "Università Iuav di Venezia",
  "Napoli Federico II": "Università di Napoli Federico II",
  "Napoli L'Orientale": "Università di Napoli L'Orientale",
  "Napoli Parthenope": "Università di Napoli Parthenope",
  "Napoli Vanvitelli": "Università della Campania Luigi Vanvitelli",
  "Modena e Reggio Emilia": "Università di Modena e Reggio Emilia",
  "Chieti e Pescara": "Università G. d'Annunzio di Chieti-Pescara",
  Marche: "Università Politecnica delle Marche",
  Calabria: "Università della Calabria",
  Basilicata: "Università della Basilicata",
  Molise: "Università del Molise",
  "Piemonte Orientale": "Università del Piemonte Orientale",
  Insubria: "Università dell'Insubria",
  Tuscia: "Università della Tuscia",
  Salento: "Università del Salento",
  Sannio: "Università del Sannio",
  Bolzano: "Libera Università di Bolzano",
  Aosta: "Università della Valle d'Aosta",
  "Enna KORE": "Università Kore di Enna",
  "Reggio Calabria": "Università Mediterranea di Reggio Calabria",
  "Perugia Stranieri": "Università per Stranieri di Perugia",
  "Siena Stranieri": "Università per Stranieri di Siena",
};

/** Plain city names become "Università di X"; anything with several words that isn't listed stays as written. */
export function universityName(ateneo: string): string {
  if (DISPLAY[ateneo]) return DISPLAY[ateneo];
  return /\s/.test(ateneo.trim()) ? ateneo.trim() : `Università di ${ateneo.trim()}`;
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());

function level(tipo: string): Programme["level"] | null {
  const t = tipo.toLowerCase();
  if (t.includes("ciclo unico")) return "single-cycle";
  if (t.includes("magistrale")) return "master";
  if (t.startsWith("laurea")) return "bachelor";
  return null;
}

function languageOf(l: string): Programme["language"] {
  const t = l.toLowerCase();
  if (t.trim() === "inglese") return "english";
  if (t.includes("inglese")) return "bilingual";
  if (t.trim() === "italiano") return "italian";
  return "other";
}

/** Parses the MUR CSV (semicolon-separated) and keeps only the newest academic year. */
export function parseMurCsv(text: string): Programme[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(";");
  const ix = (k: string) => head.indexOf(k);
  const col = { year: ix("ANNO"), ateneo: ix("Ateneo"), tipo: ix("TipoCorso"), classe: ix("Classe"), nomeClasse: ix("NomeClasse"), corso: ix("Corso"), prov: ix("SedeCorso_Provincia"), comune: ix("SedeCorso_Comune"), access: ix("ACCESSO"), did: ix("DIDATTICA"), lingua: ix("LINGUA") };
  if (Object.values(col).some((i) => i < 0)) throw new Error(`Unexpected MUR file: columns ${head.join(", ")}`);
  const rows = lines.slice(1).map((l) => l.split(";"));
  const latest = Math.max(...rows.map((r) => Number(r[col.year])).filter(Number.isFinite));
  const out: Programme[] = [];
  for (const r of rows) {
    if (Number(r[col.year]) !== latest) continue;
    const lvl = level(r[col.tipo] ?? "");
    const region = regionOfProvince(r[col.prov] ?? "");
    if (!lvl || !region) continue; // abroad / unknown province
    out.push({
      ateneo: r[col.ateneo].trim(),
      university: universityName(r[col.ateneo]),
      level: lvl,
      classCode: r[col.classe].trim().toUpperCase().replace(/\s+/g, ""),
      className: r[col.nomeClasse].trim(),
      name: r[col.corso].trim(),
      language: languageOf(r[col.lingua] ?? ""),
      access: (r[col.access] ?? "").trim(),
      delivery: (r[col.did] ?? "").trim(),
      city: titleCase(r[col.comune] ?? ""),
      province: r[col.prov].trim(),
      region,
      year: latest,
    });
  }
  return out;
}

export function loadCatalogue(path = CATALOGUE_PATH): Programme[] | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Programme[];
}

// ---------- search ----------

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const STOP = new Set(["and", "the", "for", "with", "studies", "study", "master", "masters", "degree", "program", "programme", "programs", "course", "courses", "area", "areas", "related", "general", "applied", "della", "delle", "degli", "dello", "per", "con", "studi", "del", "dei", "dell"]);
export const tokens = (s: string) => [...new Set(norm(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)))];

export interface ProgrammeQuery {
  level: Programme["level"];
  classCodes: string[]; // most relevant first
  keywords: string[]; // themes / target fields (English or Italian)
  language: "english" | "italian" | "either";
  cities?: string[];
  regions?: string[];
  limit?: number;
  maxPerUniversity?: number;
}

export interface ScoredProgramme {
  programme: Programme;
  score: number;
  reasons: string[];
}

/**
 * Deterministic: the same query over the same catalogue always returns the same list in the same order.
 *
 * Degree-class codes suggested by a model are unreliable, so they only count when the class's programmes also
 * match the client's subject. The classes that match best are found from the catalogue itself, and the final
 * list is spread across them (a law graduate sees international relations AND political science AND European
 * studies, not ten near-identical programmes of one class).
 */
export function searchProgrammes(all: Programme[], q: ProgrammeQuery): ScoredProgramme[] {
  const classes = q.classCodes.map((c) => c.toUpperCase().replace(/\s+/g, ""));
  const kw = tokens(q.keywords.join(" "));
  const cities = (q.cities ?? []).map(norm);
  const regions = (q.regions ?? []).map(norm);

  const pool: { p: Programme; hits: string[]; ci: number }[] = [];
  for (const p of all) {
    if (p.level !== q.level) continue;
    if (p.delivery && p.delivery !== "Convenzionale") continue; // a study visa needs in-person teaching
    if (/telematica/i.test(p.ateneo)) continue;
    if (q.language === "english" && p.language !== "english" && p.language !== "bilingual") continue;
    if (q.language === "italian" && p.language !== "italian" && p.language !== "bilingual") continue;
    const hay = new Set(tokens(`${p.name} ${p.className}`));
    const hits = kw.filter((t) => hay.has(t));
    const ci = classes.indexOf(p.classCode);
    if (!((ci >= 0 && hits.length >= 1) || hits.length >= 2)) continue; // not related enough
    pool.push({ p, hits, ci });
  }

  // Which classes fit this client's subject best, judged by the programmes themselves.
  const mass = new Map<string, number>();
  for (const { p, hits } of pool) mass.set(p.classCode, (mass.get(p.classCode) ?? 0) + hits.length);
  const topClasses = [...mass.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4).map(([c]) => c);

  const scored: ScoredProgramme[] = pool.map(({ p, hits, ci }) => {
    const reasons: string[] = [];
    let score = Math.min(hits.length, 3) * 2.5;
    if (hits.length) reasons.push(`matches ${hits.slice(0, 3).join(", ")}`);
    if (ci >= 0) {
      score += 6 - Math.min(ci, 3);
      reasons.push(`degree class ${p.classCode}`);
    }
    const ti = topClasses.indexOf(p.classCode);
    if (ti >= 0) score += 5 - ti * 1.5;
    if (p.language === "english") score += 4;
    else if (p.language === "bilingual") score += 1.5;
    score += p.access === "accesso libero" ? 1.5 : -1;
    if (cities.includes(norm(p.city))) score += 3;
    if (regions.includes(norm(p.region))) score += 2;
    return { programme: p, score, reasons };
  });
  scored.sort((a, b) => b.score - a.score || a.programme.university.localeCompare(b.programme.university) || a.programme.name.localeCompare(b.programme.name));

  // Round-robin over classes (best class first), at most N per university, no programme twice.
  const groups = new Map<string, ScoredProgramme[]>();
  for (const s of scored) groups.set(s.programme.classCode, [...(groups.get(s.programme.classCode) ?? []), s]);
  const order = [...groups.values()].sort((a, b) => b[0].score - a[0].score || a[0].programme.classCode.localeCompare(b[0].programme.classCode));
  const perUni = new Map<string, number>();
  const seen = new Set<string>();
  const out: ScoredProgramme[] = [];
  const limit = q.limit ?? 10;
  for (let round = 0; out.length < limit && order.some((g) => g.length); round++) {
    for (const g of order) {
      while (g.length) {
        const s = g.shift()!;
        const key = `${s.programme.university}|${norm(s.programme.name)}`;
        const n = perUni.get(s.programme.university) ?? 0;
        if (seen.has(key) || n >= (q.maxPerUniversity ?? 2)) continue;
        seen.add(key);
        perUni.set(s.programme.university, n + 1);
        out.push(s);
        break;
      }
      if (out.length >= limit) break;
    }
    if (round > limit * 4) break; // safety
  }
  return out;
}
