/**
 * Trusted host-lane operand (WP-6 Phase-1 correction F-7).
 *
 * The supported WP-6 lane (F-EL3) is represented by one exact, accepted lane
 * identifier that MUST be supplied as an explicit trusted compatibility
 * operand to trusted production validation. The I/O-free core never
 * ambiently probes the host (no `process`, environment, path, or runtime
 * global reads); only the accepted lane value can produce a validated
 * configuration, and the accepted lane participates in configuration
 * identity and correlation.
 *
 * The accepted lane corresponds to: Linux; x86_64; POSIX-style filesystem
 * semantics; UTF-8 locale; Node.js 22.x. Windows, macOS, case-insensitive
 * filesystems, network filesystems, and non-POSIX path semantics are
 * unverified and unsupported; unverified host lanes fail compatibility
 * eligibility unless separately reviewed.
 */
export const TRUSTED_HOST_LANE = 'linux-x86_64-posix-utf8-node22';

/** Exact accepted-lane predicate. Unknown lanes fail closed. */
export function isSupportedHostLane(value: string): boolean {
  return value === TRUSTED_HOST_LANE;
}
