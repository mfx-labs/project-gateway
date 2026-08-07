/**
 * WP-8-L authorized retention-mutation composition boundary (contract
 * §15.4/RNT-001…010, CAP-008/009, LOK; ADR-035). FILESYSTEM-FREE: all
 * filesystem work is delegated to the exact fs-bearing owners
 * (`retention/delete.ts`, `publication/publish-record.ts`,
 * `read/read-record.ts`, `read/history.ts`, `locks/lock.ts`).
 *
 * Authority (§15.4): the sole production consumer of the retention-
 * capability, trusted-retention-request, and retention-action-provenance
 * creators (static-guard enforced). Zero production retention-action-
 * provenance producers exist, so production retention mutation is
 * UNREACHABLE: the retention capability can only be created from a genuine
 * branded `TrustedRetentionRequest`, which requires genuine branded
 * retention-action provenance. A recovery capability, recovery action,
 * recovery plan, assessment, observation, history result, hold boolean,
 * `canDelete`/`retentionExpired`/`hasNoHold` fact, path, filename, or
 * environment value NEVER grants retention authority — retention is a
 * distinct private authority domain, and recovery authority can never
 * perform retention deletion (ADR-035 §2).
 *
 * Mutation model (§15.4): genuine trusted input + genuine retention
 * provenance → store revalidation → retention capability → hold-state
 * generation recomputation (the trusted freshness binding) → authoritative
 * WP-8-K history derivation and digest binding (record flow) or exact
 * audit/association verification (audit flow) → registry-mode generation
 * and surface recomputation → single-writer lock acquisition (never broken
 * or replaced) → under-lock re-derivation of target, history, hold and
 * policy bindings → durable deletion-intent evidence publication (intent
 * precedes any unlink) → post-intent revalidation (a hold/policy/history
 * change after intent fails closed) → exact unlink with containing-
 * directory fsync → durable deletion-completion evidence publication →
 * durability verification → capability/root revalidation → identity-bound
 * lock release. Any mismatch fails closed before any mutation.
 *
 * Idempotency (ADR-035 §6): target present + no intent → validate →
 * intent → unlink → completion; target present + matching intent + no
 * completion → reverify → unlink → completion; target absent + matching
 * intent + no completion → completion roll-forward (absence made durable
 * by directory fsync before completion); target absent + matching intent +
 * matching completion → `already-completed`; target absent + no intent →
 * fail closed; target present + completion → integrity inconsistency;
 * target or binding changed after intent → fail closed (a replacement is
 * never deleted; the intent is never self-executing authority).
 */
import { createRetentionCapability, type RetentionCapability } from '../capabilities/authenticity.js';
import { createTrustedRetentionRequest } from '../trusted-input/bootstrap-input.js';
import { verifyStoreInstance, verifyRecordObjectAt } from '../read/read-record.js';
import { inspectAuditHistoryByIdentity } from '../read/history.js';
import { revalidateParentIdentity } from '../root/resolve.js';
import { computeScanGeneration, recomputeSurfaceGeneration } from '../recovery/scan.js';
import { deriveRecordRelativePath } from '../layout/layout.js';
import { isValidDigestSyntax, parsePersistedEnvelope } from '../format/envelope.js';
import { acquireWriterLock, releaseWriterLock } from '../locks/lock.js';
import { unlinkVerifiedRecordObject, fsyncRetentionDirectory } from './delete.js';
import {
  computeRetentionHoldStateGeneration,
  retentionHistoryBindingDigest,
  buildRetentionRecordIntentEvidence,
  buildRetentionAuditIntentEvidence,
  buildRetentionRecordCompletionEvidence,
  buildRetentionAuditCompletionEvidence,
  computeRetentionRecordIntentIdentity,
  computeRetentionAuditIntentIdentity,
  computeRetentionRecordCompletionIdentity,
  computeRetentionAuditCompletionIdentity,
  verifyExistingRetentionRecordIntent,
  verifyExistingRetentionAuditIntent,
  verifyExistingRetentionRecordCompletion,
  verifyExistingRetentionAuditCompletion,
  readRetentionEvidencePayload,
  publishRetentionEvidence,
  verifyRetentionEvidenceDurability,
  isoFromEpochMs,
  type RetentionEvidenceBuild,
} from './evidence.js';
import { RECORD_CLASS_BY_ID } from '../format/taxonomy.js';
import { AUTHORIZED_WRITE_EVENT_KIND, RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND } from '../audit/write-audit.js';
import type { RecordClassId, RetentionMutationRequest, RetentionMutationResult, StorageFinding, VerifiedStoreInstance } from '../types.js';

const NO_STATE = { retryable: false, recoveryRequired: false, primaryStateChanged: 'no' as const, durabilityPointReached: 'no' as const, auditChanged: 'no' as const, verifyBeforeRetry: false };

/**
 * WP-8-L: the closed retention-deletable primary record-class list (§15.4;
 * ADR-035 §2). Narrow first slice: exact canonical immutable lifecycle fact
 * classes only. Excluded: revocable-usability classes (approval, issuance,
 * runtime grant, result publication), activation, registry snapshots, store
 * metadata, evidence, configuration snapshots, audit events (deleted only
 * through `retention-delete-audit`), locks, quarantine, foreign, malformed,
 * and tamper-class objects.
 */
export const RETENTION_DELETABLE_RECORD_CLASSES: readonly string[] = [
  'validation-record',
  'revocation-record',
  'execution-occurrence-record',
  'execution-attempt-record',
  'trusted-receipt',
  'execution-summary-record',
  'migration-record',
  'supersession-record',
] as const;

function isRetentionDeletableRecordClass(recordClass: string): boolean {
  return (RETENTION_DELETABLE_RECORD_CLASSES as readonly string[]).includes(recordClass);
}

/** Fully narrowed record-deletion action (validation guarantees the bindings). */
type RecordDeleteAction = RetentionMutationRequest['action'] & {
  category: 'retention-delete-record';
  targetRecordClass: (typeof RETENTION_DELETABLE_RECORD_CLASSES)[number];
  targetRecordId: string;
  expectedHistoryDigest: string;
  expectedHistoryStatus: 'complete';
  referencedRecordId?: undefined;
  referencedRecordDigest?: undefined;
  referencedRecordClass?: undefined;
  expectedPrimaryDeletionCompletionEvidenceId?: undefined;
};

/** Fully narrowed audit-deletion action (validation guarantees the bindings). */
type AuditDeleteAction = RetentionMutationRequest['action'] & {
  category: 'retention-delete-audit';
  targetRecordClass: 'authoritative-audit-event';
  targetRecordId: string;
  referencedRecordId: string;
  referencedRecordDigest: string;
  referencedRecordClass: RecordClassId;
  expectedPrimaryDeletionCompletionEvidenceId: string;
  expectedHistoryDigest?: undefined;
  expectedHistoryStatus?: undefined;
};

function finding(code: string, message: string, phase: StorageFinding['phase'] = 'request-validation'): StorageFinding {
  return { code, message, phase, state: NO_STATE };
}

function failResult(code: string, message: string): RetentionMutationResult {
  return { ok: false, findings: [finding(code, message)] };
}

function refusal(code: string, message: string, outcome: 'hold-blocked' | 'policy-blocked' | 'history-incomplete'): RetentionMutationResult {
  return { ok: false, outcome, findings: [finding(code, message)] };
}

