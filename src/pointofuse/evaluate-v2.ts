/**
 * WP-6 Phase 3B: v2 semantic authority evaluation on top of the committed
 * effective-authority evaluator (contract Sections 16, 17, 18; RuntimeGrant
 * gate model HCR-01). This module REUSES the committed evaluator's machinery
 * (bundle/policy structure, subject correlation, registry context, approval
 * chain, lifecycle, activation, revocation, validity windows, grant
 * correlation, consumer support, operation/resource/scope constraints, grant
 * constraint vocabulary, numeric grant constraints) and adds the v2-only
 * stages: configured capability-ceiling enforcement, capability finding
 * accumulation, configured numeric Model C integration, and complete
 * EligibilityReportV2 finalization. No second conflicting evaluator exists.
 *
 * The detached v1 branch is a thin bridge over the same committed evaluator,
 * preserving valid-v1 semantic results (the direct public v1 entry is
 * untouched).
 */
import { evaluateEffectiveAuthority, type EffectiveAuthorityInputs } from './evaluate.js';
import { sortFindings } from '../internal/report.js';
import {
  semanticGlobalCapabilityCeilingDenial,
  semanticGrantRecordTypeDenial,
  semanticWorkspaceCapabilityCeilingDenial,
} from './findings-v2.js';
import {
  buildPointOfUseResultIdentityProjection,
  computePointOfUseResultIdentity,
} from './identity-v2.js';
import type {
  DetachedV1Input,
  DetachedV2Input,
  StaticGrantProjection,
} from './router-types.js';
import type { EligibilityReport, EligibilityReportV2, ImmutableModel, RequestedUse } from '../api/types.js';
import type { ValidatedTrustedWorkspaceConfiguration, ValidatedWorkspaceRecord } from '../trusted/types.js';

// ---------------------------------------------------------------------------
// bridging the detached inputs into the committed evaluator
// ---------------------------------------------------------------------------

/**
 * Bridge the detached v1 input into the committed `EffectiveAuthorityInputs`.
 * Caller numeric ceilings are the v1 contract's own operands and are passed
 * through unchanged (v1 semantics); consumer arrays keep captured order.
 */
export function bridgeV1Input(input: DetachedV1Input): EffectiveAuthorityInputs {
  return {
    currentTime: input.currentTime,
    workspaceId: input.workspaceId,
    requestedUse: input.requestedUse as unknown as RequestedUse,
    ...(input.globalActionCeiling !== undefined ? { globalActionCeiling: input.globalActionCeiling } : {}),
    ...(input.workspaceActionCeiling !== undefined ? { workspaceActionCeiling: input.workspaceActionCeiling } : {}),
    consumerSupport: input.consumerSupport as unknown as EffectiveAuthorityInputs['consumerSupport'],
    identity: input.identity as unknown as EffectiveAuthorityInputs['identity'],
    resolver: input.resolver as unknown as EffectiveAuthorityInputs['resolver'],
    registry: input.registry as unknown as EffectiveAuthorityInputs['registry'],
    lifecycle: input.lifecycle as unknown as EffectiveAuthorityInputs['lifecycle'],
    revocations: input.revocations as unknown as EffectiveAuthorityInputs['revocations'],
    bundle: input.bundle as unknown as ImmutableModel,
    policy: input.policy as unknown as ImmutableModel,
    ...(input.grant.state === 'present' ? { grant: input.grant.capturedModel as unknown as ImmutableModel } : {}),
  };
}

/**
 * Bridge the detached v2 input into the committed evaluator. Model C numeric
 * integration: the configured global and workspace numeric ceilings are the
 * evaluator's numeric operands (the committed AUT-001 / LFC-008 checks then
 * implement the minimum narrowing semantics); v2 carries no caller numeric
 * fields. The RuntimeGrant is the mandatory gate and deny-only constraint
 * source; it is never a capability set.
 */
