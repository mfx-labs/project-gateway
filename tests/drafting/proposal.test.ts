/**
 * WP-10 Slice 1 — transport-free draft-proposal core tests.
 *
 * Fixtures are the committed WP-3 conformance fixtures
 * (`fixtures/artifacts/valid/*-minimal-genesis.json` and
 * `fixtures/artifacts/invalid/semantic-*.json`): full canonical envelopes
 * whose `revision.digest` the draft core derives (the derived digest MUST
 * equal the fixture's committed digest — construction equivalence with the
 * accepted canonicalization).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const fs = createRequire(import.meta.url)('node:fs');
import { createDraftProposal, DRAFTABLE_ARTIFACT_KINDS, NON_DRAFTABLE_ARTIFACT_KINDS, isDraftableArtifactKind, type DraftProposalResult } from '../../src/drafting/proposal.js';
import { validateArtifactInput, computeArtifactDigest, createSchemaRegistry } from '../../src/api/validate.js';
import { isGenuineValidatedTrustedWorkspaceConfiguration } from '../../src/trusted/configuration-brand.js';
import { isGenuineTrustedStorageBootstrapInput, isGenuineStorageBootstrapActionProvenance } from '../../src/storage/trusted-input/bootstrap-input.js';
import { isGenuineWriteCapability, isGenuineReadCapability, isGenuineInitializationCapability, isGenuineRecoveryCapability } from '../../src/storage/capabilities/authenticity.js';

const REPO = join(import.meta.dirname, '..', '..', '..');
const VALID_FIXTURES: Readonly<Record<string, string>> = {
  TaskSpec: 'task-minimal-genesis.json',
  AuthorityPolicy: 'policy-minimal-genesis.json',
  ContextManifest: 'context-minimal-genesis.json',
  CompletionContract: 'completion-minimal-genesis.json',
  ExecutionBundle: 'bundle-minimal-genesis.json',
};

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REPO, 'fixtures', 'artifacts', 'valid', name), 'utf8')) as Record<string, unknown>;
}

function invalidFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REPO, 'fixtures', 'artifacts', 'invalid', name), 'utf8')) as Record<string, unknown>;
}

/** Draft content: the canonical envelope with the derived member removed. */
function draftContent(model: Readonly<Record<string, unknown>>): string {
  const revision = { ...(model['revision'] as Readonly<Record<string, unknown>>) };
  delete revision['digest'];
  return JSON.stringify({ ...model, revision });
}

function declaredDigest(model: Readonly<Record<string, unknown>>): string {
  return (model['revision'] as Readonly<Record<string, unknown>>)['digest'] as string;
}

test('drafting: exact draftable vocabulary — five prospective kinds, ExecutionResult excluded', () => {
  assert.deepEqual([...DRAFTABLE_ARTIFACT_KINDS], ['TaskSpec', 'AuthorityPolicy', 'ContextManifest', 'CompletionContract', 'ExecutionBundle']);
  assert.deepEqual([...NON_DRAFTABLE_ARTIFACT_KINDS], ['ExecutionResult']);
  for (const k of DRAFTABLE_ARTIFACT_KINDS) assert.equal(isDraftableArtifactKind(k), true);
  for (const v of ['ExecutionResult', 'TaskSpec ', ' taskspec', 'TaskSpecification', 'task-spec', '', 42, null, undefined, {}]) {
    assert.equal(isDraftableArtifactKind(v), false, `lookalike ${String(v)} must not be draftable`);
  }
});

test('drafting: valid draft for every draftable kind — derived digest equals the committed canonical digest', () => {
  for (const kind of DRAFTABLE_ARTIFACT_KINDS) {
    const model = fixture(VALID_FIXTURES[kind]!);
    const declared = declaredDigest(model);
    const r = createDraftProposal({ kind, content: draftContent(model) }) as Extract<DraftProposalResult, { readonly ok: true; readonly valid: true }>;
    assert.equal(r.ok, true, `${kind} draft must succeed`);
    assert.equal(r.valid, true, `${kind} draft must be valid`);
    assert.equal(r.kind, kind);
    // Construction equivalence: the derived digest equals the committed
    // canonical digest over the exact same envelope (no canonicalization drift).
    assert.equal(r.proposal.digest, declared, `${kind} derived digest must equal the committed digest`);
    assert.equal((r.proposal.model['revision'] as Readonly<Record<string, unknown>>)['digest'], declared);
    assert.equal(r.proposal.instanceId, model['instance_id']);
    assert.equal(r.proposal.revisionId, (model['revision'] as Record<string, unknown>)['id']);
    assert.equal(r.validation.level, 'self-semantic-valid');
    assert.deepEqual(r.validation.ruleIds, []);
    // The proposal model is the complete canonical envelope (digest present).
    assert.equal(typeof r.proposal.canonicalUtf8, 'string');
    assert.ok(r.proposal.canonicalUtf8.length > 0);
  }
});

