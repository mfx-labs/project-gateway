/**
 * Authoritative media-type parsing and normalization (WP-5A R-1/R-2).
 *
 * One narrow, deterministic, side-effect-free parser owned by both the
 * capability inspector (`compatibility.ts`) and context correlation
 * (`context.ts`). It accepts `unknown` values, never coerces, never invokes
 * `toString`/`valueOf`, never reads accessors, and never triggers proxy
 * conversion traps, so malformed caller input fails closed with stable
 * adapter findings instead of raw exceptions.
 *
 * Two documented modes share one parse core:
 *
 * - declaration mode (`parseMediaDeclaration`) — capability entries must be
 *   bare `type/subtype` tokens: primitive strings only, no wildcards, no
 *   parameters, no internal whitespace.
 * - item mode (`parseMediaType`) — context-item matching strips media
 *   parameters per the documented matching rule before validation, so
 *   `text/plain; charset=utf-8` normalizes to `text/plain`.
 *
 * Normalization is lowercase `type/subtype`; matching stays exact and
 * non-widening (`text/plain` never authorizes `text/markdown`); wildcards
 * remain unsupported.
 */

export type MediaTypeParseStatus = 'valid' | 'not-a-string' | 'wildcard' | 'malformed';

export interface MediaTypeParseResult {
  readonly status: MediaTypeParseStatus;
  /** Lowercase `type/subtype` form when valid. */
  readonly normalized?: string;
  /** The raw string value when the input was a string (finding messages only). */
  readonly raw?: string;
}

/** A valid parsed media type: normalized form plus the raw string. */
export interface ParsedMediaType {
  readonly normalized: string;
  readonly raw: string;
}

function parseCore(value: unknown, stripParameters: boolean): MediaTypeParseResult {
  // primitive strings only: undefined/null/number/bigint/boolean/symbol/
  // function/array/object/String-wrapper values are rejected without any
  // coercion or hook invocation
  if (typeof value !== 'string') {
    return { status: 'not-a-string' };
  }
  const raw = value;
  let token = raw.trim();
  if (token === '') return { status: 'malformed', raw };
  if (stripParameters) {
    const semi = token.indexOf(';');
    if (semi !== -1) token = token.slice(0, semi).trim();
  }
  if (token.includes('*')) return { status: 'wildcard', raw };
  if (token.includes(';')) return { status: 'malformed', raw };
  const parts = token.split('/');
  if (parts.length !== 2) return { status: 'malformed', raw };
  // token syntax: non-empty type and subtype with no internal whitespace
  // (checked on the untrimmed parts so 'text/ plain' is malformed)
  if (parts[0]!.trim() === '' || parts[1]!.trim() === '') return { status: 'malformed', raw };
  if (/\s/.test(parts[0]!) || /\s/.test(parts[1]!)) return { status: 'malformed', raw };
  const type = parts[0]!.trim();
  const subtype = parts[1]!.trim();
  return { status: 'valid', normalized: `${type.toLowerCase()}/${subtype.toLowerCase()}`, raw };
}

/** Parse a capability media declaration (bare `type/subtype` token). */
export function parseMediaDeclaration(value: unknown): MediaTypeParseResult {
  return parseCore(value, false);
}

/** Parse a context-item media value (parameters stripped for matching). */
export function parseMediaType(value: unknown): MediaTypeParseResult {
  return parseCore(value, true);
}

/**
 * Collect the declared media surface of a capability as a deterministic
 * normalized set. Non-array, sparse, or non-string entries never crash and
 * never invoke coercion hooks: only valid primitive-string declarations are
 * collected; everything else is ignored here (the inspector reports the
 * malformed entries as findings).
 */
export function declaredMediaTypes(mediaTypes: unknown): readonly string[] {
  if (!Array.isArray(mediaTypes)) return [];
  const out: string[] = [];
  for (const entry of mediaTypes) {
    // sparse-array holes iterate as undefined and are rejected
    const parsed = parseMediaDeclaration(entry);
    if (parsed.status === 'valid' && parsed.normalized !== undefined) out.push(parsed.normalized);
  }
  return out;
}

/**
 * Deterministic fingerprint representation of one capability-list entry:
 * primitive strings are used verbatim; non-strings are represented by their
 * runtime type tag. Never invokes `toString`, `valueOf`, getters, or proxy
 * conversion hooks, so malformed caller input cannot crash fingerprinting.
 */
export function capabilityEntryString(value: unknown): string {
  if (typeof value === 'string') return value;
  return `<${typeof value}>`;
}
