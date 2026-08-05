/**
 * WP-7 — Git repository preflight.
 *
 * Before any Git invocation, inspects the repository through contained
 * controlled reads and rejects repositories with dangerous configuration,
 * alternates, commondir, etc.
 */
import { statSync, lstatSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WP7_LIMITS } from '../reader/types.js';
export interface PreflightError {
  readonly code: string;
  readonly message: string;
}

const DANGEROUS_CONFIG_PATTERNS: ReadonlyArray<{ section: string; keyPattern: RegExp }> = [
  { section: 'include', keyPattern: /^path$/ },
  { section: 'includeif', keyPattern: /.*/ },
  { section: 'core', keyPattern: /^worktree$/ },
  { section: 'core', keyPattern: /^fsmonitor$/ },
  { section: 'core', keyPattern: /^hookspath$/ },
  { section: 'diff', keyPattern: /^external$/ },
  { section: 'diff', keyPattern: /^[^.]+\.command$/ },
  { section: 'diff', keyPattern: /^[^.]+\.textconv$/ },
  { section: 'pager', keyPattern: /.*/ },
  { section: 'credential', keyPattern: /.*/ },
  { section: 'log', keyPattern: /^showsignature$/ },
  { section: 'gpg', keyPattern: /.*/ },
];

/**
 * Parse a simple INI-style config (hostile data, fail on any anomaly).
 * Returns sections as a Map<sectionName, Map<key, value>>.
 * Very strict: rejects accessor-like syntax, duplicates, malformed lines.
 */
