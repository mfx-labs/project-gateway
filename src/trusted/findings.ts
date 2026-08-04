/**
 * Typed fail-closed findings for trusted-local configuration validation (WP-6
 * Phase 1).
 *
 * Trusted-configuration findings deliberately use a dedicated finding model
 * rather than the artifact-validation pipeline (ValidationPhase /
 * FailureCategory in `src/internal/phase.ts`): trusted configuration is NOT an
 * Artifact Core validation subject (F-EL4), and altering the committed
 * VALIDATION_PHASES contract would change the public artifact-phase ordering.
 * The shape follows the established finding conventions (stable code,
 * deterministic machine-readable message key, deterministic message, optional
 * location), and findings are emitted in a stable sorted order.
 *
 * Messages never echo workspace roots, filesystem paths, or secrets.
 */
export type TrustedConfigurationFindingCode =
  | 'TCF-001' // unsupported configuration version
  | 'TCF-002' // malformed configuration structure
  | 'TCF-003' // missing or malformed provenance
  | 'TCF-004' // untrusted provenance source (repository-controlled attempt)
  | 'TCF-005' // malformed workspace identifier
  | 'TCF-006' // duplicate workspace identifier
  | 'TCF-007' // malformed root path
  | 'TCF-008' // root resolution failure
  | 'TCF-009' // duplicate canonical root
  | 'TCF-010' // overlapping or parent-child root
  | 'TCF-011' // malformed capability ceiling
  | 'TCF-012' // unknown capability identifier
  | 'TCF-013' // duplicate capability declaration
  | 'TCF-014' // malformed numeric ceiling
  | 'TCF-015' // malformed trusted extension set
  | 'TCF-016' // unsupported runtime input structure
  | 'TCF-017' // snapshot or descriptor failure
  | 'TCF-018' // configuration identity failure
  | 'TCF-019' // mixed-version configuration
  | 'TCF-020' // missing capability vocabulary version
  | 'TCF-021' // unsupported capability vocabulary version
  | 'TCF-022' // malformed extension identity
  | 'TCF-023' // unsupported extension scope
  | 'TCF-024' // duplicate extension declaration
  | 'TCF-025' // unknown field (strict-shape violation)
  | 'TCF-026' // missing root resolver
  | 'TCF-027' // missing trusted host lane
  | 'TCF-028'; // unsupported trusted host lane

export interface TrustedConfigurationFinding {
  /** Stable fail-closed finding code (see catalog above). */
  readonly code: TrustedConfigurationFindingCode;
  /** Stable machine-readable message key. */
  readonly messageKey: string;
  /** Deterministic human-readable message (no roots, paths, or secrets). */
  readonly message: string;
  /** Input-relative location (e.g. `/workspaces/0`) where available. */
  readonly location?: string;
}

export interface TrustedConfigurationReport {
  readonly ok: boolean;
  readonly findings: readonly TrustedConfigurationFinding[];
  /** Present only when the complete configuration validated. */
  readonly configuration?: import('./types.js').ValidatedTrustedWorkspaceConfiguration;
}

export function trustedFinding(
  code: TrustedConfigurationFindingCode,
  messageKey: string,
  message: string,
  location?: string,
): TrustedConfigurationFinding {
  return Object.freeze({
    code,
    messageKey,
    message,
    ...(location !== undefined ? { location } : {}),
  });
}

/** Deterministic ordering: code, then location, then message key. */
import { compareStrings } from './ordering.js';

/** Deterministic ordering: code, then location, then message key (locale-independent, correction F-3). */
export function sortTrustedFindings(findings: readonly TrustedConfigurationFinding[]): TrustedConfigurationFinding[] {
  return [...findings].sort((a, b) => {
    if (a.code !== b.code) return compareStrings(a.code, b.code);
    const la = a.location ?? '';
    const lb = b.location ?? '';
    if (la !== lb) return compareStrings(la, lb);
    if (a.messageKey !== b.messageKey) return compareStrings(a.messageKey, b.messageKey);
    return 0;
  });
}

export function failTrustedReport(
  findings: readonly TrustedConfigurationFinding[],
): TrustedConfigurationReport {
  return Object.freeze({ ok: false, findings: Object.freeze(sortTrustedFindings(findings)) });
}
