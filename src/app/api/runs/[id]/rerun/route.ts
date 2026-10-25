// POST: run the same documents again on purpose (the normal path returns the saved result instead).
import { NextResponse } from "next/server";
import { executeRun, startRun, type RunInput } from "@/lib/agents/orchestrator";
import { getStore } from "@/lib/store/file";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const old = await getStore().getRun(id);
  if (!old) return NextResponse.json({ error: "not found" }, { status: 404 });
  const input: RunInput = {
    clientFolder: old.clientId,
    documents: old.inputs.documents,
    notes: old.inputs.notes,
    tomanPerEur: old.inputs.tomanPerEur,
    force: true,
  };
  const run = await startRun(input);
  void executeRun(run.id, input);
  return NextResponse.json(run, { status: 202 });
}
