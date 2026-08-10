/**
 * WP-13 durability S3 — WP-13C outcome precondition FOCUSED tests.
 *
 * The strengthened real WP-13C publication boundary (durability decision
 * §11–§13/§19): under WP-13C's own independently acquired attempt lock,
 * BEFORE first publication or replay acceptance, the publication must find
 * exactly one valid matching ExecutionOutcomeRecord with a complete result
 * association, exact-matched against the publication request/handoff
 * (instance/digest/mode/ValidationRecord id/workspace/bundle/occurrence/
 * attempt), with the passing ValidationRecord independently re-read.
 *
 * The outcome record is NOT publication provenance; ResultPublicationRecord
 * remains authoritative for publication. An existing publication alone never
 * bypasses outcome consistency.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { publishValidatedResult } from '../../src/publication/index.js';
import { buildValidationRecordPayload } from '../../src/control-plane/records.js';
import { createPublicationOutcomePrecondition } from '../../src/internal/publication-outcome-context.js';
import { seedPayload, FIXED_NOW } from './wp12-helpers.js';
import { makeS3Env, s3Cleanup, nextRecordId } from './wp13-durability-s3-helpers.js';
import type { PublicationInput, PublicationResult, PublicationOutcomePrecondition } from '../../src/publication/types.js';
import type { ValidatedResultHandoff } from '../../src/completion/types.js';

after(s3Cleanup);

function publishedOf(result: PublicationResult): { readonly recordId: string; readonly outcome: 'published' | 'idempotent-replay' } {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  return { recordId: result.recordId, outcome: result.outcome };
}

function deniedOf(result: PublicationResult): { readonly category: string; readonly code: string } {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) throw new Error('unreachable');
  return { category: result.category, code: result.code };
}

function publicationRecords(env: ReturnType<typeof makeS3Env>): Readonly<Record<string, unknown>>[] {
  const out: Readonly<Record<string, unknown>>[] = [];
  const enumerated = env.publicationBoundary.enumerateLifecycleRecords('result-publication-record');
  if (!enumerated.ok) return [];
  for (const recordId of enumerated.recordIds) {
    const read = env.publicationBoundary.readLifecyclePayload('result-publication-record', recordId);
    if (read.ok && read.payload !== undefined) out.push(read.payload);
  }
  return out;
}

/** Seed a durable passing ValidationRecord for a variant handoff subject. */
function seedResultValidation(env: ReturnType<typeof makeS3Env>, handoff: ValidatedResultHandoff, recordId: string): void {
  seedPayload(env.store, 'validation-record', buildValidationRecordPayload({
    recordId,
    createdAt: FIXED_NOW,
    subject: {
      protocolId: 'project-gateway.artifact',
      protocolVersion: '1.0',
      kindId: 'ExecutionResult' as never,
      kindVersion: '1.0',
      instanceId: handoff.resultInstanceId,
      revisionId: handoff.resultRevisionId,
      digest: handoff.resultDigest,
      workspaceId: handoff.workspaceId,
    },
    registry: env.registryCtx,
  }));
}

// ─── SIR-WP13-DUR-S3-001: omission / forgery / legacy (no default-allow) ────

test('WP-13C precondition: omitted outcome context fails closed with zero publication write', () => {
  const env = makeS3Env();
  // A legacy-shaped caller input: every member except the outcome context.
  const { outcome: _omitted, ...legacy } = env.pubInput();
  void _omitted;
  const result = publishValidatedResult(legacy);
  const failed = deniedOf(result);
  assert.equal(failed.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failed.code, 'outcome.context-missing');
  assert.equal(publicationRecords(env).length, 0);
  // An explicitly-undefined context is the same omission.
  const result2 = publishValidatedResult(env.pubInput({ outcome: undefined }));
  assert.equal(result2.ok, false);
  if (!result2.ok) assert.equal(result2.code, 'outcome.context-missing');
  assert.equal(publicationRecords(env).length, 0);
});

