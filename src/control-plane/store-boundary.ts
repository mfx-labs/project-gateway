/**
 * WP-12 Slice 1 — WP-8 store boundary adapter (the ONLY publication path).
 *
 * Wraps the accepted WP-8 surface unchanged: `publishRecord`, `readRecord`,
 * and `enumerateClass`. The envelope model is built exactly per the WP-8
 * record envelope contract (RFM-001); `publishRecord` keeps its internal
 * writer lock and produces the mechanical authorized-write audit event at
 * the operation durability point (D-6). WP-12 never publishes
 * `AuthoritativeAuditEvent` records (the audit class is not a general
 * primary-publishable class; SCR-W12-001), never acquires WP-8 writer
 * locks itself, and never writes files directly.
 *
 * This module is the only control-plane module that imports the WP-8
 * publication/read surface (static-guard enforced).
 */
import { publishRecord } from '../storage/publication/index.js';
import { readRecord, enumerateClass } from '../storage/read/index.js';
import { recordClassProfile } from '../storage/format/taxonomy.js';
import { computePayloadDigest } from '../storage/format/envelope.js';
import { createControlPlaneWriteAction } from './storage-write-action.js';
import type { StorageWriteActionProvenance } from './storage-write-action.js';
import type { LockTimeSource, RecordClassId } from '../storage/types.js';
import type { ControlPlaneStoreBoundary, LifecycleEnumerateResult, LifecycleReadResult } from './types.js';

/**
 * The seven Slice-1/2/3 primary publishable lifecycle record classes (final
 * Slice-3 allowlist; §33 + §26.21). The attempt class stays DISABLED for
 * production until Slice 4 (the boundary rejects every class outside this
 * allowlist).
 */
const CONTROL_PLANE_PUBLISH_CLASSES: ReadonlySet<string> = new Set(['validation-record', 'approval-record', 'issuance-record', 'revocation-record', 'runtime-grant', 'activation-record', 'execution-occurrence-record']);

export interface ControlPlaneStoreBoundaryOptions {
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
 * Build the accepted WP-8 record envelope model for one lifecycle payload.
 * The envelope record identity and creation time are taken from the payload
 * (assigned by the decision core from the host identity source); the
 * trusted action identity comes from the host-owned write action.
 */
export function buildRecordEnvelope(
  recordClass: RecordClassId,
  payload: Readonly<Record<string, unknown>>,
  trustedActionId: string,
): Readonly<Record<string, unknown>> {
  const profile = recordClassProfile(recordClass);
  if (profile === undefined || !CONTROL_PLANE_PUBLISH_CLASSES.has(recordClass)) {
    throw new TypeError(`record class is not publishable by the WP-12 control plane: ${String(recordClass)}`);
  }
  const recordId = payload['record_id'];
  const createdAt = payload['created_at'];
  if (typeof recordId !== 'string' || typeof createdAt !== 'string') {
    throw new TypeError('lifecycle payload must carry record_id and created_at');
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

/** Extract the lifecycle payload from a stored envelope model (fail closed). */
export function lifecyclePayloadOf(recordModel: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined {
  const payload = recordModel['payload'];
  return isRecord(payload) ? payload : undefined;
}

/**
 * Real WP-8 store boundary. All three functions delegate to the accepted
 * WP-8 surface unchanged; every result is passed through bounded, redacted
 * (the core maps failures to the closed taxonomy and never exposes raw
 * findings, paths, or errno).
 */
export function createControlPlaneStoreBoundary(options: ControlPlaneStoreBoundaryOptions): ControlPlaneStoreBoundary {
  let provenance: StorageWriteActionProvenance;
  try {
    provenance = createControlPlaneWriteAction(options.writeAction);
  } catch {
    throw new TypeError('host write-action fields are invalid');
  }
  return Object.freeze({
    publishLifecycleRecord(recordClass: RecordClassId, payload: Readonly<Record<string, unknown>>): ReturnType<ControlPlaneStoreBoundary['publishLifecycleRecord']> {
      const envelope = buildRecordEnvelope(recordClass, payload, provenance.actionIdentity);
      return publishRecord({
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
    },
    readLifecyclePayload(recordClass: RecordClassId, recordId: string): LifecycleReadResult {
      const result = readRecord({
        trustedConfiguration: options.trustedConfiguration,
        trustedInput: options.bootstrapInput,
        recordClass,
        recordId,
      });
      if (!result.ok || result.record === undefined) {
        // SR-W12-S1-004: preserve the WP-8 semantic-absence distinction
        // (ERR-STO-NOT-FOUND) separately from actual read/storage failure so
        // the operation layer maps a missing required record to the committed
        // semantic category instead of store-failure. The WP-8 token stays
        // internal; the core maps these internal codes to the closed public
        // taxonomy and never exposes raw storage findings, errno, paths, or
        // messages.
        const absent = result.findings?.some((f) => f.code === 'ERR-STO-NOT-FOUND') === true;
        return { ok: false, code: absent ? 'not-found' : 'read-failed' };
      }
      const payload = lifecyclePayloadOf(result.record);
      if (payload === undefined) return { ok: false, code: 'malformed-record' };
      return { ok: true, payload };
    },
    enumerateLifecycleRecords(recordClass: RecordClassId): LifecycleEnumerateResult {
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