/** Validate the narrow structured action (never a path, descriptor, nonce, or callback). */
function validateAction(input: RetentionMutationRequest): { readonly ok: boolean; readonly code?: string; readonly message?: string } {
  const action = input.action;
  if (typeof action !== 'object' || action === null) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'retention action is malformed' };
  }
  if (action.category !== 'retention-delete-record' && action.category !== 'retention-delete-audit') {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'retention action category is outside the supported vocabulary; no generic deletion authority exists' };
  }
  const classProfile = RECORD_CLASS_BY_ID.get(action.targetRecordClass);
  if (classProfile === undefined || classProfile.namespace !== 'store-records') {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target record class is outside the store-records vocabulary' };
  }
  if (!Number.isSafeInteger(action.expectedTargetRevision) || action.expectedTargetRevision < 1) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected target revision must be a positive safe integer' };
  }
  if (typeof action.targetRecordDigest !== 'string' || !isValidDigestSyntax(action.targetRecordDigest)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target record digest is malformed' };
  }
  if (typeof action.expectedPolicyIdentity !== 'string' || action.expectedPolicyIdentity.length === 0) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected retention policy identity is malformed' };
  }
  if (typeof action.expectedPolicyVersion !== 'string' || action.expectedPolicyVersion.length === 0) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected retention policy version is malformed' };
  }
  if (typeof action.expectedDecisionId !== 'string' || action.expectedDecisionId.length === 0) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected retention decision identity is malformed' };
  }
  if (typeof action.expectedHoldStateGeneration !== 'string' || !isValidDigestSyntax(action.expectedHoldStateGeneration)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected hold-state generation is malformed' };
  }
  if (action.expectedHoldResult !== 'active-hold' && action.expectedHoldResult !== 'unknown-hold-state' && action.expectedHoldResult !== 'stale-hold-decision' && action.expectedHoldResult !== 'clear-current-hold-state') {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'hold result is outside the closed adjudication vocabulary' };
  }
  if (typeof action.expectedGeneration !== 'string' || !isValidDigestSyntax(action.expectedGeneration)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected generation is malformed' };
  }
  if (typeof action.expectedSurfaceGeneration !== 'string' || !isValidDigestSyntax(action.expectedSurfaceGeneration)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected surface generation is malformed' };
  }
  if (action.category === 'retention-delete-record') {
    if (!isRetentionDeletableRecordClass(action.targetRecordClass)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target record class is not retention-deletable in this slice' };
    }
    const targetId = action.targetRecordId;
    if (typeof targetId !== 'string' || !/^pgw:r:[0-9a-f]{32}$/.test(targetId)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target record identity is not a canonical typed identifier' };
    }
    if (typeof action.expectedHistoryDigest !== 'string' || !isValidDigestSyntax(action.expectedHistoryDigest)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected history-binding digest is malformed' };
    }
    if (action.expectedHistoryStatus !== 'complete') {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected history status is outside the retention-eligible vocabulary; reconstructed gaps fail closed' };
    }
    if (action.referencedRecordId !== undefined || action.referencedRecordDigest !== undefined || action.referencedRecordClass !== undefined || action.expectedPrimaryDeletionCompletionEvidenceId !== undefined) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'record deletion carries audit-only binding fields' };
    }
    return { ok: true };
  }
  // retention-delete-audit
  if (action.targetRecordClass !== 'authoritative-audit-event') {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'audit deletion targets only the authoritative-audit-event class' };
  }
  const auditId = action.targetRecordId;
  if (typeof auditId !== 'string' || !/^pgw:l:[0-9a-f]{32}$/.test(auditId)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target audit identity is not a canonical audit identity' };
  }
  const referencedRecordId = action.referencedRecordId;
  const referencedRecordDigest = action.referencedRecordDigest;
  const referencedRecordClass = action.referencedRecordClass;
  const completionId = action.expectedPrimaryDeletionCompletionEvidenceId;
  if (typeof referencedRecordId !== 'string' || !/^pgw:r:[0-9a-f]{32}$/.test(referencedRecordId)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'referenced record identity is not a canonical typed identifier' };
  }
  if (typeof referencedRecordDigest !== 'string' || !isValidDigestSyntax(referencedRecordDigest)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'referenced record digest is malformed' };
  }
  if (typeof referencedRecordClass !== 'string' || !isRetentionDeletableRecordClass(referencedRecordClass)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'referenced record class is not a retention-deletable primary class' };
  }
  if (typeof completionId !== 'string' || !/^pgw:r:[0-9a-f]{32}$/.test(completionId)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected primary deletion completion evidence identity is malformed' };
  }
  if (action.expectedHistoryDigest !== undefined || action.expectedHistoryStatus !== undefined) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'audit deletion carries record-only history binding fields' };
  }
  return { ok: true };
}

function configFacts(trustedConfiguration: unknown): { readonly configurationVersion: string; readonly configurationIdentity: string } | undefined {
  if (typeof trustedConfiguration !== 'object' || trustedConfiguration === null) return undefined;
  const c = trustedConfiguration as Readonly<Record<string, unknown>>;
  if (typeof c['configurationVersion'] !== 'string' || typeof c['identity'] !== 'string') return undefined;
  return { configurationVersion: c['configurationVersion'], configurationIdentity: c['identity'] };
}

/**
 * Hold freshness gate (§15.4/ADR-035 §3): the authority's adjudication is
 * honored only when its hold-state generation equals the generation
 * re-derived from the CURRENT genuine trusted configuration. `active-hold`,
 * `unknown-hold-state`, and `stale-hold-decision` outcomes are refusals by
 * the authority itself; a generation mismatch makes the decision stale.
 */
function holdGate(request: RetentionMutationRequest, expectedHoldStateGeneration: string): { readonly ok: boolean; readonly code?: string; readonly message?: string } {
  if (request.action.expectedHoldResult !== 'clear-current-hold-state') {
    return { ok: false, code: 'ERR-STO-RETENTION-DENIED', message: `trusted hold adjudication is ${request.action.expectedHoldResult}; deletion is prohibited` };
  }
  const facts = configFacts(request.trustedConfiguration);
  if (facts === undefined) {
    return { ok: false, code: 'ERR-STO-CONFIG-UNAVAILABLE', message: 'trusted configuration facts are unavailable for the hold gate' };
  }
  const current = computeRetentionHoldStateGeneration(facts);
  if (current !== expectedHoldStateGeneration) {
    return { ok: false, code: 'ERR-STO-RETENTION-DENIED', message: 'hold-state generation does not match the current trusted configuration; the hold decision is stale' };
  }
  return { ok: true };
}

/** Registry-mode generation/surface recomputation (the decision snapshot tokens). */
function recomputeTokens(storeInstance: VerifiedStoreInstance, namespaceRoot: string, serviceUid: number): { readonly generation: string; readonly surfaceGeneration: string } {
  const profile = storeInstance.limitProfile;
  const generation = computeScanGeneration({
    storeInstance,
    mode: 'registry',
    entryLimit: profile['totalScanEntries'] ?? 1024 * 1024,
    byteLimit: profile['totalScanBytes'] ?? 4 * 1024 * 1024 * 1024,
    failClosed: true,
  });
  const surface = recomputeSurfaceGeneration({ namespaceRoot, serviceUid, mode: 'registry' });
  if (!surface.ok || surface.generation === undefined) {
    return { generation, surfaceGeneration: generation };
  }
  return { generation, surfaceGeneration: surface.generation };
}

/**
 * Derive + bind the authoritative WP-8-K history (record flow; ADR-035 §4):
 * the inspection must be a clean complete lineage (`complete`, complete
 * flag, no continuation, zero findings) and the deterministic history
 * digest must equal the trusted decision's binding. Reconstructed-gap and
 * every contested lineage fail closed — the contract does not permit
 * retention deletion with reconstructed history gaps in this slice.
 */
function deriveHistoryBinding(input: {
  readonly storeInstance: VerifiedStoreInstance;
  readonly namespaceRoot: string;
  readonly recordClass: RecordClassId;
  readonly recordId: string;
  readonly revision: number;
  readonly expectedHistoryDigest: string;
  readonly expectedHistoryStatus: 'complete';
}): { readonly ok: boolean; readonly outcome?: 'history-incomplete'; readonly code?: string; readonly message?: string } {
  const result = inspectAuditHistoryByIdentity({
    storeInstance: input.storeInstance,
    namespaceRoot: input.namespaceRoot,
    recordClass: input.recordClass,
    recordId: input.recordId,
    revision: input.revision,
  });
  if (!result.ok) {
    return { ok: false, outcome: 'history-incomplete', code: result.findings[0]?.code ?? 'ERR-STO-INTEGRITY', message: result.findings[0]?.message ?? 'audit history could not be derived' };
  }
  if (result.status !== 'complete' || result.completeness?.complete !== true || result.continuation !== undefined || (result.auditFindings?.length ?? 0) > 0) {
    return { ok: false, outcome: 'history-incomplete', code: 'ERR-STO-RETENTION-DENIED', message: `history is not a clean complete lineage (${result.status ?? 'truncated'}); retention deletion fails closed` };
  }
  if (result.status !== input.expectedHistoryStatus) {
    return { ok: false, outcome: 'history-incomplete', code: 'ERR-STO-RETENTION-DENIED', message: 'history status does not match the trusted decision binding' };
  }
  const digest = retentionHistoryBindingDigest(result);
  if (digest === undefined || digest !== input.expectedHistoryDigest) {
    return { ok: false, outcome: 'history-incomplete', code: 'ERR-STO-RETENTION-DENIED', message: 'history-binding digest does not match the trusted decision' };
  }
  return { ok: true };
}

/**
 * Verify the exact audit event, its association, and the referenced
 * primary-absence gate (audit flow; ADR-035 §8). The audit event must bind
 * the exact referenced record identity/digest; the referenced record must
 * be a retention-deletable primary class and ABSENT (audit deletion never
 * precedes primary deletion); its durable completion evidence is verified
 * separately.
 */