test('drafting: direct WP-4 equivalence — identical validation conclusion, digest, and canonical bytes', () => {
  const registry = createSchemaRegistry();
  for (const kind of DRAFTABLE_ARTIFACT_KINDS) {
    const model = fixture(VALID_FIXTURES[kind]!);
    // Full candidate exactly as the draft core constructs it.
    const { digest } = computeArtifactDigest(model);
    const full = { ...model, revision: { ...(model['revision'] as Record<string, unknown>), digest } };
    const direct = validateArtifactInput(JSON.stringify(full), registry);
    assert.equal(direct.ok, true, `${kind} direct WP-4 must pass`);
    const r = createDraftProposal({ kind, content: draftContent(model) }) as Extract<DraftProposalResult, { readonly ok: true; readonly valid: true }>;
    assert.equal(r.proposal.digest, direct.value?.digest, `${kind} digest equal`);
    assert.equal(r.proposal.canonicalUtf8, direct.value?.canonicalUtf8, `${kind} canonical bytes equal`);
    assert.equal(r.proposal.level, direct.value?.level, `${kind} level equal`);
    assert.deepEqual(r.proposal.model, direct.value?.model, `${kind} model equal`);
  }
});

test('drafting: invalid draft is a normal conclusion with bounded findings — never a generic error', () => {
  const cases: ReadonlyArray<{ kind: string; fixture: string; expectCategory: string }> = [
    { kind: 'TaskSpec', fixture: 'semantic-task-delegated-context-instruction.json', expectCategory: 'AGGREGATE-RESPONSIBILITY-FAILURE' },
    { kind: 'AuthorityPolicy', fixture: 'semantic-authority-contains-task-instruction.json', expectCategory: 'STRUCTURAL-SCHEMA-FAILURE' },
    { kind: 'ContextManifest', fixture: 'semantic-context-instruction-promotion.json', expectCategory: 'STRUCTURAL-SCHEMA-FAILURE' },
    { kind: 'CompletionContract', fixture: 'semantic-completion-embeds-observed-pass.json', expectCategory: 'STRUCTURAL-SCHEMA-FAILURE' },
    { kind: 'ExecutionBundle', fixture: 'bundle-result-prospectively.json', expectCategory: 'STRUCTURAL-SCHEMA-FAILURE' },
  ];
  for (const c of cases) {
    const model = invalidFixture(c.fixture);
    const r = createDraftProposal({ kind: c.kind as never, content: draftContent(model) }) as Extract<DraftProposalResult, { readonly ok: true; readonly valid: false }>;
    assert.equal(r.ok, true, `${c.fixture}: draft request processed normally`);
    assert.equal(r.valid, false, `${c.fixture}: content must fail WP-4`);
    assert.equal(r.kind, c.kind);
    assert.ok(r.findings.length > 0, `${c.fixture}: findings exposed`);
    assert.equal(r.findings[0]?.category, c.expectCategory, `${c.fixture}: expected category`);
    assert.ok(r.findings[0]!.ruleIds.length > 0, `${c.fixture}: rule IDs exposed for iterative correction`);
    for (const f of r.findings) {
      assert.equal(typeof f.phase, 'string');
      assert.equal(typeof f.messageKey, 'string');
      assert.ok(!f.messageKey.includes('/'), `${c.fixture}: no path material in findings`);
    }
  }
});

