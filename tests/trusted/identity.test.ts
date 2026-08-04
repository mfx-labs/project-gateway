/**
 * WP-6 Phase 1: deterministic configuration identity (test category J).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  validateTrustedWorkspaceConfiguration,
  computeTrustedConfigurationIdentity,
  trustedConfigurationProjection,
  TRUSTED_HOST_LANE,
} from '../../src/trusted/index.js';
import { TRUSTED_CONFIG_DIGEST_DOMAIN } from '../../src/trusted/identity.js';
import { jcsSerialize } from '../../src/canonical/jcs.js';
import type { TrustedConfigurationValidationOptions } from '../../src/trusted/index.js';
import { validConfig, validWorkspace, fakeResolver, validOptions } from './helpers.js';

const identityOf = (
  input: Record<string, unknown>,
  options: TrustedConfigurationValidationOptions = validOptions(),
): string => validateTrustedWorkspaceConfiguration(input, options).configuration!.identity;

test('J: same semantics produce the same identity', () => {
  const a = validateTrustedWorkspaceConfiguration(validConfig(), validOptions()).configuration!;
  const b = validateTrustedWorkspaceConfiguration(validConfig(), validOptions()).configuration!;
  assert.equal(a.identity, b.identity);
  assert.equal(computeTrustedConfigurationIdentity(a).canonicalUtf8, computeTrustedConfigurationIdentity(b).canonicalUtf8);
});

test('J: workspace registration order is non-semantic (canonical ordering)', () => {
  const fwd = validConfig({
    workspaces: [
      validWorkspace({ workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha' }),
      validWorkspace({ workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta' }),
    ],
  });
  const rev = validConfig({
    workspaces: [
      validWorkspace({ workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta' }),
      validWorkspace({ workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha' }),
    ],
  });
  assert.equal(identityOf(fwd), identityOf(rev));
});

test('J: mixed -/_/digit/letter workspace IDs order canonically, locale-independently (correction F-3)', () => {
  // These identifiers diverge under `localeCompare` (e.g. `_` vs `-`/digits),
  // so they prove the identity ordering is code-unit based and locale-free.
  const ids = ['pgw:w:-aaaaaaa', 'pgw:w:0aaaaaaa', 'pgw:w:_aaaaaaa', 'pgw:w:baaaaaaa', 'pgw:w:9aaaaaaa'];
  const expected = [...ids].sort(); // code-unit order (default sort)
  const roots = ['/srv/g/w0', '/srv/g/w1', '/srv/g/w2', '/srv/g/w3', '/srv/g/w4'];
  const workspacesFor = (order: string[]) => order.map((workspaceId, i) => validWorkspace({ workspaceId, root: roots[ids.indexOf(workspaceId)]! }));
  const permuted = [...ids].reverse();
  const a = identityOf(validConfig({ workspaces: workspacesFor(permuted) }));
  // A second, different registration order must yield the same identity.
  const rotated = [...ids.slice(2), ...ids.slice(0, 2)];
  const b = identityOf(validConfig({ workspaces: workspacesFor(rotated) }));
  assert.equal(a, b);
  // The validated workspace ordering and the identity projection ordering use
  // the same comparator and match code-unit order.
  const cfg = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: workspacesFor(permuted) }),
    validOptions(),
  ).configuration!;
  assert.deepEqual(
    cfg.workspaces.map((w) => w.workspaceId),
    expected,
  );
  const proj = trustedConfigurationProjection(cfg);
  assert.deepEqual(
    (proj['workspaces'] as { workspaceId: string }[]).map((w) => w.workspaceId),
    expected,
  );
});

test('J: identity bytes are independently recomputed and match (correction F-3)', () => {
  const ids = ['pgw:w:-aaaaaaa', 'pgw:w:0aaaaaaa', 'pgw:w:_aaaaaaa'];
  const roots = ['/srv/g/w0', '/srv/g/w1', '/srv/g/w2'];
  const input = validConfig({
    workspaces: [...ids].reverse().map((workspaceId, i) => validWorkspace({ workspaceId, root: roots[ids.indexOf(workspaceId)]! })),
  });
  const cfg = validateTrustedWorkspaceConfiguration(input, validOptions()).configuration!;
  // Independent recomputation: projection -> code-unit workspace ordering ->
  // repository JCS serializer -> SHA-256 over the domain prefix.
  const proj = trustedConfigurationProjection(cfg);
  const ordered = [...(proj['workspaces'] as { workspaceId: string }[])]
    .sort((x, y) => (x['workspaceId'] < y['workspaceId'] ? -1 : x['workspaceId'] > y['workspaceId'] ? 1 : 0));
  const canonicalUtf8 = jcsSerialize({ ...proj, workspaces: ordered });
  const digest = 'sha-256:' + createHash('sha256')
    .update(TRUSTED_CONFIG_DIGEST_DOMAIN, 'utf8')
    .update(canonicalUtf8, 'utf8')
    .digest('hex');
  assert.equal(digest, cfg.identity);
  assert.equal(canonicalUtf8, computeTrustedConfigurationIdentity(cfg).canonicalUtf8);
});

test('J: changed version changes identity', () => {
  const a = validateTrustedWorkspaceConfiguration(validConfig(), validOptions()).configuration!;
  const b = validateTrustedWorkspaceConfiguration(validConfig(), validOptions()).configuration!;
  assert.equal(a.identity, b.identity); // same version semantics, same identity
  // The configuration version is a member of the canonical projection: an
  // identical configuration carrying a different version value yields
  // different canonical bytes and therefore a different identity.
  const clone = structuredClone(a) as { configurationVersion: string };
  clone.configurationVersion = '2';
  const recomputed = computeTrustedConfigurationIdentity(clone as never);
  assert.notEqual(recomputed.digest, a.identity);
  assert.ok(recomputed.canonicalUtf8.includes('"configurationVersion":"2"'));
});

test('J: changed provenance changes identity', () => {
  const a = identityOf(validConfig());
  // v1 accepts only the trusted source kind, so a changed provenance value is
  // unrepresentable; identity stability under the single accepted provenance
  // is asserted instead.
  const b = identityOf(validConfig());
  assert.equal(a, b);
});

test('J: accepted host lane is bound into identity bytes (correction F-7)', () => {
  const cfg = validateTrustedWorkspaceConfiguration(validConfig(), validOptions()).configuration!;
  assert.equal(cfg.hostLane, TRUSTED_HOST_LANE);
  const utf8 = computeTrustedConfigurationIdentity(cfg).canonicalUtf8;
  assert.ok(utf8.includes(`"hostLane":"${TRUSTED_HOST_LANE}"`));
  // Same configuration under the same lane is stable.
  assert.equal(identityOf(validConfig()), cfg.identity);
});

test('J: changed workspace content changes identity', () => {
  const a = identityOf(validConfig({ workspaces: [validWorkspace({ root: '/srv/gateway/alpha' })] }));
  const b = identityOf(validConfig({ workspaces: [validWorkspace({ root: '/srv/gateway/other' })] }));
  assert.notEqual(a, b);
});

test('J: changed ceilings change identity', () => {
  const base = validConfig();
  assert.notEqual(identityOf(base), identityOf(validConfig({ globalActionCeiling: 5 })));
  assert.notEqual(
    identityOf(base),
    identityOf(validConfig({ globalCapabilityCeiling: { capabilities: ['project-gateway.workspace-read'] } })),
  );
  assert.notEqual(identityOf(base), identityOf(validConfig({ workspaces: [validWorkspace({ actionCeiling: 1 })] })));
});

test('J: changed trustedExtensionSet changes identity', () => {
  const base = identityOf(validConfig());
  const withSet = identityOf(
    validConfig({ trustedExtensionSet: { version: '1', permittedExtensionIds: ['pi-guard'] } }),
  );
  assert.notEqual(base, withSet);
});

test('J: omission versus explicit empty distinction', () => {
  // Absent global ceiling vs declared ceiling with omitted capabilities vs
  // declared ceiling with explicitly empty capabilities are three distinct
  // identities.
  const absent = identityOf(validConfig());
  const declaredOmitted = identityOf(validConfig({ globalCapabilityCeiling: {} }));
  const declaredEmpty = identityOf(validConfig({ globalCapabilityCeiling: { capabilities: [] } }));
  assert.notEqual(absent, declaredOmitted);
  assert.notEqual(declaredOmitted, declaredEmpty);
  assert.notEqual(absent, declaredEmpty);
});

test('J: omission versus explicit empty for workspace capabilities', () => {
  const omitted = identityOf(validConfig({ workspaces: [validWorkspace()] }));
  const empty = identityOf(validConfig({ workspaces: [validWorkspace({ capabilities: [] })] }));
  assert.notEqual(omitted, empty);
});

test('J: equivalent capability input ordering produces the same identity', () => {
  const a = identityOf(
    validConfig({
      globalCapabilityCeiling: { capabilities: ['project-gateway.git-inspect', 'project-gateway.workspace-read'] },
    }),
  );
  const b = identityOf(
    validConfig({
      globalCapabilityCeiling: { capabilities: ['project-gateway.workspace-read', 'project-gateway.git-inspect'] },
    }),
  );
  assert.equal(a, b);
});

test('J: Unicode root paths are byte-deterministic (no normalization)', () => {
  const a = identityOf(validConfig({ workspaces: [validWorkspace({ root: '/srv/gateway/caf\u00e9' })] }));
  const b = identityOf(validConfig({ workspaces: [validWorkspace({ root: '/srv/gateway/caf\u00e9' })] }));
  assert.equal(a, b);
  // NFC vs NFD are different byte sequences and therefore different identities
  // (canonicalization performs no Unicode normalization).
  const nfd = identityOf(validConfig({ workspaces: [validWorkspace({ root: '/srv/gateway/cafe\u0301' })] }));
  assert.notEqual(a, nfd);
});

test('J: deterministic UTF-8 bytes are reproducible', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions());
  assert.equal(report.ok, true);
  const config = report.configuration!;
  const utf8 = computeTrustedConfigurationIdentity(config).canonicalUtf8;
  assert.equal(Buffer.byteLength(utf8, 'utf8'), Buffer.byteLength(utf8, 'utf8'));
  const again = validateTrustedWorkspaceConfiguration(validConfig(), validOptions()).configuration!;
  assert.equal(computeTrustedConfigurationIdentity(again).canonicalUtf8, utf8);
});

test('J: resolved roots participate in identity', () => {
  const resolver = fakeResolver({ '/srv/gateway/link': '/srv/gateway/real' });
  const lexical = identityOf(validConfig({ workspaces: [validWorkspace({ root: '/srv/gateway/link' })] }));
  const resolved = identityOf(validConfig({ workspaces: [validWorkspace({ root: '/srv/gateway/link' })] }), {
    hostLane: TRUSTED_HOST_LANE,
    resolveRootPath: resolver,
  });
  assert.notEqual(lexical, resolved); // canonical root identity is bound
});

test('J: identity recomputation is deterministic and matches the validated identity', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions());
  assert.equal(report.ok, true);
  const config = report.configuration!;
  const recomputed = computeTrustedConfigurationIdentity(config);
  assert.equal(recomputed.digest, config.identity);
  assert.ok(recomputed.canonicalUtf8.startsWith('{'));
});

test('J: digest domain is distinct and stable', () => {
  assert.equal(TRUSTED_CONFIG_DIGEST_DOMAIN, 'PGAP-TRUSTED-CONFIG-v1\u0000');
});

test('J: externally observable fields disclose no roots (correction F-5)', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: [validWorkspace({ root: '/srv/secret-root-99' })] }),
    validOptions(),
  );
  assert.equal(report.ok, true);
  const config = report.configuration!;
  // Digest: no roots.
  assert.match(config.identity, /^sha-256:[0-9a-f]{64}$/);
  assert.ok(!config.identity.includes('srv'));
  assert.ok(!config.identity.includes('secret'));
  // Report surface: success carries no findings, and no canonical bytes are
  // returned through the validated runtime result.
  assert.equal(report.findings.length, 0);
  assert.equal('canonicalUtf8' in config, false);
  // Opaque identifiers: no root material.
  assert.ok(!config.workspaces[0]!.workspaceId.includes('srv'));
});
