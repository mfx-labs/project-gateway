# WP-8-E — Read-Only Registry and Recovery Slice — Implementation Report

**Status:** WP-8-E — the first vertical slice of contract §29 phase 4
(Audit, Registry Indexes, and Recovery) — is implemented under the
authorized read-only scope: **registry derivation and recovery scanning**.
This report records the implementation, the exact changed-path inventory,
the architecture, the scanning model, the derivation and classification
semantics, the recovery-plan model, the security-boundary extensions, the
verification evidence, and the remaining phase-4 work. **Implementation
acceptance is not yet granted**; all changes are left unstaged and
uncommitted; no push, tag, release, publish, install, or deploy has
occurred; WP-9 remains unauthorized.

**Verdict:** `WP-8E READ-ONLY REGISTRY AND RECOVERY SLICE: READY FOR REVIEW`

**Focused correction (this revision):** the primary implementation review
(`WP-8-E Read-Only Registry and Recovery Slice — Implementation Review.md`)
returned open findings F1–F4 and F6. This revision corrects exactly those
findings: F1 continuation forward progress, F2 generation-bound cursors,
F3 parent-level scan completeness, F4 directory-disappearance drift, and
F6 fresh-process precondition documentation. The non-blocking review notes
F5, F7, F8, and F9 are recorded as deferred observations in §13. The
registry and recovery architecture is unchanged; no quarantine, mutation,
retention, migration, WP-8-F, or WP-9 work is implemented.

---

## 1. Baseline and Governance

| Item | Expected | Verified |
|---|---|---|
| Repository | `/home/chef/Documents/Project_Gateway_MCP` | exact |
| Branch | `main` | exact |
| Baseline HEAD | `23a30b212dbe1f2ffa05e2b69314754730aeb222` | exact |
| Baseline subject | `docs: close WP-8-D durable storage operations` | exact |
| Working tree at start | clean | clean |
| WP-8-D | CLOSED | closed at the baseline |
| Contract SHA-256 | `aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f` | byte-identical (static guard) |
| Dependencies | `ajv@8.20.0` only | unchanged |
| Public exports | 42 | unchanged |
| Package exports | `"."`, `"./pi-adapter"` | unchanged |
| `src/index.ts` | unchanged | unchanged (storage remains private) |
| Retention / migration | out of scope | not implemented |
| WP-9 / WP-12 integration | out of scope | not implemented |

## 2. Exact Changed-Path Inventory

**New source (9):**

- `src/storage/registry/classify.ts` — pure closed 11-way candidate classification (fs-free).
- `src/storage/registry/derive.ts` — pure snapshot finalization, audit association, registry-view derivation (fs-free).
- `src/storage/registry/compose.ts` — registry-view composition boundary (fs-free; capability-gated read).
- `src/storage/registry/index.ts` — registry barrel.
- `src/storage/recovery/scan.ts` — fs-bearing read-only store scan (records/audit/tmp/locks); the only new `readdirSync` owner.
- `src/storage/recovery/assess.ts` — pure recovery assessment + pure lock-record parsing (fs-free).
- `src/storage/recovery/plan.ts` — pure advisory recovery-plan construction (fs-free).
- `src/storage/recovery/compose.ts` — recovery-scan composition boundary (fs-free; capability-gated read).
- `src/storage/recovery/index.ts` — recovery barrel.

**Modified source (3):**

- `src/storage/types.ts` — WP-8-E domain types (scan observations, classifications, views, assessment, plan, cursors, bounds, requests).
- `src/storage/read/index.ts` — exports the shared store-revalidation helper and the store-records root derivation for the new composition boundaries (no behavior change).
- `src/storage/index.ts` — private storage barrel exports the two new sub-barrels (creators never re-exported).

**New tests (2):**

- `tests/unit/storage/registry.test.ts` (33 tests; +10 continuation/snapshot correction tests)
- `tests/unit/storage/recovery.test.ts` (8 tests)

**Modified tests (2):**

