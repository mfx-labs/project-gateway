/**
 * WP-6 Phase 1 correction F-RR-1: descriptor-consistent object snapshot
 * regression (shared WP-4/WP-5A snapshot boundary).
 *
 * Object capture performs a single structural key-enumeration pass: every
 * own string key reported by `ownKeys` must carry exactly one own data
 * property descriptor. A listed key whose `getOwnPropertyDescriptor` returns
 * `undefined` (or that is reported non-enumerable, or that is an accessor)
 * fails closed and is never silently omitted; Proxy `get` traps never supply
 * protocol values; plain enumerable data objects remain byte-compatible.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotJson } from '../../src/index.js';
import { SnapshotError } from '../../src/internal/snapshot.js';

const plain = (): Record<string, unknown> => ({ a: 1, b: 'x', c: true, d: { e: [1, 2], f: null } });

test('snapshot-objects: ordinary plain objects remain supported', () => {
  const snap = snapshotJson(plain()) as Record<string, unknown>;
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), plain());
});

test('snapshot-objects: nested plain objects remain supported', () => {
  const input = { a: { b: { c: { d: [1, [2, { e: 'x' }]] } } } };
  const snap = snapshotJson(input) as Record<string, unknown>;
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), input);
  assert.equal(Object.isFrozen((snap['a'] as Record<string, unknown>)['b']), true);
});

test('snapshot-objects: object Proxy get trap count is zero', () => {
  let getCalls = 0;
  const objProxy = new Proxy(plain(), {
    get(t, p) {
      getCalls++;
      throw new Error(`get trap must not fire (${String(p)})`);
    },
  });
  const snap = snapshotJson(objProxy) as Record<string, unknown>;
  assert.equal(getCalls, 0);
  assert.equal(snap['a'], 1);
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), plain());
});

test('snapshot-objects: throwing object Proxy get trap is never invoked', () => {
  let getCalls = 0;
  const objProxy = new Proxy(plain(), {
    get(t, p) {
      getCalls++;
      if (p === 'a') throw new Error('get trap must not fire for protocol values');
      return Reflect.get(t, p);
    },
  });
  const snap = snapshotJson(objProxy) as Record<string, unknown>;
  assert.equal(getCalls, 0);
  assert.equal(snap['a'], 1);
});

test('snapshot-objects: ownKeys-listed key with missing descriptor fails closed (never omitted)', () => {
  const target = plain();
  const objProxy = new Proxy(target, {
    ownKeys(t) {
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, k) {
      if (k === 'd') return undefined; // advertised by ownKeys, not describable
      return Reflect.getOwnPropertyDescriptor(t, k);
    },
  });
  assert.throws(() => snapshotJson(objProxy), SnapshotError);
  // And a nested object inside a plain container fails the same way.
  const nested = new Proxy({ g: 1 }, {
    ownKeys(t) {
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, k) {
      if (k === 'g') return undefined;
      return Reflect.getOwnPropertyDescriptor(t, k);
    },
  });
  assert.throws(() => snapshotJson({ a: nested }), SnapshotError);
});

test('snapshot-objects: listed non-enumerable data property fails closed', () => {
  const target = plain();
  Object.defineProperty(target, 'hidden', { value: 'secret', writable: false, enumerable: false, configurable: false });
  assert.throws(() => snapshotJson(target), SnapshotError);
});

test('snapshot-objects: listed accessor property fails closed without invoking the getter', () => {
  let invoked = 0;
  const target = plain();
  Object.defineProperty(target, 'd', {
    enumerable: true,
    configurable: true,
    get() {
      invoked++;
      return { e: [1, 2], f: null };
    },
  });
  assert.throws(() => snapshotJson(target), SnapshotError);
  assert.equal(invoked, 0);
});

test('snapshot-objects: throwing ownKeys fails closed with a typed error', () => {
  const objProxy = new Proxy(plain(), {
    ownKeys() {
      throw new Error('ownKeys trap failure');
    },
  });
  assert.throws(() => snapshotJson(objProxy), SnapshotError);
});

test('snapshot-objects: throwing getOwnPropertyDescriptor fails closed with a typed error', () => {
  const objProxy = new Proxy(plain(), {
    getOwnPropertyDescriptor() {
      throw new Error('descriptor trap failure');
    },
  });
  assert.throws(() => snapshotJson(objProxy), SnapshotError);
});

test('snapshot-objects: throwing getPrototypeOf fails closed with a typed error', () => {
  const objProxy = new Proxy(plain(), {
    getPrototypeOf() {
      throw new Error('prototype trap failure');
    },
  });
  assert.throws(() => snapshotJson(objProxy), SnapshotError);
});

test('snapshot-objects: revoked Proxy fails closed', () => {
  const { proxy, revoke } = Proxy.revocable(plain(), {});
  revoke();
  assert.throws(() => snapshotJson(proxy), SnapshotError);
});

test('snapshot-objects: mutation after capture cannot change the snapshot', () => {
  const caller: Record<string, unknown> = { a: { b: [1, 2, 3] } };
  const snap = snapshotJson(caller) as { a: { b: number[] } };
  (caller['a'] as Record<string, unknown>)['b'] = [9, 9];
  (caller['a'] as Record<string, unknown>)['extra'] = 'x';
  assert.deepEqual([...snap['a']['b']], [1, 2, 3]);
  assert.equal('extra' in snap['a'], false);
});

test('snapshot-objects: nested inconsistent Proxy object fails closed', () => {
  const inner = new Proxy({ cap: 5 }, {
    ownKeys(t) {
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, k) {
      if (k === 'cap') return undefined;
      return Reflect.getOwnPropertyDescriptor(t, k);
    },
  });
  const outer = new Proxy({ nested: inner }, {
    ownKeys(t) {
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, k) {
      return Reflect.getOwnPropertyDescriptor(t, k);
    },
  });
  assert.throws(() => snapshotJson(outer), SnapshotError);
});

test('snapshot-objects: valid object canonical bytes remain unchanged', () => {
  // Byte-compatibility: the captured JSON of a plain enumerable data object
  // is unchanged from the pre-correction behavior.
  const input = {
    version: '1',
    list: ['a', 'b'],
    ceiling: 0,
    nested: { x: null, y: true },
  };
  const a = JSON.stringify(snapshotJson(input));
  const b = JSON.stringify(snapshotJson({ ...input }));
  assert.equal(a, b);
  assert.equal(a, '{"version":"1","list":["a","b"],"ceiling":0,"nested":{"x":null,"y":true}}');
});
