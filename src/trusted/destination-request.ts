/**
 * WP-6 Phase 2B: untrusted destination request capture and artifact-root-
 * relative grammar (Model B).
 *
 * The destination is an artifact-root-relative POSIX path: one or more
 * non-empty components joined by single `/` separators. Empty, `.`, `..`,
 * absolute (leading slash), Windows drive, UNC, backslash, repeated or
 * trailing separators, NUL, prohibited control characters, and empty
 * components are rejected. Unlike the Phase-2A workspace-relative grammar,
 * `..` is rejected outright (no bounded pops) per F-EL2 for non-existent
 * destination paths. Destination equality with the artifact root is
 * structurally impossible: the empty path and `.` are rejected, so no
 * accepted request can normalize to the root.
 *
 * Unicode is accepted on the supported UTF-8 lane without normalization;
 * malformed input is never silently normalized.
 *
 * The core performs no filesystem I/O.
 */
import { snapshotTrustedWorkspaceConfigurationInput } from './snapshot.js';

/**
 * Fixed documented maximum request size bound (code units of the destination
 * string). Implementation-owned value; deterministic; applied before any
 * resolver invocation; tested immediately below, at, and above the boundary.
 */
export const DESTINATION_MAX_LENGTH = 4096;

export type DestinationPathFailureCode =
  | 'empty'
  | 'absolute'
  | 'drive-absolute'
  | 'unc'
  | 'dot'
  | 'dotdot'
  | 'trailing-separator'
  | 'repeated-separator'
  | 'empty-component'
  | 'backslash'
  | 'nul-or-control'
  | 'too-long';

export type DestinationPathParseResult =
  | { readonly ok: true; readonly components: readonly string[] }
  | { readonly ok: false; readonly code: DestinationPathFailureCode };

const ABSOLUTE_PATTERN = /^\//;
const DRIVE_ABSOLUTE_PATTERN = /^[A-Za-z]:/;
const UNC_PATTERN = /^\\\\/;

function hasInvalidCharacter(path: string): boolean {
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    // NUL and control characters are never valid in a POSIX path component.
    if (c === 0 || c < 0x20) return true;
  }
  return false;
}

/**
 * Parse the untrusted artifact-root-relative destination. Rejects the full
 * grammar above; returns validated non-empty components (no `.`/`..`/empty)
 * or a typed failure code. The size bound is applied first.
 */
export function parseDestinationComponents(path: string): DestinationPathParseResult {
  if (path.length > DESTINATION_MAX_LENGTH) return { ok: false, code: 'too-long' };
  if (path.length === 0) return { ok: false, code: 'empty' };
  if (hasInvalidCharacter(path)) return { ok: false, code: 'nul-or-control' };
  if (ABSOLUTE_PATTERN.test(path)) return { ok: false, code: 'absolute' };
  if (DRIVE_ABSOLUTE_PATTERN.test(path)) return { ok: false, code: 'drive-absolute' };
  if (UNC_PATTERN.test(path)) return { ok: false, code: 'unc' };
  if (path.includes('\\')) return { ok: false, code: 'backslash' };
  if (path === '.') return { ok: false, code: 'dot' };
  if (path.includes('//')) return { ok: false, code: 'repeated-separator' };
  if (path.endsWith('/')) return { ok: false, code: 'trailing-separator' };
  const components = path.split('/');
  for (const component of components) {
    if (component.length === 0) return { ok: false, code: 'empty-component' };
    if (component === '.') return { ok: false, code: 'dot' };
    if (component === '..') return { ok: false, code: 'dotdot' };
  }
  return { ok: true, components };
}

/** Canonical artifact-relative lexical destination (validated components joined). */
export function joinComponents(components: readonly string[]): string {
  return components.join('/');
}

/**
 * Lexical absolute prospective destination = configuration-bound canonical
 * artifact root + validated components. NOT assumed fully resolved (aliases
 * may exist below the root). The root is never `/` for a validated
 * configuration (TCF-038); a defensive guard fails closed if it is.
 */
export function combineCanonicalRootAndComponents(
  root: string,
  components: readonly string[],
): { readonly ok: true; readonly absolute: string } | { readonly ok: false } {
  if (root === '/' || root.length === 0 || root.endsWith('/')) {
    return { ok: false };
  }
  return { ok: true, absolute: `${root}/${joinComponents(components)}` };
}

/**
 * Internal resolved prospective destination = canonical existing directory
 * ancestor + validated tail components, joined with POSIX component
 * semantics. Distinct from the lexical absolute destination across aliases.
 * Internal-only; never externally exposed; does not prove a later write is
 * safe.
 */
export function combineAncestorAndTail(
  ancestor: string,
  tailComponents: readonly string[],
): { readonly ok: true; readonly resolved: string } | { readonly ok: false } {
  if (ancestor === '/' || ancestor.length === 0 || ancestor.endsWith('/')) {
    return { ok: false };
  }
  if (tailComponents.length === 0) {
    return { ok: true, resolved: ancestor };
  }
  return { ok: true, resolved: `${ancestor}/${joinComponents(tailComponents)}` };
}

/**
 * Descriptor-derived single capture of the untrusted request object
 * (F-EL5 / F-2BP-FR-01 pattern): no getters, zero Proxy `get`, no
 * missing/non-enumerable/accessor descriptors, no symbols, no unsupported
 * prototypes, no cycles, deep freeze, no caller reread. Hostile structures
 * throw TrustedSnapshotError (the committed snapshot wrapper already
 * converts raw trap failures into typed errors); the evaluator converts
 * them into typed findings.
 */
export function snapshotDestinationRequest(value: unknown): unknown {
  return snapshotTrustedWorkspaceConfigurationInput(value);
}
