/**
 * WP-9 MCP inspection surface — strict request validation and cursor
 * codec (slice 1). Closed-field validation only: unknown fields, wrong
 * types, unsupported values, malformed logical identifiers, and oversized
 * operands are rejected with deterministic public errors. Caller input is
 * never coerced. Pure: no filesystem, no authority, no clock.
 */
import { isAcceptedRecordClass } from '../../storage/format/taxonomy.js';
import { isCanonicalTypedIdentifier } from '../../storage/format/identifier.js';
import { isHistoryTargetClass } from '../../storage/read/history.js';
import { MCP_INSPECTION_TOOLS, type McpErrorCode, type McpInspectionRequest } from './types.js';

/** Bounded opaque continuation encoding (base64url of JSON; domain cursor semantics preserved). */
export const CURSOR_MAX_ENCODED_BYTES = 4096;
/** Bounded artifact content operand (WP-4 artifact input byte limit). */
export const ARTIFACT_CONTENT_MAX_BYTES = 1024 * 1024;
/** Bounded request correlation id. */
export const REQUEST_ID_MAX_LENGTH = 128;

export interface ValidationIssue {
  readonly code: McpErrorCode;
  readonly message: string;
}

/** Decode an opaque continuation string into the domain cursor object (shape-only; the domain re-validates semantics). */
export function decodeContinuation(raw: string): { readonly ok: true; readonly cursor: unknown } | { readonly ok: false; readonly issue: ValidationIssue } {
  if (raw.length === 0 || raw.length > CURSOR_MAX_ENCODED_BYTES) {
    return { ok: false, issue: { code: 'invalid-cursor', message: 'continuation is empty or exceeds the encoded size bound' } };
  }
  let json: string;
  try {
    json = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return { ok: false, issue: { code: 'invalid-cursor', message: 'continuation is not a valid opaque encoding' } };
  }
  if (json.length === 0 || json.length > CURSOR_MAX_ENCODED_BYTES * 2) {
    return { ok: false, issue: { code: 'invalid-cursor', message: 'continuation payload is outside the size bound' } };
  }
  let cursor: unknown;
  try {
    cursor = JSON.parse(json);
  } catch {
    return { ok: false, issue: { code: 'invalid-cursor', message: 'continuation payload is not valid JSON' } };
  }
  if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) {
    return { ok: false, issue: { code: 'invalid-cursor', message: 'continuation payload must be a cursor object' } };
  }
  return { ok: true, cursor };
}

/** Encode a domain cursor object into the opaque MCP encoding. */
export function encodeContinuation(cursor: unknown): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Strictly validate the outer request envelope (tool + requestId). */
export function validateEnvelope(request: unknown): { readonly ok: true; readonly tool: string; readonly params: unknown; readonly requestId?: string } | { readonly ok: false; readonly issue: ValidationIssue } {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    return { ok: false, issue: { code: 'invalid-request', message: 'request must be an object' } };
  }
  const r = request as Readonly<Record<string, unknown>>;
  const keys = Object.keys(r);
  for (const key of keys) {
    if (key !== 'tool' && key !== 'params' && key !== 'requestId') {
      return { ok: false, issue: { code: 'invalid-request', message: `unknown request field: ${key}` } };
    }
  }
  if (typeof r['tool'] !== 'string' || r['tool'].length === 0 || r['tool'].length > 64) {
    return { ok: false, issue: { code: 'invalid-request', message: 'tool must be a non-empty string within the size bound' } };
  }
  if (!MCP_INSPECTION_TOOLS.includes(r['tool'] as never)) {
    return { ok: false, issue: { code: 'invalid-request', message: 'tool is outside the closed inspection vocabulary' } };
  }
  if (!('params' in r)) {
    return { ok: false, issue: { code: 'invalid-request', message: 'params is required' } };
  }
  const params = r['params'];
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { ok: false, issue: { code: 'invalid-request', message: 'params must be an object' } };
  }
  let requestId: string | undefined;
  if (r['requestId'] !== undefined) {
    if (typeof r['requestId'] !== 'string' || r['requestId'].length === 0 || r['requestId'].length > REQUEST_ID_MAX_LENGTH) {
      return { ok: false, issue: { code: 'invalid-request', message: 'requestId must be a bounded non-empty string' } };
    }
    requestId = r['requestId'];
  }
  return { ok: true, tool: r['tool'], params, requestId };
}

