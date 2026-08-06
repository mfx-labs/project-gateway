# WP-8-D — Senior Decision-Resolution and ADR Review

**Review type:** adversarial, read-only senior review of the WP-8-D
decision-resolution package: ADR-029, the decision-resolution report, the
corrected pre-implementation consolidation report, and the current-state
planning documents.
**Primary inputs:** `docs/decisions/ADR-029-wp-8d-publication-locking-and-audit-policy.md`,
`docs/reports/wp-8d-decision-resolution-report.md`,
`docs/reports/wp-8d-pre-implementation-decision-consolidation-report.md`,
`docs/reports/wp-8d-senior-pre-implementation-security-and-architecture-review.md`,
`docs/design/post-wp5a-roadmap.md`, `docs/design/post-wp5a-planning-status.md`.
**Independently checked:** the authoritative WP-8 contract (SHA-256
`aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f`, read in
full), ADR-028, committed `src/storage/**` (taxonomy, provision/state,
errors/codes + precedence, capabilities, trusted-input, layout, limits,
root), committed `tests/unit/storage/**` (static-guard, taxonomy),
`tests/security/security.test.ts`, package/export configuration, and the
WP-8-C implementation report. No file other than this report was created
or modified; nothing was staged or committed.

---

## 1. Repository, Branch, HEAD, and Complete Inventory

| Item | Expected | Verified |
|---|---|---|
| Repository | `/home/chef/Documents/Project_Gateway_MCP` | exact |
| Branch | `main` | exact |
| HEAD | `bd832606ece489a924b4fcc13ad55789fcb0736f` | exact |
| HEAD subject | `feat: establish WP-8-C trusted storage bootstrap` | exact |
| HEAD parent | `05904e46ded384bab5f250ac72c2734539f1e86f` | exact |
| Staging | empty | empty (`git diff --cached` empty) |
| Commits after HEAD / tags | zero / zero | zero / zero |
| Source/test delta | zero | zero (`git diff HEAD -- src/ tests/` empty; no untracked source/tests) |
| Contract delta | zero | zero (byte-identical, SHA-256 exact) |
| Previous-ADR delta | zero | zero (ADR-028 and earlier untouched; ADR-029 is new) |
| Dependencies | `ajv@8.20.0` only | exact |
| Public exports | 42 | 42 |
| Package exports | `"."`, `"./pi-adapter"` | exact |
| Production initialization | unreachable | unreachable (action-provenance creator has zero production importers) |
| Production write publication | absent | absent (no write producer, no write capability issuer, no publication source; `src/storage/{publication,read,audit,locks}` absent; `src/control-plane/` absent) |
| WP-8-D implementation source | none | none |
| WP-9 work | none | none |

**Task-local decision-resolution delta (five paths):**
`docs/decisions/ADR-029-wp-8d-publication-locking-and-audit-policy.md` (new),
`docs/reports/wp-8d-decision-resolution-report.md` (new),
`docs/reports/wp-8d-pre-implementation-decision-consolidation-report.md`
(corrected),
`docs/design/post-wp5a-roadmap.md` (modified),
`docs/design/post-wp5a-planning-status.md` (modified).

**Complete uncommitted WP-8-D package before this review (exactly six
paths):** 1. `wp-8d-pre-implementation-decision-consolidation-report.md`;
2. `wp-8d-senior-pre-implementation-security-and-architecture-review.md`;
3. `ADR-029-wp-8d-publication-locking-and-audit-policy.md`;
4. `wp-8d-decision-resolution-report.md`;
5. `post-wp5a-roadmap.md`; 6. `post-wp5a-planning-status.md` — all six
present, nothing else in the working tree. **After creating this review
report, the complete inventory is exactly seven documentation paths.**

## 2. Governance Waiver Result

**WP-8-C INDEPENDENT COMMIT VERIFICATION: SKIPPED BY HUMAN DIRECTION**

Recorded as a governance fact. This review does not claim that the
baseline commit `bd832606…`, its complete file manifest, or its commit
report was independently verified. ADR-029 and the decision-resolution
report each record the waiver accurately and claim no independent
verification.

## 3. ADR Status and Authority Result

**CONTRACT-SUBORDINATE; ACCEPTED VIA HUMAN DECISION ONLY.** Verified:

- ADR-029 status is "Accepted (human decision resolution)" — accepted
  because of the externally granted human approval of the seven decisions
  (D-2, D-3, D-5, D-6, D-7, D-8, D-12), recorded as such; nothing in the
  ADR claims acceptance by any other authority.
- Normative for WP-8-D implementation policy — stated; the ADR binds the
  seven decisions and their implementation constraints.
- Subordinate to the contract — stated explicitly; the contract is
  recorded byte-identical (SHA-256 exact, verified by this review).
- Does not modify or reopen DS-01…DS-29 — no DS row is altered; D-8's
  "contract revision NOT REQUIRED" is a determination, not a change;
  D-9 records DS-10's reopen gate as a future possibility without
  exercising it.
- Does not authorize implementation — explicit in Status, Scope,
  Implementation Gate, and Consequences.
- Preserves D-9 and D-11 as deferred — verified (Deferred Decisions
  section; both remain unselected, with the configuration phase as the
  reopen owner).
