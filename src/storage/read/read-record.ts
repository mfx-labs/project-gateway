/**
 * WP-8-D exact read, verify-by-identity, and verified-store revalidation
 * (contract 13, RDS-001…012; ADR-029 D-5). Filesystem-bearing, READ-ONLY:
 * this module imports no mutating `node:fs` API and no directory-scan
 * APIs (bounded enumeration in `enumerate.ts` is the sole scan owner).
 *
 * Exact read: validated record class + canonical typed identity only; no raw
 * path, no alias/title/workspace path (LAY-005); descriptor-bound no-follow
 * open; mandatory pre/post descriptor verification; bounded bytes; strict
 * canonical parsing with duplicate-key rejection; digest and derived-location
 * verification; immutable copy on return; no lifecycle interpretation; no
 * mutation (RDS-011).
 *
 * Verify: structured integrity/format/location findings only (RDS-003);
 * never returns record content; a valid record confers no authority
 * (ITG-007, TAU-008); no repair.
 *
 * D-5 revalidation helpers (capability-free descriptor primitives used by
 * the composition boundaries): `verifyNamespaceRootIdentity` and
 * `verifyStoreMetadataAtPath` re-establish the verified store instance from
 * the metadata verification pipeline (descriptor-bound read; canonical
 * parse with duplicate-key rejection; payload/record digest verification;
 * namespace, parent, configuration, and limit-profile identity verification
 * against the caller's verified expectation).
 */
import { openSync, closeSync, fstatSync, readFileSync } from 'node:fs';
import { constants } from 'node:fs';
import { parseRawJson } from '../../json/scanner.js';
import { jcsSerialize } from '../../canonical/jcs.js';
import { METADATA_MAX_BYTES, METADATA_RECORD_FORMAT_VERSION, METADATA_RECORD_KIND, verifyMetadataModel } from '../metadata/store-metadata.js';
import { parsePersistedEnvelope, payloadDigestMatches } from '../format/envelope.js';
import { deriveRecordRelativePath } from '../layout/layout.js';
import { namespaceRootPath } from '../initialization/provision.js';
import { checkForbiddenRootOverlap, validateAndCaptureParent } from '../root/resolve.js';
import { comparePrePostStat, verifyDirectoryStat, verifyRegularFileStat } from '../root/identity.js';
import type { ReadCapability, VerifyCapability } from '../capabilities/authenticity.js';
import type { NamespaceIdentity, RecordClassId, ReadRecordResult, StorageFinding, StoreMetadataExpectation, VerifiedStoreInstance, VerifiedStoreMetadata, VerifyRecordResult } from '../types.js';

const { O_RDONLY, O_NOFOLLOW, O_DIRECTORY } = constants;

/** Stable store facts shared with the initialization orchestrator (LANE/versions). */
const STORE_LANE = 'posix-0700';
const STORE_LAYOUT_VERSION = 'v1';
const STORE_METADATA_FORMAT_VERSION = '1';

/** Metadata file path under a namespace root (fixed derivation). */
function metadataFilePath(namespaceRoot: string): string {
  return `${namespaceRoot}/metadata/metadata.json`;
}

/**
 * D-5 verified-store-instance pipeline (shared by the write and read
 * composition boundaries): revalidate the trusted parent, verify both
 * namespace-root descriptors, and verify both StoreMetadata files against
 * the caller's verified expectation (descriptor-bound, canonical, digest-
 * and identity-verified). Only the resulting `VerifiedStoreInstance` may
 * feed a capability creation gate. Failures map to the closed codes with
 * point-of-use semantics (SRX-013, FSP-014).
 */
