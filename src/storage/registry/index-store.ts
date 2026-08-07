/**
 * WP-8-H registry-index store access (ADR-031; contract 5.2 `index/`).
 * FILESYSTEM-BEARING, READ-ONLY: the exact owner of registry-index reads,
 * the live entry-set freshness probe, and the fast-path validation. All
 * mutation (publication) stays in the permit-bound publication sink
 * (`publication/publish-record.ts`); all parsing/derivation stays in the
 * pure model (`registry/index-model.ts`).
 *
 * The freshness probe mirrors the registry scan's enumeration exactly
 * (records/ class segments and shards, audit/audit-event shards, foreign
 * entries at every level) using readdir plus no-follow lstat — never
 * content reads. Because records and audits are immutable and only ever
 * appear through atomic hard-link publication, an exact match of the
 * live entry set (names + stat facts) against the index manifest proves
 * the store is unchanged since the index build for every legitimate
 * store evolution; content tampering with identical names and stat facts
 * requires store write access and is out of the MVP trust anchor
 * (TML-002) exactly as for the authoritative scan itself.
 */
import { readdirSync, lstatSync, openSync, closeSync, fstatSync, readFileSync } from 'node:fs';
import { constants } from 'node:fs';
import { RECORD_CLASS_BY_ID } from '../format/taxonomy.js';
import { comparePrePostStat, verifyRegularFileStat } from '../root/identity.js';
import { deriveRegistryIndexRelativePath, REGISTRY_INDEX_FAMILY } from '../layout/layout.js';
import { computeScanGeneration, recomputeSurfaceGeneration } from '../recovery/scan.js';
import {
  parseRegistryIndex,
  validateRegistryIndexSelfConsistency,
  registryIndexManifest,
  registryIndexManifestSide,
  REGISTRY_INDEX_MODEL_VERSION,
  REGISTRY_INDEX_MAX_ENTRIES,
  REGISTRY_INDEX_FILENAME_RE,
  type IndexEntryStat,
  type ParsedRegistryIndex,
} from './index-model.js';
import type { RecordClassId, VerifiedStoreInstance } from '../types.js';

const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW, O_NONBLOCK } = constants;

/** Deterministic live probe entry (never a path). */
export interface RegistryProbeEntry {
  /** Class id for records/audit entries; 'records' | 'audit' for parent-level foreign entries. */
  readonly scope: string;
  readonly shard: string;
  readonly entry: string;
  readonly stat: IndexEntryStat;
}

/** Live probe result over the records/ and audit/ surfaces. */
export interface RegistryProbeResult {
  readonly ok: boolean;
  readonly entries?: readonly RegistryProbeEntry[];
  readonly code?: string;
  readonly message?: string;
}

/** No-follow directory bracket read (mirrors the scan's readdirVerified; read-only). */
function readdirNoFollow(path: string, serviceUid: number): { readonly ok: boolean; readonly names?: readonly string[]; readonly absent?: boolean; readonly code?: string; readonly message?: string } {
  let beforeFd: number | undefined;
  let afterFd: number | undefined;
  try {
    beforeFd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const pre = fstatSync(beforeFd);
    if (!pre.isDirectory()) {
      return { ok: false, code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'expected a directory at a probe surface' };
    }
    if (pre.uid !== serviceUid || (pre.mode & 0o777) !== 0o700) {
      return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'probe surface directory violates the store permission policy' };
    }
    let names: string[];
    try {
      names = readdirSync(path);
    } finally {
      closeSync(beforeFd);
      beforeFd = undefined;
    }
    afterFd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const post = fstatSync(afterFd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok) {
      return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'probe surface directory identity changed during enumeration' };
    }
    return { ok: true, names: [...names].sort(), absent: false };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: true, absent: true };
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'probe surface is not accessible' };
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'probe surface could not be enumerated' };
  } finally {
    if (beforeFd !== undefined) closeSync(beforeFd);
    if (afterFd !== undefined) closeSync(afterFd);
  }
}

