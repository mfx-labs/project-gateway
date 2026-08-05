/**
 * WP-6 Phase 3A: detached lifecycle records-array snapshot (contract Sections
 * 12 and 15; HCR-03 Model A — frozen array of branded wrapper references).
 *
 * The source array is descriptor-inspected (length and every index through own
 * property descriptors; sparse arrays, accessor indexes, inherited indexes,
 * non-enumerable indexes, symbol properties, extra properties, structural
 * traps, and revoked Proxies are rejected). Each element reference is
 * extracted exactly once, brand-checked with the existing lifecycle-record
 * WeakSet brand, and placed into one fresh frozen array containing the exact
 * branded wrapper references — the wrappers are never deep-cloned. Duplicate
 * record IDs fail closed before lookup or identity construction. One
 * deterministic lookup is built from the frozen array; the caller's live
 * `findRecord` is never consulted as a semantic source; the original array is
 * never reread.
 *
 * The canonical lifecycle identity projection (contract Section 14) embeds
 * each record's model as a deeply frozen JSON value (the committed wrapper
 * model is already deeply frozen) and sorts projections by record ID.
 */
import type { ValidatedLifecycleRecord } from '../api/types.js';
import { isBrandedRecord } from '../internal/snapshot.js';
import { compareStrings } from '../trusted/ordering.js';
import type { StaticLifecycleRecordProjection } from './router-types.js';

export type LifecycleSnapshotFailureCode = 'array-hostile' | 'record-brand' | 'duplicate-record-id';

export interface LifecycleSnapshot {
  /** Fresh frozen array of the exact branded wrapper references (Model A). */
  readonly records: readonly ValidatedLifecycleRecord[];
  /** Deterministic lookup built only from the frozen array. */
  readonly lookup: ReadonlyMap<string, ValidatedLifecycleRecord>;
  /** Canonical projections sorted by record ID. */
  readonly projections: readonly StaticLifecycleRecordProjection[];
}

const MAX_ARRAY_LENGTH = 0xffffffff;

function isArrayIndexKey(key: string, length: number): boolean {
  if (!/^(0|[1-9]\d*)$/.test(key)) return false;
  const n = Number(key);
  return n >= 0 && n < length && Number.isSafeInteger(n);
}

function recordIdOf(record: ValidatedLifecycleRecord): string {
  // Branded wrappers are committed-constructed plain frozen records; read
  // defensively with string coercion (never through hostile accessors).
  const raw = (record as unknown as Readonly<Record<string, unknown>>)['recordId'];
  return typeof raw === 'string' ? raw : '';
}

/**
 * Snapshot the lifecycle records array. Returns the frozen wrapper-reference
 * array, the deterministic lookup, and the canonical sorted projections, or a
 * typed fail-closed code. Never rereads the original array or the lifecycle
 * `records` property.
 */
export function snapshotLifecycleRecords(recordsValue: unknown):
  | { readonly ok: true; readonly snapshot: LifecycleSnapshot }
  | { readonly ok: false; readonly code: LifecycleSnapshotFailureCode } {
  let isArray: boolean;
  try {
    isArray = Array.isArray(recordsValue);
  } catch {
    // A revoked Proxy cannot be structurally classified.
    return { ok: false, code: 'array-hostile' };
  }
  if (!isArray) return { ok: false, code: 'array-hostile' };
  const array = recordsValue as unknown[];

  let lengthDesc: PropertyDescriptor | undefined;
  try {
    lengthDesc = Object.getOwnPropertyDescriptor(array, 'length');
  } catch {
    return { ok: false, code: 'array-hostile' };
  }
  if (lengthDesc === undefined || lengthDesc.get !== undefined || lengthDesc.set !== undefined) {
    return { ok: false, code: 'array-hostile' };
  }
  const length = lengthDesc.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > MAX_ARRAY_LENGTH) {
    return { ok: false, code: 'array-hostile' };
  }

  let ownKeys: string[];
  let symbols: symbol[];
  try {
    ownKeys = Object.getOwnPropertyNames(array);
    symbols = Object.getOwnPropertySymbols(array);
  } catch {
    return { ok: false, code: 'array-hostile' };
  }
  if (symbols.length > 0) return { ok: false, code: 'array-hostile' };
  for (const key of ownKeys) {
    if (key === 'length') continue;
    if (!isArrayIndexKey(key, length)) return { ok: false, code: 'array-hostile' };
  }

  const extracted: ValidatedLifecycleRecord[] = [];
  for (let i = 0; i < length; i++) {
    const key = String(i);
    let desc: PropertyDescriptor | undefined;
    try {
      desc = Object.getOwnPropertyDescriptor(array, key);
    } catch {
      return { ok: false, code: 'array-hostile' };
    }
    if (desc === undefined) return { ok: false, code: 'array-hostile' }; // sparse hole
    if (desc.get !== undefined || desc.set !== undefined) return { ok: false, code: 'array-hostile' };
    if (!desc.enumerable) return { ok: false, code: 'array-hostile' };
    const element = desc.value;
    if (element === null || typeof element !== 'object' || !isBrandedRecord(element)) {
      return { ok: false, code: 'record-brand' };
    }
    extracted.push(element as ValidatedLifecycleRecord);
  }

  // Duplicate record IDs fail closed before lookup or identity construction.
  const seen = new Set<string>();
  for (const record of extracted) {
    const id = recordIdOf(record);
    if (id.length === 0 || seen.has(id)) return { ok: false, code: 'duplicate-record-id' };
    seen.add(id);
  }

  const records = Object.freeze([...extracted]);
  const lookup = new Map<string, ValidatedLifecycleRecord>();
  const projections: StaticLifecycleRecordProjection[] = [];
  for (const record of records) {
    const id = recordIdOf(record);
    lookup.set(id, record);
    projections.push(Object.freeze({ recordId: id, model: record.model as never }));
  }
  projections.sort((a, b) => compareStrings(a.recordId, b.recordId));

  return {
    ok: true,
    snapshot: {
      records,
      lookup,
      projections: Object.freeze(projections),
    },
  };
}

/**
 * Interface-fidelity `findRecord` backed by the deterministic lookup (contract
 * Section 12: the caller's live `findRecord` is not an independent semantic
 * source). Returned records are the exact branded wrapper references from the
 * frozen snapshot.
 */
export function createDetachedFindRecord(
  lookup: ReadonlyMap<string, ValidatedLifecycleRecord>,
): (recordId: string) => ValidatedLifecycleRecord | undefined {
  return (recordId: string) => lookup.get(recordId);
}
