/**
 * WP-6 Phase 1 correction F-1: descriptor-derived array snapshot regression
 * (shared WP-4/WP-5A snapshot boundary).
 *
 * Array capture is descriptor-derived: length and every index are acquired
 * through own property descriptors; Proxy `get` traps never supply protocol
 * values; accessors, sparse holes, unexpected own string properties, symbol
 * keys, and malformed lengths fail closed; plain-array snapshots remain
 * byte-compatible with the accepted canonical JSON contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotJson } from '../../src/index.js';
import { SnapshotError } from '../../src/internal/snapshot.js';

const plain = (): Record<string, unknown> => ({ a: 1, b: [1, 2, 3], c: 'x', d: [[true, null], ['y']] });

test('snapshot-arrays: plain arrays remain supported and byte-compatible', () => {
  const snap = snapshotJson(plain()) as Record<string, unknown>;
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), plain());
});

test('snapshot-arrays: nested arrays remain supported', () => {
  const input = { nested: [[1, [2, [3]]], [], ['a', 'b']] };
  const snap = snapshotJson(input) as Record<string, unknown>;
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), input);
  assert.equal(Object.isFrozen((snap['nested'] as unknown[])[0]), true);
});

test('snapshot-arrays: array Proxy get trap count is zero', () => {
  let getCalls = 0;
  const inner = [1, 2, 3];
  const arrProxy = new Proxy(inner, {
    get(t, p) {
      getCalls++;
      throw new Error(`get trap must not fire (${String(p)})`);
    },
  });
  const snap = snapshotJson({ b: arrProxy }) as { b: number[] };
  assert.equal(getCalls, 0);
  assert.deepEqual([...snap['b']], [1, 2, 3]);
});

test('snapshot-arrays: throwing array get trap is never invoked', () => {
  let getCalls = 0;
  const arrProxy = new Proxy([1, 2], {
    get(t, p) {
      getCalls++;
      if (p === '0') throw new Error('index get must not fire');
      return Reflect.get(t, p);
    },
  });
  const snap = snapshotJson({ b: arrProxy }) as { b: number[] };
  assert.equal(getCalls, 0);
  assert.deepEqual([...snap['b']], [1, 2]);
});

test('snapshot-arrays: nested Proxy arrays are captured descriptor-derively', () => {
  let getCalls = 0;
  const inner = new Proxy([7, 8], {
    get(t, p) {
      getCalls++;
      throw new Error(`nested get fired (${String(p)})`);
    },
  });
  const snap = snapshotJson({ b: [inner] }) as { b: number[][] };
  assert.equal(getCalls, 0);
  assert.deepEqual([...snap['b'][0]!], [7, 8]);
});

test('snapshot-arrays: throwing descriptor traps fail closed with a typed error', () => {
  const arrProxy = new Proxy([1], {
    getOwnPropertyDescriptor() {
      throw new Error('descriptor trap failure');
    },
  });
  assert.throws(() => snapshotJson({ b: arrProxy }), SnapshotError);
});

test('snapshot-arrays: accessor index descriptors are rejected without invocation', () => {
  let invoked = 0;
  const arrProxy = new Proxy([1], {
    getOwnPropertyDescriptor(t, p) {
      if (p === '0') {
        return {
          enumerable: true,
          configurable: true,
          get() {
            invoked++;
            return 99;
          },
        };
      }
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
  });
  assert.throws(() => snapshotJson({ b: arrProxy }), SnapshotError);
  assert.equal(invoked, 0);
});

test('snapshot-arrays: accessor length descriptors are rejected without invocation', () => {
  let invoked = 0;
  const arrProxy = new Proxy([1, 2], {
    getOwnPropertyDescriptor(t, p) {
      if (p === 'length') {
        return {
          enumerable: false,
          configurable: false,
          get() {
            invoked++;
            return 2;
          },
        };
      }
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
  });
  assert.throws(() => snapshotJson({ b: arrProxy }), SnapshotError);
  assert.equal(invoked, 0);
});

test('snapshot-arrays: changing index descriptors fail closed when they surface an accessor', () => {
  // Stateful structural Proxy: descriptor pass exposes an accessor for index 0.
  let accessorMode = false;
  const arrProxy = new Proxy([1, 2], {
    getOwnPropertyDescriptor(t, p) {
      if (p === '0' && accessorMode) {
        return { enumerable: true, configurable: true, get: () => 99 };
      }
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
  });
  const first = snapshotJson({ b: arrProxy }) as { b: number[] };
  assert.deepEqual([...first['b']], [1, 2]);
  accessorMode = true;
  assert.throws(() => snapshotJson({ b: arrProxy }), SnapshotError);
});

test('snapshot-arrays: sparse arrays are rejected deterministically', () => {
  const sparse: unknown[] = [];
  sparse[0] = 1;
  sparse[2] = 3; // hole at index 1
  assert.throws(() => snapshotJson({ b: sparse }), SnapshotError);
  // Deterministic across repeated calls.
  assert.throws(() => snapshotJson({ b: sparse }), SnapshotError);
});

test('snapshot-arrays: post-snapshot mutation has no effect', () => {
  const caller: Record<string, unknown> = { b: [1, 2, 3] };
  const snap = snapshotJson(caller) as { b: number[] };
  (caller['b'] as number[])[0] = 99;
  (caller['b'] as number[]).push(4);
  assert.deepEqual([...snap['b']], [1, 2, 3]);
});

test('snapshot-arrays: unexpected own string properties on arrays are rejected', () => {
  const arr: unknown[] = [1];
  (arr as unknown as Record<string, unknown>)['extra'] = 'x';
  assert.throws(() => snapshotJson({ b: arr }), SnapshotError);
});

test('snapshot-arrays: symbol properties on arrays are rejected', () => {
  const arr: unknown[] = [1];
  Object.defineProperty(arr, Symbol('x'), { value: 1, enumerable: true });
  assert.throws(() => snapshotJson({ b: arr }), SnapshotError);
});

test('snapshot-arrays: symbol properties on objects are rejected', () => {
  const obj: Record<string, unknown> = { a: 1 };
  Object.defineProperty(obj, Symbol('x'), { value: 1, enumerable: true });
  assert.throws(() => snapshotJson(obj), SnapshotError);
});

test('snapshot-arrays: malformed array length fails closed', () => {
  const arrProxy = new Proxy([1, 2], {
    getOwnPropertyDescriptor(t, p) {
      if (p === 'length') return { value: 2.5, writable: true, enumerable: false, configurable: false };
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
  });
  assert.throws(() => snapshotJson({ b: arrProxy }), SnapshotError);
});

test('snapshot-arrays: revoked array proxy fails closed', () => {
  const { proxy, revoke } = Proxy.revocable([1, 2], {});
  revoke();
  assert.throws(() => snapshotJson({ b: proxy }), SnapshotError);
});
