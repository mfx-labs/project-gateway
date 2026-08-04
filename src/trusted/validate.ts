/**
 * Trusted workspace configuration validation (WP-6 Phase 1, corrected).
 *
 * Deterministic, fail-closed validation of the trusted-local configuration
 * input:
 *
 * 1. trusted caller operands are checked first: the explicit trusted host
 *    lane (correction F-7; missing/unsupported lane fails closed, no ambient
 *    host probing) and the mandatory injected root resolver (correction F-2;
 *    no lexical-only validation mode exists);
 * 2. descriptor-derived snapshot hardening (no getter invocation, no
 *    protocol-significant Proxy `get` reads — arrays included (correction
 *    F-1), deep freeze, no rereading of caller containers);
 * 3. configuration-version and capability-vocabulary-version checks
 *    (explicit only; no inference from field presence; mixed versions
 *    rejected; no implicit upgrade or downgrade);
 * 4. strict recursive unknown-field rejection (correction F-4): unknown
 *    fields at every object layer are malformed configuration; misspelled or
 *    future fields are never silently ignored; symbol keys fail closed at
 *    the snapshot boundary;
 * 5. provenance checks (trusted-local control plane only; repository
 *    content can never supply provenance);
 * 6. workspace-identifier grammar and uniqueness (duplicates fail the
 *    ENTIRE load; no first-wins/last-wins/merge/load-order resolution);
 * 7. canonical-root registration uniqueness over symlink-resolved canonical
 *    roots (exact duplicates, parent-child, containment, and overlap fail
 *    the ENTIRE load; the mandatory resolver is the only host-boundary
 *    abstraction);
 * 8. global and workspace capability ceilings (accepted vocabulary only,
 *    duplicates rejected, canonical set ordering, missing vs explicitly
 *    empty preserved);
 * 9. numeric ceilings (non-negative safe integers; zero explicit; missing
 *    preserved as no quantitative restriction, never permission);
 * 10. trustedExtensionSet declarations (validated and frozen only; no Pi
 *     sampling; membership grants no capability);
 * 11. deterministic configuration identity over the complete validated
 *     configuration (locale-independent canonical ordering, accepted host
 *     lane bound, resolved canonical roots bound);
 * 12. deeply immutable validated output; raw canonical roots are
 *     trusted-process internal data and never appear in public identity,
 *     findings, or external representations.
 *
 * Phase 1 performs no project filesystem operations, no authority evaluation,
 * and no PointOfUseInputs v2 integration.
 */
import {
  snapshotTrustedWorkspaceConfigurationInput,
  TrustedSnapshotError,
} from './snapshot.js';
import {
  failTrustedReport,
  sortTrustedFindings,
  trustedFinding,
  type TrustedConfigurationFinding,
  type TrustedConfigurationReport,
} from './findings.js';
import { isValidWorkspaceId } from './workspace-id.js';
import {
  canonicalizeRoot,
  isRootAncestorOrEqual,
  type RootPathResolver,
} from './roots.js';
import {
  CAPABILITY_VOCABULARY_VERSION,
  canonicalCapabilitySet,
  isKnownCapability,
} from './capabilities.js';
import { validateNonNegativeSafeInteger } from './numeric.js';
import {
  TRUSTED_SOURCE_KIND,
  isTrustedSourceKind,
  type ValidatedTrustedConfigurationProvenance,
} from './provenance.js';
import {
  TRUSTED_HOST_LANE,
  isSupportedHostLane,
} from './host-lane.js';
import { compareStrings } from './ordering.js';
import {
  canonicalSortedStrings,
  isExtensionScope,
  isValidExtensionIdentity,
  type ValidatedExpectedToolSource,
  type ValidatedExtensionIdentity,
  type ValidatedTrustedExtensionSet,
} from './extension-set.js';
import { computeTrustedConfigurationIdentity, TRUSTED_CONFIG_DIGEST_RE } from './identity.js';
import {
  TRUSTED_CONFIGURATION_VERSION,
  type TrustedConfigurationValidationOptions,
  type ValidatedGlobalCapabilityCeiling,
  type ValidatedTrustedWorkspaceConfiguration,
  type ValidatedWorkspaceRecord,
} from './types.js';

