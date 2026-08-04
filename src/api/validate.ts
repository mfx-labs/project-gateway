/**
 * Public API operations. Every operation is deterministic and side-effect
 * constrained; all external state arrives through explicit interfaces.
 *
 * Validation levels are explicit:
 *   - `validateArtifactSelf`     validates through semantic self-validation;
 *   - `validateArtifactReferences` validates through exact-reference resolution;
 *   - `validateArtifactForUse`   validates through point-of-use eligibility and
 *                                evaluates effective authority for the exact
 *                                requested use;
 *   - `validateArtifactRevision` is the controlled operation with an explicit
 *                                `through` phase (no ambiguous default).
 * A wrapper's `level` records the highest phase that succeeded; self-validated
 * subjects are never accepted where for-use validation is required.
 */
import { parseRawJson, RawJsonError } from '../json/scanner.js';
import { artifactProjection, verifyArtifactDigest, registryProjection, verifyRegistryDigest } from '../digest/index.js';
import { reportFromFindings, mk, sortFindings } from '../internal/report.js';
import { INPUT_BYTE_LIMITS, type ValidationPhase } from '../internal/phase.js';
import { SchemaRegistry } from '../schema/registry.js';
import { identifySchema } from '../schema/select.js';
import { runArtifactPipeline, runRegistrySnapshotPipeline, runLifecycleRecordPipeline, validationLevelFor } from '../engine/pipeline.js';
import { validateReferenceModel, validateReferenceModelForUse } from '../references/validate.js';
import { evaluateLifecycleGraph, evaluateLifecycleRegistryContext } from '../lifecycle/graph.js';
import { evaluateEffectiveAuthority } from '../pointofuse/evaluate.js';
import { brandValidatedArtifact, brandValidatedRecord, snapshotModel } from './types.js';
import type {
  AcceptedRegistryContext,
  ConsumerSupportDeclaration,
  EligibilityReport,
  ExactArtifactReferenceModel,
  ExactSubjectResolver,
  IdentityStateView,
  PointOfUseInputs,
  RequestedUse,
  ValidationReport,
  ValidatedArtifact,
  ValidatedLifecycleRecord,
  ValidatedRegistrySnapshot,
} from './types.js';
import type { Finding } from '../internal/report.js';

export interface ParseOptions {
  subjectClass: 'artifact' | 'registry' | 'lifecycle' | 'reference';
}

/** Parse raw bytes/string with duplicate-member rejection and bounds. Returns an accepted model or a report. */
export function parseRawJsonInput(
  input: Uint8Array | string,
  opts: ParseOptions,
): { ok: true; model: unknown } | { ok: false; report: ValidationReport } {
  const limit = INPUT_BYTE_LIMITS[opts.subjectClass] ?? INPUT_BYTE_LIMITS.generic;
  try {
    const { model } = parseRawJson(input, limit);
    return { ok: true, model };
  } catch (e) {
    const err = e as RawJsonError;
    return {
      ok: false,
      report: reportFromFindings([
        mk(
          'raw-json-intake',
          err.category,
          'raw.parse',
          err.message,
          { location: `line ${err.line}, column ${err.column}` },
        ),
      ]),
    };
  }
}

/** Create a fresh offline schema registry (independent library instance). */
export function createSchemaRegistry(): SchemaRegistry {
  return new SchemaRegistry();
}

export interface ArtifactValidationInputs {
  readonly identity?: IdentityStateView;
  readonly registry?: AcceptedRegistryContext;
  readonly consumerSupport?: ConsumerSupportDeclaration;
}

/**
 * Controlled artifact validation through an explicit phase. The returned
 * wrapper's `level` reflects exactly the phases that ran.
 */
export function validateArtifactRevision(
  model: unknown,
  registry: SchemaRegistry,
  through: ValidationPhase,
  inputs: ArtifactValidationInputs = {},
): ValidationReport & { value?: ValidatedArtifact } {
  const result = runArtifactPipeline(model, {
    schemaRegistry: registry,
    ...(inputs.identity !== undefined ? { identity: inputs.identity } : {}),
    ...(inputs.registry !== undefined ? { registry: inputs.registry } : {}),
    ...(inputs.consumerSupport !== undefined ? { consumerSupport: inputs.consumerSupport } : {}),
    through,
  });
  return result as ValidationReport & { value?: ValidatedArtifact };
}

/** Self validation: raw → canonical → structural → digest → semantic self. */
export function validateArtifactSelf(
  model: unknown,
  registry: SchemaRegistry,
  inputs: ArtifactValidationInputs = {},
): ValidationReport & { value?: ValidatedArtifact } {
  return validateArtifactRevision(model, registry, 'semantic-self-validation', inputs);
}

