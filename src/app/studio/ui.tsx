"use client";
// Small shared pieces. Status is always icon + text, never colour alone (WCAG 1.4.1).
import { CheckCircle, CircleNotch, MinusCircle, Prohibit, Question, SealCheck, XCircle, type Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

const STATUS: Record<string, { label: string; cls: string; Icon: Icon; spin?: boolean }> = {
  running: { label: "Running", cls: "bg-sky-50 text-sky-800 ring-sky-200", Icon: CircleNotch, spin: true },
  done: { label: "Done", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", Icon: CheckCircle },
  approved: { label: "Approved", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", Icon: SealCheck },
  error: { label: "Error", cls: "bg-rose-50 text-rose-800 ring-rose-200", Icon: XCircle },
  blocked: { label: "Blocked", cls: "bg-amber-50 text-amber-900 ring-amber-200", Icon: Prohibit },
  needs_input: { label: "Needs input", cls: "bg-violet-50 text-violet-800 ring-violet-200", Icon: Question },
  skipped: { label: "Skipped", cls: "bg-stone-100 text-stone-700 ring-stone-200", Icon: MinusCircle },
  verified: { label: "Verified", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", Icon: CheckCircle },
  changed: { label: "Changed", cls: "bg-sky-50 text-sky-800 ring-sky-200", Icon: CheckCircle },
  not_found: { label: "Not found", cls: "bg-stone-100 text-stone-700 ring-stone-200", Icon: MinusCircle },
  conflict: { label: "Conflict", cls: "bg-amber-50 text-amber-900 ring-amber-200", Icon: Prohibit },
  approve: { label: "Approve", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", Icon: SealCheck },
  rework: { label: "Rework", cls: "bg-amber-50 text-amber-900 ring-amber-200", Icon: CircleNotch },
  block: { label: "Block", cls: "bg-rose-50 text-rose-800 ring-rose-200", Icon: Prohibit },
};

export function StatusChip({ s }: { s: string }) {
  const st = STATUS[s] ?? { label: s, cls: "bg-stone-100 text-stone-700 ring-stone-200", Icon: MinusCircle };
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${st.cls}`}>
      <st.Icon size={14} weight="bold" className={st.spin ? "motion-safe:animate-spin" : ""} aria-hidden="true" />
      {st.label}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl bg-white shadow-[var(--shadow-card)] ${className}`}>{children}</div>;
}

export function Stat({ label, value, hint, Icon: I }: { label: string; value: ReactNode; hint?: string; Icon: Icon }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-[var(--sky)] p-3">
      <I size={22} weight="duotone" className="mt-0.5 text-[var(--brand)]" aria-hidden="true" />
      <div className="min-w-0">
        <div className="font-serif text-2xl font-semibold tabular-nums text-stone-900">{value}</div>
        <div className="text-xs text-stone-600">{label}</div>
        {hint && <div className="text-[11px] text-stone-500">{hint}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: ReactNode; disabled?: boolean }[];
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-[var(--line)]">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          disabled={it.disabled}
          onClick={() => onChange(it.value)}
          className={`-mb-px inline-flex min-h-11 cursor-pointer items-center gap-1.5 border-b-2 px-3 text-sm font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-40 ${
            value === it.value ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-stone-600 hover:text-stone-900"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** The rainbow-outlined pill: the single primary action of a view (see .btn-rainbow in globals.css). */
export const btnPrimary = "btn-rainbow";

export const field =
  "mt-1.5 block w-full min-h-11 rounded-2xl border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 placeholder:text-stone-400 transition-colors duration-200 focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20";

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function duration(a: string, b?: string): string | null {
  if (!b) return null;
  const s = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