test('drafting: consumption-phase checks remain consumption-phase — draft self-validation never claims eligibility', () => {
  // Authority-policy expansion (AUT-001) is a point-of-use-eligibility check
  // requiring trusted ceiling/registry context; at self-validation an
  // expanding policy is a structurally valid PROPOSAL. The draft core must
  // agree exactly with accepted WP-4 self-validation, and the result must
  // never be read as consumption eligibility.
  const model = invalidFixture('semantic-authority-expansion.json');
  const r = createDraftProposal({ kind: 'AuthorityPolicy', content: draftContent(model) }) as Extract<DraftProposalResult, { readonly ok: true; readonly valid: true }>;
  assert.equal(r.ok, true);
  assert.equal(r.valid, true, 'self-validation does not evaluate point-of-use expansion checks');
  const { digest } = computeArtifactDigest(model);
  const direct = validateArtifactInput(JSON.stringify({ ...model, revision: { ...(model['revision'] as Record<string, unknown>), digest } }), createSchemaRegistry());
  assert.equal(direct.ok, true, 'direct WP-4 self-validation agrees');
  assert.equal(r.proposal.digest, direct.value?.digest);
});

test('drafting: direct WP-4 equivalence on invalid drafts — identical finding projection', () => {
  const registry = createSchemaRegistry();
  const cases: ReadonlyArray<{ kind: string; fixture: string }> = [
    { kind: 'AuthorityPolicy', fixture: 'semantic-authority-contains-task-instruction.json' },
    { kind: 'ContextManifest', fixture: 'semantic-context-instruction-promotion.json' },
  ];
  for (const c of cases) {
    const model = invalidFixture(c.fixture);
    const { digest } = computeArtifactDigest(model);
    const full = { ...model, revision: { ...(model['revision'] as Record<string, unknown>), digest } };
    const direct = validateArtifactInput(JSON.stringify(full), registry);
    assert.equal(direct.ok, false);
    const r = createDraftProposal({ kind: c.kind as never, content: draftContent(model) }) as Extract<DraftProposalResult, { readonly ok: true; readonly valid: false }>;
    assert.equal(r.findings.length, direct.findings.length, `${c.fixture}: finding count equal`);
    for (let i = 0; i < r.findings.length; i++) {
      const a = r.findings[i]!;
      const b = direct.findings[i]!;
      assert.equal(a.phase, b.phase);
      assert.equal(a.category, b.category);
      assert.deepEqual(a.ruleIds, b.ruleIds);
      assert.equal(a.messageKey, b.messageKey);
      assert.equal(a.location, b.location);
      assert.equal(a.subjectIdentity, b.subjectIdentity);
    }
  }
});

test('drafting: non-draftable ExecutionResult and lookalike kinds fail deterministically', () => {
  const resultModel = fixture('result-minimal-genesis.json');
  const r = createDraftProposal({ kind: 'ExecutionResult' as never, content: draftContent(resultModel) });
  assert.equal(r.ok, false);
  assert.equal((r as { error: { code: string } }).error.code, 'unsupported-artifact-kind');
  for (const lookalike of ['TaskSpec ', 'taskspec', 'TaskSpecification', 'ExecutionBundle ', 'ApprovalRecord']) {
    const rr = createDraftProposal({ kind: lookalike as never, content: draftContent(fixture('task-minimal-genesis.json')) });
    assert.equal(rr.ok, false, `${lookalike}`);
    assert.equal((rr as { error: { code: string } }).error.code, 'unsupported-artifact-kind', `${lookalike}`);
  }
});

test('drafting: kind correlation — content kind must match the requested kind', () => {
  const task = draftContent(fixture('task-minimal-genesis.json'));
  const r = createDraftProposal({ kind: 'AuthorityPolicy', content: task });
  assert.equal(r.ok, false);
  assert.equal((r as { error: { code: string } }).error.code, 'invalid-draft-request');
  // Non-artifact content (lifecycle record shape) cannot correlate either.
  const record = JSON.stringify({ record_type: 'ApprovalRecord', record_id: 'pgw:ar:00000000000000000000000000000000', approved: true });
  const r2 = createDraftProposal({ kind: 'TaskSpec', content: record });
  assert.equal(r2.ok, false);
  assert.equal((r2 as { error: { code: string } }).error.code, 'invalid-draft-request');
});

