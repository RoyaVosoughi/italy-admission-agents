"use client";
// Studio — a monitoring screen, not an approval screen: Leonardo, the Director agent, approves.
// Start an assessment, follow the team live, read the report with its evidence, see what each
// agent has learned, and record real outcomes.
import { useCallback, useEffect, useState } from "react";
import { ChartBar, ListChecks, PlusCircle, UsersThree, type Icon } from "@phosphor-icons/react";
import { AgentAvatar, persona } from "./personas";
import { NewRun, Outcomes } from "./Forms";
import { RunView } from "./RunView";
import { Team } from "./Team";
import { StatusChip, timeAgo } from "./ui";

type RunRow = { id: string; clientId: string; status: string; createdAt: string; lastStep?: string; error?: string; stepCount: number };
type Tab = "runs" | "new" | "team" | "outcomes";

const NAV: { value: Tab; label: string; Icon: Icon }[] = [
  { value: "runs", label: "Assessments", Icon: ListChecks },
  { value: "new", label: "New assessment", Icon: PlusCircle },
  { value: "team", label: "Team", Icon: UsersThree },
  { value: "outcomes", label: "Outcomes", Icon: ChartBar },
];

export default function Studio() {
  const [tab, setTab] = useState<Tab>("runs");
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Deep links: ?tab=team · ?run=<id>&view=director — and the URL follows what you open.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get("tab") as Tab | null;
    if (t && NAV.some((n) => n.value === t)) setTab(t);
    if (q.get("run")) setSelected(q.get("run"));
  }, []);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    q.set("tab", tab);
    if (tab === "runs" && selected) q.set("run", selected);
    else q.delete("run");
    if (tab !== "runs") q.delete("view");
    window.history.replaceState(null, "", `?${q}`);
  }, [tab, selected]);

  const loadRuns = useCallback(async () => {
    const rows = (await (await fetch("/api/runs")).json()) as RunRow[];
    setRuns(rows);
    setSelected((cur) => cur ?? rows[0]?.id ?? null);
  }, []);
  useEffect(() => {
    loadRuns();
    const t = setInterval(loadRuns, 5000);
    return () => clearInterval(t);
  }, [loadRuns]);

  return (
    <div className="min-h-dvh bg-white text-stone-900">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:font-bold">
        Skip to content
      </a>
      <header className="sticky top-3 z-40 px-4 pt-3 sm:px-6">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[28px] bg-white px-4 py-2 shadow-[var(--shadow-card)] sm:px-5">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: "var(--rainbow)" }} />
            <h1 className="font-serif text-lg font-semibold leading-tight tracking-tight text-stone-900">Italy Admission Studio</h1>
            <div className="-space-x-2 max-md:hidden flex" aria-hidden="true">
              {["scout", "verifier", "manager"].map((k) => (
                <AgentAvatar key={k} k={k} size="sm" />
              ))}
            </div>
          </div>
          <p className="eyebrow rounded-full bg-[var(--sky)] px-3 py-1.5 text-stone-800 max-xl:hidden">Eleven agents · every fact checked on official sites</p>
          <nav aria-label="Main" className="flex flex-wrap gap-1">
            {NAV.map((n) => (
              <button
                key={n.value}
                onClick={() => setTab(n.value)}
                aria-current={tab === n.value ? "page" : undefined}
                className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3.5 text-sm font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
                  tab === n.value ? "bg-[var(--sky)] text-stone-900" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                }`}
              >
                <n.Icon size={18} weight={tab === n.value ? "fill" : "regular"} aria-hidden="true" />
                {n.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 sm:py-12">
        {tab === "new" && (
          <NewRun
            onStarted={(id) => {
              setSelected(id);
              setTab("runs");
              loadRuns();
            }}
          />
        )}
        {tab === "team" && <Team />}
        {tab === "outcomes" && <Outcomes />}
        {tab === "runs" && (
          <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
            <aside aria-label="Assessments">
              <h2 className="eyebrow mb-3 text-stone-500">Assessments</h2>
              {runs === null ? (
                <div className="space-y-2 motion-safe:animate-pulse">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-20 rounded-3xl bg-stone-100" />
                  ))}
                </div>
              ) : runs.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-stone-300 p-5 text-sm text-stone-600">
                  No assessments yet.{" "}
                  <button onClick={() => setTab("new")} className="cursor-pointer font-bold text-[var(--brand)] underline-offset-2 hover:underline">
                    Start the first one
                  </button>
                </div>
              ) : (
                <ul className="space-y-2">
                  {runs.map((r, i) => (
                    // On phones only the 4 most recent are shown, so the selected report stays near the top.
                    <li key={r.id} className={!showAll && i >= 4 && r.id !== selected ? "max-lg:hidden" : ""}>
                      <button
                        onClick={() => setSelected(r.id)}
                        aria-current={selected === r.id ? "true" : undefined}
                        className={`agent-hover w-full cursor-pointer rounded-3xl bg-white p-4 text-left transition-shadow duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
                          selected === r.id ? "shadow-[0_0_0_1.5px_var(--ink),var(--shadow-float)]" : "shadow-[var(--shadow-card)] hover:shadow-[0_0_0_1px_var(--fog,#c7c7c7),var(--shadow-float)]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-bold text-stone-900">{r.clientId}</span>
                          <StatusChip s={r.status} />
                        </div>
                        <div className="mt-1 text-xs text-stone-600">{timeAgo(r.createdAt)}</div>
                        {r.status === "running" && r.lastStep && <CurrentStep label={r.lastStep} />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {runs && runs.length > 4 && (
                <button
                  onClick={() => setShowAll((v) => !v)}
                  aria-expanded={showAll}
                  className="mt-2 min-h-11 w-full cursor-pointer rounded-xl text-sm font-bold text-[var(--brand)] hover:bg-white focus-visible:outline-2 focus-visible:outline-[var(--brand)] lg:hidden"
                >
                  {showAll ? "Show fewer" : `Show all ${runs.length} assessments`}
                </button>
              )}
            </aside>
            <section aria-label="Assessment detail" className="min-w-0">
              {selected ? <RunView id={selected} /> : <p className="text-sm text-stone-600">Select an assessment.</p>}
            </section>
          </div>
        )}
      </main>
      <footer className="mx-auto max-w-[1200px] px-4 pb-10 text-xs text-stone-500 sm:px-6">
        University photos: Wikimedia Commons, CC BY-SA or public domain —{" "}
        <a href="/universities/credits.json" className="underline underline-offset-2 hover:text-stone-800">
          photographer credits
        </a>
      </footer>
    </div>
  );
}

/** Which character is working right now (guessed from the step label). */
function CurrentStep({ label }: { label: string }) {
  const k =
    [
      ["Extract", "intake"],
      ["Assess", "assessor"],
      ["Find candidate", "scout"],
      ["Rate", "analyst"],
      ["scholarship", "scholarship"],
      ["Verify", "verifier"],
      ["Write", "writer"],
      ["Rewrite", "writer"],
      ["Manager", "manager"],
      ["Translate", "translator"],
      ["lessons", "critic"],
    ].find(([needle]) => label.includes(needle))?.[1] ?? "orchestrator";
  const p = persona(k);
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-stone-800">
      <AgentAvatar k={k} size="sm" pulse />
      <span className="min-w-0 truncate">
        <span className="font-bold">{p.name}</span> — {label}
      </span>
    </div>
  );
}
