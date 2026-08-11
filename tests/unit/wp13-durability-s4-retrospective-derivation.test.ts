/**
 * WP-13 durability S4 — shared retrospective derivation FOCUSED tests.
 *
 * Real initialized WP-8 store + real WP-12 lifecycle chain. Covers
 * (durability decision §12/§16; retrospective simplification amendment):
 * the exact 21-field §12 durable-source mapping (golden objects per group
 * variant), retry/previous-attempt semantics, `terminal-unverifiable`
 * (typed NO-FACTS, distinct from corruption), `terminal-unpublished`
 * (association retained, `null` publication id, `[]` scopes), fail-closed
 * ambiguous/corrupt/mismatched durable state (no
 * enumeration-order/timestamp/record-id winner), repeated +
 * fresh-process structural semantic equality (`deepStrictEqual` — no JCS,
 * no hash identity, no byte comparison), and a genuine cold-restart
 * reconstruction over real S3-produced + WP-13C-published durable records.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  makeIntegrationEnv,
  makeContext,
  makeRegistryContext,
  makeIdentitySource,
  makeStoreBoundary,
  seedPayload,
  seedRawRecord,
  grantChainSubjects,
  cleanupTestEnvs,
  FIXED_NOW,
  WS_A,
} from './wp12-helpers.js';
import {
  buildExecutionAttemptRecordPayload,
  buildExecutionOccurrenceRecordPayload,
  registryReferenceFor,
} from '../../src/control-plane/records.js';
import { buildOutcomePayload, produceExecutionOutcome } from '../../src/outcome-production/index.js';
import { publishValidatedResult } from '../../src/publication/index.js';
import { deriveRetrospectiveFactsFromStore, deriveExecutionRetrospectiveFacts, resolveRetrospectiveDurableState, RETROSPECTIVE_FACTS_KEYS } from '../../src/retrospective-derivation/index.js';
import {
  makeS3Env,
  s3Cleanup,
  OCCURRENCE_ID,
  ATTEMPT_ID,
  ATTEMPT_RECORD_ID,
  OCCURRENCE_RECORD_ID,
  ACTIVATION_RECORD_ID,
  GRANT_ID,
} from './wp13-durability-s3-helpers.js';
import type { ExecutionRetrospectiveFacts, RetrospectiveDerivationResult, ValidatedDurableState } from '../../src/retrospective-derivation/index.js';
import type { ControlPlaneStoreBoundary } from '../../src/control-plane/types.js';
import type { AcceptedRegistryContext } from '../../src/api/types.js';

after(() => {
  s3Cleanup();
  cleanupTestEnvs();
});

// ─── fixed vector constants ─────────────────────────────────────────────────

const OBSERVATION_DIGEST = 'sha-256:' + 'a'.repeat(64);
const EVIDENCE_ID = 'pgw:e:' + 'b'.repeat(32);
const ENFORCEMENT_PROJECTION = 'sha-256:' + 'c'.repeat(64);
const ENFORCEMENT_FINGERPRINT = 'sha-256:' + 'd'.repeat(64);
const RESULT_INSTANCE = 'pgw:i:' + 'e'.repeat(32);
const RESULT_DIGEST = 'sha-256:' + '0'.repeat(64);
const VALIDATION_RECORD_ID = 'pgw:l:' + '1'.repeat(32);
const PUBLICATION_RECORD_ID = 'pgw:l:' + '2'.repeat(32);
const PUBLICATION_RECORD_ID_2 = 'pgw:l:' + '3'.repeat(32);
const OUTCOME_RECORD_ID = 'pgw:l:' + '7'.repeat(32);
const OUTCOME_RECORD_ID_2 = 'pgw:l:' + '8'.repeat(32);
const OUTCOME_RECORD_ID_3 = 'pgw:l:' + '9'.repeat(32);
const OCCURRENCE_RECORD_ID_2 = 'pgw:l:' + '6'.repeat(32);
const ATTEMPT_2_ID = 'pgw:a:' + '4'.repeat(32);
const ATTEMPT_2_RECORD_ID = 'pgw:l:' + '5'.repeat(32);
const ATTEMPT_1B_ID = 'pgw:a:' + 'a'.repeat(32);
const ATTEMPT_1B_RECORD_ID = 'pgw:l:' + 'b'.repeat(32);

interface AttemptSeed {
  readonly ordinal: number;
  readonly attemptId: string;
  readonly recordId: string;
}
interface AssociationSeed {
  readonly instanceId: string;
  readonly revisionDigest: string;
  readonly mode: 'originated' | 'adopted';
  readonly validationRecordId: string;
}
interface EnforcementSeed {
  readonly projectionIdentity: string;
  readonly evidenceFingerprint: string;
}

const ANCHOR: AttemptSeed = { ordinal: 1, attemptId: ATTEMPT_ID, recordId: ATTEMPT_RECORD_ID };
const RETRY: AttemptSeed = { ordinal: 2, attemptId: ATTEMPT_2_ID, recordId: ATTEMPT_2_RECORD_ID };
const ASSOCIATION: AssociationSeed = { instanceId: RESULT_INSTANCE, revisionDigest: RESULT_DIGEST, mode: 'originated', validationRecordId: VALIDATION_RECORD_ID };
const ENFORCEMENT: EnforcementSeed = { projectionIdentity: ENFORCEMENT_PROJECTION, evidenceFingerprint: ENFORCEMENT_FINGERPRINT };
const OBSERVATION_REFERENCE: Readonly<Record<string, unknown>> = Object.freeze({
  kind: 'external-evidence',
  evidence_id: EVIDENCE_ID,
  content_digest: OBSERVATION_DIGEST,
  declared_media_type: 'application/json',
  observation_role: 'evaluation-evidence',
});

// ─── world builder (real store; explicit seeding per vector) ────────────────

interface S4World {
  readonly integration: ReturnType<typeof makeIntegrationEnv>;
  readonly registryCtx: AcceptedRegistryContext;
  readonly store: ControlPlaneStoreBoundary;
  readonly bundleReference: Readonly<Record<string, unknown>>;
  readonly seedOutcome: (payload: Readonly<Record<string, unknown>>) => void;
  readonly seedPublication: (payload: Readonly<Record<string, unknown>>) => void;
  readonly seedValidation: (payload: Readonly<Record<string, unknown>>) => void;
  readonly seedAttempt: (attempt: AttemptSeed) => void;
  outcome(opts?: OutcomeOpts): Readonly<Record<string, unknown>>;
  validation(association: AssociationSeed, overrides?: Partial<Readonly<Record<string, unknown>>>): Readonly<Record<string, unknown>>;
  publication(association: AssociationSeed, opts?: { readonly recordId?: string; readonly attempt?: AttemptSeed; readonly scopes?: readonly string[]; readonly overrides?: Partial<Readonly<Record<string, unknown>>> }): Readonly<Record<string, unknown>>;
}

interface OutcomeOpts {
  readonly attempt?: AttemptSeed;
  readonly disposition?: string;
  readonly association?: AssociationSeed | null;
  readonly enforcement?: EnforcementSeed | null;
  readonly recordId?: string;
  readonly evidenceId?: string;
  readonly overrides?: Partial<Readonly<Record<string, unknown>>>;
}

function buildWorld(opts: { readonly occurrence?: 'single' | 'none' | 'duplicate'; readonly attempts?: readonly AttemptSeed[] } = {}): S4World {
  const integration = makeIntegrationEnv();
  const registryCtx = makeRegistryContext();
  const wp12Context = makeContext(integration.storeEnv, { identity: makeIdentitySource() });
  const store = wp12Context.store;
  const bundleSubject = grantChainSubjects(WS_A).bundle.subject;
  const bundleReference: Readonly<Record<string, unknown>> = Object.freeze({
    target_protocol_version: bundleSubject.protocolVersion,
    target_kind: Object.freeze({ id: bundleSubject.kindId, version: bundleSubject.kindVersion }),
    target_instance_id: bundleSubject.instanceId,
    target_revision_id: bundleSubject.revisionId,
    target_digest: bundleSubject.digest,
    target_workspace_binding: Object.freeze({ mode: 'bound', workspace_id: WS_A }),
  });
  if ((opts.occurrence ?? 'single') !== 'none') {
    const occurrence = (recordId: string): void => {
      seedPayload(store, 'execution-occurrence-record', buildExecutionOccurrenceRecordPayload({
        recordId, createdAt: FIXED_NOW, activationRecordId: ACTIVATION_RECORD_ID,
        bundle: bundleReference, workspaceId: WS_A, occurrenceId: OCCURRENCE_ID, runtimeGrantId: GRANT_ID, registry: registryCtx,
      }));
    };
    occurrence(OCCURRENCE_RECORD_ID);
    if (opts.occurrence === 'duplicate') occurrence(OCCURRENCE_RECORD_ID_2);
  }
  for (const attempt of opts.attempts ?? [ANCHOR]) {
    seedPayload(store, 'execution-attempt-record', buildExecutionAttemptRecordPayload({
      recordId: attempt.recordId, createdAt: FIXED_NOW, activationRecordId: ACTIVATION_RECORD_ID,
      occurrenceId: OCCURRENCE_ID, attemptId: attempt.attemptId, ordinal: attempt.ordinal,
      bundle: bundleReference, workspaceId: WS_A, runtimeGrantId: GRANT_ID, registry: registryCtx,
    }));
  }
  return {
    integration,
    registryCtx,
    store,
    bundleReference,
    seedOutcome: (payload) => {
      seedRawRecord(integration.storeEnv, 'execution-outcome-record', payload);
    },
    seedPublication: (payload) => {
      seedRawRecord(integration.storeEnv, 'result-publication-record', payload);
    },
    seedValidation: (payload) => {
      seedRawRecord(integration.storeEnv, 'validation-record', payload);
    },
    seedAttempt: (attempt) => {
      seedPayload(store, 'execution-attempt-record', buildExecutionAttemptRecordPayload({
        recordId: attempt.recordId, createdAt: FIXED_NOW, activationRecordId: ACTIVATION_RECORD_ID,
        occurrenceId: OCCURRENCE_ID, attemptId: attempt.attemptId, ordinal: attempt.ordinal,
        bundle: bundleReference, workspaceId: WS_A, runtimeGrantId: GRANT_ID, registry: registryCtx,
      }));
    },
    outcome(o: OutcomeOpts = {}): Readonly<Record<string, unknown>> {
      const attempt = o.attempt ?? ANCHOR;
      const payload = buildOutcomePayload(
        {
          registryReference: registryReferenceFor(registryCtx),
          workspaceId: WS_A,
          bundle: bundleReference,
          occurrenceId: OCCURRENCE_ID,
          attemptId: attempt.attemptId,
          ordinal: attempt.ordinal,
          attemptRecordId: attempt.recordId,
          disposition: (o.disposition ?? 'completed') as ExecutionRetrospectiveFacts['disposition'],
          observationDigest: OBSERVATION_DIGEST,
          ...(o.enforcement !== undefined && o.enforcement !== null ? { enforcement: Object.freeze({ ...o.enforcement }) } : {}),
          ...(o.association !== undefined && o.association !== null ? { association: Object.freeze({ ...o.association }) } : {}),
        },
        o.recordId ?? OUTCOME_RECORD_ID,
        FIXED_NOW,
        o.evidenceId ?? EVIDENCE_ID,
      );
      return { ...payload, ...o.overrides };
    },
    validation(association: AssociationSeed, overrides: Partial<Readonly<Record<string, unknown>>> = {}): Readonly<Record<string, unknown>> {
      return Object.freeze({
        record_type: 'ValidationRecord',
        record_id: association.validationRecordId,
        created_at: FIXED_NOW,
        responsible_role: 'trusted-validator',
        registry_snapshot_reference: registryReferenceFor(registryCtx),
        subject: Object.freeze({
          protocol_version: '1.0',
          kind: Object.freeze({ id: 'ExecutionResult', version: '1.0' }),
          instance_id: association.instanceId,
          revision_id: association.instanceId.replace('pgw:i:', 'pgw:r:'),
          digest: association.revisionDigest,
          workspace_id: WS_A,
        }),
        validator_profile: Object.freeze({ id: 'project-gateway.structural-semantic-v1', version: '1.0' }),
        structural_outcome: 'pass',
        semantic_outcome: 'pass',
        findings: Object.freeze([]),
        ...overrides,
      });
    },
    publication(association: AssociationSeed, o: { readonly recordId?: string; readonly attempt?: AttemptSeed; readonly scopes?: readonly string[]; readonly overrides?: Partial<Readonly<Record<string, unknown>>> } = {}): Readonly<Record<string, unknown>> {
      const attempt = o.attempt ?? ANCHOR;
      return Object.freeze({
        record_type: 'ResultPublicationRecord',
        record_id: o.recordId ?? PUBLICATION_RECORD_ID,
        created_at: FIXED_NOW,
        responsible_role: 'trusted-result-publisher',
        registry_snapshot_reference: registryReferenceFor(registryCtx),
        result_subject: Object.freeze({
          protocol_version: '1.0',
          kind: Object.freeze({ id: 'ExecutionResult', version: '1.0' }),
          instance_id: association.instanceId,
          revision_id: association.instanceId.replace('pgw:i:', 'pgw:r:'),
          digest: association.revisionDigest,
          workspace_id: WS_A,
        }),
        evaluator_provenance: Object.freeze({ evaluator_id: 'evaluator-1', capability_profile_id: 'capability-1' }),
        association_mode: association.mode,
        validation_record_id: association.validationRecordId,
        bundle: Object.freeze({ ...bundleReference }),
        workspace_id: WS_A,
        occurrence_id: OCCURRENCE_ID,
        attempt_id: attempt.attemptId,
        publication_scopes: Object.freeze(o.scopes ?? ['ordinary-review']),
        receipt_correlations: Object.freeze([]),
        ...o.overrides,
      });
    },
  };
}

function derive(world: S4World, attemptRecordId: string = ATTEMPT_RECORD_ID): RetrospectiveDerivationResult {
  return deriveRetrospectiveFactsFromStore({ records: world.store, attemptRecordId });
}

function factsOf(result: RetrospectiveDerivationResult): ExecutionRetrospectiveFacts {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  return result.facts;
}

function deniedOf(result: RetrospectiveDerivationResult): { readonly category: string; readonly code: string } {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) throw new Error('unreachable');
  return { category: result.category, code: result.code };
}

/** Golden expected 21-field object (independent construction; §12 mapping). */
function expectedFacts(world: S4World, o: {
  readonly attempt?: AttemptSeed;
  readonly previousAttemptId?: string | null;
  readonly disposition?: string;
  readonly association?: AssociationSeed | null;
  readonly enforcement?: EnforcementSeed | null;
  readonly publication?: { readonly recordId: string; readonly scopes: readonly string[] } | null;
  readonly occurrenceRecordId?: string;
} = {}): ExecutionRetrospectiveFacts {
  const attempt = o.attempt ?? ANCHOR;
  const association = o.association ?? null;
  const enforcement = o.enforcement ?? null;
  const publication = o.publication ?? null;
  return Object.freeze({
    workspace_id: WS_A,
    bundle: world.bundleReference,
    occurrence_id: OCCURRENCE_ID,
    attempt_id: attempt.attemptId,
    attempt_ordinal: attempt.ordinal,
    activation_record_id: ACTIVATION_RECORD_ID,
    runtime_grant_id: GRANT_ID,
    execution_attempt_record_id: attempt.recordId,
    occurrence_record_id: o.occurrenceRecordId ?? OCCURRENCE_RECORD_ID,
    previous_attempt_id: o.previousAttemptId !== undefined ? o.previousAttemptId : (attempt.ordinal === 1 ? null : ATTEMPT_ID),
    disposition: (o.disposition ?? 'completed') as ExecutionRetrospectiveFacts['disposition'],
    result_instance_id: association === null ? null : association.instanceId,
    result_revision_digest: association === null ? null : association.revisionDigest,
    association_mode: association === null ? null : association.mode,
    result_validation_record_id: association === null ? null : association.validationRecordId,
    result_publication_record_id: publication === null ? null : publication.recordId,
    publication_scopes: publication === null ? Object.freeze([]) : Object.freeze([...publication.scopes]),
    observation_references: Object.freeze([OBSERVATION_REFERENCE]),
    enforcement_evidence_identity: enforcement === null ? null : enforcement.projectionIdentity,
    enforcement_evidence_fingerprint: enforcement === null ? null : enforcement.evidenceFingerprint,
    orchestration_evidence_identity: attempt.recordId,
  });
}

