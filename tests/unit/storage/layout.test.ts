/**
 * WP-8-B tests: pure layout derivation (contract 5.3/5.4, LAY-003…014;
 * Appendix H).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIT_SUFFIX,
  COMPONENT_LENGTH,
  FILENAME_LENGTH,
  PATH_BYTES_DEFAULT,
  PATH_BYTES_MAX,
  PATH_COMPONENT_BYTES_DEFAULT,
  PATH_COMPONENT_BYTES_MAX,
  RECORD_CLASS_PROFILES,
  RECORD_SUFFIX,
  STORE_METADATA_RELATIVE_PATH,
  WRITER_LOCK_RELATIVE_PATH,
  deriveRecordRelativePath,
  filenameWithinComponentBound,
  isDerivedRelativePath,
  relativePathWithinBound,
} from '../../../src/storage/index.js';

const ID_0 = 'pgw:r:00000000000000000000000000000000';
const ID_F = 'pgw:r:ffffffffffffffffffffffffffffffff';

test('layout: Appendix H relative-path vectors', () => {
  const cases: Array<[string, string, string]> = [
    [ID_0, 'approval-record', 'records/approval/0000/00000000000000000000000000000000.rec'],
    [ID_F, 'approval-record', 'records/approval/ffff/ffffffffffffffffffffffffffffffff.rec'],
    ['pgw:r:0123456789abcdef0123456789abcdef', 'approval-record', 'records/approval/0123/0123456789abcdef0123456789abcdef.rec'],
    ['pgw:r:00112233445566778899aabbccddeeff', 'approval-record', 'records/approval/0011/00112233445566778899aabbccddeeff.rec'],
    ['pgw:r:abcdef0123456789abcdef0123456789', 'approval-record', 'records/approval/abcd/abcdef0123456789abcdef0123456789.rec'],
  ];
  for (const [id, cls, expected] of cases) {
    const d = deriveRecordRelativePath(cls as 'approval-record', id);
    assert.equal(d.ok, true, id);
    if (d.ok) {
      assert.equal(d.relativePath, expected);
      assert.equal(d.shard, expected.split('/')[2]);
      assert.equal(isDerivedRelativePath(cls as 'approval-record', id, expected), true);
    }
  }
});

test('layout: length arithmetic (LAY-014, 5.3)', () => {
  assert.equal(COMPONENT_LENGTH, 32);
  assert.equal(FILENAME_LENGTH, 36); // 32 + ".rec"
  assert.equal(FILENAME_LENGTH, COMPONENT_LENGTH + RECORD_SUFFIX.length);
  assert.equal(AUDIT_SUFFIX, '.aud');
  // 36 <= default 64 <= hard max 128
  assert.equal(FILENAME_LENGTH <= PATH_COMPONENT_BYTES_DEFAULT, true);
  assert.equal(FILENAME_LENGTH <= PATH_COMPONENT_BYTES_MAX, true);
  assert.equal(filenameWithinComponentBound('x'.repeat(36), PATH_COMPONENT_BYTES_DEFAULT), true);
  assert.equal(filenameWithinComponentBound('x'.repeat(65), PATH_COMPONENT_BYTES_DEFAULT), false);
  assert.equal(filenameWithinComponentBound('x'.repeat(65), PATH_COMPONENT_BYTES_MAX), true);
});

test('layout: every class relative path fits pathBytes for min and max identifiers', () => {
  for (const profile of RECORD_CLASS_PROFILES) {
    for (const id of [ID_0, ID_F]) {
      const d = deriveRecordRelativePath(profile.id, id);
      assert.equal(d.ok, true, profile.id);
      if (d.ok) {
        assert.equal(relativePathWithinBound(d.relativePath, PATH_BYTES_DEFAULT), true, `${profile.id}: ${d.relativePath.length}`);
        assert.equal(relativePathWithinBound(d.relativePath, PATH_BYTES_MAX), true);
      }
    }
  }
});

test('layout: max relative path length across classes is well below 512', () => {
  let maxLen = 0;
  for (const profile of RECORD_CLASS_PROFILES) {
    const d = deriveRecordRelativePath(profile.id, ID_0);
    if (d.ok) maxLen = Math.max(maxLen, d.relativePath.length);
  }
  assert.ok(maxLen <= 512, `max relative path length ${maxLen}`);
  assert.ok(maxLen < PATH_BYTES_DEFAULT);
});

test('layout: audit events use the .aud suffix', () => {
  const d = deriveRecordRelativePath('authoritative-audit-event', ID_0);
  assert.equal(d.ok, true);
  if (d.ok) {
    assert.equal(d.suffix, '.aud');
    assert.equal(d.relativePath.endsWith('.aud'), true);
    assert.equal(d.filename, '0'.repeat(32) + '.aud');
  }
});

test('layout: fixed auxiliary paths are deterministic', () => {
  assert.equal(STORE_METADATA_RELATIVE_PATH, 'metadata/metadata.json');
  assert.equal(WRITER_LOCK_RELATIVE_PATH, 'locks/writer.lock');
});

test('layout: rejection behavior (LAY-003/004/007)', () => {
  for (const bad of [
    'pgw:r:0123456789ABCDEF0123456789ABCDEF',
    'pgw:r:0123456789abcdef0123456789abcdeg',
    'pgw:x:0123456789abcdef0123456789abcdef',
    'pgw:r:0123456789abcdef0123456789abcd',
    'pgw:r:0123456789abcdef0123456789abcdef01',
    'pgw:r:',
    '',
  ]) {
    const d = deriveRecordRelativePath('approval-record', bad);
    assert.equal(d.ok, false, bad);
  }
  assert.equal(deriveRecordRelativePath('not-a-class' as never, ID_0).ok, false);
});

test('layout: misplaced record fails verification (ITG-003)', () => {
  const d = deriveRecordRelativePath('approval-record', ID_0);
  assert.equal(d.ok, true);
  if (d.ok) {
    const wrong = d.relativePath.replace('/0000/', '/ffff/');
    assert.equal(isDerivedRelativePath('approval-record', ID_0, wrong), false);
    // Any non-derived candidate fails.
    assert.equal(isDerivedRelativePath('approval-record', ID_0, 'records/approval/0000/../evil.rec'), false);
  }
});

test('layout: prefix is never encoded into the component (LAY-004)', () => {
  const d = deriveRecordRelativePath('approval-record', 'pgw:r:0123456789abcdef0123456789abcdef');
  assert.equal(d.ok, true);
  if (d.ok) {
    assert.equal(d.component.includes('7067773a72'), false); // hex of "pgw:r:" must not appear
    assert.equal(d.component.length, 32);
  }
});
