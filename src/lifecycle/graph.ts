/**
 * Trusted lifecycle graph validation (phase 11): pure evaluation over
 * caller-supplied records. Produces findings for LFC/EXE/PUB/MIG rules and the
 * registry-context rules (REG-001/002/008, LFC-010). No persistence, no record
 * creation, no authority.
 */
import { mk, type Finding } from '../internal/report.js';
import type { AcceptedRegistryContext } from '../api/types.js';
import { bundleReferencesEqual } from '../internal/protocol-equality.js';

export interface LifecycleGraphInput {
  /** All records available to the graph (entry records plus caller state). */
  readonly records: readonly Readonly<Record<string, unknown>>[];
  /** Record IDs that belong to the evaluated entry (findings filtered to these). */
  readonly entryRecordIds: ReadonlySet<string>;
  /** Accepted registry context (caller-supplied trusted configuration). */
  readonly registry: AcceptedRegistryContext;
  /** Valid artifacts by revision ID for subject resolution. */
  readonly artifactsByRevision: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  /** Artifacts by instance ID. */
  readonly artifactsByInstance: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  /** Valid result artifacts by instance ID (for result-instance checks). */
  readonly resultsByAttempt: ReadonlyMap<string, readonly Readonly<Record<string, unknown>>[]>;
  /** Artifact instance IDs owned by the evaluated entry (result-conflict findings filtered to these). */
  readonly entryArtifactInstances: ReadonlySet<string>;
  /** Attempts eligible for ordinal/allowance checks (valid corpus attempts plus entry attempts). */
  readonly attemptsContext?: readonly Readonly<Record<string, unknown>>[];
}

interface RecordIndex {
  byId: Map<string, Readonly<Record<string, unknown>>>;
  byType: Map<string, Readonly<Record<string, unknown>>[]>;
  byReservation: Map<string, Readonly<Record<string, unknown>>[]>;
}

function idx(input: LifecycleGraphInput): RecordIndex {
  const byId = new Map<string, Readonly<Record<string, unknown>>>();
  const byType = new Map<string, Readonly<Record<string, unknown>>[]>();
  const byReservation = new Map<string, Readonly<Record<string, unknown>>[]>();
  for (const r of input.records) {
    const id = String(r['record_id'] ?? '');
    if (id) byId.set(id, r);
    const type = String(r['record_type'] ?? '');
    const list = byType.get(type) ?? [];
    list.push(r);
    byType.set(type, list);
    if (type === 'ActivationRecord') {
      const res = String((r as Record<string, unknown>)['reserved_occurrence_id'] ?? '');
      const rl = byReservation.get(res) ?? [];
      rl.push(r);
      byReservation.set(res, rl);
    }
  }
  return { byId, byType, byReservation };
}

function str(r: Readonly<Record<string, unknown>>, key: string): string {
  const v = r[key];
  return typeof v === 'string' ? v : '';
}

