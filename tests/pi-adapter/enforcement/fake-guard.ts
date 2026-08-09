/**
 * Hermetic fake of the verified pi-guard v0.1.2 trusted projection API.
 *
 * Reproduces the released v0.1.2 semantics deterministically for tests:
 * four-field validation, PROJECTED single-active state, idempotent identical
 * replay, conflict/application-failure results, inspect/restore outcomes.
 * Records every call so tests can assert the sender-side four-field shape and
 * that no lifecycle/policy data enters pi-guard.
 */
import type {
  TrustedProjectionApi,
  TrustedProjectionApplyResult,
  TrustedProjectionInspection,
  TrustedProjectionRestoreResult,
} from '../../../src/adapters/pi/enforcement/types.js';

export interface FakeGuardCall {
  readonly operation: 'apply' | 'inspect' | 'restore';
  readonly projection?: unknown;
}

export type FakeGuardMode =
  | 'normal'
  | 'invalid'
  | 'fingerprint-mismatch'
  | 'conflict'
  | 'apply-fail-verified'
  | 'apply-fail-unverified'
  | 'inspect-not-active'
  | 'inspect-profile-mismatch'
  | 'restore-fail'
  | 'unknown-outcome'
  | 'apply-throw'
  | 'apply-partial-throw'
  | 'inspect-throw'
  | 'restore-throw'
  | 'apply-throw-restore-throw';

export interface FakeGuard {
  readonly api: TrustedProjectionApi;
  readonly calls: FakeGuardCall[];
  readonly appliedProjections: unknown[];
  restoreCount(): number;
}

/** Extract the four fields from a trusted projection object (opaque input). */
export function readProjection(projection: unknown): {
  readonly projectionVersion?: unknown;
  readonly projectionIdentity?: unknown;
  readonly allowedToolNames?: readonly unknown[];
  readonly inventoryFingerprint?: unknown;
} | null {
  if (typeof projection !== 'object' || projection === null || Array.isArray(projection)) return null;
  const p = projection as Record<string, unknown>;
  return {
    projectionVersion: p['projectionVersion'],
    projectionIdentity: p['projectionIdentity'],
    allowedToolNames: Array.isArray(p['allowedToolNames']) ? (p['allowedToolNames'] as readonly unknown[]) : undefined,
    inventoryFingerprint: p['inventoryFingerprint'],
  };
}

const INVALID: TrustedProjectionApplyResult = { kind: 'invalid', code: 'PSG_PROJECTION_INVALID_SHAPE', reason: 'four-field shape violated' };

