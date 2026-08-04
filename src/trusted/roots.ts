/**
 * Canonical workspace-root representation and registration uniqueness
 * (WP-6 Phase 1, F-EL1).
 *
 * Supported lane: Linux, x86_64, POSIX-style filesystem semantics, UTF-8
 * locale (F-EL3). Windows, macOS, case-insensitive filesystems, network
 * filesystems, and non-POSIX path semantics are unverified and out of scope.
 *
 * Canonicalization:
 * 1. lexical POSIX normalization (absolute path required; `.` and `..`
 *    resolved; `..` escaping the filesystem root rejected; repeated
 *    separators collapsed; trailing separator removed except for `/`);
 * 2. symlink resolution through the mandatory injected root-path resolver
 *    (Phase 1 is part of the I/O-free production core: the resolver is
 *    caller-supplied, matching the repository policy that all external state
 *    is supplied through explicit interfaces). The resolved canonical form
 *    is used for uniqueness comparisons so that symlink-resolved overlap is
 *    always detected (correction F-2). A resolver failure (missing path,
 *    symlink loop, thrown error, or malformed/relative result) fails closed
 *    as a root-resolution failure. There is no lexical-only validation
 *    mode: a missing resolver is a fail-closed validation error and can
 *    never produce a validated configuration.
 *
 * Uniqueness (v1): exact duplicate canonical roots, parent-child roots,
 * overlapping roots, and one-root-containing-another are all prohibited;
 * any violation fails the ENTIRE trusted configuration load. There is no
 * first-match or longest-prefix routing. Case semantics on the supported
 * Linux lane are case-sensitive; case-folding ambiguity is not introduced.
 *
 * Phase 1 performs no arbitrary candidate-path containment decisions and no
 * project filesystem operations.
 */

export interface RootResolutionFailure {
  readonly ok: false;
  readonly code: 'not-absolute' | 'path-escape' | 'invalid-character' | 'resolution-failed';
}

export interface RootResolutionSuccess {
  readonly ok: true;
  /** Canonical absolute path (lexically normalized, optionally symlink-resolved). */
  readonly canonical: string;
}

export type CanonicalRoot = RootResolutionSuccess;

/**
 * Injectable read-only resolver of an existing path to its canonical resolved
 * form (symlinks resolved). Returns the resolved path, or null when the path
 * cannot be resolved (does not exist, is a broken symlink or symlink loop, or
 * resolution failed). The production caller supplies a host-boundary resolver
 * (e.g. backed by read-only realpath) outside the I/O-free core.
 */
export type RootPathResolver = (path: string) => string | null;

const ABSOLUTE_PATH_PATTERN = /^\//;

function hasInvalidCharacter(path: string): boolean {
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    // NUL and control characters are never valid in a POSIX path component.
    if (c === 0 || c < 0x20) return true;
  }
  return false;
}

/**
 * Lexical POSIX normalization of an absolute path.
 * Rejects: non-absolute paths, NUL/control characters, and `..` that escapes
 * the filesystem root.
 */
export function canonicalizeRootLexically(path: string): RootResolutionSuccess | RootResolutionFailure {
  if (!ABSOLUTE_PATH_PATTERN.test(path)) {
    return { ok: false, code: 'not-absolute' };
  }
  if (hasInvalidCharacter(path)) {
    return { ok: false, code: 'invalid-character' };
  }
  if (path === '/') return { ok: true, canonical: '/' };
  const components: string[] = [];
  for (const raw of path.split('/')) {
    if (raw === '' || raw === '.') continue;
    if (raw === '..') {
      const popped = components.pop();
      if (popped === undefined) {
        // `..` at the top of the filesystem would escape the root.
        return { ok: false, code: 'path-escape' };
      }
      continue;
    }
    components.push(raw);
  }
  const canonical = '/' + components.join('/');
  return { ok: true, canonical };
}

/** Component-wise split of a canonical root (never empty for an absolute root). */
function splitComponents(canonical: string): readonly string[] {
  if (canonical === '/') return [];
  return canonical.slice(1).split('/');
}

/**
 * True when `a` equals `b`, or `a` is an ancestor of `b` at a component
 * boundary (parent-child / containment / overlap). Byte-exact and
 * case-sensitive on the supported Linux lane.
 */
export function isRootAncestorOrEqual(a: string, b: string): boolean {
  if (a === b) return true;
  const ac = splitComponents(a);
  const bc = splitComponents(b);
  if (ac.length === 0) return true; // "/" contains everything
  if (ac.length >= bc.length) return false;
  for (let i = 0; i < ac.length; i++) {
    if (ac[i] !== bc[i]) return false;
  }
  return true;
}

/**
 * Canonicalize a configured workspace root: lexical normalization first, then
 * mandatory symlink resolution via the injected resolver. A missing or
 * failing resolver result fails closed. There is no lexical-only path that
 * can produce a validated canonical root.
 */
export function canonicalizeRoot(
  path: string,
  resolveRoot: RootPathResolver,
): RootResolutionSuccess | RootResolutionFailure {
  const lexical = canonicalizeRootLexically(path);
  if (!lexical.ok) return lexical;
  let resolved: string | null;
  try {
    resolved = resolveRoot(lexical.canonical);
  } catch {
    resolved = null;
  }
  if (resolved === null) {
    return { ok: false, code: 'resolution-failed' };
  }
  // The resolver result must itself be canonicalized lexically (a
  // host-boundary resolver may return a path with redundant separators, or
  // a malformed/relative/outside-lane result, which then fails closed).
  const reLexical = canonicalizeRootLexically(resolved);
  if (!reLexical.ok) return { ok: false, code: 'resolution-failed' };
  return { ok: true, canonical: reLexical.canonical };
}
