/**
 * WP-13C — result-publication capability + exact-record publication permit.
 *
 * ADR-038 decision 1: the result-publication authority holds a
 * result-publication capability that is (a) module-private (a WeakSet brand
 * not structurally representable by public fields; CAP-014/015), (b)
 * generation-bound (CAP-008/010), (c) minted ONLY by the trusted host
 * composition — zero production producers outside it (the creator is never
 * exported from the package barrel), and (d) re-verified at every mutation
 * boundary (CAP-009) by the authority and again at the store-boundary sink.
 *
 * GENERATION SEMANTICS (SIR-WP13C-002 correction): the generation tracks
 * the trusted configuration/authority lifecycle — NOT individual
 * capability minting. The registry mirrors the committed WP-8
 * `generationForStore` pattern (`src/storage/capabilities/authenticity.ts`):
 * one current generation per authority lifecycle key (the workspace of the
 * trusted configuration), recording the configuration identity. Multiple
 * mints under one unchanged genuine trusted configuration SHARE the same
 * current generation — minting capability B never invalidates capability A
 * (CAP-008: invalidation on disposal or trusted-configuration replacement
 * only). The generation ADVANCES only when a mint arrives under a DIFFERENT
 * trusted configuration identity for the same workspace (genuine
 * configuration replacement): every earlier capability becomes
 * stale-generation and every mutation-boundary verification rejects it.
 * Disposal remains per-capability (CAP-009). No one-live-capability-only
 * semantics exist.
 *
 * The exact-record publication permit (role `result-publication`) confines
 * publication to exactly ONE `ResultPublicationRecord` (sink-level
 * confinement preserved): the permit binds the genuine capability, the
 * exact record class, record identity, record digest, canonical-byte digest,
 * and the internally derived destination designation; the sink re-derives
 * the destination and re-verifies the permit and the capability before any
 * write. The permit is process-local and structurally unforgeable; it
 * contains no raw filesystem path, descriptor, callback, or caller-selected
 * class/destination.
 */
import { isGenuineValidatedTrustedWorkspaceConfiguration } from '../trusted/configuration-brand.js';
import { deriveRecordRelativePath } from '../storage/layout/layout.js';
import { RESULT_PUBLICATION_RECORD_CLASS } from './types.js';

export const RESULT_PUBLICATION_OPERATION = 'result-publication' as const;
export type ResultPublicationOperation = typeof RESULT_PUBLICATION_OPERATION;

/** Capability check verdict (closed). */
export type CapabilityCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not-genuine' | 'disposed' | 'stale-generation' | 'wrong-operation' };

/** Result-publication capability binding (informational; carries no brand state). */
export interface ResultPublicationCapabilityBinding {
  readonly configurationIdentity: string;
  /** Host-owned result-publication action identity (branded provenance domain). */
  readonly actionIdentity: string;
  readonly operation: ResultPublicationOperation;
  /** Private in-process generation identity; never persisted or serialized. */
  readonly generation: object;
}

/** Opaque in-process result-publication capability (never serializable). */
export interface ResultPublicationCapability {
  /** Informational frozen binding; carries no brand state. */
  readonly binding: ResultPublicationCapabilityBinding;
  verify(): CapabilityCheck;
  dispose(): void;
}

const capabilityBrand = new WeakSet<ResultPublicationCapability>();
const capabilityDisposed = new WeakSet<ResultPublicationCapability>();
/**
 * Result-publication authority generation registry (the committed
 * `generationForStore` pattern; CAP-008/010): one current generation per
 * authority lifecycle key (the trusted configuration's workspace identity —
 * stable across configuration replacement, distinct per workspace),
 * recording the configuration identity. A mint REUSES the recorded
 * generation while the configuration identity is unchanged; a mint under a
 * DIFFERENT configuration identity for the same workspace (genuine
 * configuration replacement) ADVANCES the generation. Ordinary minting
 * never invalidates unrelated capabilities.
 */