- Records the WP-8-C verification waiver accurately — verified (§2).
- No wording lets the ADR override the contract — every decision block
  cites contract sections and stays within implementation-policy scope.

## 4. Seven-Decision Consistency Table

Cross-checked per decision across: consolidation register (§22), ADR-029,
decision-resolution report (§4), roadmap, planning status. **No hidden
additional decision was introduced** except the `{provision-phase3}`
capability element inside D-7, whose authority model is under-specified
(see M-1).

| Decision | Selected option matches human authorization | Rejected alternatives recorded | Consequences complete | Implementation constraints testable | Consolidation / ADR / resolution agree | Roadmap / planning status agree |
|---|---|---|---|---|---|---|
| D-2 zero production write authority | yes | yes (3) | yes | yes (static-guard zero-importer edge) | yes | yes |
| D-3 locks-only entropy/process exception | yes | yes (3) | yes | yes (allowlist + negative leakage tests) | yes | yes |
| D-5 verified-StoreMetadata binding | yes | yes (3) | yes | yes (binding tuple; distinct domains) | yes | yes |
| D-6 taxonomy `Wp8Production[]` amendment | yes | yes (3) | yes | yes (taxonomy + static-guard + test updates) — see M-3 | yes | yes |
| D-7 phase-3 entry set + provisioning sequence | yes | yes (3) | yes | partial — see M-1 (provisioning capability), M-2 (classification) | yes | yes |
| D-8 deterministic audit identity/ordering | yes | yes (3) | yes | yes (identity tuple; retry scenarios) | yes | yes |
| D-12 partial AUD-001 allocation | yes (human-acknowledged) | yes (2) | yes | yes (I/T + IL rows; acceptance criteria) | yes | yes |

## 5. D-2 — Production Authority Result

**NON-AMBIENT; UNREACHABLE.** Verified: zero production
`StorageWriteActionProvenance` producers (the creator exists only in
`src/storage/trusted-input/bootstrap-input.ts`; the static guard enforces
zero production importers across all `src/**`); the future path
`src/control-plane/storage-write-action.ts` is static policy only, does
not exist, and is never created by WP-8-D; no public/package export (the
private storage barrel exports no creators; `src/index.ts` has zero
storage references); no runtime test hook (test-only producers compile
into `dist-test/**` only; the package `files` field ships `dist` only, so
test output cannot leak into the package); no ambient minting
(environment/request/repository/artifact/argv/cwd/UID-only/structural
objects are all non-constructive because the only creation path requires a
genuine branded `TrustedWriteRequest` holding genuine branded write-action
provenance). **`src/storage/publication/index.ts` as the future production
consumer of the capability and trusted-request creators creates no
authority by itself:** the creators' gates require the genuine branded
operands; importing a creator confers no minting authority (the
established WP-8-C precedent for `initialize.ts`). Production publication
remains unreachable. **Result: PASS.**

## 6. D-3 — Entropy and Process Identity Result

**EXACTLY SCOPED; NON-AMBIENT.** Verified against the committed guard
(`Math.random`, `crypto.random*`, `randomUUID`, `process.pid`, `Date.now`,
`process.hrtime`, `process.env/cwd`, timers all blanket-denied in
`src/storage/**`): the exception is granted to the exact module
`src/storage/locks/lock.ts` only, allowing the named `randomBytes` import
from `node:crypto` and `process.pid`; everything else stays denied
(namespace/default/dynamic crypto imports; `randomUUID`; `Math.random`;
environment-derived nonces; action-derived nonces; direct `Date.now`;
direct `process.hrtime`; unbounded `/proc` access — no production `/proc`
read exists in WP-8-D). Injected values (process start time, acquisition
clock, optional boot identity): **no production trust source exists in
WP-8-D** — with zero production producers and zero production consumers of
the lock module, the injection seam has no production caller; the future
trust source is the trusted control-plane composition root only, and the
values are non-authority lock-record fields (they cannot mint write
authority, which requires the genuine capability + provenance chain).
They cannot be supplied by raw request, record payload, repository,
artifact, environment, or an untrusted composition caller: the only
production composition boundary is the future trusted control plane, and
the static guard denies environment/process access everywhere else. Test
injection is parameter-based with deterministic defaults; no test-only
code compiles into `src/**` or `dist/**`. Production defaults are safe:
the seam is an explicit injection parameter, so a future production caller
must supply values (fail-closed if absent); no ambient default is
introduced. Boot identity is recorded absent/"where available" (12.3) with
the field reserved for phase-4 parsing (senior-review NOTE-3 preserved).
**Result: PASS** (with the bounded recommendation in N-3).

## 7. D-5 — Capability Binding Result

