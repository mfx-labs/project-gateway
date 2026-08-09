/**
 * WP-5B — trusted enforcement run (Part B/D activation/restoration path).
 *
 * Deterministic, atomic flow, failing closed at every boundary:
 *
 *   validated projection-ready plan → validated correlated eligibility →
 *   WP-12 activation correlation → pi-guard compatibility → effective
 *   surface + normative inventory fingerprint → capability→tool projection →
 *   exact four-field trusted projection → applyTrustedProjection(...) →
 *   verified PROJECTED state → PiEnforcementEvidence.
 *
 * No partial activation: every check before `applyTrustedProjection` happens
 * before any pi-guard state change; apply failures and failed post-apply
 * verification trigger verified restoration and never leave a partially
 * widened surface. Restart requires a fresh activation decision and a fresh
 * projection (no persisted evidence ever reactivates enforcement).
 *
 * WP-5B consumes only derived enforcement data; Gateway lifecycle records are
 * never passed to pi-guard. PiEnforcementEvidence is evidence only.
 */
import { verifyTrustedProjectionApi } from './compatibility.js';
import { SUPPORTED_PI_PACKAGE_ID, SUPPORTED_PI_VERSION } from '../compatibility.js';
import {
  buildEvidence,
  computeConsumerDeclarationIdentity,
  computeEffectiveAuthorityIdentity,
  computeEnforcementConfigurationIdentity,
  computePlanFingerprint,
  computePlanIdentity,
  computeProjectionIdentity,
  type EvidenceFacts,
} from './evidence.js';
import { computeInventoryFingerprint, isAcceptedTimestamp } from './fingerprint.js';
import { piGuardFinding as finding, sortGuardFindings as sortFindings } from './findings.js';
import { projectAllowedAndDenied } from './projection.js';
import {
  GUARD_PROJECTION_VERSION,
  GUARD_CONSUMER_IDENTITY,
  GUARD_CONSUMER_VERSION,
  PI_GUARD_PACKAGE_ID,
  PI_GUARD_RELEASE_COMMIT,
  PI_GUARD_RELEASE_TAG,
  PI_GUARD_VERSION,
  PI_GUARD_VERIFIED_LANE,
  type GuardCompatibilityResult,
  type GuardEnforcementInput,
  type GuardEnforcementRunResult,
  type EffectiveToolSurface,
  type GuardFinding,
  type GuardPackageInspection,
  type TrustedProjectionApi,
} from './types.js';

/** Exact four-field projection shape (predicate 13, sender side). */
const PROJECTION_FIELDS = ['projectionVersion', 'projectionIdentity', 'allowedToolNames', 'inventoryFingerprint'] as const;

type GuardCall<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

/** Contain any unexpected host/API exception at the trusted-API boundary; raw
 *  exception text is never exposed to findings or evidence. */
function safeCall<T>(fn: () => T): GuardCall<T> {
  try {
    return { ok: true, value: fn() };
  } catch {
    return { ok: false };
  }
}

type RestorationTruth = { readonly outcome: 'verified' | 'failed' | 'not-applicable'; readonly finding?: GuardFinding };

/** Guarded restoration: a restoration exception is itself contained and
 *  represented as a failed restoration outcome, never propagated raw. */
function performRestore(api: TrustedProjectionApi): RestorationTruth {
  const call = safeCall(() => api.restoreTrustedProjection());
  if (!call.ok) {
    return { outcome: 'failed', finding: finding('GUARD-ACTIVATION-FAILURE', 'restoration.unexpected-exception', 'pi-guard restoration raised an unexpected exception; restoration reported failed') };
  }
  const result = call.value;
  if (result.kind === 'restored') return { outcome: 'verified' };
  if (result.kind === 'restorationFailed') {
    return { outcome: 'failed', finding: finding('GUARD-ACTIVATION-FAILURE', 'restoration.unverified', 'pi-guard restoration could not be verified') };
  }
  return { outcome: 'not-applicable' };
}

