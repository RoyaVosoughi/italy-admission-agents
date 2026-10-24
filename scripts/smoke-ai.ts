// Smoke test for the AI core: one structured call through OpenRouter.
// Usage: npm run smoke:ai
import { z } from "zod";
import { runAgentJSON, modelFor } from "../src/lib/ai";

async function main() {
  const schema = z.object({ city: z.string(), region: z.string(), universities: z.array(z.string()).min(1) });
  const t = Date.now();
  const { data, usage } = await runAgentJSON(schema, {
    agent: "scout",
    role: "Answer factual questions about Italian cities briefly.",
    prompt: "Which region is Turin in, and name two public universities there.",
    temperature: 0.2,
  });
  console.log(modelFor("scout"), `${Date.now() - t} ms`, JSON.stringify(data), usage);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
