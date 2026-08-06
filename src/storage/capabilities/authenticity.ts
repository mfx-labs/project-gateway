/**
 * WP-8-C initialization capability authenticity (ADR-028 decision C,
 * W8C-D03/D11; CAP-001…007/010…016 for the initialization kind).
 *
 * One private authenticity domain: `InitializationCapability`. The module is
 * one of the two exact brand-bearing modules in WP-8-C (the other is
 * `src/storage/trusted-input/bootstrap-input.ts`); `new WeakSet` is granted
 * only to these two paths by the static guard.
 *
 * The creator `createInitializationCapability` is imported only by
 * `src/storage/initialization/initialize.ts` (static-guard enforced) and is
 * NOT exported from the private storage barrel, `src/index.ts`, package
 * exports, or any local re-export barrel. Importing this module confers no
 * issuance authority: the genuine branded `TrustedStorageBootstrapInput`
 * operand is mandatory.
 *
 * The capability binds only pre-initialization facts (W8C-D03/D11):
 * trusted-parent descriptor identity, fixed namespace derivations, trusted
 * configuration identity, configured service UID, limit-profile identity,
 * operation set `{namespace-initialize}`, private generation identity, and
 * live/disposed state. The genuine action identity derives from the verified
 * action-provenance operand already bound into the trusted input; it is
 * never accepted as a separate or structurally assumed value.
 *
 * Namespace identities and StoreMetadata digests are initialization
 * results, never retroactive capability bindings. No issuance path exists
 * for write, read, verify, recovery, retention, or migration.
 */
import { isGenuineTrustedStorageBootstrapInput, isGenuineTrustedWriteRequest, type TrustedStorageBootstrapInput, type TrustedWriteRequest } from '../trusted-input/bootstrap-input.js';
import type { RootIdentity, VerifiedStoreInstance } from '../types.js';

export const INITIALIZATION_OPERATION_SET = ['namespace-initialize', 'provision-phase3'] as const;
export type InitializationOperation = (typeof INITIALIZATION_OPERATION_SET)[number];

export const WRITE_OPERATION_SET = ['record-publish'] as const;
export type WriteCapabilityOperation = (typeof WRITE_OPERATION_SET)[number];

export const READ_OPERATION_SET = ['read-record', 'enumerate-class'] as const;
export type ReadCapabilityOperation = (typeof READ_OPERATION_SET)[number];

export const VERIFY_OPERATION_SET = ['verify-record'] as const;
export type VerifyCapabilityOperation = (typeof VERIFY_OPERATION_SET)[number];

/** Fixed namespace derivations bound at creation (LAY-001/DS-19). */
export interface NamespaceDerivationBinding {
  readonly configNamespace: 'config-v1';
  readonly storeNamespace: 'store-v1';
}

/** Pre-initialization facts bound into the capability. */
export interface InitializationCapabilityBinding {
  readonly parentIdentity: RootIdentity;
  readonly namespaceDerivations: NamespaceDerivationBinding;
  readonly configurationIdentity: string;
  readonly serviceUid: number;
  readonly limitProfile: Readonly<Record<string, number>>;
  readonly actionIdentity: string;
  readonly operationSet: readonly InitializationOperation[];
  /** Private in-process generation identity; never persisted or serialized. */
  readonly generation: object;
}

export type CapabilityRejectionReason =
  | 'not-genuine'
  | 'disposed'
  | 'wrong-operation'
  | 'stale-generation'
  | 'wrong-parent-identity'
  | 'wrong-configuration'
  | 'wrong-service-uid'
  | 'wrong-limit-profile'
  | 'wrong-namespace-derivation'
  | 'wrong-store-instance';

export interface CapabilityCheck {
  readonly ok: boolean;
  readonly reason?: CapabilityRejectionReason;
}

/** Opaque in-process initialization capability (never serializable). */
export interface InitializationCapability {
  /** Informational frozen binding; carries no brand state. */
  readonly binding: InitializationCapabilityBinding;
  /**
   * Revalidates the private brand, lifetime, generation, and operation set.
   * Callable at every contract-defined mutation boundary while live.
   */
  verify(operation: InitializationOperation): CapabilityCheck;
  /** Rejects when the current store/configuration context no longer matches the binding. */
  assertExpected(expected: {
    readonly parentIdentity: RootIdentity;
    readonly configurationIdentity: string;
    readonly serviceUid: number;
    readonly limitProfile: Readonly<Record<string, number>>;
  }): CapabilityCheck;
  /** Disposes the capability; every later use fails closed. Idempotent. */
  dispose(): void;
}

