# WP-6 Phase 1 Implementation Report — Trusted Configuration Foundation

**Status:** Implementation report for WP-6 Phase 1 (corrected). WP-6 is NOT
closed; Phase 2 is NOT authorized; no commit was created. The focused
independent review found defects F-1…F-9, which were remediated under the
externally granted Phase-1 correction authorization. A focused rereview is
required before Phase 1 may be accepted.

## Baseline

- Repository: `/home/chef/Documents/Project_Gateway_MCP`; branch `main`;
  baseline HEAD `52c69bff027da5c3534edf5d782c667aff4c2e93`
  (`docs: finalize WP-6 eligibility prerequisites`); parent
  `97022a49d9029449f304a2b1e47f9dc8da4d4a89`.
- Initial Git state: staging empty; `src/index.ts` modified; untracked
  `src/trusted/**` (12 files), `tests/trusted/**` (11 files), and this
  report; no other path differed; no Phase-1 commit existed.

## Authoritative Contracts Inspected

- `docs/design/post-wp5a-roadmap.md` (WP-6 package definition, supported lane,
  F-EL5 hardening assignment);
- `docs/design/trusted-workspace-and-ceiling-configuration.md` (trusted
  configuration contract; F-EL1 workspace-ID/root uniqueness; F-EL2
  non-existent/rename containment; F-EL3 host lane; F-EL4 classification;
  F-EL5 snapshot invariant; F-07 numeric ceiling semantics; F-F2
  trustedExtensionSet; plus the normative additions adopted under the
  correction authorization: strict unknown-field policy, root-resolver
  requirement, trusted host-lane operand, root secrecy boundary);
- `docs/design/capability-vocabulary.md` (v1 vocabulary, ADR-025 Accepted);
- `docs/design/artifact-core-architecture.md`, `artifact-domain-model.md`,
  `artifact-responsibility-matrix.md` (aggregate boundary; F-EL4);
- `docs/decisions/ADR-023…ADR-027` (Accepted);
- the focused-review report
  (`WP-6 Phase 1 Focused Implementation and Security Review`, findings
  F-1…F-9) and the externally granted correction authorization decisions 1–10.

Authority order honored: Accepted ADRs → normative design contracts →
explicit human correction decisions → committed source contracts →
implementation report.

## Focused-Review Findings and Remediation History

The independent focused review found nine defects. All were remediated in
this correction; the initial implementation is not represented as defect-free.

| ID | Severity | Finding | Remediation |
|---|---|---|---|
| F-1 | MAJOR | Shared snapshot captured arrays through ordinary `length`/index reads, so Proxy `get` traps fired for protocol-significant array values; report claimed they never fire | Array capture is now descriptor-derived (`src/internal/snapshot.ts`, shared pattern): length and every index acquired through own property descriptors; accessors rejected; sparse holes, unexpected own string properties, symbol keys, and malformed lengths fail closed; trap failures are typed; hostile tests now cover proxy-wrapped arrays |
| F-2 | MAJOR | Validation succeeded without a resolver, silently downgrading symlink-resolved overlap checks to lexical-only while emitting a normal trusted validated configuration | The root resolver is now mandatory: missing resolver → dedicated TCF-026; every accepted root has a resolver result; duplicate/overlap and identity use resolved canonical roots only; no lexical-only mode exists |
| F-3 | MAJOR | Identity workspace ordering used `localeCompare` (locale/ICU-dependent), diverging from the validated ordering and producing different identities across environments | One locale-independent code-unit comparator (`compareStrings`) is used consistently for validated workspace ordering, identity projection ordering, capability sets, extension declarations, and finding ordering; no protocol-significant `localeCompare` remains in the trusted implementation |
| F-4 | MODERATE | Unknown fields were silently ignored at every level without authoritative permission; misspelled restrictions could vanish with unchanged identity | Strict recursive unknown-field rejection (TCF-025) at every object layer; symbol keys fail closed at the snapshot boundary; the contract now records the strict policy; typo tests added |
| F-5 | MODERATE | Raw canonical roots were readable through the package-root API (`canonicalRoot`, `canonicalUtf8`, projection) | All trusted exports removed from the package root; `canonicalUtf8` removed from the validated runtime result (canonical bytes stay local to identity computation); roots remain trusted-process internal data in the internal validated model; contract records the root secrecy boundary |
| F-6 | MODERATE | `npm test` did not execute `tests/trusted/**` | The default test script now includes `dist-test/tests/trusted/*.test.js`; verified with a controlled failing-test check; one command runs the complete suite |
| F-7 | MODERATE | Supported host lane was documented only; validation succeeded on any host with no lane operand | Mandatory `hostLane` operand (`linux-x86_64-posix-utf8-node22`); missing → TCF-027, unsupported → TCF-028, checked before any input handling; accepted lane bound into validated configuration, identity projection, and digest |
| F-8 | MODERATE | 56 package-root export lines exposed internal trusted helpers without a consumer requirement | The package root exposes no trusted configuration API; the internal barrel (`src/trusted/index.ts`) retains only cohesive internal entry points; low-level helpers are module-local (tests import their modules directly) |
| F-9 | MINOR | Report test-inventory counts (sum 86) contradicted actual per-file counts (99) | This report now matches executed per-file counts exactly; the inventory below is verified by direct targeted runs |

