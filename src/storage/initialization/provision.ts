/**
 * WP-8-C fixed-directory provisioning owner (ADR-028 decision E; W8C-D04).
 *
 * This module alone owns creation of the four fixed target classes:
 * `<parent>/config-v1/`, `<parent>/store-v1/`, each namespace's metadata
 * directory, and each namespace's temporary directory. It is callable only
 * from the initialization
 * orchestrator and requires the still-live genuine one-shot initialization
 * capability on every mutation boundary. Target paths must equal one fixed
 * derivation; no arbitrary path operand exists. No recursive creation, no
 * parent creation, no `chown`, no repair, no deletion of namespace
 * directories.
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
import type { InitializationCapability } from '../capabilities/authenticity.js';
import { verifyDirectoryStat } from '../root/identity.js';
import type { NamespaceIdentity, NamespaceKind, NamespaceState, RootIdentity } from '../types.js';

const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW } = constants;

/** Fixed expected entries under each namespace root (LAY-001/5.2 subset). */
const NAMESPACE_FIXED_ENTRIES = ['metadata', 'tmp'] as const;

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
 */
function ensureFixedDirectory(capability: InitializationCapability, path: string, serviceUid: number): ProvisionResult {
  const check = capability.verify('namespace-initialize');
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
    const rootResult = ensureFixedDirectory(capability, root, serviceUid);
    if (!rootResult.ok) return rootResult;
    for (const entry of NAMESPACE_FIXED_ENTRIES) {
      const sub = ensureFixedDirectory(capability, `${root}/${entry}`, serviceUid);
      if (!sub.ok) return sub;
    }
  }
  return { ok: true };
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
  const unknown = names.filter((n) => !(NAMESPACE_FIXED_ENTRIES as readonly string[]).includes(n));
  const expected = names.filter((n) => (NAMESPACE_FIXED_ENTRIES as readonly string[]).includes(n));
  if (unknown.length > 0) {
    return { kind, state: 'FOREIGN', entries: names, unknownEntries: true, identity };
  }
  const expectedDirs = (NAMESPACE_FIXED_ENTRIES as readonly string[]).filter((n) => !expected.includes(n));
  if (expectedDirs.length > 0) {
    // Missing fixed entries: provisional (no durable metadata yet) or foreign.
    return { kind, state: hasVerifiedMetadata ? 'FOREIGN' : 'PROVISIONAL', entries: names, unknownEntries: false, identity };
  }
  if (hasVerifiedMetadata) {
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