test('drafting: revision.digest is a derived member — presence is rejected', () => {
  const model = fixture('task-minimal-genesis.json');
  const r = createDraftProposal({ kind: 'TaskSpec', content: JSON.stringify(model) });
  assert.equal(r.ok, false);
  assert.equal((r as { error: { code: string } }).error.code, 'invalid-draft-request');
});

test('drafting: closed request shape — unknown fields, wrong types, non-object', () => {
  const content = draftContent(fixture('task-minimal-genesis.json'));
  assert.equal((createDraftProposal({ kind: 'TaskSpec', content, approve: true } as never) as { ok: false }).ok, false);
  assert.equal((createDraftProposal({ kind: 'TaskSpec', content, issued: true } as never) as { ok: false }).ok, false);
  assert.equal((createDraftProposal({ kind: 'TaskSpec', content, root: '/tmp' } as never) as { ok: false }).ok, false);
  assert.equal((createDraftProposal({ kind: 'TaskSpec', content: 42 } as never) as { ok: false }).ok, false);
  assert.equal((createDraftProposal({ kind: 'TaskSpec', content: '' }) as { ok: false }).ok, false);
  assert.equal((createDraftProposal(null as never) as { ok: false }).ok, false);
  assert.equal((createDraftProposal([] as never) as { ok: false }).ok, false);
  const r = createDraftProposal({ kind: 'TaskSpec', content, approve: true } as never) as { ok: false; error: { code: string; message: string } };
  assert.equal(r.error.code, 'invalid-draft-request');
  assert.equal(r.error.message.includes('approve'), true, 'unknown-field rejection names the field');
});

test('drafting: self-approval guard — authority-shaped envelope extras never produce a valid draft', () => {
  const model = fixture('task-minimal-genesis.json') as Record<string, unknown>;
  for (const extra of [{ approved: true }, { issued: true }, { activated: true }, { grant: { id: 'x' } }, { executable: true }]) {
    const tampered = { ...model, ...extra };
    const r = createDraftProposal({ kind: 'TaskSpec', content: draftContent(tampered) });
    assert.equal(r.ok, true, 'request processed');
    if (r.ok) {
      assert.equal(r.valid, false, `envelope extra ${JSON.stringify(extra)} must fail structural validation`);
    }
  }
});

test('drafting: duplicate JSON keys and malformed JSON are rejected at intake', () => {
  const dup = readFileSync(join(REPO, 'fixtures', 'artifacts', 'invalid', 'duplicate-key.json.raw'), 'utf8');
  const r = createDraftProposal({ kind: 'TaskSpec', content: dup });
  assert.equal(r.ok, false);
  assert.equal((r as { error: { code: string } }).error.code, 'invalid-draft-request');
  const r2 = createDraftProposal({ kind: 'TaskSpec', content: '{not json' });
  assert.equal(r2.ok, false);
  assert.equal((r2 as { error: { code: string } }).error.code, 'invalid-draft-request');
});

test('drafting F1: valid JSON that is not an Artifact envelope is invalid-draft-request, never internal-adapter-failure', () => {
  // A syntactically valid JSON value that is not a non-null, non-array
  // object can never be an Artifact envelope: it must classify as a draft
  // request error — never as an adapter malfunction.
  const nonObjectShapes: readonly string[] = ['null', '"scalar string"', '42', 'true', 'false', '[]', '[1,2,3]', '[{"kind":{"id":"TaskSpec"}}]'];
  for (const content of nonObjectShapes) {
    const r = createDraftProposal({ kind: 'TaskSpec', content }) as { ok: false; error: { code: string; message: string } };
    assert.equal(r.ok, false, `content ${content}`);
    assert.equal(r.error.code, 'invalid-draft-request', `content ${content} must be a request error`);
    assert.notEqual(r.error.code, 'internal-adapter-failure', `content ${content} must never be internal`);
    assert.ok(!r.error.message.includes(content.slice(0, 10)), 'no content echo in the error');
  }
  // Control: an object-shaped candidate that legitimately reaches WP-4 and
  // fails self-validation remains a normal ok:true/valid:false conclusion
  // (never invalid-draft-request).
  const objectInvalid = createDraftProposal({ kind: 'TaskSpec', content: draftContent(invalidFixture('semantic-task-delegated-context-instruction.json')) });
  assert.equal(objectInvalid.ok, true);
  assert.equal((objectInvalid as { valid: boolean }).valid, false);
  // Control: malformed JSON stays a parser error (invalid-draft-request), not internal.
  const malformed = createDraftProposal({ kind: 'TaskSpec', content: '{not json' });
  assert.equal((malformed as { ok: false }).ok, false);
  assert.equal((malformed as { error: { code: string } }).error.code, 'invalid-draft-request');
  // Control: a genuine unexpected internal failure still maps to the fixed
  // redacted internal-adapter-failure (no production fault-injection hook).
  const throwing = new Proxy({}, { get() { throw new Error('SECRET-INTERNAL-DETAIL stack=deep'); } });
  const internal = createDraftProposal(throwing as never) as { ok: false; error: { code: string; message: string } };
  assert.equal(internal.error.code, 'internal-adapter-failure');
  assert.equal(internal.error.message.includes('SECRET-INTERNAL-DETAIL'), false);
  assert.equal(internal.error.message.includes('stack'), false);
});

