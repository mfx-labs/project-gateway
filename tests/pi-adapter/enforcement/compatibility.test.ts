/**
 * WP-5B unit tests — pi-guard compatibility (predicate 12–17) and lane
 * discovery over the captured trusted API.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  verifyTrustedProjectionApi,
  guardCompatibilityFingerprint,
  GUARD_PROJECTION_SCHEMA,
  GUARD_MODE_SET,
  GUARD_RESERVED_TOOL_IDS,
} from '../../../src/adapters/pi/enforcement/compatibility.js';
import { inspectGuardPackage } from '../../../src/adapters/pi/enforcement/guard-host-harness.js';
import { createFakeGuard } from './fake-guard.js';
import type { TrustedProjectionApi } from '../../../src/adapters/pi/enforcement/types.js';

test('a compatible captured API passes the surface predicate (12) and is frozen', () => {
  const { api } = createFakeGuard();
  const result = verifyTrustedProjectionApi(api);
  assert.equal(result.compatible, true);
  assert.equal(result.piGuardVersion, '0.1.2');
  assert.deepEqual([...result.observedSurface.apiMethods].sort(), ['applyTrustedProjection', 'inspectActiveProjection', 'restoreTrustedProjection']);
  assert.equal(result.observedSurface.frozen, true);
  assert.match(result.fingerprint, /^sha-256:[0-9a-f]{64}$/);
});

test('an API with a missing operation is incompatible', () => {
  const { api } = createFakeGuard();
  const broken = Object.freeze({ applyTrustedProjection: api.applyTrustedProjection, restoreTrustedProjection: api.restoreTrustedProjection }) as unknown as TrustedProjectionApi;
  assert.equal(verifyTrustedProjectionApi(broken).compatible, false);
});

test('an API with an extra operation is incompatible (exact surface only)', () => {
  const { api } = createFakeGuard();
  const extra = Object.freeze({ ...{ applyTrustedProjection: api.applyTrustedProjection, inspectActiveProjection: api.inspectActiveProjection, restoreTrustedProjection: api.restoreTrustedProjection }, extra: () => 1 }) as unknown as TrustedProjectionApi;
  assert.equal(verifyTrustedProjectionApi(extra).compatible, false);
});

test('compatibility fingerprint is deterministic over the same surface', () => {
  const input = {
    packageId: 'pi-guard',
    version: '0.1.2',
    releasedCommit: '7a7580cc4cbd7926797564c72269394fc29a860a',
    releasedTag: 'v0.1.2',
    apiMethods: ['applyTrustedProjection', 'inspectActiveProjection', 'restoreTrustedProjection'],
    frozen: true,
    projectionVersion: 1,
  };
  assert.equal(guardCompatibilityFingerprint(input), guardCompatibilityFingerprint(input));
  assert.match(guardCompatibilityFingerprint(input), /^sha-256:[0-9a-f]{64}$/);
});

test('predicate surface constants are exactly the verified lane surface', () => {
  assert.deepEqual(GUARD_PROJECTION_SCHEMA, ['projectionVersion', 'projectionIdentity', 'allowedToolNames', 'inventoryFingerprint']);
  assert.deepEqual(GUARD_MODE_SET, ['OFF', 'INSPECT', 'EDIT', 'WRITE', 'PROJECTED']);
  assert.deepEqual(GUARD_RESERVED_TOOL_IDS, ['bash', 'edit', 'write', 'git_inspect']);
});

test('package inspection is environment-gated (reports not-gated without a path)', async () => {
  const saved = process.env['PGW_PI_GUARD_PACKAGE_PATH'];
  delete process.env['PGW_PI_GUARD_PACKAGE_PATH'];
  try {
    const result = await inspectGuardPackage();
    assert.equal(result.inspected, false);
    assert.equal(result.compatible, false);
    assert.ok(result.findings.some((f) => f.key === 'guard.harness-not-gated'));
  } finally {
    if (saved !== undefined) process.env['PGW_PI_GUARD_PACKAGE_PATH'] = saved;
  }
});

test('package inspection verifies identity/version/extension entry at the gated path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pgw-guard-'));
  try {
    mkdirSync(join(dir, 'extensions', 'pi-guard'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pi-guard', version: '0.1.2' }));
    writeFileSync(join(dir, 'extensions', 'pi-guard', 'index.ts'), 'export default function(){}');
    const ok = await inspectGuardPackage(dir);
    assert.equal(ok.compatible, true);
    assert.equal(ok.version, '0.1.2');
    assert.equal(ok.packageId, 'pi-guard');

    // wrong version fails closed
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pi-guard', version: '0.1.1' }));
    const wrong = await inspectGuardPackage(dir);
    assert.equal(wrong.compatible, false);
    assert.ok(wrong.findings.some((f) => f.key === 'guard.version-drift'));

    // wrong identity fails closed
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'other', version: '0.1.2' }));
    const wrongId = await inspectGuardPackage(dir);
    assert.equal(wrongId.compatible, false);
    assert.ok(wrongId.findings.some((f) => f.key === 'guard.package-identity'));

    // missing extension entry fails closed
    rmSync(join(dir, 'extensions'), { recursive: true, force: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pi-guard', version: '0.1.2' }));
    const missingEntry = await inspectGuardPackage(dir);
    assert.equal(missingEntry.compatible, false);
    assert.ok(missingEntry.findings.some((f) => f.key === 'guard.extension-entry-missing'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
