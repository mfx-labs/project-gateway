/**
 * Public-input shape gate and descriptor snapshots (WP-5A F-1/F-3, A-2/A-3).
 *
 * One explicit, side-effect-free shape validator for the public projection
 * API. It runs before any projection, context correlation, rendering,
 * fingerprinting, or feature lookup, so expected caller-shape errors are
 * recognized explicitly and mapped to stable findings instead of escaping as
 * raw `TypeError`s or unhandled property dereferences.
 *
 * After the gate, caller-controlled containers (capability, limits, context
 * items) are NEVER read again from the original caller object: every
 * protocol-significant field is read once through its own property
 * descriptor (`Object.getOwnPropertyDescriptor(...).value`), and all later
 * validation, correlation, matching, and rendering operates on the plain
 * immutable snapshots produced here.
 *
 * All checks are coercion-free and hook-free: values are inspected through
 * `typeof`, `Array.isArray`, `Object.getPrototypeOf`, and
 * `Object.getOwnPropertyDescriptor` only. Proxy `get` traps, getters,
 * accessors, `toString`, `valueOf`, and conversion hooks are never invoked;
 * structural proxy traps (`getPrototypeOf`, `getOwnPropertyDescriptor`) that
 * throw are caught and mapped to stable findings. Caller input is never
 * mutated.
 */
import { piFinding, sortFindings } from '../findings.js';
import type { PiFinding } from '../types.js';

// ---------------------------------------------------------------------------
// narrow introspection helpers (trap-safe, hook-free)
// ---------------------------------------------------------------------------

/** Narrow plain-runtime-object check (rejects primitives, arrays, class
 *  instances, and exotic prototypes; never invokes accessors or traps). */
export function isPlainRuntimeObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  let proto: unknown;
  try {
    proto = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return proto === Object.prototype || proto === null;
}

/** The own property descriptor of `key`, or undefined when absent or when a
 *  structural proxy trap throws. Never invokes getters or value access. */
function ownDescriptor(obj: object, key: PropertyKey): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(obj, key);
  } catch {
    return undefined;
  }
}

/** True when `key` is an own DATA property (no accessor); never invokes
 *  getters and never reads the property value. */
function hasOwnDataProperty(obj: object, key: PropertyKey): boolean {
  const desc = ownDescriptor(obj, key);
  return desc !== undefined && desc.get === undefined && desc.set === undefined;
}

/** Read the value of an own data property through its descriptor only.
 *  Returns undefined when absent, accessor-bearing, or trap-throwing. */
function readOwnDataValue(obj: object, key: PropertyKey): unknown | undefined {
  const desc = ownDescriptor(obj, key);
  if (desc === undefined || desc.get !== undefined || desc.set !== undefined) return undefined;
  return desc.value;
}

/** Snapshot a list-like capability field through per-index descriptors so a
 *  Proxy `get` trap can never execute. Sparse holes are preserved as
 *  undefined. Returns undefined when the value is not an array or when a
 *  structural trap throws (caller treats that as malformed). */
function readListSnapshot(obj: object, key: PropertyKey): readonly unknown[] | undefined {
  const value = readOwnDataValue(obj, key);
  if (!Array.isArray(value)) return undefined;
  const lengthDesc = ownDescriptor(value, 'length');
  if (lengthDesc === undefined || lengthDesc.get !== undefined || lengthDesc.set !== undefined) return undefined;
  const length = lengthDesc.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return undefined;
  const items: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const desc = ownDescriptor(value, i);
    if (desc === undefined) {
      items.push(undefined); // sparse hole
      continue;
    }
    if (desc.get !== undefined || desc.set !== undefined) return undefined;
    items.push(desc.value);
  }
  return items;
}

/** Snapshot a string-valued record through per-key descriptors. Returns
 *  undefined when the value is not a plain object or any key is
 *  accessor-bearing, non-string-valued, or trap-throwing. */
