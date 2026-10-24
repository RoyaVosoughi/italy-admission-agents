// Hybrid retrieval over the local index: BM25 keyword search + vector cosine,
// merged with Reciprocal Rank Fusion. Keyword search catches exact names that
// embeddings blur (EDiSU vs ER.GO, ISEE vs ISPE, TOLC-I vs TOLC-E); vectors catch
// paraphrases ("how much money do I get" → "scholarship amounts").
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import type { Chunk } from "./chunk";
import type { DocType } from "./sources";
import { embedQuery, embeddingModelId } from "./embed";

export const INDEX_PATH = "data/kb-index.json";

export interface IndexedChunk extends Chunk {
  vector: string; // base64 Float32Array — keeps the index file ~5x smaller than JSON numbers
}

export interface KbIndex {
  model: string;
  dims: number;
  builtAt: string;
  chunks: IndexedChunk[];
}

export interface RetrieveOptions {
  k?: number;
  regions?: string[]; // restrict to these regions…
  includeNational?: boolean; // …but still allow national docs (default true)
  docTypes?: DocType[];
}

export interface Hit {
  chunk: Chunk;
  score: number;
  bm25Rank: number | null;
  vectorRank: number | null;
}

export const encodeVector = (v: number[]) => Buffer.from(new Float32Array(v).buffer).toString("base64");
const decodeVector = (s: string) => {
  const b = Buffer.from(s, "base64");
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};

const STOP = new Set(
  "a an and are as at be by can do does for from how i in is it my of on or the to what when where which who will with".split(" "),
);
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9€]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

class Bm25 {
  private df = new Map<string, number>();
  private docs: { tf: Map<string, number>; len: number }[];
  private avgLen: number;
  constructor(texts: string[], private k1 = 1.2, private b = 0.75) {
    this.docs = texts.map((t) => {
      const tf = new Map<string, number>();
      const toks = tokenize(t);
      for (const tok of toks) tf.set(tok, (tf.get(tok) ?? 0) + 1);
      for (const tok of tf.keys()) this.df.set(tok, (this.df.get(tok) ?? 0) + 1);
      return { tf, len: toks.length };
    });
    this.avgLen = this.docs.reduce((n, d) => n + d.len, 0) / Math.max(1, this.docs.length);
  }
  score(query: string, i: number): number {
    const d = this.docs[i];
    const N = this.docs.length;
    let s = 0;
    for (const q of new Set(tokenize(query))) {
      const f = d.tf.get(q);
      if (!f) continue;
      const df = this.df.get(q)!;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      s += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / this.avgLen));
    }
    return s;
  }
}

export class Retriever {
  private vectors: Float32Array[];
  private bm25: Bm25;
  constructor(private index: KbIndex) {
    this.vectors = index.chunks.map((c) => decodeVector(c.vector));
    this.bm25 = new Bm25(index.chunks.map((c) => c.embedText));
  }

  static load(path = INDEX_PATH): Retriever {
    if (!existsSync(path)) throw new Error(`No index at ${path}. Run: npm run kb:index`);
    return new Retriever(JSON.parse(readFileSync(path, "utf8")));
  }

  get(id: string): Chunk | undefined {
    const c = this.index.chunks.find((x) => x.id === id);
    if (!c) return undefined;
    const { vector: _v, ...chunk } = c;
    return chunk;
  }

  get size() {
    return this.index.chunks.length;
  }

  private vectorDown = false;

  /**
   * Hybrid search. If embedding the query fails (e.g. the free daily quota is used up) we fall
   * back to keyword-only search instead of failing the run — slightly worse ranking, still works.
   */
  async search(query: string, opts: RetrieveOptions = {}): Promise<Hit[]> {
    let qv: number[] = [];
    if (!this.vectorDown && this.index.model !== embeddingModelId()) {
      // Vectors from another model are meaningless here; keep the run alive on keyword search.
      this.vectorDown = true;
      console.warn(`  retrieval: index was built with ${this.index.model} but ${embeddingModelId()} is configured; run npm run kb:index. Using keyword search only.`);
    }
    if (!this.vectorDown) {
      try {
        qv = await embedQueryCached(query);
      } catch (e) {
        this.vectorDown = true;
        console.warn(`  retrieval: vector search unavailable, using keyword search only (${(e as Error).message.slice(0, 80)})`);
      }
    }
    return this.searchWithVector(query, qv, opts);
  }

  searchWithVector(query: string, qv: number[], opts: RetrieveOptions = {}): Hit[] {
    const { k = 5, regions, includeNational = true, docTypes } = opts;
    const allowed = this.index.chunks
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => {
        if (docTypes && !docTypes.includes(c.docType)) return false;
        if (!regions?.length) return true;
        return c.region ? regions.includes(c.region) : includeNational;
      });

    const POOL = 50;
    const byVector = (qv.length ? allowed : [])
      .map(({ i }) => ({ i, s: dot(this.vectors[i], qv) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, POOL);
    const byBm25 = allowed
      .map(({ i }) => ({ i, s: this.bm25.score(query, i) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, POOL);

    const RRF_K = 60;
    const fused = new Map<number, Hit>();
    const add = (list: { i: number }[], key: "bm25Rank" | "vectorRank") =>
      list.forEach(({ i }, rank) => {
        const h = fused.get(i) ?? { chunk: this.strip(i), score: 0, bm25Rank: null, vectorRank: null };
        h.score += 1 / (RRF_K + rank + 1);
        h[key] = rank + 1;
        fused.set(i, h);
      });
    add(byVector, "vectorRank");
    add(byBm25, "bm25Rank");
    return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, k);
  }

  private strip(i: number): Chunk {
    const { vector: _v, ...chunk } = this.index.chunks[i];
    return chunk;
  }
}

// Agents ask the same questions run after run ("EDISU Piemonte deadline"); caching query
// vectors on disk keeps us well inside the free embedding quota.
const QUERY_CACHE = "data/query-cache.json";
let queryCache: Record<string, string> | null = null;
async function embedQueryCached(query: string): Promise<number[]> {
  queryCache ??= existsSync(QUERY_CACHE) ? JSON.parse(readFileSync(QUERY_CACHE, "utf8")) : {};
  const key = `${embeddingModelId()}|${query.trim().toLowerCase()}`;
  if (queryCache![key]) return [...decodeVector(queryCache![key])];
  const v = await embedQuery(query);
  queryCache![key] = encodeVector(v);
  writeFileSync(QUERY_CACHE, JSON.stringify(queryCache));
  return v;
}

function dot(a: Float32Array, b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
