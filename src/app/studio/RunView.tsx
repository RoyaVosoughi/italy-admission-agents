"use client";
import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { ArrowSquareOut, Brain, CheckCircle, Crown, Globe, Quotes, XCircle } from "@phosphor-icons/react";
import { AgentAvatar, persona } from "./personas";
import { Card, Stat, StatusChip, Tabs, duration, timeAgo } from "./ui";
import { acceptanceEstimate } from "@/lib/rules/chance";
import { UniPolaroid, uniKey } from "./universities";

type Step = { id: string; agent: string; label: string; status: string; summary?: string; error?: string; startedAt: string; finishedAt?: string; output?: unknown };
type Evidence = {
  id: string;
  claimId: string;
  claim: string;
  status: string;
  liveValue: string | null;
  url: string | null;
  quote: string | null;
  quoteMatched: boolean;
  officialUrl: boolean;
  checkedBy: string;
  academicYear: string | null;
};
type Decision = { round: number; verdict: string; reworkOrders: { agent: string; target: string; instruction: string }[]; blockReason: string | null };
type Detail = {
  run: {
    id: string;
    clientId: string;
    status: string;
    createdAt: string;
    error?: string;
    needsInput?: string[];
    managerRounds: number;
    steps: Step[];
    usage: { llmCalls: number; inputTokens: number; outputTokens: number; tavilyCalls: number };
  };
  evidence: Evidence[];
  decisions: Decision[];
  report: { contentEn: string; contentFa?: string; files: string[]; writingScore: number } | null;
};

type View = "pipeline" | "en" | "fa" | "evidence" | "director";

export function RunView({ id }: { id: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [view, setViewState] = useState<View>(() => {
    if (typeof window === "undefined") return "pipeline";
    const v = new URLSearchParams(window.location.search).get("view");
    return (["pipeline", "en", "fa", "evidence", "director"] as const).find((x) => x === v) ?? "pipeline";
  });
  const setView = (v: View) => {
    setViewState(v);
    const q = new URLSearchParams(window.location.search);
    q.set("view", v);
    window.history.replaceState(null, "", `?${q}`);
  };

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const json = (await (await fetch(`/api/runs/${id}`)).json()) as Detail;
      if (!alive) return;
      setD(json);
      if (json.run?.status === "running") timer = setTimeout(load, 3000);
    };
    setD(null);
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id]);

  // Hide the scaffolding markers that code puts around computed tables.
  const html = useMemo(() => {
    if (!d?.report) return "";
    const md = (view === "fa" ? d.report.contentFa ?? "" : d.report.contentEn).replace(/<!-- \/?computed -->/g, "");
    return marked.parse(md) as string;
  }, [d, view]);

  if (!d) return <RunSkeleton />;
  const { run } = d;
  const confirmed = d.evidence.filter((e) => e.quoteMatched && e.officialUrl).length;

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="display text-4xl">{run.clientId}</h2>
            <p className="text-sm text-stone-600">Started {timeAgo(run.createdAt)}</p>
          </div>
          <StatusChip s={run.status} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat Icon={Brain} label="Model calls" value={run.usage.llmCalls} hint={`${Math.round((run.usage.inputTokens + run.usage.outputTokens) / 1000)}k tokens`} />
          <Stat Icon={Globe} label="Official-site checks" value={run.usage.tavilyCalls} />
          <Stat Icon={Quotes} label="Facts quoted from official pages" value={`${confirmed}/${d.evidence.length}`} />
          <Stat Icon={Crown} label="Director rounds" value={run.managerRounds} />
        </div>
        <RunBanner d={d} />
      </Card>

      <Shortlist steps={run.steps} />

      <Tabs<View>
        label="Run sections"
        value={view}
        onChange={setView}
        items={[
          { value: "pipeline", label: "Pipeline" },
          { value: "en", label: "Report (EN)", disabled: !d.report },
          { value: "fa", label: <span className="font-[family-name:var(--font-vazir)]">گزارش فارسی</span>, disabled: !d.report },
          { value: "evidence", label: `Evidence (${d.evidence.length})` },
          { value: "director", label: `Director (${d.decisions.length})` },
        ]}
      />

      {view === "pipeline" && <Pipeline steps={run.steps} running={run.status === "running"} />}
      {(view === "en" || view === "fa") && d.report && (
        <Card className="p-6 sm:p-10">
          <article dir={view === "fa" ? "rtl" : "ltr"} className={`report ${view === "fa" ? "report-fa" : ""}`} dangerouslySetInnerHTML={{ __html: html }} />
        </Card>
      )}
      {view === "evidence" && <EvidenceTable items={d.evidence} />}
      {view === "director" && <DirectorRounds decisions={d.decisions} />}
    </div>
  );
}

