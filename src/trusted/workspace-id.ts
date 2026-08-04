/**
 * Opaque trusted workspace identifier (WP-6 Phase 1).
 *
 * Accepted grammar (canonical, documented):
 *
 *   pgw:w:<opaque>
 *
 * where `<opaque>` is 8..128 characters from the restricted opaque set
 * `[a-z0-9_-]` (lowercase letters, digits, hyphen, underscore). The grammar is
 * consistent with the committed `pgw:w:` workspace-binding model (fixture
 * workspace identifiers use `pgw:w:` plus a 32-character lowercase hex
 * opaque token).
 *
 * Properties:
 * - no filesystem root, path separator, or machine-specific value can be
 *   embedded in the public identifier (the restricted set contains no `/`,
 *   `.`, `:`, or whitespace);
 * - identity is exact and case-sensitive (lowercase-only grammar removes
 *   case-folding ambiguity on the supported Linux lane);
 * - empty and malformed identifiers are rejected;
 * - duplicate identifiers fail the entire trusted configuration load (the
 *   validator enforces this; no first-wins/last-wins/merge/load-order
 *   resolution exists);
 * - identifiers never disclose roots through serialization, errors, or
 *   public display fields.
 */
export const WORKSPACE_ID_PREFIX = 'pgw:w:';

export const WORKSPACE_ID_PATTERN = /^pgw:w:[a-z0-9_-]{8,128}$/;

export function isValidWorkspaceId(value: string): boolean {
  return WORKSPACE_ID_PATTERN.test(value);
}
