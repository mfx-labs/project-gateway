/**
 * WP-15 Phase 2 — narrow WP-8 correlation store boundary (the ONLY WP-8
 * surface of the correlation authority; §25).
 *
 * The authority consumes the existing WP-8 exact-record publication path
 * (`publishRecord`) through a dedicated boundary confined to EXACTLY TWO
 * classes — the successor `ResultPublicationRecord` and the
 * `SupersessionRecord` — exactly as the Phase 1B receipt boundary and the
 * WP-13C publication boundary wrap `publishRecord` for their classes.
 * WP-8 storage semantics, record allowlists, writer locking, durability,
 * audit, and registry-binding models are UNCHANGED (this module adds no
 * new storage behavior; it confines).
 *
 * - publish allowlist: exactly `result-publication-record` (successor
 *   permit) and `supersession-record` (supersession permit); every other
 *   record class — including `TrustedReceipt`, `ExecutionResult`,
 *   `ExecutionOutcomeRecord`, and any lifecycle class — is rejected at the
 *   boundary (a `TrustedReceipt` can never reach WP-8 through this
 *   surface; no generic publisher exists on the boundary);
 * - read allowlist (under-lock re-read only): the closed §3 Phase 2 class
 *   set — trusted-receipt, result-publication-record, supersession-record,
 *   validation-record, execution-outcome-record, execution-attempt-record,
 *   execution-occurrence-record, activation-record, revocation-record
 *   (NO runtime-grant, approval, issuance, summary, migration, or audit
 *   class is readable; §29);
 * - the write-action provenance is minted through the authorized WP-12
 *   producer (`src/control-plane/storage-write-action.ts`);
 * - each publish entry point accepts ONLY a genuine live exact-record
 *   permit of its exact class (role `receipt-publication-correlation`),
 *   re-verifies the capability at the mutation boundary (CAP-009),
 *   re-derives the destination internally, verifies the payload
 *   identity/digest/class/schema-role against the permit binding AND the
 *   committed schema-const role, and runs the committed lifecycle schema
 *   gate before any filesystem access;
 * - the envelope model is built exactly per the WP-8 record envelope
 *   contract (RFM-001); `publishRecord` keeps its internal writer lock and
 *   produces the mechanical authorized-write audit event at the operation
 *   durability point (D-6).
 *
 * This module is the ONLY correlation-family module that imports the WP-8
 * publication/read surface (static-guard enforced). No direct filesystem
 * access; no other record class; no generic lifecycle/store authority; no
 * issuance/correlation decision (eligibility, construction, identity
 * allocation, lock, replay/conflict) lives here.
 */
import { publishRecord } from '../storage/publication/index.js';
import { readRecord, enumerateClass } from '../storage/read/index.js';
import { recordClassProfile } from '../storage/format/taxonomy.js';
import { computePayloadDigest } from '../storage/format/envelope.js';
import { deriveRecordRelativePath } from '../storage/layout/layout.js';
import { createControlPlaneWriteAction } from '../control-plane/storage-write-action.js';
import { validateLifecycleRecord } from '../api/validate.js';
import {
  CORRELATION_PUBLICATION_RECORD_CLASS,
  CORRELATION_SUPERSESSION_RECORD_CLASS,
  CORRELATION_PUBLICATION_ROLE,
  CORRELATION_SUPERSESSION_ROLE,
  CORRELATION_READ_CLASSES,
  type CorrelationFailureCategory,
  type CorrelationPublicationResult,
  type CorrelationStoreBoundary,
} from './types.js';
import {
  CORRELATION_PERMIT_ROLE,
  isGenuineCorrelationPublicationPermit,
  isGenuineCorrelationSupersessionPermit,
  correlationPermitLive,
  type CorrelationPublicationPermit,
  type CorrelationSupersessionPermit,
} from './internal/brand.js';
import type { StorageWriteActionProvenance } from '../control-plane/storage-write-action.js';
import type { LockTimeSource, RecordClassId } from '../storage/types.js';
import type { LifecycleEnumerateResult, LifecycleReadResult } from '../control-plane/types.js';
import type { SchemaRegistry } from '../schema/registry.js';