**NON-FORGEABLE; COMPLETE.** Verified: all write/read/verify capabilities
require a genuine branded input (`TrustedWriteRequest` for write; the
verified-metadata result for all), fully verified StoreMetadata
(descriptor-bound read, canonical parse with duplicate-key rejection,
payload/record digest verification, namespace/parent/configuration/
limit-profile identity verification), descriptor-bound identity
verification, configuration and limit-profile correlation at admission
(CAP-008), correct operation set, generation (per-store registry reuse;
configuration replacement advances generation), lifetime/disposal.
Distinct authenticity domains: separate module-private `WeakSet`s inside
the existing two brand-bearing modules (no new brand-bearing module, no
shared/interchangeable brand, no cross-kind substitution — verified
against the committed `authenticity.ts` and `bootstrap-input.ts` patterns);
no structural binding; no raw-metadata-byte binding (the verification
pipeline result is the operand, W8C-S01 precedent); no direct creator
re-export (guard rule verified); exact creator-consumer graph
(`createWriteCapability` → `publication/index.ts` only; trusted-write-
request creator → the same; write-action-provenance creator → zero
production importers; read/verify creators → read composition, zero
production callers); disposal and mid-operation invalidation per
CAP-008/009 at all four boundaries. The ADR-028 decision-C gate ("future
capabilities may bind to verified metadata only after later human
authorization") is exercised by the WP-8-D human authorization — correctly
recorded. **Result: PASS** for write/read/verify. The `{provision-phase3}`
capability is reviewed separately (M-1).

## 8. D-6 — Taxonomy Compatibility Result

**INTERNAL SOURCE-SHAPE CHANGE; COMPLETE; CONTRACT-REVISION NOT REQUIRED.**
Verified against the committed source: `Wp8Production` is consumed only by
`src/storage/format/taxonomy.ts` (the union + 7 profile literals: 12
lifecycle classes via BASE `'no'`, `authoritative-audit-event`
`'reconstruction-only'`, `registry-snapshot` `'no'`, `store-metadata`
`'initialization'`, `store-evidence-record` `'maintenance'`,
`configuration-snapshot-record` `'no'`) and by
`tests/unit/storage/taxonomy.test.ts` (four scalar assertion sites: the
`'no'` loop over all classes, `'maintenance'`, `'initialization'`,
`'reconstruction-only'`). The scalar→array change therefore requires:
the union gains `'write-audit'`; the field type becomes
`readonly Wp8Production[]`; every existing profile becomes a one-element
array (`['no']`, `['initialization']`, `['maintenance']`,
`['reconstruction-only']`); only `authoritative-audit-event` gains
`'write-audit'` → `['reconstruction-only', 'write-audit']`; the four test
assertion sites update to array form. No other consumer exists. The change
alters no persisted bytes, digest, validation schema, package export (42
unchanged; the storage barrel is private), or contract behavior — it is an
internal phase-model shape change, so **no contract revision is
defensible or required**. The envelope's "taxonomy test updated for the
D-6 amendment" covers the four sites. **Result: PASS** (one bounded
determinism pin: see M-3 — fixed declared array order and no-duplicate
rule must be stated and test-enforced).

## 9. D-7 — Phase-3 Entry-Set and Classification Result

**DIRECTION SOUND; CLASSIFICATION MODEL UNDER-SPECIFIED (M-2); PROVISIONING
CAPABILITY AUTHORITY MODEL UNDER-SPECIFIED (M-1).**

Verified committed facts: `NAMESPACE_FIXED_ENTRIES = ['metadata','tmp']`;
`classifyNamespace` returns FOREIGN for any unknown entry, and for missing
fixed entries returns `hasVerifiedMetadata ? 'FOREIGN' : 'PROVISIONAL'`.

**Trusted source of the expected phase/classifier policy:** the fixed
entry constant is committed layout-version-bound software policy inside
`src/storage/initialization/provision.ts`; it is never selectable by an
untrusted request (no request material enters path or policy derivation;
FSP-001/002). The amendment is an authorized, reviewed source change
(D-7) — the trusted source remains the committed code, not any operand.
**Result: PASS.**

**Five-state distinction (required by this review, not yet precise in the
package):**

| Store state | Entries | Verified metadata | Required classification |
|---|---|---|---|
| Phase-2 initialized | `{metadata, tmp}` | yes | **upgradeable** (phase-2-initialized) — NOT FOREIGN |
| Phase-2 store being upgraded | `{metadata, tmp}` (+ provisioning in progress) | yes | upgradeable (provisioning idempotent) |
| Incomplete phase-3 | subset of F3 containing some of `{records,audit,locks}`, correct types, no unknowns | yes | upgradeable/provisional — deterministic retry continues provisioning |
| Foreign | unknown entries; wrong-type/UID/mode at fixed paths; `index/`/`quarantine/` present (phase-4-owned) | any | FOREIGN (fail closed) |
| Phase-3 initialized | `{metadata,tmp,records,audit,locks}` | yes | INITIALIZED |

**The package's claim is inaccurate against the committed classifier:**
ADR-029 states a phase-2-initialized store "is upgradeable/provisional,
not foreign (missing fixed entries → PROVISIONAL under the committed
classifier semantics…)". Under the committed semantics, missing fixed
entries with **verified** metadata → **FOREIGN** (provision.ts line 229).
A phase-2 store has verified metadata. The amendment therefore requires an
explicit new rule — "entries ⊆ phase-3 set, no unknown entries, missing
only phase-3 members → upgradeable/PROVISIONAL **regardless of the
metadata-verification flag**" — which the package does not state. Without
that rule, a partial entry set (crash between directory creations) or a
phase-2 store classifies FOREIGN and the deterministic retry path is
broken — the exact model the task requires rejecting.

