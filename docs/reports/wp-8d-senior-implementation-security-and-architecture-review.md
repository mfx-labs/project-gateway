# WP-8-D — Senior Implementation Security and Architecture Review

**Review type:** adversarial, read-only senior review of the complete WP-8-D
implementation (Component C / contract §29 implementation Phase 3 — Durable
Single-Record Publication, Exact Reads, and Locking).
**Primary input:** `docs/reports/wp-8d-implementation-report.md`.
**Independently checked:** the authoritative WP-8 contract (read in full;
SHA-256 `aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f`),
ADR-028 and ADR-029 (read in full), the WP-8-D decision package
(pre-implementation consolidation, senior pre-implementation review,
decision-resolution report, senior decision-resolution and ADR review,
focused decision-package rereview — all read), the complete WP-8-D source
and test delta, the crash-injection harness, the committed WP-8-C source
and tests, package/export/dependency configuration, the compiled `dist`
and `dist-test` trees, and the Git inventory. Every reported count, path
inventory, authority claim, and test result was re-derived independently;
none was copied from the implementation report without verification.
No file other than this report was created or modified; nothing was staged
or committed.

---

## 1. Repository, Branch, HEAD, and Governance

| Item | Expected | Verified |
|---|---|---|
| Repository root | `/home/chef/Documents/Project_Gateway_MCP` | exact |
| Branch | `main` | exact |
| HEAD | `bd832606ece489a924b4fcc13ad55789fcb0736f` | exact |
| HEAD subject | `feat: establish WP-8-C trusted storage bootstrap` | exact |
| HEAD parent | `05904e46ded384bab5f250ac72c2734539f1e86f` | exact |
| Staging | empty | empty (`git status --porcelain` shows only unstaged ` M` and untracked `??`; zero staged entries) |
| Commits after HEAD | zero | zero (HEAD is the newest of 24 commits) |
| Tags | zero | zero |
| Contract SHA-256 | `aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f` | exact (`sha256sum`; also asserted by the static guard) |
| Dependencies | `ajv@8.20.0` only | exact (`package.json` + lock) |
| Public exports | 42 | 42 (independent `dist/index.d.ts` audit; static-guard assertion 42) |
| Package exports | `"."`, `"./pi-adapter"` | exact |
| `src/index.ts` | unchanged | unchanged (zero diff lines; zero storage references) |
| `package-lock.json` | unchanged | unchanged (zero diff) |
| Contract / ADR modifications | none | none (all ADRs untouched; contract byte-identical) |
| WP-9 work | none | none (`src/mcp`, `src/control-plane` absent; `src/storage/{registry,recovery,retention,migration}` absent) |
| Publication | none | none (no tags, no pushes, no commits) |

**Governance fact (recorded exactly):**

`WP-8-C INDEPENDENT COMMIT VERIFICATION: SKIPPED BY HUMAN DIRECTION`

The baseline commit `bd832606…`, its complete file manifest, and its
commit report were not independently verified by this review; the commit
is treated as the operational baseline per human direction. Nothing in
this report claims independent verification of that commit or its
manifest.

## 2. Inventory Gate

### A. Task-local implementation delta (32 paths — independently reconstructed and verified exact)

**Nine new source files:**
1. `src/storage/publication/publish-record.ts`
2. `src/storage/publication/index.ts`
3. `src/storage/locks/lock.ts`
4. `src/storage/locks/index.ts`
5. `src/storage/read/read-record.ts`
6. `src/storage/read/enumerate.ts`
7. `src/storage/read/index.ts`
8. `src/storage/audit/write-audit.ts`
9. `src/storage/audit/index.ts`

**Seven modified source files:**
10. `src/storage/capabilities/authenticity.ts`
11. `src/storage/trusted-input/bootstrap-input.ts`
12. `src/storage/types.ts`
13. `src/storage/format/taxonomy.ts`
14. `src/storage/initialization/provision.ts`
15. `src/storage/initialization/state.ts`
16. `src/storage/index.ts`

**Six new tests:**
17. `tests/unit/storage/publication.test.ts` (11 tests)
18. `tests/unit/storage/locks.test.ts` (7 tests)
19. `tests/unit/storage/read.test.ts` (6 tests)
20. `tests/unit/storage/audit.test.ts` (5 tests)
21. `tests/process/storage-crash/crash-harness.test.ts` (4 tests)
22. `tests/process/storage-crash/fixture.test.ts` (1 self-check test; process child)

**Six modified test/package files:**
23. `tests/unit/storage/capabilities.test.ts` (+8 tests — see MINOR-1)
24. `tests/unit/storage/trusted-input.test.ts` (+3 tests)
25. `tests/unit/storage/static-guard.test.ts` (+3 tests)
26. `tests/unit/storage/taxonomy.test.ts` (+1 test; four scalar sites → arrays)
27. `tests/security/security.test.ts` (delegation +4 exact compiled paths)
28. `package.json` (+`test:storage-crash` script only)

**One optional test path (used, authorized):**
29. `tests/unit/storage/initialization.test.ts` (+5 classifier tests; the
    pre-existing "unknown entries fail closed" fixture changed from
    `records/` to a genuinely unknown entry (`evil`) with `index` added as
    a deferred-entry case — the D-7 classifier-policy revision supersedes
    the original expectation; the test remains meaningful and fails closed)

**Three implementation documentation paths:**
30. `docs/reports/wp-8d-implementation-report.md` (new)
31. `docs/design/post-wp5a-roadmap.md` (modified)
32. `docs/design/post-wp5a-planning-status.md` (modified)

### B. Complete uncommitted working-tree inventory (38 paths before this report)

The six pre-existing WP-8-D decision/review documentation paths
(`docs/decisions/ADR-029-…`, `wp-8d-pre-implementation-decision-consolidation-report.md`,
`wp-8d-senior-pre-implementation-security-and-architecture-review.md`,
`wp-8d-decision-resolution-report.md`,
`wp-8d-senior-decision-resolution-and-adr-review.md`,
`wp-8d-focused-decision-package-rereview.md`) remain uncommitted. The
implementation adds the 29 source/test/package paths of §2A and the
implementation report, and modifies the already-present roadmap and
planning-status paths. The complete pre-review working tree is exactly
**38 distinct paths** (29 source/test/package + 9 documentation) —
verified by full `git status --porcelain -uall` enumeration. After
creating this review report, the complete inventory is exactly 39 paths.

**Inventory determinations:** no prior decision document was removed; no
unauthorized file exists; no path was omitted from the implementation
report (its §2 itemization matches the verified delta exactly); the
reported task-local count (32) is correct. The implementation report
distinguishes the task-local 32-path delta from the complete 38-path
working-tree inventory (§2 vs §17) — no wording finding arises.

## 3. Authorized Path Envelope

Every changed source, test, package, and documentation path falls inside
the implementation authorization (ADR-029 implementation constraints; the
decision-resolution envelope). Verified: nine new source files in the four
authorized trees (`publication/`, `locks/`, `read/`, `audit/`); seven
modified source files exactly as authorized; six new tests; six modified
test/package files; the optional `initialization.test.ts` change is
limited to the D-7 classifier-policy revision (+5 five-state tests) and
does not weaken unknown-entry rejection (the updated test still fails
closed on genuinely unknown and deferred entries, and adds `index`
coverage).

