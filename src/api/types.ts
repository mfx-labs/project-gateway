/**
 * Public protocol types: validation levels, branded validated wrappers,
 * state-view interfaces, the requested-use structure, and the structured
 * report model. Consumer-neutral; no dependency-specific types leak.
 */
import type { FailureCategory, ValidationPhase } from '../internal/phase.js';
import type { ArtifactKindId, LifecycleRecordType } from '../schema/select.js';
import {
  snapshotJson,
  brandArtifactWrapper,
  brandRegistryWrapper,
  brandRecordWrapper,
} from '../internal/snapshot.js';

export type { ValidationPhase, FailureCategory };
export type { ArtifactKindId, LifecycleRecordType };

/**
 * Explicit validation level: the highest phase that has succeeded for a
 * validated subject. A subject validated only to `self-semantic-valid` must
 * never be accepted where a `point-of-use-eligible` subject is required.
 */
export type ValidationLevel =
  | 'raw-parsed'
  | 'canonical-input-valid'
  | 'structural-valid'
  | 'digest-verified'
  | 'self-semantic-valid'
  | 'exact-reference-resolved'
  | 'registry-compatible'
  | 'lifecycle-verified'
  | 'consumer-supported'
  | 'point-of-use-eligible';

/** A parsed, canonical-input-validated JSON data model (untrusted but well-formed). */
export interface AcceptedModel {
  readonly subjectClass: 'artifact' | 'registry' | 'lifecycle' | 'reference';
  readonly model: Readonly<Record<string, unknown>>;
}

/** Defensive deep-frozen snapshot of an accepted JSON data model. */
export type ImmutableModel = Readonly<Record<string, unknown>>;

export interface ValidatedArtifact {
  readonly kind: ArtifactKindId;
  readonly instanceId: string;
  readonly revisionId: string;
  readonly digest: string;
  readonly canonicalUtf8: string;
  readonly level: ValidationLevel;
  /** Deep-frozen snapshot; shares no nested references with caller input. */
  readonly model: ImmutableModel;
}

export interface ValidatedRegistrySnapshot {
  readonly snapshotId: string;
  readonly digest: string;
  readonly canonicalUtf8: string;
  readonly level: ValidationLevel;
  readonly model: ImmutableModel;
}

export interface ValidatedLifecycleRecord {
  readonly recordType: LifecycleRecordType;
  readonly recordId: string;
  readonly level: ValidationLevel;
  readonly model: ImmutableModel;
}

/** Exact artifact reference model (schema-shaped). */
export interface ExactArtifactReferenceModel {
  readonly target_protocol_version: string;
  readonly target_kind: { readonly id: string; readonly version: string };
  readonly target_instance_id: string;
  readonly target_revision_id: string;
  readonly target_digest: string;
  readonly target_workspace_binding: {
    readonly mode: 'portable' | 'bound';
    readonly workspace_id?: string;
  };
}

export interface Finding {
  readonly phase: ValidationPhase;
  readonly category: FailureCategory;
  readonly ruleIds: readonly string[];
  readonly schemaId?: string;
  readonly subjectIdentity?: string;
  readonly location?: string;
  readonly messageKey: string;
  readonly message: string;
}

export interface ValidationReport {
  readonly ok: boolean;
  readonly firstFailingPhase?: ValidationPhase;
  readonly category?: FailureCategory;
  readonly schemaId?: string;
  readonly subjectIdentity?: string;
  readonly ruleIds: readonly string[];
  readonly findings: readonly Finding[];
  /** Phase-gate marker: the highest level actually executed when no wrapper value is produced. */
  readonly level?: ValidationLevel;
}

// ---------------------------------------------------------------------------
// runtime branding helpers (membership is module-private; no brand property or
// exported token exists on the wrapper)
// ---------------------------------------------------------------------------
export function brandValidatedArtifact(base: Omit<ValidatedArtifact, never>): ValidatedArtifact {
  const wrapper = Object.freeze({ ...base }) as unknown as ValidatedArtifact;
  brandArtifactWrapper(wrapper);
  return wrapper;
}
export function brandValidatedRegistry(base: Omit<ValidatedRegistrySnapshot, never>): ValidatedRegistrySnapshot {
  const wrapper = Object.freeze({ ...base }) as unknown as ValidatedRegistrySnapshot;
  brandRegistryWrapper(wrapper);
  return wrapper;
}
export function brandValidatedRecord(base: Omit<ValidatedLifecycleRecord, never>): ValidatedLifecycleRecord {
  const wrapper = Object.freeze({ ...base }) as unknown as ValidatedLifecycleRecord;
  brandRecordWrapper(wrapper);
  return wrapper;
}

export function snapshotModel(model: unknown): ImmutableModel {
  return snapshotJson(model) as ImmutableModel;
}

// ---------------------------------------------------------------------------
// injected state interfaces
// ---------------------------------------------------------------------------

export interface RegisteredRevision {
  readonly instanceId: string;
  readonly kindId: string;
  readonly revisionId: string;
  readonly digest: string;
  readonly generation: number;
  readonly predecessor?: ExactArtifactReferenceModel;
  /** Workspace binding declared at registration time (when the subject has one). */
  readonly workspaceBinding?: Readonly<{ mode: string; workspace_id?: string }>;
}

export interface RegisteredInstance {
  readonly instanceId: string;
  readonly kindId: string;
  readonly registeredRevisionIds: readonly string[];
}

/** Caller-supplied identity state (registrar view). WP-4 performs verification only. */
export interface IdentityStateView {
  findInstance(instanceId: string): RegisteredInstance | undefined;
  findRevision(revisionId: string): RegisteredRevision | undefined;
  findPredecessor(instanceId: string, revisionId: string): ExactArtifactReferenceModel | undefined;
  /** Verify an existing registration without registering anything. */
  verifyRegistration(instanceId: string, revisionId: string, digest: string): boolean;
}

