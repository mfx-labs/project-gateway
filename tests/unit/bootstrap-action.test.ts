/**
 * PS-1 — control-plane storage bootstrap action tests.
 *
 * Proves the operator bootstrap action (`src/control-plane/
 * storage-bootstrap-action.ts`):
 *   - fully absent store initializes; the derived configuration identity is
 *     exact and deterministic;
 *   - the resolved runtime surface is accepted by strict normal startup
 *     configuration validation (`loadRuntimeConfig`);
 *   - exact idempotent replay: repeated bootstrap is verification-only and
 *     creates no fresh authority/state (identities and digests unchanged);
 *   - fail-closed states: partial, foreign, unsupported-version, wrong
 *     mode/ownership, forbidden-root overlap, conflicting supplied
 *     identity, invalid configuration;
 *   - authority authenticity: no provenance/action identity is exposed in
 *     any result, and the producer is not reachable through package
 *     surfaces.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapStore } from '../../src/control-plane/storage-bootstrap-action.js';
import { TRUSTED_HOST_LANE, DARWIN_ARM64_HOST_LANE } from '../../src/trusted/index.js';
import { createRootPathResolver, createArtifactLocationResolver } from '../../src/runtime/mcp/lanes.js';
import { loadRuntimeConfig } from '../../src/runtime/mcp/config.js';

const UID = process.getuid?.() ?? 0;
const SHA256_RE = /^sha-256:[0-9a-f]{64}$/;

function makeEnv(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ps1-bootstrap-action-'));
  chmodSync(dir, 0o700);
  return dir;
}

/**
 * The trusted parent (locator) must ALREADY exist as an operator-owned 0700
 * directory: the storage engine never creates parents (fail-closed
 * SRX-005/ADR-028). The operator (pi-shuttle `project add`) provisions it.
 */
function makeLocator(env: string): string {
  const locator = join(env, 'store');
  mkdirSync(locator, { mode: 0o700 });
  chmodSync(locator, 0o700);
  return locator;
}

/** Default action input over a fresh empty locator (no workspaces). */
function baseInput(locator: string, overrides: Record<string, unknown> = {}): Parameters<typeof bootstrapStore>[0] {
  return {
    surfaceId: 'main',
    locator,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationVersion: '2',
    hostLane: TRUSTED_HOST_LANE,
    limitProfile: {},
    workspaces: [],
    resolvers: { resolveRootPath: createRootPathResolver() },
    ...overrides,
  } as Parameters<typeof bootstrapStore>[0];
}

function inputWithWorkspace(locator: string, workspaceRoot: string, artifactLocation?: string): Parameters<typeof bootstrapStore>[0] {
  return baseInput(locator, {
    workspaces: [{ workspaceId: 'pgw:w:testworkspace0000000000000000000', root: workspaceRoot, ...(artifactLocation !== undefined ? { artifactLocation } : {}) }],
    resolvers: {
      resolveRootPath: createRootPathResolver(),
      ...(artifactLocation !== undefined ? { resolveArtifactLocation: createArtifactLocationResolver() } : {}),
    },
  });
}

