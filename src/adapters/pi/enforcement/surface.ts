/**
 * WP-5B — effective tool-surface observation (F-04 / F-R1 / F-F1).
 *
 * WP-5B observes and binds only to the effective tool surface exposed by the
 * Pi host: exact case-sensitive tool name + observable surviving source
 * (`ToolInfo.sourceInfo.source`). Same-name registrations are collapsed by Pi
 * before observation; shadowed registrations are not observable and Project
 * Gateway does not claim to detect them. Tool inventory observation never
 * creates permission.
 *
 * Observation fails closed on malformed entries, unavailable source identity
 * (`sourceInfo` missing or non-string) for any registered tool, duplicate
 * names, or unknown active tools. The fingerprint over the observed surface is
 * computed with the normative v1 algorithm (fingerprint.ts).
 */
import { computeInventoryFingerprint } from './fingerprint.js';
import { piGuardFinding as finding, sortGuardFindings as sortFindings } from './findings.js';
import type { EffectiveToolSurface, EffectiveToolSurfaceObservation, GuardFinding } from './types.js';

/** Observed inventory entry with unknown (host-supplied) shape. */
export interface RawToolInventoryEntry {
  readonly name?: unknown;
  readonly sourceInfo?: { readonly source?: unknown };
}

function isRawEntry(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read own `name` / `sourceInfo.source` through own data descriptors, fail closed. */
function readEntry(value: unknown): { readonly name?: string; readonly source?: string; readonly malformed: boolean } {
  if (!isRawEntry(value)) return { malformed: true };
  const name = value['name'];
  const sourceInfo = value['sourceInfo'];
  if (typeof name !== 'string' || name.length === 0) return { malformed: true };
  if (typeof sourceInfo !== 'object' || sourceInfo === null || Array.isArray(sourceInfo)) return { malformed: true };
  const source = (sourceInfo as Readonly<Record<string, unknown>>)['source'];
  if (typeof source !== 'string' || source.length === 0) return { malformed: true };
  return { name, source, malformed: false };
}

/**
 * Deterministic effective-surface observation over the host's registered
 * inventory (`getAllTools`) and active set (`getActiveTools`).
 */
export function observeEffectiveSurface(
  inventory: readonly unknown[],
  activeTools: readonly unknown[],
  sampledAt: string,
): EffectiveToolSurfaceObservation {
  const findings: GuardFinding[] = [];

  if (!Array.isArray(inventory)) {
    findings.push(finding('GUARD-SURFACE-UNAVAILABLE', 'surface.inventory-invalid', 'registered tool inventory is not an array'));
    return { ok: false, findings: Object.freeze(sortFindings(findings)) };
  }

  const entries: { name: string; source: string }[] = [];
  const seen = new Set<string>();
  for (const raw of inventory) {
    const read = readEntry(raw);
    if (read.malformed || read.name === undefined || read.source === undefined) {
      findings.push(finding('GUARD-SURFACE-UNAVAILABLE', 'surface.entry-malformed', 'a registered tool entry is malformed or its effective source is unavailable'));
      continue;
    }
    if (seen.has(read.name)) {
      findings.push(finding('GUARD-SURFACE-UNAVAILABLE', 'surface.duplicate-name', `duplicate effective tool name ${read.name} observed`));
      continue;
    }
    seen.add(read.name);
    entries.push({ name: read.name, source: read.source });
  }
  if (findings.length > 0) {
    return { ok: false, findings: Object.freeze(sortFindings(findings)) };
  }

  const active: string[] = [];
  if (!Array.isArray(activeTools)) {
    findings.push(finding('GUARD-SURFACE-UNAVAILABLE', 'surface.active-invalid', 'active tool set is not an array'));
    return { ok: false, findings: Object.freeze(sortFindings(findings)) };
  }
  for (const raw of activeTools) {
    if (typeof raw !== 'string' || raw.length === 0) {
      findings.push(finding('GUARD-SURFACE-UNAVAILABLE', 'surface.active-malformed', 'an active tool name is not a non-empty string'));
      return { ok: false, findings: Object.freeze(sortFindings(findings)) };
    }
    if (!seen.has(raw)) {
      findings.push(finding('GUARD-SURFACE-UNAVAILABLE', 'surface.unknown-active', `active tool ${raw} is not in the registered effective surface`));
      return { ok: false, findings: Object.freeze(sortFindings(findings)) };
    }
    if (!active.includes(raw)) active.push(raw);
  }

  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const surface: EffectiveToolSurface = Object.freeze({
    entries: Object.freeze(sorted.map((e) => Object.freeze(e))),
    activeTools: Object.freeze(active),
    sampledAt,
  });
  return { ok: true, surface, findings: Object.freeze([]) };
}

/** Effective-surface identity (fingerprint) over observed entries. */
export function surfaceIdentity(surface: EffectiveToolSurface): string {
  return computeInventoryFingerprint(surface.entries);
}

/** Recompute the fingerprint over a fresh observation and compare (drift check). */
export function resampleMatches(surface: EffectiveToolSurface, fresh: EffectiveToolSurface): boolean {
  return surfaceIdentity(surface) === surfaceIdentity(fresh) && exactNameSetEqual(surface.entries, fresh.entries);
}

export function exactNameSetEqual(left: readonly { readonly name: string }[], right: readonly { readonly name: string }[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i]!.name !== right[i]!.name) return false;
  }
  return true;
}