export function verifyStoreInstance(input: {
  readonly locator: string;
  readonly serviceUid: number;
  readonly forbiddenRoots: readonly string[];
  readonly configurationIdentity: string;
  readonly configurationVersion: string;
  readonly limitProfile: Readonly<Record<string, number>>;
}): { readonly ok: boolean; readonly storeInstance?: VerifiedStoreInstance; readonly code?: string; readonly message?: string } {
  const parent = validateAndCaptureParent(input.locator, input.serviceUid, input.forbiddenRoots);
  if (!parent.ok || parent.identity === undefined) {
    return { ok: false, code: parent.code ?? 'ERR-STO-ROOT-INVALID', message: parent.message ?? 'trusted parent validation failed' };
  }
  const overlap = checkForbiddenRootOverlap(parent.identity, input.forbiddenRoots);
  if (!overlap.ok) {
    return { ok: false, code: overlap.code ?? 'ERR-STO-ROOT-INVALID', message: overlap.message ?? 'trusted parent overlaps a forbidden root' };
  }
  const kinds: readonly NamespaceIdentity['kind'][] = ['configuration', 'store-records'];
  const namespaces: NamespaceIdentity[] = [];
  for (const kind of kinds) {
    const root = namespaceRootPath(parent.identity.canonicalPath, kind);
    const ns = verifyNamespaceRootIdentity(root, input.serviceUid, kind);
    if (!ns.ok || ns.identity === undefined) {
      return { ok: false, code: ns.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', message: ns.message ?? 'namespace root could not be revalidated' };
    }
    const expectation: Omit<StoreMetadataExpectation, 'actionIdentity'> = {
      metadataFormatVersion: STORE_METADATA_FORMAT_VERSION,
      layoutVersion: STORE_LAYOUT_VERSION,
      namespaceKind: kind,
      namespaceIdentity: ns.identity,
      parentIdentity: parent.identity,
      lane: STORE_LANE,
      configurationIdentity: input.configurationIdentity,
      limitProfileIdentity: { configurationVersion: input.configurationVersion, configurationIdentity: input.configurationIdentity },
    };
    const meta = verifyStoreMetadataAtPath({ path: metadataFilePath(root), expected: expectation, serviceUid: input.serviceUid });
    if (!meta.ok || meta.metadata === undefined) {
      return { ok: false, code: meta.code ?? 'ERR-STO-INTEGRITY', message: meta.message ?? 'store metadata verification failed' };
    }
    namespaces.push(ns.identity);
  }
  // Deterministic order: configuration namespace first, then store-records.
  namespaces.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'configuration' ? -1 : 1));
  return {
    ok: true,
    storeInstance: {
      parentIdentity: parent.identity,
      namespaces,
      configurationIdentity: input.configurationIdentity,
      serviceUid: input.serviceUid,
      limitProfile: { ...input.limitProfile },
    },
  };
}

/** Pure finding builder (disclosure-safe static messages; ERM-004). */
export function readFinding(code: string, message: string, phase: 'request-validation' | 'temporary-write' | 'pre-publication' = 'request-validation'): StorageFinding {
  return { code, message, phase, state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } };
}

/**
 * Descriptor-bound no-follow verification of one namespace root
 * (point-of-use revalidation; SRX-013/FSP-014). Returns the current
 * identity; the caller compares it with the bound store-instance identity.
 */