const currentGenerationByAuthority = new Map<string, { readonly configurationIdentity: string; readonly generation: object }>();

/**
 * Authority lifecycle key: the workspace identity of the trusted
 * configuration (single-workspace authority composition — the same
 * per-workspace composition as the trusted store). Undefined for a
 * configuration without a workspace record (fails closed at mint).
 */
function authorityLifecycleKey(configuration: Readonly<{ readonly workspaces?: readonly Readonly<{ readonly workspaceId?: unknown }>[] }>): string | undefined {
  const first = configuration.workspaces?.[0];
  if (typeof first?.workspaceId !== 'string' || first.workspaceId.length === 0) return undefined;
  return `ws:${first.workspaceId}`;
}

/**
 * generationForStore-equivalent: reuse the current generation while the
 * trusted configuration identity is unchanged; advance it on genuine
 * configuration replacement (CAP-008).
 */
function generationForAuthority(key: string, configurationIdentity: string): object | undefined {
  const recorded = currentGenerationByAuthority.get(key);
  if (recorded === undefined) {
    const generation: object = {};
    currentGenerationByAuthority.set(key, { configurationIdentity, generation });
    return generation;
  }
  if (recorded.configurationIdentity !== configurationIdentity) {
    const generation: object = {};
    currentGenerationByAuthority.set(key, { configurationIdentity, generation });
    return generation;
  }
  return recorded.generation;
}

/**
 * Gated result-publication capability creator. Consumed ONLY by the trusted
 * host composition (never exported from the package barrel; static-guard
 * enforced). Requires the genuine WP-6 validated trusted configuration
 * (runtime-branded) plus the host-owned result-publication action identity.
 * Multiple mints under one unchanged trusted configuration share the
 * current generation (minting never invalidates unrelated capabilities);
 * a mint under a replacement configuration identity advances the generation
 * and makes every earlier capability stale (CAP-008/010). The caller may
 * additionally `dispose()` a capability (CAP-009).
 */
export function createResultPublicationCapability(input: {
  readonly trustedConfiguration: unknown;
  readonly actionIdentity: string;
}): ResultPublicationCapability | undefined {
  if (!isGenuineValidatedTrustedWorkspaceConfiguration(input.trustedConfiguration)) return undefined;
  const configuration = input.trustedConfiguration as { readonly identity: string; readonly workspaces?: readonly Readonly<{ readonly workspaceId?: unknown }>[] };
  if (typeof configuration.identity !== 'string' || configuration.identity.length === 0) return undefined;
  if (typeof input.actionIdentity !== 'string' || input.actionIdentity.length === 0) return undefined;
  const lifecycleKey = authorityLifecycleKey(configuration);
  if (lifecycleKey === undefined) return undefined;
  const generation = generationForAuthority(lifecycleKey, configuration.identity);
  if (generation === undefined) return undefined;
  const binding: ResultPublicationCapabilityBinding = Object.freeze({
    configurationIdentity: configuration.identity,
    actionIdentity: input.actionIdentity,
    operation: RESULT_PUBLICATION_OPERATION,
    generation,
  });
  const capability: ResultPublicationCapability = {
    binding,
    verify() {
      // The private brand must be carried by the receiver: a captured or
      // detached method reference fails here (CAP-015).
      if (!capabilityBrand.has(this as ResultPublicationCapability)) return { ok: false, reason: 'not-genuine' };
      if (capabilityDisposed.has(this as ResultPublicationCapability)) return { ok: false, reason: 'disposed' };
      const current = currentGenerationByAuthority.get(lifecycleKey);
      if (current === undefined || current.generation !== binding.generation) return { ok: false, reason: 'stale-generation' };
      return { ok: true };
    },
    dispose() {
      if (capabilityBrand.has(this as ResultPublicationCapability)) capabilityDisposed.add(this as ResultPublicationCapability);
    },
  };
  capabilityBrand.add(capability);
  return capability;
}

