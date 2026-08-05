/**
 * WP-7 — Operational types: OperationName, request/result discriminated unions,
 * OperationFailure, OperationCorrelation, and resource limits.
 *
 * All types are internal; none is exported from the package root.
 */
import type { ContainmentDecisionIdentity } from '../trusted/index.js';

// ---------------------------------------------------------------------------
// Operation name (closed enumeration)
// ---------------------------------------------------------------------------

export const OPERATION_NAMES = [
  'list-directory',
  'inspect-metadata',
  'read-text',
  'read-bytes',
  'git-status',
  'git-diff',
  'git-log',
  'git-show',
  'fff-discover',
] as const;

export type OperationName = (typeof OPERATION_NAMES)[number];

export function isOperationName(value: string): value is OperationName {
  return (OPERATION_NAMES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

export interface OperationCorrelation {
  readonly workspaceId: string;
  readonly operation: OperationName;
  readonly canonicalWorkspaceRelativePath?: string;
  /** The point-of-use containment decision identity, when containment was evaluated. */
  readonly containmentDecisionIdentity?: string;
}

// ---------------------------------------------------------------------------
// Operational failure
// ---------------------------------------------------------------------------

export type FailureStage =
  | 'request-validation'
  | 'containment'
  | 'filesystem'
  | 'git'
  | 'discovery'
  | 'internal';

export interface OperationFailure {
  readonly code: string; // e.g. 'ERR-REQ-INVALID'
  readonly stage: FailureStage;
  readonly messageKey: string; // e.g. 'wp7.request.invalid'
  readonly retryable: boolean;
  readonly correlation: OperationCorrelation;
}

export function failure(
  code: string,
  stage: FailureStage,
  messageKey: string,
  retryable: boolean,
  correlation: OperationCorrelation,
): OperationFailure {
  return Object.freeze({ code, stage, messageKey, retryable, correlation });
}

// ---------------------------------------------------------------------------
// Operation result (discriminated union)
// ---------------------------------------------------------------------------

export type OperationResult<T = unknown> =
  | { readonly ok: true; readonly value: T; readonly correlation: OperationCorrelation }
  | { readonly ok: false; readonly failure: OperationFailure };

export function success<T>(value: T, correlation: OperationCorrelation): OperationResult<T> {
  return Object.freeze({ ok: true as const, value, correlation });
}

export function fail(failure: OperationFailure): OperationResult<never> {
  return Object.freeze({ ok: false as const, failure });
}

// ---------------------------------------------------------------------------
// Trusted operation control (separate from hostile request data)
// ---------------------------------------------------------------------------

export interface TrustedOperationControl {
  readonly signal?: AbortSignal;
}

export function validateTrustedOperationControl(
  control: unknown,
): { ok: true; signal?: AbortSignal } | { ok: false; message: string } {
  if (control === null || control === undefined) return { ok: true };
  if (typeof control !== 'object') {
    return { ok: false, message: 'control must be an object' };
  }
  const ctrl = control as Record<string, unknown>;
  const signal = ctrl['signal'];
  if (signal === undefined) return { ok: true };
  if (signal === null) return { ok: true };
  // Validate as genuine platform AbortSignal without invoking getters
  const desc = Object.getOwnPropertyDescriptor(ctrl, 'signal');
  if (desc === undefined) return { ok: true };
  if (desc.get !== undefined || desc.set !== undefined) {
    return { ok: false, message: 'signal must be a data property, not an accessor' };
  }
  const sig = desc.value;
  if (!(sig instanceof AbortSignal)) {
    return { ok: false, message: 'signal must be an AbortSignal' };
  }
  return { ok: true, signal: sig };
}

// ---------------------------------------------------------------------------
// Resource limits (pinned defaults from contract LIM-001)
// ---------------------------------------------------------------------------

export const WP7_LIMITS = Object.freeze({
  /** Maximum bytes for read-text and read-bytes (1 MiB). */
  READ_MAX_BYTES: 1_048_576,
  /** Maximum directory entries returned by list-directory. */
  MAX_DIRECTORY_ENTRIES: 10_000,
  /** Maximum Git stdout bytes (8 MiB). */
  GIT_MAX_OUTPUT_BYTES: 8_388_608,
  /** Maximum Git log records. */
  GIT_MAX_LOG_RECORDS: 1_000,
  /** Maximum FFF results. */
  FFF_MAX_RESULTS: 100,
  /** Maximum FFF snippet bytes (UTF-8). */
  FFF_MAX_SNIPPET_BYTES: 512,
  /** Maximum FFF query bytes (UTF-8). */
  FFF_MAX_QUERY_BYTES: 256,
  /** Maximum request-path bytes (UTF-8). */
  REQUEST_PATH_MAX_BYTES: 4_096,
  /** Per-operation timeout in milliseconds (5 s). */
  OPERATION_TIMEOUT_MS: 5_000,
  /** Total operation budget in milliseconds (30 s). */
  TOTAL_BUDGET_MS: 30_000,
  /** Maximum concurrent operations. */
  MAX_CONCURRENT_OPERATIONS: 4,
  /** FFF maximum scan depth. */
  FFF_MAX_DEPTH: 32,
  /** FFF maximum visited entries. */
  FFF_MAX_VISITED_ENTRIES: 10_000,
  /** FFF maximum candidate regular files. */
  FFF_MAX_CANDIDATE_FILES: 2_000,
  /** FFF maximum total content bytes. */
  FFF_MAX_TOTAL_CONTENT_BYTES: 16_777_216,
  /** FFF per-file content window. */
  FFF_PER_FILE_WINDOW: 65_536,
  /** Maximum local Git config bytes (preflight). */
  GIT_CONFIG_MAX_BYTES: 1_048_576,
} as const);

// ---------------------------------------------------------------------------
// Hostile operation request data (the part that goes through snapshot capture)
// ---------------------------------------------------------------------------

export interface ListDirectoryRequest {
  readonly operation: 'list-directory';
  readonly workspaceId: string;
  readonly path: string;
  readonly maxEntries?: number;
}

export interface InspectMetadataRequest {
  readonly operation: 'inspect-metadata';
  readonly workspaceId: string;
  readonly path: string;
}

export interface ReadTextRequest {
  readonly operation: 'read-text';
  readonly workspaceId: string;
  readonly path: string;
  readonly maxBytes?: number;
}

export interface ReadBytesRequest {
  readonly operation: 'read-bytes';
  readonly workspaceId: string;
  readonly path: string;
  readonly maxBytes?: number;
}

export interface GitStatusRequest {
  readonly operation: 'git-status';
  readonly workspaceId: string;
}

export interface GitDiffRequest {
  readonly operation: 'git-diff';
  readonly workspaceId: string;
  readonly pathspecs?: readonly string[];
}

export interface GitLogRequest {
  readonly operation: 'git-log';
  readonly workspaceId: string;
  readonly maxRecords?: number;
}

export interface GitShowRequest {
  readonly operation: 'git-show';
  readonly workspaceId: string;
  readonly commitId: string; // full 40-hex lowercase
}

export interface FffDiscoverRequest {
  readonly operation: 'fff-discover';
  readonly workspaceId: string;
  readonly query: string;
  readonly maxResults?: number;
}

export type HostileOperationRequestData =
  | ListDirectoryRequest
  | InspectMetadataRequest
  | ReadTextRequest
  | ReadBytesRequest
  | GitStatusRequest
  | GitDiffRequest
  | GitLogRequest
  | GitShowRequest
  | FffDiscoverRequest;

// ---------------------------------------------------------------------------
// Operation results
// ---------------------------------------------------------------------------

export interface DirectoryEntry {
  readonly name: string;
  readonly kindHint: 'file' | 'directory' | 'symlink' | 'other';
}

export interface ListDirectoryResult {
  readonly entries: readonly DirectoryEntry[];
  readonly truncated: boolean;
  readonly count: number;
}

export type MetadataKind = 'file' | 'directory' | 'symlink' | 'other';

export interface InspectMetadataResult {
  readonly kind: MetadataKind;
  readonly sizeBytes?: number;
  readonly isRegularFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly isSpecial: boolean;
}

export interface ReadTextResult {
  readonly text: string;
  readonly byteLength: number;
  readonly truncated: boolean;
}

export interface ReadBytesResult {
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly truncated: boolean;
}

export interface GitStatusRecord {
  readonly path: string;
  readonly indexState: string;
  readonly worktreeState: string;
  readonly originalPath?: string;
}

export interface GitStatusResult {
  readonly records: readonly GitStatusRecord[];
}

export interface GitDiffResult {
  readonly text: string;
  readonly byteLength: number;
  readonly truncated: boolean;
}

export interface GitLogRecord {
  readonly commitId: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorDate: string;
  readonly commitDate: string;
  readonly subject: string;
  readonly message: string;
}

export interface GitLogResult {
  readonly records: readonly GitLogRecord[];
  readonly truncated: boolean;
}

export interface GitShowResult {
  readonly commitId: string;
  readonly subject: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorDate: string;
  readonly commitDate: string;
  readonly message: string;
  readonly stat?: string;
  readonly truncated: boolean;
}

export interface FffResultItem {
  readonly path: string;
  readonly score: number;
  readonly snippet?: string;
}

export interface FffDiscoveryResult {
  readonly items: readonly FffResultItem[];
  readonly truncated: boolean;
}
