/**
 * WP-7-B — Git inspection tests.
 *
 * Exercises Git host-lane validation, repository preflight, hostile local
 * config rejection, prelaunch revalidation, and the four Git operations
 * against a real temporary repository.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createGitFixture, createWp7Fixture, type Wp7Fixture, WORKSPACE_ALPHA } from '../helpers.js';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { initializeGitHostLane, revalidateGitHostLane, validateHostDirectory } from '../../../src/git/host-lane.js';
import { preflightGitRepository, captureRepositoryPreflightFingerprint, revalidateRepositoryPreflightFingerprint, isUnbornRepository } from '../../../src/git/preflight.js';
import { GitInspectionService } from '../../../src/git/service.js';
import { GLOBAL_ARGV_TEST, buildGitArgv } from '../../../src/git/wrapper.js';

const GIT_BIN = '/home/chef/.local/git-2.45.4/bin/git';

describe('WP-7 Git: host-lane validation', () => {
  it('accepts the verified lane binary', async () => {
    const r = await initializeGitHostLane(GIT_BIN);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.descriptor.version, '2.45.4');
      assert.ok(r.descriptor.initialFingerprint.sha256.length === 64);
    }
  });

  it('rejects a non-absolute path', async () => {
    const r = await initializeGitHostLane('relative/git');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, 'not-absolute');
  });

  it('rejects a non-canonical path', async () => {
    const r = await initializeGitHostLane('/usr//bin/git');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, 'not-canonical');
  });

  it('rejects a missing binary', async () => {
    const r = await initializeGitHostLane('/nonexistent/git-xyz');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, 'not-found');
  });

  it('fingerprint revalidation detects a missing binary', async () => {
    const r = await initializeGitHostLane(GIT_BIN);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    // Replace the descriptor's path with one that no longer exists
    const bad = { ...r.descriptor, absolutePath: '/nonexistent/git-xyz' };
    assert.ok(revalidateGitHostLane(bad) !== null);
  });

  it('validates HOME/TMPDIR directories', async () => {
    const f = createWp7Fixture();
    try {
      // fixture home/tmpdir are 0700, owned by us, outside workspace, empty
      assert.equal(validateHostDirectory(f.home, [f.root]), null);
      assert.equal(validateHostDirectory(f.tmpdir, [f.root]), null);
      // symlink component rejected
      const link = path.join(f.root, '..', 'home-link');
      fs.symlinkSync(f.home, link);
      assert.notEqual(validateHostDirectory(link, [f.root]), null);
      // inside workspace rejected
      assert.notEqual(validateHostDirectory(path.join(f.root, 'docs'), [f.root]), null);
      // nonempty rejected
      fs.writeFileSync(path.join(f.home, 'x'), 'x');
      assert.notEqual(validateHostDirectory(f.home, [f.root]), null);
    } finally {
      f.cleanup();
    }
  });

  it('rejects writable HOME (group/world writable)', async () => {
    const f = createWp7Fixture();
    try {
      fs.chmodSync(f.home, 0o777);
      assert.notEqual(validateHostDirectory(f.home, [f.root]), null);
    } finally {
      f.cleanup();
    }
  });
});

describe('WP-7 Git: repository preflight', () => {
  it('accepts a regular repository', () => {
    const g = createGitFixture();
    try {
      assert.equal(preflightGitRepository(g.root), null);
    } finally {
      g.cleanup();
    }
  });

  it('rejects a non-repository', () => {
    const f = createWp7Fixture();
    try {
      const err = preflightGitRepository(path.join(f.root, 'docs'));
      assert.notEqual(err, null);
      if (err) assert.equal(err.code, 'no-git-dir');
    } finally {
      f.cleanup();
    }
  });

  it('rejects hostile include config', () => {
    const g = createGitFixture('[include]\n\tpath = /etc/passwd\n');
    try {
      const err = preflightGitRepository(g.root);
      assert.notEqual(err, null);
      if (err) assert.equal(err.code, 'dangerous-config');
    } finally {
      g.cleanup();
    }
  });

  it('rejects conditional includeIf', () => {
    const g = createGitFixture('[includeIf "gitdir:/x"]\n\tpath = /etc/passwd\n');
    try {
      const err = preflightGitRepository(g.root);
      assert.notEqual(err, null);
    } finally {
      g.cleanup();
    }
  });

  it('rejects core.fsmonitor', () => {
    const g = createGitFixture('[core]\n\tfsmonitor = /bin/sh\n');
    try {
      const err = preflightGitRepository(g.root);
      assert.notEqual(err, null);
    } finally {
      g.cleanup();
    }
  });

  it('rejects core.hooksPath', () => {
    const g = createGitFixture('[core]\n\thooksPath = /tmp/hooks\n');
    try {
      const err = preflightGitRepository(g.root);
      assert.notEqual(err, null);
    } finally {
      g.cleanup();
    }
  });

  it('rejects diff.external and diff driver command', () => {
    const g1 = createGitFixture('[diff]\n\texternal = /bin/echo\n');
    try {
      assert.notEqual(preflightGitRepository(g1.root), null);
    } finally { g1.cleanup(); }
    const g2 = createGitFixture('[diff "mydriver"]\n\tcommand = /bin/echo\n');
    try {
      assert.notEqual(preflightGitRepository(g2.root), null);
    } finally { g2.cleanup(); }
  });

  it('rejects pager and credential sections', () => {
    const g1 = createGitFixture('[pager]\n\tlog = /bin/echo\n');
    try {
      assert.notEqual(preflightGitRepository(g1.root), null);
    } finally { g1.cleanup(); }
    const g2 = createGitFixture('[credential]\n\thelper = /bin/echo\n');
    try {
      assert.notEqual(preflightGitRepository(g2.root), null);
    } finally { g2.cleanup(); }
  });

  it('rejects gpg and log.showSignature', () => {
    const g1 = createGitFixture('[gpg]\n\tprogram = /bin/echo\n');
    try {
      assert.notEqual(preflightGitRepository(g1.root), null);
    } finally { g1.cleanup(); }
    const g2 = createGitFixture('[log]\n\tshowSignature = true\n');
    try {
      assert.notEqual(preflightGitRepository(g2.root), null);
    } finally { g2.cleanup(); }
  });

  it('rejects duplicate security-sensitive keys', () => {
    const g = createGitFixture('[core]\n\tfsmonitor = /a\n\tfsmonitor = /b\n');
    try {
      const err = preflightGitRepository(g.root);
      assert.notEqual(err, null);
    } finally {
      g.cleanup();
    }
  });

  it('rejects malformed config', () => {
    const g = createGitFixture('this is not a valid config line\n');
    try {
      const err = preflightGitRepository(g.root);
      assert.notEqual(err, null);
    } finally {
      g.cleanup();
    }
  });

  it('rejects commondir and alternates', () => {
    const g1 = createGitFixture(undefined, (root) => {
      fs.writeFileSync(path.join(root, '.git', 'commondir'), '../shared\n');
    });
    try {
      const err = preflightGitRepository(g1.root);
      assert.notEqual(err, null);
      if (err) assert.equal(err.code, 'commondir-present');
    } finally { g1.cleanup(); }

    const g2 = createGitFixture(undefined, (root) => {
      fs.mkdirSync(path.join(root, '.git', 'objects', 'info'), { recursive: true });
      fs.writeFileSync(path.join(root, '.git', 'objects', 'info', 'alternates'), '/external/objects\n');
    });
    try {
      const err = preflightGitRepository(g2.root);
      assert.notEqual(err, null);
      if (err) assert.equal(err.code, 'alternates-present');
    } finally { g2.cleanup(); }
  });

  it('rejects .git symlink', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-gitlink-'));
    try {
      const real = path.join(base, 'real');
      fs.mkdirSync(real);
      fs.symlinkSync(real, path.join(base, 'repo'));
      const err = preflightGitRepository(base);
      assert.notEqual(err, null);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('unborn detection: empty repo is unborn, committed repo is not', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-unborn-'));
    try {
      const emptyRepo = path.join(base, 'empty');
      fs.mkdirSync(emptyRepo);
      execFileSync(GIT_BIN, ['init', '-q', emptyRepo], { stdio: 'ignore' });
      assert.equal(isUnbornRepository(emptyRepo), true);
      const g = createGitFixture();
      try {
        assert.equal(isUnbornRepository(g.root), false);
      } finally { g.cleanup(); }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('WP-7 Git: preflight fingerprint revalidation (S-04)', () => {
  it('detects .git/config mutation between preflight and launch', () => {
    const g = createGitFixture();
    try {
      const fp = captureRepositoryPreflightFingerprint(g.root);
      assert.notEqual(fp, null);
      if (fp === null) return;
      // mutate config
      fs.appendFileSync(path.join(g.root, '.git', 'config'), '\n[core]\n\tfsmonitor = /bin/sh\n');
      const drift = revalidateRepositoryPreflightFingerprint(g.root, fp);
      assert.notEqual(drift, null);
    } finally {
      g.cleanup();
    }
  });

  it('detects commondir appearing between preflight and launch', () => {
    const g = createGitFixture();
    try {
      const fp = captureRepositoryPreflightFingerprint(g.root);
      assert.notEqual(fp, null);
      if (fp === null) return;
      fs.writeFileSync(path.join(g.root, '.git', 'commondir'), '../x\n');
      const drift = revalidateRepositoryPreflightFingerprint(g.root, fp);
      assert.notEqual(drift, null);
    } finally {
      g.cleanup();
    }
  });

  it('detects alternates appearing between preflight and launch', () => {
    const g = createGitFixture();
    try {
      const fp = captureRepositoryPreflightFingerprint(g.root);
      assert.notEqual(fp, null);
      if (fp === null) return;
      fs.mkdirSync(path.join(g.root, '.git', 'objects', 'info'), { recursive: true });
      fs.writeFileSync(path.join(g.root, '.git', 'objects', 'info', 'alternates'), '/x\n');
      const drift = revalidateRepositoryPreflightFingerprint(g.root, fp);
      assert.notEqual(drift, null);
    } finally {
      g.cleanup();
    }
  });
});

describe('WP-7 Git: service operations', () => {
  let fixture: Wp7Fixture;
  let gitRoot: string;
  let service: GitInspectionService;
  let cleanupGit: () => void;

  before(async () => {
    fixture = createWp7Fixture();
    const g = createGitFixture();
    gitRoot = g.root;
    cleanupGit = g.cleanup;
    // Point the workspace root at the git repo: rebuild fixture config
    const { validateTrustedWorkspaceConfiguration, TRUSTED_HOST_LANE } = await import('../../../src/trusted/index.js');
    const report = validateTrustedWorkspaceConfiguration(
      {
        configurationVersion: '1',
        capabilityVocabularyVersion: 'v1',
        provenance: { sourceKind: 'trusted-local-control-plane' },
        workspaces: [{ workspaceId: WORKSPACE_ALPHA, root: gitRoot }],
      },
      { hostLane: TRUSTED_HOST_LANE, resolveRootPath: (p: string) => p },
    );
    if (!report.ok) throw new Error('git fixture config invalid');
    const lane = await initializeGitHostLane(GIT_BIN);
    if (!lane.ok) throw new Error('host lane init failed');
    service = new GitInspectionService({
      configuration: report.configuration!,
      gitLane: lane.descriptor,
      envDirs: { HOME: fixture.home, TMPDIR: fixture.tmpdir },
    });
  });

  after(() => {
    service.dispose();
    cleanupGit();
    fixture.cleanup();
  });

  it('git-status returns records for a clean repo', async () => {
    const r = await service.status({ operation: 'git-status', workspaceId: WORKSPACE_ALPHA }, {});
    if (!r.ok) throw new Error(r.failure.code);
    assert.equal(r.ok, true);
    const v = r.value as { records: readonly { path: string }[] };
    assert.ok(Array.isArray(v.records));
  });

  it('git-status detects a modified tracked file', async () => {
    fs.writeFileSync(path.join(gitRoot, 'file.txt'), 'modified\n');
    try {
      const r = await service.status({ operation: 'git-status', workspaceId: WORKSPACE_ALPHA }, {});
      if (!r.ok) throw new Error(r.failure.code);
      assert.equal(r.ok, true);
      const v = r.value as { records: readonly { path: string; worktreeState: string }[] };
      const rec = v.records.find((x) => x.path === 'file.txt');
      assert.ok(rec, 'file.txt must appear in status');
      assert.notEqual(rec.worktreeState, ' ');
    } finally {
      // restore
      execFileSync(GIT_BIN, ['-C', gitRoot, 'checkout', '--', 'file.txt'], { stdio: 'ignore' });
    }
  });

  it('git-diff returns bounded text', async () => {
    fs.writeFileSync(path.join(gitRoot, 'file.txt'), 'diff content\n');
    try {
      const r = await service.diff({ operation: 'git-diff', workspaceId: WORKSPACE_ALPHA }, {});
      if (!r.ok) throw new Error(r.failure.code);
      assert.equal(r.ok, true);
      const v = r.value as { text: string; byteLength: number; truncated: boolean };
      assert.ok(v.text.length > 0);
      assert.ok(v.text.includes('diff content'));
    } finally {
      execFileSync(GIT_BIN, ['-C', gitRoot, 'checkout', '--', 'file.txt'], { stdio: 'ignore' });
    }
  });

  it('git-diff rejects colon pathspec magic', async () => {
    const r = await service.diff(
      { operation: 'git-diff', workspaceId: WORKSPACE_ALPHA, pathspecs: [':(glob)*.txt'] },
      {},
    );
    assert.equal(r.ok, false);
  });

  it('git-diff accepts a leading-dash filename after --', async () => {
    // create a file named "-weird"
    fs.writeFileSync(path.join(gitRoot, '-weird'), 'x\n');
    try {
      const r = await service.diff(
        { operation: 'git-diff', workspaceId: WORKSPACE_ALPHA, pathspecs: ['-weird'] },
        {},
      );
      assert.equal(r.ok, true);
    } finally {
      fs.rmSync(path.join(gitRoot, '-weird'), { force: true });
    }
  });

  it('git-log returns NUL-framed records', async () => {
    const r = await service.log({ operation: 'git-log', workspaceId: WORKSPACE_ALPHA }, {});
    if (!r.ok) throw new Error(r.failure.code);
    assert.equal(r.ok, true);
    const v = r.value as { records: readonly { commitId: string; subject: string }[] };
    assert.ok(v.records.length >= 1);
    for (const rec of v.records) {
      assert.match(rec.commitId, /^[0-9a-f]{40}$/);
    }
  });

  it('git-show returns a commit by full SHA', async () => {
    const log = await service.log({ operation: 'git-log', workspaceId: WORKSPACE_ALPHA }, {});
    if (!log.ok) throw new Error(log.failure.code);
    assert.equal(log.ok, true);
    const first = (log.value as { records: readonly { commitId: string }[] }).records[0];
    assert.ok(first);
    const r = await service.show(
      { operation: 'git-show', workspaceId: WORKSPACE_ALPHA, commitId: first.commitId },
      {},
    );
    if (!r.ok) throw new Error(r.failure.code);
    assert.equal(r.ok, true);
    const v = r.value as { commitId: string; subject: string };
    assert.equal(v.commitId, first.commitId);
  });

  it('git-show rejects short SHAs and refs', async () => {
    const r1 = await service.show({ operation: 'git-show', workspaceId: WORKSPACE_ALPHA, commitId: 'abc123' }, {});
    assert.equal(r1.ok, false);
    const r2 = await service.show({ operation: 'git-show', workspaceId: WORKSPACE_ALPHA, commitId: 'HEAD' }, {});
    assert.equal(r2.ok, false);
  });

  it('fails with ERR-GIT-NOT-REPO for a non-repository workspace', async () => {
    const r = await service.status({ operation: 'git-status', workspaceId: WORKSPACE_ALPHA, }, {});
    // Note: workspace points at gitRoot; use a different fixture for non-repo
    const f2 = createWp7Fixture();
    try {
      const { validateTrustedWorkspaceConfiguration, TRUSTED_HOST_LANE } = await import('../../../src/trusted/index.js');
      const report = validateTrustedWorkspaceConfiguration(
        {
          configurationVersion: '1',
          capabilityVocabularyVersion: 'v1',
          provenance: { sourceKind: 'trusted-local-control-plane' },
          workspaces: [{ workspaceId: WORKSPACE_ALPHA, root: f2.root }],
        },
        { hostLane: TRUSTED_HOST_LANE, resolveRootPath: (p: string) => p },
      );
      const lane2 = await initializeGitHostLane(GIT_BIN);
      if (!lane2.ok) throw new Error(lane2.error.message);
      const svc = new GitInspectionService({
        configuration: report.configuration!,
        gitLane: lane2.descriptor,
        envDirs: { HOME: fixture.home, TMPDIR: fixture.tmpdir },
      });
      const res = await svc.status({ operation: 'git-status', workspaceId: WORKSPACE_ALPHA }, {});
      assert.equal(res.ok, false);
      if (!res.ok) assert.equal(res.failure.code, 'ERR-GIT-NOT-REPO');
      svc.dispose();
    } finally {
      f2.cleanup();
    }
  });

  it('rejects unknown workspace with ERR-WS-UNKNOWN', async () => {
    const r = await service.status({ operation: 'git-status', workspaceId: 'pgw:w:ffffffffffffffff' }, {});
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-WS-UNKNOWN');
  });

  it('timeout produces ERR-GIT-TIMEOUT for a hung launch (deterministic)', async () => {
    // C-06: replace the previous non-test (a quick log that never exercised
    // timeout) with a deterministic hung-launch at the constrained process
    // boundary. A test-owned executable that sleeps is launched through the
    // real GitInspectionService with a lane descriptor whose fingerprint
    // matches that executable; the wrapper's pinned OPERATION_TIMEOUT_MS
    // (5000) must kill it and map to ERR-GIT-TIMEOUT.
    const fixture = createWp7Fixture();
    const g = createGitFixture();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-hang-'));
    try {
      const hangBin = path.join(scratch, 'git-hang');
      fs.writeFileSync(hangBin, `#!${process.execPath}\nsetTimeout(() => {}, 120000);\n`);
      fs.chmodSync(hangBin, 0o755);
      const st = statSync(hangBin);
      const fakeLane = {
        absolutePath: hangBin,
        version: '2.45.4',
        initialFingerprint: {
          dev: st.dev,
          ino: st.ino,
          mode: st.mode,
          size: st.size,
          mtimeMs: st.mtimeMs,
          sha256: createHash('sha256').update(fs.readFileSync(hangBin)).digest('hex'),
        },
      };
      const { validateTrustedWorkspaceConfiguration, TRUSTED_HOST_LANE } = await import('../../../src/trusted/index.js');
      const report = validateTrustedWorkspaceConfiguration(
        {
          configurationVersion: '1',
          capabilityVocabularyVersion: 'v1',
          provenance: { sourceKind: 'trusted-local-control-plane' },
          workspaces: [{ workspaceId: WORKSPACE_ALPHA, root: g.root }],
        },
        { hostLane: TRUSTED_HOST_LANE, resolveRootPath: (p: string) => p },
      );
      if (!report.ok) throw new Error('hang fixture config invalid');
      const svc = new GitInspectionService({
        configuration: report.configuration!,
        gitLane: fakeLane,
        envDirs: { HOME: fixture.home, TMPDIR: fixture.tmpdir },
      });
      const t0 = Date.now();
      const r = await svc.status({ operation: 'git-status', workspaceId: WORKSPACE_ALPHA }, {});
      const elapsed = Date.now() - t0;
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.failure.code, 'ERR-GIT-TIMEOUT');
        assert.ok(!JSON.stringify(r.failure).includes('stderr'), 'no raw stderr in timeout failure');
      }
      assert.ok(elapsed >= 4000, `timeout must be enforced by the wrapper (elapsed ${elapsed}ms)`);
      svc.dispose();
    } finally {
      g.cleanup();
      fixture.cleanup();
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('cancellation kills a hung git launch and maps to ERR-OP-CANCELLED (deterministic)', async () => {
    const fixture = createWp7Fixture();
    const g = createGitFixture();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-hang-'));
    try {
      const hangBin = path.join(scratch, 'git-hang');
      fs.writeFileSync(hangBin, `#!${process.execPath}\nsetTimeout(() => {}, 120000);\n`);
      fs.chmodSync(hangBin, 0o755);
      const st = statSync(hangBin);
      const fakeLane = {
        absolutePath: hangBin,
        version: '2.45.4',
        initialFingerprint: {
          dev: st.dev,
          ino: st.ino,
          mode: st.mode,
          size: st.size,
          mtimeMs: st.mtimeMs,
          sha256: createHash('sha256').update(fs.readFileSync(hangBin)).digest('hex'),
        },
      };
      const { validateTrustedWorkspaceConfiguration, TRUSTED_HOST_LANE } = await import('../../../src/trusted/index.js');
      const report = validateTrustedWorkspaceConfiguration(
        {
          configurationVersion: '1',
          capabilityVocabularyVersion: 'v1',
          provenance: { sourceKind: 'trusted-local-control-plane' },
          workspaces: [{ workspaceId: WORKSPACE_ALPHA, root: g.root }],
        },
        { hostLane: TRUSTED_HOST_LANE, resolveRootPath: (p: string) => p },
      );
      if (!report.ok) throw new Error('hang fixture config invalid');
      const svc = new GitInspectionService({
        configuration: report.configuration!,
        gitLane: fakeLane,
        envDirs: { HOME: fixture.home, TMPDIR: fixture.tmpdir },
      });
      const ctrl = new AbortController();
      const pending = svc.status({ operation: 'git-status', workspaceId: WORKSPACE_ALPHA }, { signal: ctrl.signal });
      setTimeout(() => ctrl.abort(), 100);
      const r = await pending;
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.failure.code, 'ERR-OP-CANCELLED');
      svc.dispose();
    } finally {
      g.cleanup();
      fixture.cleanup();
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('WP-7 Git: argv construction', () => {
  it('global prefix precedes subcommand with no executable-valued pagers', () => {
    const argv = buildGitArgv('status', ['--porcelain=v1', '-z']);
    // Global prefix comes first; the subcommand follows the fixed prefix.
    assert.equal(argv[0], '--no-pager');
    assert.equal(argv[argv.length - 3], 'status');
    assert.ok(argv.includes('--no-optional-locks'));
    assert.ok(argv.includes('--no-replace-objects'));
    assert.ok(argv.includes('status.showUntrackedFiles=normal'));
    // pager overrides are empty-valued
    for (let i = 0; i < argv.length - 1; i++) {
      const a = argv[i];
      const b = argv[i + 1];
      if (a === '-c' && typeof b === 'string' && b.startsWith('pager.')) {
        assert.equal(b.endsWith('='), true, `pager override must be empty-valued: ${b}`);
        assert.ok(!b.includes('cat') && !b.includes('false') && !b.includes('true'), b);
      }
    }
  });
});

describe('WP-7 Git: environment isolation', () => {
  it('sanitized environment contains no executable-valued helper variables', async () => {
    const { buildEnvForTest } = await import('../../../src/git/wrapper.js');
    const env = buildEnvForTest('/tmp/home', '/tmp/tmp');
    assert.equal(env.PATH, '');
    assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
    assert.equal(env.GIT_CONFIG_SYSTEM, '/dev/null');
    assert.equal(env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(env.GIT_ALTERNATE_OBJECT_DIRECTORIES, '');
    for (const key of ['GIT_PAGER', 'GIT_EDITOR', 'GIT_ASKPASS', 'GIT_SSH_COMMAND']) {
      assert.equal(key in env, false, `${key} must not be set`);
    }
  });
});
