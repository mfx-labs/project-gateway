/**
 * WP-8-E pure recovery-plan construction (contract §16 CSA, §12 LOK-009;
 * WP-8-E scope item 5). FILESYSTEM-FREE and advisory-only: this module
 * turns a recovery assessment into a structured, deterministic,
 * non-authoritative plan whose actions are plain data — never directly
 * executable, never carrying a capability, path, or mutation primitive.
 * Every proposed action carries the target logical identity, the observed
 * evidence (observation ids), the reason, the required future
 * capability/operation, the verify-before-mutation flag, and a safety
 * classification. The plan is deterministic: identical assessments yield
 * identical plans (DTM-003).
 *
 * Safety/capability mapping (documented, deterministic):
 *   - orphan temporary (WPR-023 (a), inode-twin of a verified published
 *     record): removal — `safe`, recovery capability, verify immediately
 *     before mutation (the twin link and digest are re-confirmed).
 *   - orphan temporary (b)/(c): quarantine — `safe` (evidence preserved),
 *     verify immediately before mutation.
 *   - orphan temporary (d): quarantine after disposition — safety
 *     `requires-external-disposition` (unknown state; CSA-015).
 *   - non-verified record/audit objects (malformed, unsupported version,
 *     digest mismatch, wrong derived location, incomplete relationship):
 *     quarantine — `safe` (CSA-008 preserves evidence), verify immediately
 *     before mutation.
 *   - tamper-class objects (wrong type, wrong UID/mode, unexpected hard
 *     link, foreign entries) and contested identities: disposition —
 *     `requires-external-disposition` (SRE-004/005; RGY-004 fail closed).
 *   - missing audit: audit reconstruction — `safe` (16.3/CSA-013:
 *     append-only, idempotent, gap-marked), recovery capability, verify
 *     immediately before mutation that the event is still absent.
 *   - dangling audit: disposition — `requires-external-disposition`
 *     (TAU-009: primaries are never reconstructed).
 *   - persistent writer lock: lock recovery — `unsafe` (LOK-008: liveness
 *     undetermined → never stale by timeout; breaking requires a confirmed
 *     stale-lock determination and the explicitly authorized recovery
 *     capability; LOK-009), verify immediately before mutation.
 *   - foreign/malformed lock: disposition — `requires-external-disposition`.
 *
 * The plan itself performs and authorizes nothing.
 */
import type { RecoveryActionCategory, RecoveryActionSafety, RecoveryAssessment, RecoveryPlan, RecoveryPlanAction, ScanFacts } from '../types.js';

export interface PlanActionSpec {
  readonly targetLogicalIdentity: string;
  readonly targetKind: RecoveryPlanAction['targetKind'];
  readonly category: RecoveryActionCategory;
  readonly observedEvidence: readonly string[];
  readonly reason: string;
  readonly requiredCapability: 'recovery' | 'control-plane';
  readonly requiredOperation: RecoveryPlanAction['requiredOperation'];
  readonly verifyImmediatelyBeforeMutation: boolean;
  readonly safety: RecoveryActionSafety;
}

/** Deterministic safety rank for plan ordering (disposition items last). */
function safetyRank(safety: RecoveryActionSafety): number {
  return safety === 'safe' ? 0 : safety === 'unsafe' ? 1 : 2;
}

