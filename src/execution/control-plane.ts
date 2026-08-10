/**
 * WP-13A — control-plane execution boundary adapter.
 *
 * Host-side adapter that exposes the narrow WP-13A boundary over the
 * committed WP-12 surface (`executeSlice1Command` + the injected WP-8 store
 * boundary). The adapter is transport-free and I/O-free; it is the ONLY
 * place WP-13A meets WP-12, and it never exposes the store boundary, the
 * decision coordinator, roles, or the trusted context to the execution
 * core. WP-12 remains the authoritative recorder and gate: every proposed
 * ordinal is re-validated under the WP-12 lock (EXE-005/006/007, REG
 * recordability, registry context).
 */
import { executeSlice1Command } from '../control-plane/core.js';
import { EXECUTION_ATTEMPT_RECORD_CLASS } from '../control-plane/types.js';
import type { ControlPlaneTrustedContext, Slice1Result } from '../control-plane/types.js';
import type {
  ControlPlaneDecisionEvidence,
  ControlPlaneDecisionResult,
  ControlPlaneExecutionBoundary,
  DurableAttemptFact,
} from './types.js';

/** Build the WP-13A control-plane boundary over one trusted WP-12 context. */
export function createControlPlaneExecutionBoundary(context: ControlPlaneTrustedContext): ControlPlaneExecutionBoundary {
  const registryEcho = Object.freeze({
    registry_snapshot_id: context.registry.registrySnapshotId,
    registry_snapshot_digest: context.registry.registrySnapshotDigest,
  });

  const mapResult = (result: Slice1Result, outcome: 'orchestrated' | 'attempt-recorded'): ControlPlaneDecisionResult => {
    if (!result.ok) {
      return { ok: false, category: result.category, code: result.code, message: result.message };
    }
    const e = result.evidence;
    return {
      ok: true,
      evidence: Object.freeze({
        outcome,
        recordId: e.recordId,
        occurrenceRecordId: String(e.occurrenceRecordId ?? e.recordId),
        activationRecordId: String(e.activationRecordId ?? ''),
        runtimeGrantId: String(e.runtimeGrantId ?? ''),
        subject: Object.freeze({
          protocolId: e.subject.protocolId,
          protocolVersion: e.subject.protocolVersion,
          kindId: e.subject.kindId,
          kindVersion: e.subject.kindVersion,
          instanceId: e.subject.instanceId,
          revisionId: e.subject.revisionId,
          digest: e.subject.digest,
          workspaceId: e.subject.workspaceId,
        }),
        workspaceId: e.workspaceId,
        ...(e.grantCurrent !== undefined ? { grantCurrent: e.grantCurrent } : {}),
        ...(e.remainingAllowance !== undefined ? { remainingAllowance: e.remainingAllowance } : {}),
        ...(e.attemptId !== undefined ? { attemptId: e.attemptId } : {}),
        ...(e.ordinal !== undefined ? { ordinal: e.ordinal } : {}),
        ...(e.attemptRecordId !== undefined ? { attemptRecordId: e.attemptRecordId } : {}),
      } as ControlPlaneDecisionEvidence),
    };
  };

  return Object.freeze({
    orchestrationDecision(workspaceId: string, reservedOccurrenceId: string): ControlPlaneDecisionResult {
      return mapResult(
        executeSlice1Command(
          { operation: 'orchestrationDecision', workspaceId, registryEcho, reservedOccurrenceId },
          context,
        ),
        'orchestrated',
      );
    },
    recordExecutionAttempt(workspaceId: string, reservedOccurrenceId: string, ordinal: number): ControlPlaneDecisionResult {
      return mapResult(
        executeSlice1Command(
          { operation: 'recordExecutionAttempt', workspaceId, registryEcho, reservedOccurrenceId, ordinal },
          context,
        ),
        'attempt-recorded',
      );
    },
    durableAttempts(reservedOccurrenceId: string): readonly DurableAttemptFact[] {
      const enumerated = context.store.enumerateLifecycleRecords(EXECUTION_ATTEMPT_RECORD_CLASS);
      if (!enumerated.ok) return Object.freeze([]);
      const facts: DurableAttemptFact[] = [];
      for (const recordId of enumerated.recordIds) {
        const read = context.store.readLifecyclePayload(EXECUTION_ATTEMPT_RECORD_CLASS, recordId);
        if (!read.ok || read.payload === undefined) continue;
        const payload = read.payload;
        if (String(payload['occurrence_id'] ?? '') !== reservedOccurrenceId) continue;
        const ordinal = payload['ordinal'];
        const attemptId = String(payload['attempt_id'] ?? '');
        const runtimeGrantId = String(payload['runtime_grant_id'] ?? '');
        const bundle = payload['bundle'];
        if (typeof ordinal !== 'number' || !Number.isSafeInteger(ordinal) || ordinal < 1 || attemptId.length === 0 || runtimeGrantId.length === 0) {
          continue;
        }
        facts.push(
          Object.freeze({
            recordId,
            attemptId,
            ordinal,
            runtimeGrantId,
            bundle: bundle !== null && typeof bundle === 'object' && !Array.isArray(bundle)
              ? (bundle as Readonly<Record<string, unknown>>)
              : Object.freeze({}),
          }),
        );
      }
      return Object.freeze(facts.sort((a, b) => a.ordinal - b.ordinal));
    },
  });
}
