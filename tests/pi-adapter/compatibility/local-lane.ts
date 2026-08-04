/**
 * LOCAL-LANE helper (F8): the machine-specific default Pi package path used by
 * this development environment. The general harness contract treats
 * `PGW_PI_PACKAGE_PATH` (or an explicit path) as the authoritative input; this
 * local default exists only so the local compatibility suite can exercise the
 * real Pi 0.83.0 installation without requiring an environment variable.
 * Production adapter behavior never depends on this path.
 */
import { inspectLocalPiPackage } from '../../../src/adapters/pi/index.js';
import type { PiPackageInspection } from '../../../src/adapters/pi/index.js';

export const LOCAL_LANE_PI_PACKAGE_PATH =
  '/home/chef/.local/share/pi-node/node-v22.23.2-linux-x64/lib/node_modules/@earendil-works/pi-coding-agent';

/** Inspect the locally installed Pi package (explicit local-lane path). */
export function inspectLocalLanePi(): Promise<PiPackageInspection> {
  return inspectLocalPiPackage(LOCAL_LANE_PI_PACKAGE_PATH);
}
