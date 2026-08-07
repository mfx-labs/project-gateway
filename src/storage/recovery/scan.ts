/**
 * WP-8-E read-only store scan (contract §13 RDS-004/007, §16 CSA, §19
 * LMT-006/010, §24 DTM-003; WP-8-E scope item 1; corrections F1–F4, F1-B,
 * F1-S, F3-G). FILESYSTEM-BEARING, READ-ONLY: this is the sole scan owner
 * in the storage tree for the records, audit, tmp, and locks surfaces
 * (alongside the class enumeration owner `src/storage/read/enumerate.ts`
 * and the provisioning classifier). The module performs NO mutation of any
 * kind (its filesystem allowlist contains no mutating API) and NEVER
 * decides candidate classifications: it extracts pure facts and delegates
 * every category decision to the filesystem-free classifier
 * (`src/storage/registry/classify.ts`). Derived views and plans are
 * constructed elsewhere; this module returns observations and findings
 * only.
 *
 * Scanning model (deterministic; host directory order is never trusted):
 *   - parent surfaces first: `records/` and `audit/` are enumerated
 *     deterministically; the exact configured record-class directory set
 *     and the expected audit class directory are recognized; unknown
 *     directories, stray files, symlinks, and special objects are reported
 *     as foreign observations; missing required class directories are
 *     reported as findings (F3). Parent-level structure is budget-free and
 *     is reported by the first page only (no continuation): content pages
 *     report candidates only, so the paging union stays complete and
 *     duplicate-free.
 *   - class surfaces in fixed order: the 15 record classes in taxonomy
 *     order (`records/<segment>/`), then the audit class
 *     (`audit/audit-event/`), then — only for recovery-mode scans — `tmp/`
 *     and `locks/`;
 *   - every directory is descriptor-verified before and after `readdirSync`
 *     (device/inode/UID/mode snapshot; point-of-use revalidation,
 *     SRX-013/FSP-004); identity drift between the two snapshots fails
 *     closed with ERR-STO-ROOT-IDENTITY-CHANGED. A directory that was
 *     successfully opened and verified and then fails to re-open (or
 *     vanishes during readdir) is drift, never absence; only a first-
 *     attempt ENOENT (never opened) is an absent surface (F4). Class
 *     directories, the audit directory, `tmp/`, `locks/`, and shard
 *     directories follow the same drift rule.
 *   - names are sorted lexicographically; shard iteration is the sorted
 *     set of existing shard directories (never a host-order read);
 *   - bounds: strict entry and aggregate-byte limits with exact-limit
 *     acceptance and limit-plus-one fail-closed truncation
 *     (`totalScanEntries`/`totalScanBytes` for the registry scan; the same
 *     with `recoveryScanEntries` fail-closed semantics for the recovery
 *     scan; LMT-004/005/006/010); every candidate is bounded by the
 *     per-record byte limit;
 *   - continuation cursor `{generation, surfaceGeneration, recordClass,
 *     shard, entry}`: the request `generation` binds store identity,
 *     namespace identity, effective entry/byte limits, scan mode,
 *     fail-closed behavior, and the class-order model version (F2); the
 *     `surfaceGeneration` binds the cross-page structural snapshot —
 *     `records/` and `audit/` parent presence and identity, the expected
 *     record-class presence set, `audit-event` presence, and the
 *     identities of every present class directory (F3-G). A cursor whose
 *     request generation differs from the current request's computed
 *     generation is rejected with ERR-STO-REQ-INVALID before any candidate
 *     content is scanned; a cursor whose surface generation no longer
 *     matches the re-read structural snapshot is rejected with
 *     ERR-STO-ROOT-IDENTITY-CHANGED (cross-page deletion, addition,
 *     replacement, or parent disappearance is drift; absent-on-both-pages
 *     is unchanged).
 *   - forward progress (F1, accepted WP-8-D enumeration model): entries
 *     skipped because they are at or before the continuation cursor are
 *     cursor-seeking work and do NOT consume the resumed page's entry
 *     budget; reissuing the same request with the returned cursor and
 *     identical bounds advances strictly beyond the previous cursor and a
 *     finite store terminates after repeated same-bounds requests; no
 *     candidate is duplicated.
 *   - byte-bound truncation never advances past an unread candidate
 *     (F1-B): when candidate X passes its individual size bound but cannot
 *     fit within the remaining aggregate page budget, X is not processed,
 *     no observation for X is emitted, no cursor position sorts at or
 *     after X, and no candidate after X is processed on that page. If at
 *     least one resumable candidate was processed on the page, the
 *     continuation points at the last successfully processed resumable
 *     candidate (strictly before X); if zero resumable candidates were
 *     processed, no continuation is emitted and the truncated result
 *     signals a no-progress state: the caller must restart WITHOUT the
 *     cursor with a larger byte profile (the request generation binds byte
 *     limits, so a raised limit invalidates the old cursor with
 *     ERR-STO-REQ-INVALID anyway). X is never skipped and no result
 *     implies X was processed.
 *   - self-validating cursors (F1-S): a foreign shard name is a
 *     non-resumable structural anomaly — budget-free, reported at its
 *     first encounter in deterministic scan order, never a resumable
 *     cursor position, never blocking later valid candidates. Every
 *     emitted continuation is validated against the scanner's own cursor
 *     validator before return (an invalid emission is an internal
 *     invariant failure).
 *   - entries whose name fails the layout grammar are foreign findings
 *     (never opened); entries at a non-derived location are read within
 *     bounds so their envelope identity is available for the deterministic
 *     duplicate/conflict pass (18.2: location classification still precedes
 *     content classification);
 *   - observation ids and the scan generation tokens are deterministic
 *     domain digests; no clock, randomness, environment, or path material
 *     enters them (DTM-007). No raw device/inode value ever leaves the
 *     module (F3-G binds identities only through the surface digest).
 *
 * No raw absolute path, record payload, or lock nonce ever leaves this
 * module (RDS-012, ERM-004, AUD-006).
 */
import { readdirSync, openSync, closeSync, fstatSync, readFileSync } from 'node:fs';
import { constants } from 'node:fs';
import { jcsSerialize } from '../../canonical/jcs.js';
import { computeDomainDigest, isValidDigestSyntax, parsePersistedEnvelope, STORAGE_PAYLOAD_DIGEST_DOMAIN, STORAGE_RECORD_BYTES_DIGEST_DOMAIN } from '../format/envelope.js';
import { parseRawJson } from '../../json/scanner.js';
import { verifyObjectBytesAt } from '../publication/publish-record.js';
import { computeQuarantineEvidenceIdentity } from './evidence.js';
import { deriveRecordRelativePath } from '../layout/layout.js';
import { RECORD_CLASS_BY_ID, RECORD_CLASS_PROFILES } from '../format/taxonomy.js';
import { comparePrePostStat, verifyRegularFileStat } from '../root/identity.js';
import { verifyNamespaceRootIdentity } from '../read/read-record.js';
import { classifyCandidate, extractEnvelopeFacts, type CandidateFacts } from '../registry/classify.js';
import { parseRegistryIndex, computeRegistryIndexRoots, REGISTRY_INDEX_MODEL_VERSION, REGISTRY_INDEX_MAX_ENTRIES, REGISTRY_INDEX_FILENAME_RE, validateRegistryIndexSelfConsistency, type ParsedRegistryIndex } from '../registry/index-model.js';
import { parseLockRecordFacts } from './assess.js';
import { LOCK_RECORD_MAX_BYTES, RECOVERY_BREAK_GUARD_NAME, LOCK_GUARD_VERSION, computeWriterLockInstanceIdentity } from '../locks/lock.js';
import {
  computeRetentionRecordIntentIdentity,
  computeRetentionAuditIntentIdentity,
  computeRetentionRecordCompletionIdentity,
  computeRetentionAuditCompletionIdentity,
} from '../retention/evidence.js';
import type {
  AuditAssociationFacts,
  AuditScanObservation,
  ForeignScanObservation,
  IndexObjectClassification,
  IndexScanObservation,
  LockScanObservation,
  QuarantineObjectClassification,
  QuarantineScanObservation,
  RecordClassId,
  RecordObservationFacts,
  RecordScanObservation,
  RetentionHoldResult,
  ScanCursor,
  ScanHooks,
  ScanMode,
  ScanObservation,
  ScannedObjectStat,
  StorageFinding,
  StoreScanInput,
  StoreScanResult,
  TemporaryScanObservation,
  VerifiedStoreInstance,
  ConfigurationMetadataState,
  ConfigurationNamespaceObservation,
} from '../types.js';

const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW, O_NONBLOCK } = constants;

/** Domain-separated scan-observation identity domain. */
const SCAN_OBSERVATION_ID_DOMAIN = 'PGAP-STORAGE-SCAN-OBSERVATION-v1\u0000';

/** Publication temporary-name grammar (WPR-003): `pub-<16 hex>-<ordinal hex>` (WP-8-F re-derivation). */
export function isPublicationTemporaryName(name: string): boolean {
  return TEMP_NAME_RE.test(name);
}

/** Deterministic temporary-object observation id (WP-8-F evidence binding; matches the WP-8-E scan). */
export function temporaryObservationId(entry: string): string {
  return observationId('temporary-object', undefined, undefined, entry);
}

/**
 * Deterministic record observation id (WP-8-G evidence binding): the exact
 * observation identity the WP-8-E recovery scan assigns to the durable
 * record at its derived canonical location. Recomputed at the mutation
 * boundary from the closed class vocabulary and the canonical identity;
 * never taken from plan data.
 */
export function recordObservationId(recordClass: RecordClassId, shard: string, entry: string): string {
  return observationId('record', recordClass, shard, entry);
}

/** Deterministic audit-event observation id (WP-8-H index tuple reconstruction). */
export function auditObservationId(shard: string, entry: string): string {
  return observationId('audit-event', 'authoritative-audit-event', shard, entry);
}

/** Deterministic foreign-object observation id (WP-8-H index tuple reconstruction). */
export function foreignObservationId(scope: string | undefined, shard: string | undefined, entry: string): string {
  return observationId('foreign-object', scope, shard, entry);
}

/** Deterministic quarantine-object observation id (WP-8-F). */
export function quarantineObservationId(shard: string, entry: string): string {
  return observationId('quarantine-object', shard, undefined, entry);
}

/** Deterministic writer-lock observation id (WP-8-J; the fixed `writer.lock` name). */
export function lockObservationId(): string {
  return observationId('lock-object', undefined, undefined, 'writer.lock');
}

/**
 * Extract quarantine-temporary evidence payload facts from one canonical
 * store-evidence-record (WP-8-F §8): quarantine ID, source digest, and
 * source entry. Used for dangling-evidence detection. Pure.
 */
export function extractQuarantineEvidenceFacts(raw: string): { readonly quarantineId?: string; readonly sourceDigest?: string; readonly sourceEntry?: string } {
  try {
    const model = parseRawJson(raw, 1024 * 1024).model;
    if (typeof model !== 'object' || model === null || Array.isArray(model)) return {};
    const payload = (model as Readonly<Record<string, unknown>>)['payload'];
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {};
    const p = payload as Readonly<Record<string, unknown>>;
    if (p['recoveryOperation'] !== 'quarantine-temporary') return {};
    const quarantineId = p['quarantineId'];
    const sourceDigest = p['sourceDigest'];
    const sourceEntry = p['targetEntry'];
    if (typeof quarantineId !== 'string' || !/^[0-9a-f]{64}$/.test(quarantineId)) return {};
    if (typeof sourceDigest !== 'string' || !isValidDigestSyntax(sourceDigest)) return {};
    if (typeof sourceEntry !== 'string' || sourceEntry.length === 0) return {};
    return { quarantineId, sourceDigest, sourceEntry };
  } catch {
    return {};
  }
}

/**
 * WP-8-G reconstruction-evidence payload facts (16.3; §11): extracted from
 * one canonical store-evidence-record whose payload declares the
 * `audit-reconstruction` recovery operation. `reconstruction` is true for
 * every audit-reconstruction evidence claim; `malformed` is true when the
 * claimed facts are incomplete or the outcome is outside the closed
 * vocabulary; otherwise `facts` carries the bound facts. Pure.
 */
export function extractReconstructionEvidenceFacts(raw: string): {
  readonly reconstruction?: boolean;
  readonly malformed?: boolean;
  readonly facts?: {
    readonly targetRecordId: string;
    readonly targetRecordClass: string;
    readonly targetRecordDigest: string;
    readonly reconstructionAuditId: string;
    readonly outcome: string;
  };
} {
  try {
    const model = parseRawJson(raw, 1024 * 1024).model;
    if (typeof model !== 'object' || model === null || Array.isArray(model)) return {};
    const payload = (model as Readonly<Record<string, unknown>>)['payload'];
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {};
    const p = payload as Readonly<Record<string, unknown>>;
    if (p['recoveryOperation'] !== 'audit-reconstruction') return {};
    const targetRecordId = p['targetRecordId'];
    const targetRecordClass = p['targetRecordClass'];
    const targetRecordDigest = p['targetRecordDigest'];
    const reconstructionAuditId = p['reconstructionAuditId'];
    const outcome = p['outcome'];
    if (
      typeof targetRecordId !== 'string' ||
      typeof targetRecordClass !== 'string' ||
      typeof targetRecordDigest !== 'string' ||
      typeof reconstructionAuditId !== 'string' ||
      (outcome !== 'reconstructed' && outcome !== 'already-completed')
    ) {
      return { reconstruction: true, malformed: true };
    }
    return { reconstruction: true, facts: { targetRecordId, targetRecordClass, targetRecordDigest, reconstructionAuditId, outcome } };
  } catch {
    return {};
  }
}
/**
 * WP-8-L retention-deletion evidence payload facts (§15.4/ADR-035; L-1):
 * extracted from one canonical store-evidence-record whose payload declares
 * a `retention-delete-record` or `retention-delete-audit` retention
 * operation. The extractor models the ACTUAL committed evidence model as a
 * discriminated union:
 * - `kind: 'intent'` — durable deletion intent evidence. It legitimately
 *   carries NO `outcome`; every intent-required fact is verified
 *   (operation, target class/identity/revision/digest, trusted retention
 *   policy/hold bindings, history binding for the record flow, and the
 *   audit-flow referenced primary completion binding), and the envelope
 *   identity MUST equal the deterministic intent identity re-derived over
 *   those facts + the verified store instance.
 * - `kind: 'completion'` — deletion completion evidence. It requires the
 *   exact completion facts: closed outcome (`deleted` /
 *   `already-completed`), the exact bound intent identity and digest, and
 *   the per-operation bindings; the envelope identity MUST equal the
 *   deterministic completion identity.
 * A claim failing its kind's required facts, or whose identity does not
 * match the committed derivation, is `malformed` — never a valid intent
 * and never a valid completion. `retention` is true for every retention
 * evidence claim; `malformed` is true when the claim is invalid;
 * otherwise `facts` carries the bound facts. Pure.
 */
export function extractRetentionEvidenceFacts(raw: string, storeInstance: VerifiedStoreInstance): {
  readonly retention?: boolean;
  readonly malformed?: boolean;
  readonly facts?: {
    readonly kind: 'intent' | 'completion';
    readonly retentionOperation: 'retention-delete-record' | 'retention-delete-audit';
    readonly targetRecordClass: string;
    readonly targetRecordId: string;
    readonly targetRecordRevision: number;
    readonly targetRecordDigest: string;
    readonly referencedRecordId?: string;
    readonly referencedRecordDigest?: string;
    readonly primaryDeletionCompletionEvidenceId?: string;
    readonly intentEvidenceId?: string;
    readonly intentEvidenceDigest?: string;
    readonly holdStateGeneration: string;
    readonly historyDigest?: string;
    readonly outcome?: string;
  };
} {
  const RETENTION_HOLD_RESULTS: readonly string[] = ['active-hold', 'unknown-hold-state', 'stale-hold-decision', 'clear-current-hold-state'];
  try {
    const model = parseRawJson(raw, 1024 * 1024).model;
    if (typeof model !== 'object' || model === null || Array.isArray(model)) return {};
    const envelope = model as Readonly<Record<string, unknown>>;
    const payload = envelope['payload'];
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {};
    const p = payload as Readonly<Record<string, unknown>>;
    if (p['evidenceKind'] !== 'retention-evidence') return {};
    const retentionOperation = p['retentionOperation'];
    if (retentionOperation !== 'retention-delete-record' && retentionOperation !== 'retention-delete-audit') return {};
    const isAudit = retentionOperation === 'retention-delete-audit';
    const declaredRecordId = envelope['recordId'];
    const targetRecordClass = p['targetRecordClass'];
    const targetRecordId = p['targetRecordId'];
    const targetRecordRevision = p['targetRecordRevision'];
    const targetRecordDigest = p['targetRecordDigest'];
    const referencedRecordId = p['referencedRecordId'];
    const referencedRecordDigest = p['referencedRecordDigest'];
    const primaryDeletionCompletionEvidenceId = p['primaryDeletionCompletionEvidenceId'];
    const intentEvidenceId = p['intentEvidenceId'];
    const intentEvidenceDigest = p['intentEvidenceDigest'];
    const policyIdentity = p['policyIdentity'];
    const policyVersion = p['policyVersion'];
    const decisionId = p['decisionId'];
    const holdStateGeneration = p['holdStateGeneration'];
    const holdResult = p['holdResult'];
    const historyDigest = p['historyDigest'];
    const historyStatus = p['historyStatus'];
    const outcome = p['outcome'];
    const isCanonicalRecordId = (v: unknown): v is string => typeof v === 'string' && /^pgw:r:[0-9a-f]{32}$/.test(v);
    // Retention targets are primary records (`pgw:r:`) or audit events
    // (`pgw:l:` — the audit-deletion target is the audit event identity).
    const isCanonicalTargetId = (v: unknown): v is string => typeof v === 'string' && /^pgw:[rl]:[0-9a-f]{32}$/.test(v);
    const isDigest = (v: unknown): v is string => typeof v === 'string' && isValidDigestSyntax(v);
    const malformed = (): { readonly retention: true; readonly malformed: true } => ({ retention: true, malformed: true });
    // The normative discriminator: completion evidence binds the exact
    // durable intent (`intentEvidenceId`); intent evidence never carries it
    // and never carries a completion outcome (L-1).
    if (typeof intentEvidenceId === 'string') {
      // ── Completion claim ──
      if (!isCanonicalTargetId(targetRecordId) || !isDigest(targetRecordDigest) || typeof targetRecordClass !== 'string') return malformed();
      if (typeof targetRecordRevision !== 'number' || !Number.isSafeInteger(targetRecordRevision) || targetRecordRevision < 1) return malformed();
      if (typeof policyIdentity !== 'string' || typeof policyVersion !== 'string' || typeof decisionId !== 'string' || typeof holdStateGeneration !== 'string') return malformed();
      if (typeof holdResult !== 'string' || !RETENTION_HOLD_RESULTS.includes(holdResult)) return malformed();
      if (!isCanonicalRecordId(intentEvidenceId) || !isDigest(intentEvidenceDigest)) return malformed();
      // Completion outcomes stay closed; unknown outcomes fail closed.
      if (outcome !== 'deleted' && outcome !== 'already-completed') return malformed();
      if (typeof declaredRecordId !== 'string') return malformed();
      let expected: string;
      let auditFacts: { readonly referencedRecordId: string; readonly referencedRecordDigest: string; readonly primaryDeletionCompletionEvidenceId: string } | undefined;
      let recordFacts: { readonly historyDigest: string } | undefined;
      if (isAudit) {
        if (!isCanonicalRecordId(referencedRecordId) || !isDigest(referencedRecordDigest) || !isCanonicalRecordId(primaryDeletionCompletionEvidenceId)) return malformed();
        auditFacts = { referencedRecordId, referencedRecordDigest, primaryDeletionCompletionEvidenceId };
        expected = computeRetentionAuditCompletionIdentity({
          storeInstance,
          retentionOperation: 'retention-delete-audit',
          intentEvidenceId,
          targetRecordClass: 'authoritative-audit-event',
          targetRecordId,
          targetRecordRevision,
          targetRecordDigest,
          outcome,
        });
      } else {
        if (!isDigest(historyDigest)) return malformed();
        recordFacts = { historyDigest };
        expected = computeRetentionRecordCompletionIdentity({
          storeInstance,
          retentionOperation: 'retention-delete-record',
          intentEvidenceId,
          targetRecordClass,
          targetRecordId,
          targetRecordRevision,
          targetRecordDigest,
          outcome,
        });
      }
      // Exact completion identity/domain: the envelope identity must equal
      // the deterministic derivation over the declared facts.
      if (expected !== declaredRecordId) return malformed();
      return {
        retention: true,
        facts: {
          kind: 'completion',
          retentionOperation,
          targetRecordClass,
          targetRecordId,
          targetRecordRevision,
          targetRecordDigest,
          ...(auditFacts ?? {}),
          intentEvidenceId,
          intentEvidenceDigest,
          holdStateGeneration,
          ...(recordFacts ?? {}),
          outcome,
        },
      };
    }
    // ── Intent claim (L-1: no `outcome` required; every intent-required
    // fact must still verify — a missing required intent field stays
    // malformed) ──
    if (!isCanonicalTargetId(targetRecordId) || !isDigest(targetRecordDigest) || typeof targetRecordClass !== 'string') return malformed();
    if (typeof targetRecordRevision !== 'number' || !Number.isSafeInteger(targetRecordRevision) || targetRecordRevision < 1) return malformed();
    if (typeof policyIdentity !== 'string' || typeof policyVersion !== 'string' || typeof decisionId !== 'string' || typeof holdStateGeneration !== 'string') return malformed();
    if (typeof holdResult !== 'string' || !RETENTION_HOLD_RESULTS.includes(holdResult)) return malformed();
    // An intent never carries a completion outcome or an intent binding.
    if (outcome !== undefined || intentEvidenceDigest !== undefined) return malformed();
    if (typeof declaredRecordId !== 'string') return malformed();
    let expectedIntent: string;
    let intentAuditFacts: { readonly referencedRecordId: string; readonly referencedRecordDigest: string; readonly primaryDeletionCompletionEvidenceId: string } | undefined;
    let intentRecordFacts: { readonly historyDigest: string } | undefined;
    if (isAudit) {
      if (!isCanonicalRecordId(referencedRecordId) || !isDigest(referencedRecordDigest) || !isCanonicalRecordId(primaryDeletionCompletionEvidenceId)) return malformed();
      intentAuditFacts = { referencedRecordId, referencedRecordDigest, primaryDeletionCompletionEvidenceId };
      expectedIntent = computeRetentionAuditIntentIdentity({
        storeInstance,
        retentionOperation: 'retention-delete-audit',
        targetRecordClass: 'authoritative-audit-event',
        targetRecordId,
        targetRecordRevision,
        targetRecordDigest,
        referencedRecordId,
        referencedRecordDigest,
        primaryDeletionCompletionEvidenceId,
        policyIdentity,
        policyVersion,
        decisionId,
        holdStateGeneration,
        holdResult: holdResult as RetentionHoldResult,
      });
    } else {
      if (!isDigest(historyDigest) || typeof historyStatus !== 'string') return malformed();
      intentRecordFacts = { historyDigest };
      expectedIntent = computeRetentionRecordIntentIdentity({
        storeInstance,
        retentionOperation: 'retention-delete-record',
        targetRecordClass,
        targetRecordId,
        targetRecordRevision,
        targetRecordDigest,
        policyIdentity,
        policyVersion,
        decisionId,
        holdStateGeneration,
        holdResult: holdResult as RetentionHoldResult,
        historyDigest,
        historyStatus,
      });
    }
    // Exact intent identity/domain: the envelope identity must equal the
    // deterministic derivation over the declared facts.
    if (expectedIntent !== declaredRecordId) return malformed();
    return {
      retention: true,
      facts: {
        kind: 'intent',
        retentionOperation,
        targetRecordClass,
        targetRecordId,
        targetRecordRevision,
        targetRecordDigest,
        ...(intentAuditFacts ?? {}),
        holdStateGeneration,
        ...(intentRecordFacts ?? {}),
      },
    };
  } catch {
    return {};
  }
}

