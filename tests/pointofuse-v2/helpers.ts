/**
 * WP-6 Phase 3A test fixtures: branded lifecycle records and registry snapshots
 * (committed WeakSet brands), plain v1/v2 input shapes, and class-based views
 * with private state for receiver-bound adapter tests.
 */
import { brandRecordWrapper, brandRegistryWrapper } from '../../src/internal/snapshot.js';
import type { ValidatedLifecycleRecord, ValidatedRegistrySnapshot } from '../../src/api/types.js';

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** Construct and brand one lifecycle record wrapper (plain frozen record). */
export function brandedRecord(recordId: string, model: Record<string, unknown> = {}): ValidatedLifecycleRecord {
  const wrapper = Object.freeze({
    recordType: 'ValidationRecord',
    recordId,
    level: 'structural-valid',
    model: deepFreeze(model),
  });
  brandRecordWrapper(wrapper);
  return wrapper as unknown as ValidatedLifecycleRecord;
}

/** Construct and brand one registry snapshot wrapper. */
export function brandedRegistrySnapshot(snapshotId = 'snap-1'): ValidatedRegistrySnapshot {
  const wrapper = Object.freeze({
    snapshotId,
    digest: 'sha-256:' + 'a'.repeat(64),
    canonicalUtf8: '{}',
    level: 'structural-valid',
    model: Object.freeze({}),
  });
  brandRegistryWrapper(wrapper);
  return wrapper as unknown as ValidatedRegistrySnapshot;
}

export const WORKSPACE_A = 'ws-a';
export const WORKSPACE_B = 'ws-b';

/** Plain object-literal identity view (own arrow-function members). */
export function plainIdentityView(): Record<string, unknown> {
  return {
    findInstance: () => undefined,
    findRevision: () => undefined,
    findPredecessor: () => undefined,
    verifyRegistration: () => false,
  };
}

export function plainResolverView(): Record<string, unknown> {
  return { resolve: () => undefined };
}

export function plainRevocationsView(): Record<string, unknown> {
  return { revocationsByTarget: () => [] };
}

/** Class-based views using `this` and genuine private fields. */
export class PrivateIdentityView {
  #instances = new Map<string, string>();

  constructor(entries: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(entries)) this.#instances.set(k, v);
  }

  findInstance(instanceId: string): string | undefined {
    return this.#instances.get(instanceId);
  }

  findRevision(): undefined {
    return undefined;
  }

  findPredecessor(): undefined {
    return undefined;
  }

  verifyRegistration(): boolean {
    return this.#instances.size > 0;
  }
}

export class ThisResolverView {
  readonly prefix = 'resolved:';

  resolve(reference: unknown): string {
    return this.prefix + String(reference);
  }
}

export class ThisRevocationsView {
  readonly marker = 'rev';

  revocationsByTarget(recordId: string): readonly { recordId: string; effectiveAt: string; scope: string }[] {
    return recordId === 'rev-1' ? [{ recordId: 'rev-1', effectiveAt: '2026-01-01T00:00:00Z', scope: this.marker }] : [];
  }
}

/** Class-based view with a legitimate mutator on the same instance (M-1 fixture). */
export class MutatingIdentityView {
  #label: string;

  constructor(label: string) {
    this.#label = label;
  }

  findInstance(_instanceId: string): string {
    return this.#label;
  }

  findRevision(): undefined {
    return undefined;
  }

  findPredecessor(): undefined {
    return undefined;
  }

  verifyRegistration(): boolean {
    return true;
  }

  /** Legitimate mutator on the same instance (not an adapted member). */
  setLabel(label: string): void {
    this.#label = label;
  }
}

/** Class whose adapted method mutates a private field on each invocation (M-1 fixture). */
export class LiveCounterResolver {
  #calls = 0;

  resolve(reference: unknown): string {
    this.#calls += 1;
    return `${String(reference)}:${this.#calls}`;
  }
}

/** Complete plain v2 input shape (all fields own enumerable data). */
export function validV2Input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pointOfUseInputsProtocolVersion: '2',
    workspaceId: WORKSPACE_A,
    requestedUse: {
      capability: 'project-gateway.workspace-read',
      operationClass: 'read',
      resourceClass: 'artifact',
      scope: 'exact:task-1',
      workspaceId: WORKSPACE_A,
    },
    currentTime: '2026-01-01T00:00:00Z',
    consumerSupport: {
      consumerId: 'consumer-1',
      supportedProtocolFeatures: ['feature-a'],
      supportedConsumerCapabilities: ['project-gateway.workspace-read'],
      supportedExtensionNamespaces: [],
    },
    identity: plainIdentityView(),
    resolver: plainResolverView(),
    registry: {
      registryProtocolId: 'proto-1',
      registrySnapshotFormatVersion: '1',
      registrySnapshotId: 'reg-1',
      registrySnapshotDigest: 'sha-256:' + 'b'.repeat(64),
      snapshot: brandedRegistrySnapshot(),
    },
    lifecycle: { records: [brandedRecord('rec-1', { record_id: 'rec-1' })] },
    revocations: plainRevocationsView(),
    bundle: { instanceId: 'bundle-1', body: { members: [] } },
    policy: { instanceId: 'policy-1', body: { rules: [] } },
    ...overrides,
  };
}

