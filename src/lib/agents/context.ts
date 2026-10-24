// Helpers shared by agents: how knowledge-base chunks are shown to a model, and the
// per-run context (store, retriever, web tool, today's date) passed to every agent.
import type { AgentName, Usage } from "../ai";
import type { Hit, Retriever } from "../rag/retrieve";
import type { Store } from "../store/types";
import type { Tavily } from "../tools/tavily";

export interface RunContext {
  runId: string;
  today: string; // YYYY-MM-DD — injected so tests and re-runs are reproducible
  intake: string; // "2027/28"
  store: Store;
  retriever: Retriever;
  web: Tavily;
  lessons: (agent: AgentName) => Promise<string[]>;
  addUsage: (u: Usage) => void;
}

/** Chunks are shown with their id so the model can cite them as (KB: id). */
export function formatChunks(hits: Hit[], maxChars = 24_000): string {
  const out: string[] = [];
  let used = 0;
  for (const { chunk } of hits) {
    const head = `[KB: ${chunk.id}] ${chunk.region ?? "Italy (national)"} › ${chunk.headingPath.join(" › ")}${
      chunk.confidence.length ? ` {${chunk.confidence.join(", ")}}` : ""
    }`;
    const block = `${head}\n${chunk.text}`;
    if (used + block.length > maxChars) break;
    out.push(block);
    used += block.length;
  }
  return out.join("\n\n---\n\n");
}

/** Merges hit lists, keeping the first occurrence of each chunk. */
export function uniqueHits(...lists: Hit[][]): Hit[] {
  const seen = new Set<string>();
  return lists.flat().filter((h) => !seen.has(h.chunk.id) && seen.add(h.chunk.id));
}

export const json = (x: unknown) => JSON.stringify(x, null, 1);

/** Small concurrency limiter — free-tier models allow only a few requests at once. */
export function limiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