- `tests/unit/storage/static-guard.test.ts` — allowlists, `readdirSync` owners, creator edge for `createReadCapability`, registry/recovery boundary test, directory-existence policy, read/scan mutation-free test.
- `tests/security/security.test.ts` — exact compiled-module delegation gains `storage/recovery/scan.js`; every other compiled storage module remains under the blanket no-I/O assertion (no blanket storage exclusion).

**Documentation (3):**

- `docs/reports/wp-8e-registry-recovery-read-slice-implementation-report.md` (this report).
- `docs/design/post-wp5a-roadmap.md` — current-state wording (WP-8-D closed; WP-8-E implemented; next gate).
- `docs/design/post-wp5a-planning-status.md` — current-state wording (same).

## 3. Architecture

The slice follows the accepted WP-8-B/C/D separation: **pure derivation is
separate from filesystem access**, filesystem scanning lives in narrowly
owned modules, recovery-plan construction is filesystem-free, and nothing
is exported from the package root.

```
src/storage/
  registry/            (fs-free)
    classify.ts        per-candidate 11-way classification + envelope-fact extraction (pure)
    derive.ts          finalization (chain/duplicate), audit association, registry view (pure)
    compose.ts         deriveRegistryView(request) — revalidate store, issue read capability, scan, derive
  recovery/
    scan.ts            (fs-bearing, READ-ONLY allowlist)
                       scanStoreSnapshot — records/audit (+tmp/locks in recovery mode),
                       descriptor-verified readdir brackets, bounds, continuation, hooks
    assess.ts          (fs-free) assessRecovery(observations) + parseLockRecordFacts (pure)
    plan.ts            (fs-free) buildRecoveryPlan(assessment) — advisory data only
    compose.ts         runRecoveryScan(request) — revalidate store, issue read capability, scan, assess, plan
```

- The two composition boundaries reuse the accepted read boundary pattern:
  genuine branded trusted input + genuine WP-6 trusted configuration →
  store revalidation through the metadata verification pipeline →
  `createReadCapability` (non-mutating; the only capability used) →
  scan → pure derivation. `createReadCapability`'s static creator edge is
  extended to exactly the two new composition modules.
- **F6 — fresh-process precondition (inherited accepted limitation, not
  solved by WP-8-E):** the composition boundaries issue their read
  capability through `createReadCapability`, whose generation registry is
  the accepted WP-8-D per-process model with `allowCreate=false` for
  non-mutating creators. A fresh read-only process therefore CANNOT issue
  the capability until the generation registry has been seeded by an
  accepted initialization/mutation/control-plane path in that process;
  until then the boundaries fail closed with `ERR-STO-REQ-INVALID`. This is
  an inherited accepted limitation of the WP-8-D capability model — genuine
  trusted input alone is NOT sufficient — and WP-9 or a later integration
  phase must seed or revise the model before standalone fresh-process read
  service operation. The capability model itself is unchanged by this
  correction.
- The scan verifies the closed `enumerate-class` read operation (the
  operation vocabulary is closed; the scan is a bounded enumeration read).
- **No production capability or provenance creator is added or exported**;
  no recovery-operation export exists; the recovery capability kind
  (`recovery`) appears only as a future-capability name inside advisory
  plan data.

## 4. Scanning Model

- **Parent surfaces (F3)** (contract 5.2): `records/` and `audit/` are
  enumerated deterministically before any class content. The exact
  configured record-class directory set (15 classes; `store-metadata` is
  excluded — it is persisted at `metadata/metadata.json`, never under
  `records/`) and the expected `audit-event` directory are recognized;
  unknown directories, stray regular files, symlinks, and special objects
  are reported as foreign observations with best-effort descriptor facts
  (never promoted to verified records); missing required class directories
  are reported as `ERR-STO-INTEGRITY` findings naming the absent class.
  Parent-level structure is budget-free (bounded by the closed taxonomy)
  and is reported by the first page only (no continuation), so the paging
  union stays complete and duplicate-free.
- **Surfaces** (fixed order): the 15 record classes in taxonomy order
  (`records/<segment>/`), then the audit class (`audit/audit-event/`), then
  — recovery mode only — `tmp/` and `locks/`. The configuration namespace
  is not scanned in this slice (recorded limitation; namespace-scoped
  recovery per CSR-008).