function rejectUnknownFields(params: Readonly<Record<string, unknown>>, allowed: readonly string[]): ValidationIssue | undefined {
  for (const key of Object.keys(params)) {
    if (!allowed.includes(key)) {
      return { code: 'invalid-request', message: `unknown parameter field: ${key}` };
    }
  }
  return undefined;
}

function requireString(params: Readonly<Record<string, unknown>>, field: string, maxLength: number): ValidationIssue | undefined {
  const value = params[field];
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    return { code: 'invalid-request', message: `${field} must be a non-empty string within the size bound` };
  }
  return undefined;
}

/** Validate `validate-artifact` params: `{ content: string }` (closed; bounded). */
export function validateArtifactParams(params: Readonly<Record<string, unknown>>): { readonly ok: true; readonly value: { readonly content: string } } | { readonly ok: false; readonly issue: ValidationIssue } {
  const unknown = rejectUnknownFields(params, ['content']);
  if (unknown !== undefined) return { ok: false, issue: unknown };
  const content = params['content'];
  if (typeof content !== 'string' || content.length === 0) {
    return { ok: false, issue: { code: 'invalid-request', message: 'content must be a non-empty string' } };
  }
  if (Buffer.byteLength(content, 'utf8') > ARTIFACT_CONTENT_MAX_BYTES) {
    return { ok: false, issue: { code: 'limit-exceeded', message: 'content exceeds the artifact input byte bound' } };
  }
  return { ok: true, value: { content } };
}

/** Validate `inspect-stored-record` params: `{ recordClass, recordId }` (logical identifiers only). */
export function validateStoredRecordParams(params: Readonly<Record<string, unknown>>): { readonly ok: true; readonly value: { readonly recordClass: string; readonly recordId: string } } | { readonly ok: false; readonly issue: ValidationIssue } {
  const unknown = rejectUnknownFields(params, ['recordClass', 'recordId']);
  if (unknown !== undefined) return { ok: false, issue: unknown };
  const recordClass = params['recordClass'];
  if (typeof recordClass !== 'string' || recordClass.length === 0 || recordClass.length > 64) {
    return { ok: false, issue: { code: 'invalid-request', message: 'recordClass must be a non-empty string within the size bound' } };
  }
  if (!isAcceptedRecordClass(recordClass)) {
    return { ok: false, issue: { code: 'invalid-request', message: 'recordClass is outside the closed accepted record-class vocabulary' } };
  }
  const recordId = params['recordId'];
  if (typeof recordId !== 'string' || recordId.length === 0 || recordId.length > 128) {
    return { ok: false, issue: { code: 'invalid-request', message: 'recordId must be a non-empty string within the size bound' } };
  }
  if (!isCanonicalTypedIdentifier(recordId)) {
    return { ok: false, issue: { code: 'invalid-request', message: 'recordId is not a canonical typed identifier' } };
  }
  return { ok: true, value: { recordClass, recordId } };
}

/** Validate `inspect-registry` params: `{ continuation?, usePersistentIndex? }` (closed; bounded). */
export function validateRegistryParams(params: Readonly<Record<string, unknown>>): { readonly ok: true; readonly value: { readonly continuation?: string; readonly usePersistentIndex: boolean } } | { readonly ok: false; readonly issue: ValidationIssue } {
  const unknown = rejectUnknownFields(params, ['continuation', 'usePersistentIndex']);
  if (unknown !== undefined) return { ok: false, issue: unknown };
  let continuation: string | undefined;
  if (params['continuation'] !== undefined) {
    const raw = params['continuation'];
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > CURSOR_MAX_ENCODED_BYTES) {
      return { ok: false, issue: { code: 'invalid-cursor', message: 'continuation must be a bounded opaque string' } };
    }
    continuation = raw;
  }
  let usePersistentIndex = false;
  if (params['usePersistentIndex'] !== undefined) {
    const flag = params['usePersistentIndex'];
    if (typeof flag !== 'boolean') {
      return { ok: false, issue: { code: 'invalid-request', message: 'usePersistentIndex must be a boolean' } };
    }
    usePersistentIndex = flag;
  }
  return { ok: true, value: { ...(continuation !== undefined ? { continuation } : {}), usePersistentIndex } };
}

