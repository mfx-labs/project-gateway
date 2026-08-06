# WP-8-C — Trusted Root, Bootstrap, and Capability Framework — Implementation Report

**Status:** WP-8-C implementation is **complete** per the accepted decision
baseline (ADR-028; decision-consolidation report): trusted-root validation,
fixed-directory provisioning, compatibility probe, StoreMetadata bootstrap
persistence, trusted bootstrap input with non-ambient action provenance, and
the one-shot initialization capability are implemented and tested under the
authorized paths. The **production control-plane action-provenance producer
is NOT implemented** and **production initialization is unreachable**. The
integration finding **W8C-I01 is CLOSED** by the focused security-test
integration correction (exact-module delegation; the correction changed no
WP-8-C runtime source; no blanket `/storage/` or `dist/storage/**` exclusion
is used; the stricter storage static guard remains the per-API authority
boundary). The **senior security implementation review returned corrections
required** (two MODERATE findings W8C-S01…S02 and four MINOR findings
W8C-S03…S06); the **focused security implementation correction closed all
six** (register in §17); the **focused security implementation rereview
found the six findings functionally closed** and returned corrections
required only for **two MINOR evidence findings**; the **final
security-evidence micro correction closed both evidence findings**; the
**final historical-evidence label correction closed the remaining labeling
inconsistency**; the **final historical-evidence micro spot check returned
`WP-8-C FINAL HISTORICAL-EVIDENCE MICRO SPOT CHECK: ACCEPTED` with `OPEN
FINDINGS: 0`**; the **WP-8-C implementation is ACCEPTED** and the
**WP-8-C implementation baseline commit** (subject `feat: establish WP-8-C
trusted storage bootstrap`) is the commit containing this update; the
**next gate is the independent WP-8-C implementation-commit
verification**. The
implementation is **accepted**; **WP-8-D and later remain
unauthorized**; no publication has occurred. **Storage suite 148 tests (147 pass, 1
privilege-gated skip); storage static guard 16/16; global security suite
15/15; full default workflow 1358/1358; WP-7 regression 165/165.**

---

## 1. Baseline

| Item | Value |
|---|---|
| Repository | `/home/chef/Documents/Project_Gateway_MCP` |
| Branch | `main` |
| Baseline HEAD | `05904e46ded384bab5f250ac72c2734539f1e86f` (`docs: establish WP-8-C decision baseline`) |
| Baseline parent | `b83120475a4c66606ebb72d9346cf15f10c2f00d` |
| Contract SHA-256 | `aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f` (unchanged; contract not modified) |
| Working tree before change | clean; staging empty; untracked zero; tags zero; no commits after HEAD |

## 2. Authorized Changed Paths (complete current working-tree inventory)

**Original WP-8-C implementation paths:**

- **Source (new, 18):** `src/storage/root/{resolve,identity,overlap,index}.ts`,
  `src/storage/initialization/{state,provision,initialize,index}.ts`,
  `src/storage/probe/{probe,scratch,index}.ts`,
  `src/storage/metadata/{store-metadata,bootstrap-persist,index}.ts`,
  `src/storage/capabilities/{authenticity,index}.ts`,
  `src/storage/trusted-input/{bootstrap-input,index}.ts`.
- **Source (modified, 2):** `src/storage/types.ts` (domain types),
  `src/storage/index.ts` (private barrel; no creators re-exported).
- **Tests (new, 6):**
  `tests/unit/storage/{root,initialization,probe,metadata,capabilities,trusted-input}.test.ts`.
- **Tests (modified, 1):** `tests/unit/storage/static-guard.test.ts`
  (path-scoped enforcement; contract hash updated to `aeed2579…`).

**Focused integration-correction path (W8C-I01):**

- **Tests (modified, 1):** `tests/security/security.test.ts` (exact
  compiled-module delegation of the five filesystem-bearing storage modules
  to the dedicated storage static guard; blanket storage exclusion not
  used; delegation-predicate regression test added).

**Documentation (3):** this report (new),
`docs/design/post-wp5a-roadmap.md` (modified),
`docs/design/post-wp5a-planning-status.md` (modified).

**Not modified:** the authoritative contract, ADR-028, package files,
`src/index.ts`, any other source/schema/script, or any other test file.