## F-RR-1 Correction (Second Remediation Round)

### History

The focused rereview of the corrected Phase-1 implementation initially
returned `WP-6 PHASE 1 SECURITY REMEDIATION FOCUSED REREVIEW: ACCEPTED`
with open findings zero. The human coordinator rejected that acceptance
because the rereview's own recorded observation showed an
authority-widening omission: the shared object snapshot silently omitted an
own key when `ownKeys` reported the key but `getOwnPropertyDescriptor`
returned `undefined` or reported the key as non-enumerable. The coordinator
classified this as F-RR-1, MAJOR, and granted the F-RR-1 correction
authorization. The initial rereview is not represented as finding-free; its
own observation became the finding that this round corrects.

### Exact Reproduction (pre-correction, reproduced verbatim)

```text
CASE A (ownKeys reports globalActionCeiling, getOwnPropertyDescriptor
       returns undefined): ok=true, getCalls=0,
       globalActionCeiling absent from the validated result,
       identity equals the identity of a genuinely absent-field
       configuration: true
CASE B (non-enumerable data descriptor for globalActionCeiling):
       ok=true, getCalls=0, ceiling absent,
       identity equals the genuinely-absent configuration: true
```

### Why Field Omission Is Not Fail Safe for Ceilings

Capability and numeric ceilings restrict authority. Omitting an explicitly
surfaced ceiling widens effective authority: an advertised
`globalActionCeiling` (or workspace `actionCeiling`, capability ceiling,
`trustedExtensionSet`, or provenance) that is silently dropped during
capture produces a validated configuration that is behaviorally less
restrictive than the surface the caller advertised. Omission is therefore
not a fail-safe subset transformation, and identity must not collapse an
inconsistent advertised object surface into the identity of a genuinely
absent field — pre-correction, the dropped-ceiling configuration and the
truly ceiling-absent configuration shared one trusted identity.

### Central Shared-Object Correction

`src/internal/snapshot.ts` object branch (shared WP-4/WP-5A pattern; no
separate trusted-only snapshot framework):

- one structural key-enumeration pass (`Object.getOwnPropertyNames`);
- every listed own string key receives exactly one own-property descriptor
  lookup (`Object.getOwnPropertyDescriptor`);
- a listed key whose descriptor lookup returns `undefined` throws a typed
  `SnapshotError` (`missing own property descriptor for ...`) — never
  synthesized as a non-enumerable descriptor, never silently omitted;
- a listed non-enumerable own string property throws a typed `SnapshotError`
  (`non-enumerable own property ...`) — non-enumerable protocol state is
  unsupported and could conceal a restriction;
- accessor descriptors remain rejected without invocation;
- values are read from the data descriptor only; Proxy `get` traps never
  supply protocol values (zero `get` calls verified);
- throwing structural traps remain typed failures; deep immutability and
  no-reread-after-capture are unchanged;
- plain enumerable data objects remain byte-compatible; the array
  descriptor-derived branch (F-1) is unchanged;
- stateful structural Proxies remain within the accepted stable/plain-input
  determinism limitation, with safety fail-closed on every individual call.

### Typed-Failure Result

At the shared boundary both conditions surface as `SnapshotError`. At the
trusted boundary the existing message classification maps them to the
`descriptor-introspection-failed` kind, yielding deterministic `TCF-017`
(`snapshot or descriptor failure`) with `ok:false`, no validated
configuration, and no identity. No new TCF code was introduced; the
trusted snapshot wrapper and validator were not modified.

### New Tests and Counts

