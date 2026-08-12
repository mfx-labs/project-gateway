/**
 * WP-15 Phase 2 — receipt-publication-correlation capability + exact-record
 * publication permits (module-private brand).
 *
 * CAP-008…016 discipline, following the committed WP-13C/Phase-1B patterns:
 *
 * - the receipt-publication-correlation capability is (a) module-private
 *   (a WeakSet brand not structurally representable by public fields), (b)
 *   generation-bound (CAP-008/010; one current generation per authority
 *   lifecycle key — the trusted configuration's workspace — recording the
 *   configuration identity; minting never invalidates unrelated
 *   capabilities; a mint under a DIFFERENT configuration identity for the
 *   same workspace advances the generation and makes every earlier
 *   capability stale), (c) minted ONLY by the trusted host composition
 *   (`produce.ts`; the creator is never exported from the package barrel),
 *   and (d) re-verified at every mutation boundary (CAP-009) by the
 *   authority and again at the store-boundary sinks. The generation
 *   registry is INDEPENDENT of the receipt-producer, result-publication,
 *   and outcome-recorder registries — no shared generation namespace
 *   between the authority domains.
 *
 * - TWO exact-record publication permits confine publication to exactly the
 *   two Phase-2 classes: the successor-`ResultPublicationRecord` permit
 *   (role `receipt-publication-correlation`, class
 *   `result-publication-record`) and the `SupersessionRecord` permit (role
 *   `receipt-publication-correlation`, class `supersession-record`). Each
 *   permit binds the genuine capability, the exact record class, record
 *   identity, record digest, canonical-byte digest, and the internally
 *   derived destination designation; each sink re-derives the destination
 *   and re-verifies the permit and the capability before any write. A
 *   permit for one class NEVER authorizes the other class: the permit
 *   binding carries the exact class, and the sink re-checks it.
 *
 * Schema-role separation (A1 §8/§10; §26): the permit role
 * (`receipt-publication-correlation`) is the AUTHORITY role, not the
 * schema `responsible_role` — the produced records retain their committed
 * schema roles (`trusted-result-publisher` / `trusted-lifecycle-authority`),
 * which the store sinks verify against the payload. The permit carries no
 * raw filesystem path, descriptor, callback, or caller-selected
 * class/destination.
 *
 * There is NO public constructor that can manufacture authority: the only
 * creators are gated on the genuine WP-6 validated trusted configuration
 * (capability) and on a genuine live capability (permits), and neither
 * creator is exported from the family barrel.
 */
import { isGenuineValidatedTrustedWorkspaceConfiguration } from '../../trusted/configuration-brand.js';
import { deriveRecordRelativePath } from '../../storage/layout/layout.js';
import {
  CORRELATION_PRODUCER_CAPABILITY_IDENTITY,
  CORRELATION_PUBLICATION_RECORD_CLASS,
  CORRELATION_SUPERSESSION_RECORD_CLASS,
} from '../types.js';

/** Capability check verdict (closed). */
export type CorrelationCapabilityCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not-genuine' | 'disposed' | 'stale-generation' | 'wrong-operation' };

/** Receipt-publication-correlation capability binding (informational; carries no brand state). */
export interface CorrelationCapabilityBinding {
  readonly configurationIdentity: string;
  /** Host-owned correlation action identity (branded provenance domain). */
  readonly actionIdentity: string;
  readonly operation: typeof CORRELATION_PRODUCER_CAPABILITY_IDENTITY;
  /** Private in-process generation identity; never persisted or serialized. */
  readonly generation: object;
}

/** Opaque in-process correlation capability (never serializable). */
export interface CorrelationCapability {
  /** Informational frozen binding; carries no brand state. */
  readonly binding: CorrelationCapabilityBinding;
  verify(): CorrelationCapabilityCheck;
  dispose(): void;
}

const capabilityBrand = new WeakSet<CorrelationCapability>();
const capabilityDisposed = new WeakSet<CorrelationCapability>();
/**
 * Correlation authority generation registry — INDEPENDENT of the
 * receipt-producer, result-publication, and outcome-recorder registries
 * (no shared generation namespace between the authority domains; changing
 * one domain's configuration never invalidates another domain's
 * capabilities). One current generation per authority lifecycle key (the
 * trusted configuration's workspace identity).
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
 * Gated correlation capability creator. Consumed ONLY by the trusted host
 * composition (`produce.ts`; never exported from the family barrel;
 * static-guard enforced). Requires the genuine WP-6 validated trusted
 * configuration (runtime-branded) plus the host-owned correlation action
 * identity. Multiple mints under one unchanged trusted configuration share
 * the current generation; a mint under a replacement configuration
 * identity advances the generation and makes every earlier capability
 * stale.
 */