- **Descriptor-bound, no-follow, non-blocking**: every directory and object
  is opened with `O_NOFOLLOW` (+`O_NONBLOCK` so special files fail closed
  instead of blocking); file type, UID, exact mode, link count, and size
  come from the opened descriptor with mandatory pre/post stat comparison.
- **Directory identity drift (F4)**: every directory is descriptor-verified
  before and after `readdirSync`; device/inode/UID/mode divergence fails
  closed with `ERR-STO-ROOT-IDENTITY-CHANGED` (SRX-013, FSP-004). A
  directory that was successfully opened and verified and then fails to
  re-open (or vanishes during `readdir`) is drift, never absence; only a
  first-attempt `ENOENT` (never opened) is an absent surface, retained only
  where the contract allows (phase-2 stores lack `records/`, `audit/`,
  `locks/`). Class directories, the audit directory, `tmp/`, `locks/`, and
  shard directories follow the same drift rule. A test-only injection hook
  (`ScanHooks.afterReaddir`, same pattern as `PublicationHooks`) makes
  disappearance deterministic in tests.
- **Never trust host order**: all names are sorted; shard iteration is the
  sorted set of existing shard directories; classes iterate in taxonomy
  order. Identical store bytes → identical observations (DTM-003).
- **Bounds** (LMT-004/005/006/010): strict entry and aggregate-byte limits
  with exact-limit acceptance and limit-plus-one fail-closed truncation.
  Registry scans use `totalScanEntries`/`totalScanBytes` with truncation
  evidence + continuation cursor `{generation, recordClass, shard, entry}`
  (resume strictly after the last processed entry, never re-reporting);
  recovery scans use `recoveryScanEntries`/`totalScanBytes` and **fail
  closed** with `ERR-STO-LIMIT-EXCEEDED` (the contract row: "recovery
  fails closed"). Every candidate is bounded by `recordBytes`
  (records/audit) or `temporaryBytes` (tmp).
- **Forward progress (F1, accepted WP-8-D enumeration model)**: entries
  skipped because they are at or before the continuation cursor
  (classes before the cursor class, shards before the cursor shard, the
  cursor shard's own name, and entries at or before the cursor entry) are
  cursor-seeking work and do NOT consume the resumed page's entry budget;
  only candidates considered for the resumed page count. Reissuing the
  same request with the returned cursor and identical bounds advances
  strictly beyond the previous cursor; a non-empty finite store terminates
  after repeated same-bounds requests; no candidate is duplicated or
  silently skipped.
- **Byte-bound truncation never advances past an unread candidate
  (F1-B)**: the scan separates the last observed item, the last processed
  candidate, the last resumable cursor position, and the current unread
  candidate. When candidate X passes its individual size bound and is next
  in deterministic scan order but cannot fit within the remaining
  aggregate `totalScanBytes` page budget: X remains reachable, no
  observation for X is emitted, no result implies X was processed, no
  cursor position sorts at or after X, and no candidate after X is
  processed on that page. If at least one resumable candidate was
  processed on the page, the continuation points at the last successfully
  processed resumable candidate (strictly before X); if zero resumable
  candidates were processed, NO continuation is emitted: the truncated
  result without a continuation is the detectable no-progress state. A
  caller repeating the same insufficient byte profile never silently
  loses X; because the request generation binds byte limits, increasing
  the byte limit requires restarting WITHOUT the old cursor (a raised
  limit invalidates the old cursor with `ERR-STO-REQ-INVALID` anyway).
- **Self-validating cursors (F1-S)**: a foreign shard name is a
  non-resumable structural anomaly — budget-free, reported at its first
  encounter in deterministic scan order across pages (each anomaly exactly
  once), never a resumable cursor position, never blocking later valid
  candidates. Every emitted continuation is validated against the
  scanner's own cursor validator before return; an invalid emission is an
  internal-invariant failure.
- **Cross-page surface binding (F3-G)**: the cursor additionally carries a
  `surfaceGeneration` digest binding the structural snapshot observed on
  the first page — `records/` and `audit/` parent presence and identity,
  the expected record-class presence set, `audit-event` presence, and the
  identities of every present class directory (no raw device/inode value
  is exposed). On resumed pages the parent/class structure is re-read
  before candidate content and compared with the cursor-bound snapshot:
  absent-on-both-pages is unchanged; present-to-absent, absent-to-present,
  class-set change, parent disappearance, and directory replacement are
  drift (`ERR-STO-ROOT-IDENTITY-CHANGED`, zero accepted partial
  observations).
- **Generation-bound cursor (F2)**: the cursor distinguishes the request
  compatibility generation (binding store identity — both namespace
  dev/ino — effective entry limits, effective byte limits, scan mode
  (`registry` | `recovery`), fail-closed behavior, and the class-order
  model version), the cross-page surface-generation digest (F3-G), and the
  resumable traversal position. Registry and recovery scans over the same
  store and numeric limits produce different request tokens. Cursor
  validation order: (1) syntax and digest shape; (2) request-generation
  compatibility; (3) the re-read structural snapshot against the
  cursor-bound surface generation; (4) traversal position; (5) candidate
  scanning. Malformed or incompatible request cursors →
  `ERR-STO-REQ-INVALID` before any candidate content is scanned
  (cross-store, changed limits, changed mode, missing tokens, and
  previous-model cursors all fail closed; never silently restarted or
  continued); store structure changed after page one →
  `ERR-STO-ROOT-IDENTITY-CHANGED`. No cursor field grants authority; no
  raw path, device, inode, nonce, descriptor, callback, or capability
  object is ever returned.
- **Never accept caller-supplied raw paths**: the only operands are the
  verified store instance, the closed class set, and a validated
  continuation cursor (malformed cursors fail with `ERR-STO-REQ-INVALID`
  before any I/O).
- Observations carry **no raw paths** (only class/shard/entry designators),
  no payload bytes, and no lock nonce; ids and the scan-generation token
  are deterministic domain digests (no clock/randomness).

## 5. Record Classification

Each candidate is classified into exactly one of the closed 11-way
vocabulary, with the deterministic precedence of contract 18.2 and the
existing 31-code set (no new error code):

| Classification | Code |
|---|---|
| `valid-immutable-record` | — |
| `malformed` (syntax/minimum envelope/canonicalization) | `ERR-STO-MALFORMED` |
| `unsupported-version` | `ERR-STO-UNSUPPORTED-VERSION` |
| `digest-mismatch` | `ERR-STO-INTEGRITY` |
| `wrong-derived-location` (derivation, identity, or class mismatch) | `ERR-STO-INTEGRITY` |
| `wrong-type` (symlink, directory, FIFO, socket, device) | `ERR-STO-FTYPE-UNSUPPORTED` |
| `wrong-uid-or-mode` | `ERR-STO-PERM-DENIED` |
| `unexpected-hard-link` (nlink > 1) | `ERR-STO-INTEGRITY` |
| `foreign-entry` (name grammar) | `ERR-STO-MALFORMED` |
| `incomplete-relationship` (unresolved chain reference; snapshot pass) | `ERR-STO-INTEGRITY` |
| `duplicate-conflicting-identity` (contested identity; snapshot pass) | `ERR-STO-DUPLICATE` / `ERR-STO-CONFLICT-REVISION` |

Precedence: entry grammar → derived location → file type → UID/mode →
link count → byte bound (malformed bucket with the dedicated
`ERR-STO-LIMIT-EXCEEDED` code) → content precedence (malformed /
unsupported-version / canonicalization / digest) → envelope identity and
class placement. Wrong-location copies are read within bounds so their
envelope identity feeds the deterministic duplicate/conflict pass (location
classification still precedes content classification). The two
snapshot-relative categories are assigned by the pure finalization pass:
unresolved `previousRecordDigest` (same-class, digest-resolved) →
`incomplete-relationship`; an identity claimed by more than one
content-bearing candidate → the derived-location record is upgraded to
`duplicate-conflicting-identity` and the identity is never silently
resolved (RGY-004). Conflict kind per 18.2: same revision with different
digest → `ERR-STO-CONFLICT-REVISION`; otherwise `ERR-STO-DUPLICATE`.

## 6. Registry Derivation

Deterministic in-memory views over **verified records only** (RDS-005,
RGY-001…010): records grouped by class (taxonomy order, then shard/entry),
records grouped by logical identity (revision order), the latest resolvable
revision per identity (highest verified, chain-resolved revision; contested
identities never resolve), duplicate/conflict findings, audit events
associated with primary records (exact payload identity+digest match),
missing-audit findings (`ERR-STO-DURABILITY`, post-audit-publication phase)
and dangling-audit findings (`ERR-STO-INTEGRITY`/`ERR-STO-MALFORMED`).
Views contain no raw paths, no payload bytes, no capability objects; they
bind the scan generation (deterministic digest over store identity +
bounds; RGY-005), are reproducible from the same immutable bytes, grant no
authority (RGY-010), and make no lifecycle decision. Chain resolution is
same-class and mechanical; cross-class chain semantics are WP-2 lifecycle
semantics, out of this slice (recorded limitation).

## 7. Recovery Classification

The bounded recovery assessment (`assessRecovery`, pure) contains:
verified durable records; verified audit evidence; orphan temporary
objects classified per WPR-023 (a) inode-twin of a content-verified
published record, (b) incomplete unpublished, (c) malformed temporary,
(d) other; persistent writer-lock observations (present/foreign/malformed;
parsed normative fields; liveness never assumed per LOK-008; the nonce is
never carried); incomplete primary/audit publication states (missing audit,
dangling audit, orphan temporaries); malformed or foreign objects;
quarantine-eligible objects (every non-verified record/audit/foreign
observation plus every orphan temporary — CSA-008/010; quarantine itself is
not executed); objects requiring human or control-plane disposition
(tamper-class observations, contested identities, dangling audit events —
primaries are never reconstructed, TAU-009 — and lock observations);
reconstruction candidates (durable primary with missing audit; 16.3 —
reconstruction itself is not executed).

## 8. Recovery-Plan Model

The plan (`buildRecoveryPlan`, pure) is structured, deterministic,
non-authoritative advisory data (`advisoryOnly: true`, no executable form).
Every action carries: `actionId` (deterministic), `targetLogicalIdentity`
(record identity or entry designation — never a path), `targetKind`,
`category` (`quarantine` | `orphan-removal` | `audit-reconstruction` |
`lock-recovery` | `disposition`), `observedEvidence` (observation ids),
`reason`, `requiredCapability` (`recovery` | `control-plane` — a future
capability name, not a live object), `requiredOperation`,
`verifyImmediatelyBeforeMutation` (true for every mutating action: fail
closed), and `safety` (`safe` | `unsafe` | `requires-external-disposition`).
Mapping (documented): WPR-023 (a) removal and (b)/(c) quarantine → safe;
missing-audit reconstruction → safe (16.3 append-only idempotent);
tamper-class/foreign/contested/dangling-audit/foreign-lock → requires
external disposition; persistent lock → unsafe (staleness undetermined;
LOK-007/008/009). Actions are sorted by (safety, category, target,
evidence). The plan performs and authorizes nothing.

## 9. Filesystem Ownership

- `readdirSync` owners in the storage tree: `read/enumerate.ts`
  (class enumeration), `initialization/provision.ts` (fixed entry-set
  verification), and `recovery/scan.ts` (the WP-8-E store scan) — enforced
  by the static guard.
- The scan module's `node:fs` allowlist is **read-only** (`readdirSync`,
  `openSync`, `closeSync`, `fstatSync`, `readFileSync`, `constants`) and is
  asserted to contain no mutating API.
- All other new modules (classify, derive, compose, assess, plan, barrels)
  are fs-free and asserted fs-free by the static guard.

## 10. Security-Guard Changes

- `tests/unit/storage/static-guard.test.ts`:
  - `FS_ALLOWLIST` gains the exact scan module with its read-only subset.
  - `CREATOR_EDGES.createReadCapability` gains exactly the two new
    composition modules (no blanket delegation anywhere; no `storage/**` or
    `registry/**`/`recovery/**` blanket allowance exists).
  - `readdirSync` owner list updated; a new registry/recovery boundary test
    asserts fs-free modules stay fs-free, the scan allowlist is
    mutation-free, and no recovery-mutation operation marker exists
    anywhere in `src/storage`.
  - The directory-existence test now requires `registry/` and `recovery/`
    and still forbids `retention/`.
- `tests/security/security.test.ts`: the exact compiled-module delegation
  set gains `storage/recovery/scan.js`; every other compiled storage module
  (including all pure registry/recovery modules) remains subject to the
  global blanket no-I/O assertion.
- Rejected surface (unchanged and enforced): mutating fs APIs in the
  read-only slice, subprocesses, network APIs, dynamic/default/namespace
  filesystem imports, WP-7 imports, public creator or recovery-operation
  exports, package-root exports.

## 11. Tests and Actual Counts

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc -p tsconfig.json --noEmit` | pass |
| Build | `npm run build` | pass (51 schemas, 358 corpus inputs) |
| Test TS compilation | `npx tsc -p tsconfig.tests.json` | pass |
| Focused registry/recovery | `node --test dist-test/tests/unit/storage/registry.test.js dist-test/tests/unit/storage/recovery.test.js` | **41 tests, 41 pass, 0 fail** (31 prior + 10 continuation/snapshot tests: F1-B first-page no-progress, F1-B resumed-page no-progress, F1-B audit-as-first-unread, F1-S foreign-shard paging, F3-G class deletion, records-parent deletion, audit-parent deletion, audit-event deletion, absent-stable/added, replacement) |
| Complete storage suite | `node --test "dist-test/tests/unit/storage/*.test.js"` | **244 tests, 242 pass, 2 skipped** (pre-existing privilege-gated chown tests, documented in the suite), 0 fail |
| Static guard | `node --test dist-test/tests/unit/storage/static-guard.test.js` | **21 tests, 21 pass, 0 fail** |
| Global security | `node --test dist-test/tests/security/security.test.js` | **15 tests, 15 pass, 0 fail** |
| Default workflow | `npm test` (unit/integration/security/pi-adapter/trusted/pointofuse + discovery guard) | **1358/1358 pass, 0 fail** |
| WP-7 regression | `node scripts/run-wp7-tests.mjs` (validated runner) | **reader 62, git 38, fff 26, security 39 = 165/165 pass** |
| `git diff --check` | — | clean |

Continuation/snapshot correction coverage (F1-B, F1-S, F3-G): first-page
byte no-progress emits zero observations and no cursor (detectable
truncated-without-continuation state; the unread candidate remains
reachable via a larger-bound restart WITHOUT the cursor); resumed-page
byte no-progress keeps the continuation at the last successfully processed
resumable candidate strictly before the unread candidate; an audit
candidate as the first unread candidate of a page behaves identically;
foreign shard names are non-resumable, budget-free, reported exactly once,
never become cursors, and never block valid candidates (paging terminates
and the union equals the one-shot scan); cross-page class deletion,
records-parent deletion, audit-parent deletion, audit-event deletion,
class addition, and class-directory replacement all fail closed with
`ERR-STO-ROOT-IDENTITY-CHANGED` and zero accepted partial observations;
absent-on-both-pages remains stable.

Correction coverage (F1–F4): six-record store with `entryLimit=4` pages to
termination with strictly advancing cursors and a paging union identical
to the one-shot scan (no duplicate observation ids, no missing entries);
host directory order independence of page results; same-store same-bounds
cursor acceptance; cross-store, changed entry limit, changed byte limit,
changed mode, and missing/malformed-generation cursor rejection with zero
partial observations; distinct registry/recovery generation tokens;
missing expected record class, unknown class directory, stray file and
symlink under `records/`, missing `audit-event`, unknown directory and
stray file under `audit/`, with deterministic finding order; hook-based
disappearance of a record class directory, the audit class directory,
`tmp/`, and `locks/` all failing closed with
`ERR-STO-ROOT-IDENTITY-CHANGED`.

Test coverage per the task list: deterministic scan order and view
reproducibility; exact and +1 entry limits; exact and +1 byte limits;
continuation resumption without re-reporting; malformed records;
unsupported version; wrong digest; wrong location; symlinks and special
files (socket fixture; synthetic wrong-type facts); wrong UID (synthetic
facts — chown needs privileges) and wrong mode (end-to-end); concurrent
directory drift; duplicate identity; conflicting revisions; revision
ordering and latest resolvable revision with chain break; missing audit;
dangling audit; orphan temporaries (WPR-023 a–d); persistent/foreign/
malformed lock observations with nonce non-disclosure; recovery-plan
determinism and advisory-only structure; recovery fail-closed on limit
overrun; no mutation during scan or recovery scan; no raw path disclosure;
no authority production; static-guard enforcement.

## 12. Correction Summary and Deferred Non-Blocking Notes

- **F1 (forward progress)** — corrected: cursor-seeking work never consumes
  the resumed page's entry budget (skip before count at class, shard, and
  entry levels; the cursor shard's own name is not re-counted). Empirical
  paging result: a six-record store (24 scanned entries) with
  `entryLimit=4` terminates in 6 pages; every cursor strictly advances;
  the observation union equals the one-shot scan; no duplicates or gaps.
- **F1-B (never advance past an unread candidate)** — corrected: the scan
  separates the last observed item, the last processed candidate, the last
  resumable cursor position, and the current unread candidate. When
  candidate X passes its individual size bound but cannot fit within the
  remaining aggregate page budget, X is not processed, no observation for
  X is emitted, no cursor position sorts at or after X, and no candidate
  after X is processed on that page. With at least one processed resumable
  candidate the continuation points at the last successfully processed
  candidate (strictly before X); with zero processed candidates NO
  continuation is emitted — `truncated` without a continuation is the
  detectable no-progress state. Empirical byte-bound cases: (A) first
  page, first record exceeds the aggregate budget → zero observations, no
  cursor, repeat does not claim progress, larger-bound restart observes X;
  (B) resumed page, first record exceeds → continuation stays at the last
  previously processed position, X observable after a larger-bound
  restart, paging union never silently excludes X; (C) audit candidate as
  the first unread candidate → identical no-skip behavior, audit observed
  after restart; (D) candidate after earlier observations on the same page
  → cursor points at the final successfully processed candidate before X.
  Restart behavior: increasing the byte limit requires restarting WITHOUT
  the old cursor — the request generation binds byte limits, so a raised
  limit invalidates the old cursor with `ERR-STO-REQ-INVALID`. The earlier
  claim that the caller can raise the bound and continue with the returned
  cursor is removed.
- **F1-S (self-validating cursors)** — corrected: foreign shard names are
  non-resumable structural anomalies — budget-free, reported at their
  first encounter in deterministic scan order (each exactly once), never
  resumable cursor positions, never blocking later valid candidates. Every
  emitted continuation is validated against the scanner's own cursor
  validator before return (an invalid emission is
  `ERR-STO-INTERNAL-INVARIANT`). Empirical result: a foreign shard name
  ordered before valid shards with `entryLimit=2` pages to termination in
  4 pages; every returned cursor validates; the next page succeeds; no
  duplicate foreign observation; no missing valid observations; the paging
  union equals the one-shot scan.
- **F2 (generation-bound cursor)** — corrected: `ScanCursor` carries a
  deterministic generation digest binding store identity (both namespace
  dev/ino), effective entry and byte limits, scan mode, fail-closed
  behavior, and the class-order model version (`SCAN_MODEL_VERSION`);
  `computeScanGeneration` takes these as explicit inputs so registry and
  recovery scans with identical numeric limits produce different tokens.
  Rejection matrix (all `ERR-STO-REQ-INVALID`, all before candidate
  content, all with zero partial observations): malformed cursor; missing
  generation; non-digest generation; cross-store replay; changed entry
  limit; changed byte limit; changed mode; any previous incompatible
  generation (all previous-generation factors fold into the digest). The
  cursor exposes no raw store identity.
- **F3 (parent-level completeness)** — corrected: `records/` and `audit/`
  are enumerated deterministically with the exact expected class-directory
  sets (15 record classes plus `audit-event`; `store-metadata` excluded —
  it is persisted at `metadata/metadata.json`); unknown directories, stray
  files, symlinks, and special objects are foreign observations with
  best-effort descriptor facts; missing required class directories are
  `ERR-STO-INTEGRITY` findings naming the absent class. Parent entries are
  never promoted to verified records. Parent structure is budget-free and
  reported by the first page only, keeping the paging union complete.
- **F3-G (cross-page surface binding)** — corrected: the cursor carries a
  `surfaceGeneration` digest binding the structural snapshot observed on
  the first page — `records/` and `audit/` parent presence and identity,
  the expected record-class presence set, `audit-event` presence, and the
  identities of every present class directory (no raw device/inode value
  exposed). Resumed pages re-read the parent/class structure before
  candidate content and compare it with the cursor-bound snapshot. Results:
  record class present on page one and deleted before page two → drift;
  `records/` parent deleted → drift; `audit/` parent deleted → drift;
  `audit-event` deleted → drift; class absent on both pages → stable (not
  drift); class added between pages → drift; present class replaced by
  another directory identity → drift. All drift failures return
  `ERR-STO-ROOT-IDENTITY-CHANGED` with zero accepted partial observations —
  never a successful or truncated result, never a silently filtered class,
  never an ordinary missing-class finding as a substitute.
- **F4 (disappearance is drift)** — corrected: `readdirVerified` tracks
  whether the directory was successfully opened and verified; any
  subsequent `ENOENT` (post-open or during `readdir`) fails closed with
  `ERR-STO-ROOT-IDENTITY-CHANGED`. Only a first-attempt `ENOENT` is an
  absent surface (retained only where the contract allows: phase-2 stores
  lack `records/`, `audit/`, `locks/`). Class directories, the audit
  directory, `tmp/`, `locks/`, and shard directories follow the same drift
  rule; listed-but-absent-at-open also fails closed.
- **F6 (fresh-process precondition)** — documented in §3: the composition
  boundaries use `createReadCapability`; the accepted WP-8-D generation
  model is a per-process registry with `allowCreate=false` for
  non-mutating creators; a fresh read-only process cannot issue the
  capability until the generation registry is seeded by an accepted
  initialization/mutation/control-plane path; current behavior is
  `ERR-STO-REQ-INVALID`; this is an inherited accepted limitation, not
  solved by WP-8-E; WP-9 or a later integration phase must seed or revise
  the model before standalone fresh-process read service operation.
  Genuine trusted input alone is not sufficient.

**Deferred non-blocking review notes (not corrected by this revision):**

- **F5** — coarse directory-level error mapping: a class/shard directory
  with a wrong type or mode aborts the scan with a single mapped finding
  rather than per-entry reports. Deferred; the narrow fail-closed behavior
  is unchanged.
- **F7** — temporary-file link-count note: `tmp/` entries with unexpected
  link counts are not explicitly classified by link count (WPR-023 (a)
  detection uses content-verified inode twins). Deferred; observation-only.
- **F8** — contested-record code presentation: a contested derived-location
  record is upgraded with `ERR-STO-DUPLICATE` even when the conflict kind
  is `conflict-revision`. Deferred; the finding codes already carry the
  conflict kind.
- **F9** — duplicate quarantine/disposition plan actions: objects in both
  the quarantine-eligible and disposition-required assessment buckets can
  produce disposition-led plan actions while remaining listed in the
  quarantine bucket. Deferred; plan data is advisory only.

## 13. Remaining Phase-4 Work

Not implemented in this read-only slice (each is a mutation or a separate
later phase): quarantine execution; record deletion; stale-lock breaking;
recovery write execution (orphan removal, audit-reconstruction events,
recovery evidence); index rebuild and stale-index detection; audit-pipeline
completion (idempotent-duplicate/conflict event kinds; full AUD-001);
bounded audit-history inspection beyond association; configuration-
namespace scanning; cross-class chain semantics (WP-2); retention; legal
holds; migration; configuration snapshot publication; lifecycle approval
decisions; WP-12 integration; WP-9.

## 14. Git State

All changes are **unstaged and uncommitted** (`git status` shows the
modified and untracked paths of §2 only). Nothing was pushed, tagged,
released, published, installed, or deployed. The next gate is the WP-8-E
implementation acceptance review.
