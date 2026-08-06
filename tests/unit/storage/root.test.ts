/**
 * WP-8-C trusted-root validation tests (SRX-001…015 at initialization scope;
 * ADR-028 decision A).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, mkdirSync, rmdirSync, symlinkSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAndCaptureParent, checkForbiddenRootOverlap, revalidateParentIdentity } from '../../../src/storage/root/resolve.js';
import { verifyDirectoryStat, verifyRegularFileStat, comparePrePostStat, type DirectoryStatLike } from '../../../src/storage/root/identity.js';
import { pathsOverlap, firstForbiddenOverlap, namespaceRootsDistinct } from '../../../src/storage/root/overlap.js';

const UID = process.getuid?.() ?? 0;

function syntheticStat(overrides: Partial<DirectoryStatLike> = {}): DirectoryStatLike {
  return {
    isDirectory: () => true,
    isSymbolicLink: () => false,
    isFile: () => false,
    uid: UID,
    mode: 0o40700,
    dev: 1,
    ino: 2,
    nlink: 2,
    size: 0,
    ...overrides,
  };
}

test('root: pure directory-stat policy (deterministic synthetic coverage)', () => {
  assert.deepEqual(verifyDirectoryStat(syntheticStat(), UID), { ok: true });
  const wrongUid = verifyDirectoryStat(syntheticStat({ uid: UID + 1 }), UID);
  assert.equal(wrongUid.ok, false);
  assert.equal(wrongUid.code, 'ERR-STO-PERM-DENIED');
  const wrongMode = verifyDirectoryStat(syntheticStat({ mode: 0o40755 }), UID);
  assert.equal(wrongMode.ok, false);
  assert.equal(wrongMode.code, 'ERR-STO-PERM-DENIED');
  const groupBit = verifyDirectoryStat(syntheticStat({ mode: 0o40710 }), UID);
  assert.equal(groupBit.ok, false, 'group access bit must fail');
  const symlink = verifyDirectoryStat(syntheticStat({ isSymbolicLink: () => true }), UID);
  assert.equal(symlink.ok, false);
  const file = verifyDirectoryStat(syntheticStat({ isDirectory: () => false, isFile: () => true }), UID);
  assert.equal(file.ok, false);
});

test('root: pure regular-file policy (0600)', () => {
  assert.deepEqual(verifyRegularFileStat(syntheticStat({ isFile: () => true, isDirectory: () => false, mode: 0o100600 }), UID), { ok: true });
  const wrong = verifyRegularFileStat(syntheticStat({ isFile: () => true, isDirectory: () => false, mode: 0o100644 }), UID);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, 'ERR-STO-PERM-DENIED');
});

test('root: pre/post descriptor revalidation detects drift (W8C-D13)', () => {
  const base = syntheticStat({ isFile: () => true, isDirectory: () => false, mode: 0o100600, size: 128 });
  assert.deepEqual(comparePrePostStat(base, base), { ok: true });
  assert.equal(comparePrePostStat(base, syntheticStat({ ...base, ino: 999 })).ok, false, 'inode drift');
  assert.equal(comparePrePostStat(base, syntheticStat({ ...base, dev: 999 })).ok, false, 'device drift');
  assert.equal(comparePrePostStat(base, syntheticStat({ ...base, isFile: () => false })).ok, false, 'type drift');
  assert.equal(comparePrePostStat(base, syntheticStat({ ...base, uid: UID + 1 })).ok, false, 'owner drift');
  assert.equal(comparePrePostStat(base, syntheticStat({ ...base, mode: 0o100644 })).ok, false, 'mode drift');
  assert.equal(comparePrePostStat(base, syntheticStat({ ...base, size: 256 })).ok, false, 'size drift');
});

test('root: overlap rules (pure)', () => {
  assert.equal(pathsOverlap('/a', '/a'), true);
  assert.equal(pathsOverlap('/a', '/a/b'), true);
  assert.equal(pathsOverlap('/a/b', '/a'), true);
  assert.equal(pathsOverlap('/a', '/ab'), false);
  assert.equal(firstForbiddenOverlap('/a/b', ['/a']), '/a');
  assert.equal(firstForbiddenOverlap('/a/b', ['/x', '/a/b']), '/a/b');
  assert.equal(firstForbiddenOverlap('/a/b', ['/x']), undefined);
  assert.equal(namespaceRootsDistinct('/p/config-v1', '/p/store-v1'), true);
});

test('root: parent validation accepts a valid explicit locator', () => {
  const parent = mkdtempSync(join(tmpdir(), 'wp8c-root-'));
  chmodSync(parent, 0o700);
  const result = validateAndCaptureParent(parent, UID, []);
  assert.equal(result.ok, true);
  assert.equal(result.identity?.canonicalPath, parent);
  assert.equal(result.identity?.fileType, 'directory');
  const stat = statSync(parent);
  assert.equal(result.identity?.dev, Number(stat.dev));
  assert.equal(result.identity?.ino, Number(stat.ino));
  rmSync(parent, { recursive: true, force: true });
});

test('root: relative, root, missing, and non-directory locators fail closed', () => {
  assert.equal(validateAndCaptureParent('relative/path', UID, []).ok, false);
  assert.equal(validateAndCaptureParent('/', UID, []).ok, false);
  const parent = mkdtempSync(join(tmpdir(), 'wp8c-root-'));
  assert.equal(validateAndCaptureParent(join(parent, 'does-not-exist'), UID, []).ok, false);
  const file = join(parent, 'file');
  writeFileSync(file, 'x');
  assert.equal(validateAndCaptureParent(file, UID, []).ok, false);
  rmSync(parent, { recursive: true, force: true });
});

test('root: symlink final component fails closed', () => {
  const base = mkdtempSync(join(tmpdir(), 'wp8c-root-'));
  const target = join(base, 'target');
  mkdirSync(target, { mode: 0o700 });
  const link = join(base, 'link');
  symlinkSync(target, link);
  const result = validateAndCaptureParent(link, UID, []);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ERR-STO-ROOT-INVALID');
  rmSync(base, { recursive: true, force: true });
});

test('root: wrong mode and wrong owner fail closed (integration + synthetic)', () => {
  const parent = mkdtempSync(join(tmpdir(), 'wp8c-root-'));
  chmodSync(parent, 0o755);
  const loose = validateAndCaptureParent(parent, UID, []);
  assert.equal(loose.ok, false);
  assert.equal(loose.code, 'ERR-STO-PERM-DENIED');
  chmodSync(parent, 0o700);
  // Wrong owner cannot be forced without privileges; the pure predicate with
  // a synthetic stat provides deterministic coverage.
  assert.equal(verifyDirectoryStat(syntheticStat({ uid: 424242 }), UID).ok, false);
  rmSync(parent, { recursive: true, force: true });
});

test('root: forbidden-root overlap fails closed', () => {
  const parent = mkdtempSync(join(tmpdir(), 'wp8c-root-'));
  chmodSync(parent, 0o700);
  const result = validateAndCaptureParent(parent, UID, []);
  assert.equal(result.ok, true);
  assert.equal(checkForbiddenRootOverlap(result.identity!, [parent]).ok, false, 'exact equality');
  assert.equal(checkForbiddenRootOverlap(result.identity!, [join(parent, 'child')]).ok, false, 'child overlap');
  const other = mkdtempSync(join(tmpdir(), 'wp8c-other-'));
  assert.equal(checkForbiddenRootOverlap(result.identity!, [other]).ok, true, 'disjoint roots are fine');
  rmSync(parent, { recursive: true, force: true });
  rmSync(other, { recursive: true, force: true });
});

test('root: identity drift is detected by revalidation (SRX-010)', () => {
  const base = mkdtempSync(join(tmpdir(), 'wp8c-root-'));
  const parent = join(base, 'tp');
  mkdirSync(parent, { mode: 0o700 });
  const captured = validateAndCaptureParent(parent, UID, []);
  assert.equal(captured.ok, true);
  // Replacement by a non-directory at the same path must fail revalidation
  // (descriptor-bound open with O_DIRECTORY cannot succeed). Note: a
  // recreated directory may reuse the freed inode on some filesystems; the
  // contract identity model is device+inode+type, and type/descriptor checks
  // catch replacement by anything else.
  rmdirSync(parent);
  writeFileSync(parent, 'not a directory');
  const revalidated = revalidateParentIdentity(captured.identity!, UID);
  assert.equal(revalidated.ok, false);
  assert.equal(revalidated.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
  rmSync(base, { recursive: true, force: true });
});