/** Complete plain v1 input shape. */
export function validV1Input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const v2 = validV2Input();
  delete v2['pointOfUseInputsProtocolVersion'];
  const v1: Record<string, unknown> = { ...v2, ...overrides };
  return v1;
}

/** Wrap a record in a Proxy that counts `get` trap invocations. */
export function countingGetProxy<T extends object>(target: T): { proxy: T; getCalls: () => number } {
  let calls = 0;
  const proxy = new Proxy(target, {
    get(t, p) {
      calls++;
      return Reflect.get(t, p);
    },
  }) as T;
  return { proxy, getCalls: () => calls };
}

// ---------------------------------------------------------------------------
// Phase-3B world fixtures (corpus-derived, mirroring the committed
// effective-authority integration test world)
// ---------------------------------------------------------------------------

import { createSchemaRegistry, validateRegistrySnapshot } from '../../src/index.js';
import {
  validateTrustedWorkspaceConfiguration,
  TRUSTED_HOST_LANE,
} from '../../src/trusted/index.js';
import type { ValidatedTrustedWorkspaceConfiguration } from '../../src/trusted/index.js';
import { CORPUS_INPUTS } from '../../src/generated/corpus-bundle.js';
import type {
  AcceptedRegistryContext,
  ConsumerSupportDeclaration,
  RevocationView,
} from '../../src/api/types.js';

export const POU_WORKSPACE_ID = 'pgw:w:cf4339b1f56441936467dea1357dc30e';
export const POU_CURRENT_TIME = '2026-08-04T06:10:00.000Z';
export const POU_CAPABILITY = 'project-gateway.workspace-read';

export function loadJson(rel: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder('utf-8').decode(Buffer.from(CORPUS_INPUTS[rel]!, 'base64'))) as Record<string, unknown>;
}

/** Branded lifecycle record wrapper over a corpus record model (deeply frozen). */
export function brandedRecordFrom(model: Readonly<Record<string, unknown>>): ValidatedLifecycleRecord {
  const wrapper = Object.freeze({
    recordType: String(model['record_type'] ?? ''),
    recordId: String(model['record_id'] ?? ''),
    level: 'structural-valid',
    model: deepFreeze(model),
  }) as unknown as ValidatedLifecycleRecord;
  brandRecordWrapper(wrapper as unknown as object);
  return wrapper;
}

/** The full committed lifecycle chain (validation/approval/issuance per subject + grant + activation). */
export function pouChainRecords(): ValidatedLifecycleRecord[] {
  const records: ValidatedLifecycleRecord[] = [];
  for (const name of ['task', 'policy', 'context', 'completion', 'bundle']) {
    records.push(brandedRecordFrom(loadJson(`fixtures/lifecycle/valid/validation-${name}.json`)));
    records.push(brandedRecordFrom(loadJson(`fixtures/lifecycle/valid/approval-${name}.json`)));
    records.push(brandedRecordFrom(loadJson(`fixtures/lifecycle/valid/issuance-${name}.json`)));
  }
  records.push(brandedRecordFrom(loadJson('fixtures/lifecycle/valid/runtime-grant-main.json')));
  records.push(brandedRecordFrom(loadJson('fixtures/lifecycle/valid/activation-accepted.json')));
  return records;
}

/** The lifecycle chain WITHOUT the RuntimeGrant record (grant truly absent). */
export function pouChainRecordsWithoutGrant(): ValidatedLifecycleRecord[] {
  return pouChainRecords().filter((r) => r.recordType !== 'RuntimeGrant');
}

/** Lifecycle view shape with the interface `findRecord` member (plain world). */
export function pouLifecycleView(records: ValidatedLifecycleRecord[]): { records: ValidatedLifecycleRecord[]; findRecord: (id: string) => ValidatedLifecycleRecord | undefined } {
  const byId = new Map(records.map((r) => [r.recordId, r]));
  return { records, findRecord: (id) => byId.get(id) };
}

export function pouRegistryContext(): AcceptedRegistryContext {
  const model = loadJson('fixtures/registry/valid/registry-v1.json');
  const snapshot = validateRegistrySnapshot(model, createSchemaRegistry()).value!;
  return {
    registryProtocolId: 'project-gateway.registry',
    registrySnapshotFormatVersion: '1.0',
    registrySnapshotId: String(model['snapshot_id']),
    registrySnapshotDigest: String(model['snapshot_digest']),
    snapshot,
  };
}