test('bootstrap action: fully absent store initializes; derived identity is exact and deterministic', () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const result = bootstrapStore(baseInput(locator));
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.state, 'INITIALIZED');
  assert.equal(SHA256_RE.test(result.configurationIdentity), true, 'derived identity must use sha-256:<64-hex> syntax');
  assert.equal(result.namespaceIdentities?.length, 2);
  assert.equal(result.metadataDigests?.length, 2);
  // Both namespaces with the fixed bootstrap entries exist.
  for (const ns of ['store-v1', 'config-v1']) {
    assert.equal(statSync(join(locator, ns)).isDirectory(), true, `${ns} must exist`);
    const entries = readdirSync(join(locator, ns)).sort();
    assert.deepEqual(entries, ['metadata', 'tmp'], `${ns} must contain exactly metadata/ and tmp/ after initialization (lazy provisioning)`);
  }
  // Same input on a different locator derives the same identity (determinism).
  const locator2 = mkdtempSync(join(env, 'store2-')); chmodSync(locator2, 0o700);
  const result2 = bootstrapStore(baseInput(locator2));
  assert.equal(result2.ok, true);
  if (!result2.ok) return;
  assert.equal(result2.configurationIdentity, result.configurationIdentity, 'identity must be deterministic across locators');
  // The resolved surface carries the derived identity and the closed facts.
  assert.equal(result.resolved.configurationIdentity, result.configurationIdentity);
  assert.equal(result.resolved.surfaceId, 'main');
  assert.equal(result.resolved.locator, locator);
  assert.deepEqual(result.resolved.workspaces, []);
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap action: workspace surface resolves canonical root and artifact location', () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const workspaceRoot = join(env, 'project');
  mkdirSync(workspaceRoot, { mode: 0o700 });
  const artifacts = join(workspaceRoot, 'artifacts');
  mkdirSync(artifacts, { mode: 0o700 });
  const result = bootstrapStore(inputWithWorkspace(locator, workspaceRoot, artifacts));
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.resolved.workspaces.length, 1);
  const record = result.resolved.workspaces[0]!;
  assert.equal(record.workspaceId, 'pgw:w:testworkspace0000000000000000000');
  assert.equal(record.root, workspaceRoot, 'resolved root must be the canonical root');
  assert.equal(record.artifactLocation, artifacts);
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap action: operator Git-lane facts pass through to the resolved surface', () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const gitHome = join(env, 'git-home');
  mkdirSync(gitHome, { mode: 0o700 });
  const gitTmp = join(env, 'git-tmp');
  mkdirSync(gitTmp, { mode: 0o700 });
  const result = bootstrapStore(baseInput(locator, { gitPath: '/usr/bin/git', gitHome, gitTmpdir: gitTmp }));
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.resolved.gitPath, '/usr/bin/git');
  assert.equal(result.resolved.gitHome, gitHome);
  assert.equal(result.resolved.gitTmpdir, gitTmp);
  // Absent facts stay absent (never invented).
  const env2 = makeEnv();
  const plain = bootstrapStore(baseInput(makeLocator(env2)));
  assert.equal(plain.ok, true);
  if (!plain.ok) return;
  assert.equal(plain.resolved.gitPath, undefined);
  assert.equal(plain.resolved.gitHome, undefined);
  assert.equal(plain.resolved.gitTmpdir, undefined);
  rmSync(env2, { recursive: true, force: true });
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap action: resolved runtime surface is accepted by strict normal startup validation', () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const result = bootstrapStore(baseInput(locator));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const configPath = join(env, 'runtime.json');
  writeFileSync(configPath, JSON.stringify({ surfaces: [result.resolved] }), { mode: 0o600 });
  const loaded = loadRuntimeConfig(configPath);
  assert.equal(loaded.ok, true, loaded.ok ? '' : loaded.message);
  if (loaded.ok) {
    assert.equal(loaded.config.surfaces[0]?.configurationIdentity, result.configurationIdentity);
  }
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap action: exact idempotent replay is verification-only (no fresh authority/state)', () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const first = bootstrapStore(baseInput(locator));
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = bootstrapStore(baseInput(locator));
  assert.equal(second.ok, true, JSON.stringify(second));
  if (!second.ok) return;
  assert.equal(second.state, 'INITIALIZED');
  assert.equal(second.configurationIdentity, first.configurationIdentity);
  // Same namespace identities (device/inode) and same metadata digests:
  // nothing was re-created or re-authored.
  assert.deepEqual(second.namespaceIdentities, first.namespaceIdentities);
  assert.deepEqual(second.metadataDigests, first.metadataDigests);
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap action: conflicting supplied identity fails closed before any storage mutation', () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const wrong = 'sha-256:' + 'b'.repeat(64);
  const result = bootstrapStore(baseInput(locator, { configurationIdentity: wrong }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'ERR-BOOT-IDENTITY-CONFLICT');
  assert.equal(existsSync(join(locator, 'store-v1')), false, 'no store may be created on identity conflict');
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap action: exact matching supplied identity is accepted (replay composition)', () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const first = bootstrapStore(baseInput(locator));
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = bootstrapStore(baseInput(locator, { configurationIdentity: first.configurationIdentity }));
  assert.equal(second.ok, true, JSON.stringify(second));
  if (!second.ok) return;
  assert.equal(second.configurationIdentity, first.configurationIdentity);
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap action: partial store fails closed (ERR-STO-RECOVERY-REQUIRED)', () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  assert.equal(bootstrapStore(baseInput(locator)).ok, true);
  rmSync(join(locator, 'config-v1'), { recursive: true, force: true });
  const result = bootstrapStore(baseInput(locator));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'ERR-STO-RECOVERY-REQUIRED');
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap action: foreign store fails closed (ERR-STO-INTEGRITY)', () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  assert.equal(bootstrapStore(baseInput(locator)).ok, true);
  // `index` is contract-reserved and never created by initialization; its
  // presence is an unknown entry and fails closed.
  mkdirSync(join(locator, 'store-v1', 'index'), { mode: 0o700 });
  const result = bootstrapStore(baseInput(locator));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'ERR-STO-INTEGRITY');
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap action: unsupported metadata version fails closed (ERR-STO-UNSUPPORTED-VERSION)', () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  assert.equal(bootstrapStore(baseInput(locator)).ok, true);
  const metadataPath = join(locator, 'store-v1', 'metadata', 'metadata.json');
  const original = readFileSync(metadataPath, 'utf8');
  const tampered = original.replace('"formatVersion":"1.0"', '"formatVersion":"9.9"');
  assert.notEqual(tampered, original, 'tamper must alter the metadata');
  writeFileSync(metadataPath, tampered, { mode: 0o600 });
  const result = bootstrapStore(baseInput(locator));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'ERR-STO-UNSUPPORTED-VERSION');
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap action: wrong namespace mode fails closed (ERR-STO-INTEGRITY)', () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  assert.equal(bootstrapStore(baseInput(locator)).ok, true);
  chmodSync(join(locator, 'config-v1'), 0o755);
  const result = bootstrapStore(baseInput(locator));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'ERR-STO-INTEGRITY');
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap action: forbidden-root overlap fails closed (ERR-STO-ROOT-INVALID)', () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const result = bootstrapStore(baseInput(locator, { forbiddenRoots: [locator] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'ERR-STO-ROOT-INVALID');
  assert.equal(existsSync(join(locator, 'store-v1')), false, 'no store may be created on root overlap');
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap action: invalid trusted configuration fails closed (ERR-BOOT-CONFIG-INVALID)', () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  // Nonexistent workspace root cannot be canonicalized by the real resolver.
  const result = bootstrapStore(inputWithWorkspace(locator, join(env, 'does-not-exist')));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'ERR-BOOT-CONFIG-INVALID');
  assert.equal(existsSync(join(locator, 'store-v1')), false);
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap action: results expose no provenance or authority-bearing values', () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const result = bootstrapStore(baseInput(locator));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('actionIdentity'), false, 'no action identity may be serialized');
  assert.equal(serialized.includes('"provenance"'), false, 'no provenance may be serialized');
  assert.equal(serialized.includes('WeakSet'), false, 'no brand object may be serialized');
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap action: producer is not publicly exported through package surfaces', () => {
  const repo = join(import.meta.dirname, '..', '..', '..');
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { exports?: Record<string, unknown> };
  const exportsMap = pkg.exports ?? {};
  for (const subpath of Object.keys(exportsMap)) {
    assert.equal(subpath.includes('bootstrap'), false, `package export ${subpath} must not expose the bootstrap producer`);
    assert.equal(subpath.includes('control-plane'), false, `package export ${subpath} must not expose the control plane`);
  }
  const root = readFileSync(join(repo, 'src', 'index.ts'), 'utf8');
  const mcp = readFileSync(join(repo, 'src', 'adapters', 'mcp', 'index.ts'), 'utf8');
  assert.equal(root.includes('storage-bootstrap-action'), false, 'src/index.ts must not export the bootstrap action');
  assert.equal(mcp.includes('storage-bootstrap-action'), false, './mcp must not export the bootstrap action');
});

