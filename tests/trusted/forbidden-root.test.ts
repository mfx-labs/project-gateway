/**
 * WP-6 Phase 2A security correction F-2A-02: forbidden whole-filesystem
 * workspace root `/`.
 *
 * The canonical POSIX filesystem root represents the complete host
 * filesystem and violates the global product ceiling (explicit-project
 * scoping; prohibition on generic filesystem access). Trusted local
 * configuration is constrained by the product ceiling: a workspace root may
 * never canonicalize to `/`, even when supplied by a trusted local
 * administrator. Rejection happens after final canonical resolution, with a
 * dedicated TCF-029 finding.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTrustedWorkspaceConfiguration,
  evaluateExistingPathContainment,
  CONTAINMENT_PROTOCOL_VERSION,
  TRUSTED_HOST_LANE,
  type ValidatedTrustedWorkspaceConfiguration,
} from '../../src/trusted/index.js';
import { isGenuineValidatedTrustedWorkspaceConfiguration } from '../../src/trusted/configuration-brand.js';

const LANE = TRUSTED_HOST_LANE;
const idResolver = (p: string): string => p;

const input = (root: string, workspaceId = 'pgw:w:aaaaaaaaaaaaaaaa'): Record<string, unknown> => ({
  configurationVersion: '1',
  capabilityVocabularyVersion: 'v1',
  provenance: { sourceKind: 'trusted-local-control-plane' },
  workspaces: [{ workspaceId, root }],
});

const req = (cfg: ValidatedTrustedWorkspaceConfiguration, path: string): Record<string, unknown> => ({
  containmentProtocolVersion: CONTAINMENT_PROTOCOL_VERSION,
  workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa',
  path,
  purpose: 'read',
  expectedConfigurationIdentity: cfg.identity,
});

test('F2A02: literal "/" root fails with TCF-029', () => {
  const report = validateTrustedWorkspaceConfiguration(input('/'), { hostLane: LANE, resolveRootPath: idResolver });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-029');
  assert.equal(report.findings[0]!.messageKey, 'trusted-config.root-whole-filesystem');
});

test('F2A02: repeated separators canonicalizing to "/" fail', () => {
  for (const root of ['//', '///', '/./', '/.//']) {
    const report = validateTrustedWorkspaceConfiguration(input(root), { hostLane: LANE, resolveRootPath: idResolver });
    assert.equal(report.ok, false, root);
    assert.equal(report.findings[0]!.code, 'TCF-029', root);
  }
});

test('F2A02: lexical forms normalizing to "/" fail', () => {
  // '/workspace/..' normalizes lexically to '/'.
  const report = validateTrustedWorkspaceConfiguration(input('/workspace/..'), { hostLane: LANE, resolveRootPath: idResolver });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-029');
});

test('F2A02: resolver returning "/" fails', () => {
  const report = validateTrustedWorkspaceConfiguration(input('/workspace'), {
    hostLane: LANE,
    resolveRootPath: () => '/',
  });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-029');
});

test('F2A02: a raw non-root configured path resolving to "/" fails', () => {
  const report = validateTrustedWorkspaceConfiguration(input('/home/user/project'), {
    hostLane: LANE,
    resolveRootPath: () => '/',
  });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-029');
});

test('F2A02: a single-workspace configuration rooted at "/" fails', () => {
  const report = validateTrustedWorkspaceConfiguration(input('/'), { hostLane: LANE, resolveRootPath: idResolver });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-029');
});

test('F2A02: a multi-workspace configuration containing "/" fails the entire load', () => {
  const report = validateTrustedWorkspaceConfiguration({
    configurationVersion: '1',
    capabilityVocabularyVersion: 'v1',
    provenance: { sourceKind: 'trusted-local-control-plane' },
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/workspace' },
      { workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/' },
    ],
  }, { hostLane: LANE, resolveRootPath: idResolver });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-029');
  assert.equal(report.configuration, undefined);
});

test('F2A02: failure produces no configuration, identity, or brand', () => {
  const report = validateTrustedWorkspaceConfiguration(input('/'), { hostLane: LANE, resolveRootPath: idResolver });
  assert.equal(report.ok, false);
  assert.equal(report.configuration, undefined);
  assert.equal('identity' in (report as unknown as Record<string, unknown>), false);
  // No branded object exists for the failed load.
  const config = report.configuration;
  assert.equal(config === undefined || !isGenuineValidatedTrustedWorkspaceConfiguration(config), true);
});

test('F2A02: findings do not expose raw roots', () => {
  const report = validateTrustedWorkspaceConfiguration(input('/'), { hostLane: LANE, resolveRootPath: idResolver });
  assert.equal(report.ok, false);
  for (const f of report.findings) {
    // Static root-safe message: no '/', no original path, no resolver output.
    assert.ok(!f.message.includes('/'), f.message);
    assert.ok(!f.message.includes('srv'), f.message);
  }
});

test('F2A02: bounded project roots remain valid', () => {
  for (const root of ['/workspace', '/srv/projects/example', '/home/user/project']) {
    const report = validateTrustedWorkspaceConfiguration(input(root), { hostLane: LANE, resolveRootPath: idResolver });
    assert.equal(report.ok, true, root);
    assert.equal(report.configuration!.workspaces[0]!.canonicalRoot, root, root);
  }
});

test('F2A02: a nested bounded root remains valid when no overlap exists', () => {
  const report = validateTrustedWorkspaceConfiguration(input('/workspace/project'), { hostLane: LANE, resolveRootPath: idResolver });
  assert.equal(report.ok, true);
  assert.equal(report.configuration!.workspaces[0]!.canonicalRoot, '/workspace/project');
});

test('F2A02: Phase-2A cannot obtain a decision under "/" because no genuine validated configuration with that root can exist', () => {
  // The validator rejects the root before identity and branding; therefore no
  // genuine configuration can ever carry canonicalRoot '/'.
  const report = validateTrustedWorkspaceConfiguration(input('/'), { hostLane: LANE, resolveRootPath: idResolver });
  assert.equal(report.ok, false);
  // And a forged '/'-rooted configuration is independently rejected by the
  // F-2A-01 brand check with zero resolver calls.
  const forged = {
    configurationVersion: '1',
    capabilityVocabularyVersion: 'v1',
    hostLane: LANE,
    provenance: { sourceKind: 'trusted-local-control-plane' },
    workspaces: [{ workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', canonicalRoot: '/' }],
    identity: 'sha-256:' + 'b'.repeat(64),
  } as unknown as ValidatedTrustedWorkspaceConfiguration;
  let calls = 0;
  const evaluation = evaluateExistingPathContainment(req(forged, 'etc/passwd'), {
    configuration: forged,
    resolveExistingPath: (p) => {
      calls++;
      return { ok: true, canonical: p };
    },
  });
  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.findings[0]!.code, 'TCP-021');
  assert.equal(calls, 0);
  assert.equal(evaluation.decision, undefined);
});

test('F2A02: genuine configurations are unaffected and still brand correctly', () => {
  const report = validateTrustedWorkspaceConfiguration(input('/workspace'), { hostLane: LANE, resolveRootPath: idResolver });
  assert.equal(report.ok, true);
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(report.configuration!), true);
  const evaluation = evaluateExistingPathContainment(req(report.configuration!, 'a/b'), {
    configuration: report.configuration!,
    resolveExistingPath: (p) => ({ ok: true, canonical: p }),
  });
  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.decision!.resolvedAbsolutePath, '/workspace/a/b');
});