- `tests/unit/snapshot-objects.test.ts` (14 tests): plain objects; nested
  plain objects; zero Proxy `get` calls; throwing `get` never invoked;
  listed key with missing descriptor fails (never omitted, top-level and
  nested); listed non-enumerable data property fails; accessor fails
  uninvoked; throwing `ownKeys`; throwing `getOwnPropertyDescriptor`;
  throwing `getPrototypeOf`; revoked Proxy; mutation after capture;
  nested inconsistent Proxy; valid-object canonical bytes unchanged.
- `tests/trusted/hostile-input.test.ts` extended (18 → 24): advertised
  but undescribed top-level restrictive fields (`globalActionCeiling`,
  `globalCapabilityCeiling`, `trustedExtensionSet`, `provenance`) fail
  closed with `TCF-017`, zero `get` calls; advertised but undescribed
  workspace restrictive fields (`actionCeiling`, `capabilities`) fail
  closed; non-enumerable restrictive fields (all six) fail closed;
  failures produce no configuration and no identity; an inconsistent
  advertised surface cannot collapse into an absent-field identity;
  plain valid trusted configuration behavior unchanged.
- The host-lane operand is an options operand (plain string, checked
  before input handling, never snapshotted), so the F-RR-1 object-capture
  invariant applies to it only structurally through the validated
  configuration inputs it governs; no snapshot-path lane case exists.

Updated totals: shared regression 30 (array 16 + object 14); trusted suite
150 (144 + 6); complete default suite 695 (515 legacy + 30 shared + 150
trusted).

### Verification Evidence (post-correction)

- Production and test typecheck: PASS.
- `npm test`: 695/695 pass, 0 fail, 0 skipped, 0 todo; every test executes
  exactly once (695 = 515 + 16 + 14 + 144 + 6; duplicate executions 0).
- Direct shared object-snapshot regression: 14/14; direct shared array
  snapshot regression: 16/16; direct trusted hostile-input suite: 24/24;
  direct trusted identity suite: 19/19.
- WP-4/WP-5A regression (legacy globs): 545/545 (515 pre-existing + 30
  shared); conformance 531/531; schemas 51/51; semantic rules 114/114;
  digest vectors 19/19; generated corpus byte-reproducible.
- No-I/O scan passes (dist-wide, covers `dist/trusted/**`).
- Independent smokes: missing-descriptor Proxy fails closed with zero
  `get` calls, no configuration, no identity, deterministic `TCF-017`;
  non-enumerable ceiling fails closed with zero `get` calls; plain-object
  canonical bytes unchanged; mutation after capture has no effect.

Phase-1 acceptance remains pending a new independent final rereview.

## Files Added (second correction round)

- `tests/unit/snapshot-objects.test.ts` — shared descriptor-consistent
  object snapshot regression (F-RR-1, 14 tests).

## Files Modified (second correction round)

- `src/internal/snapshot.ts` — object-branch single structural
  key-enumeration pass: listed keys without descriptors and non-enumerable
  own string properties fail closed; listed keys are never silently
  omitted (F-RR-1).
- `tests/trusted/hostile-input.test.ts` — six F-RR-1 trusted configuration
  regressions added (18 → 24).
- `docs/design/trusted-workspace-and-ceiling-configuration.md` — F-EL5
  item 11 records the descriptor-consistency invariant (narrow
  clarification only; no scope change).

## Exact Phase-1 Scope

Implemented (deterministic, fail-closed, trusted-local configuration
foundation only):

1. `TrustedWorkspaceConfiguration` runtime model (trusted-local
   control-plane configuration object; repository-external; prospective
   input; outside the six aggregates and all artifact/lifecycle models);
2. configuration versioning (`1`; explicit only; no inference; mixed-version
   rejection; no implicit upgrade/downgrade);
3. explicit trusted host-lane operand (mandatory; identity-bound);
4. mandatory injected root resolver (no lexical-only validation mode);
5. strict recursive unknown-field rejection;
6. opaque workspace identifiers (`pgw:w:` grammar);
7. workspace-record validation;
8. workspace-ID and resolved-canonical-root uniqueness (duplicate/overlap
   fails the ENTIRE load; no first-wins/last-wins/merge/load-order);
9. global and workspace capability ceiling input structures;
10. global and workspace numeric action ceiling input structures;
11. `trustedExtensionSet` input structures (validated and frozen
    declarations only);
12. trusted configuration provenance (mandatory, identity-binding, trusted
    source kind only);
13. descriptor-derived snapshot hardening (F-EL5), arrays included;
14. deterministic locale-independent validated configuration identity;
15. typed fail-closed findings;
16. deeply immutable validated outputs with internal-only raw roots.

