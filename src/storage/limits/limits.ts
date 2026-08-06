/**
 * WP-8 normative limit profile (contract 19.1/19.2, LMT-001…013).
 *
 * Exactly 20 normative limits with default, hard minimum, hard maximum,
 * unit, source, configuration-selection, request-lowering, exact-limit, and
 * limit-plus-one semantics. Security hard maxima are contract-defined; no
 * implementation-selected security limit exists (LMT-012).
 */
import type { LimitProfileIdentity } from '../types.js';

export type LimitUnit = 'bytes' | 'count' | 'milliseconds' | 'readers' | 'writers';
export type LimitSource = 'layout-constant' | 'layout-constant-or-config' | 'config' | 'contract-constant';
export type LimitResult = string;

export interface LimitDefinition {
  readonly name: string;
  readonly unit: LimitUnit;
  readonly default: number;
  readonly hardMin: number;
  readonly hardMax: number;
  readonly source: LimitSource;
  readonly configSelectable: boolean;
  readonly requestLowerable: boolean;
  readonly requestRaiseable: boolean;
  /** Exact-limit result. */
  readonly exact: 'accepted' | 'n/a';
  /** Limit-plus-one result. */
  readonly plusOne: 'fail-closed' | 'accepted-continuation' | 'n/a';
  readonly result: LimitResult;
}

const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;

export const LIMIT_DEFINITIONS: readonly LimitDefinition[] = [
  { name: 'recordBytes', unit: 'bytes', default: 1 * MIB, hardMin: 1 * KIB, hardMax: 64 * MIB, source: 'layout-constant-or-config', configSelectable: true, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'ERR-STO-LIMIT-EXCEEDED / truncation only where class defines it' },
  { name: 'payloadBytes', unit: 'bytes', default: 512 * KIB, hardMin: 256, hardMax: 16 * MIB, source: 'layout-constant-or-config', configSelectable: true, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'record rejected at validation' },
  { name: 'referencesPerRecord', unit: 'count', default: 64, hardMin: 1, hardMax: 1024, source: 'layout-constant-or-config', configSelectable: true, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'record rejected' },
  { name: 'pathComponentBytes', unit: 'bytes', default: 64, hardMin: 8, hardMax: 128, source: 'layout-constant', configSelectable: false, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'derivation rejected (LAY-007)' },
  { name: 'pathBytes', unit: 'bytes', default: 512, hardMin: 64, hardMax: 1024, source: 'layout-constant', configSelectable: false, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'derivation rejected' },
  { name: 'dirEntries', unit: 'count', default: 4096, hardMin: 16, hardMax: 65536, source: 'config', configSelectable: true, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'enumeration bounded' },
  { name: 'enumerationResults', unit: 'count', default: 1024, hardMin: 16, hardMax: 65536, source: 'config', configSelectable: true, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'accepted-continuation', result: 'continuation' },
  { name: 'auditEventsPerOperation', unit: 'count', default: 1, hardMin: 1, hardMax: 64, source: 'config', configSelectable: true, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'batch rejected' },
  { name: 'recordsPerTransaction', unit: 'count', default: 1, hardMin: 1, hardMax: 64, source: 'config', configSelectable: true, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'batch rejected' },
  { name: 'temporaryBytes', unit: 'bytes', default: 64 * MIB, hardMin: 1 * MIB, hardMax: 1 * GIB, source: 'layout-constant-or-config', configSelectable: true, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'write aborted pre-publication' },
  { name: 'totalScanEntries', unit: 'count', default: 1 * MIB, hardMin: 1024, hardMax: 16 * MIB, source: 'config', configSelectable: true, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'scan truncated with evidence' },
  { name: 'totalScanBytes', unit: 'bytes', default: 4 * GIB, hardMin: 16 * MIB, hardMax: 64 * GIB, source: 'config', configSelectable: true, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'scan truncated with evidence' },
  { name: 'recoveryScanEntries', unit: 'count', default: 1 * MIB, hardMin: 1024, hardMax: 16 * MIB, source: 'config', configSelectable: true, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'recovery fails closed' },
  { name: 'retainedVersions', unit: 'count', default: 1, hardMin: 1, hardMax: 256, source: 'config', configSelectable: true, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'older versions quarantined' },
  { name: 'lockWait', unit: 'milliseconds', default: 5000, hardMin: 100, hardMax: 120000, source: 'config', configSelectable: true, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'ERR-STO-LOCK-TIMEOUT' },
  { name: 'operationTimeout', unit: 'milliseconds', default: 30000, hardMin: 1000, hardMax: 300000, source: 'config', configSelectable: true, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'ERR-STO-TIMEOUT' },
  { name: 'concurrentReaders', unit: 'readers', default: 16, hardMin: 1, hardMax: 64, source: 'config', configSelectable: true, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'read rejected' },
  { name: 'writers', unit: 'writers', default: 1, hardMin: 1, hardMax: 1, source: 'contract-constant', configSelectable: false, requestLowerable: false, requestRaiseable: false, exact: 'n/a', plusOne: 'n/a', result: 'ERR-STO-CONCURRENCY' },
  { name: 'quarantineEntries', unit: 'count', default: 4096, hardMin: 64, hardMax: 65536, source: 'config', configSelectable: true, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'quarantine full → recovery required' },
  { name: 'indexRebuildWork', unit: 'count', default: 1 * MIB, hardMin: 1024, hardMax: 16 * MIB, source: 'config', configSelectable: true, requestLowerable: true, requestRaiseable: false, exact: 'accepted', plusOne: 'fail-closed', result: 'rebuild fails closed' },
];