/**
 * WP-8-M configuration-recovery evidence payload facts (§16.7/ADR-036):
 * extracted from one canonical store-evidence-record whose payload declares
 * the `recover-configuration-namespace` recovery operation. `configuration`
 * is true for every configuration-recovery evidence claim; `malformed` is
 * true when the claimed facts are incomplete or the outcome is outside the
 * closed vocabulary; otherwise `facts` carries the bound facts. Pure.
 */
export function extractConfigurationRecoveryEvidenceFacts(raw: string): {
  readonly configuration?: boolean;
  readonly malformed?: boolean;
  readonly facts?: {
    readonly configurationIdentity: string;
    readonly configurationVersion: string;
    readonly configurationDigest: string;
    readonly trustedInputIdentity?: string;
    readonly outcome: string;
  };
} {
  try {
    const model = parseRawJson(raw, 1024 * 1024).model;
    if (typeof model !== 'object' || model === null || Array.isArray(model)) return {};
    const payload = (model as Readonly<Record<string, unknown>>)['payload'];
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {};
    const p = payload as Readonly<Record<string, unknown>>;
    if (p['evidenceKind'] !== 'recovery-evidence') return {};
    if (p['recoveryOperation'] !== 'recover-configuration-namespace') return {};
    const configurationIdentity = p['configurationIdentity'];
    const configurationVersion = p['configurationVersion'];
    const configurationDigest = p['configurationDigest'];
    const outcome = p['outcome'];
    const trustedInputIdentity = p['trustedInputIdentity'];
    if (
      typeof configurationIdentity !== 'string' ||
      typeof configurationVersion !== 'string' ||
      typeof configurationDigest !== 'string' ||
      (outcome !== 'configuration-recovered' && outcome !== 'already-completed')
    ) {
      return { configuration: true, malformed: true };
    }
    return {
      configuration: true,
      facts: {
        configurationIdentity,
        configurationVersion,
        configurationDigest,
        ...(typeof trustedInputIdentity === 'string' ? { trustedInputIdentity } : {}),
        outcome,
      },
    };
  } catch {
    return {};
  }
}

/**
 * Deterministic configuration-namespace observation id (WP-8-M): domain
 * digest over (store instance, kind, current state classification, entry
 * designation). Binds the exact current state; a state change changes the
 * id and fails the recovery request's binding. Pure.
 */
export function configurationMetadataObservationId(input: {
  readonly storeInstance: VerifiedStoreInstance;
  readonly state: ConfigurationMetadataState;
  readonly entry: 'metadata.json';
}): string {
  const tuple = jcsSerialize({
    storeInstance: input.storeInstance.namespaces
      .map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino }))
      .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
    kind: 'configuration-metadata',
    state: input.state,
    entry: input.entry,
  });
  const digest = computeDomainDigest(STORAGE_CONFIGURATION_OBSERVATION_DOMAIN, tuple);
  return `obs-${digest.slice('sha-256:'.length, 'sha-256:'.length + 16)}`;
}

/**
 * WP-8-M scan-level configuration metadata surface classification (§16.7;
 * advisory — never authority). Structural + self-consistency only: the
 * scan cannot derive the trusted-input-exact expected bytes, so
 * `configuration-healthy` means self-consistent AND declared configuration
 * identity matches the verified store instance. The recovery flow performs
 * the byte-exact trusted-input comparison separately (an observation id
 * mismatch then fails the request closed).
 */
export function classifyConfigurationMetadataSurface(input: {
  readonly configRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly configurationIdentity: string;
  readonly storeInstance: VerifiedStoreInstance;
}): { readonly ok: boolean; readonly observation?: ConfigurationNamespaceObservation; readonly code?: string; readonly message?: string } {
  const metadataDir = `${input.configRoot}/metadata`;
  // Metadata-directory state.
  const dirBracket = readdirVerified(metadataDir, input.serviceUid, undefined, { surface: 'configuration-metadata' as never, recordClass: 'store-metadata' });
  if (!dirBracket.ok || dirBracket.bracket === undefined) {
    const code = dirBracket.code;
    if (code === 'ERR-STO-NOT-FOUND' || code === 'ENOENT' || code === 'ERR-STO-FTYPE-UNSUPPORTED' && dirBracket.message?.includes('expected a directory')) {
      // The metadata directory itself is absent (or not a directory): the
      // configuration namespace is not in a recovery-recoverable state.
      const state: ConfigurationMetadataState = 'configuration-directory-missing';
      return {
        ok: true,
        observation: {
          id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }),
          state,
          reason: 'configuration metadata directory is absent or not an exact store directory; bootstrap action required',
        },
      };
    }
    return { ok: false, code: code ?? 'ERR-STO-IO-FAILURE', message: dirBracket.message ?? 'configuration metadata directory could not be enumerated' };
  }
  const names = [...dirBracket.bracket.names];
  const foreignEntries = names.filter((n) => n !== 'metadata.json');
  if (foreignEntries.length > 0) {
    const state: ConfigurationMetadataState = 'foreign-configuration-entry';
    return {
      ok: true,
      observation: {
        id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }),
        state,
        foreignEntries: [...foreignEntries].sort(),
        reason: 'foreign entries exist in the configuration metadata directory; external disposition required',
      },
    };
  }
  if (!names.includes('metadata.json')) {
    const state: ConfigurationMetadataState = 'configuration-missing';
    return {
      ok: true,
      observation: {
        id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }),
        state,
        reason: 'expected canonical configuration metadata is absent',
      },
    };
  }
  // The metadata file is present: descriptor-bound classification.
  const path = `${metadataDir}/metadata.json`;
  let fd: number | undefined;
  try {
    fd = openSync(path, O_RDONLY | O_NOFOLLOW);
    const pre = fstatSync(fd);
    if (!pre.isFile()) {
      const state: ConfigurationMetadataState = 'wrong-type-configuration';
      return { ok: true, observation: { id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }), state, reason: 'configuration metadata location is not a regular file' } };
    }
    if (pre.uid !== input.serviceUid || (pre.mode & 0o777) !== 0o600) {
      const state: ConfigurationMetadataState = 'wrong-uid-mode-configuration';
      return { ok: true, observation: { id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }), state, reason: 'configuration metadata violates the store permission policy; never repaired' } };
    }
    if (pre.size > input.byteLimit) {
      const state: ConfigurationMetadataState = 'malformed-configuration';
      return { ok: true, observation: { id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }), state, reason: 'configuration metadata exceeds the bounded byte limit' } };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok || post.size !== bytes.length) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'configuration metadata changed during descriptor-based read' };
    }
    const raw = bytes.toString('utf8');
    let model: unknown;
    try {
      model = parseRawJson(raw, input.byteLimit).model;
    } catch {
      const state: ConfigurationMetadataState = 'malformed-configuration';
      return { ok: true, observation: { id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }), state, reason: 'configuration metadata is not canonical JSON or contains duplicate members' } };
    }
    if (typeof model !== 'object' || model === null || Array.isArray(model) || jcsSerialize(model) !== raw) {
      const state: ConfigurationMetadataState = 'malformed-configuration';
      return { ok: true, observation: { id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }), state, reason: 'configuration metadata bytes are not canonical' } };
    }
    const modelObj = model as Readonly<Record<string, unknown>>;
    if (modelObj['recordKind'] !== 'store-metadata') {
      const state: ConfigurationMetadataState = 'malformed-configuration';
      return { ok: true, observation: { id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }), state, reason: 'configuration metadata record kind is not the store-metadata kind' } };
    }
    const declaredVersion = typeof modelObj['formatVersion'] === 'string' ? modelObj['formatVersion'] : '';
    if (declaredVersion !== '1.0') {
      const state: ConfigurationMetadataState = 'unsupported-configuration-version';
      return { ok: true, observation: { id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }), state, declaredMetadataVersion: declaredVersion, reason: 'configuration metadata version is outside the supported set; migration boundary' } };
    }
    const payload = modelObj['payload'];
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      const state: ConfigurationMetadataState = 'malformed-configuration';
      return { ok: true, observation: { id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }), state, reason: 'configuration metadata payload is malformed' } };
    }
    const p = payload as Readonly<Record<string, unknown>>;
    const declaredPayloadDigest = modelObj['payloadDigest'];
    const canonicalPayload = jcsSerialize(p);
    const recomputedPayloadDigest = computeDomainDigest(STORAGE_PAYLOAD_DIGEST_DOMAIN, canonicalPayload);
    if (typeof declaredPayloadDigest !== 'string' || recomputedPayloadDigest !== declaredPayloadDigest) {
      const state: ConfigurationMetadataState = 'malformed-configuration';
      return { ok: true, observation: { id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }), state, reason: 'configuration metadata payload digest mismatch' } };
    }
    const declaredConfigurationIdentity = p['configurationIdentity'];
    const recordDigest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, jcsSerialize(modelObj));
    if (typeof declaredConfigurationIdentity !== 'string' || declaredConfigurationIdentity !== input.configurationIdentity) {
      const state: ConfigurationMetadataState = 'conflicting-configuration';
      return { ok: true, observation: { id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }), state, declaredConfigurationIdentity: typeof declaredConfigurationIdentity === 'string' ? declaredConfigurationIdentity : undefined, metadataDigest: recordDigest, reason: 'configuration metadata binds a different configuration identity than the verified store' } };
    }
    const state: ConfigurationMetadataState = 'configuration-healthy';
    return { ok: true, observation: { id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }), state, declaredConfigurationIdentity, declaredMetadataVersion: declaredVersion, metadataDigest: recordDigest, reason: 'configuration metadata is self-consistent and binds the verified store configuration identity' } };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      const state: ConfigurationMetadataState = 'configuration-missing';
      return { ok: true, observation: { id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }), state, reason: 'expected canonical configuration metadata is absent' } };
    }
    if (code === 'ELOOP' || code === 'EISDIR' || code === 'ENOTDIR') {
      const state: ConfigurationMetadataState = 'wrong-type-configuration';
      return { ok: true, observation: { id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }), state, reason: 'configuration metadata location is not a no-follow regular file' } };
    }
    if (code === 'EACCES' || code === 'EPERM') {
      const state: ConfigurationMetadataState = 'wrong-uid-mode-configuration';
      return { ok: true, observation: { id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }), state, reason: 'configuration metadata is not accessible under the store permission policy' } };
    }
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'configuration metadata classification failed' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * WP-8-M recovery-flow byte-exact configuration metadata classification
 * (§16.7): the expected canonical bytes are derived from the genuine trusted
 * input; the current object is classified against them. `configuration-healthy`
 * requires byte-exact equality with the expected canonical configuration;
 * `interrupted-configuration-publication` is a provable strict prefix.
 * Never overwrites; never repairs.
 */
export function classifyConfigurationMetadataState(input: {
  readonly configRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly expectedCanonicalUtf8: string;
  readonly expectedDigest: string;
  readonly configurationIdentity: string;
  readonly storeInstance: VerifiedStoreInstance;
}): { readonly ok: boolean; readonly observation?: ConfigurationNamespaceObservation; readonly code?: string; readonly message?: string } {
  const surface = classifyConfigurationMetadataSurface({
    configRoot: input.configRoot,
    serviceUid: input.serviceUid,
    byteLimit: input.byteLimit,
    configurationIdentity: input.configurationIdentity,
    storeInstance: input.storeInstance,
  });
  if (!surface.ok || surface.observation === undefined) {
    return { ok: false, code: surface.code ?? 'ERR-STO-IO-FAILURE', message: surface.message ?? 'configuration metadata surface classification failed' };
  }
  const base = surface.observation;
  // Byte-exact refinement over the surface classification: only a present,
  // self-consistent, identity-matching object can be the expected one.
  if (base.state === 'configuration-healthy' || base.state === 'conflicting-configuration') {
    const metadataDir = `${input.configRoot}/metadata`;
    const path = `${metadataDir}/metadata.json`;
    const read = readConfigurationMetadataBytes({ path, serviceUid: input.serviceUid, byteLimit: input.byteLimit });
    if (!read.ok || read.bytes === undefined) {
      return { ok: false, code: read.code ?? 'ERR-STO-IO-FAILURE', message: read.message ?? 'configuration metadata could not be read for the exact comparison' };
    }
    const presentBytes = read.bytes;
    if (presentBytes === input.expectedCanonicalUtf8) {
      const state: ConfigurationMetadataState = 'configuration-healthy';
      return { ok: true, observation: { ...base, id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }), state, reason: 'exact expected canonical configuration metadata is present' } };
    }
    if (input.expectedCanonicalUtf8.startsWith(presentBytes) && presentBytes.length < input.expectedCanonicalUtf8.length) {
      const state: ConfigurationMetadataState = 'interrupted-configuration-publication';
      return { ok: true, observation: { ...base, id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }), state, reason: 'present bytes are a provable prefix of the expected canonical configuration; never overwritten (external disposition)' } };
    }
    const state: ConfigurationMetadataState = 'conflicting-configuration';
    return { ok: true, observation: { ...base, id: configurationMetadataObservationId({ storeInstance: input.storeInstance, state, entry: 'metadata.json' }), state, reason: 'present configuration metadata bytes differ from the expected canonical configuration; never overwritten (external disposition)' } };
  }
  // Recompute the observation id for the surface state (the store instance
  // placeholder is identical — the id binds the state and entry only).
  return { ok: true, observation: base };
}

/** Descriptor-bound read of the configuration metadata bytes (WP-8-M classification). */
function readConfigurationMetadataBytes(input: {
  readonly path: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
}): { readonly ok: boolean; readonly bytes?: string; readonly code?: string; readonly message?: string } {
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW);
    const pre = fstatSync(fd);
    if (!pre.isFile() || pre.uid !== input.serviceUid || (pre.mode & 0o777) !== 0o600) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'configuration metadata object is not the exact store file' };
    }
    if (pre.size > input.byteLimit) {
      return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'configuration metadata exceeds the bounded byte limit' };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok || post.size !== bytes.length) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'configuration metadata changed during descriptor-based read' };
    }
    return { ok: true, bytes: bytes.toString('utf8') };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'configuration metadata is absent' };
    }
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'configuration metadata read failed' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * WP-8-I disposition-evidence payload facts (ADR-032; §10): extracted from
 * one canonical store-evidence-record whose payload declares an executable
 * disposition recovery operation (`dispose-quarantined-temporary` |
 * `dispose-conflicting-index`). `disposition` is true for every such
 * claim; `malformed` is true when the claimed facts are incomplete or the
 * outcome is outside the closed vocabulary; otherwise `facts` carries the
 * bound facts. Pure.
 */
export function extractDispositionEvidenceFacts(raw: string): {
  readonly disposition?: boolean;
  readonly malformed?: boolean;
  readonly facts?: {
    readonly recoveryOperation: string;
    readonly targetEntry: string;
    readonly targetShard?: string;
    readonly targetIndexId?: string;
    readonly targetDigest: string;
    readonly observationId: string;
    readonly outcome: string;
  };
} {
  try {
    const model = parseRawJson(raw, 1024 * 1024).model;
    if (typeof model !== 'object' || model === null || Array.isArray(model)) return {};
    const payload = (model as Readonly<Record<string, unknown>>)['payload'];
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {};
    const p = payload as Readonly<Record<string, unknown>>;
    const recoveryOperation = p['recoveryOperation'];
    if (recoveryOperation !== 'dispose-quarantined-temporary' && recoveryOperation !== 'dispose-conflicting-index') return {};
    const targetEntry = p['targetEntry'];
    const targetShard = p['targetShard'];
    const targetIndexId = p['targetIndexId'];
    const targetDigest = p['targetDigest'];
    const observationId = p['observationId'];
    const outcome = p['outcome'];
    if (
      typeof targetEntry !== 'string' ||
      typeof targetDigest !== 'string' ||
      typeof observationId !== 'string' ||
      (outcome !== 'disposed' && outcome !== 'already-completed') ||
      (recoveryOperation === 'dispose-quarantined-temporary' ? typeof targetShard !== 'string' : typeof targetIndexId !== 'string')
    ) {
      return { disposition: true, malformed: true };
    }
    return {
      disposition: true,
      facts: {
        recoveryOperation,
        targetEntry,
        ...(typeof targetShard === 'string' ? { targetShard } : {}),
        ...(typeof targetIndexId === 'string' ? { targetIndexId } : {}),
        targetDigest,
        observationId,
        outcome,
      },
    };
  } catch {
    return {};
  }
}