export function verifyNamespaceRootIdentity(path: string, serviceUid: number, kind: NamespaceIdentity['kind']): { readonly ok: boolean; readonly identity?: NamespaceIdentity; readonly code?: string; readonly message?: string } {
  let fd: number | undefined;
  try {
    fd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const stat = fstatSync(fd);
    const verified = verifyDirectoryStat(stat, serviceUid);
    if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
    return { ok: true, identity: { kind, canonicalPath: path, dev: Number(stat.dev), ino: Number(stat.ino) } };
  } catch {
    return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'namespace root could not be revalidated' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * D-5 verified-StoreMetadata revalidation: descriptor-bound no-follow read,
 * canonical parse (duplicate-key rejection), payload/record digest
 * verification, and identity verification against the caller's verified
 * expectation. The stored action identity is a digest-bound stored fact of
 * the bootstrap action (bound by the recomputed payload digest); every
 * caller-verifiable field (namespace, parent, configuration, limit profile,
 * lane, versions) is cross-checked. Wrong record kind → MALFORMED;
 * recognized kind with unsupported version → UNSUPPORTED-VERSION (W8C-S04
 * precedence).
 */
export function verifyStoreMetadataAtPath(input: {
  readonly path: string;
  readonly expected: Omit<StoreMetadataExpectation, 'actionIdentity'>;
  readonly serviceUid: number;
}): { readonly ok: boolean; readonly metadata?: VerifiedStoreMetadata; readonly code?: string; readonly message?: string } {
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW);
    const pre = fstatSync(fd);
    const typeCheck = verifyRegularFileStat(pre, input.serviceUid);
    if (!typeCheck.ok) return { ok: false, code: typeCheck.code, message: typeCheck.message };
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok) return { ok: false, code: revalidated.code, message: revalidated.message };
    if (post.size !== bytes.length) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'metadata changed during descriptor-based read' };
    }
    let model: unknown;
    try {
      model = parseRawJson(bytes, METADATA_MAX_BYTES).model;
    } catch {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'metadata is not canonical JSON or contains duplicate members' };
    }
    if (typeof model !== 'object' || model === null || Array.isArray(model)) {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'metadata must be a JSON object' };
    }
    const raw = bytes.toString('utf8');
    if (jcsSerialize(model) !== raw) {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'metadata bytes are not canonical' };
    }
    const modelObj = model as Readonly<Record<string, unknown>>;
    if (modelObj['recordKind'] !== METADATA_RECORD_KIND) {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'metadata record kind is not the store-metadata kind' };
    }
    if (modelObj['formatVersion'] !== METADATA_RECORD_FORMAT_VERSION) {
      return { ok: false, code: 'ERR-STO-UNSUPPORTED-VERSION', message: 'metadata version is not supported' };
    }
    const payload = modelObj['payload'];
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'metadata payload must be an object' };
    }
    const storedAction = (payload as Readonly<Record<string, unknown>>)['actionIdentity'];
    if (typeof storedAction !== 'string' || storedAction.length === 0) {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'metadata action identity is malformed' };
    }
    const verified = verifyMetadataModel(model as Readonly<Record<string, unknown>>, { ...input.expected, actionIdentity: storedAction });
    if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
    if (verified.metadata === undefined) {
      return { ok: false, code: 'ERR-STO-INTERNAL-INVARIANT', message: 'metadata verification produced no model' };
    }
    return { ok: true, metadata: verified.metadata };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'metadata file is absent' };
    }
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'metadata revalidation failed' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export interface VerifiedRecordObject {
  readonly ok: boolean;
  readonly recordId?: string;
  readonly revision?: number;
  readonly digest?: string;
  readonly canonicalUtf8?: string;
  readonly byteLength?: number;
  readonly code?: string;
  readonly message?: string;
}

/**
 * Descriptor primitive: verify one record object at a derived path (canonical
 * parse, payload-digest verification, bounded bytes, pre/post descriptor
 * revalidation). Used by the capability-gated read/verify wrappers and by the
 * bounded enumeration (sole content-verification owner). Never mutates.
 */
export function verifyRecordObjectAt(input: {
  readonly path: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
}): VerifiedRecordObject {
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW);
    const pre = fstatSync(fd);
    const typeCheck = verifyRegularFileStat(pre, input.serviceUid);
    if (!typeCheck.ok) return { ok: false, code: typeCheck.code, message: typeCheck.message };
    if (pre.size > input.byteLimit) {
      return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'record exceeds the bounded byte limit' };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok) return { ok: false, code: revalidated.code, message: revalidated.message };
    if (post.size !== bytes.length) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'record changed during descriptor-based read' };
    }
    const raw = bytes.toString('utf8');
    const parsed = parsePersistedEnvelope(raw, input.byteLimit);
    if (!parsed.ok || parsed.bytes === undefined || parsed.model === undefined) {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'record is not a canonical envelope' };
    }
    const model = parsed.model as Readonly<Record<string, unknown>>;
    const payload = model['payload'];
    const declared = model['payloadDigest'];
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload) || typeof declared !== 'string') {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'record payload or payload digest is malformed' };
    }
    if (!payloadDigestMatches(payload as Readonly<Record<string, unknown>>, declared)) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'record payload digest mismatch' };
    }
    const recordId = model['recordId'];
    const revision = model['revision'];
    if (typeof recordId !== 'string' || typeof revision !== 'number') {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'record identity fields are malformed' };
    }
    return { ok: true, recordId, revision, digest: parsed.bytes.digest, canonicalUtf8: parsed.bytes.canonicalUtf8, byteLength: parsed.bytes.byteLength };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'record is absent' };
    }
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'record verification failed' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Derived record path under a verified namespace root (LAY-003…008). */
function deriveRecordPath(namespaceRoot: string, recordClass: RecordClassId, rawIdentifier: string): { readonly ok: boolean; readonly path?: string; readonly code?: string; readonly message?: string } {
  const derived = deriveRecordRelativePath(recordClass, rawIdentifier);
  if (!derived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'record path derivation failed' };
  }
  return { ok: true, path: `${namespaceRoot}/${derived.relativePath}` };
}

