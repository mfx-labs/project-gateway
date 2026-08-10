/**
 * WP-13 durability S2 — execution-outcome-recorder capability +
 * exact-record publication permit.
 *
 * ADR-039 decision 3: the outcome-recorder authority holds an
 * outcome-recording capability that is (a) module-private (a WeakSet brand
 * not structurally representable by public fields), (b) generation-bound,
 * (c) minted ONLY by the trusted host composition — zero production
 * producers outside it (the creator is never exported from the package
 * barrel), and (d) re-verified at every mutation boundary and again at the
 * store-boundary sink.
 *
 * GENERATION SEMANTICS: the generation tracks the trusted
 * configuration/authority lifecycle — NOT individual capability minting
 * (the corrected WP-13C semantics, SIR-WP13C-002; the committed WP-8
 * `generationForStore` pattern). One current generation per authority
 * lifecycle key (the trusted configuration's workspace identity), recording
 * the configuration identity. Multiple mints under one unchanged genuine
 * trusted configuration SHARE the current generation; minting capability B
 * never invalidates capability A. The generation ADVANCES only when a mint
 * arrives under a DIFFERENT trusted configuration identity for the same
 * workspace (genuine configuration replacement). Disposal remains
 * per-capability. The generation registry is a SEPARATE map from the
 * result-publication authority's: the two domains share no generation
 * namespace, and changing one domain's configuration never invalidates the
 * other domain's capabilities.
 *
 * The exact-record publication permit (role `execution-outcome-recording`)
 * confines publication to exactly ONE `ExecutionOutcomeRecord`: the permit
 * binds the genuine capability, the exact record class, record identity,
 * record digest, canonical-byte digest, and the internally derived
 * destination designation; the sink re-derives the destination and
 * re-verifies the permit and the capability before any write. The permit is
 * process-local and structurally unforgeable; it contains no raw filesystem
 * path, descriptor, callback, or caller-selected class/destination.
 */
import { isGenuineValidatedTrustedWorkspaceConfiguration } from '../trusted/configuration-brand.js';
import { deriveRecordRelativePath } from '../storage/layout/layout.js';
import { EXECUTION_OUTCOME_OPERATION, EXECUTION_OUTCOME_RECORD_CLASS } from './types.js';
import type { ExecutionOutcomeOperation } from './types.js';

/** Capability check verdict (closed). */
export type OutcomeCapabilityCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not-genuine' | 'disposed' | 'stale-generation' | 'wrong-operation' };

/** Outcome-recorder capability binding (informational; carries no brand state). */
export interface ExecutionOutcomeCapabilityBinding {
  readonly configurationIdentity: string;
  /** Host-owned outcome-recording action identity (branded provenance domain). */
  readonly actionIdentity: string;
  readonly operation: ExecutionOutcomeOperation;
  /** Private in-process generation identity; never persisted or serialized. */
  readonly generation: object;
}

/** Opaque in-process outcome-recorder capability (never serializable). */
export interface ExecutionOutcomeCapability {
  /** Informational frozen binding; carries no brand state. */
  readonly binding: ExecutionOutcomeCapabilityBinding;
  verify(): OutcomeCapabilityCheck;
  dispose(): void;
}

const capabilityBrand = new WeakSet<ExecutionOutcomeCapability>();
const capabilityDisposed = new WeakSet<ExecutionOutcomeCapability>();
/**
 * Outcome-recorder generation registry — INDEPENDENT of the
 * result-publication registry (no shared generation namespace between the
 * two WP-13 authority domains). One current generation per authority
 * lifecycle key (the trusted configuration's workspace identity), recording
 * the configuration identity. A mint REUSES the recorded generation while
 * the configuration identity is unchanged; a mint under a DIFFERENT
 * configuration identity for the same workspace (genuine configuration
 * replacement) ADVANCES the generation.
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
 * Gated outcome-recorder capability creator. Consumed ONLY by the trusted
 * host composition (never exported from the package barrel; static-guard
 * enforced). Requires the genuine WP-6 validated trusted configuration
 * (runtime-branded) plus the host-owned outcome-recording action identity.
 * Multiple mints under one unchanged trusted configuration share the
 * current generation; a mint under a replacement configuration identity
 * advances the generation and makes every earlier capability stale.
 */
export function createExecutionOutcomeCapability(input: {
  readonly trustedConfiguration: unknown;
  readonly actionIdentity: string;
}): ExecutionOutcomeCapability | undefined {
  if (!isGenuineValidatedTrustedWorkspaceConfiguration(input.trustedConfiguration)) return undefined;
  const configuration = input.trustedConfiguration as { readonly identity: string; readonly workspaces?: readonly Readonly<{ readonly workspaceId?: unknown }>[] };
  if (typeof configuration.identity !== 'string' || configuration.identity.length === 0) return undefined;
  if (typeof input.actionIdentity !== 'string' || input.actionIdentity.length === 0) return undefined;
  const lifecycleKey = authorityLifecycleKey(configuration);
  if (lifecycleKey === undefined) return undefined;
  const generation = generationForAuthority(lifecycleKey, configuration.identity);
  if (generation === undefined) return undefined;
  const binding: ExecutionOutcomeCapabilityBinding = Object.freeze({
    configurationIdentity: configuration.identity,
    actionIdentity: input.actionIdentity,
    operation: EXECUTION_OUTCOME_OPERATION,
    generation,
  });
  const capability: ExecutionOutcomeCapability = {
    binding,
    verify() {
      if (!capabilityBrand.has(this as ExecutionOutcomeCapability)) return { ok: false, reason: 'not-genuine' };
      if (capabilityDisposed.has(this as ExecutionOutcomeCapability)) return { ok: false, reason: 'disposed' };
      const current = currentGenerationByAuthority.get(lifecycleKey);
      if (current === undefined || current.generation !== binding.generation) return { ok: false, reason: 'stale-generation' };
      return { ok: true };
    },
    dispose() {
      if (capabilityBrand.has(this as ExecutionOutcomeCapability)) capabilityDisposed.add(this as ExecutionOutcomeCapability);
    },
  };
  capabilityBrand.add(capability);
  return capability;
}

