/**
 * WP-8-D minimal mechanical write-audit event (contract 10.1 step 9,
 * WPR-010, AUD-002/003/005; ADR-029 D-8). FILESYSTEM-FREE by design: this
 * module constructs the deterministic `authorized-write` evidence event and
 * delegates all publication to the single publication substrate
 * (`src/storage/publication/publish-record.ts`) through the composition
 * boundary. It never performs I/O and never creates a second publication
 * path.
 *
 * Identity (D-8): domain-separated digest over the canonical tuple
 * (store/namespace identities, primary class, primary instance/revision
 * identity, primary digest, event kind, trusted action identity) →
 * `pgw:l:<32-hex>`. No counter, nonce, PID, path, clock, or capability
 * object identity enters the input; no stored numeric sequence; the numeric
 * sequence is a later derived registry/recovery view (phase 4).
 *
 * Ordering: stable tuple (primary `createdAt`, primary record identity,
 * audit event identity); the audit event's `createdAt` equals the primary's
 * logical creation time (deterministic; DTM-007). No audit-of-audit event:
 * "audit-event publication" is outside the closed §22.1 audited-event list,
 * and the authorized-write event is the terminal event of the publication
 * operation.
 *
 * Evidence only: the event records who/what/when/binding and grants no
 * authority (AUD-005, TAX-012). Only the `authorized-write` kind is
 * implemented; `idempotent-duplicate` and `conflict` event kinds are
 * deferred to the audit phase (D-12); WP-8-D does not claim full AUD-001.
 */
import { jcsSerialize } from '../../canonical/jcs.js';
import { STORAGE_PAYLOAD_DIGEST_DOMAIN, STORAGE_RECORD_BYTES_DIGEST_DOMAIN, computeDomainDigest, isValidDigestSyntax } from '../format/envelope.js';
import type { NamespaceKind, WriteAuditEventModel } from '../types.js';

/** Domain-separated audit-event identity domain (D-8). */
export const STORAGE_AUDIT_EVENT_IDENTITY_DOMAIN = 'PGAP-STORAGE-AUDIT-EVENT-IDENTITY-v1\u0000';

/** The only event kind implemented in WP-8-D (22.1; D-12). */
export const AUTHORIZED_WRITE_EVENT_KIND = 'authorized-write' as const;

/**
 * WP-8-G recovery-generated audit event kind (16.3; AUD-011; CSA-013):
 * visibly distinct from the original operation event; the recovery action
 * identity and the recovery time are recorded; the event never implies the
 * original operation emitted it. The original trusted action identity is
 * recorded only in the reconstruction evidence record, never here.
 */
export const RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND = 'recovery-audit-reconstruction' as const;

/** Closed audit event-kind vocabulary (22.1 implemented kinds). */
export type AuditEventKind = typeof AUTHORIZED_WRITE_EVENT_KIND | typeof RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND;

/** Audit record format version (current write version; VRS-003). */
export const AUDIT_RECORD_FORMAT_VERSION = '1.0' as const;

/** Canonical identity tuple input shared by every implemented audit event kind (D-8). */
export interface AuditEventTupleInput {
  /** Both verified namespace identities (D-8 tuple member 1). */
  readonly storeInstance: readonly { readonly kind: NamespaceKind; readonly dev: number; readonly ino: number }[];
  /** Primary record class (canonical class id; tuple member 2). */
  readonly primaryClass: string;
  /** Primary canonical instance identity: record id (tuple member 3a). */
  readonly primaryRecordId: string;
  /** Primary revision (tuple member 3b). */
  readonly primaryRevision: number;
  /** Primary record digest (tuple member 4). */
  readonly primaryDigest: string;
  /** Audit event kind (tuple member 5). */
  readonly eventKind: AuditEventKind;
  /** Trusted action identity from the genuine capability binding (tuple member 6). */
  readonly trustedActionIdentity: string;
  /** Event creation time; the audit event's `createdAt`. */
  readonly primaryCreatedAt: string;
}

export interface AuthorizedWriteAuditInput extends Omit<AuditEventTupleInput, 'eventKind'> {
  /** Audit event kind (tuple member 5); only the authorized-write kind is accepted. */
  readonly eventKind: typeof AUTHORIZED_WRITE_EVENT_KIND;
}

export interface AuditEventBuildResult {
  readonly ok: boolean;
  readonly event?: WriteAuditEventModel;
  readonly code?: string;
  readonly message?: string;
}

/** Canonical identity tuple serialization (RFC 8785 after duplicate-key rejection). */
function canonicalIdentityTuple(input: AuditEventTupleInput): string {
  return jcsSerialize({
    storeInstance: input.storeInstance.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
    primaryClass: input.primaryClass,
    primaryRecordId: input.primaryRecordId,
    primaryRevision: input.primaryRevision,
    primaryDigest: input.primaryDigest,
    eventKind: input.eventKind,
    trustedActionIdentity: input.trustedActionIdentity,
  });
}

/**
 * Deterministic audit-event identity (D-8): domain-separated digest of the
 * canonical tuple → `pgw:l:<32-hex>` (accepted trusted-record prefix, 5.3;
 * 128-bit opaque component). Time-independent: the identity never includes
 * the clock, so identical facts and actions yield identical identities.
 */