/**
 * Write-capability binding (ADR-029 D-5): store instance from verified
 * StoreMetadata, correlated configuration and limit profile, genuine action
 * identity from the verified write-action provenance, generation, and
 * lifetime.
 */
export interface WriteCapabilityBinding {
  readonly storeInstance: VerifiedStoreInstance;
  readonly configurationIdentity: string;
  readonly serviceUid: number;
  readonly limitProfile: Readonly<Record<string, number>>;
  readonly actionIdentity: string;
  readonly operationSet: readonly WriteCapabilityOperation[];
  /** Private in-process generation identity; never persisted or serialized. */
  readonly generation: object;
}

/** Opaque in-process authorized-write capability (never serializable). */
export interface WriteCapability {
  /** Informational frozen binding; carries no brand state. */
  readonly binding: WriteCapabilityBinding;
  verify(operation: WriteCapabilityOperation): CapabilityCheck;
  assertExpected(expected: {
    readonly storeInstance: VerifiedStoreInstance;
    readonly configurationIdentity: string;
    readonly serviceUid: number;
    readonly limitProfile: Readonly<Record<string, number>>;
  }): CapabilityCheck;
  dispose(): void;
}

/** Read-capability binding (non-mutating; CAP-001/API-003). */
export interface ReadCapabilityBinding {
  readonly storeInstance: VerifiedStoreInstance;
  readonly configurationIdentity: string;
  readonly serviceUid: number;
  readonly limitProfile: Readonly<Record<string, number>>;
  readonly operationSet: readonly ReadCapabilityOperation[];
  readonly generation: object;
}

export interface ReadCapability {
  readonly binding: ReadCapabilityBinding;
  verify(operation: ReadCapabilityOperation): CapabilityCheck;
  dispose(): void;
}

/** Verify-capability binding (non-mutating; CAP-001). */
export interface VerifyCapabilityBinding {
  readonly storeInstance: VerifiedStoreInstance;
  readonly configurationIdentity: string;
  readonly serviceUid: number;
  readonly limitProfile: Readonly<Record<string, number>>;
  readonly operationSet: readonly VerifyCapabilityOperation[];
  readonly generation: object;
}

export interface VerifyCapability {
  readonly binding: VerifyCapabilityBinding;
  verify(operation: VerifyCapabilityOperation): CapabilityCheck;
  dispose(): void;
}

const capabilityBrand = new WeakSet<InitializationCapability>();

interface CapabilityState {
  live: boolean;
}

/**
 * In-process per-store generation registry. A new initialization with a
 * different trusted configuration identity advances the generation for that
 * store identity; previously issued capabilities fail the stale-generation
 * check. Non-persisted; object identity is the token (no randomness, no
 * serialized nonce, no metadata mutation).
 */
const currentGenerationByStore = new Map<string, { readonly configurationIdentity: string; readonly generation: object }>();

function storeKey(identity: RootIdentity): string {
  return `${identity.dev}:${identity.ino}`;
}

const writeCapabilityBrand = new WeakSet<WriteCapability>();
const readCapabilityBrand = new WeakSet<ReadCapability>();
const verifyCapabilityBrand = new WeakSet<VerifyCapability>();

function freezeWriteBinding(binding: WriteCapabilityBinding): WriteCapabilityBinding {
  Object.freeze(binding.storeInstance);
  Object.freeze(binding.storeInstance.namespaces);
  Object.freeze(binding.storeInstance.limitProfile);
  Object.freeze(binding.operationSet);
  Object.freeze(binding.limitProfile);
  return Object.freeze(binding);
}

function freezeReadBinding(binding: ReadCapabilityBinding): ReadCapabilityBinding {
  Object.freeze(binding.storeInstance);
  Object.freeze(binding.storeInstance.namespaces);
  Object.freeze(binding.storeInstance.limitProfile);
  Object.freeze(binding.operationSet);
  Object.freeze(binding.limitProfile);
  return Object.freeze(binding);
}

function freezeVerifyBinding(binding: VerifyCapabilityBinding): VerifyCapabilityBinding {
  Object.freeze(binding.storeInstance);
  Object.freeze(binding.storeInstance.namespaces);
  Object.freeze(binding.storeInstance.limitProfile);
  Object.freeze(binding.operationSet);
  Object.freeze(binding.limitProfile);
  return Object.freeze(binding);
}