function lstatEntry(path: string): IndexEntryStat | undefined {
  try {
    const st = lstatSync(path);
    return {
      fileType: st.isFile() ? 'regular' : st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'directory' : 'special',
      uid: Number(st.uid),
      mode: Number(st.mode) & 0o777,
      nlink: Number(st.nlink),
      size: Number(st.size),
      ino: Number(st.ino),
    };
  } catch {
    return undefined;
  }
}

const SHARD_RE = /^[0-9a-f]{4}$/;

/** Store-records `.rec` classes under `records/` (mirrors the scan's class set). */
function probeRecordClasses(): readonly RecordClassId[] {
  const out: RecordClassId[] = [];
  for (const profile of RECORD_CLASS_BY_ID.values()) {
    if (profile.namespace === 'store-records' && profile.suffix === '.rec' && profile.id !== 'store-metadata') out.push(profile.id);
  }
  return out;
}

/**
 * Live entry-set probe over the records/ and audit/ surfaces (WP-8-H §8):
 * readdir-only enumeration with no-follow lstat stat facts, mirroring the
 * registry scan's walk exactly (class segments, 4-hex shards, entries, and
 * foreign entries at every level). Absent surfaces contribute nothing; an
 * unreadable surface fails the probe closed (the fast path falls back to
 * the authoritative scan).
 */
export function probeRegistryEntrySet(namespaceRoot: string, serviceUid: number): RegistryProbeResult {
  const entries: RegistryProbeEntry[] = [];
  const recordsDir = `${namespaceRoot}/records`;
  const recordsBracket = readdirNoFollow(recordsDir, serviceUid);
  if (!recordsBracket.ok) return { ok: false, code: recordsBracket.code, message: recordsBracket.message };
  if (recordsBracket.absent !== true && recordsBracket.names !== undefined) {
    const classSet = new Set(probeRecordClasses().map((id) => RECORD_CLASS_BY_ID.get(id)?.segment));
    for (const name of recordsBracket.names) {
      if (!classSet.has(name)) {
        // Parent-level foreign entry (name-only in the manifest when the
        // build-time stat was unavailable; stat compared when present).
        const stat = lstatEntry(`${recordsDir}/${name}`);
        if (stat !== undefined) entries.push({ scope: 'records', shard: '', entry: name, stat });
        continue;
      }
      const recordClass = probeRecordClasses().find((id) => RECORD_CLASS_BY_ID.get(id)?.segment === name) as RecordClassId;
      const classDir = `${recordsDir}/${name}`;
      const classBracket = readdirNoFollow(classDir, serviceUid);
      if (!classBracket.ok) return { ok: false, code: classBracket.code, message: classBracket.message };
      if (classBracket.absent === true || classBracket.names === undefined) continue;
      for (const shardName of classBracket.names) {
        if (!SHARD_RE.test(shardName)) {
          // Foreign shard name: the scan records it with shard = the name.
          const stat = lstatEntry(`${classDir}/${shardName}`);
          if (stat !== undefined) entries.push({ scope: recordClass, shard: shardName, entry: shardName, stat });
          continue;
        }
        const shardDir = `${classDir}/${shardName}`;
        const shardBracket = readdirNoFollow(shardDir, serviceUid);
        if (!shardBracket.ok) return { ok: false, code: shardBracket.code, message: shardBracket.message };
        if (shardBracket.absent === true || shardBracket.names === undefined) continue;
        for (const entryName of shardBracket.names) {
          const stat = lstatEntry(`${shardDir}/${entryName}`);
          if (stat !== undefined) entries.push({ scope: recordClass, shard: shardName, entry: entryName, stat });
        }
      }
    }
  }
  const auditDir = `${namespaceRoot}/audit`;
  const auditBracket = readdirNoFollow(auditDir, serviceUid);
  if (!auditBracket.ok) return { ok: false, code: auditBracket.code, message: auditBracket.message };
  if (auditBracket.absent !== true && auditBracket.names !== undefined) {
    for (const name of auditBracket.names) {
      if (name !== 'audit-event') {
        const stat = lstatEntry(`${auditDir}/${name}`);
        if (stat !== undefined) entries.push({ scope: 'audit', shard: '', entry: name, stat });
        continue;
      }
      const classDir = `${auditDir}/audit-event`;
      const classBracket = readdirNoFollow(classDir, serviceUid);
      if (!classBracket.ok) return { ok: false, code: classBracket.code, message: classBracket.message };
      if (classBracket.absent === true || classBracket.names === undefined) continue;
      for (const shardName of classBracket.names) {
        if (!SHARD_RE.test(shardName)) {
          const stat = lstatEntry(`${classDir}/${shardName}`);
          if (stat !== undefined) entries.push({ scope: 'authoritative-audit-event', shard: shardName, entry: shardName, stat });
          continue;
        }
        const shardDir = `${classDir}/${shardName}`;
        const shardBracket = readdirNoFollow(shardDir, serviceUid);
        if (!shardBracket.ok) return { ok: false, code: shardBracket.code, message: shardBracket.message };
        if (shardBracket.absent === true || shardBracket.names === undefined) continue;
        for (const entryName of shardBracket.names) {
          const stat = lstatEntry(`${shardDir}/${entryName}`);
          if (stat !== undefined) entries.push({ scope: 'authoritative-audit-event', shard: shardName, entry: entryName, stat });
        }
      }
    }
  }
  return { ok: true, entries };
}

