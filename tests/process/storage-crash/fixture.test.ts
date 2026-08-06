/**
 * WP-8-D crash-injection fixture (process child). Runs only under tests;
 * runtime source never spawns (SRE-013). The fixture is executed directly
 * (`node dist-test/tests/process/storage-crash/fixture.test.js --stage=<s>
 * --root=<dir>` or `--behavior=<b>`) by the crash harness; under `node
 * --test` it runs its self-check test so the suite never passes vacuously.
 *
 * Protocol: the fixture emits `STAGE:<name>` markers on stdout AFTER each
 * protocol mutation (via deterministic hook-call counters over the real
 * filesystem operations), and blocks on a bounded `Atomics.wait` once the
 * requested stage is reached — the parent kills (SIGKILL) only after the
 * marker proves the stage was reached. Behavior stages perform a scripted
 * sequence and emit `OUTCOME:<json>` before exiting normally.
 *
 * No sleeps are used for synchronization; the bounded Atomics.wait is
 * interrupted by the kill. No HOME, workspace, repository, or unrelated
 * path is touched: everything stays inside the caller-provided isolated
 * trusted root.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, chmodSync, writeFileSync, renameSync, existsSync, statSync, writeSync, fsyncSync, linkSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createStorageWriteActionProvenance, createTrustedStorageBootstrapInput, createTrustedWriteRequest } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { createWriteCapability } from '../../../src/storage/capabilities/authenticity.js';
import { acquireWriterLock } from '../../../src/storage/locks/lock.js';
import { publishImmutableRecord, publicationTempName } from '../../../src/storage/publication/publish-record.js';
import { publishRecord } from '../../../src/storage/publication/index.js';
import { verifyStoreInstance } from '../../../src/storage/read/read-record.js';
import { buildAuthorizedWriteAuditEvent } from '../../../src/storage/audit/write-audit.js';
import { canonicalEnvelopeBytes, computePayloadDigest } from '../../../src/storage/format/envelope.js';
import { deriveRecordRelativePath } from '../../../src/storage/layout/layout.js';
import { defaultLimitProfile } from '../../../src/storage/limits/limits.js';
import type { PublicationHooks, VerifiedStoreInstance } from '../../../src/storage/types.js';

export const FIXTURE_STAGES = [
  'lock-dir-synced',
  'primary-written',
  'primary-fsynced',
  'primary-linked',
  'primary-dir-fsynced',
  'primary-unlinked',
  'primary-tmp-synced',
  'audit-written',
  'audit-linked',
  'audit-synced',
  'lock-released',
] as const;

export const FIXTURE_BEHAVIORS = [
  'temp-exists-idempotent',
  'temp-exists-audit-missing',
  'zero-progress-write',
  'partial-write',
  'cap-invalid-boundary-1',
  'cap-invalid-boundary-2',
  'cap-invalid-boundary-3',
  'root-drift-boundary-4',
] as const;

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const BOOTSTRAP_ACTION = 'crash-bootstrap-action';
const WRITE_ACTION = 'crash-write-action';
const RECORD_ID = 'pgw:r:000000000000000000000000000000dd';

function genuineConfig(): object {
  const config = { configurationVersion: '1', capabilityVocabularyVersion: '1', hostLane: 'pi', provenance: { sourceKind: 'control-plane' }, workspaces: [], identity: CONFIG_IDENTITY };
  markValidatedTrustedWorkspaceConfiguration(config);
  return config;
}

function approvalRecord(recordId: string): Readonly<Record<string, unknown>> {
  return {
    recordKind: 'ApprovalRecord',
    formatVersion: '1.0',
    recordId,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    trustedActionId: WRITE_ACTION,
    payload: { approved: true },
    payloadDigest: computePayloadDigest({ approved: true }),
  };
}

function timeSource() {
  return { now: () => 1000, processStartTime: 500 };
}

interface FixtureEnv {
  readonly config: object;
  readonly bootstrapInput: unknown;
  readonly writeProvenance: unknown;
  readonly writeRequest: unknown;
  readonly storeRoot: string;
}

function buildEnv(root: string): FixtureEnv {
  const config = genuineConfig();
  const bootstrapProvenance = createStorageBootstrapActionProvenance({
    actionIdentity: BOOTSTRAP_ACTION,
    locator: root,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: defaultLimitProfile(),
  });
  const inputResult = createTrustedStorageBootstrapInput(config, bootstrapProvenance, {
    locator: root,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
  });
  if (!inputResult.ok) throw new Error('bootstrap input failed');
  const writeProvenance = createStorageWriteActionProvenance({
    actionIdentity: WRITE_ACTION,
    locator: root,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: defaultLimitProfile(),
  });
  const writeRequest = createTrustedWriteRequest(config, writeProvenance, {
    locator: root,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
  });
  if (!writeRequest.ok) throw new Error('write request failed');
  return { config, bootstrapInput: inputResult.input, writeProvenance, writeRequest: writeRequest.request, storeRoot: join(root, 'store-v1') };
}

/** Genuine verified store instance for the caller-provided store (D-5 pipeline). */
function verifiedStore(root: string): VerifiedStoreInstance | undefined {
  const result = verifyStoreInstance({
    locator: root,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    configurationVersion: '1',
    limitProfile: defaultLimitProfile(),
  });
  return result.ok && result.storeInstance !== undefined ? result.storeInstance : undefined;
}

