/**
 * WP-8-I executable-disposition mutation owner (ADR-032; §3/§12). The ONLY
 * filesystem mutation primitive for externally authorized disposition:
 * unlink exactly one verified name, verify absence, and fsync the exact
 * containing directory. No rename, no byte copy, no recursive removal, no
 * rmdir, no chmod/chown repair, no overwrite, no arbitrary path — the
 * target path is derived internally by the composition boundary from the
 * verified quarantine/index observation, never taken from a caller.
 *
 * Confinement (static-guard enforced): this module's fs allowlist is
 * exactly `openSync, closeSync, fstatSync, unlinkSync, fsyncSync,
 * constants`; it is imported in production only by
 * `src/storage/recovery/execute.ts`; the WPR-023 (d) adjudication flow
 * never reaches it (only the two executable disposition flows do).
 */
import { openSync, closeSync, fstatSync, unlinkSync, fsyncSync } from 'node:fs';
import { constants } from 'node:fs';

const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW, O_NONBLOCK } = constants;

export interface DispositionUnlinkResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
}

/**
 * Descriptor-bound pre-unlink identity recheck + exact-name unlink +
 * absence verification (§3.12–14): opens the exact name no-follow,
 * verifies the descriptor identity (dev/ino) and link count still equal
 * the verified facts from the classification re-verification, closes,
 * unlinks exactly that one name, and verifies the name is absent (a
 * reappearing or replaced name fails closed). A directory, symlink,
 * socket, FIFO, device, wrong-UID/mode object, or changed inode fails
 * closed before any unlink.
 */
export function unlinkVerifiedTarget(input: {
  readonly targetPath: string;
  readonly serviceUid: number;
  /** Descriptor facts from the immediate classification re-verification. */
  readonly expected: { readonly dev: number; readonly ino: number; readonly nlink: number };
}): DispositionUnlinkResult {
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
      return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'permission denied at the disposition boundary' };
    }
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'disposition unlink boundary operation failed' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * fsync the exact containing directory of the unlinked name (§3.15):
 * no-follow descriptor open of the directory, fsync, close. A missing,
 * replaced, symlinked, or non-directory parent fails closed.
 */
export function fsyncContainingDirectory(input: { readonly directoryPath: string; readonly serviceUid: number }): DispositionUnlinkResult {
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
