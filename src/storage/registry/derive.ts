/**
 * WP-8-E pure registry-view derivation (contract §14, RGY-001…010;
 * RDS-005/006; §24 DTM-003/004). FILESYSTEM-FREE: this module derives
 * deterministic in-memory views from verified scan observations only; it
 * never opens files, never trusts host directory order (the scan already
 * sorted deterministically), and never performs a lifecycle decision
 * (RGY-010). Views contain no raw filesystem paths, no payload bytes, and
 * no capability objects; they are reproducible from the same immutable
 * store bytes and valid only for the scanned snapshot generation
 * (RGY-005; `source` carries the `ScanFacts`).
 *
 * Snapshot finalization (deterministic upgrade of two candidate
 * classifications that need snapshot context):
 *   - `incomplete-relationship`: a content-verified record whose
 *     `previousRecordDigest` resolves to no verified same-class record
 *     digest within the snapshot (ITG-002; RFM-007). Resolution is
 *     same-class and mechanical; cross-class chain semantics are WP-2
 *     lifecycle semantics, out of this slice (recorded limitation).
 *   - `duplicate-conflicting-identity`: an identity claimed by more than
 *     one content-bearing candidate. Precedence per 18.2: the
 *     wrong-location copy keeps `wrong-derived-location`; the derived-
 *     location record is upgraded to `duplicate-conflicting-identity`
 *     (fail closed, never silently resolved; RGY-004). Conflict kind per
 *     18.2: same revision with different digest → conflict-revision
 *     (ERR-STO-CONFLICT-REVISION); otherwise → duplicate-identity
 *     (ERR-STO-DUPLICATE).
 *
 * View semantics (documented, mechanical):
 *   - `verified records` = observations with classification
 *     `valid-immutable-record` after finalization. They populate
 *     `recordsByClass` (taxonomy class order; entry order) and
 *     `recordsByIdentity` (revision order). Every view record is
 *     chain-resolved by construction (broken chains were upgraded).
 *   - Contested identities never enter the view groups: their records were
 *     upgraded out of `valid-immutable-record` (fail closed, never silently
 *     resolved; RGY-004); the contest is reported in `duplicateConflicts`
 *     and the findings.
 *   - `latestResolvableRevision` = highest-revision verified record per
 *     identity: the objective deterministic result the contract permits
 *     (RGY-002).
 *   - `incomplete-relationship` records appear only in findings: chain
 *     failures fail closed (ITG-002) and never enter a derived view.
 *
 * Audit association (AUD-002/003; CSA-005/013): a verified audit event is
 * associated with a content-verified primary record when the audit payload
 * identity/digest pair matches exactly. Missing audit (durable primary with
 * no event) and dangling audit (event with no primary) are reported as
 * findings; reconstruction itself is phase-4 work and never happens here.
 */
import type {
  AuditEventView,
  DanglingAuditFinding,
  DuplicateConflictFinding,
  MissingAuditFinding,
  RecordScanObservation,
  RegistryView,
  RetentionSurvivorFinding,
  ScanFacts,
  ScanObservation,
  StorageFinding,
  VerifiedRecordView,
} from '../types.js';
import { RECORD_CLASS_IDS } from '../types.js';

const NO_STATE = { retryable: false, recoveryRequired: false, primaryStateChanged: 'no' as const, durabilityPointReached: 'no' as const, auditChanged: 'no' as const, verifyBeforeRetry: false };

function finding(code: string, message: string, phase: StorageFinding['phase'] = 'request-validation'): StorageFinding {
  return { code, message, phase, state: NO_STATE };
}

/** Content-verified classifications (bytes verify; identity/location may still be contested). */
const CONTENT_VERIFIED: readonly string[] = ['valid-immutable-record', 'duplicate-conflicting-identity', 'incomplete-relationship'];

function isContentVerified(classification: string): boolean {
  return CONTENT_VERIFIED.includes(classification);
}