/** True only for a capability minted by this module in this process. */
export function isGenuineResultPublicationCapability(value: unknown): value is ResultPublicationCapability {
  return value !== null && typeof value === 'object' && capabilityBrand.has(value as ResultPublicationCapability);
}

/** Exact-record binding of one authorized result-publication record publication. */
export interface ResultPublicationPermitBinding {
  /** Genuine result-publication capability (never a path). */
  readonly capability: ResultPublicationCapability;
  /** Exact publication role (closed). */
  readonly role: 'result-publication';
  /** Exact closed record class (never caller-selected). */
  readonly recordClass: 'result-publication-record';
  /** Exact record identity. */
  readonly recordId: string;
  /** Exact record digest (canonical bytes digest). */
  readonly recordDigest: string;
  /** Exact digest of the canonical record bytes (equals recordDigest; bound independently). */
  readonly canonicalBytesDigest: string;
  /** Exact internally derived destination designation (relative; never a raw path). */
  readonly destinationDesignation: string;
}

/** Opaque in-process exact-record result-publication permit (never serializable). */
export interface ResultPublicationPermit {
  /** Informational frozen binding; carries no brand state. */
  readonly binding: ResultPublicationPermitBinding;
  dispose(): void;
}

const permitBrand = new WeakSet<ResultPublicationPermit>();
const permitDisposed = new WeakSet<ResultPublicationPermit>();

function freezePermitBinding(binding: ResultPublicationPermitBinding): ResultPublicationPermitBinding {
  return Object.freeze(binding);
}

/**
 * Gated exact-record result-publication permit creator (sink-level
 * confinement). Minted INTERNALLY by the publication authority immediately
 * before the write; the store boundary re-verifies the genuine live permit
 * and the capability before any filesystem access. The binding is validated
 * (digest syntax, destination derivation) before the permit is branded.
 */
export function createResultPublicationPermit(input: {
  readonly capability: unknown;
  readonly role: 'result-publication';
  readonly recordId: string;
  readonly recordDigest: string;
  readonly canonicalBytesDigest: string;
}): ResultPublicationPermit | undefined {
  if (!isGenuineResultPublicationCapability(input.capability)) return undefined;
  const capability = input.capability as ResultPublicationCapability;
  // Least authority at mint time: the capability must verify its operation.
  if (!capability.verify().ok) return undefined;
  if (input.role !== 'result-publication') return undefined;
  if (!/^pgw:l:[0-9a-f]{32}$/.test(input.recordId)) return undefined;
  if (!/^sha-256:[0-9a-f]{64}$/.test(input.recordDigest) || !/^sha-256:[0-9a-f]{64}$/.test(input.canonicalBytesDigest)) return undefined;
  if (input.recordDigest !== input.canonicalBytesDigest) return undefined;
  const derived = deriveRecordRelativePath(RESULT_PUBLICATION_RECORD_CLASS, input.recordId);
  if (!derived.ok) return undefined;
  const binding = freezePermitBinding({
    capability,
    role: input.role,
    recordClass: RESULT_PUBLICATION_RECORD_CLASS,
    recordId: input.recordId,
    recordDigest: input.recordDigest,
    canonicalBytesDigest: input.canonicalBytesDigest,
    destinationDesignation: derived.relativePath,
  });
  const permit: ResultPublicationPermit = {
    binding,
    dispose() {
      if (permitBrand.has(this as ResultPublicationPermit)) permitDisposed.add(this as ResultPublicationPermit);
    },
  };
  permitBrand.add(permit);
  return permit;
}

/** True only for a permit minted by this module in this process. */
export function isGenuineResultPublicationPermit(value: unknown): value is ResultPublicationPermit {
  return value !== null && typeof value === 'object' && permitBrand.has(value as ResultPublicationPermit);
}

/** Live-state check for a genuine permit (disposed permits are unusable). */
export function resultPublicationPermitLive(permit: ResultPublicationPermit): boolean {
  if (!permitBrand.has(permit)) return false;
  return !permitDisposed.has(permit);
}
