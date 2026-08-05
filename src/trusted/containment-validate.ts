/**
 * WP-6 Phase 2A: existing-path containment decision evaluator.
 *
 * Deterministic, fail-closed, I/O-free prospective containment evaluation
 * for EXISTING paths only. The request is UNTRUSTED workspace-relative
 * request data (WP-0 remote-producer zone); trusted operands (validated
 * configuration, workspace record, host lane, injected resolver) come from
 * options supplied by a trusted caller. Validation proves structure and
 * containment only; it never makes request data trusted and never grants
 * authority.
 *
 * Evaluation order (deterministic):
 * 1. runtime configuration genuineness (correction F-2A-01): only a
 *    runtime-branded Phase-1 validated configuration may provide workspace
 *    roots; forged lookalikes, clones, and digest imitations fail closed
 *    before any configuration field is read;
 * 2. trusted operands (host lane, resolver) are checked next;
 * 3. descriptor-derived snapshot hardening of the request (no getters, no
 *    Proxy `get`, no missing/non-enumerable/accessor descriptors, no
 *    symbols, deep freeze, no caller reread);
 * 4. strict recursive unknown-field rejection;
 * 5. containment protocol version (explicit; no inference);
 * 6. purpose discriminator (`read` | `inspect` only);
 * 7. expected configuration identity must equal the validated configuration
 *    identity exactly (never inferred);
 * 8. workspace lookup by opaque workspace ID (unknown workspace fails);
 * 9. workspace-relative path grammar (absolute/drive/UNC/NUL/control/
 *    separator/component rules; root token `.`);
 * 10. trusted internal combination of the canonical workspace root with the
 *     validated relative components (POSIX component semantics; `..` pops
 *     bounded by the workspace root);
 * 11. exactly one injected resolution of the internal absolute candidate;
 * 12. lexical re-canonicalization of the resolver result under the
 *     supported POSIX lane;
 * 13. component-boundary containment under the selected workspace root;
 * 14. defense-in-depth: the resolved path must not fall under any OTHER
 *     registered workspace root (Phase-1 disjoint-root invariant makes this
 *     unreachable for validated configurations; the check keeps the
 *     guarantee explicit);
 * 15. immutable prospective decision + deterministic decision identity
 *     computed only after all validation succeeds;
 * 16. no result and no identity on any failure.
 *
 * The core performs no filesystem, network, Git, process, or authority
 * action; the decision is prospective and requires point-of-use
 * revalidation by the operation owner (WP-7 for reads and inspection).
 */
import {
  snapshotTrustedWorkspaceConfigurationInput,
  TrustedSnapshotError,
} from './snapshot.js';
import {
  containmentFinding,
  failContainmentReport,
  sortContainmentFindings,
  type ExistingPathContainmentFinding,
  type ExistingPathContainmentReport,
} from './containment-findings.js';
import {
  combineWorkspaceRootAndComponents,
  parseWorkspaceRelativePath,
  type RelativePathFailureCode,
} from './containment-path.js';
import {
  CONTAINMENT_OPERATION_CLASS,
  CONTAINMENT_PROTOCOL_VERSION,
  CONTAINMENT_PURPOSES,
  type ContainmentPurpose,
  type ExistingPathContainmentDecision,
  type ExistingPathContainmentOptions,
} from './containment-types.js';
import type { ExistingPathResolver } from './containment-resolver.js';
import {
  computeContainmentDecisionIdentity,
  CONTAINMENT_DECISION_DIGEST_RE,
} from './containment-identity.js';
import { lookupValidatedWorkspace } from './validate.js';
import { TRUSTED_HOST_LANE } from './host-lane.js';
import { canonicalizeRootLexically, isRootAncestorOrEqual } from './roots.js';
import { isGenuineValidatedTrustedWorkspaceConfiguration } from './configuration-brand.js';