export const LIMIT_BY_NAME: ReadonlyMap<string, LimitDefinition> = new Map(LIMIT_DEFINITIONS.map((l) => [l.name, l]));

export type SelectedLimitProfile = Readonly<Record<string, number>>;

/** The contract-defined default profile (19.1). */
export function defaultLimitProfile(): SelectedLimitProfile {
  const profile: Record<string, number> = {};
  for (const l of LIMIT_DEFINITIONS) profile[l.name] = l.default;
  return profile;
}

export type LimitValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'unknown-limit' | 'non-integer' | 'below-hard-minimum' | 'above-hard-maximum' | 'not-config-selectable' };

/** Pure validation of a configured or selected value (LMT-013). */
export function validateLimitSelection(name: string, value: number, configSelection: boolean): LimitValidationResult {
  const def = LIMIT_BY_NAME.get(name);
  if (def === undefined) return { ok: false, reason: 'unknown-limit' };
  if (!Number.isSafeInteger(value)) return { ok: false, reason: 'non-integer' };
  if (value < def.hardMin) return { ok: false, reason: 'below-hard-minimum' };
  if (value > def.hardMax) return { ok: false, reason: 'above-hard-maximum' };
  if (configSelection && !def.configSelectable) return { ok: false, reason: 'not-config-selectable' };
  return { ok: true };
}

/** Apply request-supplied lowering; raising is rejected (LMT-002). */
export function applyRequestLowering(selected: SelectedLimitProfile, requestValues: Readonly<Record<string, number>>): { readonly ok: boolean; readonly profile: SelectedLimitProfile; readonly reason?: 'unknown-limit' | 'raise-rejected' | 'non-integer' | 'below-hard-minimum' } {
  const next: Record<string, number> = { ...selected };
  for (const [name, value] of Object.entries(requestValues)) {
    const def = LIMIT_BY_NAME.get(name);
    if (def === undefined) return { ok: false, profile: selected, reason: 'unknown-limit' };
    if (!def.requestLowerable) return { ok: false, profile: selected, reason: 'raise-rejected' };
    if (!Number.isSafeInteger(value)) return { ok: false, profile: selected, reason: 'non-integer' };
    if (value > (selected[name] ?? def.default)) return { ok: false, profile: selected, reason: 'raise-rejected' };
    if (value < def.hardMin) return { ok: false, profile: selected, reason: 'below-hard-minimum' };
    next[name] = value;
  }
  return { ok: true, profile: next };
}

/** Deterministic profile identity binding (LMT-011, 19.2). */
export function bindLimitProfile(profile: SelectedLimitProfile, configurationVersion: string, configurationIdentity?: string, storeMetadataDigest?: string): LimitProfileIdentity {
  return { configurationVersion, configurationIdentity, storeMetadataDigest };
}

/** Exact-limit and limit-plus-one semantics (LMT-005). */
export function limitBoundaryBehavior(name: string, value: number, selected: SelectedLimitProfile): { readonly accepted: boolean; readonly continuation?: boolean } {
  const def = LIMIT_BY_NAME.get(name);
  if (def === undefined) return { accepted: false };
  if (value < (selected[name] ?? def.default)) return { accepted: true };
  if (value === (selected[name] ?? def.default)) return { accepted: true, continuation: def.plusOne === 'accepted-continuation' };
  // value > selected: exact+1 behavior
  if (def.plusOne === 'accepted-continuation') return { accepted: true, continuation: true };
  return { accepted: false };
}
