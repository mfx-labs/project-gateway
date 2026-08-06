/**
 * WP-8-B tests: the closed 18-class record taxonomy (contract 6.2,
 * TAX-001…014).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECORD_CLASS_IDS,
  RECORD_CLASS_PROFILES,
  RECORD_CLASS_BY_ID,
  STORE_EVIDENCE_KIND_SET,
  isAcceptedRecordClass,
  recordClassProfile,
} from '../../../src/storage/index.js';

test('taxonomy: exactly 18 classes, unique ids, unique segments', () => {
  assert.equal(RECORD_CLASS_IDS.length, 18);
  assert.equal(RECORD_CLASS_PROFILES.length, 18);
  assert.equal(new Set(RECORD_CLASS_IDS).size, 18);
  assert.equal(new Set(RECORD_CLASS_PROFILES.map((p) => p.segment)).size, 18);
  for (const id of RECORD_CLASS_IDS) assert.equal(isAcceptedRecordClass(id), true);
  assert.equal(isAcceptedRecordClass('unknown-class'), false);
});

test('taxonomy: expected composition (13 WP-2 lifecycle + audit + snapshot + metadata + evidence + config)', () => {
  const ids: Set<string> = new Set(RECORD_CLASS_IDS as readonly string[]);
  const lifecycle = [
    'validation-record', 'approval-record', 'issuance-record', 'revocation-record', 'runtime-grant',
    'activation-record', 'execution-occurrence-record', 'execution-attempt-record', 'trusted-receipt',
    'result-publication-record', 'supersession-record', 'execution-summary-record', 'migration-record',
  ];
  for (const id of lifecycle) assert.equal(ids.has(id), true, id);
  for (const extra of ['authoritative-audit-event', 'registry-snapshot', 'store-metadata', 'store-evidence-record', 'configuration-snapshot-record']) {
    assert.equal(ids.has(extra), true, extra);
  }
  assert.equal(new Set([...lifecycle, 'authoritative-audit-event', 'registry-snapshot', 'store-metadata', 'store-evidence-record', 'configuration-snapshot-record']).size, 18);
});

test('taxonomy: layout attributes (segment, suffix, namespace)', () => {
  const approval = RECORD_CLASS_BY_ID.get('approval-record');
  assert.equal(approval?.segment, 'approval'); // Appendix H vector class segment
  assert.equal(approval?.suffix, '.rec');
  assert.equal(approval?.namespace, 'store-records');
  const audit = RECORD_CLASS_BY_ID.get('authoritative-audit-event');
  assert.equal(audit?.suffix, '.aud');
  const config = RECORD_CLASS_BY_ID.get('configuration-snapshot-record');
  assert.equal(config?.namespace, 'configuration');
  assert.equal(config?.profile, 'configuration-snapshot');
  const evidence = RECORD_CLASS_BY_ID.get('store-evidence-record');
  assert.equal(evidence?.profile, 'store-evidence');
  assert.equal(evidence?.wp8Production, 'maintenance');
  const metadata = RECORD_CLASS_BY_ID.get('store-metadata');
  assert.equal(metadata?.wp8Production, 'initialization');
});

test('taxonomy: WP-8 never becomes a lifecycle semantic producer', () => {
  for (const p of RECORD_CLASS_PROFILES) {
    assert.equal(p.lifecycleEffect, 'none');
  }
  const lifecycleProducers = RECORD_CLASS_PROFILES.filter((p) => p.profile === 'lifecycle-record' && p.id !== 'authoritative-audit-event');
  for (const p of lifecycleProducers) {
    assert.equal(p.wp8Production, 'no', p.id);
  }
  // Audit reconstruction is the only WP-8-producible event form (CSA-013).
  const audit = RECORD_CLASS_BY_ID.get('authoritative-audit-event');
  assert.equal(audit?.wp8Production, 'reconstruction-only');
});

test('taxonomy: StoreEvidenceRecord closed evidence-kind set (TAX-013)', () => {
  const expected = [
    'recovery-evidence', 'retention-evidence', 'quarantine-evidence', 'lock-recovery-evidence',
    'initialization-evidence', 'migration-evidence', 'audit-reconstruction-evidence',
  ];
  assert.deepEqual([...STORE_EVIDENCE_KIND_SET].sort(), [...expected].sort());
  assert.equal(new Set(STORE_EVIDENCE_KIND_SET).size, 7);
});

test('taxonomy: unknown class lookup returns undefined (fail-closed on read)', () => {
  assert.equal(recordClassProfile('not-a-class'), undefined);
});

test('taxonomy: no class is counted twice or concealed as a subtype', () => {
  const labels = RECORD_CLASS_PROFILES.map((p) => p.label);
  assert.equal(new Set(labels).size, 18);
  assert.equal(RECORD_CLASS_BY_ID.size, 18);
});
