/**
 * WP-6 Phase 3A: exact-own nested input capture tests (contract Sections 5, 6,
 * 8, 11). Outer/inner version correlation, workspace detachment, consumer
 * canonicalization, registry brand, lifecycle snapshot, views, and bare-model
 * capture for both the v2 and the detached v1 paths.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureV1Input, captureV2Input, detachedWorkspacesEqual } from '../../src/pointofuse/index.js';
import { validV1Input, validV2Input, countingGetProxy, brandedRecord, brandedRegistrySnapshot } from './helpers.js';

// ---------------------------------------------------------------------------
// outer/inner versions
// ---------------------------------------------------------------------------

test('B: outer "2" plus inner "2" captures successfully', () => {
  const r = captureV2Input(validV2Input());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.input.pointOfUseInputsProtocolVersion, '2');
  assert.equal(r.input.workspaceId, 'ws-a');
});

test('B: missing inner version is inner-version-missing', () => {
  const input = validV2Input();
  delete input['pointOfUseInputsProtocolVersion'];
  const r = captureV2Input(input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'inner-version-missing');
});

test('B: inner "1" is inner-version-mismatch', () => {
  const r = captureV2Input(validV2Input({ pointOfUseInputsProtocolVersion: '1' }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'inner-version-mismatch');
});

test('B: inner "3" is inner-version-mismatch', () => {
  const r = captureV2Input(validV2Input({ pointOfUseInputsProtocolVersion: '3' }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'inner-version-mismatch');
});

test('B: inner number 2 is inner-version-mismatch', () => {
  const r = captureV2Input(validV2Input({ pointOfUseInputsProtocolVersion: 2 }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'inner-version-mismatch');
});

test('B: inherited inner version fails closed as inner-version-missing', () => {
  // The version key must be an OWN enumerable data descriptor; an inherited
  // version field is rejected (contract Section 11).
  const proto = { pointOfUseInputsProtocolVersion: '2' };
  const input = Object.create(proto);
  for (const [k, v] of Object.entries(validV2Input())) {
    if (k !== 'pointOfUseInputsProtocolVersion') input[k] = v;
  }
  const r = captureV2Input(input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'inner-version-missing');
});

test('B: accessor inner version is inner-version-mismatch without invocation', () => {
  let invoked = 0;
  const input = validV2Input();
  Object.defineProperty(input, 'pointOfUseInputsProtocolVersion', {
    enumerable: true,
    get() {
      invoked++;
      return '2';
    },
  });
  const r = captureV2Input(input);
  assert.equal(r.ok, false);
  assert.equal(invoked, 0);
  if (!r.ok) assert.equal(r.code, 'inner-version-mismatch');
});

test('B: non-enumerable inner version is inner-version-mismatch', () => {
  const input = validV2Input();
  Object.defineProperty(input, 'pointOfUseInputsProtocolVersion', { value: '2', enumerable: false });
  const r = captureV2Input(input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'inner-version-mismatch');
});

test('B: no identity can be constructed before both versions are valid', () => {
  // Phase 3A exposes no router; assert the boundary contract: version failures
  // produce typed capture failures and never a detached input.
  const r = captureV2Input(validV2Input({ pointOfUseInputsProtocolVersion: '1' }));
  assert.equal(r.ok, false);
  if (r.ok) assert.fail('unexpected success');
});

// ---------------------------------------------------------------------------
// nested exact-own capture
// ---------------------------------------------------------------------------

test('C: valid requested use with optional capabilityVersion absent and present', () => {
  const r1 = captureV2Input(validV2Input());
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  assert.equal('capabilityVersion' in r1.input.requestedUse, false);
  const r2 = captureV2Input(validV2Input({
    requestedUse: {
      capability: 'x', capabilityVersion: 'v1', operationClass: 'read', resourceClass: 'a', scope: 's', workspaceId: 'ws-a',
    },
  }));
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  assert.equal(r2.input.requestedUse.capabilityVersion, 'v1');
});

test('C: unknown nested requested-use field rejected', () => {
  const input = validV2Input({
    requestedUse: {
      capability: 'x', operationClass: 'read', resourceClass: 'a', scope: 's', workspaceId: 'ws-a', extra: 1,
    },
  });
  const r = captureV2Input(input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'nested-capture');
});

test('C: unknown top-level v2 field rejected (no caller numeric fields, no caller ceilings)', () => {
  for (const extra of [
    { globalActionCeiling: 5 },
    { workspaceActionCeiling: 5 },
    { globalCapabilityCeiling: { capabilities: ['x'] } },
    { staticInputCorrelationIdentity: 'sha-256:' + '0'.repeat(64) },
    { configurationIdentity: 'sha-256:' + '0'.repeat(64) },
    { configuration: { configurationVersion: '2' } },
  ]) {
    const r = captureV2Input(validV2Input(extra));
    assert.equal(r.ok, false, JSON.stringify(extra));
    if (!r.ok) assert.equal(r.code, 'nested-capture', JSON.stringify(extra));
  }
});

test('C: workspace mutation after capture has no effect', () => {
  const input = validV2Input();
  const r = captureV2Input(input);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  input['workspaceId'] = 'mutated';
  (input['requestedUse'] as Record<string, unknown>)['workspaceId'] = 'mutated';
  assert.equal(r.input.workspaceId, 'ws-a');
  assert.equal(r.input.requestedUse.workspaceId, 'ws-a');
});

test('C: input/requested-use workspace mismatch is detectable on detached values', () => {
  const input = validV2Input({
    requestedUse: {
      capability: 'x', operationClass: 'read', resourceClass: 'a', scope: 's', workspaceId: 'ws-b',
    },
  });
  const r = captureV2Input(input);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(detachedWorkspacesEqual(r.input.workspaceId, r.input.requestedUse.workspaceId), false);
  assert.equal(detachedWorkspacesEqual('ws-a', 'ws-a'), true);
});

test('C: non-string input workspace is workspace-capture', () => {
  const r = captureV2Input(validV2Input({ workspaceId: 42 }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'workspace-capture');
});

test('C: non-string requested-use workspace is workspace-capture', () => {
  const input = validV2Input({
    requestedUse: { capability: 'x', operationClass: 'read', resourceClass: 'a', scope: 's', workspaceId: 7 },
  });
  const r = captureV2Input(input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'workspace-capture');
});

test('C: consumer duplicates fail closed', () => {
  const input = validV2Input({
    consumerSupport: {
      consumerId: 'c1',
      supportedProtocolFeatures: ['a', 'a'],
      supportedConsumerCapabilities: [],
      supportedExtensionNamespaces: [],
    },
  });
  const r = captureV2Input(input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'nested-capture');
});

test('C: consumer canonical sorting', () => {
  const input = validV2Input({
    consumerSupport: {
      consumerId: 'c1',
      supportedProtocolFeatures: ['z', 'a', 'm'],
      supportedConsumerCapabilities: ['cap-b', 'cap-a'],
      supportedExtensionNamespaces: ['ns-z', 'ns-a'],
    },
  });
  const r = captureV2Input(input);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual([...r.input.consumerSupport.supportedProtocolFeatures], ['a', 'm', 'z']);
  assert.deepEqual([...r.input.consumerSupport.supportedConsumerCapabilities], ['cap-a', 'cap-b']);
  assert.deepEqual([...r.input.consumerSupport.supportedExtensionNamespaces], ['ns-a', 'ns-z']);
});

test('C: proxy-wrapped v2 input captures with zero Proxy get', () => {
  const { proxy, getCalls } = countingGetProxy(validV2Input());
  const r = captureV2Input(proxy);
  assert.equal(r.ok, true);
  assert.equal(getCalls(), 0);
});

test('C: descriptor trap fails closed as nested-capture', () => {
  const hostile = new Proxy(validV2Input(), {
    getOwnPropertyDescriptor() {
      throw new Error('gopd');
    },
  });
  const r = captureV2Input(hostile);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'nested-capture');
});

test('C: revoked proxy fails closed', () => {
  const revoked = Proxy.revocable(validV2Input(), {});
  revoked.revoke();
  const r = captureV2Input(revoked.proxy);
  assert.equal(r.ok, false);
});

test('C: symbol field rejected', () => {
  const input = validV2Input();
  (input as Record<symbol, unknown>)[Symbol('x')] = 1;
  const r = captureV2Input(input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'nested-capture');
});

test('C: forged registry snapshot fails as operand-brand', () => {
  const input = validV2Input();
  (input['registry'] as Record<string, unknown>)['snapshot'] = { snapshotId: 'forged', digest: 'x', canonicalUtf8: '{}', level: 'structural-valid', model: {} };
  const r = captureV2Input(input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'operand-brand');
});

test('C: forged lifecycle record fails as operand-brand', () => {
  const input = validV2Input();
  (input['lifecycle'] as Record<string, unknown>)['records'] = [{ recordType: 'ValidationRecord', recordId: 'forged', level: 'structural-valid', model: {} }];
  const r = captureV2Input(input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'operand-brand');
});

test('C: valid grant captured as present; absent grant as absent', () => {
  const withGrant = captureV2Input(validV2Input({ grant: { record_id: 'grant-1', bundle: { instance_id: 'b-1' } } }));
  assert.equal(withGrant.ok, true);
  if (!withGrant.ok) return;
  assert.equal(withGrant.input.grant.state, 'present');
  const withoutGrant = captureV2Input(validV2Input());
  assert.equal(withoutGrant.ok, true);
  if (!withoutGrant.ok) return;
  assert.equal(withoutGrant.input.grant.state, 'absent');
});

test('C: malformed but JSON-representable grant constraint captures successfully', () => {
  const input = validV2Input({
    grant: { record_id: 'grant-1', narrowed_constraints: [{ type: 'max-actions', value: 'not-a-number' }] },
  });
  const r = captureV2Input(input);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.input.grant.state, 'present');
});

test('C: bundle with function member fails as model-capture', () => {
  const input = validV2Input();
  (input['bundle'] as Record<string, unknown>)['fn'] = () => 1;
  const r = captureV2Input(input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'model-capture');
});

// ---------------------------------------------------------------------------
// detached v1 capture
// ---------------------------------------------------------------------------

test('C: valid v1 input captures detached with v1 semantics', () => {
  const r = captureV1Input(validV1Input({ globalActionCeiling: 3, workspaceActionCeiling: 2 }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.input.globalActionCeiling, 3);
  assert.equal(r.input.workspaceActionCeiling, 2);
  assert.equal('pointOfUseInputsProtocolVersion' in r.input, false);
});

test('C: v1 unknown field rejected by the detached helper', () => {
  const r = captureV1Input(validV1Input({ pointOfUseInputsProtocolVersion: '2' }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'nested-capture');
});

test('C: v1 consumer order and duplicates preserved (v1 semantics)', () => {
  const r = captureV1Input(validV1Input({
    consumerSupport: {
      consumerId: 'c1',
      supportedProtocolFeatures: ['z', 'a', 'z'],
      supportedConsumerCapabilities: [],
      supportedExtensionNamespaces: [],
    },
  }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual([...r.input.consumerSupport.supportedProtocolFeatures], ['z', 'a', 'z']);
});

test('C: v1 non-number numeric ceiling rejected', () => {
  const r = captureV1Input(validV1Input({ globalActionCeiling: 'three' }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'nested-capture');
});

test('C: v1 forged record brand fails', () => {
  const input = validV1Input();
  (input['lifecycle'] as Record<string, unknown>)['records'] = [{ recordType: 'ValidationRecord', recordId: 'x', level: 'structural-valid', model: {} }];
  const r = captureV1Input(input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'operand-brand');
});
