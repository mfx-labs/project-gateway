/**
 * WP-13C — narrow WP-8 publication store boundary (the ONLY WP-8 surface of
 * the publication authority).
 *
 * ADR-038 decision 3: the authority consumes the existing WP-8 exact-record
 * publication path (`publishRecord`) through a dedicated boundary confined
 * to the ONE `ResultPublicationRecord` class, exactly as the WP-12
 * control-plane store boundary wraps `publishRecord` for its eight classes.
 * WP-8 storage semantics, record allowlists, writer locking, durability,
 * audit, and registry-binding models are UNCHANGED (this module adds no new
 * storage behavior; it confines).
 *
 * - publish allowlist: exactly `result-publication-record`; every other
 *   class is rejected at the boundary;
 * - read allowlist (under-lock re-read only): `result-publication-record`,
 *   `validation-record`, `execution-attempt-record`,
 *   `execution-occurrence-record`, `activation-record`, `runtime-grant`,
 *   `revocation-record`;
 * - the write-action provenance is minted through the authorized WP-12
 *   producer (`src/control-plane/storage-write-action.ts` — the sole
 *   production consumer of `createStorageWriteActionProvenance`; static
 *   guard enforced);
 * - the publish entry point accepts ONLY a genuine live exact-record
 *   `ResultPublicationPermit` (role `result-publication`), re-verifies the
 *   capability at the mutation boundary (CAP-009), re-derives the
 *   destination internally, and verifies the payload identity/digest against
 *   the permit binding before any filesystem access;
 * - the envelope model is built exactly per the WP-8 record envelope
 *   contract (RFM-001); `publishRecord` keeps its internal writer lock and
 *   produces the mechanical authorized-write audit event at the operation
 *   durability point (D-6).
 *
 * This module is the ONLY publication-family module that imports the WP-8
 * publication/read surface (static-guard enforced). No direct filesystem
 * access; no other record class; no generic lifecycle/store authority.
 */
import { publishRecord } from '../storage/publication/index.js';
import { readRecord, enumerateClass } from '../storage/read/index.js';
import { recordClassProfile } from '../storage/format/taxonomy.js';
import { computePayloadDigest } from '../storage/format/envelope.js';
import { deriveRecordRelativePath } from '../storage/layout/layout.js';
import { createControlPlaneWriteAction } from '../control-plane/storage-write-action.js';
import { RESULT_PUBLICATION_RECORD_CLASS } from './types.js';
import type { PublicationStoreBoundary as PublicationStoreBoundaryType } from './types.js';
import {
  isGenuineResultPublicationPermit,
  resultPublicationPermitLive,
  type ResultPublicationPermit,
} from './capability.js';
import type { StorageWriteActionProvenance } from '../control-plane/storage-write-action.js';
import type { LockTimeSource, PublishRecordResult, RecordClassId } from '../storage/types.js';
import type { LifecycleEnumerateResult, LifecycleReadResult } from '../control-plane/types.js';

/** The single publishable class of the publication authority. */
const PUBLISH_CLASSES: ReadonlySet<string> = new Set(['result-publication-record']);

/** Closed read-only class set for the under-lock re-read (never published). */
const READ_CLASSES: ReadonlySet<string> = new Set([
  'result-publication-record',
  'validation-record',
  'execution-attempt-record',
  'execution-occurrence-record',
  'activation-record',
  'runtime-grant',
  'revocation-record',
]);

export interface PublicationStoreBoundaryOptions {
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
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Build the accepted WP-8 record envelope model for the single
 * `ResultPublicationRecord` class (RFM-001). The envelope record identity
 * and creation time come from the payload (assigned by the authority from
 * the host identity source); the trusted action identity comes from the
 * host-owned write action.
 */
export function buildPublicationEnvelope(
  payload: Readonly<Record<string, unknown>>,
  trustedActionId: string,
): Readonly<Record<string, unknown>> {
  const profile = recordClassProfile(RESULT_PUBLICATION_RECORD_CLASS);
  if (profile === undefined) throw new TypeError('result-publication-record class profile is unavailable');
  const recordId = payload['record_id'];
  const createdAt = payload['created_at'];
  if (typeof recordId !== 'string' || typeof createdAt !== 'string') {
    throw new TypeError('publication payload must carry record_id and created_at');
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
 * Real WP-8 publication boundary (single class). Every result is passed
 * through bounded, redacted forms; raw findings, paths, and errno never
 * cross this boundary.
 */
export function createPublicationStoreBoundary(options: PublicationStoreBoundaryOptions): PublicationStoreBoundaryType {
  let provenance: StorageWriteActionProvenance;
  try {
    provenance = createControlPlaneWriteAction(options.writeAction);
  } catch {
    throw new TypeError('host write-action fields are invalid');
  }
  return Object.freeze({
    publishResultPublicationRecord(permit: unknown, payload: Readonly<Record<string, unknown>>): PublishRecordResult {
      // Sink-level confinement (ADR-038 decision 3): ONLY a genuine live
      // exact-record permit reaches the WP-8 substrate; the capability is
      // re-verified at this mutation boundary (CAP-009).
      if (!isGenuineResultPublicationPermit(permit)) {
        return { ok: false, outcome: 'failed', findings: [] };
      }
      if (!resultPublicationPermitLive(permit)) {
        return { ok: false, outcome: 'failed', findings: [] };
      }
      const binding = (permit as ResultPublicationPermit).binding;
      if (!binding.capability.verify().ok) {
        return { ok: false, outcome: 'failed', findings: [] };
      }
      if (!isRecord(payload)) return { ok: false, outcome: 'failed', findings: [] };
      if (payload['record_id'] !== binding.recordId) return { ok: false, outcome: 'failed', findings: [] };
      if (payload['record_type'] !== 'ResultPublicationRecord') return { ok: false, outcome: 'failed', findings: [] };
      const payloadDigest = computePayloadDigest(payload);
      if (payloadDigest !== binding.recordDigest || payloadDigest !== binding.canonicalBytesDigest) {
        return { ok: false, outcome: 'failed', findings: [] };
      }
      const derived = deriveRecordRelativePath(RESULT_PUBLICATION_RECORD_CLASS, binding.recordId);
      if (!derived.ok || derived.relativePath !== binding.destinationDesignation) {
        return { ok: false, outcome: 'failed', findings: [] };
      }
      const envelope = buildPublicationEnvelope(payload, provenance.actionIdentity);
      return publishRecord({
        trustedConfiguration: options.trustedConfiguration,
        bootstrapInput: options.bootstrapInput,
        writeActionProvenance: provenance,
        locator: options.locator,
        serviceUid: options.serviceUid,
        forbiddenRoots: options.forbiddenRoots,
        limitProfile: options.limitProfile,
        recordClass: RESULT_PUBLICATION_RECORD_CLASS,
        record: envelope,
        timeSource: options.timeSource,
      });
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
