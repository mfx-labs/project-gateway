/**
 * WP-9 Slice 5 — trusted startup composition root for the local stdio MCP
 * runtime.
 *
 * The CLI is an in-package trusted composition root: it uses the exact
 * PRIVATE/TRUSTED repository composition APIs (genuine validated trusted
 * workspace configuration, genuine storage bootstrap action provenance,
 * genuine branded `TrustedStorageBootstrapInput`) to reconstruct existing
 * trusted registrations from the operator-owned startup configuration, then
 * builds the committed host-owned registry.
 *
 * Trust creators are imported HERE ONLY (localized composition root, per the
 * runtime static guard). They are never re-exported through `./mcp` or any
 * package subpath, and MCP requests never carry roots or locators.
 */
import { markValidatedTrustedWorkspaceConfiguration } from '../../trusted/configuration-brand.js';
import {
  createStorageBootstrapActionProvenance,
  createTrustedStorageBootstrapInput,
} from '../../storage/trusted-input/bootstrap-input.js';
import { createInitializationCapability } from '../../storage/capabilities/authenticity.js';
import { verifyStoreInstance } from '../../storage/read/read-record.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../storage/limits/limits.js';
import { createMcpInspectionRegistry, type McpInspectionRegistry } from '../../adapters/mcp/index.js';
import type { RuntimeConfig } from './config.js';

const BOOTSTRAP_ACTION_IDENTITY = 'project-gateway-mcp-bootstrap';

export type ComposeResult = { readonly ok: true; readonly registry: McpInspectionRegistry } | { readonly ok: false; readonly code: string; readonly message: string };

/** Build the trusted registry from the validated operator startup configuration. */
export function composeTrustedRegistry(config: RuntimeConfig): ComposeResult {
  const registrations: { readonly surfaceId: string; readonly trustedConfiguration: object; readonly trustedInput: unknown }[] = [];
  for (const surface of config.surfaces) {
    const limitProfile: SelectedLimitProfile = { ...defaultLimitProfile(), ...surface.limitProfile };
    // The trusted configuration object carries the standard repository facts;
    // `identity` is the operator-supplied configuration identity that the
    // store metadata binds (verifyStoreInstance re-checks it at composition
    // and the domain re-checks it on every request).
    const trustedConfiguration = {
      configurationVersion: surface.configurationVersion,
      capabilityVocabularyVersion: '1',
      hostLane: 'pi',
      provenance: { sourceKind: 'control-plane' },
      workspaces: [],
      identity: surface.configurationIdentity,
    };
    markValidatedTrustedWorkspaceConfiguration(trustedConfiguration);
    const provenance = createStorageBootstrapActionProvenance({
      actionIdentity: BOOTSTRAP_ACTION_IDENTITY,
      locator: surface.locator,
      serviceUid: surface.serviceUid,
      forbiddenRoots: surface.forbiddenRoots,
      configurationIdentity: surface.configurationIdentity,
      limitProfile,
    });
    const inputResult = createTrustedStorageBootstrapInput(trustedConfiguration, provenance, {
      locator: surface.locator,
      serviceUid: surface.serviceUid,
      forbiddenRoots: surface.forbiddenRoots,
      limitProfile,
    });
    if (!inputResult.ok) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: `surface ${surface.surfaceId} trusted bootstrap failed: ${inputResult.reason}` };
    }
    // In-process capability-generation seeding: the domain's read/verify
    // capability issuance observes the in-process generation registry, which
    // is normally established by in-process initialization. A fresh gateway
    // process reads stores initialized elsewhere, so the composition root
    // re-establishes the verified store instance and seeds the generation
    // entry by creating an initialization capability that is NEVER used for
    // any mutation operation and is disposed immediately. No initialization
    // or filesystem mutation is performed; the capability cannot outlive
    // composition.
    const storeResult = verifyStoreInstance({
      locator: surface.locator,
      serviceUid: surface.serviceUid,
      forbiddenRoots: surface.forbiddenRoots,
      configurationIdentity: surface.configurationIdentity,
      configurationVersion: surface.configurationVersion,
      limitProfile,
    });
    if (!storeResult.ok || storeResult.storeInstance === undefined) {
      return { ok: false, code: storeResult.code ?? 'ERR-STO-INTEGRITY', message: storeResult.message ?? `surface ${surface.surfaceId} store verification failed` };
    }
    const generationCapability = createInitializationCapability({
      trustedInput: inputResult.input,
      parentIdentity: storeResult.storeInstance.parentIdentity,
    });
    if (generationCapability === undefined) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: `surface ${surface.surfaceId} generation seeding failed` };
    }
    generationCapability.dispose();
    registrations.push({ surfaceId: surface.surfaceId, trustedConfiguration, trustedInput: inputResult.input });
  }
  const registryResult = createMcpInspectionRegistry({
    registrations: registrations.map((r) => ({
      surfaceId: r.surfaceId,
      trustedConfiguration: r.trustedConfiguration,
      trustedInput: r.trustedInput,
    })),
  });
  if (!registryResult.ok || registryResult.registry === undefined) {
    return { ok: false, code: registryResult.code ?? 'ERR-STO-REQ-INVALID', message: registryResult.message ?? 'registry composition failed' };
  }
  return { ok: true, registry: registryResult.registry };
}
