/**
 * WP-5B — environment-gated pi-guard package harness (discovery only).
 *
 * This is the WP-5B analog of the WP-5A `host-harness.ts`: the ONLY module
 * under the enforcement surface that performs filesystem / environment I/O,
 * gated by `PGW_PI_GUARD_PACKAGE_PATH`. It reads the pi-guard package manifest
 * and verifies the extension entry path exists at the gated path. It never
 * imports pi-guard internals and never invokes the extension factory; the
 * captured trusted API is supplied by the Gateway host harness.
 */
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GUARD_EXTENSION_ENTRY,
} from './compatibility.js';
import { PI_GUARD_PACKAGE_ID, PI_GUARD_VERSION } from './types.js';
import { piGuardFinding as finding, sortGuardFindings as sortFindings } from './findings.js';
import type { GuardFinding, GuardPackageInspection } from './types.js';

/** Resolve the pi-guard package path: explicit parameter, env var, or none. */
export function resolveGuardPackagePath(explicit?: string): string | undefined {
  if (explicit !== undefined && explicit !== '') return explicit;
  const env = process.env['PGW_PI_GUARD_PACKAGE_PATH'];
  if (env !== undefined && env !== '') return env;
  return undefined;
}

/** Environment-gated pi-guard package inspection (discovery only). */
export async function inspectGuardPackage(packagePath?: string): Promise<GuardPackageInspection> {
  const path = resolveGuardPackagePath(packagePath);
  if (path === undefined) {
    return Object.freeze({
      inspected: false,
      trustedApiCaptured: false,
      compatible: false,
      findings: Object.freeze([finding('GUARD-LANE-INCOMPATIBLE', 'guard.harness-not-gated', 'pi-guard inspection requires PGW_PI_GUARD_PACKAGE_PATH; harness is environment-gated')]),
    });
  }
  const findings: GuardFinding[] = [];
  let packageId: string | undefined;
  let version: string | undefined;
  try {
    const manifest = JSON.parse(readFileSync(resolve(path, 'package.json'), 'utf8')) as { name?: string; version?: string };
    packageId = manifest.name;
    version = manifest.version;
    if (packageId !== PI_GUARD_PACKAGE_ID) {
      findings.push(finding('GUARD-LANE-INCOMPATIBLE', 'guard.package-identity', `local pi-guard package identity is ${packageId ?? 'unknown'}, expected ${PI_GUARD_PACKAGE_ID}`));
    }
    if (version !== PI_GUARD_VERSION) {
      findings.push(finding('GUARD-LANE-INCOMPATIBLE', 'guard.version-drift', `local pi-guard version is ${version ?? 'unknown'}, expected ${PI_GUARD_VERSION}`));
    }
    const entry = resolve(path, GUARD_EXTENSION_ENTRY);
    let isFile = false;
    try {
      isFile = statSync(entry).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) {
      findings.push(finding('GUARD-LANE-INCOMPATIBLE', 'guard.extension-entry-missing', `pi-guard extension entry ${GUARD_EXTENSION_ENTRY} is missing`));
    }
  } catch {
    findings.push(finding('GUARD-LANE-INCOMPATIBLE', 'guard.inspection-failed', 'pi-guard package inspection failed at the gated path'));
  }
  const sorted = sortFindings(findings);
  return Object.freeze({
    inspected: true,
    ...(path !== undefined ? { packagePath: path } : {}),
    ...(packageId !== undefined ? { packageId } : {}),
    ...(version !== undefined ? { version } : {}),
    extensionEntry: GUARD_EXTENSION_ENTRY,
    trustedApiCaptured: sorted.length === 0,
    compatible: sorted.length === 0,
    findings: Object.freeze(sorted),
  });
}