**Same metadata bytes, different classification across software
versions:** yes — the same StoreMetadata (format `'1'`, layout `'v1'`,
unchanged payload) is classified with the pre-amendment fixed set by
committed software and the amended set by WP-8-D software. The metadata
never recorded the entry set, so no stored fact is contradicted; this is
deterministic reviewed software policy, **not** a stored phase/version
fact, and does not require one **provided** the upgrade/downgrade
determinism is stated: (a) upgrade — old stores classify upgradeable under
new software; (b) downgrade — pre-amendment software on a phase-3 store
classifies FOREIGN (fail-closed, no reinterpretation; VRS-008-safe).
The package's phrase "the accepted entry set is bound to the
layout/metadata version" is inaccurate (the version does not change); it
is bound to the classifier policy revision. Contract-permitted (5.2's
seven-directory structure is already normative; LAY-001/LAY-002 bind the
layout version, which is unchanged for both policies) — **no contract
revision and no stored phase fact is required**, but the matrix and the
policy-revision wording must be corrected (M-2).

**Lazy provisioning review:** top-level dirs exact (`<ns>/records`,
`<ns>/audit`, `<ns>/locks`); before-lock mutation is correct (the lock
lives at `<ns>/locks/writer.lock`, so `locks/` must pre-exist — no
circular dependency); capability boundary = the distinct provisioning
capability (M-1); concurrent first-use attempts: two in-process operations
may both attempt mkdir → second gets EEXIST → must enter the committed
descriptor-verification path (idempotent; the WP-8-C `provision.ts`
pattern) rather than fail — this must be stated explicitly; crash between
directory creations → partial set → upgradeable classification (matrix
above) → deterministic retry; wrong-type/UID/mode → fail closed
(`ERR-STO-FTYPE-UNSUPPORTED`/`ERR-STO-PERM-DENIED`), no repair, no
adoption, no deletion — verified as stated. StoreMetadata format/layout
unchanged; no migration semantics — consistent. **Result: CORRECTIONS
REQUIRED (M-1, M-2).**

## 10. D-8 — Audit Identity and Ordering Result

**DETERMINISTIC; IDEMPOTENT; CONTRACT-SUBORDINATE; COHERENT WITH D-12.**

Verified tuple: store/namespace identity (both verified namespace
identities), primary class, primary instance/revision identity (record id
+ revision), primary digest, event kind (`authorized-write`), trusted
action identity. Canonical serialization RFC 8785 JCS after
duplicate-key rejection (committed WP-2…WP-4 rule); new domain-separated
digest domain (established `STORAGE_*_DIGEST_DOMAIN` pattern); output
syntax `pgw:l:` + 32 lowercase hex (committed
`ACCEPTED_IDENTIFIER_PREFIXES` includes `pgw:l:`; no new identifier
profile); same-tuple idempotency (identical identity → identical canonical
bytes → EEXIST → exact-match verification → contract-permitted idempotent
result); collision handling via the existing-target machinery (no new
code); **no counter, nonce, PID, path, or capability object identity in
the input** — verified.

**Scenario analysis:**

- **A. Same primary, same action, retry:** same tuple → same identity →
  EEXIST → exact-match → idempotent result. **No new event emitted** — the
  retry verifies the existing audit target (MINOR-2 protocol step 4).
- **B. Same primary, different action:** different tuple (action identity
  is an input) → different event identity. Unreachable as a new
  publication: the second action's primary link hits EEXIST and aborts at
  existing-target classification before the audit stage. In the retry
  verification branch, the "required audit target" is the caller's tuple;
  absent → `ERR-STO-DURABILITY` verify-required (fail-closed, never
  fabricated). **Including the trusted action identity does NOT cause
  multiple authorized-write events for the same already-published primary
  record** — single-writer semantics (DS-01/12.1) plus the EEXIST abort
  guarantee at most one event per primary; retries verify, they never
  emit.
- **C. Same primary, later idempotent-duplicate attempt:** emits **no new
  `authorized-write` event** in WP-8-D (the existing event is verified);
  the `idempotent-duplicate` event kind itself is **deferred entirely to
  phase 4** (D-12). No evidence is silently lost (the original
  authorized-write event remains the record of the write) and AUD-001 is
  not broadened — the deferral is explicit and human-acknowledged.
- **D. Conflicting bytes under the same primary identity:** different
  bytes at the same event identity (or same primary identity) →
  `ERR-STO-DUPLICATE`/`ERR-STO-CONFLICT-REVISION` per 10.2/18.2.
- **E. Primary durable, audit missing:** `ERR-STO-DURABILITY` with the
  10.5 audit-row tuple; recovery completes or reconstructs (phase 4);
  WP-8-D never fabricates the event.
- **F. Phase-4 reconstruction:** the audit identity is stable and
  deterministic, so reconstruction can locate/verify the event and derive
  the numeric sequence over the deterministic order with gap markers per
  16.3; no collision with original events.

