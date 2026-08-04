# WP-4 Artifact Core Implementation Report

## Baseline

- Branch: `main`; baseline HEAD: `1a7036692e1b0ca40a6ca5c6412302cc372f4137`
  (`feat: establish WP-3 schema conformance package`); WP-0…WP-3 committed;
  working tree clean; staging empty.
- Committed WP-3 package verified before implementation: 51 schema resources,
  531 manifest entries (250 pass / 281 fail), 114 rule IDs with PASS/FAIL
  coverage, 19 digest vectors, absolute-URN external `$ref`s, valid catalog and
  manifest dependency metadata; executable WP-3 audit passed (Ajv 8.20.0).

## Toolchain

- Node `v22.23.2`; npm `10.9.8`; TypeScript `7.0.2` (strict, ESM/NodeNext);
  test runner: Node built-in `node:test`; validator: Ajv `8.20.0`.

## Dependencies and Rationale

| Dependency | Type | Purpose | Pin |
| --- | --- | --- | --- |
| `ajv` | production | Offline Draft 2020-12 validation via `$id` registry; the only runtime dependency | `8.20.0` |
| `typescript` | development | Strict compilation | `7.0.2` |
| `@types/node` | development | Node types | `26.1.2` |

Everything else is Node built-ins (`node:crypto`) or internal implementations:
the raw JSON scanner (duplicate-member rejection before construction), the
RFC 8785 serializer (verified against all 19 vectors), the identity state
(in-memory, test-only), and the conformance runner. `package-lock.json` is
generated and retained; it will be committed only after human approval.

## Files Created

- `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.tests.json`,
  `.gitignore` (node_modules/dist/dist-test);
- `scripts/generate-bundle.mjs` (deterministic mirror of WP-3 schemas/fixtures);
- `src/` — 24 production TypeScript modules under `api/`, `json/`, `canonical/`,
  `digest/`, `schema/`, `identity/`, `references/`, `registry/`, `semantic/`,
  `bundle/`, `lifecycle/`, `pointofuse/`, `engine/`, `conformance/`, `internal/`,
  plus `generated/` (schema bundle, corpus bundle);
- `tests/` — unit (33), integration (6), security (10) tests;
- docs: `artifact-core-architecture.md`, `artifact-core-public-api.md`,
  `artifact-core-validation-engine.md`, `artifact-core-security-model.md`,
  `wp-4-open-decisions.md`, ADR-017/018/019, this report, and authorized
  glossary additions.

## Public API Summary

`parseRawJsonInput`, `createSchemaRegistry`, `validateArtifactRevision`,
`validateArtifactInput`, `validateRegistrySnapshot`, `validateLifecycleRecord`,
`computeArtifactDigest`, `computeRegistryDigest`, `verifyArtifactDigestValue`,
`verifyRegistryDigestValue`, `resolveExactArtifactReference`,
`validateLifecycleGraph`, `evaluatePointOfUseEligibility`, `ConformanceRunner`,
plus branded validated wrappers and injected state interfaces. Unvalidated JSON
can never be confused with validated subjects; Ajv-specific objects never leak.

## Implementation Strategies

- **Raw parser:** internal scanner; duplicate members rejected at every depth
  before object construction; bounds and Unicode enforced; `JSON.parse` runs
  only on scanned-safe text.
- **Canonicalization:** internal RFC 8785 serializer; strings never normalized;
  arrays never reordered; safe integers only.
- **Digests:** `node:crypto` SHA-256 over domain-prefixed canonical UTF-8;
  artifact domain `PGAP-ARTIFACT-REVISION-v1\0`, registry domain
  `PGAP-REGISTRY-SNAPSHOT-v1\0`; projections exclude only the approved fields.
- **Schema validation:** Ajv 8.20.0 Draft 2020-12, offline `$id` registry,
  51 resources meta-validated and compiled; no network, no path identity.
- **Identity/lineage:** injected state view; generation, predecessor,
  binding-continuity, and no-merge checks; `MemoryIdentityState` for tests.
- **References:** resolver output revalidated through the full pipeline; every
  field compared; no path/alias/latest/partial/fallback resolution.
- **Registry:** exact accepted snapshot binding; namespace uniqueness; required
  versus optional modes; ignore-safety; consumer support fail-closed.
- **Semantic rules:** all 114 rule IDs registered with stable phases and
  categories; structurally enforced rules satisfied at the structural phase.
