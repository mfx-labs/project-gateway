# WP-8-I — Authorized External Disposition — Implementation Report

**Status:** WP-8-I — the storage-side externally authorized disposition
slice — is complete per the human contract decision (ADR-032; contract
§16.6/DPS-001…007): `dispose-wpr023d-temporary` remains adjudication-only
(no storage mutation ever), `dispose-quarantined-temporary` and
`dispose-conflicting-index` execute the exact unlink-with-evidence
primitive for their eligible subclasses, and every executable disposition
publishes durable `StoreEvidenceRecord` evidence reusing the existing
`recovery-evidence` kind. All changes are left unstaged and uncommitted;
nothing was pushed, tagged, released, published, installed, or deployed.
Implementation acceptance is not yet granted.

**Verdict:** `WP-8I AUTHORIZED EXTERNAL DISPOSITION: READY FOR REVIEW`

---

## 1. Baseline and Changed-Path Inventory

| Item | Value |
|---|---|
| Baseline HEAD | `d3a0f224a4072d48638d6212fc3bb251b07194c7` (`feat: add WP-8-H persistent registry index`) |
| Contract | **amended by this slice** (§16.6 + DPS-001…007, ADR-032); pinned SHA-256 updated to `d369e45ac261d0bdb396c837d7b6ce7efe6f09cf37ff356ef0ca9e651192baa7` in the static guard |
| Dependencies | unchanged (`ajv@8.20.0` only) |
| Public exports | unchanged; `src/index.ts` and package exports unchanged |

Modified (16):

- `docs/specs/wp-8-local-storage-registry-contract.md` — new §16.6
  "Externally authorized disposition (WP-8-I; ADR-032)" with the closed
  disposition vocabulary, the WPR-023 (d) adjudication-only rule, the
  executable quarantine subclasses, the exact conflicting-index artifact
  rule, the unlink-plus-directory-fsync primitive, the evidence rule, the
  idempotency rule, and DPS-001…007.
- `src/storage/types.ts` — `before-unlink`/`after-unlink` crash stages;
  `disposed` outcome; `DispositionStateFinding` + `dispositionStates`
  assessment bucket; `dispositionEvidenceFacts` on record observations;
  `quarantine-object` plan target kind; plan `requiredOperation` union
  gains the three disposition operations.
- `src/storage/capabilities/authenticity.ts` — unchanged vocabulary
  (three disposition operations already present); operation-set comment
  updated for the executable semantics.
- `src/storage/locks/lock.ts` — unchanged vocabulary (operations already
  present).
- `src/storage/publication/publish-record.ts` — per-operation
  publication ordinals 10/11 (quarantine disposition) and 12/13 (index
  disposition).
- `src/storage/recovery/scan.ts` — malformed/foreign quarantine
  observations now carry the bounded descriptor read facts
  (digest/stat) when readable (request-bindable digest, ADR-032 §4);
  `readQuarantineObject`/`readRegistryIndexObject` return descriptor
  facts; `currentIndexObservation` returns digest + descriptor;
  `extractDispositionEvidenceFacts` + observation wiring.
- `src/storage/recovery/evidence.ts` — disposition evidence domains
  (`PGAP-STORAGE-QUARANTINE-DISPOSITION-EVIDENCE-v1`,
  `PGAP-STORAGE-INDEX-DISPOSITION-EVIDENCE-v1`), the generic
  `buildDispositionEvidenceRecord` (existing `recovery-evidence` kind),
  `computeDispositionEvidenceIdentity`, `verifyExistingDispositionEvidence`;
  evidence operation vocabulary gains the two executable disposition
  operations.
- `src/storage/recovery/disposition.ts` — **new fs-bearing mutation
  owner**: the exact unlink-plus-directory-fsync primitive
  (`unlinkVerifiedTarget`, `fsyncContainingDirectory`).
