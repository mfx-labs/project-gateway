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

/** Keys excluded from decision-content identity (record identity/creation time). */
const DECISION_CONTENT_IGNORED_KEYS: ReadonlySet<string> = new Set(['record_id', 'created_at']);

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