function finding(
  code: TrustedConfigurationFinding['code'],
  messageKey: string,
  message: string,
  location?: string,
): TrustedConfigurationFinding {
  return trustedFinding(code, messageKey, message, location);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// strict unknown-field rejection (correction F-4)
// ---------------------------------------------------------------------------

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'configurationVersion',
  'capabilityVocabularyVersion',
  'provenance',
  'globalCapabilityCeiling',
  'globalActionCeiling',
  'trustedExtensionSet',
  'workspaces',
]);
const PROVENANCE_KEYS: ReadonlySet<string> = new Set(['sourceKind']);
const WORKSPACE_RECORD_KEYS: ReadonlySet<string> = new Set([
  'workspaceId',
  'root',
  'recordVersion',
  'capabilities',
  'actionCeiling',
]);
const GLOBAL_CEILING_KEYS: ReadonlySet<string> = new Set(['capabilities']);
const EXTENSION_SET_KEYS: ReadonlySet<string> = new Set([
  'version',
  'permittedExtensionIds',
  'supportedBuiltinToolIds',
  'trustedWebAccess',
  'expectedToolSources',
]);
const WEB_ACCESS_ENTRY_KEYS: ReadonlySet<string> = new Set(['packageId', 'version']);
const TOOL_SOURCE_ENTRY_KEYS: ReadonlySet<string> = new Set(['toolName', 'packageId', 'scope']);

/**
 * Reject unexpected own string keys of a protocol object. Symbol keys are
 * rejected earlier at the snapshot boundary (symbols are not representable in
 * the canonical JSON input contract). Returns false (after emitting a typed
 * finding) when any unknown field is present.
 */
function checkUnknownFields(
  container: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  location: string,
  findings: TrustedConfigurationFinding[],
): boolean {
  for (const key of Object.keys(container)) {
    if (!allowed.has(key)) {
      findings.push(finding(
        'TCF-025',
        'trusted-config.unknown-field',
        'configuration contains a field that is not part of the trusted configuration protocol',
        location,
      ));
      return false;
    }
  }
  return true;
}

/** Presence-aware capability-set field: distinguishes absent from explicitly empty from invalid. */
interface CapabilitySetField {
  readonly declared: boolean;
  readonly set?: readonly string[];
}

function validateCapabilitySetField(
  container: Record<string, unknown>,
  key: string,
  location: string,
  findings: TrustedConfigurationFinding[],
): CapabilitySetField {
  const raw = container[key];
  if (raw === undefined) return { declared: false };
  if (!Array.isArray(raw)) {
    findings.push(finding('TCF-011', 'trusted-config.capability-ceiling-malformed', 'capability ceiling is not an array', location));
    return { declared: true };
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item !== 'string') {
      findings.push(finding('TCF-011', 'trusted-config.capability-ceiling-malformed', 'capability ceiling entry is not a string', `${location}/${i}`));
      return { declared: true };
    }
    if (!isKnownCapability(item)) {
      findings.push(finding('TCF-012', 'trusted-config.capability-unknown', 'unknown capability identifier', `${location}/${i}`));
      return { declared: true };
    }
    if (seen.has(item)) {
      findings.push(finding('TCF-013', 'trusted-config.capability-duplicate', 'duplicate capability declaration', `${location}/${i}`));
      return { declared: true };
    }
    seen.add(item);
    out.push(item);
  }
  return { declared: true, set: canonicalCapabilitySet(out) };
}

function validateNumericCeiling(
  value: unknown,
  location: string,
  findings: TrustedConfigurationFinding[],
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !validateNonNegativeSafeInteger(value)) {
    findings.push(finding('TCF-014', 'trusted-config.numeric-ceiling-malformed', 'numeric ceiling is not a non-negative safe integer', location));
    return undefined;
  }
  // Negative zero is canonicalized to zero (repository canonical-number rule).
  return value === 0 ? 0 : value;
}

