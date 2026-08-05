/**
 * WP-6 Phase 3A: exact-own detached capture of the nested v1/v2 input records
 * (contract Sections 5, 6, 8, 11). All protocol data is captured through own
 * enumerable data descriptors; inherited fields, accessors (without
 * invocation), symbols, non-enumerable fields, unknown fields, missing
 * descriptors, structural traps, and revoked Proxies fail closed. The captured
 * values are detached before any equality check or later use; the original
 * records are never reread and mutation after capture has no effect.
 *
 * Version diagnostics (contract Section 11 precedence): structural envelope
 * failure precedes inner-version-missing, which precedes
 * inner-version-mismatch; workspace capture failures follow version
 * validation. Consumer set-like arrays are canonicalized (sorted) with
 * duplicates rejected for v2; v1 preserves order and tolerates duplicates
 * (v1 semantics).
 */
import { snapshotJson, isBrandedRegistry } from '../internal/snapshot.js';
import { compareStrings } from '../trusted/ordering.js';
import type { ValidatedRegistrySnapshot } from '../api/types.js';
import { captureBareModel } from './model-capture.js';
import { snapshotLifecycleRecords, createDetachedFindRecord } from './lifecycle-snapshot.js';
import {
  createIdentityViewAdapter,
  createResolverViewAdapter,
  createRevocationsViewAdapter,
} from './view-capture.js';
import type {
  ConsumerSupportProjection,
  DetachedConsumerSupportV1,
  DetachedLifecycleView,
  DetachedRegistryContext,
  DetachedV1Input,
  DetachedV2Input,
  RequestedUseProjection,
  StaticGrantProjection,
} from './router-types.js';

// ---------------------------------------------------------------------------
// exact-own field extraction
// ---------------------------------------------------------------------------

type ExactFieldExtractionCode = 'structure' | 'symbols' | 'traps' | 'missing' | 'accessor' | 'non-enumerable';

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  try {
    return !Array.isArray(value);
  } catch {
    // A revoked Proxy cannot be structurally classified: fail closed.
    return false;
  }
}

/**
 * Extract every field of a record exactly once through own property
 * descriptors. The own-key set must be exactly `requiredKeys` plus any subset
 * of `optionalKeys`. Never reads through ordinary property access (zero Proxy
 * `get`; zero getter invocation).
 */
function extractExactOwnFields(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): { readonly ok: true; readonly fields: Readonly<Record<string, unknown>> } | { readonly ok: false; readonly code: ExactFieldExtractionCode } {
  if (!isRecord(value)) return { ok: false, code: 'structure' };
  let keys: string[];
  let symbols: symbol[];
  try {
    keys = Object.getOwnPropertyNames(value);
    symbols = Object.getOwnPropertySymbols(value);
  } catch {
    return { ok: false, code: 'traps' };
  }
  if (symbols.length > 0) return { ok: false, code: 'symbols' };
  const expected = new Set([...requiredKeys, ...optionalKeys]);
  if (keys.length < requiredKeys.length) return { ok: false, code: 'structure' };
  for (const key of keys) {
    if (!expected.has(key)) return { ok: false, code: 'structure' };
  }
  for (const key of requiredKeys) {
    if (!keys.includes(key)) return { ok: false, code: 'structure' };
  }
  const fields: Record<string, unknown> = {};
  for (const key of keys) {
    let desc: PropertyDescriptor | undefined;
    try {
      desc = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return { ok: false, code: 'traps' };
    }
    if (desc === undefined) return { ok: false, code: 'missing' };
    if (desc.get !== undefined || desc.set !== undefined) return { ok: false, code: 'accessor' };
    if (!desc.enumerable) return { ok: false, code: 'non-enumerable' };
    fields[key] = desc.value;
  }
  return { ok: true, fields: Object.freeze(fields) };
}

// ---------------------------------------------------------------------------
// nested record capture helpers
// ---------------------------------------------------------------------------

const REQUESTED_USE_REQUIRED = ['capability', 'operationClass', 'resourceClass', 'scope', 'workspaceId'];
const REQUESTED_USE_OPTIONAL = ['capabilityVersion'];

