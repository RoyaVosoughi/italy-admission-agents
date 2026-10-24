// AI core — every agent call goes through here.
//   runAgentText  — free text (writer, translator: their reader is a person)
//   runAgentJSON  — structured output: extract JSON → Zod validate → on failure send the
//                   errors back to the model once and ask for a corrected version.
// Why not generateObject/JSON mode: support for it varies across OpenRouter models;
// extract + validate + retry works on all of them and keeps model swaps to one slug.
import { generateText, type ModelMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { AGENCY_CONTEXT } from "./agency";

export type AgentName =
  | "intake"
  | "assessor"
  | "scout"
  | "analyst"
  | "scholarship"
  | "cost"
  | "verifier"
  | "writer"
  | "manager"
  | "translator"
  | "critic"
  | "extractor";

export type Effort = "low" | "medium" | "high";

export interface AgentCall {
  agent: AgentName;
  /** Role-specific instructions; AGENCY_CONTEXT and lessons are added automatically. */
  role: string;
  prompt: string;
  temperature: number;
  effort?: Effort;
  lessons?: string[];
  maxOutputTokens?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

// LLM_PROVIDER=gemini uses Google's OpenAI-compatible endpoint with the free AI Studio key;
// LLM_PROVIDER=openrouter (needs credits) gives access to every model by slug.
// Free-tier fallbacks: when the primary model's daily quota is used up, the next entry of LLM_FALLBACKS
// ("provider:model,provider:model") takes over. All of these speak the OpenAI-compatible protocol.
type Provider = "gemini" | "openrouter" | "mistral" | "cerebras" | "groq";
const llmProvider = (): Provider => (process.env.LLM_PROVIDER === "openrouter" ? "openrouter" : "gemini");

const PROVIDERS: Record<Provider, { baseURL: string; keyEnv: string[]; defaultModel: string }> = {
  mistral: { baseURL: "https://api.mistral.ai/v1", keyEnv: ["MISTRAL_API_KEY"], defaultModel: "mistral-small-latest" },
  cerebras: { baseURL: "https://api.cerebras.ai/v1", keyEnv: ["CEREBRAS_API_KEY"], defaultModel: "gpt-oss-120b" },
  groq: { baseURL: "https://api.groq.com/openai/v1", keyEnv: ["GROQ_API_KEY"], defaultModel: "llama-3.3-70b-versatile" },
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: ["GEMINI_API_KEY", "EMBEDDING_API_KEY"],
    defaultModel: "gemini-3.5-flash-lite",
  },
  openrouter: { baseURL: "https://openrouter.ai/api/v1", keyEnv: ["OPENROUTER_API_KEY"], defaultModel: "google/gemini-3.5-flash-lite" },
};
const DEFAULT_MODEL = PROVIDERS[llmProvider()].defaultModel;

export function modelFor(agent: AgentName): string {
  const env = process.env;
  const specific: Partial<Record<AgentName, string | undefined>> = {
    analyst: env.ANALYST_MODEL,
    manager: env.MANAGER_MODEL,
    writer: env.WRITER_MODEL,
    translator: env.WRITER_MODEL,
  };
  return specific[agent] || env.PIPELINE_MODEL || DEFAULT_MODEL;
}

// Reasoning models can spend the whole token budget (and minutes) thinking. We inject an
// explicit effort into every request body — OpenRouter and Gemini spell it differently.
const providers = new Map<string, ReturnType<typeof createOpenAICompatible>>();
const keyOf = (name: Provider) => PROVIDERS[name].keyEnv.map((k) => process.env[k]).find(Boolean);

function provider(name: Provider, effort: Effort) {
  const cacheKey = `${name}:${effort}`;
  let p = providers.get(cacheKey);
  if (!p) {
    const cfg = PROVIDERS[name];
    const apiKey = keyOf(name);
    if (!apiKey) throw new Error(`${cfg.keyEnv[0]} is not set in .env.local`);
    p = createOpenAICompatible({
      name,
      baseURL: cfg.baseURL,
      apiKey,
      includeUsage: true,
      fetch: async (url, init) => {
        if (init?.body && typeof init.body === "string") {
          const body = JSON.parse(init.body);
          if (name === "openrouter") body.reasoning = { effort };
          else if (name === "gemini") body.reasoning_effort = effort;
          init = { ...init, body: JSON.stringify(body) };
        }
        return fetch(url, init);
      },
    });
    providers.set(cacheKey, p);
  }
  return p;
}

export function buildInstructions(call: Pick<AgentCall, "role" | "lessons">): string {
  const parts = [AGENCY_CONTEXT, `## Your role\n${call.role.trim()}`];
  if (call.lessons?.length) {
    parts.push(`## Lessons from previous runs (follow these)\n${call.lessons.map((l) => `- ${l}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A model that can't serve any more calls today (daily quota, retired model, bad key): try the next one. */
export class ModelUnavailable extends Error {}

interface Candidate {
  provider: Provider;
  model: string;
}
const candidateId = (c: Candidate) => `${c.provider}:${c.model}`;
const unavailableUntil = new Map<string, number>();
const RECHECK_MS = 30 * 60_000; // a daily quota resets overnight; look again after 30 min

/** Primary model for this agent first, then LLM_FALLBACKS in order. Entries without an API key are skipped. */
function candidates(agent: AgentName): Candidate[] {
  const list: Candidate[] = [{ provider: llmProvider(), model: modelFor(agent) }];
  for (const item of (process.env.LLM_FALLBACKS ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const [name, ...rest] = item.split(":");
    if (name in PROVIDERS) list.push({ provider: name as Provider, model: rest.join(":") || PROVIDERS[name as Provider].defaultModel });
  }
  const now = Date.now();
  return list.filter((c) => keyOf(c.provider) && (unavailableUntil.get(candidateId(c)) ?? 0) <= now);
}

const statusOf = (e: unknown) => {
  const outer = e as { lastError?: unknown };
  return ((outer.lastError ?? e) as { statusCode?: number }).statusCode;
};

/** Free tiers have per-minute limits: wait as long as the provider asks, give up on daily limits. */
async function withRateLimitRetry<T>(agent: AgentName, model: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      // The SDK wraps provider errors in a RetryError ("Failed after N attempts"); look at the real one.
      const outer = e as { lastError?: unknown; message?: string };
      const err = (outer.lastError ?? e) as { statusCode?: number; responseBody?: string; message?: string };
      if (err.message?.includes("timed out") && attempt === 0) {
        console.warn(`  ${agent}: call timed out, retrying once…`);
        continue;
      }
      if (err.statusCode !== 429) throw e;
      if (attempt >= 5) throw new ModelUnavailable(`${agent}: ${model} keeps answering "too many requests"`);
      const body = err.responseBody ?? "";
      const hinted = Number(body.match(/"retryDelay":\s*"(\d+)/)?.[1] ?? body.match(/retry in (\d+)/i)?.[1]);
      if (hinted > 300 || /PerDay|per day|daily/i.test(body)) {
        throw new ModelUnavailable(`${agent}: daily model quota used up (${model}). ${body.slice(0, 200)}`);
      }
      const waitS = (hinted || 20 * (attempt + 1)) + 1;
      console.warn(`  ${agent}: rate limited, waiting ${waitS}s…`);
      await sleep(waitS * 1000);
    }
  }
}

const CALL_TIMEOUT_MS = 240_000;

/** Hard deadline that fires even if the HTTP layer ignores the abort signal (seen with a stalled connection). */
function withDeadline<T>(agent: AgentName, p: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new Error(`${agent}: model call timed out after ${CALL_TIMEOUT_MS / 1000}s`));
    }, CALL_TIMEOUT_MS);
  });
  return Promise.race([p(ctrl.signal), deadline]).finally(() => clearTimeout(timer));
}