function sameStoreInstance(a: VerifiedStoreInstance, b: VerifiedStoreInstance): boolean {
  if (a.parentIdentity.dev !== b.parentIdentity.dev || a.parentIdentity.ino !== b.parentIdentity.ino) return false;
  if (a.namespaces.length !== b.namespaces.length) return false;
  for (let i = 0; i < a.namespaces.length; i++) {
    const x = a.namespaces[i]!;
    const y = b.namespaces[i]!;
    if (x.kind !== y.kind || x.dev !== y.dev || x.ino !== y.ino) return false;
  }
  return true;
}

/**
 * Generation lookup for a store: mutation-capable creators may advance the
 * registry on trusted-configuration replacement (matching the initialization
 * capability); non-mutating read/verify creators only observe it and fail
 * closed when no entry exists.
 */
function generationForStore(key: string, configurationIdentity: string, allowCreate: boolean): object | undefined {
  const recorded = currentGenerationByStore.get(key);
  if (recorded === undefined) {
    if (!allowCreate) return undefined;
    const generation: object = {};
    currentGenerationByStore.set(key, { configurationIdentity, generation });
    return generation;
  }
  if (recorded.configurationIdentity !== configurationIdentity) {
    if (!allowCreate) return undefined;
    const generation: object = {};
    currentGenerationByStore.set(key, { configurationIdentity, generation });
    return generation;
  }
  return recorded.generation;
}

