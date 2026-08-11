/**
 * WP-15 Phase 1A — event-type-aware TrustedReceipt lifecycle verification.
 *
 * Focused tests over the committed lifecycle graph (EXE-008/EXE-012):
 *   - event-source matrix: event_record_id resolves by event_type to the
 *     exact trusted source class (A1 §3.2); source-class mismatch fails;
 *   - denied-activation absent-only bindings; accepted-activation exact
 *     reserved occurrence; never an invented attempt;
 *   - EXE-012 exact outcome coverage for the six attempt-correlated
 *     retrospective receipt event types (result-less != outcome-less);
 *   - result-publication-correlation source/outcome-association validation;
 *   - EXE-008 attempt-side receipt-facts obligation conditioned on
 *     retrospective eligibility (terminal-unverifiable = no obligation);
 *   - incomplete/rejected receipt dispositions pass with exact outcome
 *     coverage (no lossy mapping).
 *
 * No issuance, no correlation producer, no authority runtime: pure graph
 * verification over caller-supplied records (the Phase 1A foundation).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLifecycleGraph } from '../../src/lifecycle/graph.js';
import { classifyRetrospectiveEligibility, qualifyReceiptForAttempt, resolveExactOutcome } from '../../src/lifecycle/retrospective-eligibility.js';
import { createSchemaRegistry } from '../../src/api/validate.js';

const RECEIPT_SCHEMA = 'urn:project-gateway:schema:lifecycle:1.0:records:trusted-receipt';
const OUTCOME_SCHEMA = 'urn:project-gateway:schema:lifecycle:1.0:records:execution-outcome-record';
const reg = createSchemaRegistry();

const REG = {
  registry_protocol_id: 'project-gateway.registry',
  registry_snapshot_format_version: '1.0',
  registry_snapshot_id: 'pgw:g:3fb51a11f2b23ba8c171326cbba7eb64',
  registry_snapshot_digest: 'sha-256:613112612ee7803db00c6e51826b3a63ee6ce6732b17c9b09ae8aff00db47c05',
  protocol_compatibility: { mode: 'exact-release', artifact_protocol_id: 'project-gateway.artifact', artifact_protocol_version: '1.0' },
};
const WS = 'pgw:w:cf4339b1f56441936467dea1357dc30e';
const OCCURRENCE = 'pgw:o:07afc217d096ca56baa8fe7441667a7a';
const ATTEMPT = 'pgw:a:b17466cc359d45120cf977b1c506ab81';
const BUNDLE = {
  target_protocol_version: '1.0',
  target_kind: { id: 'ExecutionBundle', version: '1.0' },
  target_instance_id: 'pgw:i:064ee0ce2bdeee0073c6d64e93b9fb60',
  target_revision_id: 'pgw:r:c55e6e260130dc58d95c600ee51db65d',
  target_digest: 'sha-256:9a59a420a06f5e00f9529708918a2b9289bcb832aa8a4c983884520f5d6be3d7',
  target_workspace_binding: { mode: 'bound', workspace_id: WS },
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
const ENFORCEMENT = {
  projection_identity: 'sha-256:1111111111111111111111111111111111111111111111111111111111111111',
  evidence_fingerprint: 'sha-256:2222222222222222222222222222222222222222222222222222222222222222',
};

// ─── trusted source records (committed shapes) ──────────────────────────────

const ACTIVATION_ACCEPTED = {
  record_type: 'ActivationRecord',
  record_id: 'pgw:l:22fc04818c32642993cba51db8146b26',
  created_at: '2026-08-04T06:01:00.000Z',
  responsible_role: 'trusted-activation-authority',
  registry_snapshot_reference: REG,
  bundle: BUNDLE,
  workspace_id: WS,
  required_issuance_record_ids: [],
  runtime_grant_id: 'pgw:l:e885b36cf1d0c416221e47dd4ad71d0e',
  reserved_occurrence_id: OCCURRENCE,
  decision: 'accepted',
};
const ACTIVATION_DENIED = {
  ...ACTIVATION_ACCEPTED,
  record_id: 'pgw:l:8b09f9194cb146322d1c75e3bec0e908',
  reserved_occurrence_id: 'pgw:o:e8a3ad170c8d6902098fdb8e56bfde04',
  decision: 'denied',
};
const OCCURRENCE_RECORD = {
  record_type: 'ExecutionOccurrenceRecord',
  record_id: 'pgw:l:496eafd01fb3475308bfcad317597fcc',
  created_at: '2026-08-04T06:01:00.000Z',
  responsible_role: 'trusted-control-plane',
  registry_snapshot_reference: REG,
  activation_record_id: ACTIVATION_ACCEPTED.record_id,
  bundle: BUNDLE,
  workspace_id: WS,
  occurrence_id: OCCURRENCE,
  runtime_grant_id: 'pgw:l:e885b36cf1d0c416221e47dd4ad71d0e',
};
const ATTEMPT_RECORD = {
  record_type: 'ExecutionAttemptRecord',
  record_id: 'pgw:l:189380433be2769e15623682895a5acd',
  created_at: '2026-08-04T06:01:00.000Z',
  responsible_role: 'trusted-execution-recorder',
  registry_snapshot_reference: REG,
  activation_record_id: ACTIVATION_ACCEPTED.record_id,
  occurrence_id: OCCURRENCE,
  attempt_id: ATTEMPT,
  ordinal: 1,
  bundle: BUNDLE,
  workspace_id: WS,
  runtime_grant_id: 'pgw:l:e885b36cf1d0c416221e47dd4ad71d0e',
};
const PUBLICATION = {
  record_type: 'ResultPublicationRecord',
  record_id: 'pgw:l:0f86561945fd788cb719f2d5b8e81ccd',
  created_at: '2026-08-04T06:01:00.000Z',
  responsible_role: 'trusted-result-publisher',
  registry_snapshot_reference: REG,
  result_subject: {
    protocol_version: '1.0',
    kind: { id: 'ExecutionResult', version: '1.0' },
    instance_id: ASSOC.instance_id,
    revision_id: 'pgw:r:66f1c853ded0e0f67d4392d6c8b792fa',
    digest: ASSOC.revision_digest,
    workspace_id: WS,
  },
  evaluator_provenance: { evaluator_id: 'pgw:ev:f66fe624e4ae4057ca89caedf8daad41', capability_profile_id: 'pgw:cp:ccbd8effd83192143cfe9c362ca71584' },
  association_mode: ASSOC.association_mode,
  validation_record_id: ASSOC.validation_record_id,
  bundle: BUNDLE,
  workspace_id: WS,
  occurrence_id: OCCURRENCE,
  attempt_id: ATTEMPT,
  publication_scopes: ['ordinary-review'],
  receipt_correlations: [],
};

// ─── builders ───────────────────────────────────────────────────────────────

function receipt(eventType: string, eventRecordId: string, extra: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    record_type: 'TrustedReceipt',
    record_id: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    created_at: '2026-08-04T06:01:00.000Z',
    responsible_role: 'trusted-receipt-producer',
    registry_snapshot_reference: REG,
    event_type: eventType,
    event_record_id: eventRecordId,
    workspace_id: WS,
    occurrence_id: OCCURRENCE,
    attempt_id: ATTEMPT,
    disposition: 'completed',
    ...extra,
  };
}

function without(model: Readonly<Record<string, unknown>>, keys: readonly string[]): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(model)) {
    if (!keys.includes(k)) out[k] = v;
  }
  return out;
}

function outcome(disposition = 'completed', overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    record_type: 'ExecutionOutcomeRecord',
    record_id: 'pgw:l:0a1b2c3d4e5f60718293a4b5c6d7e8f9',
    created_at: '2026-08-04T06:01:00.000Z',
    responsible_role: 'trusted-execution-outcome-recorder',
    registry_snapshot_reference: REG,
    workspace_id: WS,
    bundle: BUNDLE,
    occurrence_id: OCCURRENCE,
    attempt_id: ATTEMPT,
    ordinal: 1,
    execution_attempt_record_id: ATTEMPT_RECORD.record_id,
    disposition,
    observation_evidence: OBS,
    ...overrides,
  };
}

function outcomeWithAssociation(): Readonly<Record<string, unknown>> {
  return outcome('completed', { result_association: ASSOC });
}

function bundleDivergentOutcome(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return outcome('completed', {
    record_id: 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    bundle: { ...BUNDLE, target_digest: 'sha-256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    ...overrides,
  });
}

function unrelatedOutcome(): Readonly<Record<string, unknown>> {
  return outcome('completed', {
    record_id: 'pgw:l:cccccccccccccccccccccccccccccccc',
    attempt_id: 'pgw:a:0e10e10e10e10e10e10e10e10e10e10e',
    execution_attempt_record_id: 'pgw:l:0e10e10e10e10e10e10e10e10e10e10e',
  });
}

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

function receiptFindings(entry: Readonly<Record<string, unknown>>, records: readonly Readonly<Record<string, unknown>>[]) {
  const findings = graphFor(entry, records);
  return {
    source: findings.some((f) => f.ruleIds.includes('EXE-008') && f.messageKey === 'lifecycle.receipt-event'),
    bindings: findings.some((f) => f.ruleIds.includes('EXE-008') && f.messageKey === 'lifecycle.receipt-event-bindings'),
    disposition: findings.some((f) => f.ruleIds.includes('EXE-008') && f.messageKey === 'lifecycle.receipt-event-disposition'),
    orphan: findings.some((f) => f.ruleIds.includes('EXE-012') && f.messageKey === 'lifecycle.receipt-orphan'),
    outcomeInvalid: findings.some((f) => f.ruleIds.includes('EXE-012') && f.messageKey === 'lifecycle.receipt-outcome-invalid'),
    publicationInvalid: findings.some((f) => f.ruleIds.includes('EXE-012') && f.messageKey === 'lifecycle.receipt-publication-invalid'),
    any: findings.length > 0,
  };
}

// ─── schema: denied-activation absent-only (A1) ─────────────────────────────

test('phase1a schema: denied-activation receipt requires occurrence_id/attempt_id ABSENT', () => {
  const denied = without(receipt('activation-decision', ACTIVATION_DENIED.record_id, { disposition: 'denied' }), ['occurrence_id', 'attempt_id']);
  assert.equal(reg.validate(RECEIPT_SCHEMA, denied).valid, true);
  // null is invalid
  assert.equal(reg.validate(RECEIPT_SCHEMA, { ...denied, occurrence_id: null }).valid, false, 'null occurrence must fail');
  assert.equal(reg.validate(RECEIPT_SCHEMA, { ...denied, attempt_id: null }).valid, false, 'null attempt must fail');
  assert.equal(reg.validate(RECEIPT_SCHEMA, { ...denied, occurrence_id: '', attempt_id: '' }).valid, false, 'empty strings must fail');
  // fabricated/real-looking IDs are invalid
  assert.equal(reg.validate(RECEIPT_SCHEMA, { ...denied, occurrence_id: OCCURRENCE }).valid, false, 'fabricated occurrence must fail');
  assert.equal(reg.validate(RECEIPT_SCHEMA, { ...denied, attempt_id: ATTEMPT }).valid, false, 'fabricated attempt must fail');
});

test('phase1a schema: non-denied branches retain occurrence/attempt requirements', () => {
  // accepted activation: both fields required (attempt inapplicable => null)
  const accepted = receipt('activation-decision', ACTIVATION_ACCEPTED.record_id, { disposition: 'accepted' });
  assert.equal(reg.validate(RECEIPT_SCHEMA, accepted).valid, true);
  assert.equal(reg.validate(RECEIPT_SCHEMA, without(accepted, ['occurrence_id'])).valid, false, 'accepted activation missing occurrence must fail');
  assert.equal(reg.validate(RECEIPT_SCHEMA, { ...accepted, attempt_id: null }).valid, true, 'null inapplicability sentinel retained for non-denied');
  // attempt-end missing attempt context fails
  const attemptEnd = receipt('attempt-end', ATTEMPT_RECORD.record_id);
  assert.equal(reg.validate(RECEIPT_SCHEMA, without(attemptEnd, ['attempt_id'])).valid, false, 'attempt-end missing attempt must fail');
  assert.equal(reg.validate(RECEIPT_SCHEMA, without(attemptEnd, ['occurrence_id'])).valid, false, 'attempt-end missing occurrence must fail');
});

test('phase1a schema: incomplete/rejected dispositions accepted; unsupported rejected', () => {
  const base = receipt('attempt-end', ATTEMPT_RECORD.record_id);
  assert.equal(reg.validate(RECEIPT_SCHEMA, { ...base, disposition: 'incomplete' }).valid, true);
  assert.equal(reg.validate(RECEIPT_SCHEMA, { ...base, disposition: 'rejected' }).valid, true);
  assert.equal(reg.validate(RECEIPT_SCHEMA, { ...base, disposition: 'expired' }).valid, false);
  // no lossy mapping: rejected stays rejected, incomplete stays incomplete
  assert.equal(reg.validate(RECEIPT_SCHEMA, { ...base, disposition: 'denied' }).valid, true); // event-specific disposition still valid for its event
});

// ─── EXE-008: event-source matrix (A1 §3.2) ─────────────────────────────────

test('phase1a: each event type resolves its exact trusted source class', () => {
  const matrix: [string, Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>, readonly Readonly<Record<string, unknown>>[]][] = [
    ['activation-decision (denied)', ACTIVATION_DENIED, receipt('activation-decision', ACTIVATION_DENIED.record_id, { disposition: 'denied', occurrence_id: undefined, attempt_id: undefined }), []],
    ['activation-decision (accepted)', ACTIVATION_ACCEPTED, receipt('activation-decision', ACTIVATION_ACCEPTED.record_id, { disposition: 'accepted', attempt_id: undefined }), []],
    ['occurrence-start', OCCURRENCE_RECORD, receipt('occurrence-start', OCCURRENCE_RECORD.record_id, { disposition: 'started', attempt_id: undefined }), []],
    ['attempt-start', ATTEMPT_RECORD, receipt('attempt-start', ATTEMPT_RECORD.record_id, { disposition: 'started' }), [outcome('completed')]],
    ['attempt-end', ATTEMPT_RECORD, receipt('attempt-end', ATTEMPT_RECORD.record_id, { disposition: 'completed' }), [outcome('completed')]],
    ['enforcement-denial', ATTEMPT_RECORD, receipt('enforcement-denial', ATTEMPT_RECORD.record_id, { disposition: 'denied' }), [outcome('rejected', { enforcement_evidence: ENFORCEMENT })]],
    ['cancellation (attempt-level)', ATTEMPT_RECORD, receipt('cancellation', ATTEMPT_RECORD.record_id, { disposition: 'cancelled' }), [outcome('cancelled')]],
    ['cancellation (occurrence-level)', OCCURRENCE_RECORD, receipt('cancellation', OCCURRENCE_RECORD.record_id, { disposition: 'cancelled', attempt_id: undefined }), []],
    ['timeout', ATTEMPT_RECORD, receipt('timeout', ATTEMPT_RECORD.record_id, { disposition: 'timed-out' }), [outcome('timed-out')]],
    ['crash', ATTEMPT_RECORD, receipt('crash', ATTEMPT_RECORD.record_id, { disposition: 'crashed' }), [outcome('crashed')]],
    ['result-publication-correlation', PUBLICATION, receipt('result-publication-correlation', PUBLICATION.record_id, { disposition: 'completed' }), [ATTEMPT_RECORD, outcomeWithAssociation()]],
  ];
  for (const [label, source, r, outcomesSet] of matrix) {
    const result = receiptFindings(r, [r, source, ...outcomesSet]);
    assert.equal(result.any, false, `expected no findings for ${label}: ${JSON.stringify(graphFor(r, [r, source, ...outcomesSet]))}`);
  }
});

test('phase1a: source-class mismatch fails closed for every event type (no hidden universal attempt rule)', () => {
  const wrongSources: [string, string, Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>][] = [
    ['activation-decision -> attempt', 'activation-decision', ACTIVATION_ACCEPTED, receipt('activation-decision', ATTEMPT_RECORD.record_id, { disposition: 'accepted' })],
    ['occurrence-start -> attempt', 'occurrence-start', OCCURRENCE_RECORD, receipt('occurrence-start', ATTEMPT_RECORD.record_id)],
    ['attempt-end -> activation', 'attempt-end', ATTEMPT_RECORD, receipt('attempt-end', ACTIVATION_ACCEPTED.record_id)],
    ['attempt-start -> occurrence', 'attempt-start', ATTEMPT_RECORD, receipt('attempt-start', OCCURRENCE_RECORD.record_id)],
    ['enforcement-denial -> publication', 'enforcement-denial', ATTEMPT_RECORD, receipt('enforcement-denial', PUBLICATION.record_id, { disposition: 'denied' })],
    ['timeout -> activation', 'timeout', ATTEMPT_RECORD, receipt('timeout', ACTIVATION_DENIED.record_id)],
    ['crash -> occurrence', 'crash', ATTEMPT_RECORD, receipt('crash', OCCURRENCE_RECORD.record_id)],
    ['result-publication-correlation -> attempt', 'result-publication-correlation', PUBLICATION, receipt('result-publication-correlation', ATTEMPT_RECORD.record_id)],
  ];
  for (const [label, , , r] of wrongSources) {
    const result = receiptFindings(r, [r, ATTEMPT_RECORD, OCCURRENCE_RECORD, ACTIVATION_ACCEPTED, PUBLICATION, outcomeWithAssociation()]);
    assert.equal(result.source, true, `expected EXE-008 source failure for ${label}`);
  }
});

test('phase1a: unknown event type fails closed', () => {
  const r = receipt('invented-event', ATTEMPT_RECORD.record_id);
  const result = receiptFindings(r, [r, ATTEMPT_RECORD, outcomeWithAssociation()]);
  assert.equal(result.source, true);
});

// ─── exact bindings (A1 §3.2/§3.3) ──────────────────────────────────────────

test('phase1a: denied-activation receipt must not carry occurrence/attempt bindings', () => {
  const denied = (extra: Readonly<Record<string, unknown>>) =>
    receipt('activation-decision', ACTIVATION_DENIED.record_id, { disposition: 'denied', occurrence_id: undefined, attempt_id: undefined, ...extra });
  assert.equal(receiptFindings(denied({}), [denied({}), ACTIVATION_DENIED]).bindings, false);
  assert.equal(receiptFindings(denied({ occurrence_id: OCCURRENCE }), [denied({ occurrence_id: OCCURRENCE }), ACTIVATION_DENIED]).bindings, true);
  assert.equal(receiptFindings(denied({ attempt_id: ATTEMPT }), [denied({ attempt_id: ATTEMPT }), ACTIVATION_DENIED]).bindings, true);
  assert.equal(receiptFindings(denied({ occurrence_id: null }), [denied({ occurrence_id: null }), ACTIVATION_DENIED]).bindings, true);
});

test('phase1a: accepted-activation receipt binds the exact reserved occurrence and never an attempt', () => {
  const accepted = (extra: Readonly<Record<string, unknown>>) =>
    receipt('activation-decision', ACTIVATION_ACCEPTED.record_id, { disposition: 'accepted', attempt_id: undefined, ...extra });
  assert.equal(receiptFindings(accepted({}), [accepted({}), ACTIVATION_ACCEPTED]).bindings, false);
  const wrongOccurrence = accepted({ occurrence_id: 'pgw:o:0e50e50e50e50e50e50e50e50e50e50e' });
  assert.equal(receiptFindings(wrongOccurrence, [wrongOccurrence, ACTIVATION_ACCEPTED]).bindings, true);
  const withAttempt = accepted({ attempt_id: ATTEMPT });
  assert.equal(receiptFindings(withAttempt, [withAttempt, ACTIVATION_ACCEPTED]).bindings, true);
});

test('phase1a: occurrence-level receipts bind the exact occurrence and never an attempt', () => {
  const occStart = (extra: Readonly<Record<string, unknown>>) =>
    receipt('occurrence-start', OCCURRENCE_RECORD.record_id, { disposition: 'started', attempt_id: undefined, ...extra });
  assert.equal(receiptFindings(occStart({}), [occStart({}), OCCURRENCE_RECORD]).bindings, false);
  const withAttempt = occStart({ attempt_id: ATTEMPT });
  assert.equal(receiptFindings(withAttempt, [withAttempt, OCCURRENCE_RECORD]).bindings, true);
  const wrongOccurrence = occStart({ occurrence_id: 'pgw:o:0e50e50e50e50e50e50e50e50e50e50e' });
  assert.equal(receiptFindings(wrongOccurrence, [wrongOccurrence, OCCURRENCE_RECORD]).bindings, true);
});

test('phase1a: attempt receipts bind the exact occurrence and attempt of the source record', () => {
  const r = (extra: Readonly<Record<string, unknown>>) => receipt('attempt-end', ATTEMPT_RECORD.record_id, extra);
  assert.equal(receiptFindings(r({}), [r({}), ATTEMPT_RECORD, outcomeWithAssociation()]).bindings, false);
  const wrongOccurrence = r({ occurrence_id: 'pgw:o:0e50e50e50e50e50e50e50e50e50e50e' });
  assert.equal(receiptFindings(wrongOccurrence, [wrongOccurrence, ATTEMPT_RECORD, outcomeWithAssociation()]).bindings, true);
  const wrongAttempt = r({ attempt_id: 'pgw:a:0e10e10e10e10e10e10e10e10e10e10e' });
  assert.equal(receiptFindings(wrongAttempt, [wrongAttempt, ATTEMPT_RECORD, outcomeWithAssociation()]).bindings, true);
  const wrongWorkspace = r({ workspace_id: 'pgw:w:0b60b60b60b60b60b60b60b60b60b60b' });
  assert.equal(receiptFindings(wrongWorkspace, [wrongWorkspace, ATTEMPT_RECORD, outcomeWithAssociation()]).bindings, true);
});

// ─── EXE-012: exact outcome coverage ────────────────────────────────────────

test('phase1a: every attempt-correlated retrospective receipt requires exact outcome coverage', () => {
  const attemptEvents: [string, Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>][] = [
    ['attempt-start', outcome('completed'), receipt('attempt-start', ATTEMPT_RECORD.record_id, { disposition: 'started' })],
    ['attempt-end', outcome('completed'), receipt('attempt-end', ATTEMPT_RECORD.record_id, { disposition: 'completed' })],
    ['enforcement-denial', outcome('rejected', { enforcement_evidence: ENFORCEMENT }), receipt('enforcement-denial', ATTEMPT_RECORD.record_id, { disposition: 'denied' })],
    ['cancellation (attempt-level)', outcome('cancelled'), receipt('cancellation', ATTEMPT_RECORD.record_id, { disposition: 'cancelled' })],
    ['timeout', outcome('timed-out'), receipt('timeout', ATTEMPT_RECORD.record_id, { disposition: 'timed-out' })],
    ['crash', outcome('crashed'), receipt('crash', ATTEMPT_RECORD.record_id, { disposition: 'crashed' })],
  ];
  for (const [label, coveredOutcome, r] of attemptEvents) {
    // no trustworthy outcome -> terminal-unverifiable -> receipt-ineligible
    const orphan = receiptFindings(r, [r, ATTEMPT_RECORD]);
    assert.equal(orphan.orphan, true, `expected EXE-012 orphan for ${label}`);
    // exact matching outcome -> eligible (disposition must also agree)
    const covered = receiptFindings(r, [r, ATTEMPT_RECORD, coveredOutcome]);
    assert.equal(covered.any, false, `expected no findings for covered ${label}: ${JSON.stringify(graphFor(r, [r, ATTEMPT_RECORD, coveredOutcome]))}`);
    // a non-matching outcome (different attempt) does not cover
    const other = { ...coveredOutcome, attempt_id: 'pgw:a:0e10e10e10e10e10e10e10e10e10e10e', execution_attempt_record_id: 'pgw:l:0e10e10e10e10e10e10e10e10e10e10e' };
    const notCovered = receiptFindings(r, [r, ATTEMPT_RECORD, other]);
    assert.equal(notCovered.orphan, true, `expected EXE-012 orphan for non-matching outcome ${label}`);
  }
});

test('phase1a: occurrence-level cancellation requires no outcome coverage', () => {
  const r = receipt('cancellation', OCCURRENCE_RECORD.record_id, { disposition: 'cancelled', attempt_id: undefined });
  const result = receiptFindings(r, [r, OCCURRENCE_RECORD]);
  assert.equal(result.any, false, 'occurrence-level cancellation receipt is eligible without an outcome record');
});

test('phase1a: incomplete/rejected outcome-covered receipts pass without lossy mapping', () => {
  for (const disposition of ['incomplete', 'rejected'] as const) {
    const r = receipt('attempt-end', ATTEMPT_RECORD.record_id, { disposition });
    const result = receiptFindings(r, [r, ATTEMPT_RECORD, outcome(disposition)]);
    assert.equal(result.any, false, `expected no findings for outcome-covered ${disposition} receipt`);
  }
});

// ─── result-publication-correlation source validation (Phase 1A foundation) ─

test('phase1a: result-publication-correlation requires exact publication + outcome association', () => {
  const r = receipt('result-publication-correlation', PUBLICATION.record_id);
  // exact publication + exact anchor-bound outcome association -> eligible
  const exact = receiptFindings(r, [r, PUBLICATION, ATTEMPT_RECORD, outcomeWithAssociation()]);
  assert.equal(exact.any, false);
  // no outcome record -> receipt-ineligible
  const noOutcome = receiptFindings(r, [r, PUBLICATION, ATTEMPT_RECORD]);
  assert.equal(noOutcome.publicationInvalid, true);
  // outcome without result association -> receipt-ineligible
  const noAssociation = receiptFindings(r, [r, PUBLICATION, ATTEMPT_RECORD, outcome('completed')]);
  assert.equal(noAssociation.publicationInvalid, true);
  // divergent association -> receipt-ineligible
  const divergent = receiptFindings(r, [r, PUBLICATION, ATTEMPT_RECORD, outcome('completed', { result_association: { ...ASSOC, instance_id: 'pgw:i:0b20b20b20b20b20b20b20b20b20b20b' } })]);
  assert.equal(divergent.publicationInvalid, true);
});

// ─── EXE-008: eligibility-conditioned receipt-facts obligation ──────────────

test('phase1a: receipt-facts obligation applies only to retrospective-complete attempts', () => {
  const context = [ACTIVATION_ACCEPTED, OCCURRENCE_RECORD];
  // exactly one bound outcome + no receipt -> obligation fires
  const complete = graphFor(ATTEMPT_RECORD, [...context, ATTEMPT_RECORD, outcome()]);
  assert.ok(complete.some((f) => f.ruleIds.includes('EXE-008') && f.messageKey === 'lifecycle.attempt-receipt-facts'));
  // receipt present -> obligation satisfied
  const withReceipt = graphFor(ATTEMPT_RECORD, [...context, ATTEMPT_RECORD, outcome(), receipt('attempt-end', ATTEMPT_RECORD.record_id)]);
  assert.ok(!withReceipt.some((f) => f.messageKey === 'lifecycle.attempt-receipt-facts'));
  // terminal-unverifiable (no outcome) -> NO obligation
  const unverifiable = graphFor(ATTEMPT_RECORD, [...context, ATTEMPT_RECORD]);
  assert.ok(!unverifiable.some((f) => f.messageKey === 'lifecycle.attempt-receipt-facts'), 'terminal-unverifiable must not demand a receipt');
  // conflicting cardinality (>1 bound outcome) -> NO obligation (EXE-010 territory)
  const conflicting = graphFor(ATTEMPT_RECORD, [...context, ATTEMPT_RECORD, outcome(), outcome('completed', { record_id: 'pgw:l:0d40d40d40d40d40d40d40d40d40d40d' })]);
  assert.ok(!conflicting.some((f) => f.messageKey === 'lifecycle.attempt-receipt-facts'), 'conflicting outcomes must not demand a receipt');
});

// ─── SIR-WP15-P1A-001: exact outcome resolution / cardinality ───────────────

test('p1a-001: duplicate exact outcomes fail closed (no "at least one")', () => {
  const r = receipt('attempt-end', ATTEMPT_RECORD.record_id, { disposition: 'completed' });
  const duplicate = outcome('completed', { record_id: 'pgw:l:0d40d40d40d40d40d40d40d40d40d40d' });
  const result = receiptFindings(r, [r, ATTEMPT_RECORD, outcome('completed'), duplicate]);
  assert.equal(result.outcomeInvalid, true, '>1 outcome for the exact attempt must be a conflict, never covered');
  assert.equal(result.orphan, false);
});

test('p1a-001: misanchored outcome (wrong execution_attempt_record_id) never becomes "one valid outcome"', () => {
  // same workspace/occurrence/attempt/bundle tuple, wrong anchor
  const misanchored = outcome('completed', { execution_attempt_record_id: 'pgw:l:0e10e10e10e10e10e10e10e10e10e10e' });
  const r = receipt('attempt-end', ATTEMPT_RECORD.record_id, { disposition: 'completed' });
  const result = receiptFindings(r, [r, ATTEMPT_RECORD, misanchored]);
  assert.equal(result.outcomeInvalid, true, 'single misanchored candidate is malformed, not exactly-one-valid');
  // a misanchored competitor next to one exact-bound outcome is a conflict, not a pass
  const mixed = receiptFindings(r, [r, ATTEMPT_RECORD, outcome('completed'), misanchored]);
  assert.equal(mixed.outcomeInvalid, true, 'misanchored competitor must not be silently ignored');
});

test('p1a-001: wrong ordinal binding fails closed', () => {
  const wrongOrdinal = outcome('completed', { ordinal: 2 });
  const r = receipt('attempt-end', ATTEMPT_RECORD.record_id, { disposition: 'completed' });
  const result = receiptFindings(r, [r, ATTEMPT_RECORD, wrongOrdinal]);
  assert.equal(result.outcomeInvalid, true);
});

test('p1a-001: publication correlation with duplicate outcomes fails closed', () => {
  const r = receipt('result-publication-correlation', PUBLICATION.record_id, { disposition: 'completed' });
  const duplicate = outcomeWithAssociation();
  const second = { ...outcomeWithAssociation(), record_id: 'pgw:l:0d40d40d40d40d40d40d40d40d40d40d' };
  const result = receiptFindings(r, [r, PUBLICATION, ATTEMPT_RECORD, duplicate, second]);
  assert.equal(result.publicationInvalid, true, 'duplicate outcomes must fail the correlation eligibility');
});

test('p1a-001: publication correlation with a misanchored outcome fails closed', () => {
  const r = receipt('result-publication-correlation', PUBLICATION.record_id, { disposition: 'completed' });
  const misanchored = { ...outcomeWithAssociation(), execution_attempt_record_id: 'pgw:l:0e10e10e10e10e10e10e10e10e10e10e' };
  const result = receiptFindings(r, [r, PUBLICATION, ATTEMPT_RECORD, misanchored]);
  assert.equal(result.publicationInvalid, true);
});

test('p1a-001: classifier delegates to the shared resolver (conflict state)', () => {
  const eligibility = classifyRetrospectiveEligibility(ATTEMPT_RECORD, [outcome('completed'), outcome('completed', { record_id: 'pgw:l:0d40d40d40d40d40d40d40d40d40d40d' })]);
  assert.equal(eligibility, 'conflict');
  assert.equal(classifyRetrospectiveEligibility(ATTEMPT_RECORD, [outcome('completed')]), 'retrospective-complete');
  assert.equal(classifyRetrospectiveEligibility(ATTEMPT_RECORD, []), 'terminal-unverifiable');
  const misanchored = outcome('completed', { execution_attempt_record_id: 'pgw:l:0e10e10e10e10e10e10e10e10e10e10e' });
  assert.equal(classifyRetrospectiveEligibility(ATTEMPT_RECORD, [misanchored]), 'conflict');
});

test('p1a-001: claimant cardinality precedes every exact binding check', () => {
  const bundleDivergent = bundleDivergentOutcome();
  assert.equal(reg.validate(OUTCOME_SCHEMA, bundleDivergent).valid, true, 'divergent bundle claimant is structurally valid');
  assert.equal(resolveExactOutcome(ATTEMPT_RECORD, [bundleDivergent]).kind, 'malformed');
  assert.equal(classifyRetrospectiveEligibility(ATTEMPT_RECORD, [bundleDivergent]), 'conflict');

  // An anchor claim with a divergent tuple is still a claimant, never `none`.
  const anchorTupleDivergent = outcome('completed', { occurrence_id: 'pgw:o:0e50e50e50e50e50e50e50e50e50e50e' });
  assert.equal(resolveExactOutcome(ATTEMPT_RECORD, [anchorTupleDivergent]).kind, 'malformed');
  // A tuple claim with a divergent anchor is symmetric.
  const tupleAnchorDivergent = outcome('completed', { execution_attempt_record_id: 'pgw:l:0e10e10e10e10e10e10e10e10e10e10e' });
  assert.equal(resolveExactOutcome(ATTEMPT_RECORD, [tupleAnchorDivergent]).kind, 'malformed');

  const secondDivergent = bundleDivergentOutcome({
    record_id: 'pgw:l:dddddddddddddddddddddddddddddddd',
    bundle: { ...BUNDLE, target_digest: 'sha-256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  });
  assert.equal(resolveExactOutcome(ATTEMPT_RECORD, [bundleDivergent, secondDivergent]).kind, 'conflict');
  assert.equal(resolveExactOutcome(ATTEMPT_RECORD, [outcome('completed'), bundleDivergent]).kind, 'conflict');

  // A record that claims neither this tuple nor this anchor remains unrelated.
  assert.equal(resolveExactOutcome(ATTEMPT_RECORD, [outcome('completed'), unrelatedOutcome()]).kind, 'exactly-one-valid');
});

test('p1a-001: bundle-divergent claimants fail closed in receipt and publication-correlation consumers', () => {
  const attemptReceipt = receipt('attempt-end', ATTEMPT_RECORD.record_id, { disposition: 'completed' });
  const bundleDivergent = bundleDivergentOutcome({ result_association: ASSOC });
  // One divergent claimant is malformed, and a valid plus divergent claimant is conflict.
  assert.equal(receiptFindings(attemptReceipt, [attemptReceipt, ATTEMPT_RECORD, bundleDivergent]).outcomeInvalid, true);
  assert.equal(receiptFindings(attemptReceipt, [attemptReceipt, ATTEMPT_RECORD, outcomeWithAssociation(), bundleDivergent]).outcomeInvalid, true);

  const correlation = receipt('result-publication-correlation', PUBLICATION.record_id, { disposition: 'completed' });
  assert.equal(receiptFindings(correlation, [correlation, PUBLICATION, ATTEMPT_RECORD, bundleDivergent]).publicationInvalid, true);
  assert.equal(receiptFindings(correlation, [correlation, PUBLICATION, ATTEMPT_RECORD, outcomeWithAssociation(), bundleDivergent]).publicationInvalid, true);
  assert.equal(receiptFindings(correlation, [correlation, PUBLICATION, ATTEMPT_RECORD, outcomeWithAssociation(), unrelatedOutcome()]).any, false);
});

// ─── SIR-WP15-P1A-002: EXE-008 qualifying-receipt obligation ────────────────

test('p1a-002: obligation is satisfied only by a semantically qualifying receipt (attempt as entry)', () => {
  const context = [ACTIVATION_ACCEPTED, OCCURRENCE_RECORD, ATTEMPT_RECORD, outcome('completed')];
  const obligation = (extra: readonly Readonly<Record<string, unknown>>[]) =>
    graphFor(ATTEMPT_RECORD, [...context, ...extra]).some((f) => f.messageKey === 'lifecycle.attempt-receipt-facts');

  // no receipt -> obligation fires
  assert.equal(obligation([]), true);
  // invalid source receipt: same attempt_id but wrong event source class -> does NOT satisfy
  const wrongSource = receipt('attempt-end', ACTIVATION_ACCEPTED.record_id, { disposition: 'completed' });
  assert.equal(obligation([wrongSource]), true, 'source-mismatched receipt must not satisfy the obligation');
  // bad disposition receipt: attempt-end + impossible disposition -> does NOT satisfy
  const badDisposition = receipt('attempt-end', ATTEMPT_RECORD.record_id, { disposition: 'denied' });
  assert.equal(obligation([badDisposition]), true, 'invalid event/disposition pair must not satisfy the obligation');
  // unsupported event type with same attempt_id -> does NOT satisfy
  const unsupported = receipt('occurrence-start', ATTEMPT_RECORD.record_id, { disposition: 'started' });
  assert.equal(obligation([unsupported]), true, 'non-attempt-correlated event type must not satisfy the obligation');
  // result-publication-correlation receipt only -> does NOT satisfy the general attempt obligation
  // (the attempt stays exactly-one-valid: outcomeWithAssociation is the single outcome)
  const correlationOnly = receipt('result-publication-correlation', PUBLICATION.record_id, { disposition: 'completed' });
  const correlationContext = [ACTIVATION_ACCEPTED, OCCURRENCE_RECORD, ATTEMPT_RECORD, outcomeWithAssociation(), PUBLICATION];
  const correlationFindings = graphFor(ATTEMPT_RECORD, [...correlationContext, correlationOnly]);
  assert.ok(
    correlationFindings.some((f) => f.messageKey === 'lifecycle.attempt-receipt-facts'),
    'correlation receipt must not suppress the attempt receipt obligation',
  );
  // valid qualifying receipt -> satisfies
  const valid = receipt('attempt-end', ATTEMPT_RECORD.record_id, { disposition: 'completed' });
  assert.equal(obligation([valid]), false, 'valid qualifying receipt must satisfy the obligation');
});

test('p1a-002: a bundle-divergent claimant cannot qualify a contextual receipt or conceal conflict', () => {
  const validOutcome = outcome('completed');
  const bundleDivergent = bundleDivergentOutcome();
  const validReceipt = receipt('attempt-end', ATTEMPT_RECORD.record_id, { disposition: 'completed' });
  const outcomes = [validOutcome, bundleDivergent];
  assert.equal(resolveExactOutcome(ATTEMPT_RECORD, outcomes).kind, 'conflict');
  assert.equal(classifyRetrospectiveEligibility(ATTEMPT_RECORD, outcomes), 'conflict');
  assert.equal(qualifyReceiptForAttempt(validReceipt, ATTEMPT_RECORD, outcomes), false);

  // The attempt is the entry and the receipt is contextual: it must not look
  // satisfied merely because a valid-looking receipt exists in corrupt state.
  const context = [ACTIVATION_ACCEPTED, OCCURRENCE_RECORD, ATTEMPT_RECORD, validOutcome, bundleDivergent, validReceipt];
  const attemptFindings = graphFor(ATTEMPT_RECORD, context);
  assert.ok(!attemptFindings.some((f) => f.messageKey === 'lifecycle.attempt-receipt-facts'), 'conflict carries no retrospective-complete receipt obligation');
  // The receipt entry remains fail-closed even though the attempt-side finding
  // is intentionally not emitted for a conflict state.
  assert.equal(receiptFindings(validReceipt, context).outcomeInvalid, true);
});

test('p1a-002: entry-filter isolation — an invalid contextual receipt never suppresses the obligation', () => {
  // The attempt is the validation ENTRY. The invalid receipt is a context
  // record whose own findings are filtered out — qualification must still
  // reject it (pure predicate, independent of finding emission).
  const context = [ACTIVATION_ACCEPTED, OCCURRENCE_RECORD, ATTEMPT_RECORD, outcome('completed')];
  const findings = graphFor(ATTEMPT_RECORD, [...context, receipt('attempt-end', ACTIVATION_ACCEPTED.record_id, { disposition: 'completed' })]);
  assert.ok(findings.some((f) => f.messageKey === 'lifecycle.attempt-receipt-facts'), 'invalid contextual receipt must not suppress the obligation');
  assert.ok(!findings.some((f) => f.messageKey === 'lifecycle.receipt-event'), 'context receipt findings are entry-filtered — qualification must not depend on them');
});

test('p1a-002: obligation never demands a receipt for conflicting/malformed outcome state', () => {
  const context = [ACTIVATION_ACCEPTED, OCCURRENCE_RECORD, ATTEMPT_RECORD];
  const conflicting = graphFor(ATTEMPT_RECORD, [...context, outcome('completed'), outcome('completed', { record_id: 'pgw:l:0d40d40d40d40d40d40d40d40d40d40d' })]);
  assert.ok(!conflicting.some((f) => f.messageKey === 'lifecycle.attempt-receipt-facts'));
  const misanchored = graphFor(ATTEMPT_RECORD, [...context, outcome('completed', { execution_attempt_record_id: 'pgw:l:0e10e10e10e10e10e10e10e10e10e10e' })]);
  assert.ok(!misanchored.some((f) => f.messageKey === 'lifecycle.attempt-receipt-facts'));
});

// ─── SIR-WP15-P1A-003: event/disposition semantics ──────────────────────────

test('p1a-003: impossible event/disposition pairs are rejected', () => {
  const cases: [string, Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>, readonly Readonly<Record<string, unknown>>[]][] = [
    ['occurrence-start + completed', receipt('occurrence-start', OCCURRENCE_RECORD.record_id, { disposition: 'completed', attempt_id: undefined }), OCCURRENCE_RECORD, []],
    ['attempt-start + crashed', receipt('attempt-start', ATTEMPT_RECORD.record_id, { disposition: 'crashed' }), ATTEMPT_RECORD, [outcome('completed')]],
    ['timeout + completed', receipt('timeout', ATTEMPT_RECORD.record_id, { disposition: 'completed' }), ATTEMPT_RECORD, [outcome('timed-out')]],
    ['crash + completed', receipt('crash', ATTEMPT_RECORD.record_id, { disposition: 'completed' }), ATTEMPT_RECORD, [outcome('crashed')]],
    ['activation accepted + denied', receipt('activation-decision', ACTIVATION_ACCEPTED.record_id, { disposition: 'denied', attempt_id: undefined }), ACTIVATION_ACCEPTED, []],
    ['activation denied + accepted', receipt('activation-decision', ACTIVATION_DENIED.record_id, { disposition: 'accepted', occurrence_id: undefined, attempt_id: undefined }), ACTIVATION_DENIED, []],
    ['enforcement-denial + rejected receipt disposition', receipt('enforcement-denial', ATTEMPT_RECORD.record_id, { disposition: 'rejected' }), ATTEMPT_RECORD, [outcome('rejected', { enforcement_evidence: ENFORCEMENT })]],
    ['enforcement-denial + denied receipt but completed outcome', receipt('enforcement-denial', ATTEMPT_RECORD.record_id, { disposition: 'denied' }), ATTEMPT_RECORD, [outcome('completed')]],
    ['enforcement-denial + denied + rejected outcome but missing enforcement evidence', receipt('enforcement-denial', ATTEMPT_RECORD.record_id, { disposition: 'denied' }), ATTEMPT_RECORD, [outcome('rejected')]],
    ['result-publication-correlation + non-completed disposition', receipt('result-publication-correlation', PUBLICATION.record_id, { disposition: 'started' }), PUBLICATION, [ATTEMPT_RECORD, outcomeWithAssociation()]],
    ['attempt-end + lossy-mapped rejected to denied', receipt('attempt-end', ATTEMPT_RECORD.record_id, { disposition: 'denied' }), ATTEMPT_RECORD, [outcome('rejected')]],
  ];
  for (const [label, r, source, outcomesSet] of cases) {
    const result = receiptFindings(r, [r, source, ...outcomesSet]);
    assert.equal(result.disposition, true, `expected disposition failure for ${label}: ${JSON.stringify(graphFor(r, [r, source, ...outcomesSet]))}`);
  }
});

test('p1a-003: enforcement-denial evidence matrix', () => {
  const r = (extra: Readonly<Record<string, unknown>> = {}) => receipt('enforcement-denial', ATTEMPT_RECORD.record_id, { disposition: 'denied', ...extra });
  // rejected + valid evidence -> valid
  assert.equal(receiptFindings(r(), [r(), ATTEMPT_RECORD, outcome('rejected', { enforcement_evidence: ENFORCEMENT })]).any, false);
  // rejected + missing evidence -> invalid
  assert.equal(receiptFindings(r(), [r(), ATTEMPT_RECORD, outcome('rejected')]).disposition, true);
  // completed + evidence -> invalid (denial requires a rejected outcome)
  assert.equal(receiptFindings(r(), [r(), ATTEMPT_RECORD, outcome('completed', { enforcement_evidence: ENFORCEMENT })]).disposition, true);
  // completed + no evidence -> invalid
  assert.equal(receiptFindings(r(), [r(), ATTEMPT_RECORD, outcome('completed')]).disposition, true);
  // partial enforcement group -> invalid (committed group contract)
  assert.equal(receiptFindings(r(), [r(), ATTEMPT_RECORD, outcome('rejected', { enforcement_evidence: { projection_identity: 'sha-256:1111111111111111111111111111111111111111111111111111111111111111' } })]).disposition, true);
});

test('p1a-003: outcome disposition stays one-to-one for attempt-end (no lossy conversion)', () => {
  for (const disposition of ['completed', 'failed', 'cancelled', 'timed-out', 'crashed', 'incomplete', 'rejected'] as const) {
    const r = receipt('attempt-end', ATTEMPT_RECORD.record_id, { disposition });
    assert.equal(receiptFindings(r, [r, ATTEMPT_RECORD, outcome(disposition)]).any, false, `attempt-end ${disposition} must match exactly`);
    const mismatched = disposition === 'completed' ? 'failed' : 'completed';
    assert.equal(receiptFindings(r, [r, ATTEMPT_RECORD, outcome(mismatched)]).disposition, true, `attempt-end ${disposition} vs outcome ${mismatched} must fail`);
  }
});