/** Deterministic hook-call counters → named protocol markers (real fs ops). */
function markerHooks(emit: (name: string) => void): PublicationHooks {
  let writes = 0;
  let fsyncs = 0;
  let links = 0;
  let unlinks = 0;
  let dirFsyncs = 0;
  const syncDir = (path: string): void => {
    let fd: number | undefined;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      fsyncSync(fd);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };
  return {
    write(fd, buf, off, len, pos) {
      const n = writeSync(fd, buf, off, len, pos);
      writes++;
      if (writes === 2) emit('primary-written');
      if (writes === 3) emit('audit-written');
      return n;
    },
    fsyncFile(fd) {
      fsyncSync(fd);
      fsyncs++;
      if (fsyncs === 2) emit('primary-fsynced');
      if (fsyncs === 3) emit('audit-fsynced');
    },
    link(existingPath, newPath) {
      linkSync(existingPath, newPath);
      links++;
      if (links === 1) emit('primary-linked');
      if (links === 2) emit('audit-linked');
    },
    unlink(path) {
      unlinkSync(path);
      unlinks++;
      if (unlinks === 1) emit('primary-unlinked');
      if (unlinks === 3) emit('lock-released');
    },
    fsyncDirectory(path) {
      syncDir(path);
      dirFsyncs++;
      if (dirFsyncs === 1) emit('lock-dir-synced');
      if (dirFsyncs === 2) emit('primary-dir-fsynced');
      if (dirFsyncs === 3) emit('primary-tmp-synced');
      if (dirFsyncs === 6) emit('audit-synced');
    },
  };
}

function blockUntilKilled(): void {
  // Bounded block (60 s) that the parent's SIGKILL interrupts. The success
  // condition is the marker, never a sleep.
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, 60_000);
}

function publishRequest(root: string, recordId: string, hooks?: PublicationHooks) {
  const env = buildEnv(root);
  return {
    env,
    request: {
      trustedConfiguration: env.config,
      bootstrapInput: env.bootstrapInput,
      writeActionProvenance: env.writeProvenance,
      locator: root,
      serviceUid: UID,
      forbiddenRoots: [],
      limitProfile: defaultLimitProfile(),
      recordClass: 'approval-record' as const,
      record: approvalRecord(recordId),
      timeSource: timeSource(),
      hooks,
    },
  };
}