function captureRequestedUse(
  value: unknown,
): { readonly ok: true; readonly requestedUse: RequestedUseProjection } | { readonly ok: false; readonly code: 'structure' | 'workspace' } {
  const extracted = extractExactOwnFields(value, REQUESTED_USE_REQUIRED, REQUESTED_USE_OPTIONAL);
  if (!extracted.ok) return { ok: false, code: 'structure' };
  const f = extracted.fields;
  if (typeof f['workspaceId'] !== 'string') return { ok: false, code: 'workspace' };
  for (const key of ['capability', 'operationClass', 'resourceClass', 'scope']) {
    if (typeof f[key] !== 'string') return { ok: false, code: 'structure' };
  }
  if (f['capabilityVersion'] !== undefined && typeof f['capabilityVersion'] !== 'string') {
    return { ok: false, code: 'structure' };
  }
  const requestedUse: RequestedUseProjection = Object.freeze({
    capability: f['capability'] as string,
    ...(f['capabilityVersion'] !== undefined ? { capabilityVersion: f['capabilityVersion'] as string } : {}),
    operationClass: f['operationClass'] as string,
    resourceClass: f['resourceClass'] as string,
    scope: f['scope'] as string,
    workspaceId: f['workspaceId'] as string,
  });
  return { ok: true, requestedUse };
}

/** Descriptor-safe capture of a string array; returns a frozen copy in captured order. */
function captureStringList(value: unknown): readonly string[] | undefined {
  let captured: unknown;
  try {
    captured = snapshotJson(value, '$');
  } catch {
    return undefined;
  }
  if (!Array.isArray(captured)) return undefined;
  const out: string[] = [];
  for (const item of captured) {
    if (typeof item !== 'string') return undefined;
    out.push(item);
  }
  return Object.freeze(out);
}

/** Canonical set capture: descriptor-safe, sorted, duplicates fail closed. */
function canonicalizeStringSet(value: unknown): readonly string[] | undefined {
  let captured: unknown;
  try {
    captured = snapshotJson(value, '$');
  } catch {
    return undefined;
  }
  if (!Array.isArray(captured)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of captured) {
    if (typeof item !== 'string') return undefined;
    if (seen.has(item)) return undefined; // duplicates fail closed
    seen.add(item);
    out.push(item);
  }
  out.sort(compareStrings);
  return Object.freeze(out);
}

const CONSUMER_REQUIRED = ['consumerId', 'supportedProtocolFeatures', 'supportedConsumerCapabilities', 'supportedExtensionNamespaces'];

function captureConsumerSupportV2(value: unknown): { readonly ok: true; readonly consumerSupport: ConsumerSupportProjection } | { readonly ok: false } {
  const extracted = extractExactOwnFields(value, CONSUMER_REQUIRED);
  if (!extracted.ok) return { ok: false };
  const f = extracted.fields;
  if (typeof f['consumerId'] !== 'string') return { ok: false };
  const features = canonicalizeStringSet(f['supportedProtocolFeatures']);
  const capabilities = canonicalizeStringSet(f['supportedConsumerCapabilities']);
  const namespaces = canonicalizeStringSet(f['supportedExtensionNamespaces']);
  if (features === undefined || capabilities === undefined || namespaces === undefined) return { ok: false };
  return {
    ok: true,
    consumerSupport: Object.freeze({
      consumerId: f['consumerId'] as string,
      supportedProtocolFeatures: features,
      supportedConsumerCapabilities: capabilities,
      supportedExtensionNamespaces: namespaces,
    }),
  };
}

function captureConsumerSupportV1(value: unknown): { readonly ok: true; readonly consumerSupport: DetachedConsumerSupportV1 } | { readonly ok: false } {
  const extracted = extractExactOwnFields(value, CONSUMER_REQUIRED);
  if (!extracted.ok) return { ok: false };
  const f = extracted.fields;
  if (typeof f['consumerId'] !== 'string') return { ok: false };
  const features = captureStringList(f['supportedProtocolFeatures']);
  const capabilities = captureStringList(f['supportedConsumerCapabilities']);
  const namespaces = captureStringList(f['supportedExtensionNamespaces']);
  if (features === undefined || capabilities === undefined || namespaces === undefined) return { ok: false };
  return {
    ok: true,
    consumerSupport: Object.freeze({
      consumerId: f['consumerId'] as string,
      supportedProtocolFeatures: features,
      supportedConsumerCapabilities: capabilities,
      supportedExtensionNamespaces: namespaces,
    }),
  };
}

const REGISTRY_REQUIRED = ['registryProtocolId', 'registrySnapshotFormatVersion', 'registrySnapshotId', 'registrySnapshotDigest', 'snapshot'];

