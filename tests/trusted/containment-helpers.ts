/**
 * Shared fixtures for WP-6 Phase 2A containment tests.
 * Returns fresh plain objects per call so hostile-mutation tests are isolated.
 */
import {
  validateTrustedWorkspaceConfiguration,
  CONTAINMENT_PROTOCOL_VERSION,
  TRUSTED_HOST_LANE,
  type ExistingPathResolver,
  type ExistingPathResolution,
  type ValidatedTrustedWorkspaceConfiguration,
} from '../../src/trusted/index.js';
import { validConfig, validOptions } from './helpers.js';

/** A validated Phase-1 configuration built from the committed test fixtures. */
export function validatedConfig(
  overrides: Record<string, unknown> = {},
): ValidatedTrustedWorkspaceConfiguration {
  const report = validateTrustedWorkspaceConfiguration(validConfig(overrides), validOptions());
  if (!report.ok) {
    throw new Error(`fixture configuration invalid: ${report.findings.map((f) => f.code).join(',')}`);
  }
  return report.configuration!;
}

/** Untrusted Phase-2A request fixture (workspace-relative path). */
export function validRequest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    containmentProtocolVersion: CONTAINMENT_PROTOCOL_VERSION,
    workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa',
    path: 'docs/notes.md',
    purpose: 'read',
    expectedConfigurationIdentity: '',
    ...overrides,
  };
}

/** Identity resolver: every existing path resolves to itself. */
export function identityResolver(): ExistingPathResolver {
  return (p: string): ExistingPathResolution => ({ ok: true, canonical: p });
}

/** Map-based fake resolver: maps canonical candidates to resolved paths; `fail` paths fail closed. */
export function fakeExistingResolver(
  map: Record<string, string> = {},
  fail: ReadonlySet<string> = new Set(),
): ExistingPathResolver {
  return (p: string): ExistingPathResolution => {
    if (fail.has(p)) return { ok: false, code: 'not-found' };
    const target = map[p];
    return target !== undefined ? { ok: true, canonical: target } : { ok: true, canonical: p };
  };
}

/** Request with the correct expected configuration identity filled in. */
export function requestFor(
  configuration: ValidatedTrustedWorkspaceConfiguration,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return validRequest({ expectedConfigurationIdentity: configuration.identity, ...overrides });
}

/** Standard options: validated config + identity resolver. */
export function validContainmentOptions(
  configuration: ValidatedTrustedWorkspaceConfiguration,
  resolver: ExistingPathResolver = identityResolver(),
): { configuration: ValidatedTrustedWorkspaceConfiguration; resolveExistingPath: ExistingPathResolver } {
  return { configuration, resolveExistingPath: resolver };
}

export const WORKSPACE_ALPHA = 'pgw:w:aaaaaaaaaaaaaaaa';
export const WORKSPACE_BETA = 'pgw:w:bbbbbbbbbbbbbbbb';
export const ROOT_ALPHA = '/srv/gateway/alpha';
export const ROOT_BETA = '/srv/gateway/beta';
export const LANE = TRUSTED_HOST_LANE;
