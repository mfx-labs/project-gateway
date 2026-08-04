/**
 * Shared WP-5A test world: builds validated, point-of-use-eligible Artifact
 * Core subjects (bundle + four exact members), eligibility evidence, registry
 * context, host capability, and adapter limits for Pi adapter tests.
 */
import {
  createSchemaRegistry,
  validateArtifactForUse,
  validateArtifactRevision,
  validateRegistrySnapshot,
  evaluatePointOfUseEligibility,
  computeArtifactDigest,
  MemoryIdentityState,
  isLevelAtLeast,
  type AcceptedRegistryContext,
  type ConsumerSupportDeclaration,
  type EligibilityReport,
  type LifecycleStateView,
  type RequestedUse,
  type ValidatedArtifact,
  type ValidatedLifecycleRecord,
} from '../../src/index.js';
import { CONFORMANCE_MANIFEST, CORPUS_INPUTS } from '../../src/generated/corpus-bundle.js';
import type {
  PiAdapterLimits,
  PiHostCapabilityDeclaration,
  PiProjectionInput,
  PiResolvedContextItem,
} from '../../src/adapters/pi/types.js';

const corpus = CORPUS_INPUTS as Record<string, string>;
export function loadJson(rel: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder('utf-8').decode(Buffer.from(corpus[rel]!, 'base64'))) as Record<string, unknown>;
}
export function cloneModel(model: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(model)) as Record<string, unknown>;
}

export const WORKSPACE = 'pgw:w:cf4339b1f56441936467dea1357dc30e';
export const CURRENT_TIME = '2026-08-04T06:10:00.000Z';
export const OCCURRENCE_ID = 'pgw:o:07afc217d096ca56baa8fe7441667a7a';
export const ATTEMPT_ID = 'pgw:a:conformance-attempt-1';

const reg = createSchemaRegistry();
export const SCHEMA_REGISTRY = reg;

const SNAPSHOT_MODEL = loadJson('fixtures/registry/valid/registry-v1.json');
const SNAPSHOT = validateRegistrySnapshot(SNAPSHOT_MODEL, reg).value!;
export const ACCEPTED_REGISTRY: AcceptedRegistryContext = {
  registryProtocolId: 'project-gateway.registry',
  registrySnapshotFormatVersion: '1.0',
  registrySnapshotId: String(SNAPSHOT_MODEL['snapshot_id']),
  registrySnapshotDigest: String(SNAPSHOT_MODEL['snapshot_digest']),
  snapshot: SNAPSHOT,
};

export const SUPPORT: ConsumerSupportDeclaration = {
  consumerId: 'project-gateway.fixture-consumer',
  supportedProtocolFeatures: ['project-gateway.conformance-fixture'],
  supportedConsumerCapabilities: ['project-gateway.workspace-read'],
  supportedExtensionNamespaces: ['project-gateway.conformance-tag'],
};

export const READ_USE: RequestedUse = {
  capability: 'project-gateway.workspace-read',
  operationClass: 'read',
  resourceClass: 'configured-artifact-area',
  scope: 'exact:resource-1',
  workspaceId: WORKSPACE,
};

export const DEFAULT_LIMITS: PiAdapterLimits = {
  maxContextItemBytes: 8192,
  maxTotalContextBytes: 65536,
  maxPlanBytes: 262144,
  maxContextItemCount: 64,
  allowTruncation: false,
};

