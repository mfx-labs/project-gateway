/**
 * WP-8-C probe scratch ownership (W8C-D08/D14).
 *
 * Scratch names derive from the genuine action-identity digest and a bounded
 * per-action ordinal — no randomness, wall clock, PID, environment, or cwd.
 * Creation uses `O_CREAT|O_EXCL|O_NOFOLLOW`; no-overwrite is mandatory and
 * `EEXIST` fails closed: an action never claims an existing object, and
 * matching digest+ordinal never establishes ownership of a pre-existing
 * object. Only a successfully created object recorded by the current live
 * action may be removed. Prior/dead-action objects remain untouched and
 * require later maintenance handling.
 */
import { openSync, closeSync, fstatSync, fchmodSync, writeSync, unlinkSync } from 'node:fs';
import { constants } from 'node:fs';
import { computeDomainDigest } from '../format/envelope.js';

const { O_CREAT, O_EXCL, O_WRONLY, O_NOFOLLOW } = constants;

/** Domain-separated scratch-naming domain (deterministic; not authoritative state). */
export const STORAGE_SCRATCH_DOMAIN = 'PGAP-STORAGE-SCRATCH-v1\u0000';

/** Deterministic per-action scratch name: action-digest prefix + bounded ordinal. */
export function scratchName(actionIdentity: string, ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > 0xffff) {
    throw new RangeError('per-action scratch ordinal out of bounds');
  }
  const digest = computeDomainDigest(STORAGE_SCRATCH_DOMAIN, actionIdentity);
  return `probe-${digest.slice('sha-256:'.length, 'sha-256:'.length + 16)}-${ordinal.toString(16)}`;
}

/**
 * Process-local scratch ownership for one live action inside one verified
 * namespace `tmp/` directory. Records exact successfully created names;
 * deletes only those exact names.
 */
export interface ScratchOwnership {
  readonly directory: string;
  readonly names: readonly string[];
  /**
   * Exclusively create one scratch object. Returns the created path or
   * undefined on `EEXIST`/failure (never claims an existing object).
   */
  readonly create: (actionIdentity: string, ordinal: number, kind: 'file' | 'symlink-target') => string | undefined;
  /** Record an object this action created in the exact directory via another primitive. */
  readonly record: (name: string) => void;
  /** Remove only the exact objects this ownership record created. */
  readonly cleanup: () => void;
}

export function newScratchOwnership(directory: string): ScratchOwnership {
  const owned: string[] = [];
  return {
    directory,
    names: owned,
    create(actionIdentity, ordinal, kind) {
      const name = scratchName(actionIdentity, ordinal);
      const path = `${directory}/${name}`;
      let fd: number | undefined;
      try {
        fd = openSync(path, O_CREAT | O_EXCL | O_NOFOLLOW | O_WRONLY, 0o600);
        fchmodSync(fd, 0o600);
        fstatSync(fd);
        const content = Buffer.from(kind === 'file' ? 'probe' : 'probe-target', 'utf8');
        writeSync(fd, content, 0, content.length, 0);
        closeSync(fd);
        fd = undefined;
      } catch {
        if (fd !== undefined) closeSync(fd);
        return undefined;
      }
      owned.push(name);
      return path;
    },
    record(name) {
      if (name.startsWith(`${directory}/`)) {
        const base = name.slice(directory.length + 1);
        if (!owned.includes(base)) owned.push(base);
      }
    },
    cleanup() {
      for (const name of owned) {
        try {
          unlinkSync(`${directory}/${name}`);
        } catch {
          // Scratch cleanup is best-effort and non-authoritative; a leftover
          // scratch object is never adopted, repaired, or deleted by another action.
        }
      }
      owned.length = 0;
    },
  };
}
