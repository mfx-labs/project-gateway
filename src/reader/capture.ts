/**
 * WP-7 — Hostile request capture.
 *
 * Uses the established descriptor-safe snapshot pattern from
 * `src/internal/snapshot.ts` to capture `HostileOperationRequestData`
 * before any ordinary property read. The `TrustedOperationControl` is
 * a separate trusted operand that never passes through snapshot capture.
 */
import { snapshotJson, SnapshotError } from '../internal/snapshot.js';
import { isOperationName, WP7_LIMITS, type HostileOperationRequestData, type OperationName } from './types.js';
import { errReqInvalid } from './errors.js';
import type { OperationCorrelation } from './types.js';

// Known request fields per operation
const REQUEST_FIELDS: Record<OperationName, ReadonlySet<string>> = {
  'list-directory': new Set(['operation', 'workspaceId', 'path', 'maxEntries']),
  'inspect-metadata': new Set(['operation', 'workspaceId', 'path']),
  'read-text': new Set(['operation', 'workspaceId', 'path', 'maxBytes']),
  'read-bytes': new Set(['operation', 'workspaceId', 'path', 'maxBytes']),
  'git-status': new Set(['operation', 'workspaceId']),
  'git-diff': new Set(['operation', 'workspaceId', 'pathspecs']),
  'git-log': new Set(['operation', 'workspaceId', 'maxRecords']),
  'git-show': new Set(['operation', 'workspaceId', 'commitId']),
  'fff-discover': new Set(['operation', 'workspaceId', 'query', 'maxResults']),
};

const FULL_COMMIT_ID_RE = /^[0-9a-f]{40}$/;
const ROOT_TOKEN = '.';

function validatePathField(path: unknown, correlation: OperationCorrelation): string | null {
  if (typeof path !== 'string') {
    return 'path must be a string';
  }
  // Root token must be exactly '.'
  // (the committed parser accepts '.' only; empty string is rejected)
  const buf = Buffer.from(path, 'utf8');
  if (buf.length > WP7_LIMITS.REQUEST_PATH_MAX_BYTES) {
    return 'path exceeds maximum length';
  }
  // Quick pre-check before delegating to parser — the parser is the authority
  return null; // delegate to parseWorkspaceRelativePath for full validation
}

function validateCommitId(commitId: unknown): string | null {
  if (typeof commitId !== 'string') return 'commitId must be a string';
  if (!FULL_COMMIT_ID_RE.test(commitId)) return 'commitId must be a full 40-hex lowercase SHA';
  return null;
}

function validateQuery(query: unknown): string | null {
  if (typeof query !== 'string') return 'query must be a string';
  if (query.length === 0) return 'query must be non-empty';
  const buf = Buffer.from(query, 'utf8');
  if (buf.length > WP7_LIMITS.FFF_MAX_QUERY_BYTES) return 'query exceeds maximum length';
  return null;
}

function validatePathsArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null; // optional field
  if (value.length === 0) return null;
  const paths: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const p = value[i];
    if (typeof p !== 'string') return null;
    // Reject pathspec magic
    if (p.startsWith(':(') || (p.startsWith(':') && p.length > 1 && !p.startsWith(':/'))) {
      return null; // will be caught as invalid
    }
    paths.push(p);
  }
  return paths;
}

function validateNumberField(value: unknown, max: number, field: string): number | null {
  if (value === undefined) return undefined as unknown as null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return null; // invalid
  }
  // Request may ask for less, never more
  return Math.min(value, max);
}

export interface CapturedRequest {
  readonly operation: OperationName;
  readonly workspaceId: string;
  readonly path?: string;
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly maxRecords?: number;
  readonly maxResults?: number;
  readonly commitId?: string;
  readonly query?: string;
  readonly pathspecs?: readonly string[];
}

/**
 * Capture and validate a hostile request data object.
 * Returns either the captured (frozen) validated data or an error message.
 */