- `src/storage/recovery/execute.ts` — the disposition flow branches into
  the adjudication-only (d) path, the executable quarantine path, and the
  executable index path with the full 22-step sequence (§3), the
  already-completed resolution, and the evidence-state checks.
- `src/storage/recovery/assess.ts` — `dispositionStates` bucket
  (completed / conflicting / dangling disposition evidence).
- `src/storage/recovery/plan.ts` — exact operation naming in advisory
  actions (`dispose-wpr023d-temporary`, `dispose-quarantined-temporary`,
  `dispose-conflicting-index`; quarantine-object target kind).
- `src/storage/recovery/index.ts` — private barrel exports for the
  disposition evidence builders and scanner facts.
- `tests/unit/storage/static-guard.test.ts` — FS allowlist for
  `disposition.ts`; contract-hash update; mutation-owner confinement
  assertions.
- `tests/unit/storage/recovery.test.ts` — plan assertion updated to the
  exact `dispose-wpr023d-temporary` operation naming.
- `tests/security/security.test.ts` — delegation set gains
  `storage/recovery/disposition.js`.
- `src/storage/capabilities/authenticity.ts`, `src/storage/locks/lock.ts`
  — carry the disposition operation vocabulary (from the foundation
  slice; unchanged this round).

New (4):

- `docs/decisions/ADR-032-wp-8i-external-disposition.md` — the human
  contract decision (four rationales only).
- `tests/unit/storage/external-disposition.test.ts` — extended to 19
  focused tests (8 new executable-disposition tests).
- `docs/reports/wp-8i-authorized-external-disposition-implementation-report.md`
  (this report, updated).

## 2. Contract + ADR Changes

- **Contract §16.6 + DPS-001…007** record: WPR-023 (d) adjudication-only;
  quarantine disposition restricted to the three eligible regular-file
  classifications with exact bindings; conflicting-index disposition
  restricted to the exact conflicting derived index artifact; the exact
  unlink-with-evidence primitive; no generic disposition/delete
  authority; evidence reuses `recovery-evidence` (no new kind).
- **ADR-032** records the four rationales: why WPR-023 (d) remains
  preservation/adjudication-only; why isolated quarantine regular files
  may be explicitly unlinked; why conflicting derived index objects may
  be explicitly unlinked; why generic deletion and a new evidence kind
  were rejected.
- Static-guard contract hash updated to the amended contract's SHA-256.

## 3. WPR-023 (d) Adjudication Behavior

`dispose-wpr023d-temporary` is adjudication-only in the MVP: genuine
authority → store/generation/surface revalidation → writer lock →
current-state re-enumeration and classification recomputation → exact
`temporary-other` classification/code/entry-type verification →
deterministic `disposition-required`, lock release. No unlink, no
quarantine transition, no rename/copy/overwrite/chmod/chown, no evidence;
the target is byte-identical; the assessment continues to classify it
`requiresDisposition` (never downgraded to automatically recoverable);
the flow never reaches the unlink owner (static-guard proven). Tested for
regular (wrong-mode), symlink, and directory targets; sockets/FIFOs/
devices classify through the same committed scanner open-failure path.

## 4. Executable Quarantine Subset

`dispose-quarantined-temporary` unlinks ONLY targets whose current
classification is `quarantine-malformed`, `foreign-entry`, or
`quarantine-conflict` AND that are simultaneously regular files with the
exact service UID, exact quarantine-file mode, size within the bound,
`nlink === 1`, descriptor-bound no-follow verified, with the exact
content digest and observation/finding evidence bound to the request.
Malformed/foreign NAMES are disposable only via the scanner-obtained
entry designation rebound by the trusted request; arbitrary caller
strings are never filesystem operands. The adjudication-only states
(wrong-type, wrong-uid-or-mode, unexpected-hard-link, directories,
symlinks, sockets, FIFOs, devices, uncertain identities, valid
quarantines, missing-evidence, interrupted-link) return
`disposition-required` and are never unlinked.

