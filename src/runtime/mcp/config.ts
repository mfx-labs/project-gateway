/**
 * WP-9 Slice 5 — operator-owned startup configuration for the local stdio
 * MCP runtime.
 *
 * The CLI is an in-package trusted composition root. This module defines the
 * ONE minimal operator-facing config contract: the exact facts required to
 * reconstruct existing trusted registrations through the private/trusted
 * composition pipeline. Loading JSON from disk does NOT make it trusted —
 * the genuine-brand/trusted-bootstrap pipeline still gates every
 * registration (see `compose.ts`).
 *
 * Closed fields only. No authority flags, no storage semantics, no
 * generation seeds, no transport sessions, no per-tool permissions.
 * The config path is operator-owned startup input, never an MCP request
 * field.
 *
 * Independent-review corrections (F1-F3): the document read is bounded by a
 * runtime-local byte ceiling before parse/allocation; duplicate object keys
 * are rejected at every nesting level through the accepted repository raw-
 * JSON intake; and every limitProfile override routes through the committed
 * config-selection gate (LMT-013).
 */
import { openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { parseRawJson, RawJsonError } from '../../json/scanner.js';
import { SURFACE_ID_RE } from '../../adapters/mcp/index.js';
import { SURFACE_ID_MAX_LENGTH } from '../../adapters/mcp/registry.js';
import { validateLimitSelection } from '../../storage/limits/limits.js';

/**
 * Runtime-local startup-configuration byte ceiling (F1 correction).
 *
 * No existing accepted limit is semantically the operator startup
 * configuration document: METADATA_MAX_BYTES bounds a store-metadata record
 * and the WP-3 INPUT_BYTE_LIMITS bound artifact/registry documents — none is
 * an operator composition file. A narrow runtime-local robustness bound is
 * therefore defined here (deliberately NOT a storage/domain limit concept;
 * it never enters any limit profile). 1 MiB accommodates on the order of a
 * thousand surface entries while capping parse/allocation memory.
 */
export const MAX_STARTUP_CONFIG_BYTES = 1024 * 1024;

/** One registered inspection surface (mirrors the committed McpStoreRegistrationInput facts). */
export interface SurfaceConfig {
  /** Logical host-owned surface identifier (closed pattern; lookup data only). */
  readonly surfaceId: string;
  /** Trusted store parent locator (the directory containing `store-v1/` and `config-v1/`). */
  readonly locator: string;
  /** Trusted service UID (defaults to the current process UID when omitted). */
  readonly serviceUid: number;
  /** Forbidden roots set (defaults to empty). */
  readonly forbiddenRoots: readonly string[];
  /** Trusted configuration identity (must match the store metadata). */
  readonly configurationIdentity: string;
  /** Trusted configuration version (must match the store metadata). */
  readonly configurationVersion: string;
  /** Optional limit-profile overrides merged onto the repository defaults. */
  readonly limitProfile: Readonly<Record<string, number>>;
  /**
   * Optional WP-14A workspace lanes (controlled proposal persistence +
   * changed-context inspection). Absent/empty → the WP-14A tools exist but
   * return the typed `unsupported` outcome for this surface.
   */
  readonly workspaces?: readonly SurfaceWorkspaceConfig[];
  /** Optional Git binary path for the changed-context lane (default `/usr/bin/git`). */
  readonly gitPath?: string;
  /**
   * Required (with `gitTmpdir`) when `workspaces` is configured: an EMPTY,
   * operator-owned directory OUTSIDE every workspace root, used as the
   * isolated HOME for the controlled Git child process (WP-7 lane
   * requirement). Never the operator's real home directory.
   */
  readonly gitHome?: string;
  /**
   * Required (with `gitHome`) when `workspaces` is configured: an EMPTY,
   * operator-owned directory OUTSIDE every workspace root, used as the
   * isolated TMPDIR for the controlled Git child process (WP-7 lane
   * requirement).
   */
  readonly gitTmpdir?: string;
}

/** One operator-configured workspace lane entry (WP-14A). */
export interface SurfaceWorkspaceConfig {
  /** Opaque workspace identifier (e.g. `pgw:w:<32-hex>`). */
  readonly workspaceId: string;
  /** Absolute workspace root path. */
  readonly root: string;
  /** Optional absolute artifact-location directory (version-2 configuration only). */
  readonly artifactLocation?: string;
}

/** The closed startup-config document. */
export interface RuntimeConfig {
  readonly surfaces: readonly SurfaceConfig[];
}

export type ConfigLoadResult = { readonly ok: true; readonly config: RuntimeConfig } | { readonly ok: false; readonly message: string };

const SHA256_IDENTITY_RE = /^sha-256:[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Closed-field validation of one surface entry (never coerced). */
function validateSurface(raw: unknown, index: number): { readonly ok: true; readonly surface: SurfaceConfig } | { readonly ok: false; readonly message: string } {
  const label = `surfaces[${index}]`;
  if (!isRecord(raw)) return { ok: false, message: `${label} must be an object` };
  const keys = Object.keys(raw);
  for (const key of keys) {
    if (!['surfaceId', 'locator', 'serviceUid', 'forbiddenRoots', 'configurationIdentity', 'configurationVersion', 'limitProfile', 'workspaces', 'gitPath', 'gitHome', 'gitTmpdir'].includes(key)) {
      return { ok: false, message: `${label} has an unknown field: ${key}` };
    }
  }
  const surfaceId = raw['surfaceId'];
  if (typeof surfaceId !== 'string' || surfaceId.length === 0 || surfaceId.length > SURFACE_ID_MAX_LENGTH) {
    return { ok: false, message: `${label}.surfaceId must be a bounded non-empty string` };
  }
  if (!SURFACE_ID_RE.test(surfaceId)) {
    return { ok: false, message: `${label}.surfaceId is outside the closed logical identifier pattern` };
  }
  const locator = raw['locator'];
  if (typeof locator !== 'string' || !locator.startsWith('/')) {
    return { ok: false, message: `${label}.locator must be an absolute path string` };
  }
  let serviceUid: number;
  if (raw['serviceUid'] === undefined) {
    serviceUid = process.getuid?.() ?? 0;
  } else {
    const rawUid = raw['serviceUid'];
    if (typeof rawUid !== 'number' || !Number.isSafeInteger(rawUid) || rawUid < 0) {
      return { ok: false, message: `${label}.serviceUid must be a non-negative safe integer` };
    }
    serviceUid = rawUid;
  }
  let forbiddenRoots: readonly string[];
  if (raw['forbiddenRoots'] === undefined) {
    forbiddenRoots = [];
  } else {
    const rawRoots = raw['forbiddenRoots'];
    if (!Array.isArray(rawRoots) || rawRoots.some((r) => typeof r !== 'string' || !r.startsWith('/'))) {
      return { ok: false, message: `${label}.forbiddenRoots must be an array of absolute path strings` };
    }
    forbiddenRoots = rawRoots as readonly string[];
  }
  const configurationIdentity = raw['configurationIdentity'];
  if (typeof configurationIdentity !== 'string' || !SHA256_IDENTITY_RE.test(configurationIdentity)) {
    return { ok: false, message: `${label}.configurationIdentity must use sha-256:<64-hex> syntax` };
  }
  const configurationVersion = raw['configurationVersion'];
  if (typeof configurationVersion !== 'string' || configurationVersion.length === 0) {
    return { ok: false, message: `${label}.configurationVersion must be a non-empty string` };
  }
  let limitProfile: Readonly<Record<string, number>> = {};
  if (raw['limitProfile'] !== undefined) {
    const rawProfile = raw['limitProfile'];
    if (!isRecord(rawProfile)) return { ok: false, message: `${label}.limitProfile must be an object` };
    // F3 correction (LMT-013): every override routes through the committed
    // config-selection gate — the single authority for known limit names,
    // hard minimum, hard maximum, and config-selectability. No runtime
    // copy of the limit table exists and no weaker check is applied.
    for (const key of Object.keys(rawProfile)) {
      const selection = validateLimitSelection(key, rawProfile[key] as number, true);
      if (!selection.ok) {
        return { ok: false, message: `${label}.limitProfile.${key} is outside the committed config-selection contract (${selection.reason})` };
      }
    }
    limitProfile = rawProfile as Readonly<Record<string, number>>;
  }
  let workspaces: readonly SurfaceWorkspaceConfig[] | undefined;
  if (raw['workspaces'] !== undefined) {
    const rawWorkspaces = raw['workspaces'];
    if (!Array.isArray(rawWorkspaces)) return { ok: false, message: `${label}.workspaces must be an array` };
    const parsed: SurfaceWorkspaceConfig[] = [];
    const seenWorkspaces = new Set<string>();
    for (let i = 0; i < rawWorkspaces.length; i++) {
      const wLabel = `${label}.workspaces[${i}]`;
      const rawWs = rawWorkspaces[i];
      if (!isRecord(rawWs)) return { ok: false, message: `${wLabel} must be an object` };
      for (const key of Object.keys(rawWs)) {
        if (!['workspaceId', 'root', 'artifactLocation'].includes(key)) {
          return { ok: false, message: `${wLabel} has an unknown field: ${key}` };
        }
      }
      const workspaceId = rawWs['workspaceId'];
      if (typeof workspaceId !== 'string' || workspaceId.length === 0 || workspaceId.length > 128) {
        return { ok: false, message: `${wLabel}.workspaceId must be a bounded non-empty string` };
      }
      const root = rawWs['root'];
      if (typeof root !== 'string' || !root.startsWith('/')) {
        return { ok: false, message: `${wLabel}.root must be an absolute path string` };
      }
      let artifactLocation: string | undefined;
      if (rawWs['artifactLocation'] !== undefined) {
        const rawLocation = rawWs['artifactLocation'];
        if (typeof rawLocation !== 'string' || !rawLocation.startsWith('/')) {
          return { ok: false, message: `${wLabel}.artifactLocation must be an absolute path string` };
        }
        artifactLocation = rawLocation;
      }
      if (seenWorkspaces.has(workspaceId)) {
        return { ok: false, message: `${label}.workspaces contains a duplicate workspaceId: ${workspaceId}` };
      }
      seenWorkspaces.add(workspaceId);
      parsed.push({ workspaceId, root, ...(artifactLocation !== undefined ? { artifactLocation } : {}) });
    }
    workspaces = parsed;
  }
  let gitPath: string | undefined;
  if (raw['gitPath'] !== undefined) {
    const rawGit = raw['gitPath'];
    if (typeof rawGit !== 'string' || !rawGit.startsWith('/')) {
      return { ok: false, message: `${label}.gitPath must be an absolute path string` };
    }
    gitPath = rawGit;
  }
  let gitHome: string | undefined;
  if (raw['gitHome'] !== undefined) {
    const rawHome = raw['gitHome'];
    if (typeof rawHome !== 'string' || !rawHome.startsWith('/')) {
      return { ok: false, message: `${label}.gitHome must be an absolute path string` };
    }
    gitHome = rawHome;
  }
  let gitTmpdir: string | undefined;
  if (raw['gitTmpdir'] !== undefined) {
    const rawTmp = raw['gitTmpdir'];
    if (typeof rawTmp !== 'string' || !rawTmp.startsWith('/')) {
      return { ok: false, message: `${label}.gitTmpdir must be an absolute path string` };
    }
    gitTmpdir = rawTmp;
  }
  return { ok: true, surface: { surfaceId, locator, serviceUid, forbiddenRoots, configurationIdentity, configurationVersion, limitProfile, ...(workspaces !== undefined ? { workspaces } : {}), ...(gitPath !== undefined ? { gitPath } : {}), ...(gitHome !== undefined ? { gitHome } : {}), ...(gitTmpdir !== undefined ? { gitTmpdir } : {}) } };
}

/**
 * Bounded startup-config read (F1 correction). The read itself never
 * allocates more than MAX_STARTUP_CONFIG_BYTES + 1 bytes and rejects when
 * more than the ceiling is present — bounded even if the file grows after
 * the initial fstat. The descriptor is closed on every path.
 */
function readBoundedStartupConfig(configPath: string): { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly message: string } {
  let fd: number | undefined;
  try {
    fd = openSync(configPath, 'r');
    const stat = fstatSync(fd);
    if (stat.size > MAX_STARTUP_CONFIG_BYTES) {
      return { ok: false, message: `startup configuration exceeds the byte ceiling (${MAX_STARTUP_CONFIG_BYTES} bytes)` };
    }
    const buffer = Buffer.allocUnsafe(MAX_STARTUP_CONFIG_BYTES + 1);
    let total = 0;
    while (total <= MAX_STARTUP_CONFIG_BYTES) {
      const n = readSync(fd, buffer, total, MAX_STARTUP_CONFIG_BYTES + 1 - total, total);
      if (n <= 0) break;
      total += n;
    }
    if (total > MAX_STARTUP_CONFIG_BYTES) {
      return { ok: false, message: `startup configuration exceeds the byte ceiling (${MAX_STARTUP_CONFIG_BYTES} bytes)` };
    }
    return { ok: true, bytes: buffer.subarray(0, total) };
  } catch (err) {
    return { ok: false, message: `startup configuration could not be read: ${(err as NodeJS.ErrnoException).code ?? 'unknown error'}` };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Best-effort close; the read result stands.
      }
    }
  }
}