// ─── valid derivation matrix (golden 21-field objects) ──────────────────────

interface ValidRow {
  readonly name: string;
  readonly seed: (w: S4World) => void;
  readonly attemptRecordId?: string;
  readonly expected: (w: S4World) => ExecutionRetrospectiveFacts;
}

const VALID_ROWS: readonly ValidRow[] = [
  {
    name: 'ordinal-1, no result, no enforcement (golden minimal object)',
    seed: (w) => {
      w.seedOutcome(w.outcome({ enforcement: null }));
    },
    expected: (w) => expectedFacts(w, {}),
  },
  {
    name: 'retry attempt with exact previous attempt (ordinal 2)',
    seed: (w) => {
      w.seedAttempt(ANCHOR);
      w.seedOutcome(w.outcome({ recordId: OUTCOME_RECORD_ID_3, enforcement: null }));
      w.seedAttempt(RETRY);
      w.seedOutcome(w.outcome({ attempt: RETRY, recordId: OUTCOME_RECORD_ID, enforcement: null }));
    },
    attemptRecordId: ATTEMPT_2_RECORD_ID,
    expected: (w) => expectedFacts(w, { attempt: RETRY, previousAttemptId: ATTEMPT_ID }),
  },
  {
    name: 'result associated but unpublished (quartet retained; publication null; scopes [])',
    seed: (w) => {
      w.seedValidation(w.validation(ASSOCIATION));
      w.seedOutcome(w.outcome({ association: ASSOCIATION, enforcement: null }));
    },
    expected: (w) => expectedFacts(w, { association: ASSOCIATION }),
  },
  {
    name: 'result published (publication id + ordinary-review scopes)',
    seed: (w) => {
      w.seedValidation(w.validation(ASSOCIATION));
      w.seedOutcome(w.outcome({ association: ASSOCIATION, enforcement: null }));
      w.seedPublication(w.publication(ASSOCIATION));
    },
    expected: (w) => expectedFacts(w, { association: ASSOCIATION, publication: { recordId: PUBLICATION_RECORD_ID, scopes: ['ordinary-review'] } }),
  },
  {
    name: 'enforcement absent (19–20 both null)',
    seed: (w) => {
      w.seedOutcome(w.outcome({ enforcement: null, association: ASSOCIATION }));
      w.seedValidation(w.validation(ASSOCIATION));
    },
    expected: (w) => expectedFacts(w, { association: ASSOCIATION }),
  },
  {
    name: 'enforcement present (19–20 pair populated)',
    seed: (w) => {
      w.seedOutcome(w.outcome({ enforcement: ENFORCEMENT, association: ASSOCIATION }));
      w.seedValidation(w.validation(ASSOCIATION));
    },
    expected: (w) => expectedFacts(w, { association: ASSOCIATION, enforcement: ENFORCEMENT }),
  },
  {
    name: 'ordinal-1 derivation is unaffected by a later retry attempt in the same occurrence',
    seed: (w) => {
      w.seedOutcome(w.outcome({ enforcement: null }));
      w.seedAttempt(RETRY);
      w.seedOutcome(w.outcome({ attempt: RETRY, recordId: OUTCOME_RECORD_ID_3, enforcement: null }));
    },
    expected: (w) => expectedFacts(w, {}),
  },
];

