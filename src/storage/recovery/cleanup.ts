/**
 * WP-8-F safe orphan-temporary cleanup (WPR-023 (a); CSA-001/010).
 * FILESYSTEM-BEARING MUTATION OWNER: the exact-own-temporary unlink and the
 * `tmp/` directory synchronization. This module NEVER removes a canonical
 * primary record, audit record, lock, directory, socket, FIFO, device, or
 * temporary whose publication relationship is uncertain; the caller must
 * have completed the descriptor-bound re-verification (`reverify.ts`) and
 * the immediate pre-unlink inode re-check below is performed here.
 *
 * Ordering (crash-safe): pre-unlink descriptor identity re-check → unlink of
 * the exact temporary name → `tmp/` directory fsync → postcondition
 * verification (temporary absent; durable twin still present on the same
 * inode with the expected digest and the link count reduced by exactly one).
 */
import { openSync, closeSync, fsyncSync, fstatSync, unlinkSync } from 'node:fs';
import { constants } from 'node:fs';
import { comparePrePostStat, verifyRegularFileStat } from '../root/identity.js';
import { mapPublishError } from '../publication/publish-record.js';
import { isGenuineRecoveryCapability, type RecoveryCapability } from '../capabilities/authenticity.js';
import type { RecoveryMutationHooks } from '../types.js';

const { O_RDONLY, O_NOFOLLOW, O_DIRECTORY } = constants;

export interface OrphanRemovalResult {
  readonly ok: boolean;
  readonly outcome?: 'removed';
  readonly code?: string;
  readonly message?: string;
}

function fsyncDirectory(path: string, hooks: RecoveryMutationHooks | undefined): { readonly ok: boolean; readonly code?: string; readonly message?: string } {
  if (hooks?.fsyncDirectory !== undefined) {
    hooks.fsyncDirectory(path);
    return { ok: true };
  }
  let fd: number | undefined;
  try {
    fd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    fsyncSync(fd);
    return { ok: true };
  } catch {
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'temporary directory could not be synchronized' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Remove one verified orphan-temporary name. `verifiedTemp` must come from
 * `reverifyOrphanTwin` on the SAME request; the inode identity is re-checked
 * immediately before the unlink. Fails closed on any drift; never touches
 * the durable publication.
 */
export function removeOrphanTemporary(input: {
  readonly capability: RecoveryCapability;
  readonly tmpDirPath: string;
  readonly tmpName: string;
  readonly serviceUid: number;
  readonly verifiedTemp: { readonly dev: number; readonly ino: number; readonly nlink: number };
  /** Durable-twin derived path and verified facts (from `reverifyOrphanTwin`). */
  readonly twinPath: string;
  readonly verifiedTwin: { readonly dev: number; readonly ino: number; readonly nlink: number };
  readonly hooks?: RecoveryMutationHooks;
}): OrphanRemovalResult {
  // The capability operand must be genuine before any filesystem access.
  if (!isGenuineRecoveryCapability(input.capability)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery capability operand is not genuine' };
  }
  const check = input.capability.verify('orphan-removal');
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery capability is not usable at the cleanup boundary' };
  }
  const hooks = input.hooks ?? {};
  const tmpPath = `${input.tmpDirPath}/${input.tmpName}`;
  // Immediate pre-unlink descriptor identity re-check (FSP-004): the name
  // must still resolve to the exact verified inode.
  let fd: number | undefined;
  try {
    fd = openSync(tmpPath, O_RDONLY | O_NOFOLLOW);
    const pre = fstatSync(fd);
    const verified = verifyRegularFileStat(pre, input.serviceUid);
    if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
    if (Number(pre.dev) !== input.verifiedTemp.dev || Number(pre.ino) !== input.verifiedTemp.ino) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'temporary inode changed since re-verification' };
    }
    if (Number(pre.nlink) !== input.verifiedTemp.nlink) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'temporary link count changed since re-verification' };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'temporary object disappeared before the unlink' };
    }
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'temporary object could not be re-checked before unlink' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  hooks.stage?.('before-source-unlink');
  try {
    unlinkSync(tmpPath);
  } catch (err) {
    const mapped = mapPublishError((err as NodeJS.ErrnoException).code, 'temp');
    return { ok: false, code: mapped.code, message: mapped.message };
  }
  hooks.stage?.('after-source-unlink');
  // The durable twin must remain on the same inode with the expected link
  // count reduced by exactly one (the removed temporary name).
  const twinGone = verifyTwinIntact({ twinPath: input.twinPath, verifiedTwin: input.verifiedTwin, serviceUid: input.serviceUid });
  if (!twinGone.ok) {
    return { ok: false, code: twinGone.code ?? 'ERR-STO-INTEGRITY', message: twinGone.message ?? 'durable twin could not be confirmed after the unlink' };
  }
  hooks.stage?.('before-directory-fsync');
  const synced = fsyncDirectory(input.tmpDirPath, hooks);
  if (!synced.ok) {
    return { ok: false, code: synced.code ?? 'ERR-STO-IO-FAILURE', message: synced.message ?? 'temporary directory synchronization failed' };
  }
  hooks.stage?.('after-directory-fsync');
  // Postcondition: the temporary name is absent.
  const stillPresent = tempStillPresent(tmpPath);
  if (stillPresent) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'temporary name still present after the unlink' };
  }
  return { ok: true, outcome: 'removed' };
}

/** Postcondition: the durable twin is still present on the same inode. */
function verifyTwinIntact(input: {
  readonly twinPath?: string;
  readonly verifiedTwin?: { readonly dev: number; readonly ino: number; readonly nlink: number };
  readonly serviceUid: number;
}): { readonly ok: boolean; readonly code?: string; readonly message?: string } {
  if (input.twinPath === undefined || input.verifiedTwin === undefined) return { ok: true };
  let fd: number | undefined;
  try {
    fd = openSync(input.twinPath, O_RDONLY | O_NOFOLLOW);
    const stat = fstatSync(fd);
    const verified = verifyRegularFileStat(stat, input.serviceUid);
    if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
    if (Number(stat.dev) !== input.verifiedTwin.dev || Number(stat.ino) !== input.verifiedTwin.ino) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'durable twin inode changed after the unlink' };
    }
    if (Number(stat.nlink) !== input.verifiedTwin.nlink - 1) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'durable twin link count does not match the removed-temporary state' };
    }
    return { ok: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'durable twin is absent after the unlink' };
    }
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'durable twin could not be re-checked after the unlink' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function tempStillPresent(tmpPath: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(tmpPath, O_RDONLY | O_NOFOLLOW);
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