test('WP-13C precondition: replay cannot bypass the omitted context (legacy caller)', () => {
  const env = makeS3Env();
  env.seedOutcome();
  // A durable exact publication exists (created with the genuine context).
  const first = publishedOf(publishValidatedResult(env.pubInput()));
  assert.equal(first.outcome, 'published');
  // A legacy-shape direct caller omitting the context cannot replay it.
  const { outcome: _omitted2, ...legacy } = env.pubInput();
  void _omitted2;
  const result = publishValidatedResult(legacy);
  const failed = deniedOf(result);
  assert.equal(failed.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failed.code, 'outcome.context-missing');
  assert.equal(publicationRecords(env).length, 1, 'no second write and no replay bypass');
});

test('WP-13C precondition: a forged structurally-compatible outcome context is rejected before publication', () => {
  const env = makeS3Env();
  // Structurally compatible fake: a plain object wrapping a fabricated store
  // that would return a matching outcome. The WeakSet brand is unforgeable.
  const fabricated: PublicationOutcomePrecondition = {
    store: {
      publishExactOutcomeRecord() {
        return { ok: true, outcome: 'published' as const, recordId: 'pgw:l:' + '0'.repeat(32), recordDigest: 'sha-256:' + '0'.repeat(64) };
      },
      readLifecyclePayload() {
        return {
          ok: true,
          payload: {
            record_type: 'ExecutionOutcomeRecord',
            record_id: 'pgw:l:' + '0'.repeat(32),
            created_at: FIXED_NOW,
            responsible_role: 'trusted-execution-outcome-recorder',
            workspace_id: env.handoff.workspaceId,
            bundle: env.handoff.bundleReference,
            occurrence_id: env.handoff.occurrenceId,
            attempt_id: env.handoff.attemptId,
            result_association: {
              instance_id: env.handoff.resultInstanceId,
              revision_digest: env.handoff.resultDigest,
              association_mode: env.handoff.associationMode,
              validation_record_id: env.handoff.validationRecordId,
            },
          },
        };
      },
      enumerateLifecycleRecords() {
        return { ok: true, recordIds: ['pgw:l:' + '0'.repeat(32)] };
      },
    },
  };
  const result = publishValidatedResult(env.pubInput({ outcome: fabricated }));
  const failed = deniedOf(result);
  assert.equal(failed.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failed.code, 'outcome.context-not-genuine');
  assert.equal(publicationRecords(env).length, 0, 'no durable write from a forged context');
});

// ─── SIR-WP13-DUR-S3-003: corrupt candidates fail closed ────────────────────

test('WP-13C precondition: a wrong-class-marker outcome entry fails closed (never skipped)', () => {
  const env = makeS3Env();
  env.seedRawOutcome({
    record_type: 'ResultPublicationRecord',
    record_id: nextRecordId(),
    created_at: FIXED_NOW,
  });
  const failed = deniedOf(publishValidatedResult(env.pubInput()));
  assert.equal(failed.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failed.code, 'outcome.invalid');
  assert.equal(publicationRecords(env).length, 0);
});

test('WP-13C precondition: a malformed (schema-invalid) outcome entry fails closed', () => {
  const env = makeS3Env();
  env.seedRawOutcome({ record_type: 'ExecutionOutcomeRecord', record_id: nextRecordId() });
  const failed = deniedOf(publishValidatedResult(env.pubInput()));
  assert.equal(failed.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failed.code, 'outcome.invalid');
  assert.equal(publicationRecords(env).length, 0);
});

test('WP-13C precondition: an unreadable outcome candidate fails closed as state-unverifiable', () => {
  const env = makeS3Env();
  const unreadableStore: import('../../src/outcome/types.js').OutcomeStoreBoundary = {
    publishExactOutcomeRecord() {
      return { ok: true, outcome: 'published' as const, recordId: 'pgw:l:' + '0'.repeat(32), recordDigest: 'sha-256:' + '0'.repeat(64) };
    },
    readLifecyclePayload() {
      return { ok: false, code: 'read-failed' };
    },
    enumerateLifecycleRecords() {
      return { ok: true, recordIds: ['pgw:l:' + '0'.repeat(32)] };
    },
  };
  const genuine = createPublicationOutcomePrecondition(unreadableStore);
  assert.ok(genuine !== undefined);
  const failed = deniedOf(publishValidatedResult(env.pubInput({ outcome: genuine })));
  assert.equal(failed.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failed.code, 'outcome.state-unverifiable');
  assert.equal(publicationRecords(env).length, 0);
});

