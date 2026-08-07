/**
 * WP-9 MCP inspection surface — host-supplied inspection context (slice 1).
 *
 * Targeting rule: the MCP client NEVER selects roots, stores, or
 * namespaces. The host composition root supplies a genuine branded
 * trusted configuration + genuine branded `TrustedStorageBootstrapInput`
 * + a WP-4 schema registry; this module verifies the brand, the
 * configuration correlation, and the strict store instance (the exact
 * WP-8 `verifyStoreInstance` pipeline) and binds the surface to that ONE
 * healthy verified store. Structural lookalikes, forged brands, and
 * stores that fail strict verification are rejected at construction.
 *
 * No capability, provenance, or trusted-input creator is imported here:
 * only the brand VERIFIER is consumed. The trusted input is never
 * minted, modified, or serialized by this surface.
 */
import { isGenuineTrustedStorageBootstrapInput } from '../../storage/trusted-input/bootstrap-input.js';
import { verifyStoreInstance } from '../../storage/read/read-record.js';
import { createSchemaRegistry } from '../../api/validate.js';
import type { SchemaRegistry } from '../../schema/registry.js';
import type { McpInspectionContext, McpInspectionContextInput } from './types.js';

function configFacts(trustedConfiguration: unknown): { readonly configurationVersion: string; readonly configurationIdentity: string } | undefined {
  if (typeof trustedConfiguration !== 'object' || trustedConfiguration === null) return undefined;
  const c = trustedConfiguration as Readonly<Record<string, unknown>>;
  if (typeof c['configurationVersion'] !== 'string' || typeof c['identity'] !== 'string') return undefined;
  return { configurationVersion: c['configurationVersion'], configurationIdentity: c['identity'] };
}

export interface ContextResult {
  readonly ok: boolean;
  readonly context?: McpInspectionContext;
  readonly code?: string;
  readonly message?: string;
}

/**
 * Establish the verified inspection context. The store must be HEALTHY
 * under the strict WP-8 verification pipeline (both namespace metadata
 * objects verified); the surface then re-verifies through the domain on
 * every request (point-of-use discipline is delegated to the domain).
 */
export function createInspectionContext(input: McpInspectionContextInput): ContextResult {
  if (!isGenuineTrustedStorageBootstrapInput(input.trustedInput)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'trusted input is not genuine; the inspection context requires a host-supplied genuine trusted input' };
  }
  const facts = configFacts(input.trustedConfiguration);
  if (facts === undefined) {
    return { ok: false, code: 'ERR-STO-CONFIG-UNAVAILABLE', message: 'trusted configuration facts are unavailable' };
  }
  const trustedInput = input.trustedInput as { readonly configurationIdentity: string; readonly serviceUid: number; readonly forbiddenRoots: readonly string[]; readonly locator: string; readonly limitProfile: Readonly<Record<string, number>> };
  if (trustedInput.configurationIdentity !== facts.configurationIdentity) {
    return { ok: false, code: 'ERR-STO-CONFIG-UNAVAILABLE', message: 'trusted input does not correlate with the trusted configuration' };
  }
  const store = verifyStoreInstance({
    locator: trustedInput.locator,
    serviceUid: trustedInput.serviceUid,
    forbiddenRoots: trustedInput.forbiddenRoots,
    configurationIdentity: facts.configurationIdentity,
    configurationVersion: facts.configurationVersion,
    limitProfile: trustedInput.limitProfile,
  });
  if (!store.ok || store.storeInstance === undefined) {
    return { ok: false, code: store.code ?? 'ERR-STO-INTEGRITY', message: store.message ?? 'store verification failed; the inspection context requires a healthy verified store' };
  }
  const schemaRegistry: SchemaRegistry = input.schemaRegistry ?? createSchemaRegistry();
  return {
    ok: true,
    context: Object.freeze({
      trustedConfiguration: input.trustedConfiguration,
      trustedInput: input.trustedInput,
      schemaRegistry,
      storeInstance: Object.freeze({
        configurationIdentity: store.storeInstance.configurationIdentity,
        serviceUid: store.storeInstance.serviceUid,
      }),
    }),
  };
}
