// POST: start an assessment (multipart: clientFolder, notes, rate, files[]). GET: list runs.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { NextResponse } from "next/server";
import { executeRun, findReusableRun, startRun, type RunInput } from "@/lib/agents/orchestrator";
import { getStore } from "@/lib/store/file";

export const runtime = "nodejs";

export async function GET() {
  const runs = await getStore().listRuns();
  return NextResponse.json(runs.map(({ steps, ...r }) => ({ ...r, stepCount: steps.length, lastStep: steps.at(-1)?.label })));
}

export async function POST(req: Request) {
  const form = await req.formData();
  const clientFolder = String(form.get("clientFolder") ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  if (!clientFolder) return NextResponse.json({ error: "clientFolder is required" }, { status: 400 });
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return NextResponse.json({ error: "upload at least one document (resume or intake note)" }, { status: 400 });

  // Uploaded documents stay on this machine, under data/uploads (git-ignored).
  const dir = resolve("data/uploads", `${clientFolder}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const documents: string[] = [];
  for (const f of files) {
    const path = join(dir, basename(f.name));
    writeFileSync(path, Buffer.from(await f.arrayBuffer()));
    documents.push(path);
  }
  const rate = Number(form.get("rate"));
  const input: RunInput = {
    clientFolder,
    documents,
    notes: String(form.get("notes") ?? "") || undefined,
    tomanPerEur: rate > 0 ? rate : undefined,
  };
  // Same documents for the same client: hand back the saved result instead of running everything again.
  const existing = await findReusableRun(input);
  if (existing) return NextResponse.json({ ...existing, reused: true }, { status: 200 });
  const run = await startRun(input);
  // Fire and forget: the studio polls GET /api/runs/[id] for live progress.
  void executeRun(run.id, input);
  return NextResponse.json(run, { status: 202 });
}