function verifyAuditTargetAndAssociation(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly targetRecordId: string;
  readonly targetRecordRevision: number;
  readonly targetRecordDigest: string;
  readonly referencedRecordId: string;
  readonly referencedRecordDigest: string;
  readonly referencedRecordClass: RecordClassId;
}): { readonly ok: boolean; readonly target?: { readonly dev: number; readonly ino: number; readonly nlink: number }; readonly code?: string; readonly message?: string } {
  const derived = deriveRecordRelativePath('authoritative-audit-event', input.targetRecordId);
  if (!derived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'audit target path derivation failed' };
  }
  const verified = verifyRecordObjectAt({ path: `${input.namespaceRoot}/${derived.relativePath}`, serviceUid: input.serviceUid, byteLimit: input.byteLimit });
  if (!verified.ok) {
    return { ok: false, code: verified.code ?? 'ERR-STO-INTEGRITY', message: verified.message ?? 'audit target verification failed' };
  }
  if (verified.recordId !== input.targetRecordId) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'audit target identity does not match the trusted decision' };
  }
  if (verified.revision !== input.targetRecordRevision) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'audit target revision does not match the trusted decision' };
  }
  if (verified.digest !== input.targetRecordDigest) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'audit target digest does not match the trusted decision' };
  }
  const parsed = parsePersistedEnvelope(verified.canonicalUtf8 ?? '', input.byteLimit);
  if (!parsed.ok || parsed.model === undefined) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'audit target envelope could not be parsed' };
  }
  const model = parsed.model as Readonly<Record<string, unknown>>;
  const payload = model['payload'];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'audit target association payload is malformed' };
  }
  const p = payload as Readonly<Record<string, unknown>>;
  const eventKind = p['eventKind'];
  const primaryRecordId = p['recordId'];
  const primaryDigest = p['recordDigest'];
  if (eventKind !== AUTHORIZED_WRITE_EVENT_KIND && eventKind !== RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'audit target event kind is outside the associated vocabulary' };
  }
  if (typeof primaryRecordId !== 'string' || typeof primaryDigest !== 'string') {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'audit target association payload fields are malformed' };
  }
  if (primaryRecordId !== input.referencedRecordId || primaryDigest !== input.referencedRecordDigest) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'audit target association does not match the trusted decision bindings' };
  }
  const references = model['referenceDigests'];
  if (!Array.isArray(references) || !references.includes(input.referencedRecordDigest)) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'audit target reference linkage does not bind the referenced record digest' };
  }
  const referencedDerived = deriveRecordRelativePath(input.referencedRecordClass, input.referencedRecordId);
  if (!referencedDerived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'referenced record path derivation failed' };
  }
  const referenced = verifyRecordObjectAt({ path: `${input.namespaceRoot}/${referencedDerived.relativePath}`, serviceUid: input.serviceUid, byteLimit: input.byteLimit });
  if (referenced.ok) {
    return { ok: false, code: 'ERR-STO-RETENTION-DENIED', message: 'referenced primary record is still present; audit deletion is prohibited' };
  }
  if (referenced.code !== 'ERR-STO-NOT-FOUND') {
    return { ok: false, code: referenced.code ?? 'ERR-STO-INTEGRITY', message: referenced.message ?? 'referenced primary state could not be verified' };
  }
  return { ok: true, target: { dev: verified.dev ?? 0, ino: verified.ino ?? 0, nlink: verified.nlink ?? 0 } };
}

/**
 * Verify the durable primary-deletion completion evidence (audit flow gate;
 * ADR-035 §8): the evidence must exist at its deterministic identity and
 * bind the exact referenced record class/identity/digest with a completed
 * outcome. Primary absence is never inferred from absence alone — the
 * completion evidence is mandatory.
 */
function verifyPrimaryDeletionCompletion(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly evidenceId: string;
  readonly targetRecordClass: RecordClassId;
  readonly targetRecordId: string;
  readonly targetRecordDigest: string;
}): { readonly ok: boolean; readonly code?: string; readonly message?: string } {
  const verified = verifyExistingRetentionRecordCompletion({
    namespaceRoot: input.namespaceRoot,
    serviceUid: input.serviceUid,
    byteLimit: input.byteLimit,
    evidenceId: input.evidenceId,
    targetRecordClass: input.targetRecordClass,
    targetRecordId: input.targetRecordId,
    targetRecordDigest: input.targetRecordDigest,
  });
  if (!verified.ok) {
    return { ok: false, code: verified.code ?? 'ERR-STO-INTEGRITY', message: verified.message ?? 'primary deletion completion evidence could not be verified' };
  }
  if (verified.matches !== true) {
    return { ok: false, code: 'ERR-STO-RETENTION-DENIED', message: 'primary deletion completion evidence is absent; audit deletion is prohibited' };
  }
  return { ok: true };
}

/**
 * Classify a conflicting durable intent (§15.4; requirements 19/20): the
 * durable intent's hold binding differs from the current request → the hold
 * state changed after the intent (`hold-blocked`); the policy bindings
 * differ → the policy changed after the intent (`policy-blocked`); any
 * other binding mismatch is an integrity inconsistency (fail closed).
 */
function classifyIntentConflict(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly evidenceId: string;
  readonly holdStateGeneration: string;
  readonly policyIdentity: string;
  readonly policyVersion: string;
}): { readonly outcome?: 'hold-blocked' | 'policy-blocked'; readonly code: string; readonly message: string } {
  const read = readRetentionEvidencePayload(input);
  if (!read.ok || read.payload === undefined) {
    return { code: 'ERR-STO-INTEGRITY', message: read.message ?? 'conflicting durable intent could not be classified' };
  }
  const p = read.payload;
  if (p['holdStateGeneration'] !== input.holdStateGeneration || (p['holdResult'] !== 'clear-current-hold-state' && p['holdResult'] !== undefined)) {
    return { outcome: 'hold-blocked', code: 'ERR-STO-RETENTION-DENIED', message: 'hold state changed after intent publication; the durable intent is not current authority' };
  }
  if (p['policyIdentity'] !== input.policyIdentity || p['policyVersion'] !== input.policyVersion) {
    return { outcome: 'policy-blocked', code: 'ERR-STO-RETENTION-DENIED', message: 'retention policy changed after intent publication; the durable intent is not current authority' };
  }
  return { code: 'ERR-STO-INTEGRITY', message: 'existing deletion intent conflicts with the trusted decision; fail closed' };
}

/** Shared trusted-input + store + capability establishment (§15.4 steps 1-4). */
function establishContext(request: RetentionMutationRequest): {
  readonly ok: boolean;
  readonly storeInstance?: VerifiedStoreInstance;
  readonly capability?: RetentionCapability;
  readonly actionIdentity?: string;
  readonly code?: string;
  readonly message?: string;
} {
  const inputResult = createTrustedRetentionRequest(
    request.trustedConfiguration,
    request.retentionActionProvenance,
    { locator: request.locator, serviceUid: request.serviceUid, forbiddenRoots: request.forbiddenRoots, limitProfile: request.limitProfile },
  );
  if (!inputResult.ok || inputResult.request === undefined) {
    const code = inputResult.reason === 'not-genuine-configuration' || inputResult.reason === 'not-genuine-action-provenance' || inputResult.reason === 'configuration-identity-mismatch'
      ? 'ERR-STO-CONFIG-UNAVAILABLE'
      : 'ERR-STO-REQ-INVALID';
    return { ok: false, code, message: inputResult.message ?? 'trusted retention request could not be established' };
  }
  const store = verifyStoreInstance({
    locator: request.locator,
    serviceUid: request.serviceUid,
    forbiddenRoots: request.forbiddenRoots,
    configurationIdentity: (request.trustedConfiguration as { readonly identity: string }).identity,
    configurationVersion: (request.trustedConfiguration as { readonly configurationVersion: string }).configurationVersion,
    limitProfile: request.limitProfile,
  });
  if (!store.ok || store.storeInstance === undefined) {
    return { ok: false, code: store.code ?? 'ERR-STO-INTEGRITY', message: store.message ?? 'store revalidation failed' };
  }
  const storeInstance = store.storeInstance;
  const capability = createRetentionCapability({ trustedRetentionRequest: inputResult.request, storeInstance });
  if (capability === undefined) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'retention capability could not be issued' };
  }
  return { ok: true, storeInstance, capability, actionIdentity: inputResult.request.actionIdentity };
}

/**
 * Record-deletion flow (ADR-035 §5/§6; the §15.4 mutation sequence). The
 * referenced primary record is the `retention-delete-record` target; its
 * audit history survives (no cascade; §15.4 §7).
 */
