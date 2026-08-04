/**
 * Normative validation phases and stable failure categories (WP-3 structural profile).
 * The phase ordering is the single source of truth for pipeline execution.
 */

export const PHASE_ORDER = [
  'raw-json-intake',
  'canonical-input-validation',
  'schema-identification',
  'structural-schema-validation',
  'canonicalization-and-digest-verification',
  'identity-registration',
  'semantic-self-validation',
  'exact-reference-resolution',
  'cross-artifact-compatibility',
  'registry-compatibility',
  'semantic-registry-validation',
  'trusted-lifecycle-verification',
  'consumer-support-verification',
  'point-of-use-eligibility',
] as const;

export type ValidationPhase = (typeof PHASE_ORDER)[number];

export const PHASE_INDEX: Readonly<Record<ValidationPhase, number>> = Object.fromEntries(
  PHASE_ORDER.map((p, i) => [p, i]),
) as Record<ValidationPhase, number>;

/** Stable failure categories (WP-3 structural profile failure model). */
export const CATEGORIES = [
  'RAW-PARSE-FAILURE',
  'DUPLICATE-MEMBER',
  'INVALID-UNICODE',
  'NON-NFC-STRING',
  'UNSAFE-INTEGER',
  'AMBIGUOUS-VALUE',
  'RESOURCE-LIMIT',
  'UNKNOWN-SCHEMA-RESOURCE',
  'UNSUPPORTED-PROTOCOL-OR-KIND',
  'STRUCTURAL-SCHEMA-FAILURE',
  'CANONICAL-ORDER-FAILURE',
  'CANONICALIZATION-FAILURE',
  'DIGEST-MISMATCH',
  'IDENTITY-CONFLICT',
  'LINEAGE-FAILURE',
  'EXACT-REFERENCE-FAILURE',
  'WORKSPACE-FAILURE',
  'AGGREGATE-RESPONSIBILITY-FAILURE',
  'REGISTRY-INCOMPATIBILITY',
  'LIFECYCLE-FAILURE',
  'ACTIVATION-FAILURE',
  'RESULT-PUBLICATION-FAILURE',
  'RECEIPT-CORRELATION-FAILURE',
  'CONSUMER-SUPPORT-FAILURE',
  'POINT-OF-USE-FAILURE',
] as const;

export type FailureCategory = (typeof CATEGORIES)[number];

/** WP-3 resource bounds (bytes). */
export const INPUT_BYTE_LIMITS = {
  artifact: 1 * 1024 * 1024,
  registry: 512 * 1024,
  lifecycle: 256 * 1024,
  reference: 256 * 1024,
  generic: 1 * 1024 * 1024,
} as const;

export const MAX_NESTING_DEPTH = 32;
