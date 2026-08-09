# WP-5B — Pi Enforcement / Activation-Evidence Integration — Implementation Report

**Package:** @project-gateway/artifact-core (WP-5B enforcement integration).
**Baseline:** `8d90104a89bbaca87ad26852f09225c667f403a9` (Gateway main; pi-guard
v0.1.2 lane recorded and verified; release commit `7a7580c`).
**Status:** implementation complete; unstaged/uncommitted for senior review.
No WP-13, no pi-guard modification, no WP-4/6/8/12 semantic change, no
push/tag/release/deploy.

## 1. Changed paths

New module (`src/adapters/pi/enforcement/`):
`types.ts` · `fingerprint.ts` · `surface.ts` · `findings.ts` · `compatibility.ts`
· `guard-host-harness.ts` · `projection.ts` · `evidence.ts` · `run.ts` ·
`index.ts` (barrel).

Modified: `src/adapters/pi/index.ts` (WP-5B surface exports) ·
`package.json` (register `tests/pi-adapter/enforcement/*.test.js` in `test` and
`test:pi-adapter`).

New tests (`tests/pi-adapter/enforcement/`): `fake-guard.ts` (hermetic
v0.1.2 trusted API) · `world.ts` (validated plan + eligibility + activation +
surface fixtures) · `fingerprint.test.ts` · `surface.test.ts` ·
`compatibility.test.ts` · `projection.test.ts` · `evidence.test.ts` ·
`enforcement.test.ts` — **59 focused tests**.

## 2. Reused committed primitives (no second authority evaluator)

- WP-5A `PiInvocationPlan` (`projection-ready`, `piGuardEnforcementPending:
  true`), `SUPPORTED_PI_PACKAGE_ID`/`SUPPORTED_PI_VERSION` (Pi 0.83.0 lane),
  and the environment-gated host-harness pattern.
- WP-6 validated `EligibilityReport` (consumed verbatim; never reinterpreted)
  and `RequestedUse`/consumer declaration types.
- Trusted configuration model `ValidatedExpectedToolSource`
  (`src/trusted/extension-set.js`) for expected tool sources.
- Repository canonical serialization `jcsSerialize` and domain-prefixed SHA-256
  digest convention for all WP-5B identities.
- WP-12 control-plane activation correlation facts (`GuardActivationDecision`)
  consumed as `accepted`/`grantCurrent`/occurrence/attempt correlation; WP-5B
  never reads the underlying lifecycle records.

## 3. Compatibility discovery (predicate 12–17)

`guard-host-harness.ts` is the environment-gated (`PGW_PI_GUARD_PACKAGE_PATH`)
pi-guard package discovery (manifest identity `pi-guard` + version `0.1.2` +
extension entry `extensions/pi-guard/index.ts`), mirroring the WP-5A
`host-harness` pattern and carrying the adapter's only fs/env I/O.
`compatibility.ts` is pure: it verifies the captured `TrustedProjectionApi`
exposes EXACTLY `applyTrustedProjection`/`inspectActiveProjection`/
`restoreTrustedProjection` (predicate 12), records the verified lane identity
(release commit `7a7580c`, annotated tag `v0.1.2`), and computes the
predicate-17 compatibility fingerprint over package identity/version,
extension identity, required exports, mode set incl. PROJECTED, reserved ids,
config contract shape, and projection schema shape. Predicates 13–16 are bound
by the recorded lane verification; the live fingerprint convergence (16) is
re-checked at activation by pi-guard's own `fingerprintMismatch` path.

## 4. Inventory / projection semantics

- `surface.ts` observes the effective surface (F-R1): exact case-sensitive
  `name` + surviving `sourceInfo.source`; fails closed on malformed entries,
  missing/unavailable source, duplicate names, unknown active tools, and
  non-array inputs. Same-name collapse and shadowing limitation remain
  explicit — observation never grants permission.