/**
 * WP-8-J lock-recovery evidence payload facts (12.3.1; ADR-033): extracted
 * from one canonical store-evidence-record whose payload declares the
 * `break-writer-lock` recovery operation. `lockRecovery` is true for every
 * break-writer-lock evidence claim; `malformed` is true when the claimed
 * facts are incomplete or the outcome is outside the closed vocabulary;
 * otherwise `facts` carries the bound facts. Pure.
 */
export function extractLockRecoveryEvidenceFacts(raw: string): {
  readonly lockRecovery?: boolean;
  readonly malformed?: boolean;
  readonly facts?: {
    readonly lockRecordDigest: string;
    readonly lockInstanceId: string;
    readonly outcome: string;
  };
} {
  try {
    const model = parseRawJson(raw, 1024 * 1024).model;
    if (typeof model !== 'object' || model === null || Array.isArray(model)) return {};
    const payload = (model as Readonly<Record<string, unknown>>)['payload'];
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {};
    const p = payload as Readonly<Record<string, unknown>>;
    if (p['recoveryOperation'] !== 'break-writer-lock') return {};
    const lockRecordDigest = p['lockRecordDigest'];
    const lockInstanceId = p['lockInstanceId'];
    const outcome = p['outcome'];
    if (
      typeof lockRecordDigest !== 'string' ||
      !isValidDigestSyntax(lockRecordDigest) ||
      typeof lockInstanceId !== 'string' ||
      !/^pgw:r:[0-9a-f]{32}$/.test(lockInstanceId) ||
      (outcome !== 'lock-broken' && outcome !== 'already-completed')
    ) {
      return { lockRecovery: true, malformed: true };
    }
    return { lockRecovery: true, facts: { lockRecordDigest, lockInstanceId, outcome } };
  } catch {
    return {};
  }
}

/** Domain-separated scan-generation token domain (request compatibility; F2). */
export const SCAN_GENERATION_DOMAIN = 'PGAP-STORAGE-SCAN-GENERATION-v1\u0000';
/** Domain-separated cross-page surface-generation token domain (F3-G). */
export const SCAN_SURFACE_GENERATION_DOMAIN = 'PGAP-STORAGE-SCAN-SURFACE-v1\u0000';
/** WP-8-M: configuration-namespace observation identity domain (§16.7/ADR-036). */
export const STORAGE_CONFIGURATION_OBSERVATION_DOMAIN = 'PGAP-STORAGE-CONFIGURATION-OBSERVATION-v1\u0000';
/**
 * Class-order/surface model version bound into both generation tokens (F2,
 * F3-G): a future change to the deterministic class order or surface model
 * must bump this constant so cursors from the previous model are rejected.
 */
const SCAN_MODEL_VERSION = 'v1' as const;

const SHARD_RE = /^[0-9a-f]{4}$/;
/** Quarantine object filename: `<64-hex>.qtn` (ADR-030; §16.5). */
const QUARANTINE_NAME_RE = /^[0-9a-f]{64}\.qtn$/;
const QUARANTINE_SUFFIX = '.qtn';
const COMPONENT_RE = /^[0-9a-f]{32}$/;
/** Publication temporary-name grammar (WPR-003): `pub-<16 hex>-<ordinal hex>`. */
const TEMP_NAME_RE = /^pub-[0-9a-f]{16}-[0-9a-f]{1,4}$/;

const NO_STATE = { retryable: false, recoveryRequired: false, primaryStateChanged: 'no' as const, durabilityPointReached: 'no' as const, auditChanged: 'no' as const, verifyBeforeRetry: false };

function finding(code: string, message: string): StorageFinding {
  return { code, message, phase: 'request-validation', state: NO_STATE };
}

function compareFindings(a: StorageFinding, b: StorageFinding): number {
  return a.code < b.code ? -1 : a.code > b.code ? 1 : a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}

function failResult(code: string, message: string): StoreScanResult {
  return { ok: false, observations: [], findings: [finding(code, message)], scannedEntries: 0, scannedBytes: 0, truncated: false };
}

/** Deterministic observation id: domain digest over kind/scope/location/entry. */
function observationId(kind: string, scope: string | undefined, shard: string | undefined, entry: string): string {
  const tuple = jcsSerialize({ kind, scope: scope ?? null, shard: shard ?? null, entry });
  const digest = computeDomainDigest(SCAN_OBSERVATION_ID_DOMAIN, tuple);
  return `obs-${digest.slice('sha-256:'.length, 'sha-256:'.length + 16)}`;
}

/**
 * Deterministic request-compatibility generation token (F2; RGY-005):
 * domain digest over the verified store instance identity (both namespace
 * identities), the scan mode, the effective entry/byte limits, the
 * fail-closed behavior, and the class-order model version. Identical
 * stores, modes, and bounds yield identical tokens; registry and recovery
 * scans over the same store and numeric limits produce DIFFERENT tokens
 * because their modes differ.
 */
export function computeScanGeneration(input: {
  readonly storeInstance: VerifiedStoreInstance;
  readonly mode: ScanMode;
  readonly entryLimit: number;
  readonly byteLimit: number;
  readonly failClosed: boolean;
}): string {
  const tuple = jcsSerialize({
    modelVersion: SCAN_MODEL_VERSION,
    mode: input.mode,
    storeInstance: input.storeInstance.namespaces
      .map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino }))
      .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
    entryLimit: input.entryLimit,
    byteLimit: input.byteLimit,
    failClosed: input.failClosed,
  });
  return computeDomainDigest(SCAN_GENERATION_DOMAIN, tuple);
}

/** Descriptor identity of a directory (never exposed raw; F3-G binds it only through a digest). */
interface DirectoryIdentity {
  readonly dev: number;
  readonly ino: number;
}

/**
 * Cross-page structural snapshot (F3-G): parent presence and identity,
 * expected record-class presence set, `audit-event` presence, and the
 * identities of every present class directory.
 */
interface SurfaceStructure {
  /** Absent (undefined) when the parent was never successfully opened. */
  readonly recordsParent: DirectoryIdentity | undefined;
  readonly auditParent: DirectoryIdentity | undefined;
  /** Present record classes in taxonomy order. */
  readonly recordClasses: readonly RecordClassId[];
  readonly auditEventPresent: boolean;
  /** Identities of every present class directory (records classes and audit-event). */
  readonly classIdentities: ReadonlyMap<RecordClassId, DirectoryIdentity>;
  /** WP-8-F quarantine structure (recovery mode only). */
  readonly quarantineParent: DirectoryIdentity | undefined;
  readonly quarantineTemporaryPresent: boolean;
  readonly quarantineShards: readonly { readonly shard: string; readonly dev: number; readonly ino: number }[];
  /** WP-8-H registry-index structure (recovery mode only). */
  readonly indexParent: DirectoryIdentity | undefined;
  readonly indexFamilyPresent: boolean;
  readonly indexShards: readonly { readonly shard: string; readonly dev: number; readonly ino: number }[];
}

/**
 * Deterministic cross-page surface-generation token (F3-G): domain digest
 * over the structural snapshot. Absent-on-both-pages is unchanged (same
 * digest); present-to-absent, absent-to-present, class-set change, parent
 * disappearance, and directory replacement/identity change all change the
 * digest and fail closed on resume with ERR-STO-ROOT-IDENTITY-CHANGED.
 */
function computeSurfaceGeneration(structure: SurfaceStructure): string {
  // The store-evidence-record class is excluded from the structural token:
  // evidence directories legitimately appear as the direct result of
  // recovery-mutation execution itself (WP-8-F), so their appearance must
  // not be treated as structural drift by later recovery steps or resumed
  // pages. The class is still enumerated and verified by the scan.
  // Quarantine structure is bound in recovery mode only (QRN/WP-8-F §8).
  const recordClasses = structure.recordClasses.filter((c) => c !== 'store-evidence-record');
  const classIdentities = [...structure.classIdentities.entries()]
    .filter(([recordClass]) => recordClass !== 'store-evidence-record')
    .map(([recordClass, identity]) => ({ recordClass, dev: identity.dev, ino: identity.ino }))
    .sort((a, b) => (a.recordClass < b.recordClass ? -1 : a.recordClass > b.recordClass ? 1 : 0));
  const quarantineShards = [...structure.quarantineShards]
    .map((q) => ({ shard: q.shard, dev: q.dev, ino: q.ino }))
    .sort((a, b) => (a.shard < b.shard ? -1 : a.shard > b.shard ? 1 : 0));
  const indexShards = [...structure.indexShards]
    .map((q) => ({ shard: q.shard, dev: q.dev, ino: q.ino }))
    .sort((a, b) => (a.shard < b.shard ? -1 : a.shard > b.shard ? 1 : 0));
  const tuple = jcsSerialize({
    modelVersion: SCAN_MODEL_VERSION,
    recordsParent: structure.recordsParent ?? null,
    auditParent: structure.auditParent ?? null,
    recordClasses,
    auditEventPresent: structure.auditEventPresent,
    classIdentities,
    quarantineParent: structure.quarantineParent ?? null,
    quarantineTemporaryPresent: structure.quarantineTemporaryPresent,
    quarantineShards,
    indexParent: structure.indexParent ?? null,
    indexFamilyPresent: structure.indexFamilyPresent,
    indexShards,
  });
  return computeDomainDigest(SCAN_SURFACE_GENERATION_DOMAIN, tuple);
}

/**
 * Recompute the current cross-page surface-structure token (WP-8-F): the
 * mutation boundary re-reads the structural snapshot and compares it with
 * the assessment-bound token before any mutation (F3-G drift rule).
 */
export function recomputeSurfaceGeneration(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly mode: ScanMode;
  readonly hooks?: ScanHooks;
}): { readonly ok: boolean; readonly generation?: string; readonly code?: string; readonly message?: string } {
  const structureRead = readSurfaceStructure({ namespaceRoot: input.namespaceRoot, serviceUid: input.serviceUid, hooks: input.hooks, report: false, mode: input.mode });
  if (!structureRead.ok || structureRead.structure === undefined) {
    return { ok: false, code: structureRead.code ?? 'ERR-STO-IO-FAILURE', message: structureRead.message ?? 'surface structure could not be re-read' };
  }
  return { ok: true, generation: computeSurfaceGeneration(structureRead.structure) };
}

/** One verified audit-event fact set for the mutation boundary (never a path). */
export interface AuditEventFactsForTarget {
  /** Audit event identity (envelope `recordId`). */
  readonly eventId: string;
  /** Payload event kind (absent when the association payload is malformed). */
  readonly eventKind?: string;
  /** Payload record identity (absent when the association payload is malformed). */
  readonly primaryRecordId?: string;
  /** Payload record digest (absent when the association payload is malformed). */
  readonly primaryDigest?: string;
  /** True when the payload carries the exact reconstruction gap marker (`gapMarker.missingEventKind === authorized-write`). */
  readonly gapMarker: boolean;
  /** Canonical bytes of the durable event (byte-exact comparison). */
  readonly canonicalUtf8: string;
  /** Record-bytes digest of the durable event. */
  readonly digest: string;
}

/**
 * WP-8-G current audit-state enumeration (16.3; CSA-005/013/014): reads the
 * ENTIRE `audit/audit-event/` surface descriptor-bound and returns the
 * verified audit events whose payload references the target record
 * identity. Used by the audit-reconstruction boundary to verify, against
 * the CURRENT state (never a prior view), that the exact audit is absent,
 * no conflicting audit exists, and no contesting audits exist. The audit
 * surface must be fully readable: a foreign shard/entry, a non-canonical
 * event, a wrong UID/mode, an identity that does not match the derived
 * location, or a changed-during-read object fails closed — the audit state
 * cannot be proven, so no reconstruction may proceed.
 */
export function auditEventsForRecord(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly targetRecordId: string;
}): { readonly ok: boolean; readonly events?: readonly AuditEventFactsForTarget[]; readonly code?: string; readonly message?: string } {
  const auditDir = `${input.namespaceRoot}/audit`;
  const auditBracket = readdirVerified(auditDir, input.serviceUid, undefined, { surface: 'audit' });
  if (!auditBracket.ok || auditBracket.bracket === undefined) {
    return { ok: false, code: auditBracket.code ?? 'ERR-STO-IO-FAILURE', message: auditBracket.message ?? 'audit parent could not be verified' };
  }
  if (auditBracket.bracket.absent) return { ok: true, events: [] };
  if (!auditBracket.bracket.names.includes('audit-event')) return { ok: true, events: [] };
  const classDir = `${auditDir}/audit-event`;
  const classBracket = readdirVerified(classDir, input.serviceUid, undefined, { surface: 'audit', recordClass: 'authoritative-audit-event' });
  if (!classBracket.ok || classBracket.bracket === undefined) {
    return { ok: false, code: classBracket.code ?? 'ERR-STO-IO-FAILURE', message: classBracket.message ?? 'audit-event class directory could not be verified' };
  }
  if (classBracket.bracket.absent) return { ok: true, events: [] };
  const events: AuditEventFactsForTarget[] = [];
  for (const shardName of classBracket.bracket.names) {
    if (!SHARD_RE.test(shardName)) {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'foreign shard in the audit-event surface; audit state cannot be proven' };
    }
    const shardDir = `${classDir}/${shardName}`;
    const shardBracket = readdirVerified(shardDir, input.serviceUid, undefined, { surface: 'audit', recordClass: 'authoritative-audit-event', shard: shardName });
    if (!shardBracket.ok || shardBracket.bracket === undefined) {
      return { ok: false, code: shardBracket.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', message: shardBracket.message ?? 'audit shard directory could not be verified' };
    }
    if (shardBracket.bracket.absent) {
      return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'audit shard directory disappeared during verification' };
    }
    for (const entryName of shardBracket.bracket.names) {
      const component = entryName.slice(0, 32);
      if (!COMPONENT_RE.test(component) || entryName.length !== 36 || !entryName.endsWith('.aud')) {
        return { ok: false, code: 'ERR-STO-MALFORMED', message: 'foreign entry in the audit-event surface; audit state cannot be proven' };
      }
      let fd: number | undefined;
      try {
        fd = openSync(`${shardDir}/${entryName}`, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
        const pre = fstatSync(fd);
        const verified = verifyRegularFileStat(pre, input.serviceUid);
        if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
        if (pre.size > input.byteLimit) {
          return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'audit event exceeds the bounded byte limit' };
        }
        const bytes = readFileSync(fd);
        const post = fstatSync(fd);
        const revalidated = comparePrePostStat(pre, post);
        if (!revalidated.ok || post.size !== bytes.length) {
          return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'audit event changed during descriptor-based read' };
        }
        const raw = bytes.toString('utf8');
        const parsed = parsePersistedEnvelope(raw, input.byteLimit);
        if (!parsed.ok || parsed.model === undefined || parsed.bytes === undefined) {
          return { ok: false, code: 'ERR-STO-MALFORMED', message: 'audit event is not a canonical record envelope' };
        }
        if (jcsSerialize(parsed.model) !== raw) {
          return { ok: false, code: 'ERR-STO-MALFORMED', message: 'audit event bytes are not canonical JSON' };
        }
        const model = parsed.model as Readonly<Record<string, unknown>>;
        const recordId = typeof model['recordId'] === 'string' ? model['recordId'] : undefined;
        if (recordId === undefined || !recordId.endsWith(component)) {
          return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'audit event identity does not match its derived location' };
        }
        const payload = model['payload'];
        if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
          return { ok: false, code: 'ERR-STO-MALFORMED', message: 'audit event payload is malformed' };
        }
        const p = payload as Readonly<Record<string, unknown>>;
        const eventKind = p['eventKind'];
        const primaryRecordId = p['recordId'];
        const primaryDigest = p['recordDigest'];
        if (typeof eventKind !== 'string' || typeof primaryRecordId !== 'string' || typeof primaryDigest !== 'string') {
          // An audit event whose association payload is malformed cannot be
          // verified as an audit of any record; it is a conflicting/dangling
          // audit fact and the audit state cannot be proven for the target.
          return { ok: false, code: 'ERR-STO-MALFORMED', message: 'audit event association payload is malformed' };
        }
        if (primaryRecordId !== input.targetRecordId) continue;
        const gap = p['gapMarker'];
        const gapMarker = typeof gap === 'object' && gap !== null && !Array.isArray(gap) && (gap as Readonly<Record<string, unknown>>)['missingEventKind'] === 'authorized-write';
        events.push({
          eventId: recordId,
          eventKind,
          primaryRecordId,
          primaryDigest,
          gapMarker,
          canonicalUtf8: parsed.bytes.canonicalUtf8,
          digest: parsed.bytes.digest,
        });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'audit event disappeared during verification' };
        }
        return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'audit event could not be read descriptor-bound' };
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    }
  }
  events.sort((a, b) => (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));
  return { ok: true, events };
}

/** One verified reconstruction-evidence fact set for the mutation boundary (never a path). */
export interface ReconstructionEvidenceFactsForTarget {
  /** Evidence record identity (envelope `recordId`). */
  readonly evidenceId: string;
  readonly targetRecordId: string;
  readonly targetRecordClass: string;
  readonly targetRecordDigest: string;
  readonly reconstructionAuditId: string;
  readonly outcome: string;
  /** Canonical bytes of the durable evidence record. */
  readonly canonicalUtf8: string;
  /** Record-bytes digest of the durable evidence record. */
  readonly digest: string;
}

/**
 * WP-8-G current reconstruction-evidence enumeration (16.3; §9): reads the
 * `records/evidence/` surface descriptor-bound and returns the verified
 * `StoreEvidenceRecord` objects whose payload claims the
 * `audit-reconstruction` operation for the target record identity. The
 * audit-reconstruction boundary uses this to fail closed on
 * evidence-without-audit states (never republish from evidence alone),
 * conflicting evidence bindings, and duplicate evidence — always against
 * the CURRENT state, never a prior view. The evidence surface must be
 * fully readable: foreign entries, non-canonical records, malformed
 * audit-reconstruction claims, and changed-during-read objects fail
 * closed (the evidence state cannot be proven).
 */
