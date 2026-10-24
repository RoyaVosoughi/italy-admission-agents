// Weekly freshness check (run by Windows Task Scheduler while local; Vercel cron later).
// For every approved report of the last 120 days, re-open each official page that backed a
// fact and confirm the quoted sentence is still there. A vanished quote means the page changed
// (new bando, new deadline): the report is flagged so it can be re-run.
import { NextResponse } from "next/server";
import { getStore } from "@/lib/store/file";
import { quoteInPage } from "@/lib/rules/evidence";
import { Tavily } from "@/lib/tools/tavily";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const store = getStore();
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const runs = (await store.listRuns()).filter((r) => r.status === "approved" && r.createdAt >= since);

  const web = new Tavily({ maxCalls: 20 });
  const flagged: { runId: string; client: string; claim: string; url: string }[] = [];
  let checked = 0;
  for (const run of runs) {
    const ev = (await store.listEvidence(run.id)).filter((e) => e.quoteMatched && e.url);
    if (!ev.length || web.remaining < 1) continue;
    const pages = await web.extract(ev.map((e) => e.url!));
    for (const e of ev) {
      const page = pages.find((p) => p.url === e.url);
      if (!page) continue;
      checked++;
      if (!quoteInPage(e.quote, page.text)) flagged.push({ runId: run.id, client: run.clientId, claim: e.claim, url: e.url! });
    }
  }
  return NextResponse.json({ checkedFacts: checked, reports: runs.length, flagged, webCalls: web.used });
}
