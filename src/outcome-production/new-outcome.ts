/**
 * WP-13 durability S3 — no-existing branch of the outcome-recording
 * operation.
 *
 * This module is reached ONLY after the under-lock durable re-read has
 * proven that ZERO outcome records exist for the exact attempt (§8 of the
 * durability decision). It is the ONLY module in the outcome-production
 * family that calls the opaque identity/time sources (`newRecordId`,
 * `newEvidenceId`, `nowUtcIso`) — replay and conflict paths never reach it
 * (static-guard + counting/throwing source tests).
 *
 * Order (pinned): allocate opaque lifecycle record id → allocate opaque
 * observation evidence id → obtain the lifecycle timestamp → construct the
 * exact ExecutionOutcomeRecord → structural/semantic validation → mint the
 * exact S2 permit → publish through S2 `publishExactOutcomeRecord`. No
 * deterministic/content-derived record or evidence identity exists.
 *
 * Pure decision branch: no filesystem, no network, no authority beyond the
 * S2 boundary.
 */
import { registryReferenceFor } from '../control-plane/records.js';
import { computePayloadDigest } from '../storage/format/envelope.js';
import { validateLifecycleRecord } from '../api/validate.js';
import { createExecutionOutcomePermit, type ExecutionOutcomePermit } from '../outcome/capability.js';
import type { AcceptedRegistryContext } from '../api/types.js';
import type { OutcomeIdentitySource, OutcomeProductionFailureCategory, OutcomeProductionResult } from './types.js';
import type { OutcomeStoreBoundary } from '../outcome/types.js';
import type { SchemaRegistry } from '../schema/registry.js';

const RECORD_ID_RE = /^pgw:l:[0-9a-f]{32}$/;
const EVIDENCE_ID_RE = /^pgw:e:[0-9a-f]{32}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function denied(category: OutcomeProductionFailureCategory, code: string, message: string): OutcomeProductionResult {
  return { ok: false, category, code, message };
}

/**
 * The verified caller-verifiable material of one outcome record (identical
 * shape for construction and replay comparison). The operation-assigned
 * values (record_id, created_at, observation_evidence.evidence_id) are NOT
 * part of the material.
 */
export interface OutcomeMaterial {
  readonly registryReference: Readonly<Record<string, unknown>>;
  readonly workspaceId: string;
  readonly bundle: Readonly<Record<string, unknown>>;
  readonly occurrenceId: string;
  readonly attemptId: string;
  readonly ordinal: number;
  readonly attemptRecordId: string;
  readonly disposition: string;
  readonly observationDigest: string;
  readonly enforcement?: { readonly projectionIdentity: string; readonly evidenceFingerprint: string };
  readonly association?: { readonly instanceId: string; readonly revisionDigest: string; readonly mode: string; readonly validationRecordId: string };
}

/** Construct the exact `ExecutionOutcomeRecord` payload (committed S1 schema form). */
export function buildOutcomePayload(material: OutcomeMaterial, recordId: string, createdAt: string, evidenceId: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    record_type: 'ExecutionOutcomeRecord',
    record_id: recordId,
    created_at: createdAt,
    responsible_role: 'trusted-execution-outcome-recorder',
    registry_snapshot_reference: Object.freeze({ ...material.registryReference }),
    workspace_id: material.workspaceId,
    bundle: Object.freeze({ ...material.bundle }),
    occurrence_id: material.occurrenceId,
    attempt_id: material.attemptId,
    ordinal: material.ordinal,
    execution_attempt_record_id: material.attemptRecordId,
    disposition: material.disposition,
    observation_evidence: Object.freeze({
      kind: 'external-evidence',
      evidence_id: evidenceId,
      content_digest: material.observationDigest,
      declared_media_type: 'application/json',
      observation_role: 'evaluation-evidence',
    }),
    ...(material.enforcement !== undefined
      ? {
          enforcement_evidence: Object.freeze({
            projection_identity: material.enforcement.projectionIdentity,
            evidence_fingerprint: material.enforcement.evidenceFingerprint,
          }),
        }
      : {}),
    ...(material.association !== undefined
      ? {
          result_association: Object.freeze({
            instance_id: material.association.instanceId,
            revision_digest: material.association.revisionDigest,
            association_mode: material.association.mode,
            validation_record_id: material.association.validationRecordId,
          }),
        }
      : {}),
  });
}