/** Manifest comparison result (deterministic; per-surface staleness). */
export interface ManifestComparison {
  readonly ok: boolean;
  readonly side?: 'records' | 'audit';
  readonly reason?: 'missing' | 'added' | 'changed';
}

/**
 * Compare the index manifest against the live probe (WP-8-H §8): every
 * manifest entry must exist live with equal stat facts (name-only for
 * foreign entries whose build-time stat was unavailable), and every live
 * entry must be in the manifest. Any difference fails closed as a stale
 * record set or stale audit state — the fast path falls back and the index
 * becomes a rebuild candidate.
 */
export function compareManifestAgainstProbe(manifest: ReadonlyMap<string, IndexEntryStat | null>, live: readonly RegistryProbeEntry[]): ManifestComparison {
  const liveMap = new Map<string, RegistryProbeEntry>();
  for (const entry of live) liveMap.set(`${entry.scope}\u0000${entry.shard}\u0000${entry.entry}`, entry);
  for (const [key, manifestStat] of manifest) {
    const liveEntry = liveMap.get(key);
    if (liveEntry === undefined) {
      const side = key.startsWith('authoritative-audit-event\u0000') || key.startsWith('audit\u0000') ? 'audit' : 'records';
      return { ok: false, side, reason: 'missing' };
    }
    if (manifestStat !== null && !sameStat(manifestStat, liveEntry.stat)) {
      const side = key.startsWith('authoritative-audit-event\u0000') || key.startsWith('audit\u0000') ? 'audit' : 'records';
      return { ok: false, side, reason: 'changed' };
    }
  }
  for (const [key] of liveMap) {
    if (!manifest.has(key)) {
      const side = key.startsWith('authoritative-audit-event\u0000') || key.startsWith('audit\u0000') ? 'audit' : 'records';
      return { ok: false, side, reason: 'added' };
    }
  }
  return { ok: true };
}

function sameStat(a: IndexEntryStat, b: IndexEntryStat): boolean {
  return a.fileType === b.fileType && a.uid === b.uid && a.mode === b.mode && a.nlink === b.nlink && a.size === b.size && a.ino === b.ino;
}

/** Enumerated candidate index files (identity stems, sorted). */
export interface IndexCandidate {
  readonly indexId: string;
  readonly shard: string;
}

