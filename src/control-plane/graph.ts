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
  /**
   * Verification-only: extra entry identities included in the REGISTRY
   * entry check (e.g., applicable revocation records relevant to the
   * candidate). They are registry-checked by the accepted REG rules but are
   * never LFC entries (revocations are not LFC subjects). Approve/issue
   * omit this; behavior is then byte-identical to the accepted Slice-1
   * evaluation.
   */
  readonly extraRegistryEntries?: ReadonlySet<string>;
}

/** Graph evaluation over one candidate entry record. */
export function evaluateCandidateLifecycleRecord(input: LifecycleGraphInputs): ValidationReport {
  const candidateId = String(input.candidate['record_id'] ?? '');
  const entries = new Set<string>([candidateId]);
  for (const id of input.extraRegistryEntries ?? []) {
    entries.add(id);
  }
  return validateLifecycleGraph({
    records: [...input.existing, input.candidate],
    entryRecordIds: entries,
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

function isLfcFinding(finding: Finding, lfc: 'LFC-001' | 'LFC-002' | 'LFC-003' | 'LFC-004'): boolean {
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

/**
 * Map accepted graph findings to the closed verification taxonomy (Slice
 * 2B). REG findings → registry-context-mismatch; LFC-001/002 (approval
 * validation-chain) → the form's missing-approval category; LFC-003
 * (issuance approval dependency) → issuance-not-authorized; any other
 * finding → eligibility-denied (general intersection denial).
 */
export function mapVerificationFindings(
  findings: readonly Finding[],
  missingApprovalCategory: 'lifecycle-state-missing' | 'issuance-not-authorized',
): Slice1FailureCategory | undefined {
  if (findings.length === 0) return undefined;
  if (findings.some(isRegistryFinding)) return 'registry-context-mismatch';
  if (findings.some((f) => isLfcFinding(f, 'LFC-001') || isLfcFinding(f, 'LFC-002'))) return missingApprovalCategory;
  if (findings.some((f) => isLfcFinding(f, 'LFC-003'))) return 'issuance-not-authorized';
  return 'eligibility-denied';
}

/**
 * Map accepted graph findings to the closed grant-issue taxonomy (Slice
 * 3A; §26.19). REG findings → registry-context-mismatch; LFC-001/002
 * (broken approval validation-chain) → lifecycle-state-missing (broken
 * lifecycle dependency); LFC-003 (issuance approval dependency) →
 * issuance-not-authorized; any other finding (including LFC-008 grant
 * invalidity) → eligibility-denied.
 */
export function mapGrantGraphFindings(findings: readonly Finding[]): Slice1FailureCategory | undefined {
  if (findings.length === 0) return undefined;
  if (findings.some(isRegistryFinding)) return 'registry-context-mismatch';
  if (findings.some((f) => isLfcFinding(f, 'LFC-001') || isLfcFinding(f, 'LFC-002'))) return 'lifecycle-state-missing';
  if (findings.some((f) => isLfcFinding(f, 'LFC-003'))) return 'issuance-not-authorized';
  return 'eligibility-denied';
}

/**
 * Map accepted graph findings to the closed decideActivation REJECTION
 * taxonomy (§26.4). REG findings → registry-context-mismatch (PHASE-1
 * recordability); LFC-001/002/004 (broken approval validation-chain or
 * missing required issuance) → lifecycle-state-missing; LFC-003 →
 * issuance-not-authorized; EXE-001 (competing activation for the
 * reservation) → replay-denied; any other finding → eligibility-denied.
 * Post-correlation currentness failures are NEVER mapped here: they are
 * PHASE-2 eligibility → durable ActivationRecord(denied) (§26.5).
 */
export function mapActivationGraphFindings(findings: readonly Finding[]): Slice1FailureCategory | undefined {
  if (findings.length === 0) return undefined;
  if (findings.some(isRegistryFinding)) return 'registry-context-mismatch';
  if (findings.some((f) => isLfcFinding(f, 'LFC-001') || isLfcFinding(f, 'LFC-002') || isLfcFinding(f, 'LFC-004'))) return 'lifecycle-state-missing';
  if (findings.some((f) => isLfcFinding(f, 'LFC-003'))) return 'issuance-not-authorized';
  if (findings.some((f) => f.ruleIds.includes('EXE-001'))) return 'replay-denied';
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