function categoryRank(category: RecoveryActionCategory): number {
  const order: readonly RecoveryActionCategory[] = ['audit-reconstruction', 'orphan-removal', 'quarantine', 'registry-index-rebuild', 'lock-recovery', 'disposition'];
  const idx = order.indexOf(category);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

/**
 * Deterministic plan construction from one assessment (advisory data only;
 * no execution, no mutation, no capability production).
 */
export function buildRecoveryPlan(assessment: RecoveryAssessment): RecoveryPlan {
  const specs: PlanActionSpec[] = [];
  for (const orphan of assessment.orphanTemporaryObjects) {
    if (orphan.classification === 'orphan-referencing-published') {
      specs.push({
        targetLogicalIdentity: orphan.recordId ?? orphan.entry,
        targetKind: 'temporary-object',
        category: 'orphan-removal',
        observedEvidence: [orphan.observationId],
        reason: 'crash-reappearing temporary name referencing an already published immutable record (WPR-023 (a))',
        requiredCapability: 'recovery',
        requiredOperation: 'orphan-removal',
        verifyImmediatelyBeforeMutation: true,
        safety: 'safe',
      });
    } else if (orphan.classification === 'temporary-other') {
      specs.push({
        targetLogicalIdentity: orphan.entry,
        targetKind: 'temporary-object',
        category: 'quarantine',
        observedEvidence: [orphan.observationId],
        reason: 'temporary object outside the closed WPR-023 categories; quarantine after disposition (WPR-023 (d), CSA-015)',
        requiredCapability: 'control-plane',
        requiredOperation: 'disposition',
        verifyImmediatelyBeforeMutation: true,
        safety: 'requires-external-disposition',
      });
    } else {
      specs.push({
        targetLogicalIdentity: orphan.entry,
        targetKind: 'temporary-object',
        category: 'quarantine',
        observedEvidence: [orphan.observationId],
        reason: orphan.classification === 'incomplete-unpublished' ? 'incomplete unpublished temporary (WPR-023 (b))' : 'malformed temporary state (WPR-023 (c))',
        requiredCapability: 'recovery',
        requiredOperation: 'quarantine',
        verifyImmediatelyBeforeMutation: true,
        safety: 'safe',
      });
    }
  }
  for (const item of assessment.quarantineEligible) {
    // Temporary objects get their actions from the orphan-temporary pass
    // above; tamper-class and (d) objects are disposition-led.
    if (
      item.classification === 'foreign-entry' ||
      item.classification === 'wrong-type' ||
      item.classification === 'wrong-uid-or-mode' ||
      item.classification === 'unexpected-hard-link' ||
      item.classification === 'temporary-other' ||
      item.classification === 'orphan-referencing-published' ||
      item.classification === 'incomplete-unpublished' ||
      item.classification === 'malformed-temporary'
    ) {
      continue;
    }
    specs.push({
      targetLogicalIdentity: item.recordId ?? `object:${item.observationId}`,
      targetKind: 'primary-record',
      category: 'quarantine',
      observedEvidence: [item.observationId],
      reason: `object fails verification (${item.classification}); quarantine with evidence (CSA-008)`,
      requiredCapability: 'recovery',
      requiredOperation: 'quarantine',
      verifyImmediatelyBeforeMutation: true,
      safety: 'safe',
    });
  }
  for (const item of assessment.requiresDisposition) {
    const dispositionKinds: readonly string[] = ['wrong-type', 'wrong-uid-or-mode', 'unexpected-hard-link', 'foreign-entry', 'duplicate-conflicting-identity', 'dangling-audit', 'writer-lock-present', 'writer-lock-foreign', 'writer-lock-malformed', 'temporary-other'];
    if (!dispositionKinds.includes(item.classification)) continue;
    specs.push({
      targetLogicalIdentity: item.recordId ?? `object:${item.observationId}`,
      targetKind: 'primary-record',
      category: 'disposition',
      observedEvidence: [item.observationId],
      reason: item.reason,
      requiredCapability: 'control-plane',
      requiredOperation: 'disposition',
      verifyImmediatelyBeforeMutation: true,
      safety: 'requires-external-disposition',
    });
  }
  for (const candidate of assessment.reconstructionCandidates) {
    specs.push({
      targetLogicalIdentity: candidate.recordId,
      targetKind: 'primary-record',
      category: 'audit-reconstruction',
      observedEvidence: [candidate.observationId],
      reason: 'durable primary without its write-audit event; recovery-audit reconstruction with gap marker (16.3, CSA-013/014)',
      requiredCapability: 'recovery',
      requiredOperation: 'audit-reconstruction',
      verifyImmediatelyBeforeMutation: true,
      safety: 'safe',
    });
  }
  // WP-8-H: registry-index rebuild recommendation (derived cache; §11). A
  // missing, stale, malformed, or unsupported index is a rebuild candidate;
  // a conflicting index requires disposition (rebuild would collide with
  // the conflicting file at the derived identity path). The action is
  // advisory and grants nothing.
  if (assessment.indexMissing) {
    specs.push({
      targetLogicalIdentity: 'registry-index',
      targetKind: 'index-object',
      category: 'registry-index-rebuild',
      observedEvidence: [],
      reason: 'registry-index is absent; rebuild from verified source records (RGY-007; WP-8-H §9)',
      requiredCapability: 'recovery',
      requiredOperation: 'registry-index-rebuild',
      verifyImmediatelyBeforeMutation: true,
      safety: 'safe',
    });
  }
  for (const index of assessment.indexArtifacts) {
    if (index.classification === 'index-current-valid') continue;
    if (index.classification === 'index-conflicting') {
      specs.push({
        targetLogicalIdentity: index.indexId ?? index.entry,
        targetKind: 'index-object',
        category: 'disposition',
        observedEvidence: [index.id],
        reason: 'conflicting registry-index artifact at the derived identity; rebuild is blocked and disposition is required',
        requiredCapability: 'control-plane',
        requiredOperation: 'disposition',
        verifyImmediatelyBeforeMutation: true,
        safety: 'requires-external-disposition',
      });
      continue;
    }
    specs.push({
      targetLogicalIdentity: index.indexId ?? index.entry,
      targetKind: 'index-object',
      category: 'registry-index-rebuild',
      observedEvidence: [index.id],
      reason: `registry-index artifact is ${index.classification}${index.staleReason !== undefined ? ` (${index.staleReason})` : ''}; rebuild candidate`,
      requiredCapability: 'recovery',
      requiredOperation: 'registry-index-rebuild',
      verifyImmediatelyBeforeMutation: true,
      safety: 'safe',
    });
  }
  for (const lock of assessment.persistentLockObservations) {
    if (lock.classification === 'writer-lock-present') {
      specs.push({
        targetLogicalIdentity: 'writer.lock',
        targetKind: 'lock-object',
        category: 'lock-recovery',
        observedEvidence: [lock.observationId],
        reason: 'persistent writer lock; staleness undetermined, breaking requires confirmed stale-lock determination and explicit recovery authority (LOK-007/008/009)',
        requiredCapability: 'recovery',
        requiredOperation: 'lock-recovery',
        verifyImmediatelyBeforeMutation: true,
        safety: 'unsafe',
      });
    } else {
      specs.push({
        targetLogicalIdentity: 'writer.lock',
        targetKind: 'lock-object',
        category: 'disposition',
        observedEvidence: [lock.observationId],
        reason: 'foreign or malformed lock object; control-plane disposition required (LOK-018)',
        requiredCapability: 'control-plane',
        requiredOperation: 'disposition',
        verifyImmediatelyBeforeMutation: true,
        safety: 'requires-external-disposition',
      });
    }
  }
  // Deterministic ordering: (safety, category, target, evidence).
  const sorted = [...specs].sort((a, b) => {
    const bySafety = safetyRank(a.safety) - safetyRank(b.safety);
    if (bySafety !== 0) return bySafety;
    const byCategory = categoryRank(a.category) - categoryRank(b.category);
    if (byCategory !== 0) return byCategory;
    if (a.targetLogicalIdentity < b.targetLogicalIdentity) return -1;
    if (a.targetLogicalIdentity > b.targetLogicalIdentity) return 1;
    const ea = a.observedEvidence[0] ?? '';
    const eb = b.observedEvidence[0] ?? '';
    if (ea < eb) return -1;
    if (ea > eb) return 1;
    return 0;
  });
  const actions: RecoveryPlanAction[] = sorted.map((spec, index) => ({
    actionId: `plan-action-${index + 1}`,
    ...spec,
  }));
  const summary = {
    total: actions.length,
    safe: actions.filter((a) => a.safety === 'safe').length,
    unsafe: actions.filter((a) => a.safety === 'unsafe').length,
    requiresExternalDisposition: actions.filter((a) => a.safety === 'requires-external-disposition').length,
  };
  return { advisoryOnly: true, source: assessment.source, actions, summary };
}