for (const row of VALID_ROWS) {
  test(`valid: ${row.name}`, () => {
    const world = buildWorld();
    row.seed(world);
    const facts = factsOf(derive(world, row.attemptRecordId ?? ATTEMPT_RECORD_ID));
    // structural semantic equality against the golden object
    assert.deepEqual(facts, row.expected(world));
    // fixed v1 shape discipline: exactly the 21 contract keys, never undefined
    assert.deepEqual(Object.keys(facts), [...RETROSPECTIVE_FACTS_KEYS]);
    assert.equal(Object.values(facts).some((v) => v === undefined), false);
    // repeated derivation of the same durable state → structurally equal
    assert.deepEqual(factsOf(derive(world, row.attemptRecordId ?? ATTEMPT_RECORD_ID)), facts);
  });
}

// ─── terminal states ────────────────────────────────────────────────────────

test('terminal-unverifiable: durable attempt without outcome record emits NO facts (typed, distinct from corruption)', () => {
  const world = buildWorld();
  const denied = deniedOf(derive(world));
  assert.equal(denied.category, 'RETROSPECTIVE-NO-FACTS');
  assert.equal(denied.code, 'terminal-unverifiable');
});

test('terminal-unpublished: outcome with result association but no publication keeps quartet, null id, [] scopes', () => {
  const world = buildWorld();
  world.seedValidation(world.validation(ASSOCIATION));
  world.seedOutcome(world.outcome({ association: ASSOCIATION, enforcement: null }));
  const facts = factsOf(derive(world));
  assert.equal(facts.result_instance_id, RESULT_INSTANCE);
  assert.equal(facts.result_revision_digest, RESULT_DIGEST);
  assert.equal(facts.association_mode, 'originated');
  assert.equal(facts.result_validation_record_id, VALIDATION_RECORD_ID);
  assert.equal(facts.result_publication_record_id, null);
  assert.deepEqual(facts.publication_scopes, []);
});

