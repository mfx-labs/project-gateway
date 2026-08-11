/**
 * WP-14A — host-owned workspace lanes for the stdio MCP runtime.
 *
 * Trusted composition support (consumed ONLY by the composition root in
 * `compose.ts`): builds, per surface with configured workspaces, the
 * genuine WP-14A lanes:
 *
 * - the runtime-genuine validated trusted configuration (through the
 *   accepted WP-6 Phase-1 validator with REAL host resolvers — no
 *   hand-built configuration for the WP-14A lanes);
 * - the controlled-persistence lane (genuine configuration + the real
 *   prospective-destination resolver + the committed WP-11 host write
 *   executor — the ONLY filesystem-mutation boundary);
 * - the changed-context lane (committed WP-7 controlled Git inspection and
 *   workspace read services).
 *
 * All resolvers here are host observation only: they resolve/observe, they
 * never decide containment or grant write authority. No mutation
 * vocabulary exists in this module (the executor lives in
 * `src/writing/executor.ts`; the WP-7 services own their descriptor-bound
 * read discipline).
 *
 * WP-14B INTEGRATION CORRECTION (git lane environment): the controlled Git
 * child process requires EMPTY operator-owned HOME/TMPDIR directories
 * outside every workspace root (committed WP-7 `validateHostDirectory`
 * contract). The operator's real HOME is never empty and can never be
 * used; the operator supplies dedicated empty directories (`gitHome` /
 * `gitTmpdir` surface config) — never the real home, never a workspace
 * root. Absence fails composition closed with a typed message.
 *
 * SECRETS: this module carries no credentials. Tunnel/auth credentials are
 * operator-local and owned by the external tunnel/platform; Gateway
 * runtime configuration remains secret-free (ADR-040 Decision D).
 */
import { realpathSync, lstatSync, statSync } from 'node:fs';
import {
  TRUSTED_HOST_LANE,
  CAPABILITY_VOCABULARY_VERSION,
  validateTrustedWorkspaceConfiguration,
} from '../../trusted/index.js';
import type {
  ArtifactLocationResolution,
  ArtifactLocationResolver,
  ExistingPathResolution,
  ExistingPathResolver,
  ProspectiveDestinationResolution,
  ProspectiveDestinationResolutionRequest,
  ProspectiveDestinationResolver,
  RootPathResolver,
  ValidatedTrustedWorkspaceConfiguration,
} from '../../trusted/index.js';
import { initializeGitHostLane } from '../../git/host-lane.js';
import type { GitHostLaneDescriptor } from '../../git/host-lane.js';
import { GitInspectionService } from '../../git/service.js';
import { WorkspaceInspectionService } from '../../reader/service.js';
import { executeDraftFileWrite } from '../../writing/executor.js';
import type { PersistLane } from '../../adapters/mcp/index.js';
import type { ChangesLane } from '../../adapters/mcp/index.js';

/** One operator-configured workspace lane entry (closed fields). */
export interface WorkspaceLaneEntry {
  readonly workspaceId: string;
  /** Operator-supplied absolute workspace root (canonicalized at validation). */
  readonly root: string;
  /** Optional version-2 configured artifact location (strict descendant of the root). */
  readonly artifactLocation?: string;
}

/** Complete WP-14A host lanes for one surface. */
export interface WorkspaceLanes {
  /** Runtime-genuine validated trusted configuration (single object for both lanes). */
  readonly configuration: ValidatedTrustedWorkspaceConfiguration;
  readonly persistLane: PersistLane;
  readonly changesLane: ChangesLane;
}

export type WorkspaceLanesResult =
  | { readonly ok: true; readonly lanes: WorkspaceLanes }
  | { readonly ok: false; readonly message: string };

/** Real root-path resolver: canonicalizes an existing path (symlink-resolved). */
export function createRootPathResolver(): RootPathResolver {
  return (path: string): string | null => {
    try {
      return realpathSync(path);
    } catch {
      return null;
    }
  };
}

/** Real artifact-location resolver: existing directory only; typed failures otherwise. */
export function createArtifactLocationResolver(): ArtifactLocationResolver {
  return (absolutePath: string): ArtifactLocationResolution => {
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(absolutePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ELOOP') return { ok: false, code: 'loop' };
      if (code === 'EACCES' || code === 'EPERM') return { ok: false, code: 'inaccessible' };
      return { ok: false, code: 'not-found' };
    }
    if (st.isSymbolicLink()) {
      // The resolved target must itself be a directory; resolve once and
      // re-observe (symlink-to-directory is accepted by the WP-6 phase-1
      // lane; broken/looping links fail closed).
      let resolved: string;
      try {
        resolved = realpathSync(absolutePath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ELOOP') return { ok: false, code: 'loop' };
        return { ok: false, code: 'not-found' };
      }
      let target: ReturnType<typeof statSync>;
      try {
        target = statSync(resolved);
      } catch {
        return { ok: false, code: 'not-found' };
      }
      if (!target.isDirectory()) return { ok: false, code: 'unsupported-entry-kind' };
      return { ok: true, canonicalPath: resolved, entryKind: 'directory' };
    }
    if (!st.isDirectory()) return { ok: false, code: 'unsupported-entry-kind' };
    try {
      return { ok: true, canonicalPath: realpathSync(absolutePath), entryKind: 'directory' };
    } catch {
      return { ok: false, code: 'error' };
    }
  };
}

/** Real existing-path resolver (WP-7 read lane): typed not-found/loop/error. */
export function createExistingPathResolver(): ExistingPathResolver {
  return (absolutePath: string): ExistingPathResolution => {
    try {
      return { ok: true, canonical: realpathSync(absolutePath) };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ELOOP') return { ok: false, code: 'loop' };
      if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, code: 'not-found' };
      return { ok: false, code: 'error' };
    }
  };
}

