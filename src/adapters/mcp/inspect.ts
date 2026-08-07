/**
 * WP-9 MCP inspection surface — dispatch and deterministic public
 * response mapping (slice 1).
 *
 * ARCHITECTURE (the adapter rule): MCP request → strict adapter
 * validation → existing domain/read/validation API → deterministic
 * public response mapping. This module imports NO filesystem API and NO
 * mutation authority: the only domain imports are the read-only WP-4
 * validation entry, the WP-8 exact-read entry, and the WP-8 authoritative
 * registry-view entry. Every request re-runs the domain's own store
 * revalidation (point-of-use discipline stays in the domain).
 *
 * Error mapping preserves the closed public taxonomy; fail-closed
 * integrity conditions are NEVER converted to empty success, not-found,
 * or partial success. Results are plain frozen data; no capability,
 * provenance, path, descriptor, or trusted-input internals are exposed.
 */
import { validateArtifactInput } from '../../api/validate.js';
import { readRecord, inspectAuditHistory } from '../../storage/read/index.js';
import { deriveRegistryView } from '../../storage/registry/compose.js';
import { decodeContinuation, encodeContinuation, validateInspectionRequest, validateToolParams } from './validate.js';
import type { McpErrorCode, McpInspectionContext, McpInspectionRequest, McpInspectionResponse, McpInspectionSurface, McpToolDescriptor } from './types.js';

/** Deep-frozen plain-data response values (immutable copy on return). */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function errorResponse(code: McpErrorCode, message: string, requestId?: string): McpInspectionResponse {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message, ...(requestId !== undefined ? { requestId } : {}) }) });
}

function okResponse(result: Readonly<Record<string, unknown>>, requestId?: string): McpInspectionResponse {
  return Object.freeze({ ok: true, result: deepFreeze(result), ...(requestId !== undefined ? { requestId } : {}) });
}

/** Closed mapping from the domain error vocabulary to the public taxonomy. */
export function mapDomainError(code: string | undefined, hadContinuation: boolean): { readonly code: McpErrorCode; readonly message: string } {
  switch (code) {
    case 'ERR-STO-NOT-FOUND':
      return { code: 'not-found', message: 'the requested object is not present in the verified store' };
    case 'ERR-STO-LIMIT-EXCEEDED':
      return { code: 'limit-exceeded', message: 'the operation exceeded a configured bound' };
    case 'ERR-STO-UNSUPPORTED-VERSION':
      return { code: 'unsupported', message: 'the object uses an unsupported version' };
    case 'ERR-STO-ROOT-IDENTITY-CHANGED':
      return hadContinuation
        ? { code: 'stale-cursor', message: 'the store snapshot changed since the continuation was issued' }
        : { code: 'integrity-conflict', message: 'the verified store identity changed; inspection fails closed' };
    case 'ERR-STO-MALFORMED':
    case 'ERR-STO-INTEGRITY':
    case 'ERR-STO-FTYPE-UNSUPPORTED':
      return { code: 'integrity-conflict', message: 'stored content failed verification; nothing is returned as verified data' };
    case 'ERR-STO-REQ-INVALID':
      return hadContinuation
        ? { code: 'invalid-cursor', message: 'the continuation is not valid for this query' }
        : { code: 'invalid-request', message: 'the request is not valid for the verified store' };
    case 'ERR-STO-CONFIG-UNAVAILABLE':
    case 'ERR-STO-IO-FAILURE':
    case 'ERR-STO-INTERNAL-INVARIANT':
    case 'ERR-STO-PERM-DENIED':
    case 'ERR-STO-FS-UNSUPPORTED':
    default:
      // Fixed message: internal details are never exposed to MCP clients.
      return { code: 'adapter-error', message: 'the inspection could not be completed; no internal details are exposed' };
  }
}

function findingOf(f: { readonly code: string; readonly message: string }): { readonly code: string; readonly message: string } {
  return { code: f.code, message: f.message };
}

function mapValidationReport(report: { readonly ok: boolean; readonly firstFailingPhase?: string; readonly category?: string; readonly schemaId?: string; readonly subjectIdentity?: string; readonly ruleIds: readonly string[]; readonly level?: string; readonly findings: readonly unknown[] }, value: unknown): Readonly<Record<string, unknown>> {
  const findings = (report.findings as ReadonlyArray<Readonly<Record<string, unknown>>>).map((f) => ({
    phase: f['phase'],
    category: f['category'],
    ruleIds: f['ruleIds'],
    ...(f['schemaId'] !== undefined ? { schemaId: f['schemaId'] } : {}),
    ...(f['subjectIdentity'] !== undefined ? { subjectIdentity: f['subjectIdentity'] } : {}),
    ...(f['location'] !== undefined ? { location: f['location'] } : {}),
    messageKey: f['messageKey'],
  }));
  const validated = value as { readonly kind?: string; readonly instanceId?: string; readonly revisionId?: string; readonly digest?: string } | undefined;
  return {
    valid: report.ok,
    ...(report.firstFailingPhase !== undefined ? { firstFailingPhase: report.firstFailingPhase } : {}),
    ...(report.category !== undefined ? { category: report.category } : {}),
    ...(report.schemaId !== undefined ? { schemaId: report.schemaId } : {}),
    ...(report.subjectIdentity !== undefined ? { subjectIdentity: report.subjectIdentity } : {}),
    ...(report.level !== undefined ? { level: report.level } : {}),
    ...(validated !== undefined && validated.kind !== undefined ? { kind: validated.kind } : {}),
    ...(validated !== undefined && validated.instanceId !== undefined ? { instanceId: validated.instanceId } : {}),
    ...(validated !== undefined && validated.revisionId !== undefined ? { revisionId: validated.revisionId } : {}),
    ...(validated !== undefined && validated.digest !== undefined ? { digest: validated.digest } : {}),
    ruleIds: [...report.ruleIds],
    findings,
  };
}

