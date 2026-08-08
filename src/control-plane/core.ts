/**
 * WP-12 Slice 1 — transport-free approval and issuance decision core.
 *
 * Implements exactly three trusted-local operations per the committed
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
 *                      ApprovalRecord (LFC-003 via the accepted graph).
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
import { buildValidationRecordPayload, buildApprovalRecordPayload, buildIssuanceRecordPayload, sameDecision } from './records.js';
import { evaluateCandidateLifecycleRecord, mapGraphFindings, artifactModelMaps } from './graph.js';
import { LockContentionError } from './coordination.js';
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
  LIFECYCLE_ISSUE_CAPABILITY,
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
    if (subject === undefined || !subjectMatchesCanonical(subject, request.subject)) return { ok: false, category: 'subject-invalid' };
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
  const evidence = context.validationEvidence;
  const form = validateEvidenceForm(evidence);
  if (!form.ok) {
    if (form.reason === 'report-not-ok') return failure('subject-not-validated');
    return failure('request-invalid');
  }
  const correlation = correlateValidationEvidence(form.evidence, request.subject);
  if (!correlation.ok) return failure('subject-invalid');

  const existingResult = readClassPayloads(context, 'validation-record');
  if (!existingResult.ok) return failure('store-failure');

  const recordId = context.identity.newRecordId();
  const createdAt = context.identity.nowUtcIso();
  const candidate = buildValidationRecordPayload({
    recordId,
    createdAt,
    subject: request.subject,
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
    subject: request.subject,
    workspaceId: request.workspaceId,
  });
}

function runApprove(context: ControlPlaneTrustedContext, request: Slice1Request): Slice1Result {
  const artifact = validateSubjectArtifact(context, request.subject);
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
    subject: request.subject,
    workspaceId: request.workspaceId,
    purpose: request.purpose ?? SLICE_1_PURPOSES[0]!,
    validationRecordIds: request.validationRecordIds ?? [],
    requiredSemantics,
    validUntil,
    registry: context.registry,
  });

  const matching = matchingApprovals(stateResult.payloads, revocationResult.payloads, supersessionResult.payloads, request.subject, now);
  // Duplicate/conflict semantics consider only CURRENT approvals: a
  // re-approval after revocation is a new command and a new record
  // (the revoked approval is historical, not blocking).
  const current = matching.filter((entry) => entry.state === 'current');
  for (const entry of current) {
    if (sameDecision(entry.payload, candidate)) return failure('already-approved');
  }
  if (current.length > 0) return failure('lifecycle-conflict');

  const maps = artifactModelMaps(request.subject, artifact.model);
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
    subject: request.subject,
    workspaceId: request.workspaceId,
  });
}

function runIssue(context: ControlPlaneTrustedContext, request: Slice1Request): Slice1Result {
  const artifact = validateSubjectArtifact(context, request.subject);
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

  const matching = matchingApprovals(approvalResult.payloads, revocationResult.payloads, supersessionResult.payloads, request.subject, now);
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
    subject: request.subject,
    workspaceId: request.workspaceId,
    useClass,
    approvalRecordId: String(approval['record_id'] ?? ''),
    activationLimit,
    validUntil,
    registry: context.registry,
  });

  const currentIssuances = issuanceResult.payloads.filter(
    (issuance) => sameIssuanceScope(issuance, request.subject, useClass) && currentnessOf(issuance, revocationResult.payloads, supersessionResult.payloads, now).state === 'current',
  );
  for (const issuance of currentIssuances) {
    if (sameDecision(issuance, candidate)) return failure('already-issued');
  }
  if (currentIssuances.length > 0) return failure('lifecycle-conflict');

  const maps = artifactModelMaps(request.subject, artifact.model);
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
    subject: request.subject,
    workspaceId: request.workspaceId,
  });
}

function runOperation(context: ControlPlaneTrustedContext, request: Slice1Request): Slice1Result {
  switch (request.operation) {
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
    return failure('request-invalid');
  }
  const request = parsed.request;

  // Host-asserted role gates (structural authority; SCR-W12-003).
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

  const key = coordinationKeyOf(request.subject);
  try {
    return context.coordinate.withLock(key, () => runOperation(context, request));
  } catch (err) {
    if (err instanceof LockContentionError) return failure('lock-conflict');
    return failure('internal-failure');
  }
}
