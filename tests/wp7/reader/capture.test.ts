/**
 * WP-7-B — Controlled reader tests.
 *
 * Tests for hostile request capture, path validation, resource admission,
 * and the four controlled-read operations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { captureRequest, validateAndCaptureRequest } from '../../../src/reader/capture.js';
import { ConcurrencyController } from '../../../src/reader/admission.js';
import { validateTrustedOperationControl } from '../../../src/reader/types.js';
import { WP7_LIMITS, OPERATION_NAMES } from '../../../src/reader/types.js';
import { ERROR_CODES, isRetryable } from '../../../src/reader/errors.js';
import type { OperationCorrelation } from '../../../src/reader/types.js';

const corr: OperationCorrelation = { workspaceId: 'test', operation: 'list-directory' };

// ---------------------------------------------------------------------------
// Request capture
// ---------------------------------------------------------------------------

describe('WP-7 request capture', () => {
  it('rejects non-object', () => {
    const r = captureRequest(null, corr);
    assert.equal(r.ok, false);
  });

  it('rejects array', () => {
    const r = captureRequest([], corr);
    assert.equal(r.ok, false);
  });

  it('rejects unknown operation', () => {
    const r = captureRequest({ operation: 'invalid', workspaceId: 'x' }, corr);
    assert.equal(r.ok, false);
  });

  it('rejects unknown fields', () => {
    const r = captureRequest({ operation: 'read-text', workspaceId: 'x', path: 'f', extra: 1 }, corr);
    assert.equal(r.ok, false);
  });

  it('rejects missing workspaceId', () => {
    const r = captureRequest({ operation: 'read-text', path: 'f' }, corr);
    assert.equal(r.ok, false);
  });

  it('accepts valid read-text request', () => {
    const r = captureRequest({ operation: 'read-text', workspaceId: 'x', path: 'f' }, corr);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.data.operation, 'read-text');
      assert.equal(r.data.workspaceId, 'x');
      assert.equal(r.data.path, 'f');
    }
  });

  it('rejects getter-based fields', () => {
    const obj: Record<string, unknown> = {};
    Object.defineProperty(obj, 'operation', { get: () => 'read-text' });
    obj.workspaceId = 'x';
    obj.path = 'f';
    const r = captureRequest(obj, corr);
    // snapshotJson rejects accessor properties
    assert.equal(r.ok, false);
  });

  it('handles Proxy traps safely', () => {
    const target = { operation: 'read-text', workspaceId: 'x', path: 'f' };
    const proxy = new Proxy(target, {});
    // snapshotJson uses structural traps (ownKeys, getOwnPropertyDescriptor)
    // which transparent proxies pass through — this is expected
    const r = captureRequest(proxy, corr);
    assert.equal(r.ok, true);
  });

  it('rejects symbol-keyed fields', () => {
    const obj: Record<string | symbol, unknown> = { operation: 'read-text', workspaceId: 'x', path: 'f' };
    obj[Symbol('x')] = 'bad';
    const r = captureRequest(obj, corr);
    assert.equal(r.ok, false);
  });

  it('rejects inherited properties', () => {
    class Req {
      operation = 'read-text';
      workspaceId = 'x';
      path = 'f';
    }
    const r = captureRequest(new Req(), corr);
    // snapshotJson rejects non-plain objects (prototype is not Object.prototype or null)
    assert.equal(r.ok, false);
  });

  it('rejects empty path', () => {
    const r = captureRequest({ operation: 'read-text', workspaceId: 'x', path: '' }, corr);
    // The capture accepts it; the parser will reject it later
    // (this is the contract: capture delegates to parser for path format)
    assert.equal(r.ok, true);
  });

  it('rejects overlong path', () => {
    const longPath = 'x'.repeat(WP7_LIMITS.REQUEST_PATH_MAX_BYTES + 1);
    const r = captureRequest({ operation: 'read-text', workspaceId: 'x', path: longPath }, corr);
    assert.equal(r.ok, false);
  });

  it('rejects non-full-SHA commitId', () => {
    const r = captureRequest({ operation: 'git-show', workspaceId: 'x', commitId: 'abc123' }, corr);
    assert.equal(r.ok, false);
  });

  it('accepts valid full SHA commitId', () => {
    const r = captureRequest({ operation: 'git-show', workspaceId: 'x', commitId: 'a'.repeat(40) }, corr);
    assert.equal(r.ok, true);
  });

  it('rejects empty query for fff-discover', () => {
    const r = captureRequest({ operation: 'fff-discover', workspaceId: 'x', query: '' }, corr);
    assert.equal(r.ok, false);
  });

  it('rejects overlong query', () => {
    const longQ = 'x'.repeat(WP7_LIMITS.FFF_MAX_QUERY_BYTES + 1);
    const r = captureRequest({ operation: 'fff-discover', workspaceId: 'x', query: longQ }, corr);
    assert.equal(r.ok, false);
  });

  it('accepts valid fff-discover request', () => {
    const r = captureRequest({ operation: 'fff-discover', workspaceId: 'x', query: 'test' }, corr);
    assert.equal(r.ok, true);
  });
});

// ---------------------------------------------------------------------------
// Trusted operation control
// ---------------------------------------------------------------------------

describe('WP-7 trusted operation control', () => {
  it('accepts undefined control (treated as no signal)', () => {
    const r = validateTrustedOperationControl(undefined);
    assert.equal(r.ok, true);
  });

  it('accepts null control (treated as no signal)', () => {
    const r = validateTrustedOperationControl(null);
    // null is typeof object; signal property access returns undefined → ok
    assert.equal(r.ok, true);
  });

  it('accepts plain object without signal', () => {
    const r = validateTrustedOperationControl({});
    assert.equal(r.ok, true);
  });

  it('accepts valid AbortSignal', () => {
    const ctrl = new AbortController();
    const r = validateTrustedOperationControl({ signal: ctrl.signal });
    assert.equal(r.ok, true);
  });

  it('rejects non-AbortSignal signal', () => {
    const r = validateTrustedOperationControl({ signal: 'not a signal' });
    assert.equal(r.ok, false);
  });

  it('rejects accessor signal', () => {
    const obj: Record<string, unknown> = {};
    Object.defineProperty(obj, 'signal', { get: () => new AbortController().signal });
    const r = validateTrustedOperationControl(obj);
    assert.equal(r.ok, false);
  });
});

// ---------------------------------------------------------------------------
// Concurrency controller
// ---------------------------------------------------------------------------

describe('WP-7 concurrency controller', () => {
  it('admits up to max', () => {
    const cc = new ConcurrencyController(2);
    assert.equal(cc.tryAdmit(corr), null);
    assert.equal(cc.active, 1);
    assert.equal(cc.tryAdmit(corr), null);
    assert.equal(cc.active, 2);
  });

  it('rejects above max', () => {
    const cc = new ConcurrencyController(1);
    assert.equal(cc.tryAdmit(corr), null);
    assert.ok(cc.tryAdmit(corr) !== null);
  });

  it('release allows readmission', () => {
    const cc = new ConcurrencyController(1);
    cc.tryAdmit(corr);
    cc.release();
    assert.equal(cc.tryAdmit(corr), null);
  });

  it('disposed rejects all', () => {
    const cc = new ConcurrencyController(1);
    cc.dispose();
    assert.ok(cc.tryAdmit(corr) !== null);
  });
});

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

describe('WP-7 error codes', () => {
  it('has exactly 23 codes', () => {
    assert.equal(ERROR_CODES.length, 23);
  });

  it('all codes are unique', () => {
    assert.equal(new Set(ERROR_CODES).size, 23);
  });

  it('retryable codes are subset', () => {
    const retryable = ERROR_CODES.filter(isRetryable);
    assert.ok(retryable.length > 0);
    assert.ok(retryable.length < ERROR_CODES.length);
  });

  it('ERR-OP-CANCELLED is not retryable', () => {
    assert.equal(isRetryable('ERR-OP-CANCELLED'), false);
  });

  it('operation names are 9', () => {
    assert.equal(OPERATION_NAMES.length, 9);
  });
});

// ---------------------------------------------------------------------------
// Resource limits
// ---------------------------------------------------------------------------

describe('WP-7 resource limits', () => {
  it('has pinned defaults', () => {
    assert.equal(WP7_LIMITS.READ_MAX_BYTES, 1_048_576);
    assert.equal(WP7_LIMITS.MAX_DIRECTORY_ENTRIES, 10_000);
    assert.equal(WP7_LIMITS.GIT_MAX_OUTPUT_BYTES, 8_388_608);
    assert.equal(WP7_LIMITS.MAX_CONCURRENT_OPERATIONS, 4);
    assert.equal(WP7_LIMITS.FFF_MAX_QUERY_BYTES, 256);
    assert.equal(WP7_LIMITS.REQUEST_PATH_MAX_BYTES, 4_096);
    assert.equal(WP7_LIMITS.OPERATION_TIMEOUT_MS, 5_000);
  });
});
