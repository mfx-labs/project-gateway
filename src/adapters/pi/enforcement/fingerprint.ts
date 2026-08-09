/**
 * WP-5B — normative v1 inventoryFingerprint (Part B, SIR-PG-012-001).
 *
 * Byte-for-byte identical to pi-guard v0.1.2 `computeInventoryFingerprint` and
 * the committed Gateway golden vector (`02c896…7261`). WP-5B MUST converge on
 * exactly the same bytes as pi-guard; any drift fails closed at activation.
 *
 * Canonicalization (normative; platform-independent):
 *  1. entry shape `{ name, source }` — `name` = exact `ToolInfo.name`,
 *     `source` = exact `ToolInfo.sourceInfo.source`, both admitted verbatim;
 *  2. order by canonical UTF-8 bytes of `name` ascending, ties by `source`
 *     (byte-wise lexicographic = code-point order; explicitly NOT the UTF-16
 *     code-unit order of the JS `<` operator, which diverges for
 *     supplementary characters such as U+E000 vs U+10000);
 *  3. JSON array of objects with EXACTLY the keys `name` then `source` (that
 *     key order), compact ECMAScript `JSON.stringify` escaping, no
 *     insignificant whitespace;
 *  4. UTF-8 (no BOM);
 *  5. SHA-256 over those bytes, lowercase hex (64 ASCII chars).
 */
import { createHash } from 'node:crypto';
import type { EffectiveToolEntry } from './types.js';

/** Normative v1 golden-vector digest (Gateway contract Part B). */
export const GOLDEN_VECTOR_DIGEST = '02c896667bb20ac3813e2eb65aa5cda4bd46a4d4acb16588cc1611e49dd97261';

/** Golden-vector observed entries (shuffled input order). */
export const GOLDEN_VECTOR_ENTRIES: readonly EffectiveToolEntry[] = Object.freeze([
  Object.freeze({ name: 'web_search', source: 'pi-web-access' }),
  Object.freeze({ name: '\u{10000}', source: 'x' }),
  Object.freeze({ name: 'bash', source: 'builtin' }),
  Object.freeze({ name: '\uE000', source: 'x' }),
  Object.freeze({ name: 'read', source: 'builtin' }),
  Object.freeze({ name: 'caf\u00e9', source: 'builtin' }),
]);

/** Byte-wise lexicographic comparison of canonical UTF-8 encodings. */
export function compareUtf8Bytes(
  left: { readonly name: string; readonly source: string },
  right: { readonly name: string; readonly source: string },
): number {
  const byName = Buffer.compare(Buffer.from(left.name, 'utf8'), Buffer.from(right.name, 'utf8'));
  if (byName !== 0) return byName;
  return Buffer.compare(Buffer.from(left.source, 'utf8'), Buffer.from(right.source, 'utf8'));
}

/** Key-ordered `{name, source}` pair (JSON.stringify emits keys in this order). */
function pair(entry: EffectiveToolEntry): { readonly name: string; readonly source: string } {
  return { name: entry.name, source: entry.source };
}

/**
 * Normative v1 inventory fingerprint over the effective observed surface.
 * Deterministic; identical output to pi-guard v0.1.2 and the golden vector.
 */
export function computeInventoryFingerprint(entries: readonly EffectiveToolEntry[]): string {
  const sorted = [...entries].map(pair).sort(compareUtf8Bytes);
  return createHash('sha256').update(JSON.stringify(sorted), 'utf8').digest('hex');
}

/** Admitted-timestamp contract (F-R2): finite non-negative safe integer or
 *  non-empty opaque UTF-8 string. */
export function isAcceptedTimestamp(value: unknown): value is string | number {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0;
  if (typeof value === 'string') return value.length > 0;
  return false;
}
