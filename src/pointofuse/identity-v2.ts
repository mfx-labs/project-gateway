/**
 * WP-6 Phase 3A: fixed static-input projection, one-pass static-input identity,
 * and non-circular result-identity foundation (contract Sections 14 and 19;
 * HCRR-01 and HCRR-02).
 *
 * The static projection is the exact closed fixed shape: unknown keys are
 * impossible by construction, both protocol versions are the exact literal
 * `'2'`, and every optional operand uses explicit tagged absence. Captured
 * models are embedded as deeply frozen JSON values; the complete projection is
 * JCS-serialized exactly once (object-key canonicalization inside every
 * captured model occurs as part of that single whole-projection serialization;
 * arrays preserve their protocol-defined order). The SHA-256 input is
 * `PGAP-POINT-OF-USE-INPUT-v2\0` + the UTF-8 bytes of the one canonical JCS
 * serialization. Canonical serialized bytes remain internal and are not
 * themselves embedded as projection members.
 *
 * The result identity is audit correlation only: it is not authorization
 * input, not replay resistance, and its projection is non-circular (it never
 * contains `pointOfUseResultIdentity` itself).
 */
import { createHash } from 'node:crypto';
import { jcsSerialize } from '../canonical/jcs.js';
import { compareStrings } from '../trusted/ordering.js';
import type { EligibilityReport } from '../api/types.js';
import type {
  ConsumerSupportProjection,
  NormalizedResultFindingProjection,
  PointOfUseResultIdentityProjection,
  PointOfUseStaticInputProjection,
  RegistryProjection,
  RequestedUseProjection,
  StaticGrantProjection,
  StaticLifecycleRecordProjection,
  StaticProjectionInput,
  TaggedCapabilitySet,
  TaggedNumericValue,
} from './router-types.js';

export const STATIC_INPUT_IDENTITY_DOMAIN = 'PGAP-POINT-OF-USE-INPUT-v2\u0000';
export const RESULT_IDENTITY_DOMAIN = 'PGAP-POINT-OF-USE-RESULT-v2\u0000';

export const STATIC_INPUT_IDENTITY_RE = /^sha-256:[0-9a-f]{64}$/;
export const RESULT_IDENTITY_RE = /^sha-256:[0-9a-f]{64}$/;

function computeDigest(domain: string, canonicalUtf8: string): string {
  const hash = createHash('sha256');
  hash.update(domain, 'utf8');
  hash.update(canonicalUtf8, 'utf8');
  return 'sha-256:' + hash.digest('hex');
}

// ---------------------------------------------------------------------------
// static projection
// ---------------------------------------------------------------------------

function freezeTaggedCapabilitySet(value: TaggedCapabilitySet): TaggedCapabilitySet {
  if (value.state === 'absent') return Object.freeze({ state: 'absent' as const });
  return Object.freeze({ state: 'present' as const, capabilities: Object.freeze([...value.capabilities]) });
}

function freezeTaggedNumeric(value: TaggedNumericValue): TaggedNumericValue {
  if (value.state === 'absent') return Object.freeze({ state: 'absent' as const });
  return Object.freeze({ state: 'present' as const, value: value.value });
}

function freezeGrant(value: StaticGrantProjection): StaticGrantProjection {
  if (value.state === 'absent') return Object.freeze({ state: 'absent' as const });
  return Object.freeze({ state: 'present' as const, capturedModel: value.capturedModel });
}

function freezeRegistry(value: RegistryProjection): RegistryProjection {
  return Object.freeze({ ...value });
}

function freezeConsumerSupport(value: ConsumerSupportProjection): ConsumerSupportProjection {
  return Object.freeze({
    consumerId: value.consumerId,
    supportedProtocolFeatures: Object.freeze([...value.supportedProtocolFeatures]),
    supportedConsumerCapabilities: Object.freeze([...value.supportedConsumerCapabilities]),
    supportedExtensionNamespaces: Object.freeze([...value.supportedExtensionNamespaces]),
  });
}

function freezeRequestedUse(value: RequestedUseProjection): RequestedUseProjection {
  return Object.freeze({
    capability: value.capability,
    ...(value.capabilityVersion !== undefined ? { capabilityVersion: value.capabilityVersion } : {}),
    operationClass: value.operationClass,
    resourceClass: value.resourceClass,
    scope: value.scope,
    workspaceId: value.workspaceId,
  });
}

function freezeLifecycleRecords(value: readonly StaticLifecycleRecordProjection[]): readonly StaticLifecycleRecordProjection[] {
  // Canonical ordering: sorted by record ID (contract Section 14); the
  // projection is order-independent regardless of caller-supplied order.
  const sorted = [...value].sort((a, b) => compareStrings(a.recordId, b.recordId));
  return Object.freeze(sorted.map((entry) => Object.freeze({ recordId: entry.recordId, model: entry.model })));
}

/**
 * Build the exact fixed static-input projection from already-captured values
 * and genuine configuration-derived scalars (internal parameter object). The
 * builder never reads hostile input objects. The result is deeply frozen;
 * unknown keys are impossible by construction.
 */
