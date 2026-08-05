/**
 * WP-6 Phase 2B: typed fail-closed destination-containment findings (TAD
 * namespace).
 *
 * TCF findings describe trusted configuration; TCP findings describe
 * existing-path containment; TAD findings describe prospective artifact-draft
 * destination containment. The namespaces are separate so downstream
 * interpretation is never ambiguous.
 *
 * Messages are static, deterministic, and root-safe/path-safe: no configured
 * or canonical root, no caller destination text, no resolver evidence value,
 * and no secret is ever echoed. Findings are emitted in a stable sorted
 * order (code, then location, then message key).
 */
import type { ProspectiveArtifactDestinationDecision } from './destination-types.js';
import { compareStrings } from './ordering.js';

export type DestinationContainmentFindingCode =
  | 'TAD-001' // non-genuine configuration
  | 'TAD-002' // unsupported configuration version (only version 2 is accepted)
  | 'TAD-003' // unknown workspace
  | 'TAD-004' // no configured artifact location
  | 'TAD-005' // expected configuration identity mismatch
  | 'TAD-006' // unsupported artifact kind
  | 'TAD-007' // malformed request record (hostile or unknown fields)
  | 'TAD-008' // malformed destination
  | 'TAD-009' // absolute, Windows, or UNC destination
  | 'TAD-010' // prohibited traversal or dot component
  | 'TAD-011' // invalid separator or character
  | 'TAD-012' // request length exceeded
  | 'TAD-013' // missing resolver
  | 'TAD-014' // resolver failure (thrown or reported resolver-wide error)
  | 'TAD-015' // malformed success evidence
  | 'TAD-016' // malformed failure evidence
  | 'TAD-017' // unknown failure subject
  | 'TAD-018' // unknown failure code
  | 'TAD-019' // incompatible subject/code pair
  | 'TAD-020' // hostile or structurally invalid evidence (capture failure)
  | 'TAD-021' // artifact root not found
  | 'TAD-022' // artifact root not a directory
  | 'TAD-023' // artifact root unsupported kind
  | 'TAD-024' // artifact root loop
  | 'TAD-025' // artifact root inaccessible, ambiguous, or unresolved
  | 'TAD-026' // artifact root canonical mismatch (stale or changed root)
  | 'TAD-027' // no valid existing directory ancestor
  | 'TAD-028' // existing ancestor not a directory
  | 'TAD-029' // existing ancestor unsupported kind
  | 'TAD-030' // intermediate dangling symlink
  | 'TAD-031' // existing ancestor loop
  | 'TAD-032' // existing ancestor inaccessible, ambiguous, or unresolved
  | 'TAD-033' // canonical ancestor outside artifact root
  | 'TAD-034' // cross-workspace ancestor ambiguity (defense-in-depth)
  | 'TAD-035' // lexical prefix mismatch
  | 'TAD-036' // destination tail mismatch
  | 'TAD-037' // target-state/tail inconsistency
  | 'TAD-038' // alias-correlation evidence inconsistency
  | 'TAD-039' // final target already exists as a regular file
  | 'TAD-040' // final target already exists as a directory
  | 'TAD-041' // final target exists as a symlink
  | 'TAD-042' // final target is a dangling symlink
  | 'TAD-043' // final target has an unsupported entry kind
  | 'TAD-044' // final-target observation failure
  | 'TAD-045'; // decision identity failure

export interface DestinationContainmentFinding {
  /** Stable fail-closed finding code (see catalog above). */
  readonly code: DestinationContainmentFindingCode;
  /** Stable machine-readable message key. */
  readonly messageKey: string;
  /** Deterministic human-readable message (no roots, paths, or secrets). */
  readonly message: string;
  /** Request-relative location (e.g. `/destination`) where available. */
  readonly location?: string;
}

export interface ProspectiveArtifactDestinationReport {
  readonly ok: boolean;
  readonly findings: readonly DestinationContainmentFinding[];
  /** Present only when the complete decision validated. */
  readonly decision?: ProspectiveArtifactDestinationDecision;
}

export function destinationFinding(
  code: DestinationContainmentFindingCode,
  messageKey: string,
  message: string,
  location?: string,
): DestinationContainmentFinding {
  return Object.freeze({
    code,
    messageKey,
    message,
    ...(location !== undefined ? { location } : {}),
  });
}

/** Deterministic ordering: code, then location, then message key (locale-independent). */
export function sortDestinationFindings(
  findings: readonly DestinationContainmentFinding[],
): DestinationContainmentFinding[] {
  return [...findings].sort((a, b) => {
    if (a.code !== b.code) return compareStrings(a.code, b.code);
    const la = a.location ?? '';
    const lb = b.location ?? '';
    if (la !== lb) return compareStrings(la, lb);
    if (a.messageKey !== b.messageKey) return compareStrings(a.messageKey, b.messageKey);
    return 0;
  });
}

export function failDestinationReport(
  findings: readonly DestinationContainmentFinding[],
): ProspectiveArtifactDestinationReport {
  return Object.freeze({ ok: false, findings: Object.freeze(sortDestinationFindings(findings)) });
}
