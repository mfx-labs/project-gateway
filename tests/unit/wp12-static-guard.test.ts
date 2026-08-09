/**
 * WP-12 Slice 1 — control-plane static security guards.
 *
 * Proves the module family (src/control-plane/**):
 *   - is I/O-free: no node:fs, fs/promises, network, subprocess, Git,
 *     timers, environment, or fetch access anywhere in the family
 *     (node:crypto randomBytes appears ONLY in the host identity-source
 *     helper `identity.ts`, mirroring the WP-8 lock module's accepted
 *     nonce-source discipline);
 *   - reuses the accepted WP-4 lifecycle graph, lifecycle-record schema
 *     pipeline, digest computation, WP-6 trusted configuration, and the
 *     WP-8 publication/read surface through the single store-boundary
 *     adapter — no second lifecycle rule authority, no second store, no
 *     second digest domain, no alternate audit path;
 *   - never publishes AuthoritativeAuditEvent and never touches the WP-8
 *     writer-lock API (no nested acquisition; FSCR-W12-001);
 *   - contains no Slice-2+ PRODUCTION vocabulary; the only Slice-2 record
 *     class literals are the read-only currentness consumption of
 *     revocation/supersession state in `core.ts` (contract §10/§12;
 *     SCR-W12-006);
 *   - does not expose trusted mutation authority through the package root
 *     or ./mcp.
 *
 * Future files added under src/control-plane/** are automatically covered
 * (the directory is walked at guard runtime).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const CONTROL_PLANE_SRC = join(REPO, 'src', 'control-plane');

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

const controlPlaneFiles = collectTsFiles(CONTROL_PLANE_SRC);
assert.ok(controlPlaneFiles.length >= 8, 'the control-plane source tree must exist');

test('control-plane static guard: the family is I/O-free (no fs/network/process/timers/env)', () => {
  for (const file of controlPlaneFiles) {
    const content = readFileSync(file, 'utf8');
    for (const forbidden of [
      'node:fs', "from 'fs'", 'from "fs"', 'fs/promises', "require('fs')",
      'node:net', 'node:http', 'node:https', 'node:tls', 'node:dgram',
      'node:child_process', 'child_process', 'spawn(', 'exec(',
      'fetch(', 'WebSocket',
      'process.env', 'Date.now(', 'Math.random', 'setTimeout', 'setInterval',
    ]) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reach ${forbidden}`);
    }
    // node:crypto randomBytes is confined to the host identity-source helper.
    if (file.endsWith('identity.ts')) {
      assert.equal(content.includes('randomBytes'), true, 'identity.ts owns the crypto record-ID source');
    } else {
      assert.equal(content.includes('randomBytes'), false, `${rel(file)} must not use randomBytes`);
      assert.equal(content.includes('node:crypto'), false, `${rel(file)} must not import node:crypto`);
    }
  }
});

test('control-plane static guard: single lifecycle rule authority and schema authority are reused', () => {
  const core = readFileSync(join(CONTROL_PLANE_SRC, 'core.ts'), 'utf8');
  const graph = readFileSync(join(CONTROL_PLANE_SRC, 'graph.ts'), 'utf8');
  const records = readFileSync(join(CONTROL_PLANE_SRC, 'records.ts'), 'utf8');
  const subject = readFileSync(join(CONTROL_PLANE_SRC, 'subject.ts'), 'utf8');
  assert.equal(graph.includes('validateLifecycleGraph'), true, 'the accepted WP-4 lifecycle graph is invoked');
  assert.equal(core.includes('validateLifecycleRecord'), true, 'the accepted WP-4 lifecycle-record schema pipeline is invoked');
  assert.equal(records.includes('computePayloadDigest'), true, 'the accepted storage digest domain is reused');
  assert.equal(subject.includes('snapshotTrustedWorkspaceConfigurationInput'), true, 'the accepted descriptor-derived capture is reused');
  assert.equal(core.includes('lookupValidatedWorkspace'), true, 'the accepted WP-6 workspace lookup is reused');
  assert.equal(core.includes('isGenuineValidatedTrustedWorkspaceConfiguration'), true, 'the accepted WP-6 genuineness check is reused');
  assert.equal(core.includes('isKnownCapability'), true, 'the accepted capability vocabulary is reused');
});

/** Per-module allowlist of `../storage/...` import specifiers. */
const STORAGE_IMPORT_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  'src/control-plane/store-boundary.ts': [
    '../storage/publication/index.js',
    '../storage/read/index.js',
    '../storage/format/taxonomy.js',
    '../storage/format/envelope.js',
    '../storage/types.js',
  ],
  'src/control-plane/storage-write-action.ts': ['../storage/trusted-input/bootstrap-input.js'],
  'src/control-plane/records.ts': ['../storage/format/envelope.js'],
  'src/control-plane/types.ts': ['../storage/types.js'],
  'src/control-plane/core.ts': ['../storage/types.js'],
};

