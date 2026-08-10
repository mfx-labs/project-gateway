/**
 * WP-13 durability S2 — narrow WP-8 outcome store boundary (the ONLY WP-8
 * surface of the outcome-recorder authority).
 *
 * ADR-039 decision 3: the authority consumes the existing WP-8 exact-record
 * publication path (`publishRecord`) through a dedicated boundary confined
 * to the ONE `execution-outcome-record` class, exactly as the WP-13C
 * publication boundary wraps `publishRecord` for its single class. WP-8
 * storage semantics, record allowlists, writer locking, durability, audit,
 * and registry-binding models are UNCHANGED (this module adds no new
 * storage behavior; it confines).
 *
 * - publish allowlist: exactly `execution-outcome-record`; every other
 *   class is rejected at the boundary;
 * - read allowlist (for later S3 under-lock discovery): exactly
 *   `execution-outcome-record` — deterministic verified reads/enumeration
 *   only; no mutation, no "newest wins", no enumeration-order selection,
 *   no hidden uniqueness decision, no attempt-level lock, no
 *   replay/conflict semantics; multiple candidates are returned as the
 *   verified set for S3 to fail closed on;
 * - the write-action provenance is minted through the authorized WP-12
 *   producer (`src/control-plane/storage-write-action.ts`);
 * - the publish entry point accepts ONLY a genuine live exact-record
 *   `ExecutionOutcomePermit` (role `execution-outcome-recording`),
 *   re-verifies the capability at the mutation boundary, re-derives the
 *   destination internally, verifies the payload identity/digest/class/role
 *   against the permit binding, and runs the committed lifecycle schema
 *   gate before any filesystem access;
 * - the envelope model is built exactly per the WP-8 record envelope
 *   contract (RFM-001); `publishRecord` keeps its internal writer lock and
 *   produces the mechanical authorized-write audit event at the operation
 *   durability point (D-6).
 *
 * This module is the ONLY outcome-family module that imports the WP-8
 * publication/read surface (static-guard enforced). No direct filesystem
 * access; no other record class; no generic lifecycle/store authority; no
 * S3 decision (eligibility, construction, identity allocation, lock,
 * replay/conflict) lives here.
 */
import { publishRecord } from '../storage/publication/index.js';
import { readRecord, enumerateClass } from '../storage/read/index.js';
import { recordClassProfile } from '../storage/format/taxonomy.js';
import { computePayloadDigest } from '../storage/format/envelope.js';
import { deriveRecordRelativePath } from '../storage/layout/layout.js';
import { createControlPlaneWriteAction } from '../control-plane/storage-write-action.js';
import { validateLifecycleRecord } from '../api/validate.js';
import { EXECUTION_OUTCOME_RECORD_CLASS, type OutcomePublicationFailureCategory, type OutcomePublicationResult, type OutcomeStoreBoundary } from './types.js';
import {
  isGenuineExecutionOutcomePermit,
  executionOutcomePermitLive,
  type ExecutionOutcomePermit,
} from './capability.js';
import type { StorageWriteActionProvenance } from '../control-plane/storage-write-action.js';
import type { LockTimeSource, RecordClassId } from '../storage/types.js';
import type { LifecycleEnumerateResult, LifecycleReadResult } from '../control-plane/types.js';
import type { SchemaRegistry } from '../schema/registry.js';

/** The single publishable class of the outcome authority. */
const PUBLISH_CLASSES: ReadonlySet<string> = new Set(['execution-outcome-record']);

/** Closed read-only class set for later S3 under-lock discovery (never published). */
const READ_CLASSES: ReadonlySet<string> = new Set(['execution-outcome-record']);

