/**
 * WP-11 Slice 1 — transport-free create-only controlled-write core.
 *
 * Persists one already-accepted WP-10 `ValidDraftProposalResult` as a new
 * structured artifact draft inside the host-configured `artifactLocation`
 * region of one version-2 workspace. Create-only, fail-closed,
 * containment-bound, point-of-use revalidated, deterministic, I/O-free.
 *
 * INTENDED SEQUENCE (preserves the accepted security model; TOCTOU
 * elimination is never claimed):
 *
 *   input capture → request/draft validation (incl. accepted digest
 *   correlation) → prospective containment (accepted WP-6 Phase 2B
 *   evaluation) → point-of-use revalidation (second accepted Phase 2B
 *   evaluation with a FRESH resolver observation) → decision correlation
 *   → injected host executor (descriptor-anchored exclusive create,
 *   no-follow, exact bytes) → typed bounded result.
 *
 * Only a target proven missing by BOTH accepted evaluations may continue
 * toward the executor; a raced target appearance fails closed either
 * through the point-of-use evaluation (TAD-039…TAD-043) or through the
 * executor's exclusive-create conflict — never through overwrite.
 *
 * EXECUTOR ANCHORING: the host executor anchors the actual mutation to a
 * retained artifact-root descriptor (accepted WP-7 / reader lane pattern,
 * `/proc/self/fd/<rootFd>/…`) and builds the parent/target paths from the
 * accepted decision's RESOLVED canonical existing-directory ancestor plus
 * the missing tail — never from a caller lexical absolute path. The
 * executor verifies the opened parent's descriptor-bound resolution path
 * against the accepted canonical ancestor (SYM-009), so an intermediate
 * component replaced after revalidation fails closed (`parent-not-verified`)
 * instead of redirecting the write outside the configured region.
 *
 * REUSE: the accepted WP-6 Phase 2B `evaluateProspectiveArtifactDestination`
 * is the SINGLE containment authority (workspace lookup, artifact-location
 * presence, configuration-identity correlation, fixed four-kind scope
 * TAD-006, destination grammar TAD-008…TAD-012, existing-target reject-only
 * policy TAD-039…TAD-043). NO parallel traversal, ancestor, path, symlink,
 * containment, or evidence logic exists in this module. The WP-10 draft is
 * the semantic-validation snapshot: only a narrow shape/correlation
 * assertion is performed here — no second artifact validation or
 * serialization pipeline.
 *
 * The immutable accepted `ValidDraftProposalResult` is proposal data, not
 * write authority; a valid draft alone grants no filesystem authority.
 */
import { Buffer } from 'node:buffer';
import {
  ARTIFACT_DRAFT_LOCATION_KINDS,
  DESTINATION_CONTAINMENT_OPERATION_CLASS,
  DESTINATION_CONTAINMENT_PURPOSE,
  evaluateProspectiveArtifactDestination,
  snapshotTrustedWorkspaceConfigurationInput,
  TrustedSnapshotError,
} from '../trusted/index.js';
import { computeArtifactDigestOverCanonicalUtf8 } from '../digest/index.js';
import type {
  ArtifactDraftKind,
  DestinationContainmentFinding,
  ProspectiveArtifactDestinationDecision,
  ProspectiveArtifactDestinationRequest,
} from '../trusted/index.js';
import { WRITE_CANONICAL_UTF8_MAX_BYTES } from './types.js';
import type {
  ControlledWriteFailure,
  ControlledWriteFailureCategory,
  ControlledWriteOptions,
  ControlledWriteResult,
  ControlledWriteSuccess,
  DraftWriteExecutorFailureCode,
  DraftWriteExecutorInput,
  DraftWriteExecutorResult,
} from './types.js';

const REQUEST_KEYS: ReadonlySet<string> = new Set(['draft', 'workspaceId', 'destination', 'expectedConfigurationIdentity']);
const DRAFT_KEYS: ReadonlySet<string> = new Set(['ok', 'valid', 'kind', 'proposal', 'validation']);
const PROPOSAL_KEYS: ReadonlySet<string> = new Set(['instanceId', 'revisionId', 'digest', 'canonicalUtf8', 'level', 'model']);
const VALIDATION_KEYS: ReadonlySet<string> = new Set(['level', 'ruleIds']);
const ARTIFACT_DIGEST_RE = /^sha-256:[0-9a-f]{64}$/;

