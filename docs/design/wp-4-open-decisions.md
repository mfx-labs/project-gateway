# WP-4 Open Decisions

## Implementation Decisions (Resolved)

All implementation-critical WP-4 decisions were resolved during implementation:

- TypeScript/ESM over Node 22 with `node:crypto` for SHA-256.
- One production dependency (Ajv 8.20.0, Draft 2020-12, offline `$id` registry);
  one development dependency set (TypeScript 7.0.2, `@types/node` 26.1.2);
  Node's built-in test runner; internal RFC 8785 serializer verified against
  all 19 digest vectors; internal raw scanner for duplicate-member rejection.
- Schema and corpus mirroring via a deterministic generation script
  (`scripts/generate-bundle.mjs`); the committed WP-3 files remain the source
  of truth; the production core performs no runtime filesystem or network I/O.
- Identity, resolution, registry, lifecycle, and time inputs are injected
  through explicit interfaces; `MemoryIdentityState` is test/corpus-only.

## WP-3 Fixture Erratum (Resolved)

The committed WP-3 fixture `fixtures/lifecycle/invalid/approval-registry-digest-mismatch.json`
was corrected by exactly one value under the approved erratum
(`registry_snapshot_digest` → `sha-256:61311261…db47c04`); see
`docs/reports/wp-3-fixture-erratum-report.md`. The previously blocked entries
`LFC-I-190B087B` and `RULE-REG-008-FAIL` pass their declared oracle.

## Focused Correction Pass (Resolved)

The WP-4 focused correction pass resolved all seven human-review groups without
weakening the protocol:

1. Point-of-use/effective-authority evaluation is complete: the exact requested
   use is evaluated as the intersection of global and workspace ceilings, the
   approved AuthorityPolicy, the active RuntimeGrant, and consumer support,
   with deny-wins, unknown-denied, workspace alignment, current revocations,
   validity/expiry, attempt allowance, registry and extension support, and
   no-mutation guarantees. No decision input is ignored.
2. Unicode surrogate handling accepts valid escaped surrogate pairs and literal
   supplementary characters and rejects isolated surrogates without
   replacement; JavaScript strings are scanned before encoding and bytes are
   decoded strictly.
3. The conformance runner is oracle-independent: actual findings come from
   implementation-owned evaluators and the structural-enforcement mapping;
   expected values are comparison input only, and altered expectations produce
   mismatches.
4. Exact references are validated against the approved schema; resolver output
   is fully revalidated; identity verification never registers; workspace
   binding comparison is semantic and insertion-order independent.
5. Validated wrappers are deeply immutable (defensive snapshot, deep freeze,
   null-prototype objects) and genuinely branded with public type guards.
6. Validation levels are explicit (self, controlled, for-use); for-use
   validation uses all supplied inputs and fails closed on missing dependencies.
7. Canonical-input traversal follows the exact projection (full `annotations`
   subtree and `revision.digest`/`snapshot_digest` excluded by path) and
   validates digest-covered member names and values.

The full suite passes 129/129 targeted tests and 531/531 conformance entries
with strict typecheck/build and no fixture-specific production branches.

## Second Focused Correction Pass (Resolved)

The WP-4 second focused correction pass resolved the six remaining
human-review findings without weakening the protocol:

1. **Exact bundle and lifecycle-chain point of use:** point-of-use evaluation
   begins from an exact verified ExecutionBundle and its exact trusted
   lifecycle chain; the four member artifacts are resolved and revalidated with
   registry and consumer-support context; only related lifecycle records are
   evaluated; validation/approval/issuance/grant (and activation or
   pre-activation state) are required and fail closed when missing; every grant
   `narrowed_constraint` is enforced; revocations apply only to related
   revocable records; findings are sorted before first-phase selection.
2. **Phase gates and identity modes:** the pipeline stops exactly at the
   requested `through` phase; `registry-compatible` is assigned only after
   actual registry evaluation; `checkProposedRegistration` and
   `verifyExistingRegistration` are distinct operations and are never mixed;
   for-use validation uses verification mode only.
3. **Exact-reference for-use context:** self resolution never claims registry
   compatibility; for-use resolution requires and uses the accepted registry
   context and consumer support and revalidates the target through registry
   compatibility before comparison.
4. **Complete oracle independence:** schema-resource fixtures resolve their
   execution target from an implementation-owned fixture-path → catalog
   mapping; canonical-vector entries return an actual evaluation object routed
   through the same common comparison logic; all 19 `CAN-*` and the six
   listed `RULE-*` vector entries are independently compared.
5. **Private membership branding:** symbol-property branding was replaced with
   module-private WeakSet membership; no brand symbol, property, or exported
   token exists; spreads, clones, proxies, and forged lookalikes are not
   members.
6. **Per-call snapshot state:** snapshot traversal state is local to each
   top-level call with `try/finally` cleanup; repeated acyclic shared
   references are accepted and materialized independently; true cycles are
   rejected; no module-global traversal state exists.

The full suite passes 211/211 targeted tests and 531/531 conformance entries
with strict typecheck/build, oracle-mutation tests for schema IDs and vector
fields, and no fixture-specific production branches.

## Final Focused Correction — W4-F1 (Resolved)

The final narrow correction resolved the remaining MODERATE finding W4-F1
(insertion-order-dependent protocol equality). Ordinary `JSON.stringify` was
used in three production equality decisions: bundle member reference-binding
compatibility and lineage binding continuity in `src/bundle/validate.ts`, and
retry bundle-reference stability in `src/lifecycle/graph.ts`. All protocol
equality is now owned by one consumer-neutral internal module
(`src/internal/protocol-equality.ts`): `workspaceBindingsEqual` (portable/bound
mode, exact workspace ID), `exactReferencesEqual` (protocol version, artifact
kind, kind version, instance ID, revision ID, canonical digest, workspace
binding), and `bundleReferencesEqual` (the exact-reference shape of lifecycle
`bundle` members). The previously reviewed `bindingsEqual`
(`src/references/validate.ts`) and `referencesEqual`/`bindingEquals`
(`src/engine/identity.ts`) now delegate to the authoritative comparators.
Comparators read only own data properties of plain JSON objects (accessors
never invoked, inherited properties never consulted), fail closed on missing
or structurally invalid fields, and never mutate their operands. No rule was
suppressed and no failure category was downgraded: genuine protocol
differences still produce REF-005/WSP-003/WSP-005/LIN-007/MIG-001/EXE-006 with
their approved phases and categories.

No unresolved WP-4 Artifact Core decisions.