function classOrder(recordClass: string): number {
  const idx = RECORD_CLASS_IDS.indexOf(recordClass as never);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function compareFindings(a: StorageFinding, b: StorageFinding): number {
  return a.code < b.code ? -1 : a.code > b.code ? 1 : a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}

export interface FinalizedSnapshot {
  readonly observations: readonly ScanObservation[];
  readonly findings: readonly StorageFinding[];
  readonly duplicateConflicts: readonly DuplicateConflictFinding[];
}

/**
 * Upgrade candidate classifications that require snapshot context
 * (identity collisions and chain resolution). Deterministic: identical
 * observation sets yield identical upgrades and findings.
 */
export function finalizeSnapshotClassifications(observations: readonly ScanObservation[]): FinalizedSnapshot {
  const findings: StorageFinding[] = [];
  let next: readonly ScanObservation[] = observations;

  // Identity collision groups over identity-bearing record candidates (the
  // envelope was extracted even for wrong-location copies, because location
  // classification precedes content checks but the content is still read
  // within bounds for the deterministic duplicate/conflict pass).
  const byIdentity = new Map<string, RecordScanObservation[]>();
  for (const obs of next) {
    if (obs.kind !== 'record' || obs.envelope?.recordId === undefined) continue;
    const list = byIdentity.get(obs.envelope.recordId);
    if (list === undefined) byIdentity.set(obs.envelope.recordId, [obs]);
    else list.push(obs);
  }
  const duplicateConflicts: DuplicateConflictFinding[] = [];
  const contested = new Set<string>();
  for (const [identity, group] of byIdentity) {
    if (group.length < 2) continue;
    const verified = group.filter((o): o is RecordScanObservation => o.kind === 'record' && isContentVerified(o.classification));
    if (verified.length === 0) continue;
    // 18.2: same identifier with same revision but different digest →
    // conflict-revision; otherwise duplicate (same identifier, different
    // bytes or placement).
    let conflict = false;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        if (a.envelope?.revision === b.envelope?.revision && a.envelope?.recordDigest !== b.envelope?.recordDigest) conflict = true;
      }
    }
    const kind = conflict ? 'conflict-revision' : 'duplicate-identity';
    const code = conflict ? 'ERR-STO-CONFLICT-REVISION' : 'ERR-STO-DUPLICATE';
    duplicateConflicts.push({ identity, kind, code, observationIds: verified.map((o) => o.id) });
    findings.push(finding(code, kind === 'conflict-revision' ? 'conflicting revisions for one record identity' : 'duplicate record identity in the scanned snapshot'));
    for (const obs of verified) contested.add(obs.id);
  }
  if (contested.size > 0) {
    next = next.map((obs) => {
      if (obs.kind === 'record' && contested.has(obs.id) && obs.classification === 'valid-immutable-record') {
        return { ...obs, classification: 'duplicate-conflicting-identity' as const, code: 'ERR-STO-DUPLICATE' };
      }
      return obs;
    });
  }

  // Chain resolution: verified records only (contested identities are not
  // verified). previousRecordDigest must resolve within the same class.
  const verifiedDigests = new Map<string, Set<string>>();
  for (const obs of next) {
    if (obs.kind === 'record' && obs.classification === 'valid-immutable-record' && obs.envelope?.recordDigest !== undefined) {
      const perClass = verifiedDigests.get(obs.recordClass);
      if (perClass === undefined) verifiedDigests.set(obs.recordClass, new Set([obs.envelope.recordDigest]));
      else perClass.add(obs.envelope.recordDigest);
    }
  }
  const broken: string[] = [];
  for (const obs of next) {
    if (obs.kind !== 'record' || obs.classification !== 'valid-immutable-record') continue;
    const prev = obs.envelope?.previousRecordDigest;
    if (prev === undefined) continue;
    const perClass = verifiedDigests.get(obs.recordClass);
    if (perClass !== undefined && perClass.has(prev)) continue;
    broken.push(obs.id);
    findings.push(finding('ERR-STO-INTEGRITY', 'record chain reference does not resolve within the scanned snapshot'));
  }
  if (broken.length > 0) {
    const brokenIds = new Set(broken);
    next = next.map((obs) => {
      if (obs.kind === 'record' && brokenIds.has(obs.id)) {
        return { ...obs, classification: 'incomplete-relationship' as const, code: 'ERR-STO-INTEGRITY' };
      }
      return obs;
    });
  }

  return { observations: next, findings: [...findings].sort(compareFindings), duplicateConflicts: [...duplicateConflicts].sort((a, b) => (a.identity < b.identity ? -1 : 1)) };
}