/** Enumerate the `index/registry-index/` family (sorted deterministic order). */
export function enumerateRegistryIndexFiles(namespaceRoot: string, serviceUid: number): { readonly ok: boolean; readonly candidates?: readonly IndexCandidate[]; readonly code?: string; readonly message?: string } {
  const familyDir = `${namespaceRoot}/index/${REGISTRY_INDEX_FAMILY}`;
  const familyBracket = readdirNoFollow(`${namespaceRoot}/index`, serviceUid);
  if (!familyBracket.ok) return { ok: false, code: familyBracket.code, message: familyBracket.message };
  if (familyBracket.absent === true || familyBracket.names === undefined || !familyBracket.names.includes(REGISTRY_INDEX_FAMILY)) {
    return { ok: true, candidates: [] };
  }
  const family = readdirNoFollow(familyDir, serviceUid);
  if (!family.ok) return { ok: false, code: family.code, message: family.message };
  if (family.absent === true || family.names === undefined) return { ok: true, candidates: [] };
  const candidates: IndexCandidate[] = [];
  for (const shardName of family.names) {
    if (!SHARD_RE.test(shardName)) continue;
    const shardBracket = readdirNoFollow(`${familyDir}/${shardName}`, serviceUid);
    if (!shardBracket.ok) return { ok: false, code: shardBracket.code, message: shardBracket.message };
    if (shardBracket.absent === true || shardBracket.names === undefined) continue;
    for (const entryName of shardBracket.names) {
      if (!REGISTRY_INDEX_FILENAME_RE.test(entryName)) continue;
      candidates.push({ indexId: entryName.slice(0, 32), shard: shardName });
    }
  }
  candidates.sort((a, b) => (a.shard < b.shard ? -1 : a.shard > b.shard ? 1 : a.indexId < b.indexId ? -1 : 1));
  return { ok: true, candidates };
}

/**
 * Descriptor-bound read of one registry-index file at its derived path
 * (UID/mode/type checks, bounded bytes, pre/post revalidation). Returns the
 * raw canonical bytes for the pure parser.
 */
export function readRegistryIndexFile(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly indexId: string;
}): { readonly ok: boolean; readonly raw?: string; readonly code?: string; readonly message?: string } {
  const derived = deriveRegistryIndexRelativePath(input.indexId);
  if (!derived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'registry-index path derivation failed' };
  }
  let fd: number | undefined;
  try {
    fd = openSync(`${input.namespaceRoot}/${derived.relativePath}`, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const pre = fstatSync(fd);
    const verified = verifyRegularFileStat(pre, input.serviceUid);
    if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
    if (pre.size > input.byteLimit) {
      return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'registry index exceeds the bounded byte limit' };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok || post.size !== bytes.length) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'registry index changed during descriptor-based read' };
    }
    return { ok: true, raw: bytes.toString('utf8') };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'registry index is absent' };
    }
    if (code === 'ELOOP' || code === 'ENOTDIR' || code === 'ENXIO' || code === 'ENODEV' || code === 'EISDIR') {
      return { ok: false, code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'registry index location is not a regular file' };
    }
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'registry index could not be read' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Deterministic fast-path index-state vocabulary (WP-8-H §8). */
export type RegistryIndexLiveState =
  | 'current-valid'
  | 'missing'
  | 'malformed'
  | 'unsupported-version'
  | 'stale-generation'
  | 'stale-surface'
  | 'stale-record-set'
  | 'stale-audit-state'
  | 'stale-observation-set'
  | 'conflicting-index'
  | 'wrong-type'
  | 'wrong-uid-or-mode'
  | 'foreign-index-entry'
  | 'store-mismatch'
  | 'unreadable';

export interface RegistryIndexLiveValidation {
  readonly state: RegistryIndexLiveState;
  readonly model?: ParsedRegistryIndex;
}

function sameStoreIdentity(model: ParsedRegistryIndex, storeInstance: VerifiedStoreInstance): boolean {
  if (model.binding.storeInstance.parentIdentity.dev !== storeInstance.parentIdentity.dev || model.binding.storeInstance.parentIdentity.ino !== storeInstance.parentIdentity.ino) return false;
  if (model.binding.storeInstance.namespaces.length !== storeInstance.namespaces.length) return false;
  const expected = [...storeInstance.namespaces].sort((a, b) => (a.kind < b.kind ? -1 : 1));
  const actual = [...model.binding.storeInstance.namespaces].sort((a, b) => (a.kind < b.kind ? -1 : 1));
  for (let i = 0; i < expected.length; i++) {
    const x = expected[i]!;
    const y = actual[i]!;
    if (x.kind !== y.kind || x.dev !== y.dev || x.ino !== y.ino) return false;
  }
  return true;
}