export function createFakeGuard(mode: FakeGuardMode = 'normal'): FakeGuard {
  const calls: FakeGuardCall[] = [];
  const appliedProjections: unknown[] = [];
  let active:
    | { readonly projectionIdentity: string; readonly inventoryFingerprint: string; readonly permittedProfile: readonly string[] }
    | undefined;
  let restores = 0;

  const applyTrustedProjection = (projection: unknown): TrustedProjectionApplyResult => {
    calls.push({ operation: 'apply', projection });
    if (mode === 'apply-throw' || mode === 'apply-throw-restore-throw') {
      throw new Error('GUARDANOMALY-apply-boom');
    }
    if (mode === 'apply-partial-throw') {
      // simulate partial activation: pi-guard commits PROJECTED, then the call
      // raises before returning -> activation state is unknown to the caller.
      active = Object.freeze({
        projectionIdentity: 'partial',
        inventoryFingerprint: 'partial',
        permittedProfile: Object.freeze([]),
      });
      throw new Error('GUARDANOMALY-apply-partial-boom');
    }
    if (mode === 'invalid') return INVALID;
    if (mode === 'fingerprint-mismatch') {
      return { kind: 'fingerprintMismatch', expected: 'expected', actual: 'actual', reason: 'surface drift' };
    }
    if (mode === 'conflict') {
      return { kind: 'conflictingActivation', activeProjectionIdentity: 'other', reason: 'conflicting projection active' };
    }
    if (mode === 'apply-fail-verified') return { kind: 'applicationFailed', reason: 'apply failed', restorationVerified: true };
    if (mode === 'apply-fail-unverified') return { kind: 'applicationFailed', reason: 'apply failed', restorationVerified: false };
    if (mode === 'unknown-outcome') return { kind: 'bogus' } as unknown as TrustedProjectionApplyResult;

    const parsed = readProjection(projection);
    if (parsed === null || parsed.projectionVersion !== 1 || typeof parsed.projectionIdentity !== 'string' || !Array.isArray(parsed.allowedToolNames) || typeof parsed.inventoryFingerprint !== 'string') {
      return INVALID;
    }
    const names = parsed.allowedToolNames.filter((n): n is string => typeof n === 'string');
    // single-active: identical replay is idempotent; any other projection conflicts
    if (active !== undefined) {
      const identical =
        active.projectionIdentity === parsed.projectionIdentity &&
        active.inventoryFingerprint === parsed.inventoryFingerprint &&
        active.permittedProfile.length === names.length &&
        active.permittedProfile.every((n, i) => n === names[i]);
      if (!identical) {
        return { kind: 'conflictingActivation', activeProjectionIdentity: active.projectionIdentity, reason: 'conflicting projection active' };
      }
      return { kind: 'idempotentReplay', projectionIdentity: active.projectionIdentity };
    }
    appliedProjections.push(projection);
    const appliedActive: { readonly projectionIdentity: string; readonly inventoryFingerprint: string; readonly permittedProfile: readonly string[] } = Object.freeze({
      projectionIdentity: parsed.projectionIdentity,
      inventoryFingerprint: parsed.inventoryFingerprint,
      permittedProfile: Object.freeze([...names]),
    });
    if (mode === 'inspect-not-active') {
      return { kind: 'applied', projectionIdentity: appliedActive.projectionIdentity, profile: appliedActive.permittedProfile };
    }
    if (mode === 'inspect-profile-mismatch' || mode === 'restore-throw') {
      active = Object.freeze({ ...appliedActive, permittedProfile: Object.freeze(['read']) });
      return { kind: 'applied', projectionIdentity: active.projectionIdentity, profile: active.permittedProfile };
    }
    active = appliedActive;
    return { kind: 'applied', projectionIdentity: appliedActive.projectionIdentity, profile: appliedActive.permittedProfile };
  };

  const inspectActiveProjection = (): TrustedProjectionInspection => {
    calls.push({ operation: 'inspect' });
    if (mode === 'inspect-throw') throw new Error('GUARDANOMALY-inspect-boom');
    return active === undefined
      ? { active: false, mode: 'OFF' }
      : { active: true, mode: 'PROJECTED', projectionIdentity: active.projectionIdentity, inventoryFingerprint: active.inventoryFingerprint, permittedProfile: active.permittedProfile };
  };

  const restoreTrustedProjection = (): TrustedProjectionRestoreResult => {
    calls.push({ operation: 'restore' });
    restores += 1;
    if (mode === 'restore-throw' || mode === 'apply-throw-restore-throw') {
      throw new Error('GUARDANOMALY-restore-boom');
    }
    if (active === undefined) return { kind: 'not-applicable' };
    active = undefined;
    return mode === 'restore-fail' ? { kind: 'restorationFailed', restorationVerified: false } : { kind: 'restored', restorationVerified: true };
  };

  return {
    api: Object.freeze({ applyTrustedProjection, inspectActiveProjection, restoreTrustedProjection }),
    calls,
    appliedProjections,
    restoreCount: () => restores,
  };
}

/** A compatible package-inspection fixture for the verified lane. */
export function verifiedPackageInspection(): import('../../../src/adapters/pi/enforcement/types.js').GuardPackageInspection {
  return Object.freeze({
    inspected: true,
    packageId: 'pi-guard',
    version: '0.1.2',
    extensionEntry: 'extensions/pi-guard/index.ts',
    trustedApiCaptured: true,
    compatible: true,
    findings: Object.freeze([]),
  });
}
