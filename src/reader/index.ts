/**
 * WP-7 — Internal barrel (not exported from package root).
 *
 * Internal entry point for future consumers (WP-8/WP-9/WP-10/WP-11/WP-13)
 * that access WP-7 through internal composition.
 */
export { WorkspaceInspectionService } from './service.js';
export type { WorkspaceInspectionServiceOptions } from './service.js';
export { GitInspectionService } from '../git/service.js';
export type { GitInspectionServiceOptions } from '../git/service.js';
export { FffProvider, createFffProvider } from '../fff/provider.js';
export type { FffCapability, FffScanBudget } from '../fff/provider.js';
export { initializeGitHostLane, revalidateGitHostLane } from '../git/host-lane.js';
export type { GitHostLaneDescriptor, GitBinaryFingerprint } from '../git/host-lane.js';
export type { GitChildEnvironment } from '../git/wrapper.js';
export { verifyGitRepository } from '../git/preflight.js';
export { ConcurrencyController } from './admission.js';
export { captureRequest, validateAndCaptureRequest } from './capture.js';
export type { CapturedRequest } from './capture.js';
export { WP7_LIMITS } from './types.js';
export { ERROR_CODES, isRetryable } from './errors.js';
export * from './errors.js';
export type {
  OperationName,
  OperationCorrelation,
  OperationFailure,
  OperationResult,
  TrustedOperationControl,
  HostileOperationRequestData,
  ListDirectoryRequest,
  InspectMetadataRequest,
  ReadTextRequest,
  ReadBytesRequest,
  GitStatusRequest,
  GitDiffRequest,
  GitLogRequest,
  GitShowRequest,
  FffDiscoverRequest,
  DirectoryEntry,
  ListDirectoryResult,
  InspectMetadataResult,
  ReadTextResult,
  ReadBytesResult,
  GitStatusRecord,
  GitStatusResult,
  GitDiffResult,
  GitLogRecord,
  GitLogResult,
  GitShowResult,
  FffResultItem,
  FffDiscoveryResult,
} from './types.js';
