/**
 * WP-5B — PiEnforcementEvidence construction (Part E) and identity
 * canonicalization (F-02/F-R2/F-R4).
 *
 * `projectionIdentity` and `evidenceFingerprint` are DISTINCT:
 *  - `projectionIdentity` — the single canonical F-R4 identity, deterministic
 *    over the plan / authority-input / effective-authority / compatibility /
 *    inventory / enforcement-configuration / workspace / vocabulary /
 *    evaluator-interface members; explicitly EXCLUDES timestamps, activation
 *    outcome, restoration outcome, runtime observations, ExecutionResult,
 *    TrustedReceipt, and incidental diagnostics. Equivalent projection inputs
 *    and outcomes share one identity.
 *  - `evidenceFingerprint` — deterministic over the COMPLETE canonical
 *    evidence record INCLUDING every present accepted timestamp value and the
 *    timestamp-source identifier; equivalent activations at different times do
 *    NOT share a fingerprint.
 *
 * PiEnforcementEvidence is correlation/evidence only: never authority.
 */
import { createHash } from 'node:crypto';
import { jcsSerialize } from '../../../canonical/jcs.js';
import type { EligibilityReport } from '../../../index.js';
import type { PiInvocationPlan } from '../types.js';
import {
  GUARD_EVIDENCE_FINGERPRINT_DOMAIN,
  GUARD_PROJECTION_IDENTITY_DOMAIN,
  type GuardActivationOutcome,
  type GuardFinding,
  type GuardRestorationOutcome,
  type PiEnforcementEvidence,
} from './types.js';

export interface ProjectionIdentityInput {
  readonly planFingerprint: string;
  readonly authorityInputIdentities: {
    readonly globalCeilingsIdentity?: string;
    readonly workspaceCeilingsIdentity?: string;
    readonly policyRevisionId?: string;
    readonly grantIdentity: string;
    readonly consumerDeclarationIdentity: string;
  };
  readonly effectiveAuthorityIdentity: string;
  readonly compatibilityResultIdentity: string;
  readonly observedToolInventoryIdentity: string;
  readonly enforcementConfigurationIdentity: string;
  readonly workspaceIdentity: string;
  readonly capabilityVocabularyVersion: string;
  readonly evaluatorInterfaceVersion: string;
}

/** Domain-separated SHA-256 (repository digest convention). */
export function domainDigest(domain: string, canonicalUtf8: string): string {
  const hash = createHash('sha256');
  hash.update(domain, 'utf8');
  hash.update(canonicalUtf8, 'utf8');
  return 'sha-256:' + hash.digest('hex');
}

/** Deep-remove `undefined` leaves before canonical serialization (absence by
 *  omission; explicit null and empty strings are retained and distinct). */
export function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const cleaned = stripUndefined((value as Record<string, unknown>)[key]);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return value;
}

function canon(value: unknown): string {
  return jcsSerialize(stripUndefined(value));
}

/** Canonical plan identity (correlation identity of the exact occurrence/attempt). */
export function computePlanIdentity(plan: PiInvocationPlan): string {
  const canonical = canon({
    occurrenceId: plan.occurrenceId,
    attemptId: plan.attemptId,
    bundleInstance: plan.bundleReference.target_instance_id,
  });
  return domainDigest('PGAP-PI-PLAN-IDENTITY-v1\0', canonical);
}

/** Canonical plan fingerprint (deterministic, state-independent). */
export function computePlanFingerprint(plan: PiInvocationPlan): string {
  const canonical = canon({
    protocolVersion: plan.protocolVersion,
    consumerIdentity: plan.consumerIdentity,
    consumerVersion: plan.consumerVersion,
    supportedPiLane: plan.supportedPiLane,
    bundleReference: plan.bundleReference,
    taskReference: plan.taskReference,
    authorityPolicyReference: plan.authorityPolicyReference,
    contextManifestReference: plan.contextManifestReference,
    completionContractReference: plan.completionContractReference,
    occurrenceId: plan.occurrenceId,
    attemptId: plan.attemptId,
    subjectCorrelations: plan.subjectCorrelations.map((s) => ({ role: s.role, digest: s.digest, instanceId: s.instanceId, revisionId: s.revisionId })),
    capabilityCompatibilityFingerprint: plan.capabilityCompatibility.fingerprint,
    status: plan.status,
    piGuardEnforcementPending: plan.piGuardEnforcementPending,
  });
  return domainDigest('PGAP-PI-PLAN-v1\0', canonical);
}

/** Consumer-declaration identity (authority-input identity). */
export function computeConsumerDeclarationIdentity(consumer: {
  readonly consumerId: string;
  readonly supportedProtocolFeatures?: readonly string[];
  readonly supportedConsumerCapabilities?: readonly string[];
  readonly supportedExtensionNamespaces?: readonly string[];
}): string {
  const canonical = canon({
    consumerId: consumer.consumerId,
    supportedProtocolFeatures: [...(consumer.supportedProtocolFeatures ?? [])].sort(),
    supportedConsumerCapabilities: [...(consumer.supportedConsumerCapabilities ?? [])].sort(),
    supportedExtensionNamespaces: [...(consumer.supportedExtensionNamespaces ?? [])].sort(),
  });
  return domainDigest('PGAP-PI-CONSUMER-DECLARATION-v1\0', canonical);
}

