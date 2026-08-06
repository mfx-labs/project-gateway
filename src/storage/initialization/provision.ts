/**
 * WP-8-C/WP-8-D fixed-directory provisioning and phase-3 classifier owner
 * (ADR-028 decision E; ADR-029 D-7/M-1/M-2).
 *
 * Initialization creates exactly the bootstrap entries (`metadata`, `tmp`)
 * per namespace (ADR-028; initialization-time phase-3 provisioning is
 * rejected). The phase-3 classifier policy revision (ADR-029 D-7) accepts
 * the five-entry phase-3 set `metadata`, `tmp`, `records`, `audit`, `locks`
 * and classifies phase-2 stores as upgradeable/provisional, never foreign.
 * Phase-3 top-level provisioning (`records`, `audit`, `locks`) is lazy,
 * capability-gated on the initialization-family `provision-phase3`
 * operation, and runs before writer-lock acquisition.
 *
 * Every mutation boundary requires the still-live genuine capability.
 * Target paths must equal one fixed derivation; no arbitrary path operand
 * exists. No recursive creation, no parent creation, no `chown`, no repair,
 * no deletion, no adoption of existing objects.
 *
 * Enumeration (`readdirSync`, human-authorized narrow clarification) is used
 * only to verify the fixed expected entry set and detect unknown entries,
 * always bracketed by descriptor verification: open with
 * `O_RDONLY|O_DIRECTORY|O_NOFOLLOW`, capture pre-enumeration identity,
 * enumerate the exact fixed path, re-open/re-stat, and compare device,
 * inode, type, UID, and mode — any divergence fails closed.
 */
import { mkdirSync, openSync, closeSync, fchmodSync, fstatSync, fsyncSync, readdirSync } from 'node:fs';
import { constants } from 'node:fs';
import type { InitializationCapability, InitializationOperation } from '../capabilities/authenticity.js';
import { verifyDirectoryStat } from '../root/identity.js';
import type { NamespaceIdentity, NamespaceKind, NamespaceState, RootIdentity } from '../types.js';

const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW } = constants;

/** Entries created by WP-8-C initialization (metadata bootstrap scope). */
const NAMESPACE_PROVISIONED_ENTRIES = ['metadata', 'tmp'] as const;

/**
 * Phase-3 classifier fixed entry set (ADR-029 D-7/M-2): the accepted
 * namespace entry set under the classifier-policy revision. `index` and
 * `quarantine` are contract-reserved (5.2) but deferred to phase 4; their
 * presence is an unknown entry and fails closed. This constant is committed
 * implementation code — never request-selectable, never metadata-selected.
 */
export const NAMESPACE_CLASSIFIER_ENTRIES = ['metadata', 'tmp', 'records', 'audit', 'locks'] as const;

/** Phase-3 members beyond the phase-2 set. */
const PHASE3_REQUIRED_EXTRA = ['records', 'audit', 'locks'] as const;

export interface ProvisionResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly identity?: NamespaceIdentity;
  readonly entries?: readonly string[];
}

interface DescriptorSnapshot {
  readonly dev: number;
  readonly ino: number;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
  readonly uid: number;
  readonly mode: number;
}

function snapshotStat(stat: ReturnType<typeof fstatSync>): DescriptorSnapshot {
  return {
    dev: Number(stat.dev),
    ino: Number(stat.ino),
    isDirectory: stat.isDirectory(),
    isFile: stat.isFile(),
    isSymbolicLink: stat.isSymbolicLink(),
    uid: Number(stat.uid),
    mode: Number(stat.mode) & 0o777,
  };
}

function snapshotsEqual(a: DescriptorSnapshot, b: DescriptorSnapshot): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.isDirectory === b.isDirectory &&
    a.isFile === b.isFile &&
    a.isSymbolicLink === b.isSymbolicLink &&
    a.uid === b.uid &&
    a.mode === b.mode
  );
}

/** Open a fixed directory path and return a descriptor snapshot; closes nothing (caller closes). */
function openAndSnapshot(path: string): { fd: number; snapshot: DescriptorSnapshot } {
  const fd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  try {
    return { fd, snapshot: snapshotStat(fstatSync(fd)) };
  } catch (err) {
    closeSync(fd);
    throw err;
  }
}