/** True only for a capability minted by this module in this process. */
export function isGenuineExecutionOutcomeCapability(value: unknown): value is ExecutionOutcomeCapability {
  return value !== null && typeof value === 'object' && capabilityBrand.has(value as ExecutionOutcomeCapability);
}

/** Exact-record binding of one authorized outcome-record publication. */
export interface ExecutionOutcomePermitBinding {
  /** Genuine outcome-recorder capability (never a path). */
  readonly capability: ExecutionOutcomeCapability;
  /** Exact outcome-recording role (closed; domain-scoped). */
  readonly role: 'execution-outcome-recording';
  /** Exact closed record class (never caller-selected). */
  readonly recordClass: 'execution-outcome-record';
  /** Exact record identity. */
  readonly recordId: string;
  /** Exact record digest (canonical bytes digest). */
  readonly recordDigest: string;
  /** Exact digest of the canonical record bytes (equals recordDigest; bound independently). */
  readonly canonicalBytesDigest: string;
  /** Exact internally derived destination designation (relative; never a raw path). */
  readonly destinationDesignation: string;
}

/** Opaque in-process exact-record outcome permit (never serializable). */
export interface ExecutionOutcomePermit {
  /** Informational frozen binding; carries no brand state. */
  readonly binding: ExecutionOutcomePermitBinding;
  dispose(): void;
}

const permitBrand = new WeakSet<ExecutionOutcomePermit>();
const permitDisposed = new WeakSet<ExecutionOutcomePermit>();

function freezePermitBinding(binding: ExecutionOutcomePermitBinding): ExecutionOutcomePermitBinding {
  return Object.freeze(binding);
}

/**
 * Gated exact-record outcome permit creator (sink-level confinement).
 * Minted by the outcome authority (S3) immediately before the write; the
 * store boundary re-verifies the genuine live permit and the capability
 * before any filesystem access. The binding is validated (digest syntax,
 * destination derivation) before the permit is branded. A capability from
 * ANY other authority domain (for example the result-publication brand)
 * never mints an outcome permit.
 */
export function createExecutionOutcomePermit(input: {
  readonly capability: unknown;
  readonly role: 'execution-outcome-recording';
  readonly recordId: string;
  readonly recordDigest: string;
  readonly canonicalBytesDigest: string;
}): ExecutionOutcomePermit | undefined {
  if (!isGenuineExecutionOutcomeCapability(input.capability)) return undefined;
  const capability = input.capability as ExecutionOutcomeCapability;
  // Least authority at mint time: the capability must verify its operation.
  if (!capability.verify().ok) return undefined;
  if (input.role !== 'execution-outcome-recording') return undefined;
  if (!/^pgw:l:[0-9a-f]{32}$/.test(input.recordId)) return undefined;
  if (!/^sha-256:[0-9a-f]{64}$/.test(input.recordDigest) || !/^sha-256:[0-9a-f]{64}$/.test(input.canonicalBytesDigest)) return undefined;
  if (input.recordDigest !== input.canonicalBytesDigest) return undefined;
  const derived = deriveRecordRelativePath(EXECUTION_OUTCOME_RECORD_CLASS, input.recordId);
  if (!derived.ok) return undefined;
  const binding = freezePermitBinding({
    capability,
    role: input.role,
    recordClass: EXECUTION_OUTCOME_RECORD_CLASS,
    recordId: input.recordId,
    recordDigest: input.recordDigest,
    canonicalBytesDigest: input.canonicalBytesDigest,
    destinationDesignation: derived.relativePath,
  });
  const permit: ExecutionOutcomePermit = {
    binding,
    dispose() {
      if (permitBrand.has(this as ExecutionOutcomePermit)) permitDisposed.add(this as ExecutionOutcomePermit);
    },
  };
  permitBrand.add(permit);
  return permit;
}

/** True only for a permit minted by this module in this process. */
export function isGenuineExecutionOutcomePermit(value: unknown): value is ExecutionOutcomePermit {
  return value !== null && typeof value === 'object' && permitBrand.has(value as ExecutionOutcomePermit);
}

/** Live-state check for a genuine permit (disposed permits are unusable). */
export function executionOutcomePermitLive(permit: ExecutionOutcomePermit): boolean {
  if (!permitBrand.has(permit)) return false;
  return !permitDisposed.has(permit);
}
