/**
 * Pi invocation-plan projection (WP-5A).
 *
 * Accepts only Artifact Core validated subjects at use-suitable validation
 * levels, requires the exact ExecutionBundle and its four exact resolved
 * prospective members, verifies exact-reference correlation, enforces context
 * isolation and host compatibility, and produces a deterministic immutable
 * `projection-ready` plan. Projection is not activation and not authorization;
 * the plan explicitly states that pi-guard enforcement is pending.
 */
import {
  exactReferencesEqual,
  isBrandedArtifact,
  isLevelAtLeast,
  snapshotJson,
  type ExactArtifactReferenceModel,
  type ImmutableModel,
  type ValidatedArtifact,
} from '../../index.js';
import { inspectPiHostCompatibility } from './compatibility.js';
import { correlateContextItems, manifestEntries } from './context.js';
import { piFinding, sortFindings } from './findings.js';
import { brandPlanWrapper } from './internal/brand.js';
import { validateProjectionInputShapes, type EligibilitySnapshot, type RegistryContextSnapshot, type RequestedUseSnapshot } from './internal/input-shape.js';
import {
  planWithinHostBounds,
  renderCompletionCriteria,
  renderContextBlocks,
  renderContextInventory,
  renderCorrelationFooter,
  renderPrompt,
  renderTaskSection,
  TRUSTED_ADAPTER_PREAMBLE,
} from './render.js';
import {
  PI_ADAPTER_PROTOCOL_VERSION,
  PI_CONSUMER_IDENTITY,
  PI_CONSUMER_VERSION,
  SUPPORTED_PI_LANE,
} from './types.js';
import type {
  PiFinding,
  PiHostCapabilityDeclaration,
  PiInvocationPlan,
  PiProjectionInput,
  PiSubjectCorrelation,
} from './types.js';

/** Validation level required for the bundle subject. */
const BUNDLE_REQUIRED_LEVEL = 'point-of-use-eligible' as const;
/** Validation level required for member subjects (for-use resolution level). */
const MEMBER_REQUIRED_LEVEL = 'registry-compatible' as const;

/** Build the exact reference identity of a validated artifact wrapper. */
export function exactReferenceOf(artifact: ValidatedArtifact): ExactArtifactReferenceModel {
  const model = artifact.model;
  const proto = model['protocol'] as ImmutableModel | undefined;
  const kind = model['kind'] as ImmutableModel | undefined;
  const binding = model['workspace_binding'] as ImmutableModel | undefined;
  const mode = typeof binding?.['mode'] === 'string' ? binding['mode'] : '';
  const workspaceId = typeof binding?.['workspace_id'] === 'string' ? binding['workspace_id'] : undefined;
  return {
    target_protocol_version: typeof proto?.['version'] === 'string' ? proto['version'] : '',
    target_kind: {
      id: typeof kind?.['id'] === 'string' ? kind['id'] : '',
      version: typeof kind?.['version'] === 'string' ? kind['version'] : '',
    },
    target_instance_id: artifact.instanceId,
    target_revision_id: artifact.revisionId,
    target_digest: artifact.digest,
    target_workspace_binding: {
      mode: mode === 'bound' || mode === 'portable' ? mode : 'portable',
      ...(workspaceId !== undefined && mode === 'bound' ? { workspace_id: workspaceId } : {}),
    },
  };
}

function memberRef(model: ImmutableModel, member: string): ExactArtifactReferenceModel | undefined {
  const body = model['body'] as ImmutableModel | undefined;
  const ref = body?.[member];
  if (ref === null || ref === undefined || typeof ref !== 'object') return undefined;
  return ref as ExactArtifactReferenceModel;
}

function requiredSemanticsOf(model: ImmutableModel): readonly string[] {
  const requirements = model['requirements'] as ImmutableModel | undefined;
  const features = Array.isArray(requirements?.['protocol_features']) ? (requirements['protocol_features'] as ImmutableModel[]) : [];
  return features.map((f) => (typeof f['id'] === 'string' ? f['id'] : '')).filter((id) => id !== '');
}

