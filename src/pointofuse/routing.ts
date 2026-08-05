/**
 * WP-6 Phase 3B: authoritative internal configuration-aware PointOfUse router
 * (contract Sections 3, 4, 8, 9, 10, 11, 18). Internal only — never exported
 * from the package root. The router:
 *
 *  1. verifies the runtime-genuine trusted configuration brand before any
 *     configuration field read;
 *  2. captures the exact router request shell (closed v1/v2 union);
 *  3. dispatches by branch: the v1 branch evaluates the DETACHED v1 input
 *     only when `requiresV2` is false (otherwise `legacy-not-permitted`); the
 *     v2 branch captures the detached v2 input, resolves the workspace from
 *     the single detached workspace value, computes `requiresV2`, builds the
 *     static projection and static identity, evaluates v2 semantics, and
 *     finalizes the complete `EligibilityReportV2` with both identities;
 *  4. converts every boundary and internal failure into a deterministic
 *     `router-failure` with a typed finding — no exception escapes, no stack,
 *     no hostile value stringification, no identities on router failures.
 *
 * No upgrade, downgrade, reroute, or fallback exists; the result kind always
 * matches the safely captured branch.
 */
import { isGenuineValidatedTrustedWorkspaceConfiguration } from '../trusted/configuration-brand.js';
import { lookupValidatedWorkspace } from '../trusted/validate.js';
import type { ValidatedTrustedWorkspaceConfiguration, ValidatedWorkspaceRecord } from '../trusted/types.js';
import { captureRouterRequest } from './router-capture.js';
import { captureV1Input, captureV2Input } from './input-capture.js';
import {
  evaluateDetachedV1,
  evaluateV2Semantics,
  finalizeV2Report,
} from './evaluate-v2.js';
import { buildStaticInputProjection, computeStaticInputCorrelationIdentity } from './identity-v2.js';
import {
  findingConfigNotGenuine,
  findingConfigVersion,
  findingEvaluationException,
  findingInnerVersionMismatch,
  findingInnerVersionMissing,
  findingLegacyDeclaration,
  findingLegacyNotPermitted,
  findingLifecycleSnapshot,
  findingModelCapture,
  findingNestedInputCapture,
  findingOperandBrand,
  findingResultIdentity,
  findingRouteTag,
  findingShellStructural,
  findingStaticIdentity,
  findingViewAdaptation,
  findingWorkspaceCapture,
  findingWorkspaceUnknown,
} from './findings-v2.js';
import type { POU2Finding } from './findings-v2.js';
import type {
  DetachedV2Input,
  PointOfUseRoutingResult,
  StaticProjectionInput,
} from './router-types.js';

function routerFailure(finding: POU2Finding): PointOfUseRoutingResult {
  return { kind: 'router-failure', stage: finding.stage, findings: Object.freeze([finding]) };
}

function mapShellFailure(code: 'shell-structural' | 'route-tag' | 'legacy-declaration'): POU2Finding {
  switch (code) {
    case 'shell-structural':
      return findingShellStructural();
    case 'route-tag':
      return findingRouteTag();
    case 'legacy-declaration':
      return findingLegacyDeclaration();
  }
}

function mapV2CaptureFailure(
  code: 'inner-version-missing' | 'inner-version-mismatch' | 'nested-capture' | 'workspace-capture' | 'view-adaptation' | 'lifecycle-snapshot' | 'operand-brand' | 'model-capture',
): POU2Finding {
  switch (code) {
    case 'inner-version-missing':
      return findingInnerVersionMissing();
    case 'inner-version-mismatch':
      return findingInnerVersionMismatch();
    case 'nested-capture':
      return findingNestedInputCapture();
    case 'workspace-capture':
      return findingWorkspaceCapture();
    case 'view-adaptation':
      return findingViewAdaptation();
    case 'lifecycle-snapshot':
      return findingLifecycleSnapshot();
    case 'operand-brand':
      return findingOperandBrand();
    case 'model-capture':
      return findingModelCapture();
  }
}

