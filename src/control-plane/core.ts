/**
 * WP-12 Slice 1 — transport-free approval and issuance decision core.
 *
 * Implements exactly the trusted-local operations per the committed
 * WP-12 pre-implementation contract baseline:
 *
 *   recordValidation — records an ACCEPTED WP-4 validation run as a
 *                      ValidationRecord (assessment by WP-4; recording by
 *                      WP-12; never a caller-authored outcome);
 *   approve          — one ApprovalRecord for an exact validated canonical
 *                      subject, workspace, purpose, registry context, and
 *                      ValidationRecord correlation (LFC-001/002 via the
 *                      accepted WP-4 lifecycle graph);
 *   issue            — one IssuanceRecord bound to the current matching
 *                      ApprovalRecord (LFC-003 via the accepted graph);
 *   revoke (2A)      — one append-only RevocationRecord per accepted
 *                      duplicate/subsumption semantics;
 *   verifyCurrentLifecycleState (2B) — READ-ONLY non-authorizing current-
 *                      state evaluation (no lock, no mutation, no audit).
 *
 * Fail-closed, deterministic, redacted. Lifecycle state exists only in the
 * WP-8 trusted store; no project file, Git, MCP, execution, or transport
 * capability exists in this module family. The only mutation path is the
 * injected WP-8 store boundary (`publishRecord` unchanged, with its
 * mechanical authorized-write audit; no AuthoritativeAuditEvent
 * publication). Decision serialization is host-side / process-level only
 * (FSCR-W12-001); approver authority is structural (SCR-W12-003).
 *
 * This module is I/O-free: all persistence and serialization enter through
 * the injected host context.
 */
import { createSchemaRegistry, validateLifecycleRecord, evaluatePointOfUseEligibility } from '../api/validate.js';
import { brandValidatedRecord } from '../api/types.js';
import { isBrandedArtifact } from '../internal/snapshot.js';
import { isGenuineValidatedTrustedWorkspaceConfiguration } from '../trusted/configuration-brand.js';
import { lookupValidatedWorkspace } from '../trusted/index.js';
import { isKnownCapability } from '../trusted/capabilities.js';
import type { PublishRecordResult, RecordClassId } from '../storage/types.js';
import { captureSlice1Request, subjectMatchesCanonical, timestampAtOrBefore, isAcceptedTimestamp } from './subject.js';
import { validateEvidenceForm, correlateValidationEvidence } from './evidence.js';
import { buildValidationRecordPayload, buildApprovalRecordPayload, buildIssuanceRecordPayload, buildRevocationRecordPayload, buildRuntimeGrantPayload, buildActivationRecordPayload, buildExecutionOccurrenceRecordPayload, buildExecutionAttemptRecordPayload, sameDecision } from './records.js';
import { evaluateCandidateLifecycleRecord, mapGraphFindings, mapGrantGraphFindings, mapActivationGraphFindings, mapAttemptGraphFindings, artifactModelMaps, mapVerificationFindings } from './graph.js';
import { LockContentionError } from './coordination.js';
import type { ConsumerSupportDeclaration } from '../api/types.js';
import type {
  CanonicalSubject,
  ControlPlaneTrustedContext,
  Slice1Failure,
  Slice1FailureCategory,
  Slice1Request,
  Slice1Result,
  Slice1Success,
} from './types.js';
import {
  ACTIVATION_LIMIT_MAX,
  ACTIVATION_LIMIT_MIN,
  ACTIVATION_RECORD_CLASS,
  APPROVAL_OPERATE_CAPABILITY,
  ARTIFACT_PROTOCOL_ID,
  EXECUTION_ATTEMPT_RECORD_CLASS,
  EXECUTION_OCCURRENCE_RECORD_CLASS,
  LIFECYCLE_ISSUE_CAPABILITY,
  REVOCATION_RECORD_CLASS,
  RUNTIME_GRANT_CLASS,
  SLICE_1_PURPOSES,
  SLICE_1_USE_CLASSES,
} from './types.js';

const MESSAGES: Readonly<Record<Slice1FailureCategory, string>> = {
  'request-invalid': 'the Slice-1 request is malformed or hostile',
  'subject-invalid': 'the subject does not correlate with the accepted validation evidence',
  'subject-not-validated': 'the subject lacks an accepted passing validation record',
  'approver-not-independent': 'the request attempted to assert or transport the trusted operator role',
  'eligibility-denied': 'the requested lifecycle decision is not eligible under the accepted lifecycle rules',
  'ceiling-denied': 'the requested lifecycle decision exceeds the configured capability ceiling',
  'lifecycle-state-missing': 'required trusted lifecycle state is missing',
  'lifecycle-conflict': 'the requested lifecycle decision conflicts with existing trusted state',
  'already-approved': 'an identical approval record already exists',
  'approval-revoked': 'the matching approval is revoked',
  'issuance-not-authorized': 'issuance requires a current matching approval',
  'already-issued': 'an identical issuance record already exists',
  'occurrence-conflict': 'the reserved occurrence identity conflicts with existing trusted state',
  'attempt-ordinal-conflict': 'the attempt ordinal conflicts with the occurrence attempt sequence or allowance',
  'replay-denied': 'the lifecycle decision for this reservation was already made',
  'registry-context-mismatch': 'the record registry context does not match the accepted registry snapshot',
  'store-failure': 'the trusted store could not complete the operation',
  'lock-conflict': 'another decision for the same lifecycle key is in progress',
  'internal-failure': 'an internal invariant failure occurred',
};

function failure(category: Slice1FailureCategory, code?: string): Slice1Failure {
  return Object.freeze({
    ok: false,
    category,
    code: code ?? `ERR-CP-${category.toUpperCase()}`,
    message: MESSAGES[category],
  });
}