test('control-plane static guard: exactly one WP-8 store boundary (no second store or audit path)', () => {
  for (const file of controlPlaneFiles) {
    const path = rel(file);
    const content = readFileSync(file, 'utf8');
    // Any `../storage/` import must be inside the per-module allowlist.
    for (const m of content.matchAll(/from\s+'(\.\.\/storage\/[^']+)'/g)) {
      const specifier = m[1]!;
      assert.ok(
        (STORAGE_IMPORT_ALLOWLIST[path] ?? []).includes(specifier),
        `${path} imports ${specifier} outside its allowed WP-8 surface`,
      );
    }
    if (path === 'src/control-plane/store-boundary.ts') {
      assert.equal(content.includes('publishRecord'), true, 'the boundary wraps publishRecord');
      assert.equal(content.includes('readRecord'), true, 'the boundary wraps readRecord');
      assert.equal(content.includes('enumerateClass'), true, 'the boundary wraps enumerateClass');
    }
    if (path === 'src/control-plane/storage-write-action.ts') {
      assert.equal(content.includes('createStorageWriteActionProvenance'), true, 'the write-action producer mints the genuine provenance');
    }
  }
});

test('control-plane static guard: no AuthoritativeAuditEvent publication and no WP-8 writer-lock API', () => {
  for (const file of controlPlaneFiles) {
    const content = readFileSync(file, 'utf8');
    // The audit CLASS ID and the audit-event builder are banned outright;
    // the PascalCase documentation token is permitted only as prose (the
    // class can never be published: the boundary rejects every class
    // outside CONTROL_PLANE_PUBLISH_CLASSES and no audit module is imported).
    for (const forbidden of ['authoritative-audit-event', 'buildAuthorizedWriteAuditEvent', 'acquireWriterLock', 'releaseWriterLock', 'createWriteCapability', 'publishImmutableRecord', 'writerLock']) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reference ${forbidden}`);
    }
  }
});

/**
 * Slice-2A production revocation vocabulary is legitimate ONLY in the
 * modules that own the revoke operation; every other module stays clean.
 * Supersession consumption remains core.ts-only (schema-inapplicable for
 * lifecycle records); Slice-3+ vocabulary remains banned family-wide.
 */
const REVOCATION_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  'src/control-plane/core.ts': ['revocation-record', 'supersession-record', "'revoke'", 'revoke(', 'RevocationRecord'],
  'src/control-plane/types.ts': ['revocation-record', "'revoke'", 'RevocationRecord'],
  'src/control-plane/subject.ts': ["'revoke'"],
  'src/control-plane/records.ts': ['RevocationRecord', 'revocation-record'],
  'src/control-plane/store-boundary.ts': ['revocation-record'],
};

const REVOCATION_VOCABULARY: readonly string[] = ['revocation-record', 'supersession-record', "'revoke'", 'revoke(', 'RevocationRecord'];

/**
 * Slice-2B verify vocabulary is legitimate ONLY in the modules that own the
 * read-only verification operation; every other module stays clean.
 */
const VERIFY_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  'src/control-plane/core.ts': ["'verifyCurrentLifecycleState'"],
  'src/control-plane/types.ts': ["'verifyCurrentLifecycleState'"],
  'src/control-plane/subject.ts': ["'verifyCurrentLifecycleState'"],
};

const VERIFY_VOCABULARY: readonly string[] = ["'verifyCurrentLifecycleState'"];

test('control-plane static guard: Slice-2B verify vocabulary confined to its owning modules; verify is mutation- and lock-free', () => {
  for (const file of controlPlaneFiles) {
    const content = readFileSync(file, 'utf8');
    const path = rel(file);
    const allowed = VERIFY_ALLOWED[path] ?? [];
    for (const forbidden of VERIFY_VOCABULARY) {
      if (allowed.includes(forbidden)) continue;
      assert.equal(content.includes(forbidden), false, `${path} must not reference ${forbidden}`);
    }
  }
  // The complete verification implementation surface (the first dedicated
  // verify helper `readObservedState` through `runVerify`, up to
  // `runOperation`) must contain NO publication call path, NO publishable
  // record builder, NO storage write-action path, and NO decision-
  // coordinator dependency: verification is read-only and takes no
  // mutation lock (SIR-W12-S2B-001: window widened from runVerify-only to
  // cover every 2B verify helper body).
  const core = readFileSync(join(CONTROL_PLANE_SRC, 'core.ts'), 'utf8');
  const start = core.indexOf('function readObservedState(');
  const end = core.indexOf('function runOperation(');
  assert.ok(start !== -1 && end !== -1 && start < end, 'the verify surface must sit between readObservedState and runOperation');
  const verifySurface = core.slice(start, end);
  for (const forbidden of [
    'publishLifecycleRecord',
    'publishRecord',
    'buildRecordEnvelope',
    'withLock',
    'context.coordinate',
    'writeAction',
  ]) {
    assert.equal(verifySurface.includes(forbidden), false, `the verify surface must not ${forbidden}`);
  }
});

test('control-plane static guard: no Slice-3+ production vocabulary (Slice-2A revocation confined to its modules)', () => {
  for (const file of controlPlaneFiles) {
    const content = readFileSync(file, 'utf8');
    const path = rel(file);
    // Read-only currentness consumption of revocation/supersession state is
    // contract-sanctioned in the decision core only (contract §10/§12/§25).
    if (path === 'src/control-plane/core.ts') {
      assert.equal(content.includes("'revocation-record'"), true, 'the core consumes revocation state for currentness');
      assert.equal(content.includes("'supersession-record'"), true, 'the core consumes supersession state for currentness');
    }
    const allowed = REVOCATION_ALLOWED[path] ?? [];
    for (const forbidden of REVOCATION_VOCABULARY) {
      if (allowed.includes(forbidden)) continue;
      assert.equal(content.includes(forbidden), false, `${path} must not reference ${forbidden}`);
    }
    for (const forbidden of [
      'RuntimeGrant', 'runtime-grant', 'ActivationRecord', 'activation-record', 'ExecutionOccurrenceRecord', 'ExecutionAttemptRecord',
      'TrustedReceipt', 'trusted-receipt', 'ResultPublicationRecord', 'result-publication', 'MigrationRecord', 'migration-record',
      'ExecutionSummaryRecord', 'orchestration', 'recordExecutionAttempt',
      'pgw:o:', 'reserved_occurrence', 'decideActivation', 'issueRuntimeGrant', 'pi-guard', 'pi_guard',
    ]) {
      assert.equal(content.includes(forbidden), false, `${path} must not contain Slice-3+ vocabulary (${forbidden})`);
    }
  }
});

test('control-plane static guard: the only publishable record classes are the four Slice-1/Slice-2A classes', () => {
  const boundary = readFileSync(join(CONTROL_PLANE_SRC, 'store-boundary.ts'), 'utf8');
  assert.equal(boundary.includes("'validation-record'"), true);
  assert.equal(boundary.includes("'approval-record'"), true);
  assert.equal(boundary.includes("'issuance-record'"), true);
  assert.equal(boundary.includes("'revocation-record'"), true);
  // The boundary rejects every other class at the adapter level.
  assert.equal(boundary.includes('CONTROL_PLANE_PUBLISH_CLASSES'), true);
});

test('control-plane static guard: the package root and ./mcp do not expose the control plane', () => {
  const root = readFileSync(join(REPO, 'src', 'index.ts'), 'utf8');
  const mcp = readFileSync(join(REPO, 'src', 'adapters', 'mcp', 'index.ts'), 'utf8');
  for (const forbidden of ['control-plane', 'executeSlice1Command', 'from \'../control-plane/', 'from \'../../control-plane/']) {
    assert.equal(root.includes(forbidden), false, `package root must not expose ${forbidden}`);
    assert.equal(mcp.includes(forbidden), false, `./mcp must not expose ${forbidden}`);
  }
});

test('control-plane static guard: no Git, MCP, transport, or runtime vocabulary', () => {
  for (const file of controlPlaneFiles) {
    const content = readFileSync(file, 'utf8');
    for (const forbidden of ['@modelcontextprotocol', 'mcp/', 'child_process', 'http://', 'https://', 'tunnel', 'WebSocket', 'node:readline']) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reach ${forbidden}`);
    }
    // No Git mutation vocabulary anywhere in the family.
    for (const forbidden of ['gitAdd', 'gitCommit', 'gitPush', 'spawnSync', 'execSync']) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reach ${forbidden}`);
    }
  }
});