- `fingerprint.ts` implements the **normative v1** `inventoryFingerprint`
  byte-for-byte (UTF-8-byte name-then-source ordering — U+E000 before U+10000,
  NOT the JS UTF-16 order; exact `{name, source}` key order; compact
  `JSON.stringify`; UTF-8 no BOM; SHA-256 lowercase hex). The committed golden
  vector reproduces exactly (`02c896…7261`), pinned by a byte/digest test and
  a UTF-16-divergence test.
- `projection.ts` maps the evaluated capability (vocabulary v1) to a tool
  profile: research builtins `read/grep/find/ls` + present-trusted optional
  `ffgrep/fffind`; capability additions `git_inspect`/`edit`/`write`;
  `tool-inventory-inspect` → deny-all observation; `shell-execute`, `git-mutate`,
  `file-delete`/`move`, `network-external`, `service-local`, `pi-tool-execute`,
  unknowns → **unsupported → projection fails** (no partial output). Exact
  names, no aliases; required tools absent → fail; required-tool
  source mismatch or unbound security-critical source → fail; extra/unknown
  tools → denied.

## 5. Activation / restoration path

`run.ts` executes the deterministic path: validated projection-ready plan → 2.
plan verification → 3. eligibility correlation (eligible, workspace, exact
bundle-instance correlation) → 4. WP-12 activation correlation (decision
`accepted`, grant current, exact occurrence/attempt, grant identity) → 5.
supported Pi-host lane + pi-guard predicate 12 compatibility → 6. effective
surface + normative fingerprint → 7. capability→tool projection → 8. F-R4
identity ingredients → 9. exact four-field trusted projection → `applyTrustedProjection` →
10. verified PROJECTED inspection (identity + profile set-match) →
`PiEnforcementEvidence`. Every pre-apply failure is `not-attempted` with no
pi-guard state change; apply rejection/drift/conflict/application-failure →
`failed-closed` (restoration truth from pi-guard); failed post-apply
verification triggers a restore and reports truth; identical replay is
idempotent, conflicting re-activation fails closed; `surfaceStable` is the
post-activation drift probe (identity/fingerprint comparison); restart requires
a fresh activation decision and projection — no stored/persisted evidence ever
reactivates enforcement. Only the three trusted-API methods are ever called;
the projection object carries exactly the four fields and **no** Gateway
lifecycle/policy/grant/plan payload.

## 6. Evidence construction (Part E)

`evidence.ts` builds `PiEnforcementEvidence` with the full committed field set
(input plan identity + fingerprint, single canonical F-R4 `projectionIdentity`,
authority-input identities, effective-authority identity, pi-guard identity +
version, Pi identity + version, observed inventory identity, projected
allowed/denied/unsupported, activation/restoration outcomes, compatibility
findings, `timestampSource`, embedded accepted host timestamp `observedAt`,
`evidenceFingerprint`). `projectionIdentity` deterministically binds plan /
authority / effective-authority / compatibility / inventory / enforcement-config /
workspace / vocabulary / evaluator-interface members and EXCLUDES timestamps and
outcomes; `evidenceFingerprint` is SHA-256 over the complete canonical record
INCLUDING timestamps + source id (F-02/F-R2). Evidence is correlation
only — never authority.

## 7. Failure taxonomy (bounded, deterministic)

`GUARD-INPUT-INVALID` · `GUARD-PLAN-UNCORRELATED` ·
`GUARD-ELIGIBILITY-UNCORRELATED` · `GUARD-ACTIVATION-UNCORRELATED` ·
`GUARD-LANE-INCOMPATIBLE` · `GUARD-SURFACE-UNAVAILABLE` ·
`GUARD-INVENTORY-DRIFT` · `GUARD-PROJECTION-FAILURE` ·
`GUARD-ACTIVATION-FAILURE`, each with a stable machine key; raw host exception
text never enters a finding message. Restoration truth is carried by the
`restorationOutcome` evidence field (never a redundant finding category).

## 8. Verification results (actual counts, run once)