Not implemented (excluded, per authorization): path-containment decisions,
PointOfUseInputs v2 evaluator integration, conformance-corpus expansion, Pi
integration, pi-guard integration, MCP tools, persistence, project reading,
controlled writes, execution, TrustedReceipt behavior, and any filesystem,
network, Git, process, or authority action.

## Files Added

Production (`src/trusted/**`):

- `src/trusted/findings.ts` — typed finding model and report shape (28 codes);
- `src/trusted/workspace-id.ts` — workspace-ID grammar and validator;
- `src/trusted/numeric.ts` — numeric ceiling domain validation;
- `src/trusted/capabilities.ts` — accepted v1 capability vocabulary and
  canonical set ordering;
- `src/trusted/roots.ts` — lexical POSIX root canonicalization, mandatory
  injected symlink resolver, ancestor/overlap predicate;
- `src/trusted/provenance.ts` — provenance model (trusted source kind);
- `src/trusted/extension-set.ts` — trustedExtensionSet model and identity
  grammar;
- `src/trusted/snapshot.ts` — descriptor-derived snapshot wrapper with typed
  failure kinds;
- `src/trusted/identity.ts` — canonical projection and domain-separated
  SHA-256 identity (locale-independent ordering; host lane bound);
- `src/trusted/ordering.ts` — shared locale-independent code-unit comparator
  (correction F-3);
- `src/trusted/host-lane.ts` — accepted trusted host-lane operand
  (correction F-7);
- `src/trusted/types.ts` — input/validated types, version and lane constants,
  mandatory validation options;
- `src/trusted/validate.ts` — validation entry point and workspace lookup;
- `src/trusted/index.ts` — narrowed internal module-family barrel.

Tests (`tests/trusted/**`):

- `helpers.ts` (fixtures + mandatory `validOptions`), `valid-config.test.ts`,
  `version.test.ts`, `workspace-id.test.ts`, `roots.test.ts`,
  `capabilities.test.ts`, `numeric.test.ts`, `extension-set.test.ts`,
  `provenance.test.ts`, `hostile-input.test.ts`, `identity.test.ts`,
  `unknown-fields.test.ts` (F-4), `host-lane.test.ts` (F-7),
  `resolver-required.test.ts` (F-2), `export-surface.test.ts` (F-5/F-8).

Shared tests (`tests/unit/**`):

- `snapshot-arrays.test.ts` — shared descriptor-derived array snapshot
  regression (F-1);
- `snapshot-objects.test.ts` — shared descriptor-consistent object
  snapshot regression (F-RR-1).

Documentation:

- `docs/design/trusted-workspace-and-ceiling-configuration.md` — normative
  additions (strict unknown fields; resolver requirement; host-lane operand;
  root secrecy boundary);
- `docs/reports/wp-6-phase-1-trusted-configuration-foundation-implementation-report.md`
  (this report).

## Files Modified

- `src/index.ts` — the pre-correction trusted export block (56 insertions)
  was REMOVED; the package root now exposes no trusted configuration API
  (corrections F-5/F-8). The file is now byte-identical to HEAD and no
  longer appears as a modified path.
- `src/internal/snapshot.ts` — shared array capture is now descriptor-derived
  (correction F-1); symbol keys rejected; trap failures typed; object
  capture performs one structural key-enumeration pass with listed keys
  never silently omitted (correction F-RR-1).
- `package.json` — `test` script now includes
  `dist-test/tests/trusted/*.test.js` (correction F-6). Script-only change;
  `package-lock.json` untouched.

## Public and Internal APIs

Package root (`src/index.ts`): **no trusted configuration runtime API and no
root-bearing types are exported** (corrections F-5/F-8). Verified by the
export-surface test and by an import audit of the built package root.

Internal module family (`src/trusted/index.ts`, repository-internal only):

- `validateTrustedWorkspaceConfiguration(input, options)` —
  `TrustedConfigurationReport` (`ok`, sorted `findings`, `configuration`
  when valid); options require `hostLane` and `resolveRootPath`;
- `lookupValidatedWorkspace(configuration, workspaceId)` — exact
  deterministic workspace record lookup;
- `snapshotTrustedWorkspaceConfigurationInput(value)` /
  `TrustedSnapshotError` — descriptor-derived snapshot (typed kinds);
- `computeTrustedConfigurationIdentity(configuration)` /
  `trustedConfigurationProjection(configuration)` — internal identity
  computation (canonical bytes stay local to identity computation);
