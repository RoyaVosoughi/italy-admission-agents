// The approval gate (plan §4.2). The Manager agent decides; this code checks the decision
// against rules the Manager cannot override. "approved" is only ever set when this passes.
import type { ManagerDecision } from "../agents/types";
import type { EvidenceRecord } from "../store/types";
import type { Claim } from "./claims";
import { UNVERIFIED_LABEL, type CheckFailure } from "./report-checks";

export interface GateInput {
  decision: ManagerDecision;
  claims: Claim[];
  evidenceById: Map<string, EvidenceRecord>; // keyed by the short ids shown to the Manager (E1, E2…)
  hardFailures: CheckFailure[];
  threshold: number;
}

export function isUsableEvidence(e: EvidenceRecord | undefined): boolean {
  return !!e && e.quoteMatched && e.officialUrl && (e.status === "verified" || e.status === "changed");
}

const normUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/[/#?]+$/, "").toLowerCase();

/** Official URLs whose page really contains the quoted sentence. */
export function usableUrls(evidence: Iterable<EvidenceRecord>): Set<string> {
  const out = new Set<string>();
  for (const e of evidence) if (isUsableEvidence(e) && e.url) out.add(normUrl(e.url));
  return out;
}

/** A claim is backed when it links an official page whose quote was matched, or the Manager tied it to such evidence. */
export function isBacked(c: Claim, urls: Set<string>, audit?: ManagerDecision["claimAudit"][number], evidenceById?: Map<string, EvidenceRecord>) {
  if (audit?.status === "wrong" || audit?.status === "stale") return false;
  if (c.urls.some((u) => urls.has(normUrl(u)))) return true;
  return audit?.status === "verified" && audit.evidenceIds.some((id) => isUsableEvidence(evidenceById?.get(id)));
}

export function approvalGate(g: GateInput): { approved: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (g.decision.verdict !== "approve") reasons.push(`Manager verdict is "${g.decision.verdict}"`);
  if (g.hardFailures.length) reasons.push(`${g.hardFailures.length} automatic report check(s) failed`);
  if (g.decision.writingScore < g.threshold) reasons.push(`writing score ${g.decision.writingScore} < ${g.threshold}`);

  const audit = new Map(g.decision.claimAudit.map((a) => [a.claimId, a]));
  const urls = usableUrls(g.evidenceById.values());
  for (const c of g.claims) {
    const a = audit.get(c.id);
    if (a?.status === "wrong") {
      reasons.push(`claim marked wrong: ${c.text.slice(0, 100)}`);
      continue;
    }
    if (c.clientOnly) continue; // the client's own data — the Manager can still mark it wrong
    // Not backed by a quote-matched official page → the line must say it is projected/unconfirmed.
    if (!isBacked(c, urls, a, g.evidenceById) && !UNVERIFIED_LABEL.test(c.text)) {
      reasons.push(`unverified and unlabelled: ${c.text.slice(0, 100)}`);
    }
  }
  return { approved: reasons.length === 0, reasons };
}
