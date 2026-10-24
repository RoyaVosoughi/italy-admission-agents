// Real admission/scholarship results — the strongest learning signal. Each outcome is compared
// with the prediction; a miss becomes a lesson for the admission analyst.
import { NextResponse } from "next/server";
import { getStore } from "@/lib/store/file";
import type { Outcome } from "@/lib/store/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getStore().listOutcomes());
}

export async function POST(req: Request) {
  const body = (await req.json()) as Omit<Outcome, "id" | "recordedAt">;
  if (!body.clientId || !body.university || !body.result) {
    return NextResponse.json({ error: "clientId, university and result are required" }, { status: 400 });
  }
  const store = getStore();
  const outcome = await store.addOutcome(body);
  const predictedYes = body.predictedTier === "High" || body.predictedTier === "Medium";
  const admitted = body.result === "admitted";
  if (body.predictedTier && predictedYes !== admitted && body.result !== "withdrew") {
    await store.addLesson({
      agent: "analyst",
      source: "outcome",
      lesson: `${body.university} (${body.program}): predicted ${body.predictedTier} but the result was ${body.result}${
        body.notes ? ` — ${body.notes}` : ""
      }. Weigh this when rating similar profiles there.`,
    });
  }
  return NextResponse.json(outcome);
}