- types: `TrustedWorkspaceConfigurationInput`, `ValidatedTrustedWorkspaceConfiguration`,
  `ValidatedWorkspaceRecord`, `TrustedConfigurationReport`,
  `TrustedConfigurationFinding`, `TrustedConfigurationValidationOptions`,
  `RootPathResolver`, `TrustedExtensionSetInput`, `ValidatedTrustedExtensionSet`,
  and related input/validated types;
- constants: `TRUSTED_CONFIGURATION_VERSION`, `TRUSTED_HOST_LANE`,
  `CAPABILITY_VOCABULARY_VERSION`, `CAPABILITY_VOCABULARY_V1`,
  `TRUSTED_SOURCE_KIND`, `EXTENSION_SCOPES`.

Not barrel-exported (module-local; tests import modules directly): lexical
canonicalization helpers, ancestor predicates, numeric helpers, finding
constructors, sort helpers, fail-report builders, capability/extension
predicates, regex constants, digest-domain constants, workspace-ID
predicates.

Raw canonical roots remain inside the internal validated model
(`ValidatedWorkspaceRecord.canonicalRoot`) for later WP-6/WP-7/WP-11
trusted-process consumption; they are never exposed through the package
root, public identity, findings, or any external projection.

## Configuration-Version Decision

`TRUSTED_CONFIGURATION_VERSION = '1'` — one exact canonical representation.
Explicit field only: missing version fails (TCF-001, `version-missing`);
unknown version fails (TCF-001, `version-unsupported`); no inference from
field presence; no implicit upgrade/downgrade. Optional per-workspace
`recordVersion` must equal the top-level version (mixed-version input →
TCF-019). The version participates in the canonical identity projection.
`recordVersion` is a validation-time consistency check and is deliberately
not a member of the identity projection (the top-level `configurationVersion`
is the version identity input); this redundancy is explicit and consistent.

## Workspace-ID Grammar

`^pgw:w:[a-z0-9_-]{8,128}$` — fixed prefix `pgw:w:` plus an 8..128 character
lowercase alphanumeric/hyphen/underscore opaque token. Consistent with the
committed `pgw:w:` fixture model (32-hex opaque tokens). The restricted set
contains no `/`, `.`, `:`, or whitespace, so no filesystem root or path can
be embedded; identity is exact and case-sensitive; ASCII-only (no Unicode
normalization ambiguity); empty/malformed identifiers rejected (TCF-005);
duplicates fail the entire load (TCF-006). Findings never echo identifier
values.

## Provenance Representation

`{ "sourceKind": "trusted-local-control-plane" }` — the only accepted source
kind. Mandatory; participates in identity; missing/malformed → TCF-003;
any other source kind (including repository or `.pi`-style values) →
TCF-004. Findings never echo provenance values.

## Root Canonicalization Approach

Supported lane: Linux x86_64, POSIX semantics, UTF-8, Node.js 22.x (verified
22.23.2), represented by the mandatory `hostLane` operand
(`linux-x86_64-posix-utf8-node22`). Two stages: (1) lexical POSIX
normalization (absolute required; `.`/`..` resolved; `..` escape rejected;
repeated separators collapsed; trailing slash removed; NUL/control characters
rejected); (2) mandatory symlink resolution through the injected
`RootPathResolver` — the production core is I/O-free, so the host-boundary
resolver is caller-supplied (correction F-2). Missing resolver → TCF-026;
resolver results are re-canonicalized lexically; resolver failure (missing
path, loop, thrown error, malformed/relative/outside-lane result) → TCF-008
and fails the whole load. Uniqueness over resolved canonical roots: exact
duplicates (TCF-009), parent-child/containment/overlap (TCF-010) fail the
entire load; case semantics are byte-exact on the Linux lane; no
first-match/longest-prefix routing; no lexical-only validation mode exists.

## trustedExtensionSet Representation

Validated declarations: `version`; `permittedExtensionIds`;
`supportedBuiltinToolIds`; `trustedWebAccess` (packageId+version pairs);
`expectedToolSources` (toolName, packageId, scope ∈
user|project|temporary|package|top-level). Identity grammar
`[^\s/\\:]{1,128}`; duplicates rejected (TCF-024); unsupported scope
(TCF-023); malformed identities (TCF-022); structural issues (TCF-015);
strict unknown-field rejection inside every declaration (TCF-025);
canonical sorted output. No Pi sampling, no live-surface comparison, no
pi-guard activation; membership grants no capability or authority.

## Snapshot-Hardening Implementation

