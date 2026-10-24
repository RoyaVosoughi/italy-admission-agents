// Agent 12 — Lessons Critic: the self-improvement engine. After each run it reads what went
// wrong (Manager rework orders, unverifiable facts) and writes at most three
// lessons addressed to specific agents. lessons.ts injects them into those agents' prompts.
import { runAgentJSON } from "../ai";
import { CriticOutput } from "./types";
import { json, type RunContext } from "./context";

const ROLE = `
You improve a team of AI agents. From this run's log, extract at most 3 lessons, each addressed to
the ONE agent that should behave differently next time. A good lesson is specific and reusable:
"scholarship: ESU Padova publishes its bando in late June — mark the deadline projected until then."
Bad: "be more careful". No lesson about a one-off fluke. Return an empty list if nothing generalises.
Never put client names or personal data in a lesson.
`;

export async function runCritic(ctx: RunContext, log: unknown, existing: string[]) {
  const { data, usage } = await runAgentJSON(CriticOutput, {
    agent: "critic",
    role: ROLE,
    prompt: `Existing lessons (don't repeat):\n${existing.map((l) => `- ${l}`).join("\n") || "- none"}\n\nRun log:\n${json(log)}`,
    temperature: 0.4,
  });
  ctx.addUsage(usage);
  for (const l of data.lessons) await ctx.store.addLesson({ agent: l.agent, lesson: l.lesson, source: "critic" });
  return data.lessons;
}
