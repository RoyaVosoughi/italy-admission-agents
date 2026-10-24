// Optional human feedback on a report (not part of approval): becomes a lesson for one agent.
import { NextResponse } from "next/server";
import { getStore } from "@/lib/store/file";
import type { AgentName } from "@/lib/ai";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { agent, comment, rating } = (await req.json()) as { agent: AgentName; comment: string; rating: "up" | "down" };
  if (!agent || !comment?.trim()) return NextResponse.json({ error: "agent and comment are required" }, { status: 400 });
  const lesson = await getStore().addLesson({ agent, source: "human", lesson: `${rating === "down" ? "Avoid: " : "Keep doing: "}${comment.trim()}` });
  return NextResponse.json(lesson);
}
