/**
 * Conformance manifest runner: executes the complete committed WP-3 corpus.
 * The manifest is the executable oracle; every entry is evaluated and compared
 * against its declared phase, category, rules, schema, and outcome.
 */
import { CONFORMANCE_MANIFEST, CORPUS_INPUTS } from '../generated/corpus-bundle.js';
import { parseRawJson, RawJsonError } from '../json/scanner.js';
import { validateCanonicalInput } from '../canonical/input.js';
import { jcsSerialize } from '../canonical/jcs.js';
import { ARTIFACT_DIGEST_DOMAIN, REGISTRY_DIGEST_DOMAIN, artifactProjection, registryProjection } from '../digest/index.js';
import { sortFindings, type Finding } from '../internal/report.js';
import { PHASE_INDEX, INPUT_BYTE_LIMITS, type ValidationPhase, type FailureCategory } from '../internal/phase.js';
import { SchemaRegistry } from '../schema/registry.js';
import { identifySchema, EXACT_REFERENCE_SCHEMA } from '../schema/select.js';
import { MemoryIdentityState, type AcceptedRegistryContext, type ValidatedArtifact, type ValidatedRegistrySnapshot, type ExactArtifactReferenceModel } from '../api/types.js';
import { runArtifactPipeline, runRegistrySnapshotPipeline } from '../engine/pipeline.js';
import { evaluateArtifactSemantics } from '../semantic/engine.js';
import { evaluateCrossArtifact } from '../bundle/validate.js';
import { evaluateLifecycleGraph, evaluateLifecycleRegistryContext } from '../lifecycle/graph.js';
import { evaluatePointOfUse } from '../pointofuse/evaluate.js';
import { evaluateArtifactRegistryCompatibility, optionalExtensionReliance } from '../registry/evaluate.js';
import { isExactReferenceShape, validateReferenceModel } from '../references/validate.js';
import { secondResultConflictFindings } from '../semantic/rules.js';
import { structuralRuleIds, rawRuleIds, canonicalRuleIds, selectionRuleIds, referenceInputRuleIds } from '../internal/structural-map.js';
import { schemaResourceForFixture, assertSchemaResourceMapIntegrity } from '../internal/schema-resource-map.js';
import { checkProposedRegistration } from '../engine/identity.js';
import { mk } from '../internal/report.js';
import { validateTrustedWorkspaceConfiguration, TRUSTED_HOST_LANE } from '../trusted/index.js';
import { brandRecordWrapper } from '../internal/snapshot.js';
import { evaluatePointOfUseEligibilityForConfiguration, type PointOfUseRoutingResult } from '../pointofuse/index.js';

export interface ConformanceManifestEntry {
  fixture_id: string;
  paths: string[];
  subject_type: string;
  validation_phase: string;
  expected_result: 'pass' | 'fail';
  expected_schema_id: string | null;
  expected_semantic_rule_ids: string[];
  expected_failure_category: string | null;
  dependencies: string[];
  registry_snapshot_reference: unknown;
  notes: string;
  normative: boolean;
}

export interface ConformanceSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly mismatches: readonly ConformanceMismatch[];
  readonly executed: number;
}

export interface ConformanceMismatch {
  readonly fixtureId: string;
  readonly reason: string;
  readonly detail: string;
}

export class ConformanceRunner {
  private readonly schemaRegistry: SchemaRegistry;
  private readonly entries: ConformanceManifestEntry[];
  private readonly inputs: ReadonlyMap<string, Uint8Array>;
  private readonly validArtifacts: ValidatedArtifact[];
  private readonly validArtifactModels: Map<string, Readonly<Record<string, unknown>>>;
  private readonly validArtifactsByInstance: Map<string, Readonly<Record<string, unknown>>>;
  private readonly corpusRecords: Readonly<Record<string, unknown>>[];
  private readonly validRecordModels: Readonly<Record<string, unknown>>[];
  private readonly resultsByAttempt: Map<string, Readonly<Record<string, unknown>>[]>;
  private readonly acceptedRegistry: AcceptedRegistryContext;
  private readonly consumerSupport = {
    consumerId: 'project-gateway.fixture-consumer',
    supportedProtocolFeatures: [
      'project-gateway.conformance-alpha',
      'project-gateway.conformance-beta',
      'project-gateway.conformance-fixture',
    ],
    supportedConsumerCapabilities: [
      'project-gateway.workspace-read',
      'project-gateway.git-read',
      'project-gateway.fixture-consumer',
    ],
    supportedExtensionNamespaces: ['project-gateway.conformance-tag', 'example.review-evidence'],
  };
  readonly currentTime = '2026-08-04T06:10:00.000Z';

  constructor() {
    assertSchemaResourceMapIntegrity();
    this.schemaRegistry = new SchemaRegistry();
    this.entries = (CONFORMANCE_MANIFEST as { fixtures: ConformanceManifestEntry[] }).fixtures;
    const inputs = new Map<string, Uint8Array>();
    for (const [rel, b64] of Object.entries(CORPUS_INPUTS as Record<string, string>)) {
      inputs.set(rel, Buffer.from(b64, 'base64'));
    }
    this.inputs = inputs;
    this.validArtifacts = [];
    this.validArtifactModels = new Map();
    this.validArtifactsByInstance = new Map();
    this.corpusRecords = [];
    this.validRecordModels = [];
    this.resultsByAttempt = new Map();
    this.buildCorpusState();
    const snapshotModel = this.loadJson('fixtures/registry/valid/registry-v1.json');
    this.acceptedRegistry = {
      registryProtocolId: 'project-gateway.registry',
      registrySnapshotFormatVersion: '1.0',
      registrySnapshotId: String((snapshotModel as Record<string, unknown>)['snapshot_id'] ?? ''),
      registrySnapshotDigest: String((snapshotModel as Record<string, unknown>)['snapshot_digest'] ?? ''),
      snapshot: this.runRegistry(snapshotModel).value as ValidatedRegistrySnapshot,
    };
  }

  private buildCorpusState(): void {
    const identity = new MemoryIdentityState();
    const entries = this.entries;
    const validArtifactPaths = new Set<string>();
    for (const e of entries) {
      for (const p of e.paths) {
        if (p.startsWith('fixtures/artifacts/valid/') && p.endsWith('.json')) validArtifactPaths.add(p);
      }
    }
    for (const rel of [...validArtifactPaths].sort()) {
      const model = this.loadJson(rel);
      const result = runArtifactPipeline(model, {
        schemaRegistry: this.schemaRegistry,
        identity,
        through: 'semantic-self-validation',
      });
      if (result.ok && result.value) {
        const artifact = result.value as ValidatedArtifact;
        this.validArtifacts.push(artifact);
        this.validArtifactModels.set(artifact.revisionId, artifact.model);
        this.validArtifactsByInstance.set(artifact.instanceId, artifact.model);
        const revision = artifact.model['revision'] as Record<string, unknown>;
        const predecessor = revision['predecessor'] as ExactArtifactReferenceModel | undefined;
        identity.register(artifact, predecessor);
      }
    }
    const lifecyclePaths = new Set<string>();
    for (const e of entries) {
      for (const p of e.paths) {
        if (p.startsWith('fixtures/lifecycle/') && p.endsWith('.json')) lifecyclePaths.add(p);
      }
    }
    for (const rel of [...lifecyclePaths].sort()) {
      const model = this.loadJson(rel);
      this.corpusRecords.push(model);
      if (rel.startsWith('fixtures/lifecycle/valid/')) this.validRecordModels.push(model);
    }
    // result-instance graph: results referenced by validation/publication records
    const referenced = new Set<string>();
    for (const r of this.corpusRecords) {
      const type = String(r['record_type'] ?? '');
      if (type === 'ValidationRecord') {
        const subj = r['subject'] as Record<string, unknown> | undefined;
        if (subj && typeof subj['revision_id'] === 'string') referenced.add(String(subj['revision_id']));
      }
      if (type === 'ResultPublicationRecord') {
        const subj = r['result_subject'] as Record<string, unknown> | undefined;
        if (subj && typeof subj['revision_id'] === 'string') referenced.add(String(subj['revision_id']));
      }
    }
    for (const artifact of this.validArtifacts) {
      if (artifact.kind !== 'ExecutionResult') continue;
      if (!referenced.has(artifact.revisionId)) continue;
      const attempt = String((artifact.model['body'] as Record<string, unknown>)['reported_attempt_id'] ?? '');
      const list = this.resultsByAttempt.get(attempt) ?? [];
      list.push(artifact.model);
      this.resultsByAttempt.set(attempt, list);
    }
  }