Reuses the WP-4/WP-5A descriptor-derived pattern (`snapshotJson`),
corrected per F-1: arrays are captured descriptor-derively — `length` and
every index are acquired through own property descriptors; ordinary indexed
reads are never used, so Proxy `get` traps never supply protocol values
(objects or arrays); accessor descriptors rejected without invocation;
sparse arrays, unexpected own string properties, symbol keys, malformed or
non-data lengths fail closed; Proxy structural traps (`ownKeys`,
`getOwnPropertyDescriptor`, `getPrototypeOf`) are the only trap category
invoked and are unavoidable for structural classification; throwing or
inconsistent structural traps fail closed as typed `SnapshotError` (and
TCF-017 at the trusted boundary); deep freeze; no rereading of caller
containers. Determinism is scoped per the accepted WP-5A rule for
intentionally stateful descriptor-changing structural Proxies. The
distinction between forbidden value-read traps and unavoidable structural
introspection traps is implemented and tested.

## Deterministic Identity Algorithm

Canonical projection with fixed shape and explicit omission rules (absent
optional fields omitted; explicitly empty arrays retained → omission vs
explicit empty are distinct identities); workspaces ordered canonically by
workspace identity using one locale-independent code-unit comparator
(`compareStrings`, correction F-3), so registration order and host locale
are non-semantic; serialization via the repository RFC 8785 serializer
(`jcsSerialize`); SHA-256 over domain `PGAP-TRUSTED-CONFIG-v1\0` + canonical
UTF-8 bytes, formatted `sha-256:<hex>`. The projection binds: configuration
version, capability-vocabulary version, accepted host lane, provenance,
global capability ceiling, global numeric ceiling, workspace records
(identity, resolved canonical root identity, capabilities, numeric ceiling),
and the trustedExtensionSet. Public identity is the digest only; canonical
bytes stay local to identity computation (not returned through the validated
runtime result); no root or machine-specific value is disclosed.

## Finding Codes (28)

TCF-001 unsupported/missing configuration version; TCF-002 malformed
structure; TCF-003 missing/malformed provenance; TCF-004 untrusted
provenance source; TCF-005 malformed workspace identifier; TCF-006 duplicate
workspace identifier; TCF-007 malformed root; TCF-008 root-resolution
failure; TCF-009 duplicate canonical root; TCF-010 overlapping/parent-child
root; TCF-011 malformed capability ceiling; TCF-012 unknown capability;
TCF-013 duplicate capability; TCF-014 malformed numeric ceiling; TCF-015
malformed trusted extension set; TCF-016 unsupported runtime input structure;
TCF-017 snapshot/descriptor failure; TCF-018 configuration identity failure;
TCF-019 mixed-version configuration; TCF-020 missing vocabulary version;
TCF-021 unsupported vocabulary version; TCF-022 malformed extension identity;
TCF-023 unsupported extension scope; TCF-024 duplicate extension declaration;
TCF-025 unknown field (correction F-4); TCF-026 missing root resolver
(correction F-2); TCF-027 missing trusted host lane (correction F-7);
TCF-028 unsupported trusted host lane (correction F-7).

Trusted-configuration findings use a dedicated typed finding model (same
conventions as artifact findings) rather than the artifact
`ValidationPhase`/`FailureCategory` pipeline: trusted configuration is not an
Artifact Core validation subject (F-EL4), and altering the committed
`VALIDATION_PHASES` contract would change the public artifact-phase ordering.

## Test Inventory

All counts below are verified by direct execution (per-file `node --test`
runs and the default `npm test`). Shared regression: `tests/unit/snapshot-arrays.test.ts`
(16 tests) and `tests/unit/snapshot-objects.test.ts` (14 tests, correction
F-RR-1). Trusted suite (`tests/trusted/**`, 14 files, 150 tests):

- `valid-config.test.ts` (7): minimal valid; multiple workspaces; ceilings;
  trustedExtensionSet; deep immutability (no canonical bytes returned);
  exact lookup; deterministic repeated validation.
- `version.test.ts` (7): accepted; unknown; missing; non-string;
  mixed-version; matching record version; version bound into identity bytes.
- `workspace-id.test.ts` (6): grammar bounds; malformed set; empty/missing;
  duplicates; registration-order independence; no root leakage.
- `roots.test.ts` (16): distinct roots; lexical normalization; invalid
  roots; exact duplicates (incl. normalization collapse); parent-child/
  containment; sibling non-overlap; symlink-resolved duplicate/containment;
  broken symlink; loop; throwing resolver; re-canonicalization;
  case-sensitive lane; order independence; helper predicates; no leakage.
