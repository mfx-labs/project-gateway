/**
 * WP-6 Phase 2A: injected trusted existing-path resolver boundary.
 *
 * The containment core is I/O-free: it never performs `node:fs` calls. The
 * host-boundary existing-path resolver is supplied by a trusted caller and
 * is the only source of trusted existence/resolution evidence. A
 * request-supplied existence assertion is never accepted as evidence.
 *
 * The resolver receives the internally derived absolute candidate path and
 * returns either a resolved canonical existing path or a typed failure:
 * - `not-found`: the path (or a symlink along it) does not resolve to an
 *   existing object (covers broken symlinks and missing paths);
 * - `loop`: a symlink loop was detected;
 * - `error`: any other resolution failure.
 *
 * The committed Phase-1 `RootPathResolver` (`path -> string | null`) cannot
 * express these failure kinds; `fromRootPathResolver` adapts it for callers
 * that already own a Phase-1 resolver (a `null` result maps to `not-found`).
 *
 * The resolver grants no authority and performs no action inside the
 * containment core; every decision performs exactly one resolver invocation
 * (no re-resolution, so no repeated-evidence inconsistency within a single
 * decision).
 */
import type { RootPathResolver } from './roots.js';

export type ExistingPathResolutionFailureCode = 'not-found' | 'loop' | 'error';

export interface ExistingPathResolutionSuccess {
  readonly ok: true;
  /** Resolved canonical existing path (absolute; re-canonicalized by the core). */
  readonly canonical: string;
}

export interface ExistingPathResolutionFailure {
  readonly ok: false;
  readonly code: ExistingPathResolutionFailureCode;
}

export type ExistingPathResolution = ExistingPathResolutionSuccess | ExistingPathResolutionFailure;

/**
 * Injected trusted existing-path resolver. Supplied by a trusted
 * host-boundary caller (e.g. WP-7); never invoked on request-supplied
 * absolute paths.
 */
export type ExistingPathResolver = (absolutePath: string) => ExistingPathResolution;

/** Adapt the committed Phase-1 RootPathResolver to the typed Phase-2A boundary. */
export function fromRootPathResolver(resolver: RootPathResolver): ExistingPathResolver {
  return (absolutePath: string): ExistingPathResolution => {
    const resolved = resolver(absolutePath);
    return resolved === null
      ? { ok: false, code: 'not-found' }
      : { ok: true, canonical: resolved };
  };
}