type RankedLite = { candidate?: { university?: string; city?: string; programName?: string | null }; rating?: { tier?: string; score?: number; features?: unknown } };

/** The shortlist as polaroids — only universities we have a photo for (matched by name). */
function Shortlist({ steps }: { steps: Step[] }) {
  const picked = steps.find((s) => s.label === "Select shortlist")?.output as { selected?: RankedLite[] } | undefined;
  const cards = (picked?.selected ?? [])
    .map((r) => ({
      name: r.candidate?.university ?? "",
      city: r.candidate?.city ?? "",
      tier: r.rating?.tier,
      pct: r.rating?.features ? acceptanceEstimate(r.rating as Parameters<typeof acceptanceEstimate>[0], { programmeNamed: !!r.candidate?.programName }).pct : null,
      key: uniKey(r.candidate?.university ?? ""),
    }))
    .filter((c): c is typeof c & { key: string } => !!c.key);
  if (!cards.length) return null;
  return (
    <section aria-label="Shortlisted universities">
      <h3 className="eyebrow mb-3 text-stone-600">Shortlist</h3>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c, i) => (
          <li key={c.name} className="px-1 pb-2">
            <UniPolaroid k={c.key} label={c.name} caption={[c.city, c.pct ? `~${c.pct}% chance` : c.tier].filter(Boolean).join(" · ")} tilt={i} delay={i * 80} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RunBanner({ d }: { d: Detail }) {
  const { run, report } = d;
  if (run.status === "approved" && report) {
    return (
      <div className="mt-4 flex items-start gap-3 rounded-2xl bg-[var(--mint)] p-4 text-sm text-stone-900">
        <AgentAvatar k="manager" size="sm" />
        <div className="min-w-0">
          <p className="font-bold">Approved by Leonardo, the Director{typeof report.writingScore === "number" ? ` — writing score ${report.writingScore}/100` : ""}.</p>
          <p className="mt-1 break-all text-stone-700">{report.files.map((f) => f.split(/[\\/]/).slice(-2).join("/")).join(" · ")}</p>
        </div>
      </div>
    );
  }
  if (run.status === "needs_input" && run.needsInput) {
    return (
      <div className="mt-4 rounded-xl bg-violet-50 p-4 text-sm text-violet-900 ring-1 ring-violet-200">
        <p className="font-bold">Livia couldn&apos;t find: {run.needsInput.join(", ")}.</p>
        <p className="mt-1">Start a new assessment and add these in the notes.</p>
      </div>
    );
  }
  if (run.error) {
    const blocked = run.status === "blocked";
    return (
      <div className={`mt-4 rounded-xl p-4 text-sm ring-1 ${blocked ? "bg-amber-50 text-amber-950 ring-amber-200" : "bg-rose-50 text-rose-900 ring-rose-200"}`}>
        <p className="font-bold">{blocked ? "Not approved — nothing is sent to the client." : "The run stopped."}</p>
        <p className="mt-1 break-words">{run.error}</p>
      </div>
    );
  }
  return null;
}

function Pipeline({ steps, running }: { steps: Step[]; running: boolean }) {
  if (!steps.length) return <p className="text-sm text-stone-600">Waiting for the first agent…</p>;
  return (
    <ol className="relative space-y-3 before:absolute before:inset-y-2 before:start-5 before:w-px before:bg-[var(--line)]" aria-live={running ? "polite" : undefined}>
      {steps.map((s) => {
        const p = persona(s.agent);
        const took = duration(s.startedAt, s.finishedAt);
        return (
          <li key={s.id} className="relative flex gap-3">
            <AgentAvatar k={s.agent} pulse={s.status === "running"} />
            <Card className={`min-w-0 flex-1 p-4 ${s.status === "running" ? "shadow-[0_0_0_1.5px_var(--ink),var(--shadow-float)]" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className={`text-xs font-bold ${p.ink}`}>
                    {p.name} · {p.title}
                  </span>
                  <p className="font-bold text-stone-900">{s.label}</p>
                </div>
                <div className="flex items-center gap-2">
                  {took && <span className="font-mono text-xs tabular-nums text-stone-500">{took}</span>}
                  <StatusChip s={s.status} />
                </div>
              </div>
              {s.status === "running" && (
                <p className="thinking mt-2 flex items-center gap-1 text-xs text-stone-600" role="status">
                  {p.name} is working
                  <span className="ms-1 inline-flex gap-0.5" aria-hidden="true">
                    <i className="h-1.5 w-1.5 rounded-full bg-[var(--ink)]" />
                    <i className="h-1.5 w-1.5 rounded-full bg-[var(--ink)]" />
                    <i className="h-1.5 w-1.5 rounded-full bg-[var(--ink)]" />
                  </span>
                </p>
              )}
              {(s.summary || s.error) && (
                <p className={`mt-1.5 text-sm leading-relaxed ${s.error ? "text-rose-800" : "text-stone-700"}`}>{s.error ?? s.summary}</p>
              )}
            </Card>
          </li>
        );
      })}
    </ol>
  );
}

function EvidenceTable({ items }: { items: Evidence[] }) {
  if (!items.length) return <p className="text-sm text-stone-600">Vera hasn&apos;t checked any official page yet.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600">
        A fact counts as confirmed only when the quoted sentence really appears on an official page — code checks this, not the agent.
      </p>
      <ul className="space-y-3">
        {items.map((e) => {
          const ok = e.quoteMatched && e.officialUrl;
          return (
            <li key={e.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <AgentAvatar k={e.checkedBy} size="sm" />
                    <p className="min-w-0 font-bold text-stone-900">{e.claim}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusChip s={e.status} />
                    <span className={`inline-flex items-center gap-1 text-xs font-bold ${ok ? "text-emerald-800" : "text-stone-500"}`}>
                      {ok ? <CheckCircle size={14} weight="bold" aria-hidden="true" /> : <XCircle size={14} weight="bold" aria-hidden="true" />}
                      {ok ? "Quote found on page" : "No matching quote"}
                    </span>
                  </div>
                </div>
                {(e.liveValue || e.quote) && (
                  <div className="mt-3 space-y-2 border-s-2 border-[var(--line)] ps-3 text-sm">
                    {e.liveValue && (
                      <p>
                        <span className="text-stone-500">Value: </span>
                        <span className="font-bold text-stone-900">{e.liveValue}</span>
                        {e.academicYear && <span className="text-stone-500"> · {e.academicYear}</span>}
                      </p>
                    )}
                    {e.quote && <blockquote className="font-serif text-[15px] italic text-stone-700">“{e.quote}”</blockquote>}
                  </div>
                )}
                {e.url && (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex max-w-full cursor-pointer items-center gap-1 text-sm font-bold text-[var(--brand)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
                  >
                    <ArrowSquareOut size={14} weight="bold" aria-hidden="true" />
                    <span className="truncate">{new URL(e.url).hostname}</span>
                  </a>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DirectorRounds({ decisions }: { decisions: Decision[] }) {
  if (!decisions.length) return <p className="text-sm text-stone-600">Leonardo hasn&apos;t reviewed this report yet.</p>;
  return (
    <div className="space-y-4">
      {decisions.map((m) => (
        <Card key={m.round} className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 bg-[var(--sky)] px-5 py-4 text-stone-900">
            <div className="flex items-center gap-3">
              <AgentAvatar k="manager" size="sm" />
              <div>
                <p className="font-serif text-lg font-semibold leading-tight">Round {m.round}</p>
                <p className="text-xs text-stone-600">Leonardo · The Director</p>
              </div>
            </div>
            <StatusChip s={m.verdict} />
          </div>
          <div className="p-5">
            {m.blockReason && <p className="mb-3 text-sm font-bold text-rose-800">{m.blockReason}</p>}
            {m.reworkOrders.length === 0 ? (
              <p className="text-sm text-stone-700">No orders — the report is ready.</p>
            ) : (
              <ul className="space-y-3">
                {m.reworkOrders.map((o, i) => {
                  const p = persona(o.agent);
                  return (
                    <li key={i} className="flex gap-3">
                      <AgentAvatar k={o.agent} size="sm" />
                      <div className="min-w-0 text-sm">
                        <p className="font-bold text-stone-900">
                          To {p.name} ({p.title.replace("The ", "").toLowerCase()}) — {o.target}
                        </p>
                        <p className="mt-0.5 leading-relaxed text-stone-700">{o.instruction}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function RunSkeleton() {
  return (
    <div className="space-y-4 motion-safe:animate-pulse" aria-label="Loading run">
      <div className="h-40 rounded-2xl bg-stone-200/60" />
      <div className="h-10 rounded-xl bg-stone-200/60" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 rounded-2xl bg-stone-200/60" />
      ))}
    </div>
  );
}