- `capabilities.test.ts` (9): canonical sorting; duplicates; unknown IDs;
  explicit empty vs missing; vocabulary version mismatch/missing; fixed
  vocabulary (18 IDs); non-string entries.
- `numeric.test.ts` (9): zero; positive/MAX_SAFE_INTEGER; missing;
  NaN/±Infinity (TCF-016); negative/fractional (TCF-014); unsafe; negative
  zero; canonical decimal identity; non-number values; invalid-never-
  permission.
- `extension-set.test.ts` (10): valid identities/builtins; web-access;
  malformed identities; unsupported scope; all accepted scopes; missing
  security-critical fields; duplicates; canonical ordering; missing version;
  no authority fields.
- `provenance.test.ts` (6): valid; missing; malformed; repository-controlled
  attempts; identity binding; no leakage.
- `hostile-input.test.ts` (24): getters never invoked; throwing getters;
  object Proxy `get` traps unused; array Proxy `get` traps never fire;
  nested proxy arrays; accessor index; sparse arrays; throwing descriptor
  traps (TCF-017); stateful descriptor changes; cycles; unsupported
  prototypes; non-finite; mutation after validation; mutation during
  validation; nested mutable containers; typed snapshot errors; deep freeze;
  unexpected array own properties; F-RR-1: advertised-but-undescribed
  top-level restrictive fields (TCF-017, zero get calls);
  advertised-but-undescribed workspace restrictive fields; non-enumerable
  restrictive fields; no configuration/identity on F-RR-1 failures; no
  identity collapse into an absent-field configuration; plain valid
  behavior unchanged.
- `identity.test.ts` (19): same-semantics identity; order independence;
  mixed `-`/`_`/digit/letter canonical ordering; independent digest
  recomputation; version binding; provenance stability; host-lane binding;
  changed workspace content; changed ceilings; changed trustedExtensionSet;
  omission vs explicit empty (global and workspace); capability input
  ordering; Unicode byte determinism; deterministic UTF-8; resolved roots in
  identity; recomputation matches; digest domain; no root disclosure across
  externally observable fields.
- `unknown-fields.test.ts` (13): unknown field at every object layer
  (top-level, provenance, workspace record, ceiling container, extension
  set, web-access entry, tool-source entry); common misspellings; symbol
  keys; hostile unknown fields; no ignored-field identity collision;
  deterministic findings.
- `host-lane.test.ts` (9): accepted lane; missing lane; non-string lane;
  empty lane; unsupported lanes (wrong architecture, Windows, macOS,
  non-POSIX, future); no lane inference from input; lane identity binding;
  unsupported lane fails before input handling; resolver under accepted
  lane.
- `resolver-required.test.ts` (10): missing resolver; non-function
  resolver; no lexical-only downgrade; identity resolver supplies every
  root; relative result; non-POSIX results; symlink duplicate; symlink
  overlap; resolved roots bound into identity; no unresolved-validation
  mode.
- `export-surface.test.ts` (5): package root exposes no trusted runtime
  APIs; no root-bearing types/domain constants; internal barrel retains
  entry points and hides low-level helpers; no report-field root disclosure;
  failure findings never disclose roots.

## Baseline Regression Results (post-correction)

- Production typecheck: PASS.
- Test typecheck: PASS (includes `tests/trusted/**`,
  `tests/unit/snapshot-arrays.test.ts`, and
  `tests/unit/snapshot-objects.test.ts`).
- Repository-default `npm test`: **695/695 pass, 0 fail, 0 skipped, 0 todo**
  (515 WP-4/WP-5A tests + 30 shared snapshot regression (16 array + 14
  object) + 150 trusted tests). The F-1 round's controlled failing-test
  check (676/1: 676 executed, 1 failed, then removed) was re-verified in
  the F-RR-1 round with a controlled failing test (696/1: 696 executed,
  695 passed, 1 failed, then removed); no test is executed twice (total
  equals the sum of unique files; duplicate executions 0).
- Direct trusted-suite command: `node --test dist-test/tests/trusted/*.test.js`
  → 150/150.
- Shared snapshot regressions: `node --test dist-test/tests/unit/snapshot-arrays.test.js`
  → 16/16; `node --test dist-test/tests/unit/snapshot-objects.test.js`
  → 14/14.
- Conformance: **531/531** (unchanged).
- Schemas: **51/51** (unchanged).
- Semantic rules: **114/114** (unchanged — no AUT-*/fixture rule changes).
- Digest vectors: **19/19** (unchanged).
- Generated corpus: byte-reproducible — post-build Git state shows no
  `dist/` or `src/generated/` change.
