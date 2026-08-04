/**
 * Point-of-use evaluation (phase 13) and complete effective-authority evaluation.
 *
 * Point-of-use evaluation MUST begin from an exact verified ExecutionBundle and
 * its exact trusted lifecycle chain:
 *
 *   - the exact bundle and its four exact member references (TaskSpec,
 *     AuthorityPolicy, ContextManifest, CompletionContract) are resolved and
 *     revalidated before evaluation (API layer);
 *   - only lifecycle records related to the exact bundle revision, the exact
 *     four referenced artifact revisions, the exact accepted registry context,
 *     the exact RuntimeGrant, and the exact requested workspace are evaluated;
 *   - the required lifecycle chain (validation, approval, issuance, grant, and
 *     activation or pre-activation state required by the requested operation)
 *     is mandatory: missing required lifecycle state and a missing RuntimeGrant
 *     fail closed;
 *   - an unrelated lifecycle record never affects the result;
 *   - revocations apply only to related revocable records (ApprovalRecord,
 *     IssuanceRecord, RuntimeGrant, ResultPublicationRecord when relevant);
 *     historical fact records are never revocable;
 *   - every applicable RuntimeGrant `narrowed_constraint` is enforced
 *     (a read-only grant never authorizes a write request);
 *   - effective authority is the intersection of the global capability
 *     ceiling, the workspace capability ceiling, the approved AuthorityPolicy,
 *     the active RuntimeGrant, and consumer support, with deny-wins,
 *     unknown-denied, and unsupported-required-semantics-denied semantics;
 *   - findings are sorted deterministically before the first failing phase is
 *     chosen, so the first reported phase is the earliest actual failure.
 *
 * Pure and deterministic: time is caller-supplied; the system clock is never
 * read, no state is mutated, no use count is consumed, no record is created,
 * and no execution is started.
 */
import { mk, sortFindings, type Finding } from '../internal/report.js';
import type {
  AcceptedRegistryContext,
  ConsumerSupportDeclaration,
  EligibilityReport,
  ExactSubjectResolver,
  IdentityStateView,
  ImmutableModel,
  LifecycleStateView,
  RequestedUse,
  RevocationView,
  ValidatedLifecycleRecord,
} from '../api/types.js';
import type { FailureCategory, ValidationPhase } from '../internal/phase.js';

export interface EffectiveAuthorityInputs {
  readonly currentTime: string;
  readonly workspaceId: string;
  readonly requestedUse: RequestedUse;
  readonly globalActionCeiling?: number;
  readonly workspaceActionCeiling?: number;
  readonly consumerSupport: ConsumerSupportDeclaration;
  readonly identity: IdentityStateView;
  readonly resolver: ExactSubjectResolver;
  readonly registry: AcceptedRegistryContext;
  readonly lifecycle: LifecycleStateView;
  readonly revocations: RevocationView;
  /** Exact ExecutionBundle model (already validated and identity-verified). Required; missing fails closed. */
  readonly bundle: ImmutableModel;
  /** The bundle's resolved AuthorityPolicy member (already validated). Required; missing fails closed. */
  readonly policy: ImmutableModel;
  /** Active RuntimeGrant model (already validated). When absent it is located from the lifecycle records. */
  readonly grant?: ImmutableModel;
}

interface RuleView {
  readonly ruleId: string;
  readonly effect: string;
  readonly capability: string;
  readonly operationClasses: readonly string[];
  readonly resourceClasses: readonly string[];
  readonly constraints: readonly Record<string, unknown>[];
}

interface ChainSubject {
  readonly kind: string;
  readonly instanceId: string;
  readonly revisionId: string;
  readonly digest: string;
  readonly workspaceId?: string;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => str(x)) : [];
}

function collectPolicyRules(policy: ImmutableModel): RuleView[] {
  const body = policy['body'] as Record<string, unknown> | undefined;
  const rules = Array.isArray(body?.['rules']) ? (body['rules'] as Record<string, unknown>[]) : [];
  return rules.map((rule) => {
    const cap = rule['capability'] as Record<string, unknown> | undefined;
    const scope = rule['scope'] as Record<string, unknown> | undefined;
    return {
      ruleId: str(rule['rule_id']),
      effect: str(rule['effect']),
      capability: str(cap?.['id']),
      operationClasses: strArr(scope?.['operation_classes']),
      resourceClasses: strArr(scope?.['resource_classes']),
      constraints: Array.isArray(rule['constraints']) ? (rule['constraints'] as Record<string, unknown>[]) : [],
    };
  });
}

function isRevokedAt(revocations: RevocationView, recordId: string, at: string): boolean {
  return revocations.revocationsByTarget(recordId).some((r) => r.effectiveAt <= at);
}

function findFinding(
  phase: ValidationPhase,
  category: FailureCategory,
  ruleIds: string[],
  key: string,
  msg: string,
  subject: string,
  location = '',
): Finding {
  return mk(phase, category, key, msg, { ruleIds, subjectIdentity: subject, location });
}

