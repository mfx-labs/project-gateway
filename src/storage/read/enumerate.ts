/**
 * WP-8-D bounded class enumeration (contract 13, RDS-004/006…012, LMT-006,
 * DTM-003). The SOLE directory-scan owner in the storage tree: `readdirSync`
 * is confined to this module, and exact reads never scan directories.
 *
 * Fixed class directory only; deterministic ordering (shards and entries
 * sorted lexicographically — host directory order is never trusted);
 * bounded by the selected `dirEntries` (scanned entries) and
 * `enumerationResults` (reported results) limits with continuation; no
 * arbitrary recursion; every discovered object is independently verified
 * (canonical parse, digest, location) by the shared descriptor primitive
 * before being reported as a valid record; malformed or foreign entries are
 * returned only as bounded findings, never as records; no registry or
 * current-state resolution (RGY is phase 4); no raw path disclosure.
 *
 * This module imports no mutating `node:fs` API.
 */
import { readdirSync, openSync, closeSync, fstatSync } from 'node:fs';
import { constants } from 'node:fs';
import { deriveRecordRelativePath } from '../layout/layout.js';
import { verifyRecordObjectAt } from './read-record.js';
import type { ReadCapability } from '../capabilities/authenticity.js';
import type { EnumerateClassResult, EnumerationCursor, EnumeratedItem, RecordClassId } from '../types.js';

const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW } = constants;

/** Accepted entry-name grammar: exactly 32 lowercase hex + the class suffix. */
const COMPONENT_RE = /^[0-9a-f]{32}$/;

export interface EnumerateInput {
  readonly capability: ReadCapability;
  readonly namespaceRoot: string;
  readonly recordClass: RecordClassId;
  readonly continuation?: EnumerationCursor;
}

/**
 * Enumerate one record class with strict bounds and deterministic order.
 * Iterates the class shard directories (`<ns>/records/<segment>/<shard>/` or
 * `<ns>/audit/<segment>/<shard>/`) in lexicographic shard order; each shard
 * directory is descriptor-verified before and after `readdirSync`. Entries
 * are sorted; each candidate is verified before being reported. Scanning
 * stops at the `dirEntries` scanned-entry bound (fail-closed truncation with
 * continuation) or after `enumerationResults` verified results.
 */
