/**
 * The validation engine: ordered phase pipeline for artifact revisions,
 * registry snapshots, lifecycle records, and exact references.
 * Phases execute in the approved order; a failure at an earlier phase prevents
 * later authority-dependent use.
 */
import { validateCanonicalInput } from '../canonical/input.js';
import { artifactProjection, verifyArtifactDigest, registryProjection, verifyRegistryDigest, DIGEST_RE } from '../digest/index.js';
import { mk, sortFindings, type Finding, type ValidationReport } from '../internal/report.js';
import { PHASE_INDEX } from '../internal/phase.js';
import { SchemaRegistry } from '../schema/registry.js';
import { identifySchema, type ArtifactKindId, type SchemaSelection } from '../schema/select.js';
import type { AcceptedRegistryContext, ConsumerSupportDeclaration, IdentityStateView, ValidatedArtifact, ValidatedRegistrySnapshot } from '../api/types.js';
import { brandValidatedArtifact, brandValidatedRegistry, snapshotModel } from '../api/types.js';
import { evaluateArtifactRegistryCompatibility, optionalExtensionReliance, evaluateRegistrySnapshot } from '../registry/evaluate.js';
import { checkProposedRegistration, verifyExistingRegistration } from './identity.js';
import type { ValidationPhase } from '../internal/phase.js';

export interface EngineOptions {
  readonly schemaRegistry: SchemaRegistry;
  readonly identity?: IdentityStateView;
  readonly registry?: AcceptedRegistryContext;
  readonly consumerSupport?: ConsumerSupportDeclaration;
  readonly time?: string;
}

export interface PhaseResult extends ValidationReport {
  readonly value?: ValidatedArtifact | ValidatedRegistrySnapshot;
}

// ---------------------------------------------------------------------------
// canonical set ordering (phase 5)
// ---------------------------------------------------------------------------
interface OrderingSpec {
  path: string;
  keys: (item: Record<string, unknown>) => string[];
}

function orderingKey(...parts: unknown[]): string {
  return parts.map((p) => String(p)).join(':');
}

function artifactOrderingSpecs(model: Readonly<Record<string, unknown>>): OrderingSpec[] {
  const specs: OrderingSpec[] = [];
  const requirements = model['requirements'];
  if (requirements && typeof requirements === 'object') {
    const r = requirements as Record<string, unknown>;
    for (const key of ['protocol_features', 'consumer_capabilities']) {
      const arr = r[key];
      if (Array.isArray(arr)) {
        specs.push({
          path: `/requirements/${key}`,
          keys: (item) => [orderingKey(item['class'], item['id'], item['version'])],
        });
      }
    }
  }
  const extensions = model['extensions'];
  if (Array.isArray(extensions)) {
    specs.push({
      path: '/extensions',
      keys: (item) => [orderingKey(item['namespace'], item['version'])],
    });
  }
  const body = model['body'];
  if (body && typeof body === 'object' && (model['kind'] as Record<string, unknown> | undefined)?.['id'] === 'AuthorityPolicy') {
    const rules = (body as Record<string, unknown>)['rules'];
    if (Array.isArray(rules)) {
      for (let i = 0; i < rules.length; i++) {
        const required = (rules[i] as Record<string, unknown>)['required_semantics'];
        if (Array.isArray(required)) {
          specs.push({
            path: `/body/rules/${i}/required_semantics`,
            keys: (item) => [orderingKey(item['class'], item['id'], item['version'])],
          });
        }
      }
    }
  }
  return specs;
}

function registryOrderingSpecs(model: Readonly<Record<string, unknown>>): OrderingSpec[] {
  const specs: OrderingSpec[] = [];
  const entries = model['namespace_entries'];
  if (Array.isArray(entries)) {
    specs.push({ path: '/namespace_entries', keys: (item) => [String(item['namespace'] ?? '')] });
    for (let i = 0; i < entries.length; i++) {
      const contracts = (entries[i] as Record<string, unknown>)['extension_contracts'];
      if (Array.isArray(contracts)) {
        specs.push({ path: `/namespace_entries/${i}/extension_contracts`, keys: (item) => [String(item['version'] ?? '')] });
      }
    }
  }
  const registrations = model['feature_capability_registrations'];
  if (Array.isArray(registrations)) {
    specs.push({
      path: '/feature_capability_registrations',
      keys: (item) => [orderingKey(item['class'], item['id'], item['version'])],
    });
  }
  return specs;
}

