/**
 * WP-6 Phase 3A: receiver-bound callable-view adapter tests (contract Section
 * 7). Methods are extracted exactly once through own-or-prototype data
 * descriptors; wrappers invoke through `Reflect.apply` with the original
 * receiver; method replacement after capture has no effect; receiver live
 * state may affect outcomes; extraction performs zero Proxy `get`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createIdentityViewAdapter,
  createResolverViewAdapter,
  createRevocationsViewAdapter,
  extractCallable,
} from '../../src/pointofuse/index.js';
import {
  PrivateIdentityView,
  ThisResolverView,
  ThisRevocationsView,
  countingGetProxy,
  plainIdentityView,
  MutatingIdentityView,
  LiveCounterResolver,
} from './helpers.js';

test('D: own arrow-function members adapt and invoke', () => {
  const r = createIdentityViewAdapter(plainIdentityView());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.adapter.findInstance('x'), undefined);
  assert.equal(r.adapter.verifyRegistration('a', 'b', 'c'), false);
});

test('D: own ordinary function using `this` keeps the receiver', () => {
  const view = {
    prefix: 'own:',
    resolve(ref: unknown) {
      return this.prefix + String(ref);
    },
  };
  const r = createResolverViewAdapter(view);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.adapter.resolve('task-1'), 'own:task-1');
});

test('D: prototype method using instance fields keeps the receiver', () => {
  const view = new ThisResolverView();
  const r = createResolverViewAdapter(view);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.adapter.resolve('task-1'), 'resolved:task-1');
});

test('D: prototype method using genuine private fields keeps the receiver', () => {
  const view = new PrivateIdentityView({ 'inst-1': 'rev-1' });
  const r = createIdentityViewAdapter(view);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.adapter.findInstance('inst-1'), 'rev-1');
  assert.equal(r.adapter.findInstance('missing'), undefined);
  assert.equal(r.adapter.verifyRegistration('a', 'b', 'c'), true);
});

test('D: method replacement after capture has no effect', () => {
  const view = new ThisResolverView();
  const r = createResolverViewAdapter(view);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  (view as unknown as Record<string, unknown>)['resolve'] = () => 'replaced';
  assert.equal(r.adapter.resolve('x'), 'resolved:x');
});

test('D: same-receiver post-capture live state — legitimate mutator observed through the already-captured adapter', () => {
  // M-1 correction: one receiver, one adapter, legitimate mutation through the
  // SAME instance, observations through the SAME adapter only. Fails if the
  // method is called without the original receiver (private-field access
  // throws), if the receiver is cloned, or if state were captured by value.
  const view = new MutatingIdentityView('initial');   // 1. one receiver instance
  const r = createIdentityViewAdapter(view);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const adapter = r.adapter;                          // 2. one adapter from that receiver
  assert.equal(adapter.findInstance('ignored'), 'initial'); // 3. first call observes initial state
  view.setLabel('changed');                           // 4. same receiver legitimately mutated
  assert.equal(adapter.findInstance('ignored'), 'changed'); // 5. same adapter observes changed state
  // 6. the adapter is not recreated; 7. the receiver is not replaced (this test
  //    creates exactly one instance and one adapter and never rebuilds either);
  // 8. detached-value capture or wrong `this` would fail (private field access);
  // 9. private-field receiver behavior is retained;
  // 10. extraction occurs exactly once (the adapter wraps one extracted method
  //     reference; the counter test below proves per-invocation live state).
});

test('D: adapted method mutates instance state per invocation through the same adapter', () => {
  // M-1 correction (design B): each invocation mutates a private field on the
  // live original receiver, proving `Reflect.apply` uses the retained receiver.
  // The test fails if the method is invoked without the original receiver
  // (private-field access throws) or if state were captured by value.
  const view = new LiveCounterResolver();
  const r = createResolverViewAdapter(view);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.adapter.resolve('a'), 'a:1');
  assert.equal(r.adapter.resolve('b'), 'b:2');
  assert.equal(r.adapter.resolve('c'), 'c:3');
});

test('D: revocations view adapts with receiver state', () => {
  const r = createRevocationsViewAdapter(new ThisRevocationsView());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.adapter.revocationsByTarget('rev-1'), [{ recordId: 'rev-1', effectiveAt: '2026-01-01T00:00:00Z', scope: 'rev' }]);
  assert.deepEqual(r.adapter.revocationsByTarget('other'), []);
});

test('D: accessor method rejected without invocation', () => {
  let invoked = 0;
  const view: Record<string, unknown> = {};
  Object.defineProperty(view, 'findInstance', {
    enumerable: true,
    get() {
      invoked++;
      return () => undefined;
    },
  });
  const r = createIdentityViewAdapter(view);
  assert.equal(r.ok, false);
  assert.equal(invoked, 0);
  if (!r.ok) assert.equal(r.code, 'accessor');
});

test('D: prototype accessor rejected without invocation', () => {
  let invoked = 0;
  const proto: Record<string, unknown> = {};
  Object.defineProperty(proto, 'resolve', {
    enumerable: true,
    get() {
      invoked++;
      return () => undefined;
    },
  });
  const view = Object.create(proto);
  const r = createResolverViewAdapter(view);
  assert.equal(r.ok, false);
  assert.equal(invoked, 0);
  if (!r.ok) assert.equal(r.code, 'accessor');
});

test('D: missing member rejected as not-found', () => {
  const r = createIdentityViewAdapter({ findInstance: () => undefined });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'not-found');
});

test('D: data descriptor holding a non-function for a callable name rejected', () => {
  const r = createResolverViewAdapter({ resolve: 'not-a-function' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'not-found');
});

test('D: Proxy get remains zero during extraction', () => {
  const { proxy, getCalls } = countingGetProxy(new ThisResolverView());
  const r = createResolverViewAdapter(proxy);
  assert.equal(r.ok, true);
  assert.equal(getCalls(), 0);
});

test('D: descriptor trap fails closed', () => {
  const hostile = new Proxy(new ThisResolverView(), {
    getOwnPropertyDescriptor() {
      throw new Error('gopd');
    },
  });
  const r = createResolverViewAdapter(hostile);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'traps');
});

test('D: revoked Proxy fails closed', () => {
  const revoked = Proxy.revocable(new ThisResolverView(), {});
  revoked.revoke();
  const r = createResolverViewAdapter(revoked.proxy);
  assert.equal(r.ok, false);
});

test('D: extractCallable walks own descriptor first, prototype after', () => {
  const view = new ThisResolverView();
  (view as unknown as Record<string, unknown>)['resolve'] = () => 'own-wins';
  const extracted = extractCallable(view, 'resolve');
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  assert.equal(Reflect.apply(extracted.callable.method, extracted.callable.receiver, ['x']), 'own-wins');
});

test('D: extracted function invoked exactly once per adapter call', () => {
  let calls = 0;
  const view = {
    resolve() {
      calls++;
      return calls;
    },
  };
  const r = createResolverViewAdapter(view);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.adapter.resolve('a'), 1);
  assert.equal(r.adapter.resolve('b'), 2);
  assert.equal(calls, 2);
});

test('D: Object.prototype members are never accepted', () => {
  const r = extractCallable({}, 'toString');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'not-found');
});