const MESSAGES = {
  requestInvalid: 'the draft write request is malformed or hostile',
  draftInvalid: 'the supplied draft is not a complete accepted valid draft proposal',
  kindUnsupported: 'the draft kind is not one of the four permitted artifact draft kinds',
  draftCorrelation: 'the draft canonical bytes do not correspond to the accepted draft digest',
  containmentDenied: 'the requested draft destination is not contained by the configured artifact location',
  correlationFailed: 'point-of-use revalidation did not correlate with the prospective containment decision',
  pointOfUseConflict: 'the draft destination changed or conflicted at point-of-use revalidation',
  targetConflict: 'a conflicting target appeared before the draft could be created; the existing target was never modified',
  executorFailed: 'the artifact draft could not be written by the host write executor',
  cleanupIndeterminate: 'the artifact draft could not be completed and partial content could not be confirmed removed; the artifact location state is indeterminate',
} as const;

interface FailureExtras {
  readonly findings?: readonly DestinationContainmentFinding[];
  readonly reason?: DraftWriteExecutorFailureCode;
}

function failure(category: ControlledWriteFailureCategory, code: string, message: string, extra: FailureExtras = {}): ControlledWriteFailure {
  return Object.freeze({
    ok: false,
    category,
    code,
    message,
    ...(extra.findings !== undefined ? { findings: Object.freeze([...extra.findings]) } : {}),
    ...(extra.reason !== undefined ? { reason: extra.reason } : {}),
  });
}

function success(proposal: Readonly<Record<string, unknown>>, decision: ProspectiveArtifactDestinationDecision, persistedByteCount: number): ControlledWriteSuccess {
  return Object.freeze({
    ok: true,
    outcome: 'created',
    evidence: Object.freeze({
      artifactKind: decision.artifactKind,
      instanceId: proposal['instanceId'] as string,
      revisionId: proposal['revisionId'] as string,
      digest: proposal['digest'] as string,
      relativeDestination: decision.canonicalArtifactRelativeDestination,
      persistedByteCount,
      transition: 'missing-to-file',
    }),
  });
}

/** The two accepted evaluations must correlate on every write-relevant operand. */
function decisionsCorrelate(a: ProspectiveArtifactDestinationDecision, b: ProspectiveArtifactDestinationDecision): boolean {
  return a.operationClass === b.operationClass
    && a.purpose === b.purpose
    && a.configurationIdentity === b.configurationIdentity
    && a.workspaceId === b.workspaceId
    && a.artifactKind === b.artifactKind
    && a.currentCanonicalArtifactRoot === b.currentCanonicalArtifactRoot
    && a.canonicalArtifactRelativeDestination === b.canonicalArtifactRelativeDestination
    && a.canonicalExistingDirectoryAncestor === b.canonicalExistingDirectoryAncestor
    && sameTail(a.destinationTailComponents, b.destinationTailComponents)
    && b.targetState === 'missing';
}

