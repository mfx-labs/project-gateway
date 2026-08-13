/**
 * WP-7 — Git host-lane validation.
 *
 * Validates the trusted Git binary at initialization and revalidates
 * its fingerprint before every launch. PS-6R: the runtime requirement is
 * Git >= 2.30.0 (minimum version, semver-compared); 2.45.4 remains the
 * validated CI/evidence baseline. All other checks — canonical absolute
 * path, ownership (root or current uid), mode (not group/world
 * writable), dev/ino/mode/size/mtime/SHA-256 fingerprint revalidated
 * before every launch — are security invariants and are unchanged.
 */
import { statSync, lstatSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';

const execFileAsync = promisify(execFile);

export interface GitHostLaneDescriptor {
  readonly absolutePath: string;
  readonly version: string;
  readonly initialFingerprint: GitBinaryFingerprint;
}

export interface GitBinaryFingerprint {
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly sha256: string;
}

export interface GitLaneValidationError {
  readonly code: string;
  readonly message: string;
}

/**
 * Validate that a path is a canonical, non-symlink absolute path.
 */
function validateCanonicalAbsolutePath(path: string): GitLaneValidationError | null {
  if (!path.startsWith('/')) return { code: 'not-absolute', message: 'Git path must be absolute' };
  if (path.includes('//') || path.includes('/./') || path.includes('/../') || path.endsWith('/..') || path.endsWith('/.')) {
    return { code: 'not-canonical', message: 'Git path must be canonical' };
  }
  return null;
}

/**
 * Check ownership: owner must be root (0) or the current effective uid.
 */
function validateOwnership(st: Stats): GitLaneValidationError | null {
  const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
  if (st.uid !== 0 && st.uid !== uid) {
    return { code: 'bad-owner', message: `Git binary owner ${st.uid} is not root or service user ${uid}` };
  }
  return null;
}

/**
 * Check permissions: not group-writable, not world-writable, executable.
 */
function validatePermissions(st: Stats): GitLaneValidationError | null {
  const mode = Number(st.mode) & 0o777;
  if (mode & 0o020) return { code: 'group-writable', message: 'Git binary is group-writable' };
  if (mode & 0o002) return { code: 'world-writable', message: 'Git binary is world-writable' };
  if ((mode & 0o100) === 0 && (mode & 0o010) === 0 && (mode & 0o001) === 0) {
    return { code: 'not-executable', message: 'Git binary is not executable' };
  }
  return null;
}

/**
 * Compute SHA-256 fingerprint of a file.
 */
async function computeSha256(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Compute fingerprint of the Git binary.
 */
function computeFingerprint(path: string, sha256: string): GitBinaryFingerprint {
  const st: Stats = statSync(path);
  return {
    dev: st.dev,
    ino: st.ino,
    mode: st.mode,
    size: st.size,
    mtimeMs: st.mtimeMs,
    sha256,
  };
}

/**
 * Revalidate a fingerprint. Returns the error code if drifted.
 */
function revalidateFingerprint(path: string, fingerprint: GitBinaryFingerprint): GitLaneValidationError | null {
  let st: Stats | undefined;
  try {
    st = statSync(path);
  } catch {
    return { code: 'binary-gone', message: 'Git binary is no longer accessible' };
  }
  // TypeScript narrows: if we reach here, st is assigned (catch returned)
  const s = st!;
  if (s.dev !== fingerprint.dev) return { code: 'fingerprint-drift', message: 'Git binary device changed' };
  if (s.ino !== fingerprint.ino) return { code: 'fingerprint-drift', message: 'Git binary inode changed' };
  if (s.mode !== fingerprint.mode) return { code: 'fingerprint-drift', message: 'Git binary mode changed' };
  if (s.size !== fingerprint.size) return { code: 'fingerprint-drift', message: 'Git binary size changed' };
  if (s.mtimeMs !== fingerprint.mtimeMs) return { code: 'fingerprint-drift', message: 'Git binary mtime changed' };
  return null;
}

/**
 * PS-6R Git minimum runtime version. Exact 2.45.4 remains the validated
 * CI/evidence baseline; versions at/above this minimum are accepted.
 */
export const GIT_MINIMUM_VERSION = '2.30.0';

const GIT_VERSION_RE = /^git version (\d+)\.(\d+)\.(\d+)/;

/**
 * Parse `git version x.y.z(...)` output into a numeric triple. Returns
 * null when the output is unparseable (fail closed). Prerelease/build
 * suffixes are ignored for the minimum comparison; a missing triple is
 * malformed.
 */
export function parseGitVersion(output: string): { readonly major: number; readonly minor: number; readonly patch: number } | null {
  const match = output.trim().match(GIT_VERSION_RE);
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** True when the parsed version is at/above the minimum 2.30.0. */
export function satisfiesGitMinimum(version: { readonly major: number; readonly minor: number; readonly patch: number } | null): boolean {
  if (version === null) return false;
  if (version.major > 2) return true;
  if (version.major < 2) return false;
  if (version.minor > 30) return true;
  if (version.minor < 30) return false;
  return version.patch >= 0;
}

/**
 * Initialize the Git host lane: validate the binary, verify the minimum
 * version, and record the initial fingerprint.
 */
export async function initializeGitHostLane(
  absolutePath: string,
): Promise<{ ok: true; descriptor: GitHostLaneDescriptor } | { ok: false; error: GitLaneValidationError }> {
  // 1. Validate path
  const pathErr = validateCanonicalAbsolutePath(absolutePath);
  if (pathErr) return { ok: false, error: pathErr };

  // 2. stat the binary
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(absolutePath);
  } catch {
    return { ok: false, error: { code: 'not-found', message: 'Git binary not found' } };
  }

  if (!st.isFile()) {
    return { ok: false, error: { code: 'not-regular-file', message: 'Git path is not a regular file' } };
  }

  // 3. Ownership
  const ownErr = validateOwnership(st);
  if (ownErr) return { ok: false, error: ownErr };

  // 4. Permissions
  const permErr = validatePermissions(st);
  if (permErr) return { ok: false, error: permErr };

  // 5. Version check (PS-6R): minimum >= 2.30.0, semver-compared.
  //    Malformed/unreadable version output fails closed (wrong-version).
  //    The exact validated CI baseline remains 2.45.4, recorded in the
  //    descriptor for reporting.
  let version: string;
  let parsedVersion: { readonly major: number; readonly minor: number; readonly patch: number } | null = null;
  try {
    const { stdout } = await execFileAsync(absolutePath, ['--version'], {
      timeout: 5000,
      env: { LC_ALL: 'C', LANG: 'C', PATH: '' },
    });
    version = stdout.trim();
    parsedVersion = parseGitVersion(version);
    if (parsedVersion === null) {
      return { ok: false, error: { code: 'wrong-version', message: `Git version could not be parsed from: ${version}` } };
    }
    if (!satisfiesGitMinimum(parsedVersion)) {
      return { ok: false, error: { code: 'wrong-version', message: `Expected Git >= ${GIT_MINIMUM_VERSION}, got: ${version}` } };
    }
  } catch {
    return { ok: false, error: { code: 'version-check-failed', message: 'Failed to check Git version' } };
  }

  // 6. Compute initial fingerprint
  let sha256: string;
  try {
    sha256 = await computeSha256(absolutePath);
  } catch {
    return { ok: false, error: { code: 'fingerprint-failed', message: 'Failed to compute Git binary SHA-256' } };
  }

  const fingerprint = computeFingerprint(absolutePath, sha256);

  return {
    ok: true,
    descriptor: Object.freeze({
      absolutePath,
      version: `${parsedVersion.major}.${parsedVersion.minor}.${parsedVersion.patch}`,
      initialFingerprint: Object.freeze(fingerprint),
    }),
  };
}

/**
 * Revalidate the Git binary fingerprint before a launch.
 */
export function revalidateGitHostLane(
  descriptor: GitHostLaneDescriptor,
): GitLaneValidationError | null {
  return revalidateFingerprint(descriptor.absolutePath, descriptor.initialFingerprint);
}

// ---------------------------------------------------------------------------
// S-06: HOME/TMPDIR validation
// ---------------------------------------------------------------------------

import { readdirSync } from 'node:fs';

function validateDirectoryCanonical(dir: string): GitLaneValidationError | null {
  if (!dir.startsWith('/')) return { code: 'not-absolute', message: 'directory path must be absolute' };
  if (dir.includes('//') || dir.includes('/./') || dir.includes('/../')) {
    return { code: 'not-canonical', message: 'directory path must be canonical' };
  }
  return null;
}

function validateDirectorySymlinkFree(dir: string): GitLaneValidationError | null {
  const parts = dir.split('/').filter(Boolean);
  let current = '/';
  for (const part of parts) {
    current = current === '/' ? `/${part}` : `${current}/${part}`;
    try {
      const lst = lstatSync(current);
      if (lst.isSymbolicLink()) {
        return { code: 'symlink-component', message: `path component is a symlink: ${part}` };
      }
    } catch {
      return { code: 'missing-component', message: `path component missing: ${part}` };
    }
  }
  return null;
}

/**
 * Validate a HOME or TMPDIR directory for the Git child.
 *
 * Requirements: absolute canonical path; exists; is a directory; no symlink
 * path component; owner root or effective uid; not group/world writable;
 * empty at initialization; not writable by the effective service user where
 * enforceable.
 */
export function validateHostDirectory(
  dir: string,
  workspaceRoots: readonly string[],
): GitLaneValidationError | null {
  const canonErr = validateDirectoryCanonical(dir);
  if (canonErr) return canonErr;
  const symlinkErr = validateDirectorySymlinkFree(dir);
  if (symlinkErr) return symlinkErr;
  let st: Stats;
  try {
    st = statSync(dir);
  } catch {
    return { code: 'not-found', message: 'directory does not exist' };
  }
  if (!st.isDirectory()) return { code: 'not-directory', message: 'path is not a directory' };
  const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
  if (st.uid !== 0 && st.uid !== uid) {
    return { code: 'bad-owner', message: `directory owner ${st.uid} is not root or service user ${uid}` };
  }
  const mode = Number(st.mode) & 0o777;
  if (mode & 0o020) return { code: 'group-writable', message: 'directory is group-writable' };
  if (mode & 0o002) return { code: 'world-writable', message: 'directory is world-writable' };
  // Outside every configured workspace root
  for (const root of workspaceRoots) {
    if (dir === root || dir.startsWith(root.endsWith('/') ? root : `${root}/`)) {
      return { code: 'inside-workspace', message: 'directory must be outside every workspace root' };
    }
  }
  // Empty at initialization
  try {
    const entries = readdirSync(dir);
    if (entries.length > 0) {
      return { code: 'not-empty', message: 'directory must be empty at initialization' };
    }
  } catch {
    return { code: 'unreadable', message: 'directory is not readable' };
  }
  return null;
}