Verified working-tree inventory (see §19): **31 unique changed files** — 6
tracked modifications + 25 untracked files; mutually exclusive
classification: **20 source** (18 new + 2 modified storage source), **7 unit
tests** (6 new storage unit-test files + 1 modified storage static-guard
unit-test file), **1 security test** (`tests/security/security.test.ts`),
**3 documentation** (2 modified planning documents + 1 new implementation
report). Arithmetic: `20 + 7 + 1 + 3 = 31`; the category union equals the
exact 31-path inventory and the category intersection is empty.

## 3. Architecture Summary

The WP-8-C storage side is a layered, capability-gated pipeline:

`initializeTrustedStore(trustedConfiguration, actionProvenance, raw)`
→ trusted-input correlation → root validation → one-shot initialization
capability → aggregate state classification → fixed-directory provisioning →
compatibility probe → immutable StoreMetadata → descriptor-bound bootstrap
persistence → durability point → parent revalidation → truthful results.
Every filesystem-mutating boundary revalidates the still-live genuine
capability. The orchestrator is filesystem-free.

## 4. Trusted Input and Action Provenance

`src/storage/trusted-input/bootstrap-input.ts` owns two semantically distinct
private `WeakSet` authenticity domains (`StorageBootstrapActionProvenance`,
`TrustedStorageBootstrapInput`). The action-provenance creator has **zero
production importers** (its only consumer, the future
`src/control-plane/storage-bootstrap-action.ts`, does not exist — enforced
by the static guard); the trusted-input creator is imported only by
`initialization/initialize.ts`. The creation gate requires a genuine WP-6
validated configuration (verified via
`isGenuineValidatedTrustedWorkspaceConfiguration`) AND a genuine action
provenance, and verifies exact correlation of configuration identity,
locator, service UID, forbidden-root set, limit-profile identity, and action
identity (which comes only from the genuine provenance; the WP-6 provenance
limitation — `sourceKind` only — is documented in the module). Forgery
(plain object, spread, JSON, structured clone, prototype imitation, Proxy,
reflection) fails every verifier; accepted objects are deep-frozen.

## 5. Capability Model

`src/storage/capabilities/authenticity.ts` is one of the two exact
brand-bearing modules. `createInitializationCapability` binds only
pre-initialization facts (parent descriptor identity, fixed namespace
derivations, configuration identity, service UID, limit profile, action
identity derived from the verified provenance, operation set
`{namespace-initialize}`, private in-process generation, live/disposed
state) and is imported only by `initialization/initialize.ts`. Methods
revalidate the receiver's private brand, lifetime, generation (advanced on
trusted-configuration replacement via an in-process per-store registry), and
binding; disposal kills every later use; serialization/clone/spread/proxy/
detached-method use fails. Namespace identities and metadata digests are
results, never retroactive bindings. No issuance path exists for write/read/
verify/recovery/retention/migration.

## 6. Root Validation

`src/storage/root/**` validates the explicit locator only (never derived
from env/argv/cwd/request/repository/artifact/WP-8 record): absolute and not
`/`; final component not a symlink (checked before canonicalization); real
canonicalization; descriptor-bound open with `O_RDONLY|O_DIRECTORY|O_NOFOLLOW`;
exact `0700` mode and configured-UID ownership via `fstat` (no
`process.geteuid()`, no `chown`); overlap rejection against the forbidden
set (canonical equality or ancestor/descendant; WP-8-specific pure profile,
WP-6 containment primitives not reused because their semantics differ);
device/inode/type identity capture; point-of-use revalidation. Pure
stat-policy predicates give deterministic wrong-UID/wrong-mode coverage via
synthetic stats.

## 7. Provisioning and Enumeration

`src/storage/initialization/provision.ts` is the sole owner of
`<parent>/config-v1/`, `<parent>/store-v1/`, and each namespace's `metadata/`
and `tmp/`. Exclusive `mkdirSync` with `EEXIST`-verify, descriptor-bound
open/fstat/fchmod/fsync after every creation, fixed target derivations only
(no arbitrary path operand), capability-gated at every boundary, no parent
creation, no `chown`, no repair, no deletion of namespace directories.
`readdirSync` (human-authorized narrow clarification) enumerates only the
exact fixed path, bracketed by pre/post descriptor verification (device,
inode, type, UID, mode); unknown entries fail closed.

## 8. Compatibility Probe

