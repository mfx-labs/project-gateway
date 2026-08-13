/**
 * Trusted host-lane operand (WP-6 Phase-1 correction F-7; PS-6 closed
 * accepted-lane set, ADR-042; PS-6I darwin Intel lane, ADR-043).
 *
 * The supported WP-6 lane is represented by one exact, accepted lane
 * identifier that MUST be supplied as an explicit trusted compatibility
 * operand to trusted production validation. The I/O-free core never
 * ambiently probes the host (no `process`, environment, path, or runtime
 * global reads); only an accepted lane value can produce a validated
 * configuration, and the accepted lane participates in configuration
 * identity and correlation.
 *
 * The closed accepted-lane set is exactly:
 *   - `linux-x86_64-posix-utf8-node22` — Linux; x86_64; POSIX filesystem
 *     semantics; UTF-8 locale; Node.js 22.x (first-class, validated);
 *   - `darwin-arm64-posix-utf8-node22` — macOS; arm64 (Apple Silicon);
 *     POSIX filesystem semantics; UTF-8 locale; Node.js 22.x (PS-6
 *     darwin arm64 lane, ADR-042);
 *   - `darwin-x86_64-posix-utf8-node22` — macOS; Intel/x86_64; POSIX
 *     filesystem semantics; UTF-8 locale; Node.js 22.x (PS-6I darwin
 *     Intel lane, ADR-043).
 *
 * Everything else — any `macos-*` spelling, Windows lanes, non-POSIX
 * semantics, unknown/future strings — remains unverified and
 * unsupported: the predicate fails closed, so an unsupported host lane
 * can never produce a validated configuration. The `node22` suffix is a
 * frozen opaque protocol label (the Node 22.x generation), never an
 * exact Node runtime equality requirement (PS-6R).
 */
export const TRUSTED_HOST_LANE = 'linux-x86_64-posix-utf8-node22';
export const DARWIN_ARM64_HOST_LANE = 'darwin-arm64-posix-utf8-node22';
export const DARWIN_X86_64_HOST_LANE = 'darwin-x86_64-posix-utf8-node22';

/** Exact trusted host-lane type: the closed three-member accepted set. */
export type TrustedHostLane = typeof TRUSTED_HOST_LANE | typeof DARWIN_ARM64_HOST_LANE | typeof DARWIN_X86_64_HOST_LANE;

/** The closed accepted-lane set (exactly three members; frozen). */
export const ACCEPTED_HOST_LANES: readonly TrustedHostLane[] = Object.freeze([TRUSTED_HOST_LANE, DARWIN_ARM64_HOST_LANE, DARWIN_X86_64_HOST_LANE]);

/** Exact accepted-lane predicate. Unknown lanes fail closed. */
export function isSupportedHostLane(value: string): value is TrustedHostLane {
  return value === TRUSTED_HOST_LANE || value === DARWIN_ARM64_HOST_LANE || value === DARWIN_X86_64_HOST_LANE;
}

/**
 * Pure platform/architecture → trusted host lane mapping (PS-6, PS-6I).
 *
 * This is the ONE shared mapping used at the operator/runtime CLI boundary
 * (bootstrap and start paths alike). It is pure: it never probes the host
 * itself — the caller supplies the observed `platform`/`arch` — so the
 * trusted core stays ambient-probe-free. Supported mappings only:
 *   linux + x64    → linux-x86_64-posix-utf8-node22
 *   darwin + arm64 → darwin-arm64-posix-utf8-node22
 *   darwin + x64   → darwin-x86_64-posix-utf8-node22
 * Everything else (Windows, unknown platforms/arches) returns null: the
 * CLI boundary fails closed with exit 2.
 */
export function trustedHostLaneForPlatformArch(platform: string, arch: string): TrustedHostLane | null {
  if (platform === 'linux' && arch === 'x64') return TRUSTED_HOST_LANE;
  if (platform === 'darwin' && arch === 'arm64') return DARWIN_ARM64_HOST_LANE;
  if (platform === 'darwin' && arch === 'x64') return DARWIN_X86_64_HOST_LANE;
  return null;
}
