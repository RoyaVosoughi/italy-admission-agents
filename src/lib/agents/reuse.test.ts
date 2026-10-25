import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findReusableRun, fingerprintOf, type RunInput } from "./orchestrator";
import type { Run } from "../store/types";
import type { Store } from "../store/types";

const dir = mkdtempSync(join(tmpdir(), "reuse-"));
const doc = (name: string, text: string) => {
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
};
const storeWith = (runs: Partial<Run>[]) => ({ listRuns: async () => runs }) as unknown as Store;
const base = (documents: string[], extra: Partial<RunInput> = {}): RunInput => ({ clientFolder: "sara", documents, today: "2026-10-24", ...extra });

test("same documents give the same fingerprint; content, notes or rate change it; file name does not", () => {
  const a = doc("cv.txt", "GPA 17.2");
  const renamed = doc("resume-final.txt", "GPA 17.2");
  const other = doc("cv2.txt", "GPA 15.0");
  assert.equal(fingerprintOf(base([a])), fingerprintOf(base([renamed])));
  assert.notEqual(fingerprintOf(base([a])), fingerprintOf(base([other])));
  assert.notEqual(fingerprintOf(base([a])), fingerprintOf(base([a], { notes: "budget 8k" })));
  assert.notEqual(fingerprintOf(base([a])), fingerprintOf(base([a], { tomanPerEur: 110000 })));
});

test("an approved run of the same question is reused; blocked runs, other clients and force are not", async () => {
  const a = doc("cv.txt", "GPA 17.2");
  const fp = fingerprintOf(base([a]));
  const approved = { id: "r1", clientId: "sara", fingerprint: fp, status: "approved" } as Partial<Run>;
  assert.equal((await findReusableRun(base([a]), storeWith([approved])))?.id, "r1");
  assert.equal(await findReusableRun(base([a]), storeWith([{ ...approved, status: "blocked" }])), null, "blocked runs are retried");
  assert.equal(await findReusableRun(base([a]), storeWith([{ ...approved, clientId: "other" }])), null);
  assert.equal(await findReusableRun(base([a], { force: true }), storeWith([approved])), null, "force runs again");
});
