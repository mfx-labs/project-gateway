# ADR-029 — WP-8-D Publication, Locking, and Audit Policy

## Status

Accepted (human decision resolution).

Accepted by the externally granted human approval of the seven WP-8-D
decisions (D-2, D-3, D-5, D-6, D-7, D-8, D-12) selected at the WP-8-D
decision-resolution gate, following the **WP-8-D senior pre-implementation
security and architecture review** (verdict: `ACCEPTED FOR DECISION
RESOLUTION`; three bounded MINOR findings, all corrected in this
resolution). This ADR is **normative for WP-8-D implementation policy**
but **subordinate to the authoritative WP-8 contract**
(`docs/specs/wp-8-local-storage-registry-contract.md`, SHA-256
`aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f`,
byte-identical, untouched). It **does not authorize implementation**,
staging, commit, or any later phase. It does not modify, reopen, or
deviate from any §28 contract decision (DS-01…29).

## Context

WP-8-D is contract §29 implementation Phase 3 — Durable Single-Record
Publication, Exact Reads, and Locking — on the operational baseline
commit `bd832606ece489a924b4fcc13ad55789fcb0736f`
(`feat: establish WP-8-C trusted storage bootstrap`, parent
`05904e46ded384bab5f250ac72c2734539f1e86f`). The pre-implementation
decision consolidation
(`docs/reports/wp-8d-pre-implementation-decision-consolidation-report.md`)
established eligibility, scope, the 18-class record matrix, capability,
lock, publication, audit, revalidation, limits, filesystem-ownership,
crash-harness, and path-envelope models, plus a decision register
(D-1…D-15) and an ADR proposal. The senior review independently verified
the consolidation against the contract (read in full), the committed
source and tests, and the committed guards; it accepted the consolidation
for decision resolution and required the correction of three bounded
MINOR findings (MINOR-1 error-count mismatch; MINOR-2 same-action
temporary-name EEXIST retry classification under-specification; MINOR-3
D-12 classification). The human then approved the seven decisions below.

### Operational baseline

- Repository: `/home/chef/Documents/Project_Gateway_MCP`; branch `main`.
- HEAD: `bd832606ece489a924b4fcc13ad55789fcb0736f`; subject
  `feat: establish WP-8-C trusted storage bootstrap`; parent
  `05904e46ded384bab5f250ac72c2734539f1e86f`.
- Staging empty; tags zero; no commits after HEAD.
- Contract SHA-256 exact: `aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f`.
- Dependencies `ajv@8.20.0` only; public exports 42; package exports
  `"."` and `"./pi-adapter"`.
- No WP-8-D implementation source; no WP-9 work; no publication.

### Governance waiver

**WP-8-C INDEPENDENT COMMIT VERIFICATION: SKIPPED BY HUMAN DIRECTION**

The baseline commit and its complete file manifest were not independently
verified; the commit is treated as the operational baseline per human
direction. Nothing in this ADR claims independent verification of that
commit.

## Scope

This ADR binds:

- the accepted write-authority posture and producer boundary (D-2);
- the locks-only entropy/process-identity exception (D-3);
- the verified-StoreMetadata capability binding model (D-5);
- the mechanical write-audit production reconciliation (D-6);
- the phase-3 namespace entry-set model and provisioning sequence (D-7);
- the deterministic audit identity and ordering model (D-8);
- the partial AUD-001 allocation (D-12).

This ADR does not bind: implementation authorization (a separate human
gate), the WP-8 contract (unchanged, byte-identical), any §28 contract
decision, the deferred decisions D-9 and D-11, or any later phase.

---

## Decision D-2 — Zero Production Write Authority

**Accepted:** WP-8-D has **zero production `StorageWriteActionProvenance`
producers**.

- The future exact producer/consumer boundary is
  `src/control-plane/storage-write-action.ts` (WP-12 trusted control
  plane). That path is **static policy only**; it does not exist in
  WP-8-D and is never created by WP-8-D.
- While the producer does not exist, the write-provenance creator has
  **zero production importers** (static-guard enforced across all
  production `src/**` imports and re-exports, plain and aliased).
