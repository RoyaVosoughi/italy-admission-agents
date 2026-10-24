// Runs the whole pipeline for one client from the command line.
// Usage: npm run client -- <client-folder> <document> [more documents…] [--rate <toman per EUR>] [--notes "…"]
import { executeRun, startRun } from "../src/lib/agents/orchestrator";

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const rate = flag("--rate");
  const notes = flag("--notes");
  const [clientFolder, ...documents] = args;
  if (!clientFolder || !documents.length) throw new Error("usage: npm run client -- <client-folder> <document> [...]");

  const input = { clientFolder, documents, notes, tomanPerEur: rate ? Number(rate) : undefined };
  const run = await startRun(input);
  console.log(`run ${run.id} started`);
  const done = await executeRun(run.id, input);
  for (const s of done.steps) console.log(`${s.status === "done" ? "✓" : s.status === "error" ? "✗" : "•"} [${s.agent}] ${s.label} — ${s.summary ?? s.error ?? ""}`);
  console.log(`\nSTATUS: ${done.status}${done.error ? ` — ${done.error}` : ""}${done.needsInput ? ` — needs: ${done.needsInput.join(", ")}` : ""}`);
  console.log(`usage: ${done.usage.llmCalls} LLM calls, ${done.usage.inputTokens + done.usage.outputTokens} tokens, ${done.usage.tavilyCalls} web calls`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
