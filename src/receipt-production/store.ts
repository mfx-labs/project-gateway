/**
 * WP-15 Phase 1B — narrow WP-8 receipt store boundary (the ONLY WP-8
 * surface of the receipt authority).
 *
 * §15: the authority consumes the existing WP-8 exact-record publication
 * path (`publishRecord`) through a dedicated boundary confined to the ONE
 * `trusted-receipt` class, exactly as the WP-13C publication boundary and
 * the WP-13-S2 outcome boundary wrap `publishRecord` for their single
 * classes. WP-8 storage semantics, record allowlists, writer locking,
 * durability, audit, and registry-binding models are UNCHANGED (this module
 * adds no new storage behavior; it confines).
 *
 * - publish allowlist: exactly `trusted-receipt`; every other record class
 *   is rejected at the boundary (a `ResultPublicationRecord`,
 *   `SupersessionRecord`, `ExecutionResult`, `ActivationRecord`,
 *   `RuntimeGrant`, or any other lifecycle class can never reach WP-8
 *   through this surface);
 * - read allowlist (under-lock re-read only): the closed §3 class set —
 *   trusted-receipt, execution-attempt-record, execution-occurrence-record,
 *   execution-outcome-record, activation-record, runtime-grant,
 *   revocation-record, validation-record, result-publication-record;
 * - the write-action provenance is minted through the authorized WP-12
 *   producer (`src/control-plane/storage-write-action.ts` — the sole
 *   production consumer of `createStorageWriteActionProvenance`; static
 *   guard enforced);
 * - the publish entry point accepts ONLY a genuine live exact-record
 *   `TrustedReceiptPermit` (role `trusted-receipt-producer`), re-verifies
 *   the capability at the mutation boundary (CAP-009), re-derives the
 *   destination internally, verifies the payload identity/digest/class/role
 *   against the permit binding, and runs the committed lifecycle schema
 *   gate before any filesystem access;
 * - the envelope model is built exactly per the WP-8 record envelope
 *   contract (RFM-001); `publishRecord` keeps its internal writer lock and
 *   produces the mechanical authorized-write audit event at the operation
 *   durability point (D-6).
 *
 * This module is the ONLY receipt-family module that imports the WP-8
 * publication/read surface (static-guard enforced). No direct filesystem
 * access; no other record class; no generic lifecycle/store authority; no
 * issuance decision (eligibility, construction, identity allocation, lock,
 * replay/conflict) lives here.
 */
import { publishRecord } from '../storage/publication/index.js';
import { readRecord, enumerateClass } from '../storage/read/index.js';
import { recordClassProfile } from '../storage/format/taxonomy.js';
import { computePayloadDigest } from '../storage/format/envelope.js';
import { deriveRecordRelativePath } from '../storage/layout/layout.js';
import { createControlPlaneWriteAction } from '../control-plane/storage-write-action.js';
import { validateLifecycleRecord } from '../api/validate.js';
import { TRUSTED_RECEIPT_RECORD_CLASS, TRUSTED_RECEIPT_PRODUCER_ROLE, RECEIPT_READ_CLASSES, type ReceiptFailureCategory, type ReceiptPublicationResult, type ReceiptStoreBoundary } from './types.js';
import {
  isGenuineTrustedReceiptPermit,
  trustedReceiptPermitLive,
  type TrustedReceiptPermit,
} from './internal/brand.js';
import type { StorageWriteActionProvenance } from '../control-plane/storage-write-action.js';
import type { LockTimeSource, RecordClassId } from '../storage/types.js';
import type { LifecycleEnumerateResult, LifecycleReadResult } from '../control-plane/types.js';
import type { SchemaRegistry } from '../schema/registry.js';