export interface OutcomeStoreBoundaryOptions {
  /** Genuine WP-6 validated trusted configuration (runtime-branded). */
  readonly trustedConfiguration: unknown;
  /** Genuine branded `TrustedStorageBootstrapInput`. */
  readonly bootstrapInput: unknown;
  /** Host-owned write-action fields (minted into the genuine provenance here). */
  readonly writeAction: StorageWriteActionProvenance;
  /** Correlated raw fields (verified for exact equality against the provenance). */
  readonly locator: string;
  readonly serviceUid: number;
  readonly forbiddenRoots: readonly string[];
  readonly limitProfile: Readonly<Record<string, number>>;
  /** Injected time/identity sources for the WP-8 lock module (D-3). */
  readonly timeSource: LockTimeSource;
  /** Offline schema registry for the committed lifecycle record schema gate (host-built). */
  readonly schemaRegistry: unknown;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function denied(category: OutcomePublicationFailureCategory, code: string, message: string): OutcomePublicationResult {
  return { ok: false, category, code, message };
}

/**
 * Build the accepted WP-8 record envelope model for the single
 * `execution-outcome-record` class (RFM-001). The envelope record identity
 * and creation time come from the already-constructed payload (assigned by
 * the S3 authority from the host identity source); the trusted action
 * identity comes from the host-owned write action.
 */
export function buildOutcomeEnvelope(
  payload: Readonly<Record<string, unknown>>,
  trustedActionId: string,
): Readonly<Record<string, unknown>> {
  const profile = recordClassProfile(EXECUTION_OUTCOME_RECORD_CLASS);
  if (profile === undefined) throw new TypeError('execution-outcome-record class profile is unavailable');
  const recordId = payload['record_id'];
  const createdAt = payload['created_at'];
  if (typeof recordId !== 'string' || typeof createdAt !== 'string') {
    throw new TypeError('outcome payload must carry record_id and created_at');
  }
  return Object.freeze({
    recordKind: profile.label,
    formatVersion: '1.0',
    recordId,
    revision: 1,
    createdAt,
    trustedActionId,
    payload,
    payloadDigest: computePayloadDigest(payload),
  });
}

/**
 * Real WP-8 outcome publication boundary (single class). Every rejection is
 * a typed fail-closed result; every WP-8 success outcome passes through.
 */
export function createOutcomeStoreBoundary(options: OutcomeStoreBoundaryOptions): OutcomeStoreBoundary {
  let provenance: StorageWriteActionProvenance;
  try {
    provenance = createControlPlaneWriteAction(options.writeAction);
  } catch {
    throw new TypeError('host write-action fields are invalid');
  }
  const registry = options.schemaRegistry as SchemaRegistry;
  return Object.freeze({
    publishExactOutcomeRecord(permit: unknown, payload: Readonly<Record<string, unknown>>): OutcomePublicationResult {
      // Sink-level confinement (ADR-039): ONLY a genuine live exact-record
      // permit reaches the WP-8 substrate; the capability is re-verified at
      // this mutation boundary.
      if (!isGenuineExecutionOutcomePermit(permit)) {
        return denied('OUTCOME-CAPABILITY-DENIED', 'permit.not-genuine', 'the outcome publication permit is not genuine');
      }
      if (!executionOutcomePermitLive(permit)) {
        return denied('OUTCOME-CAPABILITY-DENIED', 'permit.disposed', 'the outcome publication permit is disposed');
      }
      const binding = (permit as ExecutionOutcomePermit).binding;
      if (binding.role !== 'execution-outcome-recording' || binding.recordClass !== 'execution-outcome-record') {
        return denied('OUTCOME-CAPABILITY-DENIED', 'permit.foreign-domain', 'the outcome publication permit belongs to another authority domain');
      }
      const capabilityCheck = binding.capability.verify();
      if (!capabilityCheck.ok) {
        return denied('OUTCOME-CAPABILITY-DENIED', `capability.${capabilityCheck.reason}`, 'the outcome-recorder capability is not usable');
      }
      if (!isRecord(payload)) return denied('OUTCOME-INPUT-INVALID', 'record.invalid', 'the outcome record payload is missing or malformed');
      if (payload['record_id'] !== binding.recordId) {
        return denied('OUTCOME-INPUT-INVALID', 'record.identity-mismatch', 'the outcome record identity does not match the permit binding');
      }
      if (payload['record_type'] !== 'ExecutionOutcomeRecord') {
        return denied('OUTCOME-INPUT-INVALID', 'record.class-mismatch', 'the outcome record class does not match the permit binding');
      }
      if (payload['responsible_role'] !== 'trusted-execution-outcome-recorder') {
        return denied('OUTCOME-INPUT-INVALID', 'record.role-mismatch', 'the outcome record responsible role is not the outcome-recorder role');
      }
      const payloadDigest = computePayloadDigest(payload);
      if (payloadDigest !== binding.recordDigest || payloadDigest !== binding.canonicalBytesDigest) {
        return denied('OUTCOME-INPUT-INVALID', 'record.digest-mismatch', 'the outcome record digest does not match the permit binding');
      }
      const derived = deriveRecordRelativePath(EXECUTION_OUTCOME_RECORD_CLASS, binding.recordId);
      if (!derived.ok || derived.relativePath !== binding.destinationDesignation) {
        return denied('OUTCOME-INPUT-INVALID', 'record.destination-mismatch', 'the outcome record destination does not match the permit binding');
      }
      // Committed lifecycle schema gate (canonical input + selection +
      // structural validation through the committed schema path).
      const gate = validateLifecycleRecord(payload, registry);
      if (!gate.ok || gate.value === undefined) {
        return denied('OUTCOME-INPUT-INVALID', 'record.schema-invalid', 'the outcome record failed committed lifecycle schema validation');
      }
      let envelope: Readonly<Record<string, unknown>>;
      try {
        envelope = buildOutcomeEnvelope(payload, provenance.actionIdentity);
      } catch {
        return denied('OUTCOME-INTERNAL-FAILURE', 'internal.envelope-failed', 'the outcome record envelope could not be built');
      }
      let result: ReturnType<typeof publishRecord>;
      try {
        result = publishRecord({
          trustedConfiguration: options.trustedConfiguration,
          bootstrapInput: options.bootstrapInput,
          writeActionProvenance: provenance,
          locator: options.locator,
          serviceUid: options.serviceUid,
          forbiddenRoots: options.forbiddenRoots,
          limitProfile: options.limitProfile,
          recordClass: EXECUTION_OUTCOME_RECORD_CLASS,
          record: envelope,
          timeSource: options.timeSource,
        });
      } catch {
        return denied('OUTCOME-INTERNAL-FAILURE', 'internal.publish-exception', 'the WP-8 publication substrate raised an unexpected exception');
      }
      if (result.ok !== true || result.outcome === undefined) {
        return denied('OUTCOME-WRITE-FAILED', 'write.publish-failed', 'the WP-8 publication substrate rejected the outcome record');
      }
      if (result.outcome === 'temp-exists-retry' || result.outcome === 'failed') {
        return denied('OUTCOME-WRITE-FAILED', 'write.publish-failed', 'the WP-8 publication substrate rejected the outcome record');
      }
      return {
        ok: true,
        outcome: result.outcome,
        recordId: typeof result.recordId === 'string' ? result.recordId : binding.recordId,
        recordDigest: typeof result.recordDigest === 'string' ? result.recordDigest : binding.recordDigest,
        ...(result.auditEventId !== undefined ? { auditEventId: result.auditEventId } : {}),
      };
    },
    readLifecyclePayload(recordClass: RecordClassId, recordId: string): LifecycleReadResult {
      if (!READ_CLASSES.has(recordClass)) return { ok: false, code: 'read-failed' };
      const result = readRecord({ trustedConfiguration: options.trustedConfiguration, trustedInput: options.bootstrapInput, recordClass, recordId });
      if (!result.ok || result.record === undefined) {
        const absent = result.findings?.some((f) => f.code === 'ERR-STO-NOT-FOUND') === true;
        return { ok: false, code: absent ? 'not-found' : 'read-failed' };
      }
      const payload = result.record['payload'];
      return isRecord(payload) ? { ok: true, payload } : { ok: false, code: 'malformed-record' };
    },
    enumerateLifecycleRecords(recordClass: RecordClassId): LifecycleEnumerateResult {
      if (!READ_CLASSES.has(recordClass)) return { ok: false, code: 'enumerate-failed', recordIds: Object.freeze([]) };
      const recordIds: string[] = [];
      let continuation: Parameters<typeof enumerateClass>[0]['continuation'];
      for (let pageCount = 0; pageCount < 1000; pageCount += 1) {
        const page = enumerateClass({
          trustedConfiguration: options.trustedConfiguration,
          trustedInput: options.bootstrapInput,
          recordClass,
          ...(continuation !== undefined ? { continuation } : {}),
        });
        if (!page.ok) return { ok: false, code: 'enumerate-failed', recordIds: Object.freeze([]) };
        for (const item of page.items) {
          if (item.recordId !== undefined) recordIds.push(item.recordId);
        }
        continuation = page.continuation;
        if (continuation === undefined) return { ok: true, recordIds: Object.freeze(recordIds) };
      }
      return { ok: false, code: 'enumerate-bounded', recordIds: Object.freeze([]) };
    },
  });
}