// ─── PS-6 cross-lane replay invariant ─────────────────────────────────────

test('PS6: linux-lane store identity differs from darwin-arm64 identity for identical inputs', () => {
  const env = makeEnv();
  const env2 = makeEnv();
  const linux = bootstrapStore(baseInput(makeLocator(env)));
  const darwin = bootstrapStore(baseInput(makeLocator(env2), { hostLane: DARWIN_ARM64_HOST_LANE }));
  assert.equal(linux.ok, true);
  assert.equal(darwin.ok, true);
  if (!linux.ok || !darwin.ok) return;
  assert.notEqual(linux.configurationIdentity, darwin.configurationIdentity, 'host lane is identity-bound: lanes must produce different identities');
  rmSync(env, { recursive: true, force: true });
  rmSync(env2, { recursive: true, force: true });
});

test('PS6: a store created under one accepted lane cannot be replayed under the other lane (fail closed, no repair)', () => {
  const env = makeEnv();
  const locator = makeLocator(env);

  // 1. Initialize under the Linux lane.
  const created = bootstrapStore(baseInput(locator));
  assert.equal(created.ok, true, JSON.stringify(created));
  if (!created.ok) return;
  assert.equal(created.state, 'INITIALIZED');
  const metadataBytesAfterCreate = [
    readFileSync(join(locator, 'store-v1', 'metadata', 'metadata.json')),
    readFileSync(join(locator, 'config-v1', 'metadata', 'metadata.json')),
  ];

  // 2. Cross-lane replay attempt under the darwin-arm64 lane: the derived
  //    configuration identity differs, so the recorded metadata binding
  //    cannot match — the existing storage classification fails closed
  //    (FOREIGN aggregate → ERR-STO-INTEGRITY), and nothing is repaired,
  //    migrated, or rewritten.
  const replayed = bootstrapStore(baseInput(locator, { hostLane: DARWIN_ARM64_HOST_LANE }));
  assert.equal(replayed.ok, false, 'cross-lane replay must fail closed');
  if (replayed.ok) return;
  assert.equal(replayed.code, 'ERR-STO-INTEGRITY', `unexpected failure classification: ${replayed.code}`);

  // 3. The Linux-bound store is untouched (no rewrite, no migration).
  const metadataBytesAfterReplay = [
    readFileSync(join(locator, 'store-v1', 'metadata', 'metadata.json')),
    readFileSync(join(locator, 'config-v1', 'metadata', 'metadata.json')),
  ];
  assert.deepEqual(metadataBytesAfterReplay, metadataBytesAfterCreate, 'cross-lane replay must never mutate the store');

  // 4. Replaying under the ORIGINAL lane still succeeds (verification-only
  //    replay) — the store remains fully usable under its own lane.
  const replayedOwnLane = bootstrapStore(baseInput(locator));
  assert.equal(replayedOwnLane.ok, true, JSON.stringify(replayedOwnLane));
  if (!replayedOwnLane.ok) return;
  assert.equal(replayedOwnLane.state, 'INITIALIZED');
  assert.equal(replayedOwnLane.configurationIdentity, created.configurationIdentity);
  rmSync(env, { recursive: true, force: true });
});

