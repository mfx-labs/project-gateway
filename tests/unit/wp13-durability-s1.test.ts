/**
 * WP-13 durability S1 — static foundation tests for the
 * `ExecutionOutcomeRecord` class, EXE-010…013 rules, taxonomy, schema
 * selection, and conformance-vocabulary counts.
 *
 * S1 scope only: schema/taxonomy/validation/conformance recognition.
 * No production authority, lock, or replay runtime is exercised here
 * (S2/S3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSchemaRegistry } from '../../src/api/validate.js';
import { identifySchema } from '../../src/schema/select.js';
import { evaluateLifecycleGraph } from '../../src/lifecycle/graph.js';
import { classifyRetrospectiveEligibility } from '../../src/lifecycle/retrospective-eligibility.js';
import { ruleIds } from '../../src/semantic/rules.js';
import { RECORD_CLASS_IDS, RECORD_CLASS_PROFILES, RECORD_CLASS_BY_ID } from '../../src/storage/index.js';
import { CONFORMANCE_MANIFEST } from '../../src/generated/corpus-bundle.js';

const OUTCOME_SCHEMA = 'urn:project-gateway:schema:lifecycle:1.0:records:execution-outcome-record';
const reg = createSchemaRegistry();

const REG = {
  registry_protocol_id: 'project-gateway.registry',
  registry_snapshot_format_version: '1.0',
  registry_snapshot_id: 'pgw:g:3fb51a11f2b23ba8c171326cbba7eb64',
  registry_snapshot_digest: 'sha-256:613112612ee7803db00c6e51826b3a63ee6ce6732b17c9b09ae8aff00db47c05',
  protocol_compatibility: { mode: 'exact-release', artifact_protocol_id: 'project-gateway.artifact', artifact_protocol_version: '1.0' },
};
const BUNDLE = {
  target_protocol_version: '1.0',
  target_kind: { id: 'ExecutionBundle', version: '1.0' },
  target_instance_id: 'pgw:i:064ee0ce2bdeee0073c6d64e93b9fb60',
  target_revision_id: 'pgw:r:c55e6e260130dc58d95c600ee51db65d',
  target_digest: 'sha-256:9a59a420a06f5e00f9529708918a2b9289bcb832aa8a4c983884520f5d6be3d7',
  target_workspace_binding: { mode: 'bound', workspace_id: 'pgw:w:cf4339b1f56441936467dea1357dc30e' },
};
const OBS = {
  kind: 'external-evidence',
  evidence_id: 'pgw:e:0123456789abcdef0123456789abcdef',
  content_digest: 'sha-256:3333333333333333333333333333333333333333333333333333333333333333',
  declared_media_type: 'application/json',
  observation_role: 'evaluation-evidence',
};

const ASSOC = {
  instance_id: 'pgw:i:8b13ff16e5e2ab55f9545ce171fdfb7c',
  revision_digest: 'sha-256:551a37acb15610ce49f4ad0d23743710f5f9c1a29fec423cf5b0a414c4611500',
  association_mode: 'adopted',
  validation_record_id: 'pgw:l:595fcd28f93b03437b2d8eff4873b06c',
};

function validPublication(): Readonly<Record<string, unknown>> {
  return {
    record_type: 'ResultPublicationRecord',
    record_id: 'pgw:l:0f86561945fd788cb719f2d5b8e81ccd',
    created_at: '2026-08-04T06:01:00.000Z',
    responsible_role: 'trusted-result-publisher',
    registry_snapshot_reference: REG,
    result_subject: { protocol_version: '1.0', kind: { id: 'ExecutionResult', version: '1.0' }, instance_id: ASSOC.instance_id, revision_id: 'pgw:r:66f1c853ded0e0f67d4392d6c8b792fa', digest: ASSOC.revision_digest, workspace_id: 'pgw:w:cf4339b1f56441936467dea1357dc30e' },
    evaluator_provenance: { evaluator_id: 'pgw:ev:f66fe624e4ae4057ca89caedf8daad41', capability_profile_id: 'pgw:cp:ccbd8effd83192143cfe9c362ca71584' },
    association_mode: 'adopted',
    validation_record_id: ASSOC.validation_record_id,
    bundle: BUNDLE,
    workspace_id: 'pgw:w:cf4339b1f56441936467dea1357dc30e',
    occurrence_id: 'pgw:o:07afc217d096ca56baa8fe7441667a7a',
    attempt_id: 'pgw:a:b17466cc359d45120cf977b1c506ab81',
    publication_scopes: ['ordinary-review'],
    receipt_correlations: [],
  };
}

function validOutcome(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    record_type: 'ExecutionOutcomeRecord',
    record_id: 'pgw:l:0a1b2c3d4e5f60718293a4b5c6d7e8f9',
    created_at: '2026-08-04T06:01:00.000Z',
    responsible_role: 'trusted-execution-outcome-recorder',
    registry_snapshot_reference: REG,
    workspace_id: 'pgw:w:cf4339b1f56441936467dea1357dc30e',
    bundle: BUNDLE,
    occurrence_id: 'pgw:o:07afc217d096ca56baa8fe7441667a7a',
    attempt_id: 'pgw:a:b17466cc359d45120cf977b1c506ab81',
    ordinal: 1,
    execution_attempt_record_id: 'pgw:l:189380433be2769e15623682895a5acd',
    disposition: 'completed',
    observation_evidence: OBS,
    ...overrides,
  };
}

// ------------------------------------------------------------------ schema
test('s1: schema identification selects the outcome record schema', () => {
  const sel = identifySchema(validOutcome());
  assert.equal(sel.ok, true);
  assert.equal(sel.schemaId, OUTCOME_SCHEMA);
  assert.equal(sel.recordType, 'ExecutionOutcomeRecord');
});

test('s1: valid outcome record passes the committed lifecycle schema gate', () => {
  const r = reg.validate(OUTCOME_SCHEMA, validOutcome());
  assert.equal(r.valid, true);
  // no-result form
  const noResult = reg.validate(OUTCOME_SCHEMA, validOutcome({ result_association: undefined }));
  assert.equal(noResult.valid, true);
  // enforcement-absent form
  const noEnforcement = reg.validate(OUTCOME_SCHEMA, validOutcome({ enforcement_evidence: undefined }));
  assert.equal(noEnforcement.valid, true);
  // enforcement group present
  const withEnforcement = reg.validate(
    OUTCOME_SCHEMA,
    validOutcome({
      enforcement_evidence: {
        projection_identity: 'sha-256:1111111111111111111111111111111111111111111111111111111111111111',
        evidence_fingerprint: 'sha-256:2222222222222222222222222222222222222222222222222222222222222222',
      },
    }),
  );
  assert.equal(withEnforcement.valid, true);
});

test('s1: invalid outcome records fail closed', () => {
  const cases: [string, Readonly<Record<string, unknown>>][] = [
    ['missing observation evidence', validOutcome({ observation_evidence: undefined })],
    ['raw session id as evidence_id', validOutcome({ observation_evidence: { ...OBS, evidence_id: 'sess-1/turn:0' } })],
    ['malformed pgw:e id', validOutcome({ observation_evidence: { ...OBS, evidence_id: 'pgw:e:nothex' } })],
    ['non-canonical digest', validOutcome({ observation_evidence: { ...OBS, content_digest: 'md5:abc' } })],
    ['wrong media type', validOutcome({ observation_evidence: { ...OBS, declared_media_type: 'text/plain' } })],
    ['wrong observation role', validOutcome({ observation_evidence: { ...OBS, observation_role: 'input' } })],
    ['partial enforcement group', validOutcome({ enforcement_evidence: { projection_identity: 'sha-256:1111111111111111111111111111111111111111111111111111111111111111' } })],
    ['partial result association', validOutcome({ result_association: { instance_id: 'pgw:i:8b13ff16e5e2ab55f9545ce171fdfb7c' } })],
    ['publication fields', validOutcome({ publication_scopes: ['ordinary-review'] })],
    ['receipt material', validOutcome({ receipt_correlations: [] })],
    ['wrong role', validOutcome({ responsible_role: 'trusted-result-publisher' })],
    ['malformed workspace binding', validOutcome({ workspace_id: 'pgw:w:nothex' })],
    ['unknown properties', validOutcome({ scheduler_authority: true })],
  ];
  for (const [label, model] of cases) {
    const r = reg.validate(OUTCOME_SCHEMA, model);
    assert.equal(r.valid, false, `expected schema failure: ${label}`);
  }
});

test('s1: outcome record rejects publication/receipt authority material and partial groups', () => {
  const r = reg.validate(
    OUTCOME_SCHEMA,
    validOutcome({ result_association: { instance_id: 'pgw:i:8b13ff16e5e2ab55f9545ce171fdfb7c', revision_digest: 'sha-256:551a37acb15610ce49f4ad0d23743710f5f9c1a29fec423cf5b0a414c4611500', association_mode: 'adopted' } }),
  );
  assert.equal(r.valid, false);
});

// ------------------------------------------------------------------ graph
const GRAPH_ATTEMPT = {
  record_type: 'ExecutionAttemptRecord',
  record_id: 'pgw:l:189380433be2769e15623682895a5acd',
  created_at: '2026-08-04T06:01:00.000Z',
  responsible_role: 'trusted-execution-recorder',
  registry_snapshot_reference: REG,
  activation_record_id: 'pgw:l:22fc04818c32642993cba51db8146b26',
  occurrence_id: 'pgw:o:07afc217d096ca56baa8fe7441667a7a',
  attempt_id: 'pgw:a:b17466cc359d45120cf977b1c506ab81',
  ordinal: 1,
  bundle: BUNDLE,
  workspace_id: 'pgw:w:cf4339b1f56441936467dea1357dc30e',
  runtime_grant_id: 'pgw:l:e885b36cf1d0c416221e47dd4ad71d0e',
};

function graphFor(entry: Readonly<Record<string, unknown>>, records: readonly Readonly<Record<string, unknown>>[]) {
  return evaluateLifecycleGraph({
    records,
    entryRecordIds: new Set([String(entry['record_id'])]),
    registry: { registrySnapshotId: 'pgw:g:3fb51a11f2b23ba8c171326cbba7eb64', registrySnapshotDigest: 'sha-256:613112612ee7803db00c6e51826b3a63ee6ce6732b17c9b09ae8aff00db47c05' } as never,
    artifactsByRevision: new Map(),
    artifactsByInstance: new Map(),
    resultsByAttempt: new Map(),
    entryArtifactInstances: new Set(),
  });
}

test('s1: EXE-010 — duplicate outcome record for one exact attempt conflicts (isolated)', () => {
  // one valid durable attempt + two well-bound outcome records on the SAME
  // uniqueness subject: only the duplicate cardinality violation fires
  const a = validOutcome();
  const b = validOutcome({ record_id: 'pgw:l:0d40d40d40d40d40d40d40d40d40d40d', result_association: { ...ASSOC, instance_id: 'pgw:i:0d50d50d50d50d50d50d50d50d50d50d' } });
  const findings = graphFor(a, [GRAPH_ATTEMPT, a, b]);
  assert.ok(findings.some((f) => f.ruleIds.includes('EXE-010') && f.messageKey === 'lifecycle.outcome-duplicate'));
  // binding stays valid on both records — the duplicate is the isolated reason
  assert.ok(!findings.some((f) => f.messageKey === 'lifecycle.outcome-binding'));
});

test('s1: EXE-010 — divergent attempt binding conflicts', () => {
  const divergent = validOutcome({ attempt_id: 'pgw:a:0f10f10f10f10f10f10f10f10f10f10f' });
  const findings = graphFor(divergent, [GRAPH_ATTEMPT, divergent]);
  assert.ok(findings.some((f) => f.ruleIds.includes('EXE-010') && f.messageKey === 'lifecycle.outcome-binding'));
});

test('s1: EXE-012 — attempt without outcome is VALID lifecycle state; eligibility classified separately', () => {
  // absence of an outcome record never invalidates the lifecycle graph
  const findings = graphFor(GRAPH_ATTEMPT, [GRAPH_ATTEMPT]);
  assert.ok(!findings.some((f) => f.ruleIds.includes('EXE-012')));
  assert.ok(!findings.some((f) => f.ruleIds.includes('EXE-012') || f.messageKey === 'lifecycle.attempt-outcome-missing'));
  // the pure classifier reports terminal-unverifiable (no claim, no inference)
  assert.equal(classifyRetrospectiveEligibility(GRAPH_ATTEMPT, []), 'terminal-unverifiable');
  // with a correlated outcome record the attempt is a retrospective-complete candidate
  assert.equal(classifyRetrospectiveEligibility(GRAPH_ATTEMPT, [validOutcome()]), 'retrospective-complete');
  // an outcome bound to a different attempt never classifies this attempt
  const other = validOutcome({ attempt_id: 'pgw:a:0f10f10f10f10f10f10f10f10f10f10f' });
  assert.equal(classifyRetrospectiveEligibility(GRAPH_ATTEMPT, [other]), 'terminal-unverifiable');
});

test('s1: EXE-012 — receipt claiming eligibility for a terminal-unverifiable attempt fails closed', () => {
  const receipt = {
    record_type: 'TrustedReceipt',
    record_id: 'pgw:l:0ea0ea0ea0ea0ea0ea0ea0ea0ea0ea0e',
    created_at: '2026-08-04T06:01:00.000Z',
    responsible_role: 'trusted-receipt-producer',
    registry_snapshot_reference: REG,
    event_type: 'attempt-end',
    event_record_id: 'pgw:l:189380433be2769e15623682895a5acd',
    workspace_id: 'pgw:w:cf4339b1f56441936467dea1357dc30e',
    occurrence_id: 'pgw:o:07afc217d096ca56baa8fe7441667a7a',
    attempt_id: 'pgw:a:b17466cc359d45120cf977b1c506ab81',
    disposition: 'completed',
  };
  const orphan = graphFor(receipt, [GRAPH_ATTEMPT, receipt]);
  assert.ok(orphan.some((f) => f.ruleIds.includes('EXE-012') && f.category === 'RECEIPT-CORRELATION-FAILURE' && f.messageKey === 'lifecycle.receipt-orphan'));
  // once a matching outcome record exists the receipt claim is valid
  const covered = graphFor(receipt, [GRAPH_ATTEMPT, validOutcome(), receipt]);
  assert.ok(!covered.some((f) => f.ruleIds.includes('EXE-012')));
});

test('s1: EXE-012 — malformed lifecycle state still fails under the existing validity rule', () => {
  const malformed = { ...GRAPH_ATTEMPT, activation_record_id: 'pgw:l:00000000000000000000000000000000' };
  const findings = graphFor(malformed, [malformed]);
  assert.ok(findings.some((f) => f.ruleIds.includes('EXE-004')));
});

test('s1: EXE-013 — genuine supersession successor follows the supersession contract, forged records do not', () => {
  const publication = validPublication();
  // a genuine successor referenced by a SupersessionRecord is exempt (ADR-012 §8)
  const successorChain = {
    record_type: 'SupersessionRecord',
    record_id: 'pgw:l:f708d5de3174144dabee1fe183b710b1',
    created_at: '2026-08-04T06:01:00.000Z',
    responsible_role: 'trusted-lifecycle-authority',
    registry_snapshot_reference: REG,
    prior: { subject_type: 'result-publication', record_id: 'pgw:l:0f86561945fd788cb719f2d5b8e81ccd' },
    successor: { subject_type: 'result-publication', record_id: publication.record_id },
  };
  const successorPath = graphFor(publication, [GRAPH_ATTEMPT, validOutcome(), successorChain, publication]);
  assert.ok(!successorPath.some((f) => f.ruleIds.includes('EXE-013')));
  // a superseded publication (prior of a SupersessionRecord) is equally exempt
  const supersedeChain = {
    record_type: 'SupersessionRecord',
    record_id: 'pgw:l:f708d5de3174144dabee1fe183b710b1',
    created_at: '2026-08-04T06:01:00.000Z',
    responsible_role: 'trusted-lifecycle-authority',
    registry_snapshot_reference: REG,
    prior: { subject_type: 'result-publication', record_id: publication.record_id },
    successor: { subject_type: 'result-publication', record_id: 'pgw:l:bbe7a46ace75d39197c83b683f767a0f' },
  };
  const supersededPath = graphFor(publication, [GRAPH_ATTEMPT, validOutcome(), supersedeChain, publication]);
  assert.ok(!supersededPath.some((f) => f.ruleIds.includes('EXE-013')));
  // an ordinary publication NOT referenced by any SupersessionRecord cannot obtain the exemption
  const forged = graphFor(publication, [GRAPH_ATTEMPT, validOutcome(), publication]);
  assert.ok(forged.some((f) => f.ruleIds.includes('EXE-013')));
});
test('s1: EXE-013 — original publication requires exact outcome association; all mismatch dimensions fail', () => {
  const publication = validPublication();
  const outcome = validOutcome({
    result_association: { instance_id: 'pgw:i:8b13ff16e5e2ab55f9545ce171fdfb7c', revision_digest: 'sha-256:551a37acb15610ce49f4ad0d23743710f5f9c1a29fec423cf5b0a414c4611500', association_mode: 'adopted', validation_record_id: 'pgw:l:595fcd28f93b03437b2d8eff4873b06c' },
  });
  // exact association PASS
  const exact = graphFor(publication, [GRAPH_ATTEMPT, outcome, publication]);
  assert.ok(!exact.some((f) => f.ruleIds.includes('EXE-013')));
  // missing outcome record and missing association FAIL
  const missing = graphFor(publication, [GRAPH_ATTEMPT, publication]);
  assert.ok(missing.some((f) => f.ruleIds.includes('EXE-013') && f.messageKey === 'publication.outcome-absent'));
  const diverged = graphFor(publication, [GRAPH_ATTEMPT, validOutcome({ result_association: undefined }), publication]);
  assert.ok(diverged.some((f) => f.ruleIds.includes('EXE-013') && f.messageKey === 'publication.outcome-association-absent'));
  // every material association dimension diverges to an EXE-013 failure
  const dims: [string, Readonly<Record<string, unknown>>][] = [
    ['instance', { result_subject: { ...(publication.result_subject as Readonly<Record<string, unknown>>), instance_id: 'pgw:i:0b20b20b20b20b20b20b20b20b20b20b' } }],
    ['revision digest', { result_subject: { ...(publication.result_subject as Readonly<Record<string, unknown>>), digest: 'sha-256:0000000000000000000000000000000000000000000000000000000000000000' } }],
    ['association mode', { association_mode: 'originated' }],
    ['validation id', { validation_record_id: 'pgw:l:5d90ed8cf012e735b4a9586f9f0b8da4' }],
    ['workspace', { workspace_id: 'pgw:w:0b60b60b60b60b60b60b60b60b60b60b' }],
    ['bundle', { bundle: { ...BUNDLE, target_revision_id: 'pgw:r:0b70b70b70b70b70b70b70b70b70b70b' } }],
    ['occurrence', { occurrence_id: 'pgw:o:0b80b80b80b80b80b80b80b80b80b80b' }],
    ['attempt', { attempt_id: 'pgw:a:0b90b90b90b90b90b90b90b90b90b90b' }],
  ];
  for (const [label, overrides] of dims) {
    const p = { ...publication, ...overrides };
    const findings = graphFor(p, [GRAPH_ATTEMPT, outcome, p]);
    assert.ok(findings.some((f) => f.ruleIds.includes('EXE-013')), `expected EXE-013 for ${label} divergence`);
  }
});

// ------------------------------------------------------------------ taxonomy
test('s1: taxonomy recognizes the outcome record class (recognition only)', () => {
  assert.ok(RECORD_CLASS_IDS.includes('execution-outcome-record'));
  const profile = RECORD_CLASS_BY_ID.get('execution-outcome-record');
  assert.equal(profile?.label, 'ExecutionOutcomeRecord');
  assert.equal(profile?.segment, 'execution-outcome');
  assert.equal(profile?.producer, 'trusted execution outcome recorder');
  assert.equal(profile?.wp8Production.includes('no'), true);
  assert.equal(RECORD_CLASS_IDS.length, 19);
  assert.equal(RECORD_CLASS_PROFILES.length, 19);
});

// ------------------------------------------------------------------ rules
test('s1: EXE-010…013 are registered in the committed rule inventory', () => {
  const ids = new Set(ruleIds());
  for (const id of ['EXE-010', 'EXE-011', 'EXE-012', 'EXE-013']) {
    assert.ok(ids.has(id), `missing rule ${id}`);
  }
});

// ------------------------------------------------------------------ manifest
test('s1: conformance manifest carries the EXE-010…013 vectors and outcome fixtures', () => {
  const manifest = CONFORMANCE_MANIFEST as { fixtures: { fixture_id: string; paths: string[] }[] };
  const ids = new Set(manifest.fixtures.map((f) => f.fixture_id));
  for (const id of ['RULE-EXE-010-PASS', 'RULE-EXE-010-FAIL', 'RULE-EXE-011-PASS', 'RULE-EXE-011-FAIL', 'RULE-EXE-012-PASS', 'RULE-EXE-012-FAIL', 'RULE-EXE-013-PASS', 'RULE-EXE-013-FAIL']) {
    assert.ok(ids.has(id), `missing vector ${id}`);
  }
  const outcomeFixtures = manifest.fixtures.filter((f) => f.paths.some((p) => p.includes('execution-outcome') || p.includes('outcome-main') || p.includes('outcome-dup') || p.includes('outcome-divergent') || p.includes('outcome-invalid') || p.includes('outcome-missing') || p.includes('outcome-partial') || p.includes('outcome-publication') || p.includes('outcome-receipt') || p.includes('outcome-raw') || p.includes('outcome-malformed') || p.includes('outcome-wrong') || p.includes('outcome-unknown')));
  // 23 = 19 outcome-record fixture entries + 4 RULE vectors referencing them
  assert.ok(outcomeFixtures.length >= 23, `expected at least 23 outcome fixture entries, got ${outcomeFixtures.length}`);
});
