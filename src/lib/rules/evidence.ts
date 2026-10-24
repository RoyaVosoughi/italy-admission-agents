// Evidence checks the Manager can't talk its way around:
//   1. the URL must be an official source (allow-list + deny-list)
//   2. the "verbatim quote" must really occur in the fetched page text
// (2) is what stops an agent from "verifying" a fact with a sentence it invented.

/** Exact official domains (suffix match: "www.polimi.it" matches "polimi.it"). */
const OFFICIAL_DOMAINS = [
  "universitaly.it",
  "cimea.it",
  "esteri.it", // ambteheran.esteri.it, vistoperitalia.esteri.it
  "mur.gov.it",
  "studiare-in-italia.it",
  "uni-italia.it",
  "andisu.it",
  "regione.vda.it",
  "regione.marche.it",
  "regione.lombardia.it",
  "visametric.com",
];

/**
 * Italian hosts whose name marks a university or a DSU/regional body, optionally under a
 * regional domain: "edisu.piemonte.it", "www.unipd.it", "www.esu.pd.it".
 */
const OFFICIAL_HOST_PATTERN =
  /(?:^|\.)(?:uni[a-z]*|poli[a-z]*|sissa|sns|santannapisa|iuss|imtlucca|gssi|edisu[a-z]*|er-go|ergo|laziodisco|dsu|esu[a-z]*|ersu[a-z]*|adisu[a-z]*|adsu[a-z]*|ardsu[a-z]*|ardis|erdis|aliseo|operauni|disco|regione|provincia)(?:\.[a-z0-9-]+)*\.(?:it|eu)$/i;

/** Aggregators, news sites and look-alike names — useful for leads, never as evidence. */
const DENY =
  /(?:^|\.)(?:tesify|habacus|skuola|studenti|sky|tg24|mohajerdanesh|wikipedia|reddit|medium|quora|facebook|instagram|youtube|unicredit|unipol|universitaly-info|poliambulatorio[a-z]*)\./i;

export function hostOf(url: string): string | null {
  try {
    return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isOfficialUrl(url: string): boolean {
  const host = hostOf(url);
  if (!host || DENY.test(host + ".")) return false;
  if (OFFICIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return true;
  return OFFICIAL_HOST_PATTERN.test(host);
}

export function normaliseForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[*_`#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const MIN_QUOTE_CHARS = 20;

export function quoteInPage(quote: string | null, pageText: string): boolean {
  if (!quote) return false;
  const q = normaliseForMatch(quote).replace(/^\.{3}|\.{3}$|…/g, "").trim();
  if (q.length < MIN_QUOTE_CHARS) return false; // "30 September" alone proves nothing
  return normaliseForMatch(pageText).includes(q);
}
