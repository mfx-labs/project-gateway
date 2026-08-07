# WP-8-F — Authorized Recovery Mutation Foundation — Implementation Report

**Status:** WP-8-F — the smallest safe mutation slice following the
committed WP-8-E read-only registry and recovery scanner — is implemented
under the authorized scope: **authority-gated recovery mutation
composition, immediate evidence re-verification, safe WPR-023 (a)
orphan-temporary cleanup, the authorized `quarantine-temporary`
operation (ADR-030; contract §16.5, QRN-001…006), and durable recovery
evidence**, with crash-safe, idempotent behavior. The human contract
decision defined the initial quarantine operation (`quarantine-temporary`,
WPR-023 (b)/(c) regular temporaries); the contract gained the normative
§16.5 quarantine section and QRN requirements, and ADR-030 records the
four decision points. All changes are left unstaged and uncommitted;
nothing was pushed, tagged, released, published, installed, or deployed.
**Implementation acceptance is not yet granted.**

**Verdict:** `WP-8F RECOVERY MUTATION FOUNDATION: READY FOR REVIEW`

---

## 1. Baseline and Changed-Path Inventory

| Item | Value |
|---|---|
| Baseline HEAD | `f3677e61c3ce048f9dde7ac7dc6de5ad8f2c9f8e` (`feat: add WP-8-E registry recovery read slice`) |
| Branch | `main`; working tree at start clean |
| Contract | `docs/specs/wp-8-local-storage-registry-contract.md` — **modified** by this slice (§5.2 annotation, new §16.5, QRN-001…006); SHA-256 updated to `93504ea29b5ed0abb0b9fcf4685029939ab1b652049325a8160023ba10c0cd3a` in the static guard |
| Dependencies | `ajv@8.20.0` only (unchanged) |
| Public exports | unchanged; `src/index.ts` and package exports unchanged |

**Report correction (§12 of the prior revision):** before the quarantine
extension the initial foundation inventory was **Modified: 14, New: 6,
total 20 paths** (the earlier §1 table understated the modified count; the
14 modified paths are: `docs/design/post-wp5a-planning-status.md`,
`docs/design/post-wp5a-roadmap.md`, `src/storage/capabilities/authenticity.ts`,
`src/storage/locks/lock.ts`, `src/storage/publication/publish-record.ts`,
`src/storage/recovery/compose.ts`, `src/storage/recovery/index.ts`,
`src/storage/recovery/scan.ts`, `src/storage/registry/compose.ts`,
`src/storage/trusted-input/bootstrap-input.ts`, `src/storage/types.ts`,
`tests/unit/storage/recovery.test.ts`,
`tests/unit/storage/static-guard.test.ts`, `tests/security/security.test.ts`;
the 6 new paths: `src/storage/recovery/cleanup.ts`,
`src/storage/recovery/evidence.ts`, `src/storage/recovery/execute.ts`,
`src/storage/recovery/reverify.ts`,
`tests/unit/storage/recovery-mutation.test.ts`,
`docs/reports/wp-8f-recovery-mutation-foundation-implementation-report.md`).

**Final changed-path inventory (after the quarantine extension): 16
modified + 9 new = 25 paths.**

Modified (16): the 14 above plus `docs/specs/wp-8-local-storage-registry-contract.md`
(§16.5/QRN) and `src/storage/recovery/assess.ts` (quarantine observation
buckets).

New (9): the 6 above plus `src/storage/recovery/quarantine.ts` (the
quarantine fs mutation owner), `tests/unit/storage/quarantine.test.ts`,
and `docs/decisions/ADR-030-wp-8f-quarantine-temporary-operation.md`.

**Modified (10):**

- `src/storage/types.ts` — WP-8-F types (mutation request/action/result,
  crash-stage vocabulary, hooks); `ScanFacts`/`StoreScanResult` gain the
  deterministic `surfaceGeneration` token (WP-8-E extension, additive).
- `src/storage/trusted-input/bootstrap-input.ts` — two new private
  authenticity domains: `StorageRecoveryActionProvenance` and
  `TrustedRecoveryRequest` (branded, process-local, cross-kind
  substitution fails).
- `src/storage/capabilities/authenticity.ts` — the private
  `RecoveryCapability` domain (contract 21.1; operation set
  `['orphan-removal']`, least authority) and `createRecoveryCapability`.