function mapV1CaptureFailure(
  code: 'nested-capture' | 'workspace-capture' | 'view-adaptation' | 'lifecycle-snapshot' | 'operand-brand' | 'model-capture',
): POU2Finding {
  switch (code) {
    case 'nested-capture':
      return findingNestedInputCapture();
    case 'workspace-capture':
      return findingWorkspaceCapture();
    case 'view-adaptation':
      return findingViewAdaptation();
    case 'lifecycle-snapshot':
      return findingLifecycleSnapshot();
    case 'operand-brand':
      return findingOperandBrand();
    case 'model-capture':
      return findingModelCapture();
  }
}

function checkConfigurationVersion(configuration: ValidatedTrustedWorkspaceConfiguration): POU2Finding | undefined {
  // Genuine configurations are always '1' | '2' (the trusted validator brands
  // only those); the closed switch is defensive and fail-closed.
  if (configuration.configurationVersion !== '1' && configuration.configurationVersion !== '2') {
    return findingConfigVersion();
  }
  return undefined;
}

/**
 * `requiresV2` — exact presence-based predicate (contract Section 9). Field
 * presence, not truthiness: a zero numeric ceiling counts as present; a
 * present capability ceiling with absent or empty capabilities counts as
 * present. `artifactLocation` alone never forces v2. No reflective
 * future-key detection; a future forcing operand requires an explicit
 * protocol update.
 */
export function requiresV2(
  configuration: ValidatedTrustedWorkspaceConfiguration,
  workspace: ValidatedWorkspaceRecord,
): boolean {
  return (
    configuration.globalCapabilityCeiling !== undefined ||
    configuration.globalActionCeiling !== undefined ||
    workspace.capabilities !== undefined ||
    workspace.actionCeiling !== undefined
  );
}

/** Resolve the workspace from the single detached workspace value; no second observation. */
function resolveWorkspace(
  configuration: ValidatedTrustedWorkspaceConfiguration,
  workspaceId: string,
): { readonly workspace: ValidatedWorkspaceRecord } | { readonly failure: POU2Finding } {
  const workspace = lookupValidatedWorkspace(configuration, workspaceId);
  if (workspace === undefined) return { failure: findingWorkspaceUnknown() };
  return { workspace };
}

/** Assemble the exact Section-14 static projection input from captured values only. */
function buildProjectionInput(
  configuration: ValidatedTrustedWorkspaceConfiguration,
  workspace: ValidatedWorkspaceRecord,
  input: DetachedV2Input,
): StaticProjectionInput {
  const globalCeiling = configuration.globalCapabilityCeiling;
  const workspaceCapabilities = workspace.capabilities;
  return {
    configurationVersion: configuration.configurationVersion,
    configurationIdentity: configuration.identity,
    capabilityVocabularyVersion: configuration.capabilityVocabularyVersion,
    inputWorkspaceId: input.workspaceId,
    requestedUseWorkspaceId: input.requestedUse.workspaceId,
    requestedUse: input.requestedUse,
    currentTime: input.currentTime,
    configuredGlobalCapabilityCeiling: globalCeiling !== undefined
      ? { state: 'present', capabilities: globalCeiling.capabilities ?? [] }
      : { state: 'absent' },
    configuredWorkspaceCapabilityCeiling: workspaceCapabilities !== undefined
      ? { state: 'present', capabilities: workspaceCapabilities }
      : { state: 'absent' },
    configuredGlobalNumericCeiling: configuration.globalActionCeiling !== undefined
      ? { state: 'present', value: configuration.globalActionCeiling }
      : { state: 'absent' },
    configuredWorkspaceNumericCeiling: workspace.actionCeiling !== undefined
      ? { state: 'present', value: workspace.actionCeiling }
      : { state: 'absent' },
    consumerSupport: input.consumerSupport,
    bundle: input.bundle,
    policy: input.policy,
    grant: input.grant,
    registry: {
      registryProtocolId: input.registry.registryProtocolId,
      registrySnapshotFormatVersion: input.registry.registrySnapshotFormatVersion,
      registrySnapshotId: input.registry.registrySnapshotId,
      registrySnapshotDigest: input.registry.registrySnapshotDigest,
    },
    lifecycleRecords: input.lifecycle.records.map((record) =>
      Object.freeze({ recordId: record.recordId, model: record.model as never }),
    ),
  };
}

