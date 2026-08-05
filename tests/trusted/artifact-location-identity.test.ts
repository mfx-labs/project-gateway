/**
 * WP-6 Phase 2B-P: version-2 identity (test category D).
 *
 * The version-2 identity binds every protocol-significant operand including
 * artifact-location presence versus omission and the canonical resolved
 * artifact directory; version-1 identities remain byte-identical; raw paths
 * are never disclosed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  validateTrustedWorkspaceConfiguration,
  computeTrustedConfigurationIdentity,
  trustedConfigurationProjection,
  TRUSTED_CONFIGURATION_VERSION_2,
  TRUSTED_HOST_LANE,
} from '../../src/trusted/index.js';
import { TRUSTED_CONFIG_DIGEST_DOMAIN } from '../../src/trusted/identity.js';
import { jcsSerialize } from '../../src/canonical/jcs.js';
import { validatedV1Config, v2Config, v2Options, validatedV2Config, mappingDirectoryResolver } from './artifact-location-helpers.js';

const identityOf = (input: Record<string, unknown>): string => {
  const report = validateTrustedWorkspaceConfiguration(input, v2Options());
  if (!report.ok) throw new Error(`fixture invalid: ${report.findings.map((f) => f.code).join(',')}`);
  return report.configuration!.identity;
};

test('D: deterministic repeated version-2 validation', () => {
  const a = validatedV2Config();
  const b = validatedV2Config();
  assert.equal(a.identity, b.identity);
  assert.equal(computeTrustedConfigurationIdentity(a).canonicalUtf8, computeTrustedConfigurationIdentity(b).canonicalUtf8);
});

test('D: independent recomputation matches the validated v2 identity', () => {
  const config = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  const proj = trustedConfigurationProjection(config);
  const canonicalUtf8 = jcsSerialize(proj);
  const digest = 'sha-256:' + createHash('sha256')
    .update(TRUSTED_CONFIG_DIGEST_DOMAIN, 'utf8')
    .update(canonicalUtf8, 'utf8')
    .digest('hex');
  assert.equal(digest, config.identity);
  assert.ok(canonicalUtf8.includes('"artifactLocation":"/srv/gateway/alpha/artifacts"'));
});

test('D: v1 identity is unchanged by the v2 extension', () => {
  const v1 = validatedV1Config();
  // The v1 projection shape contains no artifactLocation member.
  const proj = trustedConfigurationProjection(v1) as Record<string, unknown>;
  const workspaces = proj['workspaces'] as Record<string, unknown>[];
  for (const w of workspaces) assert.equal('artifactLocation' in w, false);
  assert.ok(!computeTrustedConfigurationIdentity(v1).canonicalUtf8.includes('artifactLocation'));
});

test('D: v1 versus v2 identities differ', () => {
  assert.notEqual(validatedV1Config().identity, validatedV2Config().identity);
});

test('D: artifact presence versus omission differ', () => {
  const omitted = identityOf(v2Config());
  const present = identityOf(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
      { workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta' },
    ],
  }));
  assert.notEqual(omitted, present);
});

test('D: artifact-directory change changes the identity', () => {
  const a = identityOf(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  const b = identityOf(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/drafts' },
    ],
  }));
  assert.notEqual(a, b);
});

test('D: workspace change changes the identity', () => {
  const a = identityOf(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  const b = identityOf(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:cccccccccccccccc', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  assert.notEqual(a, b);
});

test('D: capability, numeric ceilings, trustedExtensionSet, and provenance remain bound in v2', () => {
  const base = identityOf(v2Config());
  assert.notEqual(base, identityOf(v2Config({ globalActionCeiling: 7 })));
  assert.notEqual(base, identityOf(v2Config({ globalCapabilityCeiling: { capabilities: ['project-gateway.workspace-read'] } })));
  assert.notEqual(
    base,
    identityOf(v2Config({ trustedExtensionSet: { version: '1', permittedExtensionIds: ['pi-guard'] } })),
  );
  assert.notEqual(
    base,
    identityOf(v2Config({
      workspaces: [
        { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', actionCeiling: 3 },
        { workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta' },
      ],
    })),
  );
});

test('D: registration order is non-semantic for v2 identity', () => {
  const forward = v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
      { workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta', artifactLocation: '/srv/gateway/beta/artifacts' },
    ],
  });
  const reversed = v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta', artifactLocation: '/srv/gateway/beta/artifacts' },
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  });
  assert.equal(identityOf(forward), identityOf(reversed));
});

test('D: raw configured alias resolving to the same canonical directory yields the same identity', () => {
  // '/srv/gateway/alpha/link' resolves to '/srv/gateway/alpha/real'; both
  // the direct path and the alias bind the SAME canonical directory, so the
  // validated identities are identical (raw configured paths are not
  // identity operands).
  const aliasReport = validateTrustedWorkspaceConfiguration(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/link' },
    ],
  }), v2Options(mappingDirectoryResolver({ '/srv/gateway/alpha/link': '/srv/gateway/alpha/real' })));
  assert.equal(aliasReport.ok, true);
  assert.equal(aliasReport.configuration!.workspaces[0]!.artifactLocation, '/srv/gateway/alpha/real');
  const directReport = validateTrustedWorkspaceConfiguration(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/real' },
    ],
  }), v2Options());
  assert.equal(directReport.ok, true);
  assert.equal(directReport.configuration!.identity, aliasReport.configuration!.identity);
  // And the unmapped alias (canonical '/srv/gateway/alpha/link') differs.
  const unmappedReport = validateTrustedWorkspaceConfiguration(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/link' },
    ],
  }), v2Options());
  assert.equal(unmappedReport.ok, true);
  assert.notEqual(unmappedReport.configuration!.identity, directReport.configuration!.identity);
});

test('D: no raw-root disclosure in v2 identity or projection surface', () => {
  const config = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/secret-artifacts' },
    ],
  }));
  assert.match(config.identity, /^sha-256:[0-9a-f]{64}$/);
  assert.ok(!config.identity.includes('secret'));
  assert.ok(!config.identity.includes('srv'));
  // Canonical bytes remain internal: the validated result carries only the digest.
  assert.equal('canonicalUtf8' in config, false);
});

test('D: v2 identity binds the accepted configuration version', () => {
  const config = validatedV2Config();
  const utf8 = computeTrustedConfigurationIdentity(config).canonicalUtf8;
  assert.ok(utf8.includes(`"configurationVersion":"${TRUSTED_CONFIGURATION_VERSION_2}"`));
  assert.equal(config.hostLane, TRUSTED_HOST_LANE);
});
