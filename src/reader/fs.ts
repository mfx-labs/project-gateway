/**
 * WP-7 — Descriptor-bound filesystem access.
 *
 * Implements the accepted Linux/Node strategy:
 * - Retain a descriptor for the workspace root.
 * - Open targets relative to that root via /proc/self/fd/<rootFd>/<relative>.
 * - Use O_NOFOLLOW where required.
 * - Use O_NONBLOCK before type inspection.
 * - Perform fstat on opened descriptors.
 * - Bind reads to the opened descriptor.
 * - Never reopen by original path after validation.
 */
import { open as fsOpen, type FileHandle } from 'node:fs/promises';
import { constants, fstatSync, lstatSync, opendirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DirectoryEntry, InspectMetadataResult, MetadataKind } from './types.js';

// ---------------------------------------------------------------------------
// Bound workspace root
// ---------------------------------------------------------------------------

export interface BoundWorkspaceRoot {
  readonly rootPath: string;
  readonly rootFd: number;
  close(): Promise<void>;
}

export async function bindWorkspaceRoot(rootPath: string): Promise<BoundWorkspaceRoot> {
  const handle = await fsOpen(rootPath, constants.O_RDONLY | constants.O_DIRECTORY);
  const rootFd = handle.fd;
  return {
    rootPath,
    rootFd,
    async close() {
      try { await handle.close(); } catch { /* best-effort */ }
    },
  };
}

function fdPath(root: BoundWorkspaceRoot, relative: string): string {
  return `/proc/self/fd/${root.rootFd}/${relative}`;
}

function fsPath(root: BoundWorkspaceRoot, relative: string): string {
  return join(root.rootPath, relative);
}

// ---------------------------------------------------------------------------
// Open modes
// ---------------------------------------------------------------------------

const OPEN_DIR = constants.O_RDONLY | constants.O_DIRECTORY;
// O_NONBLOCK prevents a blocking FIFO open during type inspection.
// O_NOFOLLOW is intentionally NOT applied to the final component: containment
// resolves the full symlink chain (SYM-001…SYM-006) and the S-07 descriptor
// identity binding (fstat dev/ino vs the accepted resolved target) detects
// swaps after open. Intermediate components are protected because the
// containment-resolved canonical relative path is opened relative to the
// bound workspace-root descriptor.
const OPEN_READ_NONBLOCK = constants.O_RDONLY | constants.O_NONBLOCK;

// ---------------------------------------------------------------------------
// Type classification from fstat/lstat result
// ---------------------------------------------------------------------------

function classifyStat(st: ReturnType<typeof fstatSync>): {
  kind: MetadataKind;
  isRegularFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  isSpecial: boolean;
  sizeBytes: number;
} {
  const isRegularFile = st.isFile();
  const isDirectory = st.isDirectory();
  const isSymbolicLink = st.isSymbolicLink();
  const isSpecial = st.isFIFO() || st.isSocket() || st.isBlockDevice() || st.isCharacterDevice();
  const kind: MetadataKind =
    isSymbolicLink ? 'symlink' :
    isDirectory ? 'directory' :
    isRegularFile ? 'file' :
    'other';
  return { kind, isRegularFile, isDirectory, isSymbolicLink, isSpecial, sizeBytes: Number(st.size) };
}

// ---------------------------------------------------------------------------
// Opened target
// ---------------------------------------------------------------------------