export function createReceiptPublicationCorrelationCapability(input: {
  readonly trustedConfiguration: unknown;
  readonly actionIdentity: string;
}): CorrelationCapability | undefined {
  if (!isGenuineValidatedTrustedWorkspaceConfiguration(input.trustedConfiguration)) return undefined;
  const configuration = input.trustedConfiguration as { readonly identity: string; readonly workspaces?: readonly Readonly<{ readonly workspaceId?: unknown }>[] };
  if (typeof configuration.identity !== 'string' || configuration.identity.length === 0) return undefined;
  if (typeof input.actionIdentity !== 'string' || input.actionIdentity.length === 0) return undefined;
  const lifecycleKey = authorityLifecycleKey(configuration);
  if (lifecycleKey === undefined) return undefined;
  const generation = generationForAuthority(lifecycleKey, configuration.identity);
  if (generation === undefined) return undefined;
  const binding: CorrelationCapabilityBinding = Object.freeze({
    configurationIdentity: configuration.identity,
    actionIdentity: input.actionIdentity,
    operation: CORRELATION_PRODUCER_CAPABILITY_IDENTITY,
    generation,
  });
  const capability: CorrelationCapability = {
    binding,
    verify() {
      // The private brand must be carried by the receiver: a captured or
      // detached method reference fails here (CAP-015).
      if (!capabilityBrand.has(this as CorrelationCapability)) return { ok: false, reason: 'not-genuine' };
      if (capabilityDisposed.has(this as CorrelationCapability)) return { ok: false, reason: 'disposed' };
      const current = currentGenerationByAuthority.get(lifecycleKey);
      if (current === undefined || current.generation !== binding.generation) return { ok: false, reason: 'stale-generation' };
      return { ok: true };
    },
    dispose() {
      if (capabilityBrand.has(this as CorrelationCapability)) capabilityDisposed.add(this as CorrelationCapability);
    },
  };
  capabilityBrand.add(capability);
  return capability;
}

/** True only for a capability minted by this module in this process. */
export function isGenuineCorrelationCapability(value: unknown): value is CorrelationCapability {
  return value !== null && typeof value === 'object' && capabilityBrand.has(value as CorrelationCapability);
}

// ─── exact-record permits (two classes; §25) ────────────────────────────────

/** The correlation authority role bound into every Phase-2 permit. */
export const CORRELATION_PERMIT_ROLE = 'receipt-publication-correlation' as const;

/** Exact-record binding of one authorized successor ResultPublicationRecord publication. */
export interface CorrelationPublicationPermitBinding {
  /** Genuine correlation capability (never a path). */
  readonly capability: CorrelationCapability;
  /** Exact correlation authority role (closed). */
  readonly role: typeof CORRELATION_PERMIT_ROLE;
  /** Exact closed record class (never caller-selected). */
  readonly recordClass: typeof CORRELATION_PUBLICATION_RECORD_CLASS;
  /** Exact record identity. */
  readonly recordId: string;
  /** Exact record digest (canonical bytes digest). */
  readonly recordDigest: string;
  /** Exact digest of the canonical record bytes (equals recordDigest; bound independently). */
  readonly canonicalBytesDigest: string;
  /** Exact internally derived destination designation (relative; never a raw path). */
  readonly destinationDesignation: string;
}

/** Opaque in-process exact-record successor publication permit (never serializable). */
export interface CorrelationPublicationPermit {
  /** Informational frozen binding; carries no brand state. */
  readonly binding: CorrelationPublicationPermitBinding;
  dispose(): void;
}

/** Exact-record binding of one authorized SupersessionRecord publication. */
export interface CorrelationSupersessionPermitBinding {
  /** Genuine correlation capability (never a path). */
  readonly capability: CorrelationCapability;
  /** Exact correlation authority role (closed). */
  readonly role: typeof CORRELATION_PERMIT_ROLE;
  /** Exact closed record class (never caller-selected). */
  readonly recordClass: typeof CORRELATION_SUPERSESSION_RECORD_CLASS;
  /** Exact record identity. */
  readonly recordId: string;
  /** Exact record digest (canonical bytes digest). */
  readonly recordDigest: string;
  /** Exact digest of the canonical record bytes (equals recordDigest; bound independently). */
  readonly canonicalBytesDigest: string;
  /** Exact internally derived destination designation (relative; never a raw path). */
  readonly destinationDesignation: string;
}

/** Opaque in-process exact-record supersession permit (never serializable). */
export interface CorrelationSupersessionPermit {
  /** Informational frozen binding; carries no brand state. */
  readonly binding: CorrelationSupersessionPermitBinding;
  dispose(): void;
}

const publicationPermitBrand = new WeakSet<CorrelationPublicationPermit>();
const supersessionPermitBrand = new WeakSet<CorrelationSupersessionPermit>();
const permitDisposed = new WeakSet<object>();

const RECORD_ID_RE = /^pgw:l:[0-9a-f]{32}$/;
const DIGEST_RE = /^sha-256:[0-9a-f]{64}$/;