test('WP-13C precondition: one valid + one corrupt outcome never becomes one clean valid outcome', () => {
  const env = makeS3Env();
  env.seedOutcome();
  env.seedRawOutcome({ record_type: 'ResultPublicationRecord', record_id: nextRecordId(), created_at: FIXED_NOW });
  const failed = deniedOf(publishValidatedResult(env.pubInput()));
  assert.equal(failed.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failed.code, 'outcome.invalid');
  assert.equal(publicationRecords(env).length, 0);
  // And a schema-invalid outcome for the SAME attempt alongside a valid one.
  const envB = makeS3Env();
  envB.seedOutcome();
  envB.seedOutcome({ overrides: { record_id: nextRecordId(), responsible_role: 'trusted-validator' } });
  const failedB = deniedOf(publishValidatedResult(envB.pubInput()));
  assert.equal(failedB.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failedB.code, 'outcome.invalid');
  assert.equal(publicationRecords(envB).length, 0);
});

// ─── allowed / denied core (§19) ────────────────────────────────────────────

test('WP-13C precondition: exact outcome + exact ValidationRecord → publication allowed', () => {
  const env = makeS3Env();
  env.seedOutcome();
  const result = publishedOf(publishValidatedResult(env.pubInput()));
  assert.equal(result.outcome, 'published');
  assert.equal(publicationRecords(env).length, 1);
});

test('WP-13C precondition: no outcome → denied before any publication write', () => {
  const env = makeS3Env();
  const failed = deniedOf(publishValidatedResult(env.pubInput()));
  assert.equal(failed.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failed.code, 'outcome.missing');
  assert.equal(publicationRecords(env).length, 0);
});

test('WP-13C precondition: multiple outcomes → denied', () => {
  const env = makeS3Env();
  env.seedOutcome();
  env.seedOutcome();
  const failed = deniedOf(publishValidatedResult(env.pubInput()));
  assert.equal(failed.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failed.code, 'outcome.multiple');
  assert.equal(publicationRecords(env).length, 0);
});

test('WP-13C precondition: outcome without result association → denied', () => {
  const env = makeS3Env();
  env.seedOutcome({ withAssociation: false });
  const failed = deniedOf(publishValidatedResult(env.pubInput()));
  assert.equal(failed.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failed.code, 'outcome.association-missing');
  assert.equal(publicationRecords(env).length, 0);
});

test('WP-13C precondition: outcome record that is not schema-valid → denied', () => {
  const env = makeS3Env();
  env.seedOutcome({ overrides: { responsible_role: 'trusted-validator' } });
  const failed = deniedOf(publishValidatedResult(env.pubInput()));
  assert.equal(failed.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failed.code, 'outcome.invalid');
  assert.equal(publicationRecords(env).length, 0);
});

test('WP-13C precondition: result-instance mismatch → denied', () => {
  const env = makeS3Env();
  env.seedOutcome();
  const variant = { ...env.handoff, resultInstanceId: 'pgw:i:' + 'd'.repeat(32), resultRevisionId: 'pgw:r:' + 'e'.repeat(32), resultDigest: 'sha-256:' + 'f'.repeat(64), validationRecordId: nextRecordId() };
  seedResultValidation(env, variant, variant.validationRecordId);
  const failed = deniedOf(publishValidatedResult(env.pubInput({ handoff: variant })));
  assert.equal(failed.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failed.code, 'outcome.mismatch.instance');
  assert.equal(publicationRecords(env).length, 0);
});

