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
import { createSchemaRegistry, validateLifecycleRecord } from '../api/validate.js';
import { isBrandedArtifact } from '../internal/snapshot.js';
import { isGenuineValidatedTrustedWorkspaceConfiguration } from '../trusted/configuration-brand.js';
import { lookupValidatedWorkspace } from '../trusted/index.js';
import { isKnownCapability } from '../trusted/capabilities.js';
import type { PublishRecordResult, RecordClassId } from '../storage/types.js';
import { captureSlice1Request, subjectMatchesCanonical, timestampAtOrBefore, isAcceptedTimestamp } from './subject.js';
import { validateEvidenceForm, correlateValidationEvidence } from './evidence.js';
import { buildValidationRecordPayload, buildApprovalRecordPayload, buildIssuanceRecordPayload, buildRevocationRecordPayload, sameDecision } from './records.js';
import { evaluateCandidateLifecycleRecord, mapGraphFindings, artifactModelMaps, mapVerificationFindings } from './graph.js';
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
  APPROVAL_OPERATE_CAPABILITY,
  ARTIFACT_PROTOCOL_ID,
  LIFECYCLE_ISSUE_CAPABILITY,
  REVOCATION_RECORD_CLASS,
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
  if (!isRecord(identity) || typeof identity['nowUtcIso'] !== 'function' || typeof identity['newRecordId'] !== 'function') return false;
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
 */
function coordinationKeyOfPayload(payload: Readonly<Record<string, unknown>>): string | undefined {
  const subject = subjectOf(payload);
  if (subject === undefined) return undefined;
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

/** Reconstruct the canonical subject identity of a stored revocable record payload. */
function canonicalSubjectOfRecord(payload: Readonly<Record<string, unknown>>): CanonicalSubject | undefined {
  const subject = subjectOf(payload);
  if (subject === undefined) return undefined;
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

/** Slice-2A target class ID for an accepted operational target record type. */
function targetClassOf(targetRecordType: string): RecordClassId | undefined {
  if (targetRecordType === 'ApprovalRecord') return 'approval-record';
  if (targetRecordType === 'IssuanceRecord') return 'issuance-record';
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