`src/storage/probe/**` runs only inside verified namespace `tmp/` dirs after
provisional creation and before metadata durability: same-device
(descriptor identity across both namespaces), hard-link support, directory
and regular-file `fsync`, exclusive creation (mandatory no-overwrite),
`O_NOFOLLOW` semantics, case behavior, and read-only/native-error mapping
(ENOSPC/EDQUOT/EROFS/EXDEV/EINVAL/EPERM → closed codes). Scratch names derive
from the genuine action-identity digest plus a bounded per-action ordinal
(no randomness, clock, PID, env, cwd); `O_CREAT|O_EXCL|O_NOFOLLOW`; `EEXIST`
fails closed; an action never claims an existing object; only exact
successfully created and recorded names are deleted; dead-action scratch is
never adopted, deleted, or repaired. Probe failure creates no StoreMetadata.

## 9. StoreMetadata

`src/storage/metadata/store-metadata.ts` builds one immutable per-namespace
metadata object recording only stable facts (metadata format version, layout
version, namespace kind, namespace/parent descriptor identities, lane,
bounded probe profile, configuration identity, action identity, limit-profile
identity). Excluded: capability generation, live capability identity,
process-local object identity, random nonces, lock/publication state, mutable
head indexes. Digests reuse the accepted WP-8-B helpers and domains; the
payload digest excludes itself; the record-byte digest excludes itself and
contains the payload digest; no new envelope is invented.

## 10. Metadata Persistence and Replay

`src/storage/metadata/bootstrap-persist.ts`: creation with
`O_CREAT|O_EXCL|O_NOFOLLOW|O_WRONLY`, explicit `0600`, descriptor-bound
`fchmod`/`fstat`, bounded write-all loop (never assumes one write completes
the buffer, zero-progress terminates fail-closed), file `fsync`,
metadata-directory `fsync`, namespace-directory `fsync` (durability point).
Failures after successful exclusive creation — write, file `fsync`, or
either directory `fsync` — report `ERR-STO-DURABILITY` with
verify-before-retry semantics (decision D); pre-creation open failures keep
their native deterministic mapping; the created file is never deleted or
rolled back and a retry enters normal EEXIST classification/replay.
`EEXIST` replay is descriptor-bound and
no-follow: open `O_RDONLY|O_NOFOLLOW` → pre-read `fstat` (type/UID/mode/dev/
ino) → `readFileSync(fd)` → **mandatory post-read `fstat`** compared on
device, inode, type, UID, mode, size → duplicate-key-rejecting parse →
canonical-bytes check → version/payload-digest/record-digest/namespace/
parent/stable-field verification including the full `limitProfileIdentity`
(configuration version and configuration identity; W8C-S01) →
exact-match-only idempotence; any mismatch fails closed. Wrong record kind
maps to `ERR-STO-MALFORMED`; a recognized kind with an unsupported format
version maps to `ERR-STO-UNSUPPORTED-VERSION` (W8C-S04). Path-based reads
are prohibited for replay (guard + source assertion). Not a general record
publisher; no lifecycle or configuration-record publication; no hard-link
publication.

## 11. State Machine

`initialization/state.ts` + provision classification implement the accepted
states (ABSENT, PROVISIONAL, INITIALIZED, PARTIAL, FOREIGN,
IDENTITY_DRIFTED, MALFORMED_METADATA, UNSUPPORTED_VERSION): fully-absent may
initialize; exact-initialized is verification-only (no writes) and requires
namespace-root policy verification (directory type, configured UID, exact
`0700`, no-follow, identity match — W8C-S03); provisional
continues only under a new genuine one-shot capability after verification;
one-initialized-plus-one-absent fails closed (`ERR-STO-RECOVERY-REQUIRED`);
malformed/foreign/drifted/unsupported/unknown-entry states fail closed;
only a genuine missing namespace root (`ENOENT`) classifies ABSENT —
`ENOTDIR`/`ELOOP`/`EACCES`/`EPERM` and unverifiable conditions classify
FOREIGN/IDENTITY_DRIFTED and block provisioning (W8C-S03); no
repair, reconstruction, deletion, or authoritative cleanup ever occurs.

## 12. Error Model

Only the closed 31-code vocabulary: ROOT-INVALID, ROOT-IDENTITY-CHANGED,
PERM-DENIED, FS-UNSUPPORTED, READONLY-FS, CROSS-DEVICE, NO-SPACE,
QUOTA-EXCEEDED, IO-FAILURE, CONFIG-UNAVAILABLE, MALFORMED,
UNSUPPORTED-VERSION, INTEGRITY, DURABILITY, RECOVERY-REQUIRED, REQ-INVALID,
INTERNAL-INVARIANT, NOT-FOUND. No new code; disclosure-safe static messages
(no roots, repositories, or workspaces disclosed).