export function stringRecordSnapshot(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  let proto: unknown;
  try {
    proto = Object.getPrototypeOf(value);
  } catch {
    return undefined;
  }
  if (proto !== Object.prototype && proto !== null) return undefined;
  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch {
    return undefined;
  }
  const record: Record<string, string> = {};
  for (const k of keys) {
    const desc = ownDescriptor(value, k);
    if (desc === undefined || desc.get !== undefined || desc.set !== undefined) return undefined;
    if (typeof desc.value !== 'string') return undefined;
    record[k] = desc.value;
  }
  return Object.freeze(record);
}

/** Snapshot a string-valued record field of an object through per-key
 *  descriptors. Returns undefined when the field is absent, accessor-bearing,
 *  or not a plain record of strings. */
function readStringRecordSnapshot(obj: object, key: PropertyKey): Readonly<Record<string, string>> | undefined {
  return stringRecordSnapshot(readOwnDataValue(obj, key));
}

// ---------------------------------------------------------------------------
// capability snapshot (A-2)
// ---------------------------------------------------------------------------

/** Plain immutable internal capability snapshot. Every field is the value of
 *  an own data descriptor; the original caller object is never read again. */
export interface CapabilitySnapshot {
  readonly piPackageId: unknown;
  readonly piVersion: unknown;
  readonly adapterApiVersion: unknown;
  readonly promptInjection: readonly unknown[] | undefined;
  readonly contextTransport: readonly unknown[] | undefined;
  readonly maxPromptBytes: unknown;
  readonly textEncodings: readonly unknown[] | undefined;
  readonly mediaTypes: readonly unknown[] | undefined;
  readonly sessionLifecycleEvents: readonly unknown[] | undefined;
  readonly turnLifecycleEvents: readonly unknown[] | undefined;
  readonly resultObservationEvents: readonly unknown[] | undefined;
  readonly toolCallObservationEvents: readonly unknown[] | undefined;
  readonly cancellationObservationEvents: readonly unknown[] | undefined;
  readonly shutdownObservationEvents: readonly unknown[] | undefined;
  readonly correlationMetadataSupported: unknown;
  readonly deterministicOrdering: unknown;
  readonly requiredFeatures: readonly unknown[] | undefined;
}

const CAPABILITY_STRING_FIELDS = ['piPackageId', 'piVersion', 'adapterApiVersion'] as const;

const CAPABILITY_FIELDS = [
  'piPackageId',
  'piVersion',
  'adapterApiVersion',
  'promptInjection',
  'contextTransport',
  'maxPromptBytes',
  'textEncodings',
  'mediaTypes',
  'sessionLifecycleEvents',
  'turnLifecycleEvents',
  'resultObservationEvents',
  'toolCallObservationEvents',
  'cancellationObservationEvents',
  'shutdownObservationEvents',
  'correlationMetadataSupported',
  'deterministicOrdering',
  'requiredFeatures',
] as const;

export type CapabilitySnapshotResult =
  | { readonly ok: true; readonly snapshot: CapabilitySnapshot }
  | { readonly ok: false; readonly findings: readonly PiFinding[] };

/**
 * Snapshot every protocol-significant capability field through its own data
 * descriptor. Accessor-bearing, inherited-only, or trap-throwing fields fail
 * closed with `host.capability-malformed`; the original object is never read
 * through property access, so Proxy `get` traps and getters never execute.
 */