**Rejected classes verified absent:** no source or tests outside the
envelope; no hidden generated source under `src/`; no contract or ADR
edits; `src/index.ts` unchanged; `package-lock.json` unchanged; no package
export or dependency change (`package.json` diff = one script line);
no later-phase directories (`registry`, `recovery`, `retention`,
`migration` absent from `src/storage/`); no WP-9 source.

## 4. Implementation Architecture (source graph)

Verified actual edges (imports and creator-consumers):

- `src/storage/publication/index.ts` is the private composition boundary:
  imports `createTrustedWriteRequest` (trusted-input), `createWriteCapability`
  and `createProvisioningCapability` (authenticity), `provisionPhase3TopLevel`
  (provision), `acquireWriterLock`/`releaseWriterLock` (locks),
  `ensureClassShardDirectories`/`publishImmutableRecord`/`inspectTempObject`/
  `verifyObjectBytesAt`/`publicationTempName` (publish-record),
  `buildAuthorizedWriteAuditEvent` (write-audit), `verifyStoreInstance`
  (read-record), `revalidateParentIdentity` (root). It is filesystem-free
  (no `node:fs` import, verified in source and compiled output).
- `src/storage/publication/publish-record.ts` is the sole immutable
  publication filesystem substrate: owns temp creation, write-all,
  fsyncs, hard-link publication, final verification, own-temp unlink,
  class/shard directory creation.
- `src/storage/audit/write-audit.ts` is filesystem-free (no `node:fs`
  import; compiled output contains zero `node:fs` references) and cannot
  create a second publication path; it constructs the event and the
  composition publishes it through the single substrate.
- `src/storage/locks/lock.ts` owns the writer-lock filesystem path
  (`locks/writer.lock` fixed relative path; exercised at `store-v1/…`).
- `src/storage/read/read-record.ts` owns exact-record reads and the D-5
  verified-store pipeline; read-only fs API subset.
- `src/storage/read/enumerate.ts` is the sole directory-scanning owner in
  the read tree (`readdirSync` confined to it and to provision.ts's
  classifier bracketing — verified by the guard test).
- Private barrels (`publication/index.ts`, `locks/index.ts`, `read/index.ts`,
  `audit/index.ts`, `capabilities/index.ts`, `trusted-input/index.ts`) do
  not export authority creators. `src/storage/index.ts` re-exports the
  compositions and genuineness verifiers only; no creator is re-exported
  (guard-asserted, source-verified).
- No source imports WP-7 reader/git/FFF internals (verified by grep of
  every storage import: all are within `src/storage/**`, `src/json/**`,
  `src/canonical/**`, or `src/trusted/configuration-brand.js` — the
  committed WP-6 brand module).

## 5. Production Authority Reachability

**Zero production `StorageWriteActionProvenance` producers — PROVEN.**
`createStorageWriteActionProvenance` is defined only in
`src/storage/trusted-input/bootstrap-input.ts` and is imported by **no**
production module (grep over all of `src/`, all import forms; static-guard
`CREATOR_EDGES` enforces the zero-importers edge). The future consumer
`src/control-plane/storage-write-action.ts` does not exist.

- **No ambient write-provenance creation:** the creator requires the
  caller to pass a fields object and brands the result — but no production
  module can call it (zero importers), and tests use it only from
  `tests/**` and `tests/process/**` (compiled into `dist-test/**` only;
  the compiled `dist/` tree contains the creator but no production caller
  can reach it — verified by scanning compiled `dist/` importers).
- **No environment, argv, cwd, request, record, repository, artifact or
  UID-derived issuance:** the write path requires the genuine branded
  `TrustedWriteRequest` (itself gated on genuine branded write-action
  provenance + genuine WP-6 configuration with exact correlation of
  locator/UID/forbidden-roots/limit-profile/config identity), plus the
  verified store instance from the metadata pipeline; no ambient sources
  exist anywhere in the chain; `process.env`/`cwd`/`argv`/`Date.now` are
  statically prohibited in all `src/storage/**`.
- **No runtime test hook:** no environment-gated hook, no flag; the
  `hooks`/`timeSource` fields of `PublishRecordRequest` are per-call
  injected primitives of the internal composition API (deterministic
  failure testing), not ambient switches, and the composition has zero
  production callers.
- **Test-only producers compile only under test output:** all callers of
  the provenance/request creators are under `tests/`; `dist/` compiled
  production output imports the creators from no module.
- **Package shipping does not include test producers:** `files: ["dist"]`
  unchanged; no test file ships.
- **Write-capability creation requires genuine branded provenance:**
  `createWriteCapability` rejects any non-genuine `TrustedWriteRequest`
  (WeakSet domain) and requires the verified store instance; correlation
  (configuration identity, UID, limit profile) is exact.
- **Importing a creator does not permit minting without genuine operands:**
  verified — the gate operands are module-private brands not obtainable by
  import; structural/forged operands fail (tests: forged operands never
  reach the filesystem; structural capability rejected before fs access).
- **Production publication is unreachable:** `publishRecord` cannot be
  invoked without a genuine `StorageWriteActionProvenance`, which no
  production module can mint. All direct, aliased, barrel, and re-export
  paths were reviewed (static guard covers alias unwrapping and
  export-from forms).

No production authority leak found. Direct/aliased/barrel/re-export paths
are all covered.

## 6. Capability Authenticity

- **`provision-phase3` is an initialization-family operation, not a new
  CAP-001 kind:** `INITIALIZATION_OPERATION_SET = ['namespace-initialize',
  'provision-phase3']`; `createProvisioningCapability` uses the existing
  module-private `capabilityBrand` WeakSet; per-issuance operation sets are
  `['namespace-initialize']` (initialization) and `['provision-phase3']`
  (provisioning) — least authority; cross-operation use fails
  `wrong-operation`.
- **Distinct authenticity domains:** separate module-private WeakSets for
  `InitializationCapability`, `WriteCapability`, `ReadCapability`,
  `VerifyCapability` (authenticity.ts) and for
  `StorageBootstrapActionProvenance`, `TrustedStorageBootstrapInput`,
  `StorageWriteActionProvenance`, `TrustedWriteRequest` (bootstrap-input.ts).
  Cross-kind substitution fails (tested); structural objects, spread,
  structured clone, Proxy, reflection lookalikes, detached methods,
  JSON/worker-message forms fail every verifier (CAP-015 tests; committed
  WP-8-C pattern extended).
- **Generation and disposal:** per-store generation registry; trusted-
  configuration replacement advances generation; stale and disposed
  capabilities fail `stale-generation`/`disposed`; disposal idempotent.
- **Bindings:** StoreMetadata-derived store instance (both namespace
  identities), parent identity, configuration identity, limit-profile
  identity, action identity (write only, from the genuine provenance
  operand — never a structural string), operation set, generation,
  lifetime. `assertExpected` revalidates store/configuration/UID/profile at
  mutation boundaries.
