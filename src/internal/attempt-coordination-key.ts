/**
 * WP-13 durability S3 — shared exact attempt coordination key.
 *
 * ONE pure key derivation shared byte-for-byte by the outcome-recording
 * operation and the WP-13C publication boundary (ADR-039 decision 4; WP-13
 * durability decision §9). The key material is EXACTLY:
 *
 *   workspace | bundle instance | bundle revision | bundle digest |
 *   occurrence | attempt
 *
 * Explicitly EXCLUDED from the key: result instance, result revision/digest,
 * disposition, observation evidence id, observation digest, enforcement
 * evidence, ValidationRecord id, lifecycle record id, created_at.
 *
 * Both domains acquire the SAME attempt-level coordination lock key (Model-1:
 * the outcome operation acquires/releases completely, then WP-13C acquires
 * the same key independently — no nested/reentrant acquisition). This module
 * is the single pinned derivation so the two domains can never drift into
 * two independently formatted "equivalent" keys.
 *
 * Pure module: no I/O, no persistence, no authority.
 */
export interface AttemptCoordinationKeyInput {
  readonly workspaceId: string;
  readonly bundleInstanceId: string;
  readonly bundleRevisionId: string;
  readonly bundleDigest: string;
  readonly occurrenceId: string;
  readonly attemptId: string;
}

/** The exact shared attempt coordination key string (byte-for-byte pinned). */
export function attemptCoordinationKey(input: AttemptCoordinationKeyInput): string {
  return [
    input.workspaceId,
    input.bundleInstanceId,
    input.bundleRevisionId,
    input.bundleDigest,
    input.occurrenceId,
    input.attemptId,
  ].join('|');
}