/**
 * Real prospective-destination resolver (WP-11 lane): observes the actual
 * artifact root, the longest existing-directory lexical prefix (lstat,
 * no-follow), the canonical ancestor (realpath), and the final target
 * state. Host observation only — never a containment decision. Modeled on
 * the accepted WP-11 test-lane resolver with hardened failure evidence.
 */
export function createProspectiveDestinationResolver(): ProspectiveDestinationResolver {
  return (request: Readonly<ProspectiveDestinationResolutionRequest>): ProspectiveDestinationResolution => {
    const root = request.canonicalArtifactRoot;
    let rootStat: ReturnType<typeof lstatSync>;
    try {
      rootStat = lstatSync(root);
    } catch {
      return { ok: false, subject: 'artifact-root', code: 'not-found' };
    }
    if (!rootStat.isDirectory()) return { ok: false, subject: 'artifact-root', code: 'not-directory' };
    const absolute = request.absoluteProspectiveDestination;
    if (!absolute.startsWith(`${root}/`)) {
      return { ok: false, subject: 'resolution', code: 'error' };
    }
    const components = absolute.slice(root.length + 1).split('/');
    const prefix: string[] = [];
    let prefixPath = root;
    for (const component of components) {
      const candidate = `${prefixPath}/${component}`;
      let st: ReturnType<typeof lstatSync>;
      try {
        st = lstatSync(candidate);
      } catch {
        break;
      }
      if (st.isDirectory()) {
        prefix.push(component);
        prefixPath = candidate;
      } else {
        break;
      }
    }
    let canonicalAncestor: string;
    try {
      canonicalAncestor = prefix.length === 0 ? root : realpathSync(prefixPath);
    } catch {
      return { ok: false, subject: 'existing-ancestor', code: 'error' };
    }
    const full = `${root}/${components.join('/')}`;
    let targetState: 'missing' | 'existing-file' | 'existing-directory' | 'existing-symlink' | 'dangling-symlink' | 'unsupported-kind' = 'missing';
    try {
      const st = lstatSync(full);
      if (st.isFile()) {
        targetState = 'existing-file';
      } else if (st.isDirectory()) {
        targetState = 'existing-directory';
      } else if (st.isSymbolicLink()) {
        try {
          statSync(full);
          targetState = 'existing-symlink';
        } catch {
          targetState = 'dangling-symlink';
        }
      } else {
        targetState = 'unsupported-kind';
      }
    } catch {
      targetState = 'missing';
    }
    const tail = components.slice(prefix.length);
    return {
      ok: true,
      currentCanonicalArtifactRoot: root,
      artifactRootEntryKind: 'directory',
      lexicalExistingDirectoryPrefixComponents: prefix,
      canonicalExistingDirectoryAncestor: canonicalAncestor,
      existingAncestorEntryKind: 'directory',
      destinationTailComponents: tail,
      targetState,
    };
  };
}

/**
 * Build the WP-14A lanes for one surface from the operator-configured
 * workspace entries. Failures are typed composition failures (operator
 * configuration/environment errors); nothing partial is returned.
 */
export async function buildWorkspaceLanes(input: {
  readonly configurationVersion: string;
  readonly workspaces: readonly WorkspaceLaneEntry[];
  readonly gitPath: string;
  readonly home: string;
  readonly tmpdir: string;
}): Promise<WorkspaceLanesResult> {
  const configurationReport = validateTrustedWorkspaceConfiguration(
    {
      configurationVersion: input.configurationVersion,
      capabilityVocabularyVersion: CAPABILITY_VOCABULARY_VERSION,
      provenance: { sourceKind: 'trusted-local-control-plane' },
      workspaces: input.workspaces.map((w) => ({
        workspaceId: w.workspaceId,
        root: w.root,
        ...(w.artifactLocation !== undefined ? { artifactLocation: w.artifactLocation } : {}),
      })),
    },
    {
      hostLane: TRUSTED_HOST_LANE,
      resolveRootPath: createRootPathResolver(),
      ...(input.workspaces.some((w) => w.artifactLocation !== undefined)
        ? { resolveArtifactLocation: createArtifactLocationResolver() }
        : {}),
    },
  );
  if (!configurationReport.ok || configurationReport.configuration === undefined) {
    const first = configurationReport.findings[0];
    return { ok: false, message: `workspace lane configuration invalid: ${first?.code ?? 'unknown'}` };
  }
  const configuration = configurationReport.configuration;

  const laneResult = await initializeGitHostLane(input.gitPath);
  if (!laneResult.ok) {
    return { ok: false, message: `git host lane initialization failed: ${laneResult.error.code}` };
  }
  const gitLane: GitHostLaneDescriptor = laneResult.descriptor;

  let reader: WorkspaceInspectionService;
  let git: GitInspectionService;
  try {
    reader = new WorkspaceInspectionService({
      configuration,
      resolveExistingPath: createExistingPathResolver(),
    });
    git = new GitInspectionService({
      configuration,
      gitLane,
      envDirs: { HOME: input.home, TMPDIR: input.tmpdir },
    });
  } catch (err) {
    return { ok: false, message: `workspace lane services failed to construct: ${err instanceof Error ? err.message : 'unknown error'}` };
  }

  const persistLane: PersistLane = {
    configuration,
    resolveProspectiveDestination: createProspectiveDestinationResolver(),
    writeDraftFile: executeDraftFileWrite,
  };
  const changesLane: ChangesLane = {
    configuration,
    git,
    reader,
  };
  return { ok: true, lanes: { configuration, persistLane, changesLane } };
}
