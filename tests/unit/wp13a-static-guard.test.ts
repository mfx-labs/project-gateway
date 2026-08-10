/**
 * WP-13A — execution-foundation static security guards.
 *
 * Proves the module family (src/execution/**):
 *   - is I/O-free: no node:fs, fs/promises, network, subprocess, Git,
 *     timers, environment, fetch, Date.now, or Math.random anywhere in the
 *     family;
 *   - never activates/restores pi-guard (no apply/inspect/restore
 *     projection API, no enforcement run, no guard package inspection, no
 *     surface observation) — WP-5B remains the single enforcement owner;
 *   - never publishes lifecycle records (no WP-8 publish path, no store
 *     boundary, no record builders) and carries no result/receipt
 *     vocabulary — no CompletionContract evaluation, no ExecutionResult,
 *     no ResultPublicationRecord, no TrustedReceipt, no
 *     ExecutionRetrospectiveFacts, no ExecutionSummaryRecord;
 *   - contains no scheduler primitives (no timers/queues/loops) — retries
 *     are explicit-request-only;
 *   - does not expose trusted mutation authority through the package root.
 *
 * Future files added under src/execution/** are automatically covered (the
 * directory is walked at guard runtime).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const EXECUTION_SRC = join(REPO, 'src', 'execution');

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

const executionFiles = collectTsFiles(EXECUTION_SRC);
assert.ok(executionFiles.length >= 3, 'the execution source tree must exist');

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

test('execution static guard: the family is I/O-free (no fs/network/process/timers/env)', () => {
  for (const file of executionFiles) {
    const content = codeOf(file);
    for (const forbidden of [
      'node:fs', "from 'fs'", 'from "fs"', 'fs/promises', "require('fs')",
      'node:net', 'node:http', 'node:https', 'node:tls', 'node:dgram',
      'node:child_process', 'child_process', 'spawn(', 'exec(',
      'fetch(', 'WebSocket',
      'process.env', 'Date.now(', 'Math.random', 'setTimeout', 'setInterval',
      'setImmediate', 'queueMicrotask', 'process.nextTick',
    ]) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
  }
});

test('execution static guard: never activates/restores pi-guard; no enforcement-run or guard APIs', () => {
  for (const file of executionFiles) {
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
    ]) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
  }
});

test('execution static guard: no lifecycle publication, no result/receipt vocabulary', () => {
  for (const file of executionFiles) {
    const content = codeOf(file);
    for (const forbidden of [
      'publishRecord',
      'publishLifecycleRecord',
      'recordValidation',
      'ResultPublicationRecord',
      'result-publication',
      'TrustedReceipt',
      'trusted-receipt',
      'ExecutionResult',
      'ExecutionRetrospectiveFacts',
      'ExecutionSummaryRecord',
      'CompletionContract evaluation',
      'SupersessionRecord',
      'RevocationRecord',
      'record builders',
      'storage/',
    ]) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
  }
});

test('execution static guard: no second authority evaluator or lifecycle machinery', () => {
  for (const file of executionFiles) {
    const content = codeOf(file);
    for (const forbidden of [
      'evaluatePointOfUseEligibility',
      'pointofuse',
      'lifecycle/graph',
      "from '../lifecycle/",
      "from '../api/",
      'decideActivation',
      'issueRuntimeGrant',
      'approve',
    ]) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
  }
});

test('execution static guard: the barrel exposes no mutation authority', () => {
  const barrel = codeOf(join(EXECUTION_SRC, 'index.ts'));
  for (const forbidden of ['publish', 'activate', 'issue', 'approve', 'receipt', 'result-publication']) {
    assert.ok(!barrel.includes(forbidden), `${forbidden} in src/execution/index.ts`);
  }
});