  private loadJson(rel: string): Readonly<Record<string, unknown>> {
    const bytes = this.inputs.get(rel);
    if (!bytes) throw new Error(`corpus input missing: ${rel}`);
    return JSON.parse(new TextDecoder('utf-8').decode(bytes)) as Record<string, unknown>;
  }

  private runRegistry(model: unknown) {
    return runRegistrySnapshotPipeline(model, { schemaRegistry: this.schemaRegistry });
  }

  private parseBytes(rel: string, limit: number): { model?: unknown; error?: RawJsonError } {
    const bytes = this.inputs.get(rel);
    if (!bytes) return { error: new RawJsonError('RAW-PARSE-FAILURE', `missing input ${rel}`, 0) };
    try {
      return { model: parseRawJson(bytes, limit).model };
    } catch (e) {
      return { error: e as RawJsonError };
    }
  }

  run(): ConformanceSummary {
    // validate dependency metadata integrity
    const ids = new Set(this.entries.map((e) => e.fixture_id));
    const mismatches: ConformanceMismatch[] = [];
    for (const e of this.entries) {
      for (const d of e.dependencies) {
        if (!ids.has(d)) {
          mismatches.push({ fixtureId: e.fixture_id, reason: 'dependency-invalid', detail: d });
        }
      }
    }
    // deterministic order: sorted fixture IDs (dependencies are validated; evaluation
    // context is corpus-wide, so no topological coupling is required)
    const ordered = [...this.entries].sort((a, b) => a.fixture_id.localeCompare(b.fixture_id));
    let passed = 0;
    let failed = 0;
    let executed = 0;
    for (const entry of ordered) {
      const result = this.evaluateEntry(entry);
      executed++;
      if (result.ok) passed++;
      else {
        failed++;
        mismatches.push({ fixtureId: entry.fixture_id, reason: result.reason ?? 'unknown', detail: result.detail ?? '' });
      }
    }
    return {
      total: this.entries.length,
      passed,
      failed,
      mismatches,
      executed,
    };
  }

  private phaseIndex(p: string): number {
    return PHASE_INDEX[p as ValidationPhase];
  }

  private evaluateEntry(entry: ConformanceManifestEntry): { ok: boolean; reason?: string; detail?: string } {
    const declared = entry.validation_phase;
    const declaredIdx = this.phaseIndex(declared);
    if (Number.isNaN(declaredIdx)) {
      return { ok: false, reason: 'unknown-phase', detail: declared };
    }
    let findings: Finding[] = [];
    let schemaUsed: string | undefined;

    if (entry.fixture_id.startsWith('SCH-')) {
      // schema-resource fixtures: the schema execution target is resolved from
      // the implementation-owned path→catalog mapping (never from
      // `expected_schema_id`); actual findings are produced by the structural
      // validator and compared by the common comparison logic.
      const model = this.loadJson(entry.paths[0]!);
      const sid = schemaResourceForFixture(entry.paths[0]!, entry.subject_type);
      if (sid === undefined) {
        return { ok: false, reason: 'schema-resource-unknown', detail: `${entry.fixture_id} has no implementation-owned schema resource` };
      }
      const structural = this.schemaRegistry.validate(sid, model);
      if (!structural.valid) {
        findings = [
          mk('structural-schema-validation', 'STRUCTURAL-SCHEMA-FAILURE', 'structural.schema', 'schema component rejected', { schemaId: sid, ruleIds: structuralRuleIds(sid, structural.errors) }),
        ];
      }
      schemaUsed = sid;
    } else if (entry.fixture_id.startsWith('CAN-')) {
      // canonical-vector entries: actual evaluation object produced by
      // `evaluateVector`; compared with the vector comparison logic.
      const vector = this.loadJson(entry.paths[0]!);
      const actual = this.evaluateVector(entry, vector);
      return this.compareVector(entry, declared, declaredIdx, actual);
    } else if (entry.fixture_id.startsWith('POUV2-')) {
      // PointOfUse v2 conformance context: the authoritative internal router
      // evaluates the fixture descriptor's genuine configuration and exact
      // versioned request; the descriptor's `expect` block is the oracle.
      return this.evaluatePouV2Entry(entry);
    } else if (entry.paths[0]!.startsWith('fixtures/canonicalization/')) {
      // RULE-* coverage entries over canonicalization vectors: the actual
      // evaluation object is routed through the SAME common comparison logic
      // used for other entries (phase, category, rule IDs, pass/fail).
      const vector = this.loadJson(entry.paths[0]!);
      const actual = this.evaluateVector(entry, vector);
      const sorted = sortFindings(actual.findings);
      return this.compare(entry, declared, declaredIdx, sorted, sorted[0], actual.schemaId);
    } else {
      const path = entry.paths[0]!;
      const isRaw = path.endsWith('.raw');
      const parsed = isRaw ? undefined : this.parseBytes(path, this.byteLimitFor(path));
      if (parsed && parsed.error) {
        findings = [
          mk('raw-json-intake', parsed.error.category as never, 'raw.parse', parsed.error.message, { ruleIds: rawRuleIds(parsed.error.category, parsed.error.message) }),
        ];
        if (parsed.error.category === 'INVALID-UNICODE' && declared === 'canonical-input-validation') {
          // unpaired-surrogate escapes are raw-intake failures in this corpus
        }
      } else if (isRaw) {
        // raw file: evaluate via parseBytes with raw limit
        const rawResult = this.parseBytes(path, INPUT_BYTE_LIMITS.generic);
        if (rawResult.error) {
          findings = [mk('raw-json-intake', rawResult.error.category as never, 'raw.parse', rawResult.error.message, { ruleIds: rawRuleIds(rawResult.error.category, rawResult.error.message) })];
        } else {
          // parseable raw: canonical-input check (registry non-nfc .raw)
          const canonical = validateCanonicalInput(rawResult.model, { subjectClass: path.startsWith('fixtures/registry/') ? 'registry' : 'artifact' });
          if (!canonical.ok) {
            findings = canonical.findings.map((f) => ({ ...f, ruleIds: canonicalRuleIds(f.category) }));
          }
        }
      } else {
        const model = parsed!.model as Record<string, unknown>;
        const evaluation = this.evaluateSubject(entry, path, model, declaredIdx);
        findings = evaluation.findings;
        schemaUsed = evaluation.schemaUsed;
      }
    }

    const sorted = sortFindings(findings);
    const first = sorted[0];
    const ok = this.compare(entry, declared, declaredIdx, sorted, first, schemaUsed);
    if (!ok.ok) return ok;
    return { ok: true };
  }

  private byteLimitFor(path: string): number {
    if (path.startsWith('fixtures/artifacts/')) return INPUT_BYTE_LIMITS.artifact;
    if (path.startsWith('fixtures/registry/')) return INPUT_BYTE_LIMITS.registry;
    if (path.startsWith('fixtures/lifecycle/')) return INPUT_BYTE_LIMITS.lifecycle;
    return INPUT_BYTE_LIMITS.generic;
  }