test('drafting: content byte bound — oversized draft content fails with limit-exceeded', () => {
  const big = '{"a":' + ' '.repeat(1024 * 1024) + '}';
  const r = createDraftProposal({ kind: 'TaskSpec', content: big });
  assert.equal(r.ok, false);
  assert.equal((r as { error: { code: string } }).error.code, 'limit-exceeded');
  // Just under the artifact bound parses; the size gate admits it and the
  // kind-correlation gate rejects it — never a limit error.
  const under = '{"x":"' + 'a'.repeat(900 * 1024) + '"}';
  assert.ok(Buffer.byteLength(under, 'utf8') < 1024 * 1024);
  const r2 = createDraftProposal({ kind: 'TaskSpec', content: under });
  assert.equal(r2.ok, false);
  assert.notEqual((r2 as { error: { code: string } }).error.code, 'limit-exceeded', 'under-limit content is not a size failure');
  assert.equal((r2 as { error: { code: string } }).error.code, 'invalid-draft-request');
});

test('drafting: determinism — identical requests produce identical results', () => {
  for (const kind of DRAFTABLE_ARTIFACT_KINDS) {
    const content = draftContent(fixture(VALID_FIXTURES[kind]!));
    const a = createDraftProposal({ kind, content });
    const b = createDraftProposal({ kind, content });
    assert.deepEqual(b, a, `${kind} deterministic`);
  }
  const invalid = draftContent(invalidFixture('semantic-authority-expansion.json'));
  const a = createDraftProposal({ kind: 'AuthorityPolicy', content: invalid });
  const b = createDraftProposal({ kind: 'AuthorityPolicy', content: invalid });
  assert.deepEqual(b, a, 'invalid conclusion deterministic');
});

test('drafting: immutability — returned data is frozen and shares no mutable state', () => {
  const content = draftContent(fixture('task-minimal-genesis.json'));
  const r = createDraftProposal({ kind: 'TaskSpec', content }) as Extract<DraftProposalResult, { readonly ok: true; readonly valid: true }>;
  assert.equal(Object.isFrozen(r), true);
  assert.equal(Object.isFrozen(r.proposal), true);
  assert.equal(Object.isFrozen(r.proposal.model), true);
  assert.equal(Object.isFrozen(r.proposal.model['body']), true);
  assert.equal(Object.isFrozen(r.validation), true);
  const before = JSON.stringify(r);
  assert.throws(() => {
    (r.proposal.model as Record<string, unknown>)['body'] = 'mutated';
  });
  assert.equal(JSON.stringify(r), before);
  const again = createDraftProposal({ kind: 'TaskSpec', content }) as Extract<DraftProposalResult, { readonly ok: true; readonly valid: true }>;
  assert.deepEqual(again, r, 'mutation attempts do not affect later results');
  const inv = createDraftProposal({ kind: 'AuthorityPolicy', content: draftContent(invalidFixture('semantic-authority-contains-task-instruction.json')) }) as Extract<DraftProposalResult, { readonly ok: true; readonly valid: false }>;
  assert.equal(Object.isFrozen(inv.findings), true);
  assert.equal(Object.isFrozen(inv.findings[0]), true);
});

