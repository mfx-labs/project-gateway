/**
 * WP-8-C trusted-root initialization orchestrator (ADR-028 decisions C/F;
 * sequence per the decision baseline). Filesystem-free: all filesystem work
 * is delegated to the root, provision, probe, and metadata modules, each of
 * which revalidates the still-live genuine one-shot initialization
 * capability at every mutation boundary.
 *
 * Production initialization is UNREACHABLE: the orchestrator requires a
 * genuine `StorageBootstrapActionProvenance`, and the storage-side
 * action-provenance creator has no production importer (its only consumer is
 * the future `src/control-plane/storage-bootstrap-action.ts`, which does not
 * exist). Tests exercise the complete flow through test-only producers.
 *
 * The capability is disposed on every exit path (success and failure).
 * Namespace identities and StoreMetadata digests are initialization results,
 * never retroactive capability bindings.
 */
import { createTrustedStorageBootstrapInput } from '../trusted-input/bootstrap-input.js';
import { createInitializationCapability } from '../capabilities/authenticity.js';
import { validateAndCaptureParent, checkForbiddenRootOverlap, revalidateParentIdentity } from '../root/resolve.js';
import { classifyNamespace, metadataFilePath, namespaceRootPath, provisionNamespaceRoots, verifyNamespaceDescriptor } from './provision.js';
import { classifyAggregateState } from './state.js';
import { runCompatibilityProbe } from '../probe/probe.js';
import { buildStoreMetadata } from '../metadata/store-metadata.js';
import { persistMetadata, replayMetadata } from '../metadata/bootstrap-persist.js';
import type { ErrorStateSummary, InitializationResult, InitializationStateKind, NamespaceKind, OperationPhase, ProbeResultProfile, RootIdentity, StorageFinding, StoreMetadataExpectation, StoreMetadataFacts } from '../types.js';

const LANE = 'posix-0700';
const LAYOUT_VERSION = 'v1';
const METADATA_FORMAT_VERSION = '1';

const NO_STATE: ErrorStateSummary = {
  retryable: false,
  recoveryRequired: false,
  primaryStateChanged: 'no',
  durabilityPointReached: 'no',
  auditChanged: 'no',
  verifyBeforeRetry: false,
};

const UNKNOWN_STATE: ErrorStateSummary = {
  retryable: false,
  recoveryRequired: false,
  primaryStateChanged: 'unknown',
  durabilityPointReached: 'unknown',
  auditChanged: 'unknown',
  verifyBeforeRetry: true,
};

function finding(code: string, message: string, phase: OperationPhase = 'request-validation', state: ErrorStateSummary = NO_STATE): StorageFinding {
  return { code, message, phase, state };
}

function failResult(findings: readonly StorageFinding[]): InitializationResult {
  return { ok: false, findings };
}

export interface InitializeRequest {
  /** Genuine WP-6 validated trusted configuration (runtime-branded). */
  readonly trustedConfiguration: unknown;
  /** Genuine storage-bootstrap action provenance (test-only producer in WP-8-C). */
  readonly actionProvenance: unknown;
  /** Correlated raw fields (verified for exact equality against the provenance). */
  readonly locator: string;
  readonly serviceUid: number;
  readonly forbiddenRoots: readonly string[];
  readonly limitProfile: Readonly<Record<string, number>>;
}

const NAMESPACE_KINDS: readonly NamespaceKind[] = ['configuration', 'store-records'];

interface NamespaceFacts {
  readonly kind: NamespaceKind;
  readonly identity?: { readonly kind: NamespaceKind; readonly canonicalPath: string; readonly dev: number; readonly ino: number };
}

function expectation(
  parent: RootIdentity,
  facts: NamespaceFacts,
  input: { readonly actionIdentity: string; readonly configurationIdentity: string },
  configurationVersion: string,
): StoreMetadataExpectation {
  return {
    metadataFormatVersion: METADATA_FORMAT_VERSION,
    layoutVersion: LAYOUT_VERSION,
    namespaceKind: facts.kind,
    namespaceIdentity: facts.identity ?? { kind: facts.kind, canonicalPath: '', dev: 0, ino: 0 },
    parentIdentity: parent,
    lane: LANE,
    configurationIdentity: input.configurationIdentity,
    actionIdentity: input.actionIdentity,
    limitProfileIdentity: { configurationVersion, configurationIdentity: input.configurationIdentity },
  };
}

function fullFacts(
  identity: NonNullable<NamespaceFacts['identity']>,
  parent: RootIdentity,
  input: { readonly actionIdentity: string; readonly configurationIdentity: string },
  probe: ProbeResultProfile,
  configurationVersion: string,
): StoreMetadataFacts {
  return {
    metadataFormatVersion: METADATA_FORMAT_VERSION,
    layoutVersion: LAYOUT_VERSION,
    namespaceKind: identity.kind,
    namespaceIdentity: identity,
    parentIdentity: parent,
    lane: LANE,
    probe,
    configurationIdentity: input.configurationIdentity,
    actionIdentity: input.actionIdentity,
    limitProfileIdentity: { configurationVersion, configurationIdentity: input.configurationIdentity },
  };
}

