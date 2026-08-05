/**
 * WP-6 Phase 2B: descriptor-derived capture and exact-shape validation of
 * ProspectiveDestinationResolver evidence (F-2BP-FR-01 pattern, Model B).
 *
 * The resolver invocation and the returned evidence are separate
 * boundaries: the resolver may execute trusted host code, but the returned
 * value is then captured and validated as a STRICT tagged protocol result:
 * - captured exactly once via the committed descriptor-derived snapshot;
 * - protocol-field getters never invoked; Proxy `get` traps never fire;
 * - only own string-keyed properties; prototype-inherited fields rejected;
 * - accessors, missing own descriptors, non-enumerable fields, symbols,
 *   unsupported prototypes, and cycles fail closed;
 * - every accepted data-descriptor value read once into a detached deeply
 *   frozen representation (no mutation-dependent mixed evidence);
 * - throwing structural traps and revoked Proxies become typed fail-closed
 *   results; malformed evidence never escapes as an exception;
 * - exact variant shapes and primitive field types are validated after
 *   capture; unknown fields, malformed discriminators, and malformed tags
 *   fail closed.
 *
 * Success is one flat exact eight-own-key shape (Model B observed state).
 * Failure is one exact three-own-key subject-aware shape; subject/code
 * compatibility is a closed core-side table.
 */
import { snapshotJson } from '../internal/snapshot.js';
import { canonicalizeRootLexically } from './roots.js';
import type {
  ProspectiveDestinationResolutionFailureCode,
  ProspectiveDestinationResolutionFailureSubject,
  ProspectiveDestinationTargetState,
} from './destination-types.js';

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

export type DestinationEvidenceCaptureResult =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly code: 'malformed' };

export function captureDestinationResolutionEvidence(value: unknown): DestinationEvidenceCaptureResult {
  let captured: unknown;
  try {
    captured = snapshotJson(value, '$');
  } catch {
    // SnapshotError (accessors, missing/non-enumerable descriptors, symbols,
    // non-plain prototypes, cycles, unsupported values) or any wrapped
    // structural trap failure: fail closed as hostile evidence.
    return { ok: false, code: 'malformed' };
  }
  if (captured === null || typeof captured !== 'object' || Array.isArray(captured)) {
    return { ok: false, code: 'malformed' };
  }
  return { ok: true, value: captured as Readonly<Record<string, unknown>> };
}

// ---------------------------------------------------------------------------
// success evidence (exact eight own keys)
// ---------------------------------------------------------------------------

const SUCCESS_EVIDENCE_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'currentCanonicalArtifactRoot',
  'artifactRootEntryKind',
  'lexicalExistingDirectoryPrefixComponents',
  'canonicalExistingDirectoryAncestor',
  'existingAncestorEntryKind',
  'destinationTailComponents',
  'targetState',
]);

const TARGET_STATES: ReadonlySet<string> = new Set([
  'missing',
  'existing-file',
  'existing-directory',
  'existing-symlink',
  'dangling-symlink',
  'unsupported-kind',
]);