test('drafting: no authority — draft results confer zero authority at trusted boundaries', () => {
  const content = draftContent(fixture('task-minimal-genesis.json'));
  const r = createDraftProposal({ kind: 'TaskSpec', content }) as Extract<DraftProposalResult, { readonly ok: true; readonly valid: true }>;
  const model = r.proposal.model;
  assert.equal(Object.getOwnPropertySymbols(model).length, 0, 'no brand symbols on draft data');
  assert.equal(Object.getOwnPropertyNames(model).includes('brand'), false);
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(model), false, 'draft model is not a genuine trusted workspace configuration');
  assert.equal(isGenuineTrustedStorageBootstrapInput(model), false);
  assert.equal(isGenuineStorageBootstrapActionProvenance(model), false);
  assert.equal(isGenuineWriteCapability(model), false);
  assert.equal(isGenuineReadCapability(model), false);
  assert.equal(isGenuineInitializationCapability(model), false);
  assert.equal(isGenuineRecoveryCapability(model), false);
  // A structurally similar lookalike of a trusted input also fails.
  const lookalike = { ...model, actionIdentity: 'x', locator: '/tmp', serviceUid: 0, forbiddenRoots: [], configurationIdentity: 'sha-256:' + 'a'.repeat(64), limitProfile: {} };
  assert.equal(isGenuineTrustedStorageBootstrapInput(lookalike), false);
});

test('drafting: redaction — error messages carry no paths, stacks, or internals', () => {
  const cases: unknown[] = [
    { kind: 'TaskSpec', content: '{not json' },
    { kind: 'ExecutionResult' as never, content: '{}' },
    { kind: 'TaskSpec', content: '', evil: '/etc/passwd' } as never,
  ];
  for (const c of cases) {
    const r = createDraftProposal(c as never) as { ok: false; error: { code: string; message: string } };
    assert.equal(r.ok, false);
    assert.ok(!/stack|errno|ENOENT|EACCES|\/etc|\/tmp/.test(r.error.message), `redacted: ${r.error.message}`);
  }
  // Unexpected internal failure path: a throwing proxy request yields the
  // fixed redacted internal failure.
  const throwing = new Proxy({}, { get() { throw new Error('SECRET-INTERNAL-DETAIL stack=deep'); } });
  const r = createDraftProposal(throwing as never) as { ok: false; error: { code: string; message: string } };
  assert.equal(r.error.code, 'internal-adapter-failure');
  assert.equal(r.error.message.includes('SECRET-INTERNAL-DETAIL'), false);
  assert.equal(r.error.message.includes('stack'), false);
});

test('drafting: fs mutation watchdog — drafting never touches project/store mutation APIs', () => {
  const guards = ['writeFileSync', 'writeFile', 'mkdirSync', 'mkdir', 'rmSync', 'rm', 'renameSync', 'rename', 'unlinkSync', 'unlink', 'chmodSync', 'chmod', 'chownSync', 'chown', 'symlinkSync', 'linkSync', 'copyFileSync', 'appendFileSync', 'truncateSync', 'utimesSync', 'utimes'];
  const originals: Record<string, unknown> = {};
  for (const g of guards) {
    originals[g] = (fs as unknown as Record<string, unknown>)[g];
    (fs as unknown as Record<string, unknown>)[g] = (...a: unknown[]) => {
      throw new Error(`MUTATION:${g}`);
    };
  }
  try {
    for (const kind of DRAFTABLE_ARTIFACT_KINDS) {
      const ok = createDraftProposal({ kind, content: draftContent(fixture(VALID_FIXTURES[kind]!)) });
      assert.equal(ok.ok, true);
    }
    const invalid = createDraftProposal({ kind: 'AuthorityPolicy', content: draftContent(invalidFixture('semantic-authority-expansion.json')) });
    assert.equal(invalid.ok, true);
    createDraftProposal({ kind: 'TaskSpec', content: '{bad' });
    createDraftProposal({ kind: 'ExecutionResult' as never, content: '{}' });
  } finally {
    for (const g of guards) (fs as unknown as Record<string, unknown>)[g] = originals[g];
  }
});
