/**
 * WP-15 Phase 1B — trusted-receipt capability + exact-record publication
 * permit (module-private brand).
 *
 * CAP-008…016 discipline, following the committed WP-13C/WP-13-S2 patterns:
 *
 * - the trusted-receipt capability is (a) module-private (a WeakSet brand
 *   not structurally representable by public fields), (b) generation-bound
 *   (CAP-008/010; one current generation per authority lifecycle key — the
 *   trusted configuration's workspace — recording the configuration
 *   identity; minting never invalidates unrelated capabilities; a mint
 *   under a DIFFERENT configuration identity for the same workspace
 *   advances the generation and makes every earlier capability stale), (c)
 *   minted ONLY by the trusted host composition (`produce.ts`; the creator
 *   is never exported from the package barrel), and (d) re-verified at
 *   every mutation boundary (CAP-009) by the authority and again at the
 *   store-boundary sink.
 *
 * - the exact-record publication permit (role `trusted-receipt-production`)
 *   confines publication to exactly ONE `TrustedReceipt`: the permit binds
 *   the genuine capability, the exact record class, record identity, record
 *   digest, canonical-byte digest, and the internally derived destination
 *   designation; the sink re-derives the destination and re-verifies the
 *   permit and the capability before any write. The permit is
 *   process-local and structurally unforgeable; it contains no raw
 *   filesystem path, descriptor, callback, or caller-selected
 *   class/destination.
 *
 * There is NO public constructor that can manufacture authority: the only
 * creators are gated on the genuine WP-6 validated trusted configuration
 * (capability) and on a genuine live capability (permit), and neither
 * creator is exported from the family barrel.
 */
import { isGenuineValidatedTrustedWorkspaceConfiguration } from '../../trusted/configuration-brand.js';
import { deriveRecordRelativePath } from '../../storage/layout/layout.js';
import { TRUSTED_RECEIPT_RECORD_CLASS, TRUSTED_RECEIPT_PRODUCER_ROLE } from '../types.js';

/** Capability check verdict (closed). */
export type ReceiptCapabilityCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not-genuine' | 'disposed' | 'stale-generation' | 'wrong-operation' };

/** Trusted-receipt capability binding (informational; carries no brand state). */
export interface TrustedReceiptCapabilityBinding {
  readonly configurationIdentity: string;
  /** Host-owned receipt-production action identity (branded provenance domain). */
  readonly actionIdentity: string;
  readonly operation: 'trusted-receipt-production';
  /** Private in-process generation identity; never persisted or serialized. */
  readonly generation: object;
}

/** Opaque in-process trusted-receipt capability (never serializable). */
export interface TrustedReceiptCapability {
  /** Informational frozen binding; carries no brand state. */
  readonly binding: TrustedReceiptCapabilityBinding;
  verify(): ReceiptCapabilityCheck;
  dispose(): void;
}

const capabilityBrand = new WeakSet<TrustedReceiptCapability>();
const capabilityDisposed = new WeakSet<TrustedReceiptCapability>();
/**
 * Trusted-receipt generation registry — INDEPENDENT of the result-publication
 * and outcome-recorder registries (no shared generation namespace between
 * the authority domains; changing one domain's configuration never
 * invalidates another domain's capabilities). One current generation per
 * authority lifecycle key (the trusted configuration's workspace identity).
 */
const currentGenerationByAuthority = new Map<string, { readonly configurationIdentity: string; readonly generation: object }>();

/** Authority lifecycle key: the workspace identity of the trusted configuration. */
function authorityLifecycleKey(configuration: Readonly<{ readonly workspaces?: readonly Readonly<{ readonly workspaceId?: unknown }>[] }>): string | undefined {
  const first = configuration.workspaces?.[0];
  if (typeof first?.workspaceId !== 'string' || first.workspaceId.length === 0) return undefined;
  return `ws:${first.workspaceId}`;
}

/** generationForStore-equivalent: reuse the current generation; advance on genuine replacement. */
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
 * Gated trusted-receipt capability creator. Consumed ONLY by the trusted
 * host composition (`produce.ts`; never exported from the family barrel;
 * static-guard enforced). Requires the genuine WP-6 validated trusted
 * configuration (runtime-branded) plus the host-owned receipt-production
 * action identity. Multiple mints under one unchanged trusted configuration
 * share the current generation; a mint under a replacement configuration
 * identity advances the generation and makes every earlier capability
 * stale.
 */