**Audit time and ordering:** audit `createdAt` = primary `createdAt` —
this is the **primary record's logical creation time** (the producer-
supplied logical time of the write), used because it is deterministic and
idempotent (DTM-007); it is neither a write-attempt wall time nor an
event-mint time. The event never misleadingly claims a later retry or a
different action occurred at the primary's original time: retries emit no
events (A/C), and the event's `trustedActionId` binds the actual action.
No separate observed/action timestamp exists in WP-8-D — **the model does
not need correction**: adding one would require a clock or an injected
value and would break idempotent byte identity; AUD-005's "when" is
satisfied by the primary's logical time, and phase-4 reconstruction uses
recovery time per 16.3 (N-1 records the one-line clarification).
Ordering tuple (primary `createdAt`, primary identity, audit identity)
with the audit identity as total-order tiebreaker is deterministic;
numeric sequence is a later derived view (no stored sequence) —
consistent with AUD-002/003, DTM-003, 6.4, 24.1. **Result: PASS** (N-1,
N-2 clarifications).

## 11. D-12 — Partial AUD-001 Allocation Result

**EXPLICIT; CONSISTENT; NO SILENT DEFERral.** Verified: `authorized-write`
is I/T in WP-8-D (WPR-010/AUD-003 durability point); `idempotent-duplicate`
and `conflict` are explicitly IL (phase 4) — no full AUD-001 conformance
claim remains anywhere in the package (consolidation §21, ADR-029 D-12,
decision-resolution §4/§5 agree); acceptance criteria reflect the partial
allocation (decision-resolution §8/§9; the ADR's Consequences state the
phase-4 obligation); requirement matrices are member-specific
(AUD-001 row splits I/T from IL; no bare range claim). D-8's model does
not accidentally implement or suppress the deferred event kinds: the
authorized-write event is the only kind the write path can emit, and
retries verify rather than emit (scenario C above). **Result: PASS.**

## 12. Same-Action Temporary-Name EEXIST Retry Result

**VERIFIED AGAINST WPR/ERM/10.5; CORRECT.** The protocol (consolidation
§10, ADR-029 constraints, decision-resolution §5) states: no adoption; no
reopen for writing; no unlink as newly owned; bounded no-follow `fstat`
inspection only (wrong type/owner/mode → `ERR-STO-FTYPE-UNSUPPORTED` /
`ERR-STO-PERM-DENIED`, fail closed, no content read, 18.2 precedence);
final primary target and required audit target verified through the
existing-target classification pipeline; primary+audit fully durable and
exact → contract-permitted idempotent result (WPR-012/019); primary
durable/audit incomplete → `ERR-STO-DURABILITY` with the 10.5 audit-row
tuple; neither state provable → `ERR-STO-DURABILITY` with the
unknown-state tuple (WPR-017, ERM-006); **no new error code**; stale-temp
cleanup = phase-4 recovery (WPR-023 class (b)).

**fstat-only sufficiency question:** an `fstat` alone cannot prove the
existing temp inode was created by the current process (post-crash the
original descriptor/inode record is gone) — and the protocol **correctly
does not attempt to establish ownership**. Outcomes are decided entirely
by final-target verification (primary + audit), never by temp identity;
a hostile regular file at the temp name can cause no mutation (no
adopt/reopen/unlink) and no wrong success (the final-target verification
must pass the full invariant set); worst case it forces the fail-closed
or verify-required path and is left for phase-4 quarantine. The bounded
no-follow `fstat` is therefore **sufficient for the protocol's purpose**
(defense in depth against special files/symlinks/owner-mode anomalies),
and no ownership claim is made. One clarification is recorded (N-2: the
"required audit target" is caller-tuple-specific). **Result: PASS.**

## 13. Error Disposition Result

Reconstructed from committed `errors/codes.ts` (31 unique codes; 33
definition entries = 30 single + 3 `ERR-STO-READONLY-FS` phase rows) and
the contract 18.1 table (31 unique codes; 28 single-code rows + 3 EROFS
phase rows):

- **28 exercised directly** — the corrected consolidation table enumerates
  exactly: REQ-INVALID, CONFIG-UNAVAILABLE, ROOT-INVALID,
  ROOT-IDENTITY-CHANGED, CONTAINMENT-DENIED, FTYPE-UNSUPPORTED,
  PERM-DENIED, NOT-FOUND, DUPLICATE, CONFLICT-REVISION, INTEGRITY,
  UNSUPPORTED-VERSION, MALFORMED, DURABILITY, PUBLISH-FAILED,
  LOCK-UNAVAILABLE, LOCK-TIMEOUT, CONCURRENCY, CANCELLED, TIMEOUT,
  INTERNAL-INVARIANT, NO-SPACE, QUOTA-EXCEEDED, READONLY-FS (all three
  phase rows), CROSS-DEVICE, FS-UNSUPPORTED, IO-FAILURE, LIMIT-EXCEEDED
  (28 unique codes, EROFS phase-parameterized per ERM-015).
- **3 regression-only** — RECOVERY-REQUIRED, RECOVERY-FAILED (phase-4
  recovery-gate tier of the committed precedence chain),
  RETENTION-DENIED (phase 5). Neither raised nor returned by any WP-8-D
  operation; the raised-vs-reserved distinction is now stated explicitly
  (MINOR-1 resolved).
