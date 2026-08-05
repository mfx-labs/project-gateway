/**
 * WP-7-B — Shared test fixtures.
 *
 * Builds a real temporary workspace tree, validates a trusted configuration
 * against it, and supplies a real existing-path resolver backed by
 * node:fs `realpathSync` (the host-boundary resolver WP-7 consumes).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  validateTrustedWorkspaceConfiguration,
  TRUSTED_HOST_LANE,
  type ExistingPathResolver,
  type ExistingPathResolution,
  type ValidatedTrustedWorkspaceConfiguration,
} from '../../src/trusted/index.js';

export const WORKSPACE_ALPHA = 'pgw:w:aaaaaaaaaaaaaaaa';

export interface Wp7Fixture {
  readonly root: string;
  readonly configuration: ValidatedTrustedWorkspaceConfiguration;
  readonly resolveExistingPath: ExistingPathResolver;
  readonly home: string;
  readonly tmpdir: string;
  cleanup(): void;
}

function makeTree(base: string, relative: string): string {
  const dir = path.join(base, relative);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(base: string, relative: string, content: string | Buffer): void {
  const p = path.join(base, relative);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function realResolver(): ExistingPathResolver {
  return (p: string): ExistingPathResolution => {
    try {
      return { ok: true, canonical: fs.realpathSync(p) };
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT' || e.code === 'ELOOP' || e.code === 'ENOTDIR') {
        return { ok: false, code: 'not-found' };
      }
      return { ok: false, code: 'error' };
    }
  };
}

/**
 * Create a fixture: temp workspace with a conventional tree, validated
 * trusted configuration, and a real-path resolver. The workspace is
 * created under os.tmpdir(), which satisfies the "outside workspace roots"
 * constraint for HOME/TMPDIR validation.
 */
export function createWp7Fixture(): Wp7Fixture {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-test-'));
  const root = makeTree(base, 'workspace');
  // Conventional tree
  makeTree(root, 'docs');
  makeTree(root, 'src');
  makeTree(root, 'empty');
  writeFile(root, 'docs/notes.md', 'hello world\n');
  writeFile(root, 'src/main.ts', 'export const x = 1;\n');
  writeFile(root, 'src/alpha.txt', 'alpha content\n');
  writeFile(root, 'README.md', '# Project\n');
  // UTF-8 content with multi-byte chars
  writeFile(root, 'docs/unicode.md', 'café résumé — 日本語\n');

  const report = validateTrustedWorkspaceConfiguration(
    {
      configurationVersion: '1',
      capabilityVocabularyVersion: 'v1',
      provenance: { sourceKind: 'trusted-local-control-plane' },
      workspaces: [{ workspaceId: WORKSPACE_ALPHA, root }],
    },
    { hostLane: TRUSTED_HOST_LANE, resolveRootPath: (p: string) => p },
  );
  if (!report.ok) {
    fs.rmSync(base, { recursive: true, force: true });
    throw new Error(`fixture configuration invalid: ${report.findings.map((f) => f.code).join(',')}`);
  }

  // HOME and TMPDIR: separate empty dirs, outside the workspace
  const home = makeTree(base, 'home');
  const tmpdir = makeTree(base, 'tmpdir');
  // Make them non-group/world-writable and owned by the current user
  fs.chmodSync(home, 0o700);
  fs.chmodSync(tmpdir, 0o700);

  const fixture: Wp7Fixture = {
    root,
    configuration: report.configuration!,
    resolveExistingPath: realResolver(),
    home,
    tmpdir,
    cleanup() {
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
  return fixture;
}

/**
 * Create a temporary git repository fixture with configurable hostile
 * configuration content.
 */
export function createGitFixture(
  configContent?: string,
  extraSetup?: (root: string) => void,
): { root: string; cleanup(): void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-git-test-'));
  const root = makeTree(base, 'repo');
  // init a git repo with the host git binary
  execFileSync('/home/chef/.local/git-2.45.4/bin/git', ['init', '-q', root], { stdio: 'ignore' });
  // Set user identity to allow commits
  execFileSync('/home/chef/.local/git-2.45.4/bin/git', ['-C', root, 'config', 'user.email', 't@t'], { stdio: 'ignore' });
  execFileSync('/home/chef/.local/git-2.45.4/bin/git', ['-C', root, 'config', 'user.name', 't'], { stdio: 'ignore' });
  writeFile(root, 'file.txt', 'content\n');
  execFileSync('/home/chef/.local/git-2.45.4/bin/git', ['-C', root, 'add', 'file.txt'], { stdio: 'ignore' });
  execFileSync('/home/chef/.local/git-2.45.4/bin/git', ['-C', root, 'commit', '-q', '-m', 'init'], { stdio: 'ignore' });

  if (configContent !== undefined) {
    fs.writeFileSync(path.join(root, '.git', 'config'), configContent);
  }
  if (extraSetup) extraSetup(root);
  return {
    root,
    cleanup() {
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}
