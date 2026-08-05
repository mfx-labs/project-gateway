/**
 * WP-6 Phase 2B-P: trusted artifact-location configuration (version-2
 * workspace operand).
 *
 * The configured artifact location is trusted-local configuration input
 * (absolute path under the supported POSIX host lane) that defines the only
 * workspace region in which validated structured drafts of the four
 * prospective draft aggregates may later be considered for persistence. It
 * grants NO write authority and performs no destination containment or
 * persistence.
 *
 * Directory-existence and entry-kind contract (correction F-2BP-01):
 * - the configured path is lexically canonicalized under the supported
 *   POSIX lane (relative, Windows, UNC, NUL/control, and escaping forms
 *   fail closed);
 * - the canonical configured path is resolved exactly once through the
 *   injected trusted ArtifactLocationResolver (the core performs no
 *   filesystem module calls; request and repository content can never
 *   supply resolution evidence);
 * - successful evidence must identify the final canonical target as an
 *   existing directory; regular files, sockets, FIFOs, devices, unknown
 *   entry types, broken links, loops, inaccessible, ambiguous, and generic
 *   resolution errors fail closed;
 * - the final canonical artifact directory must be a strict
 *   component-boundary descendant of the selected canonical workspace root
 *   (equality prohibited), must not be `/`, and must not resolve outside
 *   the workspace;
 * - non-existent artifact roots are outside this prerequisite (Phase-2B
 *   nearest-existing-ancestor semantics are not implemented).
 *
 * The resolver evidence interface is dedicated to this prerequisite; the
 * committed Phase-1 RootPathResolver contract is untouched.
 */
import { canonicalizeRootLexically, isRootAncestorOrEqual } from './roots.js';
import { snapshotJson, SnapshotError } from '../internal/snapshot.js';

export type ArtifactLocationResolutionFailureCode =
  | 'not-found'
  | 'loop'
  | 'inaccessible'
  | 'ambiguous'
  | 'unsupported-entry-kind'
  | 'error';

export interface ArtifactLocationResolutionSuccess {
  readonly ok: true;
  /** Final canonical path of the resolved entry (re-canonicalized by the core). */
  readonly canonicalPath: string;
  /** Successful protocol semantics permit exactly `directory`. */
  readonly entryKind: 'directory';
}

export interface ArtifactLocationResolutionFailure {
  readonly ok: false;
  readonly code: ArtifactLocationResolutionFailureCode;
}

export type ArtifactLocationResolution = ArtifactLocationResolutionSuccess | ArtifactLocationResolutionFailure;

/**
 * Injected trusted artifact-location resolver (host-boundary; the trusted
 * configuration core performs no filesystem I/O). Exactly one trusted
 * resolution outcome per configured artifact location per validation
 * attempt. Supplied by a trusted caller; never derived from request or
 * repository content.
 */
export type ArtifactLocationResolver = (absolutePath: string) => ArtifactLocationResolution;

/**
 * Default ChatGPT-facing draft-location scope (versioned protocol
 * constant): the exact four prospective draft aggregates referenced by an
 * ExecutionBundle. ExecutionBundle (derived/reference composition
 * aggregate) and ExecutionResult (retrospective execution output) are NOT
 * part of this scope; no storage or persistence contract for them exists in
 * this work package. Caller- or configuration-supplied kind arrays are not
 * part of the protocol.
 */
export const ARTIFACT_DRAFT_LOCATION_KINDS: readonly string[] = Object.freeze([
  'TaskSpec',
  'AuthorityPolicy',
  'ContextManifest',
  'CompletionContract',
]);

export type ArtifactLocationInputFailureCode =
  | 'path-invalid'; // relative / Windows / UNC / NUL / control / traversal escape

export type ArtifactLocationConfiguredPathResult =
  | { readonly ok: true; readonly canonical: string }
  | { readonly ok: false; readonly code: ArtifactLocationInputFailureCode };

/**
 * Lexically canonicalize the configured absolute artifact-location path
 * (trusted-local configuration input) under the supported POSIX lane.
 * Relative, Windows drive, UNC, NUL/control, and traversal-escaping forms
 * fail closed. A lexically canonical `/` is passed to the resolver; the
 * final-canonical-`/` rejection happens after resolution.
 */
