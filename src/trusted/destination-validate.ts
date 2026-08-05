/**
 * WP-6 Phase 2B: prospective artifact-draft destination containment
 * evaluator (Model B alias-aware resolution).
 *
 * Deterministic, fail-closed, I/O-free prospective containment evaluation
 * for artifact-root-relative draft destinations beneath a trusted configured
 * artifact directory. The request is UNTRUSTED request data (WP-0
 * remote-producer zone); trusted operands (runtime-genuine validated
 * configuration, configuration identity, workspace correlation, the
 * configuration-bound canonical artifact directory, the fixed four-draft
 * scope, and the injected resolver) come from options supplied by a trusted
 * caller. The decision is prospective trusted-process containment data only:
 * it grants no write, overwrite, persistence, approval, RuntimeGrant, or
 * execution authority, and it requires immediate later point-of-use
 * revalidation by WP-11 before any actual mutation.
 *
 * Semantic evaluation order (deterministic, first-failure semantics). The
 * 18 semantic stages are numbered below; descriptor-derived capture of the
 * untrusted request is a SAFETY BOUNDARY PRE-STEP, not a semantic stage:
 * it runs after stages 1–2 and before stage 3, and a capture failure yields
 * TAD-007 before any request-dependent semantic stage can be evaluated.
 * Stages 3–8 read only the detached captured snapshot, never the original
 * caller object.
 *  1. configuration genuineness (TAD-001);
 *  2. configuration version exactly `2` (TAD-002);
 *  [boundary pre-step] descriptor-derived single capture of the untrusted
 *     request (failure → TAD-007; no request-field read before capture);
 *  3. workspace lookup (TAD-003);
 *  4. configured artifact-location presence (TAD-004);
 *  5. expected configuration identity correlation (TAD-005);
 *  6. artifact kind within the fixed four-draft scope (TAD-006);
 *  7. request-record structure and exact own-key set (TAD-007);
 *  8. destination lexical grammar and size bound (TAD-008…TAD-012);
 *  9. resolver presence (TAD-013);
 * 10. exactly one resolver invocation (TAD-014 on throw);
 * 11. evidence capture and exact variant shape (TAD-020 / TAD-015 / TAD-016 /
 *     TAD-017 / TAD-018 / TAD-019);
 * 12. current artifact-root state (subject-aware failure mapping);
 * 13. current artifact-root canonical correlation (TAD-026);
 * 14. existing-directory-ancestor state (subject-aware failure mapping);
 * 15. Model-B lexical-prefix and canonical-containment correlation
 *     (TAD-033…TAD-038);
 * 16. destination-tail and target-state cross-validation (TAD-035…TAD-038);
 * 17. existing-target reject-only policy (TAD-039…TAD-043);
 * 18. decision identity (TAD-045).
 *
 * Zero resolver calls for any failure before stage 10; exactly one call once
 * stage 10 is reached; no retry; no decision and no decision identity on any
 * failure; no partial successful result.
 */
import {
  snapshotDestinationRequest,
  parseDestinationComponents,
  joinComponents,
  combineCanonicalRootAndComponents,
  type DestinationPathFailureCode,
} from './destination-request.js';
import {
  captureDestinationResolutionEvidence,
  validateDestinationSuccessEvidence,
  validateDestinationFailureEvidence,
} from './destination-evidence.js';
import {
  destinationFinding,
  failDestinationReport,
  type DestinationContainmentFinding,
  type DestinationContainmentFindingCode,
  type ProspectiveArtifactDestinationReport,
} from './destination-findings.js';
import { computeDestinationDecisionIdentity, DESTINATION_DECISION_DIGEST_RE } from './destination-identity.js';
import {
  DESTINATION_CONTAINMENT_PROTOCOL_VERSION,
  DESTINATION_CONTAINMENT_OPERATION_CLASS,
  DESTINATION_CONTAINMENT_PURPOSE,
  type ArtifactDraftKind,
  type ProspectiveArtifactDestinationOptions,
} from './destination-types.js';
import { isRootAncestorOrEqual } from './roots.js';
import { isGenuineValidatedTrustedWorkspaceConfiguration } from './configuration-brand.js';
import { lookupValidatedWorkspace, lookupValidatedArtifactLocation } from './validate.js';
import { TRUSTED_CONFIGURATION_VERSION_2 } from './types.js';
import { ARTIFACT_DRAFT_LOCATION_KINDS } from './artifact-location.js';
import { TrustedSnapshotError } from './snapshot.js';