// ─── fail-closed: ambiguous/corrupt/mismatched durable state ────────────────

test('fail closed: missing occurrence record', () => {
  const world = buildWorld({ occurrence: 'none' });
  world.seedOutcome(world.outcome({ enforcement: null }));
  const denied = deniedOf(derive(world));
  assert.equal(denied.category, 'RETROSPECTIVE-STATE-CORRUPT');
  assert.equal(denied.code, 'state.occurrence-missing');
});

test('fail closed: duplicate occurrence record', () => {
  const world = buildWorld({ occurrence: 'duplicate' });
  world.seedOutcome(world.outcome({ enforcement: null }));
  const denied = deniedOf(derive(world));
  assert.equal(denied.category, 'RETROSPECTIVE-STATE-CORRUPT');
  assert.equal(denied.code, 'state.occurrence-ambiguous');
});

test('fail closed: missing previous attempt where required (ordinal 2, no ordinal 1)', () => {
  const world = buildWorld({ attempts: [] });
  world.seedAttempt(RETRY);
  world.seedOutcome(world.outcome({ attempt: RETRY, enforcement: null }));
  const denied = deniedOf(derive(world, ATTEMPT_2_RECORD_ID));
  assert.equal(denied.category, 'RETROSPECTIVE-STATE-CORRUPT');
  assert.equal(denied.code, 'state.previous-missing');
});