function checkOrdering(model: Readonly<Record<string, unknown>>, specs: OrderingSpec[], ruleId: string, category: string, subjectIdentity: string): Finding[] {
  const findings: Finding[] = [];
  for (const spec of specs) {
    const arr = spec.path.split('/').reduce<unknown>((acc, seg) => {
      if (!seg) return acc;
      if (Array.isArray(acc)) return acc[Number(seg)];
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[seg];
      return undefined;
    }, model);
    if (!Array.isArray(arr)) continue;
    const items = arr as Record<string, unknown>[];
    const keys = items.map((item) => spec.keys(item).join('|'));
    const sorted = [...keys].sort();
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== sorted[i]) {
        findings.push(
          mk('canonicalization-and-digest-verification', category as never, 'canonical.set-order', 'set-like array is not in canonical order', {
            ruleIds: [ruleId],
            subjectIdentity,
            location: `${spec.path}/${i}`,
          }),
        );
        break;
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// artifact pipeline
// ---------------------------------------------------------------------------
export interface ArtifactPipelineOptions extends EngineOptions {
  /** Explicit validation phase to run through; no ambiguous default. */
  readonly through: ValidationPhase;
  /**
   * Identity execution mode at phase 6:
   * - `verify` — existing-registration verification only (for-use validation);
   * - omitted — no identity execution unless `through === 'identity-registration'`,
   *   which runs proposed-registration conflict checks only.
   * The two modes are never mixed and neither mutates identity state.
   */
  readonly identityMode?: 'verify';
}

export function validationLevelFor(through: ValidationPhase): import('../api/types.js').ValidationLevel {
  switch (through) {
    case 'canonical-input-validation':
    case 'schema-identification':
      return 'canonical-input-valid';
    case 'structural-schema-validation':
      return 'structural-valid';
    case 'canonicalization-and-digest-verification':
    case 'identity-registration':
      return 'digest-verified';
    case 'semantic-self-validation':
      return 'self-semantic-valid';
    case 'exact-reference-resolution':
    case 'cross-artifact-compatibility':
      return 'exact-reference-resolved';
    case 'registry-compatibility':
    case 'semantic-registry-validation':
      return 'registry-compatible';
    case 'trusted-lifecycle-verification':
      return 'lifecycle-verified';
    case 'consumer-support-verification':
      return 'consumer-supported';
    case 'point-of-use-eligibility':
      return 'point-of-use-eligible';
    default:
      return 'self-semantic-valid';
  }
}

export function runArtifactPipeline(model: unknown, opts: ArtifactPipelineOptions): PhaseResult {
  const findings: Finding[] = [];
  const subject = (model as Record<string, unknown> | null) ?? {};
  const subjectIdentity = String(subject['instance_id'] ?? '');
  const phaseIndexOf = (phase: string): number => (PHASE_INDEX as Readonly<Record<string, number>>)[phase] ?? 99;
  const throughIdx = phaseIndexOf(opts.through);

  // phase 2: canonical input
  const canonical = validateCanonicalInput(model, { subjectClass: 'artifact' });
  if (!canonical.ok) return { ...canonical };
  if (opts.through === 'canonical-input-validation') {
    // explicit phase gate: stop immediately; no structural or semantic claim
    return { ok: true, ruleIds: [], findings: [], level: 'canonical-input-valid' };
  }

  // phase 3: schema identification
  const selection = identifySchema(model);
  if (!selection.ok) {
    return buildReport([
      mk('schema-identification', selection.category ?? 'UNKNOWN-SCHEMA-RESOURCE', 'schema.unknown', selection.message ?? 'schema identification failed', {
        subjectIdentity,
      }),
    ]);
  }
  const schemaId = selection.schemaId!;
  const kind = selection.kind!;
  if (opts.through === 'schema-identification') {
    // explicit phase gate: stop after schema selection; no structural/semantic claim
    return { ok: true, ruleIds: [], findings: [], level: 'canonical-input-valid', schemaId };
  }

  // phase 4: structural validation (rule IDs come from the implementation-owned
  // structural-enforcement mapping, never from the conformance manifest)
  const structural = opts.schemaRegistry.validate(schemaId, model);
  if (!structural.valid) {
    const firstError = structural.errors[0];
    return buildReport([
      mk('structural-schema-validation', 'STRUCTURAL-SCHEMA-FAILURE', 'structural.schema', firstError?.message ?? 'schema validation failed', {
        ruleIds: structuralRuleIds(schemaId, structural.errors),
        schemaId,
        subjectIdentity,
        location: firstError?.instancePath ?? '',
      }),
    ]);
  }
  if (opts.through === 'structural-schema-validation') {
    // explicit phase gate: stop after structural validation
    return { ok: true, ruleIds: [], findings: [], value: artifactValue(model, kind, 'structural-valid') };
  }

  // phase 5: canonical ordering + digest
  findings.push(...checkOrdering(model as Readonly<Record<string, unknown>>, artifactOrderingSpecs(model as Readonly<Record<string, unknown>>), 'ART-008', 'CANONICAL-ORDER-FAILURE', subjectIdentity));
  const revision = (subject['revision'] as Record<string, unknown> | undefined) ?? {};
  const declaredDigest = typeof revision['digest'] === 'string' ? revision['digest'] : '';
  if (!DIGEST_RE.test(declaredDigest)) {
    findings.push(
      mk('canonicalization-and-digest-verification', 'DIGEST-MISMATCH', 'canonical.digest-syntax', 'declared digest has invalid syntax', {
        ruleIds: ['ART-005'],
        subjectIdentity,
        location: '/revision/digest',
      }),
    );
  } else if (!verifyArtifactDigest(model as Readonly<Record<string, unknown>>, declaredDigest)) {
    findings.push(
      mk('canonicalization-and-digest-verification', 'DIGEST-MISMATCH', 'canonical.digest-mismatch', 'artifact digest does not match the canonical projection', {
        ruleIds: ['ART-005'],
        subjectIdentity,
        location: '/revision/digest',
      }),
    );
  }
  const digestPhaseIdx = phaseIndexOf('canonicalization-and-digest-verification');
  if (findings.some((f) => phaseIndexOf(f.phase) <= digestPhaseIdx)) {
    return buildReport(findings);
  }
  if (opts.through === 'canonicalization-and-digest-verification') {
    // explicit phase gate: stop after canonical projection, serialization,
    // digest calculation, and digest verification
    return { ok: true, ruleIds: [], findings: [], value: artifactValue(model, kind, 'digest-verified') };
  }

  // phase 6: identity — two distinct modes, never mixed
  if (opts.through === 'identity-registration') {
    // proposed-registration validation only; never mutates identity state
    if (opts.identity) {
      findings.push(...checkProposedRegistration(model as Readonly<Record<string, unknown>>, opts.identity));
      if (findings.length > 0) return buildReport(findings);
    }
    return { ok: true, ruleIds: [], findings: [], value: artifactValue(model, kind, 'digest-verified') };
  }
  if (opts.identityMode === 'verify' && opts.identity && throughIdx >= phaseIndexOf('identity-registration')) {
    // existing-registration verification only: no proposed-registration checks
    if (!verifyExistingRegistration(model as Readonly<Record<string, unknown>>, opts.identity)) {
      return buildReport([
        mk('identity-registration', 'IDENTITY-CONFLICT', 'identity.unregistered', 'artifact instance/revision is not registered with matching identity', {
          ruleIds: ['LIN-001', 'LIN-002'],
          subjectIdentity,
          location: '/revision',
        }),
      ]);
    }
  }

  // phase 7: semantic self-validation (text/annotation responsibility checks)
  findings.push(...evaluateArtifactSemantics(kind, model as Readonly<Record<string, unknown>>, subjectIdentity));
  if (opts.through === 'semantic-self-validation') {
    return buildReport(findings.length ? findings : [], artifactValue(model, kind, 'self-semantic-valid'));
  }

  // phase 10: registry compatibility (artifact side). The registry-compatible
  // level is assigned only after actual registry and consumer-support
  // evaluation succeeds; missing registry inputs fail closed.
  if (throughIdx >= phaseIndexOf('registry-compatibility')) {
    if (!opts.registry) {
      return buildReport([
        mk('registry-compatibility', 'REGISTRY-INCOMPATIBILITY', 'registry.context-required', 'accepted registry context is required for registry compatibility', {
          subjectIdentity,
        }),
      ]);
    }
    const regFindings = evaluateArtifactRegistryCompatibility(model as Readonly<Record<string, unknown>>, {
      registry: opts.registry,
      consumerSupport: opts.consumerSupport,
    });
    findings.push(...regFindings);
    const reliance = optionalExtensionReliance(model as Readonly<Record<string, unknown>>);
    if (reliance) findings.push(reliance);
    if (opts.through === 'registry-compatibility' || opts.through === 'semantic-registry-validation') {
      return buildReport(findings, artifactValue(model, kind, 'registry-compatible'));
    }
  }

  // Later lifecycle and point-of-use levels are assigned only by their own
  // entry points after those phases execute; the pipeline never labels a
  // subject beyond the phases it actually executed.
  const executedLevel = throughIdx >= phaseIndexOf('registry-compatibility') ? 'registry-compatible' : 'self-semantic-valid';
  return buildReport(findings, artifactValue(model, kind, executedLevel));
}

function artifactValue(model: unknown, kind: ArtifactKindId, level: import('../api/types.js').ValidationLevel = 'self-semantic-valid'): ValidatedArtifact {
  const subject = model as Record<string, unknown>;
  const revision = (subject['revision'] as Record<string, unknown>) ?? {};
  const projection = artifactProjection(subject as Readonly<Record<string, unknown>>);
  return brandValidatedArtifact({
    kind,
    instanceId: String(subject['instance_id'] ?? ''),
    revisionId: String(revision['id'] ?? ''),
    digest: String(revision['digest'] ?? ''),
    canonicalUtf8: projection.canonicalUtf8,
    level,
    model: snapshotModel(model),
  });
}

// ---------------------------------------------------------------------------
// registry snapshot pipeline
// ---------------------------------------------------------------------------
export function runRegistrySnapshotPipeline(model: unknown, opts: EngineOptions): PhaseResult {
  const subject = (model as Record<string, unknown> | null) ?? {};
  const subjectIdentity = String(subject['snapshot_id'] ?? '');
  const canonical = validateCanonicalInput(model, { subjectClass: 'registry' });
  if (!canonical.ok) return { ...canonical };
  const selection = identifySchema(model);
  if (!selection.ok) {
    return buildReport([mk('schema-identification', selection.category ?? 'UNKNOWN-SCHEMA-RESOURCE', 'schema.unknown', selection.message ?? 'schema identification failed', { subjectIdentity })]);
  }
  const schemaId = selection.schemaId!;
  const structural = opts.schemaRegistry.validate(schemaId, model);
  if (!structural.valid) {
    const firstError = structural.errors[0];
    const structuralFinding: Finding = {
      phase: 'structural-schema-validation',
      category: 'STRUCTURAL-SCHEMA-FAILURE',
      ruleIds: [],
      schemaId,
      subjectIdentity,
      location: firstError?.instancePath ?? '',
      messageKey: 'structural.schema',
      message: firstError?.message ?? 'schema validation failed',
    };
    return buildReport([structuralFinding]);
  }
  const findings: Finding[] = [];
  findings.push(...checkOrdering(model as Readonly<Record<string, unknown>>, registryOrderingSpecs(model as Readonly<Record<string, unknown>>), 'REG-009', 'CANONICAL-ORDER-FAILURE', subjectIdentity));
  const projection = registryProjection(model as Readonly<Record<string, unknown>>);
  const declared = typeof subject['snapshot_digest'] === 'string' ? subject['snapshot_digest'] : '';
  if (!verifyRegistryDigest(model as Readonly<Record<string, unknown>>, declared)) {
    findings.push(
      mk('canonicalization-and-digest-verification', 'DIGEST-MISMATCH', 'registry.digest-mismatch', 'registry snapshot digest does not match the canonical projection', {
        ruleIds: ['REG-004'],
        subjectIdentity,
        location: '/snapshot_digest',
      }),
    );
  }
  const phaseIndex = PHASE_INDEX as Readonly<Record<string, number>>;
  const digestPhaseIdx = phaseIndex['canonicalization-and-digest-verification'] ?? 99;
  if (findings.some((f) => (phaseIndex[f.phase] ?? 99) <= digestPhaseIdx)) {
    return buildReport(findings);
  }
  // semantic registry validation (phase 10)
  const semantic = evaluateRegistrySnapshot(model as Readonly<Record<string, unknown>>);
  findings.push(...semantic);
  return buildReport(findings, brandValidatedRegistry({
    snapshotId: subjectIdentity,
    digest: projection.digest,
    canonicalUtf8: projection.canonicalUtf8,
    level: 'registry-compatible',
    model: snapshotModel(model),
  }));
}

// ---------------------------------------------------------------------------
// lifecycle record pipeline (structural)
// ---------------------------------------------------------------------------
export function runLifecycleRecordPipeline(model: unknown, opts: EngineOptions): ValidationReport {
  const subject = (model as Record<string, unknown> | null) ?? {};
  const subjectIdentity = String(subject['record_id'] ?? '');
  const canonical = validateCanonicalInput(model, { subjectClass: 'lifecycle' });
  if (!canonical.ok) return { ...canonical };
  const selection = identifySchema(model);
  if (!selection.ok) {
    return buildReport([mk('schema-identification', selection.category ?? 'UNKNOWN-SCHEMA-RESOURCE', 'schema.unknown', selection.message ?? 'schema identification failed', { subjectIdentity })]);
  }
  const structural = opts.schemaRegistry.validate(selection.schemaId!, model);
  if (!structural.valid) {
    const firstError = structural.errors[0];
    const finding: Finding = {
      phase: 'structural-schema-validation',
      category: 'STRUCTURAL-SCHEMA-FAILURE',
      ruleIds: [],
      schemaId: selection.schemaId,
      subjectIdentity,
      location: firstError?.instancePath ?? '',
      messageKey: 'structural.schema',
      message: firstError?.message ?? 'schema validation failed',
    };
    return buildReport([finding]);
  }
  return { ok: true, ruleIds: [], findings: [] };
}

export function buildReport(findings: readonly Finding[], value?: ValidatedArtifact | ValidatedRegistrySnapshot): PhaseResult {
  const sorted = sortFindings(findings);
  if (sorted.length === 0) {
    return value !== undefined ? { ok: true, ruleIds: [], findings: [], value } : { ok: true, ruleIds: [], findings: [] };
  }
  const first = sorted[0]!;
  return {
    ok: false,
    firstFailingPhase: first.phase,
    category: first.category,
    ...(first.schemaId !== undefined ? { schemaId: first.schemaId } : {}),
    ...(first.subjectIdentity !== undefined ? { subjectIdentity: first.subjectIdentity } : {}),
    ruleIds: sorted.flatMap((f) => f.ruleIds),
    findings: Object.freeze(sorted),
  };
}

// ---------------------------------------------------------------------------
// artifact semantic self-validation (phase 7)
// ---------------------------------------------------------------------------
import { evaluateArtifactSemantics } from '../semantic/engine.js';
import { structuralRuleIds } from '../internal/structural-map.js';

export type { SchemaSelection };
export { identifySchema };
