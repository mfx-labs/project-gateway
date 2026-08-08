/**
 * WP-12 Slice 1 — accepted WP-4 validation evidence correlation.
 *
 * `recordValidation` consumes an ACCEPTED WP-4 validation run through the
 * host-injected trusted context only. This module verifies the evidence
 * form and correlates it with the exact canonical subject. WP-12 performs
 * NO independent validation, NO second canonicalizer, and NO parallel
 * report format: the accepted WP-4 pipeline (`validateArtifactRevision`)
 * produced the report and the branded `ValidatedArtifact`; every recorded
 * ValidationRecord field derives exclusively from that result
 * (SCR-W12-004). A WP-4 denial is never converted into success.
 *
 * Pure module: no I/O, no persistence, no authority.
 */
import { isLevelAtLeast } from '../api/validate.js';
import { isBrandedArtifact } from '../internal/snapshot.js';
import type { AcceptedValidationEvidence, CanonicalSubject } from './types.js';
import { ARTIFACT_PROTOCOL_ID, ARTIFACT_PROTOCOL_VERSION } from './types.js';

export type EvidenceRejectReason =
  | 'not-record'
  | 'report-not-ok'
  | 'report-findings'
  | 'artifact-not-branded'
  | 'artifact-level'
  | 'protocol-mismatch'
  | 'kind-mismatch'
  | 'instance-mismatch'
  | 'revision-mismatch'
  | 'digest-mismatch'
  | 'workspace-mismatch';

export type EvidenceCorrelationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: EvidenceRejectReason };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Verify the host-injected evidence form. The report must be the accepted
 * WP-4 report shape with ok:true and no findings; the artifact must be a
 * branded ValidatedArtifact at least at the accepted self-semantic level.
 * Form failures are `request-invalid` (FSCR-W12-002); a well-formed but
 * failed WP-4 result is reported as `subject-not-validated` by the caller.
 */
export function validateEvidenceForm(
  evidence: unknown,
): { readonly ok: true; readonly evidence: AcceptedValidationEvidence } | { readonly ok: false; readonly reason: 'not-record' | 'report-not-ok' | 'report-findings' | 'artifact-not-branded' | 'artifact-level' } {
  if (!isRecord(evidence)) return { ok: false, reason: 'not-record' };
  const report = evidence['report'];
  const artifact = evidence['artifact'];
  if (!isRecord(report)) return { ok: false, reason: 'not-record' };
  if (report['ok'] !== true) return { ok: false, reason: 'report-not-ok' };
  const findings = report['findings'];
  if (!Array.isArray(findings) || findings.length !== 0) return { ok: false, reason: 'report-findings' };
  if (!isRecord(artifact)) return { ok: false, reason: 'not-record' };
  if (!isBrandedArtifact(artifact)) return { ok: false, reason: 'artifact-not-branded' };
  const level = artifact['level'];
  if (typeof level !== 'string' || !isLevelAtLeast(level as never, 'self-semantic-valid')) {
    return { ok: false, reason: 'artifact-level' };
  }
  return {
    ok: true,
    evidence: Object.freeze({
      report: Object.freeze({ ...report }) as unknown as AcceptedValidationEvidence['report'],
      artifact: artifact as unknown as AcceptedValidationEvidence['artifact'],
    }),
  };
}

/** Correlation of the accepted WP-4 run with the exact canonical subject. */
export function correlateValidationEvidence(
  evidence: AcceptedValidationEvidence,
  subject: CanonicalSubject,
): EvidenceCorrelationResult {
  const artifact = evidence.artifact;
  const model = artifact.model as Readonly<Record<string, unknown>>;
  const protocol = model['protocol'];
  const protocolId = isRecord(protocol) ? protocol['id'] : undefined;
  const protocolVersion = isRecord(protocol) ? protocol['version'] : undefined;
  if (protocolId !== ARTIFACT_PROTOCOL_ID || protocolVersion !== ARTIFACT_PROTOCOL_VERSION) {
    return { ok: false, reason: 'protocol-mismatch' };
  }
  const kind = model['kind'];
  const kindId = isRecord(kind) ? kind['id'] : undefined;
  const kindVersion = isRecord(kind) ? kind['version'] : undefined;
  if (kindId !== subject.kindId || kindVersion !== subject.kindVersion) {
    return { ok: false, reason: 'kind-mismatch' };
  }
  if (artifact.instanceId !== subject.instanceId) return { ok: false, reason: 'instance-mismatch' };
  if (artifact.revisionId !== subject.revisionId) return { ok: false, reason: 'revision-mismatch' };
  if (artifact.digest !== subject.digest) return { ok: false, reason: 'digest-mismatch' };
  const binding = model['workspace_binding'];
  if (isRecord(binding) && binding['mode'] === 'bound') {
    const boundWorkspace = binding['workspace_id'];
    if (typeof boundWorkspace === 'string' && boundWorkspace !== subject.workspaceId) {
      return { ok: false, reason: 'workspace-mismatch' };
    }
  }
  return { ok: true };
}
