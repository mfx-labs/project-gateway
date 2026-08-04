/**
 * @project-gateway/artifact-core/pi-adapter
 *
 * WP-5A Pi adapter prototype: converts an already validated and
 * point-of-use-eligible ExecutionBundle (plus its four exact resolved
 * prospective members) into a deterministic Pi-compatible invocation plan and
 * observes Pi-compatible completion output through a narrow host bridge.
 *
 * The adapter is a pure projection and observation boundary: it never
 * authorizes, approves, activates, grants, or executes anything; pi-guard
 * authority enforcement is explicitly pending on every plan.
 */
export {
  inspectPiHostCompatibility,
  hostCapabilityFingerprint,
  SUPPORTED_PI_PACKAGE_ID,
  SUPPORTED_PI_VERSION,
} from './compatibility.js';
export { projectExecutionBundleToPi, exactReferenceOf } from './projection.js';
export type { PiProjectionResult } from './projection.js';
export { createPiHostBridge, validatePiInvocationPlan, isPiExecutionObservation, isPiInvocationPlan } from './host-bridge.js';
export type { PiHostBridge, PiHostBridgeResult } from './host-bridge.js';
export { observePiExecution } from './observation.js';
export { inspectLocalPiPackage, resolvePiPackagePath } from './host-harness.js';
export type { PiPackageInspection } from './host-harness.js';
export { TRUSTED_ADAPTER_PREAMBLE, renderPrompt, renderTaskSection, renderContextInventory, renderContextBlock, renderCompletionCriteria, renderCorrelationFooter } from './render.js';
export { manifestEntries, correlateContextItems } from './context.js';
export { piFinding, sortFindings as sortPiFindings } from './findings.js';
export type {
  PiAdapterLimits,
  PiCapabilityCompatibility,
  PiCapturedEvent,
  PiContextBlockMeta,
  PiEligibilityEvidence,
  PiExecutionObservation,
  PiFinding,
  PiFindingCategory,
  PiHostCapabilityDeclaration,
  PiHostSurface,
  PiInvocationPlan,
  PiModelObservation,
  PiObservationCompleteness,
  PiPlanStatus,
  PiProjectionInput,
  PiResolvedContextItem,
  PiSubjectCorrelation,
  PiToolCallObservation,
} from './types.js';
export {
  PI_ADAPTER_PROTOCOL_VERSION,
  PI_CONSUMER_IDENTITY,
  PI_CONSUMER_VERSION,
  SUPPORTED_PI_LANE,
} from './types.js';