export const POU_CONSUMER_SUPPORT: ConsumerSupportDeclaration = {
  consumerId: 'test-consumer',
  supportedProtocolFeatures: ['project-gateway.conformance-fixture'],
  supportedConsumerCapabilities: [POU_CAPABILITY],
  supportedExtensionNamespaces: ['project-gateway.conformance-tag'],
};

export const POU_REVOCATIONS: RevocationView = { revocationsByTarget: () => [] };

export const POU_REQUESTED_USE = {
  capability: POU_CAPABILITY,
  operationClass: 'read',
  resourceClass: 'configured-artifact-area',
  scope: 'exact:resource-1',
  workspaceId: POU_WORKSPACE_ID,
};

export function pouBundleModel(): Record<string, unknown> {
  return loadJson('fixtures/artifacts/valid/bundle-minimal-genesis.json');
}

export function pouPolicyModel(): Record<string, unknown> {
  return loadJson('fixtures/artifacts/valid/policy-minimal-genesis.json');
}

export function pouGrantModel(): Record<string, unknown> {
  return loadJson('fixtures/lifecycle/valid/runtime-grant-main.json');
}

/**
 * Genuine runtime-branded trusted configuration for the POU world. Ceiling
 * fields are included only when supplied (presence-aware).
 */
export function genuineConfig(overrides: {
  readonly configurationVersion?: '1' | '2';
  readonly globalCapabilityCeiling?: { readonly capabilities?: readonly string[] };
  readonly globalActionCeiling?: number;
  readonly workspaceCapabilities?: readonly string[];
  readonly workspaceActionCeiling?: number;
  readonly workspaceRoot?: string;
} = {}): ValidatedTrustedWorkspaceConfiguration {
  const input: Record<string, unknown> = {
    configurationVersion: overrides.configurationVersion ?? '2',
    capabilityVocabularyVersion: 'v1',
    provenance: { sourceKind: 'trusted-local-control-plane' },
    workspaces: [
      {
        workspaceId: POU_WORKSPACE_ID,
        root: overrides.workspaceRoot ?? '/srv/gateway/alpha',
        ...(overrides.workspaceCapabilities !== undefined ? { capabilities: [...overrides.workspaceCapabilities] } : {}),
        ...(overrides.workspaceActionCeiling !== undefined ? { actionCeiling: overrides.workspaceActionCeiling } : {}),
      },
    ],
  };
  if (overrides.globalCapabilityCeiling !== undefined) {
    const ceiling: Record<string, unknown> = {};
    if (overrides.globalCapabilityCeiling.capabilities !== undefined) {
      ceiling['capabilities'] = [...overrides.globalCapabilityCeiling.capabilities];
    }
    input['globalCapabilityCeiling'] = ceiling;
  }
  if (overrides.globalActionCeiling !== undefined) {
    input['globalActionCeiling'] = overrides.globalActionCeiling;
  }
  const report = validateTrustedWorkspaceConfiguration(input, {
    hostLane: TRUSTED_HOST_LANE,
    resolveRootPath: (p) => p,
  });
  if (!report.ok) {
    throw new Error(`fixture configuration invalid: ${report.findings.map((f) => `${f.code}:${f.messageKey}`).join(',')}`);
  }
  return report.configuration! as unknown as ValidatedTrustedWorkspaceConfiguration;
}

/** Complete valid v2 evaluation input (plain record; captured by the router). */
export function validV2EvaluationInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pointOfUseInputsProtocolVersion: '2',
    workspaceId: POU_WORKSPACE_ID,
    requestedUse: { ...POU_REQUESTED_USE },
    currentTime: POU_CURRENT_TIME,
    consumerSupport: {
      consumerId: 'test-consumer',
      supportedProtocolFeatures: ['project-gateway.conformance-fixture'],
      supportedConsumerCapabilities: [POU_CAPABILITY],
      supportedExtensionNamespaces: ['project-gateway.conformance-tag'],
    },
    identity: { findInstance: () => undefined, findRevision: () => undefined, findPredecessor: () => undefined, verifyRegistration: () => false },
    resolver: { resolve: () => undefined },
    registry: pouRegistryContext(),
    lifecycle: pouLifecycleView(pouChainRecords()),
    revocations: { revocationsByTarget: () => [] },
    bundle: pouBundleModel(),
    policy: pouPolicyModel(),
    grant: pouGrantModel(),
    ...overrides,
  };
}

/** Complete valid v1 evaluation input (same world minus the version field). */
export function validV1EvaluationInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const v2 = validV2EvaluationInput();
  delete v2['pointOfUseInputsProtocolVersion'];
  return { ...v2, ...overrides };
}

/** The direct v1 entry inputs equivalent to the v1 evaluation input (plain v1 world). */
export function directV1Inputs(): Record<string, unknown> {
  const v1 = validV1EvaluationInput();
  return v1;
}
