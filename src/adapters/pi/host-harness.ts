/**
 * Environment-gated local Pi compatibility harness (WP-5A).
 *
 * The harness inspects the locally installed Pi package (package identity,
 * version, and required runtime export surface) WITHOUT starting Pi, sending a
 * model request, executing tools, or modifying user configuration. It is
 * gated by the `PGW_PI_PACKAGE_PATH` environment variable; when unset, the
 * harness reports `inspected: false` and the adapter does not import Pi.
 *
 * The adapter itself never imports Pi statically; the harness is the only
 * environment-gated Pi import boundary.
 */
import { piFinding, sortFindings } from './findings.js';
import { SUPPORTED_PI_PACKAGE_ID, SUPPORTED_PI_VERSION } from './compatibility.js';
import type { PiFinding } from './types.js';

/** Required runtime exports of the Pi package used for surface verification. */
const REQUIRED_RUNTIME_EXPORTS = ['VERSION', 'isToolCallEventType', 'createExtensionRuntime', 'discoverAndLoadExtensions'] as const;

export interface PiPackageInspection {
  readonly inspected: boolean;
  readonly packagePath?: string;
  readonly packageId?: string;
  readonly version?: string;
  readonly runtimeExports: Readonly<Record<string, boolean>>;
  readonly compatible: boolean;
  readonly findings: readonly PiFinding[];
}

/** Resolve the Pi package path: explicit parameter, env var, or discovered global install. */
export function resolvePiPackagePath(explicit?: string): string | undefined {
  if (explicit !== undefined && explicit !== '') return explicit;
  const env = process.env['PGW_PI_PACKAGE_PATH'];
  if (env !== undefined && env !== '') return env;
  return undefined;
}

/**
 * Inspect the locally installed Pi package (environment-gated). Never starts
 * Pi, never sends a model request, never modifies configuration.
 */
export async function inspectLocalPiPackage(packagePath?: string): Promise<PiPackageInspection> {
  const path = resolvePiPackagePath(packagePath);
  if (path === undefined) {
    return {
      inspected: false,
      runtimeExports: Object.freeze({}),
      compatible: false,
      findings: Object.freeze([piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'harness.not-gated', 'local Pi inspection requires PGW_PI_PACKAGE_PATH; harness is environment-gated')]),
    };
  }
  const findings: PiFinding[] = [];
  const runtimeExports: Record<string, boolean> = {};
  let packageId: string | undefined;
  let version: string | undefined;
  try {
    // read the package manifest at the gated path (inspection only)
    const fs = await import('node:fs/promises');
    const pathModule = await import('node:path');
    const manifestPath = pathModule.join(path, 'package.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { name?: string; version?: string };
    packageId = manifest.name;
    version = manifest.version;
    if (packageId !== SUPPORTED_PI_PACKAGE_ID) {
      findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'harness.package-identity', `local Pi package identity is ${packageId ?? 'unknown'}, expected ${SUPPORTED_PI_PACKAGE_ID}`));
    }
    if (version !== SUPPORTED_PI_VERSION) {
      findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'harness.version-drift', `local Pi version is ${version ?? 'unknown'}, expected ${SUPPORTED_PI_VERSION}`));
    }
    // dynamic import of the actual package (never a model request)
    const mod = (await import(pathModule.join(path, 'dist', 'index.js'))) as Record<string, unknown>;
    for (const name of REQUIRED_RUNTIME_EXPORTS) {
      runtimeExports[name] = typeof mod[name] !== 'undefined';
      if (typeof mod[name] === 'undefined') {
        findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'harness.export-missing', `Pi package is missing required runtime export ${name}`));
      }
    }
    const versionExport = mod['VERSION'];
    if (typeof versionExport === 'string' && versionExport !== SUPPORTED_PI_VERSION) {
      findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'harness.version-export-drift', `Pi VERSION export is ${versionExport}, expected ${SUPPORTED_PI_VERSION}`));
    }
  } catch (e) {
    // raw host exception text is never part of the protocol error contract
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'harness.inspection-failed', `local Pi package inspection failed at the gated path ${path}`));
  }
  const sorted = sortFindings(findings);
  return Object.freeze({
    inspected: true,
    ...(path !== undefined ? { packagePath: path } : {}),
    ...(packageId !== undefined ? { packageId } : {}),
    ...(version !== undefined ? { version } : {}),
    runtimeExports: Object.freeze(runtimeExports),
    compatible: sorted.length === 0,
    findings: Object.freeze(sorted),
  });
}