test('fail closed: duplicate/ambiguous previous attempt (two ordinal-1 records)', () => {
  const world = buildWorld();
  world.seedAttempt({ ordinal: 1, attemptId: ATTEMPT_1B_ID, recordId: ATTEMPT_1B_RECORD_ID });
  world.seedAttempt(RETRY);
  world.seedOutcome(world.outcome({ attempt: RETRY, enforcement: null }));
  const denied = deniedOf(derive(world, ATTEMPT_2_RECORD_ID));
  assert.equal(denied.category, 'RETROSPECTIVE-STATE-CORRUPT');
  assert.equal(denied.code, 'state.previous-ambiguous');
});

test('fail closed: multiple outcome records for the exact attempt (no winner)', () => {
  const world = buildWorld();
  world.seedOutcome(world.outcome({ recordId: OUTCOME_RECORD_ID, enforcement: null }));
  world.seedOutcome(world.outcome({ recordId: OUTCOME_RECORD_ID_2, enforcement: null }));
  const denied = deniedOf(derive(world));
  assert.equal(denied.category, 'RETROSPECTIVE-STATE-CORRUPT');
  assert.equal(denied.code, 'state.outcome-ambiguous');
});

test('fail closed: corrupt entry in the outcome class (wrong record type is never skipped)', () => {
  const world = buildWorld();
  world.seedOutcome({ ...world.outcome({ enforcement: null }), record_type: 'ResultPublicationRecord' });
  const denied = deniedOf(derive(world));
  assert.equal(denied.category, 'RETROSPECTIVE-STATE-CORRUPT');
  assert.equal(denied.code, 'state.corrupt-entry');
});