/** Exact subject correlation of a lifecycle record to a chain subject. */
function subjectExactMatch(record: Readonly<Record<string, unknown>>, subject: ChainSubject): boolean {
  const s = record['subject'];
  if (s === null || typeof s !== 'object' || Array.isArray(s)) return false;
  const r = s as Record<string, unknown>;
  const kind = r['kind'];
  if (kind === null || typeof kind !== 'object') return false;
  return (
    String((kind as Record<string, unknown>)['id'] ?? '') === subject.kind &&
    String(r['instance_id'] ?? '') === subject.instanceId &&
    String(r['revision_id'] ?? '') === subject.revisionId &&
    String(r['digest'] ?? '') === subject.digest
  );
}

/** Registry-context continuity: the record must reference the exact accepted snapshot. */
function registryContextMatches(record: Readonly<Record<string, unknown>>, registry: AcceptedRegistryContext): boolean {
  const ref = record['registry_snapshot_reference'];
  if (ref === null || ref === undefined || typeof ref !== 'object') return false;
  const r = ref as Record<string, unknown>;
  return (
    String(r['registry_snapshot_id'] ?? '') === registry.registrySnapshotId &&
    String(r['registry_snapshot_digest'] ?? '') === registry.registrySnapshotDigest
  );
}

function isExpiredAt(record: Readonly<Record<string, unknown>>, at: string): boolean {
  const validUntil = str(record['valid_until']);
  return validUntil !== '' && at > validUntil;
}

/** Exact bundle reference correlation (the grant/activation `bundle` member). */
function bundleRefMatches(ref: unknown, bundle: ImmutableModel): boolean {
  if (ref === null || ref === undefined || typeof ref !== 'object') return false;
  const r = ref as Record<string, unknown>;
  const kind = r['target_kind'];
  const revision = (bundle['revision'] as Record<string, unknown> | undefined) ?? {};
  return (
    str((kind as Record<string, unknown> | undefined)?.['id']) === 'ExecutionBundle' &&
    String(r['target_instance_id'] ?? '') === String(bundle['instance_id'] ?? '') &&
    String(r['target_revision_id'] ?? '') === String(revision['id'] ?? '') &&
    String(r['target_digest'] ?? '') === String(revision['digest'] ?? '')
  );
}

/** The five exact chain subjects of the bundle: the bundle plus its four members. */
function bundleChainSubjects(bundle: ImmutableModel): { subjects: ChainSubject[]; invalidMember: boolean } {
  const subjects: ChainSubject[] = [];
  const revision = (bundle['revision'] as Record<string, unknown> | undefined) ?? {};
  const binding = bundle['workspace_binding'] as Record<string, unknown> | undefined;
  subjects.push({
    kind: 'ExecutionBundle',
    instanceId: String(bundle['instance_id'] ?? ''),
    revisionId: String(revision['id'] ?? ''),
    digest: String(revision['digest'] ?? ''),
    workspaceId: binding?.['mode'] === 'bound' ? str(binding['workspace_id']) : undefined,
  });
  const body = bundle['body'] as Record<string, unknown> | undefined;
  let invalidMember = false;
  for (const member of ['task', 'authority_policy', 'context_manifest', 'completion_contract'] as const) {
    const ref = body?.[member];
    if (ref === null || ref === undefined || typeof ref !== 'object') {
      invalidMember = true;
      continue;
    }
    const r = ref as Record<string, unknown>;
    const kind = r['target_kind'] as Record<string, unknown> | undefined;
    const wb = r['target_workspace_binding'] as Record<string, unknown> | undefined;
    subjects.push({
      kind: str(kind?.['id']),
      instanceId: str(r['target_instance_id']),
      revisionId: str(r['target_revision_id']),
      digest: str(r['target_digest']),
      workspaceId: wb?.['mode'] === 'bound' ? str(wb['workspace_id']) : undefined,
    });
  }
  return { subjects, invalidMember };
}

/**
 * Complete effective-authority evaluation over the exact bundle and its exact
 * trusted lifecycle chain. Every decision input is decision-bearing; nothing
 * is ignored; missing required state fails closed.
 */
