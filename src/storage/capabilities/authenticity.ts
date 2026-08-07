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
import { isGenuineTrustedStorageBootstrapInput, isGenuineTrustedWriteRequest, isGenuineTrustedRecoveryRequest, type TrustedRecoveryRequest, type TrustedStorageBootstrapInput, type TrustedWriteRequest } from '../trusted-input/bootstrap-input.js';
import { RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND, type AuditEventKind } from '../audit/write-audit.js';
import { isValidDigestSyntax } from '../format/envelope.js';
import { deriveRecordRelativePath, deriveRegistryIndexRelativePath } from '../layout/layout.js';
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

// ─── WP-8-F: recovery capability (contract 21.1; separate mutation domain) ──
// The recovery capability is a distinct opaque mutation-capable capability
// kind (contract 21.1), bound to the genuine recovery action identity from
// the verified recovery-action provenance. Least authority: the operation
// set contains exactly the executable recovery operation(s) of this slice;
// quarantine/audit-reconstruction/lock-recovery/disposition operations join
// the set only when implemented. The capability NEVER derives from a
// RecoveryPlan, assessment, cursor, observation, path, or caller boolean.

export const RECOVERY_OPERATION_SET = ['orphan-removal', 'quarantine-temporary', 'audit-reconstruction', 'registry-index-rebuild'] as const;
export type RecoveryOperation = (typeof RECOVERY_OPERATION_SET)[number];

/** Recovery-capability binding (mutation-capable; CAP-001/API-003). */
export interface RecoveryCapabilityBinding {
  readonly storeInstance: VerifiedStoreInstance;
  readonly configurationIdentity: string;
  readonly serviceUid: number;
  readonly limitProfile: Readonly<Record<string, number>>;
  readonly actionIdentity: string;
  readonly operationSet: readonly RecoveryOperation[];
  /** Private in-process generation identity; never persisted or serialized. */
  readonly generation: object;
}

/** Opaque in-process authorized-recovery capability (never serializable). */
export interface RecoveryCapability {
  /** Informational frozen binding; carries no brand state. */
  readonly binding: RecoveryCapabilityBinding;
  verify(operation: RecoveryOperation): CapabilityCheck;
  assertExpected(expected: {
    readonly storeInstance: VerifiedStoreInstance;
    readonly configurationIdentity: string;
    readonly serviceUid: number;
    readonly limitProfile: Readonly<Record<string, number>>;
  }): CapabilityCheck;
  dispose(): void;
}

const recoveryCapabilityBrand = new WeakSet<RecoveryCapability>();

function freezeRecoveryBinding(binding: RecoveryCapabilityBinding): RecoveryCapabilityBinding {
  Object.freeze(binding.storeInstance);
  Object.freeze(binding.storeInstance.namespaces);
  Object.freeze(binding.storeInstance.limitProfile);
  Object.freeze(binding.operationSet);
  Object.freeze(binding.limitProfile);
  return Object.freeze(binding);
}

/**
 * Gated recovery-capability creator (WP-8-F). Imported only by
 * `src/storage/recovery/execute.ts` (static-guard enforced). Requires a
 * genuine branded `TrustedRecoveryRequest` plus the verified store instance
 * produced by the metadata verification pipeline. The genuine action
 * identity derives only from the verified recovery-action provenance bound
 * into the request. Mutation-capable: like the write creator, it may
 * establish the per-process generation registry entry for the store.
 *
 * WP-8-G least-authority test seam: `operationSet` is optional and defaults
 * to the full implemented vocabulary; when supplied it must be a non-empty
 * closed subset of `RECOVERY_OPERATION_SET`. Production issuance (execute.ts)
 * never passes it; tests use it to prove that an authority whose exact
 * operation set excludes `audit-reconstruction` can never reconstruct
 * (every boundary verifies the exact operation; WP-8-G §1).
 */
