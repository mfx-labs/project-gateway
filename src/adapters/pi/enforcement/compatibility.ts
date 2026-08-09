/**
 * WP-5B — pi-guard compatibility and predicate 12–17 verification (PURE).
 *
 * This module performs NO filesystem, network, process, or environment I/O
 * (the adapter security boundary). The environment-gated pi-guard package
 * discovery lives in `guard-host-harness.ts`; this surface derives
 * compatibility from caller-supplied captures:
 *
 *  - verifies the captured trusted API exposes EXACTLY the three trusted
 *    operations (predicate 12) and is frozen;
 *  - records the verified lane identity (package identity/version, release
 *    commit, tag) and the released compatibility facts;
 *  - computes the compatibility fingerprint over the observed public surface
 *    (predicate 17: package identity, manifest version, extension identity,
 *    required exports, mode set incl. PROJECTED, reserved ids, config
 *    contract shape, projection schema shape).
 *
 * pi-guard-side predicate 13–16 (four-field projection validation, PROJECTED
 * composition, activation/restoration, fingerprint-at-activation) are bound by
 * the recorded compatible-lane verification; the live fingerprint convergence
 * (16) is re-checked at activation time by `applyTrustedProjection` (a
 * mismatch returns `fingerprintMismatch` and fails closed).
 */
import { createHash } from 'node:crypto';
import { jcsSerialize } from '../../../canonical/jcs.js';
import {
  PI_GUARD_PACKAGE_ID,
  PI_GUARD_RELEASE_COMMIT,
  PI_GUARD_RELEASE_TAG,
  PI_GUARD_VERSION,
  GUARD_PROJECTION_VERSION,
} from './types.js';
import { piGuardFinding as finding, sortGuardFindings as sortFindings } from './findings.js';
import type { GuardCompatibilityResult, GuardFinding, TrustedProjectionApi } from './types.js';

/** Reserved pi-guard tool identities (Part B predicate). */
export const GUARD_RESERVED_TOOL_IDS = Object.freeze(['bash', 'edit', 'write', 'git_inspect']);
/** Mode set incl. PROJECTED (Part B predicate). */
export const GUARD_MODE_SET = Object.freeze(['OFF', 'INSPECT', 'EDIT', 'WRITE', 'PROJECTED']);
/** Projection schema shapes (Part B predicate). */
export const GUARD_PROJECTION_SCHEMA = Object.freeze(['projectionVersion', 'projectionIdentity', 'allowedToolNames', 'inventoryFingerprint']);
/** Config contract shapes (Part B predicate). */
export const GUARD_CONFIG_CONTRACT = Object.freeze(['researchTools', 'allowedExtensions']);
/** Extension entry (Part B predicate). */
export const GUARD_EXTENSION_ENTRY = 'extensions/pi-guard/index.ts';

/** Compatible surface with the trusted API (predicate 12). Never throws: a
 *  null, malformed, or hostile API verifies as incompatible (fail closed). */
export function verifyTrustedProjectionApi(api: TrustedProjectionApi): GuardCompatibilityResult {
  const incompatible = (key: string, message: string): GuardCompatibilityResult =>
    Object.freeze({
      compatible: false,
      fingerprint: 'unverified',
      verifiedLane: `${PI_GUARD_PACKAGE_ID}-${PI_GUARD_VERSION}`,
      releasedCommit: PI_GUARD_RELEASE_COMMIT,
      releasedTag: PI_GUARD_RELEASE_TAG,
      piGuardVersion: PI_GUARD_VERSION,
      observedSurface: Object.freeze({ apiMethods: [], frozen: false, projectionVersionSupported: false }),
      findings: Object.freeze([finding('GUARD-LANE-INCOMPATIBLE', key, message)]),
    });
  try {
    const names = typeof api === 'object' && api !== null ? Object.keys(api as object).sort() : [];
    const apiMethods = names.filter((name) => typeof (api as unknown as Record<string, unknown>)[name] === 'function');
    const EXPECTED = ['applyTrustedProjection', 'inspectActiveProjection', 'restoreTrustedProjection'].sort();

    const findings: GuardFinding[] = [];
    if (api === null || typeof api !== 'object') {
      return incompatible('guard.api-invalid', 'trusted projection API is not an object');
    }
    if (names.length !== EXPECTED.length || !names.every((n, i) => n === EXPECTED[i]!)) {
      findings.push(finding('GUARD-LANE-INCOMPATIBLE', 'guard.api-surface', `trusted projection API exposes ${names.join(',')}; expected exactly applyTrustedProjection, inspectActiveProjection, restoreTrustedProjection`));
    }
    for (const method of EXPECTED) {
      if (typeof (api as unknown as Record<string, unknown>)[method] !== 'function') {
        findings.push(finding('GUARD-LANE-INCOMPATIBLE', 'guard.api-method-missing', `trusted projection API is missing callable ${method}`));
      }
    }
    const frozen = Object.isFrozen(api);

    const fingerprint = guardCompatibilityFingerprint({
      packageId: PI_GUARD_PACKAGE_ID,
      version: PI_GUARD_VERSION,
      releasedCommit: PI_GUARD_RELEASE_COMMIT,
      releasedTag: PI_GUARD_RELEASE_TAG,
      apiMethods,
      frozen,
      projectionVersion: GUARD_PROJECTION_VERSION,
    });

    return Object.freeze({
      compatible: findings.length === 0,
      fingerprint,
      verifiedLane: `${PI_GUARD_PACKAGE_ID}-${PI_GUARD_VERSION}`,
      releasedCommit: PI_GUARD_RELEASE_COMMIT,
      releasedTag: PI_GUARD_RELEASE_TAG,
      piGuardVersion: PI_GUARD_VERSION,
      observedSurface: Object.freeze({ apiMethods, frozen, projectionVersionSupported: true }),
      findings: Object.freeze(sortFindings(findings)),
    });
  } catch {
    return incompatible('guard.api-verification-failed', 'trusted projection API could not be verified');
  }
}

/** Deterministic compatibility fingerprint over the observed public surface. */
export function guardCompatibilityFingerprint(input: {
  readonly packageId: string;
  readonly version: string;
  readonly releasedCommit: string;
  readonly releasedTag: string;
  readonly apiMethods: readonly string[];
  readonly frozen: boolean;
  readonly projectionVersion: number;
}): string {
  const canonical = jcsSerialize({
    packageId: input.packageId,
    version: input.version,
    releasedCommit: input.releasedCommit,
    releasedTag: input.releasedTag,
    extensionEntry: GUARD_EXTENSION_ENTRY,
    apiMethods: [...input.apiMethods].sort(),
    frozen: input.frozen,
    projectionVersion: input.projectionVersion,
    projectionSchema: GUARD_PROJECTION_SCHEMA,
    modeSet: GUARD_MODE_SET,
    reservedToolIds: GUARD_RESERVED_TOOL_IDS,
    configContract: GUARD_CONFIG_CONTRACT,
    inventoryFingerprintAlgorithm: 'inventory-v1',
  });
  return 'sha-256:' + createHash('sha256').update('PGAP-GUARD-COMPATIBILITY-v1\0', 'utf8').update(canonical, 'utf8').digest('hex');
}