export function bridgeV2Input(
  input: DetachedV2Input,
  configuration: ValidatedTrustedWorkspaceConfiguration,
  workspace: ValidatedWorkspaceRecord,
): EffectiveAuthorityInputs {
  return {
    currentTime: input.currentTime,
    workspaceId: input.workspaceId,
    requestedUse: input.requestedUse as unknown as RequestedUse,
    ...(configuration.globalActionCeiling !== undefined ? { globalActionCeiling: configuration.globalActionCeiling } : {}),
    ...(workspace.actionCeiling !== undefined ? { workspaceActionCeiling: workspace.actionCeiling } : {}),
    consumerSupport: input.consumerSupport as unknown as EffectiveAuthorityInputs['consumerSupport'],
    identity: input.identity as unknown as EffectiveAuthorityInputs['identity'],
    resolver: input.resolver as unknown as EffectiveAuthorityInputs['resolver'],
    registry: input.registry as unknown as EffectiveAuthorityInputs['registry'],
    lifecycle: input.lifecycle as unknown as EffectiveAuthorityInputs['lifecycle'],
    revocations: input.revocations as unknown as EffectiveAuthorityInputs['revocations'],
    bundle: input.bundle as unknown as ImmutableModel,
    policy: input.policy as unknown as ImmutableModel,
    ...(input.grant.state === 'present' ? { grant: input.grant.capturedModel as unknown as ImmutableModel } : {}),
  };
}

/** Detached v1 compatibility evaluation through the committed evaluator. */
export function evaluateDetachedV1(input: DetachedV1Input): EligibilityReport {
  return evaluateEffectiveAuthority(bridgeV1Input(input));
}

// ---------------------------------------------------------------------------
// capability authority (contract Section 16)
// ---------------------------------------------------------------------------

/**
 * Capability authority: the requested capability must be permitted by the
 * configured global ceiling (or the ceiling is absent), the configured
 * workspace ceiling (or absent), the approved applicable AuthorityPolicy, and
 * the validated consumer support (the last two are enforced by the committed
 * evaluator's policy and consumer stages). Absence is NOT an empty set; a
 * PRESENT ceiling with absent or empty capabilities denies every capability
 * (committed Phase-1 presence-aware semantics). The RuntimeGrant is a
 * mandatory gate outside this set intersection (HCR-01).
 */
export function capabilityDenialFindings(
  input: DetachedV2Input,
  configuration: ValidatedTrustedWorkspaceConfiguration,
  workspace: ValidatedWorkspaceRecord,
): readonly import('../internal/report.js').Finding[] {
  const capability = input.requestedUse.capability;
  const subject = `capability:${capability}@${input.workspaceId}`;
  const findings: import('../internal/report.js').Finding[] = [];
  const globalCeiling = configuration.globalCapabilityCeiling;
  if (globalCeiling !== undefined) {
    const set = globalCeiling.capabilities;
    if (set === undefined || !set.includes(capability)) {
      findings.push(semanticGlobalCapabilityCeilingDenial(subject));
    }
  }
  const workspaceCeiling = workspace.capabilities;
  if (workspaceCeiling !== undefined && !workspaceCeiling.includes(capability)) {
    findings.push(semanticWorkspaceCapabilityCeilingDenial(subject));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// RuntimeGrant numeric derivation (contract Section 15 steps 5–6, Section 17)
// ---------------------------------------------------------------------------

/**
 * Derive `validatedActiveGrantMaxActions`: the minimum of the structurally
 * valid numeric `max-actions` entries of the captured grant, or undefined when
 * the grant is absent or any `max-actions` entry is malformed (a malformed
 * entry already produces the committed `pou.grant-unknown-constraint`
 * semantic denial in the base evaluator; no derived value exists). The value
 * is never part of the static identity; narrowing itself is enforced by the
 * committed evaluator's grant-constraint checks against the configured
 * numeric ceilings.
 */
export function deriveValidatedActiveGrantMaxActions(grant: StaticGrantProjection): number | undefined {
  if (grant.state === 'absent') return undefined;
  const constraints = (grant.capturedModel as Readonly<Record<string, unknown>>)['narrowed_constraints'];
  if (!Array.isArray(constraints)) return undefined;
  let malformed = false;
  let min: number | undefined;
  for (const entry of constraints) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      malformed = true;
      continue;
    }
    const constraint = entry as Readonly<Record<string, unknown>>;
    if (constraint['type'] !== 'max-actions') continue;
    const value = constraint['value'];
    if (typeof value !== 'number') {
      malformed = true;
      continue;
    }
    if (min === undefined || value < min) min = value;
  }
  return malformed ? undefined : min;
}

