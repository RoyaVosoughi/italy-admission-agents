// Live status of one run (polled by the studio), with its evidence and Manager decisions.
import { NextResponse } from "next/server";
import { getStore } from "@/lib/store/file";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const run = await store.getRun(id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [evidence, decisions, report] = await Promise.all([
    store.listEvidence(id),
    store.listManagerDecisions(id),
    run.reportId ? store.getReport(run.reportId) : null,
  ]);
  return NextResponse.json({ run, evidence, decisions, report });
}