function routeV1(
  configuration: ValidatedTrustedWorkspaceConfiguration,
  inputsValue: unknown,
): PointOfUseRoutingResult {
  const captured = captureV1Input(inputsValue);
  if (!captured.ok) return routerFailure(mapV1CaptureFailure(captured.code));
  const input = captured.input;
  const versionFailure = checkConfigurationVersion(configuration);
  if (versionFailure !== undefined) return routerFailure(versionFailure);
  const resolved = resolveWorkspace(configuration, input.workspaceId);
  if ('failure' in resolved) return routerFailure(resolved.failure);
  // A v1 legacy request under a v2-required configuration is never silently
  // rerouted: it fails closed before any v1 semantic evaluation.
  if (requiresV2(configuration, resolved.workspace)) {
    return routerFailure(findingLegacyNotPermitted());
  }
  const eligibility = evaluateDetachedV1(input);
  return { kind: 'eligibility-v1', eligibility };
}

function routeV2(
  configuration: ValidatedTrustedWorkspaceConfiguration,
  inputsValue: unknown,
): PointOfUseRoutingResult {
  const captured = captureV2Input(inputsValue);
  if (!captured.ok) return routerFailure(mapV2CaptureFailure(captured.code));
  const input = captured.input;
  const versionFailure = checkConfigurationVersion(configuration);
  if (versionFailure !== undefined) return routerFailure(versionFailure);
  const resolved = resolveWorkspace(configuration, input.workspaceId);
  if ('failure' in resolved) return routerFailure(resolved.failure);
  // `requiresV2` is computed after the matched workspace is resolved; a v2
  // request runs regardless (the predicate is informational on this branch).
  requiresV2(configuration, resolved.workspace);

  // Static projection and static identity only after complete detached
  // capture, workspace resolution, and lifecycle/model capture.
  const projection = buildStaticInputProjection(buildProjectionInput(configuration, resolved.workspace, input));
  let staticInputCorrelationIdentity: string;
  try {
    staticInputCorrelationIdentity = computeStaticInputCorrelationIdentity(projection);
  } catch {
    return routerFailure(findingStaticIdentity());
  }

  // Complete semantic evaluation (findings accumulate; denials finalize).
  const report = evaluateV2Semantics(input, configuration, resolved.workspace);

  // Non-circular result identity; failure yields a router failure with no
  // partial report.
  let eligibility;
  try {
    eligibility = finalizeV2Report(report, staticInputCorrelationIdentity);
  } catch {
    return routerFailure(findingResultIdentity());
  }
  return { kind: 'eligibility-v2', eligibility };
}

/**
 * Authoritative internal configuration-aware router. The only production
 * entry accepting the genuine trusted configuration; internal-only, reachable
 * exclusively through the internal point-of-use barrel. No exception escapes;
 * unexpected failures become deterministic router failures with static
 * findings only.
 */
export function evaluatePointOfUseEligibilityForConfiguration(
  configuration: ValidatedTrustedWorkspaceConfiguration,
  request: unknown,
): PointOfUseRoutingResult {
  try {
    if (!isGenuineValidatedTrustedWorkspaceConfiguration(configuration)) {
      return routerFailure(findingConfigNotGenuine());
    }
    const shell = captureRouterRequest(request);
    if (!shell.ok) return routerFailure(mapShellFailure(shell.code));
    if (shell.shell.variant === 'v1') {
      return routeV1(configuration, shell.shell.inputs);
    }
    return routeV2(configuration, shell.shell.inputs);
  } catch {
    // Unexpected internal failure: deterministic router failure; no stack, no
    // raw exception message, no hostile value stringification, no identities.
    return routerFailure(findingEvaluationException());
  }
}
