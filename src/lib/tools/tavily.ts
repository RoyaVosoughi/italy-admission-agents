// Web search/extract for the Verifier and the Manager. Three guards are built into the
// tool itself, so no prompt can bypass them:
//   - results from non-official hosts are dropped (rules/evidence.ts allow-list)
//   - a query that contains client data is refused before it leaves the machine
//   - each run has a call budget (MAX_TAVILY_CALLS)
import { createHash } from "node:crypto";
import { assertNoPii } from "../rules/pii";
import { isOfficialUrl } from "../rules/evidence";

export interface SearchResult {
  url: string;
  title: string;
  content: string; // Tavily's snippet
}

export interface PageText {
  url: string;
  text: string;
  hash: string;
  fetchedAt: string;
}

export class TavilyBudgetExceeded extends Error {}

interface TavilyResponse {
  results?: { url: string; title?: string; content?: string; raw_content?: string }[];
}

export class Tavily {
  used = 0;
  private pages = new Map<string, PageText>();
  private searches = new Map<string, SearchResult[]>();

  constructor(
    private opts: { maxCalls?: number; clientNames?: string[]; apiKey?: string } = {},
  ) {}

  private get max() {
    return this.opts.maxCalls ?? Number(process.env.MAX_TAVILY_CALLS ?? 34);
  }

  get remaining() {
    return this.max - this.used;
  }

  private async call(path: "search" | "extract", body: object): Promise<TavilyResponse> {
    if (this.used >= this.max) throw new TavilyBudgetExceeded(`Tavily budget of ${this.max} calls used up for this run`);
    const key = this.opts.apiKey ?? process.env.TAVILY_API_KEY;
    if (!key) throw new Error("TAVILY_API_KEY is not set in .env.local");
    this.used++;
    let res: Response | undefined;
    // Network blips ("fetch failed", timeouts) are retried; they don't count as extra budget.
    for (let attempt = 0; !res; attempt++) {
      try {
        res = await fetch(`https://api.tavily.com/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        if (attempt >= 2) throw e;
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
    if (!res.ok) throw new Error(`Tavily ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as TavilyResponse;
  }

  /** Searches the web and keeps official results only. `domains` narrows the search further. */
  async search(query: string, opts: { domains?: string[]; maxResults?: number } = {}): Promise<SearchResult[]> {
    assertNoPii(query, this.opts.clientNames);
    // The same question asked twice in a run (reading requirements, then verifying facts) costs one credit.
    const cacheKey = JSON.stringify([query, opts.domains ?? [], opts.maxResults ?? 8]);
    const hit = this.searches.get(cacheKey);
    if (hit) return hit;
    const json = await this.call("search", {
      query,
      search_depth: "basic", // 1 credit instead of 2; page text comes from extract anyway
      max_results: opts.maxResults ?? 8,
      ...(opts.domains?.length ? { include_domains: opts.domains } : {}),
    });
    const found = (json.results ?? [])
      .filter((r) => isOfficialUrl(r.url))
      .map((r) => ({ url: r.url, title: r.title ?? "", content: r.content ?? "" }));
    this.searches.set(cacheKey, found);
    return found;
  }

  /** Fetches full page text (cached per run). Only official URLs are fetched. */
  async extract(urls: string[]): Promise<PageText[]> {
    const official = [...new Set(urls)].filter(isOfficialUrl);
    const todo = official.filter((u) => !this.pages.has(u));
    if (todo.length) {
      const json = await this.call("extract", { urls: todo.slice(0, 20), extract_depth: "advanced" });
      const fetchedAt = new Date().toISOString();
      for (const r of json.results ?? []) {
        const text: string = r.raw_content ?? "";
        this.pages.set(r.url, { url: r.url, text, hash: createHash("sha1").update(text).digest("hex"), fetchedAt });
      }
    }
    return official.map((u) => this.pages.get(u)).filter((p): p is PageText => !!p);
  }

  /**
   * Fetches official pages directly over HTTP: free (no Tavily credit), so known pages from the knowledge
   * base are checked first and search is only needed to discover pages. Pages that need JavaScript to
   * render come back nearly empty and are skipped (Tavily's extract can still read those).
   */
  async fetchDirect(urls: string[]): Promise<PageText[]> {
    const official = [...new Set(urls)].filter(isOfficialUrl);
    await Promise.all(
      official
        .filter((u) => !this.pages.has(u))
        .map(async (u) => {
          try {
            const res = await fetch(u, {
              headers: { "user-agent": "Mozilla/5.0 (compatible; ItalyAdmissionStudio/0.1)", accept: "text/html,application/pdf;q=0.9,*/*;q=0.5" },
              signal: AbortSignal.timeout(30_000),
            });
            if (!res.ok || !isOfficialUrl(res.url)) return; // a redirect off the allow-list is not evidence
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length > 12_000_000) return;
            const isPdf = /pdf/i.test(res.headers.get("content-type") ?? "") || /\.pdf($|[?#])/i.test(u);
            const text = isPdf
              ? (await (await import("unpdf")).extractText(new Uint8Array(buf), { mergePages: true })).text
              : htmlToText(buf.toString("utf8"));
            if (text.trim().length < 300) return;
            this.pages.set(u, { url: u, text, hash: createHash("sha1").update(text).digest("hex"), fetchedAt: new Date().toISOString() });
          } catch {
            // unreachable or slow site: the caller falls back to search + extract
          }
        }),
    );
    return official.map((u) => this.pages.get(u)).filter((p): p is PageText => !!p);
  }

  /** Page text for evidence checks: what the quote is matched against. */
  page(url: string): PageText | undefined {
    return this.pages.get(url);
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€", rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—" };

/** Minimal HTML → text: enough to find sentences on a university page, not a general converter. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|table|ul|ol)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}
