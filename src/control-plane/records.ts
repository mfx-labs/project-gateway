/**
 * WP-12 Slice 1 — lifecycle record payload builders.
 *
 * Constructs the exact accepted protocol record payloads (fixture-shaped:
 * `fixtures/lifecycle/valid/validation-*.json`, `approval-*.json`,
 * `issuance-*.json`). No new record fields are invented; every payload is
 * structurally validated through the accepted WP-4 lifecycle-record schema
 * pipeline before publication (single lifecycle schema authority).
 *
 * Pure module: no I/O, no persistence, no authority.
 */
import { computePayloadDigest } from '../storage/format/envelope.js';
import type { AcceptedRegistryContext } from '../api/types.js';
import type { CanonicalSubject } from './types.js';
import { ARTIFACT_PROTOCOL_ID, ARTIFACT_PROTOCOL_VERSION, VALIDATOR_PROFILE_ID, VALIDATOR_PROFILE_VERSION } from './types.js';
import { recordSubjectOf } from './subject.js';

/** The exact accepted registry-snapshot reference binding (registry schema form). */
export function registryReferenceFor(registry: AcceptedRegistryContext): Readonly<Record<string, unknown>> {
  return Object.freeze({
    registry_protocol_id: registry.registryProtocolId,
    registry_snapshot_format_version: registry.registrySnapshotFormatVersion,
    registry_snapshot_id: registry.registrySnapshotId,
    registry_snapshot_digest: registry.registrySnapshotDigest,
    protocol_compatibility: Object.freeze({
      mode: 'exact-release',
      artifact_protocol_id: ARTIFACT_PROTOCOL_ID,
      artifact_protocol_version: ARTIFACT_PROTOCOL_VERSION,
    }),
  });
}

export interface ValidationRecordPayloadInput {
  readonly recordId: string;
  readonly createdAt: string;
  readonly subject: CanonicalSubject;
  readonly registry: AcceptedRegistryContext;
  readonly validatorProfileId?: string;
  readonly validatorProfileVersion?: string;
}

/**
 * ValidationRecord payload derived EXCLUSIVELY from the accepted WP-4 run
 * (the caller of this builder has already correlated the evidence and
 * verified pass outcomes; SCR-W12-004). Non-authorizing assessment record.
 */
export function buildValidationRecordPayload(input: ValidationRecordPayloadInput): Readonly<Record<string, unknown>> {
  return Object.freeze({
    record_type: 'ValidationRecord',
    record_id: input.recordId,
    created_at: input.createdAt,
    responsible_role: 'trusted-validator',
    registry_snapshot_reference: registryReferenceFor(input.registry),
    subject: recordSubjectOf(input.subject),
    validator_profile: Object.freeze({
      id: input.validatorProfileId ?? VALIDATOR_PROFILE_ID,
      version: input.validatorProfileVersion ?? VALIDATOR_PROFILE_VERSION,
    }),
    structural_outcome: 'pass',
    semantic_outcome: 'pass',
    findings: Object.freeze([]),
  });
}

export interface ApprovalRecordPayloadInput {
  readonly recordId: string;
  readonly createdAt: string;
  readonly subject: CanonicalSubject;
  readonly workspaceId: string;
  readonly purpose: string;
  readonly validationRecordIds: readonly string[];
  readonly requiredSemantics: { readonly protocol_features: readonly string[]; readonly consumer_capabilities: readonly string[] };
  readonly validUntil: string | null;
  readonly registry: AcceptedRegistryContext;
}

/** ApprovalRecord payload (revocable usability record; exact subject/workspace/purpose bindings). */
export function buildApprovalRecordPayload(input: ApprovalRecordPayloadInput): Readonly<Record<string, unknown>> {
  return Object.freeze({
    record_type: 'ApprovalRecord',
    record_id: input.recordId,
    created_at: input.createdAt,
    responsible_role: 'trusted-approver',
    registry_snapshot_reference: registryReferenceFor(input.registry),
    subject: recordSubjectOf(input.subject),
    workspace_id: input.workspaceId,
    purpose: input.purpose,
    validation_record_ids: Object.freeze([...input.validationRecordIds].sort()),
    required_semantics: Object.freeze({
      protocol_features: Object.freeze([...input.requiredSemantics.protocol_features]),
      consumer_capabilities: Object.freeze([...input.requiredSemantics.consumer_capabilities]),
    }),
    valid_until: input.validUntil,
  });
}

export interface IssuanceRecordPayloadInput {
  readonly recordId: string;
  readonly createdAt: string;
  readonly subject: CanonicalSubject;
  readonly workspaceId: string;
  readonly useClass: string;
  readonly approvalRecordId: string;
  readonly activationLimit: number;
  readonly validUntil: string | null;
  readonly registry: AcceptedRegistryContext;
}

