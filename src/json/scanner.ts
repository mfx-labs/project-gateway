/**
 * Raw JSON intake: bounds, UTF-8 decoding, nesting limits, duplicate-member
 * detection, malformed-JSON detection, unpaired-surrogate rejection, and
 * construction of one accepted data model.
 *
 * The scanner fully validates the input before any object construction; only after
 * the scan passes is JSON.parse used to build the model, so duplicate members can
 * never be silently collapsed.
 */
import { MAX_NESTING_DEPTH, type FailureCategory } from '../internal/phase.js';

export class RawJsonError extends Error {
  readonly category: FailureCategory;
  readonly offset: number;
  readonly line: number;
  readonly column: number;
  constructor(category: FailureCategory, message: string, offset: number) {
    super(message);
    this.name = 'RawJsonError';
    this.category = category;
    this.offset = offset;
    const { line, column } = locate(offset);
    this.line = line;
    this.column = column;
  }
}

let SOURCE = '';
function locate(offset: number): { line: number; column: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < SOURCE.length; i++) {
    if (SOURCE.charCodeAt(i) === 10) {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, column: col };
}

export interface RawParseResult {
  readonly model: unknown;
  readonly byteLength: number;
  readonly nestingDepth: number;
}

/**
 * Decode UTF-8 bytes strictly (rejects invalid UTF-8) and parse raw JSON with
 * duplicate-member detection and resource bounds.
 *
 * @param input       UTF-8 bytes or a string.
 * @param byteLimit   maximum accepted byte length (WP-3 profile bounds).
 */
export function parseRawJson(input: Uint8Array | string, byteLimit: number): RawParseResult {
  let bytes: Uint8Array;
  if (typeof input === 'string') {
    // Scan UTF-16 code units BEFORE UTF-8 encoding: TextEncoder silently replaces
    // lone surrogates with U+FFFD, which would be a silent repair. We reject them.
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = i + 1 < input.length ? input.charCodeAt(i + 1) : -1;
        if (!(next >= 0xdc00 && next <= 0xdfff)) {
          throw new RawJsonError('INVALID-UNICODE', 'lone high surrogate in string input', i);
        }
        i++; // valid pair: consume the low surrogate
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        throw new RawJsonError('INVALID-UNICODE', 'lone low surrogate in string input', i);
      }
    }
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = input;
  }
  if (bytes.byteLength > byteLimit) {
    throw new RawJsonError('RESOURCE-LIMIT', `input exceeds byte limit ${byteLimit}`, byteLimit);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new RawJsonError('INVALID-UNICODE', 'input is not valid UTF-8', bytes.byteLength);
  }
  SOURCE = text;
  const depth = scan(text);
  let model: unknown;
  try {
    model = JSON.parse(text);
  } catch {
    throw new RawJsonError('RAW-PARSE-FAILURE', 'malformed JSON input', 0);
  }
  SOURCE = '';
  return { model, byteLength: bytes.byteLength, nestingDepth: depth };
}

const enum Tok {
  LBrace = 0x7b,
  RBrace = 0x7d,
  LBracket = 0x5b,
  RBracket = 0x5d,
  Colon = 0x3a,
  Comma = 0x2c,
  Quote = 0x22,
  Backslash = 0x5c,
}

/**
 * Scan raw JSON text. Rejects malformed syntax, duplicate members (before any
 * object construction), unpaired surrogate escapes, unescaped control characters,
 * and nesting beyond MAX_NESTING_DEPTH. Returns the achieved nesting depth.
 */
