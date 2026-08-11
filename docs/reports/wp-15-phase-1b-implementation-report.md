# WP-15 Phase 1B — `trusted-receipt-producer` Authority Core — Implementation Report

**Work package:** WP-15 Phase 1B (the smallest trusted authority domain that
can issue durable `TrustedReceipt` records from freshly verified trusted
state).
**Status:** implementation complete + focused correction (SIR-WP15-P1B-001…005) applied; unstaged/uncommitted for focused rereview.
**Baseline:** HEAD `350b7ac750c68f5d02692f6f9b01744cd701c4a0` (branch
`main`), unchanged. Nothing staged; no commit; no push/tag/release/deploy.
**Normative contract:** `docs/reports/wp-15-pre-implementation-contract-decision.md`
(Architecture Amendment A1 normative) + the Phase 1B gate brief. Phase 1A
semantics are consumed unchanged (claimant-first exact outcome resolution,
event-source validity, EXE-008/EXE-012, event/disposition mapping, denied
activation absent-only schema, result-less outcome semantics).

## 1. Exact changed paths

Modified (2):

- `src/lifecycle/graph.ts` — the three Phase 1A event-source helpers
  (`receiptEventSourceClass`, `receiptSourceClassMatches`,
  `receiptSourceBindingOk`) are now `export`ed (doc-only change plus the
  `export` keyword; zero logic change) so the receipt producer resolves and
  validates event sources through the SAME authoritative primitives (§5).
- `tests/unit/wp15-phase1a-static-guard.test.ts` — the Phase 1A "no
  receipt-producer" guard now scopes the `trusted-receipt-producer`
  vocabulary to the authorized `src/receipt-production/**` family (comment
  stripping discipline, matching the other guards) while keeping
  `receipt-publication-correlation-producer` forbidden everywhere.

New source family (`src/receipt-production/`, 6 files):

- `src/receipt-production/types.ts` — closed type vocabulary: failure
  taxonomy, result model, the narrow request, identity source, the
  single-class store boundary, the issuance input, the closed §3 read
  allowlist.
- `src/receipt-production/internal/brand.ts` — module-private capability +
  exact-record permit (CAP-008…016; generation registry independent of the
  WP-13C/S2 registries).
- `src/receipt-production/store.ts` — the exact single-class WP-8 store
  boundary (the ONLY WP-8 surface of the family).
- `src/receipt-production/authority.ts` — the decision core
  (`issueTrustedReceipt`).
- `src/receipt-production/produce.ts` — the trusted host composition
  (`createReceiptProducerAuthority`; the ONE production capability mint
  site).
- `src/receipt-production/index.ts` — family barrel (no capability/permit
  internals; no package-root export; package.json untouched).

New tests (5):

- `tests/unit/wp15-phase1b-helpers.ts` — focused harness (real WP-8 store,
  real WP-12 chain, raw outcome/validation/publication/receipt seeding,
  counting/throwing identity + counting publish boundary).
- `tests/unit/wp15-phase1b-receipt-producer.test.ts` — event matrix,
  eligibility, denied activation, replay/conflict, audit, registry binding
  (30 tests).
- `tests/unit/wp15-phase1b-concurrency.test.ts` — lock/concurrency,
  in-lock hook races, replay-after-cold-read (7 tests).
- `tests/unit/wp15-phase1b-capability-security.test.ts` — §20 adversarial
  suite (14 tests).
- `tests/unit/wp15-phase1b-static-guard.test.ts` — §23/§24 static guards
  (9 tests).

No schema, fixture, generated-bundle, package-export, dependency, MCP, Pi,
WP-14/14C, publication-correlation, release-script, or F-R1 change. The
pre-existing untracked WP-13D debris (`src/retrospective/**`,
`docs/reports/wp-13d-*.md`, `tests/unit/wp13d-*.test.ts`) is byte-untouched
and excluded from every walk.

## 2. Authority-domain design

One new authority domain, `trusted-receipt-producer`, responsible role
`trusted-receipt-producer` (schema const). Deterministic fail-closed flow:

```
narrow request (workspace + event type + exact event record id)
→ input hygiene + closed-key discipline (request AND input)
→ genuine capability gate (CAP-008…016)
→ fresh durable-state reconstruction + eligibility (pre-lock; §6/§7)
→ event-subject coordination lock (trusted-receipt|<eventType>|<eventRecordId>)
→ mandatory under-lock re-read + eligibility re-run (§12)
→ in-lock hook seam (test/host race pattern)
→ claimant enumeration (exact event subject; §13/§14)
→ replay/conflict classification (§13)
→ no-claimant branch: mint opaque id → construct → schema gate → permit →
  single-class boundary → WP-8 publishRecord (D-6 audit at durability point)
```

