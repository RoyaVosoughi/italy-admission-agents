import { NextResponse } from "next/server";
import { getStore } from "@/lib/store/file";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const report = await getStore().getReport((await params).id);
  return report ? NextResponse.json(report) : NextResponse.json({ error: "not found" }, { status: 404 });
}