export interface CorrelationStoreBoundaryOptions {
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

function denied(category: CorrelationFailureCategory, code: string, message: string): CorrelationPublicationResult {
  return { ok: false, category, code, message };
}

/**
 * Build the accepted WP-8 record envelope model for one correlation record
 * class (RFM-001). The envelope record identity and creation time come from
 * the already-constructed payload (assigned by the authority from the host
 * identity source); the trusted action identity comes from the host-owned
 * write action.
 */
function buildCorrelationEnvelope(
  recordClass: typeof CORRELATION_PUBLICATION_RECORD_CLASS | typeof CORRELATION_SUPERSESSION_RECORD_CLASS,
  payload: Readonly<Record<string, unknown>>,
  trustedActionId: string,
): Readonly<Record<string, unknown>> {
  const profile = recordClassProfile(recordClass);
  if (profile === undefined) throw new TypeError('correlation record class profile is unavailable');
  const recordId = payload['record_id'];
  const createdAt = payload['created_at'];
  if (typeof recordId !== 'string' || typeof createdAt !== 'string') {
    throw new TypeError('correlation payload must carry record_id and created_at');
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
 * Real WP-8 correlation publication boundary (exactly two classes). Every
 * rejection is a typed fail-closed result; every WP-8 success outcome
 * passes through (including same-identity collision outcomes, which the
 * authority resolves through its gated collision reread).
 */
export function createCorrelationStoreBoundary(options: CorrelationStoreBoundaryOptions): CorrelationStoreBoundary {
  let provenance: StorageWriteActionProvenance;
  try {
    provenance = createControlPlaneWriteAction(options.writeAction);
  } catch {
    throw new TypeError('host write-action fields are invalid');
  }
  const registry = options.schemaRegistry as SchemaRegistry;

  function publishForClass(
    recordClass: typeof CORRELATION_PUBLICATION_RECORD_CLASS | typeof CORRELATION_SUPERSESSION_RECORD_CLASS,
    expectedRecordType: string,
    expectedRole: string,
    writeFailureCategory: 'CORRELATION-SUCCESSOR-WRITE-FAILED' | 'CORRELATION-SUPERSESSION-WRITE-FAILED',
    permit: unknown,
    payload: Readonly<Record<string, unknown>>,
  ): CorrelationPublicationResult {
    const genuine =
      recordClass === CORRELATION_PUBLICATION_RECORD_CLASS
        ? isGenuineCorrelationPublicationPermit(permit)
        : isGenuineCorrelationSupersessionPermit(permit);
    if (!genuine) {
      return denied('CORRELATION-CAPABILITY-DENIED', 'permit.not-genuine', 'the correlation publication permit is not genuine');
    }
    if (!correlationPermitLive(permit as object)) {
      return denied('CORRELATION-CAPABILITY-DENIED', 'permit.disposed', 'the correlation publication permit is disposed');
    }
    const binding = (permit as { readonly binding: { readonly capability: { readonly verify: () => { readonly ok: boolean } }; readonly role: string; readonly recordClass: string; readonly recordId: string; readonly recordDigest: string; readonly canonicalBytesDigest: string; readonly destinationDesignation: string } }).binding;
    if (binding.role !== CORRELATION_PERMIT_ROLE || binding.recordClass !== recordClass) {
      return denied('CORRELATION-CAPABILITY-DENIED', 'permit.foreign-domain', 'the correlation publication permit belongs to another authority domain or record class');
    }
    const capabilityCheck = binding.capability.verify();
    if (!capabilityCheck.ok) {
      return denied('CORRELATION-CAPABILITY-DENIED', 'capability.denied', 'the correlation capability is not usable');
    }
    if (!isRecord(payload)) return denied('CORRELATION-INPUT-INVALID', 'record.invalid', 'the correlation record payload is missing or malformed');
    if (payload['record_id'] !== binding.recordId) {
      return denied('CORRELATION-INPUT-INVALID', 'record.identity-mismatch', 'the correlation record identity does not match the permit binding');
    }
    if (payload['record_type'] !== expectedRecordType) {
      return denied('CORRELATION-INPUT-INVALID', 'record.class-mismatch', 'the correlation record class does not match the permit binding');
    }
    if (payload['responsible_role'] !== expectedRole) {
      return denied('CORRELATION-INPUT-INVALID', 'record.role-mismatch', 'the correlation record responsible role is not the committed schema role');
    }
    const payloadDigest = computePayloadDigest(payload);
    if (payloadDigest !== binding.recordDigest || payloadDigest !== binding.canonicalBytesDigest) {
      return denied('CORRELATION-INPUT-INVALID', 'record.digest-mismatch', 'the correlation record digest does not match the permit binding');
    }
    const derived = deriveRecordRelativePath(recordClass, binding.recordId);
    if (!derived.ok || derived.relativePath !== binding.destinationDesignation) {
      return denied('CORRELATION-INPUT-INVALID', 'record.destination-mismatch', 'the correlation record destination does not match the permit binding');
    }
    // Committed lifecycle schema gate (canonical input + selection +
    // structural validation through the committed schema path).
    const gate = validateLifecycleRecord(payload, registry);
    if (!gate.ok || gate.value === undefined) {
      return denied('CORRELATION-INPUT-INVALID', 'record.schema-invalid', 'the correlation record failed committed lifecycle schema validation');
    }
    let envelope: Readonly<Record<string, unknown>>;
    try {
      envelope = buildCorrelationEnvelope(recordClass, payload, provenance.actionIdentity);
    } catch {
      return denied('CORRELATION-INTERNAL-FAILURE', 'internal.envelope-failed', 'the correlation record envelope could not be built');
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
        recordClass,
        record: envelope,
        timeSource: options.timeSource,
      });
    } catch {
      return denied('CORRELATION-INTERNAL-FAILURE', 'internal.publish-exception', 'the WP-8 publication substrate raised an unexpected exception');
    }
    if (result.outcome === undefined) {
      return denied(writeFailureCategory, 'write.publish-failed', 'the WP-8 publication substrate rejected the correlation record');
    }
    if (result.outcome === 'temp-exists-retry' || result.outcome === 'failed') {
      return denied(writeFailureCategory, 'write.publish-failed', 'the WP-8 publication substrate rejected the correlation record');
    }
    // Every same-identity collision outcome ('idempotent-duplicate',
    // 'duplicate', 'conflict-revision') flows to the authority's gated
    // collision reread: class/role gate → schema gate → material
    // comparison. A malformed collision record is a typed conflict/corrupt
    // result — never a write-failure, JCS throw, replay, or overwrite.
    return {
      ok: true,
      outcome: result.outcome,
      recordId: typeof result.recordId === 'string' ? result.recordId : binding.recordId,
      recordDigest: typeof result.recordDigest === 'string' ? result.recordDigest : binding.recordDigest,
      ...(result.auditEventId !== undefined ? { auditEventId: result.auditEventId } : {}),
    };
  }

  return Object.freeze({
    publishSuccessorPublication(permit: unknown, payload: Readonly<Record<string, unknown>>): CorrelationPublicationResult {
      return publishForClass(CORRELATION_PUBLICATION_RECORD_CLASS, 'ResultPublicationRecord', CORRELATION_PUBLICATION_ROLE, 'CORRELATION-SUCCESSOR-WRITE-FAILED', permit, payload);
    },
    publishSupersession(permit: unknown, payload: Readonly<Record<string, unknown>>): CorrelationPublicationResult {
      return publishForClass(CORRELATION_SUPERSESSION_RECORD_CLASS, 'SupersessionRecord', CORRELATION_SUPERSESSION_ROLE, 'CORRELATION-SUPERSESSION-WRITE-FAILED', permit, payload);
    },
    readLifecyclePayload(recordClass: RecordClassId, recordId: string): LifecycleReadResult {
      if (!CORRELATION_READ_CLASSES.has(recordClass)) return { ok: false, code: 'read-failed' };
      const result = readRecord({ trustedConfiguration: options.trustedConfiguration, trustedInput: options.bootstrapInput, recordClass, recordId });
      if (!result.ok || result.record === undefined) {
        const absent = result.findings?.some((f) => f.code === 'ERR-STO-NOT-FOUND') === true;
        return { ok: false, code: absent ? 'not-found' : 'read-failed' };
      }
      const payload = result.record['payload'];
      return isRecord(payload) ? { ok: true, payload } : { ok: false, code: 'malformed-record' };
    },
    enumerateLifecycleRecords(recordClass: RecordClassId): LifecycleEnumerateResult {
      if (!CORRELATION_READ_CLASSES.has(recordClass)) return { ok: false, code: 'enumerate-failed', recordIds: Object.freeze([]) };
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