function finding(
  code: DestinationContainmentFindingCode,
  messageKey: string,
  message: string,
  location?: string,
): DestinationContainmentFinding {
  return destinationFinding(code, messageKey, message, location);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const REQUEST_KEYS: ReadonlySet<string> = new Set([
  'expectedConfigurationIdentity',
  'workspaceId',
  'artifactKind',
  'destination',
]);

function checkUnknownFields(
  container: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  location: string,
  findings: DestinationContainmentFinding[],
): boolean {
  for (const key of Object.keys(container)) {
    if (!allowed.has(key)) {
      findings.push(finding(
        'TAD-007',
        'destination.request-unknown-field',
        'request contains a field that is not part of the destination request protocol',
        location,
      ));
      return false;
    }
  }
  return true;
}

function pathFailureToFinding(code: DestinationPathFailureCode): DestinationContainmentFinding {
  switch (code) {
    case 'empty':
      return finding('TAD-008', 'destination.destination-malformed', 'destination must name at least one entry below the artifact root', '/destination');
    case 'absolute':
    case 'drive-absolute':
    case 'unc':
      return finding('TAD-009', 'destination.destination-absolute', 'destination must be artifact-root-relative, not absolute', '/destination');
    case 'dot':
    case 'dotdot':
      return finding('TAD-010', 'destination.destination-traversal-dot', 'destination contains a prohibited dot or traversal component', '/destination');
    case 'trailing-separator':
    case 'repeated-separator':
    case 'empty-component':
    case 'backslash':
    case 'nul-or-control':
      return finding('TAD-011', 'destination.destination-invalid-character', 'destination contains an invalid separator or character', '/destination');
    case 'too-long':
      return finding('TAD-012', 'destination.destination-too-long', 'destination exceeds the maximum request size', '/destination');
  }
}

/** Deterministic subject/code → finding mapping for subject-aware failure evidence. */
function failureToFinding(
  subject: string,
  code: string,
  location: string,
): DestinationContainmentFinding {
  switch (subject) {
    case 'artifact-root': {
      switch (code) {
        case 'not-found':
          return finding('TAD-021', 'destination.artifact-root-not-found', 'configured artifact root does not currently exist', location);
        case 'not-directory':
        case 'dangling-symlink':
          return finding('TAD-022', 'destination.artifact-root-not-directory', 'configured artifact root is not currently a directory', location);
        case 'unsupported-kind':
          return finding('TAD-023', 'destination.artifact-root-unsupported-kind', 'configured artifact root has an unsupported entry kind', location);
        case 'loop':
          return finding('TAD-024', 'destination.artifact-root-loop', 'configured artifact root resolution detected a loop', location);
        default: // inaccessible | ambiguous | error
          return finding('TAD-025', 'destination.artifact-root-inaccessible-ambiguous', 'configured artifact root is inaccessible or ambiguous', location);
      }
    }
    case 'existing-ancestor': {
      switch (code) {
        case 'not-found':
          return finding('TAD-027', 'destination.ancestor-not-found', 'no valid existing directory ancestor exists', location);
        case 'not-directory':
          return finding('TAD-028', 'destination.ancestor-not-directory', 'existing ancestor is not a directory', location);
        case 'unsupported-kind':
          return finding('TAD-029', 'destination.ancestor-unsupported-kind', 'existing ancestor has an unsupported entry kind', location);
        case 'dangling-symlink':
          return finding('TAD-030', 'destination.ancestor-dangling-symlink', 'an intermediate symlink in the ancestor chain does not resolve', location);
        case 'loop':
          return finding('TAD-031', 'destination.ancestor-loop', 'existing ancestor resolution detected a loop', location);
        default: // inaccessible | ambiguous | error
          return finding('TAD-032', 'destination.ancestor-inaccessible-ambiguous', 'existing ancestor is inaccessible or ambiguous', location);
      }
    }
    case 'final-target':
      return finding('TAD-044', 'destination.final-target-observation-failed', 'final target observation failed', location);
    default: // 'resolution'
      return finding('TAD-014', 'destination.resolver-failed', 'artifact-destination resolver failed', location);
  }
}

/** P must be an exact positional prefix of R. */
function isPrefixOf(prefix: readonly string[], request: readonly string[]): boolean {
  if (prefix.length > request.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== request[i]) return false;
  }
  return true;
}