/** IssuanceRecord payload (revocable usability record; binds the exact approval). */
export function buildIssuanceRecordPayload(input: IssuanceRecordPayloadInput): Readonly<Record<string, unknown>> {
  return Object.freeze({
    record_type: 'IssuanceRecord',
    record_id: input.recordId,
    created_at: input.createdAt,
    responsible_role: 'trusted-issuer',
    registry_snapshot_reference: registryReferenceFor(input.registry),
    subject: recordSubjectOf(input.subject),
    approval_record_id: input.approvalRecordId,
    workspace_id: input.workspaceId,
    use_class: input.useClass,
    activation_limit: input.activationLimit,
    valid_until: input.validUntil,
  });
}

/** Deterministic payload digest under the accepted storage digest domain. */
export function payloadDigestOf(payload: Readonly<Record<string, unknown>>): string {
  return computePayloadDigest(payload);
}

export interface RevocationRecordPayloadInput {
  readonly recordId: string;
  readonly createdAt: string;
  readonly targetRecordType: 'ApprovalRecord' | 'IssuanceRecord' | 'RuntimeGrant';
  readonly targetRecordId: string;
  readonly scope: 'all-uses' | 'execution-use';
  readonly effectiveAt: string;
  readonly reasonCode: string;
  readonly registry: AcceptedRegistryContext;
}

/**
 * RevocationRecord payload (append-only usability withdrawal; schema/fixture
 * shaped — no workspace field exists in the accepted schema; workspace
 * correlation is carried by the exact target record identity and the host
 * context). The registry reference binds the CURRENT accepted context
 * (C6), never the historical target's context. Slice-3A extends the
 * operational target set with `RuntimeGrant` (contract §26.15; the schema
 * target enum already admits it).
 */
export function buildRevocationRecordPayload(input: RevocationRecordPayloadInput): Readonly<Record<string, unknown>> {
  return Object.freeze({
    record_type: 'RevocationRecord',
    record_id: input.recordId,
    created_at: input.createdAt,
    responsible_role: 'trusted-revocation-authority',
    registry_snapshot_reference: registryReferenceFor(input.registry),
    target: Object.freeze({
      record_type: input.targetRecordType,
      record_id: input.targetRecordId,
    }),
    scope: input.scope,
    effective_at: input.effectiveAt,
    reason_code: input.reasonCode,
  });
}

export interface ActivationRecordPayloadInput {
  readonly recordId: string;
  readonly createdAt: string;
  /** The exact canonical ExecutionBundle revision subject. */
  readonly subject: CanonicalSubject;
  readonly workspaceId: string;
  /** The five store-derived issuance identities (exact historical correlation; bundle first). */
  readonly requiredIssuanceRecordIds: readonly string[];
  /** The exact correlated RuntimeGrant record identity. */
  readonly runtimeGrantId: string;
  /** The grant's reserved occurrence identity. */
  readonly reservedOccurrenceId: string;
  readonly decision: 'accepted' | 'denied';
  readonly registry: AcceptedRegistryContext;
}

/**
 * ActivationRecord payload (immutable historical activation decision; exact
 * bundle/workspace/grant/reservation/five-issuance bindings). Constructed
 * strictly from the accepted activation-record schema: no raw policy, no
 * consumer support, no paths, no authority tokens. A denied record binds the
 * SAME five issuance IDs, grant, and reservation as an accepted record
 * (§26.5); it is never built with fewer than five issuance IDs.
 */
export function buildActivationRecordPayload(input: ActivationRecordPayloadInput): Readonly<Record<string, unknown>> {
  return Object.freeze({
    record_type: 'ActivationRecord',
    record_id: input.recordId,
    created_at: input.createdAt,
    responsible_role: 'trusted-activation-authority',
    registry_snapshot_reference: registryReferenceFor(input.registry),
    bundle: Object.freeze({
      target_protocol_version: input.subject.protocolVersion,
      target_kind: Object.freeze({ id: input.subject.kindId, version: input.subject.kindVersion }),
      target_instance_id: input.subject.instanceId,
      target_revision_id: input.subject.revisionId,
      target_digest: input.subject.digest,
      target_workspace_binding: Object.freeze({ mode: 'bound', workspace_id: input.workspaceId }),
    }),
    workspace_id: input.workspaceId,
    required_issuance_record_ids: Object.freeze([...input.requiredIssuanceRecordIds]),
    runtime_grant_id: input.runtimeGrantId,
    reserved_occurrence_id: input.reservedOccurrenceId,
    decision: input.decision,
  });
}