/** Supported Pi 0.83.0 lane capability declaration (inspection-derived). */
export const SUPPORTED_CAPABILITY: PiHostCapabilityDeclaration = {
  piPackageId: '@earendil-works/pi-coding-agent',
  piVersion: '0.83.0',
  adapterApiVersion: '1.0',
  promptInjection: ['before-agent-start-message'],
  contextTransport: ['length-prefixed-data-blocks'],
  maxPromptBytes: 262144,
  textEncodings: ['utf-8'],
  mediaTypes: ['text/plain', 'application/octet-stream'],
  sessionLifecycleEvents: ['session_start', 'session_shutdown'],
  turnLifecycleEvents: ['turn_start', 'turn_end'],
  resultObservationEvents: ['message_end', 'agent_end', 'agent_settled'],
  toolCallObservationEvents: ['tool_execution_start', 'tool_execution_end', 'tool_call'],
  cancellationObservationEvents: ['agent_settled'],
  shutdownObservationEvents: ['session_shutdown'],
  correlationMetadataSupported: true,
  deterministicOrdering: true,
  requiredFeatures: ['base64-context', 'text-context', 'length-prefixed-data-blocks', 'before-agent-start-message'],
};

export interface ArtifactSet {
  readonly bundle: Readonly<Record<string, unknown>>;
  readonly task: Readonly<Record<string, unknown>>;
  readonly policy: Readonly<Record<string, unknown>>;
  readonly context: Readonly<Record<string, unknown>>;
  readonly completion: Readonly<Record<string, unknown>>;
}

export function corpusArtifactSet(): ArtifactSet {
  return {
    bundle: loadJson('fixtures/artifacts/valid/bundle-minimal-genesis.json'),
    task: loadJson('fixtures/artifacts/valid/task-minimal-genesis.json'),
    policy: loadJson('fixtures/artifacts/valid/policy-minimal-genesis.json'),
    context: loadJson('fixtures/artifacts/valid/context-minimal-genesis.json'),
    completion: loadJson('fixtures/artifacts/valid/completion-minimal-genesis.json'),
  };
}

function wrapRecord(model: Readonly<Record<string, unknown>>): ValidatedLifecycleRecord {
  return {
    recordType: String(model['record_type'] ?? '') as ValidatedLifecycleRecord['recordType'],
    recordId: String(model['record_id'] ?? ''),
    level: 'structural-valid',
    model,
  };
}

/** Synthesize a complete lifecycle chain (validation/approval/issuance per
 *  subject + grant + activation) for an arbitrary bundle + member set. */
