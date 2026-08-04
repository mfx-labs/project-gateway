/**
 * WP-5A unit tests: CompletionContract projection (group D) and authority
 * separation (group E).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectExecutionBundleToPi } from '../../../src/adapters/pi/projection.js';
import { completionCriteriaFromContract, renderCompletionCriteria } from '../../../src/adapters/pi/render.js';
import { buildWorld, cloneModel, corpusArtifactSet, customArtifact } from '../helpers.js';
import { buildWorldWith } from '../helpers/world.js';

function contractWorld() {
  const base = corpusArtifactSet();
  const contract = customArtifact(cloneModel(base.completion), (m) => {
    m['body'] = {
      checks: [
        {
          check_id: 'deliverable-present',
          evaluation_status: 'required',
          check: { type: 'project-gateway.deliverable-presence', version: '1.0', expected_deliverable_ids: ['conformance-note'] },
          required_evidence: [],
          acceptance_conditions: [{ condition_id: 'deliverable-required', type: 'all-identified-deliverables-present' }],
        },
        {
          check_id: 'evidence-present',
          evaluation_status: 'optional',
          check: { type: 'project-gateway.evidence-presence', version: '1.0', required_evidence_kinds: ['workspace-resource-observation'] },
          required_evidence: [{ requirement_id: 'resource-observation', kind: 'workspace-resource-observation' }],
          acceptance_conditions: [{ condition_id: 'evidence-present', type: 'all-required-evidence-present' }],
        },
      ],
    };
  });
  return buildWorldWith({ ...base, completion: contract }, 'completion');
}

test('D: criteria rendered separately', () => {
  const world = contractWorld();
  const result = projectExecutionBundleToPi(world.input());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.plan.completionCriteriaSection.includes('deliverable-present'));
    assert.ok(result.plan.completionCriteriaSection.includes('evidence-present'));
    assert.ok(result.plan.completionCriteriaSection.includes('all-identified-deliverables-present'));
    // criteria are not part of the task section
    assert.ok(!result.plan.taskSection.includes('deliverable-present'));
  }
});

test('D: completion criteria do not create permission', () => {
  const world = contractWorld();
  const result = projectExecutionBundleToPi(world.input());
  assert.equal(result.ok, true);
  if (result.ok) {
    const section = result.plan.completionCriteriaSection.toLowerCase();
    assert.ok(!section.includes('you may'), 'criteria grant permission');
    assert.ok(!section.includes('permitted'), 'criteria grant permission');
    assert.ok(!section.includes('tool'), 'criteria reference tool authority');
  }
});

test('D: no self-approval language', () => {
  const world = contractWorld();
  const result = projectExecutionBundleToPi(world.input());
  assert.equal(result.ok, true);
  if (result.ok) {
    const section = result.plan.completionCriteriaSection.toLowerCase();
    assert.ok(!section.includes('declare yourself complete'));
    assert.ok(!section.includes('approve the result'));
    assert.ok(!section.includes('mark the lifecycle record successful'));
  }
});

test('D: no receipt issuance language', () => {
  const world = contractWorld();
  const result = projectExecutionBundleToPi(world.input());
  assert.equal(result.ok, true);
  if (result.ok) {
    const section = result.plan.completionCriteriaSection.toLowerCase();
    assert.ok(!section.includes('issue the receipt'));
    assert.ok(!section.includes('trusted receipt'));
    assert.ok(!section.includes('self-certify'));
  }
});

test('D: exact CompletionContract reference preserved', () => {
  const world = contractWorld();
  const result = projectExecutionBundleToPi(world.input());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.plan.completionContractReference.target_revision_id, world.completion.revisionId);
    assert.equal(result.plan.completionContractReference.target_digest, world.completion.digest);
    const correlation = result.plan.subjectCorrelations.find((c) => c.role === 'completion-contract');
    assert.equal(correlation?.digest, world.completion.digest);
  }
});

test('D: criteria extraction is deterministic', () => {
  const world = contractWorld();
  const checks = completionCriteriaFromContract(world.completion.model);
  assert.equal(checks.length, 2);
  assert.equal(checks[0]?.checkId, 'deliverable-present');
  assert.deepEqual(checks.map((c) => c.checkId), ['deliverable-present', 'evidence-present']);
  const rendered = renderCompletionCriteria(world.completion.model);
  assert.equal(rendered, renderCompletionCriteria(world.completion.model));
});

test('E: RuntimeGrant content is not interpreted', () => {
  const world = buildWorld();
  const result = projectExecutionBundleToPi(world.input());
  assert.equal(result.ok, true);
  if (result.ok) {
    // no grant semantics anywhere in the plan
    assert.ok(!result.plan.renderedPrompt.includes('attempt_limit'));
    assert.ok(!result.plan.renderedPrompt.includes('narrowed_constraints'));
    assert.ok(!result.plan.renderedPrompt.includes('RuntimeGrant'));
  }
});

test('E: Pi tool inventory cannot expand plan semantics', () => {
  const world = buildWorld();
  const result = projectExecutionBundleToPi(world.input());
  assert.equal(result.ok, true);
  if (result.ok) {
    // the plan contains no tool-permission derivation; inventory is never consulted
    assert.ok(!result.plan.renderedPrompt.includes('getAllTools'));
    assert.ok(!result.plan.renderedPrompt.includes('active tools'));
  }
});

test('E: adapter never emits authority statuses in findings or plan fields', () => {
  const world = buildWorld();
  const result = projectExecutionBundleToPi(world.input({ occurrenceId: '' }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    const serialized = JSON.stringify(result.findings);
    for (const forbidden of ['authorized', 'approved', 'activated', 'executable', 'granted']) {
      assert.ok(!serialized.toLowerCase().includes(forbidden), `findings contain ${forbidden}`);
    }
  }
});
