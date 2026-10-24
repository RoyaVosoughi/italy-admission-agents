// The self-improvement memory: view, add (human) and delete lessons.
import { NextResponse } from "next/server";
import { getStore } from "@/lib/store/file";
import type { AgentName } from "@/lib/ai";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getStore().listLessons(undefined, false));
}

export async function POST(req: Request) {
  const { agent, lesson } = (await req.json()) as { agent: AgentName; lesson: string };
  if (!agent || !lesson?.trim()) return NextResponse.json({ error: "agent and lesson are required" }, { status: 400 });
  return NextResponse.json(await getStore().addLesson({ agent, lesson: lesson.trim(), source: "human" }));
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await getStore().deleteLesson(id);
  return NextResponse.json({ ok: true });
}
