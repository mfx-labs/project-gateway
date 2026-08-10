/**
 * WP-13B — completion/result static security guards.
 *
 * Proves the module family (src/completion/**):
 *   - is I/O-free EXCEPT the narrow result-write executor (writer.ts is the
 *     ONLY node:fs module in the family — the WP-13 result-write boundary);
 *   - never activates/restores pi-guard (no apply/inspect/restore projection
 *     API, no enforcement run, no guard package inspection, no surface
 *     observation) — WP-5B remains the single enforcement owner;
 *   - never publishes lifecycle records (no WP-8 publish path, no store
 *     boundary, no record builders, no coordination lock) — the ONLY
 *     lifecycle-record production is the WP-12 `recordValidation` command
 *     (WP-12 remains the trusted producer);
 *   - carries no WP-13C/D vocabulary — no ResultPublicationRecord, no
 *     publication scopes, no ExecutionRetrospectiveFacts, no TrustedReceipt,
 *     no ExecutionSummaryRecord;
 *   - contains no scheduler primitives;
 *   - does not expose trusted mutation authority through the package root.
 *
 * Future files added under src/completion/** are automatically covered (the
 * directory is walked at guard runtime).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const COMPLETION_SRC = join(REPO, 'src', 'completion');

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

const completionFiles = collectTsFiles(COMPLETION_SRC);
assert.ok(completionFiles.length >= 5, 'the completion source tree must exist');

/** Strip comments (block + line) so honest prose never trips the guards;
 *  imports and code are scanned verbatim. */
function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

function codeOf(file: string): string {
  return stripComments(readFileSync(file, 'utf8'));
}

test('completion static guard: I/O is confined to the result-write executor (writer.ts)', () => {
  for (const file of completionFiles) {
    const content = codeOf(file);
    const base = file.split('/').pop() ?? '';
    const ioSurface = ['node:fs', "from 'fs'", "require('fs')", 'fs/promises', 'node:crypto', 'node:net', 'node:http', 'node:https', 'node:tls', 'node:dgram', 'node:child_process', 'child_process', 'spawn(', 'exec(', 'fetch(', 'WebSocket', 'process.env', 'Date.now(', 'Math.random'];
    if (base === 'writer.ts') {
      // The executor is the ONLY filesystem-mutation boundary; it must not
      // reach network/process/timers/crypto (identities are host-injected),
      // but node:fs is its raison d'être.
      for (const forbidden of ['node:net', 'node:http', 'node:https', 'node:tls', 'node:dgram', 'node:child_process', 'child_process', 'spawn(', 'exec(', 'fetch(', 'WebSocket', 'process.env', 'Date.now(', 'Math.random', 'node:crypto', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'process.nextTick']) {
        assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
      }
    } else {
      for (const forbidden of ioSurface) {
        assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
      }
      assert.ok(!content.includes('setTimeout') && !content.includes('setInterval') && !content.includes('setImmediate') && !content.includes('queueMicrotask'), `scheduler primitive in ${rel(file)}`);
    }
  }
});

test('completion static guard: never activates/restores pi-guard; no enforcement-run or guard APIs', () => {
  for (const file of completionFiles) {
    const content = codeOf(file);
    for (const forbidden of [
      'applyTrustedProjection',
      'restoreTrustedProjection',
      'inspectActiveProjection',
      'runTrustedEnforcement',
      'inspectGuardPackage',
      'observeEffectiveSurface',
      'verifyTrustedProjectionApi',
      'guard-host-harness',
      'buildTrustedProjection',
      'readEnforcementState',
    ]) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
  }
});

test('completion static guard: no publication, no receipt, no WP-13C/D vocabulary', () => {
  for (const file of completionFiles) {
    const content = codeOf(file);
    for (const forbidden of [
      'publishRecord',
      'publishLifecycleRecord',
      'ResultPublicationRecord',
      'result-publication',
      'publicationScope',
      'publication_scopes',
      'TrustedReceipt',
      'trusted-receipt',
      'receipt_correlations',
      'ExecutionRetrospectiveFacts',
      'ExecutionSummaryRecord',
      'SupersessionRecord',
      'RevocationRecord',
      'record builders',
      'storage/',
      'withLock',
      'coordinate',
      'decideActivation',
      'issueRuntimeGrant',
      'evaluatePointOfUseEligibility',
      'lifecycle/graph',
      // SIR-WP13B-001: no content-derived identity protocol may exist in
      // the family (opaque host-injected identities only).
      'PGAP-EXECUTION-RESULT-INSTANCE',
      'PGAP-EXECUTION-RESULT-REVISION',
      'PGAP-EXECUTION-RESULT-BODY',
      'PGAP-EXECUTION-OBSERVATION-EVIDENCE',
      'domainDigest',
      'createHash',
    ]) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
  }
});

test('completion static guard: the barrel exposes no mutation authority', () => {
  const barrel = codeOf(join(COMPLETION_SRC, 'index.ts'));
  for (const forbidden of ['publish', 'activate', 'issue', 'approve', 'receipt', 'result-publication']) {
    assert.ok(!barrel.includes(forbidden), `${forbidden} in src/completion/index.ts`);
  }
});