export function reconstructionEvidenceForTarget(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly targetRecordId: string;
}): { readonly ok: boolean; readonly evidence?: readonly ReconstructionEvidenceFactsForTarget[]; readonly code?: string; readonly message?: string } {
  const recordsDir = `${input.namespaceRoot}/records`;
  const recordsBracket = readdirVerified(recordsDir, input.serviceUid, undefined, { surface: 'records' });
  if (!recordsBracket.ok || recordsBracket.bracket === undefined) {
    return { ok: false, code: recordsBracket.code ?? 'ERR-STO-IO-FAILURE', message: recordsBracket.message ?? 'records parent could not be verified' };
  }
  if (recordsBracket.bracket.absent || !recordsBracket.bracket.names.includes('evidence')) return { ok: true, evidence: [] };
  const classDir = `${recordsDir}/evidence`;
  const classBracket = readdirVerified(classDir, input.serviceUid, undefined, { surface: 'records', recordClass: 'store-evidence-record' });
  if (!classBracket.ok || classBracket.bracket === undefined) {
    return { ok: false, code: classBracket.code ?? 'ERR-STO-IO-FAILURE', message: classBracket.message ?? 'evidence class directory could not be verified' };
  }
  if (classBracket.bracket.absent) return { ok: true, evidence: [] };
  const evidence: ReconstructionEvidenceFactsForTarget[] = [];
  for (const shardName of classBracket.bracket.names) {
    if (!SHARD_RE.test(shardName)) {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'foreign shard in the evidence surface; evidence state cannot be proven' };
    }
    const shardDir = `${classDir}/${shardName}`;
    const shardBracket = readdirVerified(shardDir, input.serviceUid, undefined, { surface: 'records', recordClass: 'store-evidence-record', shard: shardName });
    if (!shardBracket.ok || shardBracket.bracket === undefined) {
      return { ok: false, code: shardBracket.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', message: shardBracket.message ?? 'evidence shard directory could not be verified' };
    }
    if (shardBracket.bracket.absent) {
      return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'evidence shard directory disappeared during verification' };
    }
    for (const entryName of shardBracket.bracket.names) {
      const component = entryName.slice(0, 32);
      if (!COMPONENT_RE.test(component) || entryName.length !== 36 || !entryName.endsWith('.rec')) {
        return { ok: false, code: 'ERR-STO-MALFORMED', message: 'foreign entry in the evidence surface; evidence state cannot be proven' };
      }
      let fd: number | undefined;
      try {
        fd = openSync(`${shardDir}/${entryName}`, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
        const pre = fstatSync(fd);
        const verified = verifyRegularFileStat(pre, input.serviceUid);
        if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
        if (pre.size > input.byteLimit) {
          return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'evidence record exceeds the bounded byte limit' };
        }
        const bytes = readFileSync(fd);
        const post = fstatSync(fd);
        const revalidated = comparePrePostStat(pre, post);
        if (!revalidated.ok || post.size !== bytes.length) {
          return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'evidence record changed during descriptor-based read' };
        }
        const raw = bytes.toString('utf8');
        const parsed = parsePersistedEnvelope(raw, input.byteLimit);
        if (!parsed.ok || parsed.model === undefined || parsed.bytes === undefined) {
          return { ok: false, code: 'ERR-STO-MALFORMED', message: 'evidence record is not a canonical record envelope' };
        }
        if (jcsSerialize(parsed.model) !== raw) {
          return { ok: false, code: 'ERR-STO-MALFORMED', message: 'evidence record bytes are not canonical JSON' };
        }
        const model = parsed.model as Readonly<Record<string, unknown>>;
        const recordId = typeof model['recordId'] === 'string' ? model['recordId'] : undefined;
        if (recordId === undefined || !recordId.endsWith(component)) {
          return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'evidence record identity does not match its derived location' };
        }
        const payload = model['payload'];
        if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
          return { ok: false, code: 'ERR-STO-MALFORMED', message: 'evidence record payload is malformed' };
        }
        const p = payload as Readonly<Record<string, unknown>>;
        if (p['recoveryOperation'] !== 'audit-reconstruction') continue;
        const targetRecordId = p['targetRecordId'];
        const targetRecordClass = p['targetRecordClass'];
        const targetRecordDigest = p['targetRecordDigest'];
        const reconstructionAuditId = p['reconstructionAuditId'];
        const outcome = p['outcome'];
        if (
          typeof targetRecordId !== 'string' ||
          typeof targetRecordClass !== 'string' ||
          typeof targetRecordDigest !== 'string' ||
          typeof reconstructionAuditId !== 'string' ||
          (outcome !== 'reconstructed' && outcome !== 'already-completed')
        ) {
          return { ok: false, code: 'ERR-STO-MALFORMED', message: 'audit-reconstruction evidence claim is malformed; evidence state cannot be proven' };
        }
        if (targetRecordId !== input.targetRecordId) continue;
        evidence.push({
          evidenceId: recordId,
          targetRecordId,
          targetRecordClass,
          targetRecordDigest,
          reconstructionAuditId,
          outcome,
          canonicalUtf8: parsed.bytes.canonicalUtf8,
          digest: parsed.bytes.digest,
        });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'evidence record disappeared during verification' };
        }
        return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'evidence record could not be read descriptor-bound' };
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    }
  }
  evidence.sort((a, b) => (a.evidenceId < b.evidenceId ? -1 : a.evidenceId > b.evidenceId ? 1 : 0));
  return { ok: true, evidence };
}

// ─── WP-8-I: current-state single-entry disposition re-verification ──────
// The external-disposition adjudication foundation re-enumerates ONE target
// entry on its committed surface and recomputes its classification with the
// EXACT committed scanner logic (same private functions, same decision
// order). The helpers are read-only; they never mutate, never mint
// authority, and never accept a path from a caller.

/**
 * Descriptor-bound entry-type probe (WP-8-I; WPR-023 (d) exact type
 * binding): no-follow open attempt → fstat type; open failures map exactly
 * as the committed temporary scanner maps them (ELOOP → symlink;
 * ENXIO/ENODEV → special; EISDIR → directory; ENOENT → absent; anything
 * else fails closed).
 */
function probeEntryType(path: string): { readonly ok: boolean; readonly entryType?: 'regular' | 'symlink' | 'special' | 'directory'; readonly code?: string; readonly message?: string } {
  let fd: number | undefined;
  try {
    fd = openSync(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const st = fstatSync(fd);
    return { ok: true, entryType: st.isFile() ? 'regular' : st.isDirectory() ? 'directory' : 'special' };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'target entry is absent' };
    if (code === 'ELOOP') return { ok: true, entryType: 'symlink' };
    if (code === 'ENXIO' || code === 'ENODEV') return { ok: true, entryType: 'special' };
    if (code === 'EISDIR') return { ok: true, entryType: 'directory' };
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'target entry could not be probed descriptor-bound' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * WP-8-I current-state re-verification of ONE `tmp/` entry (WPR-023 (d)
 * adjudication): the committed temporary-entry scanner is run against the
 * CURRENT state. The published-inode twin map is intentionally empty: every
 * WPR-023 (d) classification in the committed scanner occurs BEFORE the
 * twin branch (wrong type/UID/mode or changed-during-read), and any object
 * that would classify (a)/(b)/(c) under the full map fails the exact
 * `temporary-other` classification check — so the adjudication outcome is
 * identical to the full scanner for every (d)-expected target, and
 * fail-closed for everything else.
 */
export function currentTemporaryObservation(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly temporaryBytes: number;
  readonly recordBytes: number;
  readonly byteLimit: number;
  readonly entry: string;
}): {
  readonly ok: boolean;
  readonly observation?: TemporaryScanObservation | ForeignScanObservation;
  readonly entryType?: 'regular' | 'symlink' | 'special' | 'directory';
  readonly code?: string;
  readonly message?: string;
} {
  const path = `${input.namespaceRoot}/tmp` + `/${input.entry}`;
  const probe = probeEntryType(path);
  if (!probe.ok) {
    return { ok: false, code: probe.code, message: probe.message };
  }
  if (!TEMP_NAME_RE.test(input.entry)) {
    // The committed scanner reports foreign tmp names as foreign-object
    // observations (never WPR-023 (d)); the exact classification check
    // rejects them.
    return {
      ok: true,
      observation: { id: observationId('foreign-object', undefined, undefined, input.entry), entry: input.entry, kind: 'foreign-object', classification: 'foreign-entry', code: 'ERR-STO-MALFORMED' },
    };
  }
  const result = scanTemporaryEntry({
    path,
    name: input.entry,
    serviceUid: input.serviceUid,
    temporaryBytes: input.temporaryBytes,
    recordBytes: input.recordBytes,
    bounds: { entryLimit: 1, byteLimit: input.byteLimit, failClosed: true },
    state: { scannedBytes: 0 },
    publishedInodes: new Map(),
  });
  if (result.stop !== undefined) {
    return { ok: false, code: result.code ?? 'ERR-STO-LIMIT-EXCEEDED', message: result.message ?? 'temporary entry re-scan exceeded its bound' };
  }
  if (result.observation === undefined) {
    return { ok: false, code: 'ERR-STO-INTERNAL-INVARIANT', message: 'temporary entry re-scan produced no observation' };
  }
  return { ok: true, observation: result.observation as TemporaryScanObservation | ForeignScanObservation, entryType: probe.entryType };
}

/**
 * WP-8-J current-state re-verification of the writer lock (12.3.1;
 * ADR-033): descriptor-bound no-follow read of `locks/writer.lock` with the
 * committed scanner's classification, plus the non-secret instance bindings
 * (lock-record digest and deterministic lock-instance identity). Used by
 * the `break-writer-lock` boundary to verify, against the CURRENT state,
 * that the exact adjudicated lock instance is present and unchanged. No
 * liveness inference occurs: PID/start-time/age fields are recorded facts
 * only. Absent → `ERR-STO-NOT-FOUND`; any other state maps to the committed
 * classifications.
 */
export function currentLockObservation(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly expectedStoreInstance: readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[];
}): {
  readonly ok: boolean;
  readonly observation?: LockScanObservation;
  readonly code?: string;
  readonly message?: string;
} {
  const scanned = scanLockEntry({
    path: `${input.namespaceRoot}/locks/writer.lock`,
    name: 'writer.lock',
    serviceUid: input.serviceUid,
    bounds: { entryLimit: 1, byteLimit: LOCK_RECORD_MAX_BYTES, failClosed: true },
    state: { scannedBytes: 0 },
    expectedStoreInstance: input.expectedStoreInstance,
  });
  if (scanned.stop !== undefined) {
    return { ok: false, code: scanned.code ?? 'ERR-STO-LIMIT-EXCEEDED', message: scanned.message ?? 'writer lock re-scan exceeded its bound' };
  }
  if (scanned.observation === undefined) {
    return { ok: false, code: 'ERR-STO-INTERNAL-INVARIANT', message: 'writer lock re-scan produced no observation' };
  }
  if (scanned.observation.kind !== 'lock-object') {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'writer lock location is not a lock object' };
  }
  const observation = scanned.observation as LockScanObservation;
  if (observation.classification === 'writer-lock-malformed' && observation.code === 'ERR-STO-INTEGRITY' && observation.lock === undefined && observation.stat === undefined) {
    // The committed scanner reports a disappeared lock as writer-lock-
    // malformed/ERR-STO-INTEGRITY without facts; map absence explicitly.
    return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'writer lock is absent' };
  }
  return { ok: true, observation };
}

/**
 * WP-8-I current-state re-verification of ONE quarantine entry: the
 * committed per-entry quarantine classifier (`classifyQuarantineEntry`) is
 * run against the CURRENT state, with the `tmp/` surface freshly scanned
 * (bounded) for the interrupted-link twin check — so the recomputed
 * classification is byte-identical to the committed scanner's, including
 * the interrupted-link vs unexpected-hard-link distinction. Parent-level
 * foreign entries (shard `''`) are reported exactly as the committed
 * surface scan reports them.
 */
export function currentQuarantineObservation(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly temporaryBytes: number;
  readonly recordBytes: number;
  readonly storeInstance: VerifiedStoreInstance;
  readonly byteLimit: number;
  readonly tmpEntryLimit: number;
  readonly shard: string;
  readonly entry: string;
}): { readonly ok: boolean; readonly observation?: QuarantineScanObservation; readonly code?: string; readonly message?: string } {
  if (input.entry === 'temporary') {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'the quarantine class directory is not a disposition target' };
  }
  const quarantineDir = `${input.namespaceRoot}/quarantine`;
  const parentBracket = readdirVerified(quarantineDir, input.serviceUid, undefined, { surface: 'quarantine' });
  if (!parentBracket.ok || parentBracket.bracket === undefined) {
    return { ok: false, code: parentBracket.code ?? 'ERR-STO-IO-FAILURE', message: parentBracket.message ?? 'quarantine parent could not be verified' };
  }
  if (parentBracket.bracket.absent) {
    return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'quarantine surface is absent' };
  }
  if (input.shard === '') {
    // Parent-level foreign entries (committed scanner semantics).
    if (parentBracket.bracket.names.includes(input.entry) && input.entry !== 'temporary') {
      return { ok: true, observation: { id: quarantineObservationId('', input.entry), entry: input.entry, kind: 'quarantine-object', shard: '', classification: 'foreign-entry', code: 'ERR-STO-MALFORMED' } };
    }
    const temporaryBracket = readdirVerified(`${quarantineDir}/temporary`, input.serviceUid, undefined, { surface: 'quarantine-temporary' });
    if (!temporaryBracket.ok || temporaryBracket.bracket === undefined) {
      return { ok: false, code: temporaryBracket.code ?? 'ERR-STO-IO-FAILURE', message: temporaryBracket.message ?? 'quarantine temporary class could not be verified' };
    }
    if (!temporaryBracket.bracket.absent && temporaryBracket.bracket.names.includes(input.entry) && !SHARD_RE.test(input.entry)) {
      return { ok: true, observation: { id: quarantineObservationId('', input.entry), entry: input.entry, kind: 'quarantine-object', shard: '', classification: 'foreign-entry', code: 'ERR-STO-MALFORMED' } };
    }
    return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'target quarantine entry is absent at the parent surface' };
  }
  if (!SHARD_RE.test(input.shard)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target quarantine shard is not a 4-hex designation' };
  }
  if (!parentBracket.bracket.names.includes('temporary')) {
    return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'quarantine temporary class is absent' };
  }
  const temporaryBracket = readdirVerified(`${quarantineDir}/temporary`, input.serviceUid, undefined, { surface: 'quarantine-temporary' });
  if (!temporaryBracket.ok || temporaryBracket.bracket === undefined) {
    return { ok: false, code: temporaryBracket.code ?? 'ERR-STO-IO-FAILURE', message: temporaryBracket.message ?? 'quarantine temporary class could not be verified' };
  }
  if (temporaryBracket.bracket.absent || !temporaryBracket.bracket.names.includes(input.shard)) {
    return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'target quarantine shard is absent' };
  }
  const shardBracket = readdirVerified(`${quarantineDir}/temporary/${input.shard}`, input.serviceUid, undefined, { surface: 'quarantine-temporary', shard: input.shard });
  if (!shardBracket.ok || shardBracket.bracket === undefined) {
    return { ok: false, code: shardBracket.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', message: shardBracket.message ?? 'quarantine shard could not be verified' };
  }
  if (shardBracket.bracket.absent) {
    return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'quarantine shard disappeared during verification' };
  }
  if (!shardBracket.bracket.names.includes(input.entry)) {
    return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'target quarantine entry is absent' };
  }
  // Fresh bounded tmp-surface scan for the interrupted-link twin check.
  const tmpObservations: TemporaryScanObservation[] = [];
  const tmpDir = `${input.namespaceRoot}/tmp`;
  const tmpBracket = readdirVerified(tmpDir, input.serviceUid, undefined, { surface: 'tmp' });
  if (!tmpBracket.ok || tmpBracket.bracket === undefined) {
    return { ok: false, code: tmpBracket.code ?? 'ERR-STO-IO-FAILURE', message: tmpBracket.message ?? 'tmp surface could not be verified for the quarantine twin check' };
  }
  if (!tmpBracket.bracket.absent) {
    for (const tmpName of tmpBracket.bracket.names) {
      if (!TEMP_NAME_RE.test(tmpName)) continue;
      if (tmpObservations.length >= input.tmpEntryLimit) {
        return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'tmp surface twin scan exceeded its entry bound' };
      }
      const result = scanTemporaryEntry({
        path: `${tmpDir}/${tmpName}`,
        name: tmpName,
        serviceUid: input.serviceUid,
        temporaryBytes: input.temporaryBytes,
        recordBytes: input.recordBytes,
        bounds: { entryLimit: input.tmpEntryLimit, byteLimit: input.byteLimit, failClosed: true },
        state: { scannedBytes: 0 },
        publishedInodes: new Map(),
      });
      if (result.stop !== undefined) {
        return { ok: false, code: result.code ?? 'ERR-STO-LIMIT-EXCEEDED', message: result.message ?? 'tmp surface twin scan exceeded its bound' };
      }
      if (result.observation !== undefined && result.observation.kind === 'temporary-object') {
        tmpObservations.push(result.observation as TemporaryScanObservation);
      }
    }
  }
  return {
    ok: true,
    observation: classifyQuarantineEntry({
      namespaceRoot: input.namespaceRoot,
      shardName: input.shard,
      entryName: input.entry,
      serviceUid: input.serviceUid,
      temporaryBytes: input.temporaryBytes,
      storeInstance: input.storeInstance,
      tmpObservations,
    }),
  };
}

/**
 * WP-8-I current-state re-verification of ONE registry-index artifact: the
 * committed per-entry index classification is run against the CURRENT
 * object (name grammar → descriptor-bound read → parse → model version →
 * self-consistency). `index-conflicting` is determined purely from the
 * object's own bytes (identity/roots re-digest), so this is exact without
 * a store scan. A self-consistent object would classify `index-current-valid`
 * or `index-stale` against the current store (stale checks need the full
 * record/audit observations); either way it is never disposition-required,
 * reported here as `index-self-consistent`.
 */
export function currentIndexObservation(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly indexByteLimit: number;
  readonly shard: string;
  readonly entry: string;
}): {
  readonly ok: boolean;
  readonly facts?: {
    readonly observationId: string;
    readonly shard: string;
    readonly entry: string;
    readonly indexId?: string;
    readonly modelVersion?: string;
    readonly classification: 'index-conflicting' | 'index-malformed' | 'index-unsupported-version' | 'index-wrong-type' | 'index-wrong-uid-or-mode' | 'foreign-entry' | 'index-self-consistent';
    readonly code: string;
    /** Content digest of the artifact bytes (record-bytes domain); present when read. */
    readonly digest?: string;
    /** Descriptor facts when the object was opened (present when read). */
    readonly descriptor?: { readonly dev: number; readonly ino: number; readonly nlink: number; readonly size: number };
  };
  readonly code?: string;
  readonly message?: string;
} {
  if (!SHARD_RE.test(input.shard)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target index shard is not a 4-hex designation' };
  }
  const indexDir = `${input.namespaceRoot}/index`;
  const parentBracket = readdirVerified(indexDir, input.serviceUid, undefined, { surface: 'records' });
  if (!parentBracket.ok || parentBracket.bracket === undefined) {
    return { ok: false, code: parentBracket.code ?? 'ERR-STO-IO-FAILURE', message: parentBracket.message ?? 'index parent could not be verified' };
  }
  if (parentBracket.bracket.absent || !parentBracket.bracket.names.includes('registry-index')) {
    return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'registry-index family is absent' };
  }
  const familyBracket = readdirVerified(`${indexDir}/registry-index`, input.serviceUid, undefined, { surface: 'records' });
  if (!familyBracket.ok || familyBracket.bracket === undefined) {
    return { ok: false, code: familyBracket.code ?? 'ERR-STO-IO-FAILURE', message: familyBracket.message ?? 'registry-index family could not be verified' };
  }
  if (familyBracket.bracket.absent || !familyBracket.bracket.names.includes(input.shard)) {
    return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'target index shard is absent' };
  }
  const shardBracket = readdirVerified(`${indexDir}/registry-index/${input.shard}`, input.serviceUid, undefined, { surface: 'records', shard: input.shard });
  if (!shardBracket.ok || shardBracket.bracket === undefined) {
    return { ok: false, code: shardBracket.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', message: shardBracket.message ?? 'registry-index shard could not be verified' };
  }
  if (shardBracket.bracket.absent) {
    return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'registry-index shard disappeared during verification' };
  }
  if (!shardBracket.bracket.names.includes(input.entry)) {
    return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'target registry-index artifact is absent' };
  }
  const base = { observationId: indexObservationId(input.shard, input.entry), shard: input.shard, entry: input.entry };
  if (!REGISTRY_INDEX_FILENAME_RE.test(input.entry)) {
    return {
      ok: true,
      facts: { ...base, classification: input.entry.endsWith('.idx') ? 'index-malformed' : 'foreign-entry', code: 'ERR-STO-MALFORMED' },
    };
  }
  const indexId = input.entry.slice(0, 32);
  const objectRead = readRegistryIndexObject({
    path: `${indexDir}/registry-index/${input.shard}/${input.entry}`,
    serviceUid: input.serviceUid,
    byteLimit: input.indexByteLimit,
  });
  if (!objectRead.ok) {
    const classification = (objectRead.classification === 'index-wrong-type' ? 'index-wrong-type' : objectRead.classification === 'index-wrong-uid-or-mode' ? 'index-wrong-uid-or-mode' : 'index-malformed') as
      | 'index-wrong-type'
      | 'index-wrong-uid-or-mode'
      | 'index-malformed';
    return {
      ok: true,
      facts: { ...base, indexId, classification, code: objectRead.code ?? '' },
    };
  }
  const parsed = parseRegistryIndex(objectRead.raw ?? '', input.indexByteLimit, REGISTRY_INDEX_MAX_ENTRIES);
  if (!parsed.ok || parsed.model === undefined) {
    return { ok: true, facts: { ...base, indexId, classification: 'index-malformed', code: parsed.code ?? 'ERR-STO-MALFORMED' } };
  }
  if (parsed.model.modelVersion !== REGISTRY_INDEX_MODEL_VERSION) {
    return { ok: true, facts: { ...base, indexId, modelVersion: parsed.model.modelVersion, classification: 'index-unsupported-version', code: 'ERR-STO-MALFORMED' } };
  }
  const consistent = validateRegistryIndexSelfConsistency(parsed.model);
  if (!consistent.ok) {
    return {
      ok: true,
      facts: {
        ...base,
        indexId,
        classification: 'index-conflicting',
        code: 'ERR-STO-INTEGRITY',
        digest: computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, objectRead.raw ?? ''),
        descriptor: objectRead.dev !== undefined ? { dev: objectRead.dev, ino: objectRead.ino!, nlink: objectRead.nlink!, size: objectRead.size! } : undefined,
      },
    };
  }
  return { ok: true, facts: { ...base, indexId, classification: 'index-self-consistent', code: '' } };
}

