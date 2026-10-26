// Agent 7 — Live Verifier. Code decides WHAT to check and WHERE to search; the LLM only
// reads official pages and copies the sentence that proves each fact. Code then confirms
// the copied sentence really is on the page (rules/evidence.ts) — an invented quote fails.
import { z } from "zod";
import { runAgentJSON } from "../ai";
import { hostOf, isOfficialUrl, quoteInPage } from "../rules/evidence";
import type { EvidenceRecord } from "../store/types";
import type { PageText } from "../tools/tavily";
import { Evidence } from "./types";
import type { RunContext } from "./context";

export interface FactToVerify {
  claimId: string; // e.g. "polito-civil:deadline"
  claim: string; // what must be true, in words
  kbValue: string | null;
}

export interface VerifyGroup {
  key: string; // university or DSU body
  query: string; // web search query (no client data)
  domains: string[]; // official domains to prefer
  knownUrls?: string[]; // official pages already known from the knowledge base: fetched first, for free
  altQuery?: string; // second search (Italian, short, no year) when the first finds nothing official
  facts: FactToVerify[];
}

const ROLE = (intake: string) => `
You verify facts against official web pages. For each fact, look in the page excerpts for the sentence
that states the current value. Output one Evidence item per fact:
- quote: copy the sentence VERBATIM from the page text (at least 8 words, same wording, no paraphrase,
  no ellipsis in the middle). If you cannot find it, quote null.
- url: the page the quote comes from.
- liveValue: the value the page states; academicYear: which academic year the page is about.
- status: verified (page confirms the KB value for ${intake}), changed (page gives a different value
  for ${intake}), not_found (no page states it, or only for an older year), conflict (pages disagree).
Never mark verified on the basis of a page about an older academic year.
The page must belong to the SAME institution the fact names. Separate institutions in the same city do not
count for each other: Università di Pisa is not Scuola Superiore Sant'Anna or Scuola Normale Superiore;
Università di Milano is not Politecnico di Milano or Milano-Bicocca. A page of another institution is not_found.
For a fact that a programme EXISTS, the programme's own page title/heading or its line in a course list is
enough (the year doesn't matter for existence); quote that heading together with the words around it.
`;

const Output = z.object({ evidence: z.array(Evidence) });

/** Keyword windows from long pages (a bando PDF can be 150 pages). */
export function pageExcerpts(page: PageText, keywords: RegExp, radius = 500, maxChars = 7000): string {
  const t = page.text;
  const spans: [number, number][] = [];
  for (const m of t.matchAll(new RegExp(keywords.source, "gi"))) {
    const s = Math.max(0, m.index! - radius);
    const e = Math.min(t.length, m.index! + radius);
    if (spans.length && s <= spans[spans.length - 1][1]) spans[spans.length - 1][1] = e;
    else spans.push([s, e]);
  }
  let out = spans.map(([s, e]) => t.slice(s, e)).join("\n…\n");
  if (!out) out = t.slice(0, maxChars);
  return out.slice(0, maxChars);
}

const KEYWORDS = /deadline|scadenz|closes|application|apply|IELTS|TOEFL|B2|ISEE|ISPE|borsa|scholarship|202[6-8]|€|euro|requirement|requisit/;

/**
 * The official pages for one group: first the pages the knowledge base already points to (free), then search;
 * the Italian second query runs only if the first brought nothing. Pages and searches are cached for the run,
 * so reading a programme's requirements before rating it and verifying its facts later cost the same credits.
 */
