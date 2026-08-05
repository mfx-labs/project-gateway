/**
 * WP-6 Phase 2A: typed fail-closed containment findings (TCP namespace).
 *
 * Configuration validation findings (TCF-001…TCF-029) describe the trusted
 * configuration object; containment findings (TCP-001…TCP-021) describe
 * candidate-path decision failures. The namespaces are separate so downstream
 * interpretation is never ambiguous.
 *
 * Messages are static and root-safe: no raw root, no absolute candidate
 * path, no secret, and no request content is ever echoed. Findings are
 * emitted in a stable sorted order (code, then location, then message key).
 */
import type { ExistingPathContainmentDecision } from './containment-types.js';
import { compareStrings } from './ordering.js';

export type ExistingPathContainmentFindingCode =
  | 'TCP-001' // unsupported or missing containment protocol version
  | 'TCP-002' // malformed request structure
  | 'TCP-003' // strict unknown-field violation
  | 'TCP-004' // unsupported purpose or operation
  | 'TCP-005' // absolute request path (POSIX, Windows drive, or UNC)
  | 'TCP-006' // empty or malformed relative path
  | 'TCP-007' // traversal escape
  | 'TCP-008' // NUL or control character
  | 'TCP-009' // unknown workspace
  | 'TCP-010' // configuration identity mismatch
  | 'TCP-011' // unsupported trusted host lane
  | 'TCP-012' // missing resolver
  | 'TCP-013' // resolver failure (thrown or reported error)
  | 'TCP-014' // broken or unresolved existing path
  | 'TCP-015' // symlink loop
  | 'TCP-016' // malformed resolver result
  | 'TCP-017' // resolved path outside workspace
  | 'TCP-018' // root or workspace ambiguity
  | 'TCP-019' // structural snapshot failure
  | 'TCP-020' // decision identity failure
  | 'TCP-021'; // unrecognized or non-genuine validated configuration

export interface ExistingPathContainmentFinding {
  /** Stable fail-closed finding code (see catalog above). */
  readonly code: ExistingPathContainmentFindingCode;
  /** Stable machine-readable message key. */
  readonly messageKey: string;
  /** Deterministic human-readable message (no roots, paths, or secrets). */
  readonly message: string;
  /** Request-relative location (e.g. `/path`) where available. */
  readonly location?: string;
}

export interface ExistingPathContainmentReport {
  readonly ok: boolean;
  readonly findings: readonly ExistingPathContainmentFinding[];
  /** Present only when the complete decision validated. */
  readonly decision?: ExistingPathContainmentDecision;
}

export function containmentFinding(
  code: ExistingPathContainmentFindingCode,
  messageKey: string,
  message: string,
  location?: string,
): ExistingPathContainmentFinding {
  return Object.freeze({
    code,
    messageKey,
    message,
    ...(location !== undefined ? { location } : {}),
  });
}

/** Deterministic ordering: code, then location, then message key (locale-independent). */
export function sortContainmentFindings(
  findings: readonly ExistingPathContainmentFinding[],
): ExistingPathContainmentFinding[] {
  return [...findings].sort((a, b) => {
    if (a.code !== b.code) return compareStrings(a.code, b.code);
    const la = a.location ?? '';
    const lb = b.location ?? '';
    if (la !== lb) return compareStrings(la, lb);
    if (a.messageKey !== b.messageKey) return compareStrings(a.messageKey, b.messageKey);
    return 0;
  });
}

export function failContainmentReport(
  findings: readonly ExistingPathContainmentFinding[],
): ExistingPathContainmentReport {
  return Object.freeze({
    ok: false,
    findings: Object.freeze(sortContainmentFindings(findings)),
  });
}