/** Full artifact entry: raw bytes → self-validated artifact. */
export function validateArtifactInput(
  input: Uint8Array | string,
  registry: SchemaRegistry,
  inputs: ArtifactValidationInputs = {},
): ValidationReport & { value?: ValidatedArtifact } {
  const parsed = parseRawJsonInput(input, { subjectClass: 'artifact' });
  if (!parsed.ok) return parsed.report;
  return validateArtifactSelf(parsed.model, registry, inputs);
}

export interface ForUseInputs extends ArtifactValidationInputs {
  readonly consumerSupport: ConsumerSupportDeclaration;
  readonly resolver: ExactSubjectResolver;
  readonly identity: IdentityStateView;
  readonly lifecycle: import('./types.js').LifecycleStateView;
  readonly revocations: import('./types.js').RevocationView;
  readonly currentTime: string;
  readonly workspaceId: string;
  readonly requestedUse: RequestedUse;
  readonly globalActionCeiling?: number;
  readonly workspaceActionCeiling?: number;
}

/**
 * For-use validation: the full pipeline (structural, digest, existing-registration
 * identity verification, semantic, registry) plus exact bundle-member resolution
 * (each resolver result revalidated through the full registry and consumer-support
 * pipeline) plus the exact lifecycle-chain point-of-use evaluation for the exact
 * requested use. Registry, consumer support, resolver, identity, lifecycle,
 * revocation, and point-of-use inputs are all decision-bearing; missing required
 * dependencies and missing lifecycle state fail closed.
 */