/** Fail-closed compatibility fallback when verification itself is interrupted. */
function verificationFailedResult(): GuardCompatibilityResult {
  return Object.freeze({
    compatible: false,
    fingerprint: 'unverified',
    verifiedLane: PI_GUARD_VERIFIED_LANE,
    releasedCommit: PI_GUARD_RELEASE_COMMIT,
    releasedTag: PI_GUARD_RELEASE_TAG,
    piGuardVersion: PI_GUARD_VERSION,
    observedSurface: Object.freeze({ apiMethods: Object.freeze([]), frozen: false, projectionVersionSupported: false }),
    findings: Object.freeze([finding('GUARD-LANE-INCOMPATIBLE', 'guard.api-verification-failed', 'trusted projection API could not be verified')]),
  });
}

function shapeFindings(projection: unknown): GuardFinding[] {
  const findings: GuardFinding[] = [];
  if (typeof projection !== 'object' || projection === null || Array.isArray(projection)) {
    findings.push(finding('GUARD-INPUT-INVALID', 'run.projection-not-object', 'trusted projection must be an object'));
    return findings;
  }
  const keys = Object.keys(projection as object).sort();
  const expected = [...PROJECTION_FIELDS].sort();
  if (keys.length !== expected.length || !keys.every((k, i) => k === expected[i]!)) {
    findings.push(finding('GUARD-INPUT-INVALID', 'run.projection-shape', 'trusted projection must contain exactly the four field names'));
  }
  return findings;
}

/** Deterministic four-field trusted projection object (immutable). */
export function buildTrustedProjection(identity: string, allowedToolNames: readonly string[], fingerprint: string): unknown {
  return Object.freeze({
    projectionVersion: GUARD_PROJECTION_VERSION,
    projectionIdentity: identity,
    allowedToolNames: Object.freeze([...allowedToolNames]),
    inventoryFingerprint: fingerprint,
  });
}

/**
 * Run one trusted enforcement activation for the exact occurrence/attempt.
 * Returns a deterministic evidence-plus-outcome result; never authority.
 */