export function readCapabilitySnapshot(value: unknown): CapabilitySnapshotResult {
  if (!isPlainRuntimeObject(value)) {
    return { ok: false, findings: Object.freeze([piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.capability-missing', 'Pi host capability declaration is missing or malformed', '/capability')]) };
  }
  const findings: PiFinding[] = [];
  const snapshot: Record<string, unknown> = {};
  for (const field of CAPABILITY_FIELDS) {
    const desc = ownDescriptor(value, field);
    if (desc === undefined) {
      // absent fields snapshot as undefined; the inspector reports the
      // semantic consequence with its stable findings (e.g.
      // host.package-identity, host.text-media-missing,
      // semantic.feature-unsupported) — this preserves the F-1/F-3 contracts
      snapshot[field] = undefined;
      continue;
    }
    if (desc.get !== undefined || desc.set !== undefined) {
      findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.capability-malformed', `host capability field ${field} is inherited-only or an accessor`, `/capability/${field}`));
      continue;
    }
    const v = desc.value;
    if (Array.isArray(v)) {
      // list fields are copied through per-index descriptors so Proxy `get`
      // traps never execute; a trap-throwing list is malformed
      const list = readListSnapshot(value, field);
      if (list === undefined) {
        findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.capability-malformed', `host capability field ${field} is not a readable array`, `/capability/${field}`));
        continue;
      }
      snapshot[field] = list;
    } else {
      // raw descriptor value; type semantics are validated downstream. The
      // three identity scalar fields keep their gate-level primitive-string
      // check so the F-1 finding contract is unchanged.
      snapshot[field] = v;
      if ((CAPABILITY_STRING_FIELDS as readonly string[]).includes(field) && typeof v !== 'string') {
        findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.capability-malformed', `host capability field ${field} must be a primitive string`, `/capability/${field}`));
      }
    }
  }
  if (findings.length > 0) {
    return { ok: false, findings: Object.freeze(sortFindings(findings)) };
  }
  return { ok: true, snapshot: Object.freeze(snapshot) as unknown as CapabilitySnapshot };
}

// ---------------------------------------------------------------------------
// limits snapshot (A-2/A-3 hardening)
// ---------------------------------------------------------------------------

/** Plain immutable internal limits snapshot (validated values only). */
export interface LimitsSnapshot {
  readonly maxContextItemBytes: number;
  readonly maxTotalContextBytes: number;
  readonly maxPlanBytes: number;
  readonly maxContextItemCount: number;
  readonly allowTruncation: boolean;
}

const LIMIT_NUMERIC_FIELDS = ['maxContextItemBytes', 'maxTotalContextBytes', 'maxPlanBytes', 'maxContextItemCount'] as const;

export type LimitsSnapshotResult =
  | { readonly ok: true; readonly snapshot: LimitsSnapshot }
  | { readonly ok: false; readonly reason: 'missing' | 'malformed' };

/** Snapshot caller-supplied limits through own data descriptors; every bound
 *  must be a non-negative safe integer and `allowTruncation` a boolean.
 *  Never coerces, never invokes hooks, never throws. `missing` means the
 *  container is absent or not a plain object; `malformed` means a field
 *  shape is invalid. */
export function readLimitsSnapshot(limits: unknown): LimitsSnapshotResult {
  if (!isPlainRuntimeObject(limits)) return { ok: false, reason: 'missing' };
  const snapshot: Record<string, unknown> = {};
  for (const field of LIMIT_NUMERIC_FIELDS) {
    const v = readOwnDataValue(limits, field);
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) return { ok: false, reason: 'malformed' };
    snapshot[field] = v;
  }
  const trunc = readOwnDataValue(limits, 'allowTruncation');
  if (typeof trunc !== 'boolean') return { ok: false, reason: 'malformed' };
  snapshot['allowTruncation'] = trunc;
  return { ok: true, snapshot: Object.freeze(snapshot) as unknown as LimitsSnapshot };
}

/** True when the caller-supplied limits object has the required shape. */
export function limitsShapeValid(limits: unknown): boolean {
  return readLimitsSnapshot(limits).ok;
}

// ---------------------------------------------------------------------------
// evidence-container snapshots (F-A4)
// ---------------------------------------------------------------------------

/** Plain immutable internal eligibility snapshot (descriptor values only).
 *  The original caller eligibility object is never read again after this
 *  snapshot is created. */
export interface SubjectCorrelationsSnapshot {
  /** Optional exact bundle-instance correlation (absent = not correlated). */
  readonly bundleInstance?: string;
}

/** Plain immutable internal eligibility snapshot. */
export interface EligibilitySnapshot {
  readonly eligible: boolean;
  readonly capability: string;
  readonly workspaceId: string;
  readonly subjectCorrelations: SubjectCorrelationsSnapshot;
}

/** Plain immutable internal requested-use snapshot. */
export interface RequestedUseSnapshot {
  readonly capability: string;
  readonly workspaceId: string;
}

/** Plain immutable internal registry-context snapshot (identity strings). */
export interface RegistryContextSnapshot {
  readonly registryProtocolId: string;
  readonly registrySnapshotFormatVersion: string;
  readonly registrySnapshotId: string;
  readonly registrySnapshotDigest: string;
}

const REGISTRY_STRING_FIELDS = ['registryProtocolId', 'registrySnapshotFormatVersion', 'registrySnapshotId', 'registrySnapshotDigest'] as const;
const REQUESTED_USE_STRING_FIELDS = ['capability', 'workspaceId'] as const;

export type EligibilitySnapshotResult =
  | { readonly ok: true; readonly snapshot: EligibilitySnapshot }
  | { readonly ok: false; readonly findings: readonly PiFinding[] };

export type RequestedUseSnapshotResult =
  | { readonly ok: true; readonly snapshot: RequestedUseSnapshot }
  | { readonly ok: false; readonly findings: readonly PiFinding[] };

export type RegistryContextSnapshotResult =
  | { readonly ok: true; readonly snapshot: RegistryContextSnapshot }
  | { readonly ok: false; readonly findings: readonly PiFinding[] };

/** Snapshot the eligibility report through own data descriptors: `eligible`
 *  must be a primitive boolean, `capability`/`workspaceId` primitive strings,
 *  and `subjectCorrelations` a plain object of string values whose optional
 *  `bundleInstance` is a primitive string. Accessor-bearing, inherited-only,
 *  or trap-throwing fields fail closed with `input.eligibility-malformed`;
 *  a missing/non-object container keeps `input.eligibility-missing`. Never
 *  invokes getters or Proxy `get` traps; never mutates input. */
export function readEligibilitySnapshot(value: unknown): EligibilitySnapshotResult {
  if (!isPlainRuntimeObject(value)) {
    return { ok: false, findings: Object.freeze([piFinding('PI-ADAPTER-INPUT-INVALID', 'input.eligibility-missing', 'point-of-use eligibility evidence is missing or malformed', '/eligibility')]) };
  }
  const findings: PiFinding[] = [];
  const eligible = readOwnDataValue(value, 'eligible');
  if (typeof eligible !== 'boolean') {
    findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'input.eligibility-malformed', 'eligibility field eligible must be a primitive boolean', '/eligibility/eligible'));
  }
  const capability = readOwnDataValue(value, 'capability');
  if (typeof capability !== 'string') {
    findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'input.eligibility-malformed', 'eligibility field capability must be a primitive string', '/eligibility/capability'));
  }
  const workspaceId = readOwnDataValue(value, 'workspaceId');
  if (typeof workspaceId !== 'string') {
    findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'input.eligibility-malformed', 'eligibility field workspaceId must be a primitive string', '/eligibility/workspaceId'));
  }
  const correlations = stringRecordSnapshot(readOwnDataValue(value, 'subjectCorrelations'));
  if (correlations === undefined) {
    findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'input.eligibility-malformed', 'eligibility field subjectCorrelations must be a plain object of string values', '/eligibility/subjectCorrelations'));
  }
  if (findings.length > 0) {
    return { ok: false, findings: Object.freeze(sortFindings(findings)) };
  }
  return {
    ok: true,
    snapshot: Object.freeze({
      eligible: eligible as boolean,
      capability: capability as string,
      workspaceId: workspaceId as string,
      subjectCorrelations: Object.freeze(correlations as Readonly<Record<string, string>>) as unknown as SubjectCorrelationsSnapshot,
    }),
  };
}