## 13. Static Guard

`tests/unit/storage/static-guard.test.ts` now enforces: per-module exact
`node:fs` API allowlists with exact-name named imports only (no namespace,
renamed, default, `require`, dynamic, export-from, off-allowlist, or
forbidden-module forms); filesystem API names and `fs.` property access
denied outside the five exact filesystem-bearing allowlisted modules
(`src/storage/root/resolve.ts`, `src/storage/initialization/provision.ts`,
`src/storage/probe/probe.ts`, `src/storage/probe/scratch.ts`,
`src/storage/metadata/bootstrap-persist.ts`); filesystem-bearing modules
export no fs-imported names; no local re-export chain exposes fs names; brand
markers (`new WeakSet`) granted only to the two exact brand-bearing modules;
factory and future-issuance markers denied globally; creator-consumer edges
(enforced across all of `src/**`): the action-provenance creator has zero
production importers, the trusted-input and capability creators are imported
only by `initialization/initialize.ts`; `src/storage/index.ts` re-exports no
creator; package/export/dependency/contract-hash invariants; extended
synthetic negative inventory (bare `fs`, `fs/promises`, `node:fs/promises`,
namespace/renamed/default imports, export-from, re-export chains, helper
indirection, wrong-path brand markers, future issuance markers).

## 14. Test Evidence

### Pre-correction test evidence (historical)

This was the result BEFORE the W8C-I01 correction; it is preserved only as
labeled history. The earlier proposal of a WP-8 storage boundary exclusion
was **rejected**; it is not the current boundary model. The authoritative
current result is in Section 18.

| Command | Result (before W8C-I01 correction) |
|---|---|
| `npm test` (default workflow) | **1356/1357** — 1 failure: `security: production modules perform no hidden filesystem/network/process I/O` (pre-existing blanket scan rejecting the authorized WP-8-C `node:fs` modules) |

### Historical evidence after W8C-I01 and before the senior-security correction

The counts in this subsection belong to the **W8C-I01 integration-correction
gate** (exact compiled-module delegation). They are preserved **only as
historical evidence**: they were superseded by the focused security
implementation correction (W8C-S01…S06) and are **NOT** the current WP-8-C
verification counts. The authoritative current evidence is **Section 18**:
storage suite **148 total / 147 pass / 1 privilege-gated skip / 0 fail**;
static guard **16/16**; global security **15/15**; combined unit **317 total
/ 316 pass / 1 privilege-gated skip / 0 fail**; default workflow
**1358/1358**; WP-7 **165/165**.

Commands and counts at the W8C-I01 gate (run from the unstaged and
uncommitted WP-8-C working tree based on baseline commit
`05904e46ded384bab5f250ac72c2734539f1e86f`; W8C-I01 changes were **not
committed** at that gate; the baseline commit itself does **not** contain
the WP-8-C runtime implementation):

| Command | Result (W8C-I01 gate, historical) |
|---|---|
| `npm run typecheck` | pass, 0 errors |
| `npm run build` | pass (51 schemas, 358 corpus inputs) |
| `npx tsc -p tsconfig.tests.json` | pass, 0 errors |
| `node --test dist-test/tests/unit/storage/*.test.js` (run twice) | **134/134** pass, 0 fail (twice) |
| `node --test dist-test/tests/unit/storage/static-guard.test.js` | **13/13** pass |
| `node --test dist-test/tests/security/security.test.js` | **15/15** pass |
| `npm run test:security` | **15/15** pass |
| `npm run test:unit` | **169/169** pass |
| combined (`unit/*.test.js` + `unit/storage/*.test.js`) | **303/303** pass |
| `npm test` (default workflow) | **1358/1358** pass, 0 fail |
| WP-7 runner (`node scripts/run-wp7-tests.mjs`) | **165/165** pass (reader 62, git 38, fff 26, security 39) |
| export audit | 42 |
| package-export / dependency / contract-hash audits | pass |
| `git diff --check` | clean |

Count reconciliation: previous workflow count 1357; +1 unique delegation
regression test (`security: storage fs-module delegation is exact and
fail-closed`); current workflow count 1358; duplicate execution 0.

