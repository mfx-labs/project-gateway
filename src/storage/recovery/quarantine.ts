/**
 * WP-8-F quarantine-temporary mutation owner (ADR-030; §16.5, QRN-001…006).
 * FILESYSTEM-BEARING MUTATION OWNER: exact quarantine-directory
 * provisioning (mkdir), the same-filesystem hard-link plus unlink
 * primitive, and the required directory fsyncs. NEVER uses `rename`, byte
 * copying, overwrite, chmod/chown repair, or rollback of an established
 * quarantine destination; NEVER quarantines canonical records, audit
 * records, locks, directories, symlinks, sockets, FIFOs, devices, or
 * objects with an uncertain link state; the source must have been
 * re-verified by `reverify.ts` on the same request before this module
 * runs.
 *
 * Collision and idempotency states (§16.5): source present (nlink 1) +
 * destination absent → normal execution; source present (nlink 2) +
 * destination present + same verified inode → interrupted-link
 * continuation from the source unlink; source absent + destination
 * present + exact object → evidence roll-forward or already-completed
 * (evidence decision by the caller); source present + destination present
 * + different inode or content → fail closed; source absent + destination
 * absent → fail closed; unknown second link (nlink 2, destination absent)
 * → fail closed as uncertain.
 */
import { mkdirSync, openSync, closeSync, fsyncSync, fstatSync, linkSync, unlinkSync } from 'node:fs';
import { constants } from 'node:fs';
import { verifyDirectoryStat, verifyRegularFileStat } from '../root/identity.js';
import { mapPublishError } from '../publication/publish-record.js';
import { isGenuineRecoveryCapability, type RecoveryCapability } from '../capabilities/authenticity.js';
import { verifyQuarantineObjectDigest } from './reverify.js';
import { verifyExistingQuarantineEvidence } from './evidence.js';
import type { RecoveryMutationHooks } from '../types.js';

const { O_RDONLY, O_NOFOLLOW, O_DIRECTORY } = constants;

/** Fixed quarantine directory mode (same policy as all store directories). */
const QUARANTINE_DIR_MODE = 0o700;