/** Snapshot an optional requested-use declaration through own data
 *  descriptors: `capability` and `workspaceId` must be primitive strings.
 *  Accessor-bearing, inherited-only, or trap-throwing fields fail closed
 *  with `input.requested-use-malformed`. Never invokes getters or Proxy
 *  `get` traps; never mutates input. */
export function readRequestedUseSnapshot(value: unknown): RequestedUseSnapshotResult {
  if (!isPlainRuntimeObject(value)) {
    return { ok: false, findings: Object.freeze([piFinding('PI-ADAPTER-INPUT-INVALID', 'input.requested-use-malformed', 'requested use is missing or malformed', '/requestedUse')]) };
  }
  const findings: PiFinding[] = [];
  for (const field of REQUESTED_USE_STRING_FIELDS) {
    const v = readOwnDataValue(value, field);
    if (typeof v !== 'string') {
      findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'input.requested-use-malformed', `requested use field ${field} must be a primitive string`, `/requestedUse/${field}`));
    }
  }
  if (findings.length > 0) {
    return { ok: false, findings: Object.freeze(sortFindings(findings)) };
  }
  return {
    ok: true,
    snapshot: Object.freeze({
      capability: readOwnDataValue(value, 'capability') as string,
      workspaceId: readOwnDataValue(value, 'workspaceId') as string,
    }),
  };
}

