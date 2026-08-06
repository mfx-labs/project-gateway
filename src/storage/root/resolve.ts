/**
 * WP-8-C trusted-root resolution and descriptor-bound identity capture
 * (SRX-001…015 at initialization scope; ADR-028 decision A).
 *
 * The trusted parent must already exist; it is never created, chowned, or
 * replaced. The locator is validated only; it is never derived from an
 * environment variable, argv, cwd, request value, repository file, artifact,
 * or WP-8 record (CSR-001). No `process.geteuid()` is used: ownership is
 * verified exclusively through descriptor-bound `fstat` against the
 * configured trusted service UID. No `chown` exists anywhere.
 */
import { openSync, closeSync, fstatSync, lstatSync, realpathSync } from 'node:fs';
import { constants } from 'node:fs';
import type { RootIdentity } from '../types.js';
import { verifyDirectoryStat } from './identity.js';
import { firstForbiddenOverlap } from './overlap.js';

export interface RootValidationResult {
  readonly ok: boolean;
  readonly identity?: RootIdentity;
  readonly code?: string;
  readonly message?: string;
}

const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW } = constants;

/**
 * Validate and capture the trusted parent from the explicit locator.
 * Descriptor-bound: the canonical path is opened with
 * `O_RDONLY|O_DIRECTORY|O_NOFOLLOW` and the identity (device, inode, file
 * type) is captured from the opened descriptor before it is closed.
 */
export function validateAndCaptureParent(locator: string, serviceUid: number, forbiddenRoots: readonly string[]): RootValidationResult {
  if (!locator.startsWith('/')) {
    return { ok: false, code: 'ERR-STO-ROOT-INVALID', message: 'trusted parent locator must be an absolute path' };
  }
  if (locator === '/') {
    return { ok: false, code: 'ERR-STO-ROOT-INVALID', message: 'the filesystem root is a forbidden trusted parent' };
  }
  // SRX-005: the final component of the locator must not be a symbolic link;
  // checked BEFORE canonicalization so a symlink locator fails closed.
  let locatorLstat;
  try {
    locatorLstat = lstatSync(locator);
  } catch {
    return { ok: false, code: 'ERR-STO-ROOT-INVALID', message: 'trusted parent must already exist and be resolvable' };
  }
  if (locatorLstat.isSymbolicLink()) {
    return { ok: false, code: 'ERR-STO-ROOT-INVALID', message: 'the final component of the trusted parent must not be a symbolic link' };
  }
  let canonical: string;
  try {
    canonical = realpathSync(locator);
  } catch {
    return { ok: false, code: 'ERR-STO-ROOT-INVALID', message: 'trusted parent must already exist and be resolvable' };
  }
  if (!canonical.startsWith('/')) {
    return { ok: false, code: 'ERR-STO-ROOT-INVALID', message: 'canonical trusted parent must be absolute' };
  }
  let lstat;
  try {
    lstat = lstatSync(canonical);
  } catch {
    return { ok: false, code: 'ERR-STO-ROOT-INVALID', message: 'trusted parent is not accessible' };
  }
  if (lstat.isSymbolicLink()) {
    return { ok: false, code: 'ERR-STO-ROOT-INVALID', message: 'the final component of the trusted parent must not be a symbolic link' };
  }
  if (!lstat.isDirectory()) {
    return { ok: false, code: 'ERR-STO-ROOT-INVALID', message: 'trusted parent must be a directory' };
  }
  let fd: number | undefined;
  try {
    fd = openSync(canonical, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const stat = fstatSync(fd);
    const verified = verifyDirectoryStat(stat, serviceUid);
    if (!verified.ok) {
      return { ok: false, code: verified.code, message: verified.message };
    }
    return {
      ok: true,
      identity: { canonicalPath: canonical, dev: stat.dev, ino: stat.ino, fileType: 'directory' },
    };
  } catch {
    return { ok: false, code: 'ERR-STO-ROOT-INVALID', message: 'trusted parent could not be opened with no-follow directory semantics' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Overlap check against the supplied forbidden roots (SRX-004/CSR-004). */
export function checkForbiddenRootOverlap(identity: RootIdentity, forbiddenRoots: readonly string[]): RootValidationResult {
  const overlap = firstForbiddenOverlap(identity.canonicalPath, forbiddenRoots);
  if (overlap !== undefined) {
    return { ok: false, code: 'ERR-STO-ROOT-INVALID', message: 'trusted parent overlaps a forbidden root' };
  }
  return { ok: true, identity };
}

/**
 * Point-of-use revalidation: the canonical path's descriptor identity must
 * still equal the captured identity (SRX-010/013 at initialization scope).
 */
export function revalidateParentIdentity(identity: RootIdentity, serviceUid: number): RootValidationResult {
  let fd: number | undefined;
  try {
    fd = openSync(identity.canonicalPath, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const stat = fstatSync(fd);
    const verified = verifyDirectoryStat(stat, serviceUid);
    if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
    if (stat.dev !== identity.dev || stat.ino !== identity.ino) {
      return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'trusted parent identity changed since capture' };
    }
    return { ok: true, identity };
  } catch {
    return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'trusted parent identity could not be revalidated' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