test('fail closed: outcome record does not bind the exact anchor attempt record', () => {
  const world = buildWorld();
  world.seedOutcome(world.outcome({ enforcement: null, overrides: { execution_attempt_record_id: 'pgw:l:' + '9'.repeat(32) } }));
  const denied = deniedOf(derive(world));
  assert.equal(denied.category, 'RETROSPECTIVE-STATE-CORRUPT');
  assert.equal(denied.code, 'state.outcome-anchor-mismatch');
});

test('fail closed: outcome ordinal does not exactly match the attempt', () => {
  const world = buildWorld();
  world.seedOutcome(world.outcome({ enforcement: null, overrides: { ordinal: 2 } }));
  const denied = deniedOf(derive(world));
  assert.equal(denied.category, 'RETROSPECTIVE-STATE-CORRUPT');
  assert.equal(denied.code, 'state.outcome-ordinal-mismatch');
});

test('fail closed: missing ValidationRecord referenced by the result association', () => {
  const world = buildWorld();
  world.seedOutcome(world.outcome({ association: ASSOCIATION, enforcement: null }));
  const denied = deniedOf(derive(world));
  assert.equal(denied.category, 'RETROSPECTIVE-CORRELATION-MISMATCH');
  assert.equal(denied.code, 'validation.missing');
});

test('fail closed: non-passing ValidationRecord', () => {
  const world = buildWorld();
  world.seedValidation(world.validation(ASSOCIATION, { structural_outcome: 'fail' }));
  world.seedOutcome(world.outcome({ association: ASSOCIATION, enforcement: null }));
  const denied = deniedOf(derive(world));
  assert.equal(denied.category, 'RETROSPECTIVE-STATE-CORRUPT');
  assert.equal(denied.code, 'facts.validation-invalid');
});

test('fail closed: ValidationRecord subject mismatches the outcome association', () => {
  const world = buildWorld();
  world.seedValidation(world.validation({ ...ASSOCIATION, instanceId: 'pgw:i:' + 'f'.repeat(32) }));
  world.seedOutcome(world.outcome({ association: ASSOCIATION, enforcement: null }));
  const denied = deniedOf(derive(world));
  assert.equal(denied.category, 'RETROSPECTIVE-CORRELATION-MISMATCH');
  assert.equal(denied.code, 'facts.validation-subject-mismatch');
});

test('fail closed: publication without a matching outcome result association', () => {
  const world = buildWorld();
  world.seedOutcome(world.outcome({ enforcement: null }));
  world.seedPublication(world.publication(ASSOCIATION));
  const denied = deniedOf(derive(world));
  assert.equal(denied.category, 'RETROSPECTIVE-CORRELATION-MISMATCH');
  assert.equal(denied.code, 'facts.publication-without-association');
});

test('fail closed: mismatched publication association (EXE-013 divergence)', () => {
  const world = buildWorld();
  world.seedValidation(world.validation(ASSOCIATION));
  world.seedOutcome(world.outcome({ association: ASSOCIATION, enforcement: null }));
  world.seedPublication(world.publication(ASSOCIATION, { overrides: { association_mode: 'adopted' } }));
  const denied = deniedOf(derive(world));
  assert.equal(denied.category, 'RETROSPECTIVE-CORRELATION-MISMATCH');
  assert.equal(denied.code, 'facts.publication-association-mismatch');
});

test('fail closed: multiple attempt-scoped publications', () => {
  const world = buildWorld();
  world.seedValidation(world.validation(ASSOCIATION));
  world.seedOutcome(world.outcome({ association: ASSOCIATION, enforcement: null }));
  world.seedPublication(world.publication(ASSOCIATION, { recordId: PUBLICATION_RECORD_ID }));
  world.seedPublication(world.publication(ASSOCIATION, { recordId: PUBLICATION_RECORD_ID_2 }));
  const denied = deniedOf(derive(world));
  assert.equal(denied.category, 'RETROSPECTIVE-STATE-CORRUPT');
  assert.equal(denied.code, 'state.publication-ambiguous');
});

test('fail closed: cross-workspace outcome is not correlated (terminal-unverifiable for the exact attempt)', () => {
  const world = buildWorld();
  world.seedOutcome(world.outcome({ enforcement: null, overrides: { workspace_id: 'pgw:w:' + 'f'.repeat(32) } }));
  const denied = deniedOf(derive(world));
  assert.equal(denied.category, 'RETROSPECTIVE-NO-FACTS');
  assert.equal(denied.code, 'terminal-unverifiable');
});

test('fail closed: partial enforcement group (identity without fingerprint) is corrupt', () => {
  const world = buildWorld();
  world.seedOutcome(world.outcome({ overrides: { enforcement_evidence: Object.freeze({ projection_identity: ENFORCEMENT_PROJECTION }) } }));
  const denied = deniedOf(derive(world));
  assert.equal(denied.category, 'RETROSPECTIVE-STATE-CORRUPT');
  assert.equal(denied.code, 'facts.outcome-invalid');
});