- **Exact creator-consumer graph:** write/trusted-request/provisioning →
  `publication/index.ts`; read/verify → `read/index.ts`; both
  action-provenance creators → zero production importers; no creator is
  exported from any barrel or the package root.
- **Adversarial test coverage is real, not nominal:** forged/cloned/
  proxied/detached uses; generation advance on config replacement;
  cross-kind substitution; serialization/clone/spread/proxy/structural
  forgery; structural capability rejection before any filesystem access;
  mid-operation invalidation exercised at boundaries 1–3 (crash fixture)
  and 4 (root drift).

## 7. Phase-3 Classifier

The five-state classifier (`classifyNamespace`, fixed committed constant
`NAMESPACE_CLASSIFIER_ENTRIES = ['metadata','tmp','records','audit','locks']`)
was tested against every required case:

- **A — exact phase-2 state:** `metadata,tmp` + verified metadata →
  `PROVISIONAL / phase3UpgradeRequired: true` (never FOREIGN). ✓ tested.
- **B — upgrade in progress:** allowed subset of the phase-3 set, no
  unknowns → `PROVISIONAL`, regardless of the metadata flag. ✓ tested.
- **C — incomplete phase-3:** `metadata,tmp` + proper subset of
  `records,audit,locks`, all valid → `PROVISIONAL` independent of
  metadata-verification state (verified by code path and test). ✓ tested.
- **D — foreign/invalid:** unknown entries, `index`, `quarantine` →
  `FOREIGN`; symlink/identity drift at the namespace root →
  fail-closed states. ✓ tested. **Partial gap — see MINOR-2** (wrong
  type/UID/mode *at a fixed entry path* is not detected by the
  classifier).
- **E — phase-3 initialized:** exact five-entry set + verified metadata →
  `INITIALIZED`. ✓ tested.
- Policy is a committed constant, not caller-selectable, not
  metadata-selected; StoreMetadata format `'1'` and layout `'v1'` versions
  unchanged; no stored phase fact; no migration state; old software
  downgrade sees phase-3 entries as unknown → FOREIGN (fail closed),
  intentional and VRS-008-safe (documented in the decision package).
- Unknown-entry tests remain meaningful after the fixture update (now
  `evil` + deferred `index`).

## 8. Phase-3 Provisioning

- `provisionPhase3TopLevel` is gated on the genuine initialization-family
  `provision-phase3` capability; sole production consumer is
  `publication/index.ts`; invoked **before** writer-lock acquisition
  (verified in `publishRecord` stage order).
- Targets only the fixed derivations `<ns>/records`, `<ns>/audit`,
  `<ns>/locks` under both namespaces via `namespaceRootPath`; no raw path
  operand exists.
- Each directory: exclusive non-recursive `mkdir` mode `0700`,
  descriptor-bound no-follow verification (open `O_RDONLY|O_DIRECTORY|
  O_NOFOLLOW` + `fstat` via `verifyDirectoryStat`: directory type, UID,
  exact `0700`), `fchmod` + re-verify + `fsync` after creation;
  `EEXIST` → descriptor verification → idempotent continue only if exact;
  wrong type/UID/mode → fail closed; no repair, chmod of existing,
  chown, deletion, or adoption.
- Crash-partial sets remain PROVISIONAL (tested) and a retry creates only
  the exact missing entries (deterministic loop).
- Class/shard creation (`ensureClassShardDirectories`) occurs **after**
  lock acquisition, requires a genuine live `WriteCapability`
  (`verify('record-publish')` first), class from the closed taxonomy via
  `deriveRecordRelativePath`, shard = exact canonical four-lowercase-hex
  from the validated identity; targets only
  `<ns>/records/<segment>/<shard>` and `<ns>/audit/audit-event/<shard>`;
  no arbitrary directory operand; no other capability can create them.
- Concurrent first use: exclusive `mkdir`; `EEXIST` → descriptor
  verification → continue-or-fail-closed (unit-tested pattern, same as
  `ensureFixedDirectory`); crash between creations → PROVISIONAL +
  deterministic retry (tested).

## 9. Writer-Lock Security

- Fixed path `locks/writer.lock` (`WRITER_LOCK_RELATIVE_PATH`); exercised
  at `store-v1/…`.
- Exclusive no-follow creation `O_CREAT|O_EXCL|O_NOFOLLOW|O_WRONLY` mode
  `0600`; descriptor-bound `fstat` (regular file, configured UID, exact
  `0600`) before and after writing; file `fsync`; locks-directory `fsync`.
- Canonical bounded lock record (JCS, `LOCK_RECORD_MAX_BYTES = 4096`
  checked at write): lock version `'1'`, store instance (both namespace
  dev/ino), 16-byte random nonce (`randomBytes`, hex), domain-separated
  action-identity digest, PID, injected process start time, injected
  boot identity (absent in WP-8-D), acquisition time (injected clock),
  max age (`lockWait`).
- Bounded wait (injected wait + clock, `lockWait` → `ERR-STO-LOCK-TIMEOUT`);
  cancellation during wait → `ERR-STO-CANCELLED`; immediate contention
  without wait hook → `ERR-STO-LOCK-UNAVAILABLE`; foreign objects at the
  lock path (directory, symlink, special file) → `ERR-STO-FTYPE-UNSUPPORTED`.
- Identity-bound release (LOK-013): genuine capability first, then
  descriptor-bound no-follow read, canonical-JCS verification, nonce +
  store-instance match required, `unlink`, locks-directory `fsync`;
  wrong nonce/store, malformed, foreign, or absent → `not-owned`, never
  touched (tested). No lock breaking, no stale classification.
- Crash persistence: lock remains after kill (harness asserts lock exists
  and follow-up writers fail closed).
- **Deviation review — descriptor-bound `readFileSync` in `locks/lock.ts`:**
  (a) genuinely required: LOK-013's identity-bound release must verify the
  recorded nonce + store instance from the file content; (b) operates only
  on an already verified descriptor (`O_RDONLY|O_NOFOLLOW` open, pre-`fstat`
  regular-file/UID/exact-`0600` verification, post-read `comparePrePostStat`
  incl. size); (c) bounded after allocation only — the parse is bounded by
  `LOCK_RECORD_MAX_BYTES` but the read itself has no pre-read size check;
  in practice the file is confined to a store-owned `0700` directory and
  only ever written by this module at ≤4096 bytes, and a same-UID actor
  who could inflate it is outside the accepted guarantee (TML) — see
  NOTE-1; (d) cannot follow or reopen attacker-controlled paths
  (no-follow, descriptor-bound); (e) the exact static allowlist entry
  (`readFileSync` in `locks/lock.ts` only) and the release tests
  (identity-bound, wrong-nonce, malformed) cover it. **Not a security
  finding** under the stated criteria (not broad, not path-based).
- Verified: only `locks/lock.ts` uses named `randomBytes` and
  `process.pid` (grep + guard negative-leakage tests); injected
  start-time/clock/boot identity; no `/proc` read.

## 10. Publication Protocol