/** T must be the exact remaining suffix of R immediately after prefix P. */
function isTailAfterPrefix(
  prefix: readonly string[],
  tail: readonly string[],
  request: readonly string[],
): boolean {
  if (prefix.length + tail.length !== request.length) return false;
  for (let i = 0; i < tail.length; i++) {
    if (tail[i] !== request[prefix.length + i]) return false;
  }
  return true;
}

/**
 * Evaluate one prospective artifact-draft destination request.
 * Returns either one complete deeply frozen successful decision or one
 * complete deterministic failure report; never a partial result.
 */
export function evaluateProspectiveArtifactDestination(
  input: unknown,
  options: ProspectiveArtifactDestinationOptions,
): ProspectiveArtifactDestinationReport {
  const findings: DestinationContainmentFinding[] = [];

  // 1. Runtime configuration genuineness, checked FIRST: only a
  //    runtime-branded configuration may provide workspace and artifact
  //    roots; forged, cloned, spread, JSON-reconstructed, structured-cloned,
  //    manually frozen, or Proxy-wrapped configurations fail closed before
  //    any configuration field is read.
  const configuration = options.configuration;
  if (!isGenuineValidatedTrustedWorkspaceConfiguration(configuration)) {
    findings.push(finding('TAD-001', 'destination.configuration-not-genuine', 'trusted configuration is not a runtime-genuine validated configuration', '/options/configuration'));
    return failDestinationReport(findings);
  }

  // 2. Configuration version: exactly `2` (version-1 configurations are
  //    rejected before workspace or artifact-location lookup).
  if (configuration.configurationVersion !== TRUSTED_CONFIGURATION_VERSION_2) {
    findings.push(finding('TAD-002', 'destination.configuration-version-unsupported', 'trusted configuration version is not the supported version-2 protocol', '/options/configuration'));
    return failDestinationReport(findings);
  }

  // Boundary pre-step: descriptor-derived single capture of the untrusted
  // request. A hostile request cannot supply any protocol field; capture
  // failure is a request-structure failure (TAD-007) returned before any
  // request-dependent semantic stage (workspace, artifact-location presence,
  // expected identity, artifact kind, destination grammar) can be evaluated.
  // Stages 3–8 read only this detached captured snapshot, never the original
  // caller object.
  let snapshot: unknown;
  try {
    snapshot = snapshotDestinationRequest(input);
  } catch (err) {
    if (err instanceof TrustedSnapshotError) {
      findings.push(finding('TAD-007', 'destination.request-snapshot-failed', 'destination request structure is unsupported or hostile', '$'));
    } else {
      findings.push(finding('TAD-007', 'destination.request-snapshot-failed', 'snapshot or descriptor introspection failed', '$'));
    }
    return failDestinationReport(findings);
  }
  if (!isRecord(snapshot)) {
    findings.push(finding('TAD-007', 'destination.request-structure-malformed', 'destination request is not an object', '$'));
    return failDestinationReport(findings);
  }

  // 3. Workspace lookup by opaque workspace ID (unknown workspace fails).
  const workspaceId = snapshot['workspaceId'];
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    findings.push(finding('TAD-003', 'destination.workspace-unknown', 'workspace identifier is missing or malformed', '/workspaceId'));
    return failDestinationReport(findings);
  }
  const record = lookupValidatedWorkspace(configuration, workspaceId);
  if (record === undefined) {
    findings.push(finding('TAD-003', 'destination.workspace-unknown', 'workspace identifier is not registered in the validated configuration', '/workspaceId'));
    return failDestinationReport(findings);
  }

  // 4. Configured artifact-location presence (omission grants nothing).
  const location = lookupValidatedArtifactLocation(configuration, workspaceId);
  if (location === undefined) {
    findings.push(finding('TAD-004', 'destination.artifact-location-missing', 'workspace has no configured artifact location', '/workspaceId'));
    return failDestinationReport(findings);
  }
  const canonicalArtifactRoot = location.canonicalArtifactRoot;

  // 5. Expected configuration identity: mandatory, exact, never inferred.
  const expectedIdentity = snapshot['expectedConfigurationIdentity'];
  if (typeof expectedIdentity !== 'string' || expectedIdentity.length === 0) {
    findings.push(finding('TAD-005', 'destination.configuration-identity-mismatch', 'expected trusted configuration identity is missing', '/expectedConfigurationIdentity'));
    return failDestinationReport(findings);
  }
  if (expectedIdentity !== configuration.identity) {
    findings.push(finding('TAD-005', 'destination.configuration-identity-mismatch', 'expected trusted configuration identity does not match the validated configuration', '/expectedConfigurationIdentity'));
    return failDestinationReport(findings);
  }

  // 6. Artifact kind: exactly one of the fixed four-draft scope; no
  //    caller-configurable kind list; ExecutionBundle, ExecutionResult,
  //    TrustedReceipt, unknown strings, and non-strings are rejected.
  const kindRaw = snapshot['artifactKind'];
  if (typeof kindRaw !== 'string' || !(ARTIFACT_DRAFT_LOCATION_KINDS as readonly string[]).includes(kindRaw)) {
    findings.push(finding('TAD-006', 'destination.artifact-kind-unsupported', 'artifact kind is not one of the four permitted draft kinds', '/artifactKind'));
    return failDestinationReport(findings);
  }
  const artifactKind = kindRaw as ArtifactDraftKind;

  // 7. Request-record structure: strict exact own-key set (unknown fields
  //    are malformed; misspelled fields are never silently ignored).
  if (!checkUnknownFields(snapshot, REQUEST_KEYS, '$', findings)) {
    return failDestinationReport(findings);
  }

  // 8. Destination lexical grammar and size bound (untrusted boundary).
  const destinationRaw = snapshot['destination'];
  if (typeof destinationRaw !== 'string') {
    findings.push(finding('TAD-008', 'destination.destination-malformed', 'destination is missing or malformed', '/destination'));
    return failDestinationReport(findings);
  }
  const parsed = parseDestinationComponents(destinationRaw);
  if (!parsed.ok) {
    findings.push(pathFailureToFinding(parsed.code));
    return failDestinationReport(findings);
  }
  const components = parsed.components;

  // 9. Resolver presence.
  const resolver = options.resolveProspectiveDestination;
  if (typeof resolver !== 'function') {
    findings.push(finding('TAD-013', 'destination.resolver-missing', 'prospective-destination resolver is required for destination containment evaluation', '/options/resolveProspectiveDestination'));
    return failDestinationReport(findings);
  }

  // 10. Internally constructed, deeply frozen resolver request; exactly one
  //     invocation. The root comes only from the runtime-genuine validated
  //     configuration; the absolute destination only from that root plus
  //     validated components.
  const combined = combineCanonicalRootAndComponents(canonicalArtifactRoot, components);
  if (!combined.ok) {
    // Defensive: a validated configuration can never produce a `/` or
    // malformed canonical artifact root (TCF-038); unreachable, fail closed.
    findings.push(finding('TAD-026', 'destination.artifact-root-canonical-mismatch', 'configured canonical artifact root is not usable', '/options/configuration'));
    return failDestinationReport(findings);
  }
  const internalRequest = Object.freeze({
    destinationContainmentProtocolVersion: DESTINATION_CONTAINMENT_PROTOCOL_VERSION,
    canonicalArtifactRoot,
    absoluteProspectiveDestination: combined.absolute,
  });
  let rawEvidence: unknown;
  try {
    rawEvidence = resolver(internalRequest);
  } catch {
    findings.push(finding('TAD-014', 'destination.resolver-invocation-error', 'artifact-destination resolver invocation failed', '/options/resolveProspectiveDestination'));
    return failDestinationReport(findings);
  }

  // 11. Evidence capture: descriptor-derived single capture; hostile or
  //     structurally invalid evidence fails closed (TAD-020).
  const captured = captureDestinationResolutionEvidence(rawEvidence);
  if (!captured.ok) {
    findings.push(finding('TAD-020', 'destination.evidence-hostile', 'artifact-destination resolver evidence is hostile or structurally invalid', '/options/resolveProspectiveDestination'));
    return failDestinationReport(findings);
  }

  if (captured.value['ok'] === true) {
    // ---- success evidence (Model B observed state) ----
    const success = validateDestinationSuccessEvidence(captured.value);
    if (!success.ok) {
      // Malformed shape/types/literals/vocabulary or non-canonical paths.
      findings.push(finding('TAD-015', 'destination.evidence-success-malformed', 'artifact-destination resolver success evidence is malformed', '/options/resolveProspectiveDestination'));
      return failDestinationReport(findings);
    }
    const evidence = success.evidence;

    // 13. Current artifact-root canonical correlation: the observed current
    //     canonical root must exactly equal the configuration-bound canonical
    //     artifact root (stale or changed root fails closed; the raw
    //     configured alias discarded by Phase-2B-P is never reintroduced;
    //     resolver-to-`/` fails via this equality and the explicit check).
    if (evidence.currentCanonicalArtifactRoot === '/') {
      findings.push(finding('TAD-026', 'destination.artifact-root-canonical-mismatch', 'configured canonical artifact root is the whole-filesystem root', '/options/resolveProspectiveDestination'));
      return failDestinationReport(findings);
    }
    if (evidence.currentCanonicalArtifactRoot !== canonicalArtifactRoot) {
      findings.push(finding('TAD-026', 'destination.artifact-root-canonical-mismatch', 'current canonical artifact root does not match the configuration-bound artifact root', '/options/resolveProspectiveDestination'));
      return failDestinationReport(findings);
    }

    // 14. Canonical existing-directory-ancestor containment: equal to the
    //     current canonical artifact root or a strict component-boundary
    //     descendant; `/` and above-root/sibling-prefix forms fail.
    const ancestor = evidence.canonicalExistingDirectoryAncestor;
    if (ancestor === '/') {
      findings.push(finding('TAD-033', 'destination.ancestor-outside-root', 'canonical existing directory ancestor is the whole-filesystem root', '/options/resolveProspectiveDestination'));
      return failDestinationReport(findings);
    }
    if (!isRootAncestorOrEqual(evidence.currentCanonicalArtifactRoot, ancestor)) {
      findings.push(finding('TAD-033', 'destination.ancestor-outside-root', 'canonical existing directory ancestor is outside the artifact root', '/options/resolveProspectiveDestination'));
      return failDestinationReport(findings);
    }

    // 15. Defense-in-depth: the canonical ancestor must not fall under any
    //     OTHER registered workspace root (Phase-1 disjoint-root invariance
    //     makes this unreachable for validated configurations; kept
    //     explicit).
    for (const other of configuration.workspaces) {
      if (other.workspaceId === workspaceId) continue;
      if (isRootAncestorOrEqual(other.canonicalRoot, ancestor)) {
        findings.push(finding('TAD-034', 'destination.ancestor-workspace-ambiguity', 'canonical existing directory ancestor is ambiguous across registered workspaces', '/options/resolveProspectiveDestination'));
        return failDestinationReport(findings);
      }
    }

    // 16. Model-B lexical-prefix / canonical-containment correlation. P is
    //     an exact positional prefix of the validated request components; T
    //     is the exact remaining suffix; together they reconstruct the
    //     request exactly. The lexical-to-canonical mapping (root + P → A)
    //     is trusted host evidence and is NOT proven by the core from path
    //     strings alone; the core never requires
    //     `A + T == lexical absolute destination` (invalid across aliases).
    const prefix = evidence.lexicalExistingDirectoryPrefixComponents;
    const tail = evidence.destinationTailComponents;
    if (!isPrefixOf(prefix, components)) {
      findings.push(finding('TAD-035', 'destination.lexical-prefix-mismatch', 'lexical existing-directory prefix does not match the validated destination', '/options/resolveProspectiveDestination'));
      return failDestinationReport(findings);
    }
    if (!isTailAfterPrefix(prefix, tail, components)) {
      findings.push(finding('TAD-036', 'destination.destination-tail-mismatch', 'destination tail does not match the validated destination components', '/options/resolveProspectiveDestination'));
      return failDestinationReport(findings);
    }
    // Explicit P + T == R invariant (implied by the two checks above;
    // defense-in-depth, unreachable for consistent evidence).
    {
      const reconstructed = [...prefix, ...tail];
      if (reconstructed.length !== components.length || reconstructed.some((c, i) => c !== components[i])) {
        findings.push(finding('TAD-038', 'destination.alias-correlation-inconsistent', 'alias-correlation evidence is internally inconsistent', '/options/resolveProspectiveDestination'));
        return failDestinationReport(findings);
      }
    }
    // A zero-length lexical prefix means the ancestor IS the artifact root.
    if (prefix.length === 0 && ancestor !== evidence.currentCanonicalArtifactRoot) {
      findings.push(finding('TAD-038', 'destination.alias-correlation-inconsistent', 'alias-correlation evidence is internally inconsistent', '/options/resolveProspectiveDestination'));
      return failDestinationReport(findings);
    }

    // 17. Target-state / tail cross-validation and existing-target
    //     reject-only policy (create-only MVP; no overwrite authority).
    const state = evidence.targetState;
    if (state === 'missing') {
      if (tail.length < 1) {
        findings.push(finding('TAD-037', 'destination.target-state-tail-inconsistent', 'missing target state requires a non-empty destination tail', '/options/resolveProspectiveDestination'));
        return failDestinationReport(findings);
      }
      // Fall through to identity construction.
    } else if (state === 'existing-directory') {
      if (tail.length !== 0 || prefix.length !== components.length) {
        findings.push(finding('TAD-037', 'destination.target-state-tail-inconsistent', 'existing-directory target state requires an empty tail covering the full destination', '/options/resolveProspectiveDestination'));
        return failDestinationReport(findings);
      }
      findings.push(finding('TAD-040', 'destination.target-exists-directory', 'final target already exists as a directory', '/destination'));
      return failDestinationReport(findings);
    } else {
      // existing-file | existing-symlink | dangling-symlink | unsupported-kind
      if (tail.length !== 1 || prefix.length !== components.length - 1) {
        findings.push(finding('TAD-037', 'destination.target-state-tail-inconsistent', 'existing non-directory target state requires a one-component destination tail', '/options/resolveProspectiveDestination'));
        return failDestinationReport(findings);
      }
      const existingCode: DestinationContainmentFindingCode =
        state === 'existing-file' ? 'TAD-039'
        : state === 'existing-symlink' ? 'TAD-041'
        : state === 'dangling-symlink' ? 'TAD-042'
        : 'TAD-043';
      const key = state === 'existing-file' ? 'destination.target-exists-file'
        : state === 'existing-symlink' ? 'destination.target-exists-symlink'
        : state === 'dangling-symlink' ? 'destination.target-dangling-symlink'
        : 'destination.target-unsupported-kind';
      findings.push(finding(existingCode, key, 'final target already exists and is rejected by the create-only policy', '/destination'));
      return failDestinationReport(findings);
    }

    // 18. Deterministic decision identity over the complete validated
    //     operands; the target state is bound as exactly `missing`.
    const canonicalArtifactRelativeDestination = joinComponents(components);
    let identity;
    try {
      identity = computeDestinationDecisionIdentity({
        destinationContainmentProtocolVersion: DESTINATION_CONTAINMENT_PROTOCOL_VERSION,
        operationClass: DESTINATION_CONTAINMENT_OPERATION_CLASS,
        purpose: DESTINATION_CONTAINMENT_PURPOSE,
        configurationIdentity: configuration.identity,
        hostLane: configuration.hostLane,
        workspaceId,
        artifactKind,
        canonicalArtifactRelativeDestination,
        currentCanonicalArtifactRoot: evidence.currentCanonicalArtifactRoot,
        lexicalExistingDirectoryPrefixComponents: prefix,
        canonicalExistingDirectoryAncestor: ancestor,
        destinationTailComponents: tail,
        targetState: 'missing',
        pointOfUseRevalidationRequired: true,
      });
    } catch {
      findings.push(finding('TAD-045', 'destination.identity-failed', 'destination-containment decision identity computation failed', '$'));
      return failDestinationReport(findings);
    }
    if (!DESTINATION_DECISION_DIGEST_RE.test(identity.digest)) {
      findings.push(finding('TAD-045', 'destination.identity-failed', 'destination-containment decision identity computation failed', '$'));
      return failDestinationReport(findings);
    }

    const decision = Object.freeze({
      destinationContainmentProtocolVersion: DESTINATION_CONTAINMENT_PROTOCOL_VERSION,
      operationClass: DESTINATION_CONTAINMENT_OPERATION_CLASS,
      purpose: DESTINATION_CONTAINMENT_PURPOSE,
      decisionIdentity: identity.digest,
      configurationIdentity: configuration.identity,
      hostLane: configuration.hostLane,
      workspaceId,
      artifactKind,
      canonicalArtifactRelativeDestination,
      currentCanonicalArtifactRoot: evidence.currentCanonicalArtifactRoot,
      lexicalExistingDirectoryPrefixComponents: Object.freeze([...prefix]),
      canonicalExistingDirectoryAncestor: ancestor,
      destinationTailComponents: Object.freeze([...tail]),
      targetState: 'missing' as const,
      pointOfUseRevalidationRequired: true as const,
    });
    return Object.freeze({
      ok: true,
      findings: Object.freeze([]),
      decision,
    });
  }

  // ---- failure evidence (subject-aware) ----
  const failure = validateDestinationFailureEvidence(captured.value);
  if (!failure.ok) {
    switch (failure.code) {
      case 'unknown-subject':
        findings.push(finding('TAD-017', 'destination.failure-subject-unknown', 'artifact-destination resolver failure subject is unknown', '/options/resolveProspectiveDestination'));
        break;
      case 'unknown-code':
        findings.push(finding('TAD-018', 'destination.failure-code-unknown', 'artifact-destination resolver failure code is unknown', '/options/resolveProspectiveDestination'));
        break;
      case 'incompatible-subject-code':
        findings.push(finding('TAD-019', 'destination.failure-subject-code-incompatible', 'artifact-destination resolver failure subject and code are incompatible', '/options/resolveProspectiveDestination'));
        break;
      default:
        findings.push(finding('TAD-016', 'destination.evidence-failure-malformed', 'artifact-destination resolver failure evidence is malformed', '/options/resolveProspectiveDestination'));
        break;
    }
    return failDestinationReport(findings);
  }
  const failureEvidence = failure.evidence;
  findings.push(failureToFinding(failureEvidence.subject, failureEvidence.code, '/options/resolveProspectiveDestination'));
  return failDestinationReport(findings);
}