- Production publication is therefore **unreachable** in WP-8-D: the
  write capability can only be created from a genuine branded
  `TrustedWriteRequest`, which requires genuine write-action provenance.
- Test-only producers compile into test output only
  (`dist-test/**`); they never create a runtime or package export path,
  and no runtime test hook exists.
- No public or package export of any creator; `src/index.ts`, package
  exports, and dependencies unchanged.
- No minting from environment, request, repository content, artifact,
  argv, cwd, process UID alone, or any structural object.

**Rejected alternatives:** (a) a production producer in WP-8-D wired to a
future control plane — rejected: would create production write
reachability before any trusted consumer exists (API-004); (b) a
production test hook or ambient flag enabling publication — rejected:
ambient authority escape (CAP-007/API-007); (c) a deterministic
action-derived write provenance — rejected: forgery surface (TAU-005,
CAP-015).

**Consequences:** production publication remains unreachable until WP-12;
unit and process tests exercise the complete path through test-only
producers (established WP-8-C pattern); API-004 holds vacuously.

---

## Decision D-3 — Locks-Only Entropy and Process Identity

**Accepted:** the static-guard randomness/process prohibition is relaxed
for **one exact module only**:

- **Authorized source path (exact):** `src/storage/locks/lock.ts`.
- **Authorized APIs:** the named `randomBytes` import from `node:crypto`
  (nonce, contract 12.3 "writer nonce (random, per acquisition)") and
  `process.pid` (lock record field, LOK-015). Exact-name named imports
  only.
- **Process start time, clock (acquisition time / maximum age), and
  optional boot identity** are **injected bounded values** with
  deterministic test defaults; there is **no production `/proc` read** in
  WP-8-D (boot identity recorded absent/"where available" per 12.3; the
  recovery phase wires the real bounded source).
- **Denied everywhere else and in all other modules:** namespace/default/
  dynamic crypto imports; `randomUUID`; `Math.random`;
  environment-derived nonces; action-derived nonces; direct `Date.now`
  or `process.hrtime` in production storage source.
- **Static guard:** the blanket prohibitions remain for every other
  `src/storage/**` module; the exception is a per-module allowlist entry
  for `src/storage/locks/lock.ts` with negative leakage tests proving the
  exception does not spread.
- **Global no-I/O delegation** remains exact-module-only: the compiled
  `storage/locks/lock.js` joins the exact delegated set; no blanket
  `storage/**` exclusion.

**Rejected alternatives:** (a) deterministic nonce derived from the
action identity — rejected: contract 12.3 mandates a random nonce and a
derived nonce would be replayable from store content (LOK-006/015);
(b) broad crypto/process access across the storage tree — rejected: least
authority (SRE-009); (c) production `/proc` boot-id read in WP-8-D —
rejected: no consumer exists in this phase (stale classification is
phase 4) and it would add out-of-store filesystem access.

**Consequences:** the lock record carries the normative 12.3 fields;
nonce uniqueness is asserted in tests via injected entropy; determinism
of everything except the nonce is preserved; DTM-007 is unaffected
(nonce is not a digest/identity input for records).

---

## Decision D-5 — Verified StoreMetadata Binding

