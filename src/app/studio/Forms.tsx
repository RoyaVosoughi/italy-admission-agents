"use client";
import { useCallback, useEffect, useState } from "react";
import { Info, PaperPlaneTilt, UploadSimple } from "@phosphor-icons/react";
import { AGENT_ORDER, AgentAvatar, PERSONAS } from "./personas";
import { Card, btnPrimary, field } from "./ui";
import { HeroCollage } from "./universities";

export function NewRun({ onStarted }: { onStarted: (id: string, reused: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/runs", { method: "POST", body: new FormData(e.currentTarget) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error);
    onStarted(json.id, !!json.reused);
  }

  return (
    <div className="space-y-12">
      <section className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]" aria-labelledby="hero-title">
        <div>
          <p className="eyebrow text-stone-600">New assessment</p>
          <h2 id="hero-title" className="display mt-4 text-5xl sm:text-6xl lg:text-7xl">
            The right Italian university, <span className="rainbow-word">verified.</span>
          </h2>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-700">
            Hand the team a client&apos;s resume. Eleven agents find the programmes, rate the chances, plan the scholarship and check every date on the
            official websites — then the Director signs off. You only step in if a key fact is missing.
          </p>
        </div>
        <HeroCollage />
      </section>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="p-6 sm:p-8">
        <h2 className="font-serif text-2xl font-semibold text-stone-900">Start with the documents</h2>
        <p className="mt-1 text-stone-700">Files stay on this computer; only a profile without ID numbers or contact details is sent to the model.</p>
        <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
          <label className="block text-sm font-bold text-stone-800">
            Client folder name <span className="text-rose-700">*</span>
            <input name="clientFolder" required placeholder="e.g. sara-mohammadi" className={field} aria-describedby="folder-help" />
            <span id="folder-help" className="mt-1 block text-sm font-normal text-stone-600">
              The approved report is saved to <span className="font-mono">immigration files/clients/&lt;name&gt;/</span>
            </span>
          </label>

          <div>
            <label htmlFor="files" className="block text-sm font-bold text-stone-800">
              Resume and intake note <span className="text-rose-700">*</span>
            </label>
            <label
              htmlFor="files"
              className="mt-1.5 flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-stone-300 bg-[var(--sky)] p-4 text-center transition-colors duration-200 hover:border-[var(--brand)] focus-within:border-[var(--brand)]"
            >
              <UploadSimple size={26} weight="duotone" className="text-[var(--brand)]" aria-hidden="true" />
              <span className="text-sm font-bold text-stone-800">{files.length ? files.join(", ") : "Choose files"}</span>
              <span className="text-xs text-stone-600">PDF, DOCX, MD (Obsidian note) or TXT · files stay on this computer</span>
              <input
                id="files"
                name="files"
                type="file"
                multiple
                required
                accept=".pdf,.docx,.md,.txt"
                className="sr-only"
                onChange={(e) => setFiles([...(e.target.files ?? [])].map((f) => f.name))}
              />
            </label>
          </div>

          <label className="block text-sm font-bold text-stone-800">
            Notes <span className="font-normal text-stone-500">(optional)</span>
            <textarea name="notes" rows={3} placeholder="Budget, preferred cities, anything not in the documents" className={field} />
          </label>

          <label className="block text-sm font-bold text-stone-800">
            Today&apos;s free-market rate, toman per euro <span className="font-normal text-stone-500">(optional)</span>
            <input name="rate" type="number" inputMode="numeric" min={1} placeholder="e.g. 110000" className={field} aria-describedby="rate-help" />
            <span id="rate-help" className="mt-1 block text-sm font-normal text-stone-600">
              Lucia needs it to estimate the family&apos;s ISEE for the scholarship check.
            </span>
          </label>

          {error && (
            <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-800 ring-1 ring-rose-200">
              {error}
            </p>
          )}
          <button disabled={busy} className={btnPrimary}>
            <PaperPlaneTilt size={18} weight="bold" aria-hidden="true" />
            {busy ? "Handing over to the team…" : "Start assessment"}
          </button>
        </form>
      </Card>

      <Card className="h-fit p-6">
        <h3 className="flex items-center gap-2 font-serif text-lg font-semibold text-stone-900">
          <Info size={20} weight="duotone" className="text-[var(--brand)]" aria-hidden="true" />
          Who does what
        </h3>
        <ol className="mt-3 space-y-2.5">
          {AGENT_ORDER.map((k) => (
            <li key={k} className="agent-hover flex items-center gap-3 rounded-2xl p-1 text-sm transition-colors hover:bg-[var(--sky)]">
              <AgentAvatar k={k} size="sm" />
              <span className="min-w-0">
                <span className="font-bold text-stone-900">{PERSONAS[k].name}</span>{" "}
                <span className="text-stone-600">— {PERSONAS[k].motto}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs leading-relaxed text-stone-600">A full assessment takes about 15–30 minutes on the free models (around 10 per day).</p>
      </Card>
    </div>
    </div>
  );
}

type Outcome = { id: string; clientId: string; university: string; program: string; predictedTier: string | null; result: string; scholarshipResult: string | null };

export function Outcomes() {
  const [items, setItems] = useState<Outcome[]>([]);
  const load = useCallback(async () => setItems(await (await fetch("/api/outcomes")).json()), []);
  useEffect(() => void load(), [load]);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    await fetch("/api/outcomes", {
      method: "POST",
      body: JSON.stringify({ ...f, predictedTier: f.predictedTier || null, predictedScore: null, scholarshipResult: f.scholarshipResult || null }),
    });
    form.reset();
    load();
  }

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h2 className="display text-4xl sm:text-5xl">Real <span className="rainbow-word">outcomes</span></h2>
        <p className="mt-1 flex items-start gap-2 text-stone-700">
          <AgentAvatar k="analyst" size="sm" />
          <span>
            Record what really happened. When a result contradicts the prediction, Enzo, the Strategist, gets a lesson — this is how the chance
            estimates become calibrated over time.
          </span>
        </p>
      </div>

      <Card className="p-5">
        <form onSubmit={add} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block text-sm font-bold text-stone-800">
            Client folder *
            <input name="clientId" required className={field} />
          </label>
          <label className="block text-sm font-bold text-stone-800">
            University *
            <input name="university" required className={field} />
          </label>
          <label className="block text-sm font-bold text-stone-800">
            Programme
            <input name="program" className={field} />
          </label>
          <label className="block text-sm font-bold text-stone-800">
            Predicted chance
            <select name="predictedTier" className={field}>
              <option value="">—</option>
              {["High", "Medium", "Reach", "Unlikely"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-stone-800">
            Result *
            <select name="result" required className={field}>
              {["admitted", "rejected", "waitlisted", "withdrew"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-stone-800">
            Scholarship
            <select name="scholarshipResult" className={field}>
              <option value="">—</option>
              {["awarded", "not_awarded", "not_applied"].map((t) => (
                <option key={t} value={t}>
                  {t.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-stone-800 sm:col-span-2">
            Notes
            <input name="notes" placeholder="Reason given by the university, etc." className={field} />
          </label>
          <div className="flex items-end">
            <button className={`${btnPrimary} w-full`}>Record outcome</button>
          </div>
        </form>
      </Card>

      {items.length === 0 ? (
        <p className="text-sm text-stone-600">No outcomes recorded yet.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-[var(--sky)] text-xs uppercase tracking-wide text-stone-700">
              <tr>
                {["Client", "University", "Predicted", "Result", "Scholarship"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} className="border-t border-[var(--line)]">
                  <td className="px-4 py-3 font-bold">{o.clientId}</td>
                  <td className="px-4 py-3">
                    {o.university} <span className="text-stone-500">{o.program}</span>
                  </td>
                  <td className="px-4 py-3">{o.predictedTier ?? "—"}</td>
                  <td className="px-4 py-3 capitalize">{o.result}</td>
                  <td className="px-4 py-3">{o.scholarshipResult?.replace("_", " ") ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
