/**
 * WP-6 Phase 2A: workspace-relative candidate-path grammar (request boundary).
 *
 * The primary Phase-2A protocol accepts workspace-relative paths only. The
 * candidate path is UNTRUSTED request data and is validated at the untrusted
 * request boundary with strict, explicit rules; it can never select or infer
 * a local root.
 *
 * Grammar (explicit, fail closed):
 * - non-empty; empty paths are rejected (the workspace root has a dedicated
 *   representation: the single token `.`);
 * - POSIX absolute (`/...`), Windows drive-absolute (`C:\...` / `C:/...`),
 *   and UNC (`\\...`) request paths are rejected;
 * - `\` anywhere is rejected (Windows separators are unsupported on the
 *   supported POSIX lane);
 * - NUL (`\u0000`) and control characters (`< 0x20`) are rejected;
 * - leading, trailing, and repeated separators are rejected (ambiguous empty
 *   components; no silent cleanup at the untrusted request boundary);
 * - interior `.` components are rejected (ambiguous; the only accepted `.`
 *   form is the exact root token);
 * - `..` components are NOT normalized at the request boundary: they are
 *   carried as components and popped during the trusted internal combination
 *   (see `combineWorkspaceRootAndComponents`); a pop that would escape the
 *   workspace root fails closed as a traversal escape;
 * - Unicode bytes are preserved exactly; no NFC/NFD/case-folding/locale or
 *   compatibility normalization is ever applied.
 */
import { canonicalizeRootLexically } from './roots.js';

export type RelativePathFailureCode =
  | 'empty'
  | 'absolute'
  | 'drive-absolute'
  | 'unc'
  | 'nul-or-control'
  | 'backslash'
  | 'leading-separator'
  | 'trailing-separator'
  | 'repeated-separator'
  | 'empty-component'
  | 'interior-dot';

export type RelativePathParseResult =
  | { readonly ok: true; readonly components: readonly string[] }
  | { readonly ok: false; readonly code: RelativePathFailureCode };

const ABSOLUTE_PATTERN = /^\//;
const DRIVE_ABSOLUTE_PATTERN = /^[A-Za-z]:/;
const UNC_PATTERN = /^\\/;

function hasInvalidCharacter(path: string): boolean {
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    // NUL and control characters are never valid in a POSIX path component.
    if (c === 0 || c < 0x20) return true;
  }
  return false;
}

/**
 * Parse a workspace-relative candidate path (request boundary). The exact
 * root token `.` yields zero components; every other accepted form is a
 * sequence of non-empty, non-dot, non-dotdot components separated by single
 * `/` separators with no leading or trailing separator.
 */
export function parseWorkspaceRelativePath(path: string): RelativePathParseResult {
  if (path.length === 0) return { ok: false, code: 'empty' };
  if (hasInvalidCharacter(path)) return { ok: false, code: 'nul-or-control' };
  if (ABSOLUTE_PATTERN.test(path)) return { ok: false, code: 'absolute' };
  if (DRIVE_ABSOLUTE_PATTERN.test(path)) return { ok: false, code: 'drive-absolute' };
  if (UNC_PATTERN.test(path)) return { ok: false, code: 'unc' };
  if (path.includes('\\')) return { ok: false, code: 'backslash' };
  if (path === '.') return { ok: true, components: [] };
  if (path.includes('//')) return { ok: false, code: 'repeated-separator' };
  if (path.endsWith('/')) return { ok: false, code: 'trailing-separator' };
  const components = path.split('/');
  for (const component of components) {
    if (component.length === 0) return { ok: false, code: 'empty-component' };
    if (component === '.') return { ok: false, code: 'interior-dot' };
    // '..' components are carried; pops are applied during the trusted
    // combination, where an escaping pop fails closed as a traversal escape.
  }
  return { ok: true, components };
}

export type WorkspacePathCombinationResult =
  | {
      readonly ok: true;
      /** Canonical absolute candidate path inside the trusted process. */
      readonly canonical: string;
      /** Canonical workspace-relative form (`''` = the workspace root). */
      readonly relative: string;
    }
  | { readonly ok: false; readonly code: 'escape' | 'invalid' };

/**
 * Combine the trusted canonical workspace root (from the validated workspace
 * record only) with the validated relative components INSIDE the trusted
 * process, using POSIX component semantics — never naive string
 * concatenation. `..` components are popped against the WORKSPACE ROOT
 * boundary (not the filesystem root): a pop that would rise above the
 * workspace root fails closed as a traversal escape, and the canonical
 * relative form is derived from the popped component stack. The resulting
 * absolute path is package-internal and must never cross the package root,
 * findings, public identity, or external projections.
 */
export function combineWorkspaceRootAndComponents(
  root: string,
  components: readonly string[],
): WorkspacePathCombinationResult {
  // `..` pops are bounded by the workspace root: nothing may rise above it.
  const stack: string[] = [];
  for (const component of components) {
    if (component === '..') {
      if (stack.length === 0) return { ok: false, code: 'escape' };
      stack.pop();
    } else {
      stack.push(component);
    }
  }
  const relative = stack.join('/');
  const candidate = root === '/' ? '/' + relative : root + '/' + relative;
  // The candidate contains no `..`/`.` components, so lexical
  // canonicalization is a pure formality; a failure here is unreachable for
  // a validated root and validated components and fails closed if it occurs.
  const lex = canonicalizeRootLexically(candidate);
  if (!lex.ok) {
    return { ok: false, code: 'invalid' };
  }
  return { ok: true, canonical: lex.canonical, relative };
}