test('fail closed: partial result quartet (association without validation_record_id) is corrupt', () => {
  const world = buildWorld();
  world.seedOutcome(world.outcome({
    overrides: {
      result_association: Object.freeze({
        instance_id: RESULT_INSTANCE,
        revision_digest: RESULT_DIGEST,
        association_mode: 'originated',
      }),
    },
  }));
  const denied = deniedOf(derive(world));
  assert.equal(denied.category, 'RETROSPECTIVE-STATE-CORRUPT');
  assert.equal(denied.code, 'state.outcome-corrupt');
});

test('fail closed: malformed derivation input', () => {
  const world = buildWorld();
  const denied = deniedOf(deriveRetrospectiveFactsFromStore({ records: world.store, attemptRecordId: 'not-a-record-id' }));
  assert.equal(denied.category, 'RETROSPECTIVE-INPUT-INVALID');
  const missing = deniedOf(deriveRetrospectiveFactsFromStore({ records: world.store, attemptRecordId: 'pgw:l:' + '0'.repeat(32) }));
  assert.equal(missing.category, 'RETROSPECTIVE-STATE-CORRUPT');
  assert.equal(missing.code, 'state.attempt-missing');
});

// ─── determinism / semantic equality ────────────────────────────────────────

test('semantic equality: same durable semantic state in different seed/enumeration orders derives structurally equal facts', () => {
  const first = buildWorld();
  first.seedAttempt(RETRY);
  // unrelated outcome for the retry attempt + the anchor outcome, seeded in one order
  first.seedOutcome(first.outcome({ attempt: RETRY, recordId: OUTCOME_RECORD_ID_2, enforcement: null }));
  first.seedOutcome(first.outcome({ association: ASSOCIATION, enforcement: ENFORCEMENT }));
  first.seedValidation(first.validation(ASSOCIATION));
  first.seedPublication(first.publication(ASSOCIATION));

  const second = buildWorld();
  second.seedAttempt(RETRY);
  // same durable semantic state (identical record identities/content), reversed seeding order
  second.seedPublication(second.publication(ASSOCIATION, { recordId: PUBLICATION_RECORD_ID }));
  second.seedValidation(second.validation(ASSOCIATION));
  second.seedOutcome(second.outcome({ attempt: RETRY, recordId: OUTCOME_RECORD_ID_2, enforcement: null }));
  second.seedOutcome(second.outcome({ association: ASSOCIATION, enforcement: ENFORCEMENT, recordId: OUTCOME_RECORD_ID }));

  const factsA = factsOf(derive(first));
  const factsB = factsOf(derive(second));
  assert.deepEqual(factsB, factsA);
});

// ─── SIR-WP13-DUR-S4-001: stable immutable fact-set ownership ───────────────

test('input mutation isolation: post-derivation mutation of caller-owned nested bundle values cannot change the derived fact-set (SIR-WP13-DUR-S4-001)', () => {
  const world = buildWorld();
  world.seedOutcome(world.outcome({ enforcement: null }));
  const resolved = resolveRetrospectiveDurableState({ records: world.store, attemptRecordId: ATTEMPT_RECORD_ID });
  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  if (!resolved.ok) throw new Error('unreachable');
  const attempt = resolved.state.attempt;
  const bundle = attempt['bundle'] as Readonly<Record<string, unknown>>;
  // caller-owned MUTABLE copy of the input bundle (same committed values)
  const callerBundle: Record<string, unknown> = {
    ...bundle,
    target_kind: { ...(bundle['target_kind'] as Readonly<Record<string, unknown>>) },
    target_workspace_binding: { ...(bundle['target_workspace_binding'] as Readonly<Record<string, unknown>>) },
  };
  const state: ValidatedDurableState = { ...resolved.state, attempt: { ...attempt, bundle: callerBundle } };
  const derived = deriveExecutionRetrospectiveFacts(state);
  assert.equal(derived.ok, true, JSON.stringify(derived));
  if (!derived.ok) throw new Error('unreachable');
  const facts = derived.facts;
  const digestBefore = facts.bundle['target_digest'];

  // caller mutates its nested input objects AFTER derivation
  (callerBundle['target_kind'] as Record<string, unknown>)['id'] = 'MutatedKind';
  (callerBundle['target_workspace_binding'] as Record<string, unknown>)['workspace_id'] = 'pgw:w:' + '9'.repeat(32);
  callerBundle['target_digest'] = 'sha-256:' + 'f'.repeat(64);

  // the previously derived fact-set is unchanged (golden object still equal)
  assert.deepEqual(facts, expectedFacts(world, {}));
  assert.equal((facts.bundle['target_kind'] as Readonly<Record<string, unknown>>)['id'], 'ExecutionBundle');
  assert.equal((facts.bundle['target_workspace_binding'] as Readonly<Record<string, unknown>>)['workspace_id'], WS_A);
  assert.equal(facts.bundle['target_digest'], digestBefore);
  // (repeated derivation from the SAME unmutated state remains deepStrictEqual
  //  — covered by the valid matrix rows above; semantic equality is unchanged)
});