export function validateArtifactForUse(
  model: unknown,
  registry: SchemaRegistry,
  inputs: ForUseInputs,
): ValidationReport & { value?: ValidatedArtifact } {
  const failClosed = (findings: readonly Finding[]): ValidationReport & { value?: ValidatedArtifact } => reportFromFindings(findings);

  // fail closed when required dependencies are missing
  if (!inputs.registry) {
    return failClosed([mk('registry-compatibility', 'REGISTRY-INCOMPATIBILITY', 'foruse.registry-missing', 'accepted registry context is required for for-use validation', {})]);
  }
  if (!inputs.consumerSupport) {
    return failClosed([mk('consumer-support-verification', 'CONSUMER-SUPPORT-FAILURE', 'foruse.support-missing', 'consumer support declaration is required for for-use validation', {})]);
  }
  if (!inputs.resolver) {
    return failClosed([mk('exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'foruse.resolver-missing', 'exact-subject resolver is required for for-use validation', {})]);
  }
  if (!inputs.identity) {
    return failClosed([mk('identity-registration', 'IDENTITY-CONFLICT', 'foruse.identity-missing', 'identity state view is required for for-use validation', {})]);
  }

  // 1. requested-use structure and workspace alignment
  const use = inputs.requestedUse;
  if (
    !use ||
    typeof use.capability !== 'string' ||
    !use.capability ||
    typeof use.operationClass !== 'string' ||
    !use.operationClass ||
    typeof use.resourceClass !== 'string' ||
    !use.resourceClass ||
    typeof use.scope !== 'string' ||
    !use.scope ||
    typeof use.workspaceId !== 'string' ||
    !use.workspaceId
  ) {
    return failClosed([mk('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', 'foruse.requested-use-invalid', 'requested use is incomplete', { ruleIds: ['AUT-003'] })]);
  }
  if (use.workspaceId !== inputs.workspaceId) {
    return failClosed([
      mk('point-of-use-eligibility', 'WORKSPACE-FAILURE', 'foruse.workspace-mismatch', 'requested use workspace does not match the trusted workspace input', {
        ruleIds: ['WSP-008'],
        subjectIdentity: String((model as Record<string, unknown> | null)?.['instance_id'] ?? ''),
        location: '/requestedUse/workspaceId',
      }),
    ]);
  }

  // 2. full pipeline with existing-registration identity verification
  const pipeline = runArtifactPipeline(model, {
    schemaRegistry: registry,
    identity: inputs.identity,
    registry: inputs.registry,
    consumerSupport: inputs.consumerSupport,
    through: 'point-of-use-eligibility',
    identityMode: 'verify',
  });
  if (!pipeline.ok || pipeline.value === undefined) return pipeline as ValidationReport & { value?: ValidatedArtifact };
  const artifact = pipeline.value as ValidatedArtifact;
  const findings: Finding[] = [...pipeline.findings];

  // 3. point of use begins from an exact verified ExecutionBundle
  if (artifact.kind !== 'ExecutionBundle') {
    return failClosed([
      ...findings,
      mk('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', 'foruse.bundle-required', 'point-of-use evaluation requires an exact ExecutionBundle subject', {
        ruleIds: ['BND-001', 'EXE-007'],
        subjectIdentity: artifact.instanceId,
        location: '/kind',
      }),
    ]);
  }

  // 4. resolve and revalidate the four prospective member artifacts with the
  //    accepted registry context and consumer support (for-use resolution)
  const body = artifact.model['body'] as Record<string, unknown> | undefined;
  const memberReports: Record<string, ValidationReport & { value?: ValidatedArtifact }> = {};
  let resolutionFailed = false;
  for (const member of ['task', 'authority_policy', 'context_manifest', 'completion_contract'] as const) {
    const ref = body?.[member];
    if (!ref || typeof ref !== 'object') {
      findings.push(
        mk('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', 'foruse.member-missing', `bundle member ${member} is missing or malformed`, {
          ruleIds: ['BND-001', 'EXE-007'],
          subjectIdentity: artifact.instanceId,
          location: `/body/${member}`,
        }),
      );
      resolutionFailed = true;
      continue;
    }
    const report = validateReferenceModelForUse(ref, {
      identity: inputs.identity,
      schemaRegistry: registry,
      resolve: (r) => inputs.resolver.resolve(r),
      registry: inputs.registry,
      consumerSupport: inputs.consumerSupport,
      workspaceId: inputs.workspaceId,
    });
    memberReports[member] = report;
    if (!report.ok) {
      findings.push(...report.findings);
      resolutionFailed = true;
    }
  }
  if (resolutionFailed) {
    const first = sortFindings(findings)[0];
    return {
      ok: false,
      ...(first ? { firstFailingPhase: first.phase, category: first.category } : {}),
      subjectIdentity: artifact.instanceId,
      ruleIds: [...new Set(findings.flatMap((f) => f.ruleIds))],
      findings: Object.freeze(sortFindings(findings)),
    };
  }

  // 5. effective authority over the exact lifecycle chain
  const policyModel = (memberReports['authority_policy']?.value as ValidatedArtifact | undefined)?.model;
  const eligibility = evaluateEffectiveAuthority({
    currentTime: inputs.currentTime,
    workspaceId: inputs.workspaceId,
    requestedUse: inputs.requestedUse,
    globalActionCeiling: inputs.globalActionCeiling,
    workspaceActionCeiling: inputs.workspaceActionCeiling,
    consumerSupport: inputs.consumerSupport,
    identity: inputs.identity,
    resolver: inputs.resolver,
    registry: inputs.registry,
    lifecycle: inputs.lifecycle,
    revocations: inputs.revocations,
    bundle: artifact.model,
    policy: policyModel ?? {},
  });
  findings.push(...eligibility.findings);
  if (eligibility.eligible) {
    return {
      ok: true,
      ruleIds: [],
      findings: [],
      value: brandValidatedArtifact({ ...artifact, level: 'point-of-use-eligible' }),
    };
  }
  const first = sortFindings(findings)[0]!;
  return {
    ok: false,
    firstFailingPhase: first.phase,
    category: first.category,
    subjectIdentity: artifact.instanceId,
    ruleIds: [...new Set(findings.flatMap((f) => f.ruleIds))],
    findings: Object.freeze(sortFindings(findings)),
  };
}

export function validateRegistrySnapshot(
  model: unknown,
  registry: SchemaRegistry,
): ValidationReport & { value?: ValidatedRegistrySnapshot } {
  const result = runRegistrySnapshotPipeline(model, { schemaRegistry: registry });
  return result as ValidationReport & { value?: ValidatedRegistrySnapshot };
}

export function validateLifecycleRecord(
  model: unknown,
  registry: SchemaRegistry,
): ValidationReport & { value?: ValidatedLifecycleRecord } {
  const report = runLifecycleRecordPipeline(model, { schemaRegistry: registry });
  if (!report.ok) return report;
  const selection = identifySchema(model);
  const wrapper = brandValidatedRecord({
    recordType: selection.recordType ?? 'ValidationRecord',
    recordId: String((model as Record<string, unknown>)['record_id'] ?? ''),
    level: 'structural-valid',
    model: snapshotModel(model),
  });
  return { ...report, value: wrapper };
}

export interface DigestResult {
  readonly canonicalUtf8: string;
  readonly digest: string;
  readonly domain: string;
}

export function computeArtifactDigest(model: Readonly<Record<string, unknown>>): DigestResult {
  const p = artifactProjection(model);
  return { canonicalUtf8: p.canonicalUtf8, digest: p.digest, domain: p.domain };
}

export function verifyArtifactDigestValue(model: Readonly<Record<string, unknown>>, declared: string): boolean {
  return verifyArtifactDigest(model, declared);
}

export function computeRegistryDigest(model: Readonly<Record<string, unknown>>): DigestResult {
  const p = registryProjection(model);
  return { canonicalUtf8: p.canonicalUtf8, digest: p.digest, domain: p.domain };
}

export function verifyRegistryDigestValue(model: Readonly<Record<string, unknown>>, declared: string): boolean {
  return verifyRegistryDigest(model, declared);
}

export interface ReferenceValidationInputs {
  readonly identity: IdentityStateView;
  readonly resolver: ExactSubjectResolver;
}

/** Self resolution: resolver output fully revalidated; never claims registry compatibility. */
export function resolveExactArtifactReference(
  reference: ExactArtifactReferenceModel,
  registry: SchemaRegistry,
  inputs: ReferenceValidationInputs,
): ValidationReport & { value?: import('./types.js').ValidatedArtifact } {
  return validateReferenceModel(reference, {
    identity: inputs.identity,
    schemaRegistry: registry,
    resolve: (ref) => inputs.resolver.resolve(ref),
  });
}

export interface ReferenceForUseValidationInputs extends ReferenceValidationInputs {
  /** Accepted registry context (required; absent inputs fail closed). */
  readonly registryContext: AcceptedRegistryContext;
  readonly consumerSupport: ConsumerSupportDeclaration;
  /** Workspace context where applicable. */
  readonly workspaceId?: string;
}

/**
 * For-use resolution: the target is revalidated through registry compatibility
 * and consumer support with the accepted context; `registry-compatible` is
 * returned only after actual registry evaluation.
 */
export function resolveExactArtifactReferenceForUse(
  reference: ExactArtifactReferenceModel,
  registry: SchemaRegistry,
  inputs: ReferenceForUseValidationInputs,
): ValidationReport & { value?: import('./types.js').ValidatedArtifact } {
  return validateReferenceModelForUse(reference, {
    identity: inputs.identity,
    schemaRegistry: registry,
    resolve: (ref) => inputs.resolver.resolve(ref),
    registry: inputs.registryContext,
    consumerSupport: inputs.consumerSupport,
    workspaceId: inputs.workspaceId,
  });
}

export interface GraphValidationInputs {
  readonly records: readonly Readonly<Record<string, unknown>>[];
  readonly entryRecordIds: ReadonlySet<string>;
  readonly registry: AcceptedRegistryContext;
  readonly artifactsByRevision: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  readonly artifactsByInstance: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  readonly resultsByAttempt: ReadonlyMap<string, readonly Readonly<Record<string, unknown>>[]>;
  readonly entryArtifactInstances: ReadonlySet<string>;
}

export function validateLifecycleGraph(
  inputs: GraphValidationInputs,
): ValidationReport {
  const findings = evaluateLifecycleGraph(inputs);
  if (inputs.entryRecordIds.size > 0) {
    findings.push(...evaluateLifecycleRegistryContext(inputs.records, inputs.entryRecordIds, inputs.registry));
  }
  return reportFromFindings(findings);
}

/**
 * Complete point-of-use eligibility over the exact bundle and its exact
 * lifecycle chain: effective authority is the intersection of global and
 * workspace ceilings, the approved AuthorityPolicy, the active RuntimeGrant,
 * and consumer support, evaluated for the exact requested use. Missing
 * required state (bundle, policy, grant, lifecycle chain) fails closed.
 */
export function evaluatePointOfUseEligibility(
  inputs: PointOfUseInputs,
): EligibilityReport {
  return evaluateEffectiveAuthority({
    currentTime: inputs.currentTime,
    workspaceId: inputs.workspaceId,
    requestedUse: inputs.requestedUse,
    globalActionCeiling: inputs.globalActionCeiling,
    workspaceActionCeiling: inputs.workspaceActionCeiling,
    consumerSupport: inputs.consumerSupport,
    identity: inputs.identity,
    resolver: inputs.resolver,
    registry: inputs.registry,
    lifecycle: inputs.lifecycle,
    revocations: inputs.revocations,
    bundle: inputs.bundle,
    policy: inputs.policy,
    grant: inputs.grant,
  });
}

export { validationLevelFor };

/** Order of validation levels for level-guard comparison. */
const LEVEL_ORDER: readonly import('./types.js').ValidationLevel[] = [
  'raw-parsed',
  'canonical-input-valid',
  'structural-valid',
  'digest-verified',
  'self-semantic-valid',
  'exact-reference-resolved',
  'registry-compatible',
  'lifecycle-verified',
  'consumer-supported',
  'point-of-use-eligible',
];

/**
 * Validation-level guard: true when `level` is at least `required`.
 * A lower-level wrapper must never be accepted where a higher-level wrapper is
 * required.
 */
export function isLevelAtLeast(level: import('./types.js').ValidationLevel, required: import('./types.js').ValidationLevel): boolean {
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(required);
}

/** Phase order for documentation and tooling. */
import { PHASE_ORDER } from '../internal/phase.js';
export const VALIDATION_PHASES: readonly ValidationPhase[] = [...PHASE_ORDER];