New test coverage: root canonicalization/rejection, parent ownership and
exact mode (synthetic + integration), symlink/alias rejection, forbidden-root
overlap, identity drift, directory provisioning, exact entry sets,
unknown-entry rejection, provisional replay, partial aggregate rejection,
probe success and per-error mapping, scratch no-overwrite and ownership,
dead-action scratch non-adoption, metadata canonical bytes and digests,
partial-write loop, no-overwrite persistence, descriptor-only replay,
mandatory post-read revalidation, tamper/malformed/duplicate-key/version
drift, action-provenance and trusted-input forgery, capability forgery,
one-shot disposal, stale generation, wrong bindings, structured-clone and
detached-method rejection, static-guard allowlists and negative inventory,
creator-consumer graph, export/dependency zero delta.

## 15. Requirement Disposition (conservative)

Implemented and tested in WP-8-C: CSR-001…005, 007; SRX-001…009/011/012/014/
015 at initialization scope (SRX-010/013 primitives + initialization-scope
application); FSL-001…010; CAP-001 (initialization kind only)…007/010…016;
API-001/002/005/006/007/009/010/011; FSP-006/007/008/010/011; SRE-001/002/
004/005/012; VRS-001/002; TAU-008/010 (represented). Integrated later:
per-operation SRX-013, publication-boundary CAP-008/009, API-003/004,
FSL-010 open-time re-verification. Deferred/not owned: CSR-006, AUD-001,
CSA, WPR, LOK, RDS, RGY, RNT, TAU-001…007. No overclaims.

## 16. Mutation Evidence

Mutation is confined to the four fixed target classes and probe scratch
under verified `tmp/` dirs, all capability-gated: `mkdirSync` of
`config-v1/`, `store-v1/`, each `metadata/`, each `tmp/` (exclusive,
`0700`); `openSync`/`fchmodSync`/`fsyncSync` on created descriptors;
`O_CREAT|O_EXCL` metadata files (`0600`); probe scratch files/symlinks with
exact-name cleanup. No parent creation, no `chown`, no deletion of namespace
directories, no repair, no lock, no publication, no reads of authoritative
records, no registry, recovery, retention, or migration behavior.

## 17. Findings and Required Correction

- **W8C-I01 (integration, closed by the focused security-test integration
  correction):** the pre-existing blanket no-I/O scan
  (`tests/security/security.test.ts`) rejected the authorized WP-8-C
  `node:fs` modules in compiled `dist/storage/**`. Resolution: the global
  test now delegates ONLY the five exact compiled filesystem-bearing modules
  (`storage/root/resolve.js`, `storage/initialization/provision.js`,
  `storage/probe/probe.js`, `storage/probe/scratch.js`,
  `storage/metadata/bootstrap-persist.js`) to the stricter dedicated storage
  static guard, via an exact-path predicate
  (`isStorageFsDelegatedModule`) that fails closed on everything else. A
  blanket `/storage/` or `dist/storage/**` exclusion was rejected: barrels,
  the orchestrator, the state classifier, the metadata profile, the
  capability and trusted-input modules, sibling files, near-matches, nested
  descendants, traversal spellings, and hypothetical future modules all
  remain subject to the global no-I/O assertion. Direct regression tests
  cover the accepted set and 33 rejected spellings, plus a real-tree
  exact-set check. The dedicated storage static guard remains the full
  per-API authority policy; it passed 13/13 at the W8C-I01 closure gate and
  currently passes 16/16 as recorded in §18. The global test delegates by
exact module
  only.
- **Notes:** (a) a recreated directory may reuse a freed inode on some
  filesystems; the contract identity model is device+inode+type and
  descriptor-bound type/descriptor checks catch replacement by anything
  else — recorded as a bounded limitation; (b) root-privileged UID-switch
  tests remain optional; wrong-UID coverage is deterministic via synthetic
  stats and the verification-only wrong-UID test is privilege-gated
  (skipped when `chown` is unavailable); (c) no remote is configured;
  remote publication not provable.