export interface OpenedTarget {
  readonly handle: FileHandle;
  readonly relative: string;
  readonly kind: MetadataKind;
  readonly isRegularFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly isSpecial: boolean;
  readonly sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Open for read (text or bytes): O_NOFOLLOW | O_NONBLOCK, then fstat.
// Only regular files pass.
// ---------------------------------------------------------------------------

export async function openForRead(
  root: BoundWorkspaceRoot,
  relative: string,
): Promise<
  | { ok: true; target: OpenedTarget }
  | { ok: false; code: 'not-found' | 'permission-denied' | 'unsupported-type' | 'error' }
> {
  const fpath = fdPath(root, relative);
  let handle: FileHandle;
  try {
    handle = await fsOpen(fpath, OPEN_READ_NONBLOCK);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return { ok: false, code: 'not-found' };
    if (e.code === 'EACCES' || e.code === 'EPERM') return { ok: false, code: 'permission-denied' };
    if (e.code === 'ELOOP') return { ok: false, code: 'not-found' };
    if (e.code === 'ENOTDIR') return { ok: false, code: 'not-found' };
    if (e.code === 'ENXIO') return { ok: false, code: 'unsupported-type' };
    return { ok: false, code: 'error' };
  }

  let st: ReturnType<typeof fstatSync>;
  try {
    st = fstatSync(handle.fd);
  } catch {
    await handle.close().catch(() => {});
    return { ok: false, code: 'error' };
  }

  const classified = classifyStat(st);
  if (!classified.isRegularFile) {
    await handle.close().catch(() => {});
    return { ok: false, code: 'unsupported-type' };
  }

  return {
    ok: true,
    target: { handle, relative, ...classified },
  };
}

// ---------------------------------------------------------------------------
// Open for list-directory: O_DIRECTORY, then fstat.
// ---------------------------------------------------------------------------

export async function openForListDirectory(
  root: BoundWorkspaceRoot,
  relative: string,
): Promise<
  | { ok: true; target: OpenedTarget }
  | { ok: false; code: 'not-found' | 'permission-denied' | 'unsupported-type' | 'error' }
> {
  const fpath = fdPath(root, relative);
  let handle: FileHandle;
  try {
    handle = await fsOpen(fpath, OPEN_DIR);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return { ok: false, code: 'not-found' };
    if (e.code === 'EACCES' || e.code === 'EPERM') return { ok: false, code: 'permission-denied' };
    if (e.code === 'ENOTDIR') return { ok: false, code: 'unsupported-type' };
    return { ok: false, code: 'error' };
  }

  let st: ReturnType<typeof fstatSync>;
  try {
    st = fstatSync(handle.fd);
  } catch {
    await handle.close().catch(() => {});
    return { ok: false, code: 'error' };
  }

  const classified = classifyStat(st);
  if (!classified.isDirectory) {
    await handle.close().catch(() => {});
    return { ok: false, code: 'unsupported-type' };
  }

  return {
    ok: true,
    target: { handle, relative, ...classified },
  };
}

// ---------------------------------------------------------------------------
// Logical-entry inspection (lstat — does not follow final symlink)
// ---------------------------------------------------------------------------

export function inspectLogicalEntry(
  root: BoundWorkspaceRoot,
  relative: string,
): { ok: true; metadata: InspectMetadataResult } | { ok: false; code: 'not-found' | 'permission-denied' | 'error' } {
  const fpath = fsPath(root, relative);
  let lst: ReturnType<typeof lstatSync>;
  try {
    lst = lstatSync(fpath);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return { ok: false, code: 'not-found' };
    if (e.code === 'EACCES' || e.code === 'EPERM') return { ok: false, code: 'permission-denied' };
    return { ok: false, code: 'error' };
  }
  const classified = classifyStat(lst);
  return {
    ok: true,
    metadata: {
      kind: classified.kind,
      sizeBytes: classified.isRegularFile ? classified.sizeBytes : undefined,
      isRegularFile: classified.isRegularFile,
      isDirectory: classified.isDirectory,
      isSymbolicLink: classified.isSymbolicLink,
      isSpecial: classified.isSpecial,
    },
  };
}

// ---------------------------------------------------------------------------
// Read entries from a directory handle (list-directory)
// Uses opendirSync on the /proc/self/fd path to keep the operation bound to
// the opened directory descriptor while remaining fully type-safe.
// ---------------------------------------------------------------------------

export function listDirectoryEntries(
  target: OpenedTarget,
  maxEntries: number,
): { entries: DirectoryEntry[]; truncated: boolean } {
  const entries: DirectoryEntry[] = [];
  // opendirSync accepts only path strings, not fds; /proc/self/fd/<fd> keeps
  // the enumeration bound to the already-opened directory descriptor while
  // remaining fully type-safe (no `as any` bypass).
  const dir = opendirSync(`/proc/self/fd/${target.handle.fd}`);
  try {
    let sawExtra = false;
    for (;;) {
      const d = dir.readSync();
      if (d === null) break;
      if (entries.length >= maxEntries) {
        sawExtra = true;
        continue;
      }
      const kindHint: DirectoryEntry['kindHint'] =
        d.isFile() ? 'file' :
        d.isDirectory() ? 'directory' :
        d.isSymbolicLink() ? 'symlink' :
        'other';
      entries.push({ name: d.name, kindHint });
    }
    // Deterministic UTF-8 byte order
    entries.sort((a, b) => {
      const bufA = Buffer.from(a.name, 'utf8');
      const bufB = Buffer.from(b.name, 'utf8');
      const len = Math.min(bufA.length, bufB.length);
      for (let i = 0; i < len; i++) {
        const diff = (bufA[i] ?? 0) - (bufB[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return bufA.length - bufB.length;
    });
    return { entries, truncated: sawExtra };
  } finally {
    dir.closeSync();
  }
}

// ---------------------------------------------------------------------------
// Descriptor identity binding (S-07)
//
// Proves the opened descriptor is the same object accepted by point-of-use
// containment: fstat the opened descriptor and compare device + inode against
// a trusted internal stat of the containment-resolved absolute target taken
// immediately around descriptor acquisition.
// ---------------------------------------------------------------------------

export interface ObjectIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
}

export function statIdentity(st: ReturnType<typeof fstatSync>): ObjectIdentity {
  return {
    dev: Number(st.dev),
    ino: Number(st.ino),
    isDirectory: st.isDirectory(),
    isFile: st.isFile(),
    isSymbolicLink: st.isSymbolicLink(),
  };
}

/**
 * Obtain trusted internal identity evidence for the containment-accepted
 * resolved absolute target. This is a trusted-process-internal stat of the
 * resolved target, taken immediately around descriptor acquisition; it never
 * uses the hostile original request path.
 */
export function statResolvedTarget(resolvedAbsolutePath: string): ObjectIdentity | null {
  try {
    return statIdentity(statSync(resolvedAbsolutePath));
  } catch {
    return null;
  }
}

/**
 * Verify the opened descriptor identity against the accepted resolved-target
 * identity. Fails closed on any mismatch (device, inode, or object type).
 */
export function verifyDescriptorIdentity(
  opened: ObjectIdentity,
  accepted: ObjectIdentity,
): boolean {
  return (
    opened.dev === accepted.dev &&
    opened.ino === accepted.ino &&
    opened.isDirectory === accepted.isDirectory &&
    opened.isFile === accepted.isFile &&
    opened.isSymbolicLink === accepted.isSymbolicLink
  );
}

// ---------------------------------------------------------------------------
// Read bytes from an opened regular file
// ---------------------------------------------------------------------------

export async function readFileBytes(
  target: OpenedTarget,
  maxBytes: number,
): Promise<{ bytes: Buffer; truncated: boolean }> {
  const buf = Buffer.alloc(maxBytes);
  const result = await target.handle.read(buf, 0, maxBytes, 0);
  const bytesRead = result.bytesRead;
  return {
    bytes: buf.subarray(0, bytesRead),
    truncated: bytesRead < target.sizeBytes && bytesRead === maxBytes,
  };
}
