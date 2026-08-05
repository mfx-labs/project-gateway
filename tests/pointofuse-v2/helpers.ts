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
