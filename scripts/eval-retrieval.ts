// Retrieval quality check: does the chunk holding the answer appear in the top 5?
// Each question runs twice — without filters (hardest) and with the region filter
// (how the agents will actually query once they know the university).
// Usage: npm run eval:retrieval
import { readFileSync } from "node:fs";
import { Retriever, type Hit } from "../src/lib/rag/retrieve";
import { embedTexts } from "../src/lib/rag/embed";

interface Case {
  q: string;
  region: string | null;
  doc: string;
  expect: string[];
}

const norm = (s: string) => s.replace(/\*\*/g, "").replace(/\s+/g, " ");
const answerRank = (hits: Hit[], c: Case) =>
  hits.findIndex((h) => h.chunk.docSlug === c.doc && c.expect.some((e) => norm(h.chunk.text).includes(e))) + 1;

async function main() {
  const cases: Case[] = JSON.parse(readFileSync("evals/retrieval.json", "utf8"));
  const retriever = Retriever.load();
  const vectors = await embedTexts(cases.map((c) => c.q), "RETRIEVAL_QUERY");
  const modes = [
    { name: "no filter", opts: (_c: Case) => ({ k: 5 }) },
    { name: "region filter", opts: (c: Case) => ({ k: 5, regions: c.region ? [c.region] : undefined }) },
  ];

  for (const mode of modes) {
    let hits = 0;
    let rr = 0;
    const misses: string[] = [];
    cases.forEach((c, i) => {
      const res = retriever.searchWithVector(c.q, vectors[i], mode.opts(c));
      const rank = answerRank(res, c);
      if (rank) {
        hits++;
        rr += 1 / rank;
      } else {
        misses.push(`  ✗ ${c.q}\n      got: ${res.map((h) => h.chunk.id).join(", ")}`);
      }
    });
    console.log(
      `\n${mode.name}: hit@5 ${hits}/${cases.length} (${Math.round((100 * hits) / cases.length)}%), MRR ${(rr / cases.length).toFixed(2)}`,
    );
    if (misses.length) console.log(misses.join("\n"));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
