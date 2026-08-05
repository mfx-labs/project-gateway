/**
 * WP-6 Phase 2B: resolver-evidence descriptor capture and exact-shape
 * validation (test categories E + F; F-2BP-FR-01 pattern).
 *
 * Resolver return values are STRICT tagged protocol evidence: descriptor-
 * captured exactly once (no getters, zero Proxy `get`, no inherited fields,
 * no accessors, no mixed evidence), validated against exact variant shapes
 * (eight own keys for success, three for failure), and malformed evidence
 * fails closed as a typed finding — never as an escaping exception.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProspectiveArtifactDestination, type ProspectiveDestinationResolution } from '../../src/trusted/index.js';
import {
  validatedConfig,
  destinationRequest,
  destinationOptions,
  successResolver,
  evidenceResolver,
  failingResolver,
  countingResolver,
  DEST_DIR_A,
} from './destination-helpers.js';

const config = validatedConfig();

const run = (evidence: unknown, resolver?: (...args: unknown[]) => unknown) => {
  try {
    return evaluateProspectiveArtifactDestination(destinationRequest(config), {
      configuration: config,
      resolveProspectiveDestination: (resolver ?? (() => evidence)) as never,
    });
  } catch (err) {
    return { __threw: err instanceof Error ? err.message : String(err) };
  }
};

const malformed = (r: ReturnType<typeof run>): boolean =>
  !('__threw' in r) && r.ok === false && r.findings[0]!.code === 'TAD-020' && r.decision === undefined;

const ordinarySuccess = (): ProspectiveDestinationResolution => successResolver('missing')({
  destinationContainmentProtocolVersion: '1',
  canonicalArtifactRoot: DEST_DIR_A,
  absoluteProspectiveDestination: `${DEST_DIR_A}/task.json`,
});

// ---------------------------------------------------------------------------
// success evidence
// ---------------------------------------------------------------------------

test('E: ordinary success evidence is accepted', () => {
  const r = run(ordinarySuccess());
  assert.equal('__threw' in r, false);
  if ('__threw' in r) return;
  assert.equal(r.ok, true);
  assert.equal(r.decision!.targetState, 'missing');
});

test('E: extra field in success evidence rejected (TAD-015)', () => {
  const r = run({ ...ordinarySuccess(), canonicalPath: DEST_DIR_A });
  assert.equal('__threw' in r, false);
  if ('__threw' in r) return;
  assert.equal(r.ok, false);
  assert.equal(r.findings[0]!.code, 'TAD-015');
  assert.equal(r.findings[0]!.messageKey, 'destination.evidence-success-malformed');
});

test('E: missing field in success evidence rejected (TAD-015)', () => {
  const evidence = ordinarySuccess() as unknown as Record<string, unknown>;
  delete evidence['targetState'];
  const r = run(evidence);
  assert.equal('__threw' in r, false);
  if ('__threw' in r) return;
  assert.equal(r.ok, false);
  assert.equal(r.findings[0]!.code, 'TAD-015');
});

test('E: getter on the canonical root field is never invoked (TAD-020)', () => {
  let calls = 0;
  const evidence = ordinarySuccess() as unknown as Record<string, unknown>;
  Object.defineProperty(evidence, 'currentCanonicalArtifactRoot', {
    enumerable: true,
    get() {
      calls++;
      return DEST_DIR_A;
    },
  });
  const r = run(evidence);
  assert.equal('__threw' in r, false);
  assert.equal(calls, 0);
  assert.equal(malformed(r), true);
});

test('E: throwing getter fails closed without escaping (TAD-020)', () => {
  const evidence = ordinarySuccess() as unknown as Record<string, unknown>;
  Object.defineProperty(evidence, 'currentCanonicalArtifactRoot', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });
  const r = run(evidence);
  assert.equal('__threw' in r, false);
  assert.equal(malformed(r), true);
});

test('E: Proxy get count remains zero; valid evidence accepted', () => {
  let getCount = 0;
  const target = ordinarySuccess();
  const proxy = new Proxy(target, {
    get(t, p) {
      getCount++;
      throw new Error(`get fired: ${String(p)}`);
    },
  });
  const r = run(proxy);
  assert.equal('__threw' in r, false);
  if ('__threw' in r) return;
  assert.equal(r.ok, true);
  assert.equal(getCount, 0);
});

test('E: accessor fields are rejected without invocation (TAD-020)', () => {
  let calls = 0;
  const evidence = ordinarySuccess() as unknown as Record<string, unknown>;
  Object.defineProperty(evidence, 'canonicalExistingDirectoryAncestor', {
    enumerable: true,
    get() {
      calls++;
      return DEST_DIR_A;
    },
  });
  const r = run(evidence);
  assert.equal('__threw' in r, false);
  assert.equal(calls, 0);
  assert.equal(malformed(r), true);
});

test('E: prototype-inherited fields are rejected (TAD-020)', () => {
  const proto = ordinarySuccess();
  const evidence = Object.create(proto);
  const r = run(evidence);
  assert.equal('__threw' in r, false);
  assert.equal(malformed(r), true);
});

test('E: non-enumerable protocol fields are rejected (TAD-020)', () => {
  const evidence = ordinarySuccess() as unknown as Record<string, unknown>;
  Object.defineProperty(evidence, 'targetState', { value: 'missing', enumerable: false });
  const r = run(evidence);
  assert.equal('__threw' in r, false);
  assert.equal(malformed(r), true);
});

test('E: symbol properties are rejected (TAD-020)', () => {
  const evidence = ordinarySuccess() as unknown as Record<string, unknown>;
  Object.defineProperty(evidence, Symbol('x'), { value: 1, enumerable: true });
  const r = run(evidence);
  assert.equal('__threw' in r, false);
  assert.equal(malformed(r), true);
});

test('E: unsupported prototypes are rejected (TAD-020)', () => {
  for (const evidence of [new Date(), new Map(), new (class Foo {})()]) {
    const r = run(evidence);
    assert.equal('__threw' in r, false);
    assert.equal(malformed(r), true);
  }
});

test('E: missing own descriptor is rejected (TAD-020)', () => {
  const proxy = new Proxy(ordinarySuccess(), {
    ownKeys(t) {
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, p) {
      if (p === 'targetState') return undefined;
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
  });
  const r = run(proxy);
  assert.equal('__threw' in r, false);
  assert.equal(malformed(r), true);
});

test('E: throwing structural traps fail closed (TAD-020)', () => {
  const throwGopd = new Proxy(ordinarySuccess(), { getOwnPropertyDescriptor() { throw new Error('gopd'); } });
  const throwOwnKeys = new Proxy(ordinarySuccess(), { ownKeys() { throw new Error('ownKeys'); } });
  assert.equal(malformed(run(throwGopd)), true);
  assert.equal(malformed(run(throwOwnKeys)), true);
});

test('E: revoked proxy fails closed (TAD-020)', () => {
  const revoked = Proxy.revocable(ordinarySuccess(), {});
  revoked.revoke();
  const r = run(revoked.proxy);
  assert.equal('__threw' in r, false);
  assert.equal(malformed(r), true);
});

test('E: hostile prefix array is rejected (TAD-020)', () => {
  const evidence = ordinarySuccess() as unknown as Record<string, unknown>;
  const prefix = ['drafts'];
  Object.defineProperty(prefix, '0', { enumerable: true, get() { return 'drafts'; } });
  evidence['lexicalExistingDirectoryPrefixComponents'] = prefix;
  const r = run(evidence);
  assert.equal('__threw' in r, false);
  assert.equal(malformed(r), true);
});

test('E: hostile tail array is rejected (TAD-020)', () => {
  const evidence = ordinarySuccess() as unknown as Record<string, unknown>;
  const tail = ['task.json'];
  Object.defineProperty(tail, '0', { enumerable: true, get() { return 'task.json'; } });
  evidence['destinationTailComponents'] = tail;
  const r = run(evidence);
  assert.equal('__threw' in r, false);
  assert.equal(malformed(r), true);
});

test('E: non-canonical root path in success evidence rejected (TAD-015)', () => {
  const r = run({ ...ordinarySuccess(), currentCanonicalArtifactRoot: 'relative/path' });
  assert.equal('__threw' in r, false);
  if ('__threw' in r) return;
  assert.equal(r.ok, false);
  assert.equal(r.findings[0]!.code, 'TAD-015');
});

test('E: wrong artifactRootEntryKind literal rejected (TAD-015)', () => {
  const r = run({ ...ordinarySuccess(), artifactRootEntryKind: 'file' });
  assert.equal('__threw' in r, false);
  if ('__threw' in r) return;
  assert.equal(r.ok, false);
  assert.equal(r.findings[0]!.code, 'TAD-015');
});

test('E: unknown target state rejected (TAD-015)', () => {
  const r = run({ ...ordinarySuccess(), targetState: 'exists' });
  assert.equal('__threw' in r, false);
  if ('__threw' in r) return;
  assert.equal(r.ok, false);
  assert.equal(r.findings[0]!.code, 'TAD-015');
});

test('E: non-string target state rejected (TAD-015)', () => {
  const r = run({ ...ordinarySuccess(), targetState: 5 });
  assert.equal('__threw' in r, false);
  if ('__threw' in r) return;
  assert.equal(r.ok, false);
  assert.equal(r.findings[0]!.code, 'TAD-015');
});

test('E: hostile evidence adds no resolver invocations (exactly one)', () => {
  let calls = 0;
  const resolver = () => {
    calls++;
    const evidence = { ...ordinarySuccess() };
    Object.defineProperty(evidence, 'ok', { enumerable: true, get() { return true; } });
    return evidence;
  };
  const r = run(undefined, resolver);
  assert.equal('__threw' in r, false);
  assert.equal(malformed(r), true);
  assert.equal(calls, 1);
});

// ---------------------------------------------------------------------------
// failure evidence
// ---------------------------------------------------------------------------

test('F: every subject with a compatible code maps deterministically', () => {
  const expected: Record<string, Record<string, string>> = {
    'artifact-root': {
      'not-found': 'TAD-021',
      'not-directory': 'TAD-022',
      'dangling-symlink': 'TAD-022',
      'unsupported-kind': 'TAD-023',
      'loop': 'TAD-024',
      'inaccessible': 'TAD-025',
      'ambiguous': 'TAD-025',
      'error': 'TAD-025',
    },
    'existing-ancestor': {
      'not-found': 'TAD-027',
      'not-directory': 'TAD-028',
      'unsupported-kind': 'TAD-029',
      'dangling-symlink': 'TAD-030',
      'loop': 'TAD-031',
      'inaccessible': 'TAD-032',
      'ambiguous': 'TAD-032',
      'error': 'TAD-032',
    },
    'final-target': {
      'observation-failed': 'TAD-044',
      'loop': 'TAD-044',
      'inaccessible': 'TAD-044',
      'ambiguous': 'TAD-044',
      'error': 'TAD-044',
    },
    'resolution': {
      'error': 'TAD-014',
    },
  };
  for (const [subject, codes] of Object.entries(expected)) {
    for (const [code, findingCode] of Object.entries(codes)) {
      const r = run(undefined, failingResolver(subject as never, code as never) as (...args: unknown[]) => unknown);
      assert.equal('__threw' in r, false, `${subject}/${code}`);
      if ('__threw' in r) continue;
      assert.equal(r.ok, false, `${subject}/${code}`);
      assert.equal(r.findings[0]!.code, findingCode, `${subject}/${code}`);
      assert.equal(r.decision, undefined, `${subject}/${code}`);
    }
  }
});

test('F: unknown failure subject rejected (TAD-017)', () => {
  const r = run({ ok: false, subject: 'artifact', code: 'error' });
  assert.equal('__threw' in r, false);
  if ('__threw' in r) return;
  assert.equal(r.ok, false);
  assert.equal(r.findings[0]!.code, 'TAD-017');
  assert.equal(r.findings[0]!.messageKey, 'destination.failure-subject-unknown');
});

test('F: unknown failure code rejected (TAD-018)', () => {
  const r = run({ ok: false, subject: 'artifact-root', code: 'exploded' });
  assert.equal('__threw' in r, false);
  if ('__threw' in r) return;
  assert.equal(r.ok, false);
  assert.equal(r.findings[0]!.code, 'TAD-018');
});

test('F: missing subject rejected (TAD-016)', () => {
  const r = run({ ok: false, code: 'error' });
  assert.equal('__threw' in r, false);
  if ('__threw' in r) return;
  assert.equal(r.ok, false);
  assert.equal(r.findings[0]!.code, 'TAD-016');
});

test('F: missing code rejected (TAD-016)', () => {
  const r = run({ ok: false, subject: 'resolution' });
  assert.equal('__threw' in r, false);
  if ('__threw' in r) return;
  assert.equal(r.ok, false);
  assert.equal(r.findings[0]!.code, 'TAD-016');
});

test('F: incompatible subject/code pair rejected (TAD-019)', () => {
  const cases = [
    { ok: false, subject: 'artifact-root', code: 'observation-failed' },
    { ok: false, subject: 'final-target', code: 'not-found' },
    { ok: false, subject: 'resolution', code: 'not-directory' },
  ];
  for (const evidence of cases) {
    const r = run(evidence);
    assert.equal('__threw' in r, false);
    if ('__threw' in r) continue;
    assert.equal(r.ok, false);
    assert.equal(r.findings[0]!.code, 'TAD-019', JSON.stringify(evidence));
    assert.equal(r.findings[0]!.messageKey, 'destination.failure-subject-code-incompatible');
  }
});

test('F: extra field in failure evidence rejected (TAD-016)', () => {
  const r = run({ ok: false, subject: 'resolution', code: 'error', extra: 1 });
  assert.equal('__threw' in r, false);
  if ('__threw' in r) return;
  assert.equal(r.ok, false);
  assert.equal(r.findings[0]!.code, 'TAD-016');
});

test('F: mixed success/failure fields rejected (TAD-016)', () => {
  const r = run({ ok: false, subject: 'resolution', code: 'error', canonicalPath: DEST_DIR_A });
  assert.equal('__threw' in r, false);
  if ('__threw' in r) return;
  assert.equal(r.ok, false);
  assert.equal(r.findings[0]!.code, 'TAD-016');
});

test('F: failure evidence getter hostility fails closed (TAD-020)', () => {
  let calls = 0;
  const evidence: Record<string, unknown> = { ok: false, code: 'error' };
  Object.defineProperty(evidence, 'subject', {
    enumerable: true,
    get() {
      calls++;
      return 'resolution';
    },
  });
  const r = run(evidence);
  assert.equal('__threw' in r, false);
  assert.equal(calls, 0);
  assert.equal(malformed(r), true);
});

test('F: no decision or identity on any failure', () => {
  const cases: Record<string, unknown>[] = [
    { ok: false, subject: 'artifact-root', code: 'not-found' },
    { ok: false, subject: 'existing-ancestor', code: 'loop' },
    { ok: false, subject: 'final-target', code: 'observation-failed' },
    { ok: false, subject: 'resolution', code: 'error' },
    { ...ordinarySuccess(), targetState: 'existing-file', lexicalExistingDirectoryPrefixComponents: [], destinationTailComponents: ['task.json'] },
  ];
  for (const evidence of cases) {
    const r = run(evidence);
    assert.equal('__threw' in r, false);
    if ('__threw' in r) continue;
    assert.equal(r.ok, false, JSON.stringify(evidence));
    assert.equal(r.decision, undefined, JSON.stringify(evidence));
  }
});

test('F: exact resolver invocation count for failure evidence', () => {
  let calls = 0;
  const resolver = () => {
    calls++;
    return { ok: false, subject: 'artifact-root', code: 'not-found' } as unknown;
  };
  const r = run(undefined, resolver);
  assert.equal('__threw' in r, false);
  if ('__threw' in r) return;
  assert.equal(r.ok, false);
  assert.equal(r.findings[0]!.code, 'TAD-021');
  assert.equal(calls, 1);
});

test('E: detached immutable capture (original evidence mutation cannot change an accepted outcome)', () => {
  const evidence = ordinarySuccess() as unknown as Record<string, unknown>;
  const r = run(evidence);
  assert.equal('__threw' in r, false);
  if ('__threw' in r) return;
  assert.equal(r.ok, true);
  // Mutate the ORIGINAL evidence after capture: the accepted decision is
  // detached and immutable and must not change.
  evidence['targetState'] = 'existing-file';
  evidence['currentCanonicalArtifactRoot'] = '/srv/outside';
  assert.equal(r.decision!.targetState, 'missing');
  assert.equal(r.decision!.currentCanonicalArtifactRoot, DEST_DIR_A);
  assert.equal(Object.isFrozen(r.decision!), true);
});

test('E: resolver evidence resolver is invoked exactly once for valid evidence', () => {
  const counted = countingResolver(evidenceResolver(ordinarySuccess()));
  const r = evaluateProspectiveArtifactDestination(destinationRequest(config), destinationOptions(config, counted.resolver));
  assert.equal(r.ok, true);
  assert.equal(counted.calls(), 1);
});
