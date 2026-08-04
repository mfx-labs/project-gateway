/**
 * Identity-mode separation (phase 6).
 *
 * Two distinct operations, never mixed:
 *
 * - `checkProposedRegistration(subject, identity)` — proposed-registration
 *   conflict checks only: instance reuse, revision reuse, digest conflicts,
 *   predecessor conflicts, and generation conflicts. It never registers, never
 *   mutates state, and is used exclusively when the caller requests the
 *   `identity-registration` phase gate.
 *
 * - `verifyExistingRegistration(subject, identity)` — verification of an
 *   already registered revision: the instance exists, the revision exists, the
 *   revision belongs to the instance, and the registered digest, generation,
 *   predecessor, and workspace binding all match the subject. It MUST NOT
 *   reject a valid already-registered genesis revision as new instance reuse,
 *   and it never registers anything.
 *
 * Both operations are pure over the injected `IdentityStateView`.
 */
import { mk, type Finding } from '../internal/report.js';
import type { ExactArtifactReferenceModel, IdentityStateView } from '../api/types.js';
import { exactReferencesEqual, workspaceBindingsEqual } from '../internal/protocol-equality.js';

interface SubjectView {
  readonly instanceId: string;
  readonly kindId: string;
  readonly revisionId: string;
  readonly digest: string;
  readonly generation: number;
  readonly predecessor: unknown;
  readonly workspaceBinding: unknown;
}

export function subjectViewOf(model: Readonly<Record<string, unknown>>): SubjectView {
  const revision = (model['revision'] as Record<string, unknown> | undefined) ?? {};
  const kind = (model['kind'] as Record<string, unknown> | undefined) ?? {};
  return {
    instanceId: String(model['instance_id'] ?? ''),
    kindId: String(kind['id'] ?? ''),
    revisionId: String(revision['id'] ?? ''),
    digest: typeof revision['digest'] === 'string' ? revision['digest'] : '',
    generation: Number(revision['generation'] ?? 0),
    predecessor: revision['predecessor'],
    workspaceBinding: model['workspace_binding'],
  };
}

/**
 * Semantic exact-reference equality over the protocol fields.
 * Delegates to the authoritative comparator in `src/internal/protocol-equality.ts`.
 */
export function referencesEqual(a: unknown, b: unknown): boolean {
  return exactReferencesEqual(a, b);
}

/**
 * Semantic workspace-binding equality (mode + workspace id), insertion-order
 * independent. Delegates to the authoritative comparator in
 * `src/internal/protocol-equality.ts`.
 */
export function bindingEquals(a: unknown, b: unknown): boolean {
  return workspaceBindingsEqual(a, b);
}

function idFinding(ruleId: string, key: string, msg: string, subject: SubjectView, location: string): Finding {
  return mk('identity-registration', 'IDENTITY-CONFLICT', key, msg, {
    ruleIds: [ruleId],
    subjectIdentity: subject.instanceId,
    location,
  });
}

/**
 * Proposed-registration conflict checks. Used only when the `identity-registration`
 * phase is explicitly requested; never by for-use validation.
 */
export function checkProposedRegistration(
  model: Readonly<Record<string, unknown>>,
  identity: IdentityStateView,
): Finding[] {
  const subject = subjectViewOf(model);
  const findings: Finding[] = [];
  const inst = identity.findInstance(subject.instanceId);
  if (inst && subject.generation === 0 && inst.registeredRevisionIds.some((rid) => identity.findRevision(rid)?.generation === 0)) {
    findings.push(idFinding('LIN-001', 'identity.instance-reuse', 'instance ID is already registered to another genesis revision', subject, '/instance_id'));
  }
  const existing = identity.findRevision(subject.revisionId);
  if (existing) {
    if (existing.instanceId !== subject.instanceId || existing.digest !== subject.digest) {
      findings.push(idFinding('LIN-002', 'identity.revision-collision', 'revision ID is bound to different content or instance', subject, '/revision/id'));
    }
    if (existing.generation !== subject.generation) {
      findings.push(idFinding('LIN-005', 'identity.generation-conflict', 'registered generation does not match the proposed revision', subject, '/revision/generation'));
    }
    if (subject.predecessor !== null && subject.predecessor !== undefined) {
      const registered = existing.predecessor ?? identity.findPredecessor(subject.instanceId, subject.revisionId);
      if (registered !== undefined && !referencesEqual(subject.predecessor, registered)) {
        findings.push(idFinding('LIN-006', 'identity.predecessor-conflict', 'registered predecessor does not match the proposed predecessor', subject, '/revision/predecessor'));
      }
    }
    return findings;
  }
  // revision not yet registered: validate the proposed lineage against the
  // registered predecessor state
  if (subject.predecessor !== null && subject.predecessor !== undefined) {
    const pred = subject.predecessor as Record<string, unknown>;
    const predRev = identity.findRevision(String(pred['target_revision_id'] ?? ''));
    if (predRev && predRev.generation + 1 !== subject.generation) {
      findings.push(idFinding('LIN-005', 'identity.generation-increment', 'proposed generation is not predecessor generation plus one', subject, '/revision/generation'));
    }
    if (String(pred['target_instance_id'] ?? '') !== subject.instanceId) {
      findings.push(idFinding('LIN-004', 'identity.predecessor-instance', 'proposed predecessor is not the same instance', subject, '/revision/predecessor'));
    }
  }
  return findings;
}

/**
 * Existing-registration verification. Confirms the instance exists, the
 * revision exists, the revision belongs to the instance, and the registered
 * digest, generation, predecessor, and workspace binding match the subject.
 * Never rejects a valid registered genesis revision as new instance reuse;
 * never registers.
 */
export function verifyExistingRegistration(
  model: Readonly<Record<string, unknown>>,
  identity: IdentityStateView,
): boolean {
  const subject = subjectViewOf(model);
  if (!subject.instanceId || !subject.revisionId || !subject.digest) return false;
  const inst = identity.findInstance(subject.instanceId);
  if (!inst) return false;
  const revision = identity.findRevision(subject.revisionId);
  if (!revision) return false;
  if (revision.instanceId !== subject.instanceId) return false;
  if (revision.kindId !== subject.kindId) return false;
  if (revision.digest !== subject.digest) return false;
  if (revision.generation !== subject.generation) return false;
  const registeredPred = revision.predecessor ?? identity.findPredecessor(subject.instanceId, subject.revisionId);
  if (subject.predecessor === null || subject.predecessor === undefined) {
    if (registeredPred !== undefined) return false;
  } else if (!referencesEqual(subject.predecessor, registeredPred)) {
    return false;
  }
  const declaredBinding = subject.workspaceBinding;
  const registeredBinding = revision.workspaceBinding;
  if (declaredBinding !== null && declaredBinding !== undefined) {
    if (registeredBinding === undefined || !bindingEquals(declaredBinding, registeredBinding)) return false;
  }
  return true;
}