/** Validate `inspect-audit-history` params: `{ recordClass, recordId, revision?, continuation? }` (logical identifiers only; WP-8K target vocabulary). */
export function validateAuditHistoryParams(params: Readonly<Record<string, unknown>>): { readonly ok: true; readonly value: { readonly recordClass: string; readonly recordId: string; readonly revision?: number; readonly continuation?: string } } | { readonly ok: false; readonly issue: ValidationIssue } {
  const unknown = rejectUnknownFields(params, ['recordClass', 'recordId', 'revision', 'continuation']);
  if (unknown !== undefined) return { ok: false, issue: unknown };
  const recordClass = params['recordClass'];
  if (typeof recordClass !== 'string' || recordClass.length === 0 || recordClass.length > 64) {
    return { ok: false, issue: { code: 'invalid-request', message: 'recordClass must be a non-empty string within the size bound' } };
  }
  // WP-8K defines the exact inspected class vocabulary (13.4): store-records
  // classes excluding the audit class and bootstrap metadata. Internal and
  // non-history targets are rejected; cross-class substitution fails here.
  if (!isHistoryTargetClass(recordClass as never)) {
    return { ok: false, issue: { code: 'invalid-request', message: 'recordClass is outside the WP-8K inspected history vocabulary' } };
  }
  const recordId = params['recordId'];
  if (typeof recordId !== 'string' || recordId.length === 0 || recordId.length > 128) {
    return { ok: false, issue: { code: 'invalid-request', message: 'recordId must be a non-empty string within the size bound' } };
  }
  if (!isCanonicalTypedIdentifier(recordId)) {
    return { ok: false, issue: { code: 'invalid-request', message: 'recordId is not a canonical typed identifier' } };
  }
  let revision: number | undefined;
  if (params['revision'] !== undefined) {
    const raw = params['revision'];
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) {
      return { ok: false, issue: { code: 'invalid-request', message: 'revision must be a positive safe integer' } };
    }
    revision = raw;
  }
  let continuation: string | undefined;
  if (params['continuation'] !== undefined) {
    const raw = params['continuation'];
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > CURSOR_MAX_ENCODED_BYTES) {
      return { ok: false, issue: { code: 'invalid-cursor', message: 'continuation must be a bounded opaque string' } };
    }
    continuation = raw;
  }
  return { ok: true, value: { recordClass, recordId, ...(revision !== undefined ? { revision } : {}), ...(continuation !== undefined ? { continuation } : {}) } };
}

/** Per-tool param validation dispatch (closed). */
export function validateToolParams(tool: string, params: unknown): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly issue: ValidationIssue } {
  const record = params as Readonly<Record<string, unknown>>;
  switch (tool) {
    case 'validate-artifact':
    case 'inspect-stored-record':
    case 'inspect-registry':
    case 'inspect-audit-history':
      return validateToolSpecific(tool, record);
    default:
      return { ok: false, issue: { code: 'invalid-request', message: 'tool is outside the closed inspection vocabulary' } };
  }
}

function validateToolSpecific(tool: string, record: Readonly<Record<string, unknown>>): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly issue: ValidationIssue } {
  switch (tool) {
    case 'validate-artifact':
      return validateArtifactParams(record);
    case 'inspect-stored-record':
      return validateStoredRecordParams(record);
    case 'inspect-registry':
      return validateRegistryParams(record);
    case 'inspect-audit-history':
      return validateAuditHistoryParams(record);
    default:
      return { ok: false, issue: { code: 'invalid-request', message: 'tool is outside the closed inspection vocabulary' } };
  }
}

/** Envelope-level validation entry (used by the dispatch boundary). */
export function validateInspectionRequest(request: unknown): { readonly ok: true; readonly request: McpInspectionRequest } | { readonly ok: false; readonly issue: ValidationIssue } {
  const envelope = validateEnvelope(request);
  if (!envelope.ok) return envelope;
  return { ok: true, request: { tool: envelope.tool, params: envelope.params, ...(envelope.requestId !== undefined ? { requestId: envelope.requestId } : {}) } };
}