/** Verified record views (valid only; chain-resolved by construction), sorted by (class order, shard, entry). */
export function verifiedRecordViews(observations: readonly ScanObservation[]): VerifiedRecordView[] {
  const views: VerifiedRecordView[] = [];
  for (const obs of observations) {
    if (obs.kind !== 'record' || obs.classification !== 'valid-immutable-record' || obs.envelope?.recordId === undefined) continue;
    views.push({
      observationId: obs.id,
      shard: obs.shard,
      entry: obs.entry,
      recordId: obs.envelope.recordId,
      recordClass: obs.recordClass,
      revision: obs.envelope.revision ?? 0,
      createdAt: obs.envelope.createdAt ?? '',
      payloadDigest: obs.envelope.payloadDigest ?? '',
      recordDigest: obs.envelope.recordDigest ?? '',
      ...(obs.envelope.previousRecordDigest !== undefined ? { previousRecordDigest: obs.envelope.previousRecordDigest } : {}),
    });
  }
  // Deterministic order: class taxonomy order, then (shard, entry) — host
  // directory order is never trusted (DTM-003).
  views.sort((a, b) => classOrder(a.recordClass) - classOrder(b.recordClass) || (a.shard < b.shard ? -1 : a.shard > b.shard ? 1 : a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0));
  return views;
}

/** Verified audit-event views sorted by (createdAt, event id). */
export function verifiedAuditEventViews(observations: readonly ScanObservation[]): AuditEventView[] {
  const views: AuditEventView[] = [];
  for (const obs of observations) {
    if (obs.kind !== 'audit-event' || obs.classification !== 'valid-immutable-record' || obs.envelope === undefined) continue;
    const assoc = obs.auditAssociation;
    views.push({
      observationId: obs.id,
      eventId: obs.envelope.recordId ?? '',
      eventKind: assoc?.eventKind ?? '',
      createdAt: obs.envelope.createdAt ?? '',
      recordDigest: obs.envelope.recordDigest ?? '',
      primaryRecordId: assoc?.primaryRecordId,
      primaryDigest: assoc?.primaryDigest,
      associated: false,
    });
  }
  views.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));
  return views;
}

/** Content-verified primary (recordId, recordDigest) pairs. */
function contentVerifiedPrimaries(observations: readonly ScanObservation[]): ReadonlyMap<string, ReadonlySet<string>> {
  const byId = new Map<string, Set<string>>();
  for (const obs of observations) {
    if (obs.kind !== 'record' || !isContentVerified(obs.classification) || obs.envelope?.recordId === undefined || obs.envelope.recordDigest === undefined) continue;
    const digests = byId.get(obs.envelope.recordId);
    if (digests === undefined) byId.set(obs.envelope.recordId, new Set([obs.envelope.recordDigest]));
    else digests.add(obs.envelope.recordDigest);
  }
  return byId;
}

export interface AuditAssociationResult {
  readonly auditByPrimary: Readonly<Record<string, readonly AuditEventView[]>>;
  readonly missingAudit: readonly MissingAuditFinding[];
  readonly danglingAudit: readonly DanglingAuditFinding[];
  /** WP-8-L: dangling audits explained by a durable retention-delete-record completion evidence (§15.4). */
  readonly retentionSurvivors: readonly RetentionSurvivorFinding[];
  readonly findings: readonly StorageFinding[];
}

/**
 * WP-8-L retention-survivor lookup (§15.4/ADR-035): a dangling audit event
 * whose referenced primary has a durable retention deletion completion
 * evidence (exact class/identity/digest, completed outcome) is an
 * intentionally retained historical event — never a corruption signal, a
 * disposition candidate, or a conflicting-reconstruction state. Derived
 * purely from verified observations.
 */
