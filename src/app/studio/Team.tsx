"use client";
// The team page: eleven characters, each with what they have learned so far.
// Lessons are injected into that agent's instructions before every run (max 8 active).
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash } from "@phosphor-icons/react";
import { AGENT_ORDER, AgentAvatar, PERSONAS } from "./personas";
import { Card, btnPrimary, field } from "./ui";

type Lesson = { id: string; agent: string; lesson: string; source: string; active: boolean; createdAt: string };

const SOURCE: Record<string, string> = { critic: "from Galileo", manager: "from Leonardo", human: "from you", outcome: "from a real result" };

export function Team() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const load = useCallback(async () => setLessons(await (await fetch("/api/lessons")).json()), []);
  useEffect(() => void load(), [load]);

  async function remove(l: Lesson) {
    if (!confirm(`Delete this lesson for ${PERSONAS[l.agent]?.name ?? l.agent}?\n\n“${l.lesson}”`)) return;
    await fetch(`/api/lessons?id=${l.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h2 className="display text-4xl sm:text-5xl">The <span className="rainbow-word">team</span></h2>
        <p className="mt-1 text-stone-700">
          Eleven specialists, each with one job. Code decides the order and the rules; Leonardo, the Director, approves.
          What each agent has learned is shown on its card and used in every new run.
        </p>
      </div>

      <AddLesson onAdded={load} />

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {AGENT_ORDER.map((k) => {
          const p = PERSONAS[k];
          const mine = lessons.filter((l) => l.agent === k);
          const active = mine.filter((l) => l.active);
          return (
            <li key={k}>
              <Card className={`agent-hover flex h-full flex-col p-6 transition-transform duration-300 hover:-translate-y-1 ${k === "manager" ? "shadow-[0_0_0_1.5px_var(--ink),var(--shadow-float)]" : ""}`}>
                <div className="flex items-start gap-4">
                  <AgentAvatar k={k} size="lg" />
                  <div className="min-w-0">
                    <h3 className="font-serif text-xl font-semibold leading-tight text-stone-900">{p.name}</h3>
                    <p className={`text-sm font-bold ${p.ink}`}>{p.title}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-stone-500">{k}</p>
                  </div>
                </div>
                <p className="mt-4 font-serif text-[17px] font-medium italic leading-snug tracking-normal text-stone-900">“{p.motto}”</p>
                <p className="mt-2 text-sm leading-relaxed text-stone-700">{p.job}</p>

                <div className="mt-4 border-t border-[var(--line)] pt-3">
                  <p className="eyebrow text-stone-500">
                    Lessons learned · {active.length}/8 active
                  </p>
                  {mine.length === 0 ? (
                    <p className="mt-1.5 text-sm text-stone-500">Nothing yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {mine.map((l) => (
                        <li key={l.id} className={`flex items-start gap-2 text-sm ${l.active ? "" : "opacity-50"}`}>
                          <div className="min-w-0 flex-1">
                            <p className="leading-relaxed text-stone-800">{l.lesson}</p>
                            <p className="text-xs text-stone-500">
                              {SOURCE[l.source] ?? l.source} · {new Date(l.createdAt).toLocaleDateString()}
                              {l.active ? "" : " · retired"}
                            </p>
                          </div>
                          <button
                            onClick={() => remove(l)}
                            aria-label={`Delete lesson: ${l.lesson.slice(0, 60)}`}
                            className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-stone-500 transition-colors duration-200 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-2 focus-visible:outline-rose-600"
                          >
                            <Trash size={18} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AddLesson({ onAdded }: { onAdded: () => void }) {
  const [busy, setBusy] = useState(false);
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    await fetch("/api/lessons", { method: "POST", body: JSON.stringify({ agent: f.get("agent"), lesson: f.get("lesson") }) });
    setBusy(false);
    form.reset();
    onAdded();
  }
  return (
    <Card className="p-4">
      <form onSubmit={add} className="grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-end">
        <label className="block text-sm font-bold text-stone-800">
          Teach
          <select name="agent" className={field}>
            {AGENT_ORDER.map((k) => (
              <option key={k} value={k}>
                {PERSONAS[k].name} · {PERSONAS[k].title}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-bold text-stone-800">
          Lesson
          <input name="lesson" required placeholder="e.g. Always mention the CIMEA fee when the degree is from Iran" className={field} />
        </label>
        <button disabled={busy} className={btnPrimary}>
          <Plus size={18} weight="bold" aria-hidden="true" />
          {busy ? "Adding…" : "Add lesson"}
        </button>
      </form>
    </Card>
  );
}
