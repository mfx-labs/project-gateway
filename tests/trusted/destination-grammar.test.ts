/**
 * WP-6 Phase 2B: artifact-root-relative destination grammar and request
 * record hardening (test category C).
 *
 * Rejections: empty, `.`, `..`, interior dots, absolute (leading slash),
 * Windows drive, UNC, backslash, repeated and trailing separators, NUL,
 * prohibited control characters, empty components, and the fixed size
 * bound. Unicode is accepted without normalization. Destination equality
 * with the artifact root is structurally impossible (empty and `.` are
 * rejected). Every rejection happens before any resolver invocation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProspectiveArtifactDestination } from '../../src/trusted/index.js';
import { DESTINATION_MAX_LENGTH, parseDestinationComponents } from '../../src/trusted/destination-request.js';
import {
  validatedConfig,
  destinationRequest,
  destinationOptions,
  successResolver,
  countingResolver,
} from './destination-helpers.js';

const evaluate = (config: unknown, input: unknown, resolver = successResolver('missing')) =>
  evaluateProspectiveArtifactDestination(input, { configuration: config as never, resolveProspectiveDestination: resolver });

test('C: simple filename accepted', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { destination: 'task.json' }));
  assert.equal(report.ok, true);
  assert.equal(report.decision!.canonicalArtifactRelativeDestination, 'task.json');
});

test('C: nested path accepted', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { destination: 'drafts/2026/task.json' }));
  assert.equal(report.ok, true);
  assert.equal(report.decision!.canonicalArtifactRelativeDestination, 'drafts/2026/task.json');
});

test('C: Unicode accepted without normalization', () => {
  const config = validatedConfig();
  const destination = 'drafts/任务-ünïcode.json';
  const report = evaluate(config, destinationRequest(config, { destination }));
  assert.equal(report.ok, true);
  assert.equal(report.decision!.canonicalArtifactRelativeDestination, destination);
});

test('C: empty destination rejected (TAD-008)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { destination: '' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-008');
  assert.equal(report.findings[0]!.messageKey, 'destination.destination-malformed');
});

test('C: missing destination field rejected (TAD-008)', () => {
  const config = validatedConfig();
  const input = destinationRequest(config);
  delete (input as Record<string, unknown>)['destination'];
  const report = evaluate(config, input);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-008');
  assert.equal(report.findings[0]!.messageKey, 'destination.destination-malformed');
});

test('C: undefined-valued destination is a snapshot structure failure (TAD-007)', () => {
  // An explicit `destination: undefined` value is not representable in the
  // canonical JSON input contract; descriptor capture fails closed as a
  // request-structure failure before the grammar stage.
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { destination: undefined }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-007');
});

test('C: "." rejected (TAD-010)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { destination: '.' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-010');
  assert.equal(report.findings[0]!.messageKey, 'destination.destination-traversal-dot');
});

test('C: interior "." rejected (TAD-010)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { destination: 'a/./b' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-010');
});

test('C: ".." rejected (TAD-010)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { destination: '..' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-010');
});

test('C: interior ".." rejected (TAD-010)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { destination: 'a/../b' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-010');
});

test('C: leading slash rejected (TAD-009)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { destination: '/etc/passwd' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-009');
  assert.equal(report.findings[0]!.messageKey, 'destination.destination-absolute');
});

test('C: trailing slash rejected (TAD-011)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { destination: 'a/b/' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-011');
});

test('C: repeated separators rejected (TAD-011)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { destination: 'a//b' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-011');
});

test('C: Windows drive rejected (TAD-009)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { destination: 'C:\\drafts\\task.json' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-009');
});

test('C: UNC rejected (TAD-009)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { destination: '\\\\server\\share' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-009');
});

test('C: backslash rejected (TAD-011)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { destination: 'a\\b' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-011');
});

test('C: NUL rejected (TAD-011)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { destination: 'a\u0000b' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-011');
});

test('C: control character rejected (TAD-011)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { destination: 'a\u001fb' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-011');
});

test('C: fixed size bound below, at, and above the boundary', () => {
  const config = validatedConfig();
  const below = 'a'.repeat(DESTINATION_MAX_LENGTH - 1);
  const at = 'a'.repeat(DESTINATION_MAX_LENGTH);
  const above = 'a'.repeat(DESTINATION_MAX_LENGTH + 1);
  assert.equal(parseDestinationComponents(below).ok, true);
  assert.equal(parseDestinationComponents(at).ok, true);
  assert.equal(parseDestinationComponents(above).ok, false);
  const rBelow = evaluate(config, destinationRequest(config, { destination: below }));
  const rAt = evaluate(config, destinationRequest(config, { destination: at }));
  const rAbove = evaluate(config, destinationRequest(config, { destination: above }));
  assert.equal(rBelow.ok, true);
  assert.equal(rAt.ok, true);
  assert.equal(rAbove.ok, false);
  assert.equal(rAbove.findings[0]!.code, 'TAD-012');
  assert.equal(rAbove.findings[0]!.messageKey, 'destination.destination-too-long');
});

test('C: destination equals artifact root is structurally impossible', () => {
  const config = validatedConfig();
  // The only relative forms that normalize to the artifact root are the
  // empty path and `.`, both rejected at the grammar boundary; no accepted
  // request can name the root itself.
  for (const destination of ['', '.']) {
    const report = evaluate(config, destinationRequest(config, { destination }));
    assert.equal(report.ok, false, destination);
  }
  // A one-component request names an entry BELOW the root; it never equals
  // the root path.
  const ok = evaluate(config, destinationRequest(config, { destination: 'artifacts' }));
  assert.equal(ok.ok, true);
});

test('C: zero resolver calls on every grammar rejection', () => {
  const config = validatedConfig();
  const bad = ['', '.', 'a/.', '..', 'a/..', '/x', 'a/', 'a//b', 'C:\\x', '\\\\s\\s', 'a\\b', 'a\u0000b', 'a\u001fb'];
  for (const destination of bad) {
    const counted = countingResolver(successResolver('missing'));
    const report = evaluate(config, destinationRequest(config, { destination }), counted.resolver);
    assert.equal(report.ok, false, destination);
    assert.equal(counted.calls(), 0, destination);
  }
});

test('C: request record unknown field rejected (TAD-007)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { writeMode: 'overwrite' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-007');
  assert.equal(report.findings[0]!.messageKey, 'destination.request-unknown-field');
});

test('C: request getters are never invoked and fail closed (TAD-007)', () => {
  let invoked = 0;
  const config = validatedConfig();
  const input = destinationRequest(config);
  Object.defineProperty(input, 'destination', {
    enumerable: true,
    get() {
      invoked++;
      return 'task.json';
    },
  });
  const report = evaluate(config, input);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-007');
  assert.equal(invoked, 0);
});

test('C: request Proxy get traps are not used for protocol-significant reads', () => {
  let getCalls = 0;
  const config = validatedConfig();
  const target = destinationRequest(config);
  const proxy = new Proxy(target, {
    get(t, p) {
      getCalls++;
      if (p === 'destination') throw new Error('get trap must not fire');
      return Reflect.get(t, p);
    },
  });
  const report = evaluate(config, proxy);
  assert.equal(report.ok, true);
  assert.equal(getCalls, 0);
});

test('C: request symbol keys fail closed (TAD-007)', () => {
  const config = validatedConfig();
  const input = destinationRequest(config);
  (input as Record<symbol, unknown>)[Symbol('x')] = 'y';
  const report = evaluate(config, input);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-007');
});

test('C: non-object request fails closed (TAD-007)', () => {
  const config = validatedConfig();
  for (const value of ['x', 42, null, ['a']]) {
    const report = evaluate(config, value);
    assert.equal(report.ok, false, String(value));
    assert.equal(report.findings[0]!.code, 'TAD-007', String(value));
  }
});