/** Snapshot the accepted registry context through own data descriptors: all
 *  four identity strings must be primitive strings. Accessor-bearing,
 *  inherited-only, or trap-throwing fields fail closed with
 *  `input.registry-malformed`; a missing/non-object container keeps
 *  `input.registry-missing`. The branded `snapshot` member is never read.
 *  Never invokes getters or Proxy `get` traps; never mutates input. */
export function readRegistryContextSnapshot(value: unknown): RegistryContextSnapshotResult {
  if (!isPlainRuntimeObject(value)) {
    return { ok: false, findings: Object.freeze([piFinding('PI-ADAPTER-INPUT-INVALID', 'input.registry-missing', 'accepted RegistrySnapshot context is missing', '/registry')]) };
  }
  const findings: PiFinding[] = [];
  const snapshot: Record<string, string> = {};
  for (const field of REGISTRY_STRING_FIELDS) {
    const v = readOwnDataValue(value, field);
    if (typeof v !== 'string') {
      findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'input.registry-malformed', `registry context field ${field} must be a primitive string`, `/registry/${field}`));
      continue;
    }
    snapshot[field] = v;
  }
  if (findings.length > 0) {
    return { ok: false, findings: Object.freeze(sortFindings(findings)) };
  }
  return { ok: true, snapshot: Object.freeze(snapshot) as unknown as RegistryContextSnapshot };
}

// ---------------------------------------------------------------------------
// context-item snapshot (A-3)
// ---------------------------------------------------------------------------

/** Plain immutable internal context-item snapshot. All fields come from own
 *  data descriptors; the original caller item is never read again. */
export interface ContextItemSnapshot {
  readonly contextId: string;
  readonly label: string;
  /** The primitive-string mediaType when valid; `''` when the caller value
   *  was not a primitive string (`mediaTypeNonString` carries the flag). */
  readonly mediaType: string;
  /** True when `mediaType` was present but not a primitive string. */
  readonly mediaTypeNonString: boolean;
  readonly text?: string;
  /** True when `text` was present but not a primitive string. */
  readonly textNonString: boolean;
  readonly bytes?: Uint8Array;
  readonly byteLength: number;
  readonly provenance: Readonly<Record<string, string>>;
  readonly truncated: boolean;
  readonly contentDigest?: string;
}

const REQUIRED_ITEM_FIELDS = ['contextId', 'label', 'mediaType', 'byteLength', 'provenance', 'truncated'] as const;
const OPTIONAL_ITEM_FIELDS = ['text', 'bytes', 'contentDigest'] as const;

export type ContextItemSnapshotResult =
  | { readonly ok: true; readonly snapshot: ContextItemSnapshot }
  | { readonly ok: false; readonly reason: string };
/**
 * Snapshot one context item through own data descriptors. Required fields
 * must be own data properties with the declared primitive shapes; optional
 * fields must be own data properties when present. The snapshot's values are
 * descriptor values only, so Proxy `get` traps and getters never execute and
 * later correlation/rendering never touches the original item.
 */
