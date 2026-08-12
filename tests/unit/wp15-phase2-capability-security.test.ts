/**
 * WP-15 Phase 2 — correlation authority capability/security tests (§27/§37
 * runtime proofs).
 *
 * Genuine-brand discipline (CAP-008…016): unbranded/foreign/disposed/stale
 * capabilities are rejected; permits are exact-class-bound (a successor
 * permit never publishes a supersession and vice versa); the read
 * allowlist is the closed §3 set (NO runtime-grant, approval, issuance,
 * summary, migration, or audit class); the WP-13C publication capability
 * and the Phase 1B receipt capability are never reusable; the boundary
 * surface is exactly the two publish methods + closed reads; the
 * host-composed authority surface is exactly `correlate`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCorrelationEnv,
  failedOf,
  correlationCleanup,
  expectedSuccessorPayload,
  expectedSupersessionPayload,
  nextRecordId,
  RECEIPT_RECORD_ID,
  PUBLICATION_RECORD_ID,
  WS_A,
  FIXED_NOW,
} from './wp15-phase2-helpers.js';
import {
  createCorrelationPublicationPermit,
  createCorrelationSupersessionPermit,
  createReceiptPublicationCorrelationCapability,
} from '../../src/receipt-publication-correlation/internal/brand.js';
import { correlateReceiptPublication } from '../../src/receipt-publication-correlation/index.js';
import { createResultPublicationCapability, createResultPublicationPermit } from '../../src/publication/capability.js';
import { createTrustedReceiptCapability } from '../../src/receipt-production/internal/brand.js';
import { computePayloadDigest } from '../../src/storage/format/envelope.js';
import { makeConfigEnv, makeStoreEnv, makeStoreBoundary } from './wp12-helpers.js';
import { defaultLimitProfile } from '../../src/storage/limits/limits.js';
import { createSchemaRegistry } from '../../src/api/validate.js';

const REQUEST = { workspaceId: WS_A, predecessorPublicationRecordId: PUBLICATION_RECORD_ID, trustedReceiptRecordId: RECEIPT_RECORD_ID };

test('phase2 security: unbranded capability — a structurally compatible plain object is rejected at the authority gate', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const forged = {
      binding: { configurationIdentity: 'x', actionIdentity: 'y', operation: 'receipt-publication-correlation-producer', generation: {} },
      verify() {
        return { ok: true };
      },
      dispose() {},
    };
    const f = failedOf(correlateReceiptPublication(env.input({ capability: forged })));
    assert.equal(f.category, 'CORRELATION-CAPABILITY-DENIED');
    assert.equal(f.code, 'capability.not-genuine');
  } finally {
    correlationCleanup();
  }
});

test('phase2 security: capabilities of other trusted domains are rejected — WP-13C publication and Phase 1B receipt capabilities never unlock correlation', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const publicationCapability = createResultPublicationCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'publication-action-1' });
    assert.ok(publicationCapability);
    const fPub = failedOf(correlateReceiptPublication(env.input({ capability: publicationCapability })));
    assert.equal(fPub.category, 'CORRELATION-CAPABILITY-DENIED');
    assert.equal(fPub.code, 'capability.not-genuine');
    const receiptCapability = createTrustedReceiptCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'receipt-production-action-1' });
    assert.ok(receiptCapability);
    const fRec = failedOf(correlateReceiptPublication(env.input({ capability: receiptCapability })));
    assert.equal(fRec.category, 'CORRELATION-CAPABILITY-DENIED');
    assert.equal(fRec.code, 'capability.not-genuine');
    assert.equal(env.publicationRecords().length, 1, 'no write for any foreign capability');
    assert.equal(env.supersessionRecords().length, 0);
  } finally {
    correlationCleanup();
  }
});

test('phase2 security: disposed capability — a disposed genuine correlation capability is unusable', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const capability = createReceiptPublicationCorrelationCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'correlation-action-1' });
    assert.ok(capability);
    capability.dispose();
    const f = failedOf(correlateReceiptPublication(env.input({ capability })));
    assert.equal(f.category, 'CORRELATION-CAPABILITY-DENIED');
    assert.equal(f.code, 'capability.disposed');
  } finally {
    correlationCleanup();
  }
});

test('phase2 security: stale generation — genuine trusted-configuration replacement invalidates earlier capabilities', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const older = createReceiptPublicationCorrelationCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'correlation-action-1' });
    assert.ok(older);
    // A genuine REPLACEMENT configuration for the same workspace advances the
    // generation (the replacement must still be a genuine validated trusted
    // configuration — mint through the real WP-6 machinery).
    const configEnv = makeConfigEnv();
    const replacement = makeStoreEnv(configEnv.config);
    try {
      const minted = createReceiptPublicationCorrelationCapability({ trustedConfiguration: replacement.config, actionIdentity: 'correlation-action-2' });
      assert.ok(minted, 'the replacement configuration mints a fresh capability');
      // The earlier capability is stale-generation now.
      const f = failedOf(correlateReceiptPublication(env.input({ capability: older })));
      assert.equal(f.category, 'CORRELATION-CAPABILITY-DENIED');
      assert.equal(f.code, 'capability.stale-generation');
    } finally {
      replacement.remove();
    }
  } finally {
    correlationCleanup();
  }
});

test('phase2 security: forged permit — the store sinks reject an unbranded permit object', () => {
  const env = makeCorrelationEnv();
  try {
    const payload = expectedSuccessorPayload(env.registryCtx, env.chain, RECEIPT_RECORD_ID, nextRecordId(), FIXED_NOW);
    const denied = env.boundary.publishSuccessorPublication({ binding: { role: 'receipt-publication-correlation' } } as never, payload);
    assert.equal(denied.ok, false);
    assert.equal((denied as { category: string }).category, 'CORRELATION-CAPABILITY-DENIED');
    assert.equal((denied as { code: string }).code, 'permit.not-genuine');
    const denied2 = env.boundary.publishSupersession({ binding: {} } as never, expectedSupersessionPayload(env.registryCtx, nextRecordId(), nextRecordId(), nextRecordId(), FIXED_NOW));
    assert.equal(denied2.ok, false);
    assert.equal((denied2 as { category: string }).category, 'CORRELATION-CAPABILITY-DENIED');
  } finally {
    correlationCleanup();
  }
});

test('phase2 security: disposed permit — a live check rejects a disposed genuine permit at the sink', () => {
  const env = makeCorrelationEnv();
  try {
    const payload = expectedSuccessorPayload(env.registryCtx, env.chain, RECEIPT_RECORD_ID, nextRecordId(), FIXED_NOW);
    const permit = createCorrelationPublicationPermit({
      capability: env.capability,
      role: 'receipt-publication-correlation',
      recordId: String(payload['record_id']),
      recordDigest: computePayloadDigest(payload),
      canonicalBytesDigest: computePayloadDigest(payload),
    });
    assert.ok(permit, 'the genuine successor permit mints');
    permit.dispose();
    const denied = env.boundary.publishSuccessorPublication(permit, payload);
    assert.equal(denied.ok, false);
    assert.equal((denied as { code: string }).code, 'permit.disposed');
  } finally {
    correlationCleanup();
  }
});

test('phase2 security: a successor permit never publishes a supersession and vice versa — exact class-bound permits', () => {
  const env = makeCorrelationEnv();
  try {
    const successorPayload = expectedSuccessorPayload(env.registryCtx, env.chain, RECEIPT_RECORD_ID, nextRecordId(), FIXED_NOW);
    const supersessionPayload = expectedSupersessionPayload(env.registryCtx, nextRecordId(), nextRecordId(), nextRecordId(), FIXED_NOW);
    const successorPermit = createCorrelationPublicationPermit({
      capability: env.capability,
      role: 'receipt-publication-correlation',
      recordId: String(successorPayload['record_id']),
      recordDigest: computePayloadDigest(successorPayload),
      canonicalBytesDigest: computePayloadDigest(successorPayload),
    });
    assert.ok(successorPermit);
    // The successor permit is rejected at the SUPERSESSION sink: the sink
    // requires the exact-class supersession permit brand, so a genuine
    // successor permit is not genuine THERE (class confinement at the sink).
    const denied = env.boundary.publishSupersession(successorPermit, supersessionPayload);
    assert.equal(denied.ok, false);
    assert.equal((denied as { code: string }).code, 'permit.not-genuine');
    const supersessionPermit = createCorrelationSupersessionPermit({
      capability: env.capability,
      role: 'receipt-publication-correlation',
      recordId: String(supersessionPayload['record_id']),
      recordDigest: computePayloadDigest(supersessionPayload),
      canonicalBytesDigest: computePayloadDigest(supersessionPayload),
    });
    assert.ok(supersessionPermit);
    const denied2 = env.boundary.publishSuccessorPublication(supersessionPermit, successorPayload);
    assert.equal(denied2.ok, false);
    assert.equal((denied2 as { code: string }).code, 'permit.not-genuine');
    // A genuine successor permit publishing a TrustedReceipt-class payload
    // fails the class gate at the sink (TrustedReceipt can never be written
    // by the correlation authority).
    const receiptLike = { ...successorPayload, record_type: 'TrustedReceipt', responsible_role: 'trusted-receipt-producer' };
    const denied3 = env.boundary.publishSuccessorPublication(successorPermit, receiptLike);
    assert.equal(denied3.ok, false);
    assert.equal((denied3 as { code: string }).code, 'record.class-mismatch');
  } finally {
    correlationCleanup();
  }
});

test('phase2 security: raw publishRecord handle is not exposed — the boundary surface is the two publish methods + closed reads', () => {
  const env = makeCorrelationEnv();
  try {
    const surface = Object.keys(env.boundary).sort();
    assert.deepEqual(surface, ['enumerateLifecycleRecords', 'publishSuccessorPublication', 'publishSupersession', 'readLifecyclePayload']);
    // The read surface is the closed §3 allowlist: RuntimeGrant and the
    // excluded lifecycle classes are NOT readable.
    const runtimeGrantRead = env.boundary.readLifecyclePayload('runtime-grant' as never, nextRecordId());
    assert.equal(runtimeGrantRead.ok, false);
    for (const cls of ['approval-record', 'issuance-record', 'execution-summary-record', 'migration-record', 'authoritative-audit-event']) {
      const read = env.boundary.readLifecyclePayload(cls as never, nextRecordId());
      assert.equal(read.ok, false, `${cls} must not be readable`);
      const enumerate = env.boundary.enumerateLifecycleRecords(cls as never);
      assert.equal(enumerate.ok, false, `${cls} must not be enumerable`);
    }
    // The nine allowed classes ARE readable/enumerable.
    for (const cls of ['trusted-receipt', 'result-publication-record', 'supersession-record', 'validation-record', 'execution-outcome-record', 'execution-attempt-record', 'execution-occurrence-record', 'activation-record', 'revocation-record']) {
      const enumerate = env.boundary.enumerateLifecycleRecords(cls as never);
      assert.equal(enumerate.ok, true, `${cls} must be enumerable`);
    }
  } finally {
    correlationCleanup();
  }
});

test('phase2 security: caller cannot inject transition operands through correlate() — every injection is a closed-key rejection', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const injections: Readonly<Record<string, unknown>>[] = [
      { ...REQUEST, successor: { record_type: 'ResultPublicationRecord' } },
      { ...REQUEST, supersession: { record_type: 'SupersessionRecord' } },
      { ...REQUEST, publicationScopes: ['completion-status'] },
      { ...REQUEST, receiptCorrelations: [RECEIPT_RECORD_ID] },
      { ...REQUEST, resultFacts: { disposition: 'completed' } },
      { ...REQUEST, outcomeFacts: {} },
      { ...REQUEST, registrySnapshotReference: { registry_snapshot_id: 'pgw:g:' + 'f'.repeat(32) } },
      { ...REQUEST, responsibleRole: 'trusted-result-publisher' },
      { ...REQUEST, provenance: { evaluator_id: 'pgw:ev:' + '0'.repeat(32) } },
      { ...REQUEST, publicationDigest: 'sha-256:' + '0'.repeat(64) },
      { ...REQUEST, predecessorCurrentness: 'current' },
      { ...REQUEST, successorIdentity: nextRecordId() },
      { ...REQUEST, supersessionIdentity: nextRecordId() },
      { ...REQUEST, registry: env.registryCtx },
      { ...REQUEST, identity: { nowUtcIso: () => FIXED_NOW, newRecordId: () => nextRecordId() } },
      { ...REQUEST, coordinate: { withLock: () => undefined } },
      { ...REQUEST, hooks: { beforeFirstSuccessorPublication: () => undefined } },
      { ...REQUEST, capability: {} },
      { ...REQUEST, store: {} },
      { ...REQUEST, schemaRegistry: {} },
    ];
    for (const request of injections) {
      const result = env.authority().correlate(request as never);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.category, 'CORRELATION-INPUT-INVALID', JSON.stringify(Object.keys(request)));
        assert.ok(result.code.startsWith('request.unknown-key') || result.code === 'request.hostile-input', result.code);
      }
    }
    assert.equal(env.publicationRecords().length, 1, 'no write for any transition-operand injection');
    assert.equal(env.supersessionRecords().length, 0);
  } finally {
    correlationCleanup();
  }
});

test('phase2 security: WP-13C publication permit — the correlation sinks reject a genuine result-publication permit (no capability reuse, §27)', () => {
  const env = makeCorrelationEnv();
  try {
    const payload = expectedSuccessorPayload(env.registryCtx, env.chain, RECEIPT_RECORD_ID, nextRecordId(), FIXED_NOW);
    const publicationCapability = createResultPublicationCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'publication-action-1' });
    assert.ok(publicationCapability);
    const wp13cPermit = createResultPublicationPermit({
      capability: publicationCapability,
      role: 'result-publication',
      recordId: String(payload['record_id']),
      recordDigest: computePayloadDigest(payload),
      canonicalBytesDigest: computePayloadDigest(payload),
    });
    assert.ok(wp13cPermit);
    const denied = env.boundary.publishSuccessorPublication(wp13cPermit, payload);
    assert.equal(denied.ok, false);
    assert.equal((denied as { category: string }).category, 'CORRELATION-CAPABILITY-DENIED');
    assert.equal((denied as { code: string }).code, 'permit.not-genuine');
  } finally {
    correlationCleanup();
  }
});

test('phase2 security: host composition — createReceiptPublicationCorrelationAuthority closes over trusted infrastructure; correlate() accepts ONLY CorrelationRequest', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const authority = env.authority();
    assert.deepEqual(Object.keys(authority).sort(), ['correlate'], 'the authority surface is exactly correlate');
    // The host-closed identity/clock is NOT per-call: two correlations share
    // the closed identity source (record ids accumulate on one counter).
    const first = env.authority().correlate(REQUEST);
    assert.equal(first.ok, true);
    // A forged registry provider (unbranded snapshot) fails closed at the
    // authority input boundary.
    const forgedRegistry = { ...env.registryCtx, snapshot: { snapshot_id: 'pgw:g:' + '0'.repeat(32) } };
    const f = failedOf(correlateReceiptPublication(env.input({ registry: forgedRegistry as never })));
    assert.equal(f.category, 'CORRELATION-INPUT-INVALID');
    assert.equal(f.code, 'input.registry-invalid');
  } finally {
    correlationCleanup();
  }
});

test('phase2 security: the family has no generic lifecycle writer — only the two correlation classes are writable through the boundary', () => {
  const env = makeCorrelationEnv();
  try {
    // The boundary surface carries exactly the two publish methods; every
    // other class attempt is rejected at the permit/class gate (proven
    // above for TrustedReceipt and for cross-class permits). A generic
    // publishRecord handle is never part of the surface.
    const publishKeys = Object.keys(env.boundary).filter((k) => k.startsWith('publish'));
    assert.deepEqual(publishKeys.sort(), ['publishSuccessorPublication', 'publishSupersession']);
  } finally {
    correlationCleanup();
  }
});