- **Lifecycle/point-of-use:** pure graph and eligibility evaluation over
  caller-supplied records, time, ceilings, and revocations.

## WP-3 Fixture Erratum Dependency

The committed WP-3 fixture `fixtures/lifecycle/invalid/approval-registry-digest-mismatch.json`
was corrected by exactly one value under the approved WP-3 fixture erratum: its
`registry_snapshot_digest` changed from `…db47c05` (the accepted snapshot digest)
to `…db47c04` (syntactically valid, not accepted, not used by any other
snapshot). The fixture now represents its declared `REG-008` failure. See
`docs/reports/wp-3-fixture-erratum-report.md`. The complete WP-3 audit passes
531/531 with no schema, manifest, rule, phase, vector, or accepted-snapshot
change.

## Conformance Results (Post-Erratum Rerun)

- Executed: **531/531** manifest entries (none skipped).
- Passed: **531/531**; mismatches: **0**. The previously blocked entries
  `LFC-I-190B087B` and `RULE-REG-008-FAIL` pass their declared oracle with no
  WP-4 production source change and no fixture-specific special case.
- Schema resources compiled: 51/51; semantic rule IDs covered: 114/114;
  digest vectors verified: 19/19 (plus 6 independent `openssl` cross-checks
  during WP-3 verification); raw, canonical-input, structural, reference,
  registry, lifecycle, workflow, and point-of-use fixtures all execute at their
  declared phases.

## Test Results (Post-Erratum Rerun)

- Unit: **33/33 pass** (raw JSON, canonical input, digests, schema registry,
  identity, references, registry, lifecycle, determinism, security basics).
  The two conformance-total expectations were updated from the pre-erratum
  529/2 outcome to the corrected-corpus 531/0 outcome.
- Integration: **6/6 pass** (manifest totals, corpus listing, RULE coverage,
  19 vectors, full 531/531 conformance execution, runner determinism).
- Security: **10/10 pass** (no hidden I/O in compiled production modules, no
  `Date.now` in protocol code, duplicate-key depths, no silent repair,
  surrogate rejection, prototype-pollution inertness, no caller-input mutation,
  bounded traversal, deterministic order, instance isolation).
- Build: `tsc -p tsconfig.json` clean (typecheck and unused-symbol scans pass);
  tests compiled via `tsconfig.tests.json`; package exports resolve
  (`dist/index.js` + `dist/index.d.ts`).

## Security Verification

- No production network, shell, Git, filesystem-traversal, database, MCP, Pi,
  or pi-guard dependency; the only runtime dependency is Ajv (offline).
- Duplicate members rejected before construction; non-NFC rejected, never
  normalized; unsafe integers rejected; set-like arrays never silently
  reordered; caller input never mutated; findings deterministically ordered;
  resolver output untrusted and revalidated; no alias/path/latest/partial/
  fallback resolution; time injected; independent instances isolated; resource
  bounds enforced; no absolute local paths in reports or committed docs.

## Focused Correction Pass

The WP-4 focused correction pass (after direct human review) resolved all seven
correction groups without weakening the protocol:

1. **Point-of-use/effective-authority:** complete evaluation of the exact
   `RequestedUse` as the intersection of global/workspace ceilings, the approved
   AuthorityPolicy (deny wins, unknown denied), the active RuntimeGrant
   (validity, revocation, attempt allowance), consumer support, registry
   compatibility, and lifecycle validity; workspace alignment across bundle,
   policy, context, grant, records, and consumer use; revocation handling that
   never treats historical facts as revocable; no state mutation; no hidden
   clock. Files: `src/pointofuse/evaluate.ts`, `src/api/types.ts`,
   `src/api/validate.ts`.
2. **Unicode surrogates:** valid escaped surrogate pairs and literal
   supplementary characters accepted; isolated surrogates rejected without
   replacement; JS strings scanned in UTF-16 code units before encoding; bytes
   decoded strictly. Files: `src/json/scanner.ts`.
3. **Oracle independence:** the runner never copies expected rule IDs,
   categories, phases, or schema IDs into actual findings; the
   structural-enforcement mapping (`src/internal/structural-map.ts`) derives
   rule IDs from schema resource + validator keyword + path; altered expected
   values produce mismatches; no fixture-ID branch exists.
4. **Exact references:** references validated against the approved
   exact-reference schema (unknown members rejected); resolver output fully
   revalidated; identity verification never registers; semantic
   insertion-order-independent binding comparison.