function validateGlobalCeiling(
  value: unknown,
  findings: TrustedConfigurationFinding[],
): ValidatedGlobalCapabilityCeiling | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    findings.push(finding('TCF-011', 'trusted-config.capability-ceiling-malformed', 'global capability ceiling is not an object', '/globalCapabilityCeiling'));
    return undefined;
  }
  if (!checkUnknownFields(value, GLOBAL_CEILING_KEYS, '/globalCapabilityCeiling', findings)) return undefined;
  const cap = validateCapabilitySetField(value, 'capabilities', '/globalCapabilityCeiling/capabilities', findings);
  if (cap.declared && cap.set === undefined) return undefined;
  // Missing capabilities inside a declared ceiling are preserved as absent
  // (semantically "empty set = deny all" in later phases; presence is bound
  // into the configuration identity).
  return Object.freeze({
    ...(cap.set !== undefined ? { capabilities: cap.set } : {}),
  });
}

function validateExtensionSet(
  value: unknown,
  findings: TrustedConfigurationFinding[],
): ValidatedTrustedExtensionSet | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    findings.push(finding('TCF-015', 'trusted-config.extension-set-malformed', 'trusted extension set is not an object', '/trustedExtensionSet'));
    return undefined;
  }
  if (!checkUnknownFields(value, EXTENSION_SET_KEYS, '/trustedExtensionSet', findings)) return undefined;
  const version = value['version'];
  if (typeof version !== 'string' || version.length === 0) {
    findings.push(finding('TCF-015', 'trusted-config.extension-set-malformed', 'trusted extension set version is missing or malformed', '/trustedExtensionSet/version'));
    return undefined;
  }

  const stringList = (raw: unknown, key: string): readonly string[] | undefined => {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw)) {
      findings.push(finding('TCF-015', 'trusted-config.extension-set-malformed', 'extension set field is not an array', `/trustedExtensionSet/${key}`));
      return undefined;
    }
    const out: string[] = [];
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      if (typeof item !== 'string' || !isValidExtensionIdentity(item)) {
        findings.push(finding('TCF-022', 'trusted-config.extension-identity-malformed', 'extension identity is malformed', `/trustedExtensionSet/${key}/${i}`));
        return undefined;
      }
      out.push(item);
    }
    const seen = new Set<string>();
    for (const id of out) {
      if (seen.has(id)) {
        findings.push(finding('TCF-024', 'trusted-config.extension-duplicate', 'duplicate extension declaration', `/trustedExtensionSet/${key}`));
        return undefined;
      }
      seen.add(id);
    }
    return canonicalSortedStrings(out);
  };

  const permitted = stringList(value['permittedExtensionIds'], 'permittedExtensionIds');
  if (permitted === undefined && value['permittedExtensionIds'] !== undefined) return undefined;
  const builtins = stringList(value['supportedBuiltinToolIds'], 'supportedBuiltinToolIds');
  if (builtins === undefined && value['supportedBuiltinToolIds'] !== undefined) return undefined;

  // Trusted web-access declarations: identity + version pairs.
  let webAccess: readonly ValidatedExtensionIdentity[] | undefined;
  if (value['trustedWebAccess'] !== undefined) {
    const raw = value['trustedWebAccess'];
    if (!Array.isArray(raw)) {
      findings.push(finding('TCF-015', 'trusted-config.extension-set-malformed', 'trusted web access is not an array', '/trustedExtensionSet/trustedWebAccess'));
      return undefined;
    }
    const items: ValidatedExtensionIdentity[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < raw.length; i++) {
      const entry = raw[i];
      if (!isRecord(entry)) {
        findings.push(finding('TCF-022', 'trusted-config.extension-identity-malformed', 'web-access declaration is not an object', `/trustedExtensionSet/trustedWebAccess/${i}`));
        return undefined;
      }
      if (!checkUnknownFields(entry, WEB_ACCESS_ENTRY_KEYS, `/trustedExtensionSet/trustedWebAccess/${i}`, findings)) return undefined;
      const packageId = entry['packageId'];
      const ver = entry['version'];
      if (typeof packageId !== 'string' || !isValidExtensionIdentity(packageId) || typeof ver !== 'string' || ver.length === 0) {
        findings.push(finding('TCF-022', 'trusted-config.extension-identity-malformed', 'web-access identity or version is malformed', `/trustedExtensionSet/trustedWebAccess/${i}`));
        return undefined;
      }
      const key = `${packageId}@${ver}`;
      if (seen.has(key)) {
        findings.push(finding('TCF-024', 'trusted-config.extension-duplicate', 'duplicate web-access declaration', `/trustedExtensionSet/trustedWebAccess/${i}`));
        return undefined;
      }
      seen.add(key);
      items.push(Object.freeze({ packageId, version: ver }));
    }
    webAccess = Object.freeze(
      [...items].sort((a, b) => compareStrings(a.packageId, b.packageId) || compareStrings(a.version, b.version)),
    );
  }

  // Expected effective sources for security-relevant tools.
  let expectedSources: readonly ValidatedExpectedToolSource[] | undefined;
  if (value['expectedToolSources'] !== undefined) {
    const raw = value['expectedToolSources'];
    if (!Array.isArray(raw)) {
      findings.push(finding('TCF-015', 'trusted-config.extension-set-malformed', 'expected tool sources is not an array', '/trustedExtensionSet/expectedToolSources'));
      return undefined;
    }
    const items: ValidatedExpectedToolSource[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < raw.length; i++) {
      const entry = raw[i];
      if (!isRecord(entry)) {
        findings.push(finding('TCF-022', 'trusted-config.extension-identity-malformed', 'expected tool source is not an object', `/trustedExtensionSet/expectedToolSources/${i}`));
        return undefined;
      }
      if (!checkUnknownFields(entry, TOOL_SOURCE_ENTRY_KEYS, `/trustedExtensionSet/expectedToolSources/${i}`, findings)) return undefined;
      const toolName = entry['toolName'];
      const packageId = entry['packageId'];
      const scope = entry['scope'];
      if (typeof toolName !== 'string' || !isValidExtensionIdentity(toolName)) {
        findings.push(finding('TCF-022', 'trusted-config.extension-identity-malformed', 'expected tool source tool name is malformed', `/trustedExtensionSet/expectedToolSources/${i}`));
        return undefined;
      }
      if (typeof packageId !== 'string' || !isValidExtensionIdentity(packageId)) {
        findings.push(finding('TCF-022', 'trusted-config.extension-identity-malformed', 'expected tool source package identity is malformed', `/trustedExtensionSet/expectedToolSources/${i}`));
        return undefined;
      }
      if (typeof scope !== 'string' || !isExtensionScope(scope)) {
        findings.push(finding('TCF-023', 'trusted-config.extension-scope-unsupported', 'expected tool source scope is unsupported', `/trustedExtensionSet/expectedToolSources/${i}`));
        return undefined;
      }
      const key = `${toolName}\u0000${packageId}\u0000${scope}`;
      if (seen.has(key)) {
        findings.push(finding('TCF-024', 'trusted-config.extension-duplicate', 'duplicate expected tool source declaration', `/trustedExtensionSet/expectedToolSources/${i}`));
        return undefined;
      }
      seen.add(key);
      items.push(Object.freeze({ toolName, packageId, scope }));
    }
    expectedSources = Object.freeze(
      [...items].sort((a, b) =>
        compareStrings(a.toolName, b.toolName)
        || compareStrings(a.packageId, b.packageId)
        || compareStrings(a.scope, b.scope),
      ),
    );
  }

  return Object.freeze({
    version,
    permittedExtensionIds: permitted ?? Object.freeze([]),
    supportedBuiltinToolIds: builtins ?? Object.freeze([]),
    trustedWebAccess: webAccess ?? Object.freeze([]),
    expectedToolSources: expectedSources ?? Object.freeze([]),
  });
}