export function buildStaticInputProjection(input: StaticProjectionInput): PointOfUseStaticInputProjection {
  return Object.freeze({
    projectionProtocolVersion: '1',
    outerRouterVersion: '2',
    innerPointOfUseInputsVersion: '2',
    configurationVersion: input.configurationVersion,
    configurationIdentity: input.configurationIdentity,
    capabilityVocabularyVersion: input.capabilityVocabularyVersion,
    inputWorkspaceId: input.inputWorkspaceId,
    requestedUseWorkspaceId: input.requestedUseWorkspaceId,
    requestedUse: freezeRequestedUse(input.requestedUse),
    currentTime: input.currentTime,
    configuredGlobalCapabilityCeiling: freezeTaggedCapabilitySet(input.configuredGlobalCapabilityCeiling),
    configuredWorkspaceCapabilityCeiling: freezeTaggedCapabilitySet(input.configuredWorkspaceCapabilityCeiling),
    configuredGlobalNumericCeiling: freezeTaggedNumeric(input.configuredGlobalNumericCeiling),
    configuredWorkspaceNumericCeiling: freezeTaggedNumeric(input.configuredWorkspaceNumericCeiling),
    consumerSupport: freezeConsumerSupport(input.consumerSupport),
    bundle: Object.freeze({ state: 'present' as const, capturedModel: input.bundle }),
    policy: Object.freeze({ state: 'present' as const, capturedModel: input.policy }),
    grant: freezeGrant(input.grant),
    registry: freezeRegistry(input.registry),
    lifecycleRecords: freezeLifecycleRecords(input.lifecycleRecords),
  });
}

/**
 * One-pass static-input identity: JCS-serialize the complete projection
 * exactly once, then SHA-256 over `PGAP-POINT-OF-USE-INPUT-v2\0` + the UTF-8
 * bytes of that single serialization. Deterministic; no filesystem, network,
 * process, clock, or randomness.
 */
export function computeStaticInputCorrelationIdentity(projection: PointOfUseStaticInputProjection): string {
  const canonicalUtf8 = jcsSerialize(projection);
  return computeDigest(STATIC_INPUT_IDENTITY_DOMAIN, canonicalUtf8);
}

// ---------------------------------------------------------------------------
// result identity foundation (contract Section 19)
// ---------------------------------------------------------------------------

function sortDedup(values: readonly string[]): readonly string[] {
  const sorted = [...values].sort(compareStrings);
  const out: string[] = [];
  for (const value of sorted) {
    if (out.length === 0 || out[out.length - 1] !== value) out.push(value);
  }
  return Object.freeze(out);
}

/**
 * Build the non-circular result-identity projection from a finalized base
 * `EligibilityReport` plus the static identity. The projection excludes
 * `pointOfUseResultIdentity`; findings project stable protocol fields only
 * (never localized message prose); categories and rule IDs are sorted and
 * deduplicated; subject correlations are JCS-key-ordered by the single
 * whole-projection serialization; findings retain the report's deterministic
 * sequence; optional fields use explicit omission.
 */
export function buildPointOfUseResultIdentityProjection(input: {
  readonly staticInputCorrelationIdentity: string;
  readonly report: EligibilityReport;
}): PointOfUseResultIdentityProjection {
  const report = input.report;
  const requestedUse: RequestedUseProjection = Object.freeze({
    capability: report.requestedUse.capability,
    ...(report.requestedUse.capabilityVersion !== undefined ? { capabilityVersion: report.requestedUse.capabilityVersion } : {}),
    operationClass: report.requestedUse.operationClass,
    resourceClass: report.requestedUse.resourceClass,
    scope: report.requestedUse.scope,
    workspaceId: report.requestedUse.workspaceId,
  });
  const subjectCorrelations: Record<string, string> = {};
  for (const key of Object.keys(report.subjectCorrelations)) {
    subjectCorrelations[key] = String(report.subjectCorrelations[key]);
  }
  const findings: NormalizedResultFindingProjection[] = report.findings.map((finding) =>
    Object.freeze({
      phase: finding.phase,
      category: finding.category,
      messageKey: finding.messageKey,
      ruleIds: sortDedup(finding.ruleIds),
      ...(finding.subjectIdentity !== undefined ? { subjectIdentity: finding.subjectIdentity } : {}),
      ...(finding.location !== undefined && finding.location !== '' ? { location: finding.location } : {}),
    }),
  );
  return Object.freeze({
    pointOfUseResultIdentityProtocolVersion: '1',
    routingVariant: 'v2',
    staticInputCorrelationIdentity: input.staticInputCorrelationIdentity,
    normalizedReport: Object.freeze({
      eligible: report.eligible,
      requestedUse,
      capability: report.capability,
      scope: report.scope,
      workspaceId: report.workspaceId,
      subjectCorrelations: Object.freeze(subjectCorrelations),
      ...(report.firstFailingPhase !== undefined ? { firstFailingPhase: report.firstFailingPhase } : {}),
      categories: sortDedup(report.categories),
      ruleIds: sortDedup(report.ruleIds),
      findings: Object.freeze(findings),
    }),
  });
}

/**
 * Result identity over the non-circular projection: JCS-serialize the complete
 * projection exactly once, then SHA-256 over `PGAP-POINT-OF-USE-RESULT-v2\0` +
 * the UTF-8 bytes of that single serialization. Audit correlation only; the
 * base report is never mutated.
 */
export function computePointOfUseResultIdentity(projection: PointOfUseResultIdentityProjection): string {
  const canonicalUtf8 = jcsSerialize(projection);
  return computeDigest(RESULT_IDENTITY_DOMAIN, canonicalUtf8);
}