function executeRecordDeleteMutation(
  request: RetentionMutationRequest,
  action: RecordDeleteAction,
  hooks: NonNullable<RetentionMutationRequest['hooks']>,
): RetentionMutationResult {
  const context = establishContext(request);
  if (!context.ok || context.storeInstance === undefined || context.capability === undefined || context.actionIdentity === undefined) {
    return failResult(context.code ?? 'ERR-STO-REQ-INVALID', context.message ?? 'retention context could not be established');
  }
  const storeInstance = context.storeInstance;
  let capability: RetentionCapability | undefined = context.capability;
  try {
    const profile = storeInstance.limitProfile;
    const recordBytes = profile['recordBytes'] ?? 1024 * 1024;
    const namespaceRoot = `${storeInstance.parentIdentity.canonicalPath}/store-v1`;
    const serviceUid = request.serviceUid;

    // Hold gate (authority adjudication + freshness binding), before any
    // mutation: active/unknown/stale holds prohibit; a stale hold-state
    // generation prohibits.
    const hold = holdGate(request, action.expectedHoldStateGeneration);
    if (!hold.ok) {
      return refusal(hold.code ?? 'ERR-STO-RETENTION-DENIED', hold.message ?? 'hold gate failed', 'hold-blocked');
    }
    const bound = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid,
      limitProfile: profile,
    });
    if (!bound.ok) {
      return failResult('ERR-STO-REQ-INVALID', 'retention capability binding mismatch');
    }
    const targetDerivedPre = deriveRecordRelativePath(action.targetRecordClass, action.targetRecordId);
    if (!targetDerivedPre.ok) {
      return failResult('ERR-STO-CONTAINMENT-DENIED', 'target record path derivation failed');
    }
    // Pre-lock target presence probe + authoritative WP-8-K history
    // derivation for the live-target path (fail fast; re-derived under the
    // lock and after intent publication). An absent target is classified
    // under the lock from the durable intent/completion evidence — the
    // history of an absent target is not re-derivable and is not required
    // for the already-completed and roll-forward states (the durable intent
    // binds the history digest it was adjudicated against).
    const preTarget = verifyRecordObjectAt({ path: `${namespaceRoot}/${targetDerivedPre.relativePath}`, serviceUid, byteLimit: recordBytes });
    if (preTarget.ok && (preTarget.recordId !== action.targetRecordId || preTarget.revision !== action.expectedTargetRevision || preTarget.digest !== action.targetRecordDigest)) {
      return failResult('ERR-STO-INTEGRITY', 'target record identity/revision/digest does not match the trusted decision');
    }
    if (!preTarget.ok && preTarget.code !== 'ERR-STO-NOT-FOUND') {
      return failResult(preTarget.code ?? 'ERR-STO-INTEGRITY', preTarget.message ?? 'target state could not be verified before lock acquisition');
    }
    if (preTarget.ok) {
      const history = deriveHistoryBinding({
        storeInstance,
        namespaceRoot,
        recordClass: action.targetRecordClass,
        recordId: action.targetRecordId,
        revision: action.expectedTargetRevision,
        expectedHistoryDigest: action.expectedHistoryDigest,
        expectedHistoryStatus: action.expectedHistoryStatus,
      });
      if (!history.ok) {
        return refusal(history.code ?? 'ERR-STO-RETENTION-DENIED', history.message ?? 'history binding failed', 'history-incomplete');
      }
    }
    // Registry-mode generation/surface recomputation (the decision snapshot
    // tokens; intent publication does not change them — the evidence class
    // is excluded from the structural token and the generation binds only
    // store/limits facts).
    const tokens = recomputeTokens(storeInstance, namespaceRoot, serviceUid);
    if (tokens.generation !== action.expectedGeneration) {
      return failResult('ERR-STO-REQ-INVALID', 'registry scan generation does not match the trusted decision');
    }
    if (tokens.surfaceGeneration !== action.expectedSurfaceGeneration) {
      return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'store structure changed since the trusted decision');
    }
    const surfaceGeneration = tokens.surfaceGeneration;

    hooks.stage?.('before-writer-lock');
    const locksDir = `${namespaceRoot}/locks`;
    const lockPath = `${locksDir}/writer.lock`;
    const lockWaitMs = profile['lockWait'] ?? 5000;
    const acquired = acquireWriterLock({
      capability,
      operation: 'retention-delete-record',
      lockPath,
      locksDirPath: locksDir,
      storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      actionIdentity: context.actionIdentity,
      lockWaitMs,
      timeSource: request.timeSource,
      hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
    });
    if (!acquired.ok || acquired.record === undefined) {
      return failResult(acquired.code ?? 'ERR-STO-LOCK-UNAVAILABLE', acquired.message ?? 'writer lock could not be acquired');
    }
    const lockRecord = acquired.record;
    hooks.stage?.('after-writer-lock');
    const release = (): RetentionMutationResult => {
      hooks.stage?.('before-writer-lock-release');
      const released = releaseWriterLock({
        capability,
        operation: 'retention-delete-record',
        lockPath,
        locksDirPath: locksDir,
        expected: { nonce: lockRecord.nonce, storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })) },
        timeSource: request.timeSource,
        hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
      });
      if (!released.ok) {
        return failResult('ERR-STO-RECOVERY-FAILED', 'lock release failed; the lock remains for recovery');
      }
      return { ok: true };
    };
    const failClosed = (code: string, message: string): RetentionMutationResult => {
      const released = release();
      if (!released.ok) return released;
      return failResult(code, message);
    };

    // Under-lock re-derivation (steps 7-10 of the §15.4 sequence): hold and
    // policy bindings, generation/surface, authoritative history, target.
    const reHold = holdGate(request, action.expectedHoldStateGeneration);
    if (!reHold.ok) {
      return failClosed(reHold.code ?? 'ERR-STO-RETENTION-DENIED', reHold.message ?? 'hold gate failed under the writer lock');
    }
    const reBound = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid,
      limitProfile: profile,
    });
    if (!reBound.ok) {
      return failClosed('ERR-STO-REQ-INVALID', 'retention capability binding mismatch under the writer lock');
    }
    const reTokens = recomputeTokens(storeInstance, namespaceRoot, serviceUid);
    if (reTokens.generation !== action.expectedGeneration || reTokens.surfaceGeneration !== action.expectedSurfaceGeneration) {
      return failClosed('ERR-STO-ROOT-IDENTITY-CHANGED', 'store structure changed after lock acquisition');
    }
    const targetDerived = deriveRecordRelativePath(action.targetRecordClass, action.targetRecordId);
    if (!targetDerived.ok) {
      return failClosed('ERR-STO-CONTAINMENT-DENIED', 'target record path derivation failed under the writer lock');
    }
    const targetPath = `${namespaceRoot}/${targetDerived.relativePath}`;
    const targetDirPath = targetPath.slice(0, targetPath.lastIndexOf('/'));
    const verified = verifyRecordObjectAt({ path: targetPath, serviceUid, byteLimit: recordBytes });
    if (verified.ok) {
      if (verified.recordId !== action.targetRecordId || verified.revision !== action.expectedTargetRevision || verified.digest !== action.targetRecordDigest) {
        return failClosed('ERR-STO-INTEGRITY', 'target record identity/revision/digest does not match the trusted decision');
      }
    }
    const targetPresent = verified.ok;
    const targetAbsent = verified.code === 'ERR-STO-NOT-FOUND';
    if (!targetPresent && !targetAbsent) {
      return failClosed(verified.code ?? 'ERR-STO-INTEGRITY', verified.message ?? 'target state could not be verified under the writer lock');
    }
    const targetFacts = verified.ok ? { dev: verified.dev ?? 0, ino: verified.ino ?? 0, nlink: verified.nlink ?? 0 } : undefined;
    if (targetPresent) {
      const reHistory = deriveHistoryBinding({
        storeInstance,
        namespaceRoot,
        recordClass: action.targetRecordClass,
        recordId: action.targetRecordId,
        revision: action.expectedTargetRevision,
        expectedHistoryDigest: action.expectedHistoryDigest,
        expectedHistoryStatus: action.expectedHistoryStatus,
      });
      if (!reHistory.ok) {
        return failClosed(reHistory.code ?? 'ERR-STO-RETENTION-DENIED', reHistory.message ?? 'history binding changed under the writer lock');
      }
    }

    // Deterministic intent/completion identities (derived from the trusted
    // decision facts; replay yields identical identities).
    const intentId = computeRetentionRecordIntentIdentity({
      storeInstance,
      retentionOperation: 'retention-delete-record',
      targetRecordClass: action.targetRecordClass,
      targetRecordId: action.targetRecordId,
      targetRecordRevision: action.expectedTargetRevision,
      targetRecordDigest: action.targetRecordDigest,
      policyIdentity: action.expectedPolicyIdentity,
      policyVersion: action.expectedPolicyVersion,
      decisionId: action.expectedDecisionId,
      holdStateGeneration: action.expectedHoldStateGeneration,
      holdResult: action.expectedHoldResult,
      historyDigest: action.expectedHistoryDigest,
      historyStatus: action.expectedHistoryStatus,
    });
    const intentCheck = verifyExistingRetentionRecordIntent({
      namespaceRoot,
      serviceUid,
      byteLimit: recordBytes,
      evidenceId: intentId,
      targetRecordId: action.targetRecordId,
      targetRecordRevision: action.expectedTargetRevision,
      targetRecordDigest: action.targetRecordDigest,
      policyIdentity: action.expectedPolicyIdentity,
      policyVersion: action.expectedPolicyVersion,
      decisionId: action.expectedDecisionId,
      holdStateGeneration: action.expectedHoldStateGeneration,
      holdResult: action.expectedHoldResult,
      historyDigest: action.expectedHistoryDigest,
    });
    if (!intentCheck.ok) {
      const conflict = classifyIntentConflict({
        namespaceRoot,
        serviceUid,
        byteLimit: recordBytes,
        evidenceId: intentId,
        holdStateGeneration: action.expectedHoldStateGeneration,
        policyIdentity: action.expectedPolicyIdentity,
        policyVersion: action.expectedPolicyVersion,
      });
      if (conflict.outcome !== undefined) {
        const released = release();
        if (!released.ok) return released;
        return refusal(conflict.code, conflict.message, conflict.outcome);
      }
      return failClosed(conflict.code, conflict.message);
    }
    const intentPresent = intentCheck.matches === true;
    const completionId = computeRetentionRecordCompletionIdentity({
      storeInstance,
      retentionOperation: 'retention-delete-record',
      intentEvidenceId: intentId,
      targetRecordClass: action.targetRecordClass,
      targetRecordId: action.targetRecordId,
      targetRecordRevision: action.expectedTargetRevision,
      targetRecordDigest: action.targetRecordDigest,
      outcome: 'deleted',
    });
    const completionCheck = verifyExistingRetentionRecordCompletion({
      namespaceRoot,
      serviceUid,
      byteLimit: recordBytes,
      evidenceId: completionId,
      targetRecordClass: action.targetRecordClass,
      targetRecordId: action.targetRecordId,
      targetRecordRevision: action.expectedTargetRevision,
      targetRecordDigest: action.targetRecordDigest,
    });
    if (!completionCheck.ok) {
      return failClosed(completionCheck.code ?? 'ERR-STO-INTEGRITY', completionCheck.message ?? 'existing deletion completion conflicts with the trusted decision');
    }
    const completionPresent = completionCheck.matches === true;

    // Idempotency classification (ADR-035 §6; contract §15.4):
    if (!targetPresent && !intentPresent) {
      return failClosed('ERR-STO-INTEGRITY', 'target absent without durable deletion intent; absence never counts as retention completion');
    }
    if (targetPresent && completionPresent) {
      return failClosed('ERR-STO-INTEGRITY', 'durable deletion completion exists while the exact target is still present; integrity inconsistency');
    }
    if (!targetPresent && intentPresent && completionPresent) {
      const released = release();
      if (!released.ok) return released;
      return { ok: true, outcome: 'already-completed', intentEvidenceId: intentId, completionEvidenceId: completionId };
    }
    const rollForward = !targetPresent && intentPresent && !completionPresent;
    const intentDurable = intentPresent;

    // Decision/time facts for evidence construction (the action identity
    // comes from the genuine provenance; the time is creation evidence).
    const actionIdentity = context.actionIdentity;
    const createdAt = isoFromEpochMs(request.timeSource.now());
    const buildIntent = (): RetentionEvidenceBuild =>
      buildRetentionRecordIntentEvidence({
        storeInstance,
        actionIdentity,
        retentionOperation: 'retention-delete-record',
        targetRecordClass: action.targetRecordClass,
        targetRecordId: action.targetRecordId,
        targetRecordRevision: action.expectedTargetRevision,
        targetRecordDigest: action.targetRecordDigest,
        policyIdentity: action.expectedPolicyIdentity,
        policyVersion: action.expectedPolicyVersion,
        decisionId: action.expectedDecisionId,
        holdStateGeneration: action.expectedHoldStateGeneration,
        holdResult: action.expectedHoldResult,
        historyDigest: action.expectedHistoryDigest,
        historyStatus: action.expectedHistoryStatus,
        generation: action.expectedGeneration,
        surfaceGeneration,
        createdAt,
      });

    // Publish the durable deletion intent (intent precedes any unlink).
    let intentRecord: NonNullable<RetentionEvidenceBuild['record']> | undefined;
    if (!intentDurable) {
      const built = buildIntent();
      if (!built.ok || built.record === undefined) {
        return failClosed(built.code ?? 'ERR-STO-INTERNAL-INVARIANT', built.message ?? 'deletion intent could not be constructed');
      }
      intentRecord = built.record;
      hooks.stage?.('before-intent-publication');
      const published = publishRetentionEvidence({
        capability,
        namespaceRoot,
        serviceUid,
        byteLimit: recordBytes,
        record: intentRecord,
        operation: 'retention-delete-record',
        hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
      });
      if (!published.ok) {
        return failClosed(published.code ?? 'ERR-STO-DURABILITY', published.message ?? 'deletion intent is not durable');
      }
      hooks.stage?.('after-intent-publication');
      hooks.stage?.('after-intent-audit-publication');
    } else {
      // Durable intent: recover its exact canonical digest from the durable
      // object (the completion evidence binds the intent identity and the
      // intent's canonical digest).
      const intentDerived = deriveRecordRelativePath('store-evidence-record', intentId);
      if (!intentDerived.ok) {
        return failClosed('ERR-STO-CONTAINMENT-DENIED', 'durable deletion intent path derivation failed');
      }
      const durableIntent = verifyRecordObjectAt({ path: `${namespaceRoot}/${intentDerived.relativePath}`, serviceUid, byteLimit: recordBytes });
      if (!durableIntent.ok || durableIntent.digest === undefined) {
        return failClosed(durableIntent.code ?? 'ERR-STO-INTEGRITY', durableIntent.message ?? 'durable deletion intent could not be re-verified');
      }
      intentRecord = { recordId: intentId, canonicalUtf8: '', digest: durableIntent.digest, createdAt: '', auditCanonicalUtf8: '', auditDigest: '', auditEventId: '' };
    }

    // Post-intent revalidation (a hold/policy/history change after intent
    // fails closed before any unlink; the intent is never self-executing).
    const postHold = holdGate(request, action.expectedHoldStateGeneration);
    if (!postHold.ok) {
      return failClosed(postHold.code ?? 'ERR-STO-RETENTION-DENIED', postHold.message ?? 'hold state changed after intent publication; deletion fails before unlink');
    }
    const postBound = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid,
      limitProfile: profile,
    });
    if (!postBound.ok) {
      return failClosed('ERR-STO-REQ-INVALID', 'retention capability invalidated after intent publication; deletion fails before unlink');
    }
    const postTarget = verifyRecordObjectAt({ path: targetPath, serviceUid, byteLimit: recordBytes });
    if (!rollForward && (!postTarget.ok || postTarget.recordId !== action.targetRecordId || postTarget.revision !== action.expectedTargetRevision || postTarget.digest !== action.targetRecordDigest)) {
      return failClosed('ERR-STO-INTEGRITY', 'target changed after intent publication; the replacement is never deleted');
    }
    if (!rollForward) {
      const postHistory = deriveHistoryBinding({
        storeInstance,
        namespaceRoot,
        recordClass: action.targetRecordClass,
        recordId: action.targetRecordId,
        revision: action.expectedTargetRevision,
        expectedHistoryDigest: action.expectedHistoryDigest,
        expectedHistoryStatus: action.expectedHistoryStatus,
      });
      if (!postHistory.ok) {
        return failClosed(postHistory.code ?? 'ERR-STO-RETENTION-DENIED', postHistory.message ?? 'history changed after intent publication; deletion fails before unlink');
      }
    }
    hooks.stage?.('after-post-intent-revalidation');

    // Exact unlink (roll-forward skips the unlink; the absence is made
    // durable by the directory fsync below).
    if (!rollForward) {
      hooks.stage?.('before-target-unlink');
      const unlinked = unlinkVerifiedRecordObject({
        targetPath,
        serviceUid,
        byteLimit: recordBytes,
        expected: targetFacts ?? { dev: 0, ino: 0, nlink: 0 },
        expectedDigest: action.targetRecordDigest,
      });
      if (!unlinked.ok) {
        return failClosed(unlinked.code ?? 'ERR-STO-INTEGRITY', unlinked.message ?? 'exact unlink failed');
      }
      hooks.stage?.('after-target-unlink');
    }
    hooks.stage?.('before-directory-fsync');
    const dirFsync = fsyncRetentionDirectory({
      directoryPath: targetDirPath,
      serviceUid,
      hooks: { fsyncDirectory: hooks.fsyncDirectory },
    });
    if (!dirFsync.ok) {
      return failClosed(dirFsync.code ?? 'ERR-STO-DURABILITY', dirFsync.message ?? 'containing directory fsync failed');
    }
    hooks.stage?.('after-directory-fsync');
    const absent = verifyRecordObjectAt({ path: targetPath, serviceUid, byteLimit: recordBytes });
    if (absent.ok) {
      return failClosed('ERR-STO-INTEGRITY', 'target reappeared after unlink; fail closed');
    }
    if (absent.code !== 'ERR-STO-NOT-FOUND') {
      return failClosed(absent.code ?? 'ERR-STO-INTEGRITY', absent.message ?? 'target absence could not be verified');
    }

    // Durable deletion completion evidence (after the unlink and directory
    // fsync; the durable proof required before any later audit deletion).
    const completionCreatedAt = isoFromEpochMs(request.timeSource.now());
    const completionBuilt = buildRetentionRecordCompletionEvidence({
      storeInstance,
      actionIdentity,
      retentionOperation: 'retention-delete-record',
      intentEvidenceId: intentId,
      intentEvidenceDigest: intentRecord.digest,
      targetRecordClass: action.targetRecordClass,
      targetRecordId: action.targetRecordId,
      targetRecordRevision: action.expectedTargetRevision,
      targetRecordDigest: action.targetRecordDigest,
      policyIdentity: action.expectedPolicyIdentity,
      policyVersion: action.expectedPolicyVersion,
      decisionId: action.expectedDecisionId,
      holdStateGeneration: action.expectedHoldStateGeneration,
      holdResult: action.expectedHoldResult,
      historyDigest: action.expectedHistoryDigest,
      outcome: 'deleted',
      generation: action.expectedGeneration,
      surfaceGeneration,
      createdAt: completionCreatedAt,
    });
    if (!completionBuilt.ok || completionBuilt.record === undefined) {
      return failClosed(completionBuilt.code ?? 'ERR-STO-INTERNAL-INVARIANT', completionBuilt.message ?? 'deletion completion could not be constructed');
    }
    hooks.stage?.('before-completion-publication');
    const completionPublished = publishRetentionEvidence({
      capability,
      namespaceRoot,
      serviceUid,
      byteLimit: recordBytes,
      record: completionBuilt.record,
      operation: 'retention-delete-record',
      hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
    });
    if (!completionPublished.ok) {
      return failClosed(completionPublished.code ?? 'ERR-STO-DURABILITY', completionPublished.message ?? 'deletion completion is not durable');
    }
    hooks.stage?.('after-completion-publication');
    hooks.stage?.('after-completion-audit-publication');

    // Verify every required durability point (intent, completion, audits,
    // absence) before success. The durable-intent path re-verified the
    // intent object above; the fresh path verifies the intent + audit.
    if (!intentDurable && intentRecord !== undefined) {
      const intentDurableCheck = verifyRetentionEvidenceDurability({
        namespaceRoot,
        serviceUid,
        byteLimit: recordBytes,
        record: intentRecord,
      });
      if (!intentDurableCheck.ok) {
        return failClosed(intentDurableCheck.code ?? 'ERR-STO-DURABILITY', intentDurableCheck.message ?? 'deletion intent durability point is not verified');
      }
    }
    const completionDurableCheck = verifyRetentionEvidenceDurability({
      namespaceRoot,
      serviceUid,
      byteLimit: recordBytes,
      record: completionBuilt.record,
    });
    if (!completionDurableCheck.ok) {
      return failClosed(completionDurableCheck.code ?? 'ERR-STO-DURABILITY', completionDurableCheck.message ?? 'deletion completion durability point is not verified');
    }
    const finalAbsent = verifyRecordObjectAt({ path: targetPath, serviceUid, byteLimit: recordBytes });
    if (finalAbsent.ok) {
      return failClosed('ERR-STO-INTEGRITY', 'target is present at the final durability verification; fail closed');
    }
    const beforeSuccess = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid,
      limitProfile: profile,
    });
    if (!beforeSuccess.ok) {
      return failClosed('ERR-STO-DURABILITY', 'capability invalidated before acknowledgement; deletion intent and completion are durable');
    }
    const rootRevalidated = revalidateParentIdentity(storeInstance.parentIdentity, serviceUid);
    if (!rootRevalidated.ok) {
      return failClosed(rootRevalidated.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', rootRevalidated.message ?? 'trusted parent identity changed');
    }
    const released = release();
    if (!released.ok) return released;
    return { ok: true, outcome: 'deleted', intentEvidenceId: intentId, completionEvidenceId: completionId };
  } finally {
    capability?.dispose();
  }
}

