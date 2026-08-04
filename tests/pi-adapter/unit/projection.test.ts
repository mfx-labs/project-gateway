/**
 * WP-5A unit tests: input and bundle correlation, TaskSpec projection, and
 * authority separation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSchemaRegistry,
  validateArtifactSelf,
  type EligibilityReport,
  type ValidatedArtifact,
} from '../../../src/index.js';
import { projectExecutionBundleToPi } from '../../../src/adapters/pi/projection.js';
import { isPiInvocationPlan } from '../../../src/adapters/pi/index.js';
import {
  ATTEMPT_ID,
  OCCURRENCE_ID,
  READ_USE,
  buildWorld,
  cloneModel,
  corpusArtifactSet,
  customArtifact,
} from '../helpers.js';
import { buildWorldWith } from '../helpers/world.js';

const reg = createSchemaRegistry();

// ---------------------------------------------------------------------------
// A. input and bundle correlation
// ---------------------------------------------------------------------------
test('A: valid for-use bundle accepted as projection-ready', () => {
  const world = buildWorld();
  const result = projectExecutionBundleToPi(world.input());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.plan.status, 'projection-ready');
    assert.equal(result.plan.piGuardEnforcementPending, true);
    assert.equal(result.plan.occurrenceId, OCCURRENCE_ID);
    assert.equal(result.plan.attemptId, ATTEMPT_ID);
    assert.equal(isPiInvocationPlan(result.plan), true);
    assert.ok(result.plan.renderedPrompt.includes('[PGW-TASK]'));
    assert.ok(result.plan.renderedPrompt.includes('[PGW-CONTEXT-DATA]'));
    assert.ok(result.plan.renderedPrompt.includes('[PGW-COMPLETION-CRITERIA]'));
    assert.ok(result.plan.renderedPrompt.includes('[PGW-CORRELATION]'));
  }
});

test('A: raw artifact JSON is rejected', () => {
  const world = buildWorld();
  const raw = cloneModel(world.set.bundle);
  const result = projectExecutionBundleToPi(world.input({ bundle: raw as unknown as ValidatedArtifact }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'input.unvalidated'));
});

test('A: self-validated artifact is rejected', () => {
  const world = buildWorld();
  const selfBundle = validateArtifactSelf(world.set.bundle, reg).value!;
  assert.equal(selfBundle.level, 'self-semantic-valid');
  const result = projectExecutionBundleToPi(world.input({ bundle: selfBundle }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'input.level-insufficient'));
});

test('A: failed point-of-use evidence is rejected', () => {
  const world = buildWorld();
  const failed = { ...world.eligibility, eligible: false } as EligibilityReport;
  const result = projectExecutionBundleToPi(world.input({ eligibility: failed }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'input.eligibility-failed'));
});

test('A: point-of-use evidence for a different bundle is rejected', () => {
  const world = buildWorld();
  const other = { ...world.eligibility, subjectCorrelations: { ...world.eligibility.subjectCorrelations, bundleInstance: 'pgw:i:' + '9'.repeat(32) } } as EligibilityReport;
  const result = projectExecutionBundleToPi(world.input({ eligibility: other }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'input.eligibility-correlation'));
});

test('A: wrong TaskSpec reference is rejected', () => {
  const world = buildWorld();
  // a genuinely different TaskSpec subject (new revision identity)
  const base = corpusArtifactSet();
  const otherTask = customArtifact(cloneModel(base.task), (m) => {
    (m['revision'] as Record<string, unknown>)['id'] = 'pgw:r:' + '7'.repeat(32);
  });
  const otherWorld = buildWorldWith({ ...base, task: otherTask }, 'task');
  assert.notEqual(otherWorld.task.revisionId, world.task.revisionId);
  const result = projectExecutionBundleToPi(world.input({ taskSpec: otherWorld.task }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'bundle.member-mismatch'));
});

test('A: wrong ContextManifest reference is rejected', () => {
  const world = buildWorld();
  const base = corpusArtifactSet();
  const otherContext = customArtifact(cloneModel(base.context), (m) => {
    (m['revision'] as Record<string, unknown>)['id'] = 'pgw:r:' + '7'.repeat(32);
  });
  const otherWorld = buildWorldWith({ ...base, context: otherContext }, 'context');
  const result = projectExecutionBundleToPi(world.input({ contextManifest: otherWorld.context }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'bundle.member-mismatch'));
});

test('A: wrong CompletionContract reference is rejected', () => {
  const world = buildWorld();
  const base = corpusArtifactSet();
  const otherContract = customArtifact(cloneModel(base.completion), (m) => {
    (m['revision'] as Record<string, unknown>)['id'] = 'pgw:r:' + '7'.repeat(32);
  });
  const otherWorld = buildWorldWith({ ...base, completion: otherContract }, 'completion');
  const result = projectExecutionBundleToPi(world.input({ completionContract: otherWorld.completion }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'bundle.member-mismatch'));
});

test('A: wrong AuthorityPolicy reference is rejected', () => {
  const world = buildWorld();
  const base = corpusArtifactSet();
  const otherPolicy = customArtifact(cloneModel(base.policy), (m) => {
    (m['revision'] as Record<string, unknown>)['id'] = 'pgw:r:' + '7'.repeat(32);
  });
  const otherWorld = buildWorldWith({ ...base, policy: otherPolicy }, 'policy');
  const result = projectExecutionBundleToPi(world.input({ authorityPolicy: otherWorld.policy }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'bundle.member-mismatch'));
});

test('A: occurrence mismatch is rejected', () => {
  const world = buildWorld();
  const result = projectExecutionBundleToPi(world.input({ occurrenceId: '' }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'input.occurrence-missing'));
});

test('A: attempt mismatch is rejected', () => {
  const world = buildWorld();
  const result = projectExecutionBundleToPi(world.input({ attemptId: '' }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'input.attempt-missing'));
});

test('A: workspace mismatch is rejected via eligibility correlation', () => {
  const world = buildWorld();
  const result = projectExecutionBundleToPi(world.input({ requestedUse: { ...READ_USE, workspaceId: 'pgw:w:' + '2'.repeat(32) } }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'input.eligibility-correlation'));
});

test('A: member below registry-compatible level is rejected', () => {
  const world = buildWorld();
  const selfTask = validateArtifactSelf(world.set.task, reg).value!;
  const result = projectExecutionBundleToPi(world.input({ taskSpec: selfTask }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'input.level-insufficient'));
});

// ---------------------------------------------------------------------------
// B. task projection
// ---------------------------------------------------------------------------
test('B: task text comes only from TaskSpec', () => {
  const world = buildWorld();
  const result = projectExecutionBundleToPi(world.input());
  assert.equal(result.ok, true);
  if (result.ok) {
    const body = world.set.task['body'] as Record<string, unknown>;
    assert.ok(result.plan.renderedPrompt.includes(String(body['objective'])));
    const instructions = body['instructions'] as { instruction_id: string; text: string }[];
    for (const instruction of instructions) {
      assert.ok(result.plan.renderedPrompt.includes(instruction.text), `missing instruction ${instruction.instruction_id}`);
    }
  }
});

test('B: TaskSpec order is preserved', () => {
  const base = corpusArtifactSet();
  const task = customArtifact(cloneModel(base.task), (m) => {
    (m['body'] as Record<string, unknown>)['instructions'] = [
      { instruction_id: 'first', text: 'first instruction' },
      { instruction_id: 'second', text: 'second instruction' },
    ];
  });
  const world = buildWorldWith({ ...base, task }, 'task');
  const result = projectExecutionBundleToPi(world.input());
  assert.equal(result.ok, true);
  if (result.ok) {
    const prompt = result.plan.renderedPrompt;
    assert.ok(prompt.indexOf('first instruction') < prompt.indexOf('second instruction'));
  }
});

test('B: unsupported required task semantic fails closed', () => {
  const base = corpusArtifactSet();
  const task = customArtifact(cloneModel(base.task), (m) => {
    m['requirements'] = {
      protocol_features: [{ class: 'protocol-feature', id: 'project-gateway.conformance-fixture', version: '1.0' }],
      consumer_capabilities: [],
    };
  });
  const world = buildWorldWith({ ...base, task }, 'task');
  // the world consumer supports the feature (registry-compatible passes), but
  // the Pi host capability does not declare it → fail closed
  const capability = { ...world.capability, requiredFeatures: world.capability.requiredFeatures.filter((f) => f !== 'project-gateway.conformance-fixture') };
  const result = projectExecutionBundleToPi(world.input({ capability }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'semantic.feature-unsupported'));
});

test('B: deterministic rendering (equal inputs, byte-equivalent plans)', () => {
  const world = buildWorld();
  const a = projectExecutionBundleToPi(world.input());
  const b = projectExecutionBundleToPi(world.input());
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (a.ok && b.ok) {
    assert.equal(a.plan.renderedPrompt, b.plan.renderedPrompt);
    assert.deepEqual(a.plan, b.plan);
  }
});

test('B: no AuthorityPolicy content appears as task instruction', () => {
  const world = buildWorld();
  const result = projectExecutionBundleToPi(world.input());
  assert.equal(result.ok, true);
  if (result.ok) {
    const policyBody = world.set.policy['body'] as Record<string, unknown>;
    const ruleText = JSON.stringify(policyBody['rules']);
    assert.ok(!result.plan.renderedPrompt.includes(ruleText), 'AuthorityPolicy rules leaked into the prompt');
  }
});

test('B: no ContextManifest content appears as task instruction', () => {
  const world = buildWorld();
  const result = projectExecutionBundleToPi(world.input());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(!result.plan.taskSection.includes('context_id'));
    assert.ok(!result.plan.taskSection.includes('selection_mode'));
  }
});

// ---------------------------------------------------------------------------
// E. authority separation (plan-level)
// ---------------------------------------------------------------------------
test('E: plan status is projection-ready and never authority-flavored', () => {
  const world = buildWorld();
  const result = projectExecutionBundleToPi(world.input());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.plan.status, 'projection-ready');
    for (const forbidden of ['authorized', 'approved', 'activated', 'executable', 'granted']) {
      assert.ok(!result.plan.renderedPrompt.toLowerCase().includes(forbidden), `prompt contains ${forbidden}`);
    }
  }
});

test('E: plan explicitly states pi-guard enforcement is pending', () => {
  const world = buildWorld();
  const result = projectExecutionBundleToPi(world.input());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.plan.piGuardEnforcementPending, true);
    assert.ok(result.plan.renderedPrompt.includes('pi-guard authority enforcement has not been applied'));
    assert.ok(result.plan.correlationFooter.includes('pi_guard_enforcement: pending'));
  }
});

test('E: AuthorityPolicy is correlated but not rendered as executable instructions', () => {
  const world = buildWorld();
  const result = projectExecutionBundleToPi(world.input());
  assert.equal(result.ok, true);
  if (result.ok) {
    const correlation = result.plan.subjectCorrelations.find((c) => c.role === 'authority-policy');
    assert.ok(correlation);
    assert.equal(correlation.digest, world.policy.digest);
    assert.ok(!result.plan.renderedPrompt.includes('allowed to use'), 'plan grants tool permission');
  }
});