Traced end-to-end in `publishRecord` + `publishImmutableRecord` in the
normative order: request/class/identity/envelope/payload-digest/limits
validation (WPR-001/002/014) → genuine trusted request + capability →
D-5 store revalidation (`verifyStoreInstance`) → phase-3 top-level
provisioning (pre-lock) → writer-lock acquisition → class/shard
directories → exclusive no-follow temp creation (`O_CREAT|O_EXCL|
O_NOFOLLOW`, `0600`) → `fchmod`/`fstat` verification → bounded write-all
with zero-progress detection (`writeAllSync` loop) → temp size/identity
verification → temp `fsync` → capability revalidation (boundary 2) →
hard-link no-replace publication (`link(2)`, no `rename` anywhere in
`src/storage/`) → final-object identity (dev/ino match with temp inode,
nlink===2) and policy verification → final-record-directory `fsync`
(before unlink) → exact-own-temp `unlink` → `tmp/`-directory `fsync` →
mandatory `authorized-write` audit publication (its own temp, link, audit
file fsync, shard/class/audit-top directory syncs) → boundary-4
revalidation (capability + parent identity) → identity-bound lock release
→ success only after the full durability point (WPR-008/021).

**Searches performed:** no overwrite path (hard-link no-replace; existing
targets verified and classified, never replaced — tested); no `rename`
use in storage source (fixture uses `renameSync` only to simulate root
drift in a test child); no adoption (temp and final EEXIST paths never
reopen-for-write, never unlink foreign objects); no rollback claims after
durable link (CAP-009 outcomes return durability-class verify-required,
never success, never rollback); no error swallowing (all stages map to
closed codes; post-mutation failures map to the 10.5 rows); no success
before audit durability (audit publication failure → `ERR-STO-DURABILITY`
audit-row tuple); no unbounded allocation in the primary path (byteLimit
checked before temp write and before existing-target reads); path
arguments are all fixed derivations (`namespaceRootPath` +
`deriveRecordRelativePath` + fixed temp names), never caller strings
(the request carries validated identities only; `locator` is a genuine
provenance-bound absolute path).

## 11. CAP-009 and Partial Success

All four boundaries mapped and verified in code:

1. **Before the first trusted-state mutation** (store revalidation,
   capability issuance + `revalidateBoundary`, provisioning, lock
   acquisition): invalidation → `ERR-STO-REQ-INVALID`, no state change
   (crash fixture `cap-invalid-boundary-1`; unit tests).
2. **Immediately before primary publication**: `verify('record-publish')`
   inside `publishImmutableRecord` before `link`; failure → `REQ-INVALID`
   with containment (own temp unlinked, own lock released) — transient
   state only (fixture `cap-invalid-boundary-2`).
3. **Before required audit publication**: the audit
   `publishImmutableRecord` revalidates the capability first; failure →
   durability-class verify-required, primary durable and authoritative,
   audit row `{primaryStateChanged: yes, durabilityPointReached: yes,
   auditChanged: unknown, verifyBeforeRetry: true}` (fixture
   `cap-invalid-boundary-3`; unit test for the audit-missing tuple).
4. **Before success**: `revalidateBoundary` + `revalidateParentIdentity`;
   failure → `ERR-STO-DURABILITY` with truthful state
   (`primaryStateChanged: yes, auditChanged: yes`), durable state remains
   authoritative, idempotent replay applies (fixture `root-drift-boundary-4`).

Result tuples verified truthful: no false rollback anywhere; durable
primary remains authoritative; missing audit yields the durability-class
result with `verifyBeforeRetry: true`; cleanup and lock release are
limited to exact owned transient state (own temp by deterministic name,
own lock by nonce); invalidation cannot authorize new advancement (every
later boundary revalidates; no capability use after invalidation).

## 12. Existing-Target and Temp-EEXIST

Existing-target classes exercised by tests and code: exact idempotent
bytes → idempotent-duplicate (verify-first, WPR-019, with audit-target
verification); same identity/different bytes → `ERR-STO-CONFLICT-REVISION`
(18.2 classifier: revision/digest divergence maps to conflict;
`ERR-STO-DUPLICATE` reserved for the canonical-impossible same-digest-
different-bytes case — documented, tested); malformed → `MALFORMED`;
unsupported version → `UNSUPPORTED-VERSION` (envelope precedence);
wrong class/location → derived-path containment; symlink/directory/
special file → `ERR-STO-FTYPE-UNSUPPORTED` via no-follow descriptor
verification; wrong UID/mode → `ERR-STO-PERM-DENIED`; unexpected hard
link (nlink ≠ 2) → `ERR-STO-INTEGRITY`; absent → `NOT-FOUND`.

