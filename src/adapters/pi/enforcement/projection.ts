/**
 * WP-5B — capability → tool-profile projection (Part C/D).
 *
 * WP-5B never recomputes policy/grant semantics. It maps the evaluated
 * capability (from the validated, correlated EligibilityReport) to the
 * pi-guard tool surface and computes the deterministic projected allowed /
 * denied tool sets:
 *
 *  - exact case-sensitive tool identities; no aliases;
 *  - deny wins; unknown denied; extra tools denied;
 *  - unsupported required capability → projection fails (no partial output);
 *  - absent required profile tool → projection fails;
 *  - trusted source identity: required profile tools must come from the
 *    trusted/expected source (a declared expected source, or the default
 *    builtin expectation); an unexpected or unavailable source fails closed;
 *    every other surface tool is denied as an extra and never allowed.
 */
import { piGuardFinding as finding, sortGuardFindings as sortFindings } from './findings.js';
import type { GuardProjectionInput } from './types.js';

/** Research profile required builtins (research-class capability). */
export const RESEARCH_REQUIRED_TOOLS = Object.freeze(['read', 'grep', 'find', 'ls']);
/** Optional research tools admitted only when registered with a trusted source. */
export const OPTIONAL_FFF_TOOLS = Object.freeze(['ffgrep', 'fffind']);
/** Default expected source for Pi built-in research/authoring tools. */
export const BUILTIN_SOURCE = 'builtin';

export type ToolProfileKind =
  | 'research'
  | 'git-inspect'
  | 'edit'
  | 'write'
  | 'observational'
  | 'unsupported';

/** Deterministic projection of allowed/denied tool sets (no identity binding). */
export interface ToolProjection {
  readonly capability: string;
  readonly allowedToolNames: readonly string[];
  readonly deniedToolNames: readonly string[];
  readonly unsupportedRequiredCapabilities: readonly string[];
}

export type ToolProjectionResult =
  | { readonly ok: true; readonly projection: ToolProjection }
  | { readonly ok: false; readonly findings: readonly import('./types.js').GuardFinding[] };

/**
 * Deterministic capability → profile-kind mapping (capability-vocabulary v1).
 * Capabilities that cannot be enforced under the verified pi-guard lane
 * (bash is always blocked; no delete/move/git-mutate/network tool profile
 * exists in the verified surface) yield `unsupported` and fail projection.
 */
export function capabilityToProfileKind(capability: string): ToolProfileKind {
  switch (capability) {
    case 'project-gateway.workspace-read':
    case 'project-gateway.project-inspect':
    case 'project-gateway.artifact-draft':
      return 'research';
    case 'project-gateway.git-inspect':
      return 'git-inspect';
    case 'project-gateway.file-edit':
      return 'edit';
    case 'project-gateway.controlled-write':
    case 'project-gateway.file-create':
      return 'write';
    case 'project-gateway.tool-inventory-inspect':
      return 'observational';
    default:
      // shell-execute, git-mutate, file-delete, file-move, network-external,
      // service-local, pi-model-execute, pi-tool-execute, approval-operate,
      // lifecycle-issue, and any unknown capability: no enforceable profile.
      return 'unsupported';
  }
}

interface SourceExpectation {
  /** Expected exact source string; undefined = default builtin expectation. */
  readonly packageId?: string;
}

function expectedSourceFor(as: Readonly<Map<string, string>>, tool: string): SourceExpectation {
  const declared = as.get(tool);
  return declared !== undefined ? { packageId: declared } : {};
}

function sourceAccepted(observed: string, expectation: SourceExpectation): boolean {
  return expectation.packageId !== undefined ? observed === expectation.packageId : observed === BUILTIN_SOURCE;
}

/** Deterministic projection of the evaluated capability onto the tool surface. */
export function projectAllowedAndDenied(input: GuardProjectionInput): ToolProjectionResult {
  const profileKind = capabilityToProfileKind(input.capability);
  const surface = input.surface;

  if (profileKind === 'unsupported') {
    return {
      ok: false,
      findings: Object.freeze(
        sortFindings([
          finding('GUARD-PROJECTION-FAILURE', 'projection.capability-unsupported', `capability ${input.capability} has no enforceable tool profile under the verified pi-guard lane`),
        ]),
      ),
    };
  }

  if (profileKind === 'observational') {
    // Observation-only capability: no pi tools are authorized; every surface
    // tool is denied (an empty allowed profile is valid deny-all).
    return {
      ok: true,
      projection: Object.freeze({
        capability: input.capability,
        allowedToolNames: Object.freeze([]),
        deniedToolNames: surface.entries.map((e) => e.name),
        unsupportedRequiredCapabilities: Object.freeze([]),
      }),
    };
  }

  const expectations = new Map<string, string>(input.expectedToolSources.map((e) => [e.toolName, e.packageId] as const));

  const required: string[] = [...RESEARCH_REQUIRED_TOOLS];
  const optional: string[] = [...OPTIONAL_FFF_TOOLS];
  if (profileKind !== 'research') {
    const tool = profileKind === 'git-inspect' ? 'git_inspect' : profileKind === 'edit' ? 'edit' : profileKind === 'write' ? 'write' : '';
    if (tool !== '') required.push(tool);
  }

  const byName = new Map<string, string>();
  for (const entry of surface.entries) byName.set(entry.name, entry.source);

  const findings: import('./types.js').GuardFinding[] = [];
  const allowed: string[] = [];
  const denied: string[] = [];

  for (const tool of required) {
    const source = byName.get(tool);
    if (source === undefined) {
      findings.push(finding('GUARD-PROJECTION-FAILURE', 'projection.required-tool-absent', `required profile tool ${tool} is absent from the effective surface`));
      continue;
    }
    if (!sourceAccepted(source, expectedSourceFor(expectations, tool))) {
      findings.push(finding('GUARD-PROJECTION-FAILURE', 'projection.trusted-source-mismatch', `required profile tool ${tool} source is not the trusted expected source`));
      continue;
    }
    allowed.push(tool);
  }
  if (findings.length > 0) {
    return { ok: false, findings: Object.freeze(sortFindings(findings)) };
  }

  for (const tool of optional) {
    const source = byName.get(tool);
    if (source === undefined) continue;
    if (!sourceAccepted(source, expectedSourceFor(expectations, tool))) {
      // Unexpected source for an optional tool: denied as an extra; never allowed.
      denied.push(tool);
      continue;
    }
    allowed.push(tool);
  }

  for (const entry of surface.entries) {
    if (!allowed.includes(entry.name)) denied.push(entry.name);
  }

  return {
    ok: true,
    projection: Object.freeze({
      capability: input.capability,
      allowedToolNames: Object.freeze([...allowed].sort(compareNames)),
      deniedToolNames: Object.freeze([...denied].sort(compareNames)),
      unsupportedRequiredCapabilities: Object.freeze([]),
    }),
  };
}

/** Locale-independent comparison (exact names; deterministic bytes). */
export function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