export function canonicalizeConfiguredArtifactPath(path: string): ArtifactLocationConfiguredPathResult {
  const lexical = canonicalizeRootLexically(path);
  if (!lexical.ok) {
    return { ok: false, code: 'path-invalid' };
  }
  return { ok: true, canonical: lexical.canonical };
}

export type ArtifactLocationValidationFailureCode =
  | 'resolver-failed'              // resolver threw or reported a generic error
  | 'not-found'                    // target does not exist (or broken link)
  | 'symlink-loop'
  | 'not-directory'                // unsupported entry kind: file, socket, FIFO, device, unknown
  | 'resolver-result-malformed'    // relative / Windows / UNC / NUL / control canonical result
  | 'root-whole-filesystem'        // final canonical target is `/`
  | 'equals-workspace-root'        // final canonical target equals the workspace root
  | 'outside-workspace'            // not a strict component-boundary descendant
  | 'ambiguous';                   // resolver evidence is ambiguous

export type ArtifactLocationValidationResult =
  | { readonly ok: true; readonly canonical: string }
  | { readonly ok: false; readonly code: ArtifactLocationValidationFailureCode };

/**
 * Descriptor-derived single-capture validation for ArtifactLocationResolver
 * evidence (correction F-2BP-FR-01).
 *
 * The resolver invocation and the returned evidence are separate
 * boundaries: the resolver may execute trusted host code, but the returned
 * value is then captured and validated as a STRICT tagged protocol result
 * using the repository's accepted descriptor-derived snapshot principles:
 * - the resolver return value is captured exactly once;
 * - protocol-field getters are never invoked; Proxy `get` traps never fire;
 * - only own string-keyed properties are inspected; prototype-inherited
 *   protocol fields are rejected;
 * - accessor properties are rejected without invocation; missing own
 *   descriptors, non-enumerable required fields, symbol properties,
 *   unsupported prototypes, and cycles fail closed;
 * - every accepted data descriptor value is read once into a detached,
 *   deeply frozen representation before semantic interpretation, so
 *   mutation-dependent mixed evidence is impossible;
 * - throwing descriptor traps and Proxy traps are converted into a typed
 *   fail-closed result; malformed evidence never escapes as an exception;
 * - exact variant shapes and primitive field types are validated after
 *   capture (unknown fields, malformed discriminators, and malformed tags
 *   fail closed).
 */
export type ArtifactLocationEvidenceCaptureResult =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly code: 'malformed' };

export function captureArtifactLocationResolutionEvidence(value: unknown): ArtifactLocationEvidenceCaptureResult {
  let captured: unknown;
  try {
    captured = snapshotJson(value, '$');
  } catch {
    // SnapshotError (accessors, missing/non-enumerable descriptors, symbols,
    // non-plain prototypes, cycles, unsupported values) or any wrapped
    // structural trap failure: fail closed as malformed evidence.
    return { ok: false, code: 'malformed' };
  }
  if (captured === null || typeof captured !== 'object' || Array.isArray(captured)) {
    return { ok: false, code: 'malformed' };
  }
  return { ok: true, value: captured as Readonly<Record<string, unknown>> };
}

/** Exact own-key set of the success evidence variant. */
const SUCCESS_EVIDENCE_KEYS: ReadonlySet<string> = new Set(['ok', 'canonicalPath', 'entryKind']);
/** Exact own-key set of the failure evidence variant. */
const FAILURE_EVIDENCE_KEYS: ReadonlySet<string> = new Set(['ok', 'code']);
/** Accepted failure-status vocabulary (unchanged from the resolver contract). */
const RESOLUTION_FAILURE_CODES: ReadonlySet<string> = new Set([
  'not-found',
  'loop',
  'inaccessible',
  'ambiguous',
  'unsupported-entry-kind',
  'error',
]);

function hasExactKeys(keys: readonly string[], allowed: ReadonlySet<string>): boolean {
  if (keys.length !== allowed.size) return false;
  const seen = new Set(keys);
  for (const key of allowed) {
    if (!seen.has(key)) return false;
  }
  return true;
}