Same-action temporary `EEXIST` (MINOR-2 protocol) verified: no adoption,
no reopen for writing, no unlink of the existing object; bounded no-follow
descriptor inspection (`inspectTempObject`: type first, then UID/mode —
wrong type → FTYPE-UNSUPPORTED before content checks; wrong policy →
PERM-DENIED); caller-tuple-specific primary and audit verification
(`verifyObjectBytesAt` + `verifyAuditTargetForCaller` constructing the
deterministic audit event from the caller's tuple); exact primary+audit →
contract-permitted idempotent result (leftover temp untouched — phase-4
cleanup); primary durable + audit incomplete → `ERR-STO-DURABILITY`
audit-row tuple; neither provable → `ERR-STO-DURABILITY` unknown-state
tuple (`verifyBeforeRetry: true`); no new error code; stale temp left for
phase-4 recovery. All five protocol outcomes tested (unit + fixture
`temp-exists-idempotent`, `temp-exists-audit-missing`).

## 13. Audit Implementation

- Only `authorized-write` is emitted; `idempotent-duplicate`/`conflict`
  kinds are not implemented (D-12; tested — a `conflict` kind input is
  rejected with `REQ-INVALID`); no full AUD-001 claim anywhere.
- Identity: domain-separated digest (`PGAP-STORAGE-AUDIT-EVENT-IDENTITY-v1`,
  distinct from the payload/record-bytes domains) over the canonical JCS
  tuple (store/namespace identities, primary class, primary id + revision,
  primary digest, event kind, trusted action identity) →
  `pgw:l:<32-hex>` (tested: every tuple member changes the identity).
- Excluded from the input: nonce, PID, path, counter, clock, capability
  object identity (code-verified); no stored sequence.
- Envelope: `AuthoritativeAuditEvent`, format `1.0`, revision 1, `createdAt`
  = primary's logical time (DTM-007), `trustedActionId` = capability-bound
  action identity, payload `{eventKind, recordId, recordDigest}`, digest-
  bound payload, `referenceDigests = [primary digest]`, `retentionClass:
  indefinite`.
- Ordering tuple `(primary createdAt, primary identity, event identity)`
  deterministic; no audit-of-audit (closed §22.1 list; terminal event);
  evidence grants no authority.
- Same-action retry verifies the existing event (byte-exact) and never
  emits a second (tested: exactly one event after retry); a different
  action produces a different identity (tested) and cannot bypass
  primary-target EEXIST.
- `write-audit.ts` has no filesystem imports (source + compiled verified)
  and cannot create a second publication path.

## 14. Taxonomy

Scalar-to-array migration verified: `wp8Production` is
`readonly Wp8Production[]`; all 18 profiles migrated (BASE `['no']`; audit
`['reconstruction-only','write-audit']`; store-metadata
`['initialization']`; store-evidence `['maintenance']`; configuration-
snapshot `['no']`); arrays readonly, non-empty, no duplicates, exact
declared order (test-asserted); no runtime sorting anywhere (code-verified);
only the audit profile has two values and contains `'write-audit'`
(test-asserted); all consumers updated (typecheck + tests pass); all four
prior scalar assertion sites updated to array equality; no digest/schema/
persisted-format impact (taxonomy is type-level); no hidden export change.

## 15. Exact Read

`readRecordByIdentity`/`verifyRecordByIdentity`: canonical class + typed
identity only (`parseTypedIdentifier` + `deriveRecordRelativePath`); no
raw path; descriptor-bound no-follow open (`O_RDONLY|O_NOFOLLOW`) with
pre/post `fstat` (`comparePrePostStat`: dev/ino/type/uid/mode/size) and
post-read size match; bounded read (`pre.size > byteLimit` checked before
allocation); canonical parse with duplicate-key rejection
(`parsePersistedEnvelope`); payload-digest verification; derived-location
verification by construction; identity-component match; immutable
copy-on-return (frozen copies); no lifecycle interpretation; no mutation;
no `readdirSync`; no mutating fs imports (guard-asserted; mutating-API
denial test). Identity drift/object replacement between checks fails
closed via the pre/post descriptor comparison.

## 16. Verify and Enumeration

- Verify: structured findings only, no content, no repair; a valid record
  confers no authority (ITG-007); fail-closed codes per class.
- Enumeration: class-scoped fixed directory; deterministic order (shards
  `0000..ffff` lexicographic + sorted entry names — host order never
  trusted); bounded by `dirEntries` (scanned) and `enumerationResults`
  (reported) with continuation resuming strictly after the cursor
  (tested); each candidate independently verified (name grammar, location
  derivation, canonical envelope, digest, identity-component match)
  before being reported; malformed/foreign entries are bounded findings,
  never records; no arbitrary recursion; no registry/current-state
  resolution; no path disclosure (static messages only); `enumerate.ts`
  is the sole scan owner in the read tree (guard-asserted).
- Shard-directory changes during enumeration detected via pre/post
  descriptor snapshots → fail closed.

## 17. Filesystem API Ownership

All production `node:fs` importers reconstructed: WP-8-C modules
(`root/resolve.ts`, `initialization/provision.ts`, `probe/probe.ts`,
`probe/scratch.ts`, `metadata/bootstrap-persist.ts`) plus the four new
WP-8-D modules (`publication/publish-record.ts`, `locks/lock.ts`,
`read/read-record.ts`, `read/enumerate.ts`). `audit/write-audit.ts`, all
barrels, and both composition modules are fs-free (verified in source and
compiled output). Every API is checked against the exact per-module
allowlist by the guard; no namespace imports, no default imports, no
dynamic imports, no renamed imports (guard rejects `import { x as y }`),
no filesystem-name exports, no helper indirection escaping module
ownership (local re-import scan), no fs imports in audit composition or
barrels, no read-tree mutation APIs (mutating-API denial test).

## 18. Static Guard

Reviewed the actual guard (AST/text hybrid; source-text parsing with
synthetic samples): 19/19 tests pass. Verified specifics:
initialization-family operations — the guard does not admit operations by
count; operation vocabulary is source-constant-based and each issuance
binds one operation; the "three initialization-family operations are not
accidentally admitted if only two are authorized" question is answered by
the exact constant `['namespace-initialize','provision-phase3']` (two
values) and per-issuance operation sets; exact creator edges; zero-producer
edges for both action-provenance creators; exact four new fs allowlists;
exact locks-only crypto/process exception with negative leakage tests
(synthetic leakage samples incl. whitespace/multiline forms); read
mutation denial; storage↔WP-7 import denial (with a coverage limitation —
see MINOR-3); no creator re-export (plain + aliased + export-from
samples); no broad storage delegation; later-phase source directories
prohibited and WP-8-D directories required; renamed/default/namespace/
dynamic/export-from bypasses covered by synthetic samples (the guard does
not pass merely because a fixture misses a syntax form — the forms are
explicitly synthesized).

## 19. Global No-I/O Delegation

`tests/security/security.test.ts` delegates exactly:
`storage/publication/publish-record.js`, `storage/locks/lock.js`,
`storage/read/read-record.js`, `storage/read/enumerate.js` (plus the five
committed WP-8-C paths — nine total, verified by the delegated-in-tree
deep-equal assertion). No blanket `storage/**` exclusion; the fail-closed
predicate (exact normalized paths only) and the complete rejection
inventory remain active; barrels, composition modules, audit, capability
and trusted-input modules remain subject to the global no-I/O assertion
(15/15 pass; the compiled delegation test's rejected list covers
near-matches, traversal spellings, and hypothetical future modules); every
delegated module is covered by the stricter storage guard.

## 20. Crash-Injection Harness

Inspected source and executed twice (5/5 both runs).

- Only tests spawn children (`child_process` confined to `tests/process/**`
  and the committed WP-7 git modules; zero subprocess use in storage
  runtime source — SRE-013).
- Stage markers prove exact reach: hooks emit `STAGE:<name>` after each
  real fs mutation (deterministic hook-call counters over real
  `writeSync`/`fsyncSync`/`linkSync`/`unlinkSync`/dir-sync calls); the
  parent SIGKILLs only after the marker is observed; no sleep-only pass
  (bounded `Atomics.wait` interrupted by the kill).
- Isolated trusted root per stage; bounded deadlines (30 s) with
  kill + wait reaping (exit event proof; no orphans); HOME and unrelated
  paths asserted unchanged; stale compiled-output protection
  (dist-test mtime vs src mtime); no unrelated mutation (classifyStore
  checks only the store root + HOME).
- Exact post-crash classification per stage (record/temp/audit/lock
  presence; `tempRemovalUnknown` tolerated truthfully only for the
  unlink→tmp-sync window).
- **11 kill stages, fixed names, executed count asserted (11/11, both
  runs):** `lock-dir-synced`, `primary-written`, `primary-fsynced`,
  `primary-linked`, `primary-dir-fsynced`, `primary-unlinked`,
  `primary-tmp-synced`, `audit-written`, `audit-linked`, `audit-synced`,
  `lock-released`.
- **8 behavior stages, fixed names, executed count asserted (8/8, both
  runs):** `temp-exists-idempotent`, `temp-exists-audit-missing`,
  `zero-progress-write`, `partial-write`, `cap-invalid-boundary-1`,
  `cap-invalid-boundary-2`, `cap-invalid-boundary-3`,
  `root-drift-boundary-4`.
- Five Node test cases (4 harness + 1 fixture self-check); the
  self-check asserts the fixed 11/8 inventories, and the harness asserts
  `executed === stages.length` — a test-case count of 5 cannot pass
  without all 19 stages executing (explicit executed-stage evidence:
  marker-reach assertions per stage, both runs).
- Reconciliation vs the required windows: lock creation/dir-sync ✓; temp
  creation — no distinct kill stage between temp creation and the first
  write (kill at `primary-written` yields the identical post-crash
  classification: temp present, no record) — see NOTE-3; write ✓
  (`primary-written`); fsync ✓; link ✓; final-dir fsync ✓; unlink ✓;
  tmp-dir fsync ✓; audit write/link/dir-sync ✓; post-durability lock
  release ✓; process termination leaving temp/lock ✓.
- Both runs executed the identical fixed inventory (same assertions, same
  stage names, no duplicates, no silently skipped stages).

## 21. Test Execution

Independently executed (actual results, not copied):

| Command | Result |
|---|---|
| `npm run typecheck` | pass, 0 errors |
| `npm run build` | pass (51 schemas, 358 corpus inputs) |
| `npx tsc -p tsconfig.tests.json` | pass, 0 errors |
| storage suite run 1 | **197 total / 196 pass / 1 skip / 0 fail** |
| storage suite run 2 | **197 total / 196 pass / 1 skip / 0 fail** |
| static guard | **19/19** |
| global security | **15/15** |
| `npm run test:storage-crash` run 1 | **5/5** |
| `npm run test:storage-crash` run 2 | **5/5** (identical 11+8 stage inventory) |
| `npm run test:security` | **15/15** |
| `npm run test:unit` | **169/169** |
| combined unit (`unit/*` + `unit/storage/*`) | **366 total / 365 pass / 1 skip / 0 fail** |
| `npm test` (default workflow) | **1358/1358** |
| `node scripts/run-wp7-tests.mjs` | **165/165** (reader 62, git 38, fff 26, security 39) |
| contract-hash audit | exact |
| dependency audit | `ajv@8.20.0` only |
| public-export count | 42 (independent) |
| package-export audit | `"."`, `"./pi-adapter"` |
| `git diff --check` | clean |

Every claimed total reproduced exactly. The single skip is the committed
pre-existing WP-8-C test `initialization: verification-only path rejects
wrong-UID namespace directory (W8C-S03)`: it actively attempts
`chownSync(…, 12345, 12345)` and calls `t.skip` only when the chown throws
(privilege-gated by the environment); it is not forced, and wrong-UID
coverage is provided by the deterministic synthetic stat-policy tests.

Suite-delta reconciliation: HEAD storage suite = 148 tests (recounted
per-file from committed sources: capabilities 6, configuration 24,
envelope 13, errors 8, identifier 6, initialization 14, layout 9, limits
10, metadata 12, probe 6, root 10, static-guard 16, taxonomy 7,
trusted-input 7); current = 197; delta +49 (audit 5, locks 7, publication
11, read 6 = 29 new-file tests; capabilities +8, initialization +5,
taxonomy +1, static-guard +3, trusted-input +3 = 20 modified-test
additions). The report's `197 − 148 = 49` ground truth is correct; the
report's per-file component breakdown contains a count defect — see
MINOR-1.

## 22. Package and Build Invariants

`package.json` changed only by adding `"test:storage-crash"` (verified by
diff: one added line; dependencies, devDependencies, exports, `files`,
and all existing scripts unchanged; license/name/version untouched).
`package-lock.json` unchanged. Build schema/input behavior unchanged (51
schemas, 358 corpus inputs — same as baseline generation). Published
surface unchanged (42 exports; `"."`, `"./pi-adapter"`; no storage
reference in `src/index.ts` or `dist/index.d.ts`).

## 23. Status and Implementation Report

- The implementation report distinguishes the task-local 32-path delta
  (§2) from the complete 38-path working-tree inventory (§17); no wording
  finding.
- Roadmap and planning-status identify WP-8-D implementation as complete
  but **not accepted**, with the next gate the senior implementation
  review; staging and commit unauthorized; WP-9 and later unauthorized
  (verified in the diffs).
- No independent WP-8-C verification claim; no full AUD-001 claim; no
  production publication claim (all three checked).
- The report's test counts, skip reconciliation, deviation record (lock
  allowlist `readFileSync`; initialization-test fixture change; D-1) and
  Git-state section are accurate except the capabilities +7/+8 count and
  the §14 parenthetical arithmetic (MINOR-1).