export function runTrustedEnforcement(input: GuardEnforcementInput): GuardEnforcementRunResult {
  const findings: GuardFinding[] = [];
  const plan = input.plan;
  const eligibility = input.eligibility;

  // ─── 1. input hygiene ──────────────────────────────────────────────────────
  if (!isAcceptedTimestamp(input.hostTimestamp)) {
    findings.push(finding('GUARD-INPUT-INVALID', 'run.timestamp-invalid', 'host timestamp is not an accepted timestamp value'));
  }
  if (typeof input.timestampSource !== 'string' || input.timestampSource.length === 0) {
    findings.push(finding('GUARD-INPUT-INVALID', 'run.timestamp-source-invalid', 'timestamp source identifier is required'));
  }
  if (typeof input.workspaceIdentity !== 'string' || input.workspaceIdentity.length === 0) {
    findings.push(finding('GUARD-INPUT-INVALID', 'run.workspace-invalid', 'workspace identity is required'));
  }

  // ─── 2. plan verification (WP-5A projection-ready) ────────────────────────
  if (plan.status !== 'projection-ready' || plan.piGuardEnforcementPending !== true) {
    findings.push(finding('GUARD-PLAN-UNCORRELATED', 'plan.not-projection-ready', 'plan is not a validated projection-ready plan with pending pi-guard enforcement'));
  }
  if (typeof plan.occurrenceId !== 'string' || plan.occurrenceId.length === 0 || typeof plan.attemptId !== 'string' || plan.attemptId.length === 0) {
    findings.push(finding('GUARD-PLAN-UNCORRELATED', 'plan.occurrence-invalid', 'plan occurrence/attempt identity is missing'));
  }

  // ─── 3. eligibility correlation (never reinterpreted) ────────────────────
  if (eligibility.eligible !== true) {
    findings.push(finding('GUARD-ELIGIBILITY-UNCORRELATED', 'eligibility.not-eligible', 'eligibility evidence does not indicate eligibility'));
  }
  if (typeof eligibility.capability !== 'string' || eligibility.capability.length === 0) {
    findings.push(finding('GUARD-ELIGIBILITY-UNCORRELATED', 'eligibility.capability-invalid', 'eligibility capability identity is missing'));
  }
  if (typeof eligibility.workspaceId !== 'string' || eligibility.workspaceId !== input.workspaceIdentity) {
    findings.push(finding('GUARD-ELIGIBILITY-UNCORRELATED', 'eligibility.workspace-mismatch', 'eligibility workspace does not match the enforcement workspace'));
  }
  const bundleInstance = eligibility.subjectCorrelations['bundleInstance'];
  const planBundleInstance = plan.bundleReference.target_instance_id;
  if (typeof bundleInstance !== 'string' || bundleInstance.length === 0 || bundleInstance !== planBundleInstance) {
    findings.push(finding('GUARD-ELIGIBILITY-UNCORRELATED', 'eligibility.bundle-correlation', 'eligibility is not correlated with the exact plan bundle instance'));
  }

  // ─── 4. activation correlation (WP-12; ADR-002) ──────────────────────────
  const activation = input.activation;
  if (activation.decision !== 'accepted') {
    findings.push(finding('GUARD-ACTIVATION-UNCORRELATED', 'activation.not-accepted', 'control-plane activation decision is not accepted'));
  }
  if (activation.grantCurrent !== true) {
    findings.push(finding('GUARD-ACTIVATION-UNCORRELATED', 'activation.grant-not-current', 'correlated RuntimeGrant is not current'));
  }
  if (activation.resolvedOccurrenceId !== plan.occurrenceId || activation.attemptId !== plan.attemptId) {
    findings.push(finding('GUARD-ACTIVATION-UNCORRELATED', 'activation.occurrence-mismatch', 'activation decision is not correlated with the exact plan occurrence/attempt'));
  }
  if (typeof activation.runtimeGrantId !== 'string' || activation.runtimeGrantId.length === 0) {
    findings.push(finding('GUARD-ACTIVATION-UNCORRELATED', 'activation.grant-identity-missing', 'activation decision grant identity is missing'));
  }

  // ─── 5. pi-guard compatibility (predicate 12–17) ─────────────────────────
  // WP-5B enforces only against a verified Pi host lane (WP-5A).
  if (input.piHost.piVersion !== SUPPORTED_PI_VERSION || input.piHost.piIdentity !== SUPPORTED_PI_PACKAGE_ID) {
    findings.push(finding('GUARD-LANE-INCOMPATIBLE', 'run.pi-host-lane', 'pi host is not the supported verified lane'));
  }
  const rawPackageInspection: unknown = input.guard.packageInspection;
  // FSIR-WP5B-001: a malformed host-supplied inspection (null / non-object /
  // missing fields) is contained as a typed lane failure; `.findings` and
  // `.compatible` are never accessed on an unusable value.
  const packageInspectionUsable =
    rawPackageInspection !== null &&
    typeof rawPackageInspection === 'object' &&
    Array.isArray((rawPackageInspection as Readonly<Record<string, unknown>>)['findings']) &&
    typeof (rawPackageInspection as Readonly<Record<string, unknown>>)['compatible'] === 'boolean';
  const packageInspectionFindings: readonly GuardFinding[] = packageInspectionUsable
    ? (rawPackageInspection as GuardPackageInspection).findings
    : [finding('GUARD-LANE-INCOMPATIBLE', 'guard.package-inspection-unavailable', 'pi-guard package inspection is unavailable')];
  const packageInspectionCompatible = packageInspectionUsable
    ? (rawPackageInspection as GuardPackageInspection).compatible
    : false;
  const apiCompatibility = (() => {
    const call = safeCall(() => verifyTrustedProjectionApi(input.guard.api));
    return call.ok ? call.value : verificationFailedResult();
  })();
  const compatibilityFindings: GuardFinding[] = [...packageInspectionFindings, ...apiCompatibility.findings];
  if (!packageInspectionCompatible || !apiCompatibility.compatible) {
    findings.push(...compatibilityFindings);
  }

  // ─── 6. effective surface + normative inventory fingerprint ──────────────
  // FSIR-WP5B-001: a malformed host-supplied surface (null / non-object /
  // non-array entries) is contained as a typed surface failure; `.entries`
  // is never accessed on an unusable value.
  const rawSurface: unknown = input.surface;
  const surfaceUsable =
    rawSurface !== null &&
    typeof rawSurface === 'object' &&
    !Array.isArray(rawSurface) &&
    Array.isArray((rawSurface as Readonly<Record<string, unknown>>)['entries']);
  if (!surfaceUsable) {
    findings.push(
      finding(
        'GUARD-SURFACE-UNAVAILABLE',
        rawSurface === null ? 'run.surface-unavailable' : 'run.surface-invalid',
        'effective tool surface is unavailable',
      ),
    );
  }
  const surface = surfaceUsable ? (rawSurface as EffectiveToolSurface) : undefined;
  const observedToolInventoryIdentity = surface !== undefined ? computeInventoryFingerprint(surface.entries) : '';

  if (findings.length > 0) {
    return failClosed(input, observedToolInventoryIdentity, [], [], [], compatibilityFindings, findings, 'not-attempted', 'not-applicable');
  }

  // ─── 7. capability→tool projection ───────────────────────────────────────
  // Reachable only when `findings.length === 0` above, which requires a
  // usable surface (section 6); the narrowing is explicit for type safety.
  const surfaceEntries: readonly { readonly name: string; readonly source: string }[] = surface !== undefined ? surface.entries : [];
  const projected = projectAllowedAndDenied({
    capability: eligibility.capability,
    capabilityVocabularyVersion: input.capabilityVocabularyVersion,
    surface: surface as NonNullable<typeof surface>,
    expectedToolSources: input.expectedToolSources,
    workspaceIdentity: input.workspaceIdentity,
  });
  if (!projected.ok) {
    return failClosed(
      input,
      observedToolInventoryIdentity,
      [],
      surfaceEntries.map((e) => e.name),
      [eligibility.capability],
      compatibilityFindings,
      [...projected.findings],
      'not-attempted',
      'not-applicable',
    );
  }
  const allowed = projected.projection.allowedToolNames;
  const denied = projected.projection.deniedToolNames;

  // ─── 8. identity ingredients + projection identity (F-R4) ────────────────
  const authorityInputIdentities = {
    globalCeilingsIdentity: input.globalCeilingsIdentity,
    workspaceCeilingsIdentity: input.workspaceCeilingsIdentity,
    policyRevisionId: input.policyRevisionId,
    grantIdentity: activation.runtimeGrantId,
    consumerDeclarationIdentity: computeConsumerDeclarationIdentity(input.consumer),
  };
  const effectiveAuthorityIdentity = computeEffectiveAuthorityIdentity(eligibility);
  const enforcementConfigurationIdentity = computeEnforcementConfigurationIdentity(allowed, denied, projected.projection.unsupportedRequiredCapabilities);
  const projectionIdentity = computeProjectionIdentity({
    planFingerprint: computePlanFingerprint(plan),
    authorityInputIdentities,
    effectiveAuthorityIdentity,
    compatibilityResultIdentity: apiCompatibility.fingerprint,
    observedToolInventoryIdentity,
    enforcementConfigurationIdentity,
    workspaceIdentity: input.workspaceIdentity,
    capabilityVocabularyVersion: input.capabilityVocabularyVersion,
    evaluatorInterfaceVersion: input.evaluatorVersion,
  });

  // ─── 9. apply trusted projection (exact four fields) ─────────────────────
  const trustedProjection = buildTrustedProjection(projectionIdentity, allowed, observedToolInventoryIdentity);
  const shape = shapeFindings(trustedProjection);
  if (shape.length > 0) {
    return failClosed(input, observedToolInventoryIdentity, allowed, denied, [], compatibilityFindings, shape, 'not-attempted', 'not-applicable');
  }

  const applyCall = safeCall(() => input.guard.api.applyTrustedProjection(trustedProjection));
  if (!applyCall.ok) {
    // activation may or may not have partially occurred / state is unknown:
    // attempt guarded restoration, report truth, remain fail-closed.
    const restoration = performRestore(input.guard.api);
    const restorationFindings = restoration.finding !== undefined ? [restoration.finding] : [];
    return failClosed(
      input,
      observedToolInventoryIdentity,
      allowed,
      denied,
      [],
      compatibilityFindings,
      [finding('GUARD-ACTIVATION-FAILURE', 'activation.unexpected-exception', 'pi-guard applyTrustedProjection raised an unexpected exception; enforcement failed closed'), ...restorationFindings],
      'failed-closed',
      restoration.outcome,
    );
  }
  const applyResult = applyCall.value;

  if (applyResult.kind === 'invalid' || applyResult.kind === 'fingerprintMismatch' || applyResult.kind === 'conflictingActivation') {
    return failClosed(
      input,
      observedToolInventoryIdentity,
      allowed,
      denied,
      [],
      compatibilityFindings,
      [finding('GUARD-ACTIVATION-FAILURE', 'activation.rejected', `pi-guard rejected the trusted projection (${applyResult.kind})`)],
      'failed-closed',
      'not-applicable',
    );
  }

  if (applyResult.kind === 'applicationFailed') {
    return failClosed(
      input,
      observedToolInventoryIdentity,
      allowed,
      denied,
      [],
      compatibilityFindings,
      [finding('GUARD-ACTIVATION-FAILURE', 'activation.application-failed', 'pi-guard trusted projection application failed')],
      'failed-closed',
      applyResult.restorationVerified ? 'verified' : 'failed',
    );
  }

  // accept 'applied' and 'idempotentReplay' (identical replay is idempotent)
  if (applyResult.kind !== 'applied' && applyResult.kind !== 'idempotentReplay') {
    return failClosed(input, observedToolInventoryIdentity, allowed, denied, [], compatibilityFindings, [finding('GUARD-ACTIVATION-FAILURE', 'activation.unknown-outcome', 'pi-guard returned an unrecognized activation outcome')], 'failed-closed', 'not-applicable');
  }

  // ─── 10. verified PROJECTED state ────────────────────────────────────────
  const inspectCall = safeCall(() => input.guard.api.inspectActiveProjection());
  if (!inspectCall.ok) {
    // activation state unknown after a reported apply: guarded restore, fail closed.
    const restoration = performRestore(input.guard.api);
    const restorationFindings = restoration.finding !== undefined ? [restoration.finding] : [];
    return failClosed(
      input,
      observedToolInventoryIdentity,
      allowed,
      denied,
      [],
      compatibilityFindings,
      [finding('GUARD-ACTIVATION-FAILURE', 'activation.inspect-exception', 'pi-guard PROJECTED state could not be inspected after apply; enforcement failed closed'), ...restorationFindings],
      'failed-closed',
      restoration.outcome,
    );
  }
  const inspection = inspectCall.value;
  if (inspection.active !== true || inspection.mode !== 'PROJECTED') {
    const restoration = performRestore(input.guard.api);
    const restorationFindings = restoration.finding !== undefined ? [restoration.finding] : [];
    return failClosed(input, observedToolInventoryIdentity, allowed, denied, [], compatibilityFindings, [finding('GUARD-ACTIVATION-FAILURE', 'activation.not-verified', 'PROJECTED state was not verified after apply; enforcement restored'), ...restorationFindings], 'failed-closed', restoration.outcome);
  }
  if (inspection.projectionIdentity !== projectionIdentity || !setsEqual(inspection.permittedProfile, allowed)) {
    const restoration = performRestore(input.guard.api);
    const restorationFindings = restoration.finding !== undefined ? [restoration.finding] : [];
    return failClosed(input, observedToolInventoryIdentity, allowed, denied, [], compatibilityFindings, [finding('GUARD-ACTIVATION-FAILURE', 'activation.profile-mismatch', 'active projection profile does not match the projected profile; enforcement restored'), ...restorationFindings], 'failed-closed', restoration.outcome);
  }

  // ─── 11. success evidence ────────────────────────────────────────────────
  const facts: EvidenceFacts = {
    inputPlanIdentity: computePlanIdentity(plan),
    planFingerprint: computePlanFingerprint(plan),
    projectionIdentity,
    authorityInputIdentities,
    effectiveAuthorityIdentity,
    piGuardIdentity: PI_GUARD_PACKAGE_ID,
    piGuardVersion: PI_GUARD_VERSION,
    piIdentity: input.piHost.piIdentity,
    piVersion: input.piHost.piVersion,
    observedToolInventoryIdentity,
    projectedAllowedTools: allowed,
    projectedDeniedTools: denied,
    unsupportedRequiredCapabilities: projected.projection.unsupportedRequiredCapabilities,
    activationOutcome: 'applied',
    restorationOutcome: 'not-applicable',
    compatibilityFindings,
    timestampSource: input.timestampSource,
    observedAt: input.hostTimestamp,
  };
  const evidence = buildEvidence(facts);
  return {
    ok: true,
    evidence,
    active: Object.freeze({ projectionIdentity, allowedToolNames: allowed }),
  };
}