function eligibilityCorrelated(evidence: EligibilitySnapshot, bundle: ValidatedArtifact, requestedUse: RequestedUseSnapshot | undefined): boolean {
  if (!evidence.eligible) return false;
  const bundleInstance = evidence.subjectCorrelations.bundleInstance;
  if (bundleInstance !== undefined && bundleInstance !== bundle.instanceId) return false;
  if (requestedUse !== undefined) {
    if (evidence.capability !== requestedUse.capability) return false;
    if (evidence.workspaceId !== requestedUse.workspaceId) return false;
  }
  return true;
}

export type PiProjectionResult =
  | { readonly ok: true; readonly plan: PiInvocationPlan }
  | { readonly ok: false; readonly findings: readonly PiFinding[] };

/**
 * Project a validated, point-of-use-eligible ExecutionBundle (plus its four
 * exact members) into a deterministic Pi invocation plan.
 */
export function projectExecutionBundleToPi(input: PiProjectionInput): PiProjectionResult {
  // Public-input shape gate (F-1/A-2/A-3): expected caller-shape errors are
  // recognized explicitly before any projection, correlation, rendering,
  // fingerprinting, or feature lookup, and fail through typed findings
  // (never raw exceptions). Every top-level input field, the capability
  // container, limits, and every context item are read through own data
  // descriptors into plain immutable snapshots; the original caller objects
  // are never read again below this point.
  const gate = validateProjectionInputShapes(input);
  const findings: PiFinding[] = [...gate.findings];
  const fail = (): PiProjectionResult => ({ ok: false, findings: Object.freeze(sortFindings(findings)) });
  if (findings.length > 0) return fail();
  const fields = gate.fields;

  // 1. validated wrappers and validation levels (raw JSON is never accepted)
  const subjects: readonly { role: PiSubjectCorrelation['role']; artifact: ValidatedArtifact; requiredKind: string; minLevel: string }[] = [
    { role: 'bundle', artifact: fields['bundle'] as ValidatedArtifact, requiredKind: 'ExecutionBundle', minLevel: BUNDLE_REQUIRED_LEVEL },
    { role: 'task', artifact: fields['taskSpec'] as ValidatedArtifact, requiredKind: 'TaskSpec', minLevel: MEMBER_REQUIRED_LEVEL },
    { role: 'authority-policy', artifact: fields['authorityPolicy'] as ValidatedArtifact, requiredKind: 'AuthorityPolicy', minLevel: MEMBER_REQUIRED_LEVEL },
    { role: 'context-manifest', artifact: fields['contextManifest'] as ValidatedArtifact, requiredKind: 'ContextManifest', minLevel: MEMBER_REQUIRED_LEVEL },
    { role: 'completion-contract', artifact: fields['completionContract'] as ValidatedArtifact, requiredKind: 'CompletionContract', minLevel: MEMBER_REQUIRED_LEVEL },
  ];
  for (const { role, artifact, requiredKind, minLevel } of subjects) {
    if (!artifact || typeof artifact !== 'object' || !isBrandedArtifact(artifact)) {
      findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'input.unvalidated', `${role} subject is not a validated Artifact Core wrapper`, `/${role}`));
      continue;
    }
    if (!isLevelAtLeast(artifact.level, minLevel as never)) {
      findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'input.level-insufficient', `${role} subject level ${artifact.level} is below ${minLevel}`, `/${role}/level`));
    }
    if (artifact.kind !== requiredKind) {
      findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'input.kind-mismatch', `${role} subject has kind ${artifact.kind}, expected ${requiredKind}`, `/${role}/kind`));
    }
  }
  if (findings.length > 0) return fail();

  const bundle = fields['bundle'] as ValidatedArtifact;
  const bundleModel = bundle.model;

  // 2. point-of-use eligibility evidence (descriptor snapshot only; the
  // original caller eligibility object is never read again — F-A4)
  const eligibility = gate.eligibility!;
  if (!eligibility.eligible) {
    findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'input.eligibility-failed', 'point-of-use eligibility evidence does not indicate eligibility'));
  } else if (!eligibilityCorrelated(eligibility, bundle, gate.requestedUse)) {
    findings.push(piFinding('PI-ADAPTER-CORRELATION-MISMATCH', 'input.eligibility-correlation', 'point-of-use eligibility evidence is not correlated with the exact bundle and requested use'));
  }

  // 3. exact-reference correlation of the four members with the bundle
  const refs: {
    task: ExactArtifactReferenceModel;
    authorityPolicy: ExactArtifactReferenceModel;
    contextManifest: ExactArtifactReferenceModel;
    completionContract: ExactArtifactReferenceModel;
  } = {
    task: exactReferenceOf(fields['taskSpec'] as ValidatedArtifact),
    authorityPolicy: exactReferenceOf(fields['authorityPolicy'] as ValidatedArtifact),
    contextManifest: exactReferenceOf(fields['contextManifest'] as ValidatedArtifact),
    completionContract: exactReferenceOf(fields['completionContract'] as ValidatedArtifact),
  };
  const bundleRefs: Record<string, ExactArtifactReferenceModel | undefined> = {
    task: memberRef(bundleModel, 'task'),
    authority_policy: memberRef(bundleModel, 'authority_policy'),
    context_manifest: memberRef(bundleModel, 'context_manifest'),
    completion_contract: memberRef(bundleModel, 'completion_contract'),
  };
  const memberOrder: readonly { member: string; ref: ExactArtifactReferenceModel; role: string }[] = [
    { member: 'task', ref: refs.task, role: 'task' },
    { member: 'authority_policy', ref: refs.authorityPolicy, role: 'authority-policy' },
    { member: 'context_manifest', ref: refs.contextManifest, role: 'context-manifest' },
    { member: 'completion_contract', ref: refs.completionContract, role: 'completion-contract' },
  ];
  for (const { member, ref, role } of memberOrder) {
    const bundleMemberRef = bundleRefs[member];
    if (!bundleMemberRef) {
      findings.push(piFinding('PI-ADAPTER-BUNDLE-MISMATCH', 'bundle.member-missing', `bundle member reference ${member} is missing`, `/bundle/body/${member}`));
      continue;
    }
    if (!exactReferencesEqual(bundleMemberRef, ref)) {
      findings.push(piFinding('PI-ADAPTER-BUNDLE-MISMATCH', 'bundle.member-mismatch', `bundle member reference ${member} does not match the supplied exact subject (${role})`, `/bundle/body/${member}`));
    }
  }

  // 4. occurrence / attempt identity (caller-supplied; never generated);
  // validated by the shape gate from own data descriptors
  const occurrenceId = fields['occurrenceId'] as string;
  const attemptId = fields['attemptId'] as string;

  // 5. registry context (descriptor snapshot only; the original caller
  // registry object is never read again — F-A4)
  const registry = gate.registry! as RegistryContextSnapshot;

  // 6. host capability compatibility (over the descriptor snapshot; the
  // original caller capability object is never read again)
  const capability = gate.capability!;
  const capabilityCompatibility = inspectPiHostCompatibility(capability as unknown as PiHostCapabilityDeclaration);
  if (!capabilityCompatibility.compatible) {
    findings.push(...capabilityCompatibility.findings);
  }

  // 7. required semantics (TaskSpec and bundle protocol features) fail closed.
  // The capability feature set is null-safe and coercion-free: only primitive
  // strings are considered; missing, non-array, or non-string declarations
  // are treated as declaring nothing (F-1).
  const capabilityFeatures = Array.isArray(capability.requiredFeatures)
    ? (capability.requiredFeatures as readonly unknown[]).filter((f): f is string => typeof f === 'string')
    : [];
  for (const [role, model] of [['bundle', bundleModel], ['task', (fields['taskSpec'] as ValidatedArtifact).model]] as const) {
    for (const feature of requiredSemanticsOf(model)) {
      if (!capabilityFeatures.includes(feature)) {
        findings.push(piFinding('PI-ADAPTER-REQUIRED-SEMANTIC-UNSUPPORTED', 'semantic.feature-unsupported', `${role} requires protocol feature ${feature} which the Pi host capability does not declare`, `/${role}/requirements`));
      }
    }
  }

  // 8. context correlation and bounds (item and capability snapshots only)
  const contextResult = correlateContextItems(
    (fields['contextManifest'] as ValidatedArtifact).model,
    capability as unknown as PiHostCapabilityDeclaration,
    gate.limits!,
    gate.contextItems ?? [],
  );
  findings.push(...contextResult.findings);

  if (findings.length > 0) return fail();

  // 10. deterministic rendering (all reads from validated snapshots)
  const limits = gate.limits!;
  const entries = manifestEntries((fields['contextManifest'] as ValidatedArtifact).model);
  const taskSection = renderTaskSection((fields['taskSpec'] as ValidatedArtifact).model);
  const contextInventory = renderContextInventory(entries);
  const { blocks, metas, findings: blockFindings } = renderContextBlocks(contextResult.ordered, limits);
  findings.push(...blockFindings);
  const completionCriteria = renderCompletionCriteria((fields['completionContract'] as ValidatedArtifact).model);
  const correlationFields: readonly { key: string; value: string }[] = [
    { key: 'occurrence_id', value: occurrenceId },
    { key: 'attempt_id', value: attemptId },
    { key: 'bundle_instance', value: bundle.instanceId },
    { key: 'bundle_revision', value: bundle.revisionId },
    { key: 'bundle_digest', value: bundle.digest },
    { key: 'registry_snapshot_id', value: registry.registrySnapshotId },
    { key: 'adapter_protocol', value: PI_ADAPTER_PROTOCOL_VERSION },
    { key: 'pi_guard_enforcement', value: 'pending' },
  ];
  const correlationFooter = renderCorrelationFooter(correlationFields);
  const renderedPrompt = renderPrompt(TRUSTED_ADAPTER_PREAMBLE, taskSection, contextInventory, blocks, completionCriteria, correlationFooter);
  const bounds = planWithinHostBounds(renderedPrompt, capability as unknown as PiHostCapabilityDeclaration, limits);
  findings.push(...bounds.findings);
  if (findings.length > 0) return fail();

  const subjectCorrelations: PiSubjectCorrelation[] = subjects.map(({ role, artifact }) => ({
    role,
    reference: exactReferenceOf(artifact),
    digest: artifact.digest,
    instanceId: artifact.instanceId,
    revisionId: artifact.revisionId,
  }));

  const plan: PiInvocationPlan = {
    protocolVersion: PI_ADAPTER_PROTOCOL_VERSION,
    consumerIdentity: PI_CONSUMER_IDENTITY,
    consumerVersion: PI_CONSUMER_VERSION,
    supportedPiLane: SUPPORTED_PI_LANE,
    bundleReference: exactReferenceOf(bundle),
    taskReference: refs['task'],
    authorityPolicyReference: refs['authorityPolicy'],
    contextManifestReference: refs['contextManifest'],
    completionContractReference: refs['completionContract'],
    occurrenceId: occurrenceId,
    attemptId: attemptId,
    preamble: TRUSTED_ADAPTER_PREAMBLE,
    taskSection,
    contextSections: metas,
    completionCriteriaSection: completionCriteria,
    correlationFooter,
    contextInventory: contextResult.ordered.map((item) => ({
      contextId: item.contextId,
      label: item.label,
      mediaType: item.mediaType,
      provenance: item.provenance,
      truncated: item.truncated,
    })),
    subjectCorrelations,
    expectedObservationContract: Object.freeze({
      completion: 'message_end|agent_end|agent_settled',
      toolCalls: 'tool_execution_start|tool_execution_end',
      cancellation: 'agent_settled',
      shutdown: 'session_shutdown',
      correlation: 'session_start|turn_start',
    }),
    capabilityCompatibility: capabilityCompatibility!,
    findings: Object.freeze([]),
    status: 'projection-ready',
    piGuardEnforcementPending: true,
    renderedPrompt,
  };

  // deep immutable snapshot + module-private membership branding
  const snapshot = snapshotJson(plan) as PiInvocationPlan;
  const wrapper = Object.freeze({ ...snapshot }) as unknown as PiInvocationPlan;
  brandPlanWrapper(wrapper);
  return { ok: true, plan: wrapper };
}