- **28 + 3 = 31** — totals equal the closed set; no hidden new code;
  every recovery-required condition in WP-8-D maps to the
  `ERR-STO-DURABILITY` class per 10.5 (never to the reserved gate codes);
  precedence chain unchanged. No contradictory raised/returned/reserved
  description remains. **Result: PASS.**

## 14. Implementation Envelope Result

**BOUNDED; ONE GAP (M-1).** Verified: exact four new filesystem-bearing
modules (`publication/publish-record.ts`, `locks/lock.ts`,
`read/read-record.ts`, `read/enumerate.ts`) with per-module API subsets;
existing `provision.ts` as the fifth filesystem-bearing amendment
(existing allowlist shape unchanged); `audit/write-audit.ts` fs-free
(delegates to `publish-record.ts`; no second publication path); **no
`readdirSync` in exact read** (read-record.ts allowlist excludes it;
NOTE-1 applied); enumeration is the sole directory-scan owner; no new
brand-bearing module (brands stay in the two committed modules); package
change limited to the focused `test:storage-crash` script; no package
export, dependency, or public-index change; no contract or ADR change at
implementation time; every existing-file modification is named (six
extended modules + two amended WP-8-C modules + private barrel). Creator-
consumer paths are exact for write/read/verify and trusted-request
creators, **except** the provisioning-capability creator's consumer is
"the provisioning composition" — a module that does not exist in the
envelope (the envelope names only publication/locks/read/audit
compositions). The provisioning capability's authenticity domain is also
not placed (D-5 names three new domains only). **Result: CORRECTIONS
REQUIRED (M-1).**

## 15. Static-Guard and Global Delegation Result

**IMPLEMENTABLE.** Verified: four exact global-delegation additions
(`storage/publication/publish-record.js`, `storage/locks/lock.js`,
`storage/read/read-record.js`, `storage/read/enumerate.js`) to the
committed `STORAGE_FS_DELEGATED_MODULES` in `tests/security/security.test.ts`,
paired with the dedicated storage static guard (fail-closed predicate and
rejection inventory unchanged; blanket `storage/**` exclusion remains
prohibited, W8C-I01 precedent); corresponding `FS_ALLOWLIST` entries with
exact-name named imports only; the locks-only crypto/process exception
with negative leakage tests; read-tree mutation-API denial; creator/re-
export enforcement (CREATOR_EDGES updates incl. the zero-producer write-
provenance edge; no creator re-export rules unchanged); storage↔WP-7
no-import-edge rule (SCP-005, both directions); later-phase-directory
test releases `publication`, `read`, `audit` and keeps `registry`,
`recovery`, `retention` absent; negative bypass inventory extended
(namespace/renamed/default/dynamic/export-from forms, helper indirection,
wrong-path brands, leakage of the locks exception). All amendments are
within the committed guard's established mechanisms. **Result: PASS**
(provisioning-capability edge naming folds into M-1).

## 16. Requirement Allocation Result

**MEMBER-SPECIFIC; CONSERVATIVE.** Verified the corrected §21 rows:
AUD-001 split I/T (`authorized-write`) + IL (`idempotent-duplicate`,
`conflict`) — partial, human-acknowledged (D-12); SRE-001…005/007 explicit
regression-only (R) rows (NOTE-2 applied); D-6 mapping to TAX-011/RFM;
D-7 mapping to LAY-001/FSP-004/005/008/SRX-006/014/TAX-010; D-8 mapping to
AUD-002/003/DTM-003/007/WPR-012/019 + 16.3 (phase-4 view); same-action
temp-EEXIST retry mapping to WPR-003/012/017/019/ERM-006/10.5 with crash-
harness cases; CAP-008/009 with TVR-014 at all four boundaries; crash
requirements (TVR-001/002, CSA rows deferred) — every range row lists its
members; no broad claim hides a deferred member. **Result: PASS.**

## 17. Status Documents Result

Roadmap and planning status current-state paragraphs are consistent with
the package: next gate = WP-8-D senior decision-resolution and ADR review
(correct); WP-8-D decisions described as human-approved and bound by
ADR-029 (not open); implementation readiness stated as not granted;
WP-9 and later not authorized; the WP-8-C waiver recorded; the "not yet
accepted" phrase for WP-8-C is a waypoint inside the WP-8-C chronology
immediately superseded by "WP-8-C implementation is ACCEPTED" in the same
paragraph (historical-by-sequence; acceptable). The roadmap's WP-7 line is
past tense ("was the current work package"; acceptable).

**One stale-current-state contradiction (M-4):** `docs/design/post-wp5a-planning-status.md`
line 9 still states, unqualified and present tense: "the current work
package is **WP-8-A — Foundation and Contract Consolidation**". It is not
labeled historical, it contradicts the document's own current-state
paragraph (WP-8-D decision resolution), and it is not superseded within
the same sentence group. **Classified: MINOR stale-current-state
contradiction; must be corrected to WP-8-D** (task-mandated
classification).

## 18. Contract-Revision Determination Result