/**
 * Post-activation surface stability re-check (sampling contract (d)): the
 * live effective-surface identity (name+source fingerprint) must equal the
 * identity observed at activation. On mismatch the caller MUST refuse the
 * protected use and restore; enforcement never silently continues.
 */
export function surfaceStable(
  observedToolInventoryIdentity: string,
  live: readonly { readonly name: string; readonly source: string }[],
): boolean {
  return computeInventoryFingerprint(live) === observedToolInventoryIdentity;
}

function arraysEqualIgnoringOrder(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((v, i) => v === b[i]!);
}

function setsEqual(left: readonly string[], right: readonly string[]): boolean {
  return arraysEqualIgnoringOrder(left, right);
}

/** Deterministic fail-closed result with a full (failed/not-attempted) evidence. */
function failClosed(
  input: GuardEnforcementInput,
  observedToolInventoryIdentity: string,
  allowed: readonly string[],
  denied: readonly string[],
  unsupported: readonly string[],
  compatibilityFindings: readonly GuardFinding[],
  runFindings: readonly GuardFinding[],
  activationOutcome: 'applied' | 'failed-closed' | 'not-attempted',
  restorationOutcome: 'verified' | 'failed' | 'not-applicable',
): GuardEnforcementRunResult {
  const authorityInputIdentities = {
    globalCeilingsIdentity: input.globalCeilingsIdentity,
    workspaceCeilingsIdentity: input.workspaceCeilingsIdentity,
    policyRevisionId: input.policyRevisionId,
    grantIdentity: input.activation.runtimeGrantId,
    consumerDeclarationIdentity: computeConsumerDeclarationIdentity(input.consumer),
  };
  const planFingerprint = computePlanFingerprint(input.plan);
  const effectiveAuthorityIdentity = computeEffectiveAuthorityIdentity(input.eligibility);
  const enforcementConfigurationIdentity = computeEnforcementConfigurationIdentity(allowed, denied, unsupported);
  const projectionIdentity = computeProjectionIdentity({
    planFingerprint,
    authorityInputIdentities,
    effectiveAuthorityIdentity,
    compatibilityResultIdentity: 'unverified',
    observedToolInventoryIdentity,
    enforcementConfigurationIdentity,
    workspaceIdentity: input.workspaceIdentity,
    capabilityVocabularyVersion: input.capabilityVocabularyVersion,
    evaluatorInterfaceVersion: input.evaluatorVersion,
  });
  const evidence = buildEvidence({
    inputPlanIdentity: computePlanIdentity(input.plan),
    planFingerprint,
    projectionIdentity,
    authorityInputIdentities,
    effectiveAuthorityIdentity,
    piGuardIdentity: PI_GUARD_PACKAGE_ID,
    piGuardVersion: PI_GUARD_VERSION,
    piIdentity: input.piHost.piIdentity,
    piVersion: input.piHost.piVersion,
    observedToolInventoryIdentity,
    projectedAllowedTools: allowed,
    projectedDeniedTools: denied,
    unsupportedRequiredCapabilities: unsupported,
    activationOutcome,
    restorationOutcome,
    compatibilityFindings,
    timestampSource: input.timestampSource,
    observedAt: input.hostTimestamp,
  });
  return { ok: false, evidence, findings: sortFindings(runFindings) };
}

export type { EvidenceFacts };
export { GUARD_CONSUMER_IDENTITY, GUARD_CONSUMER_VERSION, PI_GUARD_RELEASE_COMMIT, PI_GUARD_RELEASE_TAG };