function captureRegistryContext(
  value: unknown,
): { readonly ok: true; readonly registry: DetachedRegistryContext } | { readonly ok: false; readonly code: 'structure' | 'brand' } {
  const extracted = extractExactOwnFields(value, REGISTRY_REQUIRED);
  if (!extracted.ok) return { ok: false, code: 'structure' };
  const f = extracted.fields;
  for (const key of ['registryProtocolId', 'registrySnapshotFormatVersion', 'registrySnapshotId', 'registrySnapshotDigest']) {
    if (typeof f[key] !== 'string') return { ok: false, code: 'structure' };
  }
  const snapshot = f['snapshot'];
  if (snapshot === null || typeof snapshot !== 'object' || !isBrandedRegistry(snapshot)) {
    return { ok: false, code: 'brand' };
  }
  return {
    ok: true,
    registry: Object.freeze({
      registryProtocolId: f['registryProtocolId'] as string,
      registrySnapshotFormatVersion: f['registrySnapshotFormatVersion'] as string,
      registrySnapshotId: f['registrySnapshotId'] as string,
      registrySnapshotDigest: f['registrySnapshotDigest'] as string,
      snapshot: snapshot as ValidatedRegistrySnapshot,
    }),
  };
}

// The lifecycle view's only DATA member used by v2 is `records`; the callable
// `findRecord` key is tolerated (own enumerable data descriptor required if
// present) but its value is never extracted or consulted: the deterministic
// lookup built from the frozen snapshot is the sole semantic source.
const LIFECYCLE_REQUIRED = ['records'];
const LIFECYCLE_OPTIONAL = ['findRecord'];

function captureLifecycleView(
  value: unknown,
): { readonly ok: true; readonly lifecycle: DetachedLifecycleView } | { readonly ok: false; readonly code: 'structure' | 'snapshot' | 'brand' } {
  const extracted = extractExactOwnFields(value, LIFECYCLE_REQUIRED, LIFECYCLE_OPTIONAL);
  if (!extracted.ok) return { ok: false, code: 'structure' };
  const snap = snapshotLifecycleRecords(extracted.fields['records']);
  if (!snap.ok) return { ok: false, code: snap.code === 'record-brand' ? 'brand' : 'snapshot' };
  return {
    ok: true,
    lifecycle: Object.freeze({
      records: snap.snapshot.records,
      lookup: snap.snapshot.lookup,
      findRecord: createDetachedFindRecord(snap.snapshot.lookup),
    }),
  };
}

// ---------------------------------------------------------------------------
// v2 input capture
// ---------------------------------------------------------------------------

export type V2InputCaptureFailureCode =
  | 'inner-version-missing'
  | 'inner-version-mismatch'
  | 'nested-capture'
  | 'workspace-capture'
  | 'view-adaptation'
  | 'lifecycle-snapshot'
  | 'operand-brand'
  | 'model-capture';

export type V2InputCaptureResult =
  | { readonly ok: true; readonly input: DetachedV2Input }
  | { readonly ok: false; readonly code: V2InputCaptureFailureCode };

const V2_REQUIRED = [
  'pointOfUseInputsProtocolVersion',
  'workspaceId',
  'requestedUse',
  'currentTime',
  'consumerSupport',
  'identity',
  'resolver',
  'registry',
  'lifecycle',
  'revocations',
  'bundle',
  'policy',
];
const V2_OPTIONAL = ['grant'];

const V2_INNER_VERSION_LITERAL = '2';

/**
 * Capture the nested v2 input record into one detached frozen internal record.
 * Deterministic failure precedence: structural envelope failure (nested-capture)
 * → inner-version-missing → inner-version-mismatch → exact-own key-set and
 * field capture (nested-capture) → workspace capture → per-operand capture.
 */