test('WP-13C precondition: result revision-digest mismatch → denied', () => {
  const env = makeS3Env();
  env.seedOutcome();
  const variant = { ...env.handoff, resultDigest: 'sha-256:' + 'f'.repeat(64), validationRecordId: nextRecordId() };
  seedResultValidation(env, variant, variant.validationRecordId);
  const failed = deniedOf(publishValidatedResult(env.pubInput({ handoff: variant })));
  assert.equal(failed.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failed.code, 'outcome.mismatch.digest');
  assert.equal(publicationRecords(env).length, 0);
});

test('WP-13C precondition: association-mode mismatch → denied', () => {
  const env = makeS3Env();
  env.seedOutcome();
  const variant = { ...env.handoff, associationMode: (env.handoff.associationMode === 'originated' ? 'adopted' : 'originated') as 'originated' | 'adopted', validationRecordId: nextRecordId() };
  seedResultValidation(env, variant, variant.validationRecordId);
  const failed = deniedOf(publishValidatedResult(env.pubInput({ handoff: variant })));
  assert.equal(failed.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failed.code, 'outcome.mismatch.mode');
  assert.equal(publicationRecords(env).length, 0);
});

test('WP-13C precondition: ValidationRecord-id mismatch → denied', () => {
  const env = makeS3Env();
  env.seedOutcome();
  const variant = { ...env.handoff, validationRecordId: nextRecordId() };
  seedResultValidation(env, variant, variant.validationRecordId);
  const failed = deniedOf(publishValidatedResult(env.pubInput({ handoff: variant })));
  assert.equal(failed.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failed.code, 'outcome.mismatch.validation');
  assert.equal(publicationRecords(env).length, 0);
});

test('WP-13C precondition: mismatched workspace/bundle/occurrence/attempt bindings are denied', () => {
  // Each variant handoff points at a different attempt scope; the
  // attempt-scoped outcome lookup finds no matching outcome record, so the
  // publication fails closed before any write (the divergent key dimension
  // is part of the exact attempt coordination key).
  const ws = makeS3Env();
  ws.seedOutcome();
  const wsVariant = { ...ws.handoff, workspaceId: 'pgw:w:' + 'e'.repeat(32), bundleReference: { ...ws.handoff.bundleReference, target_workspace_binding: { mode: 'bound', workspace_id: 'pgw:w:' + 'e'.repeat(32) } } };
  assert.equal(publishValidatedResult(ws.pubInput({ handoff: wsVariant })).ok, false);
  const bundle = makeS3Env();
  bundle.seedOutcome();
  const bundleVariant = { ...bundle.handoff, bundleReference: { ...bundle.handoff.bundleReference, target_instance_id: 'pgw:i:' + 'd'.repeat(32) } };
  assert.equal(publishValidatedResult(bundle.pubInput({ handoff: bundleVariant })).ok, false);
  const occ = makeS3Env();
  occ.seedOutcome();
  const occVariant = { ...occ.handoff, occurrenceId: 'pgw:o:' + 'b'.repeat(32) };
  assert.equal(publishValidatedResult(occ.pubInput({ handoff: occVariant })).ok, false);
  const att = makeS3Env();
  att.seedOutcome();
  const attVariant = { ...att.handoff, attemptId: 'pgw:a:' + '9'.repeat(32) };
  assert.equal(publishValidatedResult(att.pubInput({ handoff: attVariant })).ok, false);
  assert.equal(ws.outcomeRecords().length, 1);
  assert.equal(publicationRecords(ws).length, 0);
  assert.equal(publicationRecords(bundle).length, 0);
  assert.equal(publicationRecords(occ).length, 0);
  assert.equal(publicationRecords(att).length, 0);
});

test('WP-13C precondition: ValidationRecord absent → denied', () => {
  const env = makeS3Env();
  const V2 = nextRecordId();
  // The outcome association matches the variant handoff; the durable
  // ValidationRecord itself is missing, so the independent re-read denies.
  env.seedOutcome({
    overrides: {
      result_association: {
        instance_id: env.handoff.resultInstanceId,
        revision_digest: env.handoff.resultDigest,
        association_mode: env.handoff.associationMode,
        validation_record_id: V2,
      },
    },
  });
  const failed = deniedOf(publishValidatedResult(env.pubInput({ handoff: { ...env.handoff, validationRecordId: V2 } })));
  assert.equal(failed.category, 'PUBLICATION-LIFECYCLE-REJECTED');
  assert.equal(failed.code, 'lifecycle.validation-record-missing');
  assert.equal(publicationRecords(env).length, 0);
});