## 24. Requirement Coverage

Member-by-member audit of the accepted allocation (implementation +
tests as direct evidence; no unsupported "covered by suite" claims):

- **WPR-001…008, 010, 012…015, 018…022:** implemented and directly tested
  (validation-before-persist; canonical bytes; temp exclusivity; hard-link
  protocol with no rename; temp fsync+verify; EEXIST verification;
  dir-sync order; durability-point gating; WPR-010 audit at the durability
  point; idempotency; one-record atomic unit; trusted action identity;
  hard-link failure mapping; crash-after-link validity; durability-unknown;
  cancellation/timeout; verify-before-idempotent; permission policy; stage
  failure semantics). WPR-009 (index) vacuous/IL; WPR-011/016 quarantine
  halves and WPR-023 → phase 4 (documented, harness asserts input states).
- **LOK-001…006, 008, 009, 011…015, 017, 018:** implemented and tested
  (single writer; reader safety; published-only reads; fixed lock path;
  exclusive creation + record fields; nonce+store identity; fail-closed
  liveness; never break; bounded wait; cancellation; identity-bound
  release + dir fsync; crash persistence; PID-reuse defense; revision
  rule; repository-lock irrelevance). LOK-007 (stale classification used
  to mutate), LOK-010, LOK-016 → phase 4 (documented).
- **RDS-001…004, 008…012:** implemented and tested. RDS-005…007 → phase 4.
- **CAP-001** (write/read/verify issuance; recovery/retention/migration
  remain vocabulary), **CAP-002…007, 010…016, CAP-008/009** (four
  boundaries): implemented and tested (TVR-014 hostile channels +
  invalidation boundaries).
- **TAU-004/005/007, API-004** (zero-producer posture), **AUD-001 partial**
  (I/T `authorized-write`; IL deferred kinds, human-acknowledged D-12),
  **AUD-002…007, 013**: implemented and tested.
- **FSP-001…015** (publication/read subset), **ITG-003**, **VRS-003**,
  **SRE-006, 008…015**: implemented and tested; SRE-001…005/007
  regression re-run (default workflow).
- **TVR-001/002** (crash injection at every write stage — see NOTE-3 for
  the temp-creation window), **TVR-005** (WP-8-D subset), **TVR-006** (14
  applicable limits exact/+1 via the committed limits suite), **TVR-007…
  015**: covered by the new suites and the committed guard.
- **D-2, D-3, D-5, D-6, D-7 (with the MINOR-2 gap), D-8, D-12**:
  implemented as bound by ADR-029. **M-1…M-4 correction policies:**
  M-1 (provisioning authority pinned, initialization-family operation,
  single consumer) ✓; M-2 (five-state classifier) ✓ with the state-D
  clause gap (MINOR-2); M-3 (canonical array rules) ✓; M-4 (current
  status) ✓.
- **Error disposition:** 28 codes exercised directly + 3 regression-only
  (RECOVERY-REQUIRED, RECOVERY-FAILED, RETENTION-DENIED) = 31; no new
  code; precedence unchanged.

## 25. Findings, Blockers, Deviations

**Findings:**