function parseGitConfigStrict(content: string): Map<string, Map<string, string>> | PreflightError {
  const sections = new Map<string, Map<string, string>>();
  let currentSection: string | null = null;
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    // Skip empty lines and comments
    if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) continue;

    // Section header
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const rawSection = sectionMatch[1]!;
      // Reject subsection quoting and complex syntax
      if (rawSection.includes('"') || rawSection.includes('\\')) {
        return { code: 'malformed-config', message: `Complex section quoting at line ${i + 1}` };
      }
      // Normalize section name: strip inline comment, trim
      const section = rawSection.split(/[;#]/)[0]!.trim().toLowerCase();
      if (sections.has(section)) {
        return { code: 'duplicate-section', message: `Duplicate section [${section}] at line ${i + 1}` };
      }
      currentSection = section;
      sections.set(section, new Map());
      continue;
    }

    // Key-value
    const kvMatch = line.match(/^([^=]+)=\s*(.*)$/);
    if (kvMatch) {
      if (!currentSection) {
        return { code: 'malformed-config', message: `Key outside section at line ${i + 1}` };
      }
      const key = kvMatch[1]!.trim().toLowerCase();
      const value = kvMatch[2]!.split(/[;#]/)[0]!.trim();
      const map = sections.get(currentSection)!;
      if (map.has(key)) {
        return { code: 'duplicate-key', message: `Duplicate key ${currentSection}.${key} at line ${i + 1}` };
      }
      map.set(key, value);
      continue;
    }

    return { code: 'malformed-config', message: `Unrecognized line at ${i + 1}` };
  }
  return sections;
}

/**
 * Check if a config section+key matches any dangerous pattern.
 */
function isDangerousConfig(section: string, key: string): boolean {
  for (const pattern of DANGEROUS_CONFIG_PATTERNS) {
    // Match section prefixes like "diff.mytype" → "diff"
    const sectionBase = section.split('.')[0]!;
    if (pattern.section === sectionBase || pattern.section === section) {
      if (pattern.keyPattern.test(key)) return true;
    }
  }
  return false;
}

/**
 * Preflight a repository workspace root.
 * Returns null on success, or a PreflightError on rejection.
 */
export function preflightGitRepository(
  workspaceRoot: string,
): PreflightError | null {
  const dotGit = join(workspaceRoot, '.git');

  // 1. .git must exist and be a directory (not symlink, not file)
  let gitStat: ReturnType<typeof lstatSync>;
  try {
    gitStat = lstatSync(dotGit);
  } catch {
    return { code: 'no-git-dir', message: 'No .git entry at workspace root' };
  }

  // .git must NOT be a symlink
  if (gitStat.isSymbolicLink()) {
    return { code: 'git-is-symlink', message: '.git is a symlink' };
  }

  // .git must be a directory
  if (!gitStat.isDirectory()) {
    if (gitStat.isFile()) {
      return { code: 'worktree-not-supported', message: '.git is a file (worktree not supported)' };
    }
    return { code: 'git-not-directory', message: '.git is not a directory' };
  }

  // 2. Reject bare repos
  const headPath = join(dotGit, 'HEAD');
  if (!existsSync(headPath)) {
    return { code: 'bare-repo', message: 'Bare repository not supported' };
  }

  // 3. Reject commondir
  const commonDirPath = join(dotGit, 'commondir');
  if (existsSync(commonDirPath)) {
    return { code: 'commondir-present', message: '.git/commondir present — linked worktrees not supported' };
  }

  // 4. Reject alternates
  const alternatesPath = join(dotGit, 'objects', 'info', 'alternates');
  if (existsSync(alternatesPath)) {
    return { code: 'alternates-present', message: 'objects/info/alternates present — external object database not supported' };
  }

  // 5. Parse local config
  const configPath = join(dotGit, 'config');
  let configContent: string;
  try {
    const st = statSync(configPath);
    if (st.size > WP7_LIMITS.GIT_CONFIG_MAX_BYTES) {
      return { code: 'config-oversized', message: '.git/config exceeds maximum size' };
    }
    configContent = readFileSync(configPath, 'utf-8');
  } catch {
    // No config file — that's fine
    return null;
  }

  // Check for malformed UTF-8 by re-encoding
  if (Buffer.from(configContent, 'utf8').toString('utf8') !== configContent) {
    // Contains lone surrogates or invalid sequences
    return { code: 'config-malformed-utf8', message: '.git/config contains malformed UTF-8' };
  }

  const sections = parseGitConfigStrict(configContent);
  if ('code' in sections) return sections;

  // Check every section+key against dangerous patterns
  for (const [section, keys] of sections) {
    for (const key of keys.keys()) {
      if (isDangerousConfig(section, key)) {
        return { code: 'dangerous-config', message: `Dangerous config: [${section}] ${key}` };
      }
    }
  }

  return null;
}

/**
 * Determine whether the repository at the workspace root is unborn
 * (no commits yet on the current branch).
 *
 * Uses contained reads only: HEAD must exist (verified by preflight) and
 * must be a symbolic ref whose target ref file does not exist and is not
 * present in packed-refs. Detached HEAD is never "unborn" for this
 * purpose (a detached HEAD cannot exist in a commit-less repository).
 */
export function isUnbornRepository(workspaceRoot: string): boolean {
  const dotGit = join(workspaceRoot, '.git');
  const headPath = join(dotGit, 'HEAD');
  let head: string;
  try {
    head = readFileSync(headPath, 'utf8');
  } catch {
    return false; // cannot determine; preflight will have rejected the repo
  }
  const trimmed = head.trim();
  if (!trimmed.startsWith('ref: ')) return false;
  const refPath = trimmed.slice('ref: '.length).trim();
  if (refPath.length === 0) return false;
  const fullRefPath = join(dotGit, refPath);
  if (existsSync(fullRefPath)) return false;
  const packedRefsPath = join(dotGit, 'packed-refs');
  try {
    const packed = readFileSync(packedRefsPath, 'utf8');
    if (packed.includes(refPath)) return false;
  } catch {
    // no packed-refs: fine
  }
  return true;
}

/**
 * Verify that a workspace is a regular git repository suitable for inspection.
 */
export function verifyGitRepository(workspaceRoot: string): PreflightError | null {
  return preflightGitRepository(workspaceRoot);
}

// ---------------------------------------------------------------------------
// S-04: preflight fingerprint and prelaunch revalidation
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';

/** Security-relevant repository state captured at preflight time. */
export interface RepositoryPreflightFingerprint {
  readonly dotGit: {
    readonly exists: boolean;
    readonly dev: number;
    readonly ino: number;
    readonly mode: number;
  };
  readonly config: {
    readonly exists: boolean;
    readonly dev: number;
    readonly ino: number;
    readonly size: number;
    readonly mode: number;
    readonly mtimeMs: number;
    readonly sha256: string;
  } | null;
  readonly commondirPresent: boolean;
  readonly alternatesPresent: boolean;
  readonly classification: 'regular' | 'not-a-repo';
}

function fileDigest(p: string): string | null {
  try {
    const data = readFileSync(p);
    return createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Capture a fingerprint of the security-relevant repository state.
 * Must be called after a successful preflight; returns the state used
 * for prelaunch revalidation.
 */
export function captureRepositoryPreflightFingerprint(
  workspaceRoot: string,
): RepositoryPreflightFingerprint | null {
  const dotGit = join(workspaceRoot, '.git');
  try {
    const gitStat = statSync(dotGit);
    const configPath = join(dotGit, 'config');
    let config: RepositoryPreflightFingerprint['config'] = null;
    try {
      const st = statSync(configPath);
      config = {
        exists: true,
        dev: st.dev,
        ino: st.ino,
        size: st.size,
        mode: st.mode,
        mtimeMs: st.mtimeMs,
        sha256: fileDigest(configPath) ?? '',
      };
    } catch {
      config = null; // no config file
    }
    return {
      dotGit: { exists: true, dev: gitStat.dev, ino: gitStat.ino, mode: gitStat.mode },
      config,
      commondirPresent: existsSync(join(dotGit, 'commondir')),
      alternatesPresent: existsSync(join(dotGit, 'objects', 'info', 'alternates')),
      classification: 'regular',
    };
  } catch {
    return null;
  }
}

/**
 * Revalidate the repository preflight fingerprint immediately before launch.
 * Returns an error message on drift; null when unchanged.
 */
export function revalidateRepositoryPreflightFingerprint(
  workspaceRoot: string,
  expected: RepositoryPreflightFingerprint,
): string | null {
  const dotGit = join(workspaceRoot, '.git');
  let gitStat;
  try {
    gitStat = statSync(dotGit);
  } catch {
    return 'repository .git disappeared before launch';
  }
  if (gitStat.dev !== expected.dotGit.dev || gitStat.ino !== expected.dotGit.ino || gitStat.mode !== expected.dotGit.mode) {
    return '.git identity changed before launch';
  }
  const commondirPresent = existsSync(join(dotGit, 'commondir'));
  if (commondirPresent !== expected.commondirPresent) {
    return 'commondir state changed before launch';
  }
  const alternatesPresent = existsSync(join(dotGit, 'objects', 'info', 'alternates'));
  if (alternatesPresent !== expected.alternatesPresent) {
    return 'alternates state changed before launch';
  }
  const configPath = join(dotGit, 'config');
  const configExists = existsSync(configPath);
  if (expected.config === null) {
    if (configExists) return '.git/config appeared before launch';
    return null;
  }
  if (!configExists) return '.git/config disappeared before launch';
  let st;
  try {
    st = statSync(configPath);
  } catch {
    return '.git/config unreadable before launch';
  }
  if (st.dev !== expected.config.dev || st.ino !== expected.config.ino || st.size !== expected.config.size || st.mode !== expected.config.mode || st.mtimeMs !== expected.config.mtimeMs) {
    return '.git/config changed before launch';
  }
  const digest = fileDigest(configPath);
  if (digest !== expected.config.sha256) {
    return '.git/config content changed before launch';
  }
  return null;
}
