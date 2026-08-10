/**
 * WP-13B — WP-12 recordValidation boundary adapter.
 *
 * Host-side adapter exposing the narrow WP-13B recording surface over the
 * committed WP-12 surface (`executeSlice1Command` + the injected WP-8 store
 * boundary). WP-12 remains the trusted producer/recorder of
 * `ValidationRecord` (role `trusted-validator`; SCR-WP13-002): WP-13B
 * supplies ONLY the accepted WP-4 validation run through the committed
 * operation and never records, mints, or persists a validation record
 * itself. The store-boundary eight-class allowlist is unchanged.
 *
 * Idempotence: an exact existing ValidationRecord for the same subject is
 * recognized and its identity returned (crash recovery between the write
 * and the record must not fail on a WP-12 `lifecycle-conflict`); a
 * conflicting existing record fails closed.
 */
import { executeSlice1Command } from '../control-plane/core.js';
import { subjectsMatch, RESULT_VALIDATION_SUBJECT_KIND } from '../control-plane/subject.js';
import type { ControlPlaneTrustedContext, Slice1Result } from '../control-plane/types.js';
import type { ResultValidationSubject, ValidationRecordingBoundary, ValidationRecordingResult } from './types.js';

const VALIDATION_RECORD_CLASS = 'validation-record';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Build the WP-13B validation-recording boundary over one trusted WP-12 context. */
export function createResultValidationBoundary(context: ControlPlaneTrustedContext): ValidationRecordingBoundary {
  const withEvidence = (evidence: { readonly report: Readonly<Record<string, unknown>>; readonly artifact: unknown }): ControlPlaneTrustedContext => ({
    ...context,
    validationEvidence: {
      report: Object.freeze({ ...evidence.report }) as never,
      artifact: evidence.artifact as never,
    },
    subjectArtifact: evidence.artifact as never,
  });

  const mapResult = (result: Slice1Result): ValidationRecordingResult => {
    if (!result.ok) {
      return { ok: false, category: result.category, code: result.code, message: result.message };
    }
    const recordId = result.evidence['recordId'];
    if (typeof recordId !== 'string' || recordId.length === 0) {
      return { ok: false, category: 'internal-failure', code: 'record-id-missing', message: 'the control plane recorded a validation without a record identity' };
    }
    return { ok: true, validationRecordId: recordId };
  };

  /** Read-only exact-subject lookup over the durable validation-record set. */
  const existingExactRecord = (subject: ResultValidationSubject): string | undefined => {
    const enumerated = context.store.enumerateLifecycleRecords(VALIDATION_RECORD_CLASS);
    if (!enumerated.ok) return undefined;
    for (const recordId of enumerated.recordIds) {
      const read = context.store.readLifecyclePayload(VALIDATION_RECORD_CLASS, recordId);
      if (!read.ok || read.payload === undefined) continue;
      const payload = read.payload;
      const recordSubject = payload['subject'];
      if (!isRecord(recordSubject)) continue;
      if (
        subjectsMatch(recordSubject, {
          protocol_version: subject.protocolVersion,
          kind: { id: subject.kindId, version: subject.kindVersion },
          instance_id: subject.instanceId,
          revision_id: subject.revisionId,
          digest: subject.digest,
          workspace_id: subject.workspaceId,
        })
      ) {
        return recordId;
      }
    }
    return undefined;
  };

  return Object.freeze({
    recordValidation(input: {
      readonly workspaceId: string;
      readonly subject: ResultValidationSubject;
      readonly evidence: { readonly report: Readonly<Record<string, unknown>>; readonly artifact: unknown };
    }): ValidationRecordingResult {
      if (
        input.subject.kindId !== RESULT_VALIDATION_SUBJECT_KIND ||
        typeof input.subject.protocolId !== 'string' ||
        typeof input.subject.protocolVersion !== 'string' ||
        typeof input.subject.kindVersion !== 'string' ||
        typeof input.subject.instanceId !== 'string' ||
        typeof input.subject.revisionId !== 'string' ||
        typeof input.subject.digest !== 'string' ||
        typeof input.subject.workspaceId !== 'string'
      ) {
        return { ok: false, category: 'request-invalid', code: 'subject-invalid', message: 'the validation subject is malformed' };
      }
      let result: Slice1Result;
      try {
        result = executeSlice1Command(
          {
            operation: 'recordValidation',
            workspaceId: input.workspaceId,
            subject: {
              protocolId: input.subject.protocolId,
              protocolVersion: input.subject.protocolVersion,
              kindId: input.subject.kindId as never,
              kindVersion: input.subject.kindVersion,
              instanceId: input.subject.instanceId,
              revisionId: input.subject.revisionId,
              digest: input.subject.digest,
              workspaceId: input.subject.workspaceId,
            },
            reason: 'wp-13b-completion-result',
          },
          withEvidence(input.evidence),
        );
      } catch {
        return { ok: false, category: 'internal-failure', code: 'command-exception', message: 'the WP-12 recordValidation command raised an unexpected exception' };
      }
      const mapped = mapResult(result);
      if (mapped.ok) return mapped;
      if (mapped.category === 'lifecycle-conflict') {
        // Exact replay: the durable record from a previous run of the same
        // completion exists — recognize it idempotently.
        const existing = existingExactRecord(input.subject);
        if (existing !== undefined) return { ok: true, validationRecordId: existing };
      }
      return mapped;
    },
  });
}
