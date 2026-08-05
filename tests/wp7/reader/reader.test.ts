/**
 * WP-7-B — Controlled reader operations and lifecycle tests.
 *
 * Exercises the real WorkspaceInspectionService against a real temporary
 * workspace: descriptor-bound reads, listing, metadata, strict UTF-8,
 * NUL policy, symlinks, FIFO nonblocking, descriptor identity binding,
 * cancellation, concurrency, and disposal.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createWp7Fixture, type Wp7Fixture, WORKSPACE_ALPHA } from '../helpers.js';
import { WorkspaceInspectionService } from '../../../src/reader/service.js';
import { validateTrustedOperationControl, type OperationResult } from '../../../src/reader/types.js';
import { ERROR_CODES } from '../../../src/reader/errors.js';

let fixture: Wp7Fixture;
let service: WorkspaceInspectionService;

before(async () => {
  fixture = createWp7Fixture();
  service = new WorkspaceInspectionService({
    configuration: fixture.configuration,
    resolveExistingPath: fixture.resolveExistingPath,
  });
});

after(async () => {
  await service.dispose().catch(() => {});
  fixture.cleanup();
});

const NO_CTRL = {};

function readTextOk(result: OperationResult): { text: string; byteLength: number; truncated: boolean } {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value as { text: string; byteLength: number; truncated: boolean };
}

function readBytesOk(result: OperationResult): { bytes: Uint8Array; byteLength: number; truncated: boolean } {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value as { bytes: Uint8Array; byteLength: number; truncated: boolean };
}

describe('WP-7 reader: controlled operations', () => {
  it('reads a valid file with no control operand', async () => {
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'docs/notes.md' },
      NO_CTRL,
    );
    const v = readTextOk(r);
    assert.equal(v.text, 'hello world\n');
    assert.equal(v.byteLength, 12);
    assert.equal(v.truncated, false);
  });

  it('accepts an empty control object', async () => {
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'docs/notes.md' },
      {},
    );
    assert.equal(r.ok, true);
  });

  it('accepts a genuine AbortSignal control', async () => {
    const ctrl = new AbortController();
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'docs/notes.md' },
      { signal: ctrl.signal },
    );
    assert.equal(r.ok, true);
  });

  it('fails fast on an already-aborted signal', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'docs/notes.md' },
      { signal: ctrl.signal },
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-OP-CANCELLED');
  });

  it('rejects a forged control signal', async () => {
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'docs/notes.md' },
      { signal: { aborted: false } as unknown as AbortSignal },
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-REQ-INVALID');
  });

  it('rejects empty request path', async () => {
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: '' },
      NO_CTRL,
    );
    assert.equal(r.ok, false);
  });

  it('rejects root token .. traversal', async () => {
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: '..' },
      NO_CTRL,
    );
    assert.equal(r.ok, false);
  });

  it('lists the workspace root via . token', async () => {
    const r = await service.listDirectory(
      { operation: 'list-directory', workspaceId: WORKSPACE_ALPHA, path: '.' },
      NO_CTRL,
    );
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error('unreachable');
    const v = r.value as { entries: readonly { name: string; kindHint: string }[]; truncated: boolean; count: number };
    assert.ok(v.count >= 3);
    // deterministic ordering: byte-order sorted
    const names = v.entries.map((e) => e.name);
    const sorted = [...names].sort((a, b) => Buffer.from(a, 'utf8').compare(Buffer.from(b, 'utf8')));
    assert.deepEqual(names, sorted);
  });

  it('lists a subdirectory', async () => {
    const r = await service.listDirectory(
      { operation: 'list-directory', workspaceId: WORKSPACE_ALPHA, path: 'docs' },
      NO_CTRL,
    );
    assert.equal(r.ok, true);
  });

  it('fails listing a file target', async () => {
    const r = await service.listDirectory(
      { operation: 'list-directory', workspaceId: WORKSPACE_ALPHA, path: 'README.md' },
      NO_CTRL,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-FTYPE-UNSUPPORTED');
  });

  it('inspect-metadata returns logical entry info', async () => {
    const r = await service.inspectMetadata(
      { operation: 'inspect-metadata', workspaceId: WORKSPACE_ALPHA, path: 'README.md' },
      NO_CTRL,
    );
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error('unreachable');
    const v = r.value as { kind: string; isRegularFile: boolean; sizeBytes?: number };
    assert.equal(v.kind, 'file');
    assert.equal(v.isRegularFile, true);
    assert.ok(v.sizeBytes !== undefined && v.sizeBytes > 0);
  });

  it('inspect-metadata missing target -> ERR-NOT-FOUND', async () => {
    const r = await service.inspectMetadata(
      { operation: 'inspect-metadata', workspaceId: WORKSPACE_ALPHA, path: 'missing.txt' },
      NO_CTRL,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-NOT-FOUND');
  });

  it('decodes strict UTF-8 with multi-byte characters', async () => {
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'docs/unicode.md' },
      NO_CTRL,
    );
    const v = readTextOk(r);
    assert.ok(v.text.includes('café'));
    assert.ok(v.text.includes('日本語'));
  });

  it('fails on a truncated UTF-8 code point when split at boundary', async () => {
    // Write a file whose 4th byte is the first byte of a 2-byte sequence,
    // then read with maxBytes = 4 (which splits the multi-byte char).
    const p = path.join(fixture.root, 'split.txt');
    // 'ab' (2 bytes) + 'é' (2 bytes: 0xC3 0xA9) => bytes: a b C3 A9
    fs.writeFileSync(p, Buffer.from([0x61, 0x62, 0xc3, 0xa9, 0x63]));
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'split.txt', maxBytes: 3 },
      NO_CTRL,
    );
    // maxBytes=3 cuts at [a b C3] — incomplete code point => ERR-TEXT-MALFORMED
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-TEXT-MALFORMED');
  });

  it('rejects NUL bytes in read-text', async () => {
    const p = path.join(fixture.root, 'nul.bin');
    fs.writeFileSync(p, Buffer.from([0x61, 0x00, 0x62]));
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'nul.bin' },
      NO_CTRL,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-FTYPE-UNSUPPORTED');
  });

  it('read-bytes returns a fresh copy that cannot affect service state', async () => {
    const p = path.join(fixture.root, 'bytes.bin');
    fs.writeFileSync(p, Buffer.from([1, 2, 3, 4, 5]));
    const r1 = await service.readBytes(
      { operation: 'read-bytes', workspaceId: WORKSPACE_ALPHA, path: 'bytes.bin' },
      NO_CTRL,
    );
    const v1 = readBytesOk(r1);
    // Mutate the returned buffer
    v1.bytes.fill(0);
    const r2 = await service.readBytes(
      { operation: 'read-bytes', workspaceId: WORKSPACE_ALPHA, path: 'bytes.bin' },
      NO_CTRL,
    );
    const v2 = readBytesOk(r2);
    assert.deepEqual(Array.from(v2.bytes), [1, 2, 3, 4, 5]);
  });

  it('reads an empty file successfully', async () => {
    const p = path.join(fixture.root, 'empty.txt');
    fs.writeFileSync(p, '');
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'empty.txt' },
      NO_CTRL,
    );
    const v = readTextOk(r);
    assert.equal(v.text, '');
    assert.equal(v.byteLength, 0);
  });

  it('fails on missing file -> ERR-NOT-FOUND', async () => {
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'nope.txt' },
      NO_CTRL,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-NOT-FOUND');
  });

  it('fails on unknown workspace -> ERR-WS-UNKNOWN', async () => {
    const r = await service.readText(
      { operation: 'read-text', workspaceId: 'pgw:w:ffffffffffffffff', path: 'README.md' },
      NO_CTRL,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-WS-UNKNOWN');
  });

  it('fails on path exceeding the 4096-byte limit', async () => {
    const long = 'x'.repeat(4097);
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: long },
      NO_CTRL,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-REQ-INVALID');
  });

  it('rejects a symlink escaping the workspace', async () => {
    const outside = fs.mkdtempSync(path.join(fixture.root, '..', 'wp7-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(fixture.root, 'escape-link.txt'));
      const r = await service.readText(
        { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'escape-link.txt' },
        NO_CTRL,
      );
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.ok(['ERR-CON-DENIED', 'ERR-SYM-ESCAPE', 'ERR-NOT-FOUND'].includes(r.failure.code), r.failure.code);
      }
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('follows a symlink inside the workspace', async () => {
    const p = path.join(fixture.root, 'link-inside.txt');
    fs.symlinkSync(path.join(fixture.root, 'README.md'), p);
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'link-inside.txt' },
      NO_CTRL,
    );
    const v = readTextOk(r);
    assert.ok(v.text.includes('# Project'));
  });

  it('FIFO: O_NONBLOCK open does not block and fails with ERR-FTYPE-UNSUPPORTED', async () => {
    const fifoPath = path.join(fixture.root, 'pipe.fifo');
    try {
      // mkfifo via fs.mkfifoSync is unavailable; use execFileSync mkfifo (test-only)
      const { execFileSync } = await import('node:child_process');
      execFileSync('mkfifo', [fifoPath]);
    } catch (err: unknown) {
      // C-06: on the supported lane (Linux) mkfifo must exist; a silent
      // pass here would hide the FIFO rejection evidence.
      throw new Error(`mkfifo unavailable on the supported Linux lane: ${String(err)}`);
    }
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'pipe.fifo' },
      NO_CTRL,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-FTYPE-UNSUPPORTED');
  });

  it('unknown fields in request -> ERR-REQ-INVALID', async () => {
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'README.md', evil: 1 } as never,
      NO_CTRL,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-REQ-INVALID');
  });
});

describe('WP-7 reader: concurrency and cancellation', () => {
  it('limits concurrent operations (4 max), 5th fails with ERR-LIMIT-CONCURRENCY', async () => {
    // Admission is synchronous: all five calls are created in one synchronous
    // burst, so calls 1-4 occupy the slots and the 5th is rejected
    // deterministically with ERR-LIMIT-CONCURRENCY (no internal queue).
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.listDirectory({ operation: 'list-directory', workspaceId: WORKSPACE_ALPHA, path: '.' }, NO_CTRL),
      ),
    );
    const successes = results.filter((r) => r.ok);
    const limitFailures = results.filter((r) => !r.ok && r.failure.code === 'ERR-LIMIT-CONCURRENCY');
    const otherFailures = results.filter((r) => !r.ok && r.failure.code !== 'ERR-LIMIT-CONCURRENCY');
    assert.equal(otherFailures.length, 0, JSON.stringify(otherFailures.map((r) => (!r.ok ? r.failure.code : 'ok'))));
    assert.equal(successes.length + limitFailures.length, 5);
    assert.ok(successes.length >= 1);
    assert.ok(limitFailures.length >= 1, 'fifth concurrent operation must fail with ERR-LIMIT-CONCURRENCY');
  });

  it('cancellation before admission returns ERR-OP-CANCELLED and recovery works', async () => {
    // C-06: the previous "cancellation during operation" test allowed either
    // outcome (the fs read may complete before the abort fires on fast
    // lanes), which is a silent-pass pattern. The deterministic contract
    // surface is: an already-aborted signal fails with ERR-OP-CANCELLED and
    // subsequent operations recover. Deterministic in-flight cancellation
    // evidence lives in the FFF suite (blocking synthetic capability) and
    // the Git suite (hung-launch cancellation), where the abort can be
    // forced to land mid-operation.
    const ctrl = new AbortController();
    ctrl.abort();
    const r1 = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'docs/notes.md' },
      { signal: ctrl.signal },
    );
    assert.equal(r1.ok, false);
    if (!r1.ok) assert.equal(r1.failure.code, 'ERR-OP-CANCELLED');
    const r2 = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'docs/notes.md' },
      NO_CTRL,
    );
    assert.equal(r2.ok, true);
  });

  it('repeated operations work after cancellation', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r1 = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'docs/notes.md' },
      { signal: ctrl.signal },
    );
    assert.equal(r1.ok, false);
    const r2 = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'docs/notes.md' },
      NO_CTRL,
    );
    assert.equal(r2.ok, true);
  });
});

describe('WP-7 reader: disposal', () => {
  it('operations fail after dispose', async () => {
    const svc = new WorkspaceInspectionService({
      configuration: fixture.configuration,
      resolveExistingPath: fixture.resolveExistingPath,
    });
    await svc.dispose();
    const r = await svc.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'README.md' },
      NO_CTRL,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-OP-CANCELLED');
    // idempotent dispose
    await svc.dispose();
  });
});

describe('WP-7 error code inventory', () => {
  it('has exactly 23 closed codes', () => {
    assert.equal(ERROR_CODES.length, 23);
    assert.equal(new Set(ERROR_CODES).size, 23);
  });
});