/**
 * Ensure one fixed directory exists with the exact policy, descriptor-verified
 * after creation (SRX-014). `EEXIST` is accepted only when the existing
 * directory passes the exact descriptor checks; anything else fails closed.
 * The required capability operation is an explicit parameter so the
 * initialization family can gate `namespace-initialize` and
 * `provision-phase3` boundaries distinctly (ADR-029 D-7/M-1).
 */
function ensureFixedDirectory(capability: InitializationCapability, path: string, serviceUid: number, operation: InitializationOperation): ProvisionResult {
  const check = capability.verify(operation);
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'initialization capability is not usable at a provisioning boundary' };
  }
  let created = false;
  try {
    mkdirSync(path, 0o700);
    created = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'fixed directory could not be created' };
    }
  }
  let fd: number | undefined;
  try {
    fd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const stat = fstatSync(fd);
    const verified = verifyDirectoryStat(stat, serviceUid);
    if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
    if (created) {
      fchmodSync(fd, 0o700);
      const after = fstatSync(fd);
      const modeCheck = verifyDirectoryStat(after, serviceUid);
      if (!modeCheck.ok) return { ok: false, code: modeCheck.code, message: modeCheck.message };
      fsyncSync(fd);
    }
    return { ok: true, identity: { kind: kindOfPath(path), canonicalPath: path, dev: stat.dev, ino: stat.ino } };
  } catch {
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'fixed directory could not be verified descriptor-bound' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function kindOfPath(path: string): NamespaceKind {
  return path.endsWith('/config-v1') || path.includes('/config-v1/') ? 'configuration' : 'store-records';
}

/** Exact namespace root path derivation (fixed; no arbitrary operand). */
export function namespaceRootPath(parentCanonical: string, kind: NamespaceKind): string {
  return kind === 'configuration' ? `${parentCanonical}/config-v1` : `${parentCanonical}/store-v1`;
}

/** Provision both namespace roots plus their fixed `metadata/` and `tmp/`. */
export function provisionNamespaceRoots(
  capability: InitializationCapability,
  parent: RootIdentity,
  serviceUid: number,
): ProvisionResult {
  const kinds: readonly NamespaceKind[] = ['configuration', 'store-records'];
  for (const kind of kinds) {
    const root = namespaceRootPath(parent.canonicalPath, kind);
    const rootResult = ensureFixedDirectory(capability, root, serviceUid, 'namespace-initialize');
    if (!rootResult.ok) return rootResult;
    for (const entry of NAMESPACE_PROVISIONED_ENTRIES) {
      const sub = ensureFixedDirectory(capability, `${root}/${entry}`, serviceUid, 'namespace-initialize');
      if (!sub.ok) return sub;
    }
  }
  return { ok: true };
}

/**
 * Phase-3 top-level provisioning (ADR-029 D-7): create only the exact
 * missing top-level phase-3 directories (`records`, `audit`, `locks`) under
 * BOTH namespaces, gated on the initialization-family `provision-phase3`
 * operation. Runs before writer-lock acquisition (the lock directory must
 * pre-exist the lock file). Idempotent: an existing exact directory passes
 * descriptor verification and continues; wrong-type/UID/mode objects fail
 * closed; no repair, chown, deletion, or adoption. A crash between
 * creations leaves a partial allowed set that remains PROVISIONAL under the
 * classifier and is completed deterministically by the next attempt.
 */
export function provisionPhase3TopLevel(
  capability: InitializationCapability,
  parent: RootIdentity,
  serviceUid: number,
): ProvisionResult {
  const kinds: readonly NamespaceKind[] = ['configuration', 'store-records'];
  for (const kind of kinds) {
    const root = namespaceRootPath(parent.canonicalPath, kind);
    for (const entry of PHASE3_REQUIRED_EXTRA) {
      const sub = ensureFixedDirectory(capability, `${root}/${entry}`, serviceUid, 'provision-phase3');
      if (!sub.ok) return sub;
    }
  }
  return { ok: true };
}

/**
 * Descriptor-bound no-follow verification of one present fixed entry
 * (state-D clause, ADR-029 D-7/M-2; MINOR-2): every present fixed entry
 * (`metadata`, `tmp`, `records`, `audit`, `locks`) must be a directory
 * owned by the configured trusted service UID with exact mode `0700`.
 * Symlinks are never followed (no-follow open; `ELOOP` fails closed); a
 * regular file or special object fails `ENOTDIR`-style (wrong type); wrong
 * UID/mode fails the exact-mode policy. An entry that was listed by
 * `readdir` but disappears before this open (ENOENT) is a failed-closed
 * disappearance; unverifiable conditions map to identity drift.
 */
export function verifyFixedEntryObject(path: string, serviceUid: number): { readonly ok: boolean; readonly code?: string; readonly message?: string } {
  let fd: number | undefined;
  try {
    fd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const stat = fstatSync(fd);
    const verified = verifyDirectoryStat(stat, serviceUid);
    if (!verified.ok) {
      // Wrong type, wrong UID, or wrong mode at a fixed entry path → state D.
      // Internal classifier marker only; never an ERR-STO-* code (no new
      // error code; the aggregate state maps to the closed vocabulary).
      return { ok: false, code: 'foreign-entry', message: 'fixed entry is not an exact store directory' };
    }
    return { ok: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: false, code: 'foreign-entry', message: 'fixed entry disappeared during classification' };
    }
    if (code === 'ELOOP' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM' || code === 'ENAMETOOLONG' || code === 'EINVAL') {
      // Symlink, wrong type, or inaccessible entry → state D.
      return { ok: false, code: 'foreign-entry', message: 'fixed entry is not a no-follow accessible directory' };
    }
    return { ok: false, code: 'drifted-entry', message: 'fixed entry could not be verified' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Deterministic classification of a namespace-root open failure (W8C-S03):
 * only a genuine missing path (ENOENT) maps to ABSENT; every other native
 * condition is an existing-but-inaccessible or malformed entry and maps to a
 * fail-closed state. Pure so every native code is unit-testable without
 * privileges.
 */
export function classifyNamespaceOpenError(code: string | undefined): 'absent' | 'foreign' | 'drifted' {
  switch (code) {
    case 'ENOENT':
      return 'absent';
    case 'ENOTDIR':
    case 'ELOOP':
    case 'EACCES':
    case 'EPERM':
    case 'ENAMETOOLONG':
    case 'EINVAL':
      return 'foreign';
    default:
      // EIO and any other unverifiable condition: identity cannot be
      // established — fail closed as drifted.
      return 'drifted';
  }
}

/**
 * Classify one namespace's state and fixed entry set. The namespace root and
 * entries are enumerated only after descriptor verification, and the
 * descriptor state is re-verified after enumeration; divergence fails closed.
 * Metadata presence and identity/digest verification are performed by the
 * metadata layer; here only entry-set classification happens.
 */
export function classifyNamespace(
  capability: InitializationCapability,
  parent: RootIdentity,
  kind: NamespaceKind,
  serviceUid: number,
  hasVerifiedMetadata: boolean,
): NamespaceState {
  const root = namespaceRootPath(parent.canonicalPath, kind);
  const absentState = (): NamespaceState => ({ kind, state: 'ABSENT', entries: [], unknownEntries: false });
  const foreignState = (): NamespaceState => ({ kind, state: 'FOREIGN', entries: [], unknownEntries: true });
  const driftedState = (): NamespaceState => ({ kind, state: 'IDENTITY_DRIFTED', entries: [], unknownEntries: true });
  let identity: NamespaceIdentity | undefined;
  let names: string[];
  try {
    const before = openAndSnapshot(root);
    identity = { kind, canonicalPath: root, dev: before.snapshot.dev, ino: before.snapshot.ino };
    try {
      names = readdirSync(root);
    } finally {
      closeSync(before.fd);
    }
    const after = openAndSnapshot(root);
    closeSync(after.fd);
    if (!snapshotsEqual(before.snapshot, after.snapshot)) {
      return driftedState();
    }
  } catch (err) {
    // W8C-S03: only a genuine missing path is ABSENT. An existing but
    // inaccessible, wrong-type, or symlink namespace root is never downgraded
    // to ABSENT; it fails closed so no provisioning mutation is attempted.
    const code = (err as NodeJS.ErrnoException).code;
    const outcome = classifyNamespaceOpenError(code);
    if (outcome === 'absent') return absentState();
    if (outcome === 'foreign') return foreignState();
    return driftedState();
  }
  const unknown = names.filter((n) => !(NAMESPACE_CLASSIFIER_ENTRIES as readonly string[]).includes(n));
  const expected = names.filter((n) => (NAMESPACE_CLASSIFIER_ENTRIES as readonly string[]).includes(n));
  if (unknown.length > 0) {
    // State D: unknown or deferred entries (incl. `index`, `quarantine`) fail
    // closed; a partial phase-3 set never reaches this branch.
    return { kind, state: 'FOREIGN', entries: names, unknownEntries: true, identity };
  }
  // State-D clause (MINOR-2): every PRESENT fixed entry must be an exact
  // store directory — no-follow open, directory type, configured UID, exact
  // mode `0700`. A wrong-type object (regular file, symlink, special file),
  // wrong UID, wrong mode, or a disappeared entry fails closed; unverifiable
  // conditions map to identity drift. No repair, chown, chmod, deletion, or
  // adoption ever occurs.
  for (const entry of expected) {
    const verified = verifyFixedEntryObject(`${root}/${entry}`, serviceUid);
    if (!verified.ok) {
      if (verified.code === 'drifted-entry') {
        return { kind, state: 'IDENTITY_DRIFTED', entries: names, unknownEntries: false, identity };
      }
      return { kind, state: 'FOREIGN', entries: names, unknownEntries: false, identity };
    }
  }
  const expectedDirs = (NAMESPACE_CLASSIFIER_ENTRIES as readonly string[]).filter((n) => !expected.includes(n));
  if (expectedDirs.length > 0) {
    // Phase-3 classifier policy (ADR-029 D-7/M-2): a namespace missing only
    // phase-3 members (records/audit/locks), with no unknown entries, is
    // upgradeable/provisional — never FOREIGN — independent of the
    // metadata-verification flag (states B/C; state A carries the upgrade
    // marker for the exact phase-2 set with verified metadata).
    const missingOnlyPhase3 = expectedDirs.every((n) => (PHASE3_REQUIRED_EXTRA as readonly string[]).includes(n));
    if (missingOnlyPhase3) {
      const phase2Exact = expected.length === 2 && expected.includes('metadata') && expected.includes('tmp');
      if (phase2Exact && hasVerifiedMetadata) {
        return { kind, state: 'PROVISIONAL', entries: names, unknownEntries: false, identity, phase3UpgradeRequired: true };
      }
      return { kind, state: 'PROVISIONAL', entries: names, unknownEntries: false, identity };
    }
    // Missing bootstrap entries (metadata/tmp): committed semantics. With
    // verified metadata this cannot normally arise (metadata verification
    // requires the metadata directory) and stays fail-closed.
    return { kind, state: hasVerifiedMetadata ? 'FOREIGN' : 'PROVISIONAL', entries: names, unknownEntries: false, identity };
  }
  if (hasVerifiedMetadata) {
    // State E: exact verified phase-3 set.
    return { kind, state: 'INITIALIZED', entries: names, unknownEntries: false, identity };
  }
  return { kind, state: 'PROVISIONAL', entries: names, unknownEntries: false, identity };
}

/** Exact metadata file path under a namespace root (fixed derivation). */
export function metadataFilePath(namespaceRoot: string): string {
  return `${namespaceRoot}/metadata/metadata.json`;
}

/**
 * Re-verify a namespace root descriptor (point-of-use revalidation before
 * later mutation). Returns the captured identity.
 */
export function verifyNamespaceDescriptor(capability: InitializationCapability, path: string, serviceUid: number): ProvisionResult {
  const check = capability.verify('namespace-initialize');
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'initialization capability is not usable at a verification boundary' };
  }
  let fd: number | undefined;
  try {
    fd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const stat = fstatSync(fd);
    const verified = verifyDirectoryStat(stat, serviceUid);
    if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
    return { ok: true, identity: { kind: kindOfPath(path), canonicalPath: path, dev: stat.dev, ino: stat.ino } };
  } catch {
    return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'namespace root could not be revalidated' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
