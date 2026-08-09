# ADR-037 — pi-guard Trusted Projection Interface Authorization (WP-5B)

**Status:** Accepted. This ADR records the separate explicit human
authorization required by ADR-026 (and WP-0) before a pi-guard-side
authority-projection input interface may be introduced. It authorizes the
interface contract and its intended compatible implementation lane; it does
not implement the interface, does not modify the pi-guard repository, and
does not begin WP-5B implementation.

**Authority chain:** ADR-002 (trust and approval boundary), ADR-020
(pi-adapter boundary and no authority), ADR-023 (sequencing: WP-5B after
WP-6/WP-12), ADR-024 (trusted configuration ownership), ADR-025 (capability
vocabulary), ADR-026 (pi-guard compatibility lane and authority-projection
boundary), ADR-027 (enforcement evidence semantics),
`pi-guard-compatibility-and-authority-projection.md` Parts B–E,
`post-wp5a-roadmap.md` (WP-5B row).

## 1. Decision

Authorize a **minimal process-local trusted projection interface** in
pi-guard, consisting conceptually of exactly three operations:

- `applyTrustedProjection(projection)` — apply one trusted enforcement
  projection atomically with verification;
- `inspectActiveProjection()` — observe the active projection state for
  WP-5B evidence;
- `restoreTrustedProjection()` — verified restoration to the pre-activation
  tool state.

The trusted projection object contains **exactly four fields**:

1. `projectionVersion` — the interface contract version (currently `1`);
   unsupported versions fail closed;
2. `projectionIdentity` — the canonical projection identity (F-R4
   definition; replay/conflict binding);
3. `allowedToolNames` — the exact case-sensitive allowed tool-name set;
   **no explicit denied-tool list is required** — absence from
   `allowedToolNames` denies the tool (unknown-denied and extra-tool rules
   are enforced by absence);
4. `inventoryFingerprint` — the canonical observed effective-surface
   fingerprint (name + source entries) bound at activation; mismatch fails
   closed.

No other fields are authorized in the projection object (no ceilings,
policy, grant, plan identities, lifecycle records, per-tool sources,
extension lists, or denied-tool lists; derived/evidence fields remain
WP-5B-owned outputs, not projection inputs).

## 2. Authority ownership (unchanged)

- WP-4/WP-6/WP-12/WP-5B determine and validate effective authority; WP-5B
  constructs the exact effective tool projection from the validated
  authority intersection, the trusted extension set, the observed tool
  surface, and the compatibility result.
- pi-guard validates the projection's structural form and enforces it
  mechanically. pi-guard does NOT evaluate lifecycle state, authority
  intersections, ceilings, grants, approvals, capabilities, or execution
  decisions; it receives only derived enforcement data, never Gateway
  lifecycle records.

## 3. Contract constraints (pinned)

- **Process-local delivery only:** the interface is reachable only through
  the extension factory's returned trusted API object, captured by the
  environment-gated Gateway host harness (same in-process pattern as the
  WP-5A `PGW_PI_PACKAGE_PATH` local-lane harness).
- **No prompt/tool/command/project-file/environment-string authority
  channel:** the projection is never obtainable through model-controlled or
  user-controlled operands; `/guard` cannot enter or exit the projected
  state.
- **No persistence:** projection state is in-memory and session-local; a
  session start resets it (existing pi-guard session behavior).
- **One active trusted projection per session.**
- **Exact inventory-fingerprint check before activation** (drift fails
  closed at activation).
- **Identical projection replay may be idempotent** (same
  `projectionIdentity`, same fingerprint, same session); **conflicting
  replay fails closed** (F-R3 idempotent-replay factors preserved).
- **No partial activation:** on any failure the prior tool state is
  restored with verification.
- **Verified restoration on activation/restoration failure** (existing
  `restoreAndVerify` semantics; `[PSG_PROFILE_APPLY_FAILED]` fallback
  preserved).
- **Restart requires a fresh WP-5B decision and projection** (stale
  activation evidence is retrospective only).
- **OFF/INSPECT/EDIT/WRITE semantics remain unchanged** and remain
  user-facing manual modes.
- **PROJECTED is trusted-API-only:** user mode transitions while PROJECTED
  fail closed (a user cannot silently drop trusted enforcement); `/guard
  status` observability remains.
- **pi-guard receives only derived enforcement data, never Gateway
  lifecycle records.**

## 4. Authorization vs implementation

This ADR removes the architectural/human-authorization blocker recorded in
ADR-026. It does **not** claim the interface exists:

- The currently verified lane remains exactly **pi-guard v0.1.1** (no
  evidence change; unverified versions still fail closed).
- The intended compatible implementation lane is **pi-guard v0.1.2** — the
  next release version in the pi-guard project's own version sequence
  (v0.1.0 → v0.1.1 → v0.1.2, Git-source distribution; this is a project
  release-version statement, not a SemVer minor-version increment).
- WP-5B implementation must still wait until the authorized interface has
  actually been implemented in pi-guard v0.1.2 and that lane has been
  separately verified against the updated compatibility predicate (Part B),
  recorded as a reviewed compatibility record.
- pi-guard source changes remain outside this repository and require their
  own reviewed implementation against this contract.

## 5. Consequences

- ADR-026's eligibility condition ("the pi-guard projection interface
  exists or is explicitly authorized") is now satisfiable via the
  explicit-authorization branch; the remaining WP-5B gates are the v0.1.2
  implementation and lane verification.
- The four-field projection schema and the apply/inspect/restore behavior
  are normative in
  `pi-guard-compatibility-and-authority-projection.md` Parts B/D (updated
  with this ADR).
- No change to ADR-027 (evidence semantics), ADR-023 (sequencing), or the
  WP-5B owned contracts; WP-5B's design is unchanged except for consuming
  the authorized interface as its delivery vehicle.
