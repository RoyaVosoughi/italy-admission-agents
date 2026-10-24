// Step 1 of ingestion: clean every registered source into kb/clean/.
// Usage: npm run kb:clean   (KB_SOURCE_DIR defaults to the parent folder)
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { cleanDocument } from "../src/lib/rag/clean";
import { SOURCES } from "../src/lib/rag/sources";

const sourceDir = resolve(process.env.KB_SOURCE_DIR ?? "..");
const outDir = resolve("kb/clean");
mkdirSync(outDir, { recursive: true });

// Warn about report files nobody registered, so a new region isn't silently skipped.
const registered = new Set(SOURCES.map((s) => s.file));
const unregistered = readdirSync(sourceDir).filter(
  (f) => f.endsWith(".md") && !registered.has(f) && !f.startsWith("italy-admission-agents-plan"),
);

const report: Record<string, unknown>[] = [];
const droppedLog: string[] = [];

for (const src of SOURCES) {
  const path = join(sourceDir, src.file);
  if (!existsSync(path)) {
    console.warn(`MISSING  ${src.file}`);
    report.push({ file: src.file, missing: true });
    continue;
  }
  const { en, fa, dropped, stats } = cleanDocument(readFileSync(path, "utf8"));
  const front = [
    "---",
    `source_file: ${JSON.stringify(src.file)}`,
    `title: ${JSON.stringify(src.title)}`,
    `region: ${JSON.stringify(src.region)}`,
    `dsu_body: ${JSON.stringify(src.dsuBody)}`,
    `doc_type: ${src.docType}`,
    `cleaned_at: ${new Date().toISOString()}`,
    "---",
    "",
  ].join("\n");
  writeFileSync(join(outDir, `${src.slug}.en.md`), front + en);
  writeFileSync(join(outDir, `${src.slug}.fa.md`), front + fa);
  droppedLog.push(`### ${src.file}`, ...dropped, "");
  report.push({ file: src.file, slug: src.slug, ...stats });
  console.log(
    `${src.slug.padEnd(24)} ${String(stats.bytesIn).padStart(7)} → ${String(stats.bytesOut).padStart(6)} B` +
      `  img:${stats.base64Removed} latex:${stats.latexBlocksRemoved} tables:${stats.tablesConverted}` +
      `  en:${stats.enBlocks} fa:${stats.faBlocks} dropped:${stats.droppedBlocks}`,
  );
}

writeFileSync(join(outDir, "_report.json"), JSON.stringify(report, null, 2));
writeFileSync(join(outDir, "_dropped.log"), droppedLog.join("\n"));
if (unregistered.length) console.warn(`\nNOT REGISTERED in sources.ts: ${unregistered.join(", ")}`);