function runValidateArtifact(context: McpInspectionContext, content: string, requestId?: string): McpInspectionResponse {
  const report = validateArtifactInput(content, context.schemaRegistry);
  return okResponse(mapValidationReport(report, report.value), requestId);
}

function runInspectStoredRecord(context: McpInspectionContext, recordClass: string, recordId: string, requestId?: string): McpInspectionResponse {
  const result = readRecord({
    trustedConfiguration: context.trustedConfiguration,
    trustedInput: context.trustedInput,
    recordClass: recordClass as never,
    recordId,
  });
  if (!result.ok || result.record === undefined) {
    const mapped = mapDomainError(result.findings?.[0]?.code, false);
    return errorResponse(mapped.code, mapped.message, requestId);
  }
  return okResponse(
    {
      recordId: result.record['recordId'],
      recordClass,
      digest: result.digest,
      byteLength: result.byteLength,
      record: result.record,
    },
    requestId,
  );
}

function runInspectRegistry(context: McpInspectionContext, continuation: string | undefined, usePersistentIndex: boolean, requestId?: string): McpInspectionResponse {
  let domainContinuation: unknown;
  if (continuation !== undefined) {
    const decoded = decodeContinuation(continuation);
    if (!decoded.ok) {
      return errorResponse(decoded.issue.code, decoded.issue.message, requestId);
    }
    domainContinuation = decoded.cursor;
  }
  const result = deriveRegistryView({
    trustedConfiguration: context.trustedConfiguration,
    trustedInput: context.trustedInput,
    ...(domainContinuation !== undefined ? { continuation: domainContinuation as never } : {}),
    ...(usePersistentIndex ? { usePersistentIndex: true } : {}),
  });
  if (!result.ok || result.view === undefined) {
    const mapped = mapDomainError(result.findings?.[0]?.code, continuation !== undefined);
    return errorResponse(mapped.code, mapped.message, requestId);
  }
  const view = result.view;
  const mapped = {
    source: { ...view.source },
    recordsByClass: view.recordsByClass,
    recordsByIdentity: view.recordsByIdentity,
    latestResolvableRevision: view.latestResolvableRevision,
    duplicateConflicts: view.duplicateConflicts,
    auditByPrimary: view.auditByPrimary,
    missingAudit: view.missingAudit,
    danglingAudit: view.danglingAudit,
    findings: view.findings.map(findingOf),
    ...(result.continuation !== undefined ? { continuation: encodeContinuation(result.continuation) } : {}),
    ...(result.indexState !== undefined ? { indexState: result.indexState } : {}),
    ...(result.findings !== undefined && result.findings.length > 0 ? { resultFindings: result.findings.map(findingOf) } : {}),
  };
  return okResponse(mapped, requestId);
}

function runInspectAuditHistory(context: McpInspectionContext, recordClass: string, recordId: string, revision: number | undefined, continuation: string | undefined, requestId?: string): McpInspectionResponse {
  let domainContinuation: unknown;
  if (continuation !== undefined) {
    const decoded = decodeContinuation(continuation);
    if (!decoded.ok) {
      return errorResponse(decoded.issue.code, decoded.issue.message, requestId);
    }
    domainContinuation = decoded.cursor;
  }
  const result = inspectAuditHistory({
    trustedConfiguration: context.trustedConfiguration,
    trustedInput: context.trustedInput,
    recordClass: recordClass as never,
    recordId,
    ...(revision !== undefined ? { revision } : {}),
    ...(domainContinuation !== undefined ? { continuation: domainContinuation as never } : {}),
  });
  if (!result.ok) {
    // History-boundary failures only: genuine target absence is NOT a
    // history gap (gaps are status/findings inside ok results). Cursor
    // semantics are preserved: cursor-bound failures map through the
    // committed taxonomy with the continuation flag.
    const mapped = mapDomainError(result.findings?.[0]?.code, continuation !== undefined);
    return errorResponse(mapped.code, mapped.message, requestId);
  }
  const mapped = {
    ...(result.target !== undefined ? { target: result.target } : {}),
    ...(result.status !== undefined ? { status: result.status } : {}),
    ...(result.originalAuthorizedWrite !== undefined ? { originalAuthorizedWrite: result.originalAuthorizedWrite } : {}),
    ...(result.reconstruction !== undefined ? { reconstruction: result.reconstruction } : {}),
    ...(result.events !== undefined ? { events: result.events } : {}),
    ...(result.auditFindings !== undefined ? { auditFindings: result.auditFindings } : {}),
    ...(result.reconstructionEvidence !== undefined ? { reconstructionEvidence: result.reconstructionEvidence } : {}),
    ...(result.completeness !== undefined ? { completeness: result.completeness } : {}),
    ...(result.snapshot !== undefined ? { snapshot: result.snapshot } : {}),
    ...(result.continuation !== undefined ? { continuation: encodeContinuation(result.continuation) } : {}),
    ...(result.findings.length > 0 ? { findings: result.findings.map(findingOf) } : {}),
  };
  return okResponse(mapped, requestId);
}

