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
import { isGenuineTrustedStorageBootstrapInput, type TrustedStorageBootstrapInput } from '../trusted-input/bootstrap-input.js';
import type { RootIdentity } from '../types.js';

export const INITIALIZATION_OPERATION_SET = ['namespace-initialize'] as const;
export type InitializationOperation = (typeof INITIALIZATION_OPERATION_SET)[number];

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
  | 'wrong-namespace-derivation';

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

const capabilityBrand = new WeakSet<InitializationCapability>();
const DISPOSED = Symbol('disposed');

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
    operationSet: [...INITIALIZATION_OPERATION_SET],
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