function preCreateCrashState(root: string, withAudit: boolean): void {
  const env = buildEnv(root);
  const record = approvalRecord(RECORD_ID);
  const derived = deriveRecordRelativePath('approval-record', RECORD_ID);
  if (!derived.ok) throw new Error('derivation failed');
  const finalPath = join(env.storeRoot, derived.relativePath);
  const shardDir = join(env.storeRoot, 'records', 'approval', derived.shard);
  mkdirSync(shardDir, { recursive: true, mode: 0o700 });
  chmodSync(shardDir, 0o700);
  writeFileSync(finalPath, JSON.stringify(record), { mode: 0o600 });
  if (withAudit) {
    const configStat = statSync(join(root, 'config-v1'));
    const storeStat = statSync(env.storeRoot);
    const audit = buildAuthorizedWriteAuditEvent({
      storeInstance: [
        { kind: 'configuration', dev: Number(configStat.dev), ino: Number(configStat.ino) },
        { kind: 'store-records', dev: Number(storeStat.dev), ino: Number(storeStat.ino) },
      ],
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: canonicalEnvelopeBytes(record).digest,
      eventKind: 'authorized-write',
      trustedActionIdentity: WRITE_ACTION,
      primaryCreatedAt: record['createdAt'] as string,
    });
    if (!audit.ok || audit.event === undefined) throw new Error('audit build failed');
    const auditDerived = deriveRecordRelativePath('authoritative-audit-event', audit.event.recordId);
    if (!auditDerived.ok) throw new Error('audit derivation failed');
    const auditShardDir = join(env.storeRoot, 'audit', 'audit-event', auditDerived.shard);
    mkdirSync(auditShardDir, { recursive: true, mode: 0o700 });
    chmodSync(auditShardDir, 0o700);
    writeFileSync(join(env.storeRoot, auditDerived.relativePath), audit.event.canonicalUtf8, { mode: 0o600 });
  }
  const tmpPath = join(env.storeRoot, 'tmp', publicationTempName(WRITE_ACTION, 0));
  writeFileSync(tmpPath, JSON.stringify(record), { mode: 0o600 });
  chmodSync(tmpPath, 0o600);
}