/** Replay classification: exact match → INITIALIZED; version/format/malformed/integrity fail closed distinctly. */
function replayClassification(code: string | undefined): InitializationStateKind {
  switch (code) {
    case 'ERR-STO-UNSUPPORTED-VERSION':
      return 'UNSUPPORTED_VERSION';
    case 'ERR-STO-MALFORMED':
      return 'MALFORMED_METADATA';
    default:
      return 'FOREIGN';
  }
}

/**
 * Initialize the trusted store. Every exit path disposes the one-shot
 * capability. Fail-closed aggregate states are never repaired.
 */
export function initializeTrustedStore(request: InitializeRequest): InitializationResult {
  let capability: ReturnType<typeof createInitializationCapability> | undefined;
  try {
    const inputResult = createTrustedStorageBootstrapInput(
      request.trustedConfiguration,
      request.actionProvenance,
      { locator: request.locator, serviceUid: request.serviceUid, forbiddenRoots: request.forbiddenRoots, limitProfile: request.limitProfile },
    );
    if (!inputResult.ok || inputResult.input === undefined) {
      const code = inputResult.reason === 'not-genuine-configuration' || inputResult.reason === 'not-genuine-action-provenance' || inputResult.reason === 'configuration-identity-mismatch'
        ? 'ERR-STO-CONFIG-UNAVAILABLE'
        : 'ERR-STO-REQ-INVALID';
      return failResult([finding(code, inputResult.message ?? 'trusted bootstrap input could not be established')]);
    }
    const input = inputResult.input;

    const parent = validateAndCaptureParent(input.locator, input.serviceUid, input.forbiddenRoots);
    if (!parent.ok || parent.identity === undefined) {
      return failResult([finding(parent.code ?? 'ERR-STO-ROOT-INVALID', parent.message ?? 'trusted parent validation failed')]);
    }
    const overlap = checkForbiddenRootOverlap(parent.identity, input.forbiddenRoots);
    if (!overlap.ok) {
      return failResult([finding(overlap.code ?? 'ERR-STO-ROOT-INVALID', overlap.message ?? 'trusted parent overlaps a forbidden root')]);
    }

    const configuration = request.trustedConfiguration as { readonly configurationVersion: string; readonly identity: string };
    capability = createInitializationCapability({ trustedInput: input, parentIdentity: parent.identity });
    if (capability === undefined) {
      return failResult([finding('ERR-STO-REQ-INVALID', 'initialization capability could not be issued')]);
    }
    const bound = capability.assertExpected({
      parentIdentity: parent.identity,
      configurationIdentity: input.configurationIdentity,
      serviceUid: input.serviceUid,
      limitProfile: input.limitProfile,
    });
    if (!bound.ok) {
      return failResult([finding('ERR-STO-REQ-INVALID', 'initialization capability binding mismatch')]);
    }
    const verified = capability.verify('namespace-initialize');
    if (!verified.ok) {
      return failResult([finding('ERR-STO-REQ-INVALID', 'initialization capability is not usable')]);
    }

    // Aggregate state classification (two-phase: entries first, then metadata replay).
    const namespaceStates = [];
    const replayDigests: { readonly namespaceKind: NamespaceKind; readonly recordByteDigest: string }[] = [];
    for (const kind of NAMESPACE_KINDS) {
      const base = classifyNamespace(capability, parent.identity, kind, input.serviceUid, false);
      let state = base.state;
      if (base.entries.includes('metadata') && base.state !== 'FOREIGN' && base.state !== 'IDENTITY_DRIFTED') {
        const root = namespaceRootPath(parent.identity.canonicalPath, kind);
        const replay = replayMetadata(capability, metadataFilePath(root), expectation(parent.identity, base, input, configuration.configurationVersion), input.serviceUid);
        if (replay.ok && replay.metadata !== undefined) {
          // W8C-S03: the verification-only INITIALIZED path still verifies the
          // namespace root itself — opened descriptor is a directory, configured
          // service UID, exact mode 0700, no-follow, and identity matches the
          // classified namespace identity. Wrong UID/mode/type or drift fails
          // closed and is never silently repaired.
          const nsVerify = verifyNamespaceDescriptor(capability, root, input.serviceUid);
          const classified = base.identity;
          if (!nsVerify.ok || nsVerify.identity === undefined) {
            state = 'IDENTITY_DRIFTED';
          } else if (classified === undefined || nsVerify.identity.dev !== classified.dev || nsVerify.identity.ino !== classified.ino) {
            state = 'IDENTITY_DRIFTED';
          } else {
            state = 'INITIALIZED';
            replayDigests.push({ namespaceKind: kind, recordByteDigest: replay.metadata.recordByteDigest });
          }
        } else {
          state = replayClassification(replay.code);
        }
      }
      namespaceStates.push({ ...base, state });
    }
    const aggregate = classifyAggregateState(namespaceStates);
    if (aggregate.state === 'INITIALIZED') {
      // Exact fully initialized aggregate: verification-only idempotent result.
      return {
        ok: true,
        state: 'INITIALIZED',
        parentIdentity: parent.identity,
        namespaceIdentities: namespaceStates.map((ns) => ns.identity).filter((i): i is NonNullable<typeof i> => i !== undefined),
        metadataDigests: replayDigests,
        findings: [],
      };
    }
    if (aggregate.state !== 'ABSENT' && aggregate.state !== 'PROVISIONAL') {
      const code = aggregate.state === 'PARTIAL'
        ? 'ERR-STO-RECOVERY-REQUIRED'
        : aggregate.state === 'UNSUPPORTED_VERSION'
          ? 'ERR-STO-UNSUPPORTED-VERSION'
          : 'ERR-STO-INTEGRITY';
      return failResult([finding(code, `aggregate initialization state ${aggregate.state} fails closed without repair`)]);
    }

    // Provision fixed directories (capability-gated at every boundary).
    const provisioned = provisionNamespaceRoots(capability, parent.identity, input.serviceUid);
    if (!provisioned.ok) {
      return failResult([finding(provisioned.code ?? 'ERR-STO-IO-FAILURE', provisioned.message ?? 'fixed-directory provisioning failed')]);
    }
    const configRoot = namespaceRootPath(parent.identity.canonicalPath, 'configuration');
    const storeRoot = namespaceRootPath(parent.identity.canonicalPath, 'store-records');
    const configNs = verifyNamespaceDescriptor(capability, configRoot, input.serviceUid);
    const storeNs = verifyNamespaceDescriptor(capability, storeRoot, input.serviceUid);
    if (!configNs.ok || !storeNs.ok || configNs.identity === undefined || storeNs.identity === undefined) {
      return failResult([finding('ERR-STO-ROOT-IDENTITY-CHANGED', 'namespace root could not be revalidated after provisioning')]);
    }

    // Bounded compatibility probe inside both verified tmp/ directories.
    const probe = runCompatibilityProbe(capability, input.actionIdentity, `${configRoot}/tmp`, `${storeRoot}/tmp`);
    if (!probe.ok || probe.profile === undefined) {
      return failResult([finding(probe.code ?? 'ERR-STO-FS-UNSUPPORTED', probe.message ?? 'filesystem compatibility probe failed')]);
    }

    // Immutable StoreMetadata per namespace + bootstrap persistence (durability point).
    const digests: { readonly namespaceKind: NamespaceKind; readonly recordByteDigest: string }[] = [];
    const identities = [configNs.identity, storeNs.identity];
    for (const identity of identities) {
      const facts = fullFacts(identity, parent.identity, input, probe.profile, configuration.configurationVersion);
      const built = buildStoreMetadata(facts);
      if (!built.ok || built.metadata === undefined) {
        return failResult([finding(built.code ?? 'ERR-STO-INTERNAL-INVARIANT', built.message ?? 'metadata could not be built')]);
      }
      const root = namespaceRootPath(parent.identity.canonicalPath, identity.kind);
      const persisted = persistMetadata(capability, metadataFilePath(root), built.metadata, input.serviceUid, `${root}/metadata`, root);
      if (!persisted.ok || persisted.metadata === undefined) {
        // One namespace durable, the other not: fail closed; state is reported truthfully.
        const code = persisted.code ?? 'ERR-STO-DURABILITY';
        const state = code === 'ERR-STO-DURABILITY' ? UNKNOWN_STATE : NO_STATE;
        return failResult([finding(code, persisted.message ?? 'metadata persistence failed; partial authoritative state may exist', 'pre-publication', state)]);
      }
      digests.push({ namespaceKind: identity.kind, recordByteDigest: persisted.metadata.recordByteDigest });
    }

    // Point-of-use parent revalidation before reporting success (SRX-013).
    const revalidated = revalidateParentIdentity(parent.identity, input.serviceUid);
    if (!revalidated.ok) {
      return failResult([finding(revalidated.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', revalidated.message ?? 'trusted parent identity changed during initialization')]);
    }
    return {
      ok: true,
      state: 'INITIALIZED',
      parentIdentity: parent.identity,
      namespaceIdentities: identities,
      metadataDigests: digests,
      findings: [],
    };
  } finally {
    capability?.dispose();
  }
}
