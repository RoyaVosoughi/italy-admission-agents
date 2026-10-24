// Step 2 of ingestion: chunk kb/clean/*.en.md, embed, and write data/kb-index.json.
// Re-runnable: chunks whose text hash is unchanged reuse their stored vector.
// Usage: npm run kb:index
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { chunkDocument, type Chunk } from "../src/lib/rag/chunk";
import { embedDims, embeddingModelId, embedTexts } from "../src/lib/rag/embed";
import { encodeVector, INDEX_PATH, type KbIndex } from "../src/lib/rag/retrieve";

const CLEAN_DIR = "kb/clean";
const model = embeddingModelId();
const EMBED_DIMS = embedDims();

async function main() {
  const chunks: Chunk[] = readdirSync(CLEAN_DIR)
    .filter((f) => f.endsWith(".en.md"))
    .flatMap((f) => chunkDocument(f.replace(/\.en\.md$/, ""), readFileSync(join(CLEAN_DIR, f), "utf8")));

  const previous = new Map<string, string>();
  if (existsSync(INDEX_PATH)) {
    const old: KbIndex = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
    if (old.model === model && old.dims === EMBED_DIMS) for (const c of old.chunks) previous.set(c.hash, c.vector);
  }

  // Progress is saved after every batch: a quota or network failure must not waste what was already embedded.
  const CACHE_PATH = `data/kb-embed-cache-${model.replace(/[^\w.-]+/g, "_")}.json`;
  if (existsSync(CACHE_PATH)) for (const [h, v] of Object.entries(JSON.parse(readFileSync(CACHE_PATH, "utf8")) as Record<string, string>)) previous.set(h, v);

  const todo = chunks.filter((c) => !previous.has(c.hash));
  console.log(`${chunks.length} chunks, ${chunks.length - todo.length} cached, embedding ${todo.length}…`);
  const SAVE_EVERY = 100;
  for (let i = 0; i < todo.length; i += SAVE_EVERY) {
    const part = todo.slice(i, i + SAVE_EVERY);
    const vectors = await embedTexts(part.map((c) => c.embedText));
    part.forEach((c, j) => previous.set(c.hash, encodeVector(vectors[j])));
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(Object.fromEntries(previous)));
  }

  const index: KbIndex = {
    model,
    dims: EMBED_DIMS,
    builtAt: new Date().toISOString(),
    chunks: chunks.map((c) => ({ ...c, vector: previous.get(c.hash)! })),
  };
  mkdirSync(dirname(INDEX_PATH), { recursive: true });
  writeFileSync(INDEX_PATH, JSON.stringify(index));

  const sizes = chunks.map((c) => c.text.length).sort((a, b) => a - b);
  const byDoc = Object.entries(Object.groupBy(chunks, (c) => c.docSlug)).map(([d, cs]) => `${d}:${cs!.length}`);
  console.log(`chunk chars — min ${sizes[0]}, median ${sizes[sizes.length >> 1]}, max ${sizes[sizes.length - 1]}`);
  console.log(`tables ${chunks.filter((c) => c.isTable).length}, with confidence tag ${chunks.filter((c) => c.confidence.length).length}`);
  console.log(byDoc.join("  "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
