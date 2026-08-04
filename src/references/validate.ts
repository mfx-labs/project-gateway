/**
 * Exact-reference resolution (phase 8), separated by validation purpose:
 *
 * - `validateReferenceModel` — SELF resolution: the reference value is
 *   validated against the approved Draft 2020-12 exact-reference schema; the
 *   referenced subject is requested from the injected resolver; the returned
 *   subject is treated as untrusted and revalidated through raw parsing,
 *   canonical input, schema selection, structural schema, canonicalization and
 *   digest, existing identity registration, lineage, and semantic self-
 *   validation; every exact-reference field is compared independently. Self
 *   resolution never claims registry compatibility.
 *
 * - `validateReferenceModelForUse` — FOR-USE resolution: additionally requires
 *   the accepted registry context and consumer-support declaration and
 *   revalidates the target through registry compatibility and consumer support
 *   before any field comparison; `registry-compatible` is returned only after
 *   actual registry evaluation, and required inputs being absent fails closed.
 *
 * No path/alias/latest/partial/fallback resolution exists and no handwritten
 * shape guard is authoritative.
 */
import { runArtifactPipeline } from '../engine/pipeline.js';
import { mk, reportFromFindings, type Finding } from '../internal/report.js';
import type {
  AcceptedRegistryContext,
  ConsumerSupportDeclaration,
  ExactArtifactReferenceModel,
  IdentityStateView,
  ValidatedArtifact,
  ValidationReport,
} from '../api/types.js';
import { EXACT_REFERENCE_SCHEMA } from '../schema/select.js';
import { structuralRuleIds } from '../internal/structural-map.js';
import { verifyExistingRegistration } from '../engine/identity.js';
import { workspaceBindingsEqual } from '../internal/protocol-equality.js';

export interface ReferenceContextBase {
  readonly identity: IdentityStateView;
  readonly schemaRegistry: import('../schema/registry.js').SchemaRegistry;
  readonly resolve: (reference: ExactArtifactReferenceModel) => unknown | undefined;
}

export interface ReferenceSelfContext extends ReferenceContextBase {}

export interface ReferenceForUseContext extends ReferenceContextBase {
  /** Required for for-use resolution; absent inputs fail closed. */
  readonly registry: AcceptedRegistryContext;
  readonly consumerSupport: ConsumerSupportDeclaration;
  /** Workspace context where applicable: a bound target must match it. */
  readonly workspaceId?: string;
}

/**
 * Selection-level shape probe used ONLY to decide whether the input selects the
 * exact-reference schema (phase 3). It is never the authoritative validator.
 */
export function isExactReferenceShape(v: unknown): v is ExactArtifactReferenceModel {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  if (typeof r['target_protocol_version'] !== 'string') return false;
  const kind = r['target_kind'];
  if (kind === null || typeof kind !== 'object') return false;
  const k = kind as Record<string, unknown>;
  if (typeof k['id'] !== 'string' || typeof k['version'] !== 'string') return false;
  if (typeof r['target_instance_id'] !== 'string') return false;
  if (typeof r['target_revision_id'] !== 'string') return false;
  if (typeof r['target_digest'] !== 'string') return false;
  const binding = r['target_workspace_binding'];
  if (binding === null || typeof binding !== 'object') return false;
  return true;
}

/**
 * Semantic workspace-binding comparison, independent of member insertion order.
 * Delegates to the authoritative comparator in `src/internal/protocol-equality.ts`.
 */
export function bindingsEqual(a: unknown, b: unknown): boolean {
  return workspaceBindingsEqual(a, b);
}

/** Identity verification: the target must be an already-registered revision. */
function verifyTargetRegistration(
  reference: ExactArtifactReferenceModel,
  identity: IdentityStateView,
  subjectIdentity: string,
): Finding[] {
  const findings: Finding[] = [];
  const registered = identity.verifyRegistration(
    reference.target_instance_id,
    reference.target_revision_id,
    reference.target_digest,
  );
  if (!registered) {
    findings.push(
      mk('exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'reference.unregistered', 'resolved target revision is not registered with matching identity and digest', {
        ruleIds: ['REF-001', 'REF-003', 'REF-004'],
        schemaId: EXACT_REFERENCE_SCHEMA,
        subjectIdentity,
        location: '/target_revision_id',
      }),
    );
  }
  return findings;
}