**WP-8-D CONTRACT REVISION: NOT REQUIRED** — verified individually:

- **D-6 taxonomy shape:** internal source-shape change; no persisted
  bytes/digest/schema/export/contract behavior changes; one new union
  member + array field; no normative text contradicted.
- **D-7 phase classification:** the amendment aligns enforcement with the
  already-normative 5.2 directory structure (LAY-001); layout/metadata
  versions unchanged; deterministic reviewed software policy with
  fail-closed downgrade; no stored fact contradicted — **no revision
  required**, subject to the M-2 matrix being pinned as policy (the
  matrix itself is not a contract change).
- **D-8 audit identity/ordering:** implementation policy subordinate to
  the contract's existing ordering semantics (AUD-002/003, DTM-003, 6.4,
  24.1) and reconstruction vocabulary (16.3); no normative text
  contradicted.
- **D-12 partial allocation:** explicit phase allocation boundary within
  the §29 decomposition (phase 4 owns the audit pipeline); AUD-001's
  deferred kinds are acknowledged, not hidden.
- **Temp-EEXIST protocol:** refines WPR-006/012/019 within 10.2/18.2/
  ERM-006; no new code; no normative text contradicted.

No selected model contradicts normative contract text; all are
implementation-policy refinements. **Result: PASS.**

## 19. Findings by Severity

**BLOCKER:** none — baseline and six-path package established exactly;
no unresolved human/contract decision prevents the documented decisions
from being implemented after the corrections below.

**CRITICAL:** none — no untrusted authority minting, arbitrary
filesystem mutation, lock breaking, or overwrite exists in any selected
model.

**MAJOR:** none — audit identity/taxonomy models do not contradict the
contract; phase classification as documented does not permit wrong-store
adoption (unknown entries remain FOREIGN); capability boundaries are not
forgeable.

**MODERATE-1 (M-1) — `{provision-phase3}` capability authority model
under-specified.** The provisioning capability is introduced inside D-7
without: (a) a kind classification against CAP-001's enumerated capability
set (initialization/write/read/verify/recovery/retention/migration) — a
"distinct provisioning capability" read as a new kind would exceed the
enumerated set; (b) an authenticity-domain placement (D-5 names only
Write/Read/Verify domains; the provisioning brand is not placed); (c) an
exact consumer module ("the provisioning composition" does not exist in
the path envelope); (d) a pinned target set for shard-directory creation
(`<ns>/records/<segment>/<shard>/`, `<ns>/audit/audit-event/<shard>/` —
which capability, which operand, which class-set binding). Must be pinned
before implementation authorization: recommend (i) model the provisioning
operation as an **operation-set extension of the initialization
capability family** (same brand domain, extended operation vocabulary
`{namespace-initialize, provision-phase3}`, same gated factory and
zero-production posture) — CAP-001-compatible, no contract revision; or,
if a distinct domain is retained, an explicit documented interpretation;
(ii) name the exact composition module (recommend: the write composition
boundary `publication/index.ts` hosts the provisioning sequence, calling
the amended `provision.ts`); (iii) bind the target set to the fixed
top-level names + closed-taxonomy class segments + validated 4-hex
shards; no arbitrary path operand.

**MODERATE-2 (M-2) — D-7 phase-classification model under-specified and
misstates committed semantics.** The ADR claims a phase-2-initialized
store is "upgradeable/provisional, not foreign (missing fixed entries →
PROVISIONAL under the committed classifier semantics…)". The committed
`classifyNamespace` returns FOREIGN for missing fixed entries when
metadata is **verified** (provision.ts: `hasVerifiedMetadata ? 'FOREIGN' :
'PROVISIONAL'`), and a phase-2 store has verified metadata. The amended
classifier needs an explicit rule — "entries ⊆ phase-3 set, no unknown
entries, missing only phase-3 members → upgradeable/PROVISIONAL regardless
of the metadata-verification flag" — plus the five-state matrix (§9), the
partial-set-after-crash and concurrent-first-use (mkdir EEXIST → verify →
continue) deterministic retry statements, and a corrected "policy-revision-
bound (not layout/metadata-version-bound)" wording with the
upgrade/downgrade determinism statement (downgrade = fail-closed FOREIGN,
VRS-008-safe). The task's rejection clause (concurrent pre-lock
provisioning must not silently classify a partial entry set as foreign
without a deterministic retry path) applies to the package as written.

**MINOR-3 (M-3) — D-6 array canonical rules unpinned.** The
`readonly Wp8Production[]` change requires stated canonical ordering and
duplicate rules: fixed declared order per profile (only
`['reconstruction-only', 'write-audit']` has two members), no duplicates,
one-element arrays for every other class, taxonomy test asserting exact
array equality (the four committed scalar assertion sites update to
array form).

**MINOR-4 (M-4) — planning-status stale current-state contradiction.**
`docs/design/post-wp5a-planning-status.md` line 9: "the current work
package is WP-8-A — Foundation and Contract Consolidation" — unqualified,
present tense, not historical-labeled; must be corrected to WP-8-D.

