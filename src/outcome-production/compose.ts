/**
 * WP-13 durability S3 — trusted host composition (the ONE production
 * outcome-capability mint site).
 *
 * ADR-039 decision 3/§8: the `trusted-execution-outcome-recorder` capability
 * is minted ONLY by the trusted host composition. This module is that site:
 * it owns the genuine trusted workspace configuration and the trusted host
 * action/provenance context, builds the real S2 outcome store boundary, and
 * mints the branded generation-bound outcome capability. The capability is
 * held module-privately inside the returned authority closure — never
 * exported, never serialized, never handed to arbitrary execution callers.
 * The authority's `produce` injects the composed boundary + capability into
 * the S3 decision core, so every production outcome write flows through the
 * exact S2 → WP-8 path.
 *
 * The result-publication capability is NOT minted or held here (the two
 * WP-13 authority domains stay separate; the publication capability is
 * owned by the WP-13C composition). Generation semantics are preserved from
 * S2: multiple mints under one unchanged genuine trusted configuration share
 * the current generation; a genuine configuration replacement advances it.
 *
 * The S2 static guard asserts this file is the ONLY production mint site
 * (capability mentions across `src/**` = capability.ts definition + this
 * composition).
 */
import { createOutcomeStoreBoundary } from '../outcome/store-boundary.js';
import { createExecutionOutcomeCapability } from '../outcome/capability.js';
import { createPublicationStoreBoundary, publishValidatedResult } from '../publication/index.js';
import { createResultPublicationCapability } from '../publication/capability.js';
import { createPublicationOutcomePrecondition } from '../internal/publication-outcome-context.js';
import { produceExecutionOutcome } from './produce.js';
import type { OutcomeAuthorityInput, OutcomeProductionResult, PublicationAuthorityInput } from './types.js';
import type { OutcomeStoreBoundary } from '../outcome/types.js';
import type { PublicationResult } from '../publication/types.js';
import type { StorageWriteActionProvenance } from '../control-plane/storage-write-action.js';
import type { LockTimeSource } from '../storage/types.js';

/** Host composition options (the genuine trusted store/authority context). */
export interface ExecutionOutcomeAuthorityOptions {
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
  /** Host-owned outcome-recording action identity (branded provenance domain). */
  readonly actionIdentity: string;
  /** Host-owned result-publication action identity (WP-13C domain; the publication boundary + capability are minted here). */
  readonly publicationActionIdentity: string;
}

/** The composed outcome authority (capability internals never exposed). */
export interface ExecutionOutcomeAuthority {
  /**
   * The composed S2 outcome store boundary — the read surface the host
   * composition wires into the WP-13C outcome precondition. Never a write
   * path for arbitrary callers beyond `produce`.
   */
  readonly boundary: OutcomeStoreBoundary;
  /** Produce/replay exactly one outcome record through the composed S2 path. */
  readonly produce: (input: OutcomeAuthorityInput) => OutcomeProductionResult;
  /**
   * The trusted publication composition (SIR-WP13-DUR-S3-001): publishes a
   * validated result through the real WP-13C boundary with the genuine
   * branded outcome-precondition context injected from this composition's
   * genuine S2 boundary. The result-publication capability is held
   * module-privately and is never shared with arbitrary callers.
   */
  readonly publishResult: (input: PublicationAuthorityInput) => PublicationResult;
}

/**
 * Build the trusted outcome authority. Returns `undefined` when a genuine
 * capability or the branded precondition context cannot be minted (invalid
 * trusted configuration or action identity); the host fails closed.
 */
export function createExecutionOutcomeAuthority(options: ExecutionOutcomeAuthorityOptions): ExecutionOutcomeAuthority | undefined {
  let boundary: OutcomeStoreBoundary;
  try {
    boundary = createOutcomeStoreBoundary({
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
  const capability = createExecutionOutcomeCapability({
    trustedConfiguration: options.trustedConfiguration,
    actionIdentity: options.actionIdentity,
  });
  if (capability === undefined) return undefined;
  const outcomePrecondition = createPublicationOutcomePrecondition(boundary);
  if (outcomePrecondition === undefined) return undefined;
  let publicationBoundary: ReturnType<typeof createPublicationStoreBoundary>;
  try {
    publicationBoundary = createPublicationStoreBoundary({
      trustedConfiguration: options.trustedConfiguration,
      bootstrapInput: options.bootstrapInput,
      writeAction: options.writeAction,
      locator: options.locator,
      serviceUid: options.serviceUid,
      forbiddenRoots: options.forbiddenRoots,
      limitProfile: options.limitProfile,
      timeSource: options.lockTimeSource,
    });
  } catch {
    return undefined;
  }
  const publicationCapability = createResultPublicationCapability({
    trustedConfiguration: options.trustedConfiguration,
    actionIdentity: options.publicationActionIdentity,
  });
  if (publicationCapability === undefined) return undefined;
  const schemaRegistry = options.schemaRegistry;
  return Object.freeze({
    boundary,
    produce(input: OutcomeAuthorityInput): OutcomeProductionResult {
      return produceExecutionOutcome({ ...input, store: boundary, capability, schemaRegistry });
    },
    publishResult(input: PublicationAuthorityInput): PublicationResult {
      return publishValidatedResult({
        ...input,
        store: publicationBoundary,
        capability: publicationCapability,
        schemaRegistry,
        outcome: outcomePrecondition,
      });
    },
  });
}