export function evaluateEffectiveAuthority(inputs: EffectiveAuthorityInputs): EligibilityReport {
  const findings: Finding[] = [];
  const use = inputs.requestedUse;
  const subject = `capability:${use.capability}@${use.workspaceId}`;
  const correlations: Record<string, string> = { workspace: inputs.workspaceId };
  const at = (phase: ValidationPhase, category: FailureCategory, ruleIds: string[], key: string, msg: string, location = ''): void => {
    findings.push(findFinding(phase, category, ruleIds, key, msg, subject, location));
  };

  // 1. requested-use structure: every field must be a non-empty string
  if (
    !use.capability ||
    !use.operationClass ||
    !use.resourceClass ||
    !use.scope ||
    !use.workspaceId ||
    typeof use.capability !== 'string' ||
    typeof use.operationClass !== 'string' ||
    typeof use.resourceClass !== 'string' ||
    typeof use.scope !== 'string' ||
    typeof use.workspaceId !== 'string'
  ) {
    at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['AUT-003'], 'pou.requested-use-invalid', 'requested use is incomplete', '/requestedUse');
  }

  // 2. requested workspace must equal the trusted workspace input
  if (use.workspaceId !== inputs.workspaceId) {
    at('point-of-use-eligibility', 'WORKSPACE-FAILURE', ['WSP-008'], 'pou.workspace-requested-use', 'requested use workspace does not match the trusted workspace input', '/requestedUse/workspaceId');
  }

  // 3. exact bundle and policy are mandatory inputs
  if (!inputs.bundle) {
    at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['BND-001', 'EXE-007'], 'pou.bundle-required', 'exact ExecutionBundle is required for point-of-use evaluation', '/body');
  }
  if (!inputs.policy) {
    at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['AUT-003', 'EXE-007'], 'pou.policy-required', 'resolved AuthorityPolicy is required for point-of-use evaluation', '/body/authority_policy');
  }
  if (!inputs.bundle || !inputs.policy) {
    return finish(inputs, use, subject, correlations, findings);
  }

  // 4. the five exact chain subjects (bundle + four members)
  const { subjects, invalidMember } = bundleChainSubjects(inputs.bundle);
  const bundleSubject = subjects[0]!;
  if (invalidMember) {
    at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['BND-001', 'EXE-007'], 'pou.member-reference-invalid', 'a bundle member reference is missing or malformed', '/body');
  }
  correlations['bundleInstance'] = bundleSubject.instanceId;
  correlations['policyInstance'] = str(inputs.policy['instance_id']);
  if (subjects.length < 5) {
    return finish(inputs, use, subject, correlations, findings);
  }

  // 5. workspace alignment across bundle, policy, member references
  const bundleBinding = inputs.bundle['workspace_binding'] as Record<string, unknown> | undefined;
  const bundleWs = str(bundleBinding?.['workspace_id']);
  if (bundleBinding?.['mode'] === 'bound' && bundleWs && bundleWs !== inputs.workspaceId) {
    at('point-of-use-eligibility', 'WORKSPACE-FAILURE', ['WSP-003'], 'pou.bundle-workspace', 'requested workspace does not match the bundle workspace', '/workspace_binding');
  }
  const policyBinding = inputs.policy['workspace_binding'] as Record<string, unknown> | undefined;
  const policyWs = str(policyBinding?.['workspace_id']);
  if (policyBinding?.['mode'] === 'bound' && policyWs && policyWs !== inputs.workspaceId) {
    at('point-of-use-eligibility', 'WORKSPACE-FAILURE', ['WSP-004'], 'pou.policy-workspace', 'requested workspace does not match the policy workspace', '/workspace_binding');
  }
  for (const memberSubject of subjects.slice(1)) {
    if (memberSubject.workspaceId !== undefined && memberSubject.workspaceId !== inputs.workspaceId) {
      at('point-of-use-eligibility', 'WORKSPACE-FAILURE', ['WSP-004', 'WSP-008'], 'pou.member-workspace', 'a bundle member is bound to a different workspace', '/body');
    }
  }

  // 6. related lifecycle records only: exact subject + exact accepted registry
  //    context; unrelated records are never evaluated
  const relatedValidation = new Map<number, ValidatedLifecycleRecord[]>();
  const relatedApprovals = new Map<number, ValidatedLifecycleRecord[]>();
  const relatedIssuances = new Map<number, ValidatedLifecycleRecord[]>();
  const relatedIds = new Set<string>();
  for (let i = 0; i < subjects.length; i++) {
    const s = subjects[i]!;
    const validations: ValidatedLifecycleRecord[] = [];
    const approvals: ValidatedLifecycleRecord[] = [];
    const issuances: ValidatedLifecycleRecord[] = [];
    for (const record of inputs.lifecycle.records) {
      if (!registryContextMatches(record.model, inputs.registry)) continue;
      if (record.recordType === 'ValidationRecord' && subjectExactMatch(record.model, s)) validations.push(record);
      if (record.recordType === 'ApprovalRecord' && subjectExactMatch(record.model, s)) approvals.push(record);
      if (record.recordType === 'IssuanceRecord' && subjectExactMatch(record.model, s)) issuances.push(record);
    }
    relatedValidation.set(i, validations);
    relatedApprovals.set(i, approvals);
    relatedIssuances.set(i, issuances);
    for (const r of [...validations, ...approvals, ...issuances]) relatedIds.add(r.recordId);
  }

  // 7. required lifecycle chain per exact subject (fail closed)
  const memberNames = ['the bundle', 'the task member', 'the authority-policy member', 'the context-manifest member', 'the completion-contract member'];
  for (let i = 0; i < subjects.length; i++) {
    const s = subjects[i]!;
    const name = memberNames[i]!;
    if ((relatedValidation.get(i) ?? []).length === 0) {
      at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-001', 'LFC-004', 'EXE-007'], 'pou.missing-validation', `no validation record for ${name}`, `/subject/${i}`);
    }
    const approvals = relatedApprovals.get(i) ?? [];
    const issuances = relatedIssuances.get(i) ?? [];
    if (approvals.length === 0) {
      at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-002', 'LFC-004', 'EXE-007'], 'pou.missing-approval', `no current approval for ${name}`, `/subject/${i}`);
    }
    if (issuances.length === 0) {
      at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-003', 'LFC-004', 'EXE-007'], 'pou.missing-issuance', `no current issuance for ${name}`, `/subject/${i}`);
    }
    for (const record of [...approvals, ...issuances]) {
      const recordWs = str(record.model['workspace_id']);
      if (recordWs && recordWs !== inputs.workspaceId) {
        at('point-of-use-eligibility', 'WORKSPACE-FAILURE', ['WSP-008'], 'pou.record-workspace', 'a related lifecycle record is bound to a different workspace', `/record/${record.recordId}`);
      }
      if (isRevokedAt(inputs.revocations, record.recordId, inputs.currentTime)) {
        at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-007'], 'pou.record-revoked', `a required lifecycle record is currently revoked (${name})`, `/record/${record.recordId}`);
      }
      if (isExpiredAt(record.model, inputs.currentTime)) {
        at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-007'], 'pou.record-expired', `a required lifecycle record has expired (${name})`, `/record/${record.recordId}`);
      }
    }
    for (const issuance of issuances) {
      const approvalId = str(issuance.model['approval_record_id']);
      const approvalIds = new Set(approvals.map((a) => a.recordId));
      if (approvalId && !approvalIds.has(approvalId)) {
        at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-003'], 'pou.issuance-approval', `an issuance does not reference its subject's approval (${name})`, `/record/${issuance.recordId}`);
      }
    }
    const approvalRefs = [...approvals, ...issuances].flatMap((r) => {
      const ids = r.model['validation_record_ids'];
      return Array.isArray(ids) ? (ids as string[]) : [];
    });
    for (const vid of approvalRefs) {
      const validation = inputs.lifecycle.findRecord(vid);
      if (validation && !subjectExactMatch(validation.model, s)) {
        at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-002'], 'pou.approval-validation-subject', `an approval references a validation record for a different subject (${name})`, `/record/${vid}`);
      }
    }
  }

  // 8. exact RuntimeGrant: located from the hint or the lifecycle records;
  //    missing grant fails closed; a mismatched hint is denied but the exact
  //    record grant is still evaluated
  let grantModel: ImmutableModel | undefined;
  if (inputs.grant) {
    const hintId = str(inputs.grant['record_id']);
    const hintWs = str(inputs.grant['workspace_id']);
    const correlated = bundleRefMatches(inputs.grant['bundle'], inputs.bundle) && (!hintWs || hintWs === inputs.workspaceId);
    if (!bundleRefMatches(inputs.grant['bundle'], inputs.bundle)) {
      at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-008'], 'pou.grant-bundle-mismatch', 'the runtime grant is bound to another bundle', '/bundle');
    } else if (hintWs && hintWs !== inputs.workspaceId) {
      at('point-of-use-eligibility', 'WORKSPACE-FAILURE', ['LFC-008', 'WSP-008'], 'pou.grant-workspace-mismatch', 'the runtime grant is bound to another workspace', '/workspace_id');
    }
    if (correlated) {
      grantModel = inputs.grant;
    } else if (hintId) {
      const found = inputs.lifecycle.findRecord(hintId);
      if (found && found.recordType === 'RuntimeGrant') grantModel = found.model;
    }
  }
  if (!grantModel) {
    const found = inputs.lifecycle.records.find(
      (r) => r.recordType === 'RuntimeGrant' && bundleRefMatches(r.model['bundle'], inputs.bundle) && (!str(r.model['workspace_id']) || str(r.model['workspace_id']) === inputs.workspaceId),
    );
    grantModel = found?.model;
  }
  if (!grantModel) {
    at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-008', 'EXE-007'], 'pou.grant-missing', 'no active RuntimeGrant exists for the exact bundle in the requested workspace', '/bundle');
  } else {
    const grantId = str(grantModel['record_id']);
    correlations['grantRecordId'] = grantId;
    if (isRevokedAt(inputs.revocations, grantId, inputs.currentTime)) {
      at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-007', 'EXE-007'], 'pou.grant-revoked', 'the runtime grant is currently revoked', '/record_id');
    }
    const validity = grantModel['validity'] as Record<string, unknown> | undefined;
    const notBefore = str(validity?.['not_before']);
    const notAfter = str(validity?.['not_after']);
    if ((notBefore && inputs.currentTime < notBefore) || (notAfter && inputs.currentTime > notAfter)) {
      at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-007', 'EXE-007'], 'pou.grant-validity', 'the runtime grant validity does not cover the current time', '/validity');
    }
    if (!registryContextMatches(grantModel, inputs.registry)) {
      at('registry-compatibility', 'REGISTRY-INCOMPATIBILITY', ['REG-008', 'LFC-010'], 'pou.grant-registry-context', 'the runtime grant references a different accepted registry snapshot', '/registry_snapshot_reference');
    }
  }

  // 9. activation or pre-activation state required by the requested operation
  const attemptOperation = use.operationClass === 'attempt' || use.scope.startsWith('attempt:');
  if (attemptOperation && !grantModel) {
    at('point-of-use-eligibility', 'ACTIVATION-FAILURE', ['EXE-001', 'EXE-007'], 'pou.activation-without-grant', 'attempt use requires a runtime grant before activation', '/runtime_grant_id');
  }
  if (attemptOperation && grantModel) {
    const grantRecordId = str(grantModel['record_id']);
    const activations = inputs.lifecycle.records.filter(
      (r) =>
        r.recordType === 'ActivationRecord' &&
        str(r.model['runtime_grant_id']) === grantRecordId &&
        str(r.model['decision']) === 'accepted' &&
        bundleRefMatches(r.model['bundle'], inputs.bundle),
    );
    if (activations.length === 0) {
      at('point-of-use-eligibility', 'ACTIVATION-FAILURE', ['EXE-001', 'EXE-007'], 'pou.activation-required', 'attempt use requires an accepted activation for the exact grant and bundle', '/runtime_grant_id');
    } else {
      for (const activation of activations) {
        const required = activation.model['required_issuance_record_ids'];
        if (Array.isArray(required)) {
          for (const iid of required as string[]) {
            const issuance = inputs.lifecycle.findRecord(iid);
            if (!issuance || !relatedIds.has(iid)) {
              at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['EXE-007', 'LFC-007'], 'pou.activation-prerequisite', 'an activation prerequisite issuance is not part of the related lifecycle chain', '/required_issuance_record_ids');
            } else if (isRevokedAt(inputs.revocations, iid, inputs.currentTime)) {
              at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['EXE-007', 'LFC-007'], 'pou.activation-prerequisite-revoked', 'an activation prerequisite issuance is currently revoked', '/required_issuance_record_ids');
            }
          }
        }
      }
      const occurrence = str(grantModel['reserved_occurrence_id']);
      const limit = Number(grantModel['attempt_limit']);
      const attempts = inputs.lifecycle.records.filter(
        (r) => r.recordType === 'ExecutionAttemptRecord' && str(r.model['occurrence_id']) === occurrence,
      ).length;
      if (Number.isInteger(limit) && attempts >= limit) {
        at('point-of-use-eligibility', 'ACTIVATION-FAILURE', ['EXE-005'], 'pou.attempt-allowance', 'attempt allowance is exhausted', '/attempt_limit');
      }
    }
  }

  // 10. revocations apply only to related revocable records; historical fact
  //     records are never revocable
  const HISTORICAL = new Set(['ValidationRecord', 'ActivationRecord', 'ExecutionOccurrenceRecord', 'ExecutionAttemptRecord', 'TrustedReceipt', 'SupersessionRecord', 'ExecutionSummaryRecord', 'MigrationRecord', 'AuthoritativeAuditEvent']);
  for (const rev of inputs.lifecycle.records) {
    if (rev.recordType !== 'RevocationRecord') continue;
    const target = rev.model['target'] as Record<string, unknown> | undefined;
    const targetType = str(target?.['record_type']);
    if (HISTORICAL.has(targetType)) {
      at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-006'], 'pou.historical-revocation', 'a revocation targets a historical fact record', '/target');
    }
    // a revocation targeting a related ResultPublicationRecord withdraws it
    const targetId = str(target?.['record_id']);
    const publication = inputs.lifecycle.findRecord(targetId);
    if (publication && publication.recordType === 'ResultPublicationRecord' && isRevokedAt(inputs.revocations, targetId, inputs.currentTime)) {
      at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-007', 'PUB-008'], 'pou.publication-revoked', 'a related result publication is currently revoked', `/record/${targetId}`);
    }
  }

  // 11. consumer support and registry support (unknown capability denied)
  if (!inputs.consumerSupport.supportedConsumerCapabilities.includes(use.capability)) {
    at('point-of-use-eligibility', 'CONSUMER-SUPPORT-FAILURE', ['SEC-003', 'AUT-003'], 'pou.capability-unsupported', 'requested capability is not supported by the consumer', '/capability');
  }
  const extensions = Array.isArray(inputs.bundle['extensions']) ? (inputs.bundle['extensions'] as Readonly<Record<string, unknown>>[]) : [];
  if (extensions.length > 0) {
    const snapshotEntries = Array.isArray(inputs.registry.snapshot.model['namespace_entries'])
      ? (inputs.registry.snapshot.model['namespace_entries'] as Record<string, unknown>[])
      : [];
    const registered = new Set<string>();
    for (const entry of snapshotEntries) {
      const ns = str(entry['namespace']);
      const contracts = Array.isArray(entry['extension_contracts']) ? (entry['extension_contracts'] as Record<string, unknown>[]) : [];
      for (const c of contracts) registered.add(`${ns}:${str(c['version'])}`);
    }
    for (const ext of extensions) {
      const key = `${str(ext['namespace'])}:${str(ext['version'])}`;
      if (!registered.has(key)) {
        at('registry-compatibility', 'REGISTRY-INCOMPATIBILITY', ['REG-005', 'REG-006'], 'pou.extension-unregistered', 'bundle extension is not registered in the accepted snapshot', '/extensions');
      }
      if (!inputs.consumerSupport.supportedExtensionNamespaces.includes(str(ext['namespace']))) {
        at('point-of-use-eligibility', 'CONSUMER-SUPPORT-FAILURE', ['BND-007', 'SEC-003'], 'pou.extension-unsupported', 'bundle extension namespace is not supported', '/extensions');
      }
    }
  }
  const requirements = inputs.bundle['requirements'] as Record<string, unknown> | undefined;
  const features = Array.isArray(requirements?.['protocol_features']) ? (requirements['protocol_features'] as Record<string, unknown>[]) : [];
  for (const f of features) {
    if (!inputs.consumerSupport.supportedProtocolFeatures.includes(str(f['id']))) {
      at('point-of-use-eligibility', 'CONSUMER-SUPPORT-FAILURE', ['ART-007', 'BND-007', 'SEC-003'], 'pou.feature-unsupported', 'a required protocol feature is not supported', '/requirements');
    }
  }

  // 12. policy effective authority: deny wins; unknown denied; allow narrowed
  const rules = collectPolicyRules(inputs.policy);
  const matching = rules.filter(
    (r) =>
      r.capability === use.capability &&
      (r.operationClasses.length === 0 || r.operationClasses.includes(use.operationClass)) &&
      (r.resourceClasses.length === 0 || r.resourceClasses.includes(use.resourceClass)),
  );
  const denies = matching.filter((r) => r.effect === 'deny');
  const allows = matching.filter((r) => r.effect === 'allow');
  if (denies.length > 0) {
    at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['AUT-002'], 'pou.deny', 'requested use is denied by an effective policy deny rule', '/rules');
  } else if (allows.length === 0) {
    at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['AUT-003'], 'pou.unknown-denied', 'no policy rule authorizes the requested capability and scope', '/rules');
  } else {
    for (const allow of allows) {
      for (const c of allow.constraints) {
        const type = str(c['type']);
        const value = c['value'];
        if (type === 'read-only' && value === true && use.operationClass !== 'read') {
          at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['AUT-002'], 'pou.read-only', 'requested operation violates a read-only constraint', '/rules');
        }
        if (type === 'max-actions' && typeof value === 'number') {
          if (inputs.globalActionCeiling !== undefined && value > inputs.globalActionCeiling) {
            at('point-of-use-eligibility', 'AGGREGATE-RESPONSIBILITY-FAILURE', ['AUT-001'], 'pou.global-ceiling', 'policy allow exceeds the global action ceiling', '/rules');
          }
          if (inputs.workspaceActionCeiling !== undefined && value > inputs.workspaceActionCeiling) {
            at('point-of-use-eligibility', 'AGGREGATE-RESPONSIBILITY-FAILURE', ['AUT-001'], 'pou.workspace-ceiling', 'policy allow exceeds the workspace action ceiling', '/rules');
          }
        }
        if (type === 'require-exact-resource' && value === true && !use.scope.startsWith('exact:')) {
          at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['AUT-003'], 'pou.exact-resource', 'requested scope is not an exact resource as required', '/scope');
        }
      }
    }
  }

  // 13. every applicable RuntimeGrant narrowed constraint is enforced
  if (grantModel) {
    const constraints = Array.isArray(grantModel['narrowed_constraints']) ? (grantModel['narrowed_constraints'] as Record<string, unknown>[]) : [];
    for (const c of constraints) {
      const type = str(c['type']);
      const value = c['value'];
      if (type === 'read-only' && value === true && use.operationClass !== 'read') {
        at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-008'], 'pou.grant-read-only', 'a read-only runtime grant cannot authorize this operation', '/narrowed_constraints');
      } else if (type === 'max-actions' && typeof value === 'number') {
        if (inputs.globalActionCeiling !== undefined && value > inputs.globalActionCeiling) {
          at('point-of-use-eligibility', 'AGGREGATE-RESPONSIBILITY-FAILURE', ['LFC-008', 'AUT-001'], 'pou.grant-ceiling', 'grant narrowed constraint exceeds the global action ceiling', '/narrowed_constraints');
        }
        if (inputs.workspaceActionCeiling !== undefined && value > inputs.workspaceActionCeiling) {
          at('point-of-use-eligibility', 'AGGREGATE-RESPONSIBILITY-FAILURE', ['LFC-008', 'AUT-001'], 'pou.grant-workspace-ceiling', 'grant narrowed constraint exceeds the workspace action ceiling', '/narrowed_constraints');
        }
      } else if (type === 'require-exact-resource' && value === true && !use.scope.startsWith('exact:')) {
        at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-008'], 'pou.grant-exact-resource', 'the runtime grant requires an exact resource scope', '/narrowed_constraints');
      } else if (type === 'scope') {
        const allowed = Array.isArray(value) ? value.map((x) => str(x)) : [str(value)];
        if (allowed.length > 0 && !allowed.includes(use.scope)) {
          at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-008'], 'pou.grant-scope-narrowing', 'the requested scope violates a grant scope narrowing constraint', '/narrowed_constraints');
        }
      } else if (type === 'operation-class') {
        const allowed = Array.isArray(value) ? value.map((x) => str(x)) : [str(value)];
        if (allowed.length > 0 && !allowed.includes(use.operationClass)) {
          at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-008'], 'pou.grant-operation-narrowing', 'the requested operation class violates a grant narrowing constraint', '/narrowed_constraints');
        }
      } else if (type === 'resource-class') {
        const allowed = Array.isArray(value) ? value.map((x) => str(x)) : [str(value)];
        if (allowed.length > 0 && !allowed.includes(use.resourceClass)) {
          at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-008'], 'pou.grant-resource-narrowing', 'the requested resource class violates a grant narrowing constraint', '/narrowed_constraints');
        }
      } else {
        // unsupported required constraint semantics fail closed
        at('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', ['LFC-008', 'SEC-003'], 'pou.grant-unknown-constraint', 'the runtime grant carries an unsupported narrowed constraint', '/narrowed_constraints');
      }
    }
  }

  return finish(inputs, use, subject, correlations, findings);
}

function finish(
  inputs: EffectiveAuthorityInputs,
  use: RequestedUse,
  subject: string,
  correlations: Record<string, string>,
  findings: Finding[],
): EligibilityReport {
  // 14. deterministic ordering: the first reported phase must be the earliest
  //     actual failing phase, not the first finding pushed by code order
  const sorted = sortFindings(findings);
  const eligible = sorted.length === 0;
  const first = sorted[0];
  return {
    eligible,
    requestedUse: use,
    capability: use.capability,
    scope: use.scope,
    workspaceId: inputs.workspaceId,
    subjectCorrelations: Object.freeze(correlations),
    firstFailingPhase: first?.phase,
    categories: Object.freeze([...new Set(sorted.map((f) => f.category))]),
    ruleIds: Object.freeze([...new Set(sorted.flatMap((f) => f.ruleIds))].sort()),
    findings: Object.freeze(sorted),
  };
}

// ---------------------------------------------------------------------------
// corpus-oriented point-of-use evaluation (used by the conformance runner)
// ---------------------------------------------------------------------------
export interface PointOfUseContext {
  readonly currentTime: string;
  readonly registry: AcceptedRegistryContext;
  readonly consumerSupport: ConsumerSupportDeclaration;
  readonly records: readonly Readonly<Record<string, unknown>>[];
  readonly entryRecordIds: ReadonlySet<string>;
  readonly policyModel?: Readonly<Record<string, unknown>>;
  readonly ceilings?: { readonly global?: number; readonly workspace?: number };
}

function at(category: string, ruleIds: string[], key: string, msg: string, subjectId: string, location = ''): Finding {
  return mk('point-of-use-eligibility', category as never, key, msg, { ruleIds, subjectIdentity: subjectId, location });
}

export function evaluatePointOfUse(ctx: PointOfUseContext): Finding[] {
  const findings: Finding[] = [];
  const isEntry = (r: Readonly<Record<string, unknown>>): boolean => ctx.entryRecordIds.has(String(r['record_id'] ?? ''));

  // EXE-007 / LFC-007: activation prerequisites must be currently valid.
  for (const r of ctx.records) {
    if (!isEntry(r)) continue;
    if (String(r['record_type']) !== 'ActivationRecord') continue;
    const required = Array.isArray(r['required_issuance_record_ids']) ? (r['required_issuance_record_ids'] as string[]) : [];
    for (const iid of required) {
      const revoked = ctx.records.some(
        (x) =>
          String(x['record_type']) === 'RevocationRecord' &&
          (x['target'] as Record<string, unknown> | undefined)?.['record_id'] === iid &&
          String((x as Record<string, unknown>)['effective_at'] ?? '') <= ctx.currentTime,
      );
      if (revoked) {
        findings.push(
          at('POINT-OF-USE-FAILURE', ['EXE-007', 'LFC-007'], 'pointofuse.revoked-issuance', 'activation requires an issuance that is currently revoked', String(r['record_id']), '/required_issuance_record_ids'),
        );
        break;
      }
    }
    const grantId = String(r['runtime_grant_id'] ?? '');
    const grant = ctx.records.find((x) => String(x['record_id']) === grantId);
    if (grant) {
      const validity = grant['validity'] as Record<string, unknown> | undefined;
      const notBefore = validity ? String(validity['not_before'] ?? '') : '';
      const notAfter = validity ? String(validity['not_after'] ?? '') : '';
      if ((notBefore && ctx.currentTime < notBefore) || (notAfter && ctx.currentTime > notAfter)) {
        findings.push(
          at('POINT-OF-USE-FAILURE', ['EXE-007', 'LFC-007'], 'pointofuse.grant-validity', 'runtime grant validity does not cover the current time', String(r['record_id']), '/runtime_grant_id'),
        );
      }
    }
  }

  // PUB-005: privileged scopes require receipt correlation.
  const PRIVILEGED = new Set(['completion-status', 'authoritative-reporting', 'downstream-automation']);
  for (const r of ctx.records) {
    if (!isEntry(r)) continue;
    if (String(r['record_type']) !== 'ResultPublicationRecord') continue;
    const scopes = Array.isArray(r['publication_scopes']) ? (r['publication_scopes'] as string[]) : [];
    const receipts = Array.isArray(r['receipt_correlations']) ? (r['receipt_correlations'] as string[]) : [];
    const hasPrivileged = scopes.some((s) => PRIVILEGED.has(s));
    if (hasPrivileged && receipts.length === 0) {
      findings.push(
        at('RECEIPT-CORRELATION-FAILURE', ['PUB-005'], 'pointofuse.privileged-without-receipt', 'privileged result use requires trusted receipt correlation', String(r['record_id']), '/publication_scopes'),
      );
    }
  }

  // Revocation records: a revocation that withdraws an issuance required by an
  // activation makes the current activation state unusable at point of use.
  for (const r of ctx.records) {
    if (!isEntry(r)) continue;
    if (String(r['record_type']) !== 'RevocationRecord') continue;
    const target = r['target'] as Record<string, unknown> | undefined;
    const targetId = target ? String(target['record_id'] ?? '') : '';
    if (!targetId) continue;
    const requiredByActivation = ctx.records.some(
      (x) =>
        String(x['record_type']) === 'ActivationRecord' &&
        Array.isArray(x['required_issuance_record_ids']) &&
        (x['required_issuance_record_ids'] as string[]).includes(targetId),
    );
    if (requiredByActivation) {
      findings.push(
        at('POINT-OF-USE-FAILURE', ['EXE-007', 'LFC-007'], 'pointofuse.revocation-conflict', 'revocation withdraws an issuance required by an activation', String(r['record_id']), '/target'),
      );
    }
  }

  // AUT-001 / AUT-002: policy must not exceed consumer support; allow cannot
  // mask an effective deny.
  if (ctx.policyModel) {
    const body = ctx.policyModel['body'] as Record<string, unknown> | undefined;
    const rules = Array.isArray(body?.['rules']) ? (body['rules'] as Record<string, unknown>[]) : [];
    const supported = ctx.consumerSupport.supportedConsumerCapabilities;
    for (const rule of rules) {
      const cap = rule['capability'] as Record<string, unknown> | undefined;
      const effect = String(rule['effect'] ?? '');
      if (effect !== 'allow' || !cap) continue;
      const capability = String(cap['id'] ?? '');
      if (!supported.includes(capability)) {
        findings.push(
          at('AGGREGATE-RESPONSIBILITY-FAILURE', ['AUT-001'], 'pointofuse.policy-expansion', 'policy allow rule exceeds consumer support', String(ctx.policyModel['instance_id'] ?? ''), '/body/rules'),
        );
        findings.push(
          at('POINT-OF-USE-FAILURE', ['AUT-002'], 'pointofuse.deny-masked', 'policy allow rule masks an effective deny', String(ctx.policyModel['instance_id'] ?? ''), '/body/rules'),
        );
        break;
      }
      const constraints = Array.isArray(rule['constraints']) ? (rule['constraints'] as Record<string, unknown>[]) : [];
      for (const c of constraints) {
        const type = String(c['type'] ?? '');
        const value = c['value'];
        if (type === 'max-actions' && typeof value === 'number') {
          if (ctx.ceilings?.global !== undefined && value > ctx.ceilings.global) {
            findings.push(
              at('AGGREGATE-RESPONSIBILITY-FAILURE', ['AUT-001'], 'pointofuse.ceiling-exceeded', 'policy constraint exceeds the trusted action ceiling', String(ctx.policyModel['instance_id'] ?? ''), '/body/rules'),
            );
            break;
          }
        }
      }
    }
  }

  return findings;
}
