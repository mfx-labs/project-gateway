/**
 * Deterministic error precedence and classification (contract 18.2,
 * ERM-007/011/014; DTM-004).
 *
 * Implements the normative precedence chain and the malformed-versus-
 * unsupported-version and duplicate/conflict classification rules. Pure and
 * deterministic: identical inputs produce identical selections.
 */
import type { StorageFinding } from '../types.js';

/**
 * Precedence classes (contract 18.2): a failure in an earlier class wins
 * over any failure in a later class. Recovery-gate codes precede all
 * operational classes; INTERNAL-INVARIANT is the last-resort class.
 */
const PRECEDENCE: readonly (readonly string[])[] = [
  ['ERR-STO-RECOVERY-REQUIRED', 'ERR-STO-RECOVERY-FAILED'],
  ['ERR-STO-REQ-INVALID', 'ERR-STO-CONFIG-UNAVAILABLE', 'ERR-STO-ROOT-INVALID', 'ERR-STO-ROOT-IDENTITY-CHANGED', 'ERR-STO-CONTAINMENT-DENIED', 'ERR-STO-LIMIT-EXCEEDED'],
  ['ERR-STO-FTYPE-UNSUPPORTED', 'ERR-STO-PERM-DENIED'],
  ['ERR-STO-MALFORMED'], // minimum envelope and structural syntax
  ['ERR-STO-UNSUPPORTED-VERSION'], // declared version
  ['ERR-STO-MALFORMED'], // canonicalization (same code; class order preserved)
  ['ERR-STO-INTEGRITY'],
  ['ERR-STO-REQ-INVALID', 'ERR-STO-CONFLICT-REVISION', 'ERR-STO-NOT-FOUND'],
  ['ERR-STO-DUPLICATE'],
  ['ERR-STO-LOCK-UNAVAILABLE', 'ERR-STO-LOCK-TIMEOUT', 'ERR-STO-CONCURRENCY'],
  ['ERR-STO-PUBLISH-FAILED', 'ERR-STO-DURABILITY', 'ERR-STO-NO-SPACE', 'ERR-STO-QUOTA-EXCEEDED', 'ERR-STO-READONLY-FS', 'ERR-STO-CROSS-DEVICE', 'ERR-STO-FS-UNSUPPORTED', 'ERR-STO-IO-FAILURE'],
  ['ERR-STO-CANCELLED', 'ERR-STO-TIMEOUT'],
  ['ERR-STO-RETENTION-DENIED'],
  ['ERR-STO-INTERNAL-INVARIANT'],
];

const CLASS_OF: Map<string, number> = new Map();
PRECEDENCE.forEach((codes, i) => codes.forEach((c) => {
  // Keep the earliest (highest-precedence) class for codes listed twice
  // (MALFORMED appears for both envelope-syntax and canonicalization).
  if (!CLASS_OF.has(c)) CLASS_OF.set(c, i);
}));

/** Select the deterministic winner per the precedence chain (ERM-007, DTM-004). */
export function selectPrecedence(findings: readonly StorageFinding[]): StorageFinding | undefined {
  if (findings.length === 0) return undefined;
  const first = findings[0];
  if (first === undefined) return undefined;
  let best = first;
  for (const f of findings.slice(1)) {
    const a = CLASS_OF.get(best.code) ?? Number.MAX_SAFE_INTEGER;
    const b = CLASS_OF.get(f.code) ?? Number.MAX_SAFE_INTEGER;
    if (b < a) best = f;
  }
  return best;
}

export type ContentFailureClass = 'malformed' | 'unsupported-version' | 'integrity' | 'ok';

export interface ContentClassificationInput {
  readonly minimumEnvelopeParses: boolean;
  readonly versionFieldStructurallyValid: boolean;
  readonly versionSupported: boolean;
  readonly canonicalizationOk: boolean;
  readonly integrityOk: boolean;
}

/**
 * Malformed-versus-unsupported-version precedence (18.2, ERM-014):
 * - unparseable minimum envelope → MALFORMED regardless of version content;
 * - parseable envelope with structurally valid unsupported version →
 *   UNSUPPORTED-VERSION (precedes deeper field checks);
 * - structurally invalid version field → MALFORMED;
 * - integrity verification only after structural, version, and
 *   canonicalization checks pass.
 */
export function classifyContentFailure(input: ContentClassificationInput): ContentFailureClass {
  if (!input.minimumEnvelopeParses) return 'malformed';
  if (!input.versionFieldStructurallyValid) return 'malformed';
  if (!input.versionSupported) return 'unsupported-version';
  if (!input.canonicalizationOk) return 'malformed';
  if (!input.integrityOk) return 'integrity';
  return 'ok';
}

export type ExistingTargetClass = 'idempotent-duplicate' | 'duplicate' | 'conflict-revision';

export interface ExistingTargetClassificationInput {
  readonly sameIdentifier: boolean;
  readonly identicalCanonicalBytes: boolean;
  readonly digestMatches: boolean;
  readonly sameRevision: boolean;
}

/**
 * Duplicate/conflict classification (10.2, 18.2, ERM-011). Caller MUST pass
 * a fully verified existing target; an unverified target is never classified
 * here (WPR-006/019).
 */
export function classifyExistingTarget(input: ExistingTargetClassificationInput): ExistingTargetClass {
  // Contract 10.2/18.2: conflicting revision or revision/digest mismatch is
  // classified before identical-bytes idempotency.
  if (!input.sameRevision || !input.digestMatches) return 'conflict-revision';
  if (input.sameIdentifier && input.identicalCanonicalBytes) return 'idempotent-duplicate';
  if (input.sameIdentifier && !input.identicalCanonicalBytes) return 'duplicate';
  return 'duplicate';
}