No public constructor manufactures authority: the capability creator is
gated on the genuine WP-6 validated trusted configuration and is minted
only by the host composition; the permit creator is gated on a genuine live
capability and is minted only by the authority immediately before the
write. No arbitrary lifecycle writes exist (single publish method, single
class).

## 3. Capability/permit/provenance model

- **Capability** (`internal/brand.ts`): module-private `WeakSet` brand;
  generation-bound via the committed `generationForStore` pattern — one
  current generation per authority lifecycle key (the trusted
  configuration's workspace identity), recording the configuration
  identity; minting never invalidates unrelated capabilities; a mint under
  a different configuration identity for the same workspace (genuine
  replacement) advances the generation and stales every earlier capability.
  Re-verified at the authority admission (CAP-009) and again at the store
  sink.
- **Permit**: role `trusted-receipt-production`, class-bound to
  `trusted-receipt`, binds capability + record id + record digest +
  canonical-byte digest + internally derived destination designation; sink
  re-derives the destination and re-verifies permit + capability before any
  filesystem access.
- **Provenance**: the WP-8 write-action provenance is minted through the
  authorized WP-12 producer (`src/control-plane/storage-write-action.ts`),
  exactly like the WP-13C/S2 boundaries.
- The capability mint site is statically pinned to `produce.ts`; the permit
  mint site to `authority.ts`; the family barrel and the package root
  export neither.

## 4. Read/write allowlists

- **Write allowlist (exact single class):** ONLY `trusted-receipt`. The
  boundary rejects any attempt to publish `ResultPublicationRecord`,
  `SupersessionRecord`, `ExecutionResult`, `ActivationRecord`,
  `RuntimeGrant`, or any other lifecycle class (payload class check + role
  check + digest check + destination derivation; no generic publisher
  exists on the boundary — adversarial tests prove it).
- **Read allowlist (closed §3 set):** `trusted-receipt`,
  `execution-attempt-record`, `execution-occurrence-record`,
  `execution-outcome-record`, `activation-record`, `runtime-grant`,
  `revocation-record`, `validation-record`, `result-publication-record`.
  No approval/issuance/supersession/migration/summary/generic-audit class
  is readable. Registry snapshot/reference material flows through the
  committed registry boundary (`registryReferenceFor` on the host-supplied
  `AcceptedRegistryContext`, exactly as WP-13C).
- No additional class was required beyond the contract's expected list.

## 5. Request boundary

Exactly three closed keys: `workspaceId` (`pgw:w:`), `eventType` (closed
Phase 1A vocabulary), `eventRecordId` (`pgw:l:`). Unknown request keys fail
closed (`request.unknown-key.*`). The caller CANNOT supply a complete
`TrustedReceipt`, retrospective facts, `ExecutionOutcomeRecord` bytes,
result facts, registry snapshot truth, grant validity, revocation status,
receipt provenance, or any disposition — every trusted fact is
reconstructed/reverified internally from fresh durable state. `expectedDisposition`
is NOT accepted: the disposition is always derivable from trusted source
state (§10), so the API contract does not require it. The input container
itself has closed keys (request, registry, store, coordinate, identity,
schemaRegistry, capability, hooks).

## 6. Fresh verification pipeline

At every issuance attempt (pre-lock AND again under the lock, both on
fresh reads — no cache, no previous validation result, no caller facts, no
project-visible `ExecutionResult`, no enumeration order/timestamp):

1. event-type → exact source class via the Phase 1A matrix
   (`receiptEventSourceClass`; `cancellation` resolves its concrete class
   by read outcome: occurrence first, then attempt);
2. exact source record read freshly by `event_record_id`; class match via
   `receiptSourceClassMatches`; workspace exact;
3. branch verification:
   - **activation-decision:** decision accepted → full live chain (see 6);
     denied → activation exact only (§8; a denied activation documents a
     decision, not an exercised authority — the bound grant is NOT
     required current; the receipt carries NO occurrence/attempt);
   - **occurrence-start / occurrence-level cancellation:** occurrence
     source + live chain;
   - **attempt-correlated** (attempt-start, attempt-end,
     enforcement-denial, attempt-level cancellation, timeout, crash):
     Phase 1A `resolveExactOutcome` (zero → terminal-unverifiable /
     receipt-ineligible; >1 → conflict; misanchored singleton →
     malformed) THEN the committed shared retrospective path
     (`deriveRetrospectiveFactsFromStore` → `deriveExecutionRetrospectiveFacts`)
     with exact cross-checks (workspace/occurrence/attempt/anchor/
     disposition agreement) THEN the live chain;
   - **result-publication-correlation:** unique attempt context (tuple +
     exact bundle), `resolveExactOutcome`, exact
     result-association ↔ publication-subject quartet correlation, the
     committed validation provenance still valid (passing
     `ValidationRecord`, ExecutionResult subject matching the
     association), shared retrospective path, live chain;
4. disposition derived from event/source/outcome semantics and verified
   through the committed `receiptEventDispositionOk` validator;
5. the constructed receipt form is verified through the committed
   `receiptSourceBindingOk` binding validator.

**Live chain (§7 authority/revocation), WP-13C pattern:** exact activation
record durable + accepted; exact occurrence record durable (where
applicable); exact RuntimeGrant durable, NOT revoked (revocation-record
enumeration), validity window covering the current trusted time. Authority
is never inferred merely because an execution happened historically.

## 7. Event-type resolution / retrospective derivation reuse

The event→source-class matrix, the binding validator, and the
event/disposition validator are the Phase 1A authoritative primitives
(imported from `src/lifecycle/graph.ts` / `src/lifecycle/retrospective-eligibility.ts`).
The attempt-correlated retrospective path reuses the committed S4 family
(`src/retrospective-derivation`): `deriveRetrospectiveFactsFromStore` —
there is NO second derivation engine in `receipt-production` (static guard
§23 proves: no resolver/facts/derivation module, no redefinition of the
S4/Phase 1A vocabulary, the family imports the committed barrels).

## 8. Lock key and under-lock reread

Key: `trusted-receipt|<eventType>|<eventRecordId>` — binds the exact
intended receipt event subject (never merely the workspace or attempt).
Two concurrent issuances for the same event subject contend on this key;
divergent requests for the same subject cannot double-write. Under the
lock: fresh reread of relevant durable state → eligibility re-run →
in-lock hook → claimant enumeration → replay/conflict classification →
publish only when a new issuance is valid. Lock contention maps to typed
`RECEIPT-LOCK-CONFLICT lock.conflict`; the lock is released on success,
typed denial, and thrown errors.

## 9. Receipt construction

`record_type: 'TrustedReceipt'`, `responsible_role: 'trusted-receipt-producer'`,
`created_at` from the host trusted time source, `registry_snapshot_reference`
via `registryReferenceFor` (host-supplied current context; never caller),
`event_type`, `event_record_id`, `workspace_id`, `occurrence_id` /
`attempt_id` per event branch, `disposition`. Denied activation: both keys
ABSENT (A1 absent-only; never null/fabricated). Other branches: `null`
not-applicable sentinel per the committed convention (accepted activation /
occurrence-level events carry `attempt_id: null`; the binding helper
accepts it). Record id: opaque `pgw:l:`, non-content-derived, minted ONLY
in the no-claimant branch after the replay/conflict decision. No
non-schema authority-bearing fields. The payload is schema-gated through
`validateLifecycleRecord` before the permit mint (and again at the sink).

## 10. Replay / conflict

- **No claimant:** eligibility passes → exactly one new receipt.
- **Exactly one materially identical claimant:** idempotent replay —
  existing durable identity returned; zero new IDs, zero durable writes,
  no audit event.
- **Materially divergent claimant:** typed
  `RECEIPT-CONFLICT conflict.material-divergence`; no write.
- **Multiple claimants:** fail closed
  `conflict.multiple-claimants` (no newest/timestamp winner; historical
  receipts are never erased).

Claimant identity = exact `event_type` + `event_record_id` (the exact event
subject); a corrupt receipt claiming the same subject is still a claimant
and fails closed. Equivalence compares ALL material contract fields
(registry reference, event type/source, workspace, occurrence/attempt
applicability, disposition) in committed canonical form (JCS), ignoring
only `record_id`/`created_at`. A schema-invalid durable claimant fails
closed as corrupt.

## 11. Registry binding

`registry_snapshot_reference` derives exclusively from the host-supplied
`AcceptedRegistryContext` (shape-gated) through the committed
`registryReferenceFor` machinery; the caller cannot inject it (closed
request keys + adversarial test). Under-lock rereads re-run eligibility
against the same host context; registry malformation is typed
`input.registry-invalid`. Currentness/authority conditions are rechecked
under the lock via the live-chain check.

## 12. Audit behavior

The D-6 mechanical authorized-write audit event is emitted by the WP-8
`publishRecord` substrate at the operation durability point (untouched);
the boundary passes `auditEventId` through, and the typed result carries it
ONLY on `issued`. Exact replay (no new write), failed eligibility,
conflict, and validation failure emit NO successful-write audit (asserted).

## 13. Result/error model

```
ok: true  → { outcome: 'issued' | 'replayed', recordId, recordDigest, auditEventId? }
ok: false → { category, code, message }   // no partial success
```

Closed categories: `RECEIPT-INPUT-INVALID` (invalid request, unknown keys,
malformed shapes, workspace mismatch, registry malformed),
`RECEIPT-CAPABILITY-DENIED` (not genuine/disposed/stale-generation/foreign
domain/sink permit denial), `RECEIPT-LOCK-CONFLICT`,
`RECEIPT-STATE-UNVERIFIABLE` (read/enumerate failure, corrupt entries),
`RECEIPT-LIFECYCLE-REJECTED` (source missing/class mismatch,
terminal-unverifiable receipt-ineligible, validation provenance invalid,
grant revoked/expired/chain missing), `RECEIPT-CONFLICT` (multiple
claimants, material divergence, conflicting/malformed outcome or
publication context, retrospective-path divergence),
`RECEIPT-WRITE-FAILED`, `RECEIPT-INTERNAL-FAILURE`. Nothing leaks
filesystem paths, store internals, capability secrets, registry internals,
or raw unrelated records.

## 14. Denied activation result

`activation-decision` + `decision: denied` issues a schema-valid
`TrustedReceipt` with `occurrence_id` and `attempt_id` ABSENT (never null,
fabricated, or placeholder), disposition `denied`, binding the exact
ActivationRecord + workspace + host registry snapshot + producer
role/provenance. No live-chain requirement (documented judgment: the
denial receipt is a fact about the decision, not an exercise of authority;
the bound grant's revocation/expiry does not suppress the historical denial
fact — test proves it).

## 15. Event matrix coverage

Issued: activation accepted (`accepted`, exact reserved occurrence, attempt
null); activation denied (absent-only); occurrence-start (`started`);
attempt-start (`started`); attempt-end all seven dispositions
(completed/failed/cancelled/timed-out/crashed/incomplete/rejected,
one-to-one, no lossy mapping); enforcement-denial (`denied` over a
`rejected` outcome WITH the committed enforcement-evidence group);
cancellation occurrence-level (`cancelled`, attempt null); cancellation
attempt-level (`cancelled` over a `cancelled` outcome); timeout
(`timed-out`); crash (`crashed`); result-publication-correlation
(`completed`; publication remains ordinary-review — no successor record, no
`receipt_correlations` mutation, no `SupersessionRecord`; §19).

Rejected variants: wrong source class (invalid-event-source), wrong
workspace binding, zero outcome (terminal-unverifiable), conflicting
outcome state, malformed (misanchored) outcome, wrong disposition source
state (enforcement-denial over `completed`), missing enforcement evidence
(`rejected` without the evidence group), correlation with missing context,
correlation with divergent result association (fails closed via the shared
retrospective correlation path), unknown event type, revoked grant, expired
grant validity.

## 16. Concurrency tests

- concurrent exact same issuance → exactly one durable receipt; second
  caller resolves `replayed` (consistent, zero extra writes);
- event-subject lock contention (re-entrant + host-thrown
  `LockContentionError`) → typed `RECEIPT-LOCK-CONFLICT`;
- in-lock hook seeding a DIVERGENT claimant → `conflict.material-divergence`,
  no double-write; seeding an EXACT claimant → idempotent replay of the
  discovered durable receipt (zero allocation/write);
- independent event subjects → independent keys, both issued (no global
  serialization);
- replay after cold read is cache-independent (fresh authority over the
  seeded store replays from durable state).

## 17. Authority-isolation results

Static guards prove: the family never imports/receives the WP-13C
publication capability, the receipt-publication-correlation capability,
execution authority, the RuntimeGrant issuer, approval/issuance authority,
a generic registry writer, or a generic lifecycle store writer; the ONLY
WP-8 surface of the family is `store.ts`; identity/time sources are invoked
only from the authority core; the capability mint is confined to
`produce.ts` and the permit mint to `authority.ts`; execution/completion/
adapters/runtime/root-barrel cannot mint or import the private receipt
brand; the family carries no Phase 2 vocabulary (successor,
`receipt_correlations`, `SupersessionRecord`, privileged scopes, resume).

## 18. Tests/typechecks

| Suite | Result |
|---|---|
| `wp15-phase1b-receipt-producer.test.js` (new) | 49/49 |
| `wp15-phase1b-concurrency.test.js` (new) | 7/7 |
| `wp15-phase1b-capability-security.test.js` (new) | 14/14 |
| `wp15-phase1b-static-guard.test.js` (new) | 9/9 |
| `wp15-phase1a-*` (lifecycle + resultless + static guard) | 37/37 |
| w4-f1, wp13 durability S1/S3, S4 derivation, wp13c publication, wp12 guard, S2/S3/S4 static guards | 166/166 |
| core + integration conformance + effective-authority + corrections + second-focus | 207/207 |
| full `unit/*.test.js` | 783/785 — the 2 failures are the recorded superseded untracked WP-13D E2E tests (pre-existing, non-authoritative) |
| `pointofuse-v2` + `trusted` + `security` | 816/817 — 1 pre-existing baseline failure (boundary-v2 exports pin vs `./loading`; package.json untouched; pre-dates this gate) |
| `mcp/unit` + `runtime` + `drafting` + `writing` + `pi-adapter/unit` | 435/435 |
| WP-7 validated runner (reader/git/fff/security) | 165/165 |
| `wp7-discovery-guard` | OK |
| TypeScript | `tsc -p tsconfig.json` and `tsc -p tsconfig.tests.json` clean |
| `git diff --check` | clean |

## 19. Known limitations

- The schema-gate fail-open defect was first identified by a read-only peer
  review and provisionally corrected in the working tree; the formal
  senior-review finding SIR-WP15-P1B-001 (and the related collision-gate
  gap) is closed in full by the focused correction in §22.
- The event-subject lock is process-local per the committed coordinator
  contract (FSCR-W12-001); multi-process composition relies on WP-8's
  per-record publication lock, which the single-class boundary preserves
  unchanged.
- The pre-lock eligibility pass and the under-lock re-run both read
  fresh; a state change between the passes fails closed under the lock
  (the under-lock decision is authoritative). Concurrent outcome
  publication and receipt issuance use independent keys by design: a
  receipt issued before the outcome lands resolves terminal-unverifiable
  (retry after durability succeeds); WP-8 hard-link publication prevents
  torn reads.
- The accepted-activation and occurrence-level branches require the
  current live chain (grant current/not revoked), matching the WP-13C
  current-chain protocol per §7; the denied-activation branch documents
  the decision without a live-chain gate (documented judgment above).
- The two recorded pre-existing baseline failures (2 superseded WP-13D E2E;
  1 pointofuse exports pin) remain untouched and are recorded for the
  closure gate.

## 20. Git state

HEAD `350b7ac750c68f5d02692f6f9b01744cd701c4a0` unchanged; branch `main`;
nothing staged; no commit. Working tree: the changed/new paths above plus
the pre-existing untracked WP-13D debris (byte-untouched, excluded from all
guards). `git diff --check` clean. No external release action.

## 21. Explicit state

- `receipt-publication-correlation-producer` NOT IMPLEMENTED.
- Successor `ResultPublicationRecord` production NOT IMPLEMENTED.
- `SupersessionRecord` correlation production NOT IMPLEMENTED.
- Phase 2 / Phase 3 NOT STARTED.
- F-R1 NOT IMPLEMENTED.
- No external release action occurred (no push/tag/publication/installation/
  deployment); no MCP/Pi surface change; no package exports change; no new
  dependency, authority class, role vocabulary, writable record class, or
  contract change.

## 22. Focused correction — SIR-WP15-P1B-001…005 (senior review NO-GO)

**Gate:** focused correction; envelope exception NONE. The accepted Phase 1B
architecture is preserved unchanged: one `trusted-receipt-producer` authority
domain, one-class `TrustedReceipt` write sink, Phase 1A exact outcome
semantics, WP-13 S4 retrospective derivation reuse, pre-lock + under-lock
reread, event-subject lock, immutable replay/conflict, WP-8
durability/audit. No Phase 2 authority. Test counts below are the ACTUAL
discovered/executed counts after the correction (no predicted prose).

### SIR-WP15-P1B-001 — fail-open schema gates — CLOSED

**Root cause:** the replay and no-claimant gates wrapped
`validateLifecycleRecord` in `safeCall` and tested only `gate.value ===
undefined`; `safeCall.ok` means only "did not throw" and `gate.value` is the
whole report object, so a non-throwing invalid report
(`{ok:true, value:{ok:false,…}}`) satisfied the condition. Additionally, the
collision reread path reached JCS material comparison with NO schema gate (a
key-set asymmetry could throw `JCS: unsupported value type` out of the lock
as a mislabeled internal failure).

**Correction:** one `schemaGate()` helper (authority.ts) requires ALL of:
outer call succeeded, report exists, `report.ok === true`, validated wrapper
exists — used by the replay branch (every durable claimant is
class/role/schema-gated before material equality; schema-invalid claimants —
including invalidity only in `record_id`/`created_at`, the fields excluded
from material comparison — fail `RECEIPT-CONFLICT state.receipt-corrupt`,
never replay candidates), the no-claimant branch, AND the collision reread
(the store boundary now passes every same-identity collision outcome —
`idempotent-duplicate`, `duplicate`, `conflict-revision` — through to the
authority's gated reread: class/role gate → schema gate → material
comparison; a malformed collision record is a typed
`state.receipt-corrupt`, never a JCS throw, untyped exception, replay, or
overwrite). Material comparison now uses a closed explicit projection
(`RECEIPT_MATERIAL_FIELDS`: all schema material fields except
record_id/created_at; absent ≠ present including null; a future schema
field fails closed until deliberately added).

**Adversarial result:** raw-seeded schema-invalid-but-material-looking
claimant (invalid `created_at`) → `state.receipt-corrupt`, zero
allocation/write/audit; malformed collision reread → typed corrupt (no JCS
throw escapes); schema-valid divergent collision → `conflict.durable-record`.

### SIR-WP15-P1B-002 — issuer-supplied registry/currentness context — CLOSED

**Root cause:** the public authority surface accepted a full trusted input
per call; the holder could nominate registry context, identity/clock,
coordinator, capability, hooks, schema registry, and store.

**Correction:** the trusted host composition (`produce.ts`) now closes over
EVERY trusted dependency — `registryProvider` (host-owned current-registry
provider, called once per issuance), `identity` (trusted clock + record-id
source), `coordinate`, `schemaRegistry`, `capability`, and the host-only
`hooks` seam — and exposes exactly:

    authority.issue(request: ReceiptRequest): ReceiptResult

The issuer nominates ONLY `workspaceId`/`eventType`/`eventRecordId`; every
trusted-context operand in a request is a closed-key/hostile-input
rejection. Registry authenticity uses the committed acceptance primitive:
the authority requires `isBrandedRegistry(snapshot)` on the
`AcceptedRegistryContext` (no second brand; a scalar-shaped or merely
shape-valid lookalike is `input.registry-invalid`). The composition resolves
the current registry through the provider per issuance; issuer-supplied data
never decides current registry identity or the trusted `now`.

**Adversarial result:** injection of registry/reference/clock/identity/
coordinator/hooks/capability/store/schemaRegistry/provenance/outcome through
`issue()` → typed `RECEIPT-INPUT-INVALID` with zero writes; forged
(unbranded-snapshot) registry context → `input.registry-invalid`; the
authority object surface is exactly `['issue']`; two issuances share the
closed identity source (record ids accumulate on one host counter).

### SIR-WP15-P1B-003 — non-exact current-chain verification — CLOSED

**Root cause:** `checkLiveChain()` used first-match `.find()` occurrence
selection, omitted activation↔occurrence↔grant↔bundle↔reservation
cross-bindings, omitted the grant attempt allowance, and treated any
revocation targeting the grant id as immediately applicable (no target-type
check, no `effective_at` semantics).

**Correction:** ONE pure exact-chain primitive `resolveCurrentChain()`
(authority.ts) is the single point-of-use currentness definition:
- activation: exact identity read; class/workspace/decision checks plus
  exact bundle, reserved-occurrence, and runtime-grant cross-bindings
  (divergence → `RECEIPT-CONFLICT state.activation-*`);
- occurrence: claimant-first exact cardinality (claimants = exact tuple OR
  exact bundle+occurrence correlation); zero → lifecycle-rejected; >1 →
  `state.occurrence-ambiguous`; single divergent claimant →
  `state.occurrence-malformed` — no first/latest/enumeration-order;
- grant: exact identity read; class/workspace checks plus exact bundle
  correlation (the committed RuntimeGrant `bundle` reference) and reserved
  occurrence; attempt allowance uses the committed EXE-005/§27.3 comparison
  (`ordinal <= attempt_limit`; malformed limit fails closed); validity
  window covers the trusted now;
- revocation: committed applicability semantics — target identity AND
  target type (a same-ID different-class record never invalidates the
  grant), committed scope set (`all-uses`/`execution-use`),
  `effective_at` must be an accepted timestamp at-or-before now (future
  revocations do not invalidate); enumeration/read failure fails closed.
Denied activation is NOT routed through the live chain (historical denial
receipt semantics preserved unchanged).

**Adversarial result (through actual `issueTrustedReceipt`):** duplicate
occurrences → ambiguous; one exact + one divergent occurrence claimant →
ambiguous; wrong reservation → `lifecycle.occurrence-missing`; wrong
occurrence bundle → malformed; wrong activation binding → malformed;
unrelated RuntimeGrant → `state.activation-grant-divergence`; grant
reservation mismatch → `state.grant-reservation-divergence`; grant bundle
mismatch → `state.grant-bundle-divergence`; exceeded attempt allowance →
`lifecycle.attempt-allowance-exceeded`; boundary allowed ordinal (== limit)
issues; future revocation → not applicable (issues); wrong-type revocation
→ not applicable; out-of-scope (unrelated-grant) revocation → not
applicable; exact applicable current revocation → `lifecycle.grant-revoked`;
revocation enumeration failure → `state.revocation-enumerate-failed`.

### SIR-WP15-P1B-004 — hostile input objects not safely captured — CLOSED

**Root cause:** the request was read through ordinary `Object.keys` +
property reads before any safe capture; getters, inherited values, and
Proxy traps were not deterministically rejected.

**Correction:** request capture now goes through the committed hostile-input
primitive (`snapshotJson`, src/internal/snapshot.ts) — own enumerable data
descriptors only; accessors rejected without invocation; symbols,
non-enumerable fields, inherited values, non-plain prototypes, throwing
`ownKeys`/`getOwnPropertyDescriptor`/`getPrototypeOf` traps, and revoked
proxies fail closed as typed `RECEIPT-INPUT-INVALID` (no untyped exception
escapes); then the closed three-key set and value syntax are enforced on the
detached capture.

**Adversarial result:** getter field, inherited required fields, throwing
`ownKeys` Proxy, throwing `getOwnPropertyDescriptor` Proxy, revoked Proxy,
extra property, missing own property — all typed
`RECEIPT-INPUT-INVALID`, zero writes.

### SIR-WP15-P1B-005 — duplicate disposition authority — CLOSED

**Root cause:** `deriveDisposition()` in receipt-production duplicated the
Phase 1A event/disposition mapping.

**Correction:** the Phase 1A family now exposes the ONE authoritative pure
derivation `deriveReceiptDisposition(eventType, eventSource, exactOutcome?)`
(src/lifecycle/retrospective-eligibility.ts) with the exact contract
semantics (activation accepted/denied; occurrence-start/attempt-start →
started; attempt-end → exact seven-value outcome disposition; enforcement-
denial → denied ONLY when outcome rejected WITH the committed
enforcement-evidence group; cancellation → cancelled; timeout → timed-out;
crash → crashed; result-publication-correlation → completed; unknown →
not-derivable). receipt-production consumes it and keeps
`receiptEventDispositionOk` as a defensive assertion only; the local map is
deleted (static guard proves no second derivation exists under
receipt-production). `ATTEMPT_CORRELATED_RECEIPT_EVENTS` is now used
meaningfully in the branch structure (no dead vocabulary).

### Replay / material-equivalence regression

Material equality is reached ONLY after class check + responsible_role
check + schema validation + safe validated capture (claimant enumeration
fails closed on class/role violations; both replay and collision paths
schema-gate first) and compares the closed explicit material projection
(§26). Replay semantics unchanged otherwise: exactly-one materially
identical claimant → replay with zero IDs/writes/audit; divergent → typed
conflict; multiple → fail closed.

### Security/static guards strengthened

Guards now also prove: the authority surface accepts only `ReceiptRequest`
(no per-call trusted operands); the composition closes over
registryProvider/identity/coordinate/schemaRegistry/capability/hooks; the
authority verifies registry genuineness via `isBrandedRegistry` and captures
the request via `snapshotJson`; no second disposition derivation exists
under receipt-production (Phase 1A `deriveReceiptDisposition` is imported);
barrel exposes no `ReceiptAuthorityInput` or capability/permit internals;
private capability/permit boundary, single-class sink, no generic writer,
and no Phase 2 vocabulary all remain pinned.

### Exact changed paths (correction)

- `src/lifecycle/retrospective-eligibility.ts` — added the authoritative
  `deriveReceiptDisposition` primitive (+ type).
- `src/receipt-production/authority.ts` — `schemaGate()` (report-ok-aware)
  on replay/no-claimant/collision paths; closed material projection;
  `resolveCurrentChain()` exact-chain primitive (occurrence cardinality,
  full cross-bindings, grant allowance, revocation applicability);
  `snapshotJson`-based request capture; `isBrandedRegistry` registry
  genuineness; Phase 1A disposition derivation; claimant class/role gate.
- `src/receipt-production/store.ts` — collision outcomes flow through to the
  gated reread (typed corrupt/conflict; no write-failure mislabel).
- `src/receipt-production/produce.ts` — host-closed composition;
  `issue(request: ReceiptRequest)`.
- `src/receipt-production/types.ts` — `ReceiptAuthorityInput` removed;
  docs updated.
- `src/receipt-production/index.ts` — export surface updated.
- `tests/unit/wp15-phase1b-receipt-producer.test.ts` — +18 tests
  (collision gates, exact-chain adversarial matrix, hostile input,
  disposition-authority matrix) → 49.
- `tests/unit/wp15-phase1b-capability-security.test.ts` — +2 tests
  (SIR-002 injection surface + forged-registry brand) → 14.
- `tests/unit/wp15-phase1b-static-guard.test.ts` — +1 test (SIR-002
  authority surface + SIR-005 derivation confinement) → 9.
- `tests/unit/wp15-phase1b-helpers.ts` — `authority()` composition builder.
- `tests/unit/wp15-phase1a-static-guard.test.ts`, `src/lifecycle/graph.ts` —
  unchanged from the Phase 1B implementation gate.

### Focused verification (actual counts)

| Suite | Result |
|---|---|
| `wp15-phase1b-receipt-producer.test.js` | 49/49 |
| `wp15-phase1b-concurrency.test.js` | 7/7 |
| `wp15-phase1b-capability-security.test.js` | 14/14 |
| `wp15-phase1b-static-guard.test.js` | 9/9 |
| Phase 1A (lifecycle 30 + resultless 3 + static guard 4) | 37/37 |
| WP-13 S1/S3/S4 + WP-13C publication + WP-12/w4-f1 + S2/S3/S4 static guards | 163/163 |
| security + trusted | 585/585 |
| full `unit/*.test.js` | 805/807 — the 2 failures are the recorded superseded untracked WP-13D E2E tests (pre-existing, non-authoritative) |
| TypeScript main + tests | clean |
| `git diff --check` | clean |

Conformance was NOT rerun: no schema/semantic-rule/fixture/generated-corpus
change. No MCP/Pi/WP-7/WP-14C rerun: no shared dependency used by them
changed.

### Authority boundary after correction

- Authority domain unchanged: `trusted-receipt-producer`, single-class
  `TrustedReceipt` write sink, closed §3 read allowlist, event-subject lock,
  immutable replay/conflict, WP-8 durability/audit, capability/permit
  brands unchanged (mint sites unchanged: capability → composition, permit
  → authority core).
- Public API: `createReceiptProducerAuthority(hostTrustedContext)` →
  `authority.issue(receiptRequest)`; the internal decision core
  (`issueTrustedReceipt`, genuine-capability-gated) remains exported per
  repository convention.
- `receipt-publication-correlation-producer` NOT IMPLEMENTED; successor
  publication NOT IMPLEMENTED; `SupersessionRecord` correlation NOT
  IMPLEMENTED; Phase 2/3 NOT STARTED; F-R1 NOT IMPLEMENTED; no external
  release action.

### Known limitations (correction)

- The exact-chain primitive is receipt-production-local (no committed
  WP-13C/control-plane current-chain resolver existed to reuse; WP-13C's
  chain check remains inline/first-match and was NOT modified — out of
  scope).
- Collision rereads are only reachable through identity-source reuse (the
  host identity contract forbids reuse); the gated handling is now typed
  and fail-closed regardless.
- The two recorded pre-existing baseline failures (2 superseded WP-13D E2E)
  remain untouched.

## 23. Envelope exception status

Envelope exception: NONE.

WP-15 PHASE 1B FOCUSED CORRECTION COMPLETE — READY FOR FOCUSED REREVIEW
