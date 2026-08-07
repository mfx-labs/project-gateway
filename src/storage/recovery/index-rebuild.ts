/**
 * WP-8-H registry-index rebuild publication builder (ADR-031; contract
 * 5.2 `index/`, CSA-003/004, ITG-005, RGY-007). FILESYSTEM-FREE: this
 * module mints the exact-record `RecoveryPublicationPermit` (role
 * `registry-index`) for one canonical index snapshot and delegates the
 * immutable publication to the permit-bound sink
 * (`publication/publish-record.ts`). The recovery capability NEVER reaches
 * the generic publication substrate; a permit for one exact index can never
 * publish another index, another record class, or a caller-selected
 * destination.
 */
import { deriveRegistryIndexRelativePath } from '../layout/layout.js';
import { publishRecoveryBoundRecord } from '../publication/publish-record.js';
import { readRegistryIndexFile } from '../registry/index-store.js';
import { createRecoveryPublicationPermit, isGenuineRecoveryCapability, type RecoveryCapability } from '../capabilities/authenticity.js';
import type { PublicationHooks } from '../types.js';

export interface RegistryIndexPublishResult {
  readonly ok: boolean;
  readonly outcome?: 'published' | 'already-completed';
  readonly code?: string;
  readonly message?: string;
}

/**
 * Publish the exact canonical registry-index snapshot (WP-8-H §6/§7): a
 * dedicated exact-record permit binds the genuine recovery capability, the
 * `registry-index-rebuild` operation, the `registry-index` publication
 * role, the exact index identity/digest/canonical-byte digest, and the
 * internally derived `index/registry-index/...` destination. All
 * substitutions fail before any directory provisioning or publication. An
 * EEXIST replay at the derived index path is verified byte-exact before
 * `already-completed`; a conflicting existing file fails closed (no
 * overwrite, no rename).
 */
export function publishRegistryIndex(input: {
  readonly capability: RecoveryCapability;
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly index: { readonly indexId: string; readonly canonicalUtf8: string; readonly digest: string };
  readonly hooks?: PublicationHooks;
}): RegistryIndexPublishResult {
  if (!isGenuineRecoveryCapability(input.capability)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery capability operand is not genuine' };
  }
  const check = input.capability.verify('registry-index-rebuild');
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery capability is not usable at the registry-index publication boundary' };
  }
  const derived = deriveRegistryIndexRelativePath(input.index.indexId);
  if (!derived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'registry-index path derivation failed' };
  }
  const permit = createRecoveryPublicationPermit({
    capability: input.capability,
    operation: 'registry-index-rebuild',
    role: 'registry-index',
    recordId: input.index.indexId,
    recordDigest: input.index.digest,
    canonicalBytesDigest: input.index.digest,
    destinationDesignation: derived.relativePath,
  });
  if (permit === undefined) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'registry-index permit could not be issued' };
  }
  try {
    const published = publishRecoveryBoundRecord({
      permit,
      canonicalUtf8: input.index.canonicalUtf8,
      byteLimit: input.byteLimit,
      serviceUid: input.serviceUid,
      hooks: input.hooks,
    });
    if (!published.ok) {
      // EEXIST replay classification: an existing object at the derived
      // index path is verified byte-exact (idempotent) or rejected. The
      // index snapshot is not a record envelope, so the replay check
      // compares the raw canonical bytes descriptor-bound.
      const existing = readRegistryIndexFile({ namespaceRoot: input.namespaceRoot, serviceUid: input.serviceUid, byteLimit: input.byteLimit, indexId: input.index.indexId });
      if (existing.ok && existing.raw === input.index.canonicalUtf8) {
        return { ok: true, outcome: 'already-completed' };
      }
      if (existing.ok) {
        return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'conflicting registry-index exists at the derived identity; fail closed' };
      }
      if (existing.code === 'ERR-STO-NOT-FOUND') {
        return { ok: false, code: published.code ?? 'ERR-STO-DURABILITY', message: published.message ?? 'registry-index publication did not reach its durability point' };
      }
      return { ok: false, code: existing.code ?? 'ERR-STO-INTEGRITY', message: existing.message ?? 'registry-index replay could not be verified' };
    }
    return { ok: true, outcome: 'published' };
  } finally {
    permit.dispose();
  }
}
