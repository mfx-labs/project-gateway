/**
 * WP-15 Phase 2 — trusted host composition (the ONE production
 * correlation capability mint site).
 *
 * §5: the correlation transition is a trusted local control-plane
 * capability — NOT a general MCP/user-facing tool. This module is the
 * explicit host composition: it owns the genuine trusted workspace
 * configuration and the trusted host action/provenance context, builds the
 * real two-class correlation store boundary, mints the branded
 * generation-bound receipt-publication-correlation capability, and CLOSES
 * OVER every trusted dependency — the current-registry provider, the
 * trusted identity/clock source, the publication-correlation coordinator,
 * the schema registry, and any host-only test seam.
 *
 * The returned authority surface is exactly:
 *
 *   authority.correlate(request: CorrelationRequest): CorrelationResult
 *
 * The caller nominates ONLY the three non-authoritative request keys
 * (workspaceId, predecessorPublicationRecordId, trustedReceiptRecordId).
 * The authority holder CANNOT supply per-call registry context,
 * identity/time, coordinator, capability, hooks, schema registry, store,
 * or provenance — trusted infrastructure is closed over by this
 * composition (SIR-WP15-P1B-002 pattern). The host-owned registry provider
 * is invoked per correlation and returns the genuinely accepted current
 * `AcceptedRegistryContext` (branded snapshot; the authority re-verifies
 * genuineness through the committed `isBrandedRegistry` primitive). The
 * trusted clock lives in the identity source; the authority holder cannot
 * choose `now`.
 *
 * The capability creator is never exported from the family barrel; the
 * static guard asserts this file is the ONLY production mint site. The
 * generation registry is independent of the receipt-producer,
 * result-publication, and outcome-recorder registries (no shared
 * generation namespace between authority domains).
 */
import { createCorrelationStoreBoundary } from './store.js';
import { createReceiptPublicationCorrelationCapability } from './internal/brand.js';
import { correlateReceiptPublication } from './authority.js';
import type { CorrelationIdentitySource, CorrelationInput, CorrelationRequest, CorrelationResult } from './types.js';
import type { StorageWriteActionProvenance } from '../control-plane/storage-write-action.js';
import type { DecisionCoordinator } from '../control-plane/types.js';
import type { LockTimeSource } from '../storage/types.js';
import type { AcceptedRegistryContext } from '../api/types.js';

/** Host composition options (the genuine trusted store/authority context). */
export interface CorrelationAuthorityOptions {
  /** Genuine WP-6 validated trusted configuration (runtime-branded). */
  readonly trustedConfiguration: unknown;
  /** Genuine branded `TrustedStorageBootstrapInput`. */
  readonly bootstrapInput: unknown;
  /** Host-owned write-action fields (minted into the genuine provenance at the boundary). */
  readonly writeAction: StorageWriteActionProvenance;
  /** Correlated raw fields (verified for exact equality against the provenance). */
  readonly locator: string;
  readonly serviceUid: number;
  readonly forbiddenRoots: readonly string[];
  readonly limitProfile: Readonly<Record<string, number>>;
  /** Injected time/identity sources for the WP-8 lock module (D-3). */
  readonly lockTimeSource: LockTimeSource;
  /** Offline schema registry for the committed lifecycle record schema gate. */
  readonly schemaRegistry: unknown;
  /** Host-owned correlation action identity (branded provenance domain). */
  readonly actionIdentity: string;
  /**
   * Host-owned current-registry provider: called once per correlation;
   * MUST return a genuinely accepted current `AcceptedRegistryContext`
   * (branded snapshot — the authority re-verifies through the committed
   * `isBrandedRegistry` primitive). The caller can never choose registry
   * identity. A throwing provider is a typed internal failure.
   */
  readonly registryProvider: () => AcceptedRegistryContext;
  /** Host-owned trusted identity/clock source (`nowUtcIso` + `newRecordId`). */
  readonly identity: CorrelationIdentitySource;
  /** Host-owned publication-correlation decision coordinator (FSCR-W12-001 pattern). */
  readonly coordinate: DecisionCoordinator;
  /**
   * Host-only test seam: closed over at construction; never a caller
   * operand.
   */
  readonly hooks?: { readonly beforeFirstSuccessorPublication?: () => void; readonly beforeFirstSupersessionPublication?: () => void };
}

/** The composed correlation authority (capability internals never exposed). */
export interface CorrelationAuthority {
  /**
   * Correlate/replay/recover the exact receipt-correlated successor
   * transition. The caller nominates ONLY the narrow `CorrelationRequest`;
   * every trusted dependency is host-closed.
   */
  readonly correlate: (request: CorrelationRequest) => CorrelationResult;
}

/**
 * Build the trusted receipt-publication-correlation authority. Returns
 * `undefined` when a genuine capability cannot be minted (invalid trusted
 * configuration or action identity); the host fails closed.
 */
export function createReceiptPublicationCorrelationAuthority(options: CorrelationAuthorityOptions): CorrelationAuthority | undefined {
  let boundary: ReturnType<typeof createCorrelationStoreBoundary>;
  try {
    boundary = createCorrelationStoreBoundary({
      trustedConfiguration: options.trustedConfiguration,
      bootstrapInput: options.bootstrapInput,
      writeAction: options.writeAction,
      locator: options.locator,
      serviceUid: options.serviceUid,
      forbiddenRoots: options.forbiddenRoots,
      limitProfile: options.limitProfile,
      timeSource: options.lockTimeSource,
      schemaRegistry: options.schemaRegistry,
    });
  } catch {
    return undefined;
  }
  const capability = createReceiptPublicationCorrelationCapability({
    trustedConfiguration: options.trustedConfiguration,
    actionIdentity: options.actionIdentity,
  });
  if (capability === undefined) return undefined;
  const schemaRegistry = options.schemaRegistry;
  const registryProvider = options.registryProvider;
  const identity = options.identity;
  const coordinate = options.coordinate;
  const hooks = options.hooks;
  return Object.freeze({
    correlate(request: CorrelationRequest): CorrelationResult {
      // Host-owned current-registry resolution (per correlation). The
      // caller cannot supply or substitute registry truth.
      let registry: AcceptedRegistryContext;
      try {
        registry = registryProvider();
      } catch {
        return { ok: false, category: 'CORRELATION-INTERNAL-FAILURE', code: 'registry.provider-failed', message: 'the host-owned registry provider raised an unexpected exception' };
      }
      const input: CorrelationInput = {
        request,
        registry,
        store: boundary,
        coordinate,
        identity,
        schemaRegistry,
        capability,
        ...(hooks !== undefined ? { hooks } : {}),
      };
      return correlateReceiptPublication(input);
    },
  });
}