function retentionCompletionEvidence(
  observations: readonly ScanObservation[],
): ReadonlyMap<string, { readonly evidenceId: string; readonly primaryRecordId: string; readonly primaryRecordDigest: string }> {
  const byKey = new Map<string, { readonly evidenceId: string; readonly primaryRecordId: string; readonly primaryRecordDigest: string }>();
  for (const obs of observations) {
    if (obs.kind !== 'record' || obs.recordClass !== 'store-evidence-record' || obs.retentionEvidenceFacts === undefined) continue;
    const d = obs.retentionEvidenceFacts;
    // Only COMPLETION evidence explains an intentional retention survivor
    // (L-1): durable intents carry no outcome and never explain absence.
    if (d.malformed || d.kind !== 'completion' || d.retentionOperation !== 'retention-delete-record') continue;
    if (d.targetRecordId === undefined || d.targetRecordDigest === undefined) continue;
    if (d.outcome !== 'deleted' && d.outcome !== 'already-completed') continue;
    const key = `${d.targetRecordId}\u0000${d.targetRecordDigest}`;
    const existing = byKey.get(key);
    if (existing !== undefined && existing.evidenceId !== obs.envelope?.recordId) {
      // Conflicting completions for one primary: not a clean survivor
      // explanation; the audit stays classified as dangling.
      byKey.delete(key);
      continue;
    }
    byKey.set(key, { evidenceId: obs.envelope?.recordId ?? '', primaryRecordId: d.targetRecordId, primaryRecordDigest: d.targetRecordDigest });
  }
  return byKey;
}

/**
 * Mechanical audit association over one snapshot (AUD-002/003; CSA-005).
 * A verified audit event is associated when its payload identity and digest
 * match a content-verified primary record exactly. Events with malformed
 * association payloads, or whose primary is absent, are dangling findings;
 * content-verified primaries without any event are missing-audit findings.
 */
export function auditAssociation(observations: readonly ScanObservation[]): AuditAssociationResult {
  const findings: StorageFinding[] = [];
  const byPrimary = new Map<string, AuditEventView[]>();
  const matchedEventIds = new Set<string>();
  const primaries = contentVerifiedPrimaries(observations);
  const events = verifiedAuditEventViews(observations);
  const survivors = retentionCompletionEvidence(observations);
  const survivorFindings: RetentionSurvivorFinding[] = [];
  for (const event of events) {
    if (event.primaryRecordId === undefined || event.primaryDigest === undefined) {
      findings.push(finding('ERR-STO-MALFORMED', 'audit event association payload is malformed'));
      continue;
    }
    const digests = primaries.get(event.primaryRecordId);
    const matched = digests !== undefined && digests.has(event.primaryDigest);
    if (!matched) {
      // WP-8-L: a durable retention-delete-record completion evidence for
      // the exact referenced primary explains the orphaned audit as an
      // intentional retention survivor (never corruption, never a
      // disposition candidate).
      const explanation = survivors.get(`${event.primaryRecordId}\u0000${event.primaryDigest}`);
      if (explanation !== undefined) {
        survivorFindings.push({
          eventId: event.eventId,
          primaryRecordId: event.primaryRecordId,
          primaryRecordDigest: event.primaryDigest,
          completionEvidenceId: explanation.evidenceId,
          reason: 'audit event intentionally retained after the referenced primary was deleted under retention (durable deletion completion evidence)',
        });
        continue;
      }
      findings.push(finding('ERR-STO-INTEGRITY', 'audit event references no verified primary record'));
      continue;
    }
    matchedEventIds.add(event.eventId);
    const list = byPrimary.get(event.primaryRecordId);
    const associated: AuditEventView = { ...event, associated: true };
    if (list === undefined) byPrimary.set(event.primaryRecordId, [associated]);
    else list.push(associated);
  }
  const auditByPrimary: Record<string, readonly AuditEventView[]> = {};
  for (const [recordId, list] of [...byPrimary.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    auditByPrimary[recordId] = [...list].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.eventId < b.eventId ? -1 : 1));
  }
  // Missing audit: every content-verified primary record (all .rec classes
  // require their write audit; WPR-010/AUD-003).
  const missing: MissingAuditFinding[] = [];
  for (const obs of observations) {
    if (obs.kind !== 'record' || !isContentVerified(obs.classification) || obs.envelope?.recordId === undefined || obs.envelope.recordDigest === undefined) continue;
    const recordDigest = obs.envelope.recordDigest;
    const associated = byPrimary.get(obs.envelope.recordId)?.some((e) => e.primaryDigest === recordDigest) ?? false;
    if (!associated) {
      missing.push({ observationId: obs.id, recordId: obs.envelope.recordId, recordClass: obs.recordClass, recordDigest });
      findings.push(finding('ERR-STO-DURABILITY', 'primary record has no associated audit event', 'post-audit-publication'));
    }
  }
  missing.sort((a, b) => classOrder(a.recordClass) - classOrder(b.recordClass) || (a.recordId < b.recordId ? -1 : 1));
  const dangling: DanglingAuditFinding[] = [];
  for (const event of events) {
    if (matchedEventIds.has(event.eventId)) continue;
    if (survivorFindings.some((s) => s.eventId === event.eventId)) continue;
    dangling.push({
      observationId: event.observationId,
      eventId: event.eventId,
      eventKind: event.eventKind,
      primaryRecordId: event.primaryRecordId,
      primaryDigest: event.primaryDigest,
      code: event.primaryRecordId === undefined || event.primaryDigest === undefined ? 'ERR-STO-MALFORMED' : 'ERR-STO-INTEGRITY',
    });
  }
  dangling.sort((a, b) => (a.eventId < b.eventId ? -1 : 1));
  survivorFindings.sort((a, b) => (a.eventId < b.eventId ? -1 : 1));
  return { auditByPrimary, missingAudit: missing, danglingAudit: dangling, retentionSurvivors: survivorFindings, findings: [...findings].sort(compareFindings) };
}

