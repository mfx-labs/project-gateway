/**
 * WP-6 Phase 3A: internal PointOfUse v2 barrel. Cohesive internal entry points
 * only — this barrel is intentionally NOT re-exported from the package root
 * (`src/index.ts` remains byte-identical), and no Phase-3 type or function may
 * cross the package-root boundary.
 */
export {
  ROUTE_PROTOCOL_VERSION_1,
  ROUTE_PROTOCOL_VERSION_2,
  LEGACY_COMPATIBILITY_MODE,
  POINT_OF_USE_INPUTS_PROTOCOL_VERSION_2,
} from './router-types.js';
export type {
  ConsumerSupportProjection,
  DetachedConsumerSupportV1,
  DetachedConsumerSupportV2,
  DetachedLifecycleView,
  DetachedRegistryContext,
  DetachedV1Input,
  DetachedV2Input,
  IdentityViewAdapter,
  ImmutableJsonValue,
  NormalizedEligibilityReportWithoutResultIdentity,
  NormalizedResultFindingProjection,
  PointOfUseResultIdentityProjection,
  PointOfUseRoutingResult,
  PointOfUseStaticInputProjection,
  RegistryProjection,
  RequestedUseProjection,
  ResolverViewAdapter,
  RevocationsViewAdapter,
  RouterFailureStage,
  StaticGrantProjection,
  StaticLifecycleRecordProjection,
  StaticProjectionInput,
  TaggedCapabilitySet,
  TaggedCapturedModel,
  TaggedNumericValue,
  V1RouterRequestVariant,
  V2RouterRequestVariant,
  VersionedPointOfUseRouterRequest,
} from './router-types.js';
export { captureRouterRequest } from './router-capture.js';
export type { CapturedRouterShell, RouterShellCaptureResult, RouterShellFailureCode } from './router-capture.js';
export { captureV1Input, captureV2Input, detachedWorkspacesEqual } from './input-capture.js';
export type { V1InputCaptureFailureCode, V1InputCaptureResult, V2InputCaptureFailureCode, V2InputCaptureResult } from './input-capture.js';
export {
  createBoundAdapter,
  createIdentityViewAdapter,
  createResolverViewAdapter,
  createRevocationsViewAdapter,
  extractCallable,
} from './view-capture.js';
export type { ExtractedCallable, ViewAdapterResult, ViewExtractionFailureCode } from './view-capture.js';
export { createDetachedFindRecord, snapshotLifecycleRecords } from './lifecycle-snapshot.js';
export type { LifecycleSnapshot, LifecycleSnapshotFailureCode } from './lifecycle-snapshot.js';
export { captureBareModel } from './model-capture.js';
export type { BareModelCaptureResult } from './model-capture.js';
export {
  buildPointOfUseResultIdentityProjection,
  buildStaticInputProjection,
  computePointOfUseResultIdentity,
  computeStaticInputCorrelationIdentity,
  RESULT_IDENTITY_DOMAIN,
  RESULT_IDENTITY_RE,
  STATIC_INPUT_IDENTITY_DOMAIN,
  STATIC_INPUT_IDENTITY_RE,
} from './identity-v2.js';
export {
  findingInnerVersionMismatch,
  findingInnerVersionMissing,
  findingLegacyDeclaration,
  findingLifecycleSnapshot,
  findingModelCapture,
  findingNestedInputCapture,
  findingOperandBrand,
  findingResultIdentity,
  findingRouteTag,
  findingShellStructural,
  findingStaticIdentity,
  findingStaticProjection,
  findingViewAdaptation,
  findingWorkspaceCapture,
  pou2Finding,
  sortPou2Findings,
} from './findings-v2.js';
export type { POU2Finding, POU2FindingCode } from './findings-v2.js';
