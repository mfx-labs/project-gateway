/**
 * WP-15 Phase 1A — trustworthy result-less terminal outcome durability.
 *
 * Proves the A1 result-less semantics on the EXISTING
 * `trusted-execution-outcome-recorder` eligibility path (no new authority
 * domain, no second outcome producer): a retrospectively trustworthy
 * terminal attempt receives exactly one `ExecutionOutcomeRecord` even when
 * no `ExecutionResult` exists — `result_association` stays absent, no
 * result is fabricated, exact bindings/replay/conflict behavior is
 * preserved, and the committed dispositions `incomplete` and `rejected`
 * are durable without lossy mapping.
 *
 * result-less != outcome-less: with a durable result-less outcome record
 * the attempt classifies retrospective-complete (shared classifier);
 * without any outcome record it stays terminal-unverifiable.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { validateLifecycleRecord, createSchemaRegistry } from '../../src/api/validate.js';
import { produceExecutionOutcome } from '../../src/outcome-production/index.js';
import { classifyRetrospectiveEligibility } from '../../src/lifecycle/retrospective-eligibility.js';
import { makeS3Env, s3Cleanup, makeOutcome } from './wp13-durability-s3-helpers.js';
import type { OutcomeProductionResult } from '../../src/outcome-production/types.js';

after(s3Cleanup);

const registry = createSchemaRegistry();

function producedOf(result: OutcomeProductionResult): { readonly recordId: string; readonly outcome: 'published' | 'replayed' } {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  return { recordId: result.recordId, outcome: result.outcome };
}

function failedOf(result: OutcomeProductionResult): { readonly category: string; readonly code: string } {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) throw new Error('unreachable');
  return { category: result.category, code: result.code };
}

test('phase1a: result-less terminal outcome with disposition `incomplete` is durable, schema-valid, replay-idempotent', () => {
  const env = makeS3Env();
  const input = () => env.input({ enforcement: undefined, handoff: undefined, validation: undefined, outcome: makeOutcome('incomplete') });
  const produced = producedOf(produceExecutionOutcome(input()));
  assert.equal(produced.outcome, 'published');
  const records = env.outcomeRecords();
  assert.equal(records.length, 1);
  const record = records[0]!;
  const gate = validateLifecycleRecord(record, registry);
  assert.equal(gate.ok, true, JSON.stringify(gate));
  // exact attempt binding + durable disposition, no fabricated result
  assert.equal(record['record_type'], 'ExecutionOutcomeRecord');
  assert.equal(record['responsible_role'], 'trusted-execution-outcome-recorder');
  assert.equal(record['workspace_id'], env.attempt['workspace_id']);
  assert.equal(record['occurrence_id'], env.attempt['occurrence_id']);
  assert.equal(record['attempt_id'], env.attempt['attempt_id']);
  assert.equal(record['ordinal'], 1);
  assert.equal(record['execution_attempt_record_id'], env.attempt['record_id']);
  assert.equal(record['disposition'], 'incomplete');
  assert.equal(record['result_association'], undefined, 'result-less outcome must not fabricate a result association');
  // result-less != outcome-less: the durable outcome makes the attempt retrospective-complete
  assert.equal(classifyRetrospectiveEligibility(env.attempt, env.outcomeRecords()), 'retrospective-complete');
  // exact replay: idempotent, zero writes, no divergence
  const replayed = producedOf(produceExecutionOutcome(input()));
  assert.equal(replayed.outcome, 'replayed');
  assert.equal(replayed.recordId, produced.recordId);
  assert.equal(env.outcomePublishCount(), 1);
  // material divergence (disposition changed) fails closed
  const diverged = produceExecutionOutcome(env.input({ enforcement: undefined, handoff: undefined, validation: undefined, outcome: makeOutcome('completed') }));
  assert.equal(failedOf(diverged).code, 'conflict.material-divergence');
});

test('phase1a: result-less terminal outcome with disposition `rejected` is durable and schema-valid', () => {
  const env = makeS3Env();
  const produced = producedOf(produceExecutionOutcome(env.input({ enforcement: undefined, handoff: undefined, validation: undefined, outcome: makeOutcome('rejected') })));
  assert.equal(produced.outcome, 'published');
  const records = env.outcomeRecords();
  assert.equal(records.length, 1);
  const record = records[0]!;
  const gate = validateLifecycleRecord(record, registry);
  assert.equal(gate.ok, true, JSON.stringify(gate));
  assert.equal(record['disposition'], 'rejected');
  assert.equal(record['result_association'], undefined);
  assert.equal(classifyRetrospectiveEligibility(env.attempt, records), 'retrospective-complete');
  // one exact outcome per attempt: a second divergent production conflicts
  const second = produceExecutionOutcome(env.input({ enforcement: undefined, handoff: undefined, validation: undefined, outcome: makeOutcome('incomplete') }));
  assert.equal(failedOf(second).code, 'conflict.material-divergence');
});

test('phase1a: without any outcome record the same terminal attempt stays terminal-unverifiable', () => {
  const env = makeS3Env();
  // zero durable outcome records -> terminal-unverifiable (no inference from
  // the absence of a result; no receipt eligibility)
  assert.equal(classifyRetrospectiveEligibility(env.attempt, []), 'terminal-unverifiable');
});