5. **Deep immutability + branding:** defensive snapshots of plain JSON values
   (deep-frozen, null-prototype, accessors never invoked) and module-private
   brand symbols with public guards distinguishing artifact/registry/record.
6. **Validation levels:** explicit levels on wrappers; `validateArtifactSelf`
   versus `validateArtifactForUse` (uses every supplied input, fails closed on
   missing registry/resolver); `validateArtifactRevision` requires an explicit
   `through`.
7. **Canonical-input traversal:** exclusion of the full `annotations` subtree
   and `revision.digest`/`snapshot_digest` by structural path; NFC and surrogate
   checks on digest-covered member names and values.

Production source files modified: 17 (no new production files beyond the
existing layout; `src/internal/structural-map.ts` and
`src/semantic/patterns.ts` added). Test files modified: 3; test files added: 2
(`tests/unit/corrections.test.ts`, `tests/integration/effective-authority.test.ts`).

## Test Results (Post-Correction)

- Unit: **69/69** (raw JSON, canonical input, digests, schema registry,
  identity, references, registry, lifecycle, determinism, Unicode surrogates,
  canonical-input traversal, immutable wrappers, branding, validation levels).
- Integration: **41/41** (manifest totals, corpus listing, RULE coverage,
  19 vectors, full 531/531 conformance, runner determinism, exact-reference
  schema and revalidation, effective authority, oracle independence, semantic
  dispatch).
- Security: **19/19** (no hidden I/O, no `Date.now` in protocol code,
  duplicate-key depths, no silent repair, surrogate rejection, prototype
  pollution inertness, no caller-input mutation, bounded traversal,
  deterministic order, instance isolation).
- Total: **129/129**; strict typecheck/build pass; unused-symbol scan clean;
  package exports resolve; conformance **531/531** with zero mismatches.

## Second Focused Correction Pass

The WP-4 second focused correction pass (after direct human rereview) resolved
the six remaining finding groups without weakening the protocol:

1. **Exact bundle and lifecycle-chain point of use.** Point-of-use evaluation
   now begins from an exact verified ExecutionBundle and its exact trusted
   lifecycle chain: requested-use structure validation and workspace alignment
   first; the four member artifacts (TaskSpec, AuthorityPolicy,
   ContextManifest, CompletionContract) are resolved through for-use reference
   resolution (registry + consumer-support context) and revalidated as
   untrusted input; every member reference field is verified; existing identity
   registration is required for the bundle and all members; only lifecycle
   records related to the exact bundle revision, the four member revisions, the
   accepted registry context, the exact RuntimeGrant, and the requested
   workspace are evaluated; validation/approval/issuance/grant (and activation
   or pre-activation state for attempt operations) are mandatory and fail
   closed when missing; a missing RuntimeGrant fails closed; unrelated records
   (including unrelated revocations) never affect the result; revocations apply
   only to related revocable records; every grant `narrowed_constraint` is
   enforced (read-only, max-actions, require-exact-resource, scope,
   operation-class, resource-class; unknown types fail closed); effective
   authority is the intersection of ceilings, policy, grant, and consumer
   support; findings are sorted before the first failing phase is selected.
   Files: `src/pointofuse/evaluate.ts`, `src/api/validate.ts`,
   `src/api/types.ts`.
2. **Phase gates and identity modes.** The artifact pipeline stops exactly at
   the requested `through` phase (canonical-input-validation and
   schema-identification return `canonical-input-valid` markers;
   structural-schema-validation returns `structural-valid`;
   canonicalization-and-digest-verification and identity-registration return
   `digest-verified`; semantic-self-validation returns `self-semantic-valid`;
   registry-compatibility returns `registry-compatible` only after actual
   registry and consumer-support evaluation, and missing registry inputs fail
   closed; later lifecycle/point-of-use levels are assigned only by their own
   entry points). Identity phase 6 is separated into
   `checkProposedRegistration` (proposed-registration conflicts: instance
   reuse, revision reuse, digest conflicts, predecessor conflicts, generation
   conflicts; never mutates state) and `verifyExistingRegistration` (instance
   exists, revision exists and belongs to the instance, registered digest,
   generation, predecessor, and workspace binding match; never rejects a valid
   registered genesis as new reuse). `validateArtifactForUse` uses
   verification mode only. Files: `src/engine/pipeline.ts`,
   `src/engine/identity.ts` (new), `src/api/types.ts`,
   `src/internal/report.ts`.