- **MINOR-1 — implementation-report count defect.** The report (§2, §14)
  states capabilities "+7 tests"; the actual delta is **+8** (committed
  6 → current 14, verified per-file and by the diff's eight new test
  declarations). Additionally, the §14 parenthetical component
  enumeration does not sum to its own stated 49 (the ground-truth
  `197 − 148 = 49` is correct and was reproduced). Bounded evidence/count
  defect; no functional impact. Correction: restate capabilities +8 and
  the component sum.
- **MINOR-2 — classifier state-D clause not fully implemented.** Per the
  accepted D-7 five-state matrix, state D includes "wrong type/UID/mode at
  a fixed path"; `classifyNamespace` verifies only the namespace-root
  descriptor and entry **names**. Empirically verified: a `0600` regular
  file at `store-v1/records` (wrong type and mode for a fixed directory
  entry) classifies `PROVISIONAL` with `unknownEntries: false` (with
  verified metadata it reaches `INITIALIZED`), not the matrix's fail-closed
  FOREIGN. Every subsequent mutation path still fails closed
  descriptor-bound (provisioning and class/shard creation reject
  wrong-type/UID/mode objects), so no authority or mutation boundary is
  breached — the gap is classification fidelity vs. the accepted policy.
  Correction: extend `classifyNamespace` to verify the type/UID/mode of
  the fixed entry objects (or explicitly bound the state-D clause to the
  provisioning boundary in the ADR via human acknowledgment).
- **MINOR-3 — SCP-005 guard assertion skips relative import specifiers.**
  The storage↔WP-7 no-import test continues past every specifier starting
  with `.` or `/`; all repo-internal imports are relative, so the
  assertion can never fail on a hypothetical `import … from
  '../../reader/fs.js'` inside storage. No such import exists today
  (grep-verified: storage imports only `src/storage/**`, `src/json/**`,
  `src/canonical/**`, `src/trusted/configuration-brand.js`), so this is a
  test-assertion coverage gap, not a current violation. Correction:
  resolve relative specifiers lexically (or via the compiled graph) before
  applying the no-import rule.

**Blockers:** none.

**Deviations (recorded by the implementation, verified):**
(1) the lock-module allowlist refinement (descriptor-bound `readFileSync`)
— genuinely required for LOK-013, exact-module-only, covered; (2) the
initialization-test unknown-entry fixture change — required by the
human-approved D-7 classifier-policy revision; the test remains
meaningful; (3) D-1 (eligibility input path substitution) as documented
in the decision package. The contract, all ADRs, `src/index.ts`, and
`package-lock.json` are untouched.

**Notes (verified, non-blocking):**

- **NOTE-1 — lock-release read is descriptor-bound but not size-bounded
  before allocation.** `readFileSync(fd)` in `releaseWriterLock` has no
  pre-read size check (the parse is bounded by `LOCK_RECORD_MAX_BYTES`
  after allocation). Practical exposure is nil under the accepted threat
  model (file confined to a store-owned `0700` directory; written only by
  this module at ≤4096 bytes; same-UID actors are outside the guarantee
  per TML). Not a security finding under the stated criteria
  (descriptor-bound, no path-based reread). A pre-read size check would
  harden it.
- **NOTE-2 — read/verify issuance requires an in-process generation
  entry.** `createReadCapability`/`createVerifyCapability` observe the
  per-process generation registry without creating an entry
  (`allowCreate=false`); empirically verified that a fresh read-only
  process against an already-initialized store fails closed with
  `ERR-STO-REQ-INVALID` ("read capability could not be issued") until a
  mutation-capable path seeds the registry in that process. Deliberate and
  tested, fail-closed, but the fresh-process consequence is undocumented;
  WP-9 integration must seed the registry or revisit the model.
- **NOTE-3 — no distinct kill stage between temp creation and the first
  write.** The 11-stage kill inventory covers the contract's write-stage
  windows; the temp-created state is included in the `primary-written`
  kill (identical post-crash classification asserted), but a dedicated
  `primary-created` stage is not staged. The report's §12 claim of a
  "temp creation" kill stage slightly overstates the inventory.
- **NOTE-4 — taxonomy test order assertion is order-sensitivity-by-sort.**
  The D-6/M-3 "exact declared order" assertion checks the array equals its
  own sorted form (the declared order is required to be sorted); a
  non-sorted but fixed declared order would not be distinguished. Bounded
  assertion-form observation; the audit profile's declared order is
  correct.

## 26. Acceptance Determination

- Complete inventory: **established** (38 pre-review; 39 post-review).
- Every changed path: **authorized**.
- All required source: **present**.
- Production write authority: **unreachable** (zero producers, guard- and
  grep-proven).
- Capabilities: **non-forgeable** (distinct WeakSet domains; hostile
  channels rejected; tested).
- Provisioning/classification: safe under concurrency and crash; the
  five-state classifier has the bounded state-D clause gap (MINOR-2).
- Lock acquisition/release: **identity-bound** (nonce + store instance;
  never breaks).
- Publication: **immutable, crash-truthful** (hard-link no-replace; no
  rename; truthful durability tuples).
- Audit: **durable, deterministic, non-authoritative** (authorized-write
  only; D-8 identity; D-12 partial allocation).
- Reads: **descriptor-bound, non-mutating**.
- Filesystem authority: **exact** (allowlists; fs-free audit/composition).
- Static/global guards: fail-closed for every tested syntax form; the
  SCP-005 relative-specifier coverage gap (MINOR-3) remains.
- All 19 crash stages: **executed twice** with identical inventory.
- Every required test: **passes** (all claimed totals reproduced).
- The single skip: **legitimate** (pre-existing, privilege-gated, not
  forced).
- Contract/package/export/dependency invariants: **hold**.
- Open findings: **three MINOR findings remain** (MINOR-1, MINOR-2,
  MINOR-3).

Because the acceptance standard requires **zero open findings**, and three
bounded MINOR findings (one report-count defect, one classifier state-D
fidelity gap, one guard-assertion coverage gap) remain open, the verdict
is **CORRECTIONS REQUIRED**. No blocker, critical, major, or moderate
finding exists; every security-critical claim (production write authority
unreachable, capability non-forgeability, immutable no-replace
publication, identity-bound locking, durable deterministic audit,
descriptor-bound reads, exact fs ownership, fail-closed guards, all
crash windows executed twice) was independently verified and holds.

---

## Final Report

- **Repository, branch, HEAD:** `/home/chef/Documents/Project_Gateway_MCP`,
  `main`, `bd832606ece489a924b4fcc13ad55789fcb0736f`
  (`feat: establish WP-8-C trusted storage bootstrap`, parent
  `05904e46ded384bab5f250ac72c2734539f1e86f`).
- **Governance-waiver result:**
  `WP-8-C INDEPENDENT COMMIT VERIFICATION: SKIPPED BY HUMAN DIRECTION` —
  recorded as a governance fact; no independent verification of the
  WP-8-C commit, its manifest, or its commit report is claimed.
- **Task-local path inventory:** 32 paths (9 new source, 7 modified
  source, 6 new tests, 6 modified test/package, 1 optional test, 3
  implementation documentation) — verified exact.