// ---------------------------------------------------------------------------
// v2 semantic evaluation and finalization (contract Section 18)
// ---------------------------------------------------------------------------

/**
 * Grant gate step 2 (contract Section 15): the captured grant model's record
 * type must be exactly `RuntimeGrant`. The committed evaluator correlates the
 * grant by bundle/workspace/registry; this v2 gate adds the record-type
 * check so a non-grant record can never act as the grant.
 */
export function grantGateFindings(
  input: DetachedV2Input,
): readonly import('../internal/report.js').Finding[] {
  if (input.grant.state === 'absent') return [];
  const recordType = (input.grant.capturedModel as Readonly<Record<string, unknown>>)['record_type'];
  if (recordType !== 'RuntimeGrant') {
    const subject = `capability:${input.requestedUse.capability}@${input.workspaceId}`;
    return [semanticGrantRecordTypeDenial(subject)];
  }
  return [];
}

/**
 * Complete v2 semantic evaluation: the committed evaluator runs first
 * (accumulating findings per its deterministic order, including the mandatory
 * RuntimeGrant gate and grant constraint checks), then the v2 grant gate and
 * capability ceiling stages add their findings, then the combined report is
 * finalized deterministically. A semantic denial is a COMPLETE evaluation:
 * finalization continues and both identities are produced.
 */
export function evaluateV2Semantics(
  input: DetachedV2Input,
  configuration: ValidatedTrustedWorkspaceConfiguration,
  workspace: ValidatedWorkspaceRecord,
): EligibilityReport {
  const base = evaluateEffectiveAuthority(bridgeV2Input(input, configuration, workspace));
  const grantFindings = grantGateFindings(input);
  const capabilityFindings = capabilityDenialFindings(input, configuration, workspace);
  const combined = [...base.findings, ...grantFindings, ...capabilityFindings];
  const sorted = sortFindings(combined);
  const eligible = sorted.length === 0;
  const first = sorted[0];
  return Object.freeze({
    eligible,
    requestedUse: base.requestedUse,
    capability: base.capability,
    scope: base.scope,
    workspaceId: base.workspaceId,
    subjectCorrelations: base.subjectCorrelations,
    ...(first !== undefined ? { firstFailingPhase: first.phase } : {}),
    categories: Object.freeze([...new Set(sorted.map((f) => f.category))]),
    ruleIds: Object.freeze([...new Set(sorted.flatMap((f) => f.ruleIds))].sort()),
    findings: Object.freeze(sorted),
  });
}

/**
 * Finalize the complete v2 report: build the non-circular result-identity
 * projection over the finalized normalized base report and the static
 * identity, compute the result identity, and construct the deeply frozen
 * `EligibilityReportV2`. The base report is never mutated. Identity
 * computation failures propagate to the router, which converts them into a
 * deterministic router failure (no partial report).
 */
export function finalizeV2Report(
  report: EligibilityReport,
  staticInputCorrelationIdentity: string,
): EligibilityReportV2 {
  const projection = buildPointOfUseResultIdentityProjection({
    staticInputCorrelationIdentity,
    report,
  });
  const pointOfUseResultIdentity = computePointOfUseResultIdentity(projection);
  return Object.freeze({
    ...report,
    staticInputCorrelationIdentity,
    pointOfUseResultIdentity,
  });
}
