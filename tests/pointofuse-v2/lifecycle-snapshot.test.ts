/**
 * WP-6 Phase 3A: lifecycle records-array snapshot tests (contract Section 12;
 * HCR-03 Model A — frozen array of branded wrapper references). Duplicate
 * checking, lookup, evaluation inputs, and identity projections derive from
 * the one detached snapshot; the original array is never reread and the live
 * `findRecord` is never consulted as a semantic source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotLifecycleRecords, createDetachedFindRecord } from '../../src/pointofuse/index.js';
import { brandedRecord } from './helpers.js';

const recordsOf = (records: unknown[]): unknown[] => records;

test('E: valid branded records snapshot with deterministic lookup', () => {
  const r = snapshotLifecycleRecords(recordsOf([brandedRecord('rec-b'), brandedRecord('rec-a')]));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.snapshot.records.length, 2);
  assert.equal(r.snapshot.lookup.get('rec-a')?.recordId, 'rec-a');
  assert.equal(r.snapshot.lookup.get('rec-b')?.recordId, 'rec-b');
  assert.equal(r.snapshot.lookup.get('missing'), undefined);
});

test('E: forged records rejected as record-brand', () => {
  const r = snapshotLifecycleRecords([{ recordType: 'ValidationRecord', recordId: 'forged', level: 'structural-valid', model: {} }]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'record-brand');
});

test('E: non-array rejected', () => {
  for (const value of ['x', 42, null, { records: [] }]) {
    const r = snapshotLifecycleRecords(value);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'array-hostile');
  }
});

test('E: sparse array rejected', () => {
  const arr: unknown[] = [brandedRecord('rec-1')];
  arr.length = 3; // holes at 1 and 2
  const r = snapshotLifecycleRecords(arr);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'array-hostile');
});

test('E: accessor index rejected', () => {
  const arr: unknown[] = [brandedRecord('rec-1')];
  Object.defineProperty(arr, '1', { enumerable: true, get: () => brandedRecord('rec-2') });
  arr.length = 2;
  const r = snapshotLifecycleRecords(arr);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'array-hostile');
});

test('E: extra array property rejected', () => {
  const arr: unknown[] = [brandedRecord('rec-1')];
  (arr as unknown as Record<string, unknown>)['extra'] = brandedRecord('rec-2');
  const r = snapshotLifecycleRecords(arr);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'array-hostile');
});

test('E: symbol property rejected', () => {
  const arr: unknown[] = [brandedRecord('rec-1')];
  (arr as unknown as Record<symbol, unknown>)[Symbol('x')] = 1;
  const r = snapshotLifecycleRecords(arr);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'array-hostile');
});

test('E: duplicate record ID fails closed', () => {
  const r = snapshotLifecycleRecords([brandedRecord('rec-1'), brandedRecord('rec-1', { other: true })]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'duplicate-record-id');
});

test('E: source-array mutation after capture has no effect', () => {
  const source = [brandedRecord('rec-1')];
  const r = snapshotLifecycleRecords(source);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  source.push(brandedRecord('rec-2'));
  source[0] = brandedRecord('rec-3');
  assert.equal(r.snapshot.records.length, 1);
  assert.equal(r.snapshot.records[0]!.recordId, 'rec-1');
  assert.equal(r.snapshot.lookup.has('rec-2'), false);
});

test('E: deterministic lookup backs findRecord; live method not consulted', () => {
  let liveCalls = 0;
  const live = {
    records: [brandedRecord('rec-1')],
    findRecord() {
      liveCalls++;
      return undefined;
    },
  };
  const r = snapshotLifecycleRecords(live.records);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const findRecord = createDetachedFindRecord(r.snapshot.lookup);
  assert.equal(findRecord('rec-1')?.recordId, 'rec-1');
  assert.equal(findRecord('missing'), undefined);
  assert.equal(liveCalls, 0, 'live findRecord must never be consulted');
});

test('E: canonical projection sorted by record ID', () => {
  const r = snapshotLifecycleRecords([brandedRecord('rec-c'), brandedRecord('rec-a'), brandedRecord('rec-b')]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.snapshot.projections.map((p) => p.recordId), ['rec-a', 'rec-b', 'rec-c']);
  for (const p of r.snapshot.projections) {
    assert.equal(Object.isFrozen(p), true);
    assert.equal(Object.isFrozen(p.model), true);
  }
});

test('E: revoked array proxy fails closed', () => {
  const revoked = Proxy.revocable([brandedRecord('rec-1')], {});
  revoked.revoke();
  const r = snapshotLifecycleRecords(revoked.proxy);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'array-hostile');
});

test('E: descriptor trap fails closed', () => {
  const hostile = new Proxy([brandedRecord('rec-1')], {
    getOwnPropertyDescriptor() {
      throw new Error('gopd');
    },
  });
  const r = snapshotLifecycleRecords(hostile);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'array-hostile');
});

test('E: empty records array is valid', () => {
  const r = snapshotLifecycleRecords([]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.snapshot.records.length, 0);
  assert.deepEqual(r.snapshot.projections, []);
});