/** The no-existing branch: allocate, construct, validate, permit, publish. */
export function publishNewOutcome(input: {
  readonly material: OutcomeMaterial;
  readonly registry: AcceptedRegistryContext;
  readonly store: OutcomeStoreBoundary;
  readonly capability: unknown;
  readonly schemaRegistry: unknown;
  readonly identity: OutcomeIdentitySource;
}): OutcomeProductionResult {
  const recordIdCall = input.identity.newRecordId();
  if (typeof recordIdCall !== 'string' || !RECORD_ID_RE.test(recordIdCall)) {
    return denied('OUTCOME-IDENTITY-FAILURE', 'identity.record-id-invalid', 'the outcome identity source returned a malformed lifecycle record identity');
  }
  const evidenceIdCall = input.identity.newEvidenceId();
  if (typeof evidenceIdCall !== 'string' || !EVIDENCE_ID_RE.test(evidenceIdCall)) {
    return denied('OUTCOME-IDENTITY-FAILURE', 'identity.evidence-id-invalid', 'the outcome identity source returned a malformed observation evidence identity');
  }
  const nowCall = input.identity.nowUtcIso();
  if (typeof nowCall !== 'string' || !TIMESTAMP_RE.test(nowCall)) {
    return denied('OUTCOME-IDENTITY-FAILURE', 'identity.time-invalid', 'the outcome identity source returned a malformed timestamp');
  }
  const payload = buildOutcomePayload(input.material, recordIdCall, nowCall, evidenceIdCall);
  const gate = validateLifecycleRecord(payload, input.schemaRegistry as SchemaRegistry);
  if (gate.ok !== true || gate.value === undefined) {
    return denied('OUTCOME-INTERNAL-FAILURE', 'internal.schema-gate-rejected', 'the constructed outcome record failed committed lifecycle schema validation');
  }
  const payloadDigest = computePayloadDigest(payload);
  const permit = createExecutionOutcomePermit({
    capability: input.capability,
    role: 'execution-outcome-recording',
    recordId: recordIdCall,
    recordDigest: payloadDigest,
    canonicalBytesDigest: payloadDigest,
  });
  if (permit === undefined) {
    return denied('OUTCOME-INTERNAL-FAILURE', 'internal.permit-denied', 'the exact-record outcome publication permit could not be minted');
  }
  const result = input.store.publishExactOutcomeRecord(permit as ExecutionOutcomePermit, payload);
  if (result.ok !== true) {
    // S2 authority failures pass through distinctly (capability/input/write/internal).
    return denied(result.category, result.code, 'the S2 outcome publication boundary rejected the outcome record');
  }
  // SIR-WP13-DUR-S3-002: in the no-existing branch, success is permitted
  // ONLY when S2/WP-8 confirms the new record was actually `published`.
  // Every other storage outcome (idempotent-duplicate / duplicate /
  // conflict-revision / failed / temp-retry / any future non-published
  // state) is a fail-closed S3 write/state failure: the freshly allocated
  // record/evidence identities are NOT durable and are NEVER returned as
  // success, and a storage duplicate is NEVER reinterpreted as semantic
  // replay (the replay decision already occurred under the attempt lock;
  // a later explicit invocation performs a fresh under-lock decision).
  if (result.outcome !== 'published') {
    return denied('OUTCOME-WRITE-FAILED', 'write.not-published', 'the S2/WP-8 storage did not confirm a new durable publication; the allocated identities are not durable');
  }
  return {
    ok: true,
    outcome: 'published',
    recordId: result.recordId,
    recordDigest: result.recordDigest,
    evidenceId: evidenceIdCall,
    ...(result.auditEventId !== undefined ? { auditEventId: result.auditEventId } : {}),
  };
}
