/**
 * Unicode-safe UTF-8 text model (WP-5A F7).
 *
 * One authoritative text-bound model: every textual limit is measured in
 * UTF-8 bytes. Truncation returns the longest valid Unicode prefix whose UTF-8
 * byte length is within the limit and never splits a Unicode scalar value;
 * isolated surrogates are rejected before rendering (never replaced with
 * U+FFFD, never silently normalized).
 */
import { Buffer } from 'node:buffer';

/** UTF-8 byte length of a text value (non-string input measures 0; never throws). */
export function utf8ByteLength(text: string): number {
  return typeof text === 'string' ? Buffer.byteLength(text, 'utf8') : 0;
}

/** True when the text contains an unpaired surrogate (high or low). */
export function hasLoneSurrogate(text: string): boolean {
  if (typeof text !== 'string') return false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : -1;
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Validates that the text consists of well-formed Unicode scalar values. */
export function validateUnicodeScalarText(text: string): boolean {
  return !hasLoneSurrogate(text);
}

export interface Utf8TruncationResult {
  /** The longest valid Unicode prefix within `maxBytes` UTF-8 bytes. */
  readonly text: string;
  /** UTF-8 byte length of the emitted prefix. */
  readonly emittedBytes: number;
  /** Whether truncation occurred. */
  readonly truncated: boolean;
  /** Original UTF-8 byte length of the input. */
  readonly originalBytes: number;
}

/**
 * Truncate to the longest valid Unicode prefix whose UTF-8 byte length is at
 * most `maxBytes`. Iterates code points (never splitting a scalar value, never
 * creating an isolated surrogate). Input must already be scalar-valid.
 */
export function truncateUtf8WithoutSplittingScalar(text: string, maxBytes: number): Utf8TruncationResult {
  if (typeof text !== 'string') {
    // defensive: non-string input never throws and never coerces (R-1)
    return { text: '', emittedBytes: 0, truncated: false, originalBytes: 0 };
  }
  const originalBytes = utf8ByteLength(text);
  if (originalBytes <= maxBytes) {
    return { text, emittedBytes: originalBytes, truncated: false, originalBytes };
  }
  let emitted = '';
  let bytes = 0;
  for (const codePoint of text) {
    const unit = String(codePoint);
    const unitBytes = utf8ByteLength(unit);
    if (bytes + unitBytes > maxBytes) break;
    emitted += unit;
    bytes += unitBytes;
  }
  return { text: emitted, emittedBytes: bytes, truncated: true, originalBytes };
}