/**
 * Revalidate the resolver output as untrusted input. `forUse` revalidates
 * through registry compatibility and consumer support (with the supplied
 * context); self resolution stops at semantic self-validation and never claims
 * registry compatibility. Identity is verified explicitly by the caller
 * (`verifyTargetRegistration`), never through proposed-registration checks.
 */
function revalidateTarget(
  raw: unknown,
  ctx: ReferenceSelfContext | ReferenceForUseContext,
  forUse: boolean,
  subjectIdentity: string,
): { ok: boolean; value?: ValidatedArtifact; findings: Finding[] } {
  const base = {
    schemaRegistry: ctx.schemaRegistry,
    identity: ctx.identity,
    through: forUse ? ('registry-compatibility' as const) : ('semantic-self-validation' as const),
  };
  const pipeline = forUse
    ? runArtifactPipeline(raw, {
        ...base,
        registry: (ctx as ReferenceForUseContext).registry,
        consumerSupport: (ctx as ReferenceForUseContext).consumerSupport,
      })
    : runArtifactPipeline(raw, base);
  if (!pipeline.ok) {
    return {
      ok: false,
      findings: [
        mk('exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'reference.target-invalid', 'resolver returned a subject that fails validation', {
          ruleIds: ['REF-001'],
          schemaId: EXACT_REFERENCE_SCHEMA,
          subjectIdentity,
          location: '',
        }),
        ...pipeline.findings,
      ],
    };
  }
  const target = pipeline.value as ValidatedArtifact | undefined;
  if (!target) {
    return {
      ok: false,
      findings: [
        mk('exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'reference.target-invalid', 'resolver returned a subject that fails validation', {
          ruleIds: ['REF-001'],
          schemaId: EXACT_REFERENCE_SCHEMA,
          subjectIdentity,
          location: '',
        }),
      ],
    };
  }
  return { ok: true, value: target, findings: [] };
}