export function createRecoveryCapability(input: {
  readonly trustedRecoveryRequest: unknown;
  readonly storeInstance: VerifiedStoreInstance;
  readonly operationSet?: readonly RecoveryOperation[];
}): RecoveryCapability | undefined {
  if (!isGenuineTrustedRecoveryRequest(input.trustedRecoveryRequest)) return undefined;
  const request = input.trustedRecoveryRequest as TrustedRecoveryRequest;
  if (request.configurationIdentity !== input.storeInstance.configurationIdentity) return undefined;
  if (request.serviceUid !== input.storeInstance.serviceUid) return undefined;
  if (!sameProfile(request.limitProfile, input.storeInstance.limitProfile)) return undefined;
  const operations = input.operationSet ?? RECOVERY_OPERATION_SET;
  if (!Array.isArray(operations) || operations.length === 0) return undefined;
  for (const op of operations) {
    if (!RECOVERY_OPERATION_SET.includes(op)) return undefined;
  }
  const key = storeKey(input.storeInstance.parentIdentity);
  const generation = generationForStore(key, request.configurationIdentity, true);
  if (generation === undefined) return undefined;
  const binding = freezeRecoveryBinding({
    storeInstance: input.storeInstance,
    configurationIdentity: request.configurationIdentity,
    serviceUid: request.serviceUid,
    limitProfile: { ...request.limitProfile },
    actionIdentity: request.actionIdentity,
    operationSet: [...operations],
    generation,
  });
  const state: CapabilityState = { live: true };
  const capability: RecoveryCapability = {
    binding,
    verify(operation) {
      if (!recoveryCapabilityBrand.has(this as RecoveryCapability)) return { ok: false, reason: 'not-genuine' };
      if (!state.live) return { ok: false, reason: 'disposed' };
      const current = currentGenerationByStore.get(key);
      if (current === undefined || current.generation !== binding.generation) return { ok: false, reason: 'stale-generation' };
      if (!binding.operationSet.includes(operation)) return { ok: false, reason: 'wrong-operation' };
      return { ok: true };
    },
    assertExpected(expected) {
      if (!recoveryCapabilityBrand.has(this as RecoveryCapability)) return { ok: false, reason: 'not-genuine' };
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
      if (recoveryCapabilityBrand.has(this as RecoveryCapability)) state.live = false;
    },
  };
  recoveryCapabilityBrand.add(capability);
  return capability;
}

/** True only for a capability minted by this module in this process. */
export function isGenuineRecoveryCapability(value: unknown): value is RecoveryCapability {
  return value !== null && typeof value === 'object' && recoveryCapabilityBrand.has(value as RecoveryCapability);
}

// ─── WP-8-F correction: exact-record recovery publication permit ──────────
// Sink-level authority confinement (review finding): a genuine
// `RecoveryCapability` must never reach the generic immutable-publication
// substrate, because the generic sink accepts a caller-selected record class
// and destination. Recovery publication is confined to one exact record per
// permit: the permit binds the genuine recovery capability, the exact store
// and namespace identities (through the capability's store instance), the
// recovery operation, the publication role, the exact record class, record
// identity, record digest, canonical-byte digest, the internally derived
// destination designation, and (audit role) the exact evidence identity,
// evidence digest, `authorized-write` event kind, and trusted recovery action
// identity. The permit is process-local and structurally unforgeable
// (module-private `WeakSet`); it contains no raw filesystem path, descriptor,
// device/inode data, callback, or caller-selected class/destination. The
// creator is imported only by `src/storage/recovery/evidence.ts`; the brand
// verifier only by `src/storage/publication/publish-record.ts` (static-guard
// enforced).

export type RecoveryPublicationRole = 'recovery-evidence' | 'recovery-authorized-write-audit' | 'reconstructed-recovery-audit' | 'registry-index';
export type RecoveryPublicationRecordClass = 'store-evidence-record' | 'authoritative-audit-event' | 'registry-index';

/** Closed audit event kinds bindable by an audit-role recovery permit (vocabulary owned by the audit builder). */
export type RecoveryPermitAuditEventKind = AuditEventKind;