export function captureRequest(
  raw: unknown,
  correlation: OperationCorrelation,
): { ok: true; data: CapturedRequest } | { ok: false; error: string } {
  // 1. Descriptor-safe snapshot
  let snapshot: unknown;
  try {
    snapshot = snapshotJson(raw, '$');
  } catch (err) {
    if (err instanceof SnapshotError) {
      return { ok: false, error: `request structure is unsupported or hostile: ${err.message}` };
    }
    return { ok: false, error: 'request descriptor introspection failed' };
  }

  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { ok: false, error: 'request must be a plain object' };
  }

  const req = snapshot as Record<string, unknown>;

  // 2. operation field
  const op = req['operation'];
  if (typeof op !== 'string' || !isOperationName(op)) {
    return { ok: false, error: 'invalid or missing operation name' };
  }
  const operation: OperationName = op;
  const allowed = REQUEST_FIELDS[operation];

  // 3. Reject unknown fields
  for (const key of Object.keys(req)) {
    if (!allowed.has(key)) {
      return { ok: false, error: `unknown field: ${key}` };
    }
  }

  // 4. workspaceId
  const workspaceId = req['workspaceId'];
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    return { ok: false, error: 'workspaceId is required and must be a non-empty string' };
  }

  // 5. Operation-specific validation — build captured object in one shot
  let path: string | undefined;
  let maxEntries: number | undefined;
  let maxBytes: number | undefined;
  let maxRecords: number | undefined;
  let maxResults: number | undefined;
  let commitId: string | undefined;
  let query: string | undefined;
  let pathspecs: readonly string[] | undefined;

  if (allowed.has('path')) {
    const pathErr = validatePathField(req['path'], correlation);
    if (pathErr) return { ok: false, error: pathErr };
    path = req['path'] as string;
  }

  if (allowed.has('maxEntries')) {
    const v = validateNumberField(req['maxEntries'], WP7_LIMITS.MAX_DIRECTORY_ENTRIES, 'maxEntries');
    if (v === null && req['maxEntries'] !== undefined) {
      return { ok: false, error: 'maxEntries must be a non-negative safe integer' };
    }
    maxEntries = (v ?? undefined) as number | undefined;
  }

  if (allowed.has('maxBytes')) {
    const v = validateNumberField(req['maxBytes'], WP7_LIMITS.READ_MAX_BYTES, 'maxBytes');
    if (v === null && req['maxBytes'] !== undefined) {
      return { ok: false, error: 'maxBytes must be a non-negative safe integer' };
    }
    maxBytes = (v ?? undefined) as number | undefined;
  }

  if (allowed.has('maxRecords')) {
    const v = validateNumberField(req['maxRecords'], WP7_LIMITS.GIT_MAX_LOG_RECORDS, 'maxRecords');
    if (v === null && req['maxRecords'] !== undefined) {
      return { ok: false, error: 'maxRecords must be a non-negative safe integer' };
    }
    maxRecords = (v ?? undefined) as number | undefined;
  }

  if (allowed.has('maxResults')) {
    const v = validateNumberField(req['maxResults'], WP7_LIMITS.FFF_MAX_RESULTS, 'maxResults');
    if (v === null && req['maxResults'] !== undefined) {
      return { ok: false, error: 'maxResults must be a non-negative safe integer' };
    }
    maxResults = (v ?? undefined) as number | undefined;
  }

  if (allowed.has('commitId')) {
    const err = validateCommitId(req['commitId']);
    if (err) return { ok: false, error: err };
    commitId = req['commitId'] as string;
  }

  if (allowed.has('query')) {
    const err = validateQuery(req['query']);
    if (err) return { ok: false, error: err };
    query = req['query'] as string;
  }

  if (allowed.has('pathspecs')) {
    const paths = validatePathsArray(req['pathspecs']);
    if (paths === null && req['pathspecs'] !== undefined) {
      return { ok: false, error: 'pathspecs must be an array of strings' };
    }
    pathspecs = paths as readonly string[] | undefined;
  }

  const captured: CapturedRequest = {
    operation,
    workspaceId,
    ...(path !== undefined ? { path } : {}),
    ...(maxEntries !== undefined ? { maxEntries } : {}),
    ...(maxBytes !== undefined ? { maxBytes } : {}),
    ...(maxRecords !== undefined ? { maxRecords } : {}),
    ...(maxResults !== undefined ? { maxResults } : {}),
    ...(commitId !== undefined ? { commitId } : {}),
    ...(query !== undefined ? { query } : {}),
    ...(pathspecs !== undefined ? { pathspecs } : {}),
  };

  return { ok: true, data: captured };
}

/**
 * Full request validation wrapper: runs snapshot capture, then returns
 * structured result.
 */
export function validateAndCaptureRequest(
  raw: unknown,
  correlation: OperationCorrelation,
): { ok: true; data: CapturedRequest } | { ok: false; failure: ReturnType<typeof errReqInvalid> } {
  const result = captureRequest(raw, correlation);
  if (!result.ok) {
    return { ok: false, failure: errReqInvalid(result.error, correlation) };
  }
  return { ok: true, data: result.data };
}
