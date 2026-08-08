/**
 * WP-12 Slice 1 — WP-4 lifecycle graph adapter.
 *
 * The accepted WP-4 lifecycle evaluation (`validateLifecycleGraph` plus
 * `evaluateLifecycleRegistryContext`) is the SINGLE lifecycle rule
 * authority. The control-plane operation layer builds the graph inputs from
 * store-derived lifecycle payloads and maps graph findings to the committed
 * Slice-1 result taxonomy; it never duplicates graph semantics and never
 * implements a parallel lifecycle state machine.
 *
 * Pure module: no I/O, no persistence, no authority.
 */
import { validateLifecycleGraph } from '../api/validate.js';
import type { AcceptedRegistryContext, ValidationReport } from '../api/types.js';
import type { Finding } from '../internal/report.js';
import type { Slice1FailureCategory } from './types.js';

export interface LifecycleGraphInputs {
  /** Existing lifecycle payloads (store-derived; validated at admission). */
  readonly existing: readonly Readonly<Record<string, unknown>>[];
  /** The candidate record payload (the entry being decided). */
  readonly candidate: Readonly<Record<string, unknown>>;
  readonly registry: AcceptedRegistryContext;
  /** Exact validated artifact models by revision/instance identity (host evidence). */
  readonly artifactsByRevision: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  readonly artifactsByInstance: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
}

/** Graph evaluation over one candidate entry record. */
export function evaluateCandidateLifecycleRecord(input: LifecycleGraphInputs): ValidationReport {
  const candidateId = String(input.candidate['record_id'] ?? '');
  return validateLifecycleGraph({
    records: [...input.existing, input.candidate],
    entryRecordIds: new Set([candidateId]),
    registry: input.registry,
    artifactsByRevision: input.artifactsByRevision,
    artifactsByInstance: input.artifactsByInstance,
    resultsByAttempt: new Map(),
    entryArtifactInstances: new Set(),
  });
}

/** True when the finding is a registry-context finding (REG-001/002/008/LFC-010). */
function isRegistryFinding(finding: Finding): boolean {
  return finding.ruleIds.some((ruleId) => ruleId === 'REG-001' || ruleId === 'REG-002' || ruleId === 'REG-008' || ruleId === 'LFC-010');
}

function isLfcFinding(finding: Finding, lfc: 'LFC-001' | 'LFC-002' | 'LFC-003'): boolean {
  return finding.ruleIds.includes(lfc);
}

/**
 * Map accepted graph findings to the closed Slice-1 taxonomy:
 * - REG-001/002/008 (registry context) → registry-context-mismatch;
 * - LFC-001/002 (approval validation prerequisites) → subject-not-validated;
 * - LFC-003 (issuance requires matching approval) → issuance-not-authorized;
 * - any other finding → eligibility-denied (general intersection denial;
 *   `ceiling-denied` remains the more specific WP-6 ceiling category handled
 *   by the operation layer).
 * Returns undefined when the graph reports no findings.
 */
export function mapGraphFindings(findings: readonly Finding[]): Slice1FailureCategory | undefined {
  if (findings.length === 0) return undefined;
  if (findings.some(isRegistryFinding)) return 'registry-context-mismatch';
  if (findings.some((f) => isLfcFinding(f, 'LFC-001') || isLfcFinding(f, 'LFC-002'))) return 'subject-not-validated';
  if (findings.some((f) => isLfcFinding(f, 'LFC-003'))) return 'issuance-not-authorized';
  return 'eligibility-denied';
}

/** Deterministic key ordering for a stable map projection (no collision in practice). */
export function artifactModelMaps(
  subject: Readonly<{ instanceId: string; revisionId: string }>,
  model: Readonly<Record<string, unknown>>,
): { readonly artifactsByRevision: ReadonlyMap<string, Readonly<Record<string, unknown>>>; readonly artifactsByInstance: ReadonlyMap<string, Readonly<Record<string, unknown>>> } {
  const byRevision = new Map<string, Readonly<Record<string, unknown>>>();
  const byInstance = new Map<string, Readonly<Record<string, unknown>>>();
  byRevision.set(subject.revisionId, model);
  byInstance.set(subject.instanceId, model);
  return { artifactsByRevision: byRevision, artifactsByInstance: byInstance };
}