/** Exact-record binding of one authorized recovery record publication. */
export interface RecoveryPublicationPermitBinding {
  /** Genuine recovery capability (carries the store/namespace identity; never a path). */
  readonly capability: RecoveryCapability;
  /** Exact recovery operation of the authorized mutation. */
  readonly operation: RecoveryOperation;
  /** Publication role: evidence record or its mechanical audit event. */
  readonly role: RecoveryPublicationRole;
  /** Exact closed record class for the role (never caller-selected). */
  readonly recordClass: RecoveryPublicationRecordClass;
  /** Exact record identity. */
  readonly recordId: string;
  /** Exact record digest (canonical bytes digest). */
  readonly recordDigest: string;
  /** Exact digest of the canonical record bytes (equals recordDigest; bound independently). */
  readonly canonicalBytesDigest: string;
  /** Exact internally derived destination designation (relative; never a raw path). */
  readonly destinationDesignation: string;
  /** Audit-role binding (present only for `recovery-authorized-write-audit` and `reconstructed-recovery-audit`). */
  readonly audit?: {
    /** Exact record identity referenced by the audit event (evidence record for the evidence audit; target record for the reconstructed audit). */
    readonly referencedRecordId: string;
    /** Exact referenced record digest (evidence digest; target digest). */
    readonly referencedRecordDigest: string;
    /** Exact audit event kind (`authorized-write` | `recovery-audit-reconstruction`; role-paired). */
    readonly eventKind: RecoveryPermitAuditEventKind;
    /** Exact trusted action identity carried by the audit event (recovery action identity). */
    readonly trustedActionIdentity: string;
  };
}

/** Opaque in-process exact-record recovery publication permit (never serializable). */
export interface RecoveryPublicationPermit {
  /** Informational frozen binding; carries no brand state. */
  readonly binding: RecoveryPublicationPermitBinding;
  dispose(): void;
}

const recoveryPublicationPermitBrand = new WeakSet<RecoveryPublicationPermit>();
const recoveryPublicationPermitDisposed = new WeakSet<RecoveryPublicationPermit>();

function freezeRecoveryPublicationBinding(binding: RecoveryPublicationPermitBinding): RecoveryPublicationPermitBinding {
  const audit = binding.audit === undefined ? undefined : Object.freeze(binding.audit);
  return Object.freeze({ ...binding, ...(audit === undefined ? {} : { audit }) });
}

/**
 * Gated exact-record recovery-publication permit creator (WP-8-F; WP-8-G
 * role extension). Imported only by `src/storage/recovery/evidence.ts` and
 * `src/storage/recovery/reconstruct.ts` (static-guard enforced); never
 * exported from any barrel or the package root. Requires a genuine branded
 * `RecoveryCapability` that verifies the exact operation, and an internally
 * derived destination designation; the binding is validated (digest syntax,
 * role/class correlation, role/kind pairing, audit binding, destination
 * derivation) before the permit is branded.
 */