/**
 * Audit-deletion flow (ADR-035 §8; §15.4 §8/§16). The exact audit event is
 * deleted only when: the referenced retention-deletable primary is absent;
 * durable retention-delete-record completion evidence exists for that exact
 * referenced record (class/identity/digest); the audit's own retention
 * decision and hold state are valid; and the audit event's association is
 * verified. Each audit deletion is exact and independently authorized —
 * never a cascade.
 */
function executeAuditDeleteMutation(
  request: RetentionMutationRequest,
  action: AuditDeleteAction,
  hooks: NonNullable<RetentionMutationRequest['hooks']>,
): RetentionMutationResult {
  const referencedRecordId = action.referencedRecordId;
  const referencedRecordDigest = action.referencedRecordDigest;
  const referencedRecordClass = action.referencedRecordClass;
  const completionId = action.expectedPrimaryDeletionCompletionEvidenceId;

  const context = establishContext(request);
  if (!context.ok || context.storeInstance === undefined || context.capability === undefined || context.actionIdentity === undefined) {
    return failResult(context.code ?? 'ERR-STO-REQ-INVALID', context.message ?? 'retention context could not be established');
  }
  const storeInstance = context.storeInstance;
  let capability: RetentionCapability | undefined = context.capability;
  try {
    const profile = storeInstance.limitProfile;
    const recordBytes = profile['recordBytes'] ?? 1024 * 1024;
    const namespaceRoot = `${storeInstance.parentIdentity.canonicalPath}/store-v1`;
    const serviceUid = request.serviceUid;
    const hold = holdGate(request, action.expectedHoldStateGeneration);
    if (!hold.ok) {
      return refusal(hold.code ?? 'ERR-STO-RETENTION-DENIED', hold.message ?? 'hold gate failed', 'hold-blocked');
    }
    const bound = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid,
      limitProfile: profile,
    });
    if (!bound.ok) {
      return failResult('ERR-STO-REQ-INVALID', 'retention capability binding mismatch');
    }
    // Pre-lock audit-target presence probe: the exact audit event and its
    // association are verified only when the target is live (fail fast). An
    // absent target is classified under the lock from the durable
    // intent/completion evidence (already-completed and roll-forward states
    // do not re-derive the deleted audit event).
    const auditDerivedPre = deriveRecordRelativePath('authoritative-audit-event', action.targetRecordId);
    if (!auditDerivedPre.ok) {
      return failResult('ERR-STO-CONTAINMENT-DENIED', 'audit target path derivation failed');
    }
    const preAudit = verifyRecordObjectAt({ path: `${namespaceRoot}/${auditDerivedPre.relativePath}`, serviceUid, byteLimit: recordBytes });
    if (!preAudit.ok && preAudit.code !== 'ERR-STO-NOT-FOUND') {
      return failResult(preAudit.code ?? 'ERR-STO-INTEGRITY', preAudit.message ?? 'audit target state could not be verified before lock acquisition');
    }
    if (preAudit.ok) {
      // Exact audit-target verification + association + primary-absence +
      // primary-deletion-completion gates (pre-lock; re-derived under lock).
      const auditGate = verifyAuditTargetAndAssociation({
        namespaceRoot,
        serviceUid,
        byteLimit: recordBytes,
        targetRecordId: action.targetRecordId,
        targetRecordRevision: action.expectedTargetRevision,
        targetRecordDigest: action.targetRecordDigest,
        referencedRecordId,
        referencedRecordDigest,
        referencedRecordClass,
      });
      if (!auditGate.ok) {
        return failResult(auditGate.code ?? 'ERR-STO-INTEGRITY', auditGate.message ?? 'audit target or association verification failed');
      }
      const primaryCompletionGate = verifyPrimaryDeletionCompletion({
        namespaceRoot,
        serviceUid,
        byteLimit: recordBytes,
        evidenceId: completionId,
        targetRecordClass: referencedRecordClass,
        targetRecordId: referencedRecordId,
        targetRecordDigest: referencedRecordDigest,
      });
      if (!primaryCompletionGate.ok) {
        return failResult(primaryCompletionGate.code ?? 'ERR-STO-RETENTION-DENIED', primaryCompletionGate.message ?? 'primary deletion completion gate failed');
      }
    }
    const tokens = recomputeTokens(storeInstance, namespaceRoot, serviceUid);
    if (tokens.generation !== action.expectedGeneration) {
      return failResult('ERR-STO-REQ-INVALID', 'registry scan generation does not match the trusted decision');
    }
    if (tokens.surfaceGeneration !== action.expectedSurfaceGeneration) {
      return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'store structure changed since the trusted decision');
    }
    const surfaceGeneration = tokens.surfaceGeneration;

    hooks.stage?.('before-writer-lock');
    const locksDir = `${namespaceRoot}/locks`;
    const lockPath = `${locksDir}/writer.lock`;
    const lockWaitMs = profile['lockWait'] ?? 5000;
    const acquired = acquireWriterLock({
      capability,
      operation: 'retention-delete-audit',
      lockPath,
      locksDirPath: locksDir,
      storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      actionIdentity: context.actionIdentity,
      lockWaitMs,
      timeSource: request.timeSource,
      hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
    });
    if (!acquired.ok || acquired.record === undefined) {
      return failResult(acquired.code ?? 'ERR-STO-LOCK-UNAVAILABLE', acquired.message ?? 'writer lock could not be acquired');
    }
    const lockRecord = acquired.record;
    hooks.stage?.('after-writer-lock');
    const release = (): RetentionMutationResult => {
      hooks.stage?.('before-writer-lock-release');
      const released = releaseWriterLock({
        capability,
        operation: 'retention-delete-audit',
        lockPath,
        locksDirPath: locksDir,
        expected: { nonce: lockRecord.nonce, storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })) },
        timeSource: request.timeSource,
        hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
      });
      if (!released.ok) {
        return failResult('ERR-STO-RECOVERY-FAILED', 'lock release failed; the lock remains for recovery');
      }
      return { ok: true };
    };
    const failClosed = (code: string, message: string): RetentionMutationResult => {
      const released = release();
      if (!released.ok) return released;
      return failResult(code, message);
    };

    // Under-lock re-derivation of every gate.
    const reHold = holdGate(request, action.expectedHoldStateGeneration);
    if (!reHold.ok) {
      return failClosed(reHold.code ?? 'ERR-STO-RETENTION-DENIED', reHold.message ?? 'hold gate failed under the writer lock');
    }
    const reBound = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid,
      limitProfile: profile,
    });
    if (!reBound.ok) {
      return failClosed('ERR-STO-REQ-INVALID', 'retention capability binding mismatch under the writer lock');
    }
    const auditVerified = verifyRecordObjectAt({ path: `${namespaceRoot}/${auditDerivedPre.relativePath}`, serviceUid, byteLimit: recordBytes });
    const auditPresent = auditVerified.ok && auditVerified.recordId === action.targetRecordId && auditVerified.digest === action.targetRecordDigest && auditVerified.revision === action.expectedTargetRevision;
    if (auditVerified.ok && !auditPresent) {
      return failClosed('ERR-STO-INTEGRITY', 'audit target identity/revision/digest does not match the trusted decision');
    }
    if (!auditVerified.ok && auditVerified.code !== 'ERR-STO-NOT-FOUND') {
      return failClosed(auditVerified.code ?? 'ERR-STO-INTEGRITY', auditVerified.message ?? 'audit target state could not be verified under the writer lock');
    }
    if (auditPresent) {
      const reAuditGate = verifyAuditTargetAndAssociation({
        namespaceRoot,
        serviceUid,
        byteLimit: recordBytes,
        targetRecordId: action.targetRecordId,
        targetRecordRevision: action.expectedTargetRevision,
        targetRecordDigest: action.targetRecordDigest,
        referencedRecordId,
        referencedRecordDigest,
        referencedRecordClass,
      });
      if (!reAuditGate.ok) {
        return failClosed(reAuditGate.code ?? 'ERR-STO-INTEGRITY', reAuditGate.message ?? 'audit target or association changed under the writer lock');
      }
    }
    const rePrimaryGate = verifyPrimaryDeletionCompletion({
      namespaceRoot,
      serviceUid,
      byteLimit: recordBytes,
      evidenceId: completionId,
      targetRecordClass: referencedRecordClass,
      targetRecordId: referencedRecordId,
      targetRecordDigest: referencedRecordDigest,
    });
    if (!rePrimaryGate.ok) {
      return failClosed(rePrimaryGate.code ?? 'ERR-STO-RETENTION-DENIED', rePrimaryGate.message ?? 'primary deletion completion changed under the writer lock');
    }
    const reTokens = recomputeTokens(storeInstance, namespaceRoot, serviceUid);
    if (reTokens.generation !== action.expectedGeneration || reTokens.surfaceGeneration !== action.expectedSurfaceGeneration) {
      return failClosed('ERR-STO-ROOT-IDENTITY-CHANGED', 'store structure changed after lock acquisition');
    }
    const auditPath = `${namespaceRoot}/${auditDerivedPre.relativePath}`;
    const auditDirPath = auditPath.slice(0, auditPath.lastIndexOf('/'));
    const auditFacts = auditPresent ? { dev: auditVerified.dev ?? 0, ino: auditVerified.ino ?? 0, nlink: auditVerified.nlink ?? 0 } : undefined;

    const intentId = computeRetentionAuditIntentIdentity({
      storeInstance,
      retentionOperation: 'retention-delete-audit',
      targetRecordClass: 'authoritative-audit-event',
      targetRecordId: action.targetRecordId,
      targetRecordRevision: action.expectedTargetRevision,
      targetRecordDigest: action.targetRecordDigest,
      referencedRecordId,
      referencedRecordDigest,
      primaryDeletionCompletionEvidenceId: completionId,
      policyIdentity: action.expectedPolicyIdentity,
      policyVersion: action.expectedPolicyVersion,
      decisionId: action.expectedDecisionId,
      holdStateGeneration: action.expectedHoldStateGeneration,
      holdResult: action.expectedHoldResult,
    });
    const intentCheck = verifyExistingRetentionAuditIntent({
      namespaceRoot,
      serviceUid,
      byteLimit: recordBytes,
      evidenceId: intentId,
      targetRecordId: action.targetRecordId,
      targetRecordRevision: action.expectedTargetRevision,
      targetRecordDigest: action.targetRecordDigest,
      referencedRecordId,
      referencedRecordDigest,
      primaryDeletionCompletionEvidenceId: completionId,
      policyIdentity: action.expectedPolicyIdentity,
      policyVersion: action.expectedPolicyVersion,
      decisionId: action.expectedDecisionId,
      holdStateGeneration: action.expectedHoldStateGeneration,
      holdResult: action.expectedHoldResult,
    });
    if (!intentCheck.ok) {
      const conflict = classifyIntentConflict({
        namespaceRoot,
        serviceUid,
        byteLimit: recordBytes,
        evidenceId: intentId,
        holdStateGeneration: action.expectedHoldStateGeneration,
        policyIdentity: action.expectedPolicyIdentity,
        policyVersion: action.expectedPolicyVersion,
      });
      if (conflict.outcome !== undefined) {
        const released = release();
        if (!released.ok) return released;
        return refusal(conflict.code, conflict.message, conflict.outcome);
      }
      return failClosed(conflict.code, conflict.message);
    }
    const intentPresent = intentCheck.matches === true;
    const completionIdAudit = computeRetentionAuditCompletionIdentity({
      storeInstance,
      retentionOperation: 'retention-delete-audit',
      intentEvidenceId: intentId,
      targetRecordClass: 'authoritative-audit-event',
      targetRecordId: action.targetRecordId,
      targetRecordRevision: action.expectedTargetRevision,
      targetRecordDigest: action.targetRecordDigest,
      outcome: 'deleted',
    });
    const completionCheck = verifyExistingRetentionAuditCompletion({
      namespaceRoot,
      serviceUid,
      byteLimit: recordBytes,
      evidenceId: completionIdAudit,
      intentEvidenceId: intentId,
      targetRecordId: action.targetRecordId,
      targetRecordRevision: action.expectedTargetRevision,
      targetRecordDigest: action.targetRecordDigest,
      referencedRecordId,
      referencedRecordDigest,
      primaryDeletionCompletionEvidenceId: completionId,
    });
    if (!completionCheck.ok) {
      return failClosed(completionCheck.code ?? 'ERR-STO-INTEGRITY', completionCheck.message ?? 'existing audit deletion completion conflicts with the trusted decision');
    }
    const completionPresent = completionCheck.matches === true;

    if (!auditPresent && !intentPresent) {
      return failClosed('ERR-STO-INTEGRITY', 'audit target absent without durable deletion intent; absence never counts as retention completion');
    }
    if (auditPresent && completionPresent) {
      return failClosed('ERR-STO-INTEGRITY', 'durable audit deletion completion exists while the exact audit target is still present; integrity inconsistency');
    }
    if (!auditPresent && intentPresent && completionPresent) {
      const released = release();
      if (!released.ok) return released;
      return { ok: true, outcome: 'already-completed', intentEvidenceId: intentId, completionEvidenceId: completionIdAudit };
    }
    const rollForward = !auditPresent && intentPresent && !completionPresent;
    const intentDurable = intentPresent;

    const actionIdentity = context.actionIdentity;
    const createdAt = isoFromEpochMs(request.timeSource.now());
    const buildIntent = (): RetentionEvidenceBuild =>
      buildRetentionAuditIntentEvidence({
        storeInstance,
        actionIdentity,
        retentionOperation: 'retention-delete-audit',
        targetRecordClass: 'authoritative-audit-event',
        targetRecordId: action.targetRecordId,
        targetRecordRevision: action.expectedTargetRevision,
        targetRecordDigest: action.targetRecordDigest,
        referencedRecordId,
        referencedRecordDigest,
        primaryDeletionCompletionEvidenceId: completionId,
        policyIdentity: action.expectedPolicyIdentity,
        policyVersion: action.expectedPolicyVersion,
        decisionId: action.expectedDecisionId,
        holdStateGeneration: action.expectedHoldStateGeneration,
        holdResult: action.expectedHoldResult,
        generation: action.expectedGeneration,
        surfaceGeneration,
        createdAt,
      });

    let intentRecord: NonNullable<RetentionEvidenceBuild['record']> | undefined;
    if (!intentDurable) {
      const built = buildIntent();
      if (!built.ok || built.record === undefined) {
        return failClosed(built.code ?? 'ERR-STO-INTERNAL-INVARIANT', built.message ?? 'audit deletion intent could not be constructed');
      }
      intentRecord = built.record;
      hooks.stage?.('before-intent-publication');
      const published = publishRetentionEvidence({
        capability,
        namespaceRoot,
        serviceUid,
        byteLimit: recordBytes,
        record: intentRecord,
        operation: 'retention-delete-audit',
        hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
      });
      if (!published.ok) {
        return failClosed(published.code ?? 'ERR-STO-DURABILITY', published.message ?? 'audit deletion intent is not durable');
      }
      hooks.stage?.('after-intent-publication');
      hooks.stage?.('after-intent-audit-publication');
    } else {
      const intentDerived = deriveRecordRelativePath('store-evidence-record', intentId);
      if (!intentDerived.ok) {
        return failClosed('ERR-STO-CONTAINMENT-DENIED', 'durable audit deletion intent path derivation failed');
      }
      const durableIntent = verifyRecordObjectAt({ path: `${namespaceRoot}/${intentDerived.relativePath}`, serviceUid, byteLimit: recordBytes });
      if (!durableIntent.ok || durableIntent.digest === undefined) {
        return failClosed(durableIntent.code ?? 'ERR-STO-INTEGRITY', durableIntent.message ?? 'durable audit deletion intent could not be re-verified');
      }
      intentRecord = { recordId: intentId, canonicalUtf8: '', digest: durableIntent.digest, createdAt: '', auditCanonicalUtf8: '', auditDigest: '', auditEventId: '' };
    }

    // Post-intent revalidation (hold/policy/association changes fail closed
    // before the unlink).
    const postHold = holdGate(request, action.expectedHoldStateGeneration);
    if (!postHold.ok) {
      return failClosed(postHold.code ?? 'ERR-STO-RETENTION-DENIED', postHold.message ?? 'hold state changed after intent publication; deletion fails before unlink');
    }
    const postBound = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid,
      limitProfile: profile,
    });
    if (!postBound.ok) {
      return failClosed('ERR-STO-REQ-INVALID', 'retention capability invalidated after intent publication; deletion fails before unlink');
    }
    const postAudit = verifyRecordObjectAt({ path: auditPath, serviceUid, byteLimit: recordBytes });
    if (!rollForward && (!postAudit.ok || postAudit.recordId !== action.targetRecordId || postAudit.revision !== action.expectedTargetRevision || postAudit.digest !== action.targetRecordDigest)) {
      return failClosed('ERR-STO-INTEGRITY', 'audit target changed after intent publication; the replacement is never deleted');
    }
    const postPrimaryGate = verifyPrimaryDeletionCompletion({
      namespaceRoot,
      serviceUid,
      byteLimit: recordBytes,
      evidenceId: completionId,
      targetRecordClass: referencedRecordClass,
      targetRecordId: referencedRecordId,
      targetRecordDigest: referencedRecordDigest,
    });
    if (!postPrimaryGate.ok) {
      return failClosed(postPrimaryGate.code ?? 'ERR-STO-RETENTION-DENIED', postPrimaryGate.message ?? 'primary deletion completion changed after intent publication');
    }
    hooks.stage?.('after-post-intent-revalidation');

    if (!rollForward) {
      hooks.stage?.('before-target-unlink');
      const unlinked = unlinkVerifiedRecordObject({
        targetPath: auditPath,
        serviceUid,
        byteLimit: recordBytes,
        expected: auditFacts ?? { dev: 0, ino: 0, nlink: 0 },
        expectedDigest: action.targetRecordDigest,
      });
      if (!unlinked.ok) {
        return failClosed(unlinked.code ?? 'ERR-STO-INTEGRITY', unlinked.message ?? 'exact audit unlink failed');
      }
      hooks.stage?.('after-target-unlink');
    }
    hooks.stage?.('before-directory-fsync');
    const dirFsync = fsyncRetentionDirectory({
      directoryPath: auditDirPath,
      serviceUid,
      hooks: { fsyncDirectory: hooks.fsyncDirectory },
    });
    if (!dirFsync.ok) {
      return failClosed(dirFsync.code ?? 'ERR-STO-DURABILITY', dirFsync.message ?? 'containing directory fsync failed');
    }
    hooks.stage?.('after-directory-fsync');
    const absent = verifyRecordObjectAt({ path: auditPath, serviceUid, byteLimit: recordBytes });
    if (absent.ok) {
      return failClosed('ERR-STO-INTEGRITY', 'audit target reappeared after unlink; fail closed');
    }
    if (absent.code !== 'ERR-STO-NOT-FOUND') {
      return failClosed(absent.code ?? 'ERR-STO-INTEGRITY', absent.message ?? 'audit target absence could not be verified');
    }

    const completionCreatedAt = isoFromEpochMs(request.timeSource.now());
    const completionBuilt = buildRetentionAuditCompletionEvidence({
      storeInstance,
      actionIdentity,
      retentionOperation: 'retention-delete-audit',
      intentEvidenceId: intentId,
      intentEvidenceDigest: intentRecord.digest,
      targetRecordClass: 'authoritative-audit-event',
      targetRecordId: action.targetRecordId,
      targetRecordRevision: action.expectedTargetRevision,
      targetRecordDigest: action.targetRecordDigest,
      referencedRecordId,
      referencedRecordDigest,
      primaryDeletionCompletionEvidenceId: completionId,
      policyIdentity: action.expectedPolicyIdentity,
      policyVersion: action.expectedPolicyVersion,
      decisionId: action.expectedDecisionId,
      holdStateGeneration: action.expectedHoldStateGeneration,
      holdResult: action.expectedHoldResult,
      outcome: 'deleted',
      generation: action.expectedGeneration,
      surfaceGeneration,
      createdAt: completionCreatedAt,
    });
    if (!completionBuilt.ok || completionBuilt.record === undefined) {
      return failClosed(completionBuilt.code ?? 'ERR-STO-INTERNAL-INVARIANT', completionBuilt.message ?? 'audit deletion completion could not be constructed');
    }
    hooks.stage?.('before-completion-publication');
    const completionPublished = publishRetentionEvidence({
      capability,
      namespaceRoot,
      serviceUid,
      byteLimit: recordBytes,
      record: completionBuilt.record,
      operation: 'retention-delete-audit',
      hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
    });
    if (!completionPublished.ok) {
      return failClosed(completionPublished.code ?? 'ERR-STO-DURABILITY', completionPublished.message ?? 'audit deletion completion is not durable');
    }
    hooks.stage?.('after-completion-publication');
    hooks.stage?.('after-completion-audit-publication');

    if (!intentDurable && intentRecord !== undefined) {
      const intentDurableCheck = verifyRetentionEvidenceDurability({
        namespaceRoot,
        serviceUid,
        byteLimit: recordBytes,
        record: intentRecord,
      });
      if (!intentDurableCheck.ok) {
        return failClosed(intentDurableCheck.code ?? 'ERR-STO-DURABILITY', intentDurableCheck.message ?? 'audit deletion intent durability point is not verified');
      }
    }
    const completionDurableCheck = verifyRetentionEvidenceDurability({
      namespaceRoot,
      serviceUid,
      byteLimit: recordBytes,
      record: completionBuilt.record,
    });
    if (!completionDurableCheck.ok) {
      return failClosed(completionDurableCheck.code ?? 'ERR-STO-DURABILITY', completionDurableCheck.message ?? 'audit deletion completion durability point is not verified');
    }
    const finalAbsent = verifyRecordObjectAt({ path: auditPath, serviceUid, byteLimit: recordBytes });
    if (finalAbsent.ok) {
      return failClosed('ERR-STO-INTEGRITY', 'audit target is present at the final durability verification; fail closed');
    }
    const beforeSuccess = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid,
      limitProfile: profile,
    });
    if (!beforeSuccess.ok) {
      return failClosed('ERR-STO-DURABILITY', 'capability invalidated before acknowledgement; audit deletion intent and completion are durable');
    }
    const rootRevalidated = revalidateParentIdentity(storeInstance.parentIdentity, serviceUid);
    if (!rootRevalidated.ok) {
      return failClosed(rootRevalidated.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', rootRevalidated.message ?? 'trusted parent identity changed');
    }
    const released = release();
    if (!released.ok) return released;
    return { ok: true, outcome: 'deleted', intentEvidenceId: intentId, completionEvidenceId: completionIdAudit };
  } finally {
    capability?.dispose();
  }
}

/** Authorized retention-mutation dispatch (closed vocabulary; §15.4). */
export function executeRetentionMutation(request: RetentionMutationRequest): RetentionMutationResult {
  const validation = validateAction(request);
  if (!validation.ok) {
    return failResult(validation.code ?? 'ERR-STO-REQ-INVALID', validation.message ?? 'retention action validation failed');
  }
  const hooks = request.hooks ?? {};
  if (request.action.category === 'retention-delete-record') {
    return executeRecordDeleteMutation(request, request.action as RecordDeleteAction, hooks);
  }
  return executeAuditDeleteMutation(request, request.action as AuditDeleteAction, hooks);
}