function scan(text: string): number {
  const n = text.length;
  let i = 0;
  const stack: { keys: Set<string>; expectKey: boolean }[] = [];
  let maxDepth = 0;
  // value-start positions to detect adjacent values (missing commas)

  const fail = (category: FailureCategory, msg: string, at: number): never => {
    throw new RawJsonError(category, msg, at);
  };

  const skipWs = (): void => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
      else break;
    }
  };

  const readString = (at: number): string => {
    // assumes text[i] === '"'
    i++; // consume opening quote
    let out = '';
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === Tok.Quote) {
        i++;
        return out;
      }
      if (c === Tok.Backslash) {
        i++;
        if (i >= n) fail('RAW-PARSE-FAILURE', 'unterminated escape', at);
        const e = text.charCodeAt(i);
        switch (e) {
          case 0x22: out += '"'; i++; break;
          case 0x5c: out += '\\'; i++; break;
          case 0x2f: out += '/'; i++; break;
          case 0x62: out += '\b'; i++; break;
          case 0x66: out += '\f'; i++; break;
          case 0x6e: out += '\n'; i++; break;
          case 0x72: out += '\r'; i++; break;
          case 0x74: out += '\t'; i++; break;
          case 0x75: {
            const escAt = i - 1;
            i++;
            if (i + 4 > n) fail('RAW-PARSE-FAILURE', 'truncated unicode escape', i);
            const hex = text.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('RAW-PARSE-FAILURE', 'invalid unicode escape', i);
            const code = parseInt(hex, 16);
            if (code >= 0xd800 && code <= 0xdbff) {
              // high surrogate: must be immediately followed by an escaped low surrogate
              if (i + 6 + 4 > n || text.slice(i + 4, i + 6) !== '\\u') {
                fail('INVALID-UNICODE', 'isolated high surrogate escape', escAt);
              }
              const hex2 = text.slice(i + 6, i + 10);
              if (!/^[0-9a-fA-F]{4}$/.test(hex2)) fail('RAW-PARSE-FAILURE', 'invalid unicode escape', i + 6);
              const low = parseInt(hex2, 16);
              if (!(low >= 0xdc00 && low <= 0xdfff)) {
                fail('INVALID-UNICODE', 'high surrogate not followed by low surrogate', escAt);
              }
              out += String.fromCharCode(code, low);
              i += 10;
              break;
            }
            if (code >= 0xdc00 && code <= 0xdfff) {
              fail('INVALID-UNICODE', 'isolated low surrogate escape', escAt);
            }
            out += String.fromCharCode(code);
            i += 4;
            break;
          }
          default:
            fail('RAW-PARSE-FAILURE', 'invalid escape sequence', i);
        }
        continue;
      }
      if (c < 0x20) {
        fail('RAW-PARSE-FAILURE', 'unescaped control character in string', i);
      }
      out += text[i];
      i++;
    }
    fail('RAW-PARSE-FAILURE', 'unterminated string', at);
    return out; // unreachable: fail throws
  };

  const readNumber = (_at: number): void => {
    const ch = (): string => text.charAt(i);
    if (ch() === '-') i++;
    if (i >= n) fail('RAW-PARSE-FAILURE', 'invalid number', i);
    if (ch() === '0') {
      i++;
    } else if (ch() >= '1' && ch() <= '9') {
      while (i < n && ch() >= '0' && ch() <= '9') i++;
    } else {
      fail('RAW-PARSE-FAILURE', 'invalid number', i);
    }
    if (i < n && ch() === '.') {
      i++;
      if (i >= n || ch() < '0' || ch() > '9') fail('RAW-PARSE-FAILURE', 'invalid number fraction', i);
      while (i < n && ch() >= '0' && ch() <= '9') i++;
    }
    if (i < n && (ch() === 'e' || ch() === 'E')) {
      i++;
      if (i < n && (ch() === '+' || ch() === '-')) i++;
      if (i >= n || ch() < '0' || ch() > '9') fail('RAW-PARSE-FAILURE', 'invalid number exponent', i);
      while (i < n && ch() >= '0' && ch() <= '9') i++;
    }
  };

  const readLiteral = (at: number): void => {
    const word = text.slice(i, i + 5);
    if (word.startsWith('true')) i += 4;
    else if (word.startsWith('false')) i += 5;
    else if (word.startsWith('null')) i += 4;
    else fail('RAW-PARSE-FAILURE', 'invalid literal', at);
  };

  const parseValue = (depth: number): void => {
    // depth counts open containers; the root document is level 1, so the deepest
    // recursive call for L nesting levels has depth L-1; reject L > MAX_NESTING_DEPTH.
    if (depth >= MAX_NESTING_DEPTH) {
      fail('RESOURCE-LIMIT', `nesting exceeds limit ${MAX_NESTING_DEPTH}`, i);
    }
    if (i >= n) fail('RAW-PARSE-FAILURE', 'unexpected end of input', i);
    const c = text.charCodeAt(i);
    if (c === Tok.LBrace) {
      i++;
      const frame = { keys: new Set<string>(), expectKey: true };
      stack.push(frame);
      if (stack.length > maxDepth) maxDepth = stack.length;
      skipWs();
      if (i < n && text.charCodeAt(i) === Tok.RBrace) {
        i++;
        stack.pop();
        return;
      }
      for (;;) {
        skipWs();
        if (i >= n) fail('RAW-PARSE-FAILURE', 'unterminated object', i);
        if (text.charCodeAt(i) !== Tok.Quote) fail('RAW-PARSE-FAILURE', 'expected object key', i);
        const keyAt = i;
        const key = readString(keyAt);
        if (frame.keys.has(key)) {
          fail('DUPLICATE-MEMBER', `duplicate object member "${key}"`, keyAt);
        }
        frame.keys.add(key);
        skipWs();
        if (i >= n || text.charCodeAt(i) !== Tok.Colon) fail('RAW-PARSE-FAILURE', 'expected colon after key', i);
        i++;
        skipWs();
        parseValue(depth + 1);
        skipWs();
        if (i >= n) fail('RAW-PARSE-FAILURE', 'unterminated object', i);
        const nc = text.charCodeAt(i);
        if (nc === Tok.Comma) {
          i++;
          skipWs();
          continue;
        }
        if (nc === Tok.RBrace) {
          i++;
          stack.pop();
          return;
        }
        fail('RAW-PARSE-FAILURE', 'expected comma or closing brace', i);
      }
    }
    if (c === Tok.LBracket) {
      i++;
      stack.push({ keys: new Set<string>(), expectKey: false });
      if (stack.length > maxDepth) maxDepth = stack.length;
      skipWs();
      if (i < n && text.charCodeAt(i) === Tok.RBracket) {
        i++;
        stack.pop();
        return;
      }
      for (;;) {
        skipWs();
        parseValue(depth + 1);
        skipWs();
        if (i >= n) fail('RAW-PARSE-FAILURE', 'unterminated array', i);
        const nc = text.charCodeAt(i);
        if (nc === Tok.Comma) {
          i++;
          continue;
        }
        if (nc === Tok.RBracket) {
          i++;
          stack.pop();
          return;
        }
        fail('RAW-PARSE-FAILURE', 'expected comma or closing bracket', i);
      }
    }
    if (c === Tok.Quote) {
      readString(i);
      return;
    }
    if (c === 0x2d || (c >= 0x30 && c <= 0x39)) {
      readNumber(i);
      return;
    }
    if (c === 0x74 || c === 0x66 || c === 0x6e) {
      readLiteral(i);
      return;
    }
    fail('RAW-PARSE-FAILURE', 'unexpected character', i);
  };

  skipWs();
  if (i >= n) fail('RAW-PARSE-FAILURE', 'empty input', 0);
  parseValue(0);
  skipWs();
  if (i !== n) fail('RAW-PARSE-FAILURE', 'trailing content after top-level value', i);
  return maxDepth;
}