/**
 * Validate a complete trusted workspace configuration input.
 * Deterministic and fail closed; returns a typed report. Trusted caller
 * operands (host lane, root resolver) are mandatory: a missing resolver or
 * unsupported lane can never produce a validated configuration, and no
 * lexical-only validation mode exists. The validated configuration (when
 * `ok`) is deeply immutable, carries the accepted host lane and its
 * deterministic identity, and exposes no raw roots through public fields.
 */
export function validateTrustedWorkspaceConfiguration(
  input: unknown,
  options: TrustedConfigurationValidationOptions,
): TrustedConfigurationReport {
  const findings: TrustedConfigurationFinding[] = [];

  // 0. Trusted caller operands (deterministic, checked before input handling).
  const hostLane = options.hostLane;
  if (typeof hostLane !== 'string' || hostLane.length === 0) {
    findings.push(finding('TCF-027', 'trusted-config.host-lane-missing', 'trusted host lane operand is missing', '/options/hostLane'));
    return failTrustedReport(findings);
  }
  if (!isSupportedHostLane(hostLane)) {
    findings.push(finding('TCF-028', 'trusted-config.host-lane-unsupported', 'trusted host lane is not the accepted supported lane', '/options/hostLane'));
    return failTrustedReport(findings);
  }
  const resolveRootPath: RootPathResolver = options.resolveRootPath;
  if (typeof resolveRootPath !== 'function') {
    findings.push(finding('TCF-026', 'trusted-config.root-resolver-missing', 'root path resolver is required for trusted validation', '/options/resolveRootPath'));
    return failTrustedReport(findings);
  }

  let snapshot: unknown;
  try {
    snapshot = snapshotTrustedWorkspaceConfigurationInput(input);
  } catch (err) {
    if (err instanceof TrustedSnapshotError) {
      const code = err.kind === 'descriptor-introspection-failed' ? 'TCF-017' : 'TCF-016';
      findings.push(finding(code, 'trusted-config.snapshot-failed', 'trusted configuration input structure is unsupported or hostile', '$'));
    } else {
      findings.push(finding('TCF-017', 'trusted-config.snapshot-failed', 'snapshot or descriptor introspection failed', '$'));
    }
    return failTrustedReport(findings);
  }

  if (!isRecord(snapshot)) {
    findings.push(finding('TCF-002', 'trusted-config.structure-malformed', 'trusted configuration input is not an object', '$'));
    return failTrustedReport(findings);
  }

  // 1. Configuration version: explicit only, never inferred from fields.
  const configurationVersion = snapshot['configurationVersion'];
  if (typeof configurationVersion !== 'string' || configurationVersion.length === 0) {
    findings.push(finding('TCF-001', 'trusted-config.version-missing', 'configuration version is missing', '/configurationVersion'));
    return failTrustedReport(findings);
  }
  if (configurationVersion !== TRUSTED_CONFIGURATION_VERSION) {
    findings.push(finding('TCF-001', 'trusted-config.version-unsupported', 'unsupported configuration version', '/configurationVersion'));
    return failTrustedReport(findings);
  }

  // 2. Capability vocabulary version: explicit, no inference, no auto-upgrade.
  const vocabularyVersion = snapshot['capabilityVocabularyVersion'];
  if (typeof vocabularyVersion !== 'string' || vocabularyVersion.length === 0) {
    findings.push(finding('TCF-020', 'trusted-config.vocabulary-version-missing', 'capability vocabulary version is missing', '/capabilityVocabularyVersion'));
    return failTrustedReport(findings);
  }
  if (vocabularyVersion !== CAPABILITY_VOCABULARY_VERSION) {
    findings.push(finding('TCF-021', 'trusted-config.vocabulary-version-unsupported', 'unsupported capability vocabulary version', '/capabilityVocabularyVersion'));
    return failTrustedReport(findings);
  }

  // 3. Top-level strict shape.
  if (!checkUnknownFields(snapshot, TOP_LEVEL_KEYS, '$', findings)) {
    return failTrustedReport(findings);
  }

  // 4. Provenance: trusted-local control plane only.
  const provenanceRaw = snapshot['provenance'];
  if (!isRecord(provenanceRaw)) {
    findings.push(finding('TCF-003', 'trusted-config.provenance-missing', 'trusted configuration provenance is missing or malformed', '/provenance'));
    return failTrustedReport(findings);
  }
  if (!checkUnknownFields(provenanceRaw, PROVENANCE_KEYS, '/provenance', findings)) {
    return failTrustedReport(findings);
  }
  const sourceKind = provenanceRaw['sourceKind'];
  if (typeof sourceKind !== 'string') {
    findings.push(finding('TCF-003', 'trusted-config.provenance-malformed', 'trusted configuration provenance source kind is missing or malformed', '/provenance/sourceKind'));
    return failTrustedReport(findings);
  }
  if (!isTrustedSourceKind(sourceKind)) {
    // Includes repository-controlled provenance attempts (e.g. sourceKind
    // values naming repository or `.pi` origins).
    findings.push(finding('TCF-004', 'trusted-config.provenance-untrusted-source', 'provenance source is not the trusted local control plane', '/provenance/sourceKind'));
    return failTrustedReport(findings);
  }
  const provenance: ValidatedTrustedConfigurationProvenance = Object.freeze({ sourceKind: TRUSTED_SOURCE_KIND });

  // 5. Global ceilings.
  const globalCapabilityCeiling = validateGlobalCeiling(snapshot['globalCapabilityCeiling'], findings);
  if (globalCapabilityCeiling === undefined && snapshot['globalCapabilityCeiling'] !== undefined) {
    return failTrustedReport(findings);
  }
  const globalActionCeiling = validateNumericCeiling(snapshot['globalActionCeiling'], '/globalActionCeiling', findings);
  if (globalActionCeiling === undefined && snapshot['globalActionCeiling'] !== undefined) {
    return failTrustedReport(findings);
  }

  // 6. trustedExtensionSet (validated and frozen declarations only).
  const trustedExtensionSet = validateExtensionSet(snapshot['trustedExtensionSet'], findings);
  if (trustedExtensionSet === undefined && snapshot['trustedExtensionSet'] !== undefined) {
    return failTrustedReport(findings);
  }

  // 7. Workspaces.
  const workspacesRaw = snapshot['workspaces'];
  if (!Array.isArray(workspacesRaw)) {
    findings.push(finding('TCF-002', 'trusted-config.structure-malformed', 'workspaces is not an array', '/workspaces'));
    return failTrustedReport(findings);
  }

  const records: ValidatedWorkspaceRecord[] = [];
  const seenIds = new Set<string>();
  const rootList: string[] = [];

  for (let i = 0; i < workspacesRaw.length; i++) {
    const location = `/workspaces/${i}`;
    const entry = workspacesRaw[i];
    if (!isRecord(entry)) {
      findings.push(finding('TCF-002', 'trusted-config.structure-malformed', 'workspace entry is not an object', location));
      return failTrustedReport(findings);
    }

    // Strict workspace-record shape first.
    if (!checkUnknownFields(entry, WORKSPACE_RECORD_KEYS, location, findings)) {
      return failTrustedReport(findings);
    }

    // Workspace identifier.
    const workspaceId = entry['workspaceId'];
    if (typeof workspaceId !== 'string' || !isValidWorkspaceId(workspaceId)) {
      findings.push(finding('TCF-005', 'trusted-config.workspace-id-malformed', 'workspace identifier is missing or malformed', `${location}/workspaceId`));
      return failTrustedReport(findings);
    }
    if (seenIds.has(workspaceId)) {
      findings.push(finding('TCF-006', 'trusted-config.workspace-id-duplicate', 'duplicate workspace identifier', `${location}/workspaceId`));
      return failTrustedReport(findings);
    }
    seenIds.add(workspaceId);

    // Mixed-version rule: any declared record version must equal the top-level version.
    const recordVersion = entry['recordVersion'];
    if (recordVersion !== undefined) {
      if (typeof recordVersion !== 'string' || recordVersion !== TRUSTED_CONFIGURATION_VERSION) {
        findings.push(finding('TCF-019', 'trusted-config.version-mixed', 'workspace record version does not match the configuration version', `${location}/recordVersion`));
        return failTrustedReport(findings);
      }
    }

    // Root: mandatory symlink resolution through the injected resolver; the
    // resolved canonical root is the only root used for uniqueness and
    // identity (no lexical-only mode).
    const root = entry['root'];
    if (typeof root !== 'string') {
      findings.push(finding('TCF-007', 'trusted-config.root-malformed', 'workspace root is missing or malformed', `${location}/root`));
      return failTrustedReport(findings);
    }
    const canonical = canonicalizeRoot(root, resolveRootPath);
    if (!canonical.ok) {
      const code = canonical.code === 'resolution-failed' ? 'TCF-008' : 'TCF-007';
      const key = canonical.code === 'resolution-failed' ? 'trusted-config.root-resolution-failed' : 'trusted-config.root-malformed';
      findings.push(finding(code, key, 'workspace root cannot be canonicalized', `${location}/root`));
      return failTrustedReport(findings);
    }

    // Root uniqueness over resolved canonical roots: duplicates,
    // parent-child, containment, and overlap fail the entire load.
    for (const existing of rootList) {
      if (existing === canonical.canonical) {
        findings.push(finding('TCF-009', 'trusted-config.root-duplicate', 'duplicate canonical workspace root', `${location}/root`));
        return failTrustedReport(findings);
      }
      if (isRootAncestorOrEqual(existing, canonical.canonical) || isRootAncestorOrEqual(canonical.canonical, existing)) {
        findings.push(finding('TCF-010', 'trusted-config.root-overlap', 'workspace roots overlap or one contains another', `${location}/root`));
        return failTrustedReport(findings);
      }
    }
    rootList.push(canonical.canonical);

    // Workspace capability ceiling (presence-aware).
    const cap = validateCapabilitySetField(entry, 'capabilities', `${location}/capabilities`, findings);
    if (cap.declared && cap.set === undefined) {
      return failTrustedReport(findings);
    }

    // Workspace numeric ceiling.
    const actionCeiling = validateNumericCeiling(entry['actionCeiling'], `${location}/actionCeiling`, findings);
    if (actionCeiling === undefined && entry['actionCeiling'] !== undefined) {
      return failTrustedReport(findings);
    }

    const record: ValidatedWorkspaceRecord = Object.freeze({
      workspaceId,
      canonicalRoot: canonical.canonical,
      ...(cap.set !== undefined ? { capabilities: cap.set } : {}),
      ...(actionCeiling !== undefined ? { actionCeiling } : {}),
    });
    records.push(record);
  }

  // Canonical workspace ordering (registration order is non-semantic for
  // identity; locale-independent code-unit ordering, correction F-3).
  const orderedRecords = Object.freeze(
    [...records].sort((a, b) => compareStrings(a.workspaceId, b.workspaceId)),
  );

  const configuration: ValidatedTrustedWorkspaceConfiguration = Object.freeze({
    configurationVersion: TRUSTED_CONFIGURATION_VERSION,
    capabilityVocabularyVersion: CAPABILITY_VOCABULARY_VERSION,
    hostLane: TRUSTED_HOST_LANE,
    provenance,
    ...(globalCapabilityCeiling !== undefined ? { globalCapabilityCeiling } : {}),
    ...(globalActionCeiling !== undefined ? { globalActionCeiling } : {}),
    ...(trustedExtensionSet !== undefined ? { trustedExtensionSet } : {}),
    workspaces: orderedRecords,
    identity: '',
  });

  // 8. Deterministic configuration identity (binds every protocol-significant
  // field, the accepted host lane, and the resolved canonical roots).
  let identity;
  try {
    identity = computeTrustedConfigurationIdentity(configuration);
  } catch {
    findings.push(finding('TCF-018', 'trusted-config.identity-failed', 'configuration identity computation failed', '$'));
    return failTrustedReport(findings);
  }
  if (!TRUSTED_CONFIG_DIGEST_RE.test(identity.digest)) {
    findings.push(finding('TCF-018', 'trusted-config.identity-failed', 'configuration identity computation failed', '$'));
    return failTrustedReport(findings);
  }

  const validated: ValidatedTrustedWorkspaceConfiguration = Object.freeze({
    ...configuration,
    identity: identity.digest,
  });

  return Object.freeze({
    ok: true,
    findings: Object.freeze(sortTrustedFindings(findings)),
    configuration: validated,
  });
}

/**
 * Deterministic workspace lookup on a validated configuration.
 * Returns the validated record for the exact workspace identity, or undefined.
 */
export function lookupValidatedWorkspace(
  configuration: ValidatedTrustedWorkspaceConfiguration,
  workspaceId: string,
): ValidatedWorkspaceRecord | undefined {
  for (const record of configuration.workspaces) {
    if (record.workspaceId === workspaceId) return record;
  }
  return undefined;
}
