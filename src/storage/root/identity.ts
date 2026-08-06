/**
 * WP-8-C pure directory-stat verification (SRX-006/007/014).
 *
 * Pure predicate over a stat-shaped object so that wrong-UID/wrong-mode
 * coverage is deterministic via synthetic stats (root privileges never
 * required). Exact-mode policy: directories `0700`, group/other bits zero;
 * owner UID must equal the configured trusted service UID; unverifiable
 * state fails closed (SRX-008/015).
 */
export interface DirectoryStatLike {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  isFile(): boolean;
  readonly uid: number;
  readonly mode: number;
  readonly dev: number;
  readonly ino: number;
  readonly nlink: number;
  readonly size: number;
}

export interface StatVerification {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
}

/** Directory exact-mode policy: owner rwx only. */
export function verifyDirectoryStat(stat: DirectoryStatLike, expectedUid: number): StatVerification {
  if (!stat.isDirectory()) {
    return { ok: false, code: 'ERR-STO-ROOT-INVALID', message: 'expected a directory' };
  }
  if (stat.isSymbolicLink()) {
    return { ok: false, code: 'ERR-STO-ROOT-INVALID', message: 'symbolic links are not accepted at a root boundary' };
  }
  if (stat.uid !== expectedUid) {
    return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'directory owner is not the configured trusted service UID' };
  }
  const mode = stat.mode & 0o777;
  if (mode !== 0o700) {
    return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'directory mode must be exactly 0700 with no group or other access' };
  }
  return { ok: true };
}

/** Regular-file exact-mode policy for metadata: `0600`. */
export function verifyRegularFileStat(stat: DirectoryStatLike, expectedUid: number): StatVerification {
  if (!stat.isFile()) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'expected a regular file' };
  }
  if (stat.uid !== expectedUid) {
    return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'file owner is not the configured trusted service UID' };
  }
  const mode = stat.mode & 0o777;
  if (mode !== 0o600) {
    return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'file mode must be exactly 0600 with no group or other access' };
  }
  return { ok: true };
}

export interface PrePostComparison {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
}

/**
 * Mandatory pre/post descriptor revalidation (W8C-D13): after a
 * descriptor-based read, the post-read stat must match the pre-read stat on
 * device, inode, regular-file type, UID, exact mode, and size. Any divergence
 * fails closed.
 */
export function comparePrePostStat(pre: DirectoryStatLike, post: DirectoryStatLike): PrePostComparison {
  if (pre.dev !== post.dev || pre.ino !== post.ino) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'file identity changed during descriptor-based read' };
  }
  if (pre.isFile() !== post.isFile() || pre.isDirectory() !== post.isDirectory() || pre.isSymbolicLink() !== post.isSymbolicLink()) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'file type changed during descriptor-based read' };
  }
  if (pre.uid !== post.uid) {
    return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'file owner changed during descriptor-based read' };
  }
  if ((pre.mode & 0o777) !== (post.mode & 0o777)) {
    return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'file mode changed during descriptor-based read' };
  }
  if (pre.size !== post.size) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'file size changed during descriptor-based read' };
  }
  return { ok: true };
}