function hasExactKeys(keys: readonly string[], allowed: ReadonlySet<string>): boolean {
  if (keys.length !== allowed.size) return false;
  const seen = new Set(keys);
  for (const key of allowed) {
    if (!seen.has(key)) return false;
  }
  return true;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export interface ValidatedDestinationSuccessEvidence {
  readonly currentCanonicalArtifactRoot: string;
  readonly lexicalExistingDirectoryPrefixComponents: readonly string[];
  readonly canonicalExistingDirectoryAncestor: string;
  readonly destinationTailComponents: readonly string[];
  readonly targetState: ProspectiveDestinationTargetState;
}

export type DestinationSuccessEvidenceResult =
  | { readonly ok: true; readonly evidence: ValidatedDestinationSuccessEvidence }
  | { readonly ok: false; readonly code: 'malformed' | 'non-canonical-path' };

/**
 * Validate captured success evidence against the exact eight-own-key Model B
 * shape: exact literals for both entry kinds, string arrays for prefix and
 * tail, target state in the fixed vocabulary, and both canonical paths
 * re-canonicalized under the supported POSIX lane. Semantic checks (root
 * equality, ancestor containment, prefix/tail correlation, target-state/tail
 * rules) are applied by the evaluator.
 */
export function validateDestinationSuccessEvidence(
  captured: Readonly<Record<string, unknown>>,
): DestinationSuccessEvidenceResult {
  const keys = Object.keys(captured);
  if (!hasExactKeys(keys, SUCCESS_EVIDENCE_KEYS)) {
    return { ok: false, code: 'malformed' };
  }
  if (captured['ok'] !== true) return { ok: false, code: 'malformed' };
  const rootRaw = captured['currentCanonicalArtifactRoot'];
  const ancestorRaw = captured['canonicalExistingDirectoryAncestor'];
  const prefixRaw = captured['lexicalExistingDirectoryPrefixComponents'];
  const tailRaw = captured['destinationTailComponents'];
  const targetState = captured['targetState'];
  if (typeof rootRaw !== 'string' || typeof ancestorRaw !== 'string') {
    return { ok: false, code: 'malformed' };
  }
  if (captured['artifactRootEntryKind'] !== 'directory' || captured['existingAncestorEntryKind'] !== 'directory') {
    return { ok: false, code: 'malformed' };
  }
  if (!isStringArray(prefixRaw) || !isStringArray(tailRaw)) {
    return { ok: false, code: 'malformed' };
  }
  if (typeof targetState !== 'string' || !TARGET_STATES.has(targetState)) {
    return { ok: false, code: 'malformed' };
  }
  const rootLexical = canonicalizeRootLexically(rootRaw);
  if (!rootLexical.ok) return { ok: false, code: 'non-canonical-path' };
  const ancestorLexical = canonicalizeRootLexically(ancestorRaw);
  if (!ancestorLexical.ok) return { ok: false, code: 'non-canonical-path' };
  return {
    ok: true,
    evidence: {
      currentCanonicalArtifactRoot: rootLexical.canonical,
      lexicalExistingDirectoryPrefixComponents: prefixRaw,
      canonicalExistingDirectoryAncestor: ancestorLexical.canonical,
      destinationTailComponents: tailRaw,
      targetState: targetState as ProspectiveDestinationTargetState,
    },
  };
}

// ---------------------------------------------------------------------------
// failure evidence (exact three own keys; closed subject/code table)
// ---------------------------------------------------------------------------

const FAILURE_EVIDENCE_KEYS: ReadonlySet<string> = new Set(['ok', 'subject', 'code']);

const FAILURE_SUBJECTS: ReadonlySet<string> = new Set([
  'artifact-root',
  'existing-ancestor',
  'final-target',
  'resolution',
]);

const FAILURE_CODES: ReadonlySet<string> = new Set([
  'not-found',
  'not-directory',
  'unsupported-kind',
  'loop',
  'inaccessible',
  'ambiguous',
  'dangling-symlink',
  'observation-failed',
  'error',
]);

/** Closed subject/code compatibility table (documented; deterministic). */
const FAILURE_COMPATIBILITY: Readonly<Record<string, ReadonlySet<string>>> = {
  'artifact-root': new Set([
    'not-found',
    'not-directory',
    'unsupported-kind',
    'loop',
    'inaccessible',
    'ambiguous',
    'dangling-symlink',
    'error',
  ]),
  'existing-ancestor': new Set([
    'not-found',
    'not-directory',
    'unsupported-kind',
    'loop',
    'inaccessible',
    'ambiguous',
    'dangling-symlink',
    'error',
  ]),
  'final-target': new Set(['observation-failed', 'loop', 'inaccessible', 'ambiguous', 'error']),
  'resolution': new Set(['error']),
};

export interface ValidatedDestinationFailureEvidence {
  readonly subject: ProspectiveDestinationResolutionFailureSubject;
  readonly code: ProspectiveDestinationResolutionFailureCode;
}

export type DestinationFailureEvidenceResult =
  | { readonly ok: true; readonly evidence: ValidatedDestinationFailureEvidence }
  | { readonly ok: false; readonly code: 'malformed' | 'unknown-subject' | 'unknown-code' | 'incompatible-subject-code' };

/**
 * Validate captured failure evidence against the exact three-own-key
 * subject-aware shape and the closed subject/code compatibility table.
 * Ordinary observed existing target states must use success evidence and
 * core-side rejection, never generic failures.
 */
export function validateDestinationFailureEvidence(
  captured: Readonly<Record<string, unknown>>,
): DestinationFailureEvidenceResult {
  const keys = Object.keys(captured);
  if (!hasExactKeys(keys, FAILURE_EVIDENCE_KEYS)) {
    return { ok: false, code: 'malformed' };
  }
  if (captured['ok'] !== false) return { ok: false, code: 'malformed' };
  const subject = captured['subject'];
  const code = captured['code'];
  if (typeof subject !== 'string' || typeof code !== 'string') {
    return { ok: false, code: 'malformed' };
  }
  if (!FAILURE_SUBJECTS.has(subject)) return { ok: false, code: 'unknown-subject' };
  if (!FAILURE_CODES.has(code)) return { ok: false, code: 'unknown-code' };
  const compatible = FAILURE_COMPATIBILITY[subject];
  if (compatible === undefined || !compatible.has(code)) {
    return { ok: false, code: 'incompatible-subject-code' };
  }
  return {
    ok: true,
    evidence: { subject: subject as ProspectiveDestinationResolutionFailureSubject, code: code as ProspectiveDestinationResolutionFailureCode },
  };
}