function permitBase(capability: unknown, role: string, recordClass: string, recordId: string, recordDigest: string, canonicalBytesDigest: string): { readonly capability: CorrelationCapability; readonly derived: { readonly relativePath: string } } | undefined {
  if (!isGenuineCorrelationCapability(capability)) return undefined;
  const cap = capability as CorrelationCapability;
  // Least authority at mint time: the capability must verify its operation.
  if (!cap.verify().ok) return undefined;
  if (role !== CORRELATION_PERMIT_ROLE) return undefined;
  if (!RECORD_ID_RE.test(recordId)) return undefined;
  if (!DIGEST_RE.test(recordDigest) || !DIGEST_RE.test(canonicalBytesDigest)) return undefined;
  if (recordDigest !== canonicalBytesDigest) return undefined;
  const derived = deriveRecordRelativePath(recordClass as never, recordId);
  if (!derived.ok) return undefined;
  return { capability: cap, derived };
}

/**
 * Gated exact-record successor-publication permit creator (sink-level
 * confinement). Minted INTERNALLY by the correlation authority immediately
 * before the successor write; the store boundary re-verifies the genuine
 * live permit and the capability before any filesystem access. The binding
 * is validated (class, digest syntax, destination derivation) before the
 * permit is branded.
 */
export function createCorrelationPublicationPermit(input: {
  readonly capability: unknown;
  readonly role: typeof CORRELATION_PERMIT_ROLE;
  readonly recordId: string;
  readonly recordDigest: string;
  readonly canonicalBytesDigest: string;
}): CorrelationPublicationPermit | undefined {
  const base = permitBase(input.capability, input.role, CORRELATION_PUBLICATION_RECORD_CLASS, input.recordId, input.recordDigest, input.canonicalBytesDigest);
  if (base === undefined) return undefined;
  const binding: CorrelationPublicationPermitBinding = Object.freeze({
    capability: base.capability,
    role: input.role,
    recordClass: CORRELATION_PUBLICATION_RECORD_CLASS,
    recordId: input.recordId,
    recordDigest: input.recordDigest,
    canonicalBytesDigest: input.canonicalBytesDigest,
    destinationDesignation: base.derived.relativePath,
  });
  const permit: CorrelationPublicationPermit = {
    binding,
    dispose() {
      if (publicationPermitBrand.has(this as CorrelationPublicationPermit)) permitDisposed.add(this as CorrelationPublicationPermit);
    },
  };
  publicationPermitBrand.add(permit);
  return permit;
}

/**
 * Gated exact-record supersession-permit creator (sink-level confinement).
 * Minted INTERNALLY by the correlation authority immediately before the
 * supersession write; the store boundary re-verifies the genuine live
 * permit and the capability before any filesystem access. The binding is
 * validated (class, digest syntax, destination derivation) before the
 * permit is branded.
 */
export function createCorrelationSupersessionPermit(input: {
  readonly capability: unknown;
  readonly role: typeof CORRELATION_PERMIT_ROLE;
  readonly recordId: string;
  readonly recordDigest: string;
  readonly canonicalBytesDigest: string;
}): CorrelationSupersessionPermit | undefined {
  const base = permitBase(input.capability, input.role, CORRELATION_SUPERSESSION_RECORD_CLASS, input.recordId, input.recordDigest, input.canonicalBytesDigest);
  if (base === undefined) return undefined;
  const binding: CorrelationSupersessionPermitBinding = Object.freeze({
    capability: base.capability,
    role: input.role,
    recordClass: CORRELATION_SUPERSESSION_RECORD_CLASS,
    recordId: input.recordId,
    recordDigest: input.recordDigest,
    canonicalBytesDigest: input.canonicalBytesDigest,
    destinationDesignation: base.derived.relativePath,
  });
  const permit: CorrelationSupersessionPermit = {
    binding,
    dispose() {
      if (supersessionPermitBrand.has(this as CorrelationSupersessionPermit)) permitDisposed.add(this as CorrelationSupersessionPermit);
    },
  };
  supersessionPermitBrand.add(permit);
  return permit;
}

/** True only for a permit minted by this module in this process. */
export function isGenuineCorrelationPublicationPermit(value: unknown): value is CorrelationPublicationPermit {
  return value !== null && typeof value === 'object' && publicationPermitBrand.has(value as CorrelationPublicationPermit);
}

/** True only for a permit minted by this module in this process. */
export function isGenuineCorrelationSupersessionPermit(value: unknown): value is CorrelationSupersessionPermit {
  return value !== null && typeof value === 'object' && supersessionPermitBrand.has(value as CorrelationSupersessionPermit);
}

/** Live-state check for a genuine permit (disposed permits are unusable). */
export function correlationPermitLive(permit: object): boolean {
  return !permitDisposed.has(permit);
}
