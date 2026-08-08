/**
 * WP-11 Slice 1 — controlled-write static security guards.
 *
 * Proves the writing module family:
 *   - the pure core (`controlled-write.ts`, `types.ts`) performs NO
 *     filesystem I/O: `node:fs` appears ONLY in the injected host executor
 *     module (`executor.ts`);
 *   - the core reuses the accepted WP-6 Phase 2B containment implementation
 *     (`evaluateProspectiveArtifactDestination`) and introduces NO parallel
 *     traversal/ancestor/symlink/containment/evidence logic;
 *   - no lifecycle, storage (WP-8), Git, execution, MCP, or transport
 *     machinery is imported anywhere in the family;
 *   - the fixed four-kind vocabulary is the accepted
 *     `ARTIFACT_DRAFT_LOCATION_KINDS` (no second list);
 *   - the executor is create-only (O_CREAT|O_EXCL|O_NOFOLLOW) with a fixed
 *     implementation-owned mode; no generic write/overwrite/rename/append
 *     API exists;
 *   - the executor anchors the mutation to a retained artifact-root
 *     descriptor (`/proc/self/fd/…`) and verifies the parent's
 *     descriptor-bound resolution path — no absolute lexical re-walk;
 *   - no network, subprocess, timers, randomness, environment, or global
 *     fetch access (equivalent-or-stronger than the generic security scan
 *     from which src/writing is excluded by boundary);
 *   - bare `fs` import spellings, `fs/promises`, dynamic fs imports, and
 *     `require('fs')` are forbidden everywhere (only `node:fs` in the
 *     executor);
 *   - the package root and `./mcp` do not expose the write capability.
 *
 * Future files added under src/writing/** are automatically covered (the
 * directory is walked at guard runtime).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const WRITING_SRC = join(REPO, 'src', 'writing');

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...collectTsFiles(full));
    else if (name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function rel(file: string): string {
  return file.slice(REPO.length + 1);
}

const writingFiles = collectTsFiles(WRITING_SRC);
assert.ok(writingFiles.length >= 3, 'the writing source tree must exist');

test('writing static guard: node:fs appears only in the injected host executor module', () => {
  for (const file of writingFiles) {
    const content = readFileSync(file, 'utf8');
    if (file.endsWith('executor.ts')) {
      assert.equal(content.includes("from 'node:fs'"), true, 'the executor owns the filesystem boundary');
      assert.equal(content.includes('openSync'), true);
      assert.equal(content.includes('writeSync'), true);
    } else {
      assert.equal(content.includes('node:fs'), false, `${rel(file)} must be I/O-free (no node:fs)`);
      assert.equal(content.includes('openSync'), false, `${rel(file)} must not reach fs primitives`);
      assert.equal(content.includes('writeSync'), false, `${rel(file)} must not reach fs primitives`);
      assert.equal(content.includes('unlinkSync'), false, `${rel(file)} must not reach fs primitives`);
    }
  }
});

test('writing static guard: no bare/dynamic fs import spellings or fs/promises anywhere (equivalent to the generic dist scan)', () => {
  for (const file of writingFiles) {
    const content = readFileSync(file, 'utf8');
    // The executor's canonical 'node:fs' import never contains these tokens.
    for (const forbidden of [
      "from 'fs'", 'from "fs"', "from 'fs/promises'", 'from "fs/promises"',
      "require('fs')", 'require("fs")', "require('fs/promises')", 'require("fs/promises")',
      'node:fs/promises',
      'import("fs")', 'import("node:fs")', "import('fs')", "import('node:fs')",
      "import('fs/promises')", 'import("fs/promises")',
    ]) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reach ${forbidden}`);
    }
  }
});

test('writing static guard: the core reuses the accepted Phase 2B containment implementation — no parallel containment logic', () => {
  const core = readFileSync(join(WRITING_SRC, 'controlled-write.ts'), 'utf8');
  assert.equal(core.includes('evaluateProspectiveArtifactDestination'), true, 'the core must call the accepted containment evaluator');
  assert.equal(core.includes('ARTIFACT_DRAFT_LOCATION_KINDS'), true, 'the accepted four-kind vocabulary is reused');
  assert.equal(core.includes('computeArtifactDigestOverCanonicalUtf8'), true, 'the accepted digest correlation check is reused');
  // No traversal/ancestor/symlink/containment/evidence logic may exist in the family outside the accepted evaluator.
  for (const file of writingFiles) {
    if (file.endsWith('executor.ts')) continue; // the executor performs the descriptor-bound open pattern only
    const content = readFileSync(file, 'utf8');
    for (const forbidden of ['lstat', 'realpath', 'readdir', 'readlink', 'statSync', 'isSymbolicLink', 'resolveProspectiveDestination = (', 'walk(', 'ancestorOf', 'contains(']) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not implement parallel filesystem observation or containment logic (${forbidden})`);
    }
  }
});

test('writing static guard: no lifecycle, storage, Git, execution, MCP, transport, network, or fetch capability', () => {
  for (const file of writingFiles) {
    const content = readFileSync(file, 'utf8');
    for (const forbidden of [
      '../../storage/', '../storage/', 'publishRecord', 'publishImmutableRecord', 'WriteCapability', 'createWriteCapability',
      '../../lifecycle/', '../lifecycle/', 'RuntimeGrant', 'approve', 'issue(', 'activate', 'revoke',
      '../../git/', '../git/', 'child_process', 'spawn(', 'exec(',
      '../../runtime/', '../runtime/', '@modelcontextprotocol', 'mcp/',
      'node:net', 'node:http', 'node:https', 'node:tls', 'node:dgram', 'WebSocket',
      'fetch(',
      'Math.random', 'Date.now', 'setTimeout', 'setInterval', 'process.env',
    ]) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reach ${forbidden}`);
    }
  }
});

test('writing static guard: the executor is create-only with a fixed mode and descriptor anchoring — no generic write/overwrite/rename/append API', () => {
  const executor = readFileSync(join(WRITING_SRC, 'executor.ts'), 'utf8');
  assert.equal(/O_CREAT \| O_EXCL \| O_WRONLY \| O_NOFOLLOW/.test(executor), true, 'exclusive create with no-follow');
  assert.equal(/DRAFT_FILE_MODE = 0o600/.test(executor), true, 'fixed implementation-owned mode');
  for (const forbidden of ['renameSync', 'copyFileSync', 'appendFileSync', 'truncateSync', 'mkdirSync', 'writeFileSync', 'rmSync', 'chownSync']) {
    assert.equal(executor.includes(forbidden), false, `executor must not reach ${forbidden}`);
  }
  assert.equal(/\blinkSync\b/.test(executor), false, 'executor must not reach linkSync (the only *linkSync tokens are the cleanup unlinkSync and the identity readlinkSync)');
  assert.equal(executor.includes('O_TRUNC'), false, 'no truncate/overwrite flag');
  assert.equal(executor.includes('fsyncSync'), false, 'fsync/durability policy remains deferred');
  // Exactly one exclusive-create site and exactly one cleanup-unlink site
  // (at most one bounded best-effort partial-write removal attempt).
  assert.equal((executor.match(/openSync\(createPath/g) ?? []).length, 1, 'exactly one target create site, descriptor-anchored');
  assert.equal((executor.match(/unlinkSync\(/g) ?? []).length, 1, 'exactly one cleanup-unlink site');
  assert.equal((executor.match(/function cleanupCreatedTarget\(/g) ?? []).length, 1, 'single bounded cleanup helper definition');
  // Descriptor anchoring: the mutation is derived relative to a retained
  // artifact-root descriptor and verified against the accepted canonical
  // ancestor — never an absolute lexical re-walk.
  assert.equal(executor.includes('/proc/self/fd/'), true, 'descriptor-anchored path derivation');
  assert.equal(executor.includes('readlinkSync'), true, 'descriptor-bound resolution-path identity verification');
  assert.equal(executor.includes('parent-not-verified'), true, 'intermediate-swap divergence fails closed');
  assert.equal(executor.includes('canonicalAncestorRelativePath'), true, 'decision-derived canonical ancestor relative path');
  assert.equal(executor.includes('destinationTailComponents'), true, 'decision-derived missing tail');
  // Single-component create invariant: the create/unlink path is exactly
  // ONE final component below the verified parent. A multi-component tail
  // must fail closed before any mutation, and no joined-tail path may ever
  // reach openSync/unlinkSync (O_NOFOLLOW protects only a final component).
  assert.equal(executor.includes('tail.length !== 1'), true, 'single-component tail invariant enforced before mutation');
  assert.equal(executor.includes('tail.length === 0'), true, 'zero-length tail classified as invalid evidence');
  assert.equal(executor.includes('tail.join'), false, 'no joined multi-component tail path may exist');
  assert.equal(executor.includes('finalComponent'), true, 'create/unlink consume the single final component');
  assert.equal(executor.includes('missing-parent'), true, 'multi-component tail fails closed as missing-parent');
  assert.equal((executor.match(/cleanupCreatedTarget\(parentFd, finalComponent\)/g) ?? []).length >= 4, true, 'every post-create failure cleanup uses the same verified parent + single component');
});

test('writing static guard: the write capability is not exposed through the package root or ./mcp', () => {
  const root = readFileSync(join(REPO, 'src', 'index.ts'), 'utf8');
  const mcp = readFileSync(join(REPO, 'src', 'adapters', 'mcp', 'index.ts'), 'utf8');
  for (const forbidden of ['persistValidatedArtifactDraft', 'executeDraftFileWrite', 'writeLoop', 'from \'../writing/', 'from \'../../writing/', 'controlled-write', 'writing/']) {
    assert.equal(root.includes(forbidden), false, `package root must not expose ${forbidden}`);
    assert.equal(mcp.includes(forbidden), false, `./mcp must not expose ${forbidden}`);
  }
});