/**
 * WP-8-H fast-path validation (WP-8-H §8/§10): enumerate the index family,
 * probe the live entry set once, recompute the registry generation and
 * surface tokens, and validate every candidate index in deterministic
 * order. The first `current-valid` index wins; otherwise the most specific
 * deterministic state of the first candidate is returned (or `missing`).
 * A forged, stale, malformed, or conflicting index never serves and never
 * masks authoritative store errors — the caller falls back to the
 * authoritative scan whenever the state is not `current-valid`.
 */
export function validateRegistryIndexLive(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly storeInstance: VerifiedStoreInstance;
  readonly indexByteLimit: number;
}): RegistryIndexLiveValidation {
  const enumerated = enumerateRegistryIndexFiles(input.namespaceRoot, input.serviceUid);
  if (!enumerated.ok) {
    return { state: 'unreadable' };
  }
  if (enumerated.candidates === undefined || enumerated.candidates.length === 0) {
    return { state: 'missing' };
  }
  const probe = probeRegistryEntrySet(input.namespaceRoot, input.serviceUid);
  if (!probe.ok || probe.entries === undefined) {
    return { state: 'unreadable' };
  }
  const profile = input.storeInstance.limitProfile;
  const generation = computeScanGeneration({
    storeInstance: input.storeInstance,
    mode: 'registry',
    entryLimit: profile['totalScanEntries'] ?? 1024 * 1024,
    byteLimit: profile['totalScanBytes'] ?? 4 * 1024 * 1024 * 1024,
    failClosed: false,
  });
  const surface = recomputeSurfaceGeneration({ namespaceRoot: input.namespaceRoot, serviceUid: input.serviceUid, mode: 'registry' });
  if (!surface.ok || surface.generation === undefined) {
    return { state: 'unreadable' };
  }
  let firstState: RegistryIndexLiveState | undefined;
  for (const candidate of enumerated.candidates) {
    const read = readRegistryIndexFile({ namespaceRoot: input.namespaceRoot, serviceUid: input.serviceUid, byteLimit: input.indexByteLimit, indexId: candidate.indexId });
    if (!read.ok) {
      const state: RegistryIndexLiveState =
        read.code === 'ERR-STO-NOT-FOUND' ? 'missing' : read.code === 'ERR-STO-FTYPE-UNSUPPORTED' ? 'wrong-type' : read.code === 'ERR-STO-PERM-DENIED' ? 'wrong-uid-or-mode' : 'malformed';
      if (firstState === undefined) firstState = state;
      continue;
    }
    const parsed = parseRegistryIndex(read.raw ?? '', input.indexByteLimit, REGISTRY_INDEX_MAX_ENTRIES);
    if (!parsed.ok || parsed.model === undefined) {
      if (firstState === undefined) firstState = 'malformed';
      continue;
    }
    const model = parsed.model;
    if (model.modelVersion !== REGISTRY_INDEX_MODEL_VERSION) {
      if (firstState === undefined) firstState = 'unsupported-version';
      continue;
    }
    if (!sameStoreIdentity(model, input.storeInstance)) {
      if (firstState === undefined) firstState = 'foreign-index-entry';
      continue;
    }
    const consistent = validateRegistryIndexSelfConsistency(model);
    if (!consistent.ok) {
      if (firstState === undefined) firstState = 'conflicting-index';
      continue;
    }
    if (model.binding.generation !== generation) {
      if (firstState === undefined) firstState = 'stale-generation';
      continue;
    }
    if (model.binding.surfaceGeneration !== surface.generation) {
      if (firstState === undefined) firstState = 'stale-surface';
      continue;
    }
    const manifest = registryIndexManifest(model);
    const comparison = compareManifestAgainstProbe(manifest, probe.entries);
    if (!comparison.ok) {
      if (firstState === undefined) {
        firstState = comparison.side === 'audit' ? 'stale-audit-state' : 'stale-record-set';
      }
      continue;
    }
    // The observation root binds the full stored observation set; the
    // manifest covers the same entries, so a manifest match implies the
    // observation root matches the live store (up to the TML-002 boundary).
    return { state: 'current-valid', model };
  }
  return { state: firstState ?? 'missing' };
}
