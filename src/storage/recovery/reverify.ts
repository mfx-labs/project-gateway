/**
 * WP-8-F descriptor-bound current-state re-verification (contract 16.2/16.3,
 * CSA-008; WPR-023 (a)). FILESYSTEM-BEARING, READ-ONLY: this module re-reads
 * the mutation target and its durable publication through no-follow,
 * non-blocking, descriptor-bound access and verifies type, UID, exact mode,
 * link count, size, identity, and content digest BEFORE any mutation may
 * proceed. A prior registry view, recovery assessment, plan, or cursor is
 * never sufficient evidence by itself (WP-8-F §3).
 *
 * The WPR-023 (a) orphan-temporary re-verification establishes exactly:
 *   - the temporary entry name matches the closed publication-temp grammar
 *     and its bytes are a canonical store record whose identity and
 *     record-bytes digest equal the authorized expected twin facts;
 *   - the record kind maps to exactly one store-records class (the twin's
 *     derived class), never a configuration-class or store-metadata label;
 *   - the durable publication at the internally derived path is a regular
 *     file with the store policy whose bytes match the same digest and
 *     whose descriptor identity (dev/ino) is the SAME inode as the
 *     temporary (the crash-twin relationship);
 *   - the link count matches the authorized expectation (changed link
 *     counts fail closed);
 *   - the cross-page surface-structure token still matches the assessment.
 *
 * No path from any request operand is ever trusted: every path is derived
 * internally from the verified store root, the closed class vocabulary, and
 * the validated canonical identity. No mutation API exists in this module.
 */
import { openSync, closeSync, fstatSync, readFileSync } from 'node:fs';
import { constants } from 'node:fs';
import { computeDomainDigest, parsePersistedEnvelope, STORAGE_RECORD_BYTES_DIGEST_DOMAIN } from '../format/envelope.js';
import { RECORD_CLASS_BY_ID } from '../format/taxonomy.js';
import type { RecordClassId } from '../types.js';
import { deriveRecordRelativePath } from '../layout/layout.js';
import { comparePrePostStat, verifyRegularFileStat } from '../root/identity.js';
import { isPublicationTemporaryName, recomputeSurfaceGeneration } from './scan.js';
import { isGenuineRecoveryCapability, type RecoveryCapability } from '../capabilities/authenticity.js';

const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = constants;

/** One descriptor-bound verified object fact set (never a path). */
export interface VerifiedObjectFacts {
  readonly dev: number;
  readonly ino: number;
  readonly nlink: number;
  readonly size: number;
  readonly recordId: string;
  /** Store-records class mapped from the envelope record kind (undefined = no mapping). */
  readonly recordClass?: RecordClassId;
  readonly recordDigest: string;
}

export interface OrphanTwinVerification {
  readonly ok: boolean;
  /** Descriptor facts of the verified temporary object (inode twin). */
  readonly temp?: VerifiedObjectFacts;
  /** Descriptor facts of the verified durable publication (same inode). */
  readonly twin?: VerifiedObjectFacts;
  readonly code?: string;
  readonly message?: string;
}

/**
 * Descriptor-bound read + canonical parse of one store object (records or
 * tmp surface). Bounded by the applicable byte limit; pre/post stat
 * comparison; wrong type/UID/mode fails closed.
 */
function readVerifiedEnvelope(input: {
  readonly path: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
}): { readonly ok: boolean; readonly facts?: VerifiedObjectFacts; readonly model?: Readonly<Record<string, unknown>>; readonly code?: string; readonly message?: string } {
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const pre = fstatSync(fd);
    const verified = verifyRegularFileStat(pre, input.serviceUid);
    if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
    if (pre.size > input.byteLimit) {
      return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'object exceeds the bounded byte limit' };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok) return { ok: false, code: revalidated.code, message: revalidated.message };
    if (post.size !== bytes.length) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'object changed during descriptor-based read' };
    }
    const raw = bytes.toString('utf8');
    const parsed = parsePersistedEnvelope(raw, input.byteLimit);
    if (!parsed.ok || parsed.model === undefined || parsed.bytes === undefined) {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'object is not a canonical record envelope' };
    }
    const model = parsed.model as Readonly<Record<string, unknown>>;
    const recordId = typeof model['recordId'] === 'string' ? model['recordId'] : undefined;
    if (recordId === undefined) {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'object envelope carries no record identity' };
    }
    return {
      ok: true,
      facts: {
        dev: Number(pre.dev),
        ino: Number(pre.ino),
        nlink: Number(pre.nlink),
        size: Number(pre.size),
        recordId,
        recordClass: recordClassOfLabel(model['recordKind']),
        recordDigest: parsed.bytes.digest,
      },
      model,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'object is absent' };
    }
    if (code === 'ELOOP' || code === 'ENOTDIR' || code === 'ENXIO' || code === 'ENODEV' || code === 'EISDIR') {
      return { ok: false, code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'object location is not a regular file' };
    }
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'object could not be re-verified descriptor-bound' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Map an envelope record-kind label to its store-records class (never configuration/store-metadata). */
export function recordClassOfLabel(label: unknown): RecordClassId | undefined {
  if (typeof label !== 'string') return undefined;
  for (const profile of RECORD_CLASS_BY_ID.values()) {
    if (profile.label === label && profile.namespace === 'store-records' && profile.id !== 'store-metadata') return profile.id;
  }
  return undefined;
}

