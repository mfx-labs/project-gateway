/**
 * WP-8-B tests: closed error vocabulary and deterministic precedence
 * (contract 18, ERM-001…015).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_CODE_DEFINITIONS,
  ERROR_CODE_SET,
  READONLY_FS_PHASES,
  classifyContentFailure,
  classifyExistingTarget,
  errorCodeDefinition,
  isClosedErrorCode,
  readonlyFsState,
  selectPrecedence,
} from '../../../src/storage/index.js';
import type { StorageFinding } from '../../../src/storage/index.js';

const FORBIDDEN = ['/home', 'C:\\', 'errno', 'EACCES', 'ENOENT', 'EIO', 'stack', 'trustedActionId', 'capability', 'nonce', 'sha-256:', 'locks/writer.lock', 'metadata.json'];

test('errors: exactly 31 closed codes, each defined once', () => {
  assert.equal(ERROR_CODE_SET.size, 31);
  assert.equal(ERROR_CODE_DEFINITIONS.length, 33); // 31 unique codes; READONLY-FS has three phase rows
  const unique = new Set(ERROR_CODE_DEFINITIONS.map((d) => d.code));
  assert.equal(unique.size, 31);
  for (const code of unique) assert.equal(isClosedErrorCode(code), true);
  assert.equal(isClosedErrorCode('ERR-STO-MADE-UP'), false);
});

test('errors: expected code set present', () => {
  const expected = [
    'ERR-STO-REQ-INVALID', 'ERR-STO-CONFIG-UNAVAILABLE', 'ERR-STO-ROOT-INVALID', 'ERR-STO-ROOT-IDENTITY-CHANGED',
    'ERR-STO-CONTAINMENT-DENIED', 'ERR-STO-FTYPE-UNSUPPORTED', 'ERR-STO-PERM-DENIED', 'ERR-STO-NOT-FOUND',
    'ERR-STO-DUPLICATE', 'ERR-STO-CONFLICT-REVISION', 'ERR-STO-INTEGRITY', 'ERR-STO-UNSUPPORTED-VERSION',
    'ERR-STO-MALFORMED', 'ERR-STO-DURABILITY', 'ERR-STO-PUBLISH-FAILED', 'ERR-STO-LOCK-UNAVAILABLE',
    'ERR-STO-LOCK-TIMEOUT', 'ERR-STO-CONCURRENCY', 'ERR-STO-CANCELLED', 'ERR-STO-TIMEOUT',
    'ERR-STO-RETENTION-DENIED', 'ERR-STO-RECOVERY-REQUIRED', 'ERR-STO-RECOVERY-FAILED', 'ERR-STO-INTERNAL-INVARIANT',
    'ERR-STO-NO-SPACE', 'ERR-STO-QUOTA-EXCEEDED', 'ERR-STO-READONLY-FS', 'ERR-STO-CROSS-DEVICE',
    'ERR-STO-FS-UNSUPPORTED', 'ERR-STO-IO-FAILURE', 'ERR-STO-LIMIT-EXCEEDED',
  ];
  for (const code of expected) assert.equal(ERROR_CODE_SET.has(code), true, code);
});

test('errors: ERR-STO-READONLY-FS carries three phase rows (ERM-015)', () => {
  assert.deepEqual(READONLY_FS_PHASES, ['pre-publication', 'post-primary-publication', 'post-audit-publication']);
  const pre = readonlyFsState('pre-publication');
  const postPrimary = readonlyFsState('post-primary-publication');
  const postAudit = readonlyFsState('post-audit-publication');
  assert.ok(pre && postPrimary && postAudit);
  assert.equal(pre.state.primaryStateChanged, 'no');
  assert.equal(postPrimary.state.verifyBeforeRetry, true);
  assert.equal(postPrimary.state.recoveryRequired, true);
  assert.equal(postAudit.state.primaryStateChanged, 'yes');
  assert.equal(postAudit.state.durabilityPointReached, 'yes');
  assert.equal(readonlyFsState('unknown'), undefined);
});

test('errors: every code has deterministic metadata', () => {
  for (const d of ERROR_CODE_DEFINITIONS) {
    assert.ok(d.message.length > 0);
    assert.equal(typeof d.state.retryable, 'boolean');
    assert.equal(typeof d.state.recoveryRequired, 'boolean');
    assert.equal(typeof d.state.verifyBeforeRetry, 'boolean');
  }
});

test('errors: disclosure-safe messages contain no forbidden material (ERM-004)', () => {
  for (const d of ERROR_CODE_DEFINITIONS) {
    for (const token of FORBIDDEN) {
      assert.equal(d.message.includes(token), false, `${d.code} leaks ${token}`);
    }
    assert.ok(!/sha-256:[0-9a-f]{64}/.test(d.message));
  }
});

function findingFor(code: string, phase: StorageFinding['phase'] = 'request-validation'): StorageFinding {
  const def = errorCodeDefinition(code);
  return {
    code,
    message: def?.message ?? code,
    phase,
    state: def?.state ?? { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false },
  };
}

test('errors: precedence chain order (18.2, DTM-004)', () => {
  // containment beats permission
  assert.equal(selectPrecedence([findingFor('ERR-STO-PERM-DENIED'), findingFor('ERR-STO-CONTAINMENT-DENIED')])?.code, 'ERR-STO-CONTAINMENT-DENIED');
  // permission beats malformed
  assert.equal(selectPrecedence([findingFor('ERR-STO-MALFORMED'), findingFor('ERR-STO-PERM-DENIED')])?.code, 'ERR-STO-PERM-DENIED');
  // malformed beats unsupported-version
  assert.equal(selectPrecedence([findingFor('ERR-STO-UNSUPPORTED-VERSION'), findingFor('ERR-STO-MALFORMED')])?.code, 'ERR-STO-MALFORMED');
  // unsupported-version beats integrity
  assert.equal(selectPrecedence([findingFor('ERR-STO-INTEGRITY'), findingFor('ERR-STO-UNSUPPORTED-VERSION')])?.code, 'ERR-STO-UNSUPPORTED-VERSION');
  // integrity beats duplicate/conflict
  assert.equal(selectPrecedence([findingFor('ERR-STO-DUPLICATE'), findingFor('ERR-STO-INTEGRITY')])?.code, 'ERR-STO-INTEGRITY');
  assert.equal(selectPrecedence([findingFor('ERR-STO-CONFLICT-REVISION'), findingFor('ERR-STO-INTEGRITY')])?.code, 'ERR-STO-INTEGRITY');
  // lock beats publication
  assert.equal(selectPrecedence([findingFor('ERR-STO-PUBLISH-FAILED'), findingFor('ERR-STO-LOCK-TIMEOUT')])?.code, 'ERR-STO-LOCK-TIMEOUT');
  // publication beats cancellation pre-durability? No: cancellation takes precedence over success only pre-durability;
  // among failures, publication-class precedes cancellation per the chain.
  assert.equal(selectPrecedence([findingFor('ERR-STO-CANCELLED'), findingFor('ERR-STO-DURABILITY')])?.code, 'ERR-STO-DURABILITY');
  // recovery gate precedes everything
  assert.equal(selectPrecedence([findingFor('ERR-STO-INTEGRITY'), findingFor('ERR-STO-RECOVERY-REQUIRED')])?.code, 'ERR-STO-RECOVERY-REQUIRED');
  // internal invariant is last resort
  assert.equal(selectPrecedence([findingFor('ERR-STO-INTERNAL-INVARIANT'), findingFor('ERR-STO-NO-SPACE')])?.code, 'ERR-STO-NO-SPACE');
  // deterministic: same input, same output
  const input = [findingFor('ERR-STO-MALFORMED'), findingFor('ERR-STO-INTEGRITY'), findingFor('ERR-STO-PERM-DENIED')];
  assert.equal(selectPrecedence(input)?.code, selectPrecedence([...input].reverse())?.code);
  assert.equal(selectPrecedence([]), undefined);
});

test('errors: malformed-versus-unsupported-version precedence (ERM-014)', () => {
  // unparseable minimum envelope -> MALFORMED regardless of version content
  assert.equal(classifyContentFailure({ minimumEnvelopeParses: false, versionFieldStructurallyValid: true, versionSupported: true, canonicalizationOk: true, integrityOk: true }), 'malformed');
  // parseable envelope, structurally valid unsupported version -> UNSUPPORTED-VERSION
  assert.equal(classifyContentFailure({ minimumEnvelopeParses: true, versionFieldStructurallyValid: true, versionSupported: false, canonicalizationOk: false, integrityOk: false }), 'unsupported-version');
  // structurally invalid version field -> MALFORMED
  assert.equal(classifyContentFailure({ minimumEnvelopeParses: true, versionFieldStructurallyValid: false, versionSupported: true, canonicalizationOk: true, integrityOk: true }), 'malformed');
  // supported version, malformed field -> MALFORMED
  assert.equal(classifyContentFailure({ minimumEnvelopeParses: true, versionFieldStructurallyValid: true, versionSupported: true, canonicalizationOk: false, integrityOk: false }), 'malformed');
  // canonicalization ok, digest mismatch -> INTEGRITY
  assert.equal(classifyContentFailure({ minimumEnvelopeParses: true, versionFieldStructurallyValid: true, versionSupported: true, canonicalizationOk: true, integrityOk: false }), 'integrity');
  // all ok
  assert.equal(classifyContentFailure({ minimumEnvelopeParses: true, versionFieldStructurallyValid: true, versionSupported: true, canonicalizationOk: true, integrityOk: true }), 'ok');
});

test('errors: existing-target classification (10.2, ERM-011)', () => {
  const same = { sameIdentifier: true, identicalCanonicalBytes: true, digestMatches: true, sameRevision: true };
  assert.equal(classifyExistingTarget(same), 'idempotent-duplicate');
  assert.equal(classifyExistingTarget({ ...same, identicalCanonicalBytes: false }), 'duplicate');
  assert.equal(classifyExistingTarget({ ...same, digestMatches: false }), 'conflict-revision');
  assert.equal(classifyExistingTarget({ ...same, sameRevision: false }), 'conflict-revision');
  assert.equal(classifyExistingTarget({ ...same, sameIdentifier: false }), 'duplicate');
});