export function snapshotContextItem(item: unknown): ContextItemSnapshotResult {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return { ok: false, reason: 'context item is not a plain object' };
  }
  let proto: unknown;
  try {
    proto = Object.getPrototypeOf(item);
  } catch {
    return { ok: false, reason: 'context item prototype is not readable' };
  }
  if (proto !== Object.prototype && proto !== null) {
    return { ok: false, reason: 'context item is not a plain object' };
  }
  const obj = item as object;
  for (const field of REQUIRED_ITEM_FIELDS) {
    if (!hasOwnDataProperty(obj, field)) {
      return { ok: false, reason: `required field ${field} is missing, inherited-only, or an accessor` };
    }
  }
  for (const field of OPTIONAL_ITEM_FIELDS) {
    if (hasOwnDataProperty(obj, field)) continue;
    const desc = ownDescriptor(obj, field);
    if (desc !== undefined) {
      return { ok: false, reason: `optional field ${field} is inherited-only or an accessor` };
    }
  }

  const contextId = readOwnDataValue(obj, 'contextId');
  if (typeof contextId !== 'string') return { ok: false, reason: 'contextId must be a primitive string' };
  const label = readOwnDataValue(obj, 'label');
  if (typeof label !== 'string') return { ok: false, reason: 'label must be a primitive string' };
  // mediaType is snapshotted leniently: non-string values are classified by
  // correlation as `context.media-malformed` (R-1 contract), never coerced
  const mediaTypeValue = readOwnDataValue(obj, 'mediaType');
  const mediaType = typeof mediaTypeValue === 'string' ? mediaTypeValue : '';
  const mediaTypeNonString = mediaTypeValue !== undefined && typeof mediaTypeValue !== 'string';
  const byteLength = readOwnDataValue(obj, 'byteLength');
  if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 0) {
    return { ok: false, reason: 'byteLength must be a non-negative safe integer' };
  }
  const provenance = readStringRecordSnapshot(obj, 'provenance');
  if (provenance === undefined) return { ok: false, reason: 'provenance must be a plain object of string values' };
  const truncated = readOwnDataValue(obj, 'truncated');
  if (typeof truncated !== 'boolean') return { ok: false, reason: 'truncated must be a boolean' };

  const textValue = readOwnDataValue(obj, 'text');
  const text = typeof textValue === 'string' ? textValue : undefined;
  let textNonString = textValue !== undefined && text === undefined;
  if (textValue === undefined) {
    // snapshot round-trip: the flag is carried explicitly by the snapshot
    textNonString = readOwnDataValue(obj, 'textNonString') === true;
  }
  const bytesValue = readOwnDataValue(obj, 'bytes');
  // ArrayBuffer.isView is trap-free and false for proxies; instanceof then
  // only runs on genuine typed arrays
  const bytes = ArrayBuffer.isView(bytesValue) && bytesValue instanceof Uint8Array ? bytesValue : undefined;
  const digestValue = readOwnDataValue(obj, 'contentDigest');
  const contentDigest = typeof digestValue === 'string' ? digestValue : undefined;

  const snapshot: ContextItemSnapshot = Object.freeze({
    contextId,
    label,
    mediaType,
    mediaTypeNonString,
    ...(text !== undefined ? { text } : {}),
    textNonString,
    ...(bytes !== undefined ? { bytes } : {}),
    byteLength,
    provenance,
    truncated,
    ...(contentDigest !== undefined ? { contentDigest } : {}),
  });
  return { ok: true, snapshot };
}

/**
 * Lenient per-field descriptor read for the standalone public renderer
 * (F-2 contract): the item is never rejected for non-string field values;
 * accessor-bearing fields read as absent (the accessor is never invoked);
 * the renderer applies fixed placeholders. Returns null only for non-object,
 * array, or prototype-hostile items.
 */
export interface RenderItemFields {
  readonly contextId: unknown;
  readonly label: unknown;
  readonly mediaType: unknown;
  readonly text: unknown;
  readonly bytes: unknown;
  readonly byteLength: unknown;
  readonly truncated: unknown;
  readonly contentDigest: unknown;
}

export function readRenderItemFields(item: unknown): RenderItemFields | null {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
  let proto: unknown;
  try {
    proto = Object.getPrototypeOf(item);
  } catch {
    return null;
  }
  if (proto !== Object.prototype && proto !== null) return null;
  const obj = item as object;
  const read = (field: string): unknown => {
    const desc = ownDescriptor(obj, field);
    if (desc === undefined || desc.get !== undefined || desc.set !== undefined) return undefined;
    return desc.value;
  };
  return {
    contextId: read('contextId'),
    label: read('label'),
    mediaType: read('mediaType'),
    text: read('text'),
    bytes: read('bytes'),
    byteLength: read('byteLength'),
    truncated: read('truncated'),
    contentDigest: read('contentDigest'),
  };
}