export function createRecoveryPublicationPermit(input: {
  readonly capability: unknown;
  readonly operation: RecoveryOperation;
  readonly role: RecoveryPublicationRole;
  readonly recordId: string;
  readonly recordDigest: string;
  readonly canonicalBytesDigest: string;
  readonly destinationDesignation: string;
  readonly audit?: {
    readonly referencedRecordId: string;
    readonly referencedRecordDigest: string;
    readonly eventKind: RecoveryPermitAuditEventKind;
    readonly trustedActionIdentity: string;
  };
}): RecoveryPublicationPermit | undefined {
  if (!isGenuineRecoveryCapability(input.capability)) return undefined;
  const capability = input.capability as RecoveryCapability;
  // Least authority at mint time: the capability must verify the exact
  // bound operation (an orphan-only or quarantine-only capability can never
  // mint an audit-reconstruction or registry-index permit; WP-8-G §1).
  if (!capability.verify(input.operation).ok) return undefined;
  if (input.role !== 'recovery-evidence' && input.role !== 'recovery-authorized-write-audit' && input.role !== 'reconstructed-recovery-audit' && input.role !== 'registry-index') return undefined;
  let recordClass: RecoveryPublicationRecordClass;
  if (input.role === 'registry-index') {
    // WP-8-H: the registry-index role binds the exact derived cache snapshot
    // (ADR-031). The record identity is the 32-hex index identity; the
    // destination is the internally derived `index/registry-index/...` path.
    recordClass = 'registry-index';
    if (!/^[0-9a-f]{32}$/.test(input.recordId)) return undefined;
    if (input.audit !== undefined) return undefined;
    const indexDerived = deriveRegistryIndexRelativePath(input.recordId);
    if (!indexDerived.ok || indexDerived.relativePath !== input.destinationDesignation) return undefined;
  } else {
    recordClass = input.role === 'recovery-evidence' ? 'store-evidence-record' : 'authoritative-audit-event';
    if (!isValidDigestSyntax(input.recordDigest) || !isValidDigestSyntax(input.canonicalBytesDigest)) return undefined;
    if (input.recordDigest !== input.canonicalBytesDigest) return undefined;
    const derived = deriveRecordRelativePath(recordClass, input.recordId);
    if (!derived.ok || derived.relativePath !== input.destinationDesignation) return undefined;
  }
  if (input.role === 'recovery-authorized-write-audit') {
    if (input.audit === undefined) return undefined;
    if (input.audit.eventKind !== 'authorized-write') return undefined;
    if (!isValidDigestSyntax(input.audit.referencedRecordDigest)) return undefined;
    if (!/^pgw:r:[0-9a-f]{32}$/.test(input.audit.referencedRecordId)) return undefined;
    if (typeof input.audit.trustedActionIdentity !== 'string' || input.audit.trustedActionIdentity.length === 0) return undefined;
    if (input.audit.referencedRecordId === input.recordId && input.audit.referencedRecordDigest === input.recordDigest) return undefined;
  } else if (input.role === 'reconstructed-recovery-audit') {
    // WP-8-G: the reconstructed audit is the contract's distinct
    // `recovery-audit-reconstruction` event (16.3/AUD-011), never an
    // authorized-write event; role/kind pairing is exact.
    if (input.audit === undefined) return undefined;
    if (input.audit.eventKind !== RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND) return undefined;
    if (!isValidDigestSyntax(input.audit.referencedRecordDigest)) return undefined;
    if (!/^pgw:r:[0-9a-f]{32}$/.test(input.audit.referencedRecordId)) return undefined;
    if (typeof input.audit.trustedActionIdentity !== 'string' || input.audit.trustedActionIdentity.length === 0) return undefined;
    if (input.audit.referencedRecordId === input.recordId && input.audit.referencedRecordDigest === input.recordDigest) return undefined;
  } else if (input.audit !== undefined) {
    return undefined;
  }
  const binding = freezeRecoveryPublicationBinding({
    capability,
    operation: input.operation,
    role: input.role,
    recordClass,
    recordId: input.recordId,
    recordDigest: input.recordDigest,
    canonicalBytesDigest: input.canonicalBytesDigest,
    destinationDesignation: input.destinationDesignation,
    ...(input.audit === undefined ? {} : { audit: input.audit }),
  });
  const permit: RecoveryPublicationPermit = {
    binding,
    dispose() {
      if (recoveryPublicationPermitBrand.has(this as RecoveryPublicationPermit)) recoveryPublicationPermitDisposed.add(this as RecoveryPublicationPermit);
    },
  };
  recoveryPublicationPermitBrand.add(permit);
  return permit;
}

/** True only for a permit minted by this module in this process. */
export function isGenuineRecoveryPublicationPermit(value: unknown): value is RecoveryPublicationPermit {
  return value !== null && typeof value === 'object' && recoveryPublicationPermitBrand.has(value as RecoveryPublicationPermit);
}

/** Live-state check for a genuine permit (disposed permits are unusable). */
export function recoveryPublicationPermitLive(permit: RecoveryPublicationPermit): boolean {
  if (!recoveryPublicationPermitBrand.has(permit)) return false;
  return !recoveryPublicationPermitDisposed.has(permit);
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