export interface QuarantineExecutionResult {
  readonly ok: boolean;
  readonly outcome?: 'quarantined' | 'already-completed';
  /** True when the recovery evidence was already durable with a matching binding. */
  readonly evidenceAlreadyDurable?: boolean;
  readonly quarantineId?: string;
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
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'directory could not be synchronized' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Provision and verify exactly `quarantine/`, `quarantine/temporary/`, and
 * `quarantine/temporary/<shard>/` under the writer lock (QRN; §16.5).
 * Absent directories may be created; existing directories are verified
 * no-follow with the exact UID/mode; a symlink, special file, wrong UID,
 * wrong mode, or replacement fails closed; created parents are fsynced.
 */
function ensureQuarantineDirectories(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly shard: string;
  readonly hooks: RecoveryMutationHooks | undefined;
}): { readonly ok: boolean; readonly code?: string; readonly message?: string } {
  const dirs = [
    `${input.namespaceRoot}/quarantine`,
    `${input.namespaceRoot}/quarantine/temporary`,
    `${input.namespaceRoot}/quarantine/temporary/${input.shard}`,
  ];
  const createdParents: string[] = [];
  for (const dir of dirs) {
    let createdNow = false;
    try {
      mkdirSync(dir, QUARANTINE_DIR_MODE);
      createdNow = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        const mapped = mapPublishError((err as NodeJS.ErrnoException).code, 'dir');
        return { ok: false, code: mapped.code, message: mapped.message };
      }
    }
    let fd: number | undefined;
    try {
      fd = openSync(dir, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
      const stat = fstatSync(fd);
      const verified = verifyDirectoryStat(stat, input.serviceUid);
      if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
      if (createdNow) {
        // WP-8-F correction: the entry of a created directory lives in its
        // PARENT; fsync the parent so the creation is durable. The chain is
        // `quarantine/` → namespace root, `temporary/` → `quarantine/`,
        // shard → `quarantine/temporary/`. Existing directories are never
        // re-fsynced here (no broad fsync authority).
        createdParents.push(dir.slice(0, dir.lastIndexOf('/')));
      }
    } catch {
      return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'quarantine directory could not be verified descriptor-bound' };
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  // fsync the parents of every created directory (crash-safe directory
  // creation; deterministic order: namespace root, quarantine/, temporary/).
  for (const parent of createdParents) {
    const synced = fsyncDirectory(parent, input.hooks);
    if (!synced.ok) return { ok: false, code: synced.code ?? 'ERR-STO-IO-FAILURE', message: synced.message ?? 'quarantine parent directory synchronization failed' };
  }
  return { ok: true };
}

interface DescriptorFacts {
  readonly dev: number;
  readonly ino: number;
  readonly nlink: number;
}

function statDescriptor(path: string, serviceUid: number): { readonly ok: boolean; readonly facts?: DescriptorFacts; readonly code?: string; readonly message?: string } {
  let fd: number | undefined;
  try {
    fd = openSync(path, O_RDONLY | O_NOFOLLOW);
    const pre = fstatSync(fd);
    const verified = verifyRegularFileStat(pre, serviceUid);
    if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
    return { ok: true, facts: { dev: Number(pre.dev), ino: Number(pre.ino), nlink: Number(pre.nlink) } };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'object is absent' };
    }
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'object could not be verified descriptor-bound' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Execute the quarantine-temporary mutation for one re-verified source.
 * `sourceFacts` must come from `reverifyQuarantineSource` on the SAME
 * request; the destination content is verified against the expected source
 * digest in every state.
 */
export function executeQuarantineTemporary(input: {
  readonly capability: RecoveryCapability;
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly targetEntry: string;
  readonly quarantineId: string;
  /** Deterministic quarantine evidence identity (computed by the boundary from the store instance). */
  readonly evidenceId: string;
  readonly expectedSourceDigest: string;
  readonly temporaryBytes: number;
  readonly sourceFacts: { readonly dev: number; readonly ino: number; readonly nlink: number };
  readonly hooks?: RecoveryMutationHooks;
}): QuarantineExecutionResult {
  if (!isGenuineRecoveryCapability(input.capability)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery capability operand is not genuine' };
  }
  const check = input.capability.verify('quarantine-temporary');
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery capability is not usable at the quarantine boundary' };
  }
  const hooks = input.hooks ?? {};
  const shard = input.quarantineId.slice(0, 4);
  const destinationPath = `${input.namespaceRoot}/quarantine/temporary/${shard}/${input.quarantineId}.qtn`;
  const tmpDirPath = `${input.namespaceRoot}/tmp`;
  const sourcePath = `${tmpDirPath}/${input.targetEntry}`;
  const evidenceId = input.evidenceId;

  // Provision and verify the exact quarantine directories (16.5 order step 9).
  const provisioned = ensureQuarantineDirectories({ namespaceRoot: input.namespaceRoot, serviceUid: input.serviceUid, shard, hooks });
  if (!provisioned.ok) {
    return { ok: false, code: provisioned.code ?? 'ERR-STO-IO-FAILURE', message: provisioned.message ?? 'quarantine directory provisioning failed' };
  }
  hooks.stage?.('after-quarantine-directory-provisioning');

  const dest = statDescriptor(destinationPath, input.serviceUid);
  const destPresent = dest.ok && dest.facts !== undefined;
  const source = statDescriptor(sourcePath, input.serviceUid);
  const sourcePresent = source.ok && source.facts !== undefined;

  // Destination content must be exact in every present state.
  if (destPresent) {
    const destExact = verifyQuarantineObjectDigest({ path: destinationPath, serviceUid: input.serviceUid, byteLimit: input.temporaryBytes, expectedDigest: input.expectedSourceDigest });
    if (!destExact.ok) {
      return { ok: false, code: destExact.code ?? 'ERR-STO-INTEGRITY', message: destExact.message ?? 'quarantine destination content does not match the expected source digest' };
    }
  }

  if (!destPresent) {
    // SOURCE PRESENT, DESTINATION ABSENT → normal execution.
    if (!sourcePresent) {
      return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'quarantine source and destination are both absent; no success is inferred' };
    }
    if (source.facts!.nlink !== 1) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'quarantine source has an uncertain link state (nlink !== 1) with no destination' };
    }
    // Any existing evidence (matching or conflicting) with a missing
    // destination fails closed (16.5): matching evidence but destination
    // missing is an integrity failure; conflicting evidence fails closed.
    const evidenceState = checkQuarantineEvidence(evidenceId, input);
    if (!evidenceState.ok || evidenceState.matches) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'quarantine evidence exists but the destination is missing; fail closed' };
    }
    return linkAndRemove({ ...input, sourcePath, destinationPath, sourceFacts: source.facts!, hooks, destinationAlreadyLinked: false, evidenceAlreadyDurable: false });
  }

  const destFacts = dest.facts!;
  if (!sourcePresent) {
    // SOURCE ABSENT, DESTINATION PRESENT: exact object (digest verified
    // above) with the completed link count; the evidence decision is made
    // by the caller.
    if (destFacts.nlink !== 1) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'quarantine destination link count does not match a completed quarantine' };
    }
    const evidenceState = checkQuarantineEvidence(evidenceId, input);
    if (!evidenceState.ok) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'existing quarantine evidence conflicts with the authorized request' };
    }
    if (evidenceState.matches) {
      return { ok: true, outcome: 'already-completed', evidenceAlreadyDurable: true, quarantineId: input.quarantineId };
    }
    return { ok: true, outcome: 'quarantined', evidenceAlreadyDurable: false, quarantineId: input.quarantineId };
  }

  // SOURCE PRESENT, DESTINATION PRESENT.
  const sourceFacts = source.facts!;
  if (destFacts.dev !== sourceFacts.dev || destFacts.ino !== sourceFacts.ino) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'quarantine destination conflicts with the source; neither object is modified' };
  }
  if (sourceFacts.nlink !== 2 || destFacts.nlink !== 2) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'interrupted quarantine link count is not the expected 2' };
  }
  // Interrupted after the hard link: continue from the source unlink.
  const evidenceState = checkQuarantineEvidence(evidenceId, input);
  if (!evidenceState.ok) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'existing quarantine evidence conflicts with the authorized request' };
  }
  return linkAndRemove({ ...input, sourcePath, destinationPath, sourceFacts, hooks, destinationAlreadyLinked: true, evidenceAlreadyDurable: evidenceState.matches });
}