/** Load and validate the operator startup configuration (closed fields; deterministic). */
export function loadRuntimeConfig(configPath: string): ConfigLoadResult {
  let bytes: Uint8Array;
  try {
    const read = readBoundedStartupConfig(configPath);
    if (!read.ok) return { ok: false, message: read.message };
    bytes = read.bytes;
  } catch (err) {
    return { ok: false, message: `startup configuration could not be read: ${(err as NodeJS.ErrnoException).code ?? 'unknown error'}` };
  }
  let document: unknown;
  try {
    // F2 correction: the accepted repository raw-JSON intake scans the full
    // document (duplicate-member rejection at every nesting level, strict
    // UTF-8, nesting/resource bounds) before the single model construction;
    // the resulting model is the ONE representation flowing into structural
    // validation below — ordinary JSON.parse is never applied separately.
    document = parseRawJson(bytes, MAX_STARTUP_CONFIG_BYTES).model;
  } catch (err) {
    if (err instanceof RawJsonError) {
      switch (err.category) {
        case 'DUPLICATE-MEMBER':
          return { ok: false, message: 'startup configuration contains duplicate object keys' };
        case 'RESOURCE-LIMIT':
          return { ok: false, message: `startup configuration exceeds the byte ceiling (${MAX_STARTUP_CONFIG_BYTES} bytes)` };
        case 'INVALID-UNICODE':
          return { ok: false, message: 'startup configuration is not valid UTF-8' };
        default:
          return { ok: false, message: 'startup configuration is not valid JSON' };
      }
    }
    return { ok: false, message: 'startup configuration is not valid JSON' };
  }
  if (!isRecord(document)) return { ok: false, message: 'startup configuration must be a JSON object' };
  const keys = Object.keys(document);
  for (const key of keys) {
    if (key !== 'surfaces') return { ok: false, message: `startup configuration has an unknown field: ${key}` };
  }
  const rawSurfaces = document['surfaces'];
  if (rawSurfaces === undefined) return { ok: false, message: 'startup configuration is missing the surfaces field' };
  if (!Array.isArray(rawSurfaces)) return { ok: false, message: 'surfaces must be an array' };
  const surfaces: SurfaceConfig[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawSurfaces.length; i++) {
    const validated = validateSurface(rawSurfaces[i], i);
    if (!validated.ok) return { ok: false, message: validated.message };
    if (seen.has(validated.surface.surfaceId)) {
      return { ok: false, message: `surfaceId is registered more than once: ${validated.surface.surfaceId}` };
    }
    seen.add(validated.surface.surfaceId);
    surfaces.push(validated.surface);
  }
  return { ok: true, config: { surfaces } };
}