function success(outcome: Slice1Success['outcome'], evidence: Slice1Success['evidence']): Slice1Success {
  return Object.freeze({ ok: true, outcome, evidence: Object.freeze(evidence) });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStoreBoundary(context: ControlPlaneTrustedContext): boolean {
  return (
    isRecord(context.store) &&
    typeof context.store.publishLifecycleRecord === 'function' &&
    typeof context.store.readLifecyclePayload === 'function' &&
    typeof context.store.enumerateLifecycleRecords === 'function'
  );
}
/** Host-context integrity gate (fail closed; request operands never reach it). */
function validateHostContext(context: unknown): context is ControlPlaneTrustedContext {
  if (!isRecord(context)) return false;
  if (!isGenuineValidatedTrustedWorkspaceConfiguration(context['configuration'])) return false;
  const registry = context['registry'];
  if (!isRecord(registry) || typeof registry['registrySnapshotId'] !== 'string' || typeof registry['registrySnapshotDigest'] !== 'string') return false;
  const operator = context['operator'];
  if (!isRecord(operator) || typeof operator['approverRole'] !== 'boolean' || typeof operator['issuerRole'] !== 'boolean') return false;
  const store = context['store'];
  if (!isRecord(store) || typeof store['publishLifecycleRecord'] !== 'function' || typeof store['readLifecyclePayload'] !== 'function' || typeof store['enumerateLifecycleRecords'] !== 'function') return false;
  const coordinate = context['coordinate'];
  if (!isRecord(coordinate) || typeof coordinate['withLock'] !== 'function') return false;
  const identity = context['identity'];
  if (!isRecord(identity) || typeof identity['nowUtcIso'] !== 'function' || typeof identity['newRecordId'] !== 'function' || typeof identity['newOccurrenceId'] !== 'function' || typeof identity['newAttemptId'] !== 'function') return false;
  return true;
}

/** Capability-ceiling gate (presence-aware deny semantics; WP-6 configuration machinery). */
function capabilityCeilingDenied(
  configuration: ControlPlaneTrustedContext['configuration'],
  workspace: NonNullable<ReturnType<typeof lookupValidatedWorkspace>>,
  capability: string,
): boolean {
  if (!isKnownCapability(capability)) return true;
  const globalCeiling = configuration.globalCapabilityCeiling;
  if (globalCeiling !== undefined) {
    const set = globalCeiling.capabilities;
    if (set === undefined || !set.includes(capability)) return true;
  }
  const workspaceSet = workspace.capabilities;
  if (workspaceSet !== undefined && !workspaceSet.includes(capability)) return true;
  return false;
}

/** Read all lifecycle payloads of one class from the store (fail closed). */
function readClassPayloads(
  context: ControlPlaneTrustedContext,
  recordClass: RecordClassId,
): { readonly ok: true; readonly payloads: readonly Readonly<Record<string, unknown>>[] } | { readonly ok: false } {
  const enumerated = context.store.enumerateLifecycleRecords(recordClass);
  if (!enumerated.ok) return { ok: false };
  const payloads: Readonly<Record<string, unknown>>[] = [];
  for (const recordId of enumerated.recordIds) {
    const read = context.store.readLifecyclePayload(recordClass, recordId);
    if (!read.ok || read.payload === undefined) return { ok: false };
    payloads.push(read.payload);
  }
  return { ok: true, payloads: Object.freeze(payloads) };
}

function schemaGate(context: ControlPlaneTrustedContext, payload: Readonly<Record<string, unknown>>): boolean {
  const registry = context.schemaRegistry ?? createSchemaRegistry();
  const report = validateLifecycleRecord(payload, registry);
  return report.ok === true;
}

interface Currentness {
  readonly state: 'current' | 'revoked' | 'expired' | 'superseded';
}

/** Currentness of one revocable usability record over revocation/expiry/supersession state. */
function currentnessOf(
  record: Readonly<Record<string, unknown>>,
  revocations: readonly Readonly<Record<string, unknown>>[],
  supersessions: readonly Readonly<Record<string, unknown>>[],
  now: string,
): Currentness {
  const recordId = String(record['record_id'] ?? '');
  for (const revocation of revocations) {
    if (String(revocation['record_type']) !== 'RevocationRecord') continue;
    const target = revocation['target'];
    if (!isRecord(target)) continue;
    if (target['record_id'] !== recordId) continue;
    const scope = String(revocation['scope'] ?? '');
    if (scope !== 'all-uses' && scope !== String(record['purpose'] ?? 'execution-use') && scope !== String(record['use_class'] ?? 'execution-use')) continue;
    const effectiveAt = revocation['effective_at'];
    if (typeof effectiveAt !== 'string' || !isAcceptedTimestamp(effectiveAt)) continue;
    if (effectiveAt <= now) return { state: 'revoked' };
  }
  const validUntil = record['valid_until'];
  if (validUntil !== null && typeof validUntil === 'string' && isAcceptedTimestamp(validUntil) && timestampAtOrBefore(now, validUntil)) {
    return { state: 'expired' };
  }
  for (const supersession of supersessions) {
    if (String(supersession['record_type']) !== 'SupersessionRecord') continue;
    const prior = supersession['prior'];
    if (!isRecord(prior)) continue;
    if (prior['record_id'] !== recordId) continue;
    const scope = String(supersession['scope'] ?? '');
    if (scope !== 'all-uses' && scope !== String(record['purpose'] ?? 'execution-use') && scope !== String(record['use_class'] ?? 'execution-use')) continue;
    return { state: 'superseded' };
  }
  return { state: 'current' };
}

function subjectOf(payload: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined {
  const subject = payload['subject'];
  return isRecord(subject) ? subject : undefined;
}

function coordinationKeyOf(subject: CanonicalSubject): string {
  return `${subject.kindId}|${subject.instanceId}|${subject.revisionId}|${subject.digest}|${subject.workspaceId}`;
}

/**
 * Target-derived lifecycle coordination key (Slice 2A revoke): the SAME
 * subject/workspace identity family as approve/issue, so revoke competes
 * with issue/re-approval for the same lifecycle subject. Never keyed by
 * target record ID alone.
 *
 * Slice-3A adds the RuntimeGrant-shaped branch (contract §26.1 D1): for a
 * RuntimeGrant target the key is derived from the target's exact `bundle`
 * reference (target_kind.id | target_instance_id | target_revision_id |
 * target_digest) plus `workspace_id` — the SAME canonical bundle
 * subject/workspace family used by issueRuntimeGrant, so grant revocation
 * serializes with grant issuance for the same bundle. Never keyed by the
 * grant record ID alone or the reserved occurrence ID alone.
 */
function coordinationKeyOfPayload(payload: Readonly<Record<string, unknown>>): string | undefined {
  const subject = subjectOf(payload);
  if (subject !== undefined) {
    const kind = subject['kind'];
    const kindId = isRecord(kind) ? kind['id'] : undefined;
    const instanceId = subject['instance_id'];
    const revisionId = subject['revision_id'];
    const digest = subject['digest'];
    const workspaceId = subject['workspace_id'];
    if (typeof kindId !== 'string' || typeof instanceId !== 'string' || typeof revisionId !== 'string' || typeof digest !== 'string' || typeof workspaceId !== 'string') {
      return undefined;
    }
    return `${kindId}|${instanceId}|${revisionId}|${digest}|${workspaceId}`;
  }
  const bundle = payload['bundle'];
  if (isRecord(bundle)) {
    const kind = bundle['target_kind'];
    const kindId = isRecord(kind) ? kind['id'] : undefined;
    const instanceId = bundle['target_instance_id'];
    const revisionId = bundle['target_revision_id'];
    const digest = bundle['target_digest'];
    const workspaceId = payload['workspace_id'];
    if (typeof kindId !== 'string' || typeof instanceId !== 'string' || typeof revisionId !== 'string' || typeof digest !== 'string' || typeof workspaceId !== 'string') {
      return undefined;
    }
    return `${kindId}|${instanceId}|${revisionId}|${digest}|${workspaceId}`;
  }
  return undefined;
}

/**
 * Reconstruct the canonical subject identity of a stored revocable record
 * payload. Slice-3A adds the RuntimeGrant-shaped branch: the subject is
 * derived from the target grant's exact bundle reference + workspace_id
 * (the grant's bundle binding is the exact ExecutionBundle revision
 * identity).
 */
function canonicalSubjectOfRecord(payload: Readonly<Record<string, unknown>>): CanonicalSubject | undefined {
  const subject = subjectOf(payload);
  if (subject !== undefined) {
    const kind = subject['kind'];
    const kindId = isRecord(kind) ? kind['id'] : undefined;
    const kindVersion = isRecord(kind) ? kind['version'] : undefined;
    const protocolVersion = subject['protocol_version'];
    const instanceId = subject['instance_id'];
    const revisionId = subject['revision_id'];
    const digest = subject['digest'];
    const workspaceId = subject['workspace_id'];
    if (typeof kindId !== 'string' || typeof kindVersion !== 'string' || typeof protocolVersion !== 'string' ||
        typeof instanceId !== 'string' || typeof revisionId !== 'string' || typeof digest !== 'string' || typeof workspaceId !== 'string') {
      return undefined;
    }
    return Object.freeze({
      protocolId: ARTIFACT_PROTOCOL_ID,
      protocolVersion,
      kindId: kindId as CanonicalSubject['kindId'],
      kindVersion,
      instanceId,
      revisionId,
      digest,
      workspaceId,
    });
  }
  const bundle = payload['bundle'];
  if (isRecord(bundle)) {
    const kind = bundle['target_kind'];
    const kindId = isRecord(kind) ? kind['id'] : undefined;
    const kindVersion = isRecord(kind) ? kind['version'] : undefined;
    const protocolVersion = bundle['target_protocol_version'];
    const instanceId = bundle['target_instance_id'];
    const revisionId = bundle['target_revision_id'];
    const digest = bundle['target_digest'];
    const workspaceId = payload['workspace_id'];
    if (typeof kindId !== 'string' || typeof kindVersion !== 'string' || typeof protocolVersion !== 'string' ||
        typeof instanceId !== 'string' || typeof revisionId !== 'string' || typeof digest !== 'string' || typeof workspaceId !== 'string') {
      return undefined;
    }
    return Object.freeze({
      protocolId: ARTIFACT_PROTOCOL_ID,
      protocolVersion,
      kindId: kindId as CanonicalSubject['kindId'],
      kindVersion,
      instanceId,
      revisionId,
      digest,
      workspaceId,
    });
  }
  return undefined;
}

/** Slice-2A/3A target class ID for an accepted operational target record type. */
function targetClassOf(targetRecordType: string): RecordClassId | undefined {
  if (targetRecordType === 'ApprovalRecord') return 'approval-record';
  if (targetRecordType === 'IssuanceRecord') return 'issuance-record';
  if (targetRecordType === 'RuntimeGrant') return RUNTIME_GRANT_CLASS;
  return undefined;
}

/**
 * Exact-scope duplicate rule (SIR-W12-S2A-001): same target record type +
 * same target record ID + EXACT same scope → duplicate REGARDLESS of
 * effectiveness (committed one-way replay rule, contract §10: "a repeat of
 * the same target+scope fails as lifecycle-conflict"). A future-dated
 * same-scope record still counts.
 */
function exactScopeDuplicate(revocation: Readonly<Record<string, unknown>>, targetRecordType: string, targetRecordId: string, scope: string): boolean {
  if (String(revocation['record_type']) !== 'RevocationRecord') return false;
  const target = revocation['target'];
  if (!isRecord(target)) return false;
  if (target['record_id'] !== targetRecordId) return false;
  if (target['record_type'] !== targetRecordType) return false;
  return revocation['scope'] === scope;
}

/**
 * Cross-scope subsumption rule (SIR-W12-S2A-001): an existing `all-uses`
 * revocation blocks a narrower `execution-use` revoke ONLY when it is
 * EFFECTIVE at trustedNow (contract §25.2 E + §25.8: a revocation
 * "applies when … effectiveAt <= trustedNow"). A future-dated all-uses
 * record is valid but not yet applicable and does NOT block the narrower
 * revoke. `execution-use` never subsumes `all-uses` (broadening allowed).
 */
function effectiveScopeSubsumes(revocation: Readonly<Record<string, unknown>>, targetRecordType: string, targetRecordId: string, scope: string, now: string): boolean {
  if (String(revocation['record_type']) !== 'RevocationRecord') return false;
  const target = revocation['target'];
  if (!isRecord(target)) return false;
  if (target['record_id'] !== targetRecordId) return false;
  if (target['record_type'] !== targetRecordType) return false;
  if (revocation['scope'] !== 'all-uses') return false;
  if (scope === 'all-uses') return false;
  const effectiveAt = revocation['effective_at'];
  if (typeof effectiveAt !== 'string' || !isAcceptedTimestamp(effectiveAt)) return false;
  return effectiveAt <= now;
}

/**
 * Validate the host-injected subject artifact evidence (approve/issue).
 *
 * SR-W12-S1-003 (defense in depth): the accepted WP-4 runtime brand
 * (`isBrandedArtifact`) is required in addition to exact subject
 * correlation. An unbranded structural lookalike, a spread/clone of a
 * branded wrapper, or a brandless reconstruction is not genuine and fails
 * closed as `subject-invalid`. The artifact remains host-injected trusted
 * evidence only: it feeds the WP-4 graph subject-resolution maps and grants
 * nothing by itself; the store-derived lifecycle chain stays the lifecycle
 * authority.
 */
function validateSubjectArtifact(context: ControlPlaneTrustedContext, subject: CanonicalSubject): { readonly ok: true; readonly model: Readonly<Record<string, unknown>> } | { readonly ok: false; readonly reason: 'absent' | 'unbranded' | 'mismatch' } {
  const artifact = context.subjectArtifact;
  if (!isRecord(artifact)) return { ok: false, reason: 'absent' };
  if (!isBrandedArtifact(artifact)) return { ok: false, reason: 'unbranded' };
  const model = artifact['model'];
  if (!isRecord(model)) return { ok: false, reason: 'mismatch' };
  const kind = model['kind'];
  const kindId = isRecord(kind) ? kind['id'] : undefined;
  const kindVersion = isRecord(kind) ? kind['version'] : undefined;
  const protocol = model['protocol'];
  const protocolVersion = isRecord(protocol) ? protocol['version'] : undefined;
  if (artifact['instanceId'] !== subject.instanceId) return { ok: false, reason: 'mismatch' };
  if (artifact['revisionId'] !== subject.revisionId) return { ok: false, reason: 'mismatch' };
  if (artifact['digest'] !== subject.digest) return { ok: false, reason: 'mismatch' };
  if (kindId !== subject.kindId || kindVersion !== subject.kindVersion) return { ok: false, reason: 'mismatch' };
  if (protocolVersion !== subject.protocolVersion) return { ok: false, reason: 'mismatch' };
  return { ok: true, model };
}

/** Verify the approval's ValidationRecord references (exact subject + pass outcomes). */
function verifyValidationReferences(
  context: ControlPlaneTrustedContext,
  request: Slice1Request,
): { readonly ok: true; readonly referenced: readonly Readonly<Record<string, unknown>>[] } | { readonly ok: false; readonly category: Slice1FailureCategory } {
  const requestSubject = request.subject;
  if (requestSubject === undefined) return { ok: false, category: 'internal-failure' };
  const referenced: Readonly<Record<string, unknown>>[] = [];
  for (const ref of request.validationRecordIds ?? []) {
    const read = context.store.readLifecyclePayload('validation-record', ref);
    if (!read.ok || read.payload === undefined) {
      // A store failure is store-failure; an absent reference is
      // subject-not-validated (the subject lacks accepted validation).
      return read.code === 'not-found'
        ? { ok: false, category: 'subject-not-validated' }
        : { ok: false, category: 'store-failure' };
    }
    const payload = read.payload;
    if (String(payload['record_type']) !== 'ValidationRecord') return { ok: false, category: 'subject-not-validated' };
    const subject = subjectOf(payload);
    if (subject === undefined || !subjectMatchesCanonical(subject, requestSubject)) return { ok: false, category: 'subject-invalid' };
    if (payload['structural_outcome'] !== 'pass' || payload['semantic_outcome'] !== 'pass') return { ok: false, category: 'subject-not-validated' };
    referenced.push(payload);
  }
  if (referenced.length === 0) return { ok: false, category: 'subject-not-validated' };
  return { ok: true, referenced };
}

/** Find matching approvals and their currentness for one subject/workspace. */
function matchingApprovals(
  approvals: readonly Readonly<Record<string, unknown>>[],
  revocations: readonly Readonly<Record<string, unknown>>[],
  supersessions: readonly Readonly<Record<string, unknown>>[],
  subject: CanonicalSubject,
  now: string,
): readonly { readonly payload: Readonly<Record<string, unknown>>; readonly state: Currentness['state'] }[] {
  const out: { readonly payload: Readonly<Record<string, unknown>>; readonly state: Currentness['state'] }[] = [];
  for (const approval of approvals) {
    if (String(approval['record_type']) !== 'ApprovalRecord') continue;
    if (approval['workspace_id'] !== subject.workspaceId) continue;
    const subjectValue = subjectOf(approval);
    if (subjectValue === undefined || !subjectMatchesCanonical(subjectValue, subject)) continue;
    out.push({ payload: approval, state: currentnessOf(approval, revocations, supersessions, now).state });
  }
  return Object.freeze(out);
}

function sameIssuanceScope(
  issuance: Readonly<Record<string, unknown>>,
  subject: CanonicalSubject,
  useClass: string,
): boolean {
  if (String(issuance['record_type']) !== 'IssuanceRecord') return false;
  if (issuance['workspace_id'] !== subject.workspaceId) return false;
  if (issuance['use_class'] !== useClass) return false;
  const subjectValue = subjectOf(issuance);
  return subjectValue !== undefined && subjectMatchesCanonical(subjectValue, subject);
}

/** Publish outcome mapping to the closed taxonomy (per operation). */
function publishOutcome(
  result: PublishRecordResult,
  duplicateCategory: Slice1FailureCategory,
): { readonly ok: true; readonly recordId?: string; readonly recordDigest?: string; readonly auditEventId?: string } | { readonly ok: false; readonly category: Slice1FailureCategory } {
  if (result.ok) {
    if (result.outcome === 'published') {
      return { ok: true, recordId: result.recordId, recordDigest: result.recordDigest, auditEventId: result.auditEventId };
    }
    if (result.outcome === 'idempotent-duplicate' || result.outcome === 'duplicate') {
      return { ok: false, category: duplicateCategory };
    }
  }
  return { ok: false, category: 'store-failure' };
}

// ─── operation bodies (run under the host-side coordination lock) ──────────

function runRecordValidation(context: ControlPlaneTrustedContext, request: Slice1Request): Slice1Result {
  const subject = request.subject;
  if (subject === undefined) return failure('internal-failure');
  const evidence = context.validationEvidence;
  const form = validateEvidenceForm(evidence);
  if (!form.ok) {
    if (form.reason === 'report-not-ok') return failure('subject-not-validated');
    return failure('request-invalid');
  }
  const correlation = correlateValidationEvidence(form.evidence, subject);
  if (!correlation.ok) return failure('subject-invalid');

  const existingResult = readClassPayloads(context, 'validation-record');
  if (!existingResult.ok) return failure('store-failure');

  const recordId = context.identity.newRecordId();
  const createdAt = context.identity.nowUtcIso();
  const candidate = buildValidationRecordPayload({
    recordId,
    createdAt,
    subject,
    registry: context.registry,
  });

  for (const existing of existingResult.payloads) {
    if (sameDecision(existing, candidate)) return failure('lifecycle-conflict');
  }

  if (!schemaGate(context, candidate)) return failure('internal-failure');

  let published;
  try {
    published = context.store.publishLifecycleRecord('validation-record', candidate);
  } catch {
    return failure('store-failure');
  }
  const outcome = publishOutcome(published, 'lifecycle-conflict');
  if (!outcome.ok) return failure(outcome.category);
  return success('recorded', {
    recordClass: 'validation-record',
    recordId,
    recordDigest: outcome.recordDigest,
    auditEventId: outcome.auditEventId,
    subject,
    workspaceId: request.workspaceId,
  });
}

function runApprove(context: ControlPlaneTrustedContext, request: Slice1Request): Slice1Result {
  const subject = request.subject;
  if (subject === undefined) return failure('internal-failure');
  const artifact = validateSubjectArtifact(context, subject);
  if (!artifact.ok) {
    // Absent host evidence is a host-composition failure; unbranded or
    // subject-mismatched evidence fails closed as subject-invalid
    // (SR-W12-S1-003).
    return failure(artifact.reason === 'absent' ? 'internal-failure' : 'subject-invalid');
  }

  const refs = verifyValidationReferences(context, request);
  if (!refs.ok) return failure(refs.category);

  const now = context.identity.nowUtcIso();
  const stateResult = readClassPayloads(context, 'approval-record');
  if (!stateResult.ok) return failure('store-failure');
  const validationResult = readClassPayloads(context, 'validation-record');
  if (!validationResult.ok) return failure('store-failure');
  const revocationResult = readClassPayloads(context, 'revocation-record');
  if (!revocationResult.ok) return failure('store-failure');
  const supersessionResult = readClassPayloads(context, 'supersession-record');
  if (!supersessionResult.ok) return failure('store-failure');

  const requiredSemantics = context.approval?.requiredSemantics ?? { protocol_features: [], consumer_capabilities: [] };
  const validUntil = context.approval?.validUntil ?? null;
  const recordId = context.identity.newRecordId();
  const candidate = buildApprovalRecordPayload({
    recordId,
    createdAt: now,
    subject,
    workspaceId: request.workspaceId,
    purpose: request.purpose ?? SLICE_1_PURPOSES[0]!,
    validationRecordIds: request.validationRecordIds ?? [],
    requiredSemantics,
    validUntil,
    registry: context.registry,
  });

  const matching = matchingApprovals(stateResult.payloads, revocationResult.payloads, supersessionResult.payloads, subject, now);
  // Duplicate/conflict semantics consider only CURRENT approvals: a
  // re-approval after revocation is a new command and a new record
  // (the revoked approval is historical, not blocking).
  const current = matching.filter((entry) => entry.state === 'current');
  for (const entry of current) {
    if (sameDecision(entry.payload, candidate)) return failure('already-approved');
  }
  if (current.length > 0) return failure('lifecycle-conflict');

  const maps = artifactModelMaps(subject, artifact.model);
  const graphReport = evaluateCandidateLifecycleRecord({
    existing: [...stateResult.payloads, ...validationResult.payloads],
    candidate,
    registry: context.registry,
    artifactsByRevision: maps.artifactsByRevision,
    artifactsByInstance: maps.artifactsByInstance,
  });
  if (!graphReport.ok) {
    const category = mapGraphFindings(graphReport.findings);
    if (category !== undefined) return failure(category);
  }

  if (!schemaGate(context, candidate)) return failure('internal-failure');

  let published;
  try {
    published = context.store.publishLifecycleRecord('approval-record', candidate);
  } catch {
    return failure('store-failure');
  }
  const outcome = publishOutcome(published, 'already-approved');
  if (!outcome.ok) return failure(outcome.category);
  return success('approved', {
    recordClass: 'approval-record',
    recordId,
    recordDigest: outcome.recordDigest,
    auditEventId: outcome.auditEventId,
    subject,
    workspaceId: request.workspaceId,
  });
}

function runIssue(context: ControlPlaneTrustedContext, request: Slice1Request): Slice1Result {
  const subject = request.subject;
  if (subject === undefined) return failure('internal-failure');
  const artifact = validateSubjectArtifact(context, subject);
  if (!artifact.ok) {
    // Same mapping as approve: absent evidence is a host-composition
    // failure; unbranded or mismatched evidence fails closed as
    // subject-invalid (SR-W12-S1-003).
    return failure(artifact.reason === 'absent' ? 'internal-failure' : 'subject-invalid');
  }

  const now = context.identity.nowUtcIso();
  const approvalResult = readClassPayloads(context, 'approval-record');
  if (!approvalResult.ok) return failure('store-failure');
  const revocationResult = readClassPayloads(context, 'revocation-record');
  if (!revocationResult.ok) return failure('store-failure');
  const supersessionResult = readClassPayloads(context, 'supersession-record');
  if (!supersessionResult.ok) return failure('store-failure');
  const issuanceResult = readClassPayloads(context, 'issuance-record');
  if (!issuanceResult.ok) return failure('store-failure');

  const matching = matchingApprovals(approvalResult.payloads, revocationResult.payloads, supersessionResult.payloads, subject, now);
  if (matching.length === 0) return failure('issuance-not-authorized');
  const revoked = matching.filter((entry) => entry.state === 'revoked');
  if (revoked.length > 0) return failure('approval-revoked');
  const current = matching.filter((entry) => entry.state === 'current');
  if (current.length === 0) return failure('issuance-not-authorized');
  if (current.length > 1) return failure('lifecycle-conflict');
  const approval = current[0]!.payload;

  const useClass = request.useClass ?? SLICE_1_USE_CLASSES[0]!;
  const activationLimit = context.issuance?.activationLimit ?? 1;
  if (!Number.isSafeInteger(activationLimit) || activationLimit < ACTIVATION_LIMIT_MIN || activationLimit > ACTIVATION_LIMIT_MAX) {
    return failure('internal-failure');
  }
  const validUntil = context.issuance?.validUntil ?? null;
  const recordId = context.identity.newRecordId();
  const candidate = buildIssuanceRecordPayload({
    recordId,
    createdAt: now,
    subject,
    workspaceId: request.workspaceId,
    useClass,
    approvalRecordId: String(approval['record_id'] ?? ''),
    activationLimit,
    validUntil,
    registry: context.registry,
  });

  const currentIssuances = issuanceResult.payloads.filter(
    (issuance) => sameIssuanceScope(issuance, subject, useClass) && currentnessOf(issuance, revocationResult.payloads, supersessionResult.payloads, now).state === 'current',
  );
  for (const issuance of currentIssuances) {
    if (sameDecision(issuance, candidate)) return failure('already-issued');
  }
  if (currentIssuances.length > 0) return failure('lifecycle-conflict');

  const maps = artifactModelMaps(subject, artifact.model);
  const graphReport = evaluateCandidateLifecycleRecord({
    existing: [...approvalResult.payloads, ...issuanceResult.payloads],
    candidate,
    registry: context.registry,
    artifactsByRevision: maps.artifactsByRevision,
    artifactsByInstance: maps.artifactsByInstance,
  });
  if (!graphReport.ok) {
    const category = mapGraphFindings(graphReport.findings);
    if (category !== undefined) return failure(category);
  }

  if (!schemaGate(context, candidate)) return failure('internal-failure');

  let published;
  try {
    published = context.store.publishLifecycleRecord('issuance-record', candidate);
  } catch {
    return failure('store-failure');
  }
  const outcome = publishOutcome(published, 'already-issued');
  if (!outcome.ok) return failure(outcome.category);
  return success('issued', {
    recordClass: 'issuance-record',
    recordId,
    recordDigest: outcome.recordDigest,
    auditEventId: outcome.auditEventId,
    subject,
    workspaceId: request.workspaceId,
  });
}

/**
 * Slice-2A revoke — under-lock decision (fixed order: re-read target →
 * re-read revocation state → revalidate → build → schema gate → publish
 * exactly one RevocationRecord → verify → release by the caller's finally).
 * All decision inputs are re-read under the coordination lock; the
 * pre-lock locator read is never decision authority (C5).
 */
function revokeUnderLock(
  context: ControlPlaneTrustedContext,
  request: Slice1Request,
  targetClass: RecordClassId,
  targetRecordId: string,
): Slice1Result {
  const target = context.store.readLifecyclePayload(targetClass, targetRecordId);
  if (!target.ok || target.payload === undefined) {
    return target.code === 'not-found' ? failure('lifecycle-state-missing') : failure('store-failure');
  }
  const payload = target.payload;
  if (String(payload['record_type']) !== request.targetRecordType) return failure('lifecycle-state-missing');
  const targetWorkspace = payload['workspace_id'];
  if (typeof targetWorkspace !== 'string') return failure('store-failure');
  if (targetWorkspace !== request.workspaceId) return failure('lifecycle-state-missing');
  const subject = canonicalSubjectOfRecord(payload);
  if (subject === undefined) return failure('store-failure');

  const revocations = readClassPayloads(context, REVOCATION_RECORD_CLASS);
  if (!revocations.ok) return failure('store-failure');
  const targetType = request.targetRecordType;
  const scope = request.scope;
  const effectiveAt = request.effectiveAt;
  const reasonCode = request.reasonCode;
  if (targetType === undefined || scope === undefined || effectiveAt === undefined || reasonCode === undefined) {
    return failure('internal-failure');
  }
  // Duplicate detection (SIR-W12-S2A-001): exact-scope repeats are
  // existence-based (one-way replay, §10); cross-scope subsumption
  // (all-uses over execution-use) requires the existing record to be
  // EFFECTIVE at the trusted now (§25.2 E/§25.8).
  const now = context.identity.nowUtcIso();
  if (revocations.payloads.some(
    (revocation) => exactScopeDuplicate(revocation, targetType, targetRecordId, scope) || effectiveScopeSubsumes(revocation, targetType, targetRecordId, scope, now),
  )) {
    return failure('lifecycle-conflict');
  }
  const recordId = context.identity.newRecordId();
  const createdAt = context.identity.nowUtcIso();
  const candidate = buildRevocationRecordPayload({
    recordId,
    createdAt,
    targetRecordType: targetType,
    targetRecordId,
    scope,
    effectiveAt,
    reasonCode,
    registry: context.registry,
  });
  if (!schemaGate(context, candidate)) return failure('internal-failure');

  let published;
  try {
    published = context.store.publishLifecycleRecord(REVOCATION_RECORD_CLASS, candidate);
  } catch {
    return failure('store-failure');
  }
  const outcome = publishOutcome(published, 'lifecycle-conflict');
  if (!outcome.ok) return failure(outcome.category);
  return success('revoked', {
    recordClass: REVOCATION_RECORD_CLASS,
    recordId,
    recordDigest: outcome.recordDigest,
    auditEventId: outcome.auditEventId,
    subject,
    workspaceId: request.workspaceId,
  });
}

/**
 * Slice-2A revoke (C5 two-stage read discipline): registry echo correlation
 * → workspace resolution → PRE-LOCK locator read (existence/class/workspace
 * eligibility + target-derived lifecycle coordination key ONLY) → process-
 * local lock → full under-lock decision. Nonexistent and out-of-workspace
 * targets are externally indistinguishable (`lifecycle-state-missing`).
 */
function runRevoke(context: ControlPlaneTrustedContext, request: Slice1Request): Slice1Result {
  // Registry echo: REQUIRED untrusted correlation operand; authoritative
  // context is host-injected. Missing/malformed → request-invalid (capture);
  // differing → registry-context-mismatch.
  const echo = request.registryEcho;
  if (echo === undefined) return failure('request-invalid');
  if (echo.registry_snapshot_id !== context.registry.registrySnapshotId || echo.registry_snapshot_digest !== context.registry.registrySnapshotDigest) {
    return failure('registry-context-mismatch');
  }
  const workspace = lookupValidatedWorkspace(context.configuration, request.workspaceId);
  if (workspace === undefined) return failure('lifecycle-state-missing');
  const targetType = request.targetRecordType;
  const targetRecordId = request.targetRecordId;
  if (targetType === undefined || targetRecordId === undefined) return failure('internal-failure');
  const targetClass = targetClassOf(targetType);
  if (targetClass === undefined) return failure('request-invalid');

  // PRE-LOCK LOCATOR READ: never final decision authority (C5).
  const locator = context.store.readLifecyclePayload(targetClass, targetRecordId);
  if (!locator.ok || locator.payload === undefined) {
    return locator.code === 'not-found' ? failure('lifecycle-state-missing') : failure('store-failure');
  }
  const locatorPayload = locator.payload;
  if (String(locatorPayload['record_type']) !== targetType) return failure('lifecycle-state-missing');
  const locatorWorkspace = locatorPayload['workspace_id'];
  if (typeof locatorWorkspace !== 'string') return failure('store-failure');
  if (locatorWorkspace !== request.workspaceId) return failure('lifecycle-state-missing');
  const key = coordinationKeyOfPayload(locatorPayload);
  if (key === undefined) return failure('store-failure');

  try {
    return context.coordinate.withLock(key, () => revokeUnderLock(context, request, targetClass, targetRecordId));
  } catch (err) {
    if (err instanceof LockContentionError) return failure('lock-conflict');
    return failure('internal-failure');
  }
}

// ─── Slice-3A issueRuntimeGrant — trusted-local grant issuance ──────────────
// issueRuntimeGrant is the transport-free trusted-local RuntimeGrant
// issuance path: exact-key untrusted narrowing/correlation operands only;
// authority derived from the trusted host context + the validated
// ExecutionBundle evidence + authoritative store state, all revalidated
// under the WP-12 coordination lock; one internally allocated occurrence
// ID; EXACTLY ONE RuntimeGrant on success (with the WP-8 mechanical
// write-audit); zero primary lifecycle records on any failure. The grant
// never executes anything and never activates anything (ADR-011; §11).

/** The exact four required ExecutionBundle member kinds (ADR-006). */
const BUNDLE_MEMBER_KINDS = ['TaskSpec', 'AuthorityPolicy', 'ContextManifest', 'CompletionContract'] as const;
/** Bundle body member keys (accepted ExecutionBundle composition; ADR-006). */
const BUNDLE_MEMBER_BODY_KEYS: Readonly<Record<(typeof BUNDLE_MEMBER_KINDS)[number], string>> = {
  TaskSpec: 'task',
  AuthorityPolicy: 'authority_policy',
  ContextManifest: 'context_manifest',
  CompletionContract: 'completion_contract',
};

/**
 * Derive the exact four member identities from the validated ExecutionBundle
 * model (host-injected trusted evidence). Caller-supplied member identities
 * never exist (the request key set rejects them). The bundle body is the
 * accepted exact-artifact-reference form (ADR-006 composition).
 */
function bundleMembersOf(model: Readonly<Record<string, unknown>>): readonly CanonicalSubject[] | undefined {
  const body = model['body'];
  if (!isRecord(body)) return undefined;
  const members: CanonicalSubject[] = [];
  for (const key of BUNDLE_MEMBER_KINDS) {
    const ref = body[BUNDLE_MEMBER_BODY_KEYS[key]];
    if (!isRecord(ref)) return undefined;
    const kind = ref['target_kind'];
    const kindId = isRecord(kind) ? kind['id'] : undefined;
    const kindVersion = isRecord(kind) ? kind['version'] : undefined;
    const protocolVersion = ref['target_protocol_version'];
    const instanceId = ref['target_instance_id'];
    const revisionId = ref['target_revision_id'];
    const digest = ref['target_digest'];
    if (typeof kindId !== 'string' || kindId !== key || typeof kindVersion !== 'string' || typeof protocolVersion !== 'string' ||
        typeof instanceId !== 'string' || typeof revisionId !== 'string' || typeof digest !== 'string') {
      return undefined;
    }
    members.push(Object.freeze({
      protocolId: ARTIFACT_PROTOCOL_ID,
      protocolVersion,
      kindId: kindId as CanonicalSubject['kindId'],
      kindVersion,
      instanceId,
      revisionId,
      digest,
      workspaceId: '', // filled by the caller with the exact grant workspace
    }));
  }
  return Object.freeze(members);
}

interface ChainCorrelation {
  readonly approvalRecordIds: readonly string[];
  readonly issuanceRecordIds: readonly string[];
}

/**
 * Revalidate the authoritative lifecycle chain for the exact bundle and its
 * four exact members (contract §9/§10; §26.6 policy prerequisite). All state
 * is selected from the trusted store; caller-supplied record IDs cannot
 * select authority. For each required subject, exactly one CURRENT matching
 * approval and exactly one CURRENT matching issuance (exact subject +
 * workspace + required use class) must correlate; the issuance's referenced
 * approval must itself be current. Fail-closed mapping follows the accepted
 * chain-currentness semantics (§25.4): missing → lifecycle-state-missing;
 * explicitly revoked approval → approval-revoked; unusable issuance →
 * issuance-not-authorized; ambiguity → lifecycle-conflict. No created_at /
 * record-ID / first-enumeration / newest selection ever occurs.
 */
function correlateGrantChain(
  context: ControlPlaneTrustedContext,
  subject: CanonicalSubject,
  members: readonly CanonicalSubject[],
  approvals: readonly Readonly<Record<string, unknown>>[],
  issuances: readonly Readonly<Record<string, unknown>>[],
  revocations: readonly Readonly<Record<string, unknown>>[],
  supersessions: readonly Readonly<Record<string, unknown>>[],
  now: string,
): { readonly ok: true; readonly correlation: ChainCorrelation } | { readonly ok: false; readonly category: Slice1FailureCategory } {
  const approvalIds: string[] = [];
  const issuanceIds: string[] = [];
  const required = [
    Object.freeze({ ...subject }),
    ...members.map((member) => Object.freeze({ ...member, workspaceId: subject.workspaceId })),
  ];
  for (const requiredSubject of required) {
    const matching = matchingApprovals(approvals, revocations, supersessions, requiredSubject, now);
    if (matching.length === 0) return { ok: false, category: 'lifecycle-state-missing' };
    const currentApprovals = matching.filter((entry) => entry.state === 'current');
    if (currentApprovals.length > 1) return { ok: false, category: 'lifecycle-conflict' };
    if (currentApprovals.length === 0) {
      return matching.some((entry) => entry.state === 'revoked')
        ? { ok: false, category: 'approval-revoked' }
        : { ok: false, category: 'lifecycle-state-missing' };
    }
    const approvalId = String(currentApprovals[0]!.payload['record_id'] ?? '');

    const matchingIssuances = issuances.filter((issuance) => sameIssuanceScope(issuance, requiredSubject, SLICE_1_USE_CLASSES[0]));
    if (matchingIssuances.length === 0) return { ok: false, category: 'lifecycle-state-missing' };
    const classified = matchingIssuances.map((issuance) => ({
      payload: issuance,
      state: currentnessOf(issuance, revocations, supersessions, now).state,
    }));
    const currentIssuances = classified.filter((entry) => entry.state === 'current');
    if (currentIssuances.length > 1) return { ok: false, category: 'lifecycle-conflict' };
    if (currentIssuances.length === 0) return { ok: false, category: 'issuance-not-authorized' };
    const issuanceId = String(currentIssuances[0]!.payload['record_id'] ?? '');

    // The correlated issuance's referenced approval must itself be current
    // and usable (chain integrity; §9).
    const referencedApprovalId = String(currentIssuances[0]!.payload['approval_record_id'] ?? '');
    const referencedApproval = approvals.find((approval) => String(approval['record_id'] ?? '') === referencedApprovalId);
    if (referencedApproval === undefined) return { ok: false, category: 'lifecycle-state-missing' };
    const referencedState = currentnessOf(referencedApproval, revocations, supersessions, now).state;
    if (referencedState === 'revoked') return { ok: false, category: 'approval-revoked' };
    if (referencedState !== 'current') return { ok: false, category: 'lifecycle-state-missing' };

    approvalIds.push(approvalId);
    issuanceIds.push(issuanceId);
  }
  return { ok: true, correlation: Object.freeze({ approvalRecordIds: Object.freeze(approvalIds), issuanceRecordIds: Object.freeze(issuanceIds) }) };
}

/**
 * True when an existing lifecycle record already binds the reserved
 * occurrence identity (RuntimeGrant.reserved_occurrence_id, the
 * activation/occurrence reservation classes' reserved/occurrence identity
 * fields). Read-only freshness consumption of the relevant existing record
 * classes (contract §26.9): a collision is a hard fail — no retry with
 * another generated ID inside the same command (one-command/one-allocation
 * semantics; §20). 3B record CONSTRUCTION/PUBLICATION is never performed
 * here; these are class reads only.
 */
function reservedOccurrenceBound(records: readonly (readonly Readonly<Record<string, unknown>>[])[], occurrenceId: string): boolean {
  for (const classRecords of records) {
    for (const record of classRecords) {
      if (String(record['reserved_occurrence_id'] ?? '') === occurrenceId) return true;
      if (String(record['occurrence_id'] ?? '') === occurrenceId) return true;
    }
  }
  return false;
}

/**
 * Concrete WP-6 numeric action-ceiling comparison for requested max-actions
 * N (contract §26.6/S3-D4; the ONLY grant numeric constraint with an
 * accepted current ceiling comparison). Missing ceilings are preserved as
 * "no additional quantitative restriction" (accepted WP-6 semantics);
 * violations fail closed as ceiling-denied.
 */
function maxActionsCeilingDenied(
  configuration: ControlPlaneTrustedContext['configuration'],
  workspace: NonNullable<ReturnType<typeof lookupValidatedWorkspace>>,
  maxActions: number,
): boolean {
  if (configuration.globalActionCeiling !== undefined && maxActions > configuration.globalActionCeiling) return true;
  if (workspace.actionCeiling !== undefined && maxActions > workspace.actionCeiling) return true;
  return false;
}

/**
 * Under-lock RuntimeGrant decision (fixed §15 order: re-read authoritative
 * state → revalidate chain/currentness → allocate + check occurrence ID →
 * evaluate narrowing → construct → schema gate → publish exactly one
 * RuntimeGrant → verify durable outcome). Every decision input is re-read
 * under the coordination lock; the grant itself is the durable reservation
 * binding — no partial reservation state is ever published.
 */
function issueRuntimeGrantUnderLock(context: ControlPlaneTrustedContext, request: Slice1Request, workspace: NonNullable<ReturnType<typeof lookupValidatedWorkspace>>): Slice1Result {
  const subject = request.subject;
  const attemptLimit = request.attemptLimit;
  const validity = request.validity;
  const constraints = request.narrowedConstraints;
  if (subject === undefined || attemptLimit === undefined || validity === undefined || constraints === undefined) {
    return failure('internal-failure');
  }
  // Exact ExecutionBundle subject only (contract §8).
  if (subject.kindId !== 'ExecutionBundle') return failure('request-invalid');

  // Trusted validated bundle evidence (host-injected; branded; exact
  // subject correlation). The four member identities are derived from the
  // validated bundle model — never caller-supplied.
  const artifact = validateSubjectArtifact(context, subject);
  if (!artifact.ok) {
    return failure(artifact.reason === 'absent' ? 'internal-failure' : 'subject-invalid');
  }
  const members = bundleMembersOf(artifact.model);
  if (members === undefined) return failure('subject-invalid');

  const now = context.identity.nowUtcIso();
  const approvalResult = readClassPayloads(context, 'approval-record');
  if (!approvalResult.ok) return failure('store-failure');
  const issuanceResult = readClassPayloads(context, 'issuance-record');
  if (!issuanceResult.ok) return failure('store-failure');
  const validationResult = readClassPayloads(context, 'validation-record');
  if (!validationResult.ok) return failure('store-failure');
  const revocationResult = readClassPayloads(context, REVOCATION_RECORD_CLASS);
  if (!revocationResult.ok) return failure('store-failure');
  const supersessionResult = readClassPayloads(context, 'supersession-record');
  if (!supersessionResult.ok) return failure('store-failure');
  // Freshness-relevant existing reservation-binding classes (§26.9):
  // read-only consumption; no 3B production vocabulary.
  const grantResult = readClassPayloads(context, RUNTIME_GRANT_CLASS);
  if (!grantResult.ok) return failure('store-failure');
  const activationResult = readClassPayloads(context, 'activation-record');
  if (!activationResult.ok) return failure('store-failure');
  const occurrenceResult = readClassPayloads(context, 'execution-occurrence-record');
  if (!occurrenceResult.ok) return failure('store-failure');

  // Five-fold lifecycle chain revalidation (store-derived authority).
  const chain = correlateGrantChain(
    context, subject, members,
    approvalResult.payloads, issuanceResult.payloads,
    revocationResult.payloads, supersessionResult.payloads, now,
  );
  if (!chain.ok) return failure(chain.category);

  // Internal occurrence-ID allocation + freshness check under the lock
  // (contract §26.9): one allocation per command; collision →
  // occurrence-conflict with zero RuntimeGrant; no automatic retry.
  const reservedOccurrenceId = context.identity.newOccurrenceId();
  if (reservedOccurrenceBound([grantResult.payloads, activationResult.payloads, occurrenceResult.payloads], reservedOccurrenceId)) {
    return failure('occurrence-conflict');
  }

  // Narrowing evaluation (contract §13/§14/§26.6): max-resources is
  // schema-admitted but unsupported by the accepted enforcement
  // architecture → eligibility-denied (NOT request-invalid; NOT
  // ceiling-denied); max-actions is the only numeric form with an accepted
  // current WP-6 ceiling comparison → ceiling-denied on violation.
  for (const constraint of constraints) {
    if (constraint.type === 'max-resources') return failure('eligibility-denied');
    if (constraint.type === 'max-actions' && maxActionsCeilingDenied(context.configuration, workspace, constraint.value as number)) {
      return failure('ceiling-denied');
    }
  }

  const recordId = context.identity.newRecordId();
  const candidate = buildRuntimeGrantPayload({
    recordId,
    createdAt: now,
    subject,
    workspaceId: request.workspaceId,
    reservedOccurrenceId,
    attemptLimit,
    validity,
    narrowedConstraints: constraints,
    registry: context.registry,
  });

  // Accepted WP-4 graph evaluation: LFC chain integrity over the store
  // state + REG recordability of the correlated chain records and the
  // candidate grant under the current accepted registry context (§10/
  // §26.4 PHASE-1 recordability; single lifecycle rule authority).
  const graphReport = evaluateCandidateLifecycleRecord({
    existing: [
      ...approvalResult.payloads,
      ...issuanceResult.payloads,
      ...validationResult.payloads,
      ...revocationResult.payloads,
      ...supersessionResult.payloads,
      ...grantResult.payloads,
    ],
    candidate,
    registry: context.registry,
    artifactsByRevision: new Map(),
    artifactsByInstance: new Map(),
    extraRegistryEntries: new Set([...chain.ok ? chain.correlation.approvalRecordIds : [], ...chain.ok ? chain.correlation.issuanceRecordIds : []]),
  });
  const category = mapGrantGraphFindings(graphReport.findings);
  if (category !== undefined) return failure(category);

  if (!schemaGate(context, candidate)) return failure('internal-failure');

  let published;
  try {
    published = context.store.publishLifecycleRecord(RUNTIME_GRANT_CLASS, candidate);
  } catch {
    return failure('store-failure');
  }
  const outcome = publishOutcome(published, 'lifecycle-conflict');
  if (!outcome.ok) return failure(outcome.category);
  return success('granted', {
    recordClass: RUNTIME_GRANT_CLASS,
    recordId,
    recordDigest: outcome.recordDigest,
    auditEventId: outcome.auditEventId,
    subject,
    workspaceId: request.workspaceId,
    reservedOccurrenceId,
    attemptLimit,
    validity,
    narrowedConstraints: constraints,
    registrySnapshotId: context.registry.registrySnapshotId,
    registrySnapshotDigest: context.registry.registrySnapshotDigest,
  });
}

/**
 * issueRuntimeGrant command (host-asserted grant-authority role; §26.19):
 * registry echo correlation → trusted workspace resolution → the SAME
 * canonical bundle subject/workspace coordination key as approve/issue/
 * revoke → under-lock decision. The command payload never supplies the
 * grant authority role (structural boundary; SCR-W12-003).
 */
function runIssueRuntimeGrant(context: ControlPlaneTrustedContext, request: Slice1Request): Slice1Result {
  const echo = request.registryEcho;
  if (echo === undefined) return failure('request-invalid');
  if (echo.registry_snapshot_id !== context.registry.registrySnapshotId || echo.registry_snapshot_digest !== context.registry.registrySnapshotDigest) {
    return failure('registry-context-mismatch');
  }
  const workspace = lookupValidatedWorkspace(context.configuration, request.workspaceId);
  if (workspace === undefined) return failure('lifecycle-state-missing');
  const subject = request.subject;
  if (subject === undefined) return failure('internal-failure');
  try {
    return context.coordinate.withLock(coordinationKeyOf(subject), () => issueRuntimeGrantUnderLock(context, request, workspace));
  } catch (err) {
    if (err instanceof LockContentionError) return failure('lock-conflict');
    return failure('internal-failure');
  }
}

// ─── Slice-3B decideActivation + createOccurrence ───────────────────────────
// decideActivation is the transport-free activation decision path (S3-D3):
// exact-key request; host-asserted activation authority; under-lock
// authoritative re-read/revalidation; PHASE-1 trustworthy five-issuance
// correlation; PHASE-2 currentness/eight-check eligibility; rejection
// (zero records) vs durable ActivationRecord(denied) (exactly one record,
// no occurrence) vs accepted (ActivationRecord(accepted) FIRST, then the
// mandatory internal ExecutionOccurrenceRecord, §15 SCR-W12-005); complete
// evidence only after both publications are durable. createOccurrence is
// ONLY the recovery surface for the accepted-but-incomplete transition.

/**
 * The activation requested use (check 7). Activation is the governance
 * decision that authorizes the reserved execution occurrence under the
 * grant; its requested authority envelope is the authorized workspace work
 * capability (capability-vocabulary.md) narrowed to the activation scope.
 * The accepted point-of-use machinery then intersects the approved policy,
 * the grant's narrowed constraints, current ceilings, and consumer support
 * without an attempted expansion (§26.5/§26.6).
 */
const ACTIVATION_REQUESTED_USE = {
  capability: 'project-gateway.workspace-read',
  operationClass: 'read',
  resourceClass: 'configured-artifact-area',
  scope: 'exact:activation',
} as const;

/** All ActivationRecord payloads for one reserved occurrence (store-derived). */
function activationsForReservation(
  activations: readonly Readonly<Record<string, unknown>>[],
  reservation: string,
): readonly Readonly<Record<string, unknown>>[] {
  return Object.freeze(activations.filter((a) => String(a['reserved_occurrence_id'] ?? '') === reservation));
}

/**
 * Gate B — genuine RuntimeGrant correlation (§26.3): the exact grant exists,
 * its workspace matches, its bundle reference matches the exact requested
 * bundle, and its reserved_occurrence_id matches the request. Failures are
 * non-disclosing lifecycle-state-missing rejections (§26.4).
 */
function correlateActivationGrant(
  grants: readonly Readonly<Record<string, unknown>>[],
  request: Slice1Request,
  subject: CanonicalSubject,
): { readonly ok: true; readonly grant: Readonly<Record<string, unknown>> } | { readonly ok: false } {
  const grant = grants.find((g) => String(g['record_id'] ?? '') === request.grantId);
  if (grant === undefined) return { ok: false };
  if (grant['workspace_id'] !== subject.workspaceId) return { ok: false };
  if (String(grant['reserved_occurrence_id'] ?? '') !== request.reservedOccurrenceId) return { ok: false };
  const bundle = grant['bundle'];
  if (!isRecord(bundle)) return { ok: false };
  const kind = bundle['target_kind'];
  if (!isRecord(kind) || kind['id'] !== 'ExecutionBundle') return { ok: false };
  if (bundle['target_instance_id'] !== subject.instanceId) return { ok: false };
  if (bundle['target_revision_id'] !== subject.revisionId) return { ok: false };
  if (bundle['target_digest'] !== subject.digest) return { ok: false };
  return { ok: true, grant };
}

/**
 * PHASE-1 — trustworthy five-issuance correlation (§26.3 D / §26.5): for each
 * of the exactly five required subjects (bundle + four members) derive
 * EXACTLY ONE issuance by exact subject + workspace + activation use-class,
 * using the accepted Slice-1/2 current-record-selection primitive
 * (currentness-filtered uniqueness). Zero correlatable issuances →
 * lifecycle-state-missing; ambiguity → lifecycle-conflict. Each correlated
 * issuance's referenced approval must exist and match the subject/workspace
 * (malformed authoritative record → lifecycle-state-missing). Expired/
 * revoked-but-correlated state is NOT a correlation failure — it is PHASE-2
 * (durable denial). No created_at / record-ID / first-enumeration / newest
 * selection ever occurs.
 */
function phase1CorrelateIssuances(
  subject: CanonicalSubject,
  members: readonly CanonicalSubject[],
  issuances: readonly Readonly<Record<string, unknown>>[],
  approvals: readonly Readonly<Record<string, unknown>>[],
  revocations: readonly Readonly<Record<string, unknown>>[],
  supersessions: readonly Readonly<Record<string, unknown>>[],
  now: string,
): { readonly ok: true; readonly issuanceIds: readonly string[]; readonly approvalIds: readonly string[] } | { readonly ok: false; readonly category: 'lifecycle-state-missing' | 'lifecycle-conflict' } {
  const required = [
    Object.freeze({ ...subject }),
    ...members.map((member) => Object.freeze({ ...member, workspaceId: subject.workspaceId })),
  ];
  const issuanceIds: string[] = [];
  const approvalIds: string[] = [];
  for (const requiredSubject of required) {
    const candidates = issuances.filter((issuance) => sameIssuanceScope(issuance, requiredSubject, SLICE_1_USE_CLASSES[0]));
    if (candidates.length === 0) return { ok: false, category: 'lifecycle-state-missing' };
    let correlated: Readonly<Record<string, unknown>>;
    if (candidates.length === 1) {
      correlated = candidates[0]!;
    } else {
      // Accepted current-record-selection primitive: the currentness-filtered
      // uniqueness rule (Slice 2B issuance form). Exactly one current record
      // is the deterministic correlation; zero or multiple current records
      // among multiple candidates are ambiguous.
      const current = candidates.filter((c) => currentnessOf(c, revocations, supersessions, now).state === 'current');
      if (current.length !== 1) return { ok: false, category: 'lifecycle-conflict' };
      correlated = current[0]!;
    }
    const referencedApprovalId = String(correlated['approval_record_id'] ?? '');
    const referencedApproval = approvals.find((a) => String(a['record_id'] ?? '') === referencedApprovalId);
    if (referencedApproval === undefined) return { ok: false, category: 'lifecycle-state-missing' };
    if (referencedApproval['workspace_id'] !== requiredSubject.workspaceId) return { ok: false, category: 'lifecycle-state-missing' };
    const approvalSubject = subjectOf(referencedApproval);
    if (approvalSubject === undefined || !subjectMatchesCanonical(approvalSubject, requiredSubject)) return { ok: false, category: 'lifecycle-state-missing' };
    issuanceIds.push(String(correlated['record_id'] ?? ''));
    approvalIds.push(referencedApprovalId);
  }
  return { ok: true, issuanceIds: Object.freeze(issuanceIds), approvalIds: Object.freeze(approvalIds) };
}

/** PHASE-2 currentness denial reasons for one correlated chain record (issuance or approval). */
function chainCurrentnessDenial(
  record: Readonly<Record<string, unknown>>,
  revocations: readonly Readonly<Record<string, unknown>>[],
  supersessions: readonly Readonly<Record<string, unknown>>[],
  now: string,
): 'revoked' | 'expired' | 'current' {
  const state = currentnessOf(record, revocations, supersessions, now).state;
  if (state === 'revoked') return 'revoked';
  if (state === 'expired' || state === 'superseded') return 'expired';
  return 'current';
}

/**
 * Check 8 — activation_limit (§26.12): the exact bundle IssuanceRecord's
 * activation_limit is consumed by every ACCEPTED ActivationRecord whose
 * required_issuance_record_ids contains that exact issuance ID. The count is
 * always derived from immutable accepted ActivationRecords (no mutable
 * counter); member issuance limits are never counted for bundle use.
 */
function activationLimitExhausted(
  issuances: readonly Readonly<Record<string, unknown>>[],
  activations: readonly Readonly<Record<string, unknown>>[],
  bundleIssuanceId: string,
): boolean | undefined {
  const bundleIssuance = issuances.find((i) => String(i['record_id'] ?? '') === bundleIssuanceId);
  if (bundleIssuance === undefined) return undefined;
  const limit = bundleIssuance['activation_limit'];
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1) return undefined;
  const used = activations.filter((a) => {
    if (String(a['record_type']) !== 'ActivationRecord') return false;
    if (a['decision'] !== 'accepted') return false;
    const required = a['required_issuance_record_ids'];
    return Array.isArray(required) && (required as string[]).includes(bundleIssuanceId);
  }).length;
  return used >= limit;
}

/** Branded lifecycle view over store payloads (accepted point-of-use machinery). */
interface LifecycleViewRecord {
  readonly recordType: string;
  readonly recordId: string;
  readonly level: string;
  readonly model: Readonly<Record<string, unknown>>;
}

function buildLifecycleView(
  payloads: readonly (readonly Readonly<Record<string, unknown>>[])[],
): { readonly records: readonly LifecycleViewRecord[]; readonly findRecord: (id: string) => LifecycleViewRecord | undefined } {
  const wrappers = payloads.flat().map((model) =>
    brandValidatedRecord({
      recordType: String(model['record_type'] ?? '') as never,
      recordId: String(model['record_id'] ?? ''),
      level: 'structural-valid',
      model: model as never,
    }) as unknown as LifecycleViewRecord,
  );
  const byId = new Map<string, LifecycleViewRecord>();
  for (const wrapper of wrappers) byId.set(wrapper.recordId, wrapper);
  return Object.freeze({
    records: Object.freeze(wrappers),
    findRecord: (id: string) => byId.get(id),
  });
}

/**
 * Build the accepted point-of-use revocation view (effective revocations by
 * target record ID; scope is not consulted by the accepted evaluation).
 */
function buildRevocationView(revocations: readonly Readonly<Record<string, unknown>>[]): { readonly revocationsByTarget: (recordId: string) => readonly { recordId: string; effectiveAt: string; scope: string }[] } {
  const entries = revocations
    .filter((r) => String(r['record_type']) === 'RevocationRecord')
    .map((r) => {
      const target = r['target'];
      const targetId = isRecord(target) ? String(target['record_id'] ?? '') : '';
      const effectiveAt = r['effective_at'];
      const scope = r['scope'];
      return {
        targetId,
        effectiveAt: typeof effectiveAt === 'string' ? effectiveAt : '',
        scope: typeof scope === 'string' ? scope : '',
      };
    })
    .filter((entry) => entry.targetId !== '');
  return Object.freeze({
    revocationsByTarget: (recordId: string) =>
      Object.freeze(entries.filter((entry) => entry.targetId === recordId).map((entry) => Object.freeze({ recordId: entry.targetId, effectiveAt: entry.effectiveAt, scope: entry.scope }))),
  });
}

/**
 * Check 7 — full current policy × grant × ceiling × consumer/enforcement
 * intersection via the accepted WP-4 point-of-use machinery (§26.6). The
 * bundle and policy models are host-injected validated evidence (identity
 * correlation is verified by the caller); the grant is the correlated
 * store record. Ineligible → PHASE-2 denial.
 */
/**
 * Check 7 — full current policy × grant × ceiling × consumer/enforcement
 * intersection via the accepted WP-4 point-of-use machinery (§26.6/§27.4).
 * The bundle and policy models are host-injected validated evidence (identity
 * correlation is verified by the caller); the grant is the correlated
 * store record. Ineligible → PHASE-2 denial (activation) / eligibility
 * denial (attempt start). The requested use is supplied by the caller
 * (activation envelope or the accepted attempt envelope).
 */
function pointOfUseIntersectionDenied(
  context: ControlPlaneTrustedContext,
  workspace: NonNullable<ReturnType<typeof lookupValidatedWorkspace>>,
  requestedUse: Readonly<{ capability: string; operationClass: string; resourceClass: string; scope: string }>,
  bundleModel: Readonly<Record<string, unknown>>,
  policyModel: Readonly<Record<string, unknown>> | undefined,
  grant: Readonly<Record<string, unknown>>,
  lifecycleView: { readonly records: readonly LifecycleViewRecord[]; readonly findRecord: (id: string) => LifecycleViewRecord | undefined },
  revocationsView: { readonly revocationsByTarget: (recordId: string) => readonly { recordId: string; effectiveAt: string; scope: string }[] },
  now: string,
): boolean {
  const consumerSupport = context.consumerSupport ?? { consumerId: '', supportedProtocolFeatures: [], supportedConsumerCapabilities: [], supportedExtensionNamespaces: [] };
  const report = evaluatePointOfUseEligibility({
    currentTime: now,
    workspaceId: workspace.workspaceId,
    requestedUse: Object.freeze({ ...requestedUse, workspaceId: workspace.workspaceId }),
    ...(context.configuration.globalActionCeiling !== undefined ? { globalActionCeiling: context.configuration.globalActionCeiling } : {}),
    ...(workspace.actionCeiling !== undefined ? { workspaceActionCeiling: workspace.actionCeiling } : {}),
    consumerSupport,
    identity: Object.freeze({ findInstance: () => undefined, findRevision: () => undefined, findPredecessor: () => undefined, verifyRegistration: () => false }),
    resolver: Object.freeze({ resolve: () => undefined }),
    registry: context.registry,
    lifecycle: lifecycleView as never,
    revocations: revocationsView as never,
    bundle: bundleModel as never,
    policy: policyModel as never,
    grant: grant as never,
  });
  return !report.eligible;
}

/**
 * decideActivation — under-lock decision (fixed §15 order; all inputs
 * re-read under the lock). Returns either a rejection (ok:false, zero
 * records) or a completed decision (ok:true, outcome 'activated') whose
 * evidence carries decision 'accepted' (two publications) or 'denied'
 * (exactly one publication, no occurrence).
 */
function decideActivationUnderLock(
  context: ControlPlaneTrustedContext,
  request: Slice1Request,
  workspace: NonNullable<ReturnType<typeof lookupValidatedWorkspace>>,
): Slice1Result {
  const subject = request.subject;
  const grantId = request.grantId;
  const reservedOccurrenceId = request.reservedOccurrenceId;
  if (subject === undefined || grantId === undefined || reservedOccurrenceId === undefined) return failure('internal-failure');
  if (subject.kindId !== 'ExecutionBundle') return failure('request-invalid');

  // Check 1/2 — exact bundle evidence (host-injected, branded, digest-bound)
  // and exactly one of each member (ADR-006 composition).
  const artifact = validateSubjectArtifact(context, subject);
  if (!artifact.ok) {
    return failure(artifact.reason === 'absent' ? 'internal-failure' : 'subject-invalid');
  }
  const members = bundleMembersOf(artifact.model);
  if (members === undefined) return failure('subject-invalid');

  const now = context.identity.nowUtcIso();
  const approvalResult = readClassPayloads(context, 'approval-record');
  if (!approvalResult.ok) return failure('store-failure');
  const issuanceResult = readClassPayloads(context, 'issuance-record');
  if (!issuanceResult.ok) return failure('store-failure');
  const validationResult = readClassPayloads(context, 'validation-record');
  if (!validationResult.ok) return failure('store-failure');
  const revocationResult = readClassPayloads(context, REVOCATION_RECORD_CLASS);
  if (!revocationResult.ok) return failure('store-failure');
  const supersessionResult = readClassPayloads(context, 'supersession-record');
  if (!supersessionResult.ok) return failure('store-failure');
  const grantResult = readClassPayloads(context, RUNTIME_GRANT_CLASS);
  if (!grantResult.ok) return failure('store-failure');
  const activationResult = readClassPayloads(context, ACTIVATION_RECORD_CLASS);
  if (!activationResult.ok) return failure('store-failure');
  const occurrenceResult = readClassPayloads(context, EXECUTION_OCCURRENCE_RECORD_CLASS);
  if (!occurrenceResult.ok) return failure('store-failure');

  // Gate B — genuine RuntimeGrant correlation.
  const grantCorrelation = correlateActivationGrant(grantResult.payloads, request, subject);
  if (!grantCorrelation.ok) return failure('lifecycle-state-missing');
  const grant = grantCorrelation.grant;

  // Gate C — reservation undecided (§26.7): any prior terminal decision or
  // an existing occurrence for the reservation is replay-denied.
  const reservationActivations = activationsForReservation(activationResult.payloads, reservedOccurrenceId);
  if (reservationActivations.length > 0) return failure('replay-denied');
  if (occurrenceResult.payloads.some((o) => String(o['occurrence_id'] ?? '') === reservedOccurrenceId)) return failure('replay-denied');

  // Gate D — PHASE-1 trustworthy five-issuance correlation.
  const correlation = phase1CorrelateIssuances(
    subject, members,
    issuanceResult.payloads, approvalResult.payloads,
    revocationResult.payloads, supersessionResult.payloads, now,
  );
  if (!correlation.ok) return failure(correlation.category);

  // PHASE-2 — currentness of the five correlated issuances + five
  // referenced approvals (check 3 + check 6): revoked/expired → durable
  // denial (NOT rejection; §26.5).
  const deniedChain = (() => {
    const allRevoked = [...issuanceResult.payloads, ...approvalResult.payloads];
    for (const id of [...correlation.issuanceIds, ...correlation.approvalIds]) {
      const record = allRevoked.find((r) => String(r['record_id'] ?? '') === id);
      if (record === undefined) return true;
      const denial = chainCurrentnessDenial(record, revocationResult.payloads, supersessionResult.payloads, now);
      if (denial !== 'current') return true;
    }
    return false;
  })();

  // Check 8 — activation_limit (accepted-record count for the exact bundle
  // issuance; §26.12). Malformed authoritative state fails closed.
  const limitExhausted = activationLimitExhausted(issuanceResult.payloads, activationResult.payloads, correlation.issuanceIds[0]!);
  if (limitExhausted === undefined) return failure('store-failure');

  // Check 7 — policy × grant × ceiling × consumer intersection (accepted
  // point-of-use machinery; §26.6). The policy model is the host-injected
  // validated AuthorityPolicy resolved from the bundle reference; identity
  // correlation is verified against the bundle's authority_policy member.
  const policyModel = (() => {
    if (context.policyEvidence === undefined) return undefined;
    const model = context.policyEvidence.model as Readonly<Record<string, unknown>>;
    const policyMember = members.find((member) => member.kindId === 'AuthorityPolicy');
    if (policyMember === undefined) return undefined;
    if (context.policyEvidence.instanceId !== policyMember.instanceId) return undefined;
    if (context.policyEvidence.revisionId !== policyMember.revisionId) return undefined;
    if (context.policyEvidence.digest !== policyMember.digest) return undefined;
    return model;
  })();
  const lifecycleView = buildLifecycleView([
    approvalResult.payloads, issuanceResult.payloads, validationResult.payloads,
    revocationResult.payloads, supersessionResult.payloads, grantResult.payloads,
    activationResult.payloads, occurrenceResult.payloads,
  ]);
  const revocationsView = buildRevocationView(revocationResult.payloads);
  const intersectionDenied = pointOfUseIntersectionDenied(
    context, workspace, ACTIVATION_REQUESTED_USE, artifact.model, policyModel, grant, lifecycleView, revocationsView, now,
  );

  const decision: 'accepted' | 'denied' = deniedChain || limitExhausted || intersectionDenied ? 'denied' : 'accepted';
  const recordId = context.identity.newRecordId();
  const candidate = buildActivationRecordPayload({
    recordId,
    createdAt: now,
    subject,
    workspaceId: request.workspaceId,
    requiredIssuanceRecordIds: correlation.issuanceIds,
    runtimeGrantId: grantId,
    reservedOccurrenceId,
    decision,
    registry: context.registry,
  });

  // PHASE-1 recordability + integrity (gate E): the correlated chain records
  // (five issuances, five approvals, grant) are REG entries; LFC/EXE findings
  // here are REJECTIONS (§26.4). The graph candidate carries decision
  // 'accepted' because the graph evaluation is decision-independent at this
  // point (EXE-002/LFC-008 denied-activation checks describe the POST-denial
  // derived state and must not reject the just-made denial decision).
  const graphCandidate = { ...candidate, decision: 'accepted' };
  const graphReport = evaluateCandidateLifecycleRecord({
    existing: [
      ...approvalResult.payloads,
      ...issuanceResult.payloads,
      ...validationResult.payloads,
      ...revocationResult.payloads,
      ...supersessionResult.payloads,
      ...grantResult.payloads,
      ...activationResult.payloads,
      ...occurrenceResult.payloads,
    ],
    candidate: graphCandidate,
    registry: context.registry,
    artifactsByRevision: new Map(),
    artifactsByInstance: new Map(),
    extraRegistryEntries: new Set([...correlation.issuanceIds, ...correlation.approvalIds, grantId]),
  });
  const category = mapActivationGraphFindings(graphReport.findings);
  if (category !== undefined) return failure(category);

  if (!schemaGate(context, candidate)) return failure('internal-failure');

  let published;
  try {
    published = context.store.publishLifecycleRecord(ACTIVATION_RECORD_CLASS, candidate);
  } catch {
    return failure('store-failure');
  }
  const outcome = publishOutcome(published, 'replay-denied');
  if (!outcome.ok) return failure(outcome.category);

  // Accepted: the mandatory internal ExecutionOccurrenceRecord (SECOND
  // publication, same lock, §15 SCR-W12-005). A failure here leaves the
  // accepted-but-incomplete transition; createOccurrence is the only repair.
  let occurrenceEvidence: { readonly occurrenceRecordId: string; readonly occurrenceRecordDigest?: string; readonly occurrenceAuditEventId?: string } | undefined;
  if (decision === 'accepted') {
    const occurrenceId = context.identity.newRecordId();
    const occurrenceCandidate = buildExecutionOccurrenceRecordPayload({
      recordId: occurrenceId,
      createdAt: now,
      activationRecordId: recordId,
      bundle: Object.freeze({ ...(candidate['bundle'] as Readonly<Record<string, unknown>>) }),
      workspaceId: request.workspaceId,
      occurrenceId: reservedOccurrenceId,
      runtimeGrantId: grantId,
      registry: context.registry,
    });
    if (!schemaGate(context, occurrenceCandidate)) return failure('internal-failure');
    let occurrencePublished;
    try {
      occurrencePublished = context.store.publishLifecycleRecord(EXECUTION_OCCURRENCE_RECORD_CLASS, occurrenceCandidate);
    } catch {
      return failure('store-failure');
    }
    const occurrenceOutcome = publishOutcome(occurrencePublished, 'replay-denied');
    if (!occurrenceOutcome.ok) return failure(occurrenceOutcome.category);
    occurrenceEvidence = {
      occurrenceRecordId: occurrenceId,
      occurrenceRecordDigest: occurrenceOutcome.recordDigest,
      occurrenceAuditEventId: occurrenceOutcome.auditEventId,
    };
  }

  return success('activated', {
    recordClass: ACTIVATION_RECORD_CLASS,
    recordId,
    recordDigest: outcome.recordDigest,
    auditEventId: outcome.auditEventId,
    subject,
    workspaceId: request.workspaceId,
    decision,
    runtimeGrantId: grantId,
    reservedOccurrenceId,
    ...(occurrenceEvidence !== undefined ? { occurrenceRecordClass: EXECUTION_OCCURRENCE_RECORD_CLASS, ...occurrenceEvidence } : {}),
    registrySnapshotId: context.registry.registrySnapshotId,
    registrySnapshotDigest: context.registry.registrySnapshotDigest,
  });
}

/**
 * decideActivation command (host-asserted activation authority): registry
 * echo correlation → workspace resolution → the canonical bundle
 * subject/workspace coordination key → under-lock decision. Rejections
 * produce zero lifecycle records and zero mechanical write-audits.
 */
function runDecideActivation(context: ControlPlaneTrustedContext, request: Slice1Request): Slice1Result {
  const echo = request.registryEcho;
  if (echo === undefined) return failure('request-invalid');
  if (echo.registry_snapshot_id !== context.registry.registrySnapshotId || echo.registry_snapshot_digest !== context.registry.registrySnapshotDigest) {
    return failure('registry-context-mismatch');
  }
  const workspace = lookupValidatedWorkspace(context.configuration, request.workspaceId);
  if (workspace === undefined) return failure('lifecycle-state-missing');
  const subject = request.subject;
  if (subject === undefined) return failure('internal-failure');
  try {
    return context.coordinate.withLock(coordinationKeyOf(subject), () => decideActivationUnderLock(context, request, workspace));
  } catch (err) {
    if (err instanceof LockContentionError) return failure('lock-conflict');
    return failure('internal-failure');
  }
}

/**
 * createOccurrence — under-lock recovery decision (S3-D2/S3-D8): the exact
 * accepted ActivationRecord is the authoritative anchor; every construction
 * field derives from trusted stored facts. Recovery NEVER allocates another
 * occurrence ID, never creates another activation, never re-runs activation
 * authority/currentness, and never re-decides accepted→denied. Ambiguous or
 * conflicting state fails closed.
 */
function createOccurrenceUnderLock(
  context: ControlPlaneTrustedContext,
  request: Slice1Request,
): Slice1Result {
  const reservedOccurrenceId = request.reservedOccurrenceId;
  if (reservedOccurrenceId === undefined) return failure('internal-failure');

  const activationResult = readClassPayloads(context, ACTIVATION_RECORD_CLASS);
  if (!activationResult.ok) return failure('store-failure');
  const occurrenceResult = readClassPayloads(context, EXECUTION_OCCURRENCE_RECORD_CLASS);
  if (!occurrenceResult.ok) return failure('store-failure');
  const grantResult = readClassPayloads(context, RUNTIME_GRANT_CLASS);
  if (!grantResult.ok) return failure('store-failure');
  const revocationResult = readClassPayloads(context, REVOCATION_RECORD_CLASS);
  if (!revocationResult.ok) return failure('store-failure');
  const supersessionResult = readClassPayloads(context, 'supersession-record');
  if (!supersessionResult.ok) return failure('store-failure');
  const approvalResult = readClassPayloads(context, 'approval-record');
  if (!approvalResult.ok) return failure('store-failure');
  const issuanceResult = readClassPayloads(context, 'issuance-record');
  if (!issuanceResult.ok) return failure('store-failure');
  const validationResult = readClassPayloads(context, 'validation-record');
  if (!validationResult.ok) return failure('store-failure');

  const reservationActivations = activationsForReservation(activationResult.payloads, reservedOccurrenceId);
  if (reservationActivations.length === 0) return failure('lifecycle-state-missing');
  if (reservationActivations.length > 1) return failure('occurrence-conflict');
  const activation = reservationActivations[0]!;
  if (activation['decision'] !== 'accepted') return failure('lifecycle-state-missing');
  if (activation['workspace_id'] !== request.workspaceId) return failure('lifecycle-state-missing');

  // Occurrence absence (§15 preconditions): an existing occurrence for the
  // reservation makes the repair a conflict.
  if (occurrenceResult.payloads.some((o) => String(o['occurrence_id'] ?? '') === reservedOccurrenceId)) {
    return failure('occurrence-conflict');
  }

  // Exact historical grant correlation (S3-D8): the activation's grant must
  // exist and carry the same reservation/workspace/bundle relationships.
  const runtimeGrantId = String(activation['runtime_grant_id'] ?? '');
  const grant = grantResult.payloads.find((g) => String(g['record_id'] ?? '') === runtimeGrantId);
  if (grant === undefined) return failure('lifecycle-state-missing');
  if (String(grant['reserved_occurrence_id'] ?? '') !== reservedOccurrenceId) return failure('lifecycle-state-missing');
  if (grant['workspace_id'] !== activation['workspace_id']) return failure('lifecycle-state-missing');
  const activationBundle = activation['bundle'];
  if (!isRecord(activationBundle)) return failure('store-failure');
  const grantBundle = grant['bundle'];
  if (!isRecord(grantBundle)) return failure('store-failure');
  if (JSON.stringify(activationBundle) !== JSON.stringify(grantBundle)) return failure('lifecycle-state-missing');

  // The new ExecutionOccurrenceRecord is the lifecycle graph ENTRY candidate
  // under the CURRENT registry context; the historical activation/grant/
  // issuance records are supporting correlation records and are NOT
  // reclassified as current REG entries (§26.13 registry A → B scoping).
  const now = context.identity.nowUtcIso();
  const recordId = context.identity.newRecordId();
  const recoveredSubject = canonicalSubjectOfRecord(activation);
  if (recoveredSubject === undefined) return failure('store-failure');
  const candidate = buildExecutionOccurrenceRecordPayload({
    recordId,
    createdAt: now,
    activationRecordId: String(activation['record_id'] ?? ''),
    bundle: activationBundle,
    workspaceId: String(activation['workspace_id'] ?? ''),
    occurrenceId: reservedOccurrenceId,
    runtimeGrantId,
    registry: context.registry,
  });
  const graphReport = evaluateCandidateLifecycleRecord({
    existing: [
      ...approvalResult.payloads,
      ...issuanceResult.payloads,
      ...validationResult.payloads,
      ...revocationResult.payloads,
      ...supersessionResult.payloads,
      ...grantResult.payloads,
      ...activationResult.payloads,
      ...occurrenceResult.payloads,
    ],
    candidate,
    registry: context.registry,
    artifactsByRevision: new Map(),
    artifactsByInstance: new Map(),
  });
  if (graphReport.findings.length > 0) {
    // Recovery taxonomy (§26.19 createOccurrence): REG findings (the new
    // occurrence must be recordable under the CURRENT accepted registry
    // context) → registry-context-mismatch; broken historical chain
    // correlation (LFC) → lifecycle-state-missing; anything else stays
    // store-failure (the trusted store view itself is inconsistent). The
    // recovery token set never uses issuance-not-authorized or
    // eligibility-denied, so those categories fold into the closed
    // recovery tokens above.
    const category = mapActivationGraphFindings(graphReport.findings);
    if (category === 'registry-context-mismatch') return failure('registry-context-mismatch');
    if (category === 'lifecycle-state-missing' || category === 'issuance-not-authorized') return failure('lifecycle-state-missing');
    return failure('store-failure');
  }
  if (!schemaGate(context, candidate)) return failure('internal-failure');

  let published;
  try {
    published = context.store.publishLifecycleRecord(EXECUTION_OCCURRENCE_RECORD_CLASS, candidate);
  } catch {
    return failure('store-failure');
  }
  const outcome = publishOutcome(published, 'occurrence-conflict');
  if (!outcome.ok) return failure(outcome.category);

  return success('recovered', {
    recordClass: EXECUTION_OCCURRENCE_RECORD_CLASS,
    recordId,
    recordDigest: outcome.recordDigest,
    auditEventId: outcome.auditEventId,
    subject: recoveredSubject,
    workspaceId: String(activation['workspace_id'] ?? ''),
    activationRecordId: String(activation['record_id'] ?? ''),
    runtimeGrantId,
    reservedOccurrenceId,
    registrySnapshotId: context.registry.registrySnapshotId,
    registrySnapshotDigest: context.registry.registrySnapshotDigest,
  });
}

/**
 * createOccurrence command (host-asserted activation authority): registry
 * echo → workspace → PRE-LOCK locator read of the accepted activation for
 * the reservation (target/workspace eligibility + bundle-derived
 * coordination key ONLY; never decision authority) → lock → under-lock
 * recovery decision.
 */
function runCreateOccurrence(context: ControlPlaneTrustedContext, request: Slice1Request): Slice1Result {
  const echo = request.registryEcho;
  if (echo === undefined) return failure('request-invalid');
  if (echo.registry_snapshot_id !== context.registry.registrySnapshotId || echo.registry_snapshot_digest !== context.registry.registrySnapshotDigest) {
    return failure('registry-context-mismatch');
  }
  const workspace = lookupValidatedWorkspace(context.configuration, request.workspaceId);
  if (workspace === undefined) return failure('lifecycle-state-missing');
  const reservedOccurrenceId = request.reservedOccurrenceId;
  if (reservedOccurrenceId === undefined) return failure('internal-failure');

  // PRE-LOCK LOCATOR READ: existence/workspace eligibility + coordination
  // key derivation only (C5 two-stage discipline; the under-lock decision
  // re-reads everything).
  const locatorActivations = readClassPayloads(context, ACTIVATION_RECORD_CLASS);
  if (!locatorActivations.ok) return failure('store-failure');
  const locatorCandidates = activationsForReservation(locatorActivations.payloads, reservedOccurrenceId);
  if (locatorCandidates.length === 0) return failure('lifecycle-state-missing');
  if (locatorCandidates.length > 1) return failure('occurrence-conflict');
  const locatorActivation = locatorCandidates[0]!;
  if (locatorActivation['decision'] !== 'accepted') return failure('lifecycle-state-missing');
  if (locatorActivation['workspace_id'] !== request.workspaceId) return failure('lifecycle-state-missing');
  const key = coordinationKeyOfPayload(locatorActivation);
  if (key === undefined) return failure('store-failure');

  try {
    return context.coordinate.withLock(key, () => createOccurrenceUnderLock(context, request));
  } catch (err) {
    if (err instanceof LockContentionError) return failure('lock-conflict');
    return failure('internal-failure');
  }
}

// ─── Slice-4 orchestrationDecision + recordExecutionAttempt ─────────────────
// orchestrationDecision is the DECISION-ONLY Slice-4 surface (§27.1): bounded
// correlation/currentness/allowance evaluation over the exact occurrence
// anchor — zero lifecycle records, zero mechanical write-audits. The durable
// attempt-start / orchestration fact is the ExecutionAttemptRecord created
// by recordExecutionAttempt (§27.1): exactly one record + the normal WP-8
// mechanical audit. Both operations reuse the existing canonical bundle
// subject/workspace coordination-key family derived from the occurrence's
// grant bundle reference (§27.5), the accepted lifecycle graph (EXE-004/005/
// 006) and the accepted point-of-use machinery (EXE-007/LFC-007) (§27.4).

/**
 * The attempt requested use (point-of-use EXE-007 attempt path, §27.4). The
 * accepted policy rule set authorizes the workspace-read capability with
 * operation class 'read'; the 'attempt:' scope form is the accepted
 * machinery's attempt-use trigger (evaluatePointOfUseEligibility section 9).
 */
const ATTEMPT_REQUESTED_USE = {
  capability: 'project-gateway.workspace-read',
  operationClass: 'read',
  resourceClass: 'configured-artifact-area',
  scope: 'attempt:start',
} as const;

/** Store-derived attempt-decision facts (authoritative correlation anchor). */
interface AttemptDecisionFacts {
  readonly occurrence: Readonly<Record<string, unknown>>;
  readonly activation: Readonly<Record<string, unknown>>;
  readonly grant: Readonly<Record<string, unknown>>;
  readonly subject: CanonicalSubject;
  readonly existingAttempts: readonly Readonly<Record<string, unknown>>[];
  readonly attemptLimit: number;
  readonly grantCurrent: boolean;
  readonly remainingAllowance: number;
  /** Point-of-use EXE-007/LFC-007 intersection result (no early return; the graph gate decides REG recordability first). */
  readonly intersectionDenied: boolean;
  /** Store payloads re-read under the lock (graph-gate inputs). */
  readonly payloads: {
    readonly approvals: readonly Readonly<Record<string, unknown>>[];
    readonly issuances: readonly Readonly<Record<string, unknown>>[];
    readonly validations: readonly Readonly<Record<string, unknown>>[];
    readonly revocations: readonly Readonly<Record<string, unknown>>[];
    readonly supersessions: readonly Readonly<Record<string, unknown>>[];
    readonly grants: readonly Readonly<Record<string, unknown>>[];
    readonly activations: readonly Readonly<Record<string, unknown>>[];
    readonly occurrences: readonly Readonly<Record<string, unknown>>[];
    readonly attempts: readonly Readonly<Record<string, unknown>>[];
  };
}

/** All stored attempts for one occurrence (derived from immutable records). */
function attemptsForOccurrence(
  attempts: readonly Readonly<Record<string, unknown>>[],
  occurrenceId: string,
): readonly Readonly<Record<string, unknown>>[] {
  return Object.freeze(attempts.filter((a) => String(a['occurrence_id'] ?? '') === occurrenceId));
}

/**
 * Shared under-lock attempt decision (gates B–D; §27.2/§27.3/§27.4/§27.6):
 * the occurrence is the caller correlation anchor ONLY; activation/grant/
 * bundle authority is derived from the exact stored records. Returns the
 * authoritative facts for the caller (orchestrationDecision builds evidence;
 * recordExecutionAttempt builds + publishes the attempt record). Ordinal
 * validation (exact count + 1, unique/gapless, allowance, EXE-006 retry
 * subject stability) and currentness/point-of-use evaluation are performed
 * here for BOTH operations. No created_at / record-ID / first-enumeration /
 * newest-record selection ever occurs.
 */
function attemptDecisionUnderLock(
  context: ControlPlaneTrustedContext,
  request: Slice1Request,
): { readonly ok: true; readonly facts: AttemptDecisionFacts } | { readonly ok: false; readonly category: Slice1FailureCategory } {
  const reservedOccurrenceId = request.reservedOccurrenceId;
  if (reservedOccurrenceId === undefined) return { ok: false, category: 'internal-failure' };

  const activationResult = readClassPayloads(context, ACTIVATION_RECORD_CLASS);
  if (!activationResult.ok) return { ok: false, category: 'store-failure' };
  const occurrenceResult = readClassPayloads(context, EXECUTION_OCCURRENCE_RECORD_CLASS);
  if (!occurrenceResult.ok) return { ok: false, category: 'store-failure' };
  const grantResult = readClassPayloads(context, RUNTIME_GRANT_CLASS);
  if (!grantResult.ok) return { ok: false, category: 'store-failure' };
  const revocationResult = readClassPayloads(context, REVOCATION_RECORD_CLASS);
  if (!revocationResult.ok) return { ok: false, category: 'store-failure' };
  const supersessionResult = readClassPayloads(context, 'supersession-record');
  if (!supersessionResult.ok) return { ok: false, category: 'store-failure' };
  const approvalResult = readClassPayloads(context, 'approval-record');
  if (!approvalResult.ok) return { ok: false, category: 'store-failure' };
  const issuanceResult = readClassPayloads(context, 'issuance-record');
  if (!issuanceResult.ok) return { ok: false, category: 'store-failure' };
  const validationResult = readClassPayloads(context, 'validation-record');
  if (!validationResult.ok) return { ok: false, category: 'store-failure' };
  const attemptResult = readClassPayloads(context, EXECUTION_ATTEMPT_RECORD_CLASS);
  if (!attemptResult.ok) return { ok: false, category: 'store-failure' };

  // Gate B — occurrence anchor + exact store-derived correlation (§27.2):
  // occurrence → activation → grant → bundle bytes, all exact. Failures are
  // non-disclosing lifecycle-state-missing; a structurally conflicting
  // occurrence set is occurrence-conflict.
  const occurrences = occurrenceResult.payloads.filter((o) => String(o['occurrence_id'] ?? '') === reservedOccurrenceId);
  if (occurrences.length === 0) return { ok: false, category: 'lifecycle-state-missing' };
  if (occurrences.length > 1) return { ok: false, category: 'occurrence-conflict' };
  const occurrence = occurrences[0]!;
  if (occurrence['workspace_id'] !== request.workspaceId) return { ok: false, category: 'lifecycle-state-missing' };
  const activationRecordId = String(occurrence['activation_record_id'] ?? '');
  const activation = activationResult.payloads.find((a) => String(a['record_id'] ?? '') === activationRecordId);
  if (activation === undefined || String(activation['record_type'] ?? '') !== 'ActivationRecord') return { ok: false, category: 'occurrence-conflict' };
  if (activation['decision'] !== 'accepted') return { ok: false, category: 'occurrence-conflict' };
  if (activation['workspace_id'] !== occurrence['workspace_id']) return { ok: false, category: 'lifecycle-state-missing' };
  const activationBundle = activation['bundle'];
  if (!isRecord(activationBundle) || !isRecord(occurrence['bundle'])) return { ok: false, category: 'store-failure' };
  if (JSON.stringify(activationBundle) !== JSON.stringify(occurrence['bundle'])) return { ok: false, category: 'lifecycle-state-missing' };
  const runtimeGrantId = String(occurrence['runtime_grant_id'] ?? '');
  const grant = grantResult.payloads.find((g) => String(g['record_id'] ?? '') === runtimeGrantId);
  if (grant === undefined) return { ok: false, category: 'lifecycle-state-missing' };
  if (String(grant['reserved_occurrence_id'] ?? '') !== reservedOccurrenceId) return { ok: false, category: 'lifecycle-state-missing' };
  if (grant['workspace_id'] !== occurrence['workspace_id']) return { ok: false, category: 'lifecycle-state-missing' };
  if (!isRecord(grant['bundle'])) return { ok: false, category: 'store-failure' };
  if (JSON.stringify(grant['bundle']) !== JSON.stringify(occurrence['bundle'])) return { ok: false, category: 'lifecycle-state-missing' };
  const subject = canonicalSubjectOfRecord(occurrence);
  if (subject === undefined) return { ok: false, category: 'store-failure' };

  // Host-injected validated bundle evidence correlated to the occurrence's
  // exact bundle reference (authority stays store-derived; the model feeds
  // the accepted point-of-use evaluation). Host-context inconsistency fails
  // closed as internal-failure (no request subject exists to blame).
  const bundleModel = (() => {
    const artifact = context.subjectArtifact;
    if (!isRecord(artifact) || !isBrandedArtifact(artifact)) return undefined;
    const model = artifact['model'];
    if (!isRecord(model)) return undefined;
    const kind = occurrenceBundleKind(occurrence['bundle']);
    if (kind === undefined || kind.id !== 'ExecutionBundle') return undefined;
    if (artifact['instanceId'] !== occurrenceBundleInstance(occurrence['bundle'])) return undefined;
    if (artifact['revisionId'] !== occurrenceBundleRevision(occurrence['bundle'])) return undefined;
    if (artifact['digest'] !== occurrenceBundleDigest(occurrence['bundle'])) return undefined;
    const modelKind = model['kind'];
    const modelProtocol = model['protocol'];
    if (!isRecord(modelKind) || modelKind['id'] !== kind.id || modelKind['version'] !== kind.version) return undefined;
    if (!isRecord(modelProtocol) || modelProtocol['version'] !== occurrenceBundleProtocol(occurrence['bundle'])) return undefined;
    return model;
  })();
  if (bundleModel === undefined) return { ok: false, category: 'internal-failure' };
  const members = bundleMembersOf(bundleModel);
  if (members === undefined) return { ok: false, category: 'internal-failure' };

  // Gate C — ordinal semantics (§27.3): proposed ordinal must equal the
  // durable attempt count + 1 (unique/gapless); allowance must remain
  // (ordinal <= attempt_limit and count < attempt_limit). A malformed
  // authoritative attempt_limit fails closed as store-failure. For
  // orchestrationDecision (no proposed ordinal) the allowance check is the
  // same EXE-005 family → attempt-ordinal-conflict.
  const existingAttempts = attemptsForOccurrence(attemptResult.payloads, reservedOccurrenceId);
  const count = existingAttempts.length;
  const limitValue = grant['attempt_limit'];
  if (typeof limitValue !== 'number' || !Number.isSafeInteger(limitValue) || limitValue < 1) return { ok: false, category: 'store-failure' };
  const attemptLimit = limitValue;
  const ordinal = request.ordinal;
  if (ordinal !== undefined) {
    if (ordinal !== count + 1 || ordinal > attemptLimit || count >= attemptLimit) return { ok: false, category: 'attempt-ordinal-conflict' };
    if (count > 0) {
      // EXE-006 retry subject stability: the retry must preserve the exact
      // bundle/workspace/occurrence/grant correlation of the first attempt.
      const first = [...existingAttempts].sort((a, b) => Number(a['ordinal']) - Number(b['ordinal']))[0]!;
      const sameBundle = isRecord(first['bundle']) && JSON.stringify(first['bundle']) === JSON.stringify(occurrence['bundle']);
      const sameWorkspace = String(first['workspace_id'] ?? '') === occurrence['workspace_id'];
      const sameGrant = String(first['runtime_grant_id'] ?? '') === runtimeGrantId;
      const sameOccurrence = String(first['occurrence_id'] ?? '') === reservedOccurrenceId;
      if (!sameBundle || !sameWorkspace || !sameGrant || !sameOccurrence) return { ok: false, category: 'attempt-ordinal-conflict' };
    }
  } else if (count >= attemptLimit) {
    return { ok: false, category: 'attempt-ordinal-conflict' };
  }

  // Gate D — currentness (§27.6): revoked/expired/not-yet-valid grant at
  // attempt start → eligibility-denied (the closed point-of-use eligibility
  // category; grant-revoked/grant-expired remain verify read-form tokens).
  const now = context.identity.nowUtcIso();
  const grantState = currentnessOf(grant, revocationResult.payloads, supersessionResult.payloads, now).state;
  const validity = grant['validity'];
  const notBefore = isRecord(validity) ? validity['not_before'] : undefined;
  const notAfter = isRecord(validity) ? validity['not_after'] : undefined;
  const withinValidity =
    (typeof notBefore !== 'string' || notBefore <= now) &&
    (typeof notAfter !== 'string' || now <= notAfter);
  const grantCurrent = grantState === 'current' && withinValidity;
  if (!grantCurrent) return { ok: false, category: 'eligibility-denied' };

  // Point-of-use EXE-007/LFC-007 intersection (accepted machinery; §27.4):
  // grant/validity/revocation, prerequisite-issuance currentness, consumer
  // support, ceilings, policy, and bundle requirements. Ineligible →
  // eligibility-denied. The allowance dimension is already decided above
  // (attempt-ordinal-conflict), so the machinery's EXE-005 allowance finding
  // never changes the token.
  const policyModel = (() => {
    if (context.policyEvidence === undefined) return undefined;
    const model = context.policyEvidence.model as Readonly<Record<string, unknown>>;
    const policyMember = members.find((member) => member.kindId === 'AuthorityPolicy');
    if (policyMember === undefined) return undefined;
    if (context.policyEvidence.instanceId !== policyMember.instanceId) return undefined;
    if (context.policyEvidence.revisionId !== policyMember.revisionId) return undefined;
    if (context.policyEvidence.digest !== policyMember.digest) return undefined;
    return model;
  })();
  const lifecycleView = buildLifecycleView([
    approvalResult.payloads, issuanceResult.payloads, validationResult.payloads,
    revocationResult.payloads, supersessionResult.payloads, grantResult.payloads,
    activationResult.payloads, occurrenceResult.payloads, attemptResult.payloads,
  ]);
  const revocationsView = buildRevocationView(revocationResult.payloads);
  const workspace = lookupValidatedWorkspace(context.configuration, request.workspaceId);
  if (workspace === undefined) return { ok: false, category: 'lifecycle-state-missing' };
  // Point-of-use EXE-007/LFC-007 intersection (accepted machinery; §27.4):
  // computed here but NOT early-returned — the graph gate (recordability /
  // EXE findings) decides first, exactly like Slice-3B's PHASE-1/PHASE-2
  // ordering, so a registry-incompatible correlation chain rejects with
  // registry-context-mismatch rather than being collapsed into an
  // eligibility denial. The allowance dimension is already decided above
  // (attempt-ordinal-conflict), so the machinery's EXE-005 allowance finding
  // never changes the token.
  const intersectionDenied = pointOfUseIntersectionDenied(
    context, workspace, ATTEMPT_REQUESTED_USE, bundleModel, policyModel, grant, lifecycleView, revocationsView, now,
  );

  return {
    ok: true,
    facts: Object.freeze({
      occurrence,
      activation,
      grant,
      subject,
      existingAttempts,
      attemptLimit,
      grantCurrent,
      remainingAllowance: attemptLimit - count,
      intersectionDenied,
      payloads: Object.freeze({
        approvals: approvalResult.payloads,
        issuances: issuanceResult.payloads,
        validations: validationResult.payloads,
        revocations: revocationResult.payloads,
        supersessions: supersessionResult.payloads,
        grants: grantResult.payloads,
        activations: activationResult.payloads,
        occurrences: occurrenceResult.payloads,
        attempts: attemptResult.payloads,
      }),
    }),
  };
}

/** Extract the exact bundle-reference fields of an occurrence payload (grant-shaped form). */
function occurrenceBundleKind(bundle: unknown): { readonly id: string; readonly version: string } | undefined {
  if (!isRecord(bundle)) return undefined;
  const kind = bundle['target_kind'];
  if (!isRecord(kind) || typeof kind['id'] !== 'string' || typeof kind['version'] !== 'string') return undefined;
  return Object.freeze({ id: kind['id'], version: kind['version'] });
}
function occurrenceBundleInstance(bundle: unknown): string | undefined {
  return isRecord(bundle) && typeof bundle['target_instance_id'] === 'string' ? bundle['target_instance_id'] : undefined;
}
function occurrenceBundleRevision(bundle: unknown): string | undefined {
  return isRecord(bundle) && typeof bundle['target_revision_id'] === 'string' ? bundle['target_revision_id'] : undefined;
}
function occurrenceBundleDigest(bundle: unknown): string | undefined {
  return isRecord(bundle) && typeof bundle['target_digest'] === 'string' ? bundle['target_digest'] : undefined;
}
function occurrenceBundleProtocol(bundle: unknown): string | undefined {
  return isRecord(bundle) && typeof bundle['target_protocol_version'] === 'string' ? bundle['target_protocol_version'] : undefined;
}

/**
 * orchestrationDecision — under-lock decision-only evaluation (§27.1): zero
 * lifecycle records, zero mechanical write-audits; bounded non-record
 * orchestration evidence (§27.7).
 */
function orchestrationDecisionUnderLock(context: ControlPlaneTrustedContext, request: Slice1Request): Slice1Result {
  const decided = attemptDecisionUnderLock(context, request);
  if (!decided.ok) return failure(decided.category);
  const facts = decided.facts;
  // REG-recordability/correlation gate (§27.6, SIR-W12-S4-001): the SAME
  // accepted graph evaluation and mapping as recordExecutionAttempt, with
  // the occurrence as the graph ENTRY candidate (existing minus the
  // occurrence itself) and the correlated activation/grant as REG entries —
  // so a registry-incompatible correlation chain yields
  // registry-context-mismatch BEFORE the generic point-of-use eligibility
  // fallback. No second registry evaluator is introduced; the occurrence/
  // activation/grant correlation remains trusted-store-derived (gate B).
  const occurrenceRecordId = String(facts.occurrence['record_id'] ?? '');
  const graphReport = evaluateCandidateLifecycleRecord({
    existing: [
      ...facts.payloads.approvals,
      ...facts.payloads.issuances,
      ...facts.payloads.validations,
      ...facts.payloads.revocations,
      ...facts.payloads.supersessions,
      ...facts.payloads.grants,
      ...facts.payloads.activations,
      ...facts.payloads.attempts,
      ...facts.payloads.occurrences.filter((o) => String(o['record_id'] ?? '') !== occurrenceRecordId),
    ],
    candidate: facts.occurrence,
    registry: context.registry,
    artifactsByRevision: new Map(),
    artifactsByInstance: new Map(),
    extraRegistryEntries: new Set([String(facts.activation['record_id'] ?? ''), String(facts.grant['record_id'] ?? '')]),
  });
  const category = mapAttemptGraphFindings(graphReport.findings);
  if (category !== undefined) return failure(category);
  // Point-of-use ineligibility → eligibility-denied (§27.6).
  if (facts.intersectionDenied) return failure('eligibility-denied');
  return success('orchestrated', {
    recordClass: EXECUTION_OCCURRENCE_RECORD_CLASS,
    recordId: occurrenceRecordId,
    occurrenceRecordClass: EXECUTION_OCCURRENCE_RECORD_CLASS,
    occurrenceRecordId,
    subject: facts.subject,
    workspaceId: request.workspaceId,
    reservedOccurrenceId: request.reservedOccurrenceId,
    activationRecordId: String(facts.activation['record_id'] ?? ''),
    runtimeGrantId: String(facts.grant['record_id'] ?? ''),
    grantCurrent: facts.grantCurrent,
    remainingAllowance: facts.remainingAllowance,
    registrySnapshotId: context.registry.registrySnapshotId,
    registrySnapshotDigest: context.registry.registrySnapshotDigest,
  });
}

/**
 * recordExecutionAttempt — under-lock attempt recording (§27.1): exactly one
 * ExecutionAttemptRecord on success + the normal WP-8 mechanical
 * authorized-write audit; zero records on any failure. The attempt ID is
 * allocated INTERNALLY (pgw:a:) under the lock; the graph gate (EXE-004/005/
 * 006 + REG recordability) is the single lifecycle rule authority backstop.
 */
function recordExecutionAttemptUnderLock(context: ControlPlaneTrustedContext, request: Slice1Request): Slice1Result {
  const decided = attemptDecisionUnderLock(context, request);
  if (!decided.ok) return failure(decided.category);
  const facts = decided.facts;
  const ordinal = request.ordinal;
  if (ordinal === undefined) return failure('internal-failure');

  const now = context.identity.nowUtcIso();
  const attemptId = context.identity.newAttemptId();
  const recordId = context.identity.newRecordId();
  const reservedOccurrenceId = String(facts.occurrence['occurrence_id'] ?? '');
  const occurrenceBundle = facts.occurrence['bundle'];
  if (!isRecord(occurrenceBundle)) return failure('store-failure');
  const candidate = buildExecutionAttemptRecordPayload({
    recordId,
    createdAt: now,
    activationRecordId: String(facts.activation['record_id'] ?? ''),
    occurrenceId: reservedOccurrenceId,
    attemptId,
    ordinal,
    bundle: occurrenceBundle,
    workspaceId: request.workspaceId,
    runtimeGrantId: String(facts.grant['record_id'] ?? ''),
    registry: context.registry,
  });

  // Graph gate (§27.4/§27.6): the candidate attempt is the graph entry; the
  // correlated occurrence/activation/grant are REG entries (recordability
  // under the CURRENT accepted registry context).
  const graphReport = evaluateCandidateLifecycleRecord({
    existing: [
      ...facts.payloads.approvals,
      ...facts.payloads.issuances,
      ...facts.payloads.validations,
      ...facts.payloads.revocations,
      ...facts.payloads.supersessions,
      ...facts.payloads.grants,
      ...facts.payloads.activations,
      ...facts.payloads.occurrences,
      ...facts.payloads.attempts,
    ],
    candidate,
    registry: context.registry,
    artifactsByRevision: new Map(),
    artifactsByInstance: new Map(),
    extraRegistryEntries: new Set([String(facts.activation['record_id'] ?? ''), String(facts.grant['record_id'] ?? ''), String(facts.occurrence['record_id'] ?? '')]),
  });
  const category = mapAttemptGraphFindings(graphReport.findings);
  if (category !== undefined) return failure(category);

  // Point-of-use ineligibility (EXE-007/LFC-007) → eligibility-denied
  // (§27.6); the graph gate above already decided REG recordability and
  // ordinal/occurrence integrity.
  if (facts.intersectionDenied) return failure('eligibility-denied');

  if (!schemaGate(context, candidate)) return failure('internal-failure');

  let published;
  try {
    published = context.store.publishLifecycleRecord(EXECUTION_ATTEMPT_RECORD_CLASS, candidate);
  } catch {
    return failure('store-failure');
  }
  const outcome = publishOutcome(published, 'attempt-ordinal-conflict');
  if (!outcome.ok) return failure(outcome.category);
  return success('attempt-recorded', {
    recordClass: EXECUTION_ATTEMPT_RECORD_CLASS,
    recordId,
    recordDigest: outcome.recordDigest,
    auditEventId: outcome.auditEventId,
    subject: facts.subject,
    workspaceId: request.workspaceId,
    reservedOccurrenceId: request.reservedOccurrenceId,
    activationRecordId: String(facts.activation['record_id'] ?? ''),
    runtimeGrantId: String(facts.grant['record_id'] ?? ''),
    attemptId,
    ordinal,
    attemptRecordClass: EXECUTION_ATTEMPT_RECORD_CLASS,
    attemptRecordId: recordId,
    attemptRecordDigest: outcome.recordDigest,
    attemptAuditEventId: outcome.auditEventId,
    registrySnapshotId: context.registry.registrySnapshotId,
    registrySnapshotDigest: context.registry.registrySnapshotDigest,
  });
}

/**
 * orchestrationDecision command (host-asserted execution-recorder role;
 * §27.2): echo → workspace → PRE-LOCK locator read of the occurrence anchor
 * (existence/workspace eligibility + bundle-derived coordination key ONLY;
 * never decision authority) → lock → under-lock decision-only evaluation.
 */
function runOrchestrationDecision(context: ControlPlaneTrustedContext, request: Slice1Request): Slice1Result {
  const echo = request.registryEcho;
  if (echo === undefined) return failure('request-invalid');
  if (echo.registry_snapshot_id !== context.registry.registrySnapshotId || echo.registry_snapshot_digest !== context.registry.registrySnapshotDigest) {
    return failure('registry-context-mismatch');
  }
  const workspace = lookupValidatedWorkspace(context.configuration, request.workspaceId);
  if (workspace === undefined) return failure('lifecycle-state-missing');
  const reservedOccurrenceId = request.reservedOccurrenceId;
  if (reservedOccurrenceId === undefined) return failure('internal-failure');
  const locator = locateOccurrence(context, reservedOccurrenceId, request.workspaceId);
  if (locator === 'missing') return failure('lifecycle-state-missing');
  if (locator === 'conflict') return failure('occurrence-conflict');
  if (locator === 'store-failure') return failure('store-failure');
  try {
    return context.coordinate.withLock(locator.key, () => orchestrationDecisionUnderLock(context, request));
  } catch (err) {
    if (err instanceof LockContentionError) return failure('lock-conflict');
    return failure('internal-failure');
  }
}

/**
 * recordExecutionAttempt command (host-asserted execution-recorder role;
 * §27.2): same two-stage discipline as orchestrationDecision; the ordinal is
 * the untrusted caller-proposed operand validated under the lock (§27.3).
 */
function runRecordExecutionAttempt(context: ControlPlaneTrustedContext, request: Slice1Request): Slice1Result {
  const echo = request.registryEcho;
  if (echo === undefined) return failure('request-invalid');
  if (echo.registry_snapshot_id !== context.registry.registrySnapshotId || echo.registry_snapshot_digest !== context.registry.registrySnapshotDigest) {
    return failure('registry-context-mismatch');
  }
  const workspace = lookupValidatedWorkspace(context.configuration, request.workspaceId);
  if (workspace === undefined) return failure('lifecycle-state-missing');
  const reservedOccurrenceId = request.reservedOccurrenceId;
  if (reservedOccurrenceId === undefined || request.ordinal === undefined) return failure('internal-failure');
  const locator = locateOccurrence(context, reservedOccurrenceId, request.workspaceId);
  if (locator === 'missing') return failure('lifecycle-state-missing');
  if (locator === 'conflict') return failure('occurrence-conflict');
  if (locator === 'store-failure') return failure('store-failure');
  try {
    return context.coordinate.withLock(locator.key, () => recordExecutionAttemptUnderLock(context, request));
  } catch (err) {
    if (err instanceof LockContentionError) return failure('lock-conflict');
    return failure('internal-failure');
  }
}

/**
 * Pre-lock occurrence locator read (C5 two-stage discipline): existence /
 * workspace eligibility + the bundle-derived coordination key ONLY — never
 * decision authority (the under-lock decision re-reads everything).
 */
function locateOccurrence(
  context: ControlPlaneTrustedContext,
  reservedOccurrenceId: string,
  workspaceId: string,
): { readonly key: string } | 'missing' | 'conflict' | 'store-failure' {
  const occurrenceResult = readClassPayloads(context, EXECUTION_OCCURRENCE_RECORD_CLASS);
  if (!occurrenceResult.ok) return 'store-failure';
  const candidates = occurrenceResult.payloads.filter((o) => String(o['occurrence_id'] ?? '') === reservedOccurrenceId);
  if (candidates.length === 0) return 'missing';
  if (candidates.length > 1) return 'conflict';
  const candidate = candidates[0]!;
  if (candidate['workspace_id'] !== workspaceId) return 'missing';
  const key = coordinationKeyOfPayload(candidate);
  if (key === undefined) return 'store-failure';
  return { key };
}

// ─── Slice-2B verify — read-only current-state evaluation ───────────────────
// verifyCurrentLifecycleState is a NON-AUTHORIZING, transport-free,
// mutation-free current-state evaluator over the records observed during
// one completed evaluation (contract §25.3/§25.17/§25.18). It takes NO
// mutation coordination lock, publishes NOTHING, creates NO audit event,
// and returns bounded evidence only. The accepted Slice-1 currentness
// (currentnessOf), the accepted WP-4 lifecycle graph (LFC/REG), the
// accepted WP-6 ceilings, and the accepted 2A RevocationRecord semantics
// are reused; no second state machine or evaluator is created.

/** Empty artifact maps: verification carries no artifact evidence (host consumers may not hold it). */
const EMPTY_ARTIFACT_MAP: ReadonlyMap<string, Readonly<Record<string, unknown>>> = new Map();

interface ObservedLifecycleState {
  readonly approvals: readonly Readonly<Record<string, unknown>>[];
  readonly validations: readonly Readonly<Record<string, unknown>>[];
  readonly revocations: readonly Readonly<Record<string, unknown>>[];
  readonly supersessions: readonly Readonly<Record<string, unknown>>[];
  readonly issuances: readonly Readonly<Record<string, unknown>>[];
}

/** Bounded trusted-store reads over every lifecycle class (fixed order; fail closed). */
function readObservedState(context: ControlPlaneTrustedContext): { readonly ok: true; readonly state: ObservedLifecycleState } | { readonly ok: false } {
  const approvals = readClassPayloads(context, 'approval-record');
  if (!approvals.ok) return { ok: false };
  const validations = readClassPayloads(context, 'validation-record');
  if (!validations.ok) return { ok: false };
  const revocations = readClassPayloads(context, REVOCATION_RECORD_CLASS);
  if (!revocations.ok) return { ok: false };
  const supersessions = readClassPayloads(context, 'supersession-record');
  if (!supersessions.ok) return { ok: false };
  const issuances = readClassPayloads(context, 'issuance-record');
  if (!issuances.ok) return { ok: false };
  return {
    ok: true,
    state: {
      approvals: approvals.payloads,
      validations: validations.payloads,
      revocations: revocations.payloads,
      supersessions: supersessions.payloads,
      issuances: issuances.payloads,
    },
  };
}

/**
 * Revocation records relevant to one target for the requested lifecycle
 * scope (all-uses or exact scope match) — the accepted 2A applicability
 * predicate, used to extend the REGISTRY entry check to "relevant
 * RevocationRecord state" (contract §17). Malformed effective_at is
 * skipped exactly as the accepted currentnessOf does.
 */
function applicableRevocationIds(recordId: string, revocations: readonly Readonly<Record<string, unknown>>[], requestedScope: string): readonly string[] {
  const out: string[] = [];
  for (const revocation of revocations) {
    if (String(revocation['record_type']) !== 'RevocationRecord') continue;
    const target = revocation['target'];
    if (!isRecord(target)) continue;
    if (target['record_id'] !== recordId) continue;
    const scope = revocation['scope'];
    if (scope !== 'all-uses' && scope !== requestedScope) continue;
    const effectiveAt = revocation['effective_at'];
    if (typeof effectiveAt !== 'string' || !isAcceptedTimestamp(effectiveAt)) continue;
    out.push(String(revocation['record_id'] ?? ''));
  }
  return Object.freeze(out);
}

/**
 * Accepted WP-4 graph evaluation over one verified record (LFC chain rules
 * + REG registry rules). The candidate is the entry; applicable revocation
 * records join the REGISTRY entry check only. Missing-approval mapping
 * depends on the form (approval form: lifecycle-state-missing; issuance
 * dependency: issuance-not-authorized).
 */
function verificationGraph(
  context: ControlPlaneTrustedContext,
  observed: ObservedLifecycleState,
  candidate: Readonly<Record<string, unknown>>,
  extraRegistryEntries: readonly string[],
  missingApprovalCategory: 'lifecycle-state-missing' | 'issuance-not-authorized',
): Slice1FailureCategory | undefined {
  const candidateId = String(candidate['record_id'] ?? '');
  const existing = observed.approvals
    .concat(observed.validations, observed.revocations, observed.supersessions, observed.issuances)
    .filter((record) => String(record['record_id'] ?? '') !== candidateId);
  const report = evaluateCandidateLifecycleRecord({
    existing,
    candidate,
    registry: context.registry,
    artifactsByRevision: EMPTY_ARTIFACT_MAP,
    artifactsByInstance: EMPTY_ARTIFACT_MAP,
    ...(extraRegistryEntries.length > 0 ? { extraRegistryEntries: new Set(extraRegistryEntries) } : {}),
  });
  return mapVerificationFindings(report.findings, missingApprovalCategory);
}

/**
 * Requested-capability × current-ceiling × consumer-support intersection
 * (contract §25.16). Unknown-but-well-formed → eligibility-denied; known
 * capability denied by the CURRENT host ceiling → ceiling-denied; known
 * capability the consumer does not declare → eligibility-denied. Empty
 * requirements are vacuously satisfied.
 */
function verifyIntersection(
  context: ControlPlaneTrustedContext,
  workspace: NonNullable<ReturnType<typeof lookupValidatedWorkspace>>,
  capabilityRequirements: readonly string[],
  consumerSupport: ConsumerSupportDeclaration,
): { readonly ok: true } | { readonly ok: false; readonly category: 'ceiling-denied' | 'eligibility-denied' } {
  for (const capability of capabilityRequirements) {
    if (!isKnownCapability(capability)) return { ok: false, category: 'eligibility-denied' };
    if (capabilityCeilingDenied(context.configuration, workspace, capability)) return { ok: false, category: 'ceiling-denied' };
    if (!consumerSupport.supportedConsumerCapabilities.includes(capability)) return { ok: false, category: 'eligibility-denied' };
  }
  return { ok: true };
}

/** Approval-form verification (§11): exactly one usable current matching ApprovalRecord. */
function verifyApprovalForm(
  context: ControlPlaneTrustedContext,
  request: Slice1Request,
  subject: CanonicalSubject,
  workspace: NonNullable<ReturnType<typeof lookupValidatedWorkspace>>,
  now: string,
  observed: ObservedLifecycleState,
): Slice1Result {
  const purpose = request.purpose;
  const consumerSupport = request.consumerSupport;
  const capabilities = request.capabilityRequirements;
  if (purpose === undefined || consumerSupport === undefined || capabilities === undefined) return failure('internal-failure');
  // Exact subject + exact workspace + exact purpose (accepted matching plus
  // the request purpose filter; state from the accepted currentnessOf).
  const matching = matchingApprovals(observed.approvals, observed.revocations, observed.supersessions, subject, now)
    .filter((entry) => entry.payload['purpose'] === purpose);
  if (matching.length === 0) return failure('lifecycle-state-missing');
  const current = matching.filter((entry) => entry.state === 'current');
  if (current.length > 1) return failure('lifecycle-conflict');
  if (current.length === 0) {
    if (matching.some((entry) => entry.state === 'revoked')) return failure('approval-revoked');
    return failure('lifecycle-state-missing');
  }
  const candidate = current[0]!.payload;
  const revocationEntries = applicableRevocationIds(String(candidate['record_id'] ?? ''), observed.revocations, purpose);
  const category = verificationGraph(context, observed, candidate, revocationEntries, 'lifecycle-state-missing');
  if (category !== undefined) return failure(category);
  const intersection = verifyIntersection(context, workspace, capabilities, consumerSupport);
  if (!intersection.ok) return failure(intersection.category);
  return success('verified', {
    recordClass: 'approval-record',
    recordId: String(candidate['record_id'] ?? ''),
    subject,
    workspaceId: request.workspaceId,
    purpose,
    approvalRecordId: String(candidate['record_id'] ?? ''),
    registrySnapshotId: context.registry.registrySnapshotId,
    registrySnapshotDigest: context.registry.registrySnapshotDigest,
    verifiedAt: now,
    currentState: 'current',
    intersection: 'satisfied',
  });
}

/** Issuance-form verification (§12): exactly one usable current matching IssuanceRecord with a CURRENT AND USABLE referenced ApprovalRecord. */
function verifyIssuanceForm(
  context: ControlPlaneTrustedContext,
  request: Slice1Request,
  subject: CanonicalSubject,
  workspace: NonNullable<ReturnType<typeof lookupValidatedWorkspace>>,
  now: string,
  observed: ObservedLifecycleState,
): Slice1Result {
  const useClass = request.useClass;
  const consumerSupport = request.consumerSupport;
  const capabilities = request.capabilityRequirements;
  if (useClass === undefined || consumerSupport === undefined || capabilities === undefined) return failure('internal-failure');
  const matching = observed.issuances.filter((issuance) => sameIssuanceScope(issuance, subject, useClass));
  if (matching.length === 0) return failure('issuance-not-authorized');
  const classified = matching.map((issuance) => ({
    payload: issuance,
    state: currentnessOf(issuance, observed.revocations, observed.supersessions, now).state,
  }));
  const current = classified.filter((entry) => entry.state === 'current');
  if (current.length > 1) return failure('lifecycle-conflict');
  if (current.length === 0) return failure('issuance-not-authorized');
  const candidate = current[0]!.payload;
  const candidateId = String(candidate['record_id'] ?? '');
  const issuanceRevocations = applicableRevocationIds(candidateId, observed.revocations, useClass);
  const issuanceCategory = verificationGraph(context, observed, candidate, issuanceRevocations, 'issuance-not-authorized');
  if (issuanceCategory !== undefined) return failure(issuanceCategory);
  // The referenced ApprovalRecord must itself be CURRENT AND USABLE.
  const approvalId = String(candidate['approval_record_id'] ?? '');
  const approval = observed.approvals.find((a) => String(a['record_id'] ?? '') === approvalId);
  if (approval === undefined) return failure('issuance-not-authorized');
  const approvalState = currentnessOf(approval, observed.revocations, observed.supersessions, now).state;
  if (approvalState === 'revoked') return failure('approval-revoked');
  if (approvalState !== 'current') return failure('issuance-not-authorized');
  const approvalRevocations = applicableRevocationIds(approvalId, observed.revocations, useClass);
  const approvalCategory = verificationGraph(context, observed, approval, approvalRevocations, 'issuance-not-authorized');
  if (approvalCategory !== undefined) return failure(approvalCategory);
  const intersection = verifyIntersection(context, workspace, capabilities, consumerSupport);
  if (!intersection.ok) return failure(intersection.category);
  return success('verified', {
    recordClass: 'issuance-record',
    recordId: candidateId,
    subject,
    workspaceId: request.workspaceId,
    useClass,
    approvalRecordId: approvalId,
    issuanceRecordId: candidateId,
    registrySnapshotId: context.registry.registrySnapshotId,
    registrySnapshotDigest: context.registry.registrySnapshotDigest,
    verifiedAt: now,
    currentState: 'current',
    intersection: 'satisfied',
  });
}

/**
 * Slice-2B verify (read-only, non-linearizable, mutation-free): registry
 * echo correlation → trusted workspace resolution → trusted time capture →
 * bounded observed-state reads → form evaluation → bounded evidence. No
 * trusted role gate; no coordination lock; no publication.
 */
function runVerify(context: ControlPlaneTrustedContext, request: Slice1Request): Slice1Result {
  const subject = request.subject;
  const echo = request.registryEcho;
  if (subject === undefined || echo === undefined) return failure('internal-failure');
  // Registry echo: REQUIRED untrusted correlation operand; authoritative
  // context is host-injected. Missing/malformed → request-invalid (capture);
  // differing → registry-context-mismatch.
  if (echo.registry_snapshot_id !== context.registry.registrySnapshotId || echo.registry_snapshot_digest !== context.registry.registrySnapshotDigest) {
    return failure('registry-context-mismatch');
  }
  const workspace = lookupValidatedWorkspace(context.configuration, request.workspaceId);
  if (workspace === undefined) return failure('lifecycle-state-missing');
  const now = context.identity.nowUtcIso();
  const observedResult = readObservedState(context);
  if (!observedResult.ok) return failure('store-failure');
  const observed = observedResult.state;
  if (request.purpose !== undefined) return verifyApprovalForm(context, request, subject, workspace, now, observed);
  if (request.useClass !== undefined) return verifyIssuanceForm(context, request, subject, workspace, now, observed);
  return failure('internal-failure');
}

function runOperation(context: ControlPlaneTrustedContext, request: Slice1Request): Slice1Result {
  switch (request.operation) {
    case 'verifyCurrentLifecycleState':
      // Dispatched directly by executeSlice1Command (read-only; NO mutation
      // coordination lock — contract §25.17); unreachable through the
      // subject-key path (defensive).
      return runVerify(context, request);
    case 'revoke':
      // Dispatched directly by executeSlice1Command (target-derived key);
      // unreachable through the subject-key path (defensive).
      return runRevoke(context, request);
    case 'issueRuntimeGrant':
      // Dispatched directly by executeSlice1Command (bundle-subject key);
      // unreachable through the subject-key path (defensive).
      return runIssueRuntimeGrant(context, request);
    case 'decideActivation':
      // Dispatched directly by executeSlice1Command (bundle-subject key);
      // unreachable through the subject-key path (defensive).
      return runDecideActivation(context, request);
    case 'createOccurrence':
      // Dispatched directly by executeSlice1Command (activation-derived key);
      // unreachable through the subject-key path (defensive).
      return runCreateOccurrence(context, request);
    case 'orchestrationDecision':
      // Dispatched directly by executeSlice1Command (occurrence-derived bundle
      // key; §27.5); unreachable through the subject-key path (defensive).
      return runOrchestrationDecision(context, request);
    case 'recordExecutionAttempt':
      // Dispatched directly by executeSlice1Command (occurrence-derived bundle
      // key; §27.5); unreachable through the subject-key path (defensive).
      return runRecordExecutionAttempt(context, request);
    case 'recordValidation':
      return runRecordValidation(context, request);
    case 'approve':
      return runApprove(context, request);
    case 'issue':
      return runIssue(context, request);
  }
}

/**
 * Execute one Slice-1 command. The untrusted request is captured and parsed
 * first (fail closed on hostile shapes and role assertions), then the whole
 * decision window (re-read current state → revalidate → publish → verify)
 * runs under the host-side process-level coordination lock for the exact
 * lifecycle decision key. Denied commands create zero lifecycle records and
 * zero AuthoritativeAuditEvent records; the only audit behavior is WP-8's
 * mechanical write-audit for successful publications (SCR-W12-001).
 */
export function executeSlice1Command(input: unknown, context: ControlPlaneTrustedContext): Slice1Result {
  if (!validateHostContext(context)) return failure('internal-failure');
  if (!isRecord(context.operator) || typeof context.operator.approverRole !== 'boolean' || typeof context.operator.issuerRole !== 'boolean') {
    return failure('internal-failure');
  }

  const parsed = captureSlice1Request(input);
  if (!parsed.ok) {
    if (parsed.reason === 'role-assertion') return failure('approver-not-independent');
    // Slice-2B contract §23-B: a malformed canonical subject in a verify
    // request is subject-invalid; all other verify shape failures are
    // request-invalid (Slice-1/2A mapping is unchanged).
    if (parsed.operation === 'verifyCurrentLifecycleState' && (parsed.reason === 'subject-shape' || parsed.reason === 'subject-syntax')) {
      return failure('subject-invalid');
    }
    return failure('request-invalid');
  }
  const request = parsed.request;

  // Slice-2B verify: read-only current-state evaluation. Requires no
  // trusted operator role, no capability pre-gate, and NO mutation
  // coordination lock (non-linearizable by design; contract §25.17).
  if (request.operation === 'verifyCurrentLifecycleState') {
    return runVerify(context, request);
  }

  // Host-asserted role gates (structural authority; SCR-W12-003). The
  // revocation role is a DISTINCT role; the closed `approver-not-independent`
  // category covers transport/assertion of ANY trusted operator role.
  if (request.operation === 'revoke') {
    if (context.operator.revokerRole !== true) return failure('lifecycle-state-missing');
    return runRevoke(context, request);
  }
  if (request.operation === 'issueRuntimeGrant') {
    // Slice-3A grant authority is host-asserted only; the command payload
    // never supplies it (§6; §26.19). Missing host role fails closed.
    if (context.operator.grantRole !== true) return failure('lifecycle-state-missing');
    return runIssueRuntimeGrant(context, request);
  }
  if (request.operation === 'decideActivation' || request.operation === 'createOccurrence') {
    // Slice-3B activation/recovery authority is host-asserted only (§26.3 A;
    // S3-D2). Missing host role fails closed as lifecycle-state-missing.
    if (context.operator.activationRole !== true) return failure('lifecycle-state-missing');
    if (request.operation === 'decideActivation') return runDecideActivation(context, request);
    return runCreateOccurrence(context, request);
  }
  if (request.operation === 'orchestrationDecision' || request.operation === 'recordExecutionAttempt') {
    // Slice-4 orchestration/attempt-recording authority is host-asserted only
    // (§27.2). Missing host role fails closed as lifecycle-state-missing.
    if (context.operator.executionRecorderRole !== true) return failure('lifecycle-state-missing');
    if (request.operation === 'orchestrationDecision') return runOrchestrationDecision(context, request);
    return runRecordExecutionAttempt(context, request);
  }
  if (request.operation === 'approve' && context.operator.approverRole !== true) {
    return failure('lifecycle-state-missing');
  }
  if (request.operation === 'issue' && context.operator.issuerRole !== true) {
    return failure('lifecycle-state-missing');
  }

  // WP-6 trusted workspace resolution (unknown workspace fails closed).
  const workspace = lookupValidatedWorkspace(context.configuration, request.workspaceId);
  if (workspace === undefined) return failure('lifecycle-state-missing');

  // WP-6 capability ceilings (presence-aware deny semantics).
  if (request.operation === 'approve' && capabilityCeilingDenied(context.configuration, workspace, APPROVAL_OPERATE_CAPABILITY)) {
    return failure('ceiling-denied');
  }
  if (request.operation === 'issue' && capabilityCeilingDenied(context.configuration, workspace, LIFECYCLE_ISSUE_CAPABILITY)) {
    return failure('ceiling-denied');
  }

  const subject = request.subject;
  if (subject === undefined) return failure('internal-failure');
  try {
    return context.coordinate.withLock(coordinationKeyOf(subject), () => runOperation(context, request));
  } catch (err) {
    if (err instanceof LockContentionError) return failure('lock-conflict');
    return failure('internal-failure');
  }
}