/** Deterministic scan class order: the 15 `.rec` classes (taxonomy order), then the audit class. */
function scanClassOrder(): RecordClassId[] {
  const records: RecordClassId[] = [];
  for (const profile of RECORD_CLASS_PROFILES) {
    if (profile.namespace === 'store-records' && profile.suffix === '.rec' && profile.id !== 'store-metadata') records.push(profile.id);
  }
  return [...records, 'authoritative-audit-event'];
}

/** Store-namespace record classes partitioned under `records/` (LAY-005). */
function storeRecordClassProfiles(): readonly (typeof RECORD_CLASS_PROFILES)[number][] {
  // `store-metadata` is excluded: it is persisted at `metadata/metadata.json`
  // (STORE_METADATA_RELATIVE_PATH), never under `records/`.
  return RECORD_CLASS_PROFILES.filter((p) => p.namespace === 'store-records' && p.suffix === '.rec' && p.id !== 'store-metadata');
}

/** The scanner's own cursor validator (F1-S: every emitted cursor must pass it). */
function cursorShapeValid(cursor: ScanCursor): boolean {
  const profile = RECORD_CLASS_BY_ID.get(cursor.recordClass);
  return (
    typeof cursor.generation === 'string' &&
    isValidDigestSyntax(cursor.generation) &&
    typeof cursor.surfaceGeneration === 'string' &&
    isValidDigestSyntax(cursor.surfaceGeneration) &&
    profile !== undefined &&
    profile.namespace === 'store-records' &&
    SHARD_RE.test(cursor.shard) &&
    cursor.entry.length > 0 &&
    cursor.entry.length <= 128
  );
}

interface DirectoryBracket {
  readonly names: readonly string[];
  /** True only when the directory was absent on the FIRST open attempt (F4). */
  readonly absent: boolean;
  /** Descriptor identity of the opened directory (present when not absent; F3-G). */
  readonly identity: DirectoryIdentity;
}

/**
 * Descriptor-verified readdir bracket (FSP-004, SRX-013): open the directory
 * no-follow, verify type/UID/mode from the descriptor, readdir, run the
 * test-only hook, re-open and compare the identity snapshot. Any drift fails
 * closed.
 *
 * F4: a directory that was successfully opened and verified and then fails
 * to re-open (or vanishes during readdir) is identity drift and fails
 * closed with ERR-STO-ROOT-IDENTITY-CHANGED — never `absent:true`. Only a
 * first-attempt ENOENT (the directory was never successfully opened) is an
 * absent surface, which the caller may treat as legitimately absent where
 * the contract allows (phase-2 stores lack `records/`, `audit/`, `locks/`).
 */
function readdirVerified(path: string, serviceUid: number, hooks: ScanHooks | undefined, location: Parameters<NonNullable<ScanHooks['afterReaddir']>>[0]): { readonly ok: boolean; readonly bracket?: DirectoryBracket; readonly code?: string; readonly message?: string } {
  let beforeFd: number | undefined;
  let afterFd: number | undefined;
  let opened = false;
  try {
    beforeFd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const pre = fstatSync(beforeFd);
    if (!pre.isDirectory()) {
      return { ok: false, code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'expected a directory at a scan surface' };
    }
    if (pre.uid !== serviceUid || (pre.mode & 0o777) !== 0o700) {
      return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'scan surface directory violates the store permission policy' };
    }
    opened = true;
    const identity: DirectoryIdentity = { dev: Number(pre.dev), ino: Number(pre.ino) };
    let names: string[];
    try {
      names = readdirSync(path);
    } finally {
      closeSync(beforeFd);
      beforeFd = undefined;
    }
    hooks?.afterReaddir?.(location);
    afterFd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const post = fstatSync(afterFd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok) {
      return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'directory identity changed during the scan' };
    }
    return { ok: true, bracket: { names: [...names].sort(), absent: false, identity } };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (opened) {
      // F4: post-open disappearance (or readdir-time disappearance) is
      // identity drift, never absence.
      return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'scan surface directory disappeared or changed during the scan' };
    }
    if (code === 'ENOENT') return { ok: true, bracket: { names: [], absent: true, identity: { dev: 0, ino: 0 } } };
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'scan surface is not accessible' };
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'scan surface could not be enumerated' };
  } finally {
    if (beforeFd !== undefined) closeSync(beforeFd);
    if (afterFd !== undefined) closeSync(afterFd);
  }
}

/** Descriptor facts for one opened object (never a path). */
function statFacts(stat: ReturnType<typeof fstatSync>): ScannedObjectStat {
  return {
    fileType: stat.isFile() ? 'regular' : stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'special',
    uid: Number(stat.uid),
    mode: Number(stat.mode) & 0o777,
    nlink: Number(stat.nlink),
    size: Number(stat.size),
    dev: Number(stat.dev),
    ino: Number(stat.ino),
  };
}

/** Lightweight no-follow directory identity read (F3-G structural pass). */
function statDirectoryIdentity(path: string): { readonly ok: boolean; readonly identity?: DirectoryIdentity; readonly code?: string; readonly message?: string } {
  let fd: number | undefined;
  try {
    fd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const st = fstatSync(fd);
    return { ok: true, identity: { dev: Number(st.dev), ino: Number(st.ino) } };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: true };
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'class directory is not accessible' };
    // Symlinked, non-directory, or otherwise unopenable class positions fail
    // closed with the same coarse mapping as the class-dir bracket (F5
    // deferred).
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'class directory identity could not be read' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Structural snapshot pass (F3-G + F3): read the `records/` and `audit/`
 * parents (descriptor-verified; F4 within-page drift applies), derive the
 * expected record-class presence set and `audit-event` presence, read every
 * present class directory's identity, and — on the first page only
 * (`report`) — emit parent-level foreign observations and missing-class
 * findings. The returned structure feeds the class-loop membership, the
 * class-dir identity verification, and the cross-page surface digest.
 * Budget-free: the structure is bounded by the closed taxonomy.
 */
function readSurfaceStructure(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly hooks: ScanHooks | undefined;
  readonly report: boolean;
  /** Registry mode excludes quarantine structure; recovery mode binds it (WP-8-F §8). */
  readonly mode: ScanMode;
}): { readonly ok: boolean; readonly structure?: SurfaceStructure; readonly observations?: readonly ForeignScanObservation[]; readonly findings?: readonly StorageFinding[]; readonly code?: string; readonly message?: string } {
  const recordsBracket = readdirVerified(`${input.namespaceRoot}/records`, input.serviceUid, input.hooks, { surface: 'records' });
  if (!recordsBracket.ok || recordsBracket.bracket === undefined) {
    return { ok: false, code: recordsBracket.code ?? 'ERR-STO-IO-FAILURE', message: recordsBracket.message ?? 'records parent scan failed' };
  }
  const auditBracket = readdirVerified(`${input.namespaceRoot}/audit`, input.serviceUid, input.hooks, { surface: 'audit' });
  if (!auditBracket.ok || auditBracket.bracket === undefined) {
    return { ok: false, code: auditBracket.code ?? 'ERR-STO-IO-FAILURE', message: auditBracket.message ?? 'audit parent scan failed' };
  }
  const recordsNames = recordsBracket.bracket.absent ? [] : recordsBracket.bracket.names;
  const auditNames = auditBracket.bracket.absent ? [] : auditBracket.bracket.names;
  const recordsNameSet = new Set(recordsNames);
  const auditNameSet = new Set(auditNames);
  const expectedSegments = new Map<string, RecordClassId>();
  for (const profile of storeRecordClassProfiles()) expectedSegments.set(profile.segment, profile.id);

  const recordClasses: RecordClassId[] = scanClassOrder().filter((recordClass) => {
    const profile = RECORD_CLASS_BY_ID.get(recordClass);
    return profile !== undefined && profile.suffix === '.rec' && recordsNameSet.has(profile.segment);
  });
  const auditEventPresent = auditNameSet.has('audit-event');

  // WP-8-F quarantine structure (recovery mode only): the quarantine
  // parent, the temporary class directory, and every 4-hex shard identity.
  let quarantineParent: DirectoryIdentity | undefined;
  let quarantineTemporaryPresent = false;
  const quarantineShards: { readonly shard: string; readonly dev: number; readonly ino: number }[] = [];
  if (input.mode === 'recovery') {
    const quarantineBracket = readdirVerified(`${input.namespaceRoot}/quarantine`, input.serviceUid, input.hooks, { surface: 'quarantine' });
    if (!quarantineBracket.ok || quarantineBracket.bracket === undefined) {
      return { ok: false, code: quarantineBracket.code ?? 'ERR-STO-IO-FAILURE', message: quarantineBracket.message ?? 'quarantine parent scan failed' };
    }
    if (!quarantineBracket.bracket.absent) {
      quarantineParent = quarantineBracket.bracket.identity;
      const temporaryNames = quarantineBracket.bracket.names.filter((n) => n === 'temporary');
      if (temporaryNames.length === 1) {
        const temporaryBracket = readdirVerified(`${input.namespaceRoot}/quarantine/temporary`, input.serviceUid, input.hooks, { surface: 'quarantine-temporary' });
        if (!temporaryBracket.ok || temporaryBracket.bracket === undefined) {
          return { ok: false, code: temporaryBracket.code ?? 'ERR-STO-IO-FAILURE', message: temporaryBracket.message ?? 'quarantine temporary class scan failed' };
        }
        if (!temporaryBracket.bracket.absent) {
          quarantineTemporaryPresent = true;
          for (const shardName of temporaryBracket.bracket.names) {
            if (!SHARD_RE.test(shardName)) continue;
            const identity = statDirectoryIdentity(`${input.namespaceRoot}/quarantine/temporary/${shardName}`);
            if (!identity.ok) {
              return { ok: false, code: identity.code ?? 'ERR-STO-IO-FAILURE', message: identity.message ?? 'quarantine shard identity could not be read' };
            }
            if (identity.identity === undefined) {
              return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'quarantine shard disappeared during the scan' };
            }
            quarantineShards.push({ shard: shardName, dev: identity.identity.dev, ino: identity.identity.ino });
          }
        }
      }
    }
  }

  // WP-8-H registry-index structure (recovery mode only): the `index/`
  // parent, the `registry-index` family directory, and every 4-hex shard
  // identity. Registry mode excludes the index structure so that index
  // publication never invalidates the registry surface token the index
  // itself binds.
  let indexParent: DirectoryIdentity | undefined;
  let indexFamilyPresent = false;
  const indexShards: { readonly shard: string; readonly dev: number; readonly ino: number }[] = [];
  if (input.mode === 'recovery') {
    const indexBracket = readdirVerified(`${input.namespaceRoot}/index`, input.serviceUid, input.hooks, { surface: 'records' });
    if (!indexBracket.ok || indexBracket.bracket === undefined) {
      return { ok: false, code: indexBracket.code ?? 'ERR-STO-IO-FAILURE', message: indexBracket.message ?? 'index parent scan failed' };
    }
    if (!indexBracket.bracket.absent) {
      indexParent = indexBracket.bracket.identity;
      const familyNames = indexBracket.bracket.names.filter((n) => n === 'registry-index');
      if (familyNames.length === 1) {
        const familyBracket = readdirVerified(`${input.namespaceRoot}/index/registry-index`, input.serviceUid, input.hooks, { surface: 'records' });
        if (!familyBracket.ok || familyBracket.bracket === undefined) {
          return { ok: false, code: familyBracket.code ?? 'ERR-STO-IO-FAILURE', message: familyBracket.message ?? 'registry-index family scan failed' };
        }
        if (!familyBracket.bracket.absent) {
          indexFamilyPresent = true;
          for (const shardName of familyBracket.bracket.names) {
            if (!SHARD_RE.test(shardName)) continue;
            const identity = statDirectoryIdentity(`${input.namespaceRoot}/index/registry-index/${shardName}`);
            if (!identity.ok) {
              return { ok: false, code: identity.code ?? 'ERR-STO-IO-FAILURE', message: identity.message ?? 'registry-index shard identity could not be read' };
            }
            if (identity.identity === undefined) {
              return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'registry-index shard disappeared during the scan' };
            }
            indexShards.push({ shard: shardName, dev: identity.identity.dev, ino: identity.identity.ino });
          }
        }
      }
    }
  }

  const observations: ForeignScanObservation[] = [];
  const findings: StorageFinding[] = [];
  if (input.report) {
    for (const name of recordsNames) {
      if (expectedSegments.has(name)) continue;
      observations.push(foreignParentObservation(`${input.namespaceRoot}/records`, 'records', name));
    }
    for (const name of auditNames) {
      if (name === 'audit-event') continue;
      observations.push(foreignParentObservation(`${input.namespaceRoot}/audit`, 'audit', name));
    }
    for (const [segment, classId] of expectedSegments) {
      if (!recordsNameSet.has(segment)) {
        findings.push(finding('ERR-STO-INTEGRITY', `required record-class directory is absent: ${classId}`));
      }
    }
    if (!auditEventPresent) {
      findings.push(finding('ERR-STO-INTEGRITY', 'required audit class directory is absent: authoritative-audit-event'));
    }
  }

  // Identities of every present class directory (records classes and the
  // audit class). A class listed by its parent but absent at the identity
  // read is disappearance → drift (F4 rule).
  const classIdentities = new Map<RecordClassId, DirectoryIdentity>();
  for (const recordClass of [...recordClasses, ...(auditEventPresent ? (['authoritative-audit-event'] as RecordClassId[]) : [])]) {
    const profile = RECORD_CLASS_BY_ID.get(recordClass);
    if (profile === undefined) continue;
    const surface = profile.suffix === '.aud' ? 'audit' : 'records';
    const identity = statDirectoryIdentity(`${input.namespaceRoot}/${surface}/${profile.segment}`);
    if (!identity.ok) {
      return { ok: false, code: identity.code ?? 'ERR-STO-IO-FAILURE', message: identity.message ?? 'class directory identity could not be read' };
    }
    if (identity.identity === undefined) {
      return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'class directory disappeared during the scan' };
    }
    classIdentities.set(recordClass, identity.identity);
  }

  return {
    ok: true,
    structure: {
      recordsParent: recordsBracket.bracket.absent ? undefined : recordsBracket.bracket.identity,
      auditParent: auditBracket.bracket.absent ? undefined : auditBracket.bracket.identity,
      recordClasses,
      auditEventPresent,
      classIdentities,
      quarantineParent,
      quarantineTemporaryPresent,
      quarantineShards,
      indexParent,
      indexFamilyPresent,
      indexShards,
    },
    observations,
    findings,
  };
}