export interface SnapshotItemsArrayResult {
  readonly ok: boolean;
  /** Plain frozen array of valid item snapshots (malformed entries omitted). */
  readonly snapshots: readonly ContextItemSnapshot[];
  /** Malformed entry positions and reasons, in index order. */
  readonly malformed: readonly { readonly index: number; readonly reason: string }[];
}

/** Snapshot a context-items array through per-index descriptors (trap-safe
 *  length and element reads; sparse holes are rejected as malformed). */
export function snapshotContextItemsArray(items: unknown): SnapshotItemsArrayResult {
  if (!Array.isArray(items)) {
    return { ok: false, snapshots: [], malformed: [] };
  }
  const lengthDesc = ownDescriptor(items, 'length');
  if (lengthDesc === undefined || lengthDesc.get !== undefined || lengthDesc.set !== undefined) {
    return { ok: false, snapshots: [], malformed: [] };
  }
  const length = lengthDesc.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
    return { ok: false, snapshots: [], malformed: [] };
  }
  const snapshots: ContextItemSnapshot[] = [];
  const malformed: { index: number; reason: string }[] = [];
  for (let index = 0; index < length; index++) {
    const desc = ownDescriptor(items, index);
    const entry = desc === undefined ? undefined : desc.value;
    const snap = snapshotContextItem(entry);
    if (!snap.ok) {
      malformed.push({ index, reason: snap.reason });
      continue;
    }
    snapshots.push(snap.snapshot);
  }
  return { ok: true, snapshots: Object.freeze(snapshots), malformed: Object.freeze(malformed) };
}

// ---------------------------------------------------------------------------
// top-level projection gate (F-1)
// ---------------------------------------------------------------------------

export interface ProjectionShapeGate {
  readonly findings: readonly PiFinding[];
  /** Descriptor snapshot of every top-level input field (missing fields are
   *  undefined). Downstream code reads only from this snapshot. */
  readonly fields: Readonly<Record<string, unknown>>;
  /** Present only when the capability container passed the descriptor gate. */
  readonly capability?: CapabilitySnapshot;
  /** Present only when limits passed the descriptor gate. */
  readonly limits?: LimitsSnapshot;
  /** Present only when contextItems was an array; malformed entries are
   *  reported in findings and omitted. */
  readonly contextItems?: readonly ContextItemSnapshot[];
  /** Present only when the eligibility container passed the descriptor gate. */
  readonly eligibility?: EligibilitySnapshot;
  /** Present only when a requested-use declaration was supplied and passed. */
  readonly requestedUse?: RequestedUseSnapshot;
  /** Present only when the registry container passed the descriptor gate. */
  readonly registry?: RegistryContextSnapshot;
}

/** All top-level projection input fields read through own data descriptors. */
const INPUT_FIELDS = [
  'bundle',
  'taskSpec',
  'authorityPolicy',
  'contextManifest',
  'completionContract',
  'eligibility',
  'registry',
  'occurrenceId',
  'attemptId',
  'requestedUse',
  'capability',
  'limits',
  'contextItems',
] as const;

/**
 * Validate the top-level projection input shapes before any dereference.
 * Returns deterministic, ordered, stable findings plus descriptor snapshots
 * for every input field, the capability container, limits, and context
 * items; never throws; never invokes caller hooks; never mutates input.
 * After this gate the projection and all downstream modules read only from
 * the snapshots.
 */
