/**
 * WP-8-L exact retention-deletion mutation owner (contract §15.4; ADR-035).
 * The ONLY filesystem mutation primitive for authorized retention deletion:
 * descriptor-bound no-follow re-verification of the exact derived target
 * (regular file, exact service UID, exact mode `0600`, bounded size, exact
 * dev/ino/nlink, exact canonical-byte digest), unlink of exactly that one
 * name, absence verification, and fsync of the exact containing directory.
 * No rename, no byte copy, no recursive removal, no rmdir, no chmod/chown
 * repair, no overwrite, no glob, no arbitrary path — the target path is
 * derived internally by the composition boundary from verified logical
 * facts, never taken from a caller (FSP; §15.4).
 *
 * Confinement (static-guard enforced): this module's fs allowlist is
 * exactly `openSync, closeSync, fstatSync, readFileSync, unlinkSync,
 * fsyncSync, constants`; it is imported in production only by
 * `src/storage/retention/execute.ts`.
 */
import { openSync, closeSync, fstatSync, readFileSync, unlinkSync, fsyncSync } from 'node:fs';
import { constants } from 'node:fs';
import { computeDomainDigest, STORAGE_RECORD_BYTES_DIGEST_DOMAIN } from '../format/envelope.js';

const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW, O_NONBLOCK } = constants;

export interface RetentionUnlinkResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
}

/**
 * Descriptor-bound pre-unlink recheck + exact-name unlink + absence
 * verification + containing-directory fsync (§15.4 mutation sequence):
 * opens the exact name no-follow, verifies the descriptor identity
 * (dev/ino/nlink), type, owner, exact mode, size bound, and the exact
 * canonical-byte digest, closes, unlinks exactly that one name, verifies
 * the name is absent (a reappearing or replaced name fails closed), and
 * fsyncs the exact containing directory. A directory, symlink, socket,
 * FIFO, device, wrong-UID/mode object, changed inode/link-count, or
 * changed bytes fails closed before any unlink.
 */
export function unlinkVerifiedRecordObject(input: {
  readonly targetPath: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  /** Descriptor facts from the immediate re-verification (verifyRecordObjectAt). */
  readonly expected: { readonly dev: number; readonly ino: number; readonly nlink: number };
  /** Exact canonical record-bytes digest of the target. */
  readonly expectedDigest: string;
}): RetentionUnlinkResult {
  let fd: number | undefined;
  try {
    fd = openSync(input.targetPath, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const pre = fstatSync(fd);
    if (!pre.isFile()) {
      return { ok: false, code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'target is not a regular file; fail closed before unlink' };
    }
    if (pre.uid !== input.serviceUid || (pre.mode & 0o777) !== 0o600) {
      return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'target violates the store permission policy; fail closed before unlink' };
    }
    if (Number(pre.dev) !== input.expected.dev || Number(pre.ino) !== input.expected.ino) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'target inode changed since re-verification; fail closed before unlink' };
    }
    if (Number(pre.nlink) !== input.expected.nlink) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'target link count changed since re-verification; fail closed before unlink' };
    }
    if (pre.size > input.byteLimit) {
      return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'target exceeds the bounded byte limit; fail closed before unlink' };
    }
    const bytes = readFileSync(fd);
    const digest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, bytes.toString('utf8'));
    if (digest !== input.expectedDigest) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'target bytes changed since re-verification; fail closed before unlink' };
    }
    closeSync(fd);
    fd = undefined;
    unlinkSync(input.targetPath);
    // Absence verification: the exact name must no longer resolve.
    try {
      const goneFd = openSync(input.targetPath, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
      closeSync(goneFd);
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'target name reappeared immediately after unlink; fail closed' };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'target name state is uncertain after unlink; fail closed' };
      }
    }
    return { ok: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'target is absent before unlink' };
    }
    if (code === 'ELOOP' || code === 'ENXIO' || code === 'ENODEV' || code === 'EISDIR' || code === 'ENOTDIR') {
      return { ok: false, code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'target location is not a regular file; fail closed before unlink' };
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'permission denied at the retention deletion boundary' };
    }
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'retention unlink boundary operation failed' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * fsync the exact containing directory of the unlinked name (§15.4):
 * no-follow descriptor open of the directory, fsync, close. A missing,
 * replaced, symlinked, or non-directory parent fails closed.
 */
export function fsyncRetentionDirectory(input: { readonly directoryPath: string; readonly serviceUid: number; readonly hooks?: { readonly fsyncDirectory?: (path: string) => void } }): RetentionUnlinkResult {
  let fd: number | undefined;
  try {
    fd = openSync(input.directoryPath, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const st = fstatSync(fd);
    if (!st.isDirectory()) {
      return { ok: false, code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'containing directory is not a directory' };
    }
    if (st.uid !== input.serviceUid || (st.mode & 0o777) !== 0o700) {
      return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'containing directory violates the store permission policy' };
    }
    if (input.hooks?.fsyncDirectory !== undefined) input.hooks.fsyncDirectory(input.directoryPath);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    return { ok: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'containing directory is absent after unlink' };
    }
    if (code === 'ELOOP' || code === 'ENOTDIR') {
      return { ok: false, code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'containing directory location is not a directory' };
    }
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'containing directory fsync failed' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
