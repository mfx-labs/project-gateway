/**
 * Schema identification (phase 3): select exactly one local schema resource from
 * approved discriminators. Producer-controlled `$schema` values, paths, labels,
 * and network sources are never used for selection.
 */
import type { SubjectClass } from '../canonical/input.js';

export const ARTIFACT_KINDS = [
  'TaskSpec',
  'AuthorityPolicy',
  'ContextManifest',
  'CompletionContract',
  'ExecutionBundle',
  'ExecutionResult',
] as const;
export type ArtifactKindId = (typeof ARTIFACT_KINDS)[number];

export const LIFECYCLE_RECORD_TYPES = [
  'ValidationRecord',
  'ApprovalRecord',
  'IssuanceRecord',
  'RevocationRecord',
  'RuntimeGrant',
  'ActivationRecord',
  'ExecutionOccurrenceRecord',
  'ExecutionAttemptRecord',
  'TrustedReceipt',
  'ResultPublicationRecord',
  'SupersessionRecord',
  'ExecutionSummaryRecord',
  'MigrationRecord',
  'AuthoritativeAuditEvent',
] as const;
export type LifecycleRecordType = (typeof LIFECYCLE_RECORD_TYPES)[number];

const KIND_SCHEMA: Record<ArtifactKindId, string> = {
  TaskSpec: 'urn:project-gateway:schema:artifact:1.0:kinds:task-spec',
  AuthorityPolicy: 'urn:project-gateway:schema:artifact:1.0:kinds:authority-policy',
  ContextManifest: 'urn:project-gateway:schema:artifact:1.0:kinds:context-manifest',
  CompletionContract: 'urn:project-gateway:schema:artifact:1.0:kinds:completion-contract',
  ExecutionBundle: 'urn:project-gateway:schema:artifact:1.0:kinds:execution-bundle',
  ExecutionResult: 'urn:project-gateway:schema:artifact:1.0:kinds:execution-result',
};

const RECORD_SCHEMA: Record<LifecycleRecordType, string> = {
  ValidationRecord: 'urn:project-gateway:schema:lifecycle:1.0:records:validation-record',
  ApprovalRecord: 'urn:project-gateway:schema:lifecycle:1.0:records:approval-record',
  IssuanceRecord: 'urn:project-gateway:schema:lifecycle:1.0:records:issuance-record',
  RevocationRecord: 'urn:project-gateway:schema:lifecycle:1.0:records:revocation-record',
  RuntimeGrant: 'urn:project-gateway:schema:lifecycle:1.0:records:runtime-grant',
  ActivationRecord: 'urn:project-gateway:schema:lifecycle:1.0:records:activation-record',
  ExecutionOccurrenceRecord: 'urn:project-gateway:schema:lifecycle:1.0:records:execution-occurrence-record',
  ExecutionAttemptRecord: 'urn:project-gateway:schema:lifecycle:1.0:records:execution-attempt-record',
  TrustedReceipt: 'urn:project-gateway:schema:lifecycle:1.0:records:trusted-receipt',
  ResultPublicationRecord: 'urn:project-gateway:schema:lifecycle:1.0:records:result-publication-record',
  SupersessionRecord: 'urn:project-gateway:schema:lifecycle:1.0:records:supersession-record',
  ExecutionSummaryRecord: 'urn:project-gateway:schema:lifecycle:1.0:records:execution-summary-record',
  MigrationRecord: 'urn:project-gateway:schema:lifecycle:1.0:records:migration-record',
  AuthoritativeAuditEvent: 'urn:project-gateway:schema:lifecycle:1.0:records:authoritative-audit-event',
};

export const REGISTRY_SNAPSHOT_SCHEMA = 'urn:project-gateway:schema:registry:1.0:registry-snapshot';
export const REGISTRY_REFERENCE_SCHEMA = 'urn:project-gateway:schema:registry:1.0:registry-snapshot-reference';
export const EXACT_REFERENCE_SCHEMA = 'urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference';

export interface SchemaSelection {
  readonly ok: boolean;
  readonly schemaId?: string;
  readonly subjectClass?: SubjectClass;
  readonly kind?: ArtifactKindId;
  readonly recordType?: LifecycleRecordType;
  readonly category?: 'UNKNOWN-SCHEMA-RESOURCE' | 'UNSUPPORTED-PROTOCOL-OR-KIND';
  readonly message?: string;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * Identify the schema for a parsed subject.
 * `hint` distinguishes registry-reference subjects from registry snapshots.
 */
export function identifySchema(model: unknown, hint: 'registry-reference' | null = null): SchemaSelection {
  const rec = asRecord(model);
  if (!rec) {
    return { ok: false, category: 'UNKNOWN-SCHEMA-RESOURCE', message: 'subject is not a JSON object' };
  }
  // Registry snapshot / reference
  const protocolId = str(rec['registry_protocol_id']);
  if (protocolId !== undefined) {
    if (protocolId !== 'project-gateway.registry') {
      return { ok: false, category: 'UNSUPPORTED-PROTOCOL-OR-KIND', message: 'unsupported registry protocol' };
    }
    if (str(rec['registry_snapshot_format_version']) !== '1.0') {
      return { ok: false, category: 'UNSUPPORTED-PROTOCOL-OR-KIND', message: 'unsupported registry format version' };
    }
    if (hint === 'registry-reference' || rec['namespace_entries'] === undefined) {
      return { ok: true, schemaId: REGISTRY_REFERENCE_SCHEMA, subjectClass: 'registry' };
    }
    return { ok: true, schemaId: REGISTRY_SNAPSHOT_SCHEMA, subjectClass: 'registry' };
  }
  // Lifecycle record
  const recordType = str(rec['record_type']);
  if (recordType !== undefined) {
    const schema = RECORD_SCHEMA[recordType as LifecycleRecordType];
    if (!schema) {
      return { ok: false, category: 'UNKNOWN-SCHEMA-RESOURCE', message: `unknown lifecycle record type: ${recordType}` };
    }
    return { ok: true, schemaId: schema, subjectClass: 'lifecycle', recordType: recordType as LifecycleRecordType };
  }
  // Artifact
  const proto = asRecord(rec['protocol']);
  const kind = asRecord(rec['kind']);
  if (proto === undefined || kind === undefined) {
    return { ok: false, category: 'UNKNOWN-SCHEMA-RESOURCE', message: 'subject lacks protocol or kind discriminator' };
  }
  if (str(proto['id']) !== 'project-gateway.artifact') {
    return { ok: false, category: 'UNKNOWN-SCHEMA-RESOURCE', message: 'unknown artifact protocol' };
  }
  if (str(proto['version']) !== '1.0' || str(proto['canonicalization']) !== 'jcs-rfc8785-v1') {
    return { ok: false, category: 'UNSUPPORTED-PROTOCOL-OR-KIND', message: 'unsupported artifact protocol version or canonicalization' };
  }
  if (str(kind['version']) !== '1.0') {
    return { ok: false, category: 'UNSUPPORTED-PROTOCOL-OR-KIND', message: 'unsupported artifact kind version' };
  }
  const kindId = str(kind['id']) as ArtifactKindId;
  const schema = KIND_SCHEMA[kindId];
  if (!schema) {
    return { ok: false, category: 'UNKNOWN-SCHEMA-RESOURCE', message: `unknown artifact kind: ${String(kind['id'])}` };
  }
  return { ok: true, schemaId: schema, subjectClass: 'artifact', kind: kindId };
}