/** Foreign parent entry observation with best-effort descriptor facts (never opened for content). */
function foreignParentObservation(parentPath: string, surface: 'records' | 'audit', name: string): ForeignScanObservation {
  let stat: ScannedObjectStat | undefined;
  let fd: number | undefined;
  try {
    fd = openSync(`${parentPath}/${name}`, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    stat = statFacts(fstatSync(fd));
  } catch {
    stat = undefined; // symlinks, sockets, and other unopenable objects carry no stat
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return { id: observationId('foreign-object', surface, undefined, name), entry: name, kind: 'foreign-object', classification: 'foreign-entry', code: 'ERR-STO-MALFORMED', surface, ...(stat !== undefined ? { stat } : {}) };
}

/**
 * Scan one candidate record/audit entry (records/audit surfaces). Bounded
 * descriptor read with pre/post revalidation; pure fact extraction; the
 * classifier decides the category. Returns `null` when a bound stops the
 * scan (truncation or fail-closed) and `'stop'` semantics are handled by
 * the caller.
 */
function scanRecordEntry(input: {
  readonly path: string;
  readonly name: string;
  readonly component: string;
  readonly shard: string;
  readonly recordClass: RecordClassId;
  readonly serviceUid: number;
  readonly recordBytes: number;
  readonly storeInstance: VerifiedStoreInstance;
  readonly bounds: { readonly entryLimit: number; readonly byteLimit: number; readonly failClosed: boolean };
  readonly state: { readonly scannedBytes: number };
}): { readonly observation?: ScanObservation; readonly stop?: 'truncated' | 'failed'; readonly code?: string; readonly message?: string } {
  const derived = deriveRecordRelativePath(input.recordClass, `pgw:r:${input.component}`);
  const derivedOk = derived.ok && derived.filename === input.name && derived.shard === input.shard;
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const pre = fstatSync(fd);
    const fileType = pre.isFile() ? 'regular' : pre.isSymbolicLink() ? 'symlink' : pre.isDirectory() ? 'directory' : 'special';
    const stat = statFacts(pre);
    if (input.state.scannedBytes + stat.size > input.bounds.byteLimit) {
      closeSync(fd);
      fd = undefined;
      return { stop: input.bounds.failClosed ? 'failed' : 'truncated', code: 'ERR-STO-LIMIT-EXCEEDED' };
    }
    let facts: CandidateFacts;
    // Content is read and verified even when the link count is unexpected:
    // the crash-twin case (WPR-023 (a)) inherently leaves both names at
    // nlink 2, and the (a) classification requires the published record's
    // bytes to verify against the twin inode.
    if (fileType === 'regular' && stat.uid === input.serviceUid && (stat.mode & 0o777) === 0o600 && stat.size <= input.recordBytes) {
      const bytes = readFileSync(fd);
      const post = fstatSync(fd);
      const revalidated = comparePrePostStat(pre, post);
      if (!revalidated.ok || post.size !== bytes.length) {
        closeSync(fd);
        fd = undefined;
        return { observation: recordObservation(input.recordClass, input.shard, input.name, stat, { classification: 'malformed', code: 'ERR-STO-INTEGRITY', message: 'record changed during descriptor-based read' }, undefined, undefined) };
      }
      const extracted = extractEnvelopeFacts({ raw: bytes.toString('utf8'), byteLimit: input.recordBytes, component: input.component, recordClass: input.recordClass });
      facts = {
        entryName: input.name,
        recordClass: input.recordClass,
        shard: input.shard,
        derived: { ok: derivedOk, shard: derived.ok ? derived.shard : undefined, filename: derived.ok ? derived.filename : undefined },
        fileType,
        uidOk: stat.uid === input.serviceUid,
        modeOk: (stat.mode & 0o777) === 0o600,
        nlink: stat.nlink,
        size: stat.size,
        byteLimit: input.recordBytes,
        nameGrammarOk: true,
        ...extracted,
      };
      const classified = classifyCandidate(facts);
      const observation = recordObservation(input.recordClass, input.shard, input.name, stat, classified, extracted.envelope, extracted.auditAssociation);
      if (input.recordClass === 'store-evidence-record' && observation.kind === 'record' && observation.envelope !== undefined && classified.classification === 'valid-immutable-record') {
        const qFacts = extractQuarantineEvidenceFacts(bytes.toString('utf8'));
        if (qFacts.quarantineId !== undefined && qFacts.sourceDigest !== undefined && qFacts.sourceEntry !== undefined) {
          return { observation: { ...observation, quarantineEvidenceFacts: { quarantineId: qFacts.quarantineId, sourceDigest: qFacts.sourceDigest, sourceEntry: qFacts.sourceEntry } } };
        }
        // WP-8-G: audit-reconstruction evidence facts (16.3; §11).
        const rFacts = extractReconstructionEvidenceFacts(bytes.toString('utf8'));
        if (rFacts.reconstruction === true) {
          return {
            observation: {
              ...observation,
              reconstructionEvidenceFacts: rFacts.facts === undefined ? { malformed: true } : { malformed: false, ...rFacts.facts },
            },
          };
        }
        // WP-8-I: disposition evidence facts (ADR-032; §10).
        const dFacts = extractDispositionEvidenceFacts(bytes.toString('utf8'));
        if (dFacts.disposition === true) {
          return {
            observation: {
              ...observation,
              dispositionEvidenceFacts: dFacts.facts === undefined ? { malformed: true } : { malformed: false, ...dFacts.facts },
            },
          };
        }
        // WP-8-J: lock-recovery evidence facts (12.3.1/ADR-033; §14).
        const lFacts = extractLockRecoveryEvidenceFacts(bytes.toString('utf8'));
        if (lFacts.lockRecovery === true) {
          return {
            observation: {
              ...observation,
              lockRecoveryEvidenceFacts: lFacts.facts === undefined ? { malformed: true } : { malformed: false, ...lFacts.facts },
            },
          };
        }
        // WP-8-L: retention deletion evidence facts (§15.4/ADR-035; L-1).
        // The exact deterministic intent/completion identity is re-derived
        // over the payload facts + the verified store instance and must
        // equal the envelope identity.
        const rtFacts = extractRetentionEvidenceFacts(bytes.toString('utf8'), input.storeInstance);
        if (rtFacts.retention === true) {
          return {
            observation: {
              ...observation,
              retentionEvidenceFacts: rtFacts.facts === undefined ? { malformed: true } : { malformed: false, ...rtFacts.facts },
            },
          };
        }
        // WP-8-M: configuration-recovery evidence facts (§16.7/ADR-036).
        const cfFacts = extractConfigurationRecoveryEvidenceFacts(bytes.toString('utf8'));
        if (cfFacts.configuration === true) {
          return {
            observation: {
              ...observation,
              configurationRecoveryEvidenceFacts: cfFacts.facts === undefined ? { malformed: true } : { malformed: false, ...cfFacts.facts },
            },
          };
        }
      }
      return { observation };
    }
    // Non-regular, policy-violating, hard-linked, or over-limit content:
    // classification without reading (precedence inside classifyCandidate).
    facts = {
      entryName: input.name,
      recordClass: input.recordClass,
      shard: input.shard,
      derived: { ok: derivedOk, shard: derived.ok ? derived.shard : undefined, filename: derived.ok ? derived.filename : undefined },
      fileType,
      uidOk: stat.uid === input.serviceUid,
      modeOk: (stat.mode & 0o777) === 0o600,
      nlink: stat.nlink,
      size: stat.size,
      byteLimit: input.recordBytes,
      nameGrammarOk: true,
      rawParses: false,
      canonicalOk: false,
      minimumEnvelopeParses: false,
      versionStructurallyValid: false,
      versionSupported: false,
      envelopeDeferredOk: false,
      digestOk: false,
      identityComponentMatches: false,
      classLabelMatches: false,
    };
    const classified = classifyCandidate(facts);
    return { observation: recordObservation(input.recordClass, input.shard, input.name, stat, classified, undefined, undefined) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENXIO: Unix-domain socket; ELOOP: symlink; ENOTDIR: dangling entry;
    // EISDIR: directory without the directory flag. All are special/non-
    // regular locations → wrong-type (FSP-003/005).
    if (code === 'ENOENT' || code === 'ELOOP' || code === 'ENOTDIR' || code === 'ENXIO' || code === 'ENODEV' || code === 'EISDIR') {
      return { observation: recordObservation(input.recordClass, input.shard, input.name, undefined, { classification: 'wrong-type', code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'record location is not a regular file' }, undefined, undefined) };
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { observation: recordObservation(input.recordClass, input.shard, input.name, undefined, { classification: 'wrong-uid-or-mode', code: 'ERR-STO-PERM-DENIED', message: 'record is not accessible under the store permission policy' }, undefined, undefined) };
    }
    return { stop: 'failed', code: 'ERR-STO-IO-FAILURE', message: 'record could not be scanned' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function recordObservation(
  recordClass: RecordClassId,
  shard: string,
  name: string,
  stat: ScannedObjectStat | undefined,
  classified: { readonly classification: 'valid-immutable-record' | 'malformed' | 'unsupported-version' | 'digest-mismatch' | 'wrong-derived-location' | 'wrong-type' | 'wrong-uid-or-mode' | 'unexpected-hard-link' | 'foreign-entry' | 'incomplete-relationship' | 'duplicate-conflicting-identity'; readonly code: string; readonly message: string },
  envelope: RecordObservationFacts | undefined,
  auditAssociation: AuditAssociationFacts | undefined,
): RecordScanObservation | AuditScanObservation {
  const base = { id: observationId(recordClass === 'authoritative-audit-event' ? 'audit-event' : 'record', recordClass, shard, name), entry: name, code: classified.code, ...(stat !== undefined ? { stat } : {}) };
  if (recordClass === 'authoritative-audit-event') {
    return { ...base, kind: 'audit-event', recordClass, shard, classification: classified.classification, ...(envelope !== undefined ? { envelope } : {}), ...(auditAssociation !== undefined ? { auditAssociation } : {}) };
  }
  return { ...base, kind: 'record', recordClass, shard, classification: classified.classification, ...(envelope !== undefined ? { envelope } : {}) };
}

/**
 * Scan the `tmp/` surface (recovery mode; WPR-023/CSA-010/015). Temporary
 * names are classified against the closed WPR-023 categories; the scan
 * never removes, renames, or repairs anything.
 */
function scanTemporaryEntry(input: {
  readonly path: string;
  readonly name: string;
  readonly serviceUid: number;
  readonly temporaryBytes: number;
  readonly recordBytes: number;
  readonly bounds: { readonly entryLimit: number; readonly byteLimit: number; readonly failClosed: boolean };
  readonly state: { readonly scannedBytes: number };
  readonly publishedInodes: ReadonlyMap<string, boolean>;
}): { readonly observation?: ScanObservation; readonly stop?: 'truncated' | 'failed'; readonly code?: string; readonly message?: string } {
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const pre = fstatSync(fd);
    const stat = statFacts(pre);
    if (input.state.scannedBytes + stat.size > input.bounds.byteLimit) {
      closeSync(fd);
      fd = undefined;
      return { stop: input.bounds.failClosed ? 'failed' : 'truncated', code: 'ERR-STO-LIMIT-EXCEEDED' };
    }
    const inodeKey = `${stat.dev}:${stat.ino}`;
    const sharesInodeWithPublished = input.publishedInodes.has(inodeKey);
    const observationBase = { id: observationId('temporary-object', undefined, undefined, input.name), entry: input.name };
    if (stat.fileType !== 'regular' || stat.uid !== input.serviceUid || (stat.mode & 0o777) !== 0o600) {
      closeSync(fd);
      fd = undefined;
      const code = stat.fileType !== 'regular' ? 'ERR-STO-FTYPE-UNSUPPORTED' : 'ERR-STO-PERM-DENIED';
      const observation: TemporaryScanObservation = {
        ...observationBase,
        kind: 'temporary-object',
        classification: 'temporary-other',
        code,
        sharesInodeWithPublished: false,
        stat,
      };
      return { observation };
    }
    if (sharesInodeWithPublished) {
      // WP-8-F: the crash-twin observation carries the twin's envelope
      // facts (the temporary IS the published bytes). Bounded descriptor
      // read with pre/post revalidation; a read or parse failure still
      // classifies (a) from the inode relationship but attaches no
      // envelope (the recovery executor then requires disposition).
      let envelope: RecordObservationFacts | undefined;
      if (stat.size <= input.recordBytes) {
        try {
          const bytes = readFileSync(fd);
          const post = fstatSync(fd);
          const revalidated = comparePrePostStat(pre, post);
          if (revalidated.ok && post.size === bytes.length) {
            const extracted = extractEnvelopeFacts({ raw: bytes.toString('utf8'), byteLimit: input.recordBytes, component: '' });
            if (extracted.rawParses && extracted.canonicalOk && extracted.envelope !== undefined) envelope = extracted.envelope;
          }
        } catch {
          envelope = undefined;
        }
      }
      closeSync(fd);
      fd = undefined;
      const observation: TemporaryScanObservation = {
        ...observationBase,
        kind: 'temporary-object',
        classification: 'orphan-referencing-published',
        code: '',
        sharesInodeWithPublished: true,
        stat,
        ...(envelope !== undefined ? { envelope } : {}),
      };
      return { observation };
    }
    if (stat.size > input.temporaryBytes) {
      closeSync(fd);
      fd = undefined;
      const observation: TemporaryScanObservation = {
        ...observationBase,
        kind: 'temporary-object',
        classification: 'malformed-temporary',
        code: 'ERR-STO-LIMIT-EXCEEDED',
        sharesInodeWithPublished: false,
        stat,
      };
      return { observation };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok || post.size !== bytes.length) {
      closeSync(fd);
      fd = undefined;
      const observation: TemporaryScanObservation = {
        ...observationBase,
        kind: 'temporary-object',
        classification: 'temporary-other',
        code: 'ERR-STO-INTEGRITY',
        sharesInodeWithPublished: false,
        stat,
      };
      return { observation };
    }
    const raw = bytes.toString('utf8');
    // Deterministic content digest over the raw bytes (WP-8-F: the source
    // content digest is the pre-mutation evidence digest for (b)/(c)
    // quarantine sources).
    const contentDigest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, raw);
    // The temporary's record class is unknown from its name; parse without
    // the class-label check. Complete canonical records → (b) incomplete
    // unpublished; anything else → (c) malformed temporary.
    let parsed = false;
    let envelope: RecordObservationFacts | undefined;
    try {
      const extracted = extractEnvelopeFacts({ raw, byteLimit: input.recordBytes, component: '' });
      parsed = extracted.rawParses && extracted.canonicalOk && extracted.minimumEnvelopeParses && extracted.versionStructurallyValid && extracted.versionSupported && extracted.envelopeDeferredOk && extracted.digestOk && extracted.identityComponentMatches;
      envelope = extracted.envelope;
    } catch {
      parsed = false;
    }
    const observation: TemporaryScanObservation = {
      ...observationBase,
      kind: 'temporary-object',
      classification: parsed ? 'incomplete-unpublished' : 'malformed-temporary',
      code: parsed ? '' : 'ERR-STO-MALFORMED',
      contentDigest,
      sharesInodeWithPublished: false,
      stat,
      ...(envelope !== undefined ? { envelope } : {}),
      // WP-8-H: an index-publication temporary carries canonical
      // registry-index bytes; the recovery assessment reports it as an
      // incomplete index temporary (still a WPR-023 temporary).
      ...(isRegistryIndexBytes(raw) ? { indexContent: true } : {}),
    };
    return { observation };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ELOOP' || code === 'ENXIO' || code === 'ENODEV' || code === 'EISDIR') {
      const observation: TemporaryScanObservation = {
        id: observationId('temporary-object', undefined, undefined, input.name),
        entry: input.name,
        kind: 'temporary-object',
        classification: 'temporary-other',
        code: 'ERR-STO-FTYPE-UNSUPPORTED',
        sharesInodeWithPublished: false,
      };
      return { observation };
    }
    return { stop: 'failed', code: 'ERR-STO-IO-FAILURE', message: 'temporary object could not be scanned' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * WP-8-H: true when the raw bytes parse as a canonical registry-index
 * envelope (`indexKind: RegistryIndex` with a model version). Cheap pure
 * probe used to classify index-publication temporaries; never opens files.
 */
export function isRegistryIndexBytes(raw: string): boolean {
  try {
    const model = parseRawJson(raw, 1024 * 1024).model;
    if (typeof model !== 'object' || model === null || Array.isArray(model)) return false;
    const m = model as Readonly<Record<string, unknown>>;
    return m['indexKind'] === 'RegistryIndex' && typeof m['modelVersion'] === 'string' && m['modelVersion'].length > 0;
  } catch {
    return false;
  }
}

/** Scan the `locks/` surface (recovery mode; LOK-004…008; WP-8-J guard). Observation only. */
function scanLockEntry(input: {
  readonly path: string;
  readonly name: string;
  readonly serviceUid: number;
  readonly bounds: { readonly entryLimit: number; readonly byteLimit: number; readonly failClosed: boolean };
  readonly state: { readonly scannedBytes: number };
  readonly expectedStoreInstance: readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[];
}): { readonly observation?: ScanObservation; readonly stop?: 'truncated' | 'failed'; readonly code?: string; readonly message?: string } {
  const observationBase = { id: observationId('lock-object', undefined, undefined, input.name), entry: input.name };
  if (input.name === RECOVERY_BREAK_GUARD_NAME) {
    // WP-8-J (12.3.1): a recovery-break guard artifact is a foreign lock
    // object; a leftover guard requires external disposition (never
    // auto-broken). Classified observationally; grants nothing.
    return { observation: scanGuardEntry(input) };
  }
  if (input.name !== 'writer.lock') {
    const observation: ForeignScanObservation = { ...observationBase, kind: 'foreign-object', classification: 'foreign-entry', code: 'ERR-STO-MALFORMED' };
    return { observation };
  }
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const pre = fstatSync(fd);
    const stat = statFacts(pre);
    if (input.state.scannedBytes + stat.size > input.bounds.byteLimit) {
      closeSync(fd);
      fd = undefined;
      return { stop: input.bounds.failClosed ? 'failed' : 'truncated', code: 'ERR-STO-LIMIT-EXCEEDED' };
    }
    if (stat.fileType !== 'regular') {
      closeSync(fd);
      fd = undefined;
      const observation: LockScanObservation = { ...observationBase, kind: 'lock-object', classification: 'writer-lock-foreign', code: 'ERR-STO-FTYPE-UNSUPPORTED', stat };
      return { observation };
    }
    if (stat.uid !== input.serviceUid || (stat.mode & 0o777) !== 0o600) {
      closeSync(fd);
      fd = undefined;
      const observation: LockScanObservation = { ...observationBase, kind: 'lock-object', classification: 'writer-lock-foreign', code: 'ERR-STO-PERM-DENIED', stat };
      return { observation };
    }
    if (stat.size > LOCK_RECORD_MAX_BYTES) {
      closeSync(fd);
      fd = undefined;
      const observation: LockScanObservation = { ...observationBase, kind: 'lock-object', classification: 'writer-lock-malformed', code: 'ERR-STO-LIMIT-EXCEEDED', stat };
      return { observation };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok || post.size !== bytes.length) {
      closeSync(fd);
      fd = undefined;
      const observation: LockScanObservation = { ...observationBase, kind: 'lock-object', classification: 'writer-lock-malformed', code: 'ERR-STO-INTEGRITY', stat };
      return { observation };
    }
    const parsed = parseLockRecordFacts(bytes.toString('utf8'), input.expectedStoreInstance);
    closeSync(fd);
    fd = undefined;
    const observation: LockScanObservation = {
      ...observationBase,
      kind: 'lock-object',
      classification: parsed.ok ? (parsed.storeInstanceMatches ? 'writer-lock-present' : 'writer-lock-foreign') : 'writer-lock-malformed',
      code: parsed.ok ? '' : 'ERR-STO-MALFORMED',
      stat,
      ...(parsed.facts !== undefined ? { lock: parsed.facts } : {}),
      // WP-8-J: non-secret instance bindings (record digest + deterministic
      // instance identity) for the exact adjudicated lock.
      ...(parsed.ok
        ? {
            lockRecordDigest: computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, bytes.toString('utf8')),
            lockInstanceId: computeWriterLockInstanceIdentity({ storeInstance: input.expectedStoreInstance, lockRecordDigest: computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, bytes.toString('utf8')) }),
          }
        : {}),
    };
    return { observation };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      const observation: LockScanObservation = { ...observationBase, kind: 'lock-object', classification: 'writer-lock-malformed', code: 'ERR-STO-INTEGRITY' };
      return { observation };
    }
    // WP-8-J: foreign lock objects (symlink, directory, special file,
    // unreadable) are CLASSIFIED, never scan-fatal — the recovery scan must
    // keep assessing the store (matching the quarantine-surface precedent;
    // 12.3.1/ADR-033 §11).
    if (code === 'ELOOP' || code === 'ENOTDIR' || code === 'EISDIR') {
      const observation: LockScanObservation = { ...observationBase, kind: 'lock-object', classification: 'writer-lock-foreign', code: 'ERR-STO-FTYPE-UNSUPPORTED' };
      return { observation };
    }
    if (code === 'EACCES' || code === 'EPERM') {
      const observation: LockScanObservation = { ...observationBase, kind: 'lock-object', classification: 'writer-lock-foreign', code: 'ERR-STO-PERM-DENIED' };
      return { observation };
    }
    const observation: LockScanObservation = { ...observationBase, kind: 'lock-object', classification: 'writer-lock-malformed', code: 'ERR-STO-IO-FAILURE' };
    return { observation };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** WP-8-J: classify one recovery-break guard artifact observationally (12.3.1). */
function scanGuardEntry(input: {
  readonly path: string;
  readonly name: string;
  readonly serviceUid: number;
  readonly expectedStoreInstance: readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[];
}): LockScanObservation {
  const observationBase = { id: observationId('lock-object', undefined, undefined, input.name), entry: input.name };
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const pre = fstatSync(fd);
    const stat = statFacts(pre);
    if (stat.fileType !== 'regular' || stat.uid !== input.serviceUid || (stat.mode & 0o777) !== 0o600 || stat.size > LOCK_RECORD_MAX_BYTES) {
      return { ...observationBase, kind: 'lock-object', classification: 'recovery-break-guard-malformed', code: 'ERR-STO-MALFORMED', stat };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok || post.size !== bytes.length) {
      return { ...observationBase, kind: 'lock-object', classification: 'recovery-break-guard-malformed', code: 'ERR-STO-INTEGRITY', stat };
    }
    let model: unknown;
    try {
      model = parseRawJson(bytes.toString('utf8'), LOCK_RECORD_MAX_BYTES).model;
    } catch {
      return { ...observationBase, kind: 'lock-object', classification: 'recovery-break-guard-malformed', code: 'ERR-STO-MALFORMED', stat };
    }
    const obj = model as Readonly<Record<string, unknown>> | null;
    if (typeof obj !== 'object' || obj === null || obj['guardVersion'] !== LOCK_GUARD_VERSION) {
      return { ...observationBase, kind: 'lock-object', classification: 'recovery-break-guard-malformed', code: 'ERR-STO-MALFORMED', stat };
    }
    const storeInstance = obj['storeInstance'];
    const matches =
      Array.isArray(storeInstance) &&
      storeInstance.length === input.expectedStoreInstance.length &&
      (storeInstance as ReadonlyArray<Readonly<Record<string, unknown>>>).every(
        (n, i) => typeof n === 'object' && n !== null && n['kind'] === input.expectedStoreInstance[i]!.kind && n['dev'] === input.expectedStoreInstance[i]!.dev && n['ino'] === input.expectedStoreInstance[i]!.ino,
      );
    return { ...observationBase, kind: 'lock-object', classification: matches ? 'recovery-break-guard-present' : 'recovery-break-guard-malformed', code: '', stat };
  } catch {
    return { ...observationBase, kind: 'lock-object', classification: 'recovery-break-guard-malformed', code: 'ERR-STO-IO-FAILURE' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Scan the `quarantine/` surface (WP-8-F; recovery mode only). The surface
 * layout is fixed: `quarantine/temporary/<shard>/<quarantineId>.qtn`
 * (ADR-030). Foreign entries, malformed names, wrong types, wrong
 * UID/mode, unexpected link counts, and unknown shards/classes are
 * classified deterministically; every valid `.qtn` object is matched
 * against its identity-derived recovery evidence and against `tmp/`
 * objects sharing its inode (interrupted-link / conflict states).
 */
function scanQuarantineSurface(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly hooks: ScanHooks | undefined;
  readonly storeInstance: VerifiedStoreInstance;
  readonly temporaryBytes: number;
  readonly tmpObservations: readonly TemporaryScanObservation[];
}): { readonly ok: boolean; readonly observations: readonly QuarantineScanObservation[]; readonly findings: readonly StorageFinding[]; readonly code?: string; readonly message?: string } {
  const observations: QuarantineScanObservation[] = [];
  const findings: StorageFinding[] = [];
  const quarantineDir = `${input.namespaceRoot}/quarantine`;
  const quarantineBracket = readdirVerified(quarantineDir, input.serviceUid, input.hooks, { surface: 'quarantine' });
  if (!quarantineBracket.ok || quarantineBracket.bracket === undefined) {
    return { ok: false, observations, findings, code: quarantineBracket.code ?? 'ERR-STO-IO-FAILURE', message: quarantineBracket.message ?? 'quarantine parent scan failed' };
  }
  if (quarantineBracket.bracket.absent) return { ok: true, observations, findings };
  for (const name of quarantineBracket.bracket.names) {
    if (name === 'temporary') continue;
    observations.push({
      id: quarantineObservationId('', name),
      entry: name,
      kind: 'quarantine-object',
      shard: '',
      classification: 'foreign-entry',
      code: 'ERR-STO-MALFORMED',
    });
  }
  if (!quarantineBracket.bracket.names.includes('temporary')) return { ok: true, observations, findings };
  const temporaryBracket = readdirVerified(`${quarantineDir}/temporary`, input.serviceUid, input.hooks, { surface: 'quarantine-temporary' });
  if (!temporaryBracket.ok || temporaryBracket.bracket === undefined) {
    return { ok: false, observations, findings, code: temporaryBracket.code ?? 'ERR-STO-IO-FAILURE', message: temporaryBracket.message ?? 'quarantine temporary class scan failed' };
  }
  if (temporaryBracket.bracket.absent) return { ok: true, observations, findings };
  for (const shardName of temporaryBracket.bracket.names) {
    if (!SHARD_RE.test(shardName)) {
      observations.push({
        id: quarantineObservationId('', shardName),
        entry: shardName,
        kind: 'quarantine-object',
        shard: '',
        classification: 'foreign-entry',
        code: 'ERR-STO-MALFORMED',
      });
      continue;
    }
    const shardBracket = readdirVerified(`${quarantineDir}/temporary/${shardName}`, input.serviceUid, input.hooks, { surface: 'quarantine-temporary', shard: shardName });
    if (!shardBracket.ok || shardBracket.bracket === undefined) {
      return { ok: false, observations, findings, code: shardBracket.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', message: shardBracket.message ?? 'quarantine shard scan failed' };
    }
    if (shardBracket.bracket.absent) {
      return { ok: false, observations, findings, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'quarantine shard disappeared during the scan' };
    }
    for (const entryName of shardBracket.bracket.names) {
      const observation = classifyQuarantineEntry({
        namespaceRoot: input.namespaceRoot,
        shardName,
        entryName,
        serviceUid: input.serviceUid,
        temporaryBytes: input.temporaryBytes,
        storeInstance: input.storeInstance,
        tmpObservations: input.tmpObservations,
      });
      observations.push(observation);
    }
  }
  return { ok: true, observations, findings };
}

/**
 * Deterministic per-entry quarantine classification (WP-8-F; WP-8-I
 * single-entry re-verification reuses this exact committed logic): name
 * grammar → descriptor-bound read → interrupted-link twin check → link
 * count → evidence matching. The WP-8-I external-disposition boundary
 * calls this for one entry against the CURRENT state (with a freshly
 * scanned tmp surface) so the recomputed classification is byte-identical
 * to the committed scanner's.
 */
function classifyQuarantineEntry(input: {
  readonly namespaceRoot: string;
  readonly shardName: string;
  readonly entryName: string;
  readonly serviceUid: number;
  readonly temporaryBytes: number;
  readonly storeInstance: VerifiedStoreInstance;
  readonly tmpObservations: readonly TemporaryScanObservation[];
}): QuarantineScanObservation {
  const quarantineDir = `${input.namespaceRoot}/quarantine`;
  const base = { id: quarantineObservationId(input.shardName, input.entryName), entry: input.entryName, kind: 'quarantine-object' as const, shard: input.shardName };
  if (!QUARANTINE_NAME_RE.test(input.entryName)) {
    // WP-8-I (ADR-032 §4): a malformed/foreign NAME may still be externally
    // disposable when it is a policy-compliant regular file, so the
    // classification observation carries the bounded descriptor read facts
    // (digest/stat) whenever the object is readable. Classification is
    // unchanged; the facts are additive (they make the request digest
    // bindable). Non-readable objects keep the bare observation.
    const read = readQuarantineObject({
      path: `${quarantineDir}/temporary/${input.shardName}/${input.entryName}`,
      serviceUid: input.serviceUid,
      byteLimit: input.temporaryBytes,
    });
    if (read.ok && read.stat !== undefined && read.contentDigest !== undefined) {
      return {
        ...base,
        classification: input.entryName.endsWith(QUARANTINE_SUFFIX) ? 'quarantine-malformed' : 'foreign-entry',
        code: 'ERR-STO-MALFORMED',
        stat: read.stat,
        contentDigest: read.contentDigest,
      };
    }
    return {
      ...base,
      classification: input.entryName.endsWith(QUARANTINE_SUFFIX) ? 'quarantine-malformed' : 'foreign-entry',
      code: 'ERR-STO-MALFORMED',
    };
  }
  const quarantineId = input.entryName.slice(0, 64);
  const objectRead = readQuarantineObject({
    path: `${quarantineDir}/temporary/${input.shardName}/${input.entryName}`,
    serviceUid: input.serviceUid,
    byteLimit: input.temporaryBytes,
  });
  if (!objectRead.ok) {
    return { ...base, quarantineId, classification: objectRead.classification ?? 'quarantine-malformed', code: objectRead.code ?? '' };
  }
  // Interrupted-link detection: any tmp/ object sharing this inode.
  const tmpTwin = input.tmpObservations.find((t) => t.stat !== undefined && t.stat.dev === objectRead.dev && t.stat.ino === objectRead.ino);
  if (tmpTwin !== undefined) {
    return {
      ...base,
      quarantineId,
      classification: 'quarantine-interrupted-link',
      code: 'ERR-STO-INTEGRITY',
      sourceEntry: tmpTwin.entry,
      contentDigest: objectRead.contentDigest ?? '',
      envelope: objectRead.envelope,
      sharesInodeWithTemporary: true,
    };
  }
  if (objectRead.nlink !== 1) {
    return { ...base, quarantineId, classification: 'unexpected-hard-link', code: 'ERR-STO-INTEGRITY', contentDigest: objectRead.contentDigest, stat: objectRead.stat };
  }
  // Evidence matching (identity-derived; outcome `quarantined`).
  const evidenceId = computeQuarantineEvidenceIdentity({ storeInstance: input.storeInstance, quarantineId, sourceDigest: objectRead.contentDigest ?? '', outcome: 'quarantined' });
  const evidenceDerived = deriveRecordRelativePath('store-evidence-record', evidenceId);
  const evidencePath = evidenceDerived.ok ? `${input.namespaceRoot}/${evidenceDerived.relativePath}` : undefined;
  const evidence = evidencePath === undefined ? undefined : verifyObjectBytesAt({ path: evidencePath, serviceUid: input.serviceUid, byteLimit: input.temporaryBytes });
  if (evidence !== undefined && evidence.ok && evidence.canonicalUtf8 !== undefined) {
    const facts = extractQuarantineEvidenceFacts(evidence.canonicalUtf8);
    const matching = facts.quarantineId === quarantineId && facts.sourceDigest === (objectRead.contentDigest ?? '');
    if (matching) {
      return {
        ...base,
        quarantineId,
        classification: 'quarantined-valid',
        code: '',
        sourceEntry: facts.sourceEntry,
        contentDigest: objectRead.contentDigest,
        envelope: objectRead.envelope,
      };
    }
    return { ...base, quarantineId, classification: 'quarantine-conflict', code: 'ERR-STO-INTEGRITY', contentDigest: objectRead.contentDigest, stat: objectRead.stat };
  }
  return { ...base, quarantineId, classification: 'quarantined-missing-evidence', code: 'ERR-STO-INTEGRITY', contentDigest: objectRead.contentDigest, envelope: objectRead.envelope };
}

/** Descriptor-bound read of one quarantine object (regular-file policy). */
function readQuarantineObject(input: {
  readonly path: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
}): {
  readonly ok: boolean;
  readonly classification?: QuarantineObjectClassification;
  readonly code?: string;
  readonly message?: string;
  readonly dev?: number;
  readonly ino?: number;
  readonly nlink?: number;
  readonly size?: number;
  readonly stat?: ScannedObjectStat;
  readonly contentDigest?: string;
  readonly envelope?: RecordObservationFacts;
} {
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const pre = fstatSync(fd);
    const stat = statFacts(pre);
    if (stat.fileType !== 'regular') {
      return { ok: false, classification: 'wrong-type', code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'quarantine location is not a regular file' };
    }
    if (stat.uid !== input.serviceUid || (stat.mode & 0o777) !== 0o600) {
      return { ok: false, classification: 'wrong-uid-or-mode', code: 'ERR-STO-PERM-DENIED', message: 'quarantine object violates the store permission policy' };
    }
    if (pre.size > input.byteLimit) {
      return { ok: false, classification: 'quarantine-malformed', code: 'ERR-STO-LIMIT-EXCEEDED', message: 'quarantine object exceeds the bounded byte limit' };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok || post.size !== bytes.length) {
      return { ok: false, classification: 'quarantine-malformed', code: 'ERR-STO-INTEGRITY', message: 'quarantine object changed during descriptor-based read' };
    }
    const raw = bytes.toString('utf8');
    const contentDigest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, raw);
    let envelope: RecordObservationFacts | undefined;
    try {
      const extracted = extractEnvelopeFacts({ raw, byteLimit: input.byteLimit, component: '' });
      if (extracted.rawParses && extracted.canonicalOk && extracted.envelope !== undefined) envelope = extracted.envelope;
    } catch {
      envelope = undefined;
    }
    return {
      ok: true,
      dev: Number(pre.dev),
      ino: Number(pre.ino),
      nlink: Number(pre.nlink),
      size: Number(pre.size),
      stat,
      contentDigest,
      envelope,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'ENOTDIR' || code === 'ENXIO' || code === 'ENODEV' || code === 'EISDIR') {
      return { ok: false, classification: 'wrong-type', code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'quarantine location is not a regular file' };
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { ok: false, classification: 'wrong-uid-or-mode', code: 'ERR-STO-PERM-DENIED', message: 'quarantine object is not accessible' };
    }
    return { ok: false, classification: 'quarantine-malformed', code: 'ERR-STO-IO-FAILURE', message: 'quarantine object could not be scanned' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Deterministic index-object observation id (WP-8-H). */
export function indexObservationId(shard: string, entry: string): string {
  return observationId('index-object', shard, undefined, entry);
}

/**
 * Read one registry-index artifact descriptor-bound (WP-8-H; recovery
 * classification). Mirrors `readQuarantineObject`: no-follow open, exact
 * policy, bounded bytes, pre/post revalidation; returns the raw canonical
 * bytes for the pure parser. Read/stat failures map to the closed index
 * classifications (wrong-type / wrong-uid-or-mode / malformed).
 */
function readRegistryIndexObject(input: {
  readonly path: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
}): {
  readonly ok: boolean;
  readonly raw?: string;
  readonly classification?: IndexObjectClassification;
  readonly code?: string;
  readonly message?: string;
  readonly dev?: number;
  readonly ino?: number;
  readonly nlink?: number;
  readonly size?: number;
} {
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const pre = fstatSync(fd);
    const stat = statFacts(pre);
    if (stat.fileType !== 'regular') {
      return { ok: false, classification: 'index-wrong-type', code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'index location is not a regular file' };
    }
    if (stat.uid !== input.serviceUid || (stat.mode & 0o777) !== 0o600) {
      return { ok: false, classification: 'index-wrong-uid-or-mode', code: 'ERR-STO-PERM-DENIED', message: 'index object violates the store permission policy' };
    }
    if (pre.size > input.byteLimit) {
      return { ok: false, classification: 'index-malformed', code: 'ERR-STO-LIMIT-EXCEEDED', message: 'index object exceeds the bounded byte limit' };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok || post.size !== bytes.length) {
      return { ok: false, classification: 'index-malformed', code: 'ERR-STO-INTEGRITY', message: 'index object changed during descriptor-based read' };
    }
    return { ok: true, raw: bytes.toString('utf8'), dev: Number(pre.dev), ino: Number(pre.ino), nlink: Number(pre.nlink), size: Number(pre.size) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'ENOTDIR' || code === 'ENXIO' || code === 'ENODEV' || code === 'EISDIR') {
      return { ok: false, classification: 'index-wrong-type', code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'index location is not a regular file' };
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { ok: false, classification: 'index-wrong-uid-or-mode', code: 'ERR-STO-PERM-DENIED', message: 'index object is not accessible' };
    }
    return { ok: false, classification: 'index-malformed', code: 'ERR-STO-IO-FAILURE', message: 'index object could not be scanned' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Scan the `index/` surface (WP-8-H; recovery mode only): classifies every
 * registry-index artifact against the CURRENT scan's generation, surface
 * token, and deterministic roots — current-valid, stale (with a
 * deterministic stale reason), malformed, unsupported-version, conflicting,
 * wrong type/UID/mode, or foreign. The index never grants authority and
 * never blocks record recovery (RGY-007; WP-8-H §11).
 */
function scanIndexSurface(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly hooks: ScanHooks | undefined;
  readonly indexByteLimit: number;
  readonly storeInstance: VerifiedStoreInstance;
  readonly observations: readonly ScanObservation[];
}): { readonly ok: boolean; readonly observations: readonly IndexScanObservation[]; readonly findings: readonly StorageFinding[]; readonly code?: string; readonly message?: string } {
  // The registry index binds the REGISTRY-mode generation and surface token
  // (F2/F3-G), so currency is classified against the recomputed registry
  // tokens — never the recovery-mode tokens (the two modes differ by
  // design). The registry surface excludes the index structure itself.
  const observations: IndexScanObservation[] = [];
  const findings: StorageFinding[] = [];
  // The registry index binds the REGISTRY-mode generation and surface token
  // (F2/F3-G), so currency is classified against the recomputed registry
  // tokens — never the recovery-mode tokens (the two modes differ by
  // design). The registry surface excludes the index structure itself.
  const profile = input.storeInstance.limitProfile;
  const registryGeneration = computeScanGeneration({
    storeInstance: input.storeInstance,
    mode: 'registry',
    entryLimit: profile['totalScanEntries'] ?? 1024 * 1024,
    byteLimit: profile['totalScanBytes'] ?? 4 * 1024 * 1024 * 1024,
    failClosed: false,
  });
  const registrySurface = recomputeSurfaceGeneration({ namespaceRoot: input.namespaceRoot, serviceUid: input.serviceUid, mode: 'registry' });
  if (!registrySurface.ok || registrySurface.generation === undefined) {
    return { ok: false, observations, findings, code: registrySurface.code ?? 'ERR-STO-IO-FAILURE', message: registrySurface.message ?? 'registry surface could not be recomputed for the index classification' };
  }
  const indexDir = `${input.namespaceRoot}/index`;
  const indexBracket = readdirVerified(indexDir, input.serviceUid, input.hooks, { surface: 'records' });
  if (!indexBracket.ok || indexBracket.bracket === undefined) {
    return { ok: false, observations, findings, code: indexBracket.code ?? 'ERR-STO-IO-FAILURE', message: indexBracket.message ?? 'index parent scan failed' };
  }
  if (indexBracket.bracket.absent) return { ok: true, observations, findings };
  for (const name of indexBracket.bracket.names) {
    if (name === 'registry-index') continue;
    observations.push({ id: indexObservationId('', name), entry: name, kind: 'index-object', shard: '', classification: 'foreign-entry', code: 'ERR-STO-MALFORMED' });
    findings.push(finding('ERR-STO-MALFORMED', 'foreign entry in the index surface'));
  }
  if (!indexBracket.bracket.names.includes('registry-index')) return { ok: true, observations, findings };
  const familyBracket = readdirVerified(`${indexDir}/registry-index`, input.serviceUid, input.hooks, { surface: 'records' });
  if (!familyBracket.ok || familyBracket.bracket === undefined) {
    return { ok: false, observations, findings, code: familyBracket.code ?? 'ERR-STO-IO-FAILURE', message: familyBracket.message ?? 'registry-index family scan failed' };
  }
  if (familyBracket.bracket.absent) return { ok: true, observations, findings };
  for (const shardName of familyBracket.bracket.names) {
    if (!SHARD_RE.test(shardName)) {
      observations.push({ id: indexObservationId('', shardName), entry: shardName, kind: 'index-object', shard: '', classification: 'foreign-entry', code: 'ERR-STO-MALFORMED' });
      continue;
    }
    const shardBracket = readdirVerified(`${indexDir}/registry-index/${shardName}`, input.serviceUid, input.hooks, { surface: 'records', shard: shardName });
    if (!shardBracket.ok || shardBracket.bracket === undefined) {
      return { ok: false, observations, findings, code: shardBracket.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', message: shardBracket.message ?? 'registry-index shard scan failed' };
    }
    if (shardBracket.bracket.absent) {
      return { ok: false, observations, findings, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'registry-index shard disappeared during the scan' };
    }
    for (const entryName of shardBracket.bracket.names) {
      const base = { id: indexObservationId(shardName, entryName), entry: entryName, kind: 'index-object' as const, shard: shardName };
      if (!REGISTRY_INDEX_FILENAME_RE.test(entryName)) {
        observations.push({
          ...base,
          classification: entryName.endsWith('.idx') ? 'index-malformed' : 'foreign-entry',
          code: 'ERR-STO-MALFORMED',
        });
        continue;
      }
      const indexId = entryName.slice(0, 32);
      const objectRead = readRegistryIndexObject({
        path: `${indexDir}/registry-index/${shardName}/${entryName}`,
        serviceUid: input.serviceUid,
        byteLimit: input.indexByteLimit,
      });
      if (!objectRead.ok) {
        observations.push({ ...base, indexId, classification: objectRead.classification ?? 'index-malformed', code: objectRead.code ?? '' });
        continue;
      }
      const parsed = parseRegistryIndex(objectRead.raw ?? '', input.indexByteLimit, REGISTRY_INDEX_MAX_ENTRIES);
      if (!parsed.ok || parsed.model === undefined) {
        observations.push({ ...base, indexId, classification: 'index-malformed', code: parsed.code ?? 'ERR-STO-MALFORMED' });
        findings.push(finding('ERR-STO-MALFORMED', 'malformed registry-index artifact'));
        continue;
      }
      const model = parsed.model;
      if (model.modelVersion !== REGISTRY_INDEX_MODEL_VERSION) {
        observations.push({ ...base, indexId, modelVersion: model.modelVersion, classification: 'index-unsupported-version', code: 'ERR-STO-MALFORMED' });
        findings.push(finding('ERR-STO-MALFORMED', 'registry-index model version is not supported; rebuild required'));
        continue;
      }
      const consistent = validateRegistryIndexSelfConsistency(model);
      if (!consistent.ok) {
        observations.push({ ...base, indexId, modelVersion: model.modelVersion, classification: 'index-conflicting', code: 'ERR-STO-INTEGRITY' });
        findings.push(finding('ERR-STO-INTEGRITY', 'registry-index identity or roots are inconsistent; conflicting index'));
        continue;
      }
      // Currency classification against the CURRENT scan state.
      const staleReason = indexStaleReason(model, registryGeneration, registrySurface.generation, input.observations);
      if (staleReason !== undefined) {
        observations.push({
          ...base,
          indexId,
          modelVersion: model.modelVersion,
          classification: 'index-stale',
          code: 'ERR-STO-INTEGRITY',
          binding: {
            generation: model.binding.generation,
            surfaceGeneration: model.binding.surfaceGeneration,
            recordRoot: model.binding.recordRoot,
            auditRoot: model.binding.auditRoot,
          },
          staleReason,
        });
        continue;
      }
      observations.push({ ...base, indexId, modelVersion: model.modelVersion, classification: 'index-current-valid', code: '' });
    }
  }
  return { ok: true, observations, findings };
}

/** Deterministic stale reason of an index against the current scan state. */
function indexStaleReason(
  model: ParsedRegistryIndex,
  currentGeneration: string,
  currentSurfaceGeneration: string,
  observations: readonly ScanObservation[],
): string | undefined {
  if (model.binding.generation !== currentGeneration) return 'stale-generation';
  if (model.binding.surfaceGeneration !== currentSurfaceGeneration) return 'stale-surface';
  const roots = computeRegistryIndexRoots(observations, REGISTRY_INDEX_MODEL_VERSION);
  if (model.binding.recordRoot !== roots.recordRoot) return 'stale-record-set';
  if (model.binding.auditRoot !== roots.auditRoot) return 'stale-audit-state';
  if (model.binding.observationRoot !== roots.observationRoot) return 'stale-observation-set';
  return undefined;
}

/**
 * Bounded read-only store scan (RDS-004/007, CSA, LMT-006/010, DTM-003;
 * F1–F4, F1-B, F1-S, F3-G). `bounds.failClosed` selects the recovery-scan
 * limit semantics (over-limit fails closed with ERR-STO-LIMIT-EXCEEDED)
 * versus the registry scan semantics (truncation with evidence and
 * continuation). The scan mode must be consistent with `failClosed`
 * (registry → truncating, recovery → fail-closed); a mismatch is
 * ERR-STO-REQ-INVALID. Requires a genuine live read capability
 * (`enumerate-class` operation: the scan is a bounded enumeration read; the
 * operation vocabulary is closed).
 *
 * Cursor validation order (F2/F3-G): (1) cursor syntax and digest shape;
 * (2) request-generation compatibility; (3) the re-read structural snapshot
 * against the cursor-bound surface generation; (4) traversal position;
 * (5) candidate scanning. Mismatches map to ERR-STO-REQ-INVALID (steps 1–2,
 * 4) or ERR-STO-ROOT-IDENTITY-CHANGED (step 3).
 */
export function scanStoreSnapshot(input: StoreScanInput): StoreScanResult {
  const check = input.capability.verify('enumerate-class');
  if (!check.ok) {
    return failResult('ERR-STO-REQ-INVALID', 'read capability is not usable at the scan boundary');
  }
  const profile = input.capability.binding.limitProfile;
  const recordBytes = profile['recordBytes'] ?? 1024 * 1024;
  const temporaryBytes = profile['temporaryBytes'] ?? 64 * 1024 * 1024;
  const serviceUid = input.capability.binding.serviceUid;
  const bounds = input.bounds;
  // F2: the mode and the fail-closed behavior are distinct generation
  // bindings; they must be consistent.
  if ((bounds.mode === 'registry') === bounds.failClosed) {
    return failResult('ERR-STO-REQ-INVALID', 'scan mode and fail-closed behavior are inconsistent');
  }
  const namespaceIdentity = verifyNamespaceRootIdentity(input.namespaceRoot, serviceUid, 'store-records');
  if (!namespaceIdentity.ok || namespaceIdentity.identity === undefined) {
    return failResult(namespaceIdentity.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', 'namespace root could not be revalidated at the scan boundary');
  }
  const bound = input.capability.binding.storeInstance.namespaces.find((n) => n.kind === 'store-records');
  if (bound === undefined || bound.dev !== namespaceIdentity.identity.dev || bound.ino !== namespaceIdentity.identity.ino) {
    return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'namespace root identity drifted from the verified store instance');
  }
  // F2: the request-generation token is computed from the verified store
  // instance, the mode, the effective limits, and the fail-closed behavior.
  const generation = computeScanGeneration({
    storeInstance: input.capability.binding.storeInstance,
    mode: bounds.mode,
    entryLimit: bounds.entryLimit,
    byteLimit: bounds.byteLimit,
    failClosed: bounds.failClosed,
  });
  const cursor = input.continuation;
  if (cursor !== undefined) {
    // Step 1: syntax and digest shape; step 2: request-generation
    // compatibility. A cursor from any other store, bounds, mode, or model
    // version is rejected before any candidate content is scanned; never
    // silently restarted or continued.
    if (!cursorShapeValid(cursor)) {
      return failResult('ERR-STO-REQ-INVALID', 'scan continuation is malformed');
    }
    if (cursor.generation !== generation) {
      return failResult('ERR-STO-REQ-INVALID', 'scan continuation generation does not match the current scan request');
    }
  }
  const classes = scanClassOrder();
  const cursorClassIndex = cursor === undefined ? -1 : classes.indexOf(cursor.recordClass);
  if (cursor !== undefined && cursorClassIndex === -1) {
    return failResult('ERR-STO-REQ-INVALID', 'scan continuation class is not scannable');
  }

  // ── structural snapshot (F3-G): parents + present class identities ─────
  // Parent-level structure is budget-free and reported by the first page
  // only (a continuation cursor suppresses re-reporting so the paging union
  // stays complete and duplicate-free).
  const reportParent = cursor === undefined;
  const structureRead = readSurfaceStructure({ namespaceRoot: input.namespaceRoot, serviceUid, hooks: input.hooks, report: reportParent, mode: bounds.mode });
  if (!structureRead.ok || structureRead.structure === undefined) {
    return failResult(structureRead.code ?? 'ERR-STO-IO-FAILURE', structureRead.message ?? 'surface structure scan failed');
  }
  const structure = structureRead.structure;
  // Step 3: the re-read structural snapshot must match the cursor-bound
  // surface generation. Present-to-absent, absent-to-present, class-set
  // change, parent disappearance, and directory replacement are drift.
  const surfaceGeneration = computeSurfaceGeneration(structure);
  if (cursor !== undefined && cursor.surfaceGeneration !== surfaceGeneration) {
    return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'store structure changed since the continuation page');
  }

  const observations: ScanObservation[] = [];
  const findings: StorageFinding[] = [];
  let scannedEntries = 0;
  let scannedBytes = 0;
  let truncated = false;
  let lastClass: RecordClassId | undefined;
  let lastShard: string | undefined;
  let lastEntry: string | undefined;

  if (reportParent) {
    observations.push(...(structureRead.observations ?? []));
    findings.push(...(structureRead.findings ?? []));
  }

  // ── class surfaces ─────────────────────────────────────────────────────
  for (let ci = 0; ci < classes.length; ci++) {
    if (truncated) break;
    const recordClass = classes[ci]!;
    if (cursor !== undefined && ci < cursorClassIndex) continue;
    const recordProfile = RECORD_CLASS_BY_ID.get(recordClass);
    if (recordProfile === undefined) continue;
    const surface = recordProfile.suffix === '.aud' ? 'audit' : 'records';
    const present = surface === 'records' ? structure.recordClasses.includes(recordClass) : structure.auditEventPresent;
    if (!present) continue; // missing-class finding already reported by the first page
    const classDir = `${input.namespaceRoot}/${surface}/${recordProfile.segment}`;
    const classBracket = readdirVerified(classDir, serviceUid, input.hooks, { surface, recordClass });
    if (!classBracket.ok || classBracket.bracket === undefined) {
      return failResult(classBracket.code ?? 'ERR-STO-IO-FAILURE', classBracket.message ?? 'class directory scan failed');
    }
    if (classBracket.bracket.absent) {
      // Listed by the structural pass but absent at open: disappearance → drift (F4).
      return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'class directory disappeared during the scan');
    }
    // F3-G: the opened class directory must be the SAME directory the
    // structural snapshot bound; a replacement between the snapshot and the
    // open is drift.
    const expectedIdentity = structure.classIdentities.get(recordClass);
    if (expectedIdentity === undefined || classBracket.bracket.identity.dev !== expectedIdentity.dev || classBracket.bracket.identity.ino !== expectedIdentity.ino) {
      return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'class directory identity changed during the scan');
    }
    for (const shardName of classBracket.bracket.names) {
      if (truncated) break;
      // F1: cursor-seeking work is not page-result work — shards before the
      // cursor's shard do not consume the resumed page's entry budget. The
      // cursor's own shard is opened (its entries after the cursor are
      // processed) but its NAME is not re-counted: it was already counted on
      // the page that produced the cursor.
      const cursorShard = cursor !== undefined && ci === cursorClassIndex && shardName === cursor.shard;
      if (cursor !== undefined && ci === cursorClassIndex && shardName < cursor.shard) continue;
      if (!SHARD_RE.test(shardName)) {
        // F1-S: a foreign shard name is a non-resumable structural anomaly —
        // budget-free, reported at its first encounter in deterministic scan
        // order (resume skips everything at or before the cursor, so each
        // anomaly is reported exactly once), never a resumable cursor
        // position, never blocking later valid candidates.
        observations.push({ id: observationId('foreign-object', recordClass, shardName, shardName), entry: shardName, kind: 'foreign-object', recordClass, classification: 'foreign-entry', code: 'ERR-STO-MALFORMED', shard: shardName });
        continue;
      }
      if (!cursorShard) {
        scannedEntries++;
        if (scannedEntries > bounds.entryLimit) {
          truncated = true;
          if (bounds.failClosed) {
            return failResult('ERR-STO-LIMIT-EXCEEDED', 'recovery scan entry bound exceeded; recovery fails closed');
          }
          findings.push(finding('ERR-STO-LIMIT-EXCEEDED', 'scan entry bound exceeded; truncated with evidence'));
          break;
        }
      }
      const shardDir = `${classDir}/${shardName}`;
      const shardBracket = readdirVerified(shardDir, serviceUid, input.hooks, { surface, recordClass, shard: shardName });
      if (!shardBracket.ok || shardBracket.bracket === undefined) {
        return failResult(shardBracket.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', shardBracket.message ?? 'shard directory scan failed');
      }
      if (shardBracket.bracket.absent) {
        return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'shard directory disappeared during the scan');
      }
      for (const entryName of shardBracket.bracket.names) {
        if (truncated) break;
        // F1: entries at or before the cursor entry do not consume the
        // resumed page's entry budget.
        if (cursor !== undefined && ci === cursorClassIndex && shardName === cursor.shard && entryName <= cursor.entry) continue;
        scannedEntries++;
        if (scannedEntries > bounds.entryLimit) {
          truncated = true;
          if (bounds.failClosed) {
            return failResult('ERR-STO-LIMIT-EXCEEDED', 'recovery scan entry bound exceeded; recovery fails closed');
          }
          findings.push(finding('ERR-STO-LIMIT-EXCEEDED', 'scan entry bound exceeded; truncated with evidence'));
          break;
        }
        const component = entryName.slice(0, 32);
        const nameGrammarOk = COMPONENT_RE.test(component) && entryName.length === 36 && entryName.endsWith(recordProfile.suffix);
        if (!nameGrammarOk) {
          const foreign: ForeignScanObservation = { id: observationId('foreign-object', recordClass, shardName, entryName), entry: entryName, kind: 'foreign-object', recordClass, classification: 'foreign-entry', code: 'ERR-STO-MALFORMED', shard: shardName };
          observations.push(foreign);
          lastClass = recordClass;
          lastShard = shardName;
          lastEntry = entryName;
          continue;
        }
        const result = scanRecordEntry({
          path: `${shardDir}/${entryName}`,
          name: entryName,
          component,
          shard: shardName,
          recordClass,
          serviceUid,
          recordBytes,
          storeInstance: input.capability.binding.storeInstance,
          bounds,
          state: { scannedBytes },
        });
        if (result.stop !== undefined) {
          if (result.stop === 'failed') {
            return failResult(result.code ?? 'ERR-STO-LIMIT-EXCEEDED', result.message ?? 'scan bound exceeded');
          }
          truncated = true;
          if (bounds.failClosed) {
            return failResult('ERR-STO-LIMIT-EXCEEDED', 'recovery scan byte bound exceeded; recovery fails closed');
          }
          findings.push(finding('ERR-STO-LIMIT-EXCEEDED', 'scan byte bound exceeded; truncated with evidence'));
          // F1-B: never advance past the unread candidate X. The
          // continuation (emitted below) stays at the last successfully
          // processed resumable candidate, strictly before X; when nothing
          // was processed on this page, no continuation is emitted and the
          // truncated result signals that this byte profile cannot make
          // progress: the caller must restart WITHOUT the cursor with a
          // larger byte limit (the request generation binds byte limits, so
          // a raised limit invalidates the old cursor anyway). X is never
          // skipped and no result implies X was processed.
          break;
        }
        if (result.observation !== undefined) {
          observations.push(result.observation);
          scannedBytes += result.observation.stat?.size ?? 0;
          lastClass = recordClass;
          lastShard = shardName;
          lastEntry = entryName;
        }
      }
    }
  }

  // ── tmp/ and locks/ surfaces (recovery mode only) ──────────────────────
  const recoveryMode = bounds.failClosed;
  if (!truncated && recoveryMode) {
    const tmpDir = `${input.namespaceRoot}/tmp`;
    const tmpBracket = readdirVerified(tmpDir, serviceUid, input.hooks, { surface: 'tmp' });
    if (!tmpBracket.ok || tmpBracket.bracket === undefined) {
      return failResult(tmpBracket.code ?? 'ERR-STO-IO-FAILURE', tmpBracket.message ?? 'tmp directory scan failed');
    }
    if (!tmpBracket.bracket.absent) {
      // Published inode map over content-verified record/audit observations
      // (envelope present ⇒ canonical parse + payload digest verified).
      // WPR-023 (a) requires the published record's bytes to verify, so the
      // map is keyed by content verification, not by classification (the
      // crash-twin record legitimately carries an unexpected link count).
      const publishedInodes = new Map<string, boolean>();
      for (const obs of observations) {
        if ((obs.kind === 'record' || obs.kind === 'audit-event') && obs.envelope !== undefined && obs.stat !== undefined) {
          publishedInodes.set(`${obs.stat.dev}:${obs.stat.ino}`, true);
        }
      }
      for (const tmpName of tmpBracket.bracket.names) {
        if (truncated) break;
        scannedEntries++;
        if (scannedEntries > bounds.entryLimit) {
          truncated = true;
          return failResult('ERR-STO-LIMIT-EXCEEDED', 'recovery scan entry bound exceeded; recovery fails closed');
        }
        if (!TEMP_NAME_RE.test(tmpName)) {
          const foreign: ForeignScanObservation = { id: observationId('foreign-object', undefined, undefined, tmpName), entry: tmpName, kind: 'foreign-object', classification: 'foreign-entry', code: 'ERR-STO-MALFORMED' };
          observations.push(foreign);
          lastClass = undefined;
          lastShard = 'tmp';
          lastEntry = tmpName;
          continue;
        }
        const result = scanTemporaryEntry({
          path: `${tmpDir}/${tmpName}`,
          name: tmpName,
          serviceUid,
          temporaryBytes,
          recordBytes,
          bounds,
          state: { scannedBytes },
          publishedInodes,
        });
        if (result.stop !== undefined) {
          if (result.stop === 'failed') {
            return failResult(result.code ?? 'ERR-STO-LIMIT-EXCEEDED', result.message ?? 'recovery scan bound exceeded');
          }
          truncated = true;
          return failResult('ERR-STO-LIMIT-EXCEEDED', 'recovery scan byte bound exceeded; recovery fails closed');
        }
        if (result.observation !== undefined) {
          observations.push(result.observation);
          scannedBytes += result.observation.stat?.size ?? 0;
          lastClass = undefined;
          lastShard = 'tmp';
          lastEntry = tmpName;
        }
      }
    }
  }
  if (!truncated && recoveryMode) {
    const locksDir = `${input.namespaceRoot}/locks`;
    const locksBracket = readdirVerified(locksDir, serviceUid, input.hooks, { surface: 'locks' });
    if (!locksBracket.ok || locksBracket.bracket === undefined) {
      return failResult(locksBracket.code ?? 'ERR-STO-IO-FAILURE', locksBracket.message ?? 'locks directory scan failed');
    }
    if (!locksBracket.bracket.absent) {
      const expectedStoreInstance = input.capability.binding.storeInstance.namespaces
        .map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino }))
        .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
      for (const lockName of locksBracket.bracket.names) {
        if (truncated) break;
        scannedEntries++;
        if (scannedEntries > bounds.entryLimit) {
          truncated = true;
          return failResult('ERR-STO-LIMIT-EXCEEDED', 'recovery scan entry bound exceeded; recovery fails closed');
        }
        const result = scanLockEntry({
          path: `${locksDir}/${lockName}`,
          name: lockName,
          serviceUid,
          bounds,
          state: { scannedBytes },
          expectedStoreInstance,
        });
        if (result.stop !== undefined) {
          if (result.stop === 'failed') {
            return failResult(result.code ?? 'ERR-STO-LIMIT-EXCEEDED', result.message ?? 'recovery scan bound exceeded');
          }
          truncated = true;
          return failResult('ERR-STO-LIMIT-EXCEEDED', 'recovery scan byte bound exceeded; recovery fails closed');
        }
        if (result.observation !== undefined) {
          observations.push(result.observation);
          scannedBytes += result.observation.stat?.size ?? 0;
          lastClass = undefined;
          lastShard = 'locks';
          lastEntry = lockName;
        }
      }
    }
  }

  // F1-B: the continuation is emitted only from the last successfully
  // processed resumable candidate — never from an unread candidate and
  // never from a non-resumable structural anomaly. When nothing was
  // processed, `truncated` without a continuation is the detectable
  // no-progress state.
  // ── quarantine/ surface (WP-8-F; recovery mode only) ────────────────────
  // Quarantine objects are never registry records: registry mode does not
  // scan this surface at all (QRN/WP-8-F §8).
  const quarantineObservations: QuarantineScanObservation[] = [];
  if (!truncated && recoveryMode) {
    const quarantineScan = scanQuarantineSurface({
      namespaceRoot: input.namespaceRoot,
      serviceUid,
      hooks: input.hooks,
      storeInstance: input.capability.binding.storeInstance,
      temporaryBytes,
      tmpObservations: observations.filter((o): o is TemporaryScanObservation => o.kind === 'temporary-object'),
    });
    if (!quarantineScan.ok) {
      return failResult(quarantineScan.code ?? 'ERR-STO-IO-FAILURE', quarantineScan.message ?? 'quarantine surface scan failed');
    }
    quarantineObservations.push(...quarantineScan.observations);
    findings.push(...quarantineScan.findings);
  }
  observations.push(...quarantineObservations);
  // ── index/ surface (WP-8-H; recovery mode only) ─────────────────────────
  // Registry-index artifacts are derived cache: recovery classifies them
  // (current/stale/malformed/conflicting/foreign) and may recommend
  // rebuild, but never treats index loss as record loss and never derives
  // authority from an index. Registry mode does not scan this surface (the
  // fast path validates the index separately against the live store).
  const indexObservations: IndexScanObservation[] = [];
  if (!truncated && recoveryMode) {
    const indexScan = scanIndexSurface({
      namespaceRoot: input.namespaceRoot,
      serviceUid,
      hooks: input.hooks,
      indexByteLimit: bounds.indexByteLimit ?? 64 * 1024 * 1024,
      storeInstance: input.capability.binding.storeInstance,
      observations,
    });
    if (!indexScan.ok) {
      return failResult(indexScan.code ?? 'ERR-STO-IO-FAILURE', indexScan.message ?? 'registry-index surface scan failed');
    }
    indexObservations.push(...indexScan.observations);
    findings.push(...indexScan.findings);
  }
  observations.push(...indexObservations);

  const continuation: ScanCursor | undefined =
    truncated && lastClass !== undefined && lastShard !== undefined && lastEntry !== undefined && !recoveryMode
      ? { generation, surfaceGeneration, recordClass: lastClass, shard: lastShard, entry: lastEntry }
      : undefined;
  // F1-S: every emitted cursor must pass the scanner's own validator.
  if (continuation !== undefined && !cursorShapeValid(continuation)) {
    return failResult('ERR-STO-INTERNAL-INVARIANT', 'continuation failed self-validation');
  }
  findings.sort(compareFindings);
  // WP-8-M: configuration-namespace observation (recovery mode only; §16.7).
  // Advisory — never authority; a malformed/conflicting configuration object
  // never makes the unrelated store-records scan fail (the observation is
  // reported, the scan continues).
  let configurationObservation: ConfigurationNamespaceObservation | undefined;
  if (recoveryMode) {
    const configRoot = `${input.capability.binding.storeInstance.parentIdentity.canonicalPath}/config-v1`;
    const classified = classifyConfigurationMetadataSurface({
      configRoot,
      serviceUid,
      byteLimit: recordBytes,
      configurationIdentity: input.capability.binding.storeInstance.configurationIdentity,
      storeInstance: input.capability.binding.storeInstance,
    });
    if (classified.ok && classified.observation !== undefined) {
      configurationObservation = classified.observation;
    } else {
      findings.push(finding(classified.code ?? 'ERR-STO-IO-FAILURE', classified.message ?? 'configuration namespace observation failed'));
    }
  }
  return {
    ok: true,
    observations,
    findings,
    scannedEntries,
    scannedBytes,
    truncated,
    generation,
    surfaceGeneration,
    ...(configurationObservation !== undefined ? { configurationObservation } : {}),
    ...(continuation !== undefined ? { continuation } : {}),
  };
}
