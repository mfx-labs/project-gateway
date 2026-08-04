/**
 * RFC 8785 (JCS) serialization for the canonical input set used by the protocol.
 *
 * The WP-3 digest vectors were produced over input restricted to safe integers and
 * Unicode strings without surrogate pairs; this serializer implements the RFC 8785
 * rules for exactly that input set (and beyond: UTF-16 code-unit key ordering,
 * shortest control-char escapes, integer-only number output, -0 normalized to 0).
 * It is verified against all 19 committed digest vectors.
 */

const ESCAPES: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
};

function escapeString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    const esc = ESCAPES[c];
    if (esc !== undefined) {
      out += esc;
      continue;
    }
    const code = s.charCodeAt(i);
    if (code < 0x20) {
      out += '\\u' + code.toString(16).padStart(4, '0');
      continue;
    }
    out += c;
  }
  return out + '"';
}

function serializeNumber(v: number): string {
  if (Object.is(v, -0)) return '0';
  if (!Number.isInteger(v)) {
    throw new Error('JCS: non-integer number in canonical input: ' + v);
  }
  if (!Number.isSafeInteger(v)) {
    throw new Error('JCS: unsafe integer in canonical input: ' + v);
  }
  return String(v);
}

/**
 * Serialize a JSON value under RFC 8785 rules.
 * - object keys sorted by UTF-16 code units;
 * - strings escaped per RFC 8785 (shortest form);
 * - numbers must be safe integers (protocol canonical-input contract);
 * - arrays preserve order.
 */
export function jcsSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return serializeNumber(value);
  if (typeof value === 'string') return escapeString(value);
  if (Array.isArray(value)) {
    return '[' + value.map((x) => jcsSerialize(x)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return '{' + keys.map((k) => escapeString(k) + ':' + jcsSerialize((value as Record<string, unknown>)[k])).join(',') + '}';
  }
  throw new Error('JCS: unsupported value type');
}