function runBehavior(name: string, root: string): { readonly ok: boolean; readonly outcome?: string; readonly code?: string; readonly note?: string } {
  const env = buildEnv(root);
  switch (name) {
    case 'temp-exists-idempotent': {
      preCreateCrashState(root, true);
      const { request } = publishRequest(root, RECORD_ID);
      const result = publishRecord(request);
      return result.ok ? { ok: true, outcome: result.outcome } : { ok: false, code: result.findings?.[0]?.code };
    }
    case 'temp-exists-audit-missing': {
      preCreateCrashState(root, false);
      const { request } = publishRequest(root, RECORD_ID);
      const result = publishRecord(request);
      return result.ok ? { ok: true, outcome: result.outcome } : { ok: false, code: result.findings?.[0]?.code };
    }
    case 'zero-progress-write': {
      const { request } = publishRequest(root, 'pgw:r:000000000000000000000000000000ee', { write: () => 0 });
      const result = publishRecord(request);
      return { ok: false, code: result.findings?.[0]?.code };
    }
    case 'partial-write': {
      const { request } = publishRequest(root, 'pgw:r:000000000000000000000000000000ef', {
        write: (fd: number, buf: Uint8Array, off: number, len: number, pos: number | null) => {
          // First call writes half the buffer; every later call returns zero
          // so the bounded write-all loop terminates fail-closed, leaving a
          // partial temp on disk.
          if (pos === 0) {
            const half = Math.max(1, Math.floor(buf.length / 2));
            return writeSync(fd, buf, off, Math.min(half, len), pos);
          }
          return 0;
        },
      });
      const result = publishRecord(request);
      return { ok: false, code: result.findings?.[0]?.code };
    }
    case 'cap-invalid-boundary-1': {
      // Boundary 1 (before the first trusted-state mutation): a disposed
      // write capability is rejected at the lock boundary before any
      // filesystem access.
      const store = verifiedStore(root);
      if (store === undefined) return { ok: false, note: 'store verification failed in fixture' };
      const capability = createWriteCapability({ trustedWriteRequest: env.writeRequest, storeInstance: store });
      if (capability === undefined) return { ok: false, note: 'capability not issued' };
      capability.dispose();
      const acquired = acquireWriterLock({
        capability,
        lockPath: join(env.storeRoot, 'locks', 'writer.lock'),
        locksDirPath: join(env.storeRoot, 'locks'),
        storeInstance: store.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
        actionIdentity: WRITE_ACTION,
        lockWaitMs: 5000,
        timeSource: timeSource(),
      });
      return { ok: false, code: acquired.code };
    }
    case 'cap-invalid-boundary-2': {
      // Boundary 2 (immediately before primary publication): the publication
      // entry revalidation rejects a disposed capability; no temp, no lock,
      // no record mutation occurs.
      const store = verifiedStore(root);
      if (store === undefined) return { ok: false, note: 'store verification failed in fixture' };
      const capability = createWriteCapability({ trustedWriteRequest: env.writeRequest, storeInstance: store });
      if (capability === undefined) return { ok: false, note: 'capability not issued' };
      capability.dispose();
      const record = approvalRecord('pgw:r:000000000000000000000000000000f0');
      const derived = deriveRecordRelativePath('approval-record', 'pgw:r:000000000000000000000000000000f0');
      if (!derived.ok) return { ok: false, note: 'derivation failed' };
      const tmpDir = join(env.storeRoot, 'tmp');
      const result = publishImmutableRecord({
        capability,
        canonicalUtf8: canonicalEnvelopeBytes(record).canonicalUtf8,
        byteLimit: 1024 * 1024,
        tmpPath: join(tmpDir, publicationTempName(WRITE_ACTION, 0)),
        tmpDirPath: tmpDir,
        finalPath: join(env.storeRoot, derived.relativePath),
        finalDirPath: join(env.storeRoot, 'records', 'approval', derived.shard),
        serviceUid: UID,
        expectedRecordId: record['recordId'] as string,
        expectedRevision: 1,
        expectedDigest: canonicalEnvelopeBytes(record).digest,
      });
      return { ok: false, code: result.code };
    }
    case 'cap-invalid-boundary-3': {
      // Boundary 3 (immediately before required audit publication): the
      // audit publication revalidates the capability and fails closed before
      // any audit mutation.
      const store = verifiedStore(root);
      if (store === undefined) return { ok: false, note: 'store verification failed in fixture' };
      const capability = createWriteCapability({ trustedWriteRequest: env.writeRequest, storeInstance: store });
      if (capability === undefined) return { ok: false, note: 'capability not issued' };
      const audit = buildAuthorizedWriteAuditEvent({
        storeInstance: store.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
        primaryClass: 'approval-record',
        primaryRecordId: 'pgw:r:000000000000000000000000000000f1',
        primaryRevision: 1,
        primaryDigest: 'sha-256:' + 'd'.repeat(64),
        eventKind: 'authorized-write',
        trustedActionIdentity: WRITE_ACTION,
        primaryCreatedAt: '2026-01-01T00:00:00.000Z',
      });
      if (!audit.ok || audit.event === undefined) return { ok: false, note: 'audit build failed' };
      const derived = deriveRecordRelativePath('authoritative-audit-event', audit.event.recordId);
      if (!derived.ok) return { ok: false, note: 'derivation failed' };
      capability.dispose();
      const tmpDir = join(env.storeRoot, 'tmp');
      const result = publishImmutableRecord({
        capability,
        canonicalUtf8: audit.event.canonicalUtf8,
        byteLimit: 1024 * 1024,
        tmpPath: join(tmpDir, publicationTempName(WRITE_ACTION, 1)),
        tmpDirPath: tmpDir,
        finalPath: join(env.storeRoot, derived.relativePath),
        finalDirPath: join(env.storeRoot, 'audit', 'audit-event', derived.shard),
        serviceUid: UID,
        expectedRecordId: audit.event.recordId,
        expectedRevision: 1,
        expectedDigest: audit.event.digest,
      });
      return { ok: false, code: result.code };
    }
    case 'root-drift-boundary-4': {
      // Boundary 4 (before reporting successful completion): replace the
      // trusted parent directory after the audit durability syncs so the
      // final root revalidation detects identity drift and fails closed
      // without rollback; the durable state remains untouched.
      const moved = `${root}-moved-${process.pid}`;
      let dirFsyncs = 0;
      let swapped = false;
      const { request } = publishRequest(root, 'pgw:r:000000000000000000000000000000f2', {
        fsyncDirectory: () => {
          dirFsyncs++;
          // The 7th directory fsync is the audit temporary-directory sync:
          // after it every store mutation (record, audit, temp removal) is
          // durable and only boundary 4 remains.
          if (dirFsyncs === 7 && !swapped) {
            swapped = true;
            try {
              renameSync(root, moved);
              mkdirSync(root, { mode: 0o700 });
            } catch {
              swapped = false;
            }
          }
        },
      });
      const result = publishRecord(request);
      // Restore the parent so the harness can clean up deterministically.
      try {
        if (existsSync(moved)) {
          const movedStore = join(moved, 'store-v1');
          if (!existsSync(movedStore)) {
            // The store stayed under the original root (no drift applied).
            renameSync(moved, join(root, `drift-orphan-${process.pid}`));
          } else {
            // Move the store back under the original root path.
            renameSync(moved, root);
          }
        }
      } catch {
        // best effort; the harness classifies what remains
      }
      return result.ok ? { ok: true, outcome: result.outcome } : { ok: false, code: result.findings?.[0]?.code };
    }
    default:
      return { ok: false, note: 'unknown behavior' };
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const stageArg = args.find((a) => a.startsWith('--stage='));
  const behaviorArg = args.find((a) => a.startsWith('--behavior='));
  const rootArg = args.find((a) => a.startsWith('--root='));
  if (rootArg === undefined) {
    process.stdout.write('OUTCOME:{"ok":false,"note":"missing --root"}\n');
    process.exit(2);
  }
  const root = rootArg.slice('--root='.length);
  if (stageArg !== undefined) {
    const target = stageArg.slice('--stage='.length) as (typeof FIXTURE_STAGES)[number];
    let reached = false;
    const emit = (name: string): void => {
      process.stdout.write(`STAGE:${name}\n`);
      if (name === target) {
        reached = true;
        blockUntilKilled();
      }
    };
    const env = buildEnv(root);
    const recordId = RECORD_ID;
    const result = publishRecord({
      trustedConfiguration: env.config,
      bootstrapInput: env.bootstrapInput,
      writeActionProvenance: env.writeProvenance,
      locator: root,
      serviceUid: UID,
      forbiddenRoots: [],
      limitProfile: defaultLimitProfile(),
      recordClass: 'approval-record',
      record: approvalRecord(recordId),
      timeSource: timeSource(),
      hooks: markerHooks(emit),
    });
    if (!reached) {
      process.stdout.write(`OUTCOME:${JSON.stringify({ ok: false, note: 'target stage not reached', code: result.findings?.[0]?.code })}\n`);
      process.exit(1);
    }
    process.stdout.write(`OUTCOME:${JSON.stringify({ ok: result.ok, outcome: result.outcome, code: result.findings?.[0]?.code })}\n`);
    return;
  }
  if (behaviorArg !== undefined) {
    const behavior = behaviorArg.slice('--behavior='.length) as (typeof FIXTURE_BEHAVIORS)[number];
    const result = runBehavior(behavior, root);
    process.stdout.write(`OUTCOME:${JSON.stringify(result)}\n`);
    return;
  }
  process.stdout.write('OUTCOME:{"ok":false,"note":"no stage or behavior"}\n');
  process.exit(2);
}

const isDirectRun = process.argv[1]?.endsWith('fixture.test.js') === true && process.argv.slice(2).some((a) => a.startsWith('--stage=') || a.startsWith('--behavior='));
if (isDirectRun) {
  main();
}

test('fixture: self-check (module loads; stage and behavior inventories are complete)', () => {
  assert.equal(FIXTURE_STAGES.length, 11);
  assert.equal(FIXTURE_BEHAVIORS.length, 8);
  assert.ok(FIXTURE_STAGES.includes('audit-synced'));
  assert.ok(FIXTURE_BEHAVIORS.includes('root-drift-boundary-4'));
});