## 5. Conflicting-Index Disposition

`dispose-conflicting-index` unlinks exactly one regular-file
`index-conflicting` artifact at the exact deterministic derived identity
(`index/registry-index/<shard>/<indexId>.idx`): exact UID/mode, bounded
size, `nlink === 1`, exact digest/identity bound to the request, current
classification exactly `index-conflicting`, authoritative store/surface
revalidated (the registry never depends on the index). Stale historical
indexes, current-valid indexes, unrelated malformed/foreign entries,
directories, symlinks, and recursive `index/` deletion are prohibited
(tested). Disposition never triggers a rebuild; the next authorized
`registry-index-rebuild` succeeds afterward (tested).

## 6. Authority Model

The closed vocabulary is unchanged: `dispose-wpr023d-temporary`,
`dispose-quarantined-temporary`, `dispose-conflicting-index`; no generic
`delete-object`/`dispose-any`/`repair-storage`/`recovery-admin`/
`filesystem-cleanup` operation exists (static-guard proven). Every gate
verifies the exact operation; reduced-set authorities fail every verify;
zero production recovery-action-provenance producers unchanged; plan
actions and scanner findings grant nothing.

## 7. Immediate Re-Verification

1. genuine trusted configuration + genuine recovery provenance → 2. exact
operation authority → 3. store/namespace revalidation → 4. request
generation recomputation → 5. surface generation recomputation → 6.
identity-bound writer lock → 7. current-surface single-entry
re-enumeration (committed scanner logic) → 8. descriptor-bound no-follow
type/UID/mode/size/nlink/digest verification → 9. classification
recomputation → 10. exact eligible subclass verification → 11. expected
digest/observation/finding binding → then, for executable targets, the
mutation sequence. A prior assessment, index, cursor, plan, or finding is
never sufficient.

## 8. Unlink/fsync Algorithm