- **Complete pre/post-review working-tree inventory:** 38 paths before
  this report (29 source/test/package + 9 documentation); **39 paths**
  after.
- **Path-authorization result:** every changed path authorized; no
  envelope violations; contract/ADR/`src/index.ts`/lockfile untouched.
- **Source architecture:** layered capability-gated composition;
  `publication/index.ts` the private write boundary (fs-free);
  `publish-record.ts` the sole publication substrate; `write-audit.ts`
  fs-free; `locks/lock.ts` the sole lock owner and D-3 exception module;
  `read-record.ts`/`enumerate.ts` the read owners; barrels export no
  creators; no WP-7 imports.
- **Production-reachability result:** **UNREACHABLE** — zero production
  `StorageWriteActionProvenance` producers; no ambient issuance; no
  runtime test hook; test-only producers confined to `dist-test/**`; no
  export path.
- **Capability result:** distinct WeakSet domains; cross-kind/structural/
  clone/Proxy/reflection/detached-method failures tested; generation and
  disposal enforced; full binding tuple; exact creator-consumer graph; no
  creator export.
- **Classifier result:** five states implemented and tested with one
  bounded gap — wrong type/UID/mode at a fixed entry path is not detected
  by `classifyNamespace` (MINOR-2); policy not caller-selectable;
  versions unchanged; no migration; downgrade fail-closed.
- **Provisioning result:** initialization-family `provision-phase3`
  before lock acquisition; exact top-level targets, mode `0700`, UID,
  descriptor-bound verification, EEXIST-idempotent; class/shard creation
  under the live `WriteCapability` after lock; crash-partial retryable.
- **Lock result:** fixed path; exclusive no-follow `0600`; canonical
  bounded record with nonce/store/action-digest/PID/injected time fields;
  file+dir fsync; bounded wait/timeout/cancellation; identity-bound
  release; no lock breaking; crash persistence; deviation (`readFileSync`)
  evaluated — required, descriptor-bound, covered (NOTE-1).
- **Publication result:** normative 10.1 order; no overwrite; no rename;
  no adoption; no rollback; success only after the full durability point.
- **CAP-009/partial-success result:** all four boundaries mapped and
  tested; truthful tuples; no false rollback; durable primary
  authoritative; missing audit → durability class; containment limited to
  exact owned transient state.
- **Existing-target/temp-EEXIST result:** all classes handled per
  10.2/18.2; MINOR-2 retry protocol fully implemented and tested; no new
  error code; stale temp left for phase 4.
- **Audit result:** only `authorized-write`; D-8 deterministic identity
  (`pgw:l:<32-hex>`, domain-separated, no nonce/PID/path/counter/
  capability identity); no stored sequence; stable ordering; idempotent
  retry; no recursion; evidence non-authoritative; no full AUD-001 claim;
  `write-audit.ts` fs-free.
- **Taxonomy result:** scalar-to-array migration complete and correct
  (M-3); only the audit profile has two members; no runtime sorting; all
  consumers updated; no format impact.
- **Read result:** canonical class/identity input; descriptor-bound
  no-follow; pre/post fstat; bounded read; duplicate-key rejection;
  digest + location verification; copy-on-return; no mutation.
- **Verify/enumeration result:** structured findings, no authority, no
  repair; class-scoped, bounded, deterministic, continuation-correct,
  independently verified candidates, no registry resolution, no path
  disclosure; `enumerate.ts` the sole scan owner.
- **Filesystem ownership result:** exact importer set and per-module
  allowlists; fs-free audit/composition/barrels; no namespace/default/
  dynamic/renamed imports; no fs-name exports; read-tree mutation denial.
- **Static-guard result:** 19/19; allowlists, creator edges, zero-producer
  edges, D-3 exception with negative leakage, read mutation denial,
  storage↔WP-7 rule (relative-specifier coverage gap — MINOR-3), no
  creator re-export, later-phase denial, synthetic bypass coverage.
- **Global-delegation result:** exact four new compiled paths; nine total;
  no blanket exclusion; fail-closed predicate; 15/15.
- **Crash-harness result:** 11 kill stages (`lock-dir-synced`,
  `primary-written`, `primary-fsynced`, `primary-linked`,
  `primary-dir-fsynced`, `primary-unlinked`, `primary-tmp-synced`,
  `audit-written`, `audit-linked`, `audit-synced`, `lock-released`) and 8
  behavior stages (`temp-exists-idempotent`, `temp-exists-audit-missing`,
  `zero-progress-write`, `partial-write`, `cap-invalid-boundary-1`,
  `cap-invalid-boundary-2`, `cap-invalid-boundary-3`,
  `root-drift-boundary-4`); 5/5 twice with executed counts asserted;
  marker-proven reach; no sleep-only pass; no orphans; isolated roots.
- **Test commands and actual totals:** typecheck pass; build pass (51
  schemas, 358 corpus); tests-tsc pass; storage 197/196/1 twice; static
  guard 19/19; global security 15/15; crash 5/5 twice; security 15/15;
  unit 169/169; combined 366/365/1; default 1358/1358; WP-7 165/165;
  contract hash exact; deps ajv-only; exports 42; package exports exact;
  `git diff --check` clean.
- **Package/build invariants:** one script added; everything else
  unchanged; published surface unchanged.
- **Status/report result:** implementation report and status documents
  accurate and consistent (except MINOR-1); complete-but-not-accepted;
  next gate correctly identified; staging/commit/WP-9 unauthorized.
- **Requirement-coverage result:** WPR/LOK/RDS/CAP/TAU/API/AUD/FSP/ITG/
  VRS/SRE/TVR rows supported by direct implementation and test evidence;
  D-2/D-3/D-5/D-6/D-7 (state-D gap)/D-8/D-12 and M-1/M-3/M-4 implemented;
  M-2 with MINOR-2.
- **Findings by severity:** BLOCKER 0; CRITICAL 0; MAJOR 0; MODERATE 0;
  **MINOR 3** (MINOR-1 report count defect; MINOR-2 classifier state-D
  clause; MINOR-3 SCP-005 relative-specifier coverage); NOTE 4.
- **Required corrections:** (1) restate capabilities +8 and the §14
  component sum in the implementation report; (2) extend
  `classifyNamespace` to verify fixed-entry type/UID/mode (or obtain a
  human-acknowledged scoping of the state-D clause); (3) make the
  storage↔WP-7 no-import assertion resolve relative specifiers.
- **Blockers:** none.
- **Deviations:** the recorded three (lock allowlist `readFileSync`;
  initialization-test fixture; D-1) — all verified as documented.
- **Implementation-acceptance result:** **CORRECTIONS REQUIRED** — the
  implementation itself is verified sound on every security-critical
  property; three bounded MINOR findings must be corrected (or
  human-dispositioned) before acceptance.
- **Exact next gate:** human disposition of the three MINOR findings and
  the correction cycle, followed by re-review and human authorization of
  WP-8-D implementation acceptance and commit preparation.
- **Exact verdict:**

`WP-8-D SENIOR IMPLEMENTATION SECURITY AND ARCHITECTURE REVIEW: CORRECTIONS REQUIRED`