/**
 * Re-verify the WPR-023 (a) orphan-temporary state immediately before any
 * mutation. Fails closed on any mismatch: changed content, changed inode,
 * changed UID/mode, changed link count, disappeared source, replaced source,
 * changed durable twin, or surface-structure drift.
 */
export function reverifyOrphanTwin(input: {
  readonly capability: RecoveryCapability;
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly temporaryBytes: number;
  readonly recordBytes: number;
  readonly targetEntry: string;
  readonly expectedTwinRecordId: string;
  readonly expectedTwinDigest: string;
  readonly expectedLinkCount: number;
  readonly expectedSurfaceGeneration: string;
}): OrphanTwinVerification {
  // The capability operand must be genuine before any filesystem access.
  if (!isGenuineRecoveryCapability(input.capability)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery capability operand is not genuine' };
  }
  const check = input.capability.verify('orphan-removal');
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery capability is not usable at the re-verification boundary' };
  }
  if (!isPublicationTemporaryName(input.targetEntry)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'temporary entry designation is not a publication temporary name' };
  }
  // Cross-page structural drift (F3-G): the assessment-bound surface token
  // must still match the current structure.
  const surface = recomputeSurfaceGeneration({ namespaceRoot: input.namespaceRoot, serviceUid: input.serviceUid, mode: 'recovery' });
  if (!surface.ok || surface.generation === undefined) {
    return { ok: false, code: surface.code ?? 'ERR-STO-IO-FAILURE', message: surface.message ?? 'surface structure could not be re-read' };
  }
  if (surface.generation !== input.expectedSurfaceGeneration) {
    return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'store structure changed since the recovery assessment' };
  }
  // The temporary object: canonical record bytes, identity and digest.
  const tmpDirPath = `${input.namespaceRoot}/tmp`;
  const tempPath = `${tmpDirPath}/${input.targetEntry}`;
  const tempRead = readVerifiedEnvelope({ path: tempPath, serviceUid: input.serviceUid, byteLimit: input.temporaryBytes });
  if (!tempRead.ok || tempRead.facts === undefined) {
    return { ok: false, code: tempRead.code ?? 'ERR-STO-INTEGRITY', message: tempRead.message ?? 'temporary object could not be re-verified' };
  }
  const temp = tempRead.facts;
  if (temp.recordClass === undefined) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'temporary record kind maps to no store-records class' };
  }
  if (temp.recordId !== input.expectedTwinRecordId) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'temporary identity does not match the authorized request' };
  }
  if (temp.recordDigest !== input.expectedTwinDigest) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'temporary content digest does not match the authorized request' };
  }
  if (temp.nlink !== input.expectedLinkCount) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'temporary link count changed since the recovery assessment' };
  }
  // The durable twin: internally derived path from the verified class and
  // identity; same inode, same bytes.
  const derived = deriveRecordRelativePath(temp.recordClass, temp.recordId);
  if (!derived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'twin path derivation failed' };
  }
  const twinPath = `${input.namespaceRoot}/${derived.relativePath}`;
  const twinRead = readVerifiedEnvelope({ path: twinPath, serviceUid: input.serviceUid, byteLimit: input.recordBytes });
  if (!twinRead.ok || twinRead.facts === undefined) {
    return { ok: false, code: twinRead.code ?? 'ERR-STO-INTEGRITY', message: twinRead.message ?? 'durable twin could not be re-verified' };
  }
  const twin = twinRead.facts;
  if (twin.recordDigest !== input.expectedTwinDigest) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'durable twin content digest does not match the authorized request' };
  }
  if (twin.recordId !== input.expectedTwinRecordId) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'durable twin identity does not match the authorized request' };
  }
  if (twin.dev !== temp.dev || twin.ino !== temp.ino) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'temporary object is not an inode twin of the durable publication' };
  }
  if (twin.nlink !== input.expectedLinkCount) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'durable twin link count changed since the recovery assessment' };
  }
  return { ok: true, temp, twin };
}

/**
 * Descriptor-bound digest verification of one quarantine destination object
 * (WP-8-F): regular file, exact policy, bounded size, canonical content
 * read, exact expected digest.
 */
export function verifyQuarantineObjectDigest(input: {
  readonly path: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly expectedDigest: string;
}): { readonly ok: boolean; readonly code?: string; readonly message?: string } {
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const pre = fstatSync(fd);
    const verified = verifyRegularFileStat(pre, input.serviceUid);
    if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
    if (pre.size > input.byteLimit) {
      return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'object exceeds the bounded byte limit' };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok || post.size !== bytes.length) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'object changed during descriptor-based read' };
    }
    const raw = bytes.toString('utf8');
    const digest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, raw);
    if (digest !== input.expectedDigest) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'object content digest does not match the expected digest' };
    }
    return { ok: true };
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
 * Re-verify a WPR-023 (b)/(c) quarantine source immediately before the
 * mutation (WP-8-F §16.5): regular file, exact UID/mode, size within the
 * temporary bound, `nlink` 1 (normal) or 2 (recoverable interrupted-link
 * state, confirmed against the derived destination), exact content digest,
 * and the current classification recomputed from the bytes. The recovery
 * capability and the surface generation are re-verified.
 */