## 17a. Senior Security Review — Correction Register (W8C-S01…S06)

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| W8C-S01 | MODERATE | metadata replay did not verify `limitProfileIdentity` against the expectation | CLOSED — `verifyMetadataModel` now compares both components (configuration version, configuration identity) of the recorded limit-profile identity against the caller's verified expected identity by canonical value (no object-reference or key-order dependence); mismatch fails closed (`ERR-STO-INTEGRITY`) and never classifies the namespace INITIALIZED; tests: exact match, reordered-equivalent expectation, mismatched configuration version, mismatched configuration identity, self-consistent-stored-with-wrong-expectation |
| W8C-S02 | MODERATE | post-creation durability failures mapped to ordinary IO-FAILURE/NO_STATE instead of decision-D semantics | CLOSED — every failure after successful exclusive creation (fchmod/fstat, zero-progress or partial write, file `fsync`, metadata-directory `fsync`, namespace-directory `fsync`, close) reports `ERR-STO-DURABILITY`; pre-creation open failures keep their deterministic native mapping (no state created); the created file is never deleted or rolled back; a retry enters normal classification/replay (EEXIST → exact verification); injectable `fsyncFile`/`fsyncDirectory`/`write` hooks (defaulting to the real APIs, mirroring the accepted `writeAllSync` injection pattern) enable per-stage failure tests. **Evidence scope (accurate):** persist-level tests directly assert, for file-, metadata-directory-, and namespace-directory-fsync failures — `ERR-STO-DURABILITY`; the metadata file remains; no deletion; identity (inode) and bytes of the originally created object are unchanged; a subsequent normal invocation enters EEXIST replay and verifies the existing metadata (`outcome: verified`) with no re-creation or overwrite. The orchestrator state-tuple mapping (`ERR-STO-DURABILITY` → the existing `UNKNOWN_STATE` summary with `primaryStateChanged: unknown` and `verifyBeforeRetry: true` in `initialize.ts`) is verified from orchestrator code and independently exercised by the focused rereviewer; it is NOT claimed as directly asserted by every persist-level fsync test |
| W8C-S03 | MINOR | namespace classification downgraded non-ENOENT open failures to ABSENT; namespace policy not verified on the verification-only path | CLOSED — pure `classifyNamespaceOpenError` maps only `ENOENT` → ABSENT; `ENOTDIR`/`ELOOP`/`EACCES`/`EPERM`/`ENAMETOOLONG`/`EINVAL` → FOREIGN; everything else (incl. `EIO`) → IDENTITY_DRIFTED; no provisioning mutation occurs after a non-ENOENT classification failure; the verification-only INITIALIZED path now policy-verifies each namespace root (directory type, configured UID, exact `0700`, no-follow, identity match) before accepting; no silent repair |
| W8C-S04 | MINOR | wrong `recordKind` pre-classified as UNSUPPORTED-VERSION | CLOSED — replay precedence corrected: wrong record kind → `ERR-STO-MALFORMED`; recognized kind with unsupported format version → `ERR-STO-UNSUPPORTED-VERSION`; both branches tested |
| W8C-S05 | MINOR | static guard did not parse named local export-from declarations | CLOSED — `parseImports` now retains export-from names (plain and aliased); creator-consumer edges unwrap aliases; creators are never re-exported by any storage module (plain, aliased, export-from, multiline — file scan + synthetic samples); `export * from` denied outside the top barrel; local export-from of filesystem-imported names detected (aliases unwrapped); no parser dependency added |
| W8C-S06 | MINOR | missing zero-progress and per-stage fsync-failure tests | CLOSED — explicit zero-progress write test (loop terminates, `ERR-STO-DURABILITY`, file not deleted) and file-fsync / metadata-directory-fsync / namespace-directory-fsync injection tests; each fsync-stage test asserts the failure code, the remaining file, no deletion, unchanged inode and bytes (originally created object), and the subsequent normal-invocation EEXIST replay verifying the existing metadata (`verified`) with no re-creation or overwrite |
| W8C-E01 | MINOR (evidence) | stale closing banner stated the senior-security-review gate | CLOSED (final micro) — banner replaced with `WP-8-C FINAL SECURITY-EVIDENCE MICRO CORRECTION: READY FOR FINAL SPOT CHECK`; chronology records the senior review, the focused correction (S01…S06), the focused rereview (six findings functionally closed, corrections required only for two MINOR evidence findings), and this correction |
| W8C-E02 | MINOR (evidence) | fsync-failure tests lacked rerun assertions; state-tuple wording overstated direct test scope; combined-unit row overstated | CLOSED (final micro) — metadata-directory and namespace-directory fsync tests extended (same top-level tests): `ERR-STO-DURABILITY`, file remains, no deletion, unchanged inode/bytes of the originally created object, subsequent normal invocation enters EEXIST replay and verifies (`verified`), no re-creation/overwrite; state-tuple evidence scoped accurately (see W8C-S02 row); combined-unit row corrected to 317 total = 316 pass + 1 privilege-gated skip + 0 fail |