test('WP-13C precondition: ValidationRecord wrong subject/digest/workspace → denied', () => {
  const env = makeS3Env();
  const V2 = nextRecordId();
  env.seedOutcome({
    overrides: {
      result_association: {
        instance_id: env.handoff.resultInstanceId,
        revision_digest: env.handoff.resultDigest,
        association_mode: env.handoff.associationMode,
        validation_record_id: V2,
      },
    },
  });
  // Wrong digest for the exact result subject.
  seedPayload(env.store, 'validation-record', buildValidationRecordPayload({
    recordId: V2,
    createdAt: FIXED_NOW,
    subject: {
      protocolId: 'project-gateway.artifact',
      protocolVersion: '1.0',
      kindId: 'ExecutionResult' as never,
      kindVersion: '1.0',
      instanceId: env.handoff.resultInstanceId,
      revisionId: env.handoff.resultRevisionId,
      digest: 'sha-256:' + '0'.repeat(64),
      workspaceId: env.handoff.workspaceId,
    },
    registry: env.registryCtx,
  }));
  const failed = deniedOf(publishValidatedResult(env.pubInput({ handoff: { ...env.handoff, validationRecordId: V2 } })));
  assert.equal(failed.category, 'PUBLICATION-LIFECYCLE-REJECTED');
  assert.equal(failed.code, 'lifecycle.validation-record-mismatch');
  assert.equal(publicationRecords(env).length, 0);
});

// ─── replay compatibility (§13) ─────────────────────────────────────────────

test('WP-13C precondition: existing publication replay with correct outcome is idempotent', () => {
  const env = makeS3Env();
  env.seedOutcome();
  const first = publishedOf(publishValidatedResult(env.pubInput()));
  assert.equal(first.outcome, 'published');
  const second = publishedOf(publishValidatedResult(env.pubInput()));
  assert.equal(second.outcome, 'idempotent-replay');
  assert.equal(second.recordId, first.recordId);
  assert.equal(publicationRecords(env).length, 1);
});

test('WP-13C precondition: an existing publication never bypasses outcome consistency (divergent outcome → denied)', () => {
  const env = makeS3Env();
  env.seedOutcome();
  publishedOf(publishValidatedResult(env.pubInput()));
  // A divergent publication request for the SAME attempt: the single seeded
  // outcome association does not exact-match → denied before the existing
  // publication's idempotent semantics could apply.
  const variant = { ...env.handoff, resultInstanceId: 'pgw:i:' + 'd'.repeat(32), resultRevisionId: 'pgw:r:' + 'e'.repeat(32), resultDigest: 'sha-256:' + 'f'.repeat(64), validationRecordId: nextRecordId() };
  seedResultValidation(env, variant, variant.validationRecordId);
  const failed = deniedOf(publishValidatedResult(env.pubInput({ handoff: variant })));
  assert.equal(failed.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failed.code, 'outcome.mismatch.instance');
  assert.equal(publicationRecords(env).length, 1, 'the existing durable publication is untouched');
});

test('WP-13C precondition: conflicting outcome/publication durable state fails closed (multiple outcomes)', () => {
  const env = makeS3Env();
  env.seedOutcome();
  publishedOf(publishValidatedResult(env.pubInput()));
  // A second outcome record for the same attempt appears later: the
  // precondition now sees multiple outcomes and denies — the existing
  // publication is never silently preferred.
  env.seedOutcome({ overrides: { record_id: nextRecordId() } });
  const failed = deniedOf(publishValidatedResult(env.pubInput()));
  assert.equal(failed.category, 'PUBLICATION-OUTCOME-REJECTED');
  assert.equal(failed.code, 'outcome.multiple');
  assert.equal(publicationRecords(env).length, 1);
});