- `src/storage/locks/lock.ts` — `acquireWriterLock`/`releaseWriterLock`
  accept the write capability OR the recovery capability (same
  single-writer lock; brand-checked before any filesystem access).
- `src/storage/publication/publish-record.ts` — the immutable-publication
  substrate and class/shard provisioning accept a `PublicationAuthority`
  view plus the caller's closed operation (default `record-publish`;
  behavior for the write path unchanged).
- `src/storage/recovery/scan.ts` — WP-8-E extensions: `surfaceGeneration`
  on scan results; exported `isPublicationTemporaryName`,
  `temporaryObservationId`, `recomputeSurfaceGeneration`; the WPR-023 (a)
  temporary observation now carries the twin's envelope facts (bounded
  read); the surface-generation token excludes the `store-evidence-record`
  class (evidence directories legitimately appear as a result of recovery
  execution itself).
- `src/storage/recovery/compose.ts`, `src/storage/registry/compose.ts` —
  wire `surfaceGeneration` into `ScanFacts`.
- `src/storage/recovery/index.ts` — barrel exports the mutation boundary
  and evidence builders (private; no package-root export).
- `tests/unit/storage/recovery.test.ts` — updated (a)-twin assertion (the
  plan target is now the twin's logical identity).
- `tests/unit/storage/static-guard.test.ts`, `tests/security/security.test.ts`
  — exact allowlists and delegation for the two new fs owners.

**New (3):**

- `src/storage/recovery/execute.ts` — recovery-mutation composition
  boundary (fs-free).
- `src/storage/recovery/reverify.ts` — descriptor-bound current-state
  re-verification (fs-bearing, read-only).
- `src/storage/recovery/cleanup.ts` — exact temporary-name unlink with
  tmp-directory fsync (fs-bearing mutation owner).
- `src/storage/recovery/evidence.ts` — pure evidence construction + narrow
  publication composition via the existing substrate (fs-free by import).
- `tests/unit/storage/recovery-mutation.test.ts` — 15 focused tests.
- `docs/reports/wp-8f-recovery-mutation-foundation-implementation-report.md`
  (this report).

## 2. Authority Model

- **Recovery capability** (contract 21.1, mutation-capable): a new private
  brand domain in `capabilities/authenticity.ts`. Binding: verified store
  instance, configuration identity, service UID, limit profile, the
  genuine recovery action identity, operation set `['orphan-removal']`
  (quarantine/audit-reconstruction/lock-recovery/disposition operations
  join the set only when implemented), and the per-process generation
  token (mutation-capable creators may establish the registry entry,
  matching the write creator).
- **Recovery action provenance**: a new private brand domain in
  `trusted-input/bootstrap-input.ts`. `createRecoveryActionProvenance`
  has **zero production consumers** (future consumer:
  `src/control-plane/storage-recovery-action.ts`, which does not exist);
  test-only producers are confined to test output. `createTrustedRecoveryRequest`
  correlates the genuine WP-6 configuration and the genuine provenance by
  exact equality (identity, locator, UID, forbidden roots, limit profile).
- **Creator edges** (static-guard enforced): `createRecoveryCapability`
  and `createTrustedRecoveryRequest` import only by
  `src/storage/recovery/execute.ts`; the provenance creator has no
  production importer.
- **No authority from data**: a `RecoveryPlan`, assessment, cursor,
  observation, path, filename, environment value, argv, cwd, record
  content, or caller boolean never grants authority; the plan remains
  advisory data and a plan action object cannot be passed to the mutation
  API (rejected at validation; tested).
- **No structural or ambient authority**: capabilities and provenances are
  brand-checked before any method call or filesystem access; spread/JSON
  clones fail every verifier (tested).

## 3. Mutation Request Model

`RecoveryMutationRequest` carries only: genuine trusted configuration,
genuine recovery-action provenance, correlated locator/UID/forbidden
roots/limit profile, a narrow structured `RecoveryMutationAction`, and the
injected bounded time source. The action accepts only closed-vocabulary
identifiers: category (`orphan-removal` executable; `quarantine`
contract-decision-gated), the temporary entry designation (WPR-003
grammar), the expected twin record identity and class, the expected
pre-mutation evidence digest, the expected link count, exactly one
expected observation evidence id (recomputed deterministically and
compared), the expected assessment scan generation, and the expected
surface generation. **No raw path, destination path, descriptor, nonce,
callback, filesystem function, arbitrary operation string, or
capability-like structural object is accepted.** Every filesystem location
is re-derived internally from the verified store configuration and the
closed class/shards vocabulary.

## 4. Supported and Unsupported Mutations

**Supported:** `orphan-removal` — the WPR-023 (a) inode-twin temporary
cleanup with durable recovery evidence.

**Unsupported (deterministic fail-closed rejection at the boundary):**
- `quarantine` — contract decision required (destination layout and
  mutation primitive undefined; see §10).
- stale-lock breaking, lock age/process-liveness inference, primary-record
  deletion, audit-record deletion, contested-identity disposition,
  dangling-audit deletion, foreign-directory removal, broad garbage
  collection, retention, migration, index rebuild — all out of scope and
  not reachable through any API in this slice.

Never removed: canonical primary records, audit records, locks, foreign
directories, sockets/FIFOs/devices, temporaries whose publication
relationship is uncertain (non-twin, malformed, incomplete-unpublished —
all remain untouched and classifiable; disposition required).

## 5. Immediate Re-Verification Model

Before any mutation, in order:

1. genuine trusted configuration + genuine recovery provenance correlation
   (`createTrustedRecoveryRequest`);
2. store metadata/root revalidation (`verifyStoreInstance`) and the
   recovery capability issue + `assertExpected` binding check;
3. assessment-generation recomputation (store identity, recovery mode,
   `recoveryScanEntries`/`totalScanBytes`, fail-closed) — mismatch →
   `ERR-STO-REQ-INVALID`;
4. surface-structure recomputation (F3-G token; the `store-evidence-record`
   class is excluded so recovery's own evidence directories are not
   drift) — mismatch → `ERR-STO-ROOT-IDENTITY-CHANGED`;
5. single-writer lock acquisition (never broken or replaced; the recovery
   capability shares the write lock);
6. descriptor-bound target re-verification (`reverify.ts`): no-follow,
   non-blocking open; exact type/UID/mode; size bounds; canonical parse;
   the temporary's identity and record-bytes digest must equal the
   authorized twin facts; the temporary's record-kind must map to exactly
   one store-records class; the durable publication at the internally
   derived path must be the SAME inode (dev/ino) with the same digest and
   the same link count;
7. immediate pre-unlink inode re-check inside `cleanup.ts`.

A prior view, assessment, plan, or cursor is never sufficient evidence.
Any mismatch fails closed before any mutation, with the lock released
(except on simulated crash, where the held lock is the deterministic
fail-closed state).

## 6. Orphan-Temporary Cleanup Algorithm (WPR-023 (a))

1. Derive the temporary location internally: `<ns>/tmp/<entry>` where the
   entry passes the closed WPR-003 grammar.
2. Re-verify the twin immediately before unlink (§5.6): same inode,
   same digest, exact link count.
3. Pre-unlink descriptor identity re-check (the name must still resolve
   to the verified inode).
4. Unlink ONLY the temporary name (`unlinkSync`, the contract's unlink
   primitive; no rename, no byte copy).
5. Verify the durable publication remains on the same inode with the link
   count reduced by exactly one.
6. `tmp/` directory fsync (durable removal of the name).
7. Postcondition: temporary name absent.
8. Durable recovery evidence publication (§7).
9. Capability/root revalidation and identity-bound lock release.

Interrupted-removal roll-forward: when the temporary name is already gone
but the twin is intact and unchanged, the evidence half is completed
(provable roll-forward of the removal fact); when the evidence is already
durable with a matching factual binding, the result is deterministic
`already-completed` — never a re-unlink, never a second evidence record.

## 7. Evidence Durability

Every successful removal produces a `StoreEvidenceRecord` with the closed
`evidenceKind` `recovery-evidence` (6.3), published through the existing
immutable hard-link publication substrate under the recovery capability,
followed by its mechanical `authorized-write` audit event at the same
durability point (WPR-010/AUD-003; the 6.3 audit linkage). The envelope
binds: the recovery action identity (`trustedActionId`), the recovery
time (deterministic UTC ISO formatter from the injected epoch; never the
original operation time), the referenced twin digest, and the bounded
payload (evidence kind, operation, target entry, twin identity/class/
digest, observation evidence id, outcome, generation, surface generation,
resulting state). The deterministic evidence identity is a domain digest
over (store/namespace identity, evidence kind, operation, target entry,
twin identity/class, pre-mutation evidence digest, outcome) — no clock,
nonce, action identity, or path enters it. Success is reported only after
the evidence and its audit event are durable; EEXIST replay classifies
the existing final target byte-exact or rejects; a leftover evidence
temporary is never adopted or unlinked (the recovery scanner classifies it
deterministically, matching the write path's MINOR-2 model). Crash
mutation-without-evidence states are classifiable (temporary absent, twin
intact, no evidence) and roll forward; evidence-without-mutation states
return deterministic `already-completed`.

## 8. Crash Model

Fixed 10-stage inventory (asserted in tests): `before-lock-acquisition`,
`after-lock-acquisition`, `after-target-verification`,
`before-source-unlink`, `after-source-unlink`, `before-directory-fsync`,
`after-directory-fsync`, `before-evidence-publication`,
`after-evidence-publication`, `before-lock-release`. A stage hook throwing
simulates the process crash (the same harness pattern as the accepted
`PublicationHooks`). After every injected crash: no overwrite, no
corrupted canonical record, no unauthorized deletion, no ambiguous
successful state; the WP-8-E recovery scanner classifies the resulting
state deterministically; the rerun either completes safely or returns the
deterministic fail-closed `ERR-STO-LOCK-UNAVAILABLE` when the crashed
process's writer lock is still held (stale-lock breaking is out of scope;
tests release the crash lock as a fixture step to continue stage
coverage).

## 9. Idempotency and Conflicts

- Already removed twin + matching durable evidence → deterministic
  `already-completed` (same evidence identity, no second record).
- Already removed twin + no evidence → evidence half completed
  (roll-forward).
- Evidence final exists with identical bytes → `already-completed`.
- Existing evidence with the same identity but conflicting factual
  binding → fail closed (`ERR-STO-INTEGRITY`, "conflict").
- Source changed (digest/inode/mode/link count), source replaced with a
  symlink or another file, source disappeared while the twin changed,
  twin changed or disappeared, surface generation changed, store
  generation changed, observation evidence mismatch → fail closed.
- No repair-by-guessing, no overwrite, no rollback.

## 10. Quarantine-Temporary Operation (ADR-030; contract §16.5)

The human contract decision defined the initial quarantine operation
`quarantine-temporary`; the contract now carries the normative §16.5
section and QRN-001…006, and ADR-030 records the four decision points
(deterministic destination, hard-link plus unlink, WPR-023 (b)/(c)
scope, rejected alternatives).

- **Operation and authority**: `quarantine-temporary` joined
  `RECOVERY_OPERATION_SET` (`['orphan-removal', 'quarantine-temporary']`);
  no generic `quarantine` operation exists; every boundary verifies its
  exact operation (an orphan-only capability can never quarantine).
- **Eligibility (closed)**: WPR-023 (b)/(c) regular temporaries only —
  exact UID/mode, `nlink === 1`, size within `temporaryBytes`, exact
  content digest, exact observation evidence, exact classification;
  (a) twins, (d), primaries, audits, locks, directories, symlinks,
  sockets, FIFOs, devices, wrong-UID/mode, and contested objects fail
  closed untouched.
- **Destination**: `<ns>/quarantine/temporary/<shard>/<quarantineId>.qtn`
  with `quarantineId` a domain-separated SHA-256 digest over (store
  identity, namespace identity, source entry, WPR-023 classification,
  source content digest, pre-mutation evidence digest). No raw path,
  descriptor, dev/ino, clock, nonce, capability, or action identity in
  the digest or returned data.
- **Provisioning**: `quarantine/`, `quarantine/temporary/`,
  `quarantine/temporary/<shard>/` provisioned lazily under the writer
  lock with exact no-follow UID/mode verification; created parents
  fsynced; symlink/special/wrong-UID/wrong-mode/replacement fails closed.
- **Primitive**: same-filesystem hard-link plus unlink with the full
  22-step ordering of §16.5 (link no-replace → same-inode and 1→2 link
  verification → destination shard fsync → source re-verification →
  source unlink → 2→1 verification → tmp fsync → source-absent and
  destination-exact verification → evidence → audit → revalidation →
  lock release). No rename, no byte copy, no overwrite, no chmod/chown
  repair, no rollback.
- **Idempotency states**: normal execution; interrupted-link
  continuation (same inode); destination-only roll-forward (evidence
  published); matching evidence → `already-completed`; conflicting
  destination or evidence → fail closed untouched; both absent → fail
  closed; matching evidence with missing destination → fail closed;
  matching evidence with source still present outside the interrupted
  state → fail closed.
- **Evidence**: `StoreEvidenceRecord` (`recovery-evidence`,
  `quarantine-temporary`) binding store/namespace identity, the recovery
  action identity, source entry/classification/digest, the pre-mutation
  evidence digest, quarantine ID, destination logical designation,
  resulting state, generation, surface generation, and outcome
  (`quarantined` | `already-completed`); deterministic identity derivable
  by the recovery scanner from the `.qtn` object; success only after
  destination, source-removal, evidence, and audit durability.
- **Scanner integration**: recovery mode scans `quarantine/` (parent,
  temporary class, 4-hex shards, `.qtn` objects) and classifies
  quarantined-valid / missing-evidence / interrupted-link / conflict /
  malformed filename / foreign entry / wrong type / wrong UID-mode /
  unexpected link count / unknown class-shard; dangling evidence is
  derived from the scanned evidence payload facts; the recovery-mode
  surface generation binds the quarantine structure (registry mode
  excludes it); quarantine objects never become registry records.
- **Crash model**: fixed 15-stage quarantine inventory asserted in tests
  (before/after lock, after source verification, after quarantine
  provisioning, before/after destination link, before/after destination
  fsync, before/after source unlink, before/after tmp fsync,
  before/after evidence, before lock release); every stage leaves a
  scanner-classifiable state and a safe rerun (continue, roll forward,
  already-completed, or fail closed); held crash locks remain fail
  closed (stale-lock breaking out of scope).

## 11. Static-Guard and Security-Boundary Changes

- `FS_ALLOWLIST` gains exactly three owners: `recovery/reverify.ts`
  (`openSync`, `closeSync`, `fstatSync`, `readFileSync`, `constants` —
  read-only), `recovery/cleanup.ts` (`openSync`, `closeSync`,
  `fstatSync`, `fsyncSync`, `unlinkSync`, `constants`), and
  `recovery/quarantine.ts` (`mkdirSync`, `openSync`, `closeSync`,
  `fstatSync`, `fsyncSync`, `linkSync`, `unlinkSync`, `constants` —
  exact quarantine provisioning and the hard-link plus unlink
  primitive; no rename, copy, chmod/chown, or recursive removal).
- `CREATOR_EDGES` gains `createRecoveryCapability` and
  `createTrustedRecoveryRequest` → `recovery/execute.ts` only;
  `createRecoveryActionProvenance` → zero production consumers.
- The recovery-mutation operation markers are denied everywhere except
  the exact owners (`execute.ts`, `cleanup.ts`, and the private barrel
  re-export); `execute.ts` accepts no `RecoveryPlanAction` and performs no
  direct filesystem work; recovery authority creators are denied outside
  the brand modules and `execute.ts`.
- The global security delegation set gains exactly
  `storage/recovery/reverify.js` and `storage/recovery/cleanup.js`; all
  other compiled storage modules (including the pure execute/evidence
  modules) remain under the blanket no-I/O assertion; no blanket
  `recovery/**` or `storage/**` delegation.
- No mutation API beyond the exact owners; no chmod/chown repair, no
  recursive removal, no arbitrary rename/copy, no subprocess, no network,
  no dynamic/default/namespace fs imports, no caller-provided fs
  functions, no public/package export.

## 12. Tests and Exact Counts

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc -p tsconfig.json --noEmit` | pass |
| Build | `npm run build` | pass (51 schemas, 358 corpus inputs) |
| Test TS compilation | `npx tsc -p tsconfig.tests.json` | pass |
| Focused recovery-mutation | `node --test dist-test/tests/unit/storage/recovery-mutation.test.js` | **15 tests, 15 pass, 0 fail** |
| Focused quarantine | `node --test dist-test/tests/unit/storage/quarantine.test.js` | **11 tests, 11 pass, 0 fail** |
| Complete storage suite | `node --test "dist-test/tests/unit/storage/*.test.js"` | **270 tests, 268 pass, 2 skipped** (pre-existing privilege-gated chown tests), 0 fail |
| Static guard | `node --test dist-test/tests/unit/storage/static-guard.test.js` | **21 tests, 21 pass, 0 fail** |
| Global security | `node --test dist-test/tests/security/security.test.js` | **15 tests, 15 pass, 0 fail** |
| Default workflow | `npm test` | **1358/1358 pass, 0 fail** |
| WP-7 regression | `node scripts/run-wp7-tests.mjs` | **165/165 pass** |
| `git diff --check` | — | clean |

Focused coverage: genuine authority accepted; forged and structural-clone
provenance rejected; wrong store rejected; advisory plan grants nothing
(plan action and plan-as-request rejected; path and malformed operands
rejected); quarantine category rejected contract-decision-gated; changed
content/inode/mode/link-count rejected; symlink and wrong-inode source
rejected; surface and generation drift rejected; wrong observation
evidence rejected; verified twin safely unlinked with the durable
publication intact; non-twin and uncertain temporaries never removed;
repeated execution deterministic already-completed; already-removed
roll-forward; twin changed/disappeared on the already-removed path
rejected; fixed 10-stage crash inventory asserted and exercised with
classifiable states and safe reruns; evidence identity deterministic and
binding; evidence + audit durably published and scanner-verified;
conflicting evidence rejected.

## 13. Remaining Phase-4 Build Work

WPR-023 (d) and other external-disposition paths; quarantine-evidence
reconstruction and quarantine-object disposition for malformed/foreign/
conflicting quarantine states; stale-lock breaking with lock-recovery
evidence; audit-reconstruction events (16.3); index rebuild and
stale-index detection; full audit-history inspection;
configuration-namespace recovery; retention; legal holds; migration;
lifecycle approval decisions; WP-12 integration; WP-9 generation seeding.

## 14. Git State

All changes are unstaged and uncommitted (`git status` shows the modified
and untracked paths of §1 only). Nothing was pushed, tagged, released,
published, installed, or deployed. The next gate is the WP-8-F
implementation review.

## 13. Correction: Sink-Level Recovery Publication Authority Confinement

### 13.1 Review finding

The WP-8-F implementation review found one CRITICAL defect in the
immutable-publication substrate sharing introduced by this slice: the
generic APIs `publishImmutableRecord` and `ensureClassShardDirectories`
accepted a structural `PublicationAuthority` view plus a caller-supplied
operation string, and a genuine `RecoveryCapability` verifies the recovery
operations (`orphan-removal`, `quarantine-temporary`). A minted recovery
capability could therefore be passed directly to the generic sink with a
recovery operation, a caller-selected record class (`approval-record`),
and a caller-selected derived destination, publishing an arbitrary primary
record and provisioning arbitrary class directories — a confused-deputy
surface at the publication sink.

Minting control alone (zero production recovery-provenance producers,
non-exported creators, static-guard creator edges) confines *who can mint*
a capability; it does not confine *what an existing authority object can
do at a shared sink*. Authority must be confined at the sink itself.

### 13.2 Correction design: exact-record recovery publication permit

The structural `PublicationAuthority` abstraction is removed. The generic
substrate accepts WRITE authority only, enforced at runtime by
`isGenuineWriteCapability` before any filesystem access (a recovery
capability, forged object, or lookalike is rejected with
`ERR-STO-REQ-INVALID` before `mkdir`, `link`, or record publication).
Recovery publication no longer uses the generic sink at all.

A private branded `RecoveryPublicationPermit` (module
`src/storage/capabilities/authenticity.ts`, module-private `WeakSet`
domain, process-local, structurally unforgeable) binds exactly ONE record
publication:

- the genuine `RecoveryCapability` (store and namespace identity through
  its verified store instance — no raw paths, descriptors, or device/inode
  data in the permit);
- the exact recovery operation (`orphan-removal` | `quarantine-temporary`);
- the publication role (`recovery-evidence` | `recovery-authorized-write-audit`);
- the exact closed record class (`store-evidence-record` for evidence,
  `authoritative-audit-event` for the audit);
- the exact record identity, record digest, and canonical-byte digest;
- the exact internally derived destination designation;
- for the audit role: the exact evidence record identity and digest, the
  `authorized-write` event kind, and the exact trusted recovery action
  identity.

The permit contains no caller-selected class, destination path, shard,
descriptor, callback, or arbitrary operation string. The creator
`createRecoveryPublicationPermit` is imported in production only by
`src/storage/recovery/evidence.ts`; the brand verifier
`isGenuineRecoveryPublicationPermit` and liveness check
`recoveryPublicationPermitLive` only by
`src/storage/publication/publish-record.ts` (static-guard enforced); no
barrel or the package root exports any of them. Spread copies, JSON
clones, lookalikes, and cross-kind branded objects fail verification.

### 13.3 Dedicated recovery publication entry point

`publishRecoveryBoundRecord` (in the existing publication implementation,
never re-exported through the generic publication barrel) consumes only
the permit plus the canonical bytes. It verifies the genuine permit and
its live state before any filesystem access, parses and verifies the
canonical record bytes (record kind, identity, canonical-byte digest)
against the permit, derives the destination internally and verifies it
against the permit binding, provisions only the exact bound class/shard
(module-private provisioning; no caller class), and publishes with the
existing immutable hard-link no-replace algorithm (same durability
points, `EEXIST` byte-exact idempotency classification, and per-operation
deterministic temporary ordinals 2/3 and 4/5 as before). A permit for one
exact record can never publish another record, even within the same
class.

`src/storage/recovery/evidence.ts` constructs the canonical
`StoreEvidenceRecord` first; only after its bytes, identity, and digest
are complete does it mint the exact evidence permit and publish. Only
after the evidence is durable does it construct the mechanically
corresponding `authorized-write` audit event and publish it under a
separate exact audit permit. Neither a recovery capability nor an
evidence permit alone can publish an arbitrary audit event, and neither
permit can be used for the other role.

### 13.4 Exploit-probe results (genuine branded test authority)

- Generic publication misuse (recovery capability → arbitrary primary
  record, `approval-record`, caller-selected final path, `record-publish`,
  `orphan-removal`, `quarantine-temporary`): all fail with
  `ERR-STO-REQ-INVALID` before mutation; no class directory, temporary,
  or final record is created.
- Generic provisioning misuse (recovery authority → `approval-record`,
  other primary classes, arbitrary class strings): all fail before
  `mkdir`; no directory is created.
- Permit substitution (forged, spread clone, JSON clone, evidence permit
  for audit bytes, audit permit for evidence bytes, modified bytes,
  different digest, different identity, different operation payload,
  wrong referenced evidence, wrong action identity, arbitrary audit
  record): all fail before mutation.
- Authorized path: the exact evidence record publishes under its evidence
  permit; the exact corresponding `authorized-write` audit publishes under
  its audit permit; identical retry is byte-exact idempotent
  (`idempotent-duplicate`); conflicting retry fails closed.
- The original exploit shape (recovery capability, operation
  `orphan-removal`, selected class `approval-record`, selected final
  destination) is rejected at the sink before `mkdir`/`link` with no side
  effects.

### 13.5 Quarantine provisioning parent-fsync correction

`ensureQuarantineDirectories` now fsyncs the directory containing each
newly created entry (the parent), closing the narrow power-loss window
where the `quarantine/` entry in the namespace root could be lost after
the source unlink was already durable: after creating `quarantine/` the
verified namespace root is fsynced; after creating `quarantine/temporary/`
the `quarantine/` directory is fsynced; after creating the shard
directory `quarantine/temporary/` is fsynced (deterministic creation
order). Existing directories continue to be verified no-follow with exact
UID, mode, and type; no broad fsync or mkdir authority is introduced. A
test asserts the exact parent-fsync sequence via the directory-fsync
hook.

### 13.6 Regression state

No regression: orphan-removal authority and mutation, quarantine-temporary
authority and mutation, eligibility checks, immediate target
re-verification, single-writer locking, collision handling, crash
continuation (fixed 10-stage and 15-stage inventories), evidence identity
determinism, scanner classification, zero public recovery producers, no
stale-lock breaking, no arbitrary deletion, and no rename or byte-copy
fallback all behave as before. The contract hash remains
`93504ea29b5ed0abb0b9fcf4685029939ab1b652049325a8160023ba10c0cd3a`; no
ADR or contract change was introduced by this correction.