| Suite | Result |
|---|---|
| typecheck (`tsc -p tsconfig.json --noEmit` + `tsc -p tsconfig.tests.json --noEmit`) | clean |
| focused WP-5B (`tests/pi-adapter/enforcement/*`) | **67/67** pass (incl. 7 SIR-WP5B-001 adversarial boundary tests + 1 FSIR-WP5B-001 null-shape test) |
| WP-5B/Pi-adapter suite (`npm run test:pi-adapter`, incl. security static guard) | **338/339** pass (1 pre-existing environmental failure) |
| Complete Gateway regression (`npm test`: unit/integration/security/pi-adapter/mcp/runtime/drafting/writing/trusted/pointofuse-v2) | **1871/1872** pass (1 pre-existing environmental failure) |
| WP-7 suffix (`run-wp7-tests.mjs`) | **165/165** pass (reader 62 · git 38 · fff 26 · security 39) |

Pre-existing environmental failure (NOT caused by WP-5B; unchanged test at
`tests/pi-adapter/compatibility/harness.test.ts` F8): "real Pi 0.83.0 path
supplied explicitly is accepted" asserts the machine's env-configured local Pi
lane is exactly 0.83.0; this machine's Pi is **0.84.1**, so the lane check
fails closed by design. `host-harness.ts` and that test are unmodified.

## 9. Contract interpretation (recorded)

- Capability → tool-profile mapping is WP-5B-owned (Part C); it is a fixed
  deterministic table over the v1 vocabulary. Capabilities pi-guard cannot
  enforce under the verified lane (bash always blocked; no
  delete/move/git-mutate/network profile) are `unsupported` and fail projection.
- Expected tool sources: a declared `expectedToolSources` entry must match the
  observed source exactly; undeclared security-relevant required tools fail
  closed (source unbound); research builtins default to the `builtin` source;
  optional trusted tools with unexpected sources are denied (never allowed).
- `ffgrep`/`fffind` (optional FFF research tools) are admitted into a
  research projection only when present with a trusted/builtin source,
  matching the pi-guard research profile.
- `projectionIdentity` excludes timestamps and outcomes; `evidenceFingerprint`
  includes every present accepted timestamp and the timestamp-source id; the
  evidence record carries the host-supplied accepted timestamp as `observedAt`.

## 10. Scope-integrity check

No Pi execution, retry decisions, `ExecutionResult`, `TrustedReceipt`,
WP-13 orchestration, WP-15 hardening, new lifecycle records, new
persistence/store, generic shell/filesystem authority, or new pi-guard
policy/config semantics. WP-5B consumes the validated `EligibilityReport` and
correlation facts only; it never reinterprets `AuthorityPolicy`/`RuntimeGrant`;
pi-guard receives only derived four-field enforcement data. WP-4/6/8/12
semantics unchanged; pi-guard v0.1.2 untouched.

## 12. Focused correction record (SIR-WP5B-001 / SIR-WP5B-002)

- **SIR-WP5B-001 — CLOSED (typed guard-API failure boundary).** Every trusted
  pi-guard boundary in `run.ts` is now wrapped by a containing `safeCall` that
  converts an unexpected host/API exception into the bounded failure model;
  raw exception text never reaches findings or evidence. Covered:
  `verifyTrustedProjectionApi` (now never-throwing; null/malformed/hostile
  APIs verify as incompatible with a typed finding),
  `applyTrustedProjection` (exception → `failed-closed` with guarded
  restoration), `inspectActiveProjection` (exception after apply → guarded
  restoration, fail closed), and `restoreTrustedProjection` (exception
  contained as a failed restoration outcome via `performRestore`). When
  activation may have partially occurred or its state is unknown, a guarded
  restore is attempted and its truth (verified / failed / not-applicable) is
  reported in `restorationOutcome`. Normal typed pi-guard outcomes are
  unchanged. Seven adversarial tests added: null/invalid API, apply-throw,
  inspect-throw, restore-throw, exception-then-verified-restore,
  exception-then-failed-restore, and a hostile getter API during verification;
  each asserts no `GUARDANOMALY`/`boom` raw text in public output.
