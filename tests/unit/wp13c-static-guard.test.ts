/**
 * WP-13C — publication authority static security guards.
 *
 * Proves the module family (src/publication/**):
 *   - is filesystem-free (NO node:fs anywhere: the authority publishes ONLY
 *     through the WP-8 `publishRecord` path via the narrow boundary);
 *   - has no network/process/timer/crypto/environment surface;
 *   - imports the WP-8 storage surface ONLY through the exact allowed
 *     modules (store-boundary.ts = the single publication boundary;
 *     capability.ts = the pure layout/destination derivation for the
 *     exact-record permit; publish.ts = the WP-8 envelope digest convention
 *     for permit/replay binding), and `publishRecord` itself ONLY in
 *     store-boundary.ts;
 *   - never uses the WP-12 publish path (`publishLifecycleRecord`) and
 *     carries no WP-13D/WP-15 vocabulary (no TrustedReceipt, no
 *     ExecutionRetrospectiveFacts, no privileged publication scopes);
 *   - capability/permit internals are never exported from the package
 *     barrel (CAP-011/014/015: no creator, no brand verifier, no WeakSet
 *     brand state in public exports).
 *
 * Future files added under src/publication/** are automatically covered
 * (the directory is walked at guard runtime).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const PUBLICATION_SRC = join(REPO, 'src', 'publication');

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

const publicationFiles = collectTsFiles(PUBLICATION_SRC);
assert.ok(publicationFiles.length >= 5, 'the publication source tree must exist');

/** Strip comments so honest prose never trips the guards; imports and code are scanned verbatim. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

test('publication static guard: filesystem-free; no network/process/timer/crypto/env surface', () => {
  for (const file of publicationFiles) {
    const content = codeOf(file);
    for (const forbidden of [
      'node:fs',
      "from 'fs'",
      "require('fs')",
      'fs/promises',
      'node:crypto',
      'node:net',
      'node:http',
      'node:https',
      'node:tls',
      'node:dgram',
      'node:child_process',
      'child_process',
      'spawn(',
      'exec(',
      'fetch(',
      'WebSocket',
      'process.env',
      'Date.now(',
      'Math.random',
      'setTimeout',
      'setInterval',
      'setImmediate',
      'queueMicrotask',
      'process.nextTick',
    ]) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
  }
});

test('publication static guard: WP-8 surface confined to the exact boundary modules', () => {
  for (const file of publicationFiles) {
    const content = codeOf(file);
    const base = file.split('/').pop() ?? '';
    if (base === 'store-boundary.ts') {
      // The single WP-8 publication/read boundary: publishRecord + read +
      // enumerate live here and nowhere else.
      assert.ok(content.includes("from '../storage/publication/index.js'"), 'store-boundary must own publishRecord');
    } else if (base === 'capability.ts') {
      // The exact-record permit needs the pure layout derivation only.
      assert.ok(!content.includes('../storage/publication/'), `publication surface in ${rel(file)}`);
      assert.ok(!content.includes('../storage/read/'), `read surface in ${rel(file)}`);
      assert.ok(content.includes("../storage/layout/layout.js"), 'capability.ts must own the destination derivation');
    } else if (base === 'publish.ts') {
      // The authority uses the WP-8 envelope digest convention for the
      // permit/replay binding only — never the publication/read surface.
      assert.ok(!content.includes('../storage/publication/'), `publication surface in ${rel(file)}`);
      assert.ok(!content.includes('../storage/read/'), `read surface in ${rel(file)}`);
    } else if (base === 'types.ts') {
      // Type-only vocabulary imports (WP-8 result/envelope types) are
      // permitted; no runtime storage surface may be imported.
      assert.ok(!content.includes('../storage/publication/'), `publication surface in ${rel(file)}`);
      assert.ok(!content.includes('../storage/read/'), `read surface in ${rel(file)}`);
      assert.ok(!content.includes('../storage/layout/'), `layout surface in ${rel(file)}`);
      assert.ok(!content.includes('../storage/format/'), `format surface in ${rel(file)}`);
    } else {
      for (const forbidden of ["'../storage/", "'../storage'", "from '../storage/", "from '../storage'"]) {
        assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
      }
    }
  }
});

test('publication static guard: no WP-12 publish path, no WP-13D/WP-15 vocabulary', () => {
  for (const file of publicationFiles) {
    const content = codeOf(file);
    for (const forbidden of [
      'publishLifecycleRecord',
      'executeSlice1Command',
      'recordValidation',
      'TrustedReceipt',
      'trusted-receipt',
      'TrustedReceiptRecord',
      'ExecutionRetrospectiveFacts',
      'ExecutionSummaryRecord',
      'completion-status',
      'downstream-automation',
      'authoritative-reporting',
      'SupersessionRecord',
      'decideActivation',
      'issueRuntimeGrant',
    ]) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
  }
});

test('publication static guard: capability/permit internals never exported from the barrel', () => {
  const barrel = codeOf(join(PUBLICATION_SRC, 'index.ts'));
  for (const forbidden of [
    'createResultPublicationCapability',
    'createResultPublicationPermit',
    'isGenuineResultPublicationCapability',
    'isGenuineResultPublicationPermit',
    'resultPublicationPermitLive',
    'WeakSet',
    'capabilityBrand',
    'permitBrand',
  ]) {
    assert.ok(!barrel.includes(forbidden), `${forbidden} in src/publication/index.ts`);
  }
  // The barrel exposes the authority entry and the narrow boundary factory only.
  assert.ok(barrel.includes('publishValidatedResult'), 'the authority entry must be exported');
  assert.ok(barrel.includes('createPublicationStoreBoundary'), 'the boundary factory must be exported');
});
