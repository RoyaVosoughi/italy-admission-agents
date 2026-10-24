// Local-first store: one JSON file per collection in data/store/. No database to install;
// fine for one office's volume. Writes are serialised per collection and written via a
// temp file + rename so a crash never leaves a half-written file.
import { mkdirSync, readFileSync, existsSync, writeFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentName } from "../ai";
import {
  MAX_ACTIVE_LESSONS,
  type EvidenceRecord,
  type Lesson,
  type ManagerDecisionRecord,
  type Outcome,
  type Report,
  type Run,
  type Step,
  type Store,
} from "./types";

type Collections = {
  runs: Run[];
  reports: Report[];
  evidence: EvidenceRecord[];
  decisions: ManagerDecisionRecord[];
  lessons: Lesson[];
  outcomes: Outcome[];
};

const now = () => new Date().toISOString();

export class FileStore implements Store {
  private cache = new Map<keyof Collections, unknown[]>();
  private queue = Promise.resolve();

  constructor(private dir = "data/store") {
    mkdirSync(dir, { recursive: true });
  }

  private mtimes = new Map<keyof Collections, number>();

  private load<K extends keyof Collections>(name: K): Collections[K] {
    const path = join(this.dir, `${name}.json`);
    const mtime = existsSync(path) ? statSync(path).mtimeMs : 0;
    let rows = this.cache.get(name);
    // Reload when another process (e.g. the command-line runner) changed the file.
    if (!rows || mtime > (this.mtimes.get(name) ?? 0)) {
      rows = mtime ? JSON.parse(readFileSync(path, "utf8")) : [];
      this.cache.set(name, rows!);
      this.mtimes.set(name, mtime);
    }
    return rows as Collections[K];
  }

  private save(name: keyof Collections) {
    const path = join(this.dir, `${name}.json`);
    const data = JSON.stringify(this.load(name), null, 1);
    writeFileSync(`${path}.tmp`, data);
    // On Windows, antivirus/indexing can hold a just-written file for a moment (EPERM/EBUSY).
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        renameSync(`${path}.tmp`, path);
        this.mtimes.set(name, statSync(path).mtimeMs);
        return;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
      }
    }
    writeFileSync(path, data); // last resort: direct write
    this.mtimes.set(name, statSync(path).mtimeMs);
  }

  /** Serialises all mutations so concurrent agents can't interleave writes. */
  private mutate<T>(name: keyof Collections, fn: () => T): Promise<T> {
    const p = this.queue.then(() => {
      const out = fn();
      this.save(name);
      return out;
    });
    this.queue = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }

  async createRun(run: Omit<Run, "id" | "createdAt" | "steps" | "managerRounds" | "usage">) {
    const full: Run = {
      ...run,
      id: randomUUID(),
      steps: [],
      managerRounds: 0,
      usage: { llmCalls: 0, inputTokens: 0, outputTokens: 0, tavilyCalls: 0 },
      createdAt: now(),
    };
    return this.mutate("runs", () => (this.load("runs").push(full), full));
  }
  async getRun(id: string) {
    return this.load("runs").find((r) => r.id === id) ?? null;
  }
  async listRuns() {
    return [...this.load("runs")].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async updateRun(id: string, patch: Partial<Run>) {
    return this.mutate("runs", () => {
      const run = this.load("runs").find((r) => r.id === id);
      if (!run) throw new Error(`run ${id} not found`);
      Object.assign(run, patch);
      return run;
    });
  }
  async upsertStep(runId: string, step: Step) {
    await this.mutate("runs", () => {
      const run = this.load("runs").find((r) => r.id === runId);
      if (!run) throw new Error(`run ${runId} not found`);
      const i = run.steps.findIndex((s) => s.id === step.id);
      if (i >= 0) run.steps[i] = step;
      else run.steps.push(step);
    });
  }

  async saveReport(report: Omit<Report, "id" | "createdAt">) {
    const full: Report = { ...report, id: randomUUID(), createdAt: now() };
    return this.mutate("reports", () => (this.load("reports").push(full), full));
  }
  async getReport(id: string) {
    return this.load("reports").find((r) => r.id === id) ?? null;
  }

  async addEvidence(items: Omit<EvidenceRecord, "id">[]) {
    await this.mutate("evidence", () => this.load("evidence").push(...items.map((e) => ({ ...e, id: randomUUID() }))));
  }
  async listEvidence(runId: string) {
    return this.load("evidence").filter((e) => e.runId === runId);
  }
  async addManagerDecision(d: Omit<ManagerDecisionRecord, "id" | "createdAt">) {
    await this.mutate("decisions", () => this.load("decisions").push({ ...d, id: randomUUID(), createdAt: now() }));
  }
  async listManagerDecisions(runId: string) {
    return this.load("decisions").filter((d) => d.runId === runId);
  }

  async listLessons(agent?: AgentName, activeOnly = true) {
    return this.load("lessons").filter((l) => (!agent || l.agent === agent) && (!activeOnly || l.active));
  }
  async addLesson(l: Omit<Lesson, "id" | "createdAt" | "active">) {
    const full: Lesson = { ...l, id: randomUUID(), active: true, createdAt: now() };
    return this.mutate("lessons", () => {
      const all = this.load("lessons");
      all.push(full);
      const active = all.filter((x) => x.agent === l.agent && x.active).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const old of active.slice(0, Math.max(0, active.length - MAX_ACTIVE_LESSONS))) old.active = false;
      return full;
    });
  }
  async deleteLesson(id: string) {
    await this.mutate("lessons", () => {
      const all = this.load("lessons");
      const i = all.findIndex((l) => l.id === id);
      if (i >= 0) all.splice(i, 1);
    });
  }

  async addOutcome(o: Omit<Outcome, "id" | "recordedAt">) {
    const full: Outcome = { ...o, id: randomUUID(), recordedAt: now() };
    return this.mutate("outcomes", () => (this.load("outcomes").push(full), full));
  }
  async listOutcomes() {
    return this.load("outcomes");
  }
}

let store: Store | null = null;
export function getStore(): Store {
  return (store ??= new FileStore(process.env.STORE_DIR ?? "data/store"));
}