function sameProfile(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i]!;
    if (key !== keysB[i] || a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * Gated authorized-write capability creator (ADR-029 D-2/D-5). Imported
 * only by `src/storage/publication/index.ts` (static-guard enforced).
 * Requires a genuine branded `TrustedWriteRequest` plus the verified store
 * instance produced by the metadata verification pipeline. The genuine
 * action identity derives only from the verified write-action provenance
 * bound into the request. Structural objects, forged brands, proxies, and
 * stale generations fail; disposal kills every later use.
 */
export function createWriteCapability(input: {
  readonly trustedWriteRequest: unknown;
  readonly storeInstance: VerifiedStoreInstance;
}): WriteCapability | undefined {
  if (!isGenuineTrustedWriteRequest(input.trustedWriteRequest)) return undefined;
  const request = input.trustedWriteRequest as TrustedWriteRequest;
  if (request.configurationIdentity !== input.storeInstance.configurationIdentity) return undefined;
  if (request.serviceUid !== input.storeInstance.serviceUid) return undefined;
  if (!sameProfile(request.limitProfile, input.storeInstance.limitProfile)) return undefined;
  const key = storeKey(input.storeInstance.parentIdentity);
  const generation = generationForStore(key, request.configurationIdentity, true);
  if (generation === undefined) return undefined;
  const binding = freezeWriteBinding({
    storeInstance: input.storeInstance,
    configurationIdentity: request.configurationIdentity,
    serviceUid: request.serviceUid,
    limitProfile: { ...request.limitProfile },
    actionIdentity: request.actionIdentity,
    operationSet: [...WRITE_OPERATION_SET],
    generation,
  });
  const state: CapabilityState = { live: true };
  const capability: WriteCapability = {
    binding,
    verify(operation) {
      if (!writeCapabilityBrand.has(this as WriteCapability)) return { ok: false, reason: 'not-genuine' };
      if (!state.live) return { ok: false, reason: 'disposed' };
      const current = currentGenerationByStore.get(key);
      if (current === undefined || current.generation !== binding.generation) return { ok: false, reason: 'stale-generation' };
      if (!binding.operationSet.includes(operation)) return { ok: false, reason: 'wrong-operation' };
      return { ok: true };
    },
    assertExpected(expected) {
      if (!writeCapabilityBrand.has(this as WriteCapability)) return { ok: false, reason: 'not-genuine' };
      if (!state.live) return { ok: false, reason: 'disposed' };
      const current = currentGenerationByStore.get(key);
      if (current === undefined || current.generation !== binding.generation) return { ok: false, reason: 'stale-generation' };
      if (!sameStoreInstance(expected.storeInstance, binding.storeInstance)) return { ok: false, reason: 'wrong-store-instance' };
      if (expected.configurationIdentity !== binding.configurationIdentity) return { ok: false, reason: 'wrong-configuration' };
      if (expected.serviceUid !== binding.serviceUid) return { ok: false, reason: 'wrong-service-uid' };
      if (!sameProfile(expected.limitProfile, binding.limitProfile)) return { ok: false, reason: 'wrong-limit-profile' };
      return { ok: true };
    },
    dispose() {
      if (writeCapabilityBrand.has(this as WriteCapability)) state.live = false;
    },
  };
  writeCapabilityBrand.add(capability);
  return capability;
}

/** True only for a capability minted by this module in this process. */
export function isGenuineWriteCapability(value: unknown): value is WriteCapability {
  return value !== null && typeof value === 'object' && writeCapabilityBrand.has(value as WriteCapability);
}

/**
 * Gated read-capability creator (non-mutating; ADR-029 D-5). Imported only
 * by `src/storage/read/index.ts` (static-guard enforced). Requires the
 * verified store instance (verified StoreMetadata) and a correlated genuine
 * branded trusted input; zero production consumers until WP-9/WP-12.
 */
export function createReadCapability(input: {
  readonly trustedInput: unknown;
  readonly storeInstance: VerifiedStoreInstance;
}): ReadCapability | undefined {
  if (!isGenuineTrustedStorageBootstrapInput(input.trustedInput)) return undefined;
  const trustedInput = input.trustedInput as TrustedStorageBootstrapInput;
  if (trustedInput.configurationIdentity !== input.storeInstance.configurationIdentity) return undefined;
  if (trustedInput.serviceUid !== input.storeInstance.serviceUid) return undefined;
  if (!sameProfile(trustedInput.limitProfile, input.storeInstance.limitProfile)) return undefined;
  const key = storeKey(input.storeInstance.parentIdentity);
  // Non-mutating: observe the existing generation only; a store without a
  // recorded generation (never initialized in this process) fails closed.
  const generation = generationForStore(key, trustedInput.configurationIdentity, false);
  if (generation === undefined) return undefined;
  const binding = freezeReadBinding({
    storeInstance: input.storeInstance,
    configurationIdentity: trustedInput.configurationIdentity,
    serviceUid: trustedInput.serviceUid,
    limitProfile: { ...trustedInput.limitProfile },
    operationSet: [...READ_OPERATION_SET],
    generation,
  });
  const state: CapabilityState = { live: true };
  const capability: ReadCapability = {
    binding,
    verify(operation) {
      if (!readCapabilityBrand.has(this as ReadCapability)) return { ok: false, reason: 'not-genuine' };
      if (!state.live) return { ok: false, reason: 'disposed' };
      const current = currentGenerationByStore.get(key);
      if (current === undefined || current.generation !== binding.generation) return { ok: false, reason: 'stale-generation' };
      if (!binding.operationSet.includes(operation)) return { ok: false, reason: 'wrong-operation' };
      return { ok: true };
    },
    dispose() {
      if (readCapabilityBrand.has(this as ReadCapability)) state.live = false;
    },
  };
  readCapabilityBrand.add(capability);
  return capability;
}

/** True only for a capability minted by this module in this process. */
export function isGenuineReadCapability(value: unknown): value is ReadCapability {
  return value !== null && typeof value === 'object' && readCapabilityBrand.has(value as ReadCapability);
}

/**
 * Gated verify-capability creator (non-mutating; ADR-029 D-5). Imported
 * only by `src/storage/read/index.ts` (static-guard enforced). Same gate as
 * the read capability; verification confers no authority (RDS-003,
 * ITG-007).
 */
export function createVerifyCapability(input: {
  readonly trustedInput: unknown;
  readonly storeInstance: VerifiedStoreInstance;
}): VerifyCapability | undefined {
  if (!isGenuineTrustedStorageBootstrapInput(input.trustedInput)) return undefined;
  const trustedInput = input.trustedInput as TrustedStorageBootstrapInput;
  if (trustedInput.configurationIdentity !== input.storeInstance.configurationIdentity) return undefined;
  if (trustedInput.serviceUid !== input.storeInstance.serviceUid) return undefined;
  if (!sameProfile(trustedInput.limitProfile, input.storeInstance.limitProfile)) return undefined;
  const key = storeKey(input.storeInstance.parentIdentity);
  const generation = generationForStore(key, trustedInput.configurationIdentity, false);
  if (generation === undefined) return undefined;
  const binding = freezeVerifyBinding({
    storeInstance: input.storeInstance,
    configurationIdentity: trustedInput.configurationIdentity,
    serviceUid: trustedInput.serviceUid,
    limitProfile: { ...trustedInput.limitProfile },
    operationSet: [...VERIFY_OPERATION_SET],
    generation,
  });
  const state: CapabilityState = { live: true };
  const capability: VerifyCapability = {
    binding,
    verify(operation) {
      if (!verifyCapabilityBrand.has(this as VerifyCapability)) return { ok: false, reason: 'not-genuine' };
      if (!state.live) return { ok: false, reason: 'disposed' };
      const current = currentGenerationByStore.get(key);
      if (current === undefined || current.generation !== binding.generation) return { ok: false, reason: 'stale-generation' };
      if (!binding.operationSet.includes(operation)) return { ok: false, reason: 'wrong-operation' };
      return { ok: true };
    },
    dispose() {
      if (verifyCapabilityBrand.has(this as VerifyCapability)) state.live = false;
    },
  };
  verifyCapabilityBrand.add(capability);
  return capability;
}

/** True only for a capability minted by this module in this process. */
export function isGenuineVerifyCapability(value: unknown): value is VerifyCapability {
  return value !== null && typeof value === 'object' && verifyCapabilityBrand.has(value as VerifyCapability);
}

/**
 * Phase-3 provisioning capability issuer (ADR-029 D-7 / M-1).
 * `provision-phase3` is NOT a new CAP-001 capability kind: it is an
 * operation-set extension of the existing initialization-capability family
 * and uses the existing module-private `InitializationCapability` domain.
 * Imported only by `src/storage/publication/index.ts` (static-guard
 * enforced); zero production issuance — the genuine branded trusted-input
 * operand has no production producer in WP-8-D.
 */
export function createProvisioningCapability(input: {
  readonly trustedInput: unknown;
  readonly storeInstance: VerifiedStoreInstance;
}): InitializationCapability | undefined {
  if (!isGenuineTrustedStorageBootstrapInput(input.trustedInput)) return undefined;
  const trustedInput = input.trustedInput as TrustedStorageBootstrapInput;
  if (trustedInput.configurationIdentity !== input.storeInstance.configurationIdentity) return undefined;
  if (trustedInput.serviceUid !== input.storeInstance.serviceUid) return undefined;
  if (!sameProfile(trustedInput.limitProfile, input.storeInstance.limitProfile)) return undefined;
  const key = storeKey(input.storeInstance.parentIdentity);
  const generation = generationForStore(key, trustedInput.configurationIdentity, true);
  if (generation === undefined) return undefined;
  const binding = freezeBinding({
    parentIdentity: input.storeInstance.parentIdentity,
    namespaceDerivations: { configNamespace: 'config-v1', storeNamespace: 'store-v1' },
    configurationIdentity: trustedInput.configurationIdentity,
    serviceUid: trustedInput.serviceUid,
    limitProfile: { ...trustedInput.limitProfile },
    actionIdentity: trustedInput.actionIdentity,
    operationSet: ['provision-phase3'],
    generation,
  });
  const state: CapabilityState = { live: true };
  const capability: InitializationCapability = {
    binding,
    verify(operation) {
      if (!capabilityBrand.has(this as InitializationCapability)) return { ok: false, reason: 'not-genuine' };
      if (!state.live) return { ok: false, reason: 'disposed' };
      const current = currentGenerationByStore.get(key);
      if (current === undefined || current.generation !== binding.generation) return { ok: false, reason: 'stale-generation' };
      if (!binding.operationSet.includes(operation)) return { ok: false, reason: 'wrong-operation' };
      return { ok: true };
    },
    assertExpected(expected) {
      if (!capabilityBrand.has(this as InitializationCapability)) return { ok: false, reason: 'not-genuine' };
      if (!state.live) return { ok: false, reason: 'disposed' };
      const current = currentGenerationByStore.get(key);
      if (current === undefined || current.generation !== binding.generation) return { ok: false, reason: 'stale-generation' };
      if (expected.parentIdentity.dev !== binding.parentIdentity.dev || expected.parentIdentity.ino !== binding.parentIdentity.ino) {
        return { ok: false, reason: 'wrong-parent-identity' };
      }
      if (expected.configurationIdentity !== binding.configurationIdentity) return { ok: false, reason: 'wrong-configuration' };
      if (expected.serviceUid !== binding.serviceUid) return { ok: false, reason: 'wrong-service-uid' };
      if (!sameProfile(expected.limitProfile, binding.limitProfile)) return { ok: false, reason: 'wrong-limit-profile' };
      return { ok: true };
    },
    dispose() {
      if (capabilityBrand.has(this as InitializationCapability)) state.live = false;
    },
  };
  capabilityBrand.add(capability);
  return capability;
}

function freezeBinding(binding: InitializationCapabilityBinding): InitializationCapabilityBinding {
  Object.freeze(binding.namespaceDerivations);
  Object.freeze(binding.operationSet);
  Object.freeze(binding.limitProfile);
  return Object.freeze(binding);
}

/**
 * Gated initialization-capability creator. Imported only by
 * `src/storage/initialization/initialize.ts`. Requires a genuine branded
 * trusted bootstrap input plus the validated trusted-parent descriptor
 * identity. Binds only pre-initialization facts; action identity derives from
 * the verified action-provenance operand already bound into the input.
 */
export function createInitializationCapability(input: {
  readonly trustedInput: unknown;
  readonly parentIdentity: RootIdentity;
}): InitializationCapability | undefined {
  if (!isGenuineTrustedStorageBootstrapInput(input.trustedInput)) return undefined;
  const trustedInput = input.trustedInput as TrustedStorageBootstrapInput;
  const key = storeKey(input.parentIdentity);
  const recorded = currentGenerationByStore.get(key);
  let generation: object;
  if (recorded === undefined || recorded.configurationIdentity !== trustedInput.configurationIdentity) {
    // First initialization for this store, or trusted-configuration
    // replacement: advance the generation so stale capabilities fail.
    generation = {};
    currentGenerationByStore.set(key, { configurationIdentity: trustedInput.configurationIdentity, generation });
  } else {
    // Same store and same configuration: share the current generation token.
    generation = recorded.generation;
  }
  const binding = freezeBinding({
    parentIdentity: input.parentIdentity,
    namespaceDerivations: { configNamespace: 'config-v1', storeNamespace: 'store-v1' },
    configurationIdentity: trustedInput.configurationIdentity,
    serviceUid: trustedInput.serviceUid,
    limitProfile: trustedInput.limitProfile,
    actionIdentity: trustedInput.actionIdentity,
    // Least authority (M-1): the initialization capability binds only its own
    // operation; the phase-3 provisioning capability (same domain, same
    // family vocabulary) is issued separately with `provision-phase3`.
    operationSet: ['namespace-initialize'],
    generation,
  });
  const state: CapabilityState = { live: true };
  const capability: InitializationCapability = {
    binding,
    verify(operation) {
      // The private brand must be carried by the receiver: a captured or
      // detached method reference fails here (CAP-015).
      if (!capabilityBrand.has(this as InitializationCapability)) return { ok: false, reason: 'not-genuine' };
      if (!state.live) return { ok: false, reason: 'disposed' };
      const current = currentGenerationByStore.get(key);
      if (current === undefined || current.generation !== binding.generation) return { ok: false, reason: 'stale-generation' };
      if (!binding.operationSet.includes(operation)) return { ok: false, reason: 'wrong-operation' };
      return { ok: true };
    },
    assertExpected(expected) {
      if (!capabilityBrand.has(this as InitializationCapability)) return { ok: false, reason: 'not-genuine' };
      if (!state.live) return { ok: false, reason: 'disposed' };
      const current = currentGenerationByStore.get(key);
      if (current === undefined || current.generation !== binding.generation) return { ok: false, reason: 'stale-generation' };
      if (expected.parentIdentity.dev !== binding.parentIdentity.dev || expected.parentIdentity.ino !== binding.parentIdentity.ino) {
        return { ok: false, reason: 'wrong-parent-identity' };
      }
      if (expected.configurationIdentity !== binding.configurationIdentity) return { ok: false, reason: 'wrong-configuration' };
      if (expected.serviceUid !== binding.serviceUid) return { ok: false, reason: 'wrong-service-uid' };
      const expectedKeys = Object.keys(expected.limitProfile).sort();
      const boundKeys = Object.keys(binding.limitProfile).sort();
      if (expectedKeys.length !== boundKeys.length) return { ok: false, reason: 'wrong-limit-profile' };
      for (let i = 0; i < expectedKeys.length; i++) {
        const key = expectedKeys[i]!;
        if (key !== boundKeys[i] || binding.limitProfile[key] !== expected.limitProfile[key]) return { ok: false, reason: 'wrong-limit-profile' };
      }
      return { ok: true };
    },
    dispose() {
      if (capabilityBrand.has(this as InitializationCapability)) state.live = false;
    },
  };
  capabilityBrand.add(capability);
  return capability;
}

/** True only for a capability minted by this module in this process. */
export function isGenuineInitializationCapability(value: unknown): value is InitializationCapability {
  return value !== null && typeof value === 'object' && capabilityBrand.has(value as InitializationCapability);
}
