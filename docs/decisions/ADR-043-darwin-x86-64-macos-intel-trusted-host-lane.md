# ADR-043 — darwin-x86_64 (macOS Intel) Trusted Host Lane

**Status:** Accepted (PS-6I implementation gate; decision human-approved
before implementation).
**Applies to:** the trusted host-lane operand, the closed accepted-lane
set, and the macOS Intel evidence lane (pi-shuttle Lane C).
**Related:** ADR-042 (darwin-arm64 trusted host lane and APFS
compatibility), ADR-016 addendum (lane-specific identity oracles),
`src/trusted/host-lane.ts`.

## Context

ADR-042 closed the accepted host-lane set to exactly two members:
`linux-x86_64-posix-utf8-node22` and `darwin-arm64-posix-utf8-node22`,
and explicitly left macOS Intel (`darwin-x86_64-*`) unsupported — the
pi-shuttle Lane C was a compatibility/refusal-honesty lane only. The
PS-6I human authorization promotes macOS Intel / darwin x64 to a
supported pi-shuttle platform, with a physical Intel Mac
(MacBookPro13,3, macOS 12.7.6) as the immediate validation target. This
ADR is the reviewed protocol change that makes the third lane a
first-class accepted lane; it does not alter any existing lane identity,
semantics, or store.

## Decision

1. **The closed accepted host-lane set is exactly three lanes:**
   `linux-x86_64-posix-utf8-node22` (Linux x86_64),
   `darwin-arm64-posix-utf8-node22` (macOS arm64 / Apple Silicon,
   ADR-042), and `darwin-x86_64-posix-utf8-node22` (macOS Intel /
   x86_64). The predicate is set membership; every other string — any
   `macos-*` spelling, Windows lanes, non-POSIX semantics,
   unknown/future strings — fails closed (validator TCF-028,
   containment TCP-011, CLI exit 2).
2. **The `node22` suffix remains a frozen opaque protocol label.**
   It denotes the Node 22.x generation, never an exact Node runtime
   equality requirement (PS-6R policy: Node >= 22.19.0 accepted).
3. **The new lane inherits the existing POSIX/UTF-8 protocol semantics
   byte-for-byte.** No Intel-specific Git semantics, filesystem
   semantics, or identity formula are introduced. APFS object identity
   (dev + ino) is architecture-independent; ADR-042 decisions 3–12
   (case-insensitive default APFS support, no path normalization,
   canonical-spelling identity, fixed lowercase layout, dev/inode-backed
   namespace identity, lane-bound configuration identity, cross-lane
   replay fail-closed, probe evidence, JCS byte semantics) apply to the
   Intel lane unchanged.
4. **No existing lane is renamed or modified.** `TRUSTED_HOST_LANE` and
   `DARWIN_ARM64_HOST_LANE` constants, their identities, and their store
   semantics are byte-unchanged. No store migration exists or is added:
   the new lane receives its own configuration identity naturally, and
   existing stores remain lane-bound to the lane that created them.
5. **Cross-lane replay fails closed, including between the two darwin
   lanes.** A store created under `darwin-arm64-...` cannot be replayed
   under `darwin-x86_64-...` and vice versa (FOREIGN aggregate →
   `ERR-STO-INTEGRITY`), with no repair, migration, or rewrite. The two
   darwin lanes produce distinct identity vectors for identical inputs
   (tested).
6. **Identity consequences are lane-additive.** Configuration identity
   already binds `hostLane`; the POUV2 static-identity oracles are
   lane-keyed (`staticIdentityByLane`, ADR-016 addendum). The nine
   oracle fixtures gain the Intel-lane entry
   (`oracle.intelConfigurationIdentity` + the third map key), derived by
   the same committed JCS/domain-prefix method as the darwin entries.
   Every existing Linux and darwin-arm64 fixture/oracle digest is
   byte-preserved.
7. **The darwin-arm64 native-arm64 Node requirement is unchanged.**
   ADR-042/PS-6R policy: on the darwin-arm64 lane the actual Node
   executable must be arm64 (Rosetta/x64 fails closed). The darwin-Intel
   lane requires no such probe: x64 is the lane's native architecture,
   and the running interpreter is the runtime Node.
8. **The CLI boundary derives the lane once** from
   `process.platform`/`process.arch` via the shared pure mapping
   (`trustedHostLaneForPlatformArch`) and fails closed (exit 2) on
   unsupported hosts before any validation; the supported-host message
   now lists all three lanes.

## Consequences

- The validator accepts exactly three lane operands and retains the
  actual validated lane in the configuration; identity digests differ
  across all three lanes for otherwise identical inputs (tested).
- Containment evaluation accepts all three accepted lanes under the same
  contract; decision identities remain lane-bound.
- POUV2 conformance: all three lanes pass the authoritative corpus
  648/648 with lane-keyed identity oracles; no expected-failure
  allowance is introduced.
- pi-shuttle: the manifest `supportedLanes` claim gains the Intel lane;
  install/project add/doctor/start/platform reporting accept native
  darwin x64. The darwin-arm64 native-arm64 rule is untouched.
- Lane C (pi-shuttle CI) is transformed from refusal-honesty evidence to
  first-class Intel real-stack evidence on the `macos-15-intel` runner;
  Lane A (Linux) and Lane B (Apple Silicon) are unchanged.
- Physical evidence point: macOS 12.7.6 on MacBookPro13,3 (Intel Core
  i7-6700HQ, Node v22.23.1 x64, Git 2.37.1, Pi 0.84.1 candidate with a
  required pi-guard compatibility probe PASS) — recorded as a validated
  evidence point, not a universal minimum macOS version.

## Alternatives considered

- **Keep macOS Intel unsupported (Lane C refusal-only)** — rejected by
  the PS-6I human authorization: the platform is promoted to supported
  with physical + CI evidence.
- **A separate Intel-specific identity formula or lane vocabulary** —
  rejected: identity/authority semantics are architecture-independent;
  only the accepted lane set changes.
- **Rosetta/emulation on arm64 hardware for Intel evidence** — rejected:
  the supported lane is native darwin x64 on Intel hardware; emulated
  runs are not lane evidence.
