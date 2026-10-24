// Store interface (Adapter pattern): the orchestrator and agents only see this, so the
// local JSON-file store can later be swapped for SQLite/Supabase without touching them.
import type { AgentName } from "../ai";
import type { Evidence, ManagerDecision } from "../agents/types";

export type RunStatus = "running" | "needs_input" | "approved" | "blocked" | "error";

export interface Step {
  id: string;
  agent: AgentName | "rules" | "retrieval" | "orchestrator" | "export";
  label: string;
  status: "running" | "done" | "error" | "skipped";
  startedAt: string;
  finishedAt?: string;
  summary?: string;
  output?: unknown;
  error?: string;
}

export interface Run {
  id: string;
  clientId: string;
  status: RunStatus;
  inputs: { documents: string[]; notes?: string; today: string };
  steps: Step[];
  managerRounds: number;
  reportId?: string;
  error?: string;
  needsInput?: string[];
  usage: { llmCalls: number; inputTokens: number; outputTokens: number; tavilyCalls: number };
  createdAt: string;
  finishedAt?: string;
}

export interface Report {
  id: string;
  runId: string;
  clientId: string;
  contentEn: string;
  contentFa?: string;
  files: string[];
  writingScore: number;
  status: "approved" | "blocked";
  createdAt: string;
}

export interface EvidenceRecord extends Evidence {
  id: string;
  runId: string;
  quoteMatched: boolean;
  officialUrl: boolean;
  pageHash: string | null;
  checkedBy: "verifier" | "manager";
  fetchedAt: string | null;
  note?: string;
}

export interface ManagerDecisionRecord extends ManagerDecision {
  id: string;
  runId: string;
  round: number;
  createdAt: string;
}

export interface Lesson {
  id: string;
  agent: AgentName;
  lesson: string;
  source: "critic" | "manager" | "human" | "outcome";
  active: boolean;
  createdAt: string;
}

export interface Outcome {
  id: string;
  clientId: string;
  university: string;
  program: string;
  predictedTier: string | null;
  predictedScore: number | null;
  result: "admitted" | "rejected" | "waitlisted" | "withdrew";
  scholarshipResult: "awarded" | "not_awarded" | "not_applied" | null;
  notes: string;
  recordedAt: string;
}

export interface Store {
  createRun(run: Omit<Run, "id" | "createdAt" | "steps" | "managerRounds" | "usage">): Promise<Run>;
  getRun(id: string): Promise<Run | null>;
  listRuns(): Promise<Run[]>;
  updateRun(id: string, patch: Partial<Run>): Promise<Run>;
  upsertStep(runId: string, step: Step): Promise<void>;

  saveReport(report: Omit<Report, "id" | "createdAt">): Promise<Report>;
  getReport(id: string): Promise<Report | null>;

  addEvidence(items: Omit<EvidenceRecord, "id">[]): Promise<void>;
  listEvidence(runId: string): Promise<EvidenceRecord[]>;
  addManagerDecision(d: Omit<ManagerDecisionRecord, "id" | "createdAt">): Promise<void>;
  listManagerDecisions(runId: string): Promise<ManagerDecisionRecord[]>;

  listLessons(agent?: AgentName, activeOnly?: boolean): Promise<Lesson[]>;
  addLesson(l: Omit<Lesson, "id" | "createdAt" | "active">): Promise<Lesson>;
  deleteLesson(id: string): Promise<void>;

  addOutcome(o: Omit<Outcome, "id" | "recordedAt">): Promise<Outcome>;
  listOutcomes(): Promise<Outcome[]>;
}

/** Max active lessons per agent — oldest retire first (keeps prompts short and lessons fresh). */
export const MAX_ACTIVE_LESSONS = 8;