3. **Exact-reference for-use context.** Exact-reference resolution is separated
   by purpose: self resolution (`validateReferenceModel` /
   `resolveExactArtifactReference`) revalidates the target through
   self-semantic validation and never claims registry compatibility; for-use
   resolution (`validateReferenceModelForUse` /
   `resolveExactArtifactReferenceForUse`) requires and uses the accepted
   registry context and consumer support, revalidates the target through
   registry compatibility before comparing every reference field, fails closed
   on absent required inputs, denies unsupported required extensions/features,
   and compares workspace bindings semantically and insertion-order
   independently. No `skipIdentity` path bypasses verification. Files:
   `src/references/validate.ts`, `src/api/validate.ts`,
   `src/engine/identity.ts`.
4. **Complete oracle independence.** Schema-resource (`SCH-*`) fixtures no
   longer use `expected_schema_id` as the execution target: the schema is
   resolved from an implementation-owned fixture-path → catalog mapping
   (`src/internal/schema-resource-map.ts`, new; the two shared
   `identifier-instance` paths are disambiguated by subject-type label), and
   `actualSchemaId` is compared with `expected_schema_id` afterwards.
   `evaluateVector()` now returns an actual evaluation object (actual
   success/failure, phase, category, rule IDs, canonical projection, canonical
   UTF-8, digest, rejection reason); `RULE-*` vector entries
   (RULE-ART-008-FAIL/PASS, RULE-REG-009-FAIL/PASS, RULE-SEC-001-PASS,
   RULE-SEC-002-PASS) are routed through the same common comparison logic as
   every other entry, and `CAN-*` entries use the vector comparison (invariant
   violations always mismatch; rejection vectors compare actual phase and
   category). Files: `src/conformance/runner.ts`,
   `src/internal/schema-resource-map.ts`.
5. **Private membership branding.** Symbol-property branding was replaced with
   module-private WeakSet membership (`artifactWrappers`, `registryWrappers`,
   `recordWrappers`). No brand is stored as an own symbol property, string
   property, exported token, or global symbol; `Object.getOwnPropertySymbols`
   reveals nothing; spreads, clones, proxies, and forged lookalikes are not
   members; memberships are distinct per wrapper class and valid only within
   the physical module instance that created the wrapper. Files:
   `src/internal/snapshot.ts`, `src/api/types.ts`, `src/index.ts`.
6. **Per-call snapshot state.** Snapshot traversal state (recursion stack,
   completed set, depth) is local to each top-level `snapshotJson()` call with
   `try/finally` cleanup; no module-global WeakMap/WeakSet holds traversal
   state. Documented repeated-reference policy: repeated acyclic shared
   references are accepted and materialized as independent deeply-frozen JSON
   subtrees; true cycles are rejected deterministically. A failed nested
   traversal never contaminates later calls, other inputs, other library
   instances, or concurrent/reentrant calls. File: `src/internal/snapshot.ts`.

Production source files modified: 9 (`src/pointofuse/evaluate.ts`,
`src/api/validate.ts`, `src/api/types.ts`, `src/engine/pipeline.ts`,
`src/references/validate.ts`, `src/conformance/runner.ts`,
`src/internal/snapshot.ts`, `src/internal/report.ts`, `src/index.ts`).
Production source files added: 2 (`src/engine/identity.ts`,
`src/internal/schema-resource-map.ts`). Test files modified: 3
(`tests/unit/corrections.test.ts`, `tests/integration/effective-authority.test.ts`,
`tests/security/security.test.ts`). Test files added: 1
(`tests/unit/second-focus.test.ts`). No dependencies changed.

### Focused Test Additions (Second Pass)

- Point of use: no RuntimeGrant denied; empty lifecycle denied; resolver
  invoked; identity verification invoked; unregistered bundle denied;
  unregistered member denied; wrong RequestedUse workspace denied; unrelated
  revoked approval no effect; related revoked approval denied; unrelated
  revoked grant no effect; related revoked grant denied; grant bound to another
  bundle denied; grant bound to another workspace denied; read-only grant with
  write request denied; scope narrowing denied; unknown constraint type denied;
  exact valid chain eligible (evaluator and API); registry failure before
  point-of-use failure; deterministic finding order regardless of record input
  order; missing member reference denied.