function resolveReference(
  model: unknown,
  ctx: ReferenceSelfContext | ReferenceForUseContext,
  forUse: boolean,
): ValidationReport & { value?: ValidatedArtifact } {
  // fail closed when required registry/support inputs are absent for for-use
  if (forUse) {
    const fu = ctx as ReferenceForUseContext;
    if (!fu.registry || !fu.consumerSupport) {
      return reportFromFindings([
        mk('registry-compatibility', 'REGISTRY-INCOMPATIBILITY', 'reference.registry-required', 'accepted registry context and consumer support are required for for-use reference resolution', {
          ruleIds: ['REG-001', 'SEC-003'],
          schemaId: EXACT_REFERENCE_SCHEMA,
          location: '',
        }),
      ]);
    }
  }

  // 1. authoritative schema validation of the reference value itself
  const structural = ctx.schemaRegistry.validate(EXACT_REFERENCE_SCHEMA, model);
  if (!structural.valid) {
    const firstError = structural.errors[0];
    return reportFromFindings([
      mk('structural-schema-validation', 'STRUCTURAL-SCHEMA-FAILURE', 'reference.schema', firstError?.message ?? 'exact-reference schema validation failed', {
        ruleIds: structuralRuleIds(EXACT_REFERENCE_SCHEMA, structural.errors),
        schemaId: EXACT_REFERENCE_SCHEMA,
        location: firstError?.instancePath ?? '',
      }),
    ]);
  }
  const reference = model as ExactArtifactReferenceModel;
  const subjectIdentity = reference.target_instance_id;

  // 2. request the subject from the injected resolver
  const raw = ctx.resolve(reference);
  if (raw === undefined || raw === null) {
    return reportFromFindings([
      mk('exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'reference.unresolved', 'exact reference target is unresolved', {
        ruleIds: ['REF-001', 'RES-002'],
        schemaId: EXACT_REFERENCE_SCHEMA,
        subjectIdentity,
        location: '',
      }),
    ]);
  }

  // 3. treat as untrusted: full revalidation pipeline
  const revalidated = revalidateTarget(raw, ctx, forUse, subjectIdentity);
  if (!revalidated.ok) {
    return reportFromFindings(revalidated.findings);
  }
  const target = revalidated.value!;

  // 4. identity verification (existing registration only — never registration)
  const findings: Finding[] = [...verifyTargetRegistration(reference, ctx.identity, subjectIdentity)];

  // 4b. existing-registration verification of the revalidated target model
  //     (digest/generation/predecessor/workspace binding; never registers)
  if (!verifyExistingRegistration(target.model, ctx.identity)) {
    findings.push(
      mk('exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'reference.identity-verification', 'resolved target fails existing-registration verification', {
        ruleIds: ['REF-001', 'LIN-002'],
        schemaId: EXACT_REFERENCE_SCHEMA,
        subjectIdentity,
        location: '/target_revision_id',
      }),
    );
  }

  // 5. compare every exact-reference field independently
  const model2 = target.model;
  const proto = model2['protocol'] as Record<string, unknown>;
  const kind = model2['kind'] as Record<string, unknown>;
  const binding = model2['workspace_binding'] as Record<string, unknown>;
  if (String(proto['version']) !== reference.target_protocol_version) {
    findings.push(mk('exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'reference.protocol-version', 'target protocol version mismatch', {
      ruleIds: ['REF-002'], schemaId: EXACT_REFERENCE_SCHEMA, subjectIdentity, location: '/target_protocol_version',
    }));
  }
  if (String(kind['id']) !== reference.target_kind.id || String(kind['version']) !== reference.target_kind.version) {
    findings.push(mk('exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'reference.kind', 'target kind/version mismatch', {
      ruleIds: ['REF-002', 'REF-003', 'BND-002'], schemaId: EXACT_REFERENCE_SCHEMA, subjectIdentity, location: '/target_kind',
    }));
  }
  if (target.instanceId !== reference.target_instance_id) {
    findings.push(mk('exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'reference.instance', 'target instance mismatch', {
      ruleIds: ['REF-003'], schemaId: EXACT_REFERENCE_SCHEMA, subjectIdentity, location: '/target_instance_id',
    }));
  }
  if (target.revisionId !== reference.target_revision_id) {
    findings.push(mk('exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'reference.revision', 'target revision mismatch', {
      ruleIds: ['REF-003'], schemaId: EXACT_REFERENCE_SCHEMA, subjectIdentity, location: '/target_revision_id',
    }));
  }
  if (target.digest !== reference.target_digest) {
    findings.push(mk('exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'reference.digest', 'target digest mismatch', {
      ruleIds: ['REF-004'], schemaId: EXACT_REFERENCE_SCHEMA, subjectIdentity, location: '/target_digest',
    }));
  }
  if (!bindingsEqual(binding, reference.target_workspace_binding)) {
    findings.push(mk('exact-reference-resolution', 'WORKSPACE-FAILURE', 'reference.workspace', 'target workspace binding mismatch', {
      ruleIds: ['REF-005', 'WSP-004'], schemaId: EXACT_REFERENCE_SCHEMA, subjectIdentity, location: '/target_workspace_binding',
    }));
  }
  // 6. workspace context (for-use): a bound target must match the use workspace
  if (forUse) {
    const fu = ctx as ReferenceForUseContext;
    const workspaceId = fu.workspaceId;
    if (workspaceId !== undefined) {
      const bindingModel = model2['workspace_binding'] as Record<string, unknown> | undefined;
      const mode = String(bindingModel?.['mode'] ?? '');
      const boundWs = String(bindingModel?.['workspace_id'] ?? '');
      if (mode === 'bound' && boundWs && boundWs !== workspaceId) {
        findings.push(mk('exact-reference-resolution', 'WORKSPACE-FAILURE', 'reference.workspace-context', 'bound target workspace does not match the use workspace', {
          ruleIds: ['WSP-004', 'WSP-008'], schemaId: EXACT_REFERENCE_SCHEMA, subjectIdentity, location: '/target_workspace_binding',
        }));
      }
    }
  }
  const report = reportFromFindings(findings);
  return { ...report, value: target };
}

/** Self resolution: no registry-compatibility claim; stops at semantic self-validation. */
export function validateReferenceModel(
  model: unknown,
  ctx: ReferenceSelfContext,
): ValidationReport & { value?: ValidatedArtifact } {
  return resolveReference(model, ctx, false);
}

/** For-use resolution: registry compatibility and consumer support are required and executed. */
export function validateReferenceModelForUse(
  model: unknown,
  ctx: ReferenceForUseContext,
): ValidationReport & { value?: ValidatedArtifact } {
  return resolveReference(model, ctx, true);
}