- No excluded path changed; no production dependency changed (package.json
  test-script field only; package-lock.json untouched); staging remains
  empty.

## Security-Test Results

- No-I/O core policy preserved: `src/trusted/**` performs no filesystem,
  network, process, or `Date.now` usage (only `node:crypto` hashing in
  `identity.ts`); root symlink resolution is caller-injected; the existing
  security suite (including the dist-wide forbidden-I/O scan, which covers
  `dist/trusted/**`) passes.
- Snapshot hardening: getters never invoked; Proxy `get` traps never fire
  for protocol-significant reads (objects and arrays); descriptor traps and
  unsupported structures fail closed with typed findings; mutation after
  validation cannot change validated state.
- Mandatory host facts: the resolver and host lane are required operands;
  no identity-invisible downgrade exists.
- Unknown fields: strict recursive rejection; misspellings cannot silently
  remove restrictions.
- Root secrecy: no root/path/secret disclosure through findings, opaque
  identifiers, the public digest, or the package-root API; canonical bytes
  are not returned through the validated runtime result.

## Supported Host Lane

Represented by the mandatory trusted compatibility operand
`hostLane: "linux-x86_64-posix-utf8-node22"` (Linux; x86_64; POSIX-style
filesystem semantics; UTF-8 locale; Node.js 22.x, verified 22.23.2). The
core never ambiently probes the host. Windows, macOS, case-insensitive
filesystems, network filesystems, and non-POSIX path semantics are
unverified and unsupported; missing (TCF-027) and unsupported (TCF-028)
lanes fail closed before any input handling. The accepted lane is bound
into the validated configuration, identity projection, and digest.

## Known Limitations

1. The production `node:fs`-backed root resolver is a host-boundary
   component outside the I/O-free core and is not included in Phase 1; the
   mandatory injected `RootPathResolver` interface is the contract point.
2. `recordVersion` is a validation-time mixed-version guard and is not a
   member of the identity projection (explicit redundancy).
3. NaN/±Infinity numeric values are rejected at the snapshot stage (TCF-016)
   rather than the numeric-ceiling stage (TCF-014); both fail closed and the
   split is documented and stable.
4. Provenance is a constant label (`trusted-local-control-plane`); the
   contract defines a single trusted source kind; instance/origin/revision
   identity is a WP-8 (persistence) concern.
5. `expectedToolSources` carries no per-tool version and no
   security-critical classification; the F-F2(6)/(7) source-version and
   criticality/fallback semantics are resolved by the WP-5B consumption
   contract.
6. Pre-existing WP-4/WP-5A code outside the trusted module family retains
   its committed locale-based ordering in non-trusted paths; the trusted
   configuration implementation contains no protocol-significant
   `localeCompare` usage.

## Excluded Responsibilities

Approval, RuntimeGrant/lifecycle issuance, persistence (WP-8), project
reading (WP-7), controlled writes (WP-11), activation decisions (WP-12), Pi
tool inventory sampling and pi-guard activation (WP-5B), execution (WP-13),
TrustedReceipt issuance (WP-15), PointOfUseInputs v2 evaluator integration,
path-containment decisions, conformance-corpus expansion, MCP surfaces, and
any Artifact Core aggregate/schema-catalog change.

## Final Git State

- Staging: empty.
- No commit created; no push, tag, release, publication, installation, or
  deployment.
- Differences from HEAD: `M docs/design/trusted-workspace-and-ceiling-configuration.md`
  (normative additions incl. F-EL5 item 11), `M package.json`
  (test-script integration only), `M src/internal/snapshot.ts`
  (descriptor-derived array capture F-1 + descriptor-consistent object
  capture F-RR-1); untracked `src/trusted/` (14 files), `tests/trusted/`
  (14 test files + helpers), `tests/unit/snapshot-arrays.test.ts`,
  `tests/unit/snapshot-objects.test.ts` (F-RR-1), and this report under
  `docs/reports/`. `src/index.ts` is byte-identical to HEAD.
- No Phase-2 behavior exists.

## Unresolved Findings

None within Phase 1 scope. Pending decisions (not findings): the
implementation report and the corrected implementation are untracked and
require the final-rereview and commit gate; Phase-1 acceptance remains
pending a new independent final rereview after the F-RR-1 correction;
Phase 2 authorization is a separate decision.

## Recommendation

Recommend a new independent final rereview of the F-RR-1-corrected
Phase-1 implementation and this report before any acceptance or commit
decision.
