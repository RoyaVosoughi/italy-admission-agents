// Embedding client. Gemini (gemini-embedding-001) by default; the provider is behind
// one function so it can be swapped for OpenAI later without touching callers.

// EMBEDDING_PROVIDER=local runs a small open model on this computer (no key, no quota, nothing leaves the
// machine); "gemini" uses the Google API (free tier: 1,000 texts/day).
const LOCAL_MODEL = process.env.LOCAL_EMBEDDING_MODEL ?? "Xenova/bge-small-en-v1.5";
const isLocal = () => process.env.EMBEDDING_PROVIDER === "local";

export const embedDims = () => (isLocal() ? 384 : 768);
/** Identifies the vector space: an index built with one model can only be searched with the same one. */
export const embeddingModelId = () => (isLocal() ? `local:${LOCAL_MODEL}` : (process.env.EMBEDDING_MODEL ?? "gemini-embedding-001"));
const BATCH = 100;

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

function config() {
  const key = process.env.EMBEDDING_API_KEY;
  if (!key) throw new Error("EMBEDDING_API_KEY is not set in .env.local");
  return { key, model: process.env.EMBEDDING_MODEL ?? "gemini-embedding-001" };
}

// Gemini only returns unit-length vectors at the full 3072 dims; at 768 we normalise
// ourselves so cosine similarity becomes a plain dot product.
function normalise(v: number[]): number[] {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

interface BatchEmbedResponse {
  embeddings: { values: number[] }[];
}

async function postWithRetry(url: string, key: string, body: unknown): Promise<BatchEmbedResponse> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        // without a timeout a dropped connection hangs the whole indexing run
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      if (attempt < 6) {
        console.warn(`  embedding request failed (${(e as Error).name}), retrying…`);
        continue;
      }
      throw e;
    }
    if (res.ok) return res.json();
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      // The free tier is a per-minute quota; Gemini says how long to wait ("retryDelay": "41s").
      const hinted = Number(text.match(/"retryDelay":\s*"(\d+)/)?.[1]);
      // A long hint means the *daily* free quota (1,000 texts/day) is used up — waiting is pointless.
      if (res.status === 429 && hinted > 300) {
        throw new Error(
          `Daily embedding quota used up; Google says retry in ${Math.round(hinted / 3600)}h. ` +
            `Enable billing on the Google AI Studio project, or wait for the reset.`,
        );
      }
      const waitS = res.status === 429 ? (hinted || 60) + 2 : 2 ** attempt;
      if (res.status === 429) console.warn(`  embedding quota reached, waiting ${waitS}s…`);
      await new Promise((r) => setTimeout(r, waitS * 1000));
      continue;
    }
    throw new Error(`Embedding request failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

type Extractor = (texts: string[], opts: { pooling: "cls"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;
let localExtractor: Promise<Extractor> | null = null;

async function embedLocal(texts: string[], taskType: TaskType): Promise<number[][]> {
  localExtractor ??= import("@huggingface/transformers").then(
    (m) => m.pipeline("feature-extraction", LOCAL_MODEL, { dtype: "q8" }) as unknown as Promise<Extractor>,
  );
  const extract = await localExtractor;
  // bge models are trained to see this instruction in front of search queries (not in front of passages)
  const inputs = taskType === "RETRIEVAL_QUERY" ? texts.map((t) => `Represent this sentence for searching relevant passages: ${t}`) : texts;
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += 16) {
    out.push(...(await extract(inputs.slice(i, i + 16), { pooling: "cls", normalize: true })).tolist());
    if (inputs.length > 16 && (i / 16) % 5 === 4) console.log(`  embedded ${Math.min(i + 16, inputs.length)}/${inputs.length}`);
  }
  return out;
}

export async function embedTexts(texts: string[], taskType: TaskType = "RETRIEVAL_DOCUMENT"): Promise<number[][]> {
  if (isLocal()) return embedLocal(texts, taskType);
  const { key, model } = config();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const json = await postWithRetry(url, key, {
      requests: texts.slice(i, i + BATCH).map((text) => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: embedDims(),
      })),
    });
    out.push(...json.embeddings.map((e) => normalise(e.values)));
    if (texts.length > BATCH) console.log(`  embedded ${out.length}/${texts.length}`);
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  return (await embedTexts([text], "RETRIEVAL_QUERY"))[0];
}
