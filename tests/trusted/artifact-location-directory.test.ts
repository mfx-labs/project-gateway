/**
 * WP-6 Phase 2B-P: artifact-directory evidence and root relationship
 * (test categories B + C).
 *
 * The configured artifact location must be absolute, must exist at
 * validation time, must resolve to a directory (through trusted injected
 * evidence), must not be `/`, and must be a strict component-boundary
 * descendant of the canonical workspace root (equality prohibited).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTrustedWorkspaceConfiguration,
  TRUSTED_CONFIGURATION_VERSION_2,
  TRUSTED_HOST_LANE,
  type ArtifactLocationResolver,
} from '../../src/trusted/index.js';
import {
  canonicalizeConfiguredArtifactPath,
  resolveConfiguredArtifactLocation,
} from '../../src/trusted/artifact-location.js';
import { v2Config, v2Options, failingResolver, mappingDirectoryResolver, ARTIFACT_DIR_ALPHA } from './artifact-location-helpers.js';

const alphaWithLocation = (artifactLocation: string): Record<string, unknown> => v2Config({
  workspaces: [
    { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation },
  ],
});

test('B: existing bounded directory validates', () => {
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/artifacts'), v2Options());
  assert.equal(report.ok, true);
  assert.equal(report.configuration!.workspaces[0]!.artifactLocation, '/srv/gateway/alpha/artifacts');
});

test('B: deep existing bounded directory validates', () => {
  const report = validateTrustedWorkspaceConfiguration(
    alphaWithLocation('/srv/gateway/alpha/artifacts/drafts/2026'),
    v2Options(),
  );
  assert.equal(report.ok, true);
  assert.equal(report.configuration!.workspaces[0]!.artifactLocation, '/srv/gateway/alpha/artifacts/drafts/2026');
});

test('B: symlink resolving to an internal directory is accepted through canonical evidence', () => {
  const resolver = mappingDirectoryResolver({ '/srv/gateway/alpha/link': '/srv/gateway/alpha/real-artifacts' });
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/link'), v2Options(resolver));
  assert.equal(report.ok, true);
  // Only the final canonical directory is stored and identity-bound.
  assert.equal(report.configuration!.workspaces[0]!.artifactLocation, '/srv/gateway/alpha/real-artifacts');
});

test('B: regular file rejected (TCF-036)', () => {
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/file.txt'), v2Options(failingResolver('unsupported-entry-kind')));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-036');
  assert.equal(report.findings[0]!.messageKey, 'artifact-location.not-directory');
});

test('B: symlink resolving to a file rejected (TCF-036)', () => {
  const resolver = mappingDirectoryResolver({ '/srv/gateway/alpha/link': '/srv/gateway/alpha/real-file' });
  const fileResolver: ArtifactLocationResolver = (p) => {
    const target = { '/srv/gateway/alpha/link': '/srv/gateway/alpha/real-file' }[p];
    if (target === undefined) return { ok: true, canonicalPath: p, entryKind: 'directory' };
    // Evidence identifies a regular file as the final target.
    return { ok: false, code: 'unsupported-entry-kind' };
  };
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/link'), v2Options(fileResolver));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-036');
  assert.equal(resolver !== undefined, true);
});

test('B: socket, FIFO, device, and unknown entry kinds rejected (TCF-036)', () => {
  for (const code of ['unsupported-entry-kind'] as const) {
    const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/sock'), v2Options(failingResolver(code)));
    assert.equal(report.ok, false, code);
    assert.equal(report.findings[0]!.code, 'TCF-036', code);
  }
});

test('B: not-found rejected (TCF-035)', () => {
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/missing'), v2Options(failingResolver('not-found')));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-035');
});

test('B: broken link rejected (TCF-035)', () => {
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/broken'), v2Options(failingResolver('not-found')));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-035');
});

test('B: symlink loop rejected (TCF-037)', () => {
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/loop'), v2Options(failingResolver('loop')));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-037');
});

test('B: inaccessible rejected (TCF-033)', () => {
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/locked'), v2Options(failingResolver('inaccessible')));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-033');
});

test('B: ambiguous resolution rejected (TCF-041)', () => {
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/x'), v2Options(failingResolver('ambiguous')));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-041');
});

test('B: generic resolver error rejected (TCF-033)', () => {
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/x'), v2Options(failingResolver('error')));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-033');
});

test('B: throwing resolver rejected (TCF-033), no exception escapes', () => {
  const throwing: ArtifactLocationResolver = () => {
    throw new Error('artifact resolver boom');
  };
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/x'), v2Options(throwing));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-033');
});

test('B: malformed tagged result rejected (TCF-034)', () => {
  const malformed: ArtifactLocationResolver = () => ({ ok: true, canonicalPath: '/srv/gateway/alpha/x\u0000y', entryKind: 'directory' });
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/x'), v2Options(malformed));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-034');
});

test('B: relative, Windows, and UNC canonical results rejected (TCF-034)', () => {
  for (const bad of ['relative/path', 'C:\\srv\\gateway\\alpha', '\\\\server\\share', 'srv/gateway/alpha']) {
    const resolver: ArtifactLocationResolver = () => ({ ok: true, canonicalPath: bad, entryKind: 'directory' });
    const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/x'), v2Options(resolver));
    assert.equal(report.ok, false, bad);
    assert.equal(report.findings[0]!.code, 'TCF-034', bad);
  }
});

test('B: missing resolver when a location is present fails closed (TCF-032)', () => {
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/artifacts'), {
    hostLane: TRUSTED_HOST_LANE,
    resolveRootPath: (p) => p,
  });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-032');
  assert.equal(report.configuration, undefined);
});

test('B: resolver omitted when no location exists is fine (not required)', () => {
  const report = validateTrustedWorkspaceConfiguration(v2Config(), {
    hostLane: TRUSTED_HOST_LANE,
    resolveRootPath: (p) => p,
  });
  assert.equal(report.ok, true);
  assert.equal(report.configuration!.configurationVersion, TRUSTED_CONFIGURATION_VERSION_2);
});

test('B: resolver is invoked exactly once per configured location', () => {
  let calls = 0;
  const counting: ArtifactLocationResolver = (p) => {
    calls++;
    return { ok: true, canonicalPath: p, entryKind: 'directory' };
  };
  const report = validateTrustedWorkspaceConfiguration(
    v2Config({
      workspaces: [
        { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/a' },
        { workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta' },
      ],
    }),
    v2Options(counting),
  );
  assert.equal(report.ok, true);
  assert.equal(calls, 1);
});

test('B: malformed configured path (relative, Windows, UNC, NUL, control) rejected (TCF-031)', () => {
  for (const bad of ['relative/path', 'C:\\srv\\gateway\\alpha', '\\\\server\\share', '/srv/gateway/alpha/x\u0000y', '/srv/gateway/alpha/x\u001fy', 'alpha/artifacts']) {
    const report = validateTrustedWorkspaceConfiguration(alphaWithLocation(bad), v2Options());
    assert.equal(report.ok, false, bad);
    assert.equal(report.findings[0]!.code, 'TCF-031', bad);
  }
});

test('B: non-string artifactLocation field rejected (TCF-030)', () => {
  for (const value of [42, true, ['/srv/gateway/alpha/artifacts'], { path: '/x' }, null]) {
    const report = validateTrustedWorkspaceConfiguration(alphaWithLocation(value as never), v2Options());
    assert.equal(report.ok, false, String(value));
    assert.equal(report.findings[0]!.code, 'TCF-030', String(value));
  }
});

test('C: strict descendant accepted; workspace-root equality rejected (TCF-040)', () => {
  const ok = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/sub/dir'), v2Options());
  assert.equal(ok.ok, true);
  const equal = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha'), v2Options());
  assert.equal(equal.ok, false);
  assert.equal(equal.findings[0]!.code, 'TCF-040');
  assert.equal(equal.findings[0]!.messageKey, 'artifact-location.equals-workspace-root');
});

test('C: sibling-prefix confusion rejected (TCF-039)', () => {
  // '/srv/gateway/alphab' is NOT inside '/srv/gateway/alpha' (component boundary).
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alphab/artifacts'), v2Options());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-039');
});

test('C: outside workspace rejected (TCF-039)', () => {
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/outside/artifacts'), v2Options());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-039');
});

test('C: canonical "/" rejected (TCF-038)', () => {
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/'), v2Options());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-038');
  assert.equal(report.findings[0]!.messageKey, 'artifact-location.root-whole-filesystem');
});

test('C: raw non-root resolving to "/" rejected (TCF-038)', () => {
  const resolver: ArtifactLocationResolver = () => ({ ok: true, canonicalPath: '/', entryKind: 'directory' });
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/link'), v2Options(resolver));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-038');
});

test('C: resolver escape outside workspace rejected (TCF-039)', () => {
  const resolver = mappingDirectoryResolver({ '/srv/gateway/alpha/link': '/srv/outside/artifacts' });
  const report = validateTrustedWorkspaceConfiguration(alphaWithLocation('/srv/gateway/alpha/link'), v2Options(resolver));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-039');
});

test('C: final directory under another workspace rejected (strict-descendant + disjoint-root invariants)', () => {
  // A location under another workspace's root fails the strict-descendant
  // check of its own workspace (TCF-039); the post-loop TCF-042
  // defense-in-depth check is unreachable for validated configurations
  // because Phase-1 prohibits overlapping workspace roots, and is kept as an
  // explicit invariant.
  const input = v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/beta/artifacts' },
      { workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta' },
    ],
  });
  const report = validateTrustedWorkspaceConfiguration(input, v2Options());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-039');
});

test('C: registration order independence for artifact locations', () => {
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
  const a = validateTrustedWorkspaceConfiguration(forward, v2Options());
  const b = validateTrustedWorkspaceConfiguration(reversed, v2Options());
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.configuration!.identity, b.configuration!.identity);
});

test('C: canonicalization helpers behave deterministically', () => {
  assert.deepEqual(canonicalizeConfiguredArtifactPath('/a/b/'), { ok: true, canonical: '/a/b' });
  assert.equal(canonicalizeConfiguredArtifactPath('relative').ok, false);
  assert.equal(canonicalizeConfiguredArtifactPath('C:\\x').ok, false);
  assert.equal(canonicalizeConfiguredArtifactPath('/a/\u0000b').ok, false);
  const outcome = resolveConfiguredArtifactLocation('/srv/gateway/alpha/artifacts', '/srv/gateway/alpha', (p) => ({ ok: true, canonicalPath: p, entryKind: 'directory' }));
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.equal(outcome.canonical, '/srv/gateway/alpha/artifacts');
  assert.equal(resolveConfiguredArtifactLocation('/x', '/srv/gateway/alpha', (p) => ({ ok: true, canonicalPath: p, entryKind: 'directory' })).ok, false);
  assert.equal(ARTIFACT_DIR_ALPHA.length > 0, true);
});