test('output immutability: returned nested bundle values are frozen and owned (SIR-WP13-DUR-S4-001)', () => {
  const world = buildWorld();
  world.seedOutcome(world.outcome({ enforcement: null }));
  const facts = factsOf(derive(world));
  // nested bundle objects are frozen (strict-mode assignment throws)
  assert.throws(() => {
    (facts.bundle['target_kind'] as Record<string, unknown>)['id'] = 'MutatedKind';
  }, TypeError);
  assert.throws(() => {
    (facts.bundle['target_workspace_binding'] as Record<string, unknown>)['workspace_id'] = 'pgw:w:' + '9'.repeat(32);
  }, TypeError);
  assert.throws(() => {
    (facts.bundle as Record<string, unknown>)['target_digest'] = 'sha-256:' + 'f'.repeat(64);
  }, TypeError);
  // the fact-set itself and its remaining nested members are frozen too
  assert.throws(() => {
    (facts as unknown as Record<string, unknown>)['workspace_id'] = 'pgw:w:' + '9'.repeat(32);
  }, TypeError);
  assert.throws(() => {
    (facts.observation_references[0] as Record<string, unknown>)['evidence_id'] = 'pgw:e:' + '9'.repeat(32);
  }, TypeError);
  assert.throws(() => {
    (facts.publication_scopes as string[]).push('mutated');
  }, TypeError);
  // values unchanged after all attempted mutations
  assert.deepEqual(facts, expectedFacts(world, {}));
});

// ─── cold restart E2E (real S3 production + real WP-13C publication) ────────

test('cold restart: a fresh store handle reconstructs the exact same 21-field object from durable records only', () => {
  const env = makeS3Env();
  // real S3 outcome production (published) + real WP-13C publication (published)
  const produced = produceExecutionOutcome(env.input());
  assert.equal(produced.ok, true, JSON.stringify(produced));
  if (!produced.ok) throw new Error('unreachable');
  assert.equal(produced.outcome, 'published');
  const published = publishValidatedResult(env.pubInput());
  assert.equal(published.ok, true, JSON.stringify(published));
  if (!published.ok) throw new Error('unreachable');
  assert.equal(published.outcome, 'published');

  // first derivation through the live boundary
  const first = deriveRetrospectiveFactsFromStore({ records: env.wp12Context.store, attemptRecordId: ATTEMPT_RECORD_ID });
  assert.equal(first.ok, true, JSON.stringify(first));
  if (!first.ok) throw new Error('unreachable');

  // fresh store boundary over the SAME durable root (fresh-process equivalent:
  // no process-local outcome/observation/handoff, no ExecutionResult bytes,
  // no receipt, no in-memory cache)
  const freshStore = makeStoreBoundary({
    dir: env.integration.storeEnv.dir,
    config: env.integration.storeEnv.config,
    bootstrapInput: env.integration.storeEnv.bootstrapInput,
    remove: () => {
      /* owned by the original env */
    },
  });
  const second = deriveRetrospectiveFactsFromStore({ records: freshStore, attemptRecordId: ATTEMPT_RECORD_ID });
  assert.equal(second.ok, true, JSON.stringify(second));
  if (!second.ok) throw new Error('unreachable');

  // structural semantic equality across the cold restart
  assert.deepEqual(second.facts, first.facts);

  // spot-check the real durable values (quartet + publication + enforcement + observation)
  const facts = first.facts;
  assert.equal(facts.workspace_id, WS_A);
  assert.equal(facts.attempt_ordinal, 1);
  assert.equal(facts.previous_attempt_id, null);
  assert.equal(facts.execution_attempt_record_id, ATTEMPT_RECORD_ID);
  assert.equal(facts.occurrence_record_id, OCCURRENCE_RECORD_ID);
  assert.equal(facts.disposition, 'completed');
  assert.equal(facts.result_instance_id, env.handoff.resultInstanceId);
  assert.equal(facts.result_revision_digest, env.handoff.resultDigest);
  assert.equal(facts.association_mode, env.handoff.associationMode);
  assert.equal(facts.result_validation_record_id, env.handoff.validationRecordId);
  assert.equal(facts.result_publication_record_id, published.recordId);
  assert.deepEqual(facts.publication_scopes, ['ordinary-review']);
  assert.equal(facts.observation_references.length, 1);
  assert.equal(facts.enforcement_evidence_identity, env.enforcement.projectionIdentity);
  assert.equal(facts.enforcement_evidence_fingerprint, env.enforcement.evidenceFingerprint);
  assert.equal(facts.orchestration_evidence_identity, ATTEMPT_RECORD_ID);
  assert.deepEqual(Object.keys(facts), [...RETROSPECTIVE_FACTS_KEYS]);
});
