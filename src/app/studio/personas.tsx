"use client";
// The team. Each agent gets a character that matches its job, so a run reads like a story:
// Livia files the documents, Marco explores the regions, Vera checks every fact, Leonardo signs off.
// Names mix Italian and Persian on purpose — the office is the bridge between the two.
import {
  Calculator,
  ChartLineUp,
  Compass,
  Crown,
  FileArrowDown,
  Fingerprint,
  FlowArrow,
  FolderOpen,
  Gavel,
  GraduationCap,
  Lightbulb,
  PenNib,
  Stethoscope,
  Translate,
  type Icon,
} from "@phosphor-icons/react";

export interface Persona {
  key: string;
  name: string;
  title: string;
  motto: string;
  job: string;
  Icon: Icon;
  /** avatar colours: soft background, strong foreground (≥4.5:1 on that background), ring */
  tone: { bg: string; fg: string; ring: string };
  /** text colour for the name on white cards */
  ink: string;
  isAgent: boolean;
}

const P = (p: Persona) => p;

export const PERSONAS: Record<string, Persona> = {
  intake: P({
    key: "intake",
    name: "Livia",
    title: "The Archivist",
    motto: "Every page read, nothing private kept.",
    job: "Reads the resume and Obsidian note, extracts the profile and strips national ID and phone numbers.",
    Icon: FolderOpen,
    tone: { bg: "bg-[#e8f1ff]", fg: "text-[#08304c]", ring: "ring-[#08304c]/25" },
    ink: "text-[#084e72]",
    isAgent: true,
  }),
  assessor: P({
    key: "assessor",
    name: "Dario",
    title: "The Counsellor",
    motto: "Honest about strengths, honest about gaps.",
    job: "Assesses the profile: eligible degree levels, strengths, weaknesses with fixes, and what to search for.",
    Icon: Stethoscope,
    tone: { bg: "bg-[#d7ffe2]", fg: "text-[#08304c]", ring: "ring-[#08304c]/25" },
    ink: "text-[#084e72]",
    isAgent: true,
  }),
  scout: P({
    key: "scout",
    name: "Marco",
    title: "The Explorer",
    motto: "Twenty regions, one map.",
    job: "Searches the regional reports (RAG) and proposes candidate universities and programmes, citing each source.",
    Icon: Compass,
    tone: { bg: "bg-[#ffebd6]", fg: "text-[#08304c]", ring: "ring-[#08304c]/25" },
    ink: "text-[#084e72]",
    isAgent: true,
  }),
  analyst: P({
    key: "analyst",
    name: "Enzo",
    title: "The Strategist",
    motto: "Chances are numbers, not hopes.",
    job: "Classifies the admission factors for each programme; the score itself is computed by code from a transparent rubric.",
    Icon: ChartLineUp,
    tone: { bg: "bg-[#e8f1ff]", fg: "text-[#08304c]", ring: "ring-[#08304c]/25" },
    ink: "text-[#084e72]",
    isAgent: true,
  }),
  scholarship: P({
    key: "scholarship",
    name: "Lucia",
    title: "The Patron",
    motto: "Find the money before the deadline finds you.",
    job: "Plans the regional DSU scholarship step by step: ISEE Parificato, legalised family documents, deadlines and risks.",
    Icon: GraduationCap,
    tone: { bg: "bg-[#ffebd6]", fg: "text-[#08304c]", ring: "ring-[#08304c]/25" },
    ink: "text-[#084e72]",
    isAgent: true,
  }),
  cost: P({
    key: "cost",
    name: "Paolo",
    title: "The Treasurer",
    motto: "Two ledgers, never mixed.",
    job: "Lists what the client pays third parties (toman and euro) and prices our fee — always as two separate blocks.",
    Icon: Calculator,
    tone: { bg: "bg-[#d7ffe2]", fg: "text-[#08304c]", ring: "ring-[#08304c]/25" },
    ink: "text-[#084e72]",
    isAgent: true,
  }),
  verifier: P({
    key: "verifier",
    name: "Vera",
    title: "The Detective",
    motto: "If it isn't on the official page, it isn't a fact.",
    job: "Opens official university, DSU and embassy pages and copies the exact sentence that proves each fact.",
    Icon: Fingerprint,
    tone: { bg: "bg-[#e8f1ff]", fg: "text-[#08304c]", ring: "ring-[#08304c]/25" },
    ink: "text-[#084e72]",
    isAgent: true,
  }),
  writer: P({
    key: "writer",
    name: "Dante",
    title: "The Author",
    motto: "Clear steps, plain words, every claim cited.",
    job: "Writes the client report around the code-computed tables and rewrites it from the director's notes.",
    Icon: PenNib,
    tone: { bg: "bg-[#ffebd6]", fg: "text-[#08304c]", ring: "ring-[#08304c]/25" },
    ink: "text-[#084e72]",
    isAgent: true,
  }),
  manager: P({
    key: "manager",
    name: "Leonardo",
    title: "The Director",
    motto: "Trusts no one. Checks everything. Signs last.",
    job: "Re-checks the top universities on official sites, audits every claim, then approves or sends specific agents back to work.",
    Icon: Crown,
    tone: { bg: "bg-[#08304c]", fg: "text-white", ring: "ring-[#08304c]" },
    ink: "text-[#08304c]",
    isAgent: true,
  }),
  translator: P({
    key: "translator",
    name: "Hafez",
    title: "The Interpreter",
    motto: "Every line, in formal Persian.",
    job: "Translates the approved report completely; code checks sections, numbers and Latin proper nouns.",
    Icon: Translate,
    tone: { bg: "bg-[#d7ffe2]", fg: "text-[#08304c]", ring: "ring-[#08304c]/25" },
    ink: "text-[#084e72]",
    isAgent: true,
  }),
  critic: P({
    key: "critic",
    name: "Galileo",
    title: "The Mentor",
    motto: "Every mistake becomes a lesson.",
    job: "Reviews each run and writes up to three lessons for specific agents — the system's memory.",
    Icon: Lightbulb,
    tone: { bg: "bg-[#ffebd6]", fg: "text-[#08304c]", ring: "ring-[#08304c]/25" },
    ink: "text-[#084e72]",
    isAgent: true,
  }),
  // Steps done by plain code, not by an agent
  rules: P({
    key: "rules",
    name: "Rulebook",
    title: "Code",
    motto: "Computed, not guessed.",
    job: "Deterministic rules: GPA conversion, chance score, shortlist, ISEE, deadlines, costs, approval gate.",
    Icon: Gavel,
    tone: { bg: "bg-[#eeeeee]", fg: "text-[#353535]", ring: "ring-[#353535]/20" },
    ink: "text-stone-500",
    isAgent: false,
  }),
  orchestrator: P({
    key: "orchestrator",
    name: "Conductor",
    title: "Code",
    motto: "Order, limits, hand-offs.",
    job: "Runs the agents in order and carries out the Director's rework orders within hard limits.",
    Icon: FlowArrow,
    tone: { bg: "bg-[#eeeeee]", fg: "text-[#353535]", ring: "ring-[#353535]/20" },
    ink: "text-stone-500",
    isAgent: false,
  }),
  export: P({
    key: "export",
    name: "Export",
    title: "Code",
    motto: "Saved to the client's folder.",
    job: "Writes the bilingual .md and .docx report into immigration files/clients.",
    Icon: FileArrowDown,
    tone: { bg: "bg-[#eeeeee]", fg: "text-[#353535]", ring: "ring-[#353535]/20" },
    ink: "text-stone-500",
    isAgent: false,
  }),
};

export const AGENT_ORDER = ["intake", "assessor", "scout", "analyst", "scholarship", "cost", "verifier", "writer", "manager", "translator", "critic"];

export const persona = (key: string): Persona => PERSONAS[key] ?? PERSONAS.orchestrator;

/**
 * `pulse` = the agent is working right now: its icon plays its own animation (see globals.css) and a ring
 * ripples out. The same animation plays when you hover the avatar or any `.agent-hover` card around it.
 */
export function AgentAvatar({ k, size = "md", pulse = false }: { k: string; size?: "sm" | "md" | "lg"; pulse?: boolean }) {
  const p = persona(k);
  const dims = { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-14 w-14" }[size];
  const icon = { sm: 16, md: 20, lg: 28 }[size];
  return (
    <span
      className={`agent-avatar relative inline-flex shrink-0 items-center justify-center rounded-full ring-1 ${dims} ${p.tone.bg} ${p.tone.fg} ${p.tone.ring}`}
      data-agent={persona(k).key}
      data-active={pulse}
      aria-hidden="true"
    >
      <span className="agent-ring" />
      <span className="agent-icon">
        <p.Icon size={icon} weight="duotone" />
      </span>
      <span className="agent-scan" />
    </span>
  );
}
