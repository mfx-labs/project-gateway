# ADR-042 — darwin-arm64 Trusted Host Lane and APFS Compatibility

**Status:** Accepted (PS-6 implementation gate; decisions previously
human-approved in the pi-shuttle product contract and platform-support
contract).
**Applies to:** the trusted host-lane operand, the closed accepted-lane
set, and the macOS arm64 evidence lane.
**Related:** ADR-028 (bootstrap locator), ADR-036 (compatibility probe),
ADR-041 (operator bootstrap command), WP-6 Phase 1 (F-7 host-lane
operand), `src/trusted/host-lane.ts`, `src/storage/probe/probe.ts`, and
the pi-shuttle platform-support contract §1/§3 (PS-6).

## Context

The trusted host lane was a single accepted value,
`linux-x86_64-posix-utf8-node22` (WP-6 correction F-7). First-class
macOS arm64 product support (pi-shuttle PS-6) requires a second accepted
lane, `darwin-arm64-posix-utf8-node22`, selected at the operator CLI
boundary and threaded as the trusted validation operand. Default macOS
APFS is case-insensitive (case-preserving); the previous lane wording
treated all macOS and all case-insensitive filesystems as unverified and
unsupported, which would contradict the approved product decision that
default APFS is a supported v0.1.0 filesystem.

## Decision

1. **The closed accepted host-lane set is exactly two lanes:**
   `linux-x86_64-posix-utf8-node22` (Linux x86_64) and
   `darwin-arm64-posix-utf8-node22` (macOS arm64 / Apple Silicon).
   The predicate is set membership; every other string — macOS Intel
   (`darwin-x86_64-*`), any `macos-*` spelling, Windows lanes,
   non-POSIX semantics, unknown/future strings — fails closed
   (validator TCF-028, containment TCP-011, CLI exit 2).
2. **macOS Intel remains unsupported.** `darwin-arm64-*` is the only
   darwin lane; `darwin-x86_64-*` is rejected and is never a support
   claim (pi-shuttle Lane C is compatibility evidence only).
3. **Default case-insensitive APFS is supported.** No case-sensitive
   APFS volume is required. Rationale: the store layout is entirely
   fixed lowercase ASCII (`store-v1`, `config-v1`, `metadata`, `tmp`,
   `records`, `audit`, `locks`, `index`, `quarantine`); store
   identifiers are lowercase hex; and project identity derives from the
   filesystem-canonical spelling (see 4–5), so case-insensitive lookup
   cannot create duplicate authority.
4. **No lowercase/case-fold path normalization is introduced.** pi-shuttle
   and the Gateway never lowercase or Unicode-normalize operator paths.
5. **Filesystem project identity continues to derive from the canonical
   filesystem spelling.** Identity inputs are the canonical
   (symlink-resolved) roots produced by `realpath`-style resolution; on
   default APFS, two case variants (and NFC/NFD spelling variants) of the
   same object resolve to the same on-disk spelling and therefore to one
   identity. Case variants of distinct objects (possible only on
   case-sensitive volumes) remain distinct identities.
6. **The fixed lowercase store layout avoids internal case collisions.**
   Every layout/entry name is fixed lowercase ASCII; the store id is
   lowercase hex; mixed-case input never reaches store-name derivation.
7. **Store namespace identity remains dev/inode-backed.**
   `namespaceIdentity`/`parentIdentity` metadata (dev + ino) is
   case-independent and unchanged.
8. **The host lane remains identity-bound.** `hostLane` stays a first-class
   member of the canonical configuration projection; the validated
   configuration carries the actual validated lane operand (never a
   hardcoded value). The trusted core remains ambient-probe-free: the
   lane is derived once at the operator CLI boundary by the pure
   platform/arch mapping and is never an operator-config-controlled
   field.
9. **Cross-lane replay fails closed.** Store metadata binds the
   lane-derived `configurationIdentity`; re-verifying a store created
   under one accepted lane with the other lane fails closed with the
   existing storage classification (FOREIGN aggregate → fail-closed
   `ERR-STO-INTEGRITY`), with no repair, migration, or rewrite. Stores
   remain lane/machine-bound; no cross-machine portability is added.
10. **The compatibility probe may record `caseSensitive: false` without
    that alone being a failure.** The probe records the observed profile
    (exclusive creation, hard-link, no-follow, directory/file fsync,
    case sensitivity) into the store metadata as evidence; a
    case-insensitive profile is not treated as a failed probe under the
    darwin-arm64 lane (fixed-lowercase layout, decisions 3–6).
11. **fsync / no-follow / exclusive-create evidence is runtime/probe
    evidence, not assumed.** The probe runs at every store bootstrap on
    the actual volume; the storage crash suite on the darwin lane is
    release evidence (pi-shuttle platform-support contract §3.6). Any
    divergence is recorded, not assumed.
12. **Artifact Unicode/JCS normalization semantics are unchanged.**
    Canonical artifact bytes remain byte-exact UTF-8, RFC 8785 JCS; no
    normalization is introduced at any layer.

## Consequences

- The validator accepts exactly two lane operands and retains the actual
  validated lane in the configuration; identity digests differ across
  lanes for otherwise identical inputs (tested).
- Containment evaluation accepts both accepted lanes under the same
  contract; decision identities remain lane-bound.
- The CLI (bootstrap and runtime paths) derives the lane once from
  `process.platform`/`process.arch` via the shared pure mapping and fails
  closed (exit 2) on unsupported hosts before any validation.
- POUV2 conformance fixture oracles embed linux-lane identity digests;
  under the darwin lane exactly those lane-bound identity vectors differ
  by design (all other fixtures behave identically).
- No change to the pi-shuttle product identity formula, authority
  semantics, storage architecture, lock architecture, or Pi policy.

## Alternatives considered

- **Case-sensitive APFS requirement** — rejected (human-approved product
  decision: default APFS is supported; the fixed-lowercase layout +
  canonical-spelling identity maintain the invariants).
- **String case-folding in identity derivation** — rejected (would
  introduce a new normalization semantic; filesystem canonicalization
  already closes the collision space).
- **Broad platform enum / future-lane guessing** — rejected (closed
  two-member set only; unknown lanes fail closed).

## Addendum — lane-specific POUV2 identity oracles (PS-6 focused correction gate)

The Consequences paragraph above records the implementation-gate state,
in which the nine POUV2 static-identity oracle fixtures were
linux-lane-bound and the darwin run diverged on exactly those nine
vectors. That state was corrected under the HUMAN-approved POUV2
lane-specific oracle decision (SIR-PS6-001): the nine fixtures now carry
lane-keyed expected static identities (`expect.staticIdentityByLane`,
keyed only by the validated `TrustedHostLane`, both accepted lanes
mandatory) plus the darwin configuration-identity literal
(`oracle.darwinConfigurationIdentity`). Every existing Linux
fixture/oracle digest is byte-preserved; the identity algorithm, the
configurationIdentity projection, fixture inputs, eligibility, findings,
rules, and artifact canonicalization are unchanged. This protocol
evolution is recorded in the ADR-016 addendum
(`ADR-016-addendum-lane-specific-identity-oracles.md`). Both accepted
lanes pass the authoritative corpus 648/648 with no expected-failure
allowance.