export interface ExecutionOccurrenceRecordPayloadInput {
  readonly recordId: string;
  readonly createdAt: string;
  /** The exact accepted ActivationRecord identity (the recovery/decision anchor). */
  readonly activationRecordId: string;
  /** The exact ExecutionBundle reference (byte-identical reuse from the activation/grant). */
  readonly bundle: Readonly<Record<string, unknown>>;
  readonly workspaceId: string;
  /** The reserved occurrence identity (EXACTLY the activation's reservation; never re-allocated). */
  readonly occurrenceId: string;
  readonly runtimeGrantId: string;
  readonly registry: AcceptedRegistryContext;
}

/**
 * ExecutionOccurrenceRecord payload (immutable historical occurrence; the
 * second publication of an accepted activation, §15 SCR-W12-005). The
 * `responsible_role` constant 'trusted-control-plane' is a schema record
 * field, never a host operator role token (S3-D2).
 */
export function buildExecutionOccurrenceRecordPayload(input: ExecutionOccurrenceRecordPayloadInput): Readonly<Record<string, unknown>> {
  return Object.freeze({
    record_type: 'ExecutionOccurrenceRecord',
    record_id: input.recordId,
    created_at: input.createdAt,
    responsible_role: 'trusted-control-plane',
    registry_snapshot_reference: registryReferenceFor(input.registry),
    activation_record_id: input.activationRecordId,
    bundle: Object.freeze({ ...input.bundle }),
    workspace_id: input.workspaceId,
    occurrence_id: input.occurrenceId,
    runtime_grant_id: input.runtimeGrantId,
  });
}

/** Keys excluded from decision-content identity (record identity/creation time). */
const DECISION_CONTENT_IGNORED_KEYS: ReadonlySet<string> = new Set(['record_id', 'created_at']);

export interface RuntimeGrantPayloadInput {
  readonly recordId: string;
  readonly createdAt: string;
  /** The exact canonical ExecutionBundle revision subject (kindId MUST be ExecutionBundle). */
  readonly subject: CanonicalSubject;
  readonly workspaceId: string;
  /** Internally allocated fresh occurrence identity (`pgw:o:` + 32 lowercase hex). */
  readonly reservedOccurrenceId: string;
  readonly attemptLimit: number;
  readonly validity: { readonly not_before: string; readonly not_after: string };
  readonly narrowedConstraints: readonly Readonly<{ type: string; value: number | boolean }>[];
  readonly registry: AcceptedRegistryContext;
}

/**
 * RuntimeGrant payload (revocable per-occurrence usability record; exact
 * bundle/workspace/reservation bindings). Constructed strictly from the
 * accepted runtime-grant schema (`schemas/lifecycle/1.0/records/runtime-grant.json`):
 * no approval IDs, issuance IDs, raw policy, consumer support, path,
 * authority token, role object, or mutable reservation object is added.
 * The bundle reference is the accepted exact-artifact-reference form bound
 * to the exact operation workspace (SCR-W12-008).
 */
export function buildRuntimeGrantPayload(input: RuntimeGrantPayloadInput): Readonly<Record<string, unknown>> {
  return Object.freeze({
    record_type: 'RuntimeGrant',
    record_id: input.recordId,
    created_at: input.createdAt,
    responsible_role: 'trusted-runtime-grant-authority',
    registry_snapshot_reference: registryReferenceFor(input.registry),
    bundle: Object.freeze({
      target_protocol_version: input.subject.protocolVersion,
      target_kind: Object.freeze({ id: input.subject.kindId, version: input.subject.kindVersion }),
      target_instance_id: input.subject.instanceId,
      target_revision_id: input.subject.revisionId,
      target_digest: input.subject.digest,
      target_workspace_binding: Object.freeze({ mode: 'bound', workspace_id: input.workspaceId }),
    }),
    workspace_id: input.workspaceId,
    reserved_occurrence_id: input.reservedOccurrenceId,
    attempt_limit: input.attemptLimit,
    validity: Object.freeze({ not_before: input.validity.not_before, not_after: input.validity.not_after }),
    narrowed_constraints: Object.freeze(input.narrowedConstraints.map((c) => Object.freeze({ type: c.type, value: c.value }))),
  });
}

/**
 * Deterministic digest of the DECISION CONTENT of a lifecycle payload
 * (everything except the assigned record identity and creation time).
 * Duplicate semantics are keyed on the complete accepted evidence/decision
 * correlation, never on the fresh record identity (SCR-W12-004).
 */
export function decisionContentDigestOf(payload: Readonly<Record<string, unknown>>): string {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!DECISION_CONTENT_IGNORED_KEYS.has(key)) copy[key] = value;
  }
  return computePayloadDigest(copy);
}

/** True when two lifecycle payloads carry the same decision content. */
export function sameDecision(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
  return decisionContentDigestOf(a) === decisionContentDigestOf(b);
}

/** True when two lifecycle payloads are byte-identical (same canonical form). */
export function payloadsIdentical(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
  return payloadDigestOf(a) === payloadDigestOf(b);
}