test('PS6: mirrored direction — a store created under darwin-arm64 cannot be replayed under the linux lane (fail closed, no repair)', () => {
  const env = makeEnv();
  const locator = makeLocator(env);

  // 1. Initialize under the darwin-arm64 lane.
  const created = bootstrapStore(baseInput(locator, { hostLane: DARWIN_ARM64_HOST_LANE }));
  assert.equal(created.ok, true, JSON.stringify(created));
  if (!created.ok) return;
  assert.equal(created.state, 'INITIALIZED');
  const metadataBytesAfterCreate = [
    readFileSync(join(locator, 'store-v1', 'metadata', 'metadata.json')),
    readFileSync(join(locator, 'config-v1', 'metadata', 'metadata.json')),
  ];

  // 2. Cross-lane replay attempt under the linux lane: the derived
  //    configuration identity differs, so the existing metadata binding
  //    cannot match — the same storage classification fails closed
  //    (FOREIGN aggregate → ERR-STO-INTEGRITY); nothing is repaired,
  //    migrated, or rewritten.
  const replayed = bootstrapStore(baseInput(locator));
  assert.equal(replayed.ok, false, 'cross-lane replay must fail closed');
  if (replayed.ok) return;
  assert.equal(replayed.code, 'ERR-STO-INTEGRITY', `unexpected failure classification: ${replayed.code}`);

  // 3. The darwin-bound store is untouched (no rewrite, no migration).
  const metadataBytesAfterReplay = [
    readFileSync(join(locator, 'store-v1', 'metadata', 'metadata.json')),
    readFileSync(join(locator, 'config-v1', 'metadata', 'metadata.json')),
  ];
  assert.deepEqual(metadataBytesAfterReplay, metadataBytesAfterCreate, 'cross-lane replay must never mutate the store');

  // 4. Replaying under the ORIGINAL (darwin-arm64) lane still succeeds.
  const replayedOwnLane = bootstrapStore(baseInput(locator, { hostLane: DARWIN_ARM64_HOST_LANE }));
  assert.equal(replayedOwnLane.ok, true, JSON.stringify(replayedOwnLane));
  if (!replayedOwnLane.ok) return;
  assert.equal(replayedOwnLane.state, 'INITIALIZED');
  assert.equal(replayedOwnLane.configurationIdentity, created.configurationIdentity);
  rmSync(env, { recursive: true, force: true });
});