/** Dispatch one validated inspection request to the domain. */
export function dispatchInspection(context: McpInspectionContext, request: McpInspectionRequest): McpInspectionResponse {
  const requestId = request.requestId;
  switch (request.tool) {
    case 'validate-artifact': {
      const validated = validateToolParams(request.tool, request.params);
      if (!validated.ok) return errorResponse(validated.issue.code, validated.issue.message, requestId);
      return runValidateArtifact(context, (validated.value as { readonly content: string }).content, requestId);
    }
    case 'inspect-stored-record': {
      const validated = validateToolParams(request.tool, request.params);
      if (!validated.ok) return errorResponse(validated.issue.code, validated.issue.message, requestId);
      const value = validated.value as { readonly recordClass: string; readonly recordId: string };
      return runInspectStoredRecord(context, value.recordClass, value.recordId, requestId);
    }
    case 'inspect-registry': {
      const validated = validateToolParams(request.tool, request.params);
      if (!validated.ok) return errorResponse(validated.issue.code, validated.issue.message, requestId);
      const value = validated.value as { readonly continuation?: string; readonly usePersistentIndex: boolean };
      return runInspectRegistry(context, value.continuation, value.usePersistentIndex, requestId);
    }
    case 'inspect-audit-history': {
      const validated = validateToolParams(request.tool, request.params);
      if (!validated.ok) return errorResponse(validated.issue.code, validated.issue.message, requestId);
      const value = validated.value as { readonly recordClass: string; readonly recordId: string; readonly revision?: number; readonly continuation?: string };
      return runInspectAuditHistory(context, value.recordClass, value.recordId, value.revision, value.continuation, requestId);
    }
    default:
      return errorResponse('invalid-request', 'tool is outside the closed inspection vocabulary', requestId);
  }
}

const TOOL_DESCRIPTORS: readonly McpToolDescriptor[] = Object.freeze([
  Object.freeze({
    name: 'validate-artifact',
    description: 'Validate supplied artifact content through the pure WP-4 validation pipeline. Answers valid/invalid, artifact kind, schema and rule identifiers, and bounded diagnostics. Never implies stored, approved, issued, active, or authorized.',
    params: Object.freeze(['content']),
    readOnly: true,
  }),
  Object.freeze({
    name: 'inspect-stored-record',
    description: 'Inspect one exact verified stored record by logical class and canonical typed identity. Returns only verified public facts (envelope model, digest, byte length); malformed or conflicting stored content is never returned as verified data.',
    params: Object.freeze(['recordClass', 'recordId']),
    readOnly: true,
  }),
  Object.freeze({
    name: 'inspect-registry',
    description: 'Authoritative read-only registry view through the WP-8 registry derivation. Optional verified persistent-index fast path with automatic authoritative fallback; opaque self-validating continuation preserves bounded paging.',
    params: Object.freeze(['continuation', 'usePersistentIndex']),
    readOnly: true,
  }),
  Object.freeze({
    name: 'inspect-audit-history',
    description: 'Bounded read-only audit-history inspection for one exact store record through the WP-8K history API. Preserves normative event ordering, snapshot-bound continuation, status/completeness, reconstruction and event-without-evidence findings exactly as the domain reports them. Never a reconstruction authority.',
    params: Object.freeze(['recordClass', 'recordId', 'revision', 'continuation']),
    readOnly: true,
  }),
]);

/** Create the inspection surface bound to one verified store. */
export function createMcpInspectionSurface(context: McpInspectionContext): McpInspectionSurface {
  const surface: McpInspectionSurface = {
    inspect(request: unknown): McpInspectionResponse {
      const envelope = validateInspectionRequest(request);
      if (!envelope.ok) {
        return errorResponse(envelope.issue.code, envelope.issue.message, (request as { readonly requestId?: string } | null)?.requestId);
      }
      return dispatchInspection(context, envelope.request);
    },
    tools: TOOL_DESCRIPTORS,
  };
  return Object.freeze({ inspect: surface.inspect, tools: surface.tools });
}