export function synthesizeChain(set: ArtifactSet): ValidatedLifecycleRecord[] {
  const records: ValidatedLifecycleRecord[] = [];
  const subjects: readonly { kind: string; model: Readonly<Record<string, unknown>> }[] = [
    { kind: 'ExecutionBundle', model: set.bundle },
    { kind: 'TaskSpec', model: set.task },
    { kind: 'AuthorityPolicy', model: set.policy },
    { kind: 'ContextManifest', model: set.context },
    { kind: 'CompletionContract', model: set.completion },
  ];
  const subjectOf = (kind: string, model: Readonly<Record<string, unknown>>): Record<string, unknown> => {
    const revision = (model['revision'] as Record<string, unknown>) ?? {};
    const binding = (model['workspace_binding'] as Record<string, unknown>) ?? {};
    return {
      protocol_version: '1.0',
      kind: { id: kind, version: '1.0' },
      instance_id: String(model['instance_id'] ?? ''),
      revision_id: String(revision['id'] ?? ''),
      digest: String(revision['digest'] ?? ''),
      ...(binding['mode'] === 'bound' ? { workspace_id: String(binding['workspace_id']) } : {}),
    };
  };
  const registryRef = {
    registry_protocol_id: 'project-gateway.registry',
    registry_snapshot_format_version: '1.0',
    registry_snapshot_id: ACCEPTED_REGISTRY.registrySnapshotId,
    registry_snapshot_digest: ACCEPTED_REGISTRY.registrySnapshotDigest,
  };
  const issuanceIds: string[] = [];
  subjects.forEach(({ kind, model }, i) => {
    const subject = subjectOf(kind, model);
    const validationId = `pgw:l:syn-val-${i}`;
    const approvalId = `pgw:l:syn-app-${i}`;
    const issuanceId = `pgw:l:syn-iss-${i}`;
    issuanceIds.push(issuanceId);
    records.push(
      wrapRecord({
        record_type: 'ValidationRecord',
        record_id: validationId,
        registry_snapshot_reference: registryRef,
        subject,
        structural_outcome: 'valid',
        semantic_outcome: 'valid',
      }),
      wrapRecord({
        record_type: 'ApprovalRecord',
        record_id: approvalId,
        registry_snapshot_reference: registryRef,
        subject,
        workspace_id: WORKSPACE,
        validation_record_ids: [validationId],
        valid_until: null,
      }),
      wrapRecord({
        record_type: 'IssuanceRecord',
        record_id: issuanceId,
        registry_snapshot_reference: registryRef,
        subject,
        approval_record_id: approvalId,
        workspace_id: WORKSPACE,
        valid_until: null,
      }),
    );
  });
  const revision = (set.bundle['revision'] as Record<string, unknown>) ?? {};
  const binding = (set.bundle['workspace_binding'] as Record<string, unknown>) ?? {};
  const bundleRef = {
    target_protocol_version: '1.0',
    target_kind: { id: 'ExecutionBundle', version: '1.0' },
    target_instance_id: String(set.bundle['instance_id'] ?? ''),
    target_revision_id: String(revision['id'] ?? ''),
    target_digest: String(revision['digest'] ?? ''),
    target_workspace_binding: binding,
  };
  const grantId = 'pgw:l:syn-grant-1';
  records.push(
    wrapRecord({
      record_type: 'RuntimeGrant',
      record_id: grantId,
      registry_snapshot_reference: registryRef,
      bundle: bundleRef,
      workspace_id: WORKSPACE,
      reserved_occurrence_id: OCCURRENCE_ID,
      attempt_limit: 2,
      validity: { not_before: '2026-08-04T06:00:00.000Z', not_after: '2026-08-05T06:00:00.000Z' },
      narrowed_constraints: [{ type: 'max-actions', value: 10 }],
    }),
    wrapRecord({
      record_type: 'ActivationRecord',
      record_id: 'pgw:l:syn-act-1',
      registry_snapshot_reference: registryRef,
      bundle: bundleRef,
      workspace_id: WORKSPACE,
      required_issuance_record_ids: issuanceIds,
      runtime_grant_id: grantId,
      reserved_occurrence_id: OCCURRENCE_ID,
      decision: 'accepted',
    }),
  );
  return records;
}

function chainLifecycle(records: ValidatedLifecycleRecord[]): LifecycleStateView {
  const byId = new Map(records.map((r) => [r.recordId, r]));
  return { records, findRecord: (id) => byId.get(id) };
}

export interface PiTestWorld {
  readonly set: ArtifactSet;
  readonly bundle: ValidatedArtifact;
  readonly task: ValidatedArtifact;
  readonly policy: ValidatedArtifact;
  readonly context: ValidatedArtifact;
  readonly completion: ValidatedArtifact;
  readonly eligibility: EligibilityReport;
  readonly capability: PiHostCapabilityDeclaration;
  readonly limits: PiAdapterLimits;
  input(over?: Partial<PiProjectionInput>): PiProjectionInput;
}

/** Build a fully validated test world for an artifact set (defaults to the
 *  corpus minimal set; custom sets need schema-valid models with recomputed
 *  digests). */