/**
 * Derive the deterministic registry view over one finalized snapshot
 * (RGY-001…010, RDS-005). Groups, orderings, and findings are computed
 * mechanically; the view grants no authority and performs no lifecycle
 * decision. Reproducible from identical observations; valid only for the
 * carried `ScanFacts` generation.
 */
export function deriveRegistryViewFromScan(observations: readonly ScanObservation[], source: ScanFacts): RegistryView {
  const finalized = finalizeSnapshotClassifications(observations);
  const obs = finalized.observations;
  const association = auditAssociation(obs);
  const views = verifiedRecordViews(obs);

  const recordsByClass: Record<string, readonly VerifiedRecordView[]> = {};
  for (const recordClass of RECORD_CLASS_IDS) {
    const group = views.filter((v) => v.recordClass === recordClass);
    if (group.length > 0) recordsByClass[recordClass] = group;
  }

  const byIdentity = new Map<string, VerifiedRecordView[]>();
  for (const view of views) {
    const list = byIdentity.get(view.recordId);
    if (list === undefined) byIdentity.set(view.recordId, [view]);
    else list.push(view);
  }
  const recordsByIdentity: Record<string, readonly VerifiedRecordView[]> = {};
  const latestResolvableRevision: Record<string, VerifiedRecordView> = {};
  for (const [identity, group] of [...byIdentity.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const sorted = [...group].sort((a, b) => a.revision - b.revision || (a.recordDigest < b.recordDigest ? -1 : a.recordDigest > b.recordDigest ? 1 : 0));
    recordsByIdentity[identity] = sorted;
    // Contested identities never reach this point (their records were
    // upgraded out of `valid-immutable-record`); every view record is
    // chain-resolved by construction. The latest revision per identity is
    // the objective deterministic result (RGY-002).
    const latest = sorted[sorted.length - 1];
    if (latest !== undefined) latestResolvableRevision[identity] = latest;
  }

  return {
    source,
    recordsByClass,
    recordsByIdentity,
    latestResolvableRevision,
    duplicateConflicts: finalized.duplicateConflicts,
    auditByPrimary: association.auditByPrimary,
    missingAudit: association.missingAudit,
    danglingAudit: association.danglingAudit,
    findings: [...finalized.findings, ...association.findings].sort(compareFindings),
  };
}

/** Content-verified record observations after finalization (contested included). */
export function contentVerifiedRecords(observations: readonly ScanObservation[]): RecordScanObservation[] {
  return observations.filter((o): o is RecordScanObservation => o.kind === 'record' && isContentVerified(o.classification));
}
