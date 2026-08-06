/**
 * WP-8 typed-identifier parser (contract 5.3, LAY-003/004; W8A-R01 model).
 *
 * Pure parser: validates the complete canonical WP-2 typed identifier,
 * validates the required accepted prefix for the requested class, and
 * extracts exactly 32 lowercase hexadecimal opaque characters verbatim.
 * Uppercase input is rejected, never normalized. No filesystem authority is
 * exposed.
 */
import {
  ACCEPTED_IDENTIFIER_PREFIXES,
  OPAQUE_IDENTIFIER_LENGTH,
  type AcceptedIdentifierPrefix,
  type TypedIdentifier,
} from '../types.js';

const HEX32_RE = /^[0-9a-f]{32}$/;

export type IdentifierParseResult =
  | { readonly ok: true; readonly identifier: TypedIdentifier }
  | { readonly ok: false; readonly reason: IdentifierRejectReason };

export type IdentifierRejectReason =
  | 'empty'
  | 'too-short'
  | 'too-long'
  | 'wrong-prefix'
  | 'uppercase'
  | 'invalid-character'
  | 'non-ascii'
  | 'non-canonical';

/**
 * Parse a complete canonical typed identifier.
 *
 * @param raw     the complete canonical identifier string
 * @param requirePrefix optional accepted prefix required for the requested class
 */
export function parseTypedIdentifier(raw: string, requirePrefix?: AcceptedIdentifierPrefix): IdentifierParseResult {
  if (raw.length === 0) return { ok: false, reason: 'empty' };
  // ASCII-only guard before any other classification.
  for (let i = 0; i < raw.length; i++) {
    if (raw.charCodeAt(i) > 0x7f) return { ok: false, reason: 'non-ascii' };
  }
  const prefix = ACCEPTED_IDENTIFIER_PREFIXES.find((p) => raw.startsWith(p));
  if (prefix === undefined) return { ok: false, reason: 'wrong-prefix' };
  if (requirePrefix !== undefined && prefix !== requirePrefix) return { ok: false, reason: 'wrong-prefix' };
  const opaque = raw.slice(prefix.length);
  if (opaque.length === 0) return { ok: false, reason: 'empty' };
  if (opaque.length < OPAQUE_IDENTIFIER_LENGTH) return { ok: false, reason: 'too-short' };
  if (opaque.length > OPAQUE_IDENTIFIER_LENGTH) return { ok: false, reason: 'too-long' };
  if (opaque !== opaque.toLowerCase()) return { ok: false, reason: 'uppercase' };
  if (!HEX32_RE.test(opaque)) return { ok: false, reason: 'invalid-character' };
  return { ok: true, identifier: { raw, prefix, opaque } };
}

/** Deterministic canonical check: the raw string must equal its own canonical form. */
export function isCanonicalTypedIdentifier(raw: string): boolean {
  const r = parseTypedIdentifier(raw);
  return r.ok && r.identifier.raw === raw;
}