export function createTrustedReceiptCapability(input: {
  readonly trustedConfiguration: unknown;
  readonly actionIdentity: string;
}): TrustedReceiptCapability | undefined {
  if (!isGenuineValidatedTrustedWorkspaceConfiguration(input.trustedConfiguration)) return undefined;
  const configuration = input.trustedConfiguration as { readonly identity: string; readonly workspaces?: readonly Readonly<{ readonly workspaceId?: unknown }>[] };
  if (typeof configuration.identity !== 'string' || configuration.identity.length === 0) return undefined;
  if (typeof input.actionIdentity !== 'string' || input.actionIdentity.length === 0) return undefined;
  const lifecycleKey = authorityLifecycleKey(configuration);
  if (lifecycleKey === undefined) return undefined;
  const generation = generationForAuthority(lifecycleKey, configuration.identity);
  if (generation === undefined) return undefined;
  const binding: TrustedReceiptCapabilityBinding = Object.freeze({
    configurationIdentity: configuration.identity,
    actionIdentity: input.actionIdentity,
    operation: 'trusted-receipt-production',
    generation,
  });
  const capability: TrustedReceiptCapability = {
    binding,
    verify() {
      // The private brand must be carried by the receiver: a captured or
      // detached method reference fails here (CAP-015).
      if (!capabilityBrand.has(this as TrustedReceiptCapability)) return { ok: false, reason: 'not-genuine' };
      if (capabilityDisposed.has(this as TrustedReceiptCapability)) return { ok: false, reason: 'disposed' };
      const current = currentGenerationByAuthority.get(lifecycleKey);
      if (current === undefined || current.generation !== binding.generation) return { ok: false, reason: 'stale-generation' };
      return { ok: true };
    },
    dispose() {
      if (capabilityBrand.has(this as TrustedReceiptCapability)) capabilityDisposed.add(this as TrustedReceiptCapability);
    },
  };
  capabilityBrand.add(capability);
  return capability;
}

/** True only for a capability minted by this module in this process. */
export function isGenuineTrustedReceiptCapability(value: unknown): value is TrustedReceiptCapability {
  return value !== null && typeof value === 'object' && capabilityBrand.has(value as TrustedReceiptCapability);
}

/** Exact-record binding of one authorized TrustedReceipt publication. */
export interface TrustedReceiptPermitBinding {
  /** Genuine trusted-receipt capability (never a path). */
  readonly capability: TrustedReceiptCapability;
  /** Exact receipt-production role (closed). */
  readonly role: typeof TRUSTED_RECEIPT_PRODUCER_ROLE;
  /** Exact closed record class (never caller-selected). */
  readonly recordClass: typeof TRUSTED_RECEIPT_RECORD_CLASS;
  /** Exact record identity. */
  readonly recordId: string;
  /** Exact record digest (canonical bytes digest). */
  readonly recordDigest: string;
  /** Exact digest of the canonical record bytes (equals recordDigest; bound independently). */
  readonly canonicalBytesDigest: string;
  /** Exact internally derived destination designation (relative; never a raw path). */
  readonly destinationDesignation: string;
}

/** Opaque in-process exact-record receipt permit (never serializable). */
export interface TrustedReceiptPermit {
  /** Informational frozen binding; carries no brand state. */
  readonly binding: TrustedReceiptPermitBinding;
  dispose(): void;
}

const permitBrand = new WeakSet<TrustedReceiptPermit>();
const permitDisposed = new WeakSet<TrustedReceiptPermit>();

/**
 * Gated exact-record receipt permit creator (sink-level confinement).
 * Minted INTERNALLY by the receipt authority immediately before the write;
 * the store boundary re-verifies the genuine live permit and the capability
 * before any filesystem access. The binding is validated (digest syntax,
 * destination derivation) before the permit is branded.
 */
export function createTrustedReceiptPermit(input: {
  readonly capability: unknown;
  readonly role: typeof TRUSTED_RECEIPT_PRODUCER_ROLE;
  readonly recordId: string;
  readonly recordDigest: string;
  readonly canonicalBytesDigest: string;
}): TrustedReceiptPermit | undefined {
  if (!isGenuineTrustedReceiptCapability(input.capability)) return undefined;
  const capability = input.capability as TrustedReceiptCapability;
  // Least authority at mint time: the capability must verify its operation.
  if (!capability.verify().ok) return undefined;
  if (input.role !== TRUSTED_RECEIPT_PRODUCER_ROLE) return undefined;
  if (!/^pgw:l:[0-9a-f]{32}$/.test(input.recordId)) return undefined;
  if (!/^sha-256:[0-9a-f]{64}$/.test(input.recordDigest) || !/^sha-256:[0-9a-f]{64}$/.test(input.canonicalBytesDigest)) return undefined;
  if (input.recordDigest !== input.canonicalBytesDigest) return undefined;
  const derived = deriveRecordRelativePath(TRUSTED_RECEIPT_RECORD_CLASS, input.recordId);
  if (!derived.ok) return undefined;
  const binding: TrustedReceiptPermitBinding = Object.freeze({
    capability,
    role: input.role,
    recordClass: TRUSTED_RECEIPT_RECORD_CLASS,
    recordId: input.recordId,
    recordDigest: input.recordDigest,
    canonicalBytesDigest: input.canonicalBytesDigest,
    destinationDesignation: derived.relativePath,
  });
  const permit: TrustedReceiptPermit = {
    binding,
    dispose() {
      if (permitBrand.has(this as TrustedReceiptPermit)) permitDisposed.add(this as TrustedReceiptPermit);
    },
  };
  permitBrand.add(permit);
  return permit;
}

/** True only for a permit minted by this module in this process. */
export function isGenuineTrustedReceiptPermit(value: unknown): value is TrustedReceiptPermit {
  return value !== null && typeof value === 'object' && permitBrand.has(value as TrustedReceiptPermit);
}

/** Live-state check for a genuine permit (disposed permits are unusable). */
export function trustedReceiptPermitLive(permit: TrustedReceiptPermit): boolean {
  if (!permitBrand.has(permit)) return false;
  return !permitDisposed.has(permit);
}