export interface ReceiptStoreBoundaryOptions {
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

function denied(category: ReceiptFailureCategory, code: string, message: string): ReceiptPublicationResult {
  return { ok: false, category, code, message };
}

/**
 * Build the accepted WP-8 record envelope model for the single
 * `trusted-receipt` class (RFM-001). The envelope record identity and
 * creation time come from the already-constructed payload (assigned by the
 * authority from the host identity source); the trusted action identity
 * comes from the host-owned write action.
 */
export function buildReceiptEnvelope(
  payload: Readonly<Record<string, unknown>>,
  trustedActionId: string,
): Readonly<Record<string, unknown>> {
  const profile = recordClassProfile(TRUSTED_RECEIPT_RECORD_CLASS);
  if (profile === undefined) throw new TypeError('trusted-receipt class profile is unavailable');
  const recordId = payload['record_id'];
  const createdAt = payload['created_at'];
  if (typeof recordId !== 'string' || typeof createdAt !== 'string') {
    throw new TypeError('receipt payload must carry record_id and created_at');
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
 * Real WP-8 receipt publication boundary (single class). Every rejection is
 * a typed fail-closed result; every WP-8 success outcome passes through.
 */
export function createReceiptStoreBoundary(options: ReceiptStoreBoundaryOptions): ReceiptStoreBoundary {
  let provenance: StorageWriteActionProvenance;
  try {
    provenance = createControlPlaneWriteAction(options.writeAction);
  } catch {
    throw new TypeError('host write-action fields are invalid');
  }
  const registry = options.schemaRegistry as SchemaRegistry;
  return Object.freeze({
    publishTrustedReceipt(permit: unknown, payload: Readonly<Record<string, unknown>>): ReceiptPublicationResult {
      // Sink-level confinement (§15): ONLY a genuine live exact-record
      // permit reaches the WP-8 substrate; the capability is re-verified at
      // this mutation boundary (CAP-009).
      if (!isGenuineTrustedReceiptPermit(permit)) {
        return denied('RECEIPT-CAPABILITY-DENIED', 'permit.not-genuine', 'the receipt publication permit is not genuine');
      }
      if (!trustedReceiptPermitLive(permit)) {
        return denied('RECEIPT-CAPABILITY-DENIED', 'permit.disposed', 'the receipt publication permit is disposed');
      }
      const binding = (permit as TrustedReceiptPermit).binding;
      if (binding.role !== TRUSTED_RECEIPT_PRODUCER_ROLE || binding.recordClass !== TRUSTED_RECEIPT_RECORD_CLASS) {
        return denied('RECEIPT-CAPABILITY-DENIED', 'permit.foreign-domain', 'the receipt publication permit belongs to another authority domain');
      }
      const capabilityCheck = binding.capability.verify();
      if (!capabilityCheck.ok) {
        return denied('RECEIPT-CAPABILITY-DENIED', `capability.${capabilityCheck.reason}`, 'the trusted-receipt capability is not usable');
      }
      if (!isRecord(payload)) return denied('RECEIPT-INPUT-INVALID', 'record.invalid', 'the receipt record payload is missing or malformed');
      if (payload['record_id'] !== binding.recordId) {
        return denied('RECEIPT-INPUT-INVALID', 'record.identity-mismatch', 'the receipt record identity does not match the permit binding');
      }
      if (payload['record_type'] !== 'TrustedReceipt') {
        return denied('RECEIPT-INPUT-INVALID', 'record.class-mismatch', 'the receipt record class does not match the permit binding');
      }
      if (payload['responsible_role'] !== TRUSTED_RECEIPT_PRODUCER_ROLE) {
        return denied('RECEIPT-INPUT-INVALID', 'record.role-mismatch', 'the receipt record responsible role is not the receipt-producer role');
      }
      const payloadDigest = computePayloadDigest(payload);
      if (payloadDigest !== binding.recordDigest || payloadDigest !== binding.canonicalBytesDigest) {
        return denied('RECEIPT-INPUT-INVALID', 'record.digest-mismatch', 'the receipt record digest does not match the permit binding');
      }
      const derived = deriveRecordRelativePath(TRUSTED_RECEIPT_RECORD_CLASS, binding.recordId);
      if (!derived.ok || derived.relativePath !== binding.destinationDesignation) {
        return denied('RECEIPT-INPUT-INVALID', 'record.destination-mismatch', 'the receipt record destination does not match the permit binding');
      }
      // Committed lifecycle schema gate (canonical input + selection +
      // structural validation through the committed schema path).
      const gate = validateLifecycleRecord(payload, registry);
      if (!gate.ok || gate.value === undefined) {
        return denied('RECEIPT-INPUT-INVALID', 'record.schema-invalid', 'the receipt record failed committed lifecycle schema validation');
      }
      let envelope: Readonly<Record<string, unknown>>;
      try {
        envelope = buildReceiptEnvelope(payload, provenance.actionIdentity);
      } catch {
        return denied('RECEIPT-INTERNAL-FAILURE', 'internal.envelope-failed', 'the receipt record envelope could not be built');
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
          recordClass: TRUSTED_RECEIPT_RECORD_CLASS,
          record: envelope,
          timeSource: options.timeSource,
        });
      } catch {
        return denied('RECEIPT-INTERNAL-FAILURE', 'internal.publish-exception', 'the WP-8 publication substrate raised an unexpected exception');
      }
      if (result.outcome === undefined) {
        return denied('RECEIPT-WRITE-FAILED', 'write.publish-failed', 'the WP-8 publication substrate rejected the receipt record');
      }
      if (result.outcome === 'temp-exists-retry' || result.outcome === 'failed') {
        return denied('RECEIPT-WRITE-FAILED', 'write.publish-failed', 'the WP-8 publication substrate rejected the receipt record');
      }
      // SIR-WP15-P1B-001 §3: every same-identity collision outcome
      // ('idempotent-duplicate', 'duplicate', 'conflict-revision' — WP-8
      // returns ok:false for the content-differing pair) flows to the
      // authority's gated collision reread: class/role gate → schema gate →
      // material comparison. A malformed collision record is a typed
      // conflict/corrupt result — never a write-failure, JCS throw, replay,
      // or overwrite.
      return {
        ok: true,
        outcome: result.outcome,
        recordId: typeof result.recordId === 'string' ? result.recordId : binding.recordId,
        recordDigest: typeof result.recordDigest === 'string' ? result.recordDigest : binding.recordDigest,
        ...(result.auditEventId !== undefined ? { auditEventId: result.auditEventId } : {}),
      };
    },
    readLifecyclePayload(recordClass: RecordClassId, recordId: string): LifecycleReadResult {
      if (!RECEIPT_READ_CLASSES.has(recordClass)) return { ok: false, code: 'read-failed' };
      const result = readRecord({ trustedConfiguration: options.trustedConfiguration, trustedInput: options.bootstrapInput, recordClass, recordId });
      if (!result.ok || result.record === undefined) {
        const absent = result.findings?.some((f) => f.code === 'ERR-STO-NOT-FOUND') === true;
        return { ok: false, code: absent ? 'not-found' : 'read-failed' };
      }
      const payload = result.record['payload'];
      return isRecord(payload) ? { ok: true, payload } : { ok: false, code: 'malformed-record' };
    },
    enumerateLifecycleRecords(recordClass: RecordClassId): LifecycleEnumerateResult {
      if (!RECEIPT_READ_CLASSES.has(recordClass)) return { ok: false, code: 'enumerate-failed', recordIds: Object.freeze([]) };
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
