/**
 * W4-F1 focused regression tests: insertion-order-independent protocol
 * equality for workspace bindings, exact artifact references, and bundle
 * references across cross-artifact, lineage, and lifecycle retry evaluation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  workspaceBindingsEqual,
  exactReferencesEqual,
  bundleReferencesEqual,
} from '../../src/internal/protocol-equality.js';
import { evaluateCrossArtifact } from '../../src/bundle/validate.js';
import { evaluateLifecycleGraph } from '../../src/lifecycle/graph.js';

const W = 'pgw:w:cf4339b1f56441936467dea1357dc30e';
const W2 = 'pgw:w:' + '2'.repeat(32);

// ---------------------------------------------------------------------------
// workspace-binding equality
// ---------------------------------------------------------------------------
test('W4-F1: same bound binding, same key order → equal', () => {
  const a = { mode: 'bound', workspace_id: W };
  assert.equal(workspaceBindingsEqual(a, { mode: 'bound', workspace_id: W }), true);
});

test('W4-F1: same bound binding, different key order → equal', () => {
  const a = { mode: 'bound', workspace_id: W };
  const b = { workspace_id: W, mode: 'bound' };
  assert.equal(workspaceBindingsEqual(a, b), true);
});

test('W4-F1: same portable binding, different key order → equal', () => {
  const a = { mode: 'portable' };
  const b = { mode: 'portable' };
  assert.equal(workspaceBindingsEqual(a, b), true);
});

test('W4-F1: bound versus portable → unequal', () => {
  assert.equal(workspaceBindingsEqual({ mode: 'bound', workspace_id: W }, { mode: 'portable' }), false);
  assert.equal(workspaceBindingsEqual({ mode: 'portable' }, { mode: 'bound', workspace_id: W }), false);
});

test('W4-F1: same mode, different workspace ID → unequal', () => {
  assert.equal(workspaceBindingsEqual({ mode: 'bound', workspace_id: W }, { mode: 'bound', workspace_id: W2 }), false);
});

test('W4-F1: structurally invalid binding fails closed', () => {
  // unknown mode
  assert.equal(workspaceBindingsEqual({ mode: 'teleport', workspace_id: W }, { mode: 'teleport', workspace_id: W }), false);
  // bound without workspace_id
  assert.equal(workspaceBindingsEqual({ mode: 'bound' }, { mode: 'bound', workspace_id: W }), false);
  // non-object operands
  assert.equal(workspaceBindingsEqual(null, null), false);
  assert.equal(workspaceBindingsEqual('portable', { mode: 'portable' }), false);
  assert.equal(workspaceBindingsEqual(undefined, undefined), false);
  assert.equal(workspaceBindingsEqual([], []), false);
});

// ---------------------------------------------------------------------------
// exact artifact reference equality
// ---------------------------------------------------------------------------
function ref(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    target_protocol_version: '1.0',
    target_kind: { id: 'TaskSpec', version: '1.0' },
    target_instance_id: 'pgw:i:' + 'a'.repeat(32),
    target_revision_id: 'pgw:r:' + 'b'.repeat(32),
    target_digest: 'sha-256:' + 'c'.repeat(64),
    target_workspace_binding: { mode: 'portable' },
    ...over,
  };
}

test('W4-F1: same reference, different top-level key order → equal', () => {
  const a = ref();
  const b = {
    target_kind: { id: 'TaskSpec', version: '1.0' },
    target_digest: 'sha-256:' + 'c'.repeat(64),
    target_protocol_version: '1.0',
    target_workspace_binding: { mode: 'portable' },
    target_instance_id: 'pgw:i:' + 'a'.repeat(32),
    target_revision_id: 'pgw:r:' + 'b'.repeat(32),
  };
  assert.equal(exactReferencesEqual(a, b), true);
});

test('W4-F1: same reference, reordered nested workspace binding → equal', () => {
  const a = ref({ target_workspace_binding: { mode: 'bound', workspace_id: W } });
  const b = ref({ target_workspace_binding: { workspace_id: W, mode: 'bound' } });
  assert.equal(exactReferencesEqual(a, b), true);
});

test('W4-F1: different protocol version → unequal', () => {
  assert.equal(exactReferencesEqual(ref(), ref({ target_protocol_version: '2.0' })), false);
});

test('W4-F1: different artifact kind → unequal', () => {
  assert.equal(exactReferencesEqual(ref(), ref({ target_kind: { id: 'ExecutionResult', version: '1.0' } })), false);
});

test('W4-F1: different kind version → unequal', () => {
  assert.equal(exactReferencesEqual(ref(), ref({ target_kind: { id: 'TaskSpec', version: '2.0' } })), false);
});

test('W4-F1: different instance ID → unequal', () => {
  assert.equal(exactReferencesEqual(ref(), ref({ target_instance_id: 'pgw:i:' + 'd'.repeat(32) })), false);
});

test('W4-F1: different revision ID → unequal', () => {
  assert.equal(exactReferencesEqual(ref(), ref({ target_revision_id: 'pgw:r:' + 'e'.repeat(32) })), false);
});

test('W4-F1: different digest → unequal', () => {
  assert.equal(exactReferencesEqual(ref(), ref({ target_digest: 'sha-256:' + 'f'.repeat(64) })), false);
});

test('W4-F1: different workspace-binding mode → unequal', () => {
  assert.equal(exactReferencesEqual(ref(), ref({ target_workspace_binding: { mode: 'bound', workspace_id: W } })), false);
});

test('W4-F1: different workspace ID → unequal', () => {
  const a = ref({ target_workspace_binding: { mode: 'bound', workspace_id: W } });
  const b = ref({ target_workspace_binding: { mode: 'bound', workspace_id: W2 } });
  assert.equal(exactReferencesEqual(a, b), false);
});

test('W4-F1: bundle reference equality is exact-reference equality', () => {
  const a = ref({ target_kind: { id: 'ExecutionBundle', version: '1.0' }, target_workspace_binding: { mode: 'bound', workspace_id: W } });
  const b = {
    target_workspace_binding: { workspace_id: W, mode: 'bound' },
    target_digest: 'sha-256:' + 'c'.repeat(64),
    target_kind: { id: 'ExecutionBundle', version: '1.0' },
    target_instance_id: 'pgw:i:' + 'a'.repeat(32),
    target_protocol_version: '1.0',
    target_revision_id: 'pgw:r:' + 'b'.repeat(32),
  };
  assert.equal(bundleReferencesEqual(a, b), true);
  const changed = { ...b, target_digest: 'sha-256:' + 'f'.repeat(64) };
  assert.equal(bundleReferencesEqual(a, changed), false);
});

// ---------------------------------------------------------------------------
// cross-artifact validation (bundle member binding + lineage continuity)
// ---------------------------------------------------------------------------
function crossArtifactModel(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    instance_id: 'pgw:i:' + 'a'.repeat(32),
    workspace_binding: { mode: 'bound', workspace_id: W },
    body: {
      task: ref({
        target_kind: { id: 'TaskSpec', version: '1.0' },
        target_workspace_binding: { workspace_id: W, mode: 'bound' }, // reordered
      }),
    },
    ...over,
  };
}

test('W4-F1: semantically equal reordered member binding produces no REF/WSP finding', () => {
  const model = crossArtifactModel();
  const target = {
    instance_id: 'pgw:i:' + '9'.repeat(32),
    workspace_binding: { mode: 'bound', workspace_id: W }, // different insertion order
  };
  const findings = evaluateCrossArtifact({
    kind: 'ExecutionBundle',
    model,
    subjectIdentity: 'pgw:i:' + 'a'.repeat(32),
    resolveTarget: () => target,
  });
  assert.deepEqual(findings.map((f) => f.messageKey), []);
});

test('W4-F1: genuine binding mismatch still produces expected REF/WSP findings', () => {
  const model = crossArtifactModel();
  const target = {
    instance_id: 'pgw:i:' + '9'.repeat(32),
    workspace_binding: { mode: 'bound', workspace_id: W2 },
  };
  const findings = evaluateCrossArtifact({
    kind: 'ExecutionBundle',
    model,
    subjectIdentity: 'pgw:i:' + 'a'.repeat(32),
    resolveTarget: () => target,
  });
  assert.ok(findings.some((f) => f.messageKey === 'workspace.reference-binding'));
  assert.ok(findings.some((f) => f.ruleIds.includes('REF-005')));
  assert.ok(findings.some((f) => f.ruleIds.includes('WSP-003')));
});

test('W4-F1: semantically equal reordered lineage binding produces no LIN/MIG finding', () => {
  const model = crossArtifactModel({
    kind: undefined,
    body: undefined,
    revision: {
      id: 'pgw:r:' + 'b'.repeat(32),
      predecessor: {
        target_protocol_version: '1.0',
        target_kind: { id: 'TaskSpec', version: '1.0' },
        target_instance_id: 'pgw:i:' + 'a'.repeat(32),
        target_revision_id: 'pgw:r:' + '0'.repeat(32),
        target_digest: 'sha-256:' + 'c'.repeat(64),
        target_workspace_binding: { workspace_id: W, mode: 'bound' }, // reordered
      },
    },
  });
  const findings = evaluateCrossArtifact({
    kind: 'TaskSpec',
    model,
    subjectIdentity: 'pgw:i:' + 'a'.repeat(32),
    resolveTarget: () => undefined,
  });
  assert.ok(!findings.some((f) => f.ruleIds.includes('LIN-007')));
  assert.ok(!findings.some((f) => f.ruleIds.includes('MIG-001')));
});

test('W4-F1: genuine lineage binding change still produces expected LIN/MIG findings', () => {
  const model = crossArtifactModel({
    body: undefined,
    revision: {
      id: 'pgw:r:' + 'b'.repeat(32),
      predecessor: {
        target_protocol_version: '1.0',
        target_kind: { id: 'TaskSpec', version: '1.0' },
        target_instance_id: 'pgw:i:' + 'a'.repeat(32),
        target_revision_id: 'pgw:r:' + '0'.repeat(32),
        target_digest: 'sha-256:' + 'c'.repeat(64),
        target_workspace_binding: { mode: 'bound', workspace_id: W2 },
      },
    },
  });
  const findings = evaluateCrossArtifact({
    kind: 'TaskSpec',
    model,
    subjectIdentity: 'pgw:i:' + 'a'.repeat(32),
    resolveTarget: () => undefined,
  });
  assert.ok(findings.some((f) => f.ruleIds.includes('LIN-007')));
  assert.ok(findings.some((f) => f.ruleIds.includes('MIG-001')));
});

// ---------------------------------------------------------------------------
// lifecycle retry stability (evaluateLifecycleGraph)
// ---------------------------------------------------------------------------
function bundleRef(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    target_protocol_version: '1.0',
    target_kind: { id: 'ExecutionBundle', version: '1.0' },
    target_instance_id: 'pgw:i:' + 'e'.repeat(32),
    target_revision_id: 'pgw:r:' + 'f'.repeat(32),
    target_digest: 'sha-256:' + '0'.repeat(64),
    target_workspace_binding: { mode: 'bound', workspace_id: W },
    ...over,
  };
}

function retryRecords(retryBundle: Record<string, unknown>): Record<string, unknown>[] {
  const activation = {
    record_type: 'ActivationRecord',
    record_id: 'pgw:l:act-1',
    decision: 'accepted',
    reserved_occurrence_id: 'pgw:o:occ-1',
    runtime_grant_id: 'pgw:l:grant-1',
    bundle: bundleRef(),
  };
  const occurrence = {
    record_type: 'ExecutionOccurrenceRecord',
    record_id: 'pgw:l:occ-1',
    occurrence_id: 'pgw:o:occ-1',
    activation_record_id: 'pgw:l:act-1',
    bundle: bundleRef(),
    workspace_id: W,
    runtime_grant_id: 'pgw:l:grant-1',
  };
  const first = {
    record_type: 'ExecutionAttemptRecord',
    record_id: 'pgw:l:att-1',
    attempt_id: 'pgw:a:1',
    ordinal: 1,
    occurrence_id: 'pgw:o:occ-1',
    activation_record_id: 'pgw:l:act-1',
    bundle: bundleRef(), // baseline order
    workspace_id: W,
    runtime_grant_id: 'pgw:l:grant-1',
  };
  const retry = {
    record_type: 'ExecutionAttemptRecord',
    record_id: 'pgw:l:att-2',
    attempt_id: 'pgw:a:2',
    ordinal: 2,
    occurrence_id: 'pgw:o:occ-1',
    activation_record_id: 'pgw:l:act-1',
    bundle: retryBundle,
    workspace_id: W,
    runtime_grant_id: 'pgw:l:grant-1',
  };
  const grant = {
    record_type: 'RuntimeGrant',
    record_id: 'pgw:l:grant-1',
    attempt_limit: 2,
    reserved_occurrence_id: 'pgw:o:occ-1',
    bundle: bundleRef(),
    workspace_id: W,
  };
  const receipts = [
    { record_type: 'TrustedReceipt', record_id: 'pgw:l:rec-1', attempt_id: 'pgw:a:1', event_record_id: 'pgw:l:att-1' },
    { record_type: 'TrustedReceipt', record_id: 'pgw:l:rec-2', attempt_id: 'pgw:a:2', event_record_id: 'pgw:l:att-2' },
  ];
  return [activation, occurrence, first, retry, grant, ...receipts];
}

function retryFindings(records: Record<string, unknown>[]): { messageKey: string; ruleIds: readonly string[] }[] {
  const findings = evaluateLifecycleGraph({
    records,
    entryRecordIds: new Set(['pgw:l:att-2']),
    registry: {} as never,
    artifactsByRevision: new Map(),
    artifactsByInstance: new Map(),
    resultsByAttempt: new Map(),
    entryArtifactInstances: new Set(),
    attemptsContext: records.filter((r) => r['record_type'] === 'ExecutionAttemptRecord'),
  });
  return findings.map((f) => ({ messageKey: f.messageKey, ruleIds: f.ruleIds }));
}

test('W4-F1: same bundle reference with reordered top-level fields → accepted', () => {
  const reordered = {
    target_workspace_binding: { workspace_id: W, mode: 'bound' },
    target_digest: 'sha-256:' + '0'.repeat(64),
    target_kind: { version: '1.0', id: 'ExecutionBundle' },
    target_instance_id: 'pgw:i:' + 'e'.repeat(32),
    target_protocol_version: '1.0',
    target_revision_id: 'pgw:r:' + 'f'.repeat(32),
  };
  const findings = retryFindings(retryRecords(reordered));
  assert.ok(!findings.some((f) => f.ruleIds.includes('EXE-006')), JSON.stringify(findings));
});

test('W4-F1: same bundle reference with reordered nested binding → accepted', () => {
  const reordered = bundleRef({ target_workspace_binding: { workspace_id: W, mode: 'bound' } });
  const findings = retryFindings(retryRecords(reordered));
  assert.ok(!findings.some((f) => f.ruleIds.includes('EXE-006')), JSON.stringify(findings));
});

test('W4-F1: different bundle digest → retry-substitution finding', () => {
  const changed = bundleRef({ target_digest: 'sha-256:' + '1'.repeat(64) });
  const findings = retryFindings(retryRecords(changed));
  assert.ok(findings.some((f) => f.ruleIds.includes('EXE-006')), JSON.stringify(findings));
});

test('W4-F1: different bundle revision → retry-substitution finding', () => {
  const changed = bundleRef({ target_revision_id: 'pgw:r:' + '9'.repeat(32) });
  const findings = retryFindings(retryRecords(changed));
  assert.ok(findings.some((f) => f.ruleIds.includes('EXE-006')), JSON.stringify(findings));
});

test('W4-F1: different bundle workspace → retry-substitution finding', () => {
  const changed = bundleRef({ target_workspace_binding: { mode: 'bound', workspace_id: W2 } });
  const findings = retryFindings(retryRecords(changed));
  assert.ok(findings.some((f) => f.ruleIds.includes('EXE-006')), JSON.stringify(findings));
});

test('W4-F1: retry substitution failure keeps the approved category and rule', () => {
  const changed = bundleRef({ target_digest: 'sha-256:' + '2'.repeat(64) });
  const findings = retryFindings(retryRecords(changed));
  const exe6 = findings.find((f) => f.ruleIds.includes('EXE-006'));
  assert.ok(exe6);
  assert.equal(exe6.messageKey, 'lifecycle.retry-substitution');
});

// ---------------------------------------------------------------------------
// comparator safety properties
// ---------------------------------------------------------------------------
test('W4-F1: no ordinary JSON.stringify remains in protocol equality decisions', () => {
  const files = [
    'src/bundle/validate.ts',
    'src/lifecycle/graph.ts',
    'src/references/validate.ts',
    'src/engine/identity.ts',
    'src/internal/protocol-equality.ts',
  ];
  for (const rel of files) {
    const src = readFileSync(new URL('../../../' + rel, import.meta.url), 'utf8');
    assert.ok(!src.includes('JSON.stringify('), `${rel} still uses JSON.stringify in equality`);
  }
});

test('W4-F1: comparator behavior is deterministic', () => {
  const a = { mode: 'bound', workspace_id: W };
  const b = { workspace_id: W, mode: 'bound' };
  assert.equal(workspaceBindingsEqual(a, b), workspaceBindingsEqual(a, b));
  const r1 = ref({ target_workspace_binding: { workspace_id: W, mode: 'bound' } });
  const r2 = ref({ target_workspace_binding: { mode: 'bound', workspace_id: W } });
  assert.equal(exactReferencesEqual(r1, r2), exactReferencesEqual(r1, r2));
});

test('W4-F1: comparator does not mutate either operand', () => {
  const a = Object.freeze({ mode: 'bound', workspace_id: W });
  const b = Object.freeze({ workspace_id: W, mode: 'bound' });
  assert.equal(workspaceBindingsEqual(a, b), true);
  const r1 = Object.freeze(ref({ target_workspace_binding: Object.freeze({ workspace_id: W, mode: 'bound' }) }));
  const r2 = Object.freeze(ref({ target_workspace_binding: Object.freeze({ mode: 'bound', workspace_id: W }) }));
  assert.equal(exactReferencesEqual(r1, r2), true);
  // frozen operands are byte-identical afterwards
  assert.deepEqual({ ...a }, { mode: 'bound', workspace_id: W });
  assert.deepEqual({ ...r1 }, ref({ target_workspace_binding: { workspace_id: W, mode: 'bound' } }));
});

test('W4-F1: comparator handles null-prototype JSON objects', () => {
  const plain = Object.create(null) as Record<string, unknown>;
  plain['mode'] = 'bound';
  plain['workspace_id'] = W;
  assert.equal(workspaceBindingsEqual(plain, { workspace_id: W, mode: 'bound' }), true);
  assert.equal(workspaceBindingsEqual(plain, { mode: 'portable' }), false);
  const refPlain = Object.create(null) as Record<string, unknown>;
  const kind = Object.create(null) as Record<string, unknown>;
  kind['id'] = 'TaskSpec';
  kind['version'] = '1.0';
  refPlain['target_protocol_version'] = '1.0';
  refPlain['target_kind'] = kind;
  refPlain['target_instance_id'] = 'pgw:i:' + 'a'.repeat(32);
  refPlain['target_revision_id'] = 'pgw:r:' + 'b'.repeat(32);
  refPlain['target_digest'] = 'sha-256:' + 'c'.repeat(64);
  const portable = Object.create(null) as Record<string, unknown>;
  portable['mode'] = 'portable';
  refPlain['target_workspace_binding'] = portable;
  assert.equal(exactReferencesEqual(refPlain, ref()), true);
});

test('W4-F1: comparator does not invoke getters or inherited properties', () => {
  let calls = 0;
  const withGetter = { mode: 'bound' } as Record<string, unknown>;
  Object.defineProperty(withGetter, 'workspace_id', {
    enumerable: true,
    get() {
      calls++;
      return W;
    },
  });
  // accessors are never invoked: the getter property fails closed
  assert.equal(workspaceBindingsEqual(withGetter, { mode: 'bound', workspace_id: W }), false);
  assert.equal(calls, 0);
  // inherited properties are never consulted
  const proto = { workspace_id: W };
  const inherited = Object.create(proto) as Record<string, unknown>;
  inherited['mode'] = 'bound';
  assert.equal(workspaceBindingsEqual(inherited, { mode: 'bound', workspace_id: W }), false);
  // class instances are not accepted
  class Binding {
    mode = 'bound';
    workspace_id = W;
  }
  assert.equal(workspaceBindingsEqual(new Binding(), { mode: 'bound', workspace_id: W }), false);
  assert.equal(exactReferencesEqual(new Binding(), ref()), false);
});