/**
 * Exact read by identity (RDS-001/002/008/009/011/012): capability-gated,
 * class + canonical identity only, descriptor-bound, canonical, digest- and
 * location-verified, copy-on-return. No mutation.
 */
export function readRecordByIdentity(input: {
  readonly capability: ReadCapability;
  readonly namespaceRoot: string;
  readonly recordClass: RecordClassId;
  readonly rawIdentifier: string;
}): ReadRecordResult {
  const check = input.capability.verify('read-record');
  if (!check.ok) {
    return { ok: false, findings: [readFinding('ERR-STO-REQ-INVALID', 'read capability is not usable at the read boundary')] };
  }
  const byteLimit = input.capability.binding.limitProfile['recordBytes'] ?? 1024 * 1024;
  const derived = deriveRecordPath(input.namespaceRoot, input.recordClass, input.rawIdentifier);
  if (!derived.ok || derived.path === undefined) {
    return { ok: false, findings: [readFinding(derived.code ?? 'ERR-STO-CONTAINMENT-DENIED', derived.message ?? 'record path derivation failed')] };
  }
  const verified = verifyRecordObjectAt({ path: derived.path, serviceUid: input.capability.binding.serviceUid, byteLimit });
  if (!verified.ok) {
    return { ok: false, findings: [readFinding(verified.code ?? 'ERR-STO-IO-FAILURE', verified.message ?? 'record verification failed')] };
  }
  // ITG-003: the opened path is the derived path by construction; confirm the
  // envelope identity matches the requested identity before returning.
  if (verified.recordId !== input.rawIdentifier) {
    return { ok: false, findings: [readFinding('ERR-STO-INTEGRITY', 'record identity does not match the requested identity')] };
  }
  const parsed = parsePersistedEnvelope(verified.canonicalUtf8 ?? '', byteLimit);
  if (!parsed.ok || parsed.model === undefined) {
    return { ok: false, findings: [readFinding('ERR-STO-MALFORMED', 'record is not a canonical envelope')] };
  }
  // Immutable copy on return (RDS-008): no live store handles or mutable
  // objects are exposed.
  const model = parsed.model as Readonly<Record<string, unknown>>;
  const frozenPayload = (model['payload'] as Readonly<Record<string, unknown>>);
  const copy = Object.freeze({ ...model, payload: Object.freeze({ ...frozenPayload }) });
  return { ok: true, record: copy, digest: verified.digest, byteLength: verified.byteLength };
}

/**
 * Verify by identity (RDS-003): structured integrity/format/location
 * findings only; never returns record content; a valid record confers no
 * authority; no repair.
 */
export function verifyRecordByIdentity(input: {
  readonly capability: VerifyCapability;
  readonly namespaceRoot: string;
  readonly recordClass: RecordClassId;
  readonly rawIdentifier: string;
}): VerifyRecordResult {
  const check = input.capability.verify('verify-record');
  if (!check.ok) {
    return { ok: false, findings: [readFinding('ERR-STO-REQ-INVALID', 'verify capability is not usable at the verify boundary')] };
  }
  const byteLimit = input.capability.binding.limitProfile['recordBytes'] ?? 1024 * 1024;
  const derived = deriveRecordPath(input.namespaceRoot, input.recordClass, input.rawIdentifier);
  if (!derived.ok || derived.path === undefined) {
    return { ok: false, findings: [readFinding(derived.code ?? 'ERR-STO-CONTAINMENT-DENIED', derived.message ?? 'record path derivation failed')] };
  }
  const verified = verifyRecordObjectAt({ path: derived.path, serviceUid: input.capability.binding.serviceUid, byteLimit });
  if (!verified.ok) {
    return { ok: false, findings: [readFinding(verified.code ?? 'ERR-STO-IO-FAILURE', verified.message ?? 'record verification failed')] };
  }
  if (verified.recordId !== input.rawIdentifier) {
    return { ok: false, findings: [readFinding('ERR-STO-INTEGRITY', 'record identity does not match the requested identity')] };
  }
  return { ok: true, findings: [] };
}