  private evaluateSubject(
    entry: ConformanceManifestEntry,
    path: string,
    model: Readonly<Record<string, unknown>>,
    declaredIdx: number,
  ): { findings: Finding[]; schemaUsed: string | undefined } {
    if (path.startsWith('fixtures/artifacts/')) {
      return this.evaluateArtifactEntry(entry, model, declaredIdx);
    }
    if (path.startsWith('fixtures/registry/')) {
      return this.evaluateRegistryEntry(entry, model, declaredIdx);
    }
    if (path.startsWith('fixtures/lifecycle/')) {
      return this.evaluateLifecycleEntry(entry, model, declaredIdx);
    }
    if (path.startsWith('fixtures/references/')) {
      return this.evaluateReferenceEntry(entry, model, declaredIdx);
    }
    if (path.startsWith('fixtures/canonicalization/')) {
      // non-vector source models are not evaluated directly
      return { findings: [], schemaUsed: undefined };
    }
    if (path.startsWith('fixtures/workflows/')) {
      return this.evaluateWorkflowEntry(entry, model, declaredIdx);
    }
    return { findings: [], schemaUsed: undefined };
  }

  // ------------------------------------------------------------------ artifacts
  private evaluateArtifactEntry(
    entry: ConformanceManifestEntry,
    model: Readonly<Record<string, unknown>>,
    declaredIdx: number,
  ): { findings: Finding[]; schemaUsed: string | undefined } {
    const subjectIdentity = String(model['instance_id'] ?? '');
    const findings: Finding[] = [];
    const identity = this.buildIdentity();
    const add = (phase: string): boolean => this.phaseIndex(phase) <= declaredIdx;

    // canonical input (2)
    if (add('canonical-input-validation')) {
      const canonical = validateCanonicalInput(model, { subjectClass: 'artifact' });
      if (!canonical.ok) {
        const canonicalFindings = canonical.findings.map((f) => ({ ...f, ruleIds: canonicalRuleIds(f.category) }));
        return { findings: canonicalFindings, schemaUsed: undefined };
      }
    }
    // schema identification (3)
    const selection = identifySchema(model);
    if (!selection.ok) {
      return {
        findings: [mk('schema-identification', selection.category ?? 'UNKNOWN-SCHEMA-RESOURCE', 'schema.unknown', selection.message ?? 'schema identification failed', { ruleIds: selectionRuleIds(selection), subjectIdentity })],
        schemaUsed: undefined,
      };
    }
    const schemaId = selection.schemaId!;
    if (!add('structural-schema-validation')) {
      return { findings: [], schemaUsed: schemaId };
    }
    // structural (4)
    const structural = this.schemaRegistry.validate(schemaId, model);
    if (!structural.valid) {
      const firstError = structural.errors[0];
      return {
        findings: [
          mk('structural-schema-validation', 'STRUCTURAL-SCHEMA-FAILURE', 'structural.schema', firstError?.message ?? 'schema validation failed', {
            ruleIds: structuralRuleIds(schemaId, structural.errors),
            schemaId,
            subjectIdentity,
            location: firstError?.instancePath ?? '',
          }),
        ],
        schemaUsed: schemaId,
      };
    }
    // canonical ordering + digest (5)
    if (add('canonicalization-and-digest-verification')) {
      const artifactPipeline = runArtifactPipeline(model, { schemaRegistry: this.schemaRegistry, identity, through: 'canonicalization-and-digest-verification' });
      if (!artifactPipeline.ok) return { findings: [...artifactPipeline.findings], schemaUsed: schemaId };
    }
    // identity (6): the registration-conflict checks run only when identity
    // registration is the declared focus; later-phase entries evaluate an
    // already-registered subject and do not re-register it.
    if (entry.validation_phase === 'identity-registration') {
      const idFindings = this.identityFindings(model, subjectIdentity);
      if (idFindings.length > 0) return { findings: idFindings, schemaUsed: schemaId };
    }
    // lineage checks (LIN-004/005) at exact-reference resolution (8)
    if (add('exact-reference-resolution')) {
      findings.push(...this.lineageFindings(model, subjectIdentity, selection.kind));
    }
    // semantic self (7)
    if (add('semantic-self-validation')) {
      findings.push(...evaluateArtifactSemantics(selection.kind!, model, subjectIdentity));
    }
    // exact reference (8) for results
    if (add('exact-reference-resolution') && selection.kind === 'ExecutionResult') {
      const bundleRef = (model['body'] as Record<string, unknown> | undefined)?.['reported_bundle'] as Record<string, unknown> | undefined;
      if (bundleRef && !this.resolveTarget(bundleRef)) {
        findings.push(
          mk('exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'reference.unresolved', 'reported bundle reference is unresolved', {
            ruleIds: ['RES-002', 'REF-001'],
            schemaId,
            subjectIdentity,
            location: '/body/reported_bundle',
          }),
        );
      }
    }
    // cross-artifact (9)
    if (add('cross-artifact-compatibility')) {
      findings.push(
        ...evaluateCrossArtifact({
          kind: selection.kind!,
          model,
          subjectIdentity,
          resolveTarget: (ref) => this.resolveTarget(ref),
        }),
      );
    }
    // registry compatibility (10)
    if (add('registry-compatibility')) {
      findings.push(...evaluateArtifactRegistryCompatibility(model, { registry: this.acceptedRegistry, consumerSupport: this.consumerSupport }));
      const reliance = optionalExtensionReliance(model);
      if (reliance) findings.push(reliance);
    }
    // result-instance conflict (11)
    if (add('trusted-lifecycle-verification') && selection.kind === 'ExecutionResult') {
      const attempt = String((model['body'] as Record<string, unknown> | undefined)?.['reported_attempt_id'] ?? '');
      const all = this.resultsByAttempt.get(attempt) ?? [];
      const candidate = model;
      const others = all.filter((r) => r !== candidate && String(r['instance_id']) !== String(candidate['instance_id']));
      if (others.length > 0) {
        const revision = candidate['revision'] as Record<string, unknown> | undefined;
        const generation = revision ? Number(revision['generation']) : NaN;
        findings.push(...secondResultConflictFindings({ model, subjectIdentity }, generation === 0));
      }
    }
    // point of use (13) policy evaluation
    if (entry.validation_phase === 'point-of-use-eligibility') {
      findings.push(
        ...evaluatePointOfUse({
          currentTime: this.currentTime,
          registry: this.acceptedRegistry,
          consumerSupport: this.consumerSupport,
          records: this.corpusRecords,
          entryRecordIds: new Set<string>(),
          policyModel: model,
        }),
      );
    }
    return { findings, schemaUsed: schemaId };
  }

  private lineageFindings(
    model: Readonly<Record<string, unknown>>,
    subjectIdentity: string,
    kind: string | undefined,
  ): Finding[] {
    const identity = this.buildIdentity();
    const findings: Finding[] = [];
    const revision = (model['revision'] as Record<string, unknown> | undefined) ?? {};
    const pred = revision['predecessor'];
    if (!pred || typeof pred !== 'object') return findings;
    const p = pred as Record<string, unknown>;
    const ownInstance = String(model['instance_id'] ?? '');
    const ownKind = String(kind ?? (model['kind'] as Record<string, unknown> | undefined)?.['id'] ?? '');
    const predInstance = String(p['target_instance_id'] ?? '');
    const predKind = String((p['target_kind'] as Record<string, unknown> | undefined)?.['id'] ?? '');
    if (predInstance !== ownInstance || predKind !== ownKind) {
      findings.push(
        mk('exact-reference-resolution', 'LINEAGE-FAILURE', 'lineage.predecessor-subject', 'predecessor is not the same instance and kind', {
          ruleIds: ['LIN-004'],
          subjectIdentity,
          location: '/revision/predecessor',
        }),
      );
    }
    const predRev = identity.findRevision(String(p['target_revision_id'] ?? ''));
    const generation = Number(revision['generation'] ?? NaN);
    if (predRev && Number.isInteger(generation) && generation !== predRev.generation + 1) {
      findings.push(
        mk('exact-reference-resolution', 'LINEAGE-FAILURE', 'lineage.generation', 'successor generation is not predecessor generation plus one', {
          ruleIds: ['LIN-005'],
          subjectIdentity,
          location: '/revision/generation',
        }),
      );
    }
    return findings;
  }

  private buildIdentity(): MemoryIdentityState {
    const identity = new MemoryIdentityState();
    for (const a of this.validArtifacts) {
      const revision = a.model['revision'] as Record<string, unknown>;
      identity.register(a, revision['predecessor'] as ExactArtifactReferenceModel | undefined);
    }
    return identity;
  }

  private identityFindings(model: Readonly<Record<string, unknown>>, subjectIdentity: string): Finding[] {
    const identity = this.buildIdentity();
    return checkProposedRegistration(model, identity);
  }

  private resolveTarget(reference: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined {
    const revisionId = String(reference['target_revision_id'] ?? '');
    return this.validArtifactModels.get(revisionId);
  }

  // ------------------------------------------------------------------ registry
  private evaluateRegistryEntry(
    entry: ConformanceManifestEntry,
    model: Readonly<Record<string, unknown>>,
    declaredIdx: number,
  ): { findings: Finding[]; schemaUsed: string | undefined } {
    const subjectIdentity = String(model['snapshot_id'] ?? '');
    if (entry.paths[0]!.endsWith('registry-v1-reference.json')) {
      const sid = 'urn:project-gateway:schema:registry:1.0:registry-snapshot-reference';
      const structural = this.schemaRegistry.validate(sid, model);
      if (!structural.valid) {
        const finding: Finding = {
          phase: 'structural-schema-validation',
          category: 'STRUCTURAL-SCHEMA-FAILURE',
          ruleIds: [],
          schemaId: sid,
          subjectIdentity,
          messageKey: 'structural.schema',
          message: structural.errors[0]?.message ?? 'schema validation failed',
        };
        return { findings: [finding], schemaUsed: sid };
      }
      return { findings: [], schemaUsed: sid };
    }
    const pipeline = runRegistrySnapshotPipeline(model, { schemaRegistry: this.schemaRegistry });
    if (!pipeline.ok) return { findings: [...pipeline.findings], schemaUsed: pipeline.schemaId };
    if (!this.phaseAtOrBelow('semantic-registry-validation', declaredIdx)) return { findings: [], schemaUsed: pipeline.schemaId };
    // pipeline already includes the phase-10 semantic registry findings
    return { findings: [], schemaUsed: pipeline.schemaId };
  }

  private phaseAtOrBelow(phase: string, declaredIdx: number): boolean {
    return this.phaseIndex(phase) <= declaredIdx;
  }

  // ----------------------------------------------------------------- lifecycle
  private evaluateLifecycleEntry(
    entry: ConformanceManifestEntry,
    model: Readonly<Record<string, unknown>>,
    declaredIdx: number,
  ): { findings: Finding[]; schemaUsed: string | undefined } {
    const subjectIdentity = String(model['record_id'] ?? '');
    const record = this.recordsWith([model]);
    const entryIds = new Set([subjectIdentity]);
    const findings: Finding[] = [];
    const selection = identifySchema(model);
    if (!selection.ok) {
      return { findings: [mk('schema-identification', selection.category ?? 'UNKNOWN-SCHEMA-RESOURCE', 'schema.unknown', selection.message ?? 'schema identification failed', { ruleIds: selectionRuleIds(selection), subjectIdentity })], schemaUsed: undefined };
    }
    const schemaId = selection.schemaId!;
    const structural = this.schemaRegistry.validate(schemaId, model);
    if (!structural.valid) {
      return {
        findings: [mk('structural-schema-validation', 'STRUCTURAL-SCHEMA-FAILURE', 'structural.schema', structural.errors[0]?.message ?? 'schema validation failed', { ruleIds: structuralRuleIds(schemaId, structural.errors), schemaId, subjectIdentity })],
        schemaUsed: schemaId,
      };
    }
    if (declaredIdx >= this.phaseIndex('registry-compatibility')) {
      findings.push(...evaluateLifecycleRegistryContext(record, entryIds, this.acceptedRegistry));
    }
    if (declaredIdx >= this.phaseIndex('trusted-lifecycle-verification')) {
      findings.push(...this.graphFindings(entryIds, new Set<string>(), [model]));
    }
    if (entry.validation_phase === 'point-of-use-eligibility') {
      findings.push(
        ...evaluatePointOfUse({
          currentTime: this.currentTime,
          registry: this.acceptedRegistry,
          consumerSupport: this.consumerSupport,
          records: this.corpusRecords,
          entryRecordIds: entryIds,
        }),
      );
    }
    return { findings, schemaUsed: schemaId };
  }

  private recordsWith(extra: readonly Readonly<Record<string, unknown>>[]): Readonly<Record<string, unknown>>[] {
    const seen = new Set<string>();
    const out: Readonly<Record<string, unknown>>[] = [];
    for (const r of [...this.corpusRecords, ...extra]) {
      const id = String(r['record_id'] ?? '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push(r);
    }
    return out;
  }

  private graphFindings(entryRecordIds: ReadonlySet<string>, entryArtifactInstances: ReadonlySet<string>, entryRecords: readonly Readonly<Record<string, unknown>>[] = []): Finding[] {
    return evaluateLifecycleGraph({
      records: this.corpusRecords,
      entryRecordIds,
      registry: this.acceptedRegistry,
      artifactsByRevision: this.validArtifactModels,
      artifactsByInstance: this.validArtifactsByInstance,
      resultsByAttempt: this.resultsByAttempt,
      entryArtifactInstances,
      attemptsContext: this.dedupeAttempts([...this.validRecordModels, ...entryRecords]),
    });
  }

  // ---------------------------------------------------------------- references
  private evaluateReferenceEntry(
    _entry: ConformanceManifestEntry,
    model: Readonly<Record<string, unknown>>,
    declaredIdx: number,
  ): { findings: Finding[]; schemaUsed: string | undefined } {
    // graph descriptor with nodes/edges
    if (Array.isArray(model['nodes']) && Array.isArray(model['edges'])) {
      const edges = model['edges'] as { from?: string; to?: string }[];
      const adj = new Map<string, string[]>();
      for (const e of edges) {
        const from = String(e['from'] ?? '');
        const to = String(e['to'] ?? '');
        const list = adj.get(from) ?? [];
        list.push(to);
        adj.set(from, list);
      }
      const WHITE = 0, GRAY = 1, BLACK = 2;
      const color = new Map<string, number>();
      let cycle = false;
      const visit = (u: string, path: string[]): void => {
        color.set(u, GRAY);
        for (const v of adj.get(u) ?? []) {
          const c = color.get(v) ?? WHITE;
          if (c === GRAY) {
            cycle = true;
            return;
          }
          if (c === WHITE) visit(v, [...path, v]);
        }
        color.set(u, BLACK);
      };
      for (const u of adj.keys()) {
        if ((color.get(u) ?? WHITE) === WHITE) visit(u, [u]);
        if (cycle) break;
      }
      if (cycle) {
        return {
          findings: [
            mk('exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'reference.cycle', 'reference graph contains a cycle', {
              ruleIds: ['REF-008', 'BND-008'],
              location: '/edges',
            }),
          ],
          schemaUsed: undefined,
        };
      }
      return { findings: [], schemaUsed: undefined };
    }
    if (!isExactReferenceShape(model)) {
      const finding: Finding = {
        phase: 'schema-identification',
        category: 'UNKNOWN-SCHEMA-RESOURCE',
        ruleIds: referenceInputRuleIds(model as Record<string, unknown>),
        messageKey: 'reference.shape',
        message: 'input is not an exact artifact reference',
      };
      return { findings: [finding], schemaUsed: undefined };
    }
    if (declaredIdx < this.phaseIndex('structural-schema-validation')) {
      return { findings: [], schemaUsed: EXACT_REFERENCE_SCHEMA };
    }
    // authoritative exact-reference schema validation (rejects unknown members)
    const refStructural = this.schemaRegistry.validate(EXACT_REFERENCE_SCHEMA, model);
    if (!refStructural.valid) {
      const firstError = refStructural.errors[0];
      const finding: Finding = {
        phase: 'structural-schema-validation',
        category: 'STRUCTURAL-SCHEMA-FAILURE',
        ruleIds: [],
        schemaId: EXACT_REFERENCE_SCHEMA,
        location: firstError?.instancePath ?? '',
        messageKey: 'reference.schema',
        message: firstError?.message ?? 'exact-reference schema validation failed',
      };
      return { findings: [finding], schemaUsed: EXACT_REFERENCE_SCHEMA };
    }
    if (declaredIdx < this.phaseIndex('exact-reference-resolution')) {
      return { findings: [], schemaUsed: EXACT_REFERENCE_SCHEMA };
    }
    const reference = model as ExactArtifactReferenceModel;
    const report = validateReferenceModel(reference, {
      identity: this.buildIdentity(),
      schemaRegistry: this.schemaRegistry,
      resolve: (ref) => this.resolveTarget(ref as unknown as Record<string, unknown>),
    });
    return { findings: [...report.findings], schemaUsed: EXACT_REFERENCE_SCHEMA };
  }

  // ---------------------------------------------------------------- workflows
  private evaluateWorkflowEntry(
    entry: ConformanceManifestEntry,
    _model: Readonly<Record<string, unknown>>,
    declaredIdx: number,
  ): { findings: Finding[]; schemaUsed: string | undefined } {
    const findings: Finding[] = [];
    const entryArtifacts: Readonly<Record<string, unknown>>[] = [];
    const entryRecords: Readonly<Record<string, unknown>>[] = [];
    const entryArtifactInstances = new Set<string>();
    const entryRecordIds = new Set<string>();
    const subjectPaths: string[] = [];
    const descriptor = this.loadJson(entry.paths[0]!);
    if (Array.isArray(descriptor['record_paths'])) {
      for (const rel of descriptor['record_paths'] as string[]) subjectPaths.push(rel);
    }
    for (const rel of entry.paths) {
      if (!rel.startsWith('fixtures/workflows/')) subjectPaths.push(rel);
    }
    for (const rel of subjectPaths) {
      const model = this.loadJson(rel);
      if (rel.startsWith('fixtures/artifacts/')) {
        entryArtifacts.push(model);
        entryArtifactInstances.add(String(model['instance_id'] ?? ''));
      } else if (rel.startsWith('fixtures/lifecycle/')) {
        entryRecords.push(model);
        entryRecordIds.add(String(model['record_id'] ?? ''));
      }
    }
    // artifact subjects: structural + digest + semantic
    for (const model of entryArtifacts) {
      const selection = identifySchema(model);
      if (!selection.ok) {
        findings.push(mk('schema-identification', selection.category ?? 'UNKNOWN-SCHEMA-RESOURCE', 'schema.unknown', selection.message ?? 'schema identification failed', { ruleIds: selectionRuleIds(selection), subjectIdentity: String((model as Record<string, unknown>)['instance_id'] ?? '') }));
        continue;
      }
      const subjectIdentity = String((model as Record<string, unknown>)['instance_id'] ?? '');
      const pipeline = runArtifactPipeline(model, { schemaRegistry: this.schemaRegistry, identity: this.buildIdentity(), through: 'semantic-self-validation' });
      if (!pipeline.ok) {
        findings.push(...pipeline.findings);
        continue;
      }
      findings.push(...evaluateArtifactSemantics(selection.kind!, model, subjectIdentity));
      if (declaredIdx >= this.phaseIndex('cross-artifact-compatibility')) {
        findings.push(
          ...evaluateCrossArtifact({
            kind: selection.kind!,
            model,
            subjectIdentity,
            resolveTarget: (ref) => this.resolveTarget(ref),
          }),
        );
      }
    }
    // record subjects: structural
    for (const model of entryRecords) {
      const selection = identifySchema(model);
      if (!selection.ok) {
        findings.push(mk('schema-identification', selection.category ?? 'UNKNOWN-SCHEMA-RESOURCE', 'schema.unknown', selection.message ?? 'schema identification failed', { ruleIds: selectionRuleIds(selection), subjectIdentity: String((model as Record<string, unknown>)['record_id'] ?? '') }));
        continue;
      }
      const structural = this.schemaRegistry.validate(selection.schemaId!, model);
      if (!structural.valid) {
        const finding: Finding = {
          phase: 'structural-schema-validation',
          category: 'STRUCTURAL-SCHEMA-FAILURE',
          ruleIds: structuralRuleIds(selection.schemaId!, structural.errors),
          schemaId: selection.schemaId,
          subjectIdentity: String((model as Record<string, unknown>)['record_id'] ?? ''),
          messageKey: 'structural.schema',
          message: structural.errors[0]?.message ?? 'schema validation failed',
        };
        findings.push(finding);
      }
    }
    if (declaredIdx >= this.phaseIndex('registry-compatibility')) {
      findings.push(...evaluateLifecycleRegistryContext(this.recordsWith(entryRecords), entryRecordIds, this.acceptedRegistry));
    }
    if (declaredIdx >= this.phaseIndex('trusted-lifecycle-verification')) {
      findings.push(...this.graphFindings(entryRecordIds, entryArtifactInstances, entryRecords));
      // result-instance conflicts for entry result artifacts
      for (const model of entryArtifacts) {
        const kind = (model['kind'] as Record<string, unknown> | undefined)?.['id'];
        if (kind !== 'ExecutionResult') continue;
        const attempt = String((model['body'] as Record<string, unknown> | undefined)?.['reported_attempt_id'] ?? '');
        const all = this.resultsByAttempt.get(attempt) ?? [];
        const others = all.filter((r) => r !== model && String(r['instance_id']) !== String(model['instance_id']));
        if (others.length > 0) {
          const revision = model['revision'] as Record<string, unknown> | undefined;
          const generation = revision ? Number(revision['generation']) : NaN;
          findings.push(
            ...secondResultConflictFindings(
              { model, subjectIdentity: String(model['instance_id'] ?? '') },
              generation === 0,
            ),
          );
        }
      }
    }
    if (entry.validation_phase === 'point-of-use-eligibility') {
      findings.push(
        ...evaluatePointOfUse({
          currentTime: this.currentTime,
          registry: this.acceptedRegistry,
          consumerSupport: this.consumerSupport,
          records: this.recordsWith(entryRecords),
          entryRecordIds,
        }),
      );
    }
    return { findings, schemaUsed: undefined };
  }

  // ------------------------------------------------- point-of-use v2 context
  /**
   * PointOfUse v2 conformance context (WP-6 Phase 3C1): the fixture
   * descriptor under `fixtures/pointofuse-v2/` carries the trusted
   * configuration input, the exact versioned router request (with corpus-path
   * references for bundle/policy/grant/lifecycle/registry), and the `expect`
   * oracle. The runner constructs a runtime-genuine configuration through the
   * committed Phase-1 validator and calls the authoritative INTERNAL
   * configuration-aware router — no authority intersection is reproduced in
   * the runner and the direct public v1 entry is never used for v2 fixtures.
   */
  private evaluatePouV2Entry(entry: ConformanceManifestEntry): { ok: boolean; reason?: string; detail?: string } {
    const descriptor = this.loadJson(entry.paths[0]!) as Record<string, unknown>;
    const expect = (descriptor['expect'] as Record<string, unknown>) ?? {};
    const built = this.buildPouV2Configuration(descriptor['config'] as Record<string, unknown> | undefined);
    if (!built.ok) return { ok: false, reason: 'config-invalid', detail: built.detail };
    // Forged-configuration boundary fixture: an unbranded spread clone is
    // supplied to the router, which must fail closed at config-not-genuine.
    const configuration = descriptor['config_forged'] === true ? { ...(built.configuration as object) } : built.configuration;
    const request = this.buildPouV2Request(descriptor);
    if (!request.ok) return { ok: false, reason: 'request-build', detail: request.detail };
    let result: PointOfUseRoutingResult;
    try {
      result = evaluatePointOfUseEligibilityForConfiguration(configuration as never, request.request);
    } catch {
      return { ok: false, reason: 'router-threw', detail: entry.fixture_id };
    }
    return this.comparePouV2(entry.fixture_id, result, expect);
  }

  private buildPouV2Configuration(configInput: Record<string, unknown> | undefined):
    { ok: true; configuration: unknown } | { ok: false; detail: string } {
    if (!configInput || typeof configInput !== 'object') {
      return { ok: false, detail: 'descriptor config missing' };
    }
    const report = validateTrustedWorkspaceConfiguration(configInput, {
      hostLane: TRUSTED_HOST_LANE,
      resolveRootPath: (p: string) => p,
    });
    if (!report.ok) {
      return { ok: false, detail: `config invalid: ${report.findings.map((f) => f.messageKey).join(',')}` };
    }
    return { ok: true, configuration: report.configuration };
  }

  private buildPouV2Request(descriptor: Record<string, unknown>):
    { ok: true; request: Record<string, unknown> } | { ok: false; detail: string } {
    const request = (descriptor['request'] as Record<string, unknown>) ?? {};
    const route = request['routeProtocolVersion'];
    const inputs = (request['inputs'] as Record<string, unknown>) ?? {};
    const built = this.buildPouV2Inputs(inputs);
    if (!built.ok) return built;
    if (route === '1') {
      return {
        ok: true,
        request: { routeProtocolVersion: '1', legacyCompatibilityMode: 'explicit-legacy-test', inputs: built.inputs },
      };
    }
    return { ok: true, request: { routeProtocolVersion: '2', inputs: built.inputs } };
  }

  private buildPouV2Inputs(inputs: Record<string, unknown>):
    { ok: true; inputs: Record<string, unknown> } | { ok: false; detail: string } {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(inputs)) {
      if (key === 'bundle_path') {
        out['bundle'] = this.loadJson(String(value));
      } else if (key === 'policy_path') {
        out['policy'] = this.loadJson(String(value));
      } else if (key === 'grant') {
        const grant = value as Record<string, unknown>;
        if (grant['present'] === true) {
          let model = this.loadJson(String(grant['path'])) as Record<string, unknown>;
          const override = grant['override'] as Record<string, unknown> | undefined;
          if (override) model = this.applyPouV2Override(model, override);
          out['grant'] = model;
        }
      } else if (key === 'registry') {
        out['registry'] = this.buildPouV2Registry(value as Record<string, unknown>);
      } else if (key === 'lifecycle') {
        out['lifecycle'] = this.buildPouV2Lifecycle(value as Record<string, unknown>);
      } else if (key === 'identity') {
        out['identity'] = {
          findInstance: () => undefined,
          findRevision: () => undefined,
          findPredecessor: () => undefined,
          verifyRegistration: () => false,
        };
      } else if (key === 'resolver') {
        out['resolver'] = { resolve: () => undefined };
      } else if (key === 'revocations') {
        out['revocations'] = this.buildPouV2Revocations(value);
      } else {
        out[key] = value;
      }
    }
    return { ok: true, inputs: out };
  }

  /**
   * Apply a shallow/dot-path override to a freshly loaded JSON model (grant
   * variants). Dot paths address nested scalars; plain keys replace values.
   * Operates on the runner-owned copy only — never on corpus bytes.
   */
  private applyPouV2Override(model: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
    for (const [key, value] of Object.entries(override)) {
      const parts = key.split('.');
      let target: Record<string, unknown> = model;
      for (let i = 0; i < parts.length - 1; i++) {
        const next = target[parts[i]!];
        if (next === null || typeof next !== 'object' || Array.isArray(next)) {
          target[parts[i]!] = {};
        }
        target = target[parts[i]!] as Record<string, unknown>;
      }
      target[parts[parts.length - 1]!] = value;
    }
    return model;
  }

  private buildPouV2Registry(value: Record<string, unknown>): Record<string, unknown> {
    const model = this.loadJson(String(value['snapshot_path'])) as Record<string, unknown>;
    const snapshot = this.runRegistry(model).value as ValidatedRegistrySnapshot;
    return {
      registryProtocolId: String(value['registryProtocolId'] ?? 'project-gateway.registry'),
      registrySnapshotFormatVersion: String(value['registrySnapshotFormatVersion'] ?? '1.0'),
      registrySnapshotId: String(model['snapshot_id'] ?? ''),
      registrySnapshotDigest: String(model['snapshot_digest'] ?? ''),
      snapshot,
    };
  }

  private buildPouV2Lifecycle(value: Record<string, unknown>): Record<string, unknown> {
    const recordPaths = Array.isArray(value['record_paths']) ? (value['record_paths'] as string[]) : [];
    const records = recordPaths.map((rel) => {
      const model = this.loadJson(rel) as Record<string, unknown>;
      const wrapper = Object.freeze({
        recordType: String(model['record_type'] ?? ''),
        recordId: String(model['record_id'] ?? ''),
        level: 'structural-valid',
        model: Object.freeze(model),
      });
      brandRecordWrapper(wrapper);
      return wrapper;
    });
    return { records, findRecord: (id: string) => records.find((r) => r.recordId === id) };
  }

  private buildPouV2Revocations(value: unknown): { revocationsByTarget: (recordId: string) => readonly { recordId: string; effectiveAt: string; scope: string }[] } {
    const entries = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
    return {
      revocationsByTarget: (recordId: string) =>
        entries
          .filter((e) => String(e['target_record_id']) === recordId)
          .map((e) => ({ recordId, effectiveAt: String(e['effective_at']), scope: String(e['scope'] ?? 'revoke') })),
    };
  }

  private comparePouV2(fixtureId: string, result: PointOfUseRoutingResult, expect: Record<string, unknown>):
    { ok: boolean; reason?: string; detail?: string } {
    const kind = String(expect['kind'] ?? '');
    if (result.kind !== kind) {
      return { ok: false, reason: 'kind-mismatch', detail: `${fixtureId} expected kind ${kind} got ${result.kind}` };
    }
    if (result.kind === 'router-failure') {
      const stage = String(expect['stage'] ?? '');
      if (result.stage !== stage) {
        return { ok: false, reason: 'stage-mismatch', detail: `${fixtureId} expected stage ${stage} got ${result.stage}` };
      }
      const codes = Array.isArray(expect['finding_codes']) ? (expect['finding_codes'] as string[]) : [];
      const actualCodes = result.findings.map((f) => f.code);
      if (codes.length > 0 && JSON.stringify(codes) !== JSON.stringify(actualCodes)) {
        return { ok: false, reason: 'finding-code-mismatch', detail: `${fixtureId} expected [${codes.join(',')}] got [${actualCodes.join(',')}]` };
      }
      return { ok: true };
    }
    const eligibility = result.eligibility;
    const expectedEligible = expect['eligible'];
    if (expectedEligible !== undefined && eligibility.eligible !== expectedEligible) {
      return { ok: false, reason: 'eligible-mismatch', detail: `${fixtureId} expected eligible=${expectedEligible} got ${eligibility.eligible}` };
    }
    const identities = expect['identities'];
    if (identities !== undefined) {
      const hasStatic = 'staticInputCorrelationIdentity' in eligibility;
      if (identities === true && !hasStatic) return { ok: false, reason: 'identity-missing', detail: fixtureId };
      if (identities === false && hasStatic) return { ok: false, reason: 'identity-unexpected', detail: fixtureId };
      if (identities === true) {
        const v2 = eligibility as unknown as { staticInputCorrelationIdentity: string; pointOfUseResultIdentity: string };
        if (!/^sha-256:[0-9a-f]{64}$/.test(v2.staticInputCorrelationIdentity) || !/^sha-256:[0-9a-f]{64}$/.test(v2.pointOfUseResultIdentity)) {
          return { ok: false, reason: 'identity-format', detail: fixtureId };
        }
      }
    }
    const staticIdentity = expect['static_identity'];
    if (staticIdentity !== undefined) {
      const actual = (eligibility as unknown as { staticInputCorrelationIdentity: string }).staticInputCorrelationIdentity;
      if (String(staticIdentity) !== actual) {
        return { ok: false, reason: 'static-identity-mismatch', detail: `${fixtureId} expected ${staticIdentity} got ${actual}` };
      }
    }
    const ruleIds = Array.isArray(expect['rule_ids']) ? (expect['rule_ids'] as string[]) : [];
    if (ruleIds.length > 0) {
      const union = new Set(eligibility.ruleIds);
      for (const r of ruleIds) {
        if (!union.has(r)) return { ok: false, reason: 'rule-missing', detail: `${fixtureId} rule ${r}` };
      }
    }
    const categories = Array.isArray(expect['categories']) ? (expect['categories'] as string[]) : [];
    if (categories.length > 0) {
      const set = new Set<string>(eligibility.categories as readonly string[]);
      for (const c of categories) {
        if (!set.has(c)) return { ok: false, reason: 'category-missing', detail: `${fixtureId} category ${c}` };
      }
    }
    const messageKeys = Array.isArray(expect['message_keys']) ? (expect['message_keys'] as string[]) : [];
    if (messageKeys.length > 0) {
      const actual = eligibility.findings.map((f) => f.messageKey);
      if (JSON.stringify(messageKeys) !== JSON.stringify(actual)) {
        return { ok: false, reason: 'message-key-order-mismatch', detail: `${fixtureId} expected [${messageKeys.join(',')}] got [${actual.join(',')}]` };
      }
    }
    return { ok: true };
  }

  // ------------------------------------------------------------------ vectors
  private evaluateVector(
    entry: ConformanceManifestEntry,
    vector: Readonly<Record<string, unknown>>,
  ): {
    readonly ok: boolean;
    readonly findings: Finding[];
    readonly phase: ValidationPhase;
    readonly canonicalProjection?: string;
    readonly canonicalUtf8?: string;
    readonly digest?: string;
    readonly rejectionReason?: string;
    readonly schemaId?: string;
  } {
    const subjectType = String(vector['subject_type'] ?? '');
    const isRegistry = subjectType === 'registry-snapshot';
    const digestRule = isRegistry ? 'REG-004' : 'ART-005';
    const orderRule = isRegistry ? 'REG-009' : 'ART-008';
    const phase: ValidationPhase = 'canonicalization-and-digest-verification';
    const violation = (category: FailureCategory, key: string, msg: string, ruleIds: string[], reason: string, location = ''): {
      readonly ok: boolean;
      readonly findings: Finding[];
      readonly phase: ValidationPhase;
      readonly canonicalProjection?: string;
      readonly canonicalUtf8?: string;
      readonly digest?: string;
      readonly rejectionReason?: string;
      readonly schemaId?: string;
    } => ({
      ok: false,
      findings: [mk(phase, category, key, msg, { ruleIds, location })],
      phase,
      rejectionReason: reason,
    });
    const okResult = (findings: Finding[] = []): {
      readonly ok: boolean;
      readonly findings: Finding[];
      readonly phase: ValidationPhase;
      readonly canonicalProjection?: string;
      readonly canonicalUtf8?: string;
      readonly digest?: string;
      readonly rejectionReason?: string;
      readonly schemaId?: string;
    } => ({ ok: true, findings, phase });

    // --- rejection vectors: the source subject must be rejected at the
    //     declared condition; actual findings come from the actual evaluators.
    const rejection = String(vector['rejection_expectation'] ?? '');
    if (rejection !== '') {
      const source = String(vector['source_fixture'] ?? '');
      const sourceModel = vector['source_data_model'] ?? vector['accepted_parsed_data_model'];
      if (rejection === 'non-nfc-string') {
        const model = sourceModel ?? this.loadSourceModel(source);
        const canonical = validateCanonicalInput(model, { subjectClass: source.startsWith('fixtures/registry/') ? 'registry' : 'artifact' });
        if (canonical.ok) {
          return violation('NON-NFC-STRING', 'vector.non-nfc-accepted', 'non-NFC input was accepted by canonical-input validation', ['SEC-002'], 'non-nfc-string');
        }
        return okResult(canonical.findings.map((f) => ({ ...f, ruleIds: canonicalRuleIds(f.category) })));
      }
      if (rejection === 'duplicate-member') {
        const bytes = this.inputs.get(source);
        if (!bytes) return violation('DUPLICATE-MEMBER', 'vector.source-missing', `vector source input missing: ${source}`, ['SEC-001'], 'duplicate-source');
        try {
          parseRawJson(bytes, INPUT_BYTE_LIMITS.generic);
          return violation('DUPLICATE-MEMBER', 'vector.duplicate-accepted', 'duplicate-member input was accepted by the raw scanner', ['SEC-001'], 'duplicate-member');
        } catch (e) {
          const err = e as RawJsonError;
          if (err.category !== 'DUPLICATE-MEMBER') {
            return violation('DUPLICATE-MEMBER', 'vector.duplicate-other', `unexpected raw error ${err.category}`, ['SEC-001'], 'duplicate-member');
          }
          return okResult([mk('raw-json-intake', 'DUPLICATE-MEMBER', 'raw.parse', err.message, { ruleIds: rawRuleIds(err.category, err.message), location: `line ${err.line}, column ${err.column}` })]);
        }
      }
      if (rejection === 'canonical-order-failure') {
        const model = sourceModel ?? this.loadSourceModel(source);
        const pipeline = isRegistry
          ? runRegistrySnapshotPipeline(model, { schemaRegistry: this.schemaRegistry })
          : runArtifactPipeline(model, { schemaRegistry: this.schemaRegistry, identity: this.buildIdentity(), through: 'canonicalization-and-digest-verification' });
        const orderFindings = (pipeline.findings ?? []).filter((f) => f.category === 'CANONICAL-ORDER-FAILURE');
        if (orderFindings.length === 0) {
          return violation('CANONICAL-ORDER-FAILURE', 'vector.order-accepted', 'canonical-order input was accepted', [orderRule], 'canonical-order-failure');
        }
        return okResult([...pipeline.findings]);
      }
      return violation('POINT-OF-USE-FAILURE', 'vector.unknown-rejection', `unknown rejection expectation ${rejection}`, [], 'unknown-rejection');
    }

    // --- digest vectors: recompute canonical UTF-8, serialized digest, and
    //     projection independently; the vector's assertions must all hold.
    const expectedSha = vector['expected_sha256'];
    const domain = String(vector['digest_domain'] ?? '');
    const texts = Array.isArray(vector['canonical_utf8']) ? (vector['canonical_utf8'] as string[]) : [String(vector['canonical_utf8'] ?? '')];
    const serialized = Array.isArray(vector['expected_serialized_digest']) ? (vector['expected_serialized_digest'] as string[]) : [String(vector['expected_serialized_digest'] ?? '')];
    const actualTexts: string[] = [];
    const actualDigests: string[] = [];
    if (expectedSha !== null && expectedSha !== undefined) {
      const hashes = Array.isArray(expectedSha) ? (expectedSha as string[]) : [String(expectedSha)];
      for (let i = 0; i < texts.length; i++) {
        const text = texts[i]!;
        const hash = computeSha256(domain + text);
        actualTexts.push(text);
        actualDigests.push(hash);
        if (hash !== hashes[i]) {
          return violation('DIGEST-MISMATCH', 'vector.digest-mismatch', `${entry.fixture_id}[${i}] expected ${hashes[i]} got ${hash}`, [digestRule], `digest[${i}]`);
        }
        if (serialized[i] !== undefined && serialized[i] !== '' && `sha-256:${hash}` !== serialized[i]) {
          return violation('DIGEST-MISMATCH', 'vector.serialized-digest-mismatch', `${entry.fixture_id}[${i}] serialized digest mismatch`, [digestRule], `serialized-digest[${i}]`);
        }
      }
      // projection equality where present (actual canonical projection text)
      const projections = Array.isArray(vector['canonical_projections']) ? (vector['canonical_projections'] as Readonly<Record<string, unknown>>[]) : vector['canonical_projection'] && typeof vector['canonical_projection'] === 'object' ? [vector['canonical_projection'] as Readonly<Record<string, unknown>>] : [];
      for (let i = 0; i < projections.length && i < texts.length; i++) {
        let actualText = '';
        try {
          actualText = jcsSerialize(projections[i]);
        } catch {
          actualText = '';
        }
        if (actualText !== texts[i]) {
          return violation('CANONICALIZATION-FAILURE', 'vector.projection-mismatch', `${entry.fixture_id}[${i}] canonical projection mismatch`, [digestRule], `projection[${i}]`);
        }
      }
      // multi-model vectors: distinct models must never canonicalize to the
      // same text or digest (canonical identity must be injective)
      if (actualTexts.length > 1) {
        for (let i = 0; i < actualTexts.length; i++) {
          for (let j = i + 1; j < actualTexts.length; j++) {
            if (actualTexts[i] === actualTexts[j] || actualDigests[i] === actualDigests[j]) {
              return violation('DUPLICATE-MEMBER', 'vector.canonical-collision', `${entry.fixture_id} distinct models collapsed to one canonical identity`, [digestRule, 'SEC-001'], 'canonical-collision');
            }
          }
        }
      }
      // declared digest of the source model(s) must recompute (actual evaluator)
      const models = Array.isArray(vector['source_data_models']) ? (vector['source_data_models'] as Readonly<Record<string, unknown>>[]) : [];
      const single = vector['accepted_parsed_data_model'] as Readonly<Record<string, unknown>> | undefined;
      for (const model of [...models, ...(single ? [single] : [])]) {
        if (!model || typeof model !== 'object') continue;
        const projection = isRegistry ? registryProjection(model) : artifactProjection(model);
        const declared = isRegistry ? String(model['snapshot_digest'] ?? '') : String((model['revision'] as Record<string, unknown> | undefined)?.['digest'] ?? '');
        if (declared && projection.digest !== declared) {
          return violation('DIGEST-MISMATCH', 'vector.declared-digest-mismatch', `${entry.fixture_id} source model declared digest does not match its canonical projection`, [digestRule], 'declared-digest');
        }
      }
      return okResult();
    }
    return okResult();
  }

  // --------------------------------------------------------------- comparison
  private compare(
    entry: ConformanceManifestEntry,
    declared: string,
    declaredIdx: number,
    sorted: Finding[],
    first: Finding | undefined,
    schemaUsed: string | undefined,
  ): { ok: boolean; reason?: string; detail?: string } {
    if (entry.expected_result === 'pass') {
      if (sorted.length > 0) {
        return { ok: false, reason: 'unexpected-finding', detail: `${entry.fixture_id} first finding ${first?.category}@${first?.phase} (${first?.messageKey})` };
      }
      if (this.schemaCheckApplies(entry) && entry.expected_schema_id && schemaUsed && entry.expected_schema_id !== schemaUsed) {
        return { ok: false, reason: 'schema-mismatch', detail: `${entry.fixture_id} expected ${entry.expected_schema_id} used ${schemaUsed}` };
      }
      return { ok: true };
    }
    if (!first) {
      return { ok: false, reason: 'expected-failure', detail: `${entry.fixture_id} expected fail but no findings` };
    }
    if (this.phaseIndex(first.phase) !== declaredIdx) {
      return { ok: false, reason: 'phase-mismatch', detail: `${entry.fixture_id} expected first phase ${declared} got ${first.phase}` };
    }
    const expectedRules = entry.expected_semantic_rule_ids;
    const expectedCategory = entry.expected_failure_category === 'SCHEMA-FAILURE' ? 'STRUCTURAL-SCHEMA-FAILURE' : entry.expected_failure_category;
    if (expectedRules.length > 0) {
      const matching = sorted.filter((f) => f.phase === first.phase && f.ruleIds.some((r) => expectedRules.includes(r)));
      if (matching.length === 0) {
        return { ok: false, reason: 'rule-not-fired', detail: `${entry.fixture_id} no finding for ${expectedRules.join(',')} at ${declared}` };
      }
      if (!matching.some((f) => f.category === expectedCategory)) {
        return { ok: false, reason: 'category-mismatch', detail: `${entry.fixture_id} expected ${expectedCategory} among ${matching.map((f) => f.category).join('|')}` };
      }
      const union = new Set(sorted.flatMap((f) => f.ruleIds));
      for (const r of expectedRules) {
        if (!union.has(r)) {
          return { ok: false, reason: 'rule-missing', detail: `${entry.fixture_id} rule ${r} not among findings` };
        }
      }
    } else {
      if (first.category !== expectedCategory) {
        return { ok: false, reason: 'category-mismatch', detail: `${entry.fixture_id} expected ${expectedCategory} got ${first.category} (${first.messageKey})` };
      }
    }
    if (this.schemaCheckApplies(entry) && entry.expected_schema_id && schemaUsed && entry.expected_schema_id !== schemaUsed) {
      return { ok: false, reason: 'schema-mismatch', detail: `${entry.fixture_id} expected ${entry.expected_schema_id} used ${schemaUsed}` };
    }
    return { ok: true };
  }

  private schemaCheckApplies(entry: ConformanceManifestEntry): boolean {
    if (entry.fixture_id.startsWith('SCH-')) return true;
    return entry.validation_phase === 'structural-schema-validation';
  }

  /**
   * Vector comparison: the actual evaluation object is compared against the
   * declared outcome. An invariant violation is always a mismatch. Rejection
   * vectors additionally compare the actual rejection phase and category with
   * the declared ones (rule IDs on `CAN-*` entries are nominal coverage labels
   * and are not compared; `RULE-*` vector entries use the common comparison).
   */
  private compareVector(
    entry: ConformanceManifestEntry,
    declared: string,
    declaredIdx: number,
    actual: {
      readonly ok: boolean;
      readonly findings: Finding[];
      readonly phase: ValidationPhase;
      readonly canonicalProjection?: string;
      readonly canonicalUtf8?: string;
      readonly digest?: string;
      readonly rejectionReason?: string;
      readonly schemaId?: string;
    },
  ): { ok: boolean; reason?: string; detail?: string } {
    if (!actual.ok) {
      return { ok: false, reason: 'vector-violation', detail: `${entry.fixture_id} ${actual.rejectionReason ?? 'canonical invariant violated'}` };
    }
    if (actual.findings.length === 0) return { ok: true };
    const sorted = sortFindings(actual.findings);
    const first = sorted[0]!;
    if (this.phaseIndex(first.phase) !== declaredIdx) {
      return { ok: false, reason: 'phase-mismatch', detail: `${entry.fixture_id} expected first phase ${declared} got ${first.phase}` };
    }
    const expectedCategory = entry.expected_failure_category === 'SCHEMA-FAILURE' ? 'STRUCTURAL-SCHEMA-FAILURE' : entry.expected_failure_category;
    if (expectedCategory && first.category !== expectedCategory) {
      return { ok: false, reason: 'category-mismatch', detail: `${entry.fixture_id} expected ${expectedCategory} got ${first.category}` };
    }
    return { ok: true };
  }

  private dedupeAttempts(records: readonly Readonly<Record<string, unknown>>[]): Readonly<Record<string, unknown>>[] {
    const seen = new Set<string>();
    const out: Readonly<Record<string, unknown>>[] = [];
    for (const r of records) {
      if (String(r['record_type']) !== 'ExecutionAttemptRecord') continue;
      const id = String(r['record_id'] ?? '');
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(r);
    }
    return out;
  }

  private loadSourceModel(source: string): unknown {
    const bytes = this.inputs.get(source);
    if (!bytes) return null;
    try {
      return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch {
      return null;
    }
  }
}

import { createHash } from 'node:crypto';
function computeSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function manifestStats(): { entries: number; inputs: number; schemas: number } {
  return {
    entries: (CONFORMANCE_MANIFEST as { fixtures: unknown[] }).fixtures.length,
    inputs: Object.keys(CORPUS_INPUTS as Record<string, string>).length,
    schemas: 52,
  };
}

export { ARTIFACT_DIGEST_DOMAIN, REGISTRY_DIGEST_DOMAIN };