export function enumerateClassByIdentity(input: EnumerateInput): EnumerateClassResult {
  const check = input.capability.verify('enumerate-class');
  if (!check.ok) {
    return { ok: false, items: [], scannedEntries: 0, truncated: false, findings: [{ code: 'ERR-STO-REQ-INVALID', message: 'read capability is not usable at the enumeration boundary', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } }] };
  }
  const profile = deriveRecordRelativePath(input.recordClass, 'pgw:r:00000000000000000000000000000000');
  if (!profile.ok) {
    return { ok: false, items: [], scannedEntries: 0, truncated: false, findings: [{ code: 'ERR-STO-CONTAINMENT-DENIED', message: 'record class is not enumerable', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } }] };
  }
  const topLevel = profile.relativePath.startsWith('audit/') ? 'audit' : 'records';
  const classDir = `${input.namespaceRoot}/${topLevel}/${profile.classSegment}`;
  const suffix = profile.suffix;
  const serviceUid = input.capability.binding.serviceUid;
  const byteLimit = input.capability.binding.limitProfile['recordBytes'] ?? 1024 * 1024;
  const dirEntriesLimit = input.capability.binding.limitProfile['dirEntries'] ?? 4096;
  const resultsLimit = input.capability.binding.limitProfile['enumerationResults'] ?? 1024;

  const items: EnumeratedItem[] = [];
  let scanned = 0;
  let truncated = false;
  let lastShard: string | undefined;
  let lastEntry: string | undefined;

  // Deterministic shard iteration: 0000..ffff in lexicographic order,
  // resuming from the continuation cursor when provided.
  const SHARDS = 0x10000;
  const shardWidth = profile.shard.length;
  const startIndex = input.continuation === undefined ? 0 : parseInt(input.continuation.shard, 16);
  for (let idx = startIndex; idx < SHARDS; idx++) {
    const shard = idx.toString(16).padStart(shardWidth, '0');
    const shardDir = `${classDir}/${shard}`;
    let names: string[];
    try {
      // Descriptor-verified readdir bracket: pre/post snapshot comparison.
      const before = openAndSnapshot(shardDir, serviceUid);
      let list: string[];
      try {
        list = readdirSync(shardDir);
      } finally {
        closeSync(before.fd);
      }
      const after = openAndSnapshot(shardDir, serviceUid);
      closeSync(after.fd);
      if (!snapshotsEqual(before.snapshot, after.snapshot)) {
        return { ok: false, items, scannedEntries: scanned, truncated: true, findings: [{ code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'shard directory changed during enumeration', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: true } }] };
      }
      names = [...list].sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Shard directory absent: no records in this shard; continue.
        continue;
      }
      return { ok: false, items, scannedEntries: scanned, truncated: true, findings: [{ code: 'ERR-STO-IO-FAILURE', message: 'shard directory could not be enumerated', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } }] };
    }
    const startEntry = input.continuation !== undefined && input.continuation.shard === shard ? input.continuation.entry : undefined;
    for (const name of names) {
      // Resume strictly AFTER the cursor entry (the cursor entry was already
      // reported on the previous page).
      if (startEntry !== undefined && name <= startEntry) continue;
      scanned++;
      lastShard = shard;
      lastEntry = name;
      if (scanned > dirEntriesLimit) {
        truncated = true;
        break;
      }
      const component = name.slice(0, 32);
      if (!COMPONENT_RE.test(component) || !name.endsWith(suffix) || name.length !== 36) {
        // Foreign entry: bounded finding, never a record (fail closed).
        items.push({ finding: { code: 'ERR-STO-MALFORMED', message: 'foreign entry in the record class directory', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } } });
        continue;
      }
      // Location verification: the entry must equal the derived filename for
      // SOME canonical identity whose opaque component is this entry.
      const derived = deriveRecordRelativePath(input.recordClass, `pgw:r:${component}`);
      if (!derived.ok || derived.filename !== name || derived.shard !== shard) {
        items.push({ finding: { code: 'ERR-STO-INTEGRITY', message: 'entry location does not match the layout derivation', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } } });
        continue;
      }
      const verified = verifyRecordObjectAt({ path: `${shardDir}/${name}`, serviceUid, byteLimit });
      if (!verified.ok) {
        items.push({ finding: { code: verified.code ?? 'ERR-STO-INTEGRITY', message: verified.message ?? 'record verification failed', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } } });
        continue;
      }
      if (verified.recordId === undefined) continue;
      // The discovered component must match the envelope's own identity
      // component (the identifier prefix is read from the record content).
      if (!verified.recordId.endsWith(component)) {
        items.push({ finding: { code: 'ERR-STO-INTEGRITY', message: 'record identity does not match its derived location', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } } });
        continue;
      }
      items.push({ recordId: verified.recordId });
      if (items.filter((i) => i.recordId !== undefined).length >= resultsLimit) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }
  const continuation: EnumerationCursor | undefined =
    truncated && lastShard !== undefined && lastEntry !== undefined ? { shard: lastShard, entry: lastEntry } : undefined;
  return { ok: true, items, continuation, scannedEntries: scanned, truncated };
}

interface ShardSnapshot {
  readonly fd: number;
  readonly snapshot: { readonly dev: number; readonly ino: number; readonly uid: number; readonly mode: number };
}

function openAndSnapshot(path: string, serviceUid: number): ShardSnapshot {
  const fd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isDirectory()) {
      closeSync(fd);
      throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
    }
    if (stat.uid !== serviceUid || (stat.mode & 0o777) !== 0o700) {
      closeSync(fd);
      throw Object.assign(new Error('policy violation'), { code: 'EACCES' });
    }
    return { fd, snapshot: { dev: Number(stat.dev), ino: Number(stat.ino), uid: Number(stat.uid), mode: Number(stat.mode) & 0o777 } };
  } catch (err) {
    closeSync(fd);
    throw err;
  }
}

function snapshotsEqual(a: ShardSnapshot['snapshot'], b: ShardSnapshot['snapshot']): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode;
}
