/**
 * Canonical-input preconditions (phase 2): NFC, safe integers, timestamps,
 * ambiguous values, and profile bounds. Never normalizes, sorts, clamps, or
 * discards data.
 *
 * Exclusion follows the exact canonical projection:
 * - artifact: the entire top-level `annotations` subtree is excluded (it is not
 *   digest-covered); the `revision.digest` value is excluded (its syntax is
 *   verified at the digest phase); every other digest-covered key and value is
 *   validated, including object member names.
 * - registry: the top-level `snapshot_digest` value is excluded by path.
 * Exclusion is path-based, so nested members merely named `annotations` or
 * `digest` remain digest-covered.
 */
import { mk, failReport, type ValidationReport, type Finding } from '../internal/report.js';

export type SubjectClass = 'artifact' | 'registry' | 'lifecycle';

const TIMESTAMP_RE =
  /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/;

const SAFE_INT_MIN = -9007199254740991;
const SAFE_INT_MAX = 9007199254740991;

const TIMESTAMP_KEYS = new Set([
  'created_at',
  'effective_at',
  'reviewed_at',
  'valid_until',
  'not_before',
  'not_after',
  'event_time',
]);

function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** True when the given structural path is excluded from the canonical projection. */
function isExcludedPath(class_: SubjectClass, path: string): boolean {
  if (class_ === 'artifact') {
    if (path === '/annotations') return true; // entire subtree excluded
    if (path === '/revision/digest') return true; // derived digest value excluded
    return false;
  }
  if (class_ === 'registry') {
    return path === '/snapshot_digest';
  }
  return false;
}

function isNfcString(s: string): boolean {
  return s.normalize('NFC') === s;
}

function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : -1;
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function walkValue(
  findings: Finding[],
  class_: SubjectClass,
  path: string,
  value: unknown,
  depth: number,
): void {
  if (depth > 64) {
    findings.push(mk('canonical-input-validation', 'RESOURCE-LIMIT', 'canonical.nesting', 'canonical-input nesting limit exceeded', { location: path }));
    return;
  }
  if (isExcludedPath(class_, path)) return;
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (!isNfcString(value)) {
      findings.push(mk('canonical-input-validation', 'NON-NFC-STRING', 'canonical.nfc', 'digest-covered string is not NFC', { location: path }));
    }
    if (hasLoneSurrogate(value)) {
      findings.push(mk('canonical-input-validation', 'INVALID-UNICODE', 'canonical.surrogate', 'digest-covered string contains an unpaired surrogate', { location: path }));
    }
    const key = path.slice(path.lastIndexOf('/') + 1);
    if (TIMESTAMP_KEYS.has(key) && !TIMESTAMP_RE.test(value)) {
      findings.push(mk('canonical-input-validation', 'AMBIGUOUS-VALUE', 'canonical.timestamp', 'invalid canonical timestamp form', { location: path }));
    }
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || !Number.isFinite(value) || value < SAFE_INT_MIN || value > SAFE_INT_MAX) {
      findings.push(mk('canonical-input-validation', 'UNSAFE-INTEGER', 'canonical.safe-integer', 'JSON number outside the safe-integer contract', { location: path }));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkValue(findings, class_, `${path}/${i}`, value[i], depth + 1);
    }
    return;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const k of Object.keys(record)) {
      const memberPath = `${path}/${escapePointer(k)}`;
      // digest-covered member names are validated like values
      if (!isNfcString(k)) {
        findings.push(mk('canonical-input-validation', 'NON-NFC-STRING', 'canonical.key-nfc', 'digest-covered object member name is not NFC', { location: memberPath }));
      }
      if (hasLoneSurrogate(k)) {
        findings.push(mk('canonical-input-validation', 'INVALID-UNICODE', 'canonical.key-surrogate', 'digest-covered object member name contains an unpaired surrogate', { location: memberPath }));
      }
      walkValue(findings, class_, memberPath, record[k], depth + 1);
    }
    return;
  }
  findings.push(mk('canonical-input-validation', 'AMBIGUOUS-VALUE', 'canonical.type', 'unsupported value type in canonical input', { location: path }));
}

export interface CanonicalInputOptions {
  subjectClass: SubjectClass;
}

export function validateCanonicalInput(model: unknown, opts: CanonicalInputOptions): ValidationReport {
  const findings: Finding[] = [];
  walkValue(findings, opts.subjectClass, '', model, 0);
  if (findings.length === 0) {
    return { ok: true, ruleIds: [], findings: [] };
  }
  const sorted = findings.sort(
    (a, b) => (a.location ?? '').localeCompare(b.location ?? '') || a.messageKey.localeCompare(b.messageKey),
  );
  const first = sorted[0]!;
  const reportOpts: { ruleIds?: readonly string[]; location?: string; messageKey: string; message: string; extraFindings?: readonly Finding[] } = {
    ruleIds: first.ruleIds,
    messageKey: first.messageKey,
    message: first.message,
    extraFindings: sorted.slice(1),
  };
  if (first.location !== undefined) reportOpts.location = first.location;
  return failReport(first.phase, first.category, reportOpts);
}

export function isNfc(s: string): boolean {
  return isNfcString(s);
}