- **SIR-WP5B-002 — CLOSED (taxonomy cleanup).** The unused categories
  `GUARD-RESTORATION-UNVERIFIED` and `GUARD-EVIDENCE-UNVERIFIED` were removed
  from the `GuardFindingCategory` union. Restoration truth is carried by the
  existing `restorationOutcome` evidence field (with `GUARD-ACTIVATION-FAILURE`
  findings and stable keys when a restoration cannot be verified); no
  replacement vocabulary was introduced beyond the minimal keys needed for
  the exception boundaries (`activation.unexpected-exception`,
  `activation.inspect-exception`, `restoration.unexpected-exception`,
  `restoration.unverified`, `guard.api-invalid`, `guard.api-verification-failed`).
- **Regression:** the correction is confined to the enforcement path (guarded
  API boundaries inside `run.ts`; defensive `compatibility.ts`; category
  union in `types.ts`; enforcement tests). No shared runtime behavior outside
  the focused enforcement path changed, so the prior complete-Gateway
  regression evidence is preserved: main phase **1871/1872** (the single
  failure is the pre-existing environmental Pi 0.84.1-vs-0.83.0 F8, unchanged)
  and WP-7 **165/165**. The pi-adapter suite was re-run: **337/338** (same
  single pre-existing F8). Builds and typecheck clean.

## 13. Final focused correction record (FSIR-WP5B-001)

- **FSIR-WP5B-001 — CLOSED (malformed host-input containment).** The two
  residual untyped escape paths in `runTrustedEnforcement()` are contained:
  - `input.guard.packageInspection == null` (or non-object / missing
    `findings`/`compatible`) → typed `GUARD-LANE-INCOMPATIBLE` finding with
    stable key `guard.package-inspection-unavailable`; `.findings` and
    `.compatible` are never accessed on an unusable value.
  - `input.surface == null` (or non-object / non-array `entries`) → typed
    `GUARD-SURFACE-UNAVAILABLE` finding with stable key
    `run.surface-unavailable` (null case) / `run.surface-invalid`
    (non-array-entries case, unchanged); `.entries` is never accessed on an
    unusable value.
  Both paths keep `activationOutcome = not-attempted`, perform no authority
  or activation attempt, add no finding category, and leave valid-host-input
  behavior byte-identical (verified empirically: null inspection →
  `guard.package-inspection-unavailable`; null surface →
  `run.surface-unavailable`; valid input still succeeds). One adversarial
  test covers both null shapes and asserts no raw exception text.
  Previously accepted corrections (API exception containment, guarded
  restoration, taxonomy cleanup, projection, fingerprinting, evidence
  canonicalization, authority/correlation logic) are unchanged.

## 14. Final Git state

Gateway HEAD `8d90104` (unchanged); modified tracked: `package.json`,
`src/adapters/pi/index.ts`; untracked new: `src/adapters/pi/enforcement/`,
`tests/pi-adapter/enforcement/`, this report. Nothing staged, nothing
committed; no stash; `dist/`/`dist-test/` are gitignored build outputs. No
push/tag/release/deploy; WP-13 not started; pi-guard not modified.

## 15. Closure record

- **Finding disposition (all CLOSED):** SIR-WP5B-001 (typed guard-API
  failure boundary), SIR-WP5B-002 (taxonomy cleanup), FSIR-WP5B-001
  (malformed host-input containment) — each closed with its adversarial
  tests and recorded above.
- **Final focused rereview:** `WP-5B FINAL FOCUSED REREVIEW ACCEPTED —
  READY FOR WP-5B CLOSURE COMMIT`.
- **Final verification evidence:** focused WP-5B **67/67**; pi-adapter
  **338/339** (sole failure = unchanged environmental Pi 0.84.1 vs
  supported 0.83.0 F8); typecheck/builds clean; preserved full Gateway
  regression **1871/1872** (same F8); preserved WP-7 **165/165**.
- **WP-5B closure status:** CLOSED — pi-guard v0.1.2 integration baseline
  established; PiEnforcementEvidence path established; downstream WP-13
  dependency on WP-5B satisfied. WP-13 NOT STARTED; pi-guard NOT
  modified; no push/tag/release/deploy.