async function complete(call: AgentCall, instructions: string, messages: ModelMessage[]) {
  const chain = candidates(call.agent);
  if (!chain.length) throw new ModelUnavailable(`${call.agent}: no model available (all daily quotas used up, or no API key set)`);
  let last: unknown;
  for (const c of chain) {
    try {
      const res = await withRateLimitRetry(call.agent, c.model, () =>
        withDeadline(call.agent, (signal) =>
          generateText({
            model: provider(c.provider, call.effort ?? "low")(c.model),
            instructions,
            messages,
            temperature: call.temperature,
            maxOutputTokens: call.maxOutputTokens ?? 8000,
            maxRetries: 0, // rate limits and timeouts are handled by withRateLimitRetry
            abortSignal: signal,
          }),
        ),
      );
      return {
        text: res.text,
        usage: { inputTokens: res.usage.inputTokens ?? 0, outputTokens: res.usage.outputTokens ?? 0, calls: 1 },
      };
    } catch (e) {
      const status = statusOf(e);
      const transient = status !== undefined && status >= 500;
      const switchable = e instanceof ModelUnavailable || transient || (status !== undefined && [401, 403, 404].includes(status));
      if (!switchable) throw e;
      unavailableUntil.set(candidateId(c), Date.now() + (transient ? 2 * 60_000 : RECHECK_MS));
      console.warn(`  ${call.agent}: ${candidateId(c)} unavailable (${status ?? "quota"}), switching to the next model…`);
      last = e;
    }
  }
  throw last;
}

export async function runAgentText(call: AgentCall): Promise<{ text: string; usage: Usage }> {
  const { text, usage } = await complete(call, buildInstructions(call), [{ role: "user", content: call.prompt }]);
  if (!text.trim()) throw new Error(`${call.agent}: model returned an empty response`);
  return { text, usage };
}

/** Pulls the JSON value out of a model reply (code fences, leading prose, trailing notes). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error("no JSON object or array found in the reply");
  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(close);
  if (end <= start) throw new Error("JSON is not closed");
  return JSON.parse(candidate.slice(start, end + 1));
}

function formatIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 15)
    .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

export async function runAgentJSON<S extends z.ZodType>(
  schema: S,
  call: AgentCall,
): Promise<{ data: z.infer<S>; usage: Usage }> {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema, { unrepresentable: "any" }));
  const instructions =
    buildInstructions(call) +
    `\n\n## Output format\nReply with ONLY one JSON value that validates against this JSON Schema. ` +
    `No prose before or after it.\n${jsonSchema}`;

  const messages: ModelMessage[] = [{ role: "user", content: call.prompt }];
  const total: Usage = { inputTokens: 0, outputTokens: 0, calls: 0 };

  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, usage } = await complete(call, instructions, messages);
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
    total.calls++;

    let problem: string;
    try {
      const parsed = schema.safeParse(extractJson(text));
      if (parsed.success) return { data: parsed.data, usage: total };
      problem = `The JSON did not validate:\n${formatIssues(parsed.error)}`;
    } catch (e) {
      problem = `The reply could not be parsed as JSON: ${(e as Error).message}`;
    }
    messages.push(
      { role: "assistant", content: text },
      { role: "user", content: `${problem}\n\nReturn the corrected JSON only.` },
    );
    if (attempt === 1) throw new Error(`${call.agent}: invalid output after retry. ${problem}`);
  }
  throw new Error("unreachable");
}