- Phase gates: every `through` phase stops exactly at the requested phase;
  structural/semantic level returns; no registry inputs means no
  registry-compatible wrapper; later phases never label beyond executed
  phases; validation-level guards (`isLevelAtLeast`).
- Identity modes: registered genesis verifies (no false instance reuse);
  second genesis proposal fails; digest/predecessor/generation conflicts
  detected; verification does not register; proposed registration does not
  mutate state; for-use uses verification mode; workspace binding is part of
  verification.
- Exact-reference profiles: self does not claim registry compatibility;
  for-use requires registry and consumer support (fail closed); unsupported
  required extension denied; wrong accepted snapshot denied; target registry
  mismatch (required mode) denied; valid target registry-compatible; phase
  level reflects executed validation; no skipIdentity bypasses verification.
- Oracle independence: altered `expected_schema_id` → mismatch; altered vector
  rule ID/category/phase/result/digest → mismatch; SCH/vector entries execute
  independently (compiled and source scans); no fixture-ID branch.
- Branding: symbol extraction cannot forge; spread/clone/proxy not branded;
  cross-class guards; original remains recognized; no brand property;
  serialization carries no branding.
- Snapshot: same invalid object twice → same error; failed nested then valid
  succeeds; object A failure does not affect object B; self/mutual cycles
  rejected; repeated shared acyclic accepted per documented policy; reentrant
  and concurrent calls share no state; deterministic error path; no
  module-global traversal state.

## Test Results (Post-Second-Correction)

- Unit: **107/107** (raw JSON, canonical input, digests, schema registry,
  identity, references, registry, lifecycle, determinism, Unicode surrogates,
  canonical-input traversal, immutable wrappers, branding, validation levels,
  phase gates, identity modes, snapshot state, membership branding).
- Integration: **90/90** (manifest totals, corpus listing, RULE coverage,
  19 vectors, full 531/531 conformance, runner determinism, exact-reference
  schema/revalidation, self vs for-use reference resolution, exact
  lifecycle-chain point of use, effective authority, oracle mutation tests
  including schema-ID and vector fields, semantic dispatch).
- Security: **14/14** (no hidden I/O, no `Date.now` in protocol code,
  duplicate-key depths, no silent repair, surrogate rejection, prototype
  pollution inertness, no caller-input mutation, bounded traversal,
  deterministic order, instance isolation, per-call snapshot state scan,
  no brand symbol/property in compiled output, expected-metadata execution
  scan, no hidden mutable protocol state).
- Total: **211/211**; strict typecheck/build pass; package exports resolve;
  conformance **531/531** with zero mismatches; 51/51 schemas compile; 114/114
  rule IDs with implementation-owned dispatch; 19/19 digest vectors recompute.

## Final Focused Correction — W4-F1

**Finding W4-F1 (MODERATE): insertion-order-dependent protocol equality.**

### Affected Locations

- `src/bundle/validate.ts` — bundle member reference-binding compatibility
  (`JSON.stringify(declaredBinding) !== JSON.stringify(actualBinding)`,
  REF-005/WSP-003/WSP-005) and lineage workspace-binding continuity
  (`JSON.stringify(ownBinding) !== JSON.stringify(predBinding)`, LIN-007/
  MIG-001).
- `src/lifecycle/graph.ts` — retry bundle-reference stability
  (`JSON.stringify(first['bundle']) === JSON.stringify(r['bundle'])`, EXE-006).

A complete production source audit found no other `JSON.stringify` equality
use; the only retained serialization is the RFC 8785 canonical serializer
(`src/canonical/jcs.ts`), which produces digest output and is never used as an
equality predicate.

### Comparator Ownership

Option B: one consumer-neutral internal module
`src/internal/protocol-equality.ts` (new) owns all protocol equality:

- `workspaceBindingsEqual(a, b)` — explicit `mode` (+ exact `workspace_id` for
  `bound`); portable never equals bound; unknown/missing fields fail closed;
- `exactReferencesEqual(a, b)` — every protocol-significant field: protocol
  version, artifact kind, kind version, instance ID, revision ID, canonical
  digest, workspace binding;
- `bundleReferencesEqual(a, b)` — the exact-reference shape used by lifecycle
  `bundle` members.

The previously reviewed comparators `bindingsEqual`
(`src/references/validate.ts`) and `referencesEqual`/`bindingEquals`
(`src/engine/identity.ts`) now delegate to the authoritative module. The
module imports nothing, exposes no mutable state, and creates no dependency
cycles. Comparators read only own data properties of plain JSON objects via
`Object.getOwnPropertyDescriptor` (accessors are never invoked, inherited
properties never consulted, class instances rejected) and never mutate their
operands.

