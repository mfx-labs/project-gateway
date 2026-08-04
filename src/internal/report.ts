/**
 * Deterministic structured validation report model.
 * Expected invalid input returns typed results; implementation exceptions are never
 * presented as conformance findings.
 */
import {
  PHASE_INDEX,
  type FailureCategory,
  type ValidationPhase,
} from './phase.js';
import type { ValidationLevel } from '../api/types.js';

export interface Finding {
  /** Phase at which the finding was produced. */
  phase: ValidationPhase;
  /** Stable failure category. */
  category: FailureCategory;
  /** Applicable semantic rule IDs (empty for pure structural findings). */
  ruleIds: readonly string[];
  /** Schema resource URN where applicable. */
  schemaId?: string;
  /** Subject identity (instance/revision/record/snapshot ID) where available. */
  subjectIdentity?: string;
  /** JSON pointer or graph location where available. */
  location?: string;
  /** Stable machine-readable message key. */
  messageKey: string;
  /** Deterministic human-readable message. */
  message: string;
}

export interface ValidationReport {
  readonly ok: boolean;
  readonly firstFailingPhase?: ValidationPhase | undefined;
  readonly category?: FailureCategory | undefined;
  readonly schemaId?: string | undefined;
  readonly subjectIdentity?: string | undefined;
  readonly ruleIds: readonly string[];
  readonly findings: readonly Finding[];
  /** Phase-gate marker: the highest level actually executed when no wrapper value is produced. */
  readonly level?: ValidationLevel | undefined;
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const pa = PHASE_INDEX[a.phase] - PHASE_INDEX[b.phase];
    if (pa !== 0) return pa;
    const ca = a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
    if (ca !== 0) return ca;
    const ra = (a.ruleIds[0] ?? '').localeCompare(b.ruleIds[0] ?? '');
    if (ra !== 0) return ra;
    const sa = (a.subjectIdentity ?? '').localeCompare(b.subjectIdentity ?? '');
    if (sa !== 0) return sa;
    const la = (a.location ?? '').localeCompare(b.location ?? '');
    if (la !== 0) return la;
    return a.messageKey.localeCompare(b.messageKey);
  });
}

export function okReport(findings: readonly Finding[] = []): ValidationReport {
  return {
    ok: true,
    ruleIds: [],
    findings: Object.freeze(sortFindings(findings)),
  };
}

export function failReport(
  phase: ValidationPhase,
  category: FailureCategory,
  opts: {
    ruleIds?: readonly string[];
    schemaId?: string;
    subjectIdentity?: string;
    location?: string;
    messageKey: string;
    message: string;
    extraFindings?: readonly Finding[];
  },
): ValidationReport {
  const first: Finding = {
    phase,
    category,
    ruleIds: opts.ruleIds ?? [],
    schemaId: opts.schemaId,
    subjectIdentity: opts.subjectIdentity,
    location: opts.location,
    messageKey: opts.messageKey,
    message: opts.message,
  };
  const findings = sortFindings([first, ...(opts.extraFindings ?? [])]);
  return {
    ok: false,
    firstFailingPhase: phase,
    category,
    schemaId: opts.schemaId,
    subjectIdentity: opts.subjectIdentity,
    ruleIds: findings.flatMap((f) => f.ruleIds),
    findings: Object.freeze(findings),
  };
}

/** Build a report from an arbitrary finding set (used by the pipeline). */
export function reportFromFindings(findings: readonly Finding[]): ValidationReport {
  const sorted = sortFindings(findings);
  const first = sorted[0];
  if (!first) return okReport();
  return {
    ok: false,
    firstFailingPhase: first.phase,
    category: first.category,
    schemaId: first.schemaId,
    subjectIdentity: first.subjectIdentity,
    ruleIds: sorted.flatMap((f) => f.ruleIds),
    findings: Object.freeze(sorted),
  };
}

export const ok = (): ValidationReport => okReport();

export function mk(
  phase: ValidationPhase,
  category: FailureCategory,
  messageKey: string,
  message: string,
  opts: { ruleIds?: readonly string[]; schemaId?: string; subjectIdentity?: string; location?: string } = {},
): Finding {
  return {
    phase,
    category,
    ruleIds: opts.ruleIds ?? [],
    schemaId: opts.schemaId,
    subjectIdentity: opts.subjectIdentity,
    location: opts.location,
    messageKey,
    message,
  };
}
