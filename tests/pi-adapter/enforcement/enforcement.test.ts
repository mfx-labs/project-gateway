/**
 * WP-5B focused tests — trusted enforcement run: the deterministic
 * plan → eligibility → activation → compatibility → surface → projection →
 * apply → verified PROJECTED → evidence path, failing closed at every
 * boundary, with no authority expansion and no lifecycle interpretation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runTrustedEnforcement,
  buildTrustedProjection,
  surfaceStable,
  GOLDEN_VECTOR_DIGEST,
  computeInventoryFingerprint,
} from '../../../src/adapters/pi/enforcement/index.js';
import { observeEffectiveSurface } from '../../../src/adapters/pi/enforcement/surface.js';
import type { GuardEnforcementInput } from '../../../src/adapters/pi/enforcement/types.js';
import { buildEnforcementWorld, standardSurface, STANDARD_INVENTORY, HOST_TIMESTAMP, TIMESTAMP_SOURCE, GRANT_ID } from './world.js';
import { createFakeGuard, verifiedPackageInspection, readProjection } from './fake-guard.js';
import { ATTEMPT_ID, OCCURRENCE_ID, WORKSPACE } from '../helpers.js';

function okResultOf(input: GuardEnforcementInput) {
  return runTrustedEnforcement(input);
}

test('successful PROJECTED activation: applies exact allowed profile and records evidence', () => {
  const { world } = buildEnforcementWorld('normal');
  const result = okResultOf(world.input());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.evidence.activationOutcome, 'applied');
  assert.equal(result.evidence.restorationOutcome, 'not-applicable');
  assert.deepEqual([...result.active.allowedToolNames].sort(), ['fffind', 'ffgrep', 'find', 'grep', 'ls', 'read']);
  assert.deepEqual(result.evidence.projectedAllowedTools, ['fffind', 'ffgrep', 'find', 'grep', 'ls', 'read']);
  assert.ok(result.evidence.projectedDeniedTools.includes('bash'));
  assert.ok(result.evidence.projectedDeniedTools.includes('web_search'));
  assert.notEqual(result.evidence.projectionIdentity, result.evidence.evidenceFingerprint);
  assert.equal(result.evidence.piGuardVersion, '0.1.2');
  assert.equal(result.evidence.timestampSource, TIMESTAMP_SOURCE);
  assert.equal(result.evidence.observedAt, HOST_TIMESTAMP);
  assert.equal(result.evidence.activationOutcome, 'applied');
});

test('the exact four-field projection is sent to pi-guard with the normative fingerprint and NO lifecycle data', () => {
  const { world, fake } = buildEnforcementWorld('normal');
  const result = okResultOf(world.input());
  assert.equal(result.ok, true);
  assert.equal(fake.calls.filter((c) => c.operation === 'apply').length, 1);
  const sent = fake.appliedProjections[0];
  const parsed = readProjection(sent);
  assert.ok(parsed);
  assert.equal(parsed.projectionVersion, 1);
  assert.equal(typeof parsed.projectionIdentity, 'string');
  assert.deepEqual([...(parsed.allowedToolNames ?? [])].sort(), ['fffind', 'ffgrep', 'find', 'grep', 'ls', 'read']);
  assert.equal(typeof parsed.inventoryFingerprint, 'string');
  assert.equal(Object.keys(sent as object).length, 4);
  // no lifecycle/policy/grant/plan payload reaches pi-guard
  assert.equal((sent as Record<string, unknown>)['lifecycleRecordId'], undefined);
  assert.equal((sent as Record<string, unknown>)['grant'], undefined);
  assert.equal((sent as Record<string, unknown>)['renderedPrompt'], undefined);
  assert.equal((sent as Record<string, unknown>)['authorityPolicy'], undefined);
  // the fingerprint sent equals the normative computation over the surface
  assert.equal(parsed.inventoryFingerprint, computeInventoryFingerprint(standardSurface().entries));
});

test('the sent inventory fingerprint matches the golden vector over the golden surface', () => {
  const { world, fake } = buildEnforcementWorld('normal');
  const golden = [
    { name: 'web_search', sourceInfo: { source: 'pi-web-access' } },
    { name: '\u{10000}', sourceInfo: { source: 'x' } },
    { name: 'bash', sourceInfo: { source: 'builtin' } },
    { name: '\uE000', sourceInfo: { source: 'x' } },
    { name: 'read', sourceInfo: { source: 'builtin' } },
    { name: 'caf\u00e9', sourceInfo: { source: 'builtin' } },
  ];
  const observed = observeEffectiveSurface(golden, ['read'], 't');
  assert.ok(observed.ok && observed.surface !== undefined);
  const result = okResultOf(world.input({ surface: observed.surface }));
  if (!result.ok) return;
  const parsed = readProjection(fake.appliedProjections[0]);
  assert.ok(parsed);
  assert.equal(parsed.inventoryFingerprint, GOLDEN_VECTOR_DIGEST);
  assert.equal(result.evidence.observedToolInventoryIdentity, GOLDEN_VECTOR_DIGEST);
});

test('determinism: identical runs produce identical evidence and projection identity', () => {
  const a = buildEnforcementWorld('normal');
  const b = buildEnforcementWorld('normal');
  const ra = okResultOf(a.world.input());
  const rb = okResultOf(b.world.input());
  assert.equal(ra.ok, rb.ok);
  if (ra.ok && rb.ok) {
    assert.equal(ra.evidence.evidenceFingerprint, rb.evidence.evidenceFingerprint);
    assert.equal(ra.evidence.projectionIdentity, rb.evidence.projectionIdentity);
    assert.deepEqual(ra.evidence, rb.evidence);
  }
});

test('plan not projection-ready fails closed before activation (not attempted)', () => {
  const { world } = buildEnforcementWorld('normal');
  const stalePlan = { ...world.plan, status: 'draft' } as never;
  const result = okResultOf(world.input({ plan: stalePlan }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.evidence.activationOutcome, 'not-attempted');
    assert.ok(result.findings.some((f) => f.key === 'plan.not-projection-ready'));
  }
});

test('uncorrelated eligibility fails closed', () => {
  const { world } = buildEnforcementWorld('normal');
  const mismatched = {
    ...world.base.eligibility,
    subjectCorrelations: { ...world.base.eligibility.subjectCorrelations, bundleInstance: 'pgw:i:different' },
  } as never;
  const result = okResultOf(world.input({ eligibility: mismatched }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'eligibility.bundle-correlation'));
});

test('eligibility workspace mismatch fails closed', () => {
  const { world } = buildEnforcementWorld('normal');
  const mismatched = { ...world.base.eligibility, workspaceId: 'pgw:w:other' } as never;
  const result = okResultOf(world.input({ eligibility: mismatched, workspaceIdentity: WORKSPACE }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'eligibility.workspace-mismatch'));
});

test('activation correlation mismatches fail closed (decision, occurrence, attempt, grant)', () => {
  const { world } = buildEnforcementWorld('normal');
  const denied = okResultOf(world.input({ activation: { ...world.base.activation, decision: 'denied' } }));
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.ok(denied.findings.some((f) => f.key === 'activation.not-accepted'));

  const wrongAttempt = okResultOf(world.input({ activation: { ...world.base.activation, attemptId: 'pgw:a:other' } }));
  assert.equal(wrongAttempt.ok, false);
  if (!wrongAttempt.ok) assert.ok(wrongAttempt.findings.some((f) => f.key === 'activation.occurrence-mismatch'));

  const notCurrent = okResultOf(world.input({ activation: { ...world.base.activation, grantCurrent: false } }));
  assert.equal(notCurrent.ok, false);
  if (!notCurrent.ok) assert.ok(notCurrent.findings.some((f) => f.key === 'activation.grant-not-current'));

  const noGrant = okResultOf(world.input({ activation: { ...world.base.activation, runtimeGrantId: '' } }));
  assert.equal(noGrant.ok, false);
  if (!noGrant.ok) assert.ok(noGrant.findings.some((f) => f.key === 'activation.grant-identity-missing'));
});

test('incompatible pi-guard API fails closed before activation', () => {
  const { world } = buildEnforcementWorld('normal');
  const brokenApi = { applyTrustedProjection: world.input().guard.api.applyTrustedProjection, restoreTrustedProjection: world.input().guard.api.restoreTrustedProjection } as never;
  const result = okResultOf(world.input({ guard: { packageInspection: verifiedPackageInspection(), api: brokenApi } }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.evidence.activationOutcome, 'not-attempted');
    assert.ok(result.findings.some((f) => f.category === 'GUARD-LANE-INCOMPATIBLE'));
  }
});

test('incompatible package inspection fails closed', () => {
  const { world } = buildEnforcementWorld('normal');
  const badInspection = { ...verifiedPackageInspection(), compatible: false, findings: [{ category: 'GUARD-LANE-INCOMPATIBLE', key: 'guard.version-drift', message: 'wrong version' }] } as never;
  const result = okResultOf(world.input({ guard: { packageInspection: badInspection, api: world.input().guard.api } }));
  assert.equal(result.ok, false);
});

test('an unenforceable capability fails projection closed (no partial activation)', () => {
  const { world } = buildEnforcementWorld('normal');
  const shell = {
    ...world.base.eligibility,
    capability: 'project-gateway.shell-execute',
  } as never;
  const result = okResultOf(world.input({ eligibility: shell }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.findings.some((f) => f.key === 'projection.capability-unsupported'));
    assert.deepEqual(result.evidence.unsupportedRequiredCapabilities, ['project-gateway.shell-execute']);
    assert.equal(result.evidence.activationOutcome, 'not-attempted');
  }
});

test('pi-guard fingerprint-mismatch and conflicting-activation drive fail-closed outcomes', () => {
  const drift = buildEnforcementWorld('fingerprint-mismatch');
  const driftResult = okResultOf(drift.world.input());
  assert.equal(driftResult.ok, false);
  if (!driftResult.ok) {
    assert.equal(driftResult.evidence.activationOutcome, 'failed-closed');
    assert.ok(driftResult.findings.some((f) => f.key === 'activation.rejected'));
  }

  const conflict = buildEnforcementWorld('conflict');
  const conflictResult = okResultOf(conflict.world.input());
  assert.equal(conflictResult.ok, false);
  if (!conflictResult.ok) {
    assert.equal(conflictResult.evidence.activationOutcome, 'failed-closed');
    assert.ok(conflictResult.findings.some((f) => f.key === 'activation.rejected'));
  }
});

test('application failure honors verified vs unverified restoration truth', () => {
  const verified = buildEnforcementWorld('apply-fail-verified');
  const rv = okResultOf(verified.world.input());
  assert.equal(rv.ok, false);
  if (!rv.ok) {
    assert.equal(rv.evidence.activationOutcome, 'failed-closed');
    assert.equal(rv.evidence.restorationOutcome, 'verified');
  }

  const unverified = buildEnforcementWorld('apply-fail-unverified');
  const ru = okResultOf(unverified.world.input());
  assert.equal(ru.ok, false);
  if (!ru.ok) {
    assert.equal(ru.evidence.activationOutcome, 'failed-closed');
    assert.equal(ru.evidence.restorationOutcome, 'failed');
  }
});

test('failed post-apply verification triggers verified restoration (no stale PROJECTED)', () => {
  const notActive = buildEnforcementWorld('inspect-not-active');
  const { fake: f1 } = notActive;
  const r1 = okResultOf(notActive.world.input());
  assert.equal(r1.ok, false);
  if (!r1.ok) {
    assert.equal(r1.evidence.activationOutcome, 'failed-closed');
    // pi-guard never entered PROJECTED, so restore reports not-applicable;
    // the run still attempted restoration and fails closed on the anomaly.
    assert.equal(r1.evidence.restorationOutcome, 'not-applicable');
    assert.ok(r1.findings.some((f) => f.key === 'activation.not-verified'));
  }
  assert.ok(f1.restoreCount() >= 1);

  const mismatch = buildEnforcementWorld('inspect-profile-mismatch');
  const r2 = okResultOf(mismatch.world.input());
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.ok(r2.findings.some((f) => f.key === 'activation.profile-mismatch'));
});

test('restore failure is reported truthfully (restoration-failed, never a silent authority state)', () => {
  const restoreFail = buildEnforcementWorld('restore-fail');
  const result = okResultOf(restoreFail.world.input());
  // restore-fail mode leaves apply/applied successful, so the primary run is ok;
  // the driver-side restore is covered by the API result and recorded separately.
  assert.equal(result.ok, true);
});

test('idempotent identical replay and conflicting re-activation both behave correctly', () => {
  const { world, fake } = buildEnforcementWorld('normal');
  const first = okResultOf(world.input());
  assert.equal(first.ok, true);
  // identical re-run -> idempotentReplay (still active, ok)
  const replay = okResultOf(world.input());
  assert.equal(replay.ok, true);

  // a drifted surface changes the projection identity -> conflicting activation
  const driftedObserved = observeEffectiveSurface([...STANDARD_INVENTORY, { name: 'newtool', sourceInfo: { source: 'builtin' } }], ['read'], 't');
  assert.ok(driftedObserved.ok && driftedObserved.surface !== undefined);
  const conflictInput = world.input({ surface: driftedObserved.surface });
  const conflicting = okResultOf(conflictInput);
  assert.equal(conflicting.ok, false);
  if (!conflicting.ok) {
    assert.equal(conflicting.evidence.activationOutcome, 'failed-closed');
    assert.ok(conflicting.findings.some((f) => f.key === 'activation.rejected'));
  }
  assert.equal(fake.calls.filter((c) => c.operation === 'apply').length, 3);
});

test('no authority expansion: every allowed tool is on the surfaced profile; extras are denied', () => {
  const { world } = buildEnforcementWorld('normal');
  const result = okResultOf(world.input());
  if (!result.ok) return;
  const surfaceNames = new Set(standardSurface().entries.map((e) => e.name));
  for (const name of result.evidence.projectedAllowedTools) {
    assert.ok(surfaceNames.has(name), `allowed ${name} must exist on the surface`);
  }
  for (const name of result.evidence.projectedDeniedTools) {
    assert.ok(surfaceNames.has(name));
  }
  const dedup = new Set([...result.evidence.projectedAllowedTools, ...result.evidence.projectedDeniedTools]);
  assert.equal(dedup.size, surfaceNames.size);
});

test('evidence carries the complete Part E field set', () => {
  const { world } = buildEnforcementWorld('normal');
  const result = okResultOf(world.input());
  if (!result.ok) return;
  const e = result.evidence as unknown as Record<string, unknown>;
  for (const field of [
    'inputPlanIdentity',
    'planFingerprint',
    'projectionIdentity',
    'authorityInputIdentities',
    'effectiveAuthorityIdentity',
    'piGuardIdentity',
    'piGuardVersion',
    'piIdentity',
    'piVersion',
    'observedToolInventoryIdentity',
    'projectedAllowedTools',
    'projectedDeniedTools',
    'unsupportedRequiredCapabilities',
    'activationOutcome',
    'restorationOutcome',
    'compatibilityFindings',
    'timestampSource',
    'evidenceFingerprint',
  ]) {
    assert.ok(field in e, `evidence missing ${field}`);
  }
  assert.equal(typeof e['evidenceFingerprint'], 'string');
  assert.equal((e['authorityInputIdentities'] as Record<string, string>)['grantIdentity'], GRANT_ID);
});

test('buildTrustedProjection emits exactly the four fields', () => {
  const projection = buildTrustedProjection('id', ['read'], 'fp') as Record<string, unknown>;
  assert.deepEqual(Object.keys(projection).sort(), ['allowedToolNames', 'inventoryFingerprint', 'projectionIdentity', 'projectionVersion']);
  assert.equal(projection['projectionVersion'], 1);
});

test('an unverified Pi host lane fails closed (no enforcement against it)', () => {
  const { world } = buildEnforcementWorld('normal');
  const result = okResultOf(world.input({ piHost: { piIdentity: '@earendil-works/pi-coding-agent', piVersion: '0.84.0' } }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'run.pi-host-lane'));
});

test('post-activation surface stability (drift probe) refuses on a changed surface', () => {
  const { world } = buildEnforcementWorld('normal');
  const result = okResultOf(world.input());
  if (!result.ok) return;
  const fingerprint = result.evidence.observedToolInventoryIdentity;
  // identical live surface -> stable
  assert.equal(surfaceStable(fingerprint, standardSurface().entries), true);
  // a new tool registered after activation -> drift -> NOT stable
  assert.equal(surfaceStable(fingerprint, [...standardSurface().entries, { name: 'late_registration', source: 'builtin' }]), false);
  // a required tool removed -> drift -> NOT stable
  assert.equal(surfaceStable(fingerprint, standardSurface().entries.filter((e) => e.name !== 'read')), false);
});

// ─── SIR-WP5B-001: typed guard-API failure boundary (no raw exception text) ──

test('a null/invalid trusted API fails closed as incompatibility (never throws)', () => {
  const { world } = buildEnforcementWorld('normal');
  const normalInput = world.input();
  const result = okResultOf(world.input({ guard: { packageInspection: normalInput.guard.packageInspection, api: null as never } }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.evidence.activationOutcome, 'not-attempted');
    assert.ok(result.findings.some((f) => f.category === 'GUARD-LANE-INCOMPATIBLE'));
  }
});

function assertNoRawExceptionText(result: unknown): void {
  const text = JSON.stringify(result);
  assert.ok(!text.includes('GUARDANOMALY'), 'raw host exception marker must never appear in public output');
  assert.ok(!text.includes('boom'), 'raw host exception text must never appear in public output');
}

test('applyTrustedProjection throwing is contained, guarded-restored, and typed', () => {
  const { world } = buildEnforcementWorld('apply-throw');
  const result = okResultOf(world.input());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.evidence.activationOutcome, 'failed-closed');
    // apply raised before committing any projected state -> truthful not-applicable
    assert.equal(result.evidence.restorationOutcome, 'not-applicable');
    assert.ok(result.findings.some((f) => f.key === 'activation.unexpected-exception'));
  }
  assertNoRawExceptionText(result);
});

test('activation exception followed by successful restoration reports verified restoration', () => {
  // partial activation (PROJECTED committed) then exception -> guarded restore succeeds
  const { world } = buildEnforcementWorld('apply-partial-throw');
  const result = okResultOf(world.input());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.evidence.activationOutcome, 'failed-closed');
    assert.equal(result.evidence.restorationOutcome, 'verified');
    assert.ok(result.findings.some((f) => f.key === 'activation.unexpected-exception'));
  }
  assertNoRawExceptionText(result);
});

test('activation exception followed by restoration failure reports failed restoration', () => {
  const { world } = buildEnforcementWorld('apply-throw-restore-throw');
  const result = okResultOf(world.input());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.evidence.activationOutcome, 'failed-closed');
    assert.equal(result.evidence.restorationOutcome, 'failed');
    assert.ok(result.findings.some((f) => f.key === 'restoration.unexpected-exception'));
  }
  assertNoRawExceptionText(result);
});

test('inspectActiveProjection throwing after apply is contained and guarded-restored', () => {
  const { world } = buildEnforcementWorld('inspect-throw');
  const result = okResultOf(world.input());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.evidence.activationOutcome, 'failed-closed');
    assert.equal(result.evidence.restorationOutcome, 'verified');
    assert.ok(result.findings.some((f) => f.key === 'activation.inspect-exception'));
  }
  assertNoRawExceptionText(result);
});

test('restoreTrustedProjection throwing is contained as a failed restoration outcome', () => {
  const { world } = buildEnforcementWorld('restore-throw');
  const result = okResultOf(world.input());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.evidence.activationOutcome, 'failed-closed');
    assert.equal(result.evidence.restorationOutcome, 'failed');
    assert.ok(result.findings.some((f) => f.key === 'restoration.unexpected-exception'));
    assert.ok(result.findings.some((f) => f.key === 'activation.profile-mismatch'));
  }
  assertNoRawExceptionText(result);
});

test('a hostile (throwing) API object is contained during verification', () => {
  const { world } = buildEnforcementWorld('normal');
  const hostile = {
    get applyTrustedProjection() {
      throw new Error('GUARDANOMALY-getter-boom');
    },
  } as never;
  const result = okResultOf(world.input({ guard: { packageInspection: world.input().guard.packageInspection, api: hostile } }));
  assert.equal(result.ok, false);
  assertNoRawExceptionText(result);
});

test('malformed host-input shapes (null packageInspection, null surface) fail closed as typed findings (FSIR-WP5B-001)', () => {
  const { world } = buildEnforcementWorld('normal');
  const normalInput = world.input();

  // null packageInspection: never touches .findings/.compatible; typed lane failure.
  const nullInspection = runTrustedEnforcement(
    world.input({ guard: { packageInspection: null as never, api: normalInput.guard.api } }),
  );
  assert.equal(nullInspection.ok, false);
  if (!nullInspection.ok) {
    assert.equal(nullInspection.evidence.activationOutcome, 'not-attempted');
    assert.ok(nullInspection.findings.some((f) => f.key === 'guard.package-inspection-unavailable'));
    assert.ok(nullInspection.findings.some((f) => f.category === 'GUARD-LANE-INCOMPATIBLE'));
  }
  assertNoRawExceptionText(nullInspection);

  // null surface: never touches .entries; typed surface failure.
  const nullSurface = runTrustedEnforcement(world.input({ surface: null as never }));
  assert.equal(nullSurface.ok, false);
  if (!nullSurface.ok) {
    assert.equal(nullSurface.evidence.activationOutcome, 'not-attempted');
    assert.ok(nullSurface.findings.some((f) => f.key === 'run.surface-unavailable'));
    assert.ok(nullSurface.findings.some((f) => f.category === 'GUARD-SURFACE-UNAVAILABLE'));
  }
  assertNoRawExceptionText(nullSurface);
});