**NOTE-1 — audit "when" semantics.** Audit `createdAt` = the primary
record's logical creation time; no observed/action timestamp exists in
WP-8-D (correct by design: determinism, DTM-007, idempotent byte
identity; retries emit no events, so no misattribution is possible;
AUD-005 "when" is satisfied; phase-4 reconstruction uses recovery time per
16.3). Recommend a one-line statement in the implementation plan; no
correction required.

**NOTE-2 — caller-tuple audit verification in the retry protocol.** The
"required audit target" in the same-action temp-EEXIST protocol is the
audit event for the **caller's** identity tuple; a different action can
never reach the audit stage via its own publication (primary EEXIST
aborts first), and an absent caller-tuple audit yields the DURABILITY
verify-required outcome — never a fabricated event for another action.
Fail-closed in every reading; pin in the retry protocol; no correction
required.

**NOTE-3 — D-3 injection trust sources.** No production trust source
exists in WP-8-D for the injected start-time/clock/boot identity (zero
production callers; future source = trusted control-plane composition
root only; values are non-authority lock fields; the seam is an explicit
parameter with deterministic test defaults and no ambient default).
Recommend three pins in the implementation plan: lock-acquisition
functions require a genuine capability operand; the lock module's exact
production consumer edge joins the guard's consumer graph; the lock-record
schema explicitly reserves the boot-identity field for phase-4 parsing
(consistent with NOTE-3 of the prior review). No correction required.

## 20. Required Corrections (bounded; all documentation/planning pins)

1. **M-1:** pin the `{provision-phase3}` capability's kind classification
   (operation-set extension of the initialization capability family —
   recommended — or explicit documented interpretation), its authenticity
   domain, its exact consumer module, and its fixed target set (no
   arbitrary path operand); name the provisioning composition path in the
   envelope.
2. **M-2:** replace the D-7 classification wording with the five-state
   matrix and the upgradeable rule (independent of the metadata-
   verification flag); state the partial-set and concurrent-first-use
   deterministic retry paths (mkdir EEXIST → descriptor verification →
   continue); correct the "version-bound" claim to policy-revision-bound
   with the upgrade/downgrade determinism statement.
3. **M-3:** state the D-6 array canonical ordering and no-duplicate rules
   and the one-element-array requirement for all other classes; update
   the four taxonomy test assertion sites to array form.
4. **M-4:** correct the planning-status "current work package" statement
   to WP-8-D (or label it historical).

## 21. Blockers / Deviations

**Blockers:** none. M-1 and M-2 gate implementation authorization, not
this review's determinations; both are bounded documentation pins with
clear recommended resolutions.

**Deviations:** none beyond those already recorded in the package (D-1
eligibility-path substitution, verified accurate). No reviewed document
was modified by this review; no file other than this report was created.

## 22. Implementation-Readiness Result

**NOT YET GRANTED.** The seven decisions are human-approved and bound by
ADR-029; ADR-029 is contract-subordinate; the three prior MINOR findings
(MINOR-1/2/3) are closed consistently across the consolidation, ADR-029,
and the decision-resolution report; no contract revision is required;
production write authority remains unreachable; the implementation
envelope is exact except the provisioning-capability naming gap (M-1).
Two MODERATE (M-1, M-2) and two MINOR (M-3, M-4) findings remain open;
per the acceptance standard (zero open findings), the package requires
the bounded corrections above before human implementation authorization.

## 23. Verdict

`WP-8-D SENIOR DECISION-RESOLUTION AND ADR REVIEW: CORRECTIONS REQUIRED`

```text
OPEN FINDINGS: 2 MODERATE (M-1, M-2), 2 MINOR (M-3, M-4), 3 NOTES (no correction required)
WP-8-C OPERATIONAL BASELINE: bd832606ece489a924b4fcc13ad55789fcb0736f
WP-8-C INDEPENDENT COMMIT VERIFICATION: SKIPPED BY HUMAN DIRECTION
WP-8-D SEVEN-DECISION CONSISTENCY: CONFIRMED
WP-8-D PRIOR-MINOR CLOSURE: CONFIRMED (MINOR-1, MINOR-2, MINOR-3)
WP-8-D ADR-029: ACCEPTED (CONTRACT-SUBORDINATE; CORRECTIONS TO ITS D-7 IMPLEMENTATION DETAILS REQUIRED)
WP-8-D CONTRACT REVISION: NOT REQUIRED
WP-8-D PRODUCTION WRITE AUTHORITY: UNREACHABLE
WP-8-D ERROR DISPOSITION: CONSISTENT (28 + 3 = 31)
WP-8-D IMPLEMENTATION ENVELOPE: BOUNDED (ONE NAMING GAP, M-1)
WP-8-D IMPLEMENTATION READINESS: NOT YET GRANTED
WP-8-D IMPLEMENTATION AUTHORIZATION: NOT GRANTED
WP-8-D STAGING AUTHORIZATION: NOT GRANTED
WP-8-D COMMIT AUTHORIZATION: NOT GRANTED
WP-9 AND LATER AUTHORIZATION: NOT GRANTED
NEXT GATE: WP-8-D CORRECTION OF M-1…M-4, THEN HUMAN AUTHORIZATION OF WP-8-D IMPLEMENTATION
PUBLICATION: NOT PERFORMED
```