export function captureV2Input(value: unknown): V2InputCaptureResult {
  // 1. Structural envelope (record; symbols; traps).
  if (!isRecord(value)) return { ok: false, code: 'nested-capture' };
  let symbols: symbol[];
  try {
    symbols = Object.getOwnPropertySymbols(value);
  } catch {
    return { ok: false, code: 'nested-capture' };
  }
  if (symbols.length > 0) return { ok: false, code: 'nested-capture' };

  // 2. Inner version: presence and exact literal, through the own descriptor.
  let versionDesc: PropertyDescriptor | undefined;
  try {
    versionDesc = Object.getOwnPropertyDescriptor(value, 'pointOfUseInputsProtocolVersion');
  } catch {
    return { ok: false, code: 'nested-capture' };
  }
  if (versionDesc === undefined) return { ok: false, code: 'inner-version-missing' };
  if (versionDesc.get !== undefined || versionDesc.set !== undefined || !versionDesc.enumerable) {
    return { ok: false, code: 'inner-version-mismatch' };
  }
  if (versionDesc.value !== V2_INNER_VERSION_LITERAL) return { ok: false, code: 'inner-version-mismatch' };

  // 3. Exact own-key set and one-pass field extraction.
  const extracted = extractExactOwnFields(value, V2_REQUIRED, V2_OPTIONAL);
  if (!extracted.ok) return { ok: false, code: 'nested-capture' };
  const f = extracted.fields;

  // 4. Workspace capture (own data descriptor already enforced; type check).
  const workspaceId = f['workspaceId'];
  if (typeof workspaceId !== 'string') return { ok: false, code: 'workspace-capture' };

  // 5. Requested use (its workspaceId is captured exact-own as well).
  const requestedUse = captureRequestedUse(f['requestedUse']);
  if (!requestedUse.ok) {
    return { ok: false, code: requestedUse.code === 'workspace' ? 'workspace-capture' : 'nested-capture' };
  }

  // 6. Current time.
  if (typeof f['currentTime'] !== 'string') return { ok: false, code: 'nested-capture' };

  // 7. Consumer support (canonical sorted sets; duplicates fail closed).
  const consumer = captureConsumerSupportV2(f['consumerSupport']);
  if (!consumer.ok) return { ok: false, code: 'nested-capture' };

  // 8. Registry context (scalars detached; snapshot brand-checked).
  const registry = captureRegistryContext(f['registry']);
  if (!registry.ok) return { ok: false, code: registry.code === 'brand' ? 'operand-brand' : 'nested-capture' };

  // 9. Lifecycle snapshot (frozen wrapper references; duplicate IDs fail closed).
  const lifecycle = captureLifecycleView(f['lifecycle']);
  if (!lifecycle.ok) {
    return { ok: false, code: lifecycle.code === 'brand' ? 'operand-brand' : lifecycle.code === 'snapshot' ? 'lifecycle-snapshot' : 'nested-capture' };
  }

  // 10. Callable-view adapters (receiver-bound; zero getter / zero Proxy get).
  const identity = createIdentityViewAdapter(f['identity']);
  if (!identity.ok) return { ok: false, code: 'view-adaptation' };
  const resolver = createResolverViewAdapter(f['resolver']);
  if (!resolver.ok) return { ok: false, code: 'view-adaptation' };
  const revocations = createRevocationsViewAdapter(f['revocations']);
  if (!revocations.ok) return { ok: false, code: 'view-adaptation' };

  // 11. Bare-model capture (bundle, policy, grant).
  const bundle = captureBareModel(f['bundle']);
  if (!bundle.ok) return { ok: false, code: 'model-capture' };
  const policy = captureBareModel(f['policy']);
  if (!policy.ok) return { ok: false, code: 'model-capture' };
  let grant: StaticGrantProjection = { state: 'absent' };
  if (f['grant'] !== undefined) {
    const capturedGrant = captureBareModel(f['grant']);
    if (!capturedGrant.ok) return { ok: false, code: 'model-capture' };
    grant = { state: 'present', capturedModel: capturedGrant.model };
  }

  // 12. Detached frozen input record.
  const input: DetachedV2Input = Object.freeze({
    pointOfUseInputsProtocolVersion: '2',
    workspaceId: workspaceId as string,
    requestedUse: requestedUse.requestedUse,
    currentTime: f['currentTime'] as string,
    consumerSupport: consumer.consumerSupport,
    identity: identity.adapter,
    resolver: resolver.adapter,
    registry: registry.registry,
    lifecycle: lifecycle.lifecycle,
    revocations: revocations.adapter,
    bundle: bundle.model,
    policy: policy.model,
    grant,
  });
  return { ok: true, input };
}

// ---------------------------------------------------------------------------
// v1 input capture (detached; internal and separate from the unchanged public
// legacy entry)
// ---------------------------------------------------------------------------

export type V1InputCaptureFailureCode =
  | 'nested-capture'
  | 'workspace-capture'
  | 'view-adaptation'
  | 'lifecycle-snapshot'
  | 'operand-brand'
  | 'model-capture';

export type V1InputCaptureResult =
  | { readonly ok: true; readonly input: DetachedV1Input }
  | { readonly ok: false; readonly code: V1InputCaptureFailureCode };

