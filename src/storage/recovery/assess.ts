/**
 * WP-8-E pure recovery assessment (contract §16 CSA-001…015, §12
 * LOK-004…008, §19 LMT-006/010; WP-8-E scope item 4). FILESYSTEM-FREE:
 * this module turns finalized scan observations into a bounded, structured,
 * deterministic recovery assessment. It performs NO mutation of any kind
 * (no delete, rename, unlink, repair, quarantine, lock break, audit
 * publication, or capability minting) and produces advisory data only.
 *
 * Bucket semantics (documented, deterministic):
 *   - verified durable records / verified audit evidence: content-verified
 *     records and audit events (post-finalization `valid-immutable-record`).
 *   - orphan temporary objects: WPR-023 closed categories (a)…(d).
 *   - persistent writer-lock observations: `locks/writer.lock` presence
 *     with parsed normative fields; liveness is NEVER assumed (LOK-008);
 *     the lock nonce is never carried (18.3/ERM-004).
 *   - incomplete primary/audit publication states: missing audit (durable
 *     primary, absent event; 10.5 step 9), dangling audit (event without a
 *     verified primary; CSA-005), and crash-reappearing orphan temporaries
 *     (WPR-023).
 *   - malformed or foreign objects: `malformed`, `unsupported-version`, and
 *     `foreign-entry` observations.
 *   - objects eligible for later quarantine (CSA-008/010): every
 *     non-verified record/audit/foreign observation plus every orphan
 *     temporary. Quarantine itself is out of this slice.
 *   - objects requiring human or control-plane disposition: tamper-class
 *     observations (wrong type/UID/mode, unexpected hard links, foreign
 *     entries), contested identities (RGY-004), dangling audit events
 *     (TAU-009: primaries are never reconstructed), and lock observations
 *     (staleness requires external confirmation; LOK-007/008/009).
 *   - reconstruction candidates: durable primaries with missing audit
 *     (16.3/CSA-013). Reconstruction itself is out of this slice.
 *
 * Lock-record parsing (`parseLockRecordFacts`) is pure: canonical JSON,
 * LOK-005 normative fields, and store-instance identity comparison; the
 * nonce and the action identity digest are validated for presence but never
 * carried in the observable facts.
 */
import type {
  AuditEventView,
  DispositionFinding,
  IncompletePublicationFinding,
  LockFacts,
  LockObservationFinding,
  LockScanObservation,
  ObjectFinding,
  OrphanTemporaryFinding,
  QuarantineScanObservation,
  ReconstructionCandidateFinding,
  ReconstructionStateFinding,
  RecordClassId,
  RecordScanObservation,
  RecoveryAssessment,
  ScanFacts,
  ScanObservation,
  StorageFinding,
  TemporaryScanObservation,
  VerifiedRecordView,
} from '../types.js';
import { RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND } from '../audit/write-audit.js';
import { jcsSerialize } from '../../canonical/jcs.js';
import { parseRawJson } from '../../json/scanner.js';
import { isValidDigestSyntax } from '../format/envelope.js';
import { LOCK_RECORD_MAX_BYTES, LOCK_VERSION } from '../locks/lock.js';
import { auditAssociation, finalizeSnapshotClassifications, verifiedAuditEventViews, verifiedRecordViews } from '../registry/derive.js';

const NO_STATE = { retryable: false, recoveryRequired: false, primaryStateChanged: 'no' as const, durabilityPointReached: 'no' as const, auditChanged: 'no' as const, verifyBeforeRetry: false };

function finding(code: string, message: string, phase: StorageFinding['phase'] = 'request-validation'): StorageFinding {
  return { code, message, phase, state: NO_STATE };
}