const REQUEST_KEYS: ReadonlySet<string> = new Set([
  'containmentProtocolVersion',
  'workspaceId',
  'path',
  'purpose',
  'expectedConfigurationIdentity',
]);

function finding(
  code: ExistingPathContainmentFinding['code'],
  messageKey: string,
  message: string,
  location?: string,
): ExistingPathContainmentFinding {
  return containmentFinding(code, messageKey, message, location);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkUnknownFields(
  container: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  location: string,
  findings: ExistingPathContainmentFinding[],
): boolean {
  for (const key of Object.keys(container)) {
    if (!allowed.has(key)) {
      findings.push(finding(
        'TCP-003',
        'containment.unknown-field',
        'request contains a field that is not part of the containment request protocol',
        location,
      ));
      return false;
    }
  }
  return true;
}

function isPurpose(value: string): value is ContainmentPurpose {
  return (CONTAINMENT_PURPOSES as readonly string[]).includes(value);
}

function pathFailureToFinding(code: RelativePathFailureCode): ExistingPathContainmentFinding {
  switch (code) {
    case 'absolute':
    case 'drive-absolute':
    case 'unc':
      return finding('TCP-005', 'containment.path-absolute', 'request path must be workspace-relative, not absolute', '/path');
    case 'nul-or-control':
      return finding('TCP-008', 'containment.path-invalid-character', 'request path contains a NUL or control character', '/path');
    case 'empty':
    case 'backslash':
    case 'leading-separator':
    case 'trailing-separator':
    case 'repeated-separator':
    case 'empty-component':
    case 'interior-dot':
      return finding('TCP-006', 'containment.path-malformed', 'request path is empty or malformed', '/path');
  }
}

/**
 * Evaluate the prospective containment of an existing workspace-relative
 * path. Returns an immutable typed report; a decision (with identity) exists
 * only when every validation step succeeded. No filesystem operation is
 * performed and no authority is granted.
 */
export function evaluateExistingPathContainment(
  input: unknown,
  options: ExistingPathContainmentOptions,
): ExistingPathContainmentReport {
  const findings: ExistingPathContainmentFinding[] = [];

  // 0. Runtime configuration genuineness (correction F-2A-01), checked FIRST:
  //    only a runtime-branded configuration produced by a successful Phase-1
  //    validation may provide workspace roots. A forged lookalike, clone,
  //    spread, Proxy wrapper, or correct-digest imitation is rejected before
  //    any field (hostLane, identity, workspaces, canonicalRoot) is read,
  //    before workspace lookup, before candidate-root combination, before
  //    resolver invocation, and before decision identity computation.
  const configuration = options.configuration;
  if (!isGenuineValidatedTrustedWorkspaceConfiguration(configuration)) {
    findings.push(finding('TCP-021', 'containment.configuration-not-genuine', 'trusted configuration is not a runtime-genuine validated configuration', '/options/configuration'));
    return failContainmentReport(findings);
  }

  // 1. Trusted operands first (host lane, resolver).
  if (configuration.hostLane !== TRUSTED_HOST_LANE) {
    findings.push(finding('TCP-011', 'containment.host-lane-unsupported', 'trusted host lane is not the accepted supported lane', '/options/configuration'));
    return failContainmentReport(findings);
  }
  const resolveExistingPath: ExistingPathResolver = options.resolveExistingPath;
  if (typeof resolveExistingPath !== 'function') {
    findings.push(finding('TCP-012', 'containment.resolver-missing', 'existing-path resolver is required for containment evaluation', '/options/resolveExistingPath'));
    return failContainmentReport(findings);
  }

  // 2. Descriptor-derived snapshot hardening of the untrusted request.
  let snapshot: unknown;
  try {
    snapshot = snapshotTrustedWorkspaceConfigurationInput(input);
  } catch (err) {
    if (err instanceof TrustedSnapshotError) {
      findings.push(finding('TCP-019', 'containment.snapshot-failed', 'containment request structure is unsupported or hostile', '$'));
    } else {
      findings.push(finding('TCP-019', 'containment.snapshot-failed', 'snapshot or descriptor introspection failed', '$'));
    }
    return failContainmentReport(findings);
  }

  // 3. Request structure and strict shape.
  if (!isRecord(snapshot)) {
    findings.push(finding('TCP-002', 'containment.structure-malformed', 'containment request is not an object', '$'));
    return failContainmentReport(findings);
  }
  if (!checkUnknownFields(snapshot, REQUEST_KEYS, '$', findings)) {
    return failContainmentReport(findings);
  }

  // 4. Containment protocol version: explicit, mandatory, no inference.
  const version = snapshot['containmentProtocolVersion'];
  if (typeof version !== 'string' || version.length === 0) {
    findings.push(finding('TCP-001', 'containment.version-missing', 'containment protocol version is missing', '/containmentProtocolVersion'));
    return failContainmentReport(findings);
  }
  if (version !== CONTAINMENT_PROTOCOL_VERSION) {
    findings.push(finding('TCP-001', 'containment.version-unsupported', 'unsupported containment protocol version', '/containmentProtocolVersion'));
    return failContainmentReport(findings);
  }

  // 5. Purpose discriminator (read | inspect; shared containment semantics).
  const purposeRaw = snapshot['purpose'];
  if (typeof purposeRaw !== 'string' || !isPurpose(purposeRaw)) {
    findings.push(finding('TCP-004', 'containment.purpose-unsupported', 'unsupported containment purpose', '/purpose'));
    return failContainmentReport(findings);
  }
  const purpose: ContainmentPurpose = purposeRaw;

  // 6. Expected configuration identity: mandatory, exact, never inferred.
  const expectedIdentity = snapshot['expectedConfigurationIdentity'];
  if (typeof expectedIdentity !== 'string' || expectedIdentity.length === 0) {
    findings.push(finding('TCP-010', 'containment.configuration-identity-mismatch', 'expected trusted configuration identity is missing', '/expectedConfigurationIdentity'));
    return failContainmentReport(findings);
  }
  if (expectedIdentity !== configuration.identity) {
    findings.push(finding('TCP-010', 'containment.configuration-identity-mismatch', 'expected trusted configuration identity does not match the validated configuration', '/expectedConfigurationIdentity'));
    return failContainmentReport(findings);
  }

  // 7. Workspace lookup by opaque workspace ID.
  const workspaceId = snapshot['workspaceId'];
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    findings.push(finding('TCP-009', 'containment.workspace-unknown', 'workspace identifier is missing or malformed', '/workspaceId'));
    return failContainmentReport(findings);
  }
  const record = lookupValidatedWorkspace(configuration, workspaceId);
  if (record === undefined) {
    findings.push(finding('TCP-009', 'containment.workspace-unknown', 'workspace identifier is not registered in the validated configuration', '/workspaceId'));
    return failContainmentReport(findings);
  }

  // 8. Workspace-relative path grammar (untrusted request boundary).
  const rawPath = snapshot['path'];
  if (typeof rawPath !== 'string') {
    findings.push(finding('TCP-006', 'containment.path-malformed', 'request path is empty or malformed', '/path'));
    return failContainmentReport(findings);
  }
  const parsed = parseWorkspaceRelativePath(rawPath);
  if (!parsed.ok) {
    findings.push(pathFailureToFinding(parsed.code));
    return failContainmentReport(findings);
  }

  // 9. Trusted internal combination: canonical root + validated components.
  const combined = combineWorkspaceRootAndComponents(record.canonicalRoot, parsed.components);
  if (!combined.ok) {
    const code = combined.code === 'escape' ? 'TCP-007' : 'TCP-006';
    const key = combined.code === 'escape' ? 'containment.path-traversal-escape' : 'containment.path-malformed';
    findings.push(finding(code, key, combined.code === 'escape' ? 'request path escapes the workspace root' : 'request path cannot be combined with the workspace root', '/path'));
    return failContainmentReport(findings);
  }

  // 10. Exactly one injected resolution of the internal absolute candidate.
  let resolution;
  try {
    resolution = resolveExistingPath(combined.canonical);
  } catch {
    findings.push(finding('TCP-013', 'containment.resolver-failure', 'existing-path resolver failed', '/options/resolveExistingPath'));
    return failContainmentReport(findings);
  }
  if (!resolution.ok) {
    if (resolution.code === 'not-found') {
      findings.push(finding('TCP-014', 'containment.path-unresolved', 'existing path cannot be resolved', '/path'));
    } else if (resolution.code === 'loop') {
      findings.push(finding('TCP-015', 'containment.symlink-loop', 'existing path resolution detected a symlink loop', '/path'));
    } else {
      findings.push(finding('TCP-013', 'containment.resolver-failure', 'existing-path resolver failed', '/options/resolveExistingPath'));
    }
    return failContainmentReport(findings);
  }

  // 11. Re-canonicalize the resolver result under the supported POSIX lane.
  //     Relative, Windows/UNC, NUL/control, and otherwise malformed resolver
  //     results fail closed (the resolver is trusted, but its output is
  //     still evidence and is normalized deterministically).
  const resolvedLexical = canonicalizeRootLexically(resolution.canonical);
  if (!resolvedLexical.ok) {
    findings.push(finding('TCP-016', 'containment.resolver-result-malformed', 'resolver result is malformed or outside the supported lane', '/options/resolveExistingPath'));
    return failContainmentReport(findings);
  }
  const resolvedCanonical = resolvedLexical.canonical;

  // 12. Component-boundary containment under the selected workspace root.
  if (!isRootAncestorOrEqual(record.canonicalRoot, resolvedCanonical)) {
    findings.push(finding('TCP-017', 'containment.path-outside-workspace', 'resolved path is outside the workspace root', '/path'));
    return failContainmentReport(findings);
  }

  // 13. Defense-in-depth: the resolved path must not fall under any other
  //     registered workspace root (Phase-1 prohibits overlapping roots, so
  //     this cannot fire for validated configurations; kept explicit).
  for (const other of configuration.workspaces) {
    if (other.workspaceId === workspaceId) continue;
    if (isRootAncestorOrEqual(other.canonicalRoot, resolvedCanonical)) {
      findings.push(finding('TCP-018', 'containment.root-ambiguity', 'resolved path is ambiguous across registered workspaces', '/path'));
      return failContainmentReport(findings);
    }
  }

  // 14/15. Immutable prospective decision + identity (only after success).
  const decisionBase: Omit<ExistingPathContainmentDecision, 'decisionIdentity'> = {
    containmentProtocolVersion: CONTAINMENT_PROTOCOL_VERSION,
    operationClass: CONTAINMENT_OPERATION_CLASS,
    purpose,
    configurationIdentity: configuration.identity,
    workspaceId,
    canonicalWorkspaceRelativePath: combined.relative,
    resolvedAbsolutePath: resolvedCanonical,
    pointOfUseRevalidationRequired: true,
  };

  let identity;
  try {
    identity = computeContainmentDecisionIdentity({
      ...decisionBase,
      hostLane: configuration.hostLane,
    });
  } catch {
    findings.push(finding('TCP-020', 'containment.identity-failed', 'containment decision identity computation failed', '$'));
    return failContainmentReport(findings);
  }
  if (!CONTAINMENT_DECISION_DIGEST_RE.test(identity.digest)) {
    findings.push(finding('TCP-020', 'containment.identity-failed', 'containment decision identity computation failed', '$'));
    return failContainmentReport(findings);
  }

  const decision: ExistingPathContainmentDecision = Object.freeze({
    ...decisionBase,
    decisionIdentity: identity.digest,
  });

  return Object.freeze({
    ok: true,
    findings: Object.freeze(sortContainmentFindings(findings)),
    decision,
  });
}