const V1_REQUIRED = [
  'currentTime',
  'workspaceId',
  'requestedUse',
  'consumerSupport',
  'identity',
  'resolver',
  'registry',
  'lifecycle',
  'revocations',
  'bundle',
  'policy',
];
const V1_OPTIONAL = ['grant', 'globalActionCeiling', 'workspaceActionCeiling'];

/**
 * Capture the nested v1 input record into one detached frozen internal record,
 * preserving valid-v1 semantic results for plain records. The direct public
 * legacy entry is unchanged; this helper is the authoritative router's future
 * detached v1 path (contract Section 3). v1 consumer arrays preserve order and
 * tolerate duplicates (v1 semantics); present numeric ceilings must be numbers.
 */
export function captureV1Input(value: unknown): V1InputCaptureResult {
  const extracted = extractExactOwnFields(value, V1_REQUIRED, V1_OPTIONAL);
  if (!extracted.ok) return { ok: false, code: 'nested-capture' };
  const f = extracted.fields;

  const workspaceId = f['workspaceId'];
  if (typeof workspaceId !== 'string') return { ok: false, code: 'workspace-capture' };

  const requestedUse = captureRequestedUse(f['requestedUse']);
  if (!requestedUse.ok) {
    return { ok: false, code: requestedUse.code === 'workspace' ? 'workspace-capture' : 'nested-capture' };
  }
  if (typeof f['currentTime'] !== 'string') return { ok: false, code: 'nested-capture' };

  const consumer = captureConsumerSupportV1(f['consumerSupport']);
  if (!consumer.ok) return { ok: false, code: 'nested-capture' };

  const registry = captureRegistryContext(f['registry']);
  if (!registry.ok) return { ok: false, code: registry.code === 'brand' ? 'operand-brand' : 'nested-capture' };

  const lifecycle = captureLifecycleView(f['lifecycle']);
  if (!lifecycle.ok) {
    return { ok: false, code: lifecycle.code === 'brand' ? 'operand-brand' : lifecycle.code === 'snapshot' ? 'lifecycle-snapshot' : 'nested-capture' };
  }

  const identity = createIdentityViewAdapter(f['identity']);
  if (!identity.ok) return { ok: false, code: 'view-adaptation' };
  const resolver = createResolverViewAdapter(f['resolver']);
  if (!resolver.ok) return { ok: false, code: 'view-adaptation' };
  const revocations = createRevocationsViewAdapter(f['revocations']);
  if (!revocations.ok) return { ok: false, code: 'view-adaptation' };

  const bundle = captureBareModel(f['bundle']);
  if (!bundle.ok) return { ok: false, code: 'model-capture' };
  const policy = captureBareModel(f['policy']);
  if (!policy.ok) return { ok: false, code: 'model-capture' };

  let grant: StaticGrantProjection = { state: 'absent' };
  if (f['grant'] !== undefined) {
    const capturedGrant = captureBareModel(f['grant']);
    if (!capturedGrant.ok) return { ok: false, code: 'model-capture' };
    grant = { state: 'present', capturedModel: capturedGrant.model };
  }

  const globalActionCeiling = f['globalActionCeiling'];
  const workspaceActionCeiling = f['workspaceActionCeiling'];
  if (globalActionCeiling !== undefined && typeof globalActionCeiling !== 'number') return { ok: false, code: 'nested-capture' };
  if (workspaceActionCeiling !== undefined && typeof workspaceActionCeiling !== 'number') return { ok: false, code: 'nested-capture' };

  const input: DetachedV1Input = Object.freeze({
    currentTime: f['currentTime'] as string,
    workspaceId: workspaceId as string,
    requestedUse: requestedUse.requestedUse,
    ...(globalActionCeiling !== undefined ? { globalActionCeiling: globalActionCeiling as number } : {}),
    ...(workspaceActionCeiling !== undefined ? { workspaceActionCeiling: workspaceActionCeiling as number } : {}),
    consumerSupport: consumer.consumerSupport,
    identity: identity.adapter,
    resolver: resolver.adapter,
    registry: registry.registry,
    lifecycle: lifecycle.lifecycle,
    revocations: revocations.adapter,
    bundle: bundle.model,
    policy: policy.model,
    grant,
  });
  return { ok: true, input };
}

/**
 * Workspace equality helper operating only on detached values (contract
 * Section 8): the input workspace and the requested-use workspace must match;
 * routing, `requiresV2`, and evaluation all consume the same captured values.
 */
export function detachedWorkspacesEqual(inputWorkspaceId: string, requestedUseWorkspaceId: string): boolean {
  return inputWorkspaceId === requestedUseWorkspaceId;
}