**Accepted:** write, read, and verify capabilities bind only after the
store's `StoreMetadata` has been fully verified through the established
metadata layer (descriptor-bound read; canonical parse with duplicate-key
rejection; payload/record digest verification; namespace identity,
parent identity, configuration identity, and limit-profile identity
verification against the caller's verified expectation). Binding from
structural objects is not authorized; only the metadata verification
result plus genuine branded trusted-input operands may feed a capability
creation gate (ADR-028 decision C gate, exercised by this human
authorization).

**Complete capability binding tuple:**

| Component | Source |
|---|---|
| Capability kind | distinct authenticity domain (`WriteCapability`, `ReadCapability`, `VerifyCapability`) |
| Operation set | `{record-publish}` (write); read/verify operation sets per CAP-001 |
| Store namespace | both verified namespace identities (`config-v1`, `store-v1`) from verified StoreMetadata |
| Namespace device/inode/type identity | verified metadata namespace identities |
| Parent identity | verified metadata parent identity (device/inode/type) |
| Configuration identity | verified metadata configuration identity, correlated with trusted configuration |
| Limit-profile identity | verified metadata limit-profile identity (configuration version + configuration identity), correlated at admission (CAP-008) |
| Trusted action identity (write only) | from the genuine branded write-action provenance bound into the genuine `TrustedWriteRequest`; never a separate/structural string |
| Generation | in-process per-store generation registry (configuration replacement advances; stale capabilities fail) |
| Live/disposed state | capability lifetime; disposal kills every later use |

**Distinct authenticity domains:** the three capability kinds use
separate module-private `WeakSet` collections inside the existing
brand-bearing module `src/storage/capabilities/authenticity.ts` (no new
brand-bearing module, no shared/interchangeable brand), and the two
trusted-input domains (`StorageWriteActionProvenance`,
`TrustedWriteRequest`) are separate collections inside
`src/storage/trusted-input/bootstrap-input.ts` — cross-kind substitution
fails every verifier. This is the accepted equivalent of distinct
domains; no alternative mechanism is needed.

**Rejected alternatives:** (a) binding from the raw metadata file bytes
without the verification pipeline — rejected: would accept
self-consistent-but-unverified state (W8C-S01 precedent); (b) one shared
brand for all capability kinds — rejected: cross-kind substitution;
(c) binding from structural request objects — rejected (CAP-015).

**Consequences:** capability creation is non-ambient; read/verify
creators have gated factories with zero production consumers until
WP-9/WP-12 (API-008).

---

## Decision D-6 — Mechanical Write-Audit Production

**Accepted reconciliation:**

- Semantic producers remain exactly those named by the record-class
  contract (§6.2). WP-8-D is a **persistence substrate**, never a
  semantic producer for primary records.
- The storage layer **mechanically emits the minimum `authorized-write`
  evidence event** required by WPR-010/AUD-003 at the operation
  durability point (contract 10.1 step 9).
- Emission requires a **genuine capability-bound trusted action
  identity** (D-2/D-5); the event records evidence of a completed or
  attempted authorized write; it **grants no authority**, cannot
  approve, activate, issue, or execute anything (AUD-005, TAX-012), and
  is never a lifecycle decision.
- **Audit-event publication is not recursively audited** because
  "audit-event publication" is outside the closed audited-event list of
  §22.1; the authorized-write event is the terminal event of the
  publication operation.

**Exact narrow `Wp8Production` taxonomy amendment (implementation-time,
not applied now):**

- The committed union
  `Wp8Production = 'no' | 'initialization' | 'maintenance' |
  'reconstruction-only'` (in `src/storage/format/taxonomy.ts`) gains one
  new member: `'write-audit'` (mechanical authorized-write evidence
  production by the write substrate).
- The field type becomes `readonly wp8Production: readonly Wp8Production[]`
  so that production statuses remain combinable; the
  `authoritative-audit-event` profile changes from
  `['reconstruction-only']` to
  `['reconstruction-only', 'write-audit']`.
- **No other record class or event kind changes production status.**
  All other classes keep their existing single-member values (`'no'`,
  `'initialization'`, `'maintenance'`).
- The `reconstruction-only` member is preserved: recovery reconstruction
  (CSA-013/16.3) remains a phase-4 production path.

**Canonical array rules (M-3 pin).**

- Arrays are immutable (`readonly`), contain **no duplicates**, are
  **never empty**, and use the **exact declared order**; **no runtime
  sorting** is performed or permitted anywhere.
- Every non-audit profile uses an **exact one-element array**, chosen
  from exactly: `['no']`, `['initialization']`, `['maintenance']`,
  `['reconstruction-only']`.
- The `authoritative-audit-event` profile is the **only** two-element
  array: `['reconstruction-only', 'write-audit']` (exact declared order;
  `write-audit` appears in no other profile).
- **Implementation-time test-envelope update (tests not modified by this
  task):** the four committed scalar assertion sites in
  `tests/unit/storage/taxonomy.test.ts` become exact array-equality
  assertions: (1) the `'no'` loop over all non-special classes
  (→ `['no']`); (2) `store-evidence-record` `'maintenance'`
  (→ `['maintenance']`); (3) `store-metadata` `'initialization'`
  (→ `['initialization']`); (4) `authoritative-audit-event`
  `'reconstruction-only'` (→ `['reconstruction-only', 'write-audit']`).
- Required test coverage: exact declared order; exact array equality; no
  duplicates; only the audit profile has two values; only the audit
  profile contains `'write-audit'`.

**Rejected alternatives:** (a) replacing `'reconstruction-only'` with a
single new scalar — rejected: loses the phase-4 reconstruction fact;
(b) a separate boolean flag field — rejected: splits one cohesive fact;
(c) broadening production status of any other class — rejected.

**Consequences:** the taxonomy remains closed and testable; the static
guard and taxonomy tests are amended at implementation time
(implementation not authorized by this ADR).

---

## Decision D-7 — Phase-3 Namespace Entry Set and Provisioning Authority

**Committed semantics (accurate).** The committed WP-8-C phase-2
classifier (`classifyNamespace` in `src/storage/initialization/provision.ts`,
fixed entry set `['metadata','tmp']`) returns FOREIGN when fixed entries
are missing **and metadata is verified**
(`hasVerifiedMetadata ? 'FOREIGN' : 'PROVISIONAL'`). A phase-2-initialized
store has verified metadata, so the committed classifier classifies it
FOREIGN. The prior package wording ("PROVISIONAL under the committed
classifier semantics") was inaccurate and is corrected here; the
classification below is the **newly authorized WP-8-D policy revision**.

**Accepted classifier-policy-revision-bound entry-set model:**

| Scope | Entries |
|---|---|
| WP-8-C phase-2 exact namespace entries (committed) | `metadata`, `tmp` |
| WP-8-D phase-3 required subset | `metadata`, `tmp`, `records`, `audit`, `locks` |
| Contract-reserved but deferred (5.2) | `index`, `quarantine` (phase 4) |

**Five-state phase classification (newly authorized WP-8-D policy):**

| State | Entries | Metadata | Classification |
|---|---|---|---|
| A. Phase-2 initialized | exact `{metadata, tmp}` | verified | `PROVISIONAL / PHASE3-UPGRADE-REQUIRED` |
| B. Upgrade in progress | allowed subset of the phase-3 set, no unknowns | any | `PROVISIONAL` |
| C. Incomplete phase-3 | `metadata`, `tmp` plus a proper subset of `records`, `audit`, `locks`, all existing entries valid | **regardless of the metadata-verification flag** | `PROVISIONAL` |
| D. Foreign / invalid | unknown entry; deferred entry (`index`, `quarantine`); wrong type/UID/mode at a fixed path; symlink; identity drift; malformed or unsupported state | any | existing fail-closed state per precedence (FOREIGN / IDENTITY_DRIFTED / MALFORMED_METADATA / UNSUPPORTED_VERSION) |
| E. Phase-3 initialized | exact `{metadata, tmp, records, audit, locks}` | verified | `INITIALIZED` |

**Policy-revision characterization.**

- The expected policy is a **committed internal software-policy
  revision** of the classifier's fixed-entry constant; it is **not
  request-selectable** and **not selected by metadata**.
- StoreMetadata format (`'1'`) and layout (`'v1'`) versions remain
  unchanged; **no stored phase fact is added**; **no migration is
  introduced** (VRS-004: no automatic upgrade).
- Classification is **classifier-policy-revision-bound** (the layout/
  metadata version is unchanged for both policies; the accepted entry set
  is bound to the classifier policy revision, not to a version change).
- **Upgrade/downgrade determinism:** WP-8-D software upgrades phase-2
  stores (A → E through B/C); older pre-amendment software sees the
  phase-3 entries as unknown → FOREIGN and fails closed. This
  downgrade behavior is **intentional** and VRS-008-safe (no
  reinterpretation of records).

**Concurrent first use:** two operations may both attempt the exclusive
`mkdir` of the same phase-3 directory; the second receives `EEXIST` and
**enters the descriptor-verification path** (WP-8-C `ensureFixedDirectory`
pattern): an exact valid directory → idempotent continue; an invalid
object → fail closed. No object is adopted, repaired, or deleted.

**Crash between creations:** a partial allowed set (states B/C) remains
`PROVISIONAL`; a deterministic retry creates **only the exact missing
entries**; a partial set is never classified FOREIGN.

**Provisioning authority model (M-1 pin).**

- `provision-phase3` is **not a new CAP-001 capability kind**; it is an
  **operation-set extension of the existing initialization-capability
  family**.
- It uses the existing module-private `InitializationCapability`
  authenticity domain in `src/storage/capabilities/authenticity.ts`.
  Allowed initialization-family operation values: `namespace-initialize`;
  `provision-phase3`.
- Issuance uses the existing initialization-family trusted gate (genuine
  branded trusted-input operand with correlated parent, namespace,
  configuration, limit-profile, generation, and lifetime bindings); **all
  current bindings remain**; **zero production issuance remains** (no
  production producer of the genuine branded operands exists; test-only
  issuance; importing the creator confers no minting authority).
- **Exact consumer:** `src/storage/publication/index.ts` — the
  composition module invokes the phase-3 top-level provisioning sequence
  **before writer-lock acquisition**.
- **Top-level mutation targets (pinned, exact):** `<namespace>/records`,
  `<namespace>/audit`, `<namespace>/locks`. **No raw path operand is
  accepted**; every target is a fixed derivation.
- **Class and shard directory creation is pinned separately:** it
  requires a **genuine live `WriteCapability`** and occurs **only after
  writer-lock acquisition**; the class comes from the closed validated
  taxonomy; the class segment comes from the accepted layout derivation;
  the shard is an exact canonical four-lowercase-hex value derived from
  the validated record identity. Permitted targets:
  `<namespace>/records/<validated-class-segment>/<validated-shard>` and
  `<namespace>/audit/audit-event/<validated-shard>`. No arbitrary
  directory or segment; **no other capability may create these targets**.

**Provisioning sequence (lazy, avoids the writer-lock circular
dependency):** the writer lock file lives at
`<ns>/locks/writer.lock`, so `locks/` must exist **before** lock
acquisition — lazy provisioning cannot be performed *under* the
writer lock. The safe sequence is therefore:

1. Revalidate the store through verified StoreMetadata (D-5 pipeline).
2. Acquire the phase-3 provisioning capability (initialization-family
   domain, operation `provision-phase3`, existing trusted gate), invoked
   by `src/storage/publication/index.ts`.
3. Provision only the exact missing **top-level** phase-3 directories
   (`records`, `audit`, `locks`); idempotent — existing correct
   directories pass descriptor verification.
4. Dispose the provisioning capability.
5. Proceed to writer-lock acquisition; class and shard directories are
   then created under the genuine live `WriteCapability` (M-1 pin above).

The provisioning capability follows the D-2 producer posture: zero
production issuance until the trusted control plane exists; no
production reachability is invented by this decision. (Alternative
rejected: initialization-time provisioning of the phase-3 set for fresh
stores — recorded as D-13's non-selected option; it remains
available as a future refinement but the lazy sequence is the accepted
WP-8-D model.)

**Rejected alternatives:** (a) provisioning under the writer lock —
rejected: circular (the lock directory must pre-exist the lock);
(b) treating phase-2 stores as FOREIGN after the amendment —
rejected: breaks backward compatibility; (c) a new CAP-001 capability
kind for provisioning — rejected: exceeds the enumerated capability
set; (d) pre-creating `index/` and `quarantine/` — rejected:
phase-4 owned.

**Consequences:** committed WP-8-C initialization source
(`provision.ts`, `state.ts`) is amended at implementation time under
this authorization (classifier fixed-entry constant and the
initialization-family operation vocabulary); the exact-entry security
boundary change is explicitly authorized (F-1 closed by this decision);
the provisioning authority is pinned to the initialization family and the
single composition consumer, with class/shard creation gated by the
genuine live write capability.

## Decision D-8 — Deterministic Audit Identity

**Accepted:** the deterministic audit-identity model.

**Identity input tuple (domain-separated, canonical):**

- store/namespace identity (both verified namespace device/inode
  identities);
- primary record class (canonical class id);
- primary canonical instance/revision identity (record id + revision);
- primary record digest (canonical `sha-256:<64-hex>`);
- audit event kind (`authorized-write`);
- trusted action identity (capability-bound).

**Operation ordinal:** **not required.** Under single-writer semantics
(DS-01/12.1) at most one authorized-write event exists per primary
record; an ordinal would break idempotent retry by minting a new
identity per attempt. The tuple is unique and stable without one.

**Excluded from the identity input:** random nonce; PID; wall-clock-only
uniqueness; mutable sequence counter; filesystem path; capability object
identity.

**Definition:**

- **Canonical serialization:** RFC 8785 JCS of the tuple after
  duplicate-key rejection (accepted WP-2…WP-4 canonical rules).
- **Digest domain:** a new domain-separated digest domain
  (`STORAGE_AUDIT_EVENT_IDENTITY_DOMAIN`), following the established
  domain-separated digest pattern (`STORAGE_PAYLOAD_DIGEST_DOMAIN` /
  `STORAGE_RECORD_BYTES_DIGEST_DOMAIN`).
- **Output identifier syntax:** the accepted trusted-record prefix
  `pgw:l:` + exactly 32 lowercase hex characters (accepted identifier
  grammar, 5.3/ADR-014); no new identifier profile.
- **Collision handling:** SHA-256 domain separation makes collisions
  practically impossible; if an identity collision ever occurs at
  publication, the existing-target machinery classifies it (identical
  bytes → idempotent duplicate; different bytes → `ERR-STO-DUPLICATE`;
  revision conflict → `ERR-STO-CONFLICT-REVISION`) — no new code.
- **Idempotent retry:** same tuple → same identity → same canonical
  bytes → EEXIST → exact-match verification → contract-permitted
  idempotent result (WPR-012/019).
- **Same-primary/different-action:** different action identity in the
  tuple → different event identity; unreachable in practice under
  single-writer/duplicate classification, but deterministic if it
  occurs.
- **Same-action duplicate:** EEXIST with identical bytes → idempotent.
- **Conflict behavior:** different bytes at the same event identity →
  `ERR-STO-DUPLICATE` / `ERR-STO-CONFLICT-REVISION` per 10.2/18.2.

**Ordering:**

- Deterministic existing stable tuple: **(primary record `createdAt`,
  primary record identity, audit event identity)**; the audit event's
  `createdAt` equals the primary's (deterministic; DTM-007 compliant).
- The audit **identity is the total-order tiebreaker**.
- **No stored normative numeric sequence** is added; the numeric
  sequence is a **later derived registry/recovery view** (phase 4:
  reconstruction derives sequences over this order and allocates gap
  markers per 16.3).

**Rejected alternatives:** (a) counter-under-lock via bounded scan —
rejected: introduces mutable state, scan cost, and non-deterministic
recovery; (b) contract revision to store a normative numeric sequence —
rejected for WP-8-D (see below); (c) nonce/PID/time-based identity —
rejected: non-idempotent and non-deterministic (DTM-007).

**Contract relationship:**

`WP-8-D CONTRACT REVISION FOR D-8: NOT REQUIRED`

The contract already fixes audit ordering semantics (AUD-002/003,
DTM-003, 6.4, 24.1) and recovery reconstruction sequence allocation
(16.3); the deterministic derivation is an implementation-policy model
subordinate to those semantics and requires no contract change.

---

## Decision D-12 — Partial AUD-001 Allocation (human-acknowledged)

**Accepted (reclassified from implementation-owned to
human-acknowledged):**

- WP-8-D implements the **minimum `authorized-write` event** only.
- WP-8-D **does not claim full AUD-001 conformance**.
- The `idempotent-duplicate` and `conflict` event kinds of §22.1 are
  **deferred to the later audit/registry/recovery phase** (phase 4).
- This is an explicit **phase allocation boundary**, not an
  implementation omission hidden from acceptance: requirement tables
  classify AUD-001 as **partial / integrated-later** (I/T for
  `authorized-write`; IL for the deferred kinds), and the acceptance
  gate for WP-8-D records this partial allocation.
- The deferral is sound because §29 phase 4 owns the audit pipeline;
  WP-8-D phase-3 owns durability and the write protocol's mandatory
  audit step (WPR-010).

**Rejected alternatives:** (a) full AUD-001 sweep in WP-8-D — rejected:
expands scope into the phase-4 audit pipeline and the deferred event
kinds; (b) silent deferral without acknowledgment — rejected.

**Consequences:** the WP-8-D acceptance criteria explicitly exclude full
AUD-001 conformance; phase 4 must implement the remaining kinds before
AUD-001 closure.

---

## Deferred Decisions (not resolved by this ADR)

- **D-4/D-9 — lock scope tension (DS-10 "whole-store" vs LOK-004/12.3
  per-namespace fixed path):** remains deferred. WP-8-D uses the fixed
  `store-v1/locks/writer.lock` path; only `store-v1` is writable in this
  phase. **No stale-lock breaking** occurs. A contract revision may be
  required before the configuration namespace becomes writable; the
  configuration phase must resolve the store-wide serialization
  question.
- **D-11 — `ConfigurationSnapshotRecord` persistence:** remains
  deferred. No configuration current-head, genesis, or activation
  materialization occurs in WP-8-D (contract permissive via
  W8A-R08/I/FPH-005; deferral recorded, re-openable at the configuration
  phase).
- **D-1** (documented deviation: eligibility input path substitution) and
  **D-10, D-13, D-14, D-15** (implementation-owned items recorded in the
  consolidation register) remain as recorded.

## Consequences

1. Production write authority is unreachable until WP-12 (D-2).
2. The static guard gains one exact entropy/process exception and four
   exact fs-bearing module allowlists (D-3, envelope below).
3. Capabilities bind only to verified metadata and genuine branded
   operands (D-5).
4. The audit-event taxonomy amendment is narrow and closed (D-6).
5. The phase-3 entry-set amendment is classifier-policy-revision-bound,
   backward-compatible, and provisioning-safe (D-7), with the five-state
   matrix and pinned provisioning authority (M-1/M-2).
6. Audit identity and ordering are deterministic, idempotent, and
   phase-4-compatible without a contract revision (D-8).
7. AUD-001 conformance is explicitly partial in WP-8-D (D-12).

## Implementation Constraints

- **Contract:** byte-identical; no revision for WP-8-D.
- **Exact authorized lock-module path (D-3):** `src/storage/locks/lock.ts`.
- **Exact filesystem-bearing modules (implementation envelope):**
  `src/storage/publication/publish-record.ts`,
  `src/storage/locks/lock.ts`, `src/storage/read/read-record.ts`,
  `src/storage/read/enumerate.ts`, plus the amended
  `src/storage/initialization/provision.ts` (existing allowlist shape
  unchanged). `src/storage/audit/write-audit.ts` is fs-free.
- **Filesystem API subsets:** per the consolidation §16 table — exact
  per-module allowlists; exact-name named imports only; no namespace/
  renamed/default/export-from forms; the read tree denies all mutating
  APIs; `readdirSync` is owned by the enumeration module only (exact
  reads do not require directory scans).
- **Crypto/process exception:** `randomBytes` from `node:crypto` and
  `process.pid` in `src/storage/locks/lock.ts` only (D-3).
- **Creator-consumer graph (static-guard `CREATOR_EDGES`):**
  `createWriteCapability` → `src/storage/publication/index.ts`
  (single production consumer); trusted-write-request creator → the same
  composition boundary; write-action-provenance creator → **zero
  production importers**; read/verify creators → the read composition
  module (zero production callers until WP-9/WP-12); the
  **provisioning-capability issuer** (initialization-family domain,
  operation `provision-phase3`) → `src/storage/publication/index.ts`
  (single production consumer; **zero production issuance** — the
  trusted gate operands have no production producer).
- **No new brand-bearing module**; brands remain in the two exact
  committed modules; no new issuance markers; no new dependencies; no
  child-process in runtime; no package-export, public-index, or
  dependency change.
- **Static-guard implications:** `FS_ALLOWLIST` gains the four new
  modules; the later-phase-directory test releases `publication`,
  `read`, `audit` and keeps `registry`, `recovery`, `retention` absent;
  the locks-only randomness/process exception with negative leakage
  tests; storage↔WP-7 no-import-edge rule (SCP-005); read-tree
  mutation-API denial; creator-edge updates.
- **Global no-I/O delegation:** the exact set grows by
  `storage/publication/publish-record.js`, `storage/locks/lock.js`,
  `storage/read/read-record.js`, `storage/read/enumerate.js`; the
  fail-closed predicate and rejection inventory remain; blanket
  `storage/**` exclusion remains prohibited.
- **Testing implications:** storage unit suites for publication, locks,
  read, audit; extended capability/trusted-input/static-guard/taxonomy
  suites; the process-level crash harness
  (`tests/process/storage-crash/**`) with the full stage matrix and the
  same-action temp-EEXIST retry cases (MINOR-2 protocol below); the
  focused `test:storage-crash` script; TVR-006 exact/+1 for the 14
  applicable limits; TVR-014 invalidation at all four CAP-009
  boundaries.

## Same-Action Temporary-Name EEXIST Retry Protocol (MINOR-2 resolution)

When a retry derives a deterministic temporary name (action-derived,
WPR-003 pattern) and the exclusive creation fails with `EEXIST`:

1. **Do not adopt** the existing object; **do not reopen it for
   writing**; **do not unlink it as newly owned**.
2. Inspect it only through authorized bounded no-follow operations
   (`O_RDONLY|O_NOFOLLOW` open + `fstat`). A wrong-type, wrong-owner, or
   wrong-mode object fails closed without further steps:
   `ERR-STO-FTYPE-UNSUPPORTED` (special file / symlink / directory) or
   `ERR-STO-PERM-DENIED` (owner/mode) per 18.2 precedence (file-type
   failures precede content checks; no content is read).
3. Verify the **final primary target** (descriptor-bound read, canonical
   bytes, digest, location) and the **required audit target**, through
   the same bounded verification used by existing-target classification.
4. **Primary and audit fully durable and exact** → the contract-permitted
   idempotent result (10.2/WPR-012/019; class-dependent duplicate
   evidence; verify-before-acknowledgement already performed).
5. **Primary durable, audit incomplete** → `ERR-STO-DURABILITY` with the
   10.5 audit-row state tuple: `primaryStateChanged: 'yes'`,
   `durabilityPointReached: 'yes'` (primary), `auditChanged: 'unknown'`,
   `verifyBeforeRetry: true`, recovery required to complete or
   reconstruct (CSA-005/013; phase 4).
6. **Neither complete state provable** (primary absent, partial, or
   unverifiable) → `ERR-STO-DURABILITY` with the unknown-state tuple:
   `primaryStateChanged: 'unknown'`, `durabilityPointReached: 'unknown'`,
   `auditChanged: 'unknown'`, `verifyBeforeRetry: true`, retryable,
   recovery required (WPR-017 durability-unknown; ERM-006: success never
   claimed when state is unknown). This is the contract's
   durability-unknown verify-required code per 18.1/18.2 precedence
   (publication/durability tier); **no new error code** is introduced.
7. Stale-temp cleanup belongs to recovery (WPR-023 class (b)
   quarantine with evidence; phase 4). No automatic adoption, repair,
   or deletion by WP-8-D.

## Contract Relationship

- The authoritative contract is unchanged and byte-identical
  (SHA-256 `aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f`).
- `WP-8-D CONTRACT REVISION FOR D-8: NOT REQUIRED`.
- No contract revision is required for any other WP-8-D decision; DS-10
  remains the reopen gate if D-9 resolves via contract revision in the
  configuration phase.

## Implementation Gate

This ADR **does not authorize implementation**. WP-8-D implementation,
staging, and commit require separate human authorization following the
**WP-8-D focused decision-package rereview** (the senior
decision-resolution and ADR review returned corrections required for
M-1…M-4; the focused decision-package correction applied them) of this
ADR, the decision-resolution report
(`docs/reports/wp-8d-decision-resolution-report.md`), and the corrected
consolidation report. WP-9 and later phases remain unauthorized.
