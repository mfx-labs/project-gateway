/**
 * WP-15 Phase 1B — trusted host composition (the ONE production
 * trusted-receipt capability mint site; SIR-WP15-P1B-002).
 *
 * §25: receipt issuance is a trusted local control-plane capability — NOT a
 * general MCP/user-facing tool. This module is the explicit host
 * composition: it owns the genuine trusted workspace configuration and the
 * trusted host action/provenance context, builds the real single-class
 * receipt store boundary, mints the branded generation-bound
 * trusted-receipt capability, and CLOSES OVER every trusted dependency —
 * the current-registry provider, the trusted identity/clock source, the
 * event-subject coordinator, the schema registry, and any host-only test
 * seam.
 *
 * The returned authority surface is exactly:
 *
 *   authority.issue(request: ReceiptRequest): ReceiptResult
 *
 * The issuer nominates ONLY the three non-authoritative request keys
 * (workspaceId, eventType, eventRecordId). The authority holder CANNOT
 * supply per-call registry context, identity/time, coordinator, capability,
 * hooks, schema registry, store, or provenance — trusted infrastructure is
 * closed over by this composition (SIR-WP15-P1B-002 §5/§6/§7/§9/§10). The
 * host-owned registry provider is invoked per issuance and returns the
 * genuinely accepted current `AcceptedRegistryContext` (branded snapshot;
 * the authority re-verifies genuineness through the committed
 * `isBrandedRegistry` primitive). The trusted clock lives in the identity
 * source; the authority holder cannot choose `now` or the validity instant.
 *
 * The capability creator is never exported from the family barrel; the
 * static guard asserts this file is the ONLY production mint site. The
 * generation registry is independent of the result-publication and
 * outcome-recorder registries (no shared generation namespace between
 * authority domains).
 */
import { createReceiptStoreBoundary } from './store.js';
import { createTrustedReceiptCapability } from './internal/brand.js';
import { issueTrustedReceipt } from './authority.js';
import type { ReceiptIdentitySource, ReceiptInput, ReceiptRequest, ReceiptResult } from './types.js';
import type { StorageWriteActionProvenance } from '../control-plane/storage-write-action.js';
import type { DecisionCoordinator } from '../control-plane/types.js';
import type { LockTimeSource } from '../storage/types.js';
import type { AcceptedRegistryContext } from '../api/types.js';

/** Host composition options (the genuine trusted store/authority context). */
export interface ReceiptProducerAuthorityOptions {
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
  /** Host-owned receipt-production action identity (branded provenance domain). */
  readonly actionIdentity: string;
  /**
   * Host-owned current-registry provider (SIR-WP15-P1B-002 §9): called once
   * per issuance; MUST return a genuinely accepted current
   * `AcceptedRegistryContext` (branded snapshot — the authority re-verifies
   * through the committed `isBrandedRegistry` primitive). The issuer can
   * never choose registry identity. A throwing provider is a typed internal
   * failure.
   */
  readonly registryProvider: () => AcceptedRegistryContext;
  /** Host-owned trusted identity/clock source (`nowUtcIso` + `newRecordId`). */
  readonly identity: ReceiptIdentitySource;
  /** Host-owned event-subject decision coordinator (FSCR-W12-001 pattern). */
  readonly coordinate: DecisionCoordinator;
  /**
   * Host-only test seam (SIR-WP15-P1B-002 §7): closed over at construction;
   * never an issuer operand.
   */
  readonly hooks?: { readonly beforeFirstReceiptPublication?: () => void };
}

/** The composed receipt authority (capability internals never exposed). */
export interface ReceiptProducerAuthority {
  /**
   * Issue/replay exactly one TrustedReceipt. The caller nominates ONLY the
   * narrow `ReceiptRequest`; every trusted dependency is host-closed.
   */
  readonly issue: (request: ReceiptRequest) => ReceiptResult;
}

/**
 * Build the trusted receipt producer authority. Returns `undefined` when a
 * genuine capability cannot be minted (invalid trusted configuration or
 * action identity); the host fails closed.
 */
export function createReceiptProducerAuthority(options: ReceiptProducerAuthorityOptions): ReceiptProducerAuthority | undefined {
  let boundary: ReturnType<typeof createReceiptStoreBoundary>;
  try {
    boundary = createReceiptStoreBoundary({
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
  const capability = createTrustedReceiptCapability({
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
    issue(request: ReceiptRequest): ReceiptResult {
      // Host-owned current-registry resolution (per issuance; §9). The
      // issuer cannot supply or substitute registry truth.
      let registry: AcceptedRegistryContext;
      try {
        registry = registryProvider();
      } catch {
        return { ok: false, category: 'RECEIPT-INTERNAL-FAILURE', code: 'registry.provider-failed', message: 'the host-owned registry provider raised an unexpected exception' };
      }
      const input: ReceiptInput = {
        request,
        registry,
        store: boundary,
        coordinate,
        identity,
        schemaRegistry,
        capability,
        ...(hooks !== undefined ? { hooks } : {}),
      };
      return issueTrustedReceipt(input);
    },
  });
}
