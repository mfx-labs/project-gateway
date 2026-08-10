/**
 * WP-13 durability S3 — outcome-production static security guards
 * (SIR-WP13-DUR-S3-004 strengthened ownership checks).
 *
 * Proves the module family (src/outcome-production/**):
 *   - is filesystem-free and network/process/timer-free; node:crypto
 *     appears ONLY in produce.ts (the canonical observation content digest);
 *   - the ONLY outcome write surface is the S2 boundary's
 *     `publishExactOutcomeRecord` call in new-outcome.ts — no raw WP-8
 *     `publishRecord`, no WP-12 publish path, no generic lifecycle writer;
 *   - identity/evidence/time sources are INVOKED (dot-call AND bracket-call
 *     spellings) ONLY from the no-existing branch module (new-outcome.ts) —
 *     replay/conflict paths never invoke them;
 *   - the SAME shared attempt-coordination-key derivation is pinned in both
 *     the outcome production core and the WP-13C publication boundary; no
 *     second private helper and no direct key reconstruction anywhere in
 *     `src/**`;
 *   - the outcome capability MODULE (`src/outcome/capability`) is imported
 *     ONLY by the capability definition, the S3 decision core, the
 *     no-existing branch (permit mint), and the trusted host composition
 *     (the single capability mint site); alias/renamed/re-exported/direct
 *     relative imports from any other production module are rejected;
 *   - the result-publication surface is confined to the trusted host
 *     composition (compose.ts) and type-only vocabulary (types.ts); the
 *     branded outcome-precondition context factory is never imported by the
 *     family (compose.ts consumes it from src/internal);
 *   - no WP-13D/WP-15 vocabulary, no S4 retrospective-derivation import, no
 *     background recovery/scheduler.
 *
 * Future files added under src/outcome-production/** are automatically
 * covered (the directory is walked at guard runtime). These guards are
 * regression tripwires; the branded runtime checks (capability brand,
 * precondition-context brand, permit brand) remain the real authority
 * defense.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const S3_SRC = join(REPO, 'src', 'outcome-production');

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

const s3Files = collectTsFiles(S3_SRC);
assert.ok(s3Files.length >= 4, 'the outcome-production source tree must exist');

/** Strip comments so honest prose never trips the guards; imports and code are scanned verbatim. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

test('outcome-production static guard: filesystem-free; no network/process/timer/env surface; crypto confined to produce.ts', () => {
  for (const file of s3Files) {
    const content = codeOf(file);
    const base = file.split('/').pop() ?? '';
    for (const forbidden of [
      'node:fs',
      "from 'fs'",
      "require('fs')",
      'fs/promises',
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
    if (base === 'produce.ts') {
      // The canonical observation content digest is the ONLY crypto consumer.
      assert.ok(content.includes('node:crypto'), 'produce.ts must own the observation digest crypto');
    } else {
      assert.ok(!content.includes('node:crypto'), `node:crypto outside produce.ts in ${rel(file)}`);
    }
  }
});

test('outcome-production static guard: the ONLY outcome write surface is the S2 boundary; no WP-12/WP-8 publish path', () => {
  for (const file of s3Files) {
    const content = codeOf(file);
    const base = file.split('/').pop() ?? '';
    for (const forbidden of [
      'publishLifecycleRecord',
      'executeSlice1Command',
      'recordValidation',
      'publishRecord',
      "from '../control-plane/store-boundary.js'",
      'decideActivation',
      'issueRuntimeGrant',
    ]) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
    // Raw WP-8 surface: the committed envelope-digest convention and the
    // type vocabulary are the ONLY storage imports allowed (same discipline
    // as the WP-13C publication authority).
    for (const forbidden of [
      "from '../storage/publication/",
      "from '../storage/read/",
      "from '../storage/layout/",
      "from '../storage/format/taxonomy.js'",
      "from '../control-plane/store-boundary.js'",
      "from '../storage'",
    ]) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
    if (base === 'new-outcome.ts') {
      // The no-existing branch owns the single S2 sink call.
      assert.ok(content.includes('publishExactOutcomeRecord('), 'new-outcome.ts must own the S2 outcome write');
    } else {
      assert.ok(!content.includes('publishExactOutcomeRecord('), `publishExactOutcomeRecord call outside new-outcome.ts in ${rel(file)}`);
    }
  }
});

test('outcome-production static guard: identity/evidence/time sources INVOKED ONLY from the no-existing branch (dot-call and bracket-call)', () => {
  for (const file of s3Files) {
    const content = codeOf(file);
    const base = file.split('/').pop() ?? '';
    if (base === 'new-outcome.ts' || base === 'types.ts') {
      // new-outcome.ts = the no-existing branch; types.ts = the declarations.
      continue;
    }
    // Property-CALL ownership: catch BOTH `identity.newRecordId()` and
    // `identity['newRecordId']()` invocation spellings anywhere else.
    for (const name of ['newRecordId', 'newEvidenceId', 'nowUtcIso']) {
      assert.ok(!content.includes(`${name}(`), `${name}( invocation outside the no-existing branch (found in ${rel(file)})`);
      assert.ok(!content.includes(`${name}'](`), `${name}']( bracket invocation outside the no-existing branch (found in ${rel(file)})`);
      assert.ok(!content.includes(`${name}'?.(`), `${name}'?.( optional bracket invocation outside the no-existing branch (found in ${rel(file)})`);
    }
  }
  // The no-existing branch genuinely invokes all three sources.
  const branch = codeOf(join(S3_SRC, 'new-outcome.ts'));
  assert.ok(branch.includes('newRecordId()') && branch.includes('newEvidenceId()') && branch.includes('nowUtcIso()'), 'the no-existing branch must own the identity/time calls');
});

test('outcome-production static guard: same-key derivation is shared and pinned with WP-13C (no second helper, no reconstruction)', () => {
  // The shared key module is imported by BOTH domains and by nobody else in
  // src/**; the key helper itself is the ONLY builder.
  const importers: string[] = [];
  for (const file of collectTsFiles(join(REPO, 'src'))) {
    const content = codeOf(file);
    if (content.includes('attemptCoordinationKey')) importers.push(rel(file));
    if (content.includes("from '../internal/attempt-coordination-key.js'") || content.includes("from '../../internal/attempt-coordination-key.js'")) {
      assert.ok(content.includes('attemptCoordinationKey'), `key import without use in ${rel(file)}`);
    }
  }
  assert.deepEqual(
    importers.sort(),
    [
      'src/internal/attempt-coordination-key.ts',
      'src/outcome-production/produce.ts',
      'src/publication/publish.ts',
    ].sort(),
    'no production module other than the helper, the outcome core, and the WP-13C boundary may touch the attempt coordination key',
  );
  // Direct reconstruction of the full coordination key is rejected in both domains.
  for (const file of [join(S3_SRC, 'produce.ts'), join(REPO, 'src', 'publication', 'publish.ts')]) {
    assert.ok(!codeOf(file).includes(".join('|')"), `${rel(file)} must not rebuild the coordination key`);
  }
});

test('outcome-production static guard: capability MODULE ownership — imports confined to definition/core/branch/composition (SIR-WP13-DUR-S3-004)', () => {
  // Every production import of the outcome capability module across ALL of
  // src/** (any relative spelling, alias or renamed) is confined to the four
  // authorized owners: the capability definition itself, the S3 decision
  // core (genuineness check), the no-existing branch (exact-record permit
  // mint), and the trusted host composition (the ONE capability mint site).
  const capabilityImporters: string[] = [];
  for (const file of collectTsFiles(join(REPO, 'src'))) {
    const content = codeOf(file);
    if (/from '(\.\.\/)+outcome\/capability[^']*'/.test(content)) capabilityImporters.push(rel(file));
    if (/from "(\.\.\/)+outcome\/capability[^"]*"/.test(content)) capabilityImporters.push(rel(file));
  }
  assert.deepEqual(
    capabilityImporters.sort(),
    [
      'src/outcome-production/compose.ts',
      'src/outcome-production/new-outcome.ts',
      'src/outcome-production/produce.ts',
    ].sort(),
    'the outcome capability module must be imported ONLY by the S3 composition, the no-existing branch, and the decision core',
  );
  // The capability mint primitive itself is confined to the single mint site.
  for (const file of s3Files) {
    const content = codeOf(file);
    const base = file.split('/').pop() ?? '';
    if (base === 'compose.ts') {
      assert.ok(content.includes('createExecutionOutcomeCapability'), 'compose.ts is the ONE production mint site');
    } else {
      assert.ok(!content.includes('createExecutionOutcomeCapability'), `capability mint outside compose.ts in ${rel(file)}`);
    }
    if (base === 'new-outcome.ts') {
      // The no-existing branch mints the exact-record permit immediately before the write.
      assert.ok(content.includes('createExecutionOutcomePermit'), 'new-outcome.ts must mint the exact-record permit');
    } else {
      assert.ok(!content.includes('createExecutionOutcomePermit'), `permit mint outside new-outcome.ts in ${rel(file)}`);
    }
    if (base !== 'produce.ts' && base !== 'compose.ts' && base !== 'new-outcome.ts' && base !== 'types.ts') {
      for (const forbidden of ['WeakSet', 'capabilityBrand', 'permitBrand', 'isGenuineExecutionOutcomeCapability', 'isGenuineExecutionOutcomePermit']) {
        assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
      }
    }
  }
  // The branded outcome-precondition context factory is consumed ONLY by
  // the composition (never by the family barrel or the decision core).
  for (const file of s3Files) {
    const content = codeOf(file);
    const base = file.split('/').pop() ?? '';
    if (base === 'compose.ts') {
      assert.ok(content.includes('createPublicationOutcomePrecondition'), 'compose.ts must own the precondition-context mint');
    } else {
      assert.ok(!content.includes('createPublicationOutcomePrecondition'), `precondition-context mint outside compose.ts in ${rel(file)}`);
    }
  }
});

test('outcome-production static guard: result-publication surface confined to the composition + type vocabulary; barrel clean', () => {
  for (const file of s3Files) {
    const content = codeOf(file);
    const base = file.split('/').pop() ?? '';
    if (base === 'compose.ts') {
      // The trusted host composition owns the WP-13C wiring (publication
      // boundary, capability mint, publishValidatedResult invocation).
      assert.ok(content.includes('createPublicationStoreBoundary'), 'compose.ts must build the real publication boundary');
      assert.ok(content.includes('createResultPublicationCapability'), 'compose.ts must mint the result-publication capability');
      assert.ok(content.includes('publishValidatedResult'), 'compose.ts must invoke the real WP-13C boundary');
    } else if (base === 'types.ts') {
      // Type-only vocabulary imports only.
      assert.ok(content.includes("from '../publication/types.js'"), 'types.ts may carry the publication type vocabulary');
      for (const forbidden of ['createPublicationStoreBoundary', 'createResultPublicationCapability', 'publishValidatedResult']) {
        assert.ok(!content.includes(forbidden), `${forbidden} in types.ts`);
      }
    } else {
      for (const forbidden of ["from '../publication/", 'createPublicationStoreBoundary', 'createResultPublicationCapability', 'publishValidatedResult', 'PublicationInput']) {
        assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
      }
    }
  }
  const barrel = codeOf(join(S3_SRC, 'index.ts'));
  for (const forbidden of ['createPublicationStoreBoundary', 'createResultPublicationCapability', 'publishValidatedResult', 'createPublicationOutcomePrecondition']) {
    assert.ok(!barrel.includes(forbidden), `${forbidden} in src/outcome-production/index.ts`);
  }
});

test('outcome-production static guard: no WP-13D/WP-15 vocabulary, no S4 derivation import, no recovery/scheduler', () => {
  for (const file of s3Files) {
    const content = codeOf(file);
    for (const forbidden of [
      'TrustedReceipt',
      'trusted-receipt',
      'TrustedReceiptRecord',
      'ExecutionRetrospectiveFacts',
      'ExecutionSummaryRecord',
      'completion-status',
      'downstream-automation',
      'authoritative-reporting',
      'SupersessionRecord',
      "from '../retrospective/",
      'receipt_correlations',
      'resume',
      'setTimeout',
      'setInterval',
      'setImmediate',
      'queueMicrotask',
      'process.nextTick',
    ]) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
  }
  const barrel = codeOf(join(S3_SRC, 'index.ts'));
  assert.ok(barrel.includes('produceExecutionOutcome'), 'the decision core must be exported');
  assert.ok(barrel.includes('createExecutionOutcomeAuthority'), 'the host composition must be exported');
  for (const forbidden of ['createExecutionOutcomeCapability', 'createExecutionOutcomePermit', 'WeakSet', 'capabilityBrand', 'permitBrand']) {
    assert.ok(!barrel.includes(forbidden), `${forbidden} in src/outcome-production/index.ts`);
  }
});