export function buildWorld(set: ArtifactSet = corpusArtifactSet(), limits: PiAdapterLimits = DEFAULT_LIMITS): PiTestWorld {
  const identity = new MemoryIdentityState();
  const lifecycle = chainLifecycle(synthesizeChain(set));

  const members = {
    task: validateArtifactRevision(set.task, reg, 'registry-compatibility', { registry: ACCEPTED_REGISTRY, consumerSupport: SUPPORT, identity }).value!,
    policy: validateArtifactRevision(set.policy, reg, 'registry-compatibility', { registry: ACCEPTED_REGISTRY, consumerSupport: SUPPORT, identity }).value!,
    context: validateArtifactRevision(set.context, reg, 'registry-compatibility', { registry: ACCEPTED_REGISTRY, consumerSupport: SUPPORT, identity }).value!,
    completion: validateArtifactRevision(set.completion, reg, 'registry-compatibility', { registry: ACCEPTED_REGISTRY, consumerSupport: SUPPORT, identity }).value!,
  };
  for (const m of [members.task, members.policy, members.context, members.completion]) identity.register(m);

  const resolver = {
    resolve: (ref: { target_revision_id?: string }) => {
      for (const model of [set.task, set.policy, set.context, set.completion]) {
        if (String((model['revision'] as Record<string, unknown>)['id']) === ref['target_revision_id']) return model;
      }
      return undefined;
    },
  };

  // the bundle must be registered before for-use verification runs
  const preBundle = validateArtifactRevision(set.bundle, reg, 'semantic-self-validation', { identity }).value!;
  identity.register(preBundle);

  const report = validateArtifactForUse(set.bundle, reg, {
    registry: ACCEPTED_REGISTRY,
    consumerSupport: SUPPORT,
    resolver,
    identity,
    lifecycle,
    revocations: { revocationsByTarget: () => [] },
    currentTime: CURRENT_TIME,
    workspaceId: WORKSPACE,
    requestedUse: READ_USE,
  });
  if (!report.ok || report.value === undefined) {
    throw new Error(`test world failed for-use validation: ${report.findings.map((f) => `${f.phase}:${f.messageKey}`).join(',')}`);
  }
  const bundle = report.value;
  identity.register(bundle);

  const eligibility = evaluatePointOfUseEligibility({
    currentTime: CURRENT_TIME,
    workspaceId: WORKSPACE,
    requestedUse: READ_USE,
    consumerSupport: SUPPORT,
    identity,
    resolver,
    registry: ACCEPTED_REGISTRY,
    lifecycle,
    revocations: { revocationsByTarget: () => [] },
    bundle: bundle.model,
    policy: members.policy.model,
  });
  if (!eligibility.eligible) throw new Error('test world eligibility failed');

  const world: PiTestWorld = {
    set,
    bundle,
    task: members.task,
    policy: members.policy,
    context: members.context,
    completion: members.completion,
    eligibility,
    capability: SUPPORTED_CAPABILITY,
    limits,
    input(over = {}) {
      return {
        bundle: world.bundle,
        taskSpec: world.task,
        authorityPolicy: world.policy,
        contextManifest: world.context,
        completionContract: world.completion,
        eligibility: world.eligibility,
        registry: ACCEPTED_REGISTRY,
        occurrenceId: OCCURRENCE_ID,
        attemptId: ATTEMPT_ID,
        capability: world.capability,
        contextItems: [],
        limits: world.limits,
        requestedUse: READ_USE,
        ...over,
      };
    },
  };
  return world;
}

/** Build a schema-valid custom artifact model with a recomputed digest. */
export function customArtifact(
  base: Record<string, unknown>,
  mutate: (model: Record<string, unknown>) => void,
): Record<string, unknown> {
  const model = cloneModel(base);
  mutate(model);
  model['revision'] = { ...(model['revision'] as Record<string, unknown>), digest: '' };
  model['revision'] = { ...(model['revision'] as Record<string, unknown>), digest: computeArtifactDigest(model).digest };
  return model;
}

export function contextItem(contextId: string, over: Partial<PiResolvedContextItem> = {}): PiResolvedContextItem {
  const text = over['text'] ?? `context content for ${contextId}`;
  return {
    contextId,
    label: `label-${contextId}`,
    mediaType: 'text/plain',
    text,
    byteLength: Buffer.byteLength(text, 'utf8'),
    provenance: { source: 'caller-supplied' },
    truncated: false,
    ...over,
  };
}

export { isLevelAtLeast, CONFORMANCE_MANIFEST };