### Exact Correction

- `src/bundle/validate.ts` (2 sites): reference-binding compatibility and
  lineage binding continuity now use `workspaceBindingsEqual`.
- `src/lifecycle/graph.ts` (1 site): retry bundle stability now uses
  `bundleReferencesEqual`.
- `src/references/validate.ts`, `src/engine/identity.ts`: delegate to the
  authoritative comparators (behavior unchanged, single implementation).
- No rule suppressed, no category downgraded, no manifest expectation changed.

### Tests Added

`tests/unit/w4-f1.test.ts` (32 tests): workspace-binding equality (same/different
key order, portable vs bound, workspace ID, invalid forms fail closed);
exact-reference equality (reordered top-level and nested binding equal;
protocol/kind/kind-version/instance/revision/digest/binding-mode/workspace-ID
differences unequal); cross-artifact validation (reordered member binding → no
REF/WSP finding; genuine mismatch → REF-005/WSP-003; reordered lineage binding →
no LIN/MIG finding; genuine change → LIN-007/MIG-001); lifecycle retry (reordered
top-level and nested bundle reference accepted; changed digest/revision/
workspace → EXE-006 with approved key/category); comparator safety (no
`JSON.stringify` in equality modules, determinism, no mutation of frozen
operands, null-prototype objects, getters never invoked, inherited properties
never consulted, class instances rejected).

### Source-Audit Results

- `JSON.stringify` in production equality decisions: **0** (only a doc-comment
  mention in `src/internal/protocol-equality.ts`);
- retained serialization: `jcsSerialize` (RFC 8785 canonical digest output,
  non-equality use, verified by all 19 digest vectors);
- every workspace-binding, exact-reference, bundle-reference, lineage,
  migration, retry, and cross-artifact equality decision now routes through
  `src/internal/protocol-equality.ts`.

## Test Results (Post-W4-F1)

- Unit: **139/139** (107 prior + 32 W4-F1); integration: **90/90**; security:
  **14/14**; total **243/243**.
- Strict typecheck and build pass; package exports resolve; generated corpus
  regeneration is byte-identical; conformance **531/531** with zero mismatches;
  51/51 schemas compile; 114/114 rule IDs with implementation-owned dispatch;
  19/19 digest vectors recompute; WP-3 erratum unchanged.

## Known Limitations

- `MemoryIdentityState` is in-memory only by design; persistent identity and
  lifecycle storage are outside WP-4.
- `consumer-support-verification` (phase 12) is implemented in the engine and
  the effective-authority intersection but is not directly exercised as a
  standalone corpus phase; it is available to callers.
- The WP-3 fixture erratum (one digest value) remains pending human approval;
  no WP-4 production source change was required for it.
- Point-of-use evaluation is bundle-centric by protocol design: for-use
  validation of a non-ExecutionBundle subject fails closed.

## Git State

- Only authorized paths changed (`package.json`, `package-lock.json`,
  `tsconfig*.json`, `.gitignore`, `scripts/`, `src/`, `tests/`, five design
  docs, three ADRs, this report, glossary additions). Staging empty; HEAD and
  branch unchanged; no Git-state mutation; no WP-0…WP-3 schema, manifest, rule
  catalog, or vector file modified; the approved one-value WP-3 fixture
  erratum remains the only fixture change.
- W4-F1 pass: `src/internal/protocol-equality.ts` (new),
  `src/bundle/validate.ts`, `src/lifecycle/graph.ts`,
  `src/references/validate.ts`, `src/engine/identity.ts`,
  `tests/unit/w4-f1.test.ts` (new), and the authorized documentation files.

## Verdict

**WP-4 W4-F1 CORRECTION COMPLETE — READY FOR FINAL ACCEPTANCE REREVIEW**

The W4-F1 insertion-order-dependent protocol equality defect is resolved:
targeted tests 243/243, conformance 531/531, strict typecheck/build clean,
51/51 schemas, 114/114 rule IDs, 19/19 digest vectors, generated corpus
byte-reproducible, zero `JSON.stringify` uses in production equality decisions,
and all previously approved corrections preserved. A final independent
read-only rereview of W4-F1 and explicit human approval are required before
WP-4 may be committed and closed. No human approval and no WP-4 closure are
claimed.