export function reverifyQuarantineSource(input: {
  readonly capability: RecoveryCapability;
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly temporaryBytes: number;
  readonly targetEntry: string;
  readonly expectedClassification: 'incomplete-unpublished' | 'malformed-temporary';
  readonly expectedSourceDigest: string;
  readonly expectedSurfaceGeneration: string;
}): { readonly ok: boolean; readonly source?: { readonly dev: number; readonly ino: number; readonly nlink: number }; readonly code?: string; readonly message?: string } {
  if (!isGenuineRecoveryCapability(input.capability)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery capability operand is not genuine' };
  }
  const check = input.capability.verify('quarantine-temporary');
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery capability is not usable at the quarantine re-verification boundary' };
  }
  if (!isPublicationTemporaryName(input.targetEntry)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'temporary entry designation is not a publication temporary name' };
  }
  const surface = recomputeSurfaceGeneration({ namespaceRoot: input.namespaceRoot, serviceUid: input.serviceUid, mode: 'recovery' });
  if (!surface.ok || surface.generation === undefined) {
    return { ok: false, code: surface.code ?? 'ERR-STO-IO-FAILURE', message: surface.message ?? 'surface structure could not be re-read' };
  }
  if (surface.generation !== input.expectedSurfaceGeneration) {
    return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'store structure changed since the recovery assessment' };
  }
  const tmpDirPath = `${input.namespaceRoot}/tmp`;
  const tempPath = `${tmpDirPath}/${input.targetEntry}`;
  let fd: number | undefined;
  try {
    fd = openSync(tempPath, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const pre = fstatSync(fd);
    const verified = verifyRegularFileStat(pre, input.serviceUid);
    if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
    if (pre.size > input.temporaryBytes) {
      return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'temporary object exceeds the bounded byte limit' };
    }
    const nlink = Number(pre.nlink);
    if (nlink !== 1 && nlink !== 2) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'temporary object has an unexpected link count' };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok || post.size !== bytes.length) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'temporary object changed during descriptor-based read' };
    }
    const raw = bytes.toString('utf8');
    const digest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, raw);
    if (digest !== input.expectedSourceDigest) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'temporary content digest does not match the authorized request' };
    }
    // Current classification recomputed from the bytes (WPR-023 (b)/(c)).
    let classification: 'incomplete-unpublished' | 'malformed-temporary';
    try {
      const parsed = parsePersistedEnvelope(raw, input.temporaryBytes);
      const ok = parsed.ok && parsed.model !== undefined;
      classification = ok ? 'incomplete-unpublished' : 'malformed-temporary';
    } catch {
      classification = 'malformed-temporary';
    }
    if (classification !== input.expectedClassification) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'temporary classification no longer matches the authorized request' };
    }
    return { ok: true, source: { dev: Number(pre.dev), ino: Number(pre.ino), nlink } };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'temporary object is absent' };
    }
    if ((err as NodeJS.ErrnoException).code === 'ELOOP' || (err as NodeJS.ErrnoException).code === 'ENOTDIR' || (err as NodeJS.ErrnoException).code === 'ENXIO' || (err as NodeJS.ErrnoException).code === 'EISDIR') {
      return { ok: false, code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'temporary location is not a regular file' };
    }
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'temporary object could not be re-verified' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Re-verify the durable twin only (used on the already-removed path: the
 * temporary name is gone but the twin must still be intact and unchanged).
 */
export function reverifyTwinOnly(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly recordBytes: number;
  readonly twinRecordId: string;
  readonly twinRecordClass: RecordClassId;
  readonly expectedTwinDigest: string;
  readonly expectedLinkCount: number;
}): { readonly ok: boolean; readonly twin?: VerifiedObjectFacts; readonly code?: string; readonly message?: string } {
  const derived = deriveRecordRelativePath(input.twinRecordClass, input.twinRecordId);
  if (!derived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'twin path derivation failed' };
  }
  const twinPath = `${input.namespaceRoot}/${derived.relativePath}`;
  const twinRead = readVerifiedEnvelope({ path: twinPath, serviceUid: input.serviceUid, byteLimit: input.recordBytes });
  if (!twinRead.ok || twinRead.facts === undefined) {
    return { ok: false, code: twinRead.code ?? 'ERR-STO-INTEGRITY', message: twinRead.message ?? 'durable twin could not be re-verified' };
  }
  const twin = twinRead.facts;
  if (twin.recordDigest !== input.expectedTwinDigest || twin.recordId !== input.twinRecordId) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'durable twin content or identity changed' };
  }
  // The temporary name is gone: the inode's link count dropped by exactly
  // one relative to the assessment-time count.
  if (twin.nlink !== input.expectedLinkCount - 1) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'durable twin link count does not match the removed-temporary state' };
  }
  return { ok: true, twin };
}