`unlinkVerifiedTarget` (the sole fs-bearing mutation owner,
`recovery/disposition.ts`): no-follow open → descriptor identity
(dev/ino) and link-count recheck against the verified facts → close →
unlink exactly that one name → absence verification → then
`fsyncContainingDirectory`: no-follow directory open, exact UID/mode,
fsync, close. No rename, copy, recursive removal, rmdir, chmod/chown,
metadata repair, unlink of another name, or plan-derived mutation. The
owner's fs allowlist is exactly `openSync, closeSync, fstatSync,
unlinkSync, fsyncSync, constants`; imported in production only by
`execute.ts`; the WPR-023 (d) branch never references it.

## 9. Evidence Model

Every successful executable disposition publishes a deterministic
`StoreEvidenceRecord` with the EXISTING `evidenceKind: recovery-evidence`
(no new kind; TAX-013 unchanged), the exact disposition operation, the
trusted recovery action identity, the recovery time, the target surface/
classification/logical entry designation, the pre-disposition object
digest, the observation/finding evidence id, generation and surface
generation, resulting state, and outcome (`disposed` |
`already-completed`). Identities are per-operation domain-separated
(`PGAP-STORAGE-QUARANTINE-DISPOSITION-EVIDENCE-v1`,
`PGAP-STORAGE-INDEX-DISPOSITION-EVIDENCE-v1`); no clock, nonce, path, or
action identity enters them. Publication reuses the WP-8F exact-record
permit pipeline (`publishRecoveryEvidence` → evidence permit +
`authorized-write` audit permit); generic publication remains
write-authority-only; `dispose-wpr023d-temporary` never emits evidence.

## 10. Idempotency / Conflict States

| State | Result |
|---|---|
| Target present, exact eligible classification, no evidence | unlink + publish evidence → `disposed` |
| Target absent, matching evidence | `already-completed` |
| Target absent, no evidence | fail closed (`ERR-STO-NOT-FOUND`; no inference) |
| Target present, matching evidence | fail closed (evidence-with-live-target integrity inconsistency) |
| Target present, classification changed | fail closed |
| Target present, digest/inode changed | fail closed |
| Conflicting evidence | fail closed |

## 11. Crash Model

The WPR-023 (d) 5-stage adjudication inventory is unchanged. The
executable inventory (12 stages, exercised independently for an eligible
quarantine regular file and the conflicting index artifact):
`before-lock-acquisition`, `after-lock-acquisition`,
`after-target-verification`, `after-classification-recomputation`,
`before-unlink`, `after-unlink`, `before-directory-fsync`,
`after-directory-fsync`, `before-evidence-publication`,
`after-evidence-publication`, `after-evidence-audit-publication`,
`before-lock-release`. After every crash: no canonical primary/audit
record changes; the scanner classifies the state deterministically; the
fresh rerun either completes the disposition (pre-unlink stages), fails
closed (unlink done, evidence not yet published — no inference), or
returns `already-completed` (evidence durable); stale locks are never
automatically broken.

## 12. Scanner / Assessment / Plan Changes

- Assessment gains `dispositionStates`: `completed-disposition`
  (evidence durable + referenced target absent; for the index case a
  present non-conflicting artifact at the identity is the normal
  post-rebuild coexistence), `conflicting-disposition-evidence`
  (evidence + live target, or malformed facts), `dangling-disposition-evidence`
  (incomplete/closed-vocabulary payloads). The "interrupted after unlink"
  state is not derivable from one snapshot's durable facts (target-absent
  without evidence is ambiguous with never-disposed); it is reported by
  the execution as the deterministic fail-closed result and exercised in
  the crash inventory. WPR-023 (d) remains `requiresDisposition`.
- Evidence never grants mutation authority (scan.ts imports no creator;
  static-guard proven).
- Plan actions now name the exact operation: `dispose-wpr023d-temporary`
  (marked adjudication-only in the reason), `dispose-quarantined-temporary`
  (quarantine-object target kind), `dispose-conflicting-index`; the
  generic `disposition` designation remains only for classes without an
  executable operation (locks, foreign objects, tamper-class records,
  dangling audits, duplicates). Plans still grant nothing and contain no
  raw path.

## 13. Security Boundary

One new fs-bearing module (`recovery/disposition.ts`) with the exact
allowlist; exact creator/import edges; no generic deletion marker; no
scanner/finding → capability edge; evidence publication remains
exact-permit-bound; generic publication remains write-authority-only; no
public/package-root export. Static guard proves: only the two executable
operations reach the unlink owner; the WPR-023 (d) branch never does; the
owner contains no prohibited mutation API and never mints permits or
publishes records; the disposition flow uses raw mutation fs APIs nowhere
and reaches the generic substrate nowhere.

**Recorded trust boundary (unlink primitive).** The executable mutation
uses the contract's own §16.6 primitive shape — descriptor-bound
no-follow open, verified-inode/link-count recheck, close, path-based
`unlinkSync` of exactly that one name, absence verification. Between the
descriptor close and the unlink there is a residual check-to-use window
that a concurrent local actor with store write access could exploit by
replacing the name with another object (amplified by inode recycling on
common filesystems, which can make the recheck pass). This is the
contract's explicit threat-model limit — §1.2: "without a separately
protected trust anchor, a local actor with write access to the entire
store can roll back or rewrite it (Section 9, TML)"; TML-002 lists the
same class of store rewrites as out of scope — and the identical
verify-then-path-unlink pattern is used by every accepted mutation
primitive (`cleanup.ts` orphan removal, `quarantine.ts` source unlink,
publication protocol 10.1 step 7, which rechecks nothing). All trusted
mutations are serialized under the single writer lock held by this flow,
so no trusted-operation race exists; Node exposes no unlink-by-fd to
close the window further. Reported as an accepted trust boundary, not as
hostile-host tamper resistance (TML-006).

## 14. Tests and Exact Counts

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc -p tsconfig.json --noEmit` | pass |
| Build | `npm run build` | pass |
| Test TS compilation | `npx tsc -p tsconfig.tests.json` | pass |
| Focused external-disposition | `node --test dist-test/tests/unit/storage/external-disposition.test.js` | **19 tests, 19 pass, 0 fail** |
| Recovery-mutation | `node --test dist-test/tests/unit/storage/recovery-mutation.test.js` | **18 tests, 18 pass, 0 fail** |
| Quarantine | `node --test dist-test/tests/unit/storage/quarantine.test.js` | **12 tests, 12 pass, 0 fail** |
| Audit-reconstruction | `node --test dist-test/tests/unit/storage/audit-reconstruction.test.js` | **14 tests, 14 pass, 0 fail** |
| Registry-index | `node --test dist-test/tests/unit/storage/registry-index.test.js` | **11 tests, 11 pass, 0 fail** |
| Registry/recovery | `node --test dist-test/tests/unit/storage/registry.test.js dist-test/tests/unit/storage/recovery.test.js` | **41 tests, 41 pass, 0 fail** |
| Complete storage suite | `node --test "dist-test/tests/unit/storage/*.test.js"` | **322 tests, 320 pass, 2 skipped** (pre-existing privilege-gated chown tests), 0 fail |
| Static guard | `node --test dist-test/tests/unit/storage/static-guard.test.js` | **25 tests, 25 pass, 0 fail** |
| Global security | `node --test dist-test/tests/security/security.test.js` | **15 tests, 15 pass, 0 fail** |
| Crash suites | recovery-mutation (10-stage), quarantine (15-stage), audit-reconstruction (12-stage), registry-index (8-stage), WPR-023 (d) adjudication (5-stage), executable disposition (12-stage × quarantine + index) | all pass within the storage suite |
| Default workflow | `npm test` | **1357/1358 pass; 1 pre-existing environment-pinned failure** (pi-adapter harness expects Pi `0.83.0`, installed `0.84.1`; reproduced on the baseline — accepted per WP-8-I §15) |
| WP-7 regression | `node scripts/run-wp7-tests.mjs` | **165/165 pass** |
| Contract-hash audit | static guard (pinned SHA-256 `d369e45a…`) | pass |
| `git diff --check` | — | clean |