export async function gatherPages(ctx: RunContext, group: VerifyGroup): Promise<PageText[]> {
  const pages: PageText[] = group.knownUrls?.length ? await ctx.web.fetchDirect(group.knownUrls.slice(0, 3)) : [];
  const searched = async (query: string) => {
    if (ctx.web.remaining < 2) return;
    const results = await ctx.web.search(query, { domains: group.domains, maxResults: 6 }).catch(() => []);
    const urls = results.map((r) => r.url).filter((u) => !pages.some((p) => p.url === u)).slice(0, 3);
    const direct = await ctx.web.fetchDirect(urls);
    pages.push(...direct);
    const rest = urls.filter((u) => !direct.some((p) => p.url === u));
    if (rest.length && ctx.web.remaining >= 2) pages.push(...(await ctx.web.extract(rest).catch(() => [])));
  };
  await searched(group.query);
  if (!pages.length && group.altQuery) await searched(group.altQuery);
  return pages.slice(0, 5);
}

const REQ_KEYWORDS = /requirement|requisit|eligib|prerequisite|admission|ammission|accesso|CFU|ECTS|credits|GPA|grade|voto|minimum|minimo|IELTS|TOEFL|B2|C1|entrance|test|quota|places|posti|non-EU|selection|selezione|laurea/i;

/** The admission-requirement passages of the official pages, verbatim, for the analyst to read. */
export function requirementsExcerpt(pages: PageText[], maxChars = 9000): string {
  return pages
    .slice(0, 3)
    .map((p) => `=== ${p.url} ===\n${pageExcerpts(p, REQ_KEYWORDS, 450, 4000)}`)
    .join("\n\n")
    .slice(0, maxChars);
}

export async function verifyGroup(
  ctx: RunContext,
  group: VerifyGroup,
  checkedBy: "verifier" | "manager",
): Promise<Omit<EvidenceRecord, "id">[]> {
  const notFound = (why: string) =>
    group.facts.map((f) => ({
      ...f,
      liveValue: null,
      url: null,
      quote: null,
      status: "not_found" as const,
      academicYear: null,
      runId: ctx.runId,
      quoteMatched: false,
      officialUrl: false,
      pageHash: null,
      checkedBy,
      fetchedAt: null,
      note: why,
    }));

  const pages = await gatherPages(ctx, group);
  if (!pages.length) return notFound(ctx.web.remaining < 2 ? "web budget used up" : "no official page found");

  const excerpts = pages.map((p) => `=== ${p.url} ===\n${pageExcerpts(p, KEYWORDS)}`).join("\n\n");
  const { data, usage } = await runAgentJSON(Output, {
    agent: "verifier",
    role: ROLE(ctx.intake),
    prompt: `Today: ${ctx.today}\nFacts to verify:\n${group.facts
      .map((f) => `- ${f.claimId}: ${f.claim}${f.kbValue ? ` (knowledge base says: ${f.kbValue})` : ""}`)
      .join("\n")}\n\nOfficial page excerpts:\n\n${excerpts}`,
    temperature: 0.1,
    lessons: await ctx.lessons("verifier"),
  });
  ctx.addUsage(usage);

  const byId = new Map(data.evidence.map((e) => [e.claimId, e]));
  return group.facts.map((f) => {
    const e = byId.get(f.claimId);
    const page = e?.url ? (ctx.web.page(e.url) ?? pages.find((p) => hostOf(p.url) === hostOf(e.url!))) : undefined;
    const official = !!e?.url && isOfficialUrl(e.url);
    const matched = !!page && quoteInPage(e?.quote ?? null, page.text);
    // A claimed verification without a matching quote on an official page is not evidence.
    const status = e && (e.status === "verified" || e.status === "changed") && !(matched && official) ? "not_found" : (e?.status ?? "not_found");
    return {
      claimId: f.claimId,
      claim: f.claim,
      kbValue: f.kbValue,
      liveValue: e?.liveValue ?? null,
      url: e?.url ?? null,
      quote: e?.quote ?? null,
      status,
      academicYear: e?.academicYear ?? null,
      runId: ctx.runId,
      quoteMatched: matched,
      officialUrl: official,
      pageHash: page?.hash ?? null,
      checkedBy,
      fetchedAt: page?.fetchedAt ?? null,
    };
  });
}