/** Evidence check for a completed quarantine state (matching → already-completed). */
function checkQuarantineEvidence(
  evidenceId: string,
  input: { namespaceRoot: string; serviceUid: number; temporaryBytes: number; quarantineId: string; expectedSourceDigest: string; targetEntry: string },
): { readonly ok: boolean; readonly matches: boolean } {
  const check = verifyExistingQuarantineEvidence({
    namespaceRoot: input.namespaceRoot,
    serviceUid: input.serviceUid,
    byteLimit: input.temporaryBytes,
    evidenceId,
    quarantineId: input.quarantineId,
    sourceDigest: input.expectedSourceDigest,
    sourceEntry: input.targetEntry,
  });
  if (!check.ok) {
    return { ok: false, matches: false };
  }
  return { ok: true, matches: check.matches === true };
}

/** Link (or continue) + unlink half of the quarantine mutation. */
function linkAndRemove(input: {
  readonly capability: RecoveryCapability;
  readonly serviceUid: number;
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly sourceFacts: { readonly dev: number; readonly ino: number; readonly nlink: number };
  readonly hooks: RecoveryMutationHooks;
  readonly destinationAlreadyLinked: boolean;
  readonly evidenceAlreadyDurable: boolean;
  readonly quarantineId: string;
}): QuarantineExecutionResult {
  const hooks = input.hooks;
  let destinationFacts: DescriptorFacts;
  if (!input.destinationAlreadyLinked) {
    hooks.stage?.('before-destination-link');
    try {
      linkSync(input.sourcePath, input.destinationPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        const mapped = mapPublishError(code, 'link');
        return { ok: false, code: mapped.code, message: mapped.message };
      }
      // The destination appeared between the state check and the link:
      // classify exactly; never overwrite or unlink.
      const recheck = statDescriptor(input.destinationPath, input.serviceUid);
      if (!recheck.ok || recheck.facts === undefined) {
        return { ok: false, code: recheck.code ?? 'ERR-STO-INTEGRITY', message: recheck.message ?? 'quarantine destination appeared but could not be verified' };
      }
      if (recheck.facts.dev !== input.sourceFacts.dev || recheck.facts.ino !== input.sourceFacts.ino) {
        return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'quarantine destination conflicts with the source; neither object is modified' };
      }
      destinationFacts = recheck.facts;
    }
    hooks.stage?.('after-destination-link');
    const sourceAfterLink = statDescriptor(input.sourcePath, input.serviceUid);
    if (!sourceAfterLink.ok || sourceAfterLink.facts === undefined) {
      return { ok: false, code: sourceAfterLink.code ?? 'ERR-STO-INTEGRITY', message: sourceAfterLink.message ?? 'quarantine source could not be re-verified after the link' };
    }
    if (sourceAfterLink.facts.dev !== input.sourceFacts.dev || sourceAfterLink.facts.ino !== input.sourceFacts.ino) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'quarantine source inode changed during the link' };
    }
    const destStat = statDescriptor(input.destinationPath, input.serviceUid);
    if (!destStat.ok || destStat.facts === undefined) {
      return { ok: false, code: destStat.code ?? 'ERR-STO-INTEGRITY', message: destStat.message ?? 'quarantine destination could not be verified after the link' };
    }
    destinationFacts = destStat.facts;
    if (destinationFacts.dev !== input.sourceFacts.dev || destinationFacts.ino !== input.sourceFacts.ino) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'quarantine destination is not the same inode as the source' };
    }
    if (destinationFacts.nlink !== input.sourceFacts.nlink + 1) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'quarantine link count did not transition from 1 to 2' };
    }
  } else {
    destinationFacts = { dev: input.sourceFacts.dev, ino: input.sourceFacts.ino, nlink: input.sourceFacts.nlink };
  }
  // Destination shard-directory fsync BEFORE the source unlink (16.5 order).
  hooks.stage?.('before-destination-directory-fsync');
  const destDir = input.destinationPath.slice(0, input.destinationPath.lastIndexOf('/'));
  const destSynced = fsyncDirectory(destDir, hooks);
  if (!destSynced.ok) {
    return { ok: false, code: destSynced.code ?? 'ERR-STO-IO-FAILURE', message: destSynced.message ?? 'quarantine destination directory synchronization failed' };
  }
  hooks.stage?.('after-destination-directory-fsync');
  // Immediately reverify the source name still maps to the same inode.
  const sourceBeforeUnlink = statDescriptor(input.sourcePath, input.serviceUid);
  if (!sourceBeforeUnlink.ok || sourceBeforeUnlink.facts === undefined) {
    return { ok: false, code: sourceBeforeUnlink.code ?? 'ERR-STO-INTEGRITY', message: sourceBeforeUnlink.message ?? 'quarantine source could not be re-verified before unlink' };
  }
  if (sourceBeforeUnlink.facts.dev !== input.sourceFacts.dev || sourceBeforeUnlink.facts.ino !== input.sourceFacts.ino) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'quarantine source inode changed before the unlink' };
  }
  hooks.stage?.('before-source-unlink');
  try {
    unlinkSync(input.sourcePath);
  } catch (err) {
    const mapped = mapPublishError((err as NodeJS.ErrnoException).code, 'temp');
    return { ok: false, code: mapped.code, message: mapped.message };
  }
  hooks.stage?.('after-source-unlink');
  // Destination must remain intact with the link count 2 → 1.
  const destAfterUnlink = statDescriptor(input.destinationPath, input.serviceUid);
  if (!destAfterUnlink.ok || destAfterUnlink.facts === undefined) {
    return { ok: false, code: destAfterUnlink.code ?? 'ERR-STO-INTEGRITY', message: destAfterUnlink.message ?? 'quarantine destination could not be verified after the unlink' };
  }
  if (destAfterUnlink.facts.dev !== destinationFacts.dev || destAfterUnlink.facts.ino !== destinationFacts.ino) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'quarantine destination inode changed after the unlink' };
  }
  if (destAfterUnlink.facts.nlink !== destinationFacts.nlink - 1) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'quarantine destination link count did not transition from 2 to 1' };
  }
  // Source tmp/ directory fsync (durable source-name removal).
  hooks.stage?.('before-tmp-directory-fsync');
  const tmpDir = input.sourcePath.slice(0, input.sourcePath.lastIndexOf('/'));
  const tmpSynced = fsyncDirectory(tmpDir, hooks);
  if (!tmpSynced.ok) {
    return { ok: false, code: tmpSynced.code ?? 'ERR-STO-IO-FAILURE', message: tmpSynced.message ?? 'temporary directory synchronization failed' };
  }
  hooks.stage?.('after-tmp-directory-fsync');
  // Postcondition: source absent, destination intact.
  const sourceGone = statDescriptor(input.sourcePath, input.serviceUid);
  if (sourceGone.ok) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'quarantine source name still present after the unlink' };
  }
  return { ok: true, outcome: 'quarantined', evidenceAlreadyDurable: input.evidenceAlreadyDurable, quarantineId: input.quarantineId };
}