export function computeAuditEventIdentity(input: AuditEventTupleInput): string {
  const digest = computeDomainDigest(STORAGE_AUDIT_EVENT_IDENTITY_DOMAIN, canonicalIdentityTuple(input));
  return `pgw:l:${digest.slice('sha-256:'.length, 'sha-256:'.length + 32)}`;
}

/** Shared envelope construction for every implemented audit event kind. */
function buildAuditEventCore(input: AuditEventTupleInput, payload: Readonly<Record<string, unknown>>): AuditEventBuildResult {
  const recordId = computeAuditEventIdentity(input);
  const payloadDigest = computeDomainDigest(STORAGE_PAYLOAD_DIGEST_DOMAIN, jcsSerialize(payload));
  const envelope: Readonly<Record<string, unknown>> = {
    recordKind: 'AuthoritativeAuditEvent',
    formatVersion: AUDIT_RECORD_FORMAT_VERSION,
    recordId,
    revision: 1,
    createdAt: input.primaryCreatedAt,
    trustedActionId: input.trustedActionIdentity,
    payload,
    payloadDigest,
    referenceDigests: [input.primaryDigest],
    retentionClass: 'indefinite',
  };
  const canonicalUtf8 = jcsSerialize(envelope);
  const digest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, canonicalUtf8);
  return {
    ok: true,
    event: {
      recordId,
      envelope,
      canonicalUtf8,
      digest,
      // Ordering tuple: primary createdAt, primary identity, event identity (DTM-003).
      ordering: [input.primaryCreatedAt, input.primaryRecordId, recordId],
    },
  };
}

/**
 * Build the canonical `authorized-write` audit event: deterministic identity,
 * envelope with the primary's logical `createdAt` and the capability-bound
 * trusted action identity, digest-bound payload and reference linkage to the
 * primary record. Identical inputs yield identical bytes (idempotent retry).
 */
export function buildAuthorizedWriteAuditEvent(input: AuthorizedWriteAuditInput): AuditEventBuildResult {
  if (input.eventKind !== AUTHORIZED_WRITE_EVENT_KIND) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'only the authorized-write event kind is implemented in WP-8-D' };
  }
  if (!isValidDigestSyntax(input.primaryDigest)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'primary digest must use sha-256:<64-hex> syntax' };
  }
  const payload: Readonly<Record<string, unknown>> = {
    eventKind: input.eventKind,
    recordId: input.primaryRecordId,
    recordDigest: input.primaryDigest,
  };
  return buildAuditEventCore(input, payload);
}

/**
 * WP-8-G reconstructed audit input (16.3; AUD-011/012; CSA-013). The event
 * is derived mechanically from durable target-record facts plus the trusted
 * RECOVERY action identity and the recovery time; the original trusted
 * action identity never enters this event (it is a fact recorded in the
 * reconstruction evidence record instead). The gap marker names the missing
 * original event kind explicitly.
 */
export interface RecoveryAuditReconstructionInput {
  /** Both verified namespace identities (D-8 tuple member 1). */
  readonly storeInstance: readonly { readonly kind: NamespaceKind; readonly dev: number; readonly ino: number }[];
  /** Target record class (canonical class id; tuple member 2). */
  readonly primaryClass: string;
  /** Target canonical instance identity: record id (tuple member 3a). */
  readonly primaryRecordId: string;
  /** Target revision read from the durable record (tuple member 3b). */
  readonly primaryRevision: number;
  /** Target record digest (tuple member 4). */
  readonly primaryDigest: string;
  /** Trusted RECOVERY action identity (tuple member 6; never the original write action). */
  readonly recoveryActionIdentity: string;
  /** Recovery time (ISO; the event's `createdAt` — never the original operation time). */
  readonly recoveryTime: string;
}

/**
 * Build the canonical `recovery-audit-reconstruction` audit event for one
 * durable target record: deterministic identity over (store instance,
 * target class/id/revision/digest, kind, recovery action identity) — the
 * recovery time enters only the envelope bytes, never the identity — with a
 * digest-bound payload referencing the target and an explicit gap marker
 * naming the missing original `authorized-write` event (16.3, CSA-013).
 * Identical facts and actions yield identical identities (idempotent
 * retry/roll-forward); the recovery-time bytes are creation evidence.
 */
export function buildRecoveryAuditReconstructionEvent(input: RecoveryAuditReconstructionInput): AuditEventBuildResult {
  if (!isValidDigestSyntax(input.primaryDigest)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target digest must use sha-256:<64-hex> syntax' };
  }
  if (!Number.isSafeInteger(input.primaryRevision) || input.primaryRevision < 1) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target revision must be a positive safe integer' };
  }
  const tuple: AuditEventTupleInput = {
    storeInstance: input.storeInstance,
    primaryClass: input.primaryClass,
    primaryRecordId: input.primaryRecordId,
    primaryRevision: input.primaryRevision,
    primaryDigest: input.primaryDigest,
    eventKind: RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND,
    trustedActionIdentity: input.recoveryActionIdentity,
    primaryCreatedAt: input.recoveryTime,
  };
  const payload: Readonly<Record<string, unknown>> = {
    eventKind: RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND,
    recordId: input.primaryRecordId,
    recordDigest: input.primaryDigest,
    gapMarker: { missingEventKind: AUTHORIZED_WRITE_EVENT_KIND },
  };
  return buildAuditEventCore(tuple, payload);
}