New focused coverage: (d) adjudication-only for regular/symlink/directory
with no surface fsync and no evidence; eligible quarantine malformed/
foreign/conflict regular files disposed with deterministic
operation-specific evidence; exact eligibility (hard-link, wrong-mode,
digest mismatch, symlink replacement, changed classification); quarantine
idempotency (already-completed, absent-without-evidence fail closed,
evidence-with-live-target fail closed, conflicting evidence fail closed);
exact conflicting index disposed with stale-historical/unrelated artifacts
preserved and rebuild succeeding afterward; index idempotency states; the
executable 12-stage inventory asserted for both surfaces; crash at every
stage with the deterministic rerun outcome per stage.

## 15. WP-8-H Notes (§16)

`usePersistentIndex` with continuation and the ADR TML-002 wording were
not touched; no code they reference was changed, so they are recorded
here only.

## 16. Remaining WP-8 Work

Stale-lock breaking with lock-recovery evidence; primary/audit deletion;
retention; legal holds; migration; full audit-history inspection;
configuration-namespace recovery; disposition of the remaining
adjudication-only classes (wrong-type/wrong-uid-or-mode/
unexpected-hard-link quarantine objects, foreign objects, tamper-class
records, dangling audits, lock objects) pending further contract
decisions; lifecycle approval decisions; WP-12 integration; WP-9
generation seeding.

## 17. Git State

All changes are unstaged and uncommitted (`git status` shows the
modified and untracked paths of §1 only). Nothing was pushed, tagged,
released, published, installed, or deployed. The next gate is the
WP-8-F/WP-8-G/WP-8-H/WP-8-I implementation review.
