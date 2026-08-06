/**
 * WP-8 pure layout derivation (contract 5.3/5.4, LAY-001…014; Appendix H).
 *
 * Functions create relative path representations only. They never resolve an
 * absolute root, canonicalize a real filesystem path, inspect symlinks,
 * check device/inode identities, create directories, or open files.
 */
import { OPAQUE_IDENTIFIER_LENGTH, type NamespaceKind, type RecordClassId } from '../types.js';
import { RECORD_CLASS_BY_ID } from '../format/taxonomy.js';
import { parseTypedIdentifier, type IdentifierRejectReason } from '../format/identifier.js';

/** Fixed layout constants (LAY-007, LAY-014 length arithmetic). */
export const COMPONENT_LENGTH = OPAQUE_IDENTIFIER_LENGTH; // 32
export const SHARD_WIDTH = 4;
export const RECORD_SUFFIX = '.rec';
export const AUDIT_SUFFIX = '.aud';
export const FILENAME_LENGTH = COMPONENT_LENGTH + RECORD_SUFFIX.length; // 36
export const PATH_COMPONENT_BYTES_DEFAULT = 64;
export const PATH_COMPONENT_BYTES_MAX = 128;
export const PATH_BYTES_DEFAULT = 512;
export const PATH_BYTES_MAX = 1024;

/** Fixed auxiliary layout paths (phase-owned format model; LAY-011). */
export const STORE_METADATA_RELATIVE_PATH = 'metadata/metadata.json' as const;
export const WRITER_LOCK_RELATIVE_PATH = 'locks/writer.lock' as const;
export const TEMPORARY_SUFFIX = '.tmp' as const;

export type LayoutRejectReason = 'unknown-record-class' | IdentifierRejectReason | 'component-over-limit' | 'path-over-limit';

export type LayoutDerivationResult =
  | {
      readonly ok: true;
      readonly namespace: NamespaceKind;
      readonly classSegment: string;
      readonly shard: string;
      readonly component: string;
      readonly suffix: string;
      readonly filename: string;
      /** Namespace-relative path, e.g. `records/approval/0000/<component>.rec`. */
      readonly relativePath: string;
    }
  | { readonly ok: false; readonly reason: LayoutRejectReason };

/**
 * Derive the record-relative path for a validated class and canonical typed
 * identifier (LAY-003/004/005/006/007, Appendix H).
 */
export function deriveRecordRelativePath(recordClass: RecordClassId, rawIdentifier: string): LayoutDerivationResult {
  const profile = RECORD_CLASS_BY_ID.get(recordClass);
  if (profile === undefined) return { ok: false, reason: 'unknown-record-class' };
  const parsed = parseTypedIdentifier(rawIdentifier);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const component = parsed.identifier.opaque;
  const shard = component.slice(0, SHARD_WIDTH);
  const filename = component + profile.suffix;
  if (filename.length > PATH_COMPONENT_BYTES_DEFAULT) {
    return { ok: false, reason: 'component-over-limit' };
  }
  const directory = profile.suffix === AUDIT_SUFFIX ? 'audit' : 'records';
  const relativePath = `${directory}/${profile.segment}/${shard}/${filename}`;
  if (relativePath.length > PATH_BYTES_DEFAULT) {
    return { ok: false, reason: 'path-over-limit' };
  }
  return {
    ok: true,
    namespace: profile.namespace,
    classSegment: profile.segment,
    shard,
    component,
    suffix: profile.suffix,
    filename,
    relativePath,
  };
}

/** Bound check used by LAY-007: filename must fit `pathComponentBytes`. */
export function filenameWithinComponentBound(filename: string, bound: number): boolean {
  return filename.length <= bound;
}

/** Bound check used by LAY-007/LAY-014: relative path must fit `pathBytes`. */
export function relativePathWithinBound(relativePath: string, bound: number): boolean {
  return relativePath.length <= bound;
}

/** Deterministic verification that a relative path equals the derived path (ITG-003). */
export function isDerivedRelativePath(recordClass: RecordClassId, rawIdentifier: string, candidate: string): boolean {
  const d = deriveRecordRelativePath(recordClass, rawIdentifier);
  return d.ok && d.relativePath === candidate;
}