/** Caller-supplied exact-subject resolver. Returned subjects are treated as untrusted. */
export interface ExactSubjectResolver {
  resolve(reference: ExactArtifactReferenceModel): unknown | undefined;
}

/** Registry snapshot acceptance (caller-supplied trusted configuration). */
export interface AcceptedRegistryContext {
  readonly registryProtocolId: string;
  readonly registrySnapshotFormatVersion: string;
  readonly registrySnapshotId: string;
  readonly registrySnapshotDigest: string;
  readonly snapshot: ValidatedRegistrySnapshot;
}

export interface ConsumerSupportDeclaration {
  readonly consumerId: string;
  readonly supportedProtocolFeatures: readonly string[];
  readonly supportedConsumerCapabilities: readonly string[];
  readonly supportedExtensionNamespaces: readonly string[];
}

/** Caller-supplied trusted lifecycle record view (records already accepted). */
export interface LifecycleStateView {
  readonly records: readonly ValidatedLifecycleRecord[];
  findRecord(recordId: string): ValidatedLifecycleRecord | undefined;
}

export interface RevocationView {
  /** Effective revocations keyed by target record ID. */
  revocationsByTarget(recordId: string): readonly { recordId: string; effectiveAt: string; scope: string }[];
}

/** The exact operation requested at point of use. */
export interface RequestedUse {
  readonly capability: string;
  readonly capabilityVersion?: string;
  readonly operationClass: string;
  readonly resourceClass: string;
  readonly scope: string;
  readonly workspaceId: string;
}

export interface PointOfUseInputs {
  readonly currentTime: string;
  readonly workspaceId: string;
  readonly requestedUse: RequestedUse;
  readonly globalActionCeiling?: number;
  readonly workspaceActionCeiling?: number;
  readonly consumerSupport: ConsumerSupportDeclaration;
  readonly identity: IdentityStateView;
  readonly resolver: ExactSubjectResolver;
  readonly registry: AcceptedRegistryContext;
  readonly lifecycle: LifecycleStateView;
  readonly revocations: RevocationView;
  /** Exact ExecutionBundle model (already validated and identity-verified). Required; missing fails closed. */
  readonly bundle: ImmutableModel;
  /** The bundle's resolved AuthorityPolicy member (already validated). Required; missing fails closed. */
  readonly policy: ImmutableModel;
  /** Active RuntimeGrant model (already validated). When absent it is located from the lifecycle records. */
  readonly grant?: ImmutableModel;
}

/** Deterministic eligibility report for a requested use. */
export interface EligibilityReport {
  readonly eligible: boolean;
  readonly requestedUse: RequestedUse;
  readonly capability: string;
  readonly scope: string;
  readonly workspaceId: string;
  readonly subjectCorrelations: Readonly<Record<string, string>>;
  readonly firstFailingPhase?: ValidationPhase;
  readonly categories: readonly FailureCategory[];
  readonly ruleIds: readonly string[];
  readonly findings: readonly Finding[];
}

/** In-memory identity state for tests and the conformance runner (not persistent). */
export class MemoryIdentityState implements IdentityStateView {
  private readonly instances = new Map<string, RegisteredInstance>();
  private readonly revisions = new Map<string, RegisteredRevision>();
  private readonly predecessors = new Map<string, ExactArtifactReferenceModel>();

  register(artifact: ValidatedArtifact, predecessor?: ExactArtifactReferenceModel): void {
    const existingInstance = this.instances.get(artifact.instanceId);
    if (existingInstance) {
      this.instances.set(artifact.instanceId, {
        ...existingInstance,
        registeredRevisionIds: [...existingInstance.registeredRevisionIds, artifact.revisionId],
      });
    } else {
      this.instances.set(artifact.instanceId, {
        instanceId: artifact.instanceId,
        kindId: artifact.kind,
        registeredRevisionIds: [artifact.revisionId],
      });
    }
    const revision = artifact.model['revision'] as Record<string, unknown>;
    const base: RegisteredRevision = {
      instanceId: artifact.instanceId,
      kindId: artifact.kind,
      revisionId: artifact.revisionId,
      digest: artifact.digest,
      generation: revision['generation'] as number,
    };
    const binding = artifact.model['workspace_binding'];
    if (binding !== null && binding !== undefined && typeof binding === 'object') {
      const b = binding as Record<string, unknown>;
      (base as { workspaceBinding?: { mode: string; workspace_id?: string } }).workspaceBinding = Object.freeze({
        mode: String(b['mode'] ?? ''),
        ...(b['workspace_id'] !== undefined && b['workspace_id'] !== null ? { workspace_id: String(b['workspace_id']) } : {}),
      });
    }
    const entry: RegisteredRevision = predecessor !== undefined ? { ...base, predecessor } : base;
    this.revisions.set(artifact.revisionId, entry);
    if (predecessor) {
      this.predecessors.set(`${artifact.instanceId}:${artifact.revisionId}`, predecessor);
    }
  }

  findInstance(instanceId: string): RegisteredInstance | undefined {
    return this.instances.get(instanceId);
  }

  findRevision(revisionId: string): RegisteredRevision | undefined {
    return this.revisions.get(revisionId);
  }

  findPredecessor(instanceId: string, revisionId: string): ExactArtifactReferenceModel | undefined {
    return this.predecessors.get(`${instanceId}:${revisionId}`);
  }

  verifyRegistration(instanceId: string, revisionId: string, digest: string): boolean {
    const revision = this.revisions.get(revisionId);
    return (
      revision !== undefined &&
      revision.instanceId === instanceId &&
      revision.digest === digest
    );
  }
}