export interface LockRecordParseResult {
  readonly ok: boolean;
  /** True when the lock record identifies exactly this verified store instance. */
  readonly storeInstanceMatches: boolean;
  readonly facts?: LockFacts;
  readonly code?: string;
  readonly message?: string;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/**
 * Pure lock-record parsing and store-instance verification (LOK-004…006,
 * LOK-015). Canonical JSON with the normative fields of 12.3; the nonce is
 * validated (non-empty string) but never exposed. A record that parses but
 * names a different store instance is foreign (LOK-018).
 */
export function parseLockRecordFacts(raw: string, expectedStoreInstance: readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[]): LockRecordParseResult {
  let model: unknown;
  try {
    model = parseRawJson(raw, LOCK_RECORD_MAX_BYTES).model;
  } catch {
    return { ok: false, storeInstanceMatches: false, code: 'ERR-STO-MALFORMED', message: 'lock record is not canonical JSON' };
  }
  if (typeof model !== 'object' || model === null || Array.isArray(model)) {
    return { ok: false, storeInstanceMatches: false, code: 'ERR-STO-MALFORMED', message: 'lock record must be a JSON object' };
  }
  if (jcsSerialize(model) !== raw) {
    return { ok: false, storeInstanceMatches: false, code: 'ERR-STO-MALFORMED', message: 'lock record bytes are not canonical' };
  }
  const obj = model as Readonly<Record<string, unknown>>;
  if (obj['lockVersion'] !== LOCK_VERSION) {
    return { ok: false, storeInstanceMatches: false, code: 'ERR-STO-MALFORMED', message: 'lock record version is not supported' };
  }
  const storeInstance = obj['storeInstance'];
  if (!Array.isArray(storeInstance) || storeInstance.length !== 2 || storeInstance.some((n) => typeof n !== 'object' || n === null)) {
    return { ok: false, storeInstanceMatches: false, code: 'ERR-STO-MALFORMED', message: 'lock record store instance is malformed' };
  }
  const rawInstances = (storeInstance as ReadonlyArray<Readonly<Record<string, unknown>>>).map((n) => ({
    kind: n['kind'] as unknown,
    dev: n['dev'] as unknown,
    ino: n['ino'] as unknown,
  }));
  const instances: { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[] = [];
  for (const n of rawInstances) {
    if ((n.kind !== 'configuration' && n.kind !== 'store-records') || !isSafeInteger(n.dev) || !isSafeInteger(n.ino)) {
      return { ok: false, storeInstanceMatches: false, code: 'ERR-STO-MALFORMED', message: 'lock record store instance identity is malformed' };
    }
    instances.push({ kind: n.kind, dev: n.dev, ino: n.ino });
  }
  const expected = [...expectedStoreInstance].sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  const actual = [...instances].sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  const storeInstanceMatches =
    expected.length === actual.length && expected.every((n, i) => n.kind === actual[i]!.kind && n.dev === actual[i]!.dev && n.ino === actual[i]!.ino);
  const nonce = obj['nonce'];
  if (typeof nonce !== 'string' || nonce.length === 0) {
    return { ok: false, storeInstanceMatches, code: 'ERR-STO-MALFORMED', message: 'lock record nonce is malformed' };
  }
  const actionIdentityDigest = obj['actionIdentityDigest'];
  const actionIdentityDigestPresent = typeof actionIdentityDigest === 'string' && isValidDigestSyntax(actionIdentityDigest);
  const pid = obj['pid'];
  const processStartTime = obj['processStartTime'];
  const acquisitionTime = obj['acquisitionTime'];
  const maxAgeMs = obj['maxAgeMs'];
  if (!isSafeInteger(pid) || !isSafeInteger(processStartTime) || !isSafeInteger(acquisitionTime) || !isSafeInteger(maxAgeMs) || !actionIdentityDigestPresent) {
    return { ok: false, storeInstanceMatches, code: 'ERR-STO-MALFORMED', message: 'lock record fields are malformed' };
  }
  const bootIdentity = obj['bootIdentity'];
  return {
    ok: true,
    storeInstanceMatches,
    facts: {
      lockVersion: LOCK_VERSION,
      storeInstanceMatches,
      actionIdentityDigestPresent,
      pid,
      processStartTime,
      acquisitionTime,
      maxAgeMs,
      bootIdentityPresent: typeof bootIdentity === 'string' && bootIdentity.length > 0,
    },
  };
}

/** Tamper-class classifications requiring external disposition (SRE-004/005, FSP-003/005/006). */
const TAMPER_CLASS: readonly string[] = ['wrong-type', 'wrong-uid-or-mode', 'unexpected-hard-link', 'foreign-entry'];

/** Malformed/foreign bucket classifications. */
const MALFORMED_FOREIGN: readonly string[] = ['malformed', 'unsupported-version', 'foreign-entry'];

function objectFinding(obs: ScanObservation): ObjectFinding {
  return {
    observationId: obs.id,
    classification: obs.classification,
    code: obs.code,
    recordId: obs.kind === 'record' || obs.kind === 'audit-event' || obs.kind === 'temporary-object' ? obs.envelope?.recordId : undefined,
  };
}

/**
 * Bounded recovery assessment over one scanned snapshot (CSA-001…015;
 * observation only). Deterministic: identical snapshots yield identical
 * assessments; the result is advisory data and never executable.
 */
export function assessRecovery(observations: readonly ScanObservation[], source: ScanFacts): RecoveryAssessment {
  const finalized = finalizeSnapshotClassifications(observations);
  const obs = finalized.observations;
  const association = auditAssociation(obs);

  const verifiedDurableRecords: VerifiedRecordView[] = verifiedRecordViews(obs);
  const verifiedAuditEvidence: AuditEventView[] = verifiedAuditEventViews(obs);

  const orphanTemporaryObjects: OrphanTemporaryFinding[] = [];
  const persistentLockObservations: LockObservationFinding[] = [];
  const incompletePublicationStates: IncompletePublicationFinding[] = [];
  const malformedOrForeignObjects: ObjectFinding[] = [];
  const quarantineEligible: ObjectFinding[] = [];
  const requiresDisposition: DispositionFinding[] = [];
  const reconstructionCandidates: ReconstructionCandidateFinding[] = [];
  const reconstructionStates: ReconstructionStateFinding[] = [];
  const quarantineObjects: QuarantineScanObservation[] = [];
  const danglingQuarantineEvidence: { readonly evidenceObservationId: string; readonly quarantineId: string; readonly sourceEntry?: string }[] = [];
  const findings: StorageFinding[] = [...finalized.findings, ...association.findings];

  for (const item of obs) {
    if (item.kind === 'temporary-object') {
      const temp = item as TemporaryScanObservation;
      orphanTemporaryObjects.push({
        observationId: temp.id,
        entry: temp.entry,
        classification: temp.classification,
        recordId: temp.envelope?.recordId,
        recordDigest: temp.envelope?.recordDigest,
        contentDigest: temp.contentDigest,
        sharesInodeWithPublished: temp.sharesInodeWithPublished,
      });
      incompletePublicationStates.push({
        kind: 'orphan-temporary',
        recordId: temp.envelope?.recordId,
        observationId: temp.id,
        code: temp.code === '' ? 'ERR-STO-INTEGRITY' : temp.code,
      });
      quarantineEligible.push(objectFinding(temp));
      if (temp.classification === 'temporary-other') {
        requiresDisposition.push({ ...objectFinding(temp), reason: 'temporary object state is outside the closed WPR-023 categories; recovery-required' });
      }
      continue;
    }
    if (item.kind === 'lock-object') {
      const lock = item as LockScanObservation;
      persistentLockObservations.push({
        observationId: lock.id,
        classification: lock.classification,
        parseable: lock.lock !== undefined,
        storeInstanceMatches: lock.lock?.storeInstanceMatches,
        pid: lock.lock?.pid,
        processStartTime: lock.lock?.processStartTime,
        acquisitionTime: lock.lock?.acquisitionTime,
        maxAgeMs: lock.lock?.maxAgeMs,
        bootIdentityPresent: lock.lock?.bootIdentityPresent ?? false,
      });
      requiresDisposition.push({
        observationId: lock.id,
        classification: lock.classification,
        code: lock.code === '' ? 'ERR-STO-LOCK-UNAVAILABLE' : lock.code,
        reason:
          lock.classification === 'writer-lock-present'
            ? 'persistent writer lock; liveness is undetermined and the lock is never stale by timeout alone (LOK-007/008)'
            : 'lock object is foreign or malformed; control-plane disposition required (LOK-018)',
      });
      findings.push(finding(lock.code === '' ? 'ERR-STO-LOCK-UNAVAILABLE' : lock.code, 'writer lock state requires explicit recovery disposition'));
      continue;
    }
    if (item.kind === 'foreign-object') {
      malformedOrForeignObjects.push(objectFinding(item));
      quarantineEligible.push(objectFinding(item));
      requiresDisposition.push({ ...objectFinding(item), reason: 'foreign entry; control-plane disposition required' });
      continue;
    }
    // record / audit-event observations.
    if (item.classification === 'valid-immutable-record') continue;
    quarantineEligible.push(objectFinding(item));
    if (MALFORMED_FOREIGN.includes(item.classification)) {
      malformedOrForeignObjects.push(objectFinding(item));
    }
    if (TAMPER_CLASS.includes(item.classification)) {
      requiresDisposition.push({ ...objectFinding(item), reason: 'tamper-class observation; control-plane disposition required before any quarantine' });
    }
    if (item.classification === 'incomplete-relationship') {
      requiresDisposition.push({ ...objectFinding(item), reason: 'record chain does not resolve within the snapshot; external verification required' });
    }
  }

  for (const item of obs) {
    if (item.kind !== 'quarantine-object') continue;
    const q = item as QuarantineScanObservation;
    quarantineObjects.push(q);
    if (q.classification === 'quarantine-malformed' || q.classification === 'foreign-entry') {
      findings.push(finding('ERR-STO-MALFORMED', 'malformed or foreign quarantine object in the quarantine surface'));
      requiresDisposition.push({ observationId: q.id, classification: q.classification, code: q.code, reason: 'malformed or foreign quarantine object; control-plane disposition required' });
    }
    if (q.classification === 'quarantine-conflict' || q.classification === 'unexpected-hard-link' || q.classification === 'wrong-type' || q.classification === 'wrong-uid-or-mode') {
      findings.push(finding(q.code === '' ? 'ERR-STO-INTEGRITY' : q.code, 'quarantine object violates the quarantine policy'));
      requiresDisposition.push({ observationId: q.id, classification: q.classification, code: q.code === '' ? 'ERR-STO-INTEGRITY' : q.code, reason: 'quarantine object requires control-plane disposition' });
    }
    if (q.classification === 'quarantined-missing-evidence') {
      findings.push(finding('ERR-STO-INTEGRITY', 'quarantined temporary object is missing its recovery evidence'));
    }
    if (q.classification === 'quarantine-interrupted-link') {
      findings.push(finding('ERR-STO-INTEGRITY', 'quarantine interrupted between destination link and source unlink'));
    }
  }
  // WP-8-F: dangling quarantine evidence (evidence referencing no present
  // quarantine object) — derived purely from the scanned evidence facts.
  const qtnIds = new Set(quarantineObjects.filter((q) => q.quarantineId !== undefined).map((q) => q.quarantineId as string));
  for (const item of obs) {
    if (item.kind !== 'record' || item.recordClass !== 'store-evidence-record' || item.quarantineEvidenceFacts === undefined) continue;
    if (qtnIds.has(item.quarantineEvidenceFacts.quarantineId)) continue;
    danglingQuarantineEvidence.push({ evidenceObservationId: item.id, quarantineId: item.quarantineEvidenceFacts.quarantineId, sourceEntry: item.quarantineEvidenceFacts.sourceEntry });
    findings.push(finding('ERR-STO-INTEGRITY', 'quarantine evidence references a missing quarantine object'));
  }

  // WP-8-G: deterministic audit-reconstruction state classification (16.3;
  // §11). State precedence per target: conflicting-audit > duplicate-audit >
  // dangling-evidence > evidence-without-audit > complete > malformed-evidence
  // > audit-without-evidence. `missing-audit-eligible` targets remain in
  // `reconstructionCandidates` (they have no reconstruction-kind event and
  // no reconstruction evidence).
  const RECONSTRUCTION_STATE_PRECEDENCE: Readonly<Record<ReconstructionStateFinding['state'], number>> = {
    'conflicting-audit': 6,
    'duplicate-audit': 5,
    'dangling-evidence': 4,
    'evidence-without-audit': 3,
    complete: 2,
    'malformed-evidence': 1,
    'audit-without-evidence': 0,
  };
  const reconstructionByTarget = new Map<string, ReconstructionStateFinding>();
  const setReconstructionState = (key: string, state: ReconstructionStateFinding): void => {
    const current = reconstructionByTarget.get(key);
    if (current === undefined || RECONSTRUCTION_STATE_PRECEDENCE[state.state] > RECONSTRUCTION_STATE_PRECEDENCE[current.state]) {
      reconstructionByTarget.set(key, state);
    }
  };
  const targetOf = (recordId: string): VerifiedRecordView | undefined => verifiedDurableRecords.find((v) => v.recordId === recordId);
  // Evidence-driven states: every scanned reconstruction-evidence record.
  for (const item of obs) {
    if (item.kind !== 'record' || item.recordClass !== 'store-evidence-record' || item.reconstructionEvidenceFacts === undefined) continue;
    const r = item.reconstructionEvidenceFacts;
    const targetId = r.targetRecordId;
    const targetClass = r.targetRecordClass;
    const targetDigest = r.targetRecordDigest;
    const auditId = r.reconstructionAuditId;
    const outcome = r.outcome;
    if (r.malformed || targetId === undefined || targetClass === undefined || targetDigest === undefined || auditId === undefined || (outcome !== 'reconstructed' && outcome !== 'already-completed')) {
      setReconstructionState(targetId ?? item.envelope?.recordId ?? '', {
        recordId: targetId ?? '',
        recordClass: (targetClass as RecordClassId) ?? item.recordClass,
        recordDigest: targetDigest ?? '',
        state: 'malformed-evidence',
        auditEventIds: [],
        evidenceObservationId: item.id,
        reason: 'reconstruction evidence payload is incomplete or outside the closed outcome vocabulary',
      });
      findings.push(finding('ERR-STO-MALFORMED', 'malformed audit-reconstruction evidence record'));
      continue;
    }
    const target = targetOf(targetId);
    if (target === undefined || target.recordDigest !== targetDigest) {
      setReconstructionState(targetId, {
        recordId: targetId,
        recordClass: targetClass as RecordClassId,
        recordDigest: targetDigest,
        state: 'dangling-evidence',
        auditEventIds: [],
        evidenceObservationId: item.id,
        reason: 'reconstruction evidence references a target that is not verified present with the bound digest',
      });
      findings.push(finding('ERR-STO-INTEGRITY', 'reconstruction evidence references a missing or unverified target'));
      continue;
    }
    const recEvents = (association.auditByPrimary[targetId] ?? []).filter((e) => e.eventKind === RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND);
    if (recEvents.length === 0) {
      setReconstructionState(targetId, {
        recordId: targetId,
        recordClass: targetClass as RecordClassId,
        recordDigest: targetDigest,
        state: 'evidence-without-audit',
        auditEventIds: [],
        evidenceObservationId: item.id,
        reason: 'reconstruction evidence is durable but the reconstructed audit is missing; integrity failure (never republish from evidence alone)',
      });
      findings.push(finding('ERR-STO-INTEGRITY', 'reconstruction evidence present without its reconstructed audit'));
      continue;
    }
    if (recEvents.length > 1) {
      setReconstructionState(targetId, {
        recordId: targetId,
        recordClass: targetClass as RecordClassId,
        recordDigest: targetDigest,
        state: 'duplicate-audit',
        auditEventIds: recEvents.map((e) => e.eventId),
        evidenceObservationId: item.id,
        reason: 'multiple contesting reconstruction audits exist for the target',
      });
      continue;
    }
    setReconstructionState(targetId, {
      recordId: targetId,
      recordClass: targetClass as RecordClassId,
      recordDigest: targetDigest,
      state: 'complete',
      auditEventIds: [recEvents[0]!.eventId],
      evidenceObservationId: item.id,
      reason: 'exact reconstructed audit and matching recovery evidence are durable',
    });
  }
  // Audit-driven states: targets with reconstruction-kind audits but no
  // reconstruction evidence (the roll-forward state).
  for (const [recordId, events] of Object.entries(association.auditByPrimary)) {
    const recEvents = events.filter((e) => e.eventKind === RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND);
    if (recEvents.length === 0) continue;
    const target = targetOf(recordId);
    if (target === undefined) continue;
    if (recEvents.length > 1) {
      setReconstructionState(recordId, {
        recordId,
        recordClass: target.recordClass,
        recordDigest: target.recordDigest,
        state: 'duplicate-audit',
        auditEventIds: recEvents.map((e) => e.eventId),
        reason: 'multiple contesting reconstruction audits exist for the target',
      });
      continue;
    }
    setReconstructionState(recordId, {
      recordId,
      recordClass: target.recordClass,
      recordDigest: target.recordDigest,
      state: 'audit-without-evidence',
      auditEventIds: [recEvents[0]!.eventId],
      reason: 'exact reconstructed audit is durable but its recovery evidence is missing; the mutation rolls the evidence forward',
    });
  }
  // Conflicting reconstruction audits: reconstruction-kind events that
  // reference a wrong digest or an absent target (dangling; TAU-009).
  for (const dangling of association.danglingAudit) {
    if (dangling.eventKind !== RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND) continue;
    const key = dangling.primaryRecordId ?? dangling.eventId;
    setReconstructionState(key, {
      recordId: dangling.primaryRecordId ?? '',
      recordClass: 'approval-record',
      recordDigest: dangling.primaryDigest ?? '',
      state: 'conflicting-audit',
      auditEventIds: [dangling.eventId],
      reason: 'reconstruction-kind audit references a wrong digest or an absent target; conflicting/dangling audit',
    });
    findings.push(finding('ERR-STO-INTEGRITY', 'reconstruction-kind audit references no verified primary record'));
  }
  for (const state of reconstructionByTarget.values()) reconstructionStates.push(state);

  for (const conflict of finalized.duplicateConflicts) {
    requiresDisposition.push({
      observationId: conflict.observationIds[0] ?? '',
      classification: 'duplicate-conflicting-identity',
      code: conflict.code,
      reason: 'contested record identity; recovery must not silently resolve the conflict (RGY-004)',
    });
  }

  for (const missing of association.missingAudit) {
    incompletePublicationStates.push({ kind: 'missing-audit', recordId: missing.recordId, recordClass: missing.recordClass, observationId: missing.observationId, code: 'ERR-STO-DURABILITY' });
    reconstructionCandidates.push({
      recordId: missing.recordId,
      recordClass: missing.recordClass,
      recordDigest: missing.recordDigest,
      observationId: missing.observationId,
      reason: 'durable primary record without its write-audit event (16.3/CSA-013)',
    });
  }
  for (const dangling of association.danglingAudit) {
    incompletePublicationStates.push({ kind: 'dangling-audit', eventId: dangling.eventId, observationId: dangling.observationId, code: dangling.code });
    requiresDisposition.push({
      observationId: dangling.observationId,
      classification: 'dangling-audit',
      code: dangling.code,
      reason: 'audit event references no verified primary; primaries are never reconstructed (TAU-009)',
    });
  }

  quarantineObjects.sort((a, b) => (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0));
  danglingQuarantineEvidence.sort((a, b) => (a.quarantineId < b.quarantineId ? -1 : a.quarantineId > b.quarantineId ? 1 : 0));
  orphanTemporaryObjects.sort((a, b) => (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0));
  persistentLockObservations.sort((a, b) => (a.observationId < b.observationId ? -1 : 1));
  incompletePublicationStates.sort((a, b) => (a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : a.kind < b.kind ? -1 : 1));
  malformedOrForeignObjects.sort((a, b) => (a.observationId < b.observationId ? -1 : 1));
  quarantineEligible.sort((a, b) => (a.observationId < b.observationId ? -1 : 1));
  requiresDisposition.sort((a, b) => (a.observationId < b.observationId ? -1 : 1));
  reconstructionCandidates.sort((a, b) => (a.recordId < b.recordId ? -1 : 1));
  reconstructionStates.sort((a, b) => (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : a.state < b.state ? -1 : 1));
  findings.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.message < b.message ? -1 : a.message > b.message ? 1 : 0));

  return {
    source,
    verifiedDurableRecords,
    verifiedAuditEvidence,
    orphanTemporaryObjects,
    persistentLockObservations,
    incompletePublicationStates,
    malformedOrForeignObjects,
    quarantineEligible,
    requiresDisposition,
    reconstructionCandidates,
    quarantineObjects,
    danglingQuarantineEvidence,
    reconstructionStates,
    findings,
  };
}