function sameTail(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((component, index) => component === b[index]);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(container: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>): boolean {
  const keys = Object.keys(container);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

/**
 * Validate the accepted WP-10 draft as a write input (narrow shape/correlation
 * assertion; no second artifact validation/serialization pipeline). The kind
 * gate is distinguished: a well-formed draft whose kind is outside the fixed
 * four-draft scope is `reason: 'kind'`; a digest/bytes correlation failure is
 * `reason: 'correlation'`; anything else malformed is `reason: 'shape'`.
 */
function validateWriteableDraft(
  draft: unknown,
): { readonly ok: true; readonly kind: ArtifactDraftKind; readonly canonicalUtf8: string; readonly proposal: Readonly<Record<string, unknown>> } | { readonly ok: false; readonly reason: 'kind' | 'shape' | 'correlation' } {
  if (!isRecord(draft)) return { ok: false, reason: 'shape' };
  if (!hasExactKeys(draft, DRAFT_KEYS)) return { ok: false, reason: 'shape' };
  if (draft['ok'] !== true || draft['valid'] !== true) return { ok: false, reason: 'shape' };
  const kind = draft['kind'];
  if (typeof kind !== 'string' || !(ARTIFACT_DRAFT_LOCATION_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, reason: 'kind' };
  }
  const proposal = draft['proposal'];
  if (!isRecord(proposal) || !hasExactKeys(proposal, PROPOSAL_KEYS)) return { ok: false, reason: 'shape' };
  const instanceId = proposal['instanceId'];
  const revisionId = proposal['revisionId'];
  const digest = proposal['digest'];
  const canonicalUtf8 = proposal['canonicalUtf8'];
  const level = proposal['level'];
  const model = proposal['model'];
  if (typeof instanceId !== 'string' || instanceId.length === 0) return { ok: false, reason: 'shape' };
  if (typeof revisionId !== 'string' || revisionId.length === 0) return { ok: false, reason: 'shape' };
  if (typeof digest !== 'string' || !ARTIFACT_DIGEST_RE.test(digest)) return { ok: false, reason: 'shape' };
  if (typeof canonicalUtf8 !== 'string' || canonicalUtf8.length === 0) return { ok: false, reason: 'shape' };
  if (Buffer.byteLength(canonicalUtf8, 'utf8') > WRITE_CANONICAL_UTF8_MAX_BYTES) return { ok: false, reason: 'shape' };
  if (typeof level !== 'string' || level.length === 0) return { ok: false, reason: 'shape' };
  if (!isRecord(model)) return { ok: false, reason: 'shape' };
  const validation = draft['validation'];
  if (!isRecord(validation) || !hasExactKeys(validation, VALIDATION_KEYS)) return { ok: false, reason: 'shape' };
  if (typeof validation['level'] !== 'string' || validation['level'].length === 0) return { ok: false, reason: 'shape' };
  const ruleIds = validation['ruleIds'];
  if (!Array.isArray(ruleIds) || ruleIds.some((r) => typeof r !== 'string')) return { ok: false, reason: 'shape' };
  // Accepted digest correlation: the captured canonical bytes must recompute
  // to the declared digest under the accepted domain separation (single
  // accepted computation; no second serializer/hash contract). A forged or
  // mutated draft can never reach containment or the executor.
  if (computeArtifactDigestOverCanonicalUtf8(canonicalUtf8) !== digest) {
    return { ok: false, reason: 'correlation' };
  }
  return { ok: true, kind: kind as ArtifactDraftKind, canonicalUtf8, proposal };
}

/**
 * Persist one accepted validated artifact draft (create-only). Deterministic;
 * the only allowed mutation is the single newly-created artifact draft file
 * (via the injected executor). Returns a bounded typed result.
 */
export function persistValidatedArtifactDraft(input: unknown, options: ControlledWriteOptions): ControlledWriteResult {
  // Trusted options: the injected executor is mandatory (host composition
  // error otherwise); configuration genuineness/version and resolver
  // presence are enforced by the accepted Phase 2B evaluation
  // (TAD-001/002/013).
  if (!isRecord(options) || typeof options.writeDraftFile !== 'function') {
    return failure('executor-failure', 'ERR-WRITE-EXECUTOR-FAILED', MESSAGES.executorFailed);
  }

  // Untrusted request: descriptor-derived single capture (hostile structures
  // fail closed before any request-field read).
  let snapshot: unknown;
  try {
    snapshot = snapshotTrustedWorkspaceConfigurationInput(input);
  } catch {
    return failure('request-invalid', 'ERR-WRITE-REQ-INVALID', MESSAGES.requestInvalid);
  }
  if (!isRecord(snapshot)) {
    return failure('request-invalid', 'ERR-WRITE-REQ-INVALID', MESSAGES.requestInvalid);
  }
  if (!hasExactKeys(snapshot, REQUEST_KEYS)) {
    return failure('request-invalid', 'ERR-WRITE-REQ-INVALID', MESSAGES.requestInvalid);
  }
  const workspaceId = snapshot['workspaceId'];
  const destination = snapshot['destination'];
  const expectedConfigurationIdentity = snapshot['expectedConfigurationIdentity'];
  if (typeof workspaceId !== 'string' || typeof destination !== 'string' || typeof expectedConfigurationIdentity !== 'string') {
    return failure('request-invalid', 'ERR-WRITE-REQ-INVALID', MESSAGES.requestInvalid);
  }

  // Draft validation: complete accepted valid draft; fixed four-kind scope.
  // A forged, valid:false, ok:false, ExecutionBundle/ExecutionResult,
  // lifecycle/control-plane, or lookalike draft never proceeds.
  const draft = snapshot['draft'];
  const validated = validateWriteableDraft(draft);
  if (!validated.ok) {
    if (validated.reason === 'kind') {
      return failure('draft-not-writeable', 'ERR-WRITE-KIND-UNSUPPORTED', MESSAGES.kindUnsupported);
    }
    if (validated.reason === 'correlation') {
      return failure('draft-not-writeable', 'ERR-WRITE-DRAFT-DIGEST-MISMATCH', MESSAGES.draftCorrelation);
    }
    return failure('draft-not-writeable', 'ERR-WRITE-DRAFT-INVALID', MESSAGES.draftInvalid);
  }

  // Accepted Phase 2B prospective destination evaluation (single containment
  // authority: workspace lookup, artifact-location presence, identity
  // correlation, kind scope TAD-006, destination grammar, existing-target
  // reject-only policy).
  const request: ProspectiveArtifactDestinationRequest = {
    expectedConfigurationIdentity,
    workspaceId,
    artifactKind: validated.kind,
    destination,
  };
  const evaluationOptions = {
    configuration: options.configuration,
    resolveProspectiveDestination: options.resolveProspectiveDestination,
  };
  const prospective = evaluateProspectiveArtifactDestination(request, evaluationOptions);
  if (!prospective.ok || prospective.decision === undefined) {
    return failure('containment-denied', 'ERR-WRITE-CONTAINMENT-DENIED', MESSAGES.containmentDenied, {
      findings: prospective.findings,
    });
  }

  // Mandatory point-of-use revalidation: a SECOND accepted evaluation with a
  // FRESH resolver observation immediately before the executor. Stale
  // prospective evidence never authorizes a write.
  const pointOfUse = evaluateProspectiveArtifactDestination(request, evaluationOptions);
  if (!pointOfUse.ok || pointOfUse.decision === undefined) {
    return failure('point-of-use-conflict', 'ERR-WRITE-POINT-OF-USE-CONFLICT', MESSAGES.pointOfUseConflict, {
      findings: pointOfUse.findings,
    });
  }

  // Correlation: both accepted evaluations must agree on every
  // write-relevant operand (fail closed otherwise).
  if (!decisionsCorrelate(prospective.decision, pointOfUse.decision)) {
    return failure('point-of-use-conflict', 'ERR-WRITE-POINT-OF-USE-CONFLICT', MESSAGES.correlationFailed);
  }

  // Executor evidence: ONLY the accepted decision + the accepted payload.
  // The executor anchors to the decision's canonical artifact root and
  // builds the parent/target from the RESOLVED canonical existing-directory
  // ancestor plus the missing tail — never from caller lexical paths.
  const decision = pointOfUse.decision;
  const ancestorRelative = decision.canonicalExistingDirectoryAncestor === decision.currentCanonicalArtifactRoot
    ? ''
    : decision.canonicalExistingDirectoryAncestor.startsWith(`${decision.currentCanonicalArtifactRoot}/`)
      ? decision.canonicalExistingDirectoryAncestor.slice(decision.currentCanonicalArtifactRoot.length + 1)
      : null;
  if (ancestorRelative === null) {
    // Unreachable for accepted decisions (TAD-033 guarantees the ancestor
    // is within the artifact root); fail closed on evidence inconsistency.
    return failure('point-of-use-conflict', 'ERR-WRITE-POINT-OF-USE-CONFLICT', MESSAGES.correlationFailed);
  }
  const executorInput: DraftWriteExecutorInput = {
    operationClass: DESTINATION_CONTAINMENT_OPERATION_CLASS,
    purpose: DESTINATION_CONTAINMENT_PURPOSE,
    configurationIdentity: decision.configurationIdentity,
    workspaceId: decision.workspaceId,
    artifactKind: decision.artifactKind,
    canonicalArtifactRoot: decision.currentCanonicalArtifactRoot,
    canonicalExistingDirectoryAncestor: decision.canonicalExistingDirectoryAncestor,
    canonicalAncestorRelativePath: ancestorRelative,
    destinationTailComponents: decision.destinationTailComponents,
    canonicalUtf8: validated.canonicalUtf8,
    expectedByteCount: Buffer.byteLength(validated.canonicalUtf8, 'utf8'),
  };

  // Injected host executor: the ONLY filesystem-mutation boundary.
  let executorResult: DraftWriteExecutorResult;
  try {
    executorResult = options.writeDraftFile(executorInput);
  } catch {
    return failure('executor-failure', 'ERR-WRITE-EXECUTOR-FAILED', MESSAGES.executorFailed);
  }
  if (!executorResult.ok) {
    if (executorResult.code === 'exclusive-create-conflict') {
      // A raced target appearance: expected create-only conflict; the
      // appeared target was never overwritten.
      return failure('point-of-use-conflict', 'ERR-WRITE-TARGET-CONFLICT', MESSAGES.targetConflict);
    }
    if (executorResult.cleanup === 'failed') {
      // The operation created the target, failed, and could not confirm
      // removal: indeterminate artifact-location state.
      return failure('cleanup-indeterminate', 'ERR-WRITE-CLEANUP-INDETERMINATE', MESSAGES.cleanupIndeterminate, {
        reason: executorResult.code,
      });
    }
    return failure('executor-failure', 'ERR-WRITE-EXECUTOR-FAILED', MESSAGES.executorFailed, {
      reason: executorResult.code,
    });
  }
  return success(validated.proposal, decision, executorResult.persistedByteCount);
}