/**
 * Effective-authority identity: WP-5B consumes the committed WP-6 result
 * identity when present (EligibilityReportV2 `pointOfUseResultIdentity`);
 * otherwise it derives a deterministic correlation identity over the exact
 * validated eligibility facts (capability, workspace, scope, correlations).
 * This is correlation linkage only — WP-5B never re-evaluates the
 * intersection.
 */
export function computeEffectiveAuthorityIdentity(eligibility: EligibilityReport): string {
  const v2 = eligibility as Readonly<{ pointOfUseResultIdentity?: unknown }>;
  if (typeof v2['pointOfUseResultIdentity'] === 'string' && v2['pointOfUseResultIdentity'].length > 0) {
    return v2['pointOfUseResultIdentity'];
  }
  const canonical = canon({
    eligible: eligibility.eligible === true,
    capability: eligibility.capability,
    workspaceId: eligibility.workspaceId,
    scope: eligibility.scope,
    subjectCorrelations: eligibility.subjectCorrelations,
  });
  return domainDigest('PGAP-PI-EFFECTIVE-AUTHORITY-LINKAGE-v1\0', canonical);
}

/** Projected Enforcement Configuration identity (Part D; canonical allowed set). */
export function computeEnforcementConfigurationIdentity(allowed: readonly string[], denied: readonly string[], unsupported: readonly string[]): string {
  const canonical = canon({
    allowedToolNames: [...allowed].sort(),
    deniedToolNames: [...denied].sort(),
    unsupportedRequiredCapabilities: [...unsupported].sort(),
  });
  return domainDigest('PGAP-PI-ENFORCEMENT-CONFIG-v1\0', canonical);
}

/** Single canonical F-R4 projection identity. */
export function computeProjectionIdentity(input: ProjectionIdentityInput): string {
  const canonical = canon({
    planFingerprint: input.planFingerprint,
    authorityInputIdentities: input.authorityInputIdentities,
    effectiveAuthorityIdentity: input.effectiveAuthorityIdentity,
    compatibilityResultIdentity: input.compatibilityResultIdentity,
    observedToolInventoryIdentity: input.observedToolInventoryIdentity,
    enforcementConfigurationIdentity: input.enforcementConfigurationIdentity,
    workspaceIdentity: input.workspaceIdentity,
    capabilityVocabularyVersion: input.capabilityVocabularyVersion,
    evaluatorInterfaceVersion: input.evaluatorInterfaceVersion,
  });
  return domainDigest(GUARD_PROJECTION_IDENTITY_DOMAIN, canonical);
}

/** Canonical evidence record (complete, incl. timestamps + source id). */
export function canonicalizeEvidence(evidence: Omit<PiEnforcementEvidence, 'evidenceFingerprint'>): string {
  return canon(evidence);
}

/** Evidence fingerprint over the complete canonical record (incl. timestamps). */
export function computeEvidenceFingerprint(evidence: Omit<PiEnforcementEvidence, 'evidenceFingerprint'>): string {
  return domainDigest(GUARD_EVIDENCE_FINGERPRINT_DOMAIN, canonicalizeEvidence(evidence));
}

export interface EvidenceFacts {
  readonly inputPlanIdentity: string;
  readonly planFingerprint: string;
  readonly projectionIdentity: string;
  readonly authorityInputIdentities: ProjectionIdentityInput['authorityInputIdentities'];
  readonly effectiveAuthorityIdentity: string;
  readonly piGuardIdentity: string;
  readonly piGuardVersion: string;
  readonly piIdentity: string;
  readonly piVersion: string;
  readonly observedToolInventoryIdentity: string;
  readonly projectedAllowedTools: readonly string[];
  readonly projectedDeniedTools: readonly string[];
  readonly unsupportedRequiredCapabilities: readonly string[];
  readonly activationOutcome: GuardActivationOutcome;
  readonly restorationOutcome: GuardRestorationOutcome;
  readonly compatibilityFindings: readonly GuardFinding[];
  readonly timestampSource: string;
  readonly observedAt: string;
}

/** Build a deterministic PiEnforcementEvidence record (Part E). */
export function buildEvidence(facts: EvidenceFacts): PiEnforcementEvidence {
  const without = {
    inputPlanIdentity: facts.inputPlanIdentity,
    planFingerprint: facts.planFingerprint,
    projectionIdentity: facts.projectionIdentity,
    authorityInputIdentities: facts.authorityInputIdentities,
    effectiveAuthorityIdentity: facts.effectiveAuthorityIdentity,
    piGuardIdentity: facts.piGuardIdentity,
    piGuardVersion: facts.piGuardVersion,
    piIdentity: facts.piIdentity,
    piVersion: facts.piVersion,
    observedToolInventoryIdentity: facts.observedToolInventoryIdentity,
    projectedAllowedTools: [...facts.projectedAllowedTools].sort(),
    projectedDeniedTools: [...facts.projectedDeniedTools].sort(),
    unsupportedRequiredCapabilities: [...facts.unsupportedRequiredCapabilities].sort(),
    activationOutcome: facts.activationOutcome,
    restorationOutcome: facts.restorationOutcome,
    compatibilityFindings: facts.compatibilityFindings,
    timestampSource: facts.timestampSource,
    observedAt: facts.observedAt,
  };
  return Object.freeze({
    ...without,
    evidenceFingerprint: computeEvidenceFingerprint(without),
  });
}