/** Semantic validation result of captured evidence (maps directly to the validation failure vocabulary). */
type CapturedEvidenceResult =
  | { readonly ok: true; readonly canonicalPath: string }
  | { readonly ok: false; readonly code: ArtifactLocationValidationFailureCode };

/**
 * Validate the captured evidence against the exact tagged variant shapes:
 * success `{ok: true, canonicalPath, entryKind: 'directory'}`; failure
 * `{ok: false, code}` with the accepted status vocabulary. Unknown fields,
 * missing fields, mixed variant shapes, malformed discriminators or tags,
 * and wrong primitive types fail closed as malformed evidence.
 */
function validateCapturedEvidence(captured: Readonly<Record<string, unknown>>): CapturedEvidenceResult {
  const keys = Object.keys(captured);
  if (hasExactKeys(keys, SUCCESS_EVIDENCE_KEYS)) {
    if (captured['ok'] !== true) return { ok: false, code: 'resolver-result-malformed' };
    const canonicalPath = captured['canonicalPath'];
    if (typeof canonicalPath !== 'string') return { ok: false, code: 'resolver-result-malformed' };
    const entryKind = captured['entryKind'];
    if (typeof entryKind !== 'string') return { ok: false, code: 'resolver-result-malformed' };
    if (entryKind !== 'directory') return { ok: false, code: 'not-directory' };
    return { ok: true, canonicalPath };
  }
  if (hasExactKeys(keys, FAILURE_EVIDENCE_KEYS)) {
    if (captured['ok'] !== false) return { ok: false, code: 'resolver-result-malformed' };
    const code = captured['code'];
    if (typeof code !== 'string' || !RESOLUTION_FAILURE_CODES.has(code)) {
      return { ok: false, code: 'resolver-result-malformed' };
    }
    if (code === 'not-found') return { ok: false, code: 'not-found' };
    if (code === 'loop') return { ok: false, code: 'symlink-loop' };
    if (code === 'ambiguous') return { ok: false, code: 'ambiguous' };
    if (code === 'unsupported-entry-kind') return { ok: false, code: 'not-directory' };
    return { ok: false, code: 'resolver-failed' }; // inaccessible | error
  }
  // Unknown fields, missing fields, or a mixed variant shape: malformed.
  return { ok: false, code: 'resolver-result-malformed' };
}

/**
 * Resolve and validate one configured artifact location against its
 * workspace's canonical root: exactly one resolver invocation, the returned
 * evidence descriptor-captured once and validated as a strict tagged
 * protocol result (entry kind `directory` required), the final canonical
 * target re-canonicalized, `/` prohibited, equality with the workspace root
 * prohibited, and a strict component-boundary descendant of the workspace
 * root required.
 */
export function resolveConfiguredArtifactLocation(
  canonicalConfiguredPath: string,
  workspaceCanonicalRoot: string,
  resolver: ArtifactLocationResolver,
): ArtifactLocationValidationResult {
  let rawResolution: unknown;
  try {
    rawResolution = resolver(canonicalConfiguredPath);
  } catch {
    return { ok: false, code: 'resolver-failed' };
  }
  // Separate boundary: the resolver return value is captured once as strict
  // tagged protocol evidence (no getters, zero Proxy `get`, no inherited
  // fields, no mixed evidence); malformed evidence fails closed here and
  // can never escape as an exception.
  const captured = captureArtifactLocationResolutionEvidence(rawResolution);
  if (!captured.ok) {
    return { ok: false, code: 'resolver-result-malformed' };
  }
  const resolution = validateCapturedEvidence(captured.value);
  if (!resolution.ok) {
    return { ok: false, code: resolution.code };
  }
  const lexical = canonicalizeRootLexically(resolution.canonicalPath);
  if (!lexical.ok) {
    return { ok: false, code: 'resolver-result-malformed' };
  }
  const canonical = lexical.canonical;
  if (canonical === '/') {
    return { ok: false, code: 'root-whole-filesystem' };
  }
  if (canonical === workspaceCanonicalRoot) {
    return { ok: false, code: 'equals-workspace-root' };
  }
  if (!isRootAncestorOrEqual(workspaceCanonicalRoot, canonical)) {
    return { ok: false, code: 'outside-workspace' };
  }
  return { ok: true, canonical };
}