export function validateProjectionInputShapes(input: unknown): ProjectionShapeGate {
  if (!isPlainRuntimeObject(input)) {
    return { findings: Object.freeze([piFinding('PI-ADAPTER-INPUT-INVALID', 'input.invalid', 'projection input is missing or malformed')]), fields: Object.freeze({}) };
  }
  const findings: PiFinding[] = [];

  // every top-level field is read once through its own data descriptor
  const fields: Record<string, unknown> = {};
  for (const field of INPUT_FIELDS) {
    fields[field] = readOwnDataValue(input, field);
  }
  const inputFields = Object.freeze(fields);

  // capability: full descriptor snapshot
  const capabilityResult = readCapabilitySnapshot(inputFields['capability']);
  if (!capabilityResult.ok) {
    findings.push(...capabilityResult.findings);
  }

  // limits: full descriptor snapshot (missing vs malformed distinguished so
  // the F-1 finding contract is unchanged)
  const limitsResult = readLimitsSnapshot(inputFields['limits']);
  if (!limitsResult.ok) {
    findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', limitsResult.reason === 'missing' ? 'input.limits-missing' : 'input.limits-malformed', 'adapter limits are missing or malformed', '/limits'));
  }

  // occurrence / attempt identity (caller-supplied; never generated)
  const occurrence = inputFields['occurrenceId'];
  if (typeof occurrence !== 'string' || occurrence === '') {
    findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'input.occurrence-missing', 'execution occurrence ID is missing', '/occurrenceId'));
  }
  const attempt = inputFields['attemptId'];
  if (typeof attempt !== 'string' || attempt === '') {
    findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'input.attempt-missing', 'execution attempt ID is missing', '/attemptId'));
  }

  // context items: descriptor snapshots per entry (sparse-array holes are
  // visited and rejected; length and element reads are trap-free)
  let itemSnapshots: ContextItemSnapshot[] | undefined;
  const itemsValue = inputFields['contextItems'];
  const itemsResult = snapshotContextItemsArray(itemsValue);
  if (!itemsResult.ok) {
    findings.push(piFinding('PI-ADAPTER-CONTEXT-MISMATCH', 'context.items-missing', 'resolved context items are missing', '/contextItems'));
  } else {
    itemSnapshots = [...itemsResult.snapshots];
    for (const { index, reason } of itemsResult.malformed) {
      findings.push(piFinding('PI-ADAPTER-CONTEXT-MISMATCH', 'context.item-malformed', `context item at index ${index} is malformed: ${reason}`, `/contextItems/${index}`));
    }
  }

  // eligibility: full descriptor snapshot (container + nested
  // subjectCorrelations); malformed fields fail closed (F-A4)
  let eligibilitySnap: EligibilitySnapshot | undefined;
  const eligibilityResult = readEligibilitySnapshot(inputFields['eligibility']);
  if (!eligibilityResult.ok) {
    findings.push(...eligibilityResult.findings);
  } else {
    eligibilitySnap = eligibilityResult.snapshot;
  }

  // requested use (optional): full descriptor snapshot (F-A4)
  let requestedUseSnap: RequestedUseSnapshot | undefined;
  if (inputFields['requestedUse'] !== undefined) {
    const requestedUseResult = readRequestedUseSnapshot(inputFields['requestedUse']);
    if (!requestedUseResult.ok) {
      findings.push(...requestedUseResult.findings);
    } else {
      requestedUseSnap = requestedUseResult.snapshot;
    }
  }

  // registry context: full descriptor snapshot (F-A4)
  let registrySnap: RegistryContextSnapshot | undefined;
  const registryResult = readRegistryContextSnapshot(inputFields['registry']);
  if (!registryResult.ok) {
    findings.push(...registryResult.findings);
  } else {
    registrySnap = registryResult.snapshot;
  }

  const sorted = sortFindings(findings);
  return {
    findings: Object.freeze(sorted),
    fields: inputFields,
    ...(capabilityResult.ok ? { capability: capabilityResult.snapshot } : {}),
    ...(limitsResult.ok ? { limits: limitsResult.snapshot } : {}),
    ...(itemSnapshots !== undefined ? { contextItems: Object.freeze(itemSnapshots) } : {}),
    ...(eligibilitySnap !== undefined ? { eligibility: eligibilitySnap } : {}),
    ...(requestedUseSnap !== undefined ? { requestedUse: requestedUseSnap } : {}),
    ...(registrySnap !== undefined ? { registry: registrySnap } : {}),
  };
}
