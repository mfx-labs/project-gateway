/**
 * WP-7 — Git process wrapper.
 *
 * The wrapper may launch only the trusted Git binary. No shell.
 * Fixed global argv prefix applied before every subcommand.
 * Sanitized child environment constructed from scratch.
 * HOME and TMPDIR are host-preprovisioned and must be supplied.
 */
import { execFile, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitHostLaneDescriptor } from './host-lane.js';
import { revalidateGitHostLane } from './host-lane.js';
import { WP7_LIMITS } from '../reader/types.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Fixed global argv prefix (applied before every subcommand)
// ---------------------------------------------------------------------------

const GLOBAL_ARGV: readonly string[] = Object.freeze([
  '--no-pager',
  '--no-optional-locks',
  '--no-replace-objects',
  '-c', 'core.fsmonitor=',
  '-c', 'core.hooksPath=',
  '-c', 'core.pager=',
  '-c', 'pager.status=',
  '-c', 'pager.diff=',
  '-c', 'pager.log=',
  '-c', 'pager.show=',
  '-c', 'diff.external=',
  '-c', 'core.attributesfile=/dev/null',
  '-c', 'credential.helper=',
  '-c', 'log.showSignature=false',
  '-c', 'status.showUntrackedFiles=normal',
]);

/** Test-visible: the fixed global prefix before the subcommand. */
export const GLOBAL_ARGV_TEST: readonly string[] = GLOBAL_ARGV;

/** Build the exact argv: global prefix + subcommand + fixed args. */
export function buildGitArgv(subcommand: string, subcommandArgs: readonly string[]): string[] {
  return [...GLOBAL_ARGV, subcommand, ...subcommandArgs];
}

// ---------------------------------------------------------------------------
// Sanitized environment
// ---------------------------------------------------------------------------

export interface GitChildEnvironment {
  readonly HOME: string;
  readonly TMPDIR: string;
}

function buildEnv(home: string, tmpdir: string): Record<string, string> {
  return {
    LC_ALL: 'C',
    LANG: 'C',
    PATH: '',
    HOME: home,
    TMPDIR: tmpdir,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALTERNATE_OBJECT_DIRECTORIES: '',
    // All other GIT_* variables are NOT set
  };
}

/** Test-visible: construct the sanitized child environment. */
export function buildEnvForTest(home: string, tmpdir: string): Record<string, string> {
  return buildEnv(home, tmpdir);
}

// ---------------------------------------------------------------------------
// Git execution result
// ---------------------------------------------------------------------------

export interface GitExecutionSuccess {
  readonly ok: true;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitExecutionFailure {
  readonly ok: false;
  readonly code: 'timeout' | 'unavailable' | 'sanitized-failure' | 'signal';
  readonly exitCode?: number;
  readonly signal?: string;
}

export type GitExecutionResult = GitExecutionSuccess | GitExecutionFailure;

// ---------------------------------------------------------------------------
// Execute Git
// ---------------------------------------------------------------------------

export async function executeGit(
  descriptor: GitHostLaneDescriptor,
  envDirs: GitChildEnvironment,
  cwd: string,
  subcommand: string,
  subcommandArgs: readonly string[],
  signal?: AbortSignal,
): Promise<GitExecutionResult> {
  // 1. Revalidate fingerprint
  const drift = revalidateGitHostLane(descriptor);
  if (drift) return { ok: false, code: 'unavailable' };

  // 2. Build argv: global prefix + subcommand + args
  const argv = buildGitArgv(subcommand, subcommandArgs);

  // 3. Sanitized child environment
  const env = buildEnv(envDirs.HOME, envDirs.TMPDIR);

  // 4. Check cancellation
  if (signal?.aborted) return { ok: false, code: 'signal' };

  // 5. Execute with cwd pinned to the workspace root (GIT-019: the
  //    repository MUST be the workspace root itself; no parent walk-up).
  const options: ExecFileOptions = {
    env,
    cwd,
    timeout: WP7_LIMITS.OPERATION_TIMEOUT_MS,
    maxBuffer: WP7_LIMITS.GIT_MAX_OUTPUT_BYTES,
    signal,
    shell: false, // never a shell
    windowsHide: true,
  };

  try {
    const { stdout, stderr } = await execFileAsync(
      descriptor.absolutePath,
      argv,
      options,
    );
    return { ok: true, stdout: String(stdout), stderr: String(stderr) };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string; code?: string };
    if (signal?.aborted) return { ok: false, code: 'signal' };
    if (e.killed || e.code === 'ETIMEDOUT') return { ok: false, code: 'timeout' };
    if (e.code === 'ENOENT') return { ok: false, code: 'unavailable' };
    // Nonzero exit: sanitized failure
    return { ok: false, code: 'sanitized-failure', exitCode: typeof e.code === 'number' ? e.code : (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? undefined : undefined) };
  }
}

// ---------------------------------------------------------------------------
// Status parser
// ---------------------------------------------------------------------------

export interface GitStatusRecord {
  readonly path: string;
  readonly indexState: string;
  readonly worktreeState: string;
  readonly originalPath?: string;
}

/**
 * Parse `git status --porcelain=v1 -z` output into structured records.
 * NUL-delimited, supports rename/copy records.
 */