function subjectOf(r: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined {
  const s = r['subject'];
  return s && typeof s === 'object' && !Array.isArray(s) ? (s as Record<string, unknown>) : undefined;
}

function kindIdOf(subject: Readonly<Record<string, unknown>>): string {
  const k = subject['kind'];
  return k && typeof k === 'object' ? String((k as Record<string, unknown>)['id'] ?? '') : '';
}
function sameSubject(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
  return (
    str(a, 'instance_id') === str(b, 'instance_id') &&
    str(a, 'revision_id') === str(b, 'revision_id') &&
    str(a, 'digest') === str(b, 'digest') &&
    kindIdOf(a) === kindIdOf(b)
  );
}

function at(phase: string, category: string, ruleIds: string[], key: string, msg: string, subjectId: string, location = ''): Finding {
  return mk(phase as never, category as never, key, msg, {
    ruleIds,
    subjectIdentity: subjectId,
    location,
  });
}

/**
 * Evaluate the trusted lifecycle graph. Findings are emitted only for records in
 * `entryRecordIds`; graph-wide conditions are still computed over all records.
 */
export function evaluateLifecycleGraph(input: LifecycleGraphInput): Finding[] {
  const findings: Finding[] = [];
  const index = idx(input);
  const isEntry = (r: Readonly<Record<string, unknown>>): boolean => input.entryRecordIds.has(str(r, 'record_id'));
  const emitFor = (r: Readonly<Record<string, unknown>>, ruleIds: string[], key: string, msg: string, category: string, location = ''): void => {
    if (!isEntry(r)) return;
    findings.push(at('trusted-lifecycle-verification', category, ruleIds, key, msg, str(r, 'record_id'), location));
  };

  // ---- approvals
  for (const r of index.byType.get('ApprovalRecord') ?? []) {
    const subject = subjectOf(r);
    const target = subject ? input.artifactsByRevision.get(str(subject, 'revision_id')) : undefined;
    const workspaceId = str(r, 'workspace_id');
    if (target) {
      const targetSubject = {
        instance_id: str(target, 'instance_id'),
        revision_id: str((target['revision'] as Record<string, unknown>) ?? {}, 'id'),
        digest: str((target['revision'] as Record<string, unknown>) ?? {}, 'digest'),
        kind: { id: str((target['kind'] as Record<string, unknown>) ?? {}, 'id') },
      };
      if (subject && !sameSubject(subject, targetSubject)) {
        emitFor(r, ['LFC-002'], 'lifecycle.approval-subject', 'approval subject does not resolve to the exact artifact', 'LIFECYCLE-FAILURE', '/subject');
      }
      const subjectWorkspace = subject ? str(subject, 'workspace_id') : '';
      if (subjectWorkspace && workspaceId && subjectWorkspace !== workspaceId) {
        emitFor(r, ['LFC-002'], 'lifecycle.approval-workspace', 'approval workspace does not match the approved subject workspace', 'LIFECYCLE-FAILURE', '/workspace_id');
      }
    }
    const validationIds = r['validation_record_ids'];
    const validations = Array.isArray(validationIds) ? (validationIds as string[]) : [];
    let validCount = 0;
    for (const vid of validations) {
      const v = index.byId.get(vid);
      if (v && str(v, 'record_type') === 'ValidationRecord') {
        const vs = subjectOf(v);
        if (vs && subject && sameSubject(vs, subject)) validCount++;
      }
    }
    if (validCount === 0) {
      emitFor(r, ['LFC-001', 'LFC-002'], 'lifecycle.approval-without-validation', 'approval references no valid validation record for its subject', 'LIFECYCLE-FAILURE', '/validation_record_ids');
    }
  }

  // ---- issuances
  for (const r of index.byType.get('IssuanceRecord') ?? []) {
    const approvalId = str(r, 'approval_record_id');
    const approval = index.byId.get(approvalId);
    const subject = subjectOf(r);
    if (!approval || str(approval, 'record_type') !== 'ApprovalRecord') {
      emitFor(r, ['LFC-003'], 'lifecycle.issuance-without-approval', 'issuance references no matching approval record', 'LIFECYCLE-FAILURE', '/approval_record_id');
    } else {
      const as = subjectOf(approval);
      if (as && subject && !sameSubject(as, subject)) {
        emitFor(r, ['LFC-003', 'MIG-003', 'MIG-004', 'LIN-008'], 'lifecycle.issuance-approval-subject', 'issuance reuses an approval for a different subject (lifecycle transfer)', 'LIFECYCLE-FAILURE', '/approval_record_id');
      }
      if (str(approval, 'workspace_id') && str(r, 'workspace_id') && str(approval, 'workspace_id') !== str(r, 'workspace_id')) {
        emitFor(r, ['LFC-003'], 'lifecycle.issuance-workspace', 'issuance workspace does not match its approval workspace', 'LIFECYCLE-FAILURE', '/workspace_id');
      }
    }
  }

  // ---- grants
  for (const r of index.byType.get('RuntimeGrant') ?? []) {
    const reservation = str(r, 'reserved_occurrence_id');
    const activations = index.byReservation.get(reservation) ?? [];
    const denied = activations.some((a) => str(a, 'decision') === 'denied');
    const constraints = r['narrowed_constraints'];
    const emptyConstraints = Array.isArray(constraints) && (constraints as unknown[]).length === 0;
    if (denied || emptyConstraints) {
      emitFor(r, ['LFC-008'], 'lifecycle.grant-invalid', 'runtime grant is closed or carries no narrowing constraints', 'LIFECYCLE-FAILURE', '/narrowed_constraints');
    }
  }

  // ---- activations
  for (const r of index.byType.get('ActivationRecord') ?? []) {
    const reservation = str(r, 'reserved_occurrence_id');
    const grantId = str(r, 'runtime_grant_id');
    const decision = str(r, 'decision');
    const activations = index.byReservation.get(reservation) ?? [];
    const hasCompleteIssuances = (a: Readonly<Record<string, unknown>>): boolean => {
      const required = a['required_issuance_record_ids'];
      if (!Array.isArray(required)) return false;
      return (required as string[]).every((iid) => {
        const issuance = index.byId.get(iid);
        return issuance !== undefined && str(issuance, 'record_type') === 'IssuanceRecord';
      });
    };
    const competingValid = activations.filter((a) => a !== r && hasCompleteIssuances(a));
    if (competingValid.length > 0) {
      emitFor(r, ['EXE-001'], 'lifecycle.activation-cardinality', 'a reserved occurrence has more than one activation decision', 'ACTIVATION-FAILURE', '/reserved_occurrence_id');
    }
    // grant closure: the grant (by reservation) already has a denied activation
    {
      // LFC-004: required issuances must exist (for any activation decision)
      const required = r['required_issuance_record_ids'];
      if (Array.isArray(required)) {
        for (const iid of required as string[]) {
          const issuance = index.byId.get(iid);
          if (!issuance || str(issuance, 'record_type') !== 'IssuanceRecord') {
            emitFor(r, ['LFC-002', 'LFC-004', 'WSP-006'], 'lifecycle.missing-member-issuance', 'activation requires an issuance (and its approval chain) that is absent', 'LIFECYCLE-FAILURE', '/required_issuance_record_ids');
            break;
          }
        }
      }
    }
    if (decision === 'denied') {
      // denial terminality: occurrence/attempt for the reservation, or grant reuse
      const occurrences = index.byType.get('ExecutionOccurrenceRecord') ?? [];
      const hasOccurrence = occurrences.some((o) => str(o, 'occurrence_id') === reservation && str(o, 'activation_record_id') === str(r, 'record_id'));
      if (hasOccurrence) {
        emitFor(r, ['EXE-002', 'EXE-009'], 'lifecycle.denied-occurrence', 'a denied activation has an occurrence', 'ACTIVATION-FAILURE', '/decision');
      }
      // grant reuse: another activation for the same grant after a denial
      const grantClosed = (index.byType.get('ActivationRecord') ?? []).some(
        (a) => a !== r && str(a, 'runtime_grant_id') === grantId && str(a, 'decision') === 'denied',
      );
      if (grantClosed) {
        emitFor(r, ['EXE-002'], 'lifecycle.denied-grant-reuse', 'an activation reuses a grant closed by a denial', 'ACTIVATION-FAILURE', '/runtime_grant_id');
      }
    }
  }

  // ---- occurrences
  for (const r of index.byType.get('ExecutionOccurrenceRecord') ?? []) {
    const activationId = str(r, 'activation_record_id');
    const activation = index.byId.get(activationId);
    if (!activation || str(activation, 'record_type') !== 'ActivationRecord') {
      emitFor(r, ['EXE-003'], 'lifecycle.occurrence-activation', 'occurrence references a missing activation record', 'ACTIVATION-FAILURE', '/activation_record_id');
    } else if (str(activation, 'decision') !== 'accepted') {
      emitFor(r, ['EXE-002', 'EXE-003', 'EXE-009'], 'lifecycle.occurrence-denied', 'an occurrence exists for a non-accepted activation', 'ACTIVATION-FAILURE', '/activation_record_id');
    } else {
      // accepted activation must create exactly one occurrence with the reserved ID
      const reservation = str(activation, 'reserved_occurrence_id');
      const occs = (index.byType.get('ExecutionOccurrenceRecord') ?? []).filter(
        (o) => str(o, 'activation_record_id') === activationId,
      );
      if (occs.length !== 1 || str(r, 'occurrence_id') !== reservation) {
        emitFor(r, ['EXE-003'], 'lifecycle.occurrence-cardinality', 'accepted activation does not map to exactly one reserved occurrence', 'ACTIVATION-FAILURE', '/occurrence_id');
      }
    }
  }

  // ---- attempts
  const attempts = index.byType.get('ExecutionAttemptRecord') ?? [];
  const attemptContext = input.attemptsContext ?? attempts;
  const outcomes = index.byType.get('ExecutionOutcomeRecord') ?? [];
  for (const r of attempts) {
    const activationId = str(r, 'activation_record_id');
    const occurrenceId = str(r, 'occurrence_id');
    const activation = index.byId.get(activationId);
    const occurrence = (index.byType.get('ExecutionOccurrenceRecord') ?? []).find((o) => str(o, 'occurrence_id') === occurrenceId);
    const accepted =
      activation && str(activation, 'record_type') === 'ActivationRecord' && str(activation, 'decision') === 'accepted';
    if (!accepted || !occurrence || str(occurrence, 'record_type') !== 'ExecutionOccurrenceRecord') {
      emitFor(r, ['EXE-004'], 'lifecycle.attempt-without-occurrence', 'attempt lacks an accepted activation and matching occurrence', 'ACTIVATION-FAILURE', '/occurrence_id');
      emitFor(r, ['EXE-008'], 'lifecycle.attempt-facts', 'attempt lacks valid occurrence context and trusted receipt facts', 'LIFECYCLE-FAILURE', '/occurrence_id');
      continue;
    }
    // ordinals unique increasing from 1 (over the eligible attempt context)
    const occAttempts = attemptContext.filter((a) => str(a, 'occurrence_id') === occurrenceId);
    const ordinals = occAttempts.map((a) => Number(a['ordinal'])).filter((n) => Number.isInteger(n));
    const sortedOrd = [...ordinals].sort((a, b) => a - b);
    if (sortedOrd[0] !== 1 || sortedOrd.some((n, i) => i > 0 && n !== sortedOrd[i - 1]! + 1) || new Set(ordinals).size !== ordinals.length) {
      emitFor(r, ['EXE-005'], 'lifecycle.attempt-ordinal', 'attempt ordinals are not unique and increasing from one', 'ACTIVATION-FAILURE', '/ordinal');
    }
    // grant allowance
    const grant = index.byId.get(str(r, 'runtime_grant_id'));
    const limit = grant ? Number((grant as Record<string, unknown>)['attempt_limit']) : NaN;
    if (Number.isInteger(limit) && Number(r['ordinal']) > limit) {
      emitFor(r, ['EXE-005'], 'lifecycle.attempt-allowance', 'attempt ordinal exceeds the grant attempt allowance', 'ACTIVATION-FAILURE', '/ordinal');
    }
    // retry subject stability: bundle/workspace/grant must match the first attempt
    const first = occAttempts
      .filter((a) => a !== r)
      .sort((a, b) => Number(a['ordinal']) - Number(b['ordinal']))[0];
    if (first && Number(r['ordinal']) > 1) {
      const sameBundle = bundleReferencesEqual(first['bundle'], r['bundle']);
      const sameWorkspace = str(first, 'workspace_id') === str(r, 'workspace_id');
      const sameGrant = str(first, 'runtime_grant_id') === str(r, 'runtime_grant_id');
      const sameOccurrence = str(first, 'occurrence_id') === str(r, 'occurrence_id');
      if (!sameBundle || !sameWorkspace || !sameGrant || !sameOccurrence) {
        emitFor(r, ['EXE-006'], 'lifecycle.retry-substitution', 'a retry substitutes bundle, workspace, occurrence, or grant', 'ACTIVATION-FAILURE', '/bundle');
      }
    }
    // receipt facts (EXE-008): receipts for the attempt must exist when attempts are evaluated
    const receipts = index.byType.get('TrustedReceipt') ?? [];
    const hasReceipt = receipts.some((t) => str(t, 'attempt_id') === str(r, 'attempt_id'));
    if (!hasReceipt) {
      emitFor(r, ['EXE-008'], 'lifecycle.attempt-receipt-facts', 'attempt has no trusted receipt facts', 'LIFECYCLE-FAILURE', '/attempt_id');
    }
  }

  // ---- execution outcome records (EXE-010: cardinality + exact binding)
  for (const r of outcomes) {
    const ws = str(r, 'workspace_id');
    const occ = str(r, 'occurrence_id');
    const att = str(r, 'attempt_id');
    const bundle = r['bundle'];
    // exact binding: the anchor must resolve to an attempt record with
    // exact-equal workspace/bundle/occurrence/attempt/ordinal
    const anchor = str(r, 'execution_attempt_record_id');
    const bound = index.byId.get(anchor);
    const boundOk =
      bound !== undefined &&
      str(bound, 'record_type') === 'ExecutionAttemptRecord' &&
      str(bound, 'workspace_id') === ws &&
      str(bound, 'occurrence_id') === occ &&
      str(bound, 'attempt_id') === att &&
      Number(bound['ordinal']) === Number(r['ordinal']) &&
      bundleReferencesEqual(bound['bundle'], bundle);
    if (!boundOk) {
      emitFor(r, ['EXE-010'], 'lifecycle.outcome-binding', 'outcome record does not exactly bind its execution attempt record', 'LIFECYCLE-FAILURE', '/execution_attempt_record_id');
    }
    // at most one outcome record per exact attempt (result instance,
    // disposition, observation evidence, and validation material are never
    // uniqueness key material)
    const duplicate = outcomes.some(
      (o) => o !== r && str(o, 'workspace_id') === ws && str(o, 'occurrence_id') === occ && str(o, 'attempt_id') === att && bundleReferencesEqual(o['bundle'], bundle),
    );
    if (duplicate) {
      emitFor(r, ['EXE-010'], 'lifecycle.outcome-duplicate', 'more than one outcome record for the same exact attempt', 'LIFECYCLE-FAILURE', '/attempt_id');
    }
  }

  // ---- receipts
  for (const r of index.byType.get('TrustedReceipt') ?? []) {
    const event = index.byId.get(str(r, 'event_record_id'));
    if (!event || str(event, 'record_type') !== 'ExecutionAttemptRecord') {
      emitFor(r, ['EXE-008'], 'lifecycle.receipt-event', 'receipt does not correlate to an attempt record', 'LIFECYCLE-FAILURE', '/event_record_id');
      continue;
    }
    // EXE-012 (retrospective eligibility): a receipt correlated to an attempt
    // with no trustworthy outcome record claims retrospective facts for a
    // `terminal-unverifiable` attempt. Absence of an outcome record is a
    // VALID durable lifecycle state (execution in progress, crash, or
    // post-recording failure); only the receipt claim is invalid.
    const covered = outcomes.some(
      (o) =>
        str(o, 'workspace_id') === str(r, 'workspace_id') &&
        str(o, 'occurrence_id') === str(r, 'occurrence_id') &&
        str(o, 'attempt_id') === str(r, 'attempt_id') &&
        bundleReferencesEqual(o['bundle'], event['bundle']),
    );
    if (!covered) {
      emitFor(r, ['EXE-012'], 'lifecycle.receipt-orphan', 'receipt correlates to an attempt without a trustworthy outcome record (terminal-unverifiable)', 'RECEIPT-CORRELATION-FAILURE', '/attempt_id');
    }
  }

  // ---- result publications
  const publications = index.byType.get('ResultPublicationRecord') ?? [];
  const supersessions = index.byType.get('SupersessionRecord') ?? [];
  const superseded = new Set<string>();
  for (const s of supersessions) {
    const prior = s['prior'] as Record<string, unknown> | undefined;
    if (prior && str(prior, 'subject_type') === 'result-publication') superseded.add(str(prior, 'record_id'));
  }
  const supersessionSuccessors = new Set<string>();
  for (const s of supersessions) {
    const succ = s['successor'] as Record<string, unknown> | undefined;
    if (succ && str(succ, 'subject_type') === 'result-publication') supersessionSuccessors.add(str(succ, 'record_id'));
  }
  const currentPublications = publications.filter((p) => !superseded.has(str(p, 'record_id')));
  for (const r of publications) {
    const resultSubject = r['result_subject'] as Record<string, unknown> | undefined;
    const resultInstance = resultSubject ? str(resultSubject, 'instance_id') : '';
    const resultRevision = resultSubject ? str(resultSubject, 'revision_id') : '';
    const validationId = str(r, 'validation_record_id');
    const validation = index.byId.get(validationId);
    const attempt = str(r, 'attempt_id');
    const scopes = Array.isArray(r['publication_scopes']) ? (r['publication_scopes'] as string[]) : [];
    const receipts = Array.isArray(r['receipt_correlations']) ? (r['receipt_correlations'] as string[]) : [];

    // result subject must resolve to a valid artifact
    const resultArtifact = input.artifactsByRevision.get(resultRevision);
    if (!resultArtifact || str(resultArtifact, 'instance_id') !== resultInstance) {
      emitFor(r, ['PUB-003'], 'publication.result-subject', 'publication result subject does not resolve exactly', 'RESULT-PUBLICATION-FAILURE', '/result_subject');
    }
    // validation record must exist for the exact result
    if (!validation || str(validation, 'record_type') !== 'ValidationRecord') {
      emitFor(r, ['PUB-003', 'PUB-004'], 'publication.validation', 'publication lacks a validation record for the result', 'RESULT-PUBLICATION-FAILURE', '/validation_record_id');
    } else {
      const vs = subjectOf(validation);
      if (vs && resultSubject && !sameSubject(vs, resultSubject)) {
        emitFor(r, ['PUB-003', 'PUB-004'], 'publication.validation-subject', 'publication validation does not match the result subject', 'RESULT-PUBLICATION-FAILURE', '/validation_record_id');
      }
    }
    // provenance: the evaluator must match the established association for the attempt
    const provenance = r['evaluator_provenance'] as Record<string, unknown> | undefined;
    const evaluator = provenance ? str(provenance, 'evaluator_id') : '';
    const established = (publications as Record<string, unknown>[]).find(
      (p) => p !== r && str(p, 'attempt_id') === attempt && !superseded.has(str(p, 'record_id')),
    );
    const establishedEvaluator = established
      ? str((established['evaluator_provenance'] as Record<string, unknown> | undefined) ?? {}, 'evaluator_id')
      : '';
    if (!evaluator || (establishedEvaluator && establishedEvaluator !== evaluator)) {
      emitFor(r, ['PUB-003', 'PUB-004', 'PUB-008'], 'publication.provenance', 'publication evaluator provenance is absent or incompatible', 'RESULT-PUBLICATION-FAILURE', '/evaluator_provenance');
      emitFor(r, ['RES-007'], 'publication.receipt-impersonation', 'publication without compatible provenance cannot confer receipt-like status', 'AGGREGATE-RESPONSIBILITY-FAILURE', '/evaluator_provenance');
    }
    // EXE-013 (outcome/publication consistency): the first-publication path
    // requires an exact matching outcome result association. Superseded
    // publications and supersession successors are the later-owned
    // correction path (ADR-012 §8) and are exempt here; their consistency
    // handling is separately owned.
    const isSuperseded = superseded.has(str(r, 'record_id'));
    const isSuccessor = supersessionSuccessors.has(str(r, 'record_id'));
    if (!isSuperseded && !isSuccessor) {
      const outcome = outcomes.find(
        (o) =>
          str(o, 'workspace_id') === str(r, 'workspace_id') &&
          str(o, 'occurrence_id') === str(r, 'occurrence_id') &&
          str(o, 'attempt_id') === attempt &&
          bundleReferencesEqual(o['bundle'], r['bundle']),
      );
      const assoc = outcome ? (outcome['result_association'] as Record<string, unknown> | undefined) : undefined;
      if (!outcome) {
        emitFor(r, ['EXE-013'], 'publication.outcome-absent', 'publication has no outcome record for the exact attempt', 'RESULT-PUBLICATION-FAILURE', '/attempt_id');
      } else if (!assoc) {
        emitFor(r, ['EXE-013'], 'publication.outcome-association-absent', 'publication requires a result association that the outcome record lacks', 'RESULT-PUBLICATION-FAILURE', '/result_association');
      } else {
        const resultSubject = r['result_subject'] as Record<string, unknown> | undefined;
        const exact =
          str(assoc, 'instance_id') === (resultSubject ? str(resultSubject, 'instance_id') : '') &&
          str(assoc, 'revision_digest') === (resultSubject ? str(resultSubject, 'digest') : '') &&
          str(assoc, 'association_mode') === str(r, 'association_mode') &&
          str(assoc, 'validation_record_id') === str(r, 'validation_record_id');
        if (!exact) {
          emitFor(r, ['EXE-013'], 'publication.outcome-mismatch', 'publication result association diverges from the outcome record association', 'RESULT-PUBLICATION-FAILURE', '/result_subject');
        }
      }
    }
    // competing active publications (PUB-006): active = not superseded AND has receipt correlations
    const active = currentPublications.filter((p) => !superseded.has(str(p, 'record_id')));
    if (superseded.has(str(r, 'record_id'))) continue;
    for (const other of active) {
      if (other === r) continue;
      const otherSubject = other['result_subject'] as Record<string, unknown> | undefined;
      const otherInstance = otherSubject ? str(otherSubject, 'instance_id') : '';
      const otherScopes = Array.isArray(other['publication_scopes']) ? (other['publication_scopes'] as string[]) : [];
      const otherReceipts = Array.isArray(other['receipt_correlations']) ? (other['receipt_correlations'] as string[]) : [];
      const overlap = scopes.some((s) => otherScopes.includes(s));
      if (resultInstance && resultInstance === otherInstance && overlap && receipts.length > 0 && otherReceipts.length > 0) {
        emitFor(r, ['PUB-006'], 'publication.competing', 'more than one active publication applies to the same result scope', 'RESULT-PUBLICATION-FAILURE', '/publication_scopes');
        break;
      }
    }
  }

  // ---- second result instance per attempt (RES-005/PUB-001/002, RES-006/PUB-007)
  for (const [, results] of input.resultsByAttempt) {
    if (results.length < 2) continue;
    const sortedResults = [...results].sort((a, b) => {
      const ra = str(a, 'instance_id');
      const rb = str(b, 'instance_id');
      return ra < rb ? -1 : ra > rb ? 1 : 0;
    });
    const established = sortedResults[0]!;
    for (const candidate of sortedResults.slice(1)) {
      if (!input.entryArtifactInstances.has(str(candidate, 'instance_id'))) continue;
      if (str(candidate, 'instance_id') === str(established, 'instance_id')) continue; // same-instance successor revision
      const revision = candidate['revision'] as Record<string, unknown> | undefined;
      const generation = revision ? Number(revision['generation']) : NaN;
      const ruleIds = generation === 0
        ? ['PUB-001', 'PUB-002', 'RES-005', 'RES-006', 'PUB-007']
        : ['PUB-001', 'PUB-002', 'RES-005'];
      findings.push(
        at('trusted-lifecycle-verification', 'RESULT-PUBLICATION-FAILURE', ruleIds, 'publication.second-result', 'an attempt has more than one evaluator-produced result instance', str(candidate, 'instance_id'), '/body'),
      );
    }
  }

  return findings;
}

/**
 * Registry-context evaluation for lifecycle records (phase 10): every record's
 * registry snapshot reference must exactly match the accepted snapshot.
 */
export function evaluateLifecycleRegistryContext(
  records: readonly Readonly<Record<string, unknown>>[],
  entryRecordIds: ReadonlySet<string>,
  registry: AcceptedRegistryContext,
): Finding[] {
  const findings: Finding[] = [];
  for (const r of records) {
    if (!entryRecordIds.has(String(r['record_id'] ?? ''))) continue;
    const ref = r['registry_snapshot_reference'];
    if (!ref || typeof ref !== 'object') continue;
    const rr = ref as Record<string, unknown>;
    const id = typeof rr['registry_snapshot_id'] === 'string' ? rr['registry_snapshot_id'] : '';
    const digest = typeof rr['registry_snapshot_digest'] === 'string' ? rr['registry_snapshot_digest'] : '';
    if (id !== registry.registrySnapshotId || digest !== registry.registrySnapshotDigest) {
      findings.push(
        at('registry-compatibility', 'REGISTRY-INCOMPATIBILITY', ['REG-001', 'REG-002', 'REG-008', 'LFC-010'], 'registry.context', 'record registry context does not match the accepted snapshot', String(r['record_id']), '/registry_snapshot_reference'),
      );
    }
  }
  return findings;
}