**Findings:** the six senior-review findings (W8C-S01…S06) were found
functionally closed by the focused rereview; the two remaining MINOR
evidence findings (W8C-E01…E02) are claimed closed by this final micro
correction; the final security-evidence micro spot check is pending.
**Blockers:** none. **Deviations:** none — contract byte-identical; no
requirement ID/count changed; no prohibited path touched; no runtime
source change in this correction; no capability instance or filesystem
authority added; no new error code, state, result field, or public
type/export.

## 18. Test Evidence (post-correction)

| Command | Result |
|---|---|
| `npm run typecheck` | pass, 0 errors |
| `npm run build` | pass (51 schemas, 358 corpus inputs) |
| `npx tsc -p tsconfig.tests.json` | pass, 0 errors |
| `node --test dist-test/tests/unit/storage/*.test.js` (run twice) | **148 tests / 147 pass / 1 privilege-gated skip** (134 prior + 14 new unique; the skip is the wrong-UID verification-only test when `chown` is unavailable — wrong-UID covered deterministically by synthetic stat-policy tests), both runs |
| `node --test dist-test/tests/unit/storage/static-guard.test.js` | **16/16** (13 prior + 3 new) |
| `node --test dist-test/tests/security/security.test.js` | **15/15** |
| `npm run test:security` | **15/15** |
| `npm run test:unit` | **169/169** |
| combined unit | **317 total = 316 pass + 1 privilege-gated skip + 0 fail** (169 + 148; the skipped wrong-UID integration test is backed by deterministic synthetic UID-policy coverage) |
| `npm test` (default workflow) | **1358/1358** pass, 0 fail |
| WP-7 runner | **165/165** |
| export / package-export / dependency / contract-hash audits | pass |
| `git diff --check` | clean |

Count reconciliation: storage suite prior unique count 134; +14 new unique
tests (metadata 6: limit-profile exact match, zero-progress write, file/
metadata-dir/namespace-dir fsync failure, record-kind precedence;
initialization 5: wrong-mode / wrong-UID (privilege-gated) / wrong-type and
drift on the verification-only path, non-ENOENT classification without
provisioning, pure open-error mapping; static guard 3: creator re-export
scan, export-star policy, synthetic export-from/alias samples) = 148 unique
(147 pass + 1 privilege-gated skip); runner count 148; duplicate execution
0. Default workflow remains 1358/1358 (the storage suite is not part of the
default `npm test` glob — accepted bounded test-runner limitation, enforced
by the explicit documented gate command). No runtime source was changed in
the W8C-I01 correction.

## 19. Git State

All changes unstaged and uncommitted; staging empty; tags zero; no commits
after HEAD `05904e46ded384bab5f250ac72c2734539f1e86f`; no push, tag,
release, publication, installation, or deployment; no WP-8-D work begun;
the production control-plane producer is not implemented; production
initialization is unreachable.

**Verified working-tree inventory (31 unique changed files):** tracked
modified 6 (`docs/design/post-wp5a-planning-status.md`,
`docs/design/post-wp5a-roadmap.md`, `src/storage/index.ts`,
`src/storage/types.ts`, `tests/security/security.test.ts`,
`tests/unit/storage/static-guard.test.ts`); untracked 25 (18 storage
source files, 6 storage unit-test files,
`docs/reports/wp-8c-implementation-report.md`). Mutually exclusive
classification: **20 source** (18 new + 2 modified), **7 unit tests** (6 new
storage unit-test files + 1 modified storage static-guard unit-test file),
**1 security test** (`tests/security/security.test.ts`), **3 documentation**
(2 modified planning documents + 1 new implementation report);
`20 + 7 + 1 + 3 = 31`; the category union equals the exact 31-path
inventory and the category intersection is empty. Every path is a tracked
modification or untracked file; no path is omitted or counted twice; no
unauthorized path exists.

**WP-8-C FINAL HISTORICAL-EVIDENCE MICRO SPOT CHECK: ACCEPTED**
**OPEN FINDINGS: 0**
**WP-8-C IMPLEMENTATION: ACCEPTED**
**WP-8-C FULL DEFAULT WORKFLOW: PASS (1358/1358)**