export function parseGitStatus(stdout: string): { records: GitStatusRecord[] } | { error: string } {
  const records: GitStatusRecord[] = [];
  const parts = stdout.split('\0');

  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry === undefined || entry.length === 0) continue;

    if (entry.length < 4) {
      return { error: `malformed status entry at index ${i}: too short` };
    }

    const indexState = entry[0]!;
    const worktreeState = entry[1]!;
    const space = entry[2]!;
    if (space !== ' ') return { error: `malformed status entry at index ${i}: missing space separator` };

    const rest = entry.substring(3);

    // Rename/copy records: R or C followed by NUL-separated paths
    if ((indexState === 'R' || indexState === 'C') || (worktreeState === 'R' || worktreeState === 'C')) {
      i++;
      const nextPart = parts[i];
      if (nextPart === undefined) return { error: `truncated rename/copy record at index ${i}` };
      // rest is the first path, nextPart is the second (original path)
      records.push({
        path: nextPart,
        indexState,
        worktreeState,
        originalPath: rest,
      });
    } else {
      records.push({ path: rest, indexState, worktreeState });
    }
  }

  // Sort by path UTF-8 byte order
  records.sort((a, b) => {
    const bufA = Buffer.from(a.path, 'utf8');
    const bufB = Buffer.from(b.path, 'utf8');
    const len = Math.min(bufA.length, bufB.length);
    for (let i = 0; i < len; i++) {
      const diff = (bufA[i] ?? 0) - (bufB[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return bufA.length - bufB.length;
  });

  return { records };
}

// ---------------------------------------------------------------------------
// Log parser
// ---------------------------------------------------------------------------

/**
 * Parse `git log --format=%H%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x00%B%x00%x00`
 * NUL-delimited output. Fields per record: commitId, authorName, authorEmail,
 * authorDate, commitDate, subject, message. Record separator: double-NUL.
 */
export interface GitLogRecord {
  readonly commitId: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorDate: string;
  readonly commitDate: string;
  readonly subject: string;
  readonly message: string;
}

export function parseGitLog(stdout: string, maxRecords: number): { records: GitLogRecord[]; truncated: boolean } | { error: string } {
  const records: GitLogRecord[] = [];
  // git terminates format output with exactly one trailing newline after the
  // final %x00%x00 record separator; strip it before splitting so the final
  // separator yields a single trailing empty element (dropped below).
  const normalized = stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout;
  const rawRecords = normalized.split('\0\0');
  // Drop a single trailing empty element produced by the final record separator.
  if (rawRecords.length > 0 && rawRecords[rawRecords.length - 1] === '') {
    rawRecords.pop();
  }
  let truncated = rawRecords.length > maxRecords;

  const toConsume = Math.min(rawRecords.length, maxRecords);

  for (let i = 0; i < toConsume; i++) {
    const raw = rawRecords[i];
    if (raw === undefined || raw.length === 0) continue;

    // Fields within a record are \0 separated
    const fields = raw.split('\0');
    // Expected: H, an, ae, aI, cI, s, B (7 fields; message may contain NULs
    // only if the commit body contains them, which is extremely unlikely, so
    // fields beyond index 5 are rejoined into the message).
    const commitId = fields[0] ?? '';
    const authorName = fields[1] ?? '';
    const authorEmail = fields[2] ?? '';
    const authorDate = fields[3] ?? '';
    const commitDate = fields[4] ?? '';
    const subject = fields[5] ?? '';
    const message = fields.slice(6).join('\0');

    if (!/^[0-9a-f]{40}$/.test(commitId)) {
      return { error: `malformed commit ID in record ${i}` };
    }

    records.push({
      commitId,
      authorName,
      authorEmail,
      authorDate,
      commitDate,
      subject,
      message,
    });
  }

  // Sort: commit date descending, commit ID ascending for ties
  records.sort((a, b) => {
    if (a.commitDate > b.commitDate) return -1;
    if (a.commitDate < b.commitDate) return 1;
    // Tie: commit ID ascending
    return a.commitId < b.commitId ? -1 : a.commitId > b.commitId ? 1 : 0;
  });

  return { records, truncated };
}

// ---------------------------------------------------------------------------
// Show parser
// ---------------------------------------------------------------------------

/**
 * Parse `git show --format=%H%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x00%B%x00%x00`
 * Output format is the same as log: metadata NUL-delimited, double-NUL
 * terminator, then the raw diff/stat text follows after the double-NUL.
 */
export interface GitShowParsed {
  readonly commitId: string;
  readonly subject: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorDate: string;
  readonly commitDate: string;
  readonly message: string;
  readonly stat?: string;
}

export function parseGitShow(stdout: string): GitShowParsed | { error: string } {
  // git terminates with a trailing newline after the final %x00%x00.
  const normalized = stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout;
  // Split on double-NUL: first part is metadata, rest is stat/diff
  const idx = normalized.indexOf('\0\0');
  let metadataPart: string;
  let statPart: string | undefined;

  if (idx >= 0) {
    metadataPart = normalized.substring(0, idx);
    statPart = normalized.substring(idx + 2);
  } else {
    metadataPart = normalized;
  }

  const fields = metadataPart.split('\0');
  if (fields.length < 7) {
    return { error: 'malformed show output: insufficient metadata fields' };
  }

  const commitId = fields[0] ?? '';
  const authorName = fields[1] ?? '';
  const authorEmail = fields[2] ?? '';
  const authorDate = fields[3] ?? '';
  const commitDate = fields[4] ?? '';
  const subject = fields[5] ?? '';
  const message = fields.slice(6).join('\0');

  if (!/^[0-9a-f]{40}$/.test(commitId)) {
    return { error: 'malformed commit ID in show output' };
  }

  return {
    commitId,
    subject,
    authorName,
    authorEmail,
    authorDate,
    commitDate,
    message,
    stat: statPart && statPart.length > 0 ? statPart : undefined,
  };
}
