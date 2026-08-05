# WP-6 Phase 2B-P Implementation Report — Trusted Artifact-Location Configuration

**Status:** Implementation report for WP-6 Phase 2B-P (implemented under the
externally granted WP-6 Phase 2B-P Human Implementation Authorization;
then corrected under the externally granted WP-6 Phase 2B-P security-
correction authorization after the focused review returned
`WP-6 PHASE 2B-P FOCUSED REVIEW: CORRECTIONS REQUIRED` with F-2BP-FR-01
(MAJOR, promoted by the human acceptance gate), MINOR-1, and MINOR-2).
WP-6 is NOT closed; Phase 2B-P is NOT accepted; no commit was created.
Phase 2B destination containment, nearest-existing-ancestor handling,
artifact persistence, and Phase 3 (PointOfUseInputs v2) are NOT authorized
and have not started. A final independent security rereview is required
before Phase 2B-P may be accepted and committed.

## Baseline

- Repository: `/home/chef/Documents/Project_Gateway_MCP`; branch `main`;
  baseline HEAD `4a3415f9629768adb631f16caace5bba80140688`
  (`feat: establish WP-6 existing-path containment core`); parent
  `a93eacad45e439b88a77b695023c3352cb520df3`.
- Initial Git state: staging empty; working tree clean; zero untracked
  paths; no tag on HEAD; no Phase-2B-P implementation; Phase 1 (`a93eaca`)
  and Phase 2A (`4a3415f`) authoritative.
- Baseline verification: production typecheck PASS; test typecheck PASS;
  repository-default tests 821/821 (0 fail, 0 skipped, 0 todo; duplicate
  executions 0); conformance 531/531; schemas 51/51; semantic rules 114/114;
  digest vectors 19/19; generated corpus byte-reproducible.

## Authoritative Sources

- WP-0 scope and principles (configured project-visible artifact location;
  only write boundary = validated artifact drafts in configured artifact
  locations; artifact location not supplied by ChatGPT/repository content);
- ADR-001/ADR-002/ADR-004 (product boundary; trust/approval boundary; MVP
  capability boundary);
- `trusted-workspace-and-ceiling-configuration.md` (versioning rules;
  F-EL1/F-EL2/F-EL3/F-EL4/F-EL5; Phase-2A section recording the Phase-2B
  blocker);
- `artifact-domain-model.md` (six aggregates; ExecutionBundle composition;
  ExecutionResult retrospective observation);
- the accepted Phase-2B-P focused eligibility-correction review
  (F-2BP-01/F-2BP-02 dispositions; the 19 authoritative human decisions);
- Phase-1 and Phase-2A implementation reports; committed `src/trusted/**`.

Authority order honored: WP-0 product ceiling → accepted ADRs → normative
design contracts → explicit human Phase-2B-P authorization → committed
source contracts → reports.

## Exact Work-Package Scope

Implemented:

1. explicit configuration version dispatch — versions `1` and `2` accepted,
   exact version-specific shapes, no permissive union-superset parsing;
2. version-2 workspace shape — every version-1 field plus one optional
   `artifactLocation` plain-string field;
3. zero-or-one artifact-location cardinality; omission = no artifact-draft
   persistence location, no write authority, no workspace-root fallback;
4. `ArtifactLocationResolver` trusted injected evidence interface
   (success: canonical path + entry kind exactly `directory`; failure:
   not-found / loop / inaccessible / ambiguous / unsupported-entry-kind /
   error); exactly one resolution per configured location; the committed
   Phase-1 `RootPathResolver` contract is untouched;
5. directory-existence and entry-kind validation — the final canonical
   target must exist at validation time and be a directory; regular files,
   sockets, FIFOs, devices, unknown entry types, broken links, loops,
   inaccessible, ambiguous, and generic errors fail closed; malformed
   evidence (relative/Windows/UNC/NUL/control) fails closed;
6. root relationship — final canonical artifact directory must be a strict
   component-boundary descendant of the canonical workspace root; equality
   with the workspace root prohibited; canonical `/` prohibited; resolver
   escape and outside-workspace placement fail closed; cross-workspace
   defense-in-depth check;
7. version-2 identity — presence-aware canonical artifact directory bound
   into the projection and digest; version-1 identities byte-identical;
   raw configured paths are not identity operands;
8. runtime genuineness — the existing single WeakSet brand covers
   successful v1 and v2 configurations; artifact-location validation and
   identity computation complete before branding; failed validation never
   brands; no second brand; no serialized brand state;
9. `lookupValidatedArtifactLocation` — internal, genuineness-checked,
   immutable metadata (configuration identity, workspace ID, canonical
   artifact directory, fixed four-draft scope); undefined for v1, unknown
   workspaces, and v2 omissions;
10. four-draft scope constant — exactly TaskSpec, AuthorityPolicy,
    ContextManifest, CompletionContract; ExecutionBundle and ExecutionResult
    excluded with no storage assignment;
11. TCF finding extensions (TCF-030…TCF-042, 29 → 42 codes);
12. strict snapshot and version-specific unknown-field hardening;
13. tests (92 new) and this report.

Not implemented (excluded per authorization): destination containment,
nearest-existing-ancestor handling, artifact persistence, filename or
subdirectory selection, generic write/create/overwrite/delete/rename/move,
source-code editing, filesystem mutation, RuntimeGrant, approval,
execution, ExecutionBundle storage, ExecutionResult storage, TrustedReceipt
behavior, MCP tools, Pi/pi-guard behavior, PointOfUseInputs v2.

## Configuration Placement

Model A: the artifact location is a direct optional field of the version-2
workspace record inside `TrustedWorkspaceConfiguration` — one trusted
configuration object is the single source of truth for workspace identity,
root, ceilings, lane, provenance, trustedExtensionSet, and artifact-location
presence/canonical directory. No separate ArtifactLocationConfiguration
object and no WP-8 registry placement.

## Explicit v1/v2 Dispatch

`TRUSTED_CONFIGURATION_VERSION = '1'` and `TRUSTED_CONFIGURATION_VERSION_2 =
'2'`; `TrustedConfigurationVersion = '1' | '2'`. The validator accepts
exactly these two strings; empty/unknown versions fail closed (TCF-001);
no inference; no implicit upgrade or downgrade; version-1 input carrying
`artifactLocation` fails strict unknown-field rejection (TCF-025); the
version-1 workspace key set is unchanged; the version-2 key set adds
`artifactLocation`; `recordVersion` must equal the top-level accepted
version (mixed-version TCF-019). No "latest version" constant was added
(repository conventions do not require one; callers dispatch explicitly).

## Exact Version-2 Workspace Shape

All version-1 workspace fields (`workspaceId`, `root`, `recordVersion`,
`capabilities`, `actionCeiling`) plus one optional `artifactLocation`
plain-string field. No nested object, no artifact-kind arrays, no write
operations, no filenames, no extensions, no destination templates, no
source-tree classifications, no persistence options, no overwrite policies,
no ExecutionBundle/ExecutionResult routing.

## Optionality and Cardinality

Zero or one artifact location per version-2 workspace. Omission grants no
write authority, does not inherit the workspace root, and produces a
canonical projection distinct from presence. A single version-2
configuration may mix configured workspaces and read-only workspaces. The
`ArtifactLocationResolver` option is required at runtime only when at least
one version-2 workspace declares an artifact location (TCF-032 otherwise);
it is not required for v1 or for v2 configurations with no locations, and
when supplied but unused it is not protocol-significant.

## ArtifactLocationResolver Contract

Dedicated internal interface (`src/trusted/artifact-location.ts`):

- success: `{ ok: true, canonicalPath: string, entryKind: 'directory' }`;
- failure: `{ ok: false, code: 'not-found' | 'loop' | 'inaccessible' |
  'ambiguous' | 'unsupported-entry-kind' | 'error' }`.

Injected by a trusted caller; the configuration core performs no filesystem
I/O; request/repository content can never supply resolution evidence;
exactly one trusted resolution outcome per configured artifact location per
validation attempt; resolver throws fail closed; malformed tagged results
(relative, Windows drive, UNC, NUL/control canonical paths) fail closed;
caller assertions such as `exists: true` or `isDirectory: true` cannot
appear in the configuration shape (strict unknown-field rejection). The
Phase-1 `RootPathResolver` contract is unchanged.

## Directory-Existence and Entry-Kind Validation

Per configured version-2 location: snapshot → exact version-2 strict shape →
configured path validated as absolute trusted-local POSIX input (relative,
Windows, UNC, NUL/control, traversal-escape forms rejected) → lexically
canonicalized → resolver invoked exactly once → entry kind exactly
`directory` required → final canonical path re-canonicalized under the
supported POSIX lane → `/` rejected → equality with the workspace root
rejected → strict component-boundary descendant required → only the final
canonical directory stored and identity-bound. Successful validation proves
only the trusted evidence observed at validation time (the target existed
and was a directory); no ongoing-existence, race-freedom, or persistence
claims; Phase 2B/WP-11 perform their own point-of-use validation.

## Root Relationship

Strict component-boundary descendant of the canonical workspace root;
equality prohibited (would recreate generic workspace writes); `/`
prohibited; `/workspace/a-artifacts` is not inside `/workspace/a`
(sibling-prefix safe); resolver escape fails closed; defense-in-depth
cross-workspace check (TCF-042) is kept explicit and is unreachable for
validated configurations because Phase-1 prohibits overlapping workspace
roots. `inside workspace root` is never equated with `authorized write
destination`.

## Four-Draft Scope

`ARTIFACT_DRAFT_LOCATION_KINDS = ['TaskSpec', 'AuthorityPolicy',
'ContextManifest', 'CompletionContract']` — an internal immutable,
versioned protocol constant; no caller- or configuration-supplied kind
arrays; no per-kind routing, filenames, extensions, subdirectories, or
destination templates. Excluded kinds (ExecutionBundle, ExecutionResult,
TrustedReceipt, lifecycle records, implementation reports) receive no
storage destinations.

## ExecutionBundle Disposition

Derived/reference composition aggregate (artifact-domain-model: "sole core
aggregate that performs this composition"); not automatically a
ChatGPT-authored draft; not automatically assigned to the draft location;
no storage or persistence contract in this work package.

## ExecutionResult Disposition

Retrospective execution output (artifact-domain-model: "records
retrospective observations"); not a prospective draft; outside the
draft-location boundary; not TrustedReceipt; no storage or persistence
contract in this work package.

## Runtime Genuineness

The existing single process-local WeakSet brand
(`src/trusted/configuration-brand.ts`) covers successful version-1 and
version-2 configurations: complete version-specific validation, all
artifact-location resolution/directory validation, and identity computation
complete before branding; the exact final frozen validated object is
branded; failed validation never brands; clones, spreads, JSON round-trips,
forged digests, manually frozen lookalikes, and Proxy wrappers remain
non-genuine; no second brand; marking operation unexported; brand state
never serialized.

## Version-2 Identity Projection

The version-1 projection is byte-identical (workspace records never carry
`artifactLocation` in v1). The version-2 projection binds: configuration
version `2`, capability-vocabulary version, host lane, provenance, every
workspace ID, every canonical workspace root, workspace capability and
numeric ceiling presence/values, global ceilings, trustedExtensionSet, and
artifact-location presence-versus-omission with the canonical resolved
artifact directory when present. Raw configured paths are not identity
operands (an alias resolving to the same canonical directory yields the
same identity); resolver implementation identity is not an operand; entry
kind is not an operand (successful semantics permit only `directory`);
caller kind lists do not exist; v1 and v2 identities cannot be confused
(version is a projection member); canonical bytes remain internal; raw
roots are not exposed by identity strings. The digest domain
(`PGAP-TRUSTED-CONFIG-v1\0`) is unchanged because the configuration version
is a projection member and v1 identities must remain byte-identical.

## Lookup Model

`lookupValidatedArtifactLocation(configuration, workspaceId)` (in
`src/trusted/validate.ts`, internal): checks runtime genuineness before
reading any configuration field; returns undefined for version 1, unknown
workspace IDs, and version-2 workspaces that omit `artifactLocation`;
returns deeply immutable metadata correlating configuration identity,
workspace ID, canonical artifact directory, and the fixed four-draft scope.
Exposes no package-root API; grants no authority; returns no RuntimeGrant,
approval, destination-containment decision, persistence handle, or
ExecutionBundle/ExecutionResult storage information.
`lookupValidatedWorkspace` is unchanged in behavior. It does not itself
select or return artifact-location data as a dedicated surface, but genuine
version-2 workspace records returned inside the trusted-process boundary
legitimately carry the canonical artifact location as part of the validated
record; Phase-2A consumers read only workspace identity and the canonical
workspace root; the data remains inside the trusted-process boundary, and
`lookupValidatedArtifactLocation` remains the dedicated artifact-location
lookup surface.

## Finding Codes

TCF-030 malformed version-2 artifact-location field; TCF-031 invalid
absolute configured artifact path; TCF-032 missing ArtifactLocationResolver
when a location is present; TCF-033 artifact-location resolver failure
(thrown or reported error); TCF-034 malformed resolver result; TCF-035
configured location not found; TCF-036 configured location is not a
directory (unsupported entry kind); TCF-037 symlink loop; TCF-038 final
canonical location is the whole-filesystem root; TCF-039 final canonical
location outside the workspace root; TCF-040 final canonical location
equals the workspace root; TCF-041 ambiguous resolution; TCF-042 artifact
location ambiguous across registered workspaces (defense-in-depth;
unreachable for validated configurations). Static, deterministic,
root-safe, path-safe, immutable messages; deterministic ordering; the TCF
catalog is now 42 codes (29 + 13).

## Security Correction (F-2BP-FR-01, second round)

### History

The focused review of the Phase-2B-P implementation returned
`WP-6 PHASE 2B-P FOCUSED REVIEW: CORRECTIONS REQUIRED` with one MAJOR
finding and two MINOR findings. F-2BP-FR-01 (ArtifactLocationResolver
evidence consumed through ordinary property access) was promoted to MAJOR
by the human acceptance gate because the reproduced behavior (evidence
getters invoked; Proxy `get` traps invoked; prototype-inherited protocol
fields accepted; a throwing getter escaping
`validateTrustedWorkspaceConfiguration` as an exception) violated the
explicit authorization acceptance criteria (deterministic capture, fail
closed, no getter invocation, zero Proxy `get`, no mixed evidence, typed
failure rather than an escaping exception). MINOR-1 (per-file test counts
and inventory wording) and MINOR-2 (`lookupValidatedWorkspace` wording)
were corrected; NOTE-2 (digest domain) and NOTE-3 (helper path) were
disposed. Prior historical events are not rewritten.

### Reproduction (pre-correction, verbatim)

- getter on the `ok` discriminator: invoked once; evidence accepted;
- throwing getter on `ok`: the exception escaped
  `validateTrustedWorkspaceConfiguration`;
- Proxy with counted `get`: three `get` trap invocations;
- prototype-inherited `ok`/`canonicalPath`/`entryKind`: accepted;
- accessor `canonicalPath`: getter invoked; evidence accepted.

### Corrected Evidence-Capture Model

`src/trusted/artifact-location.ts` now captures the resolver return value
exactly once through the repository's committed descriptor-derived snapshot
(`snapshotJson`, imported from `src/internal/snapshot.js`; that module is
NOT modified): no protocol-field getters, zero Proxy `get`, only own
string-keyed properties, prototype-inherited fields rejected, accessors
rejected uninvoked, missing own descriptors rejected, non-enumerable
required fields rejected, symbol properties rejected, unsupported
prototypes rejected, cycles rejected, every accepted data-descriptor value
read once into a detached deeply frozen representation before semantic
interpretation (no mutation-dependent mixed evidence), and throwing
structural traps converted into a typed fail-closed result — malformed
evidence never escapes as an exception. Exact tagged variant shapes are
validated after capture: success `{ok: true, canonicalPath, entryKind:
'directory'}` (three exact own keys) and failure `{ok: false, code}` (two
exact own keys, accepted vocabulary unchanged). Unknown fields, missing
fields, mixed variant shapes, malformed discriminators, wrong primitive
types, and unknown status codes fail closed. No new resolver capabilities
and no caller-supplied evidence fields were added.

### Exception and Finding Mapping

- resolver invocation throwing: unchanged mapping to TCF-033
  (resolver failure);
- malformed, structurally hostile, or unparseable evidence (including any
  trap or exception encountered while descriptor-capturing the returned
  value): mapped to the existing TCF-034 (malformed resolver result) — no
  new TCF code was required;
- every malformed-evidence case produces `ok:false`, a deterministic typed
  finding, no configuration, no configuration identity, no genuine brand,
  and no artifact-location lookup result;
- exactly one resolver invocation per configured artifact location (the
  capture never re-invokes the resolver).

### New Tests

`tests/trusted/artifact-location-evidence.test.ts` (23 tests): genuine
success evidence; normal tagged failures (all six status codes with their
intended TCF mappings); getter discriminator non-invocation; throwing
getter no-escape; zero Proxy `get`; accessor `canonicalPath` and `entryKind`
non-invocation; prototype-inherited discriminator/canonical-path/entry-kind
rejection; non-enumerable field rejection; symbol rejection; unsupported
prototype rejection; unknown-field rejection; missing-descriptor rejection;
mutation-between-reads mixed-evidence rejection; throwing descriptor/Proxy
trap fail-closed; every malformed-evidence case yields no configuration/
identity/brand/lookup; exact resolver invocation count; hostile evidence
adds no invocations; resolver-throw TCF-033 mapping; multi-workspace
atomicity (one hostile evidence fails the entire load with no partial
configuration, identity, brand, or lookup, and every configured location
invoked at most once); unchanged directory/failure-status/root-relationship
behavior.

### Corrected Test Counts

The earlier inventory miscounted two suites; the actual counts are
directory-evidence suite **29** (not 30) and genuineness-and-lookup suite
**13** (not 12); the Phase-2B-P total was and remains **92** before this
round. With the 23 new evidence tests, the corrected totals are:
Phase-2B-P suite **115** (7 test files + one test fixture/helper module);
trusted suite **391** (150 + 126 + 115); complete default suite **936**
(515 legacy + 30 shared + 391 trusted); `npm test` **936/936 pass, 0 fail,
0 skipped, 0 todo**, every test exactly once.

Phase-2B-P acceptance remains pending a final independent security
rereview.

### Correction History — Final-Inventory Wording (MINOR, third round)

The final security rereview returned
`WP-6 PHASE 2B-P FINAL SECURITY REREVIEW: CORRECTIONS REQUIRED` with one
residual MINOR finding: the implementation report's `Final Git State`
sentence did not accurately enumerate the ten untracked Phase-2B-P paths
(the pre-evidence-round wording "six `artifact-location-*` files (5 test
files + helpers)" with the evidence test listed separately could not
reconcile to the actual inventory). This documentation-only correction
rewrites that sentence with explicit enumeration and arithmetic: 1
production module + 7 test files + 1 fixture/helper + 1 report = 10
untracked paths; complete working tree = 7 modified tracked + 10 untracked
= 17 total paths; zero deletions; zero renames. No runtime, test,
identity, finding, export, security, or protocol behavior changed; all
prior `936/936` verification evidence remains unchanged. Phase-2B-P
acceptance remains pending a final bounded rereview. Earlier historical
findings and verdicts are not rewritten.

## Files Added

Production (`src/trusted/**`):

- `artifact-location.ts` — resolver evidence interface, four-draft scope
  constant, configured-path canonicalization, directory resolution and
  containment validation helpers.

Modified (`src/trusted/**`):

- `types.ts` — `TRUSTED_CONFIGURATION_VERSION_2`,
  `TrustedConfigurationVersion`, v2 input/validated shapes, options
  `resolveArtifactLocation`;
- `validate.ts` — explicit v1/v2 dispatch, version-specific key sets,
  resolver-requirement rule, per-workspace artifact-location validation,
  post-loop cross-workspace defense check, version-aware recordVersion,
  version-aware validated configuration, branding unchanged,
  `lookupValidatedArtifactLocation`;
- `findings.ts` — TCF-030…TCF-042;
- `identity.ts` — presence-aware workspace projection member;
- `index.ts` — narrow internal exports
  (`lookupValidatedArtifactLocation`, `ValidatedArtifactLocationLookup`,
  `TRUSTED_CONFIGURATION_VERSION_2`, `TrustedConfigurationVersion`,
  `ARTIFACT_DRAFT_LOCATION_KINDS`, resolver evidence types).

Tests (`tests/trusted/**`):

- `artifact-location-helpers.ts` (fixtures);
- `artifact-location-versioning.test.ts` — version dispatch and v1
  compatibility;
- `artifact-location-directory.test.ts` — directory evidence and root
  relationship;
- `artifact-location-identity.test.ts` — version-2 identity;
- `artifact-location-lookup.test.ts` — genuineness and lookup;
- `artifact-location-hostile.test.ts` — hostile version-2 input;
- `artifact-location-scope.test.ts` — four-draft scope and product
  boundary.

One existing test expectation updated for the new protocol:
`tests/trusted/version.test.ts` — the unsupported-version expectation moved
from `'2'` to `'3'` (because `'2'` is now an accepted version), and the
additive unsupported cases `'0'` and `'v1'` were added to the same test;
the assertion semantics are unchanged.

Documentation:

- `docs/design/trusted-workspace-and-ceiling-configuration.md` — narrow
  Phase-2B-P section;
- `docs/reports/wp-6-phase-2b-p-trusted-artifact-location-implementation-report.md`
  (this report).

Correction round (F-2BP-FR-01): modified `src/trusted/artifact-location.ts`
(descriptor-derived evidence capture and exact variant validation); added
`tests/trusted/artifact-location-evidence.test.ts` (23 tests); report and
design-document corrections as recorded above.

## Tests Added

115 tests across 7 test files plus one test fixture/helper module (all
verified by direct execution and by the default `npm test`; the committed
trusted glob discovers them automatically — no package.json change).
Corrected per-file counts: versioning **11**; directory evidence and root
relationship **29**; v2 identity **12**; genuineness and lookup **13**;
configuration hostile input **16**; scope and product boundary **11**;
resolver-evidence capture (correction F-2BP-FR-01) **23**.

- versioning (11): v1 valid with unchanged identity; v1 records carry no
  location; v1 lookup undefined; v1 with artifactLocation fails (TCF-025);
  v2 all-omitted valid; v2 configured valid; v2 mixed configured/read-only;
  unknown/missing versions (TCF-001); no implicit migration; no
  workspace-root fallback; v1-vs-v2 identity distinction.
- directory evidence and root relationship (29): existing/deep bounded
  directories; symlink-to-internal-directory via canonical evidence;
  regular file; symlink-to-file; socket/FIFO/device/unknown kinds; not
  found; broken link; loop; inaccessible; ambiguous; generic error; throwing
  resolver; malformed tagged result; relative/Windows/UNC canonical results;
  missing resolver when present; resolver not required when absent; exact
  invocation count; malformed configured paths; non-string field;
  strict descendant; equality rejected; sibling prefix; outside workspace;
  canonical `/`; raw non-root resolving to `/`; resolver escape;
  cross-workspace placement (strict-descendant precedence); registration
  order; helper units.
- v2 identity (12): deterministic repetition; independent digest
  recomputation; v1 projection unchanged; v1-vs-v2 differ; presence vs
  omission; directory change; workspace change; ceilings/extension set/
  provenance still bound; order independence; canonical-alias identity
  equality (raw paths not operands); no raw-root disclosure; version bound.
- genuineness and lookup (13): genuine v2 lookup with immutable metadata;
  omission/v1/unknown-workspace undefined; forged lookalike; correct-digest
  forgery; clone; Proxy wrapper; failed directory validation produces no
  brand; lookup immutability and no-authority fields; no package-root
  export + barrel scope; brand non-serialized; single shared brand across
  versions; attacker-location failure never brands; hostile v2 validation
  never yields a branded object.
- hostile input (16): getters; throwing getters; Proxy `get`; missing
  descriptors; non-enumerable artifactLocation; accessor artifactLocation;
  symbols; cycles; unsupported prototypes; mutation during snapshot;
  mutation after snapshot; unknown v2 fields; caller existence flag;
  caller entry-kind flag; caller artifact-kind list; deep freeze.
- scope and product boundary (11): four-draft scope exact; excluded kinds;
  scope immutability; lookup metadata only; no routing/filename metadata;
  configured directory is not write authority; no destination/nearest-
  ancestor/persistence/mutation tokens; no filesystem/shell/network/Git/
  MCP/Pi/execution fields; no bundle/result storage; package-root negative
  exports; v2 record shape exact.

## Exact Test Totals

- Phase-2B-P suite: **115** (7 test files + one test fixture/helper module).
- Trusted suite: **391** = 150 (Phase-1) + 126 (Phase-2A) + 115 (Phase-2B-P).
- Complete default suite: **936** = 515 legacy + 30 shared + 391 trusted.
- `npm test`: **936/936 pass, 0 fail, 0 skipped, 0 todo**; every test
  executes exactly once (duplicate executions 0).

## Version-1 Compatibility Results

All 150 Phase-1 trusted tests pass unchanged except the single updated
version-test case described above; version-1 identities are byte-identical
across repeated validation; the version-1 projection contains no
artifactLocation member; Phase-2A containment behavior is unchanged
(126/126); TCF-029 and TCP-021 behavior unchanged; package-root export
boundary unchanged.

## Phase-1 and Phase-2A Regression Results

Phase-1 trusted suite 150/150; Phase-2A suite 126/126; shared snapshot
30/30; legacy WP-4/WP-5A globs 545/545.

## Conformance/Schema/Rule/Vector/Corpus Results

Conformance **531/531**; schemas **51/51**; semantic rules **114/114**;
digest vectors **19/19**; generated corpus byte-reproducible. No Artifact
Core schema, AUT-*, fixture, vector, or corpus change.

## Package-Export Result

The package root exposes no Phase-2B-P API, type, constant, or resolver
evidence surface (negative export tests + smoke). The internal barrel
exposes only the cohesive entry points listed above; low-level helpers
(`canonicalizeConfiguredArtifactPath`, `resolveConfiguredArtifactLocation`)
are module-local.

## Root-Secrecy Result

Findings never echo configured paths, canonical roots, resolver values, or
secrets (static messages); identity digests disclose no path material; the
validated result carries no canonical bytes; internal canonical artifact
directories exist only inside trusted-process validated records and lookup
metadata; brand state is absent from serialization, projections, digest
bytes, findings, and declarations.

## No-I/O Result

The committed dist-wide forbidden-I/O scan passes with the new module built
into `dist/trusted/**` (the module doc comment was worded to avoid the
forbidden needle); `src/trusted/artifact-location.ts` imports only internal
trusted modules; resolution is caller-injected; no dependency added.

## Digest-Domain Disposition (NOTE-2)

`PGAP-TRUSTED-CONFIG-v1\0` is the accepted identity-family domain under the
ADR-009 convention: the `v1` suffix identifies the hash-domain family, NOT
the accepted configuration protocol version. The accepted configuration
protocol version (`1` or `2`) is separately digest-covered as a member of
the canonical projection. Version-1 identity bytes remain unchanged; the
version-1 and version-2 projections cannot collide because the
configuration-version member differs.

## Helper-Path Disposition (NOTE-3)

The Phase-2B-P test fixture module is `tests/trusted/artifact-location-helpers.ts`
— a test-only fixture module. No production
`src/trusted/artifact-location-helpers.ts` module exists; the production
artifact-location surface is `src/trusted/artifact-location.ts` only.

## Known Limitations

1. TCF-042 (cross-workspace artifact-location ambiguity) is defense-in-depth
   and unreachable for validated configurations because Phase-1 prohibits
   overlapping workspace roots; it is kept as an explicit invariant.
2. The directory-existence and entry-kind guarantee holds only for the
   trusted evidence observed at configuration-validation time; ongoing
   existence, race-freedom, and persistence suitability are Phase-2B/WP-11
   point-of-use concerns.
3. The ArtifactLocationResolver is a host-boundary component outside the
   I/O-free core; no host implementation ships in this work package
   (structured stubs represent trusted evidence in tests).
4. ExecutionBundle and ExecutionResult storage remain undecided pending an
   authoritative later contract; this work package assigns none.
5. The digest domain prefix remains `PGAP-TRUSTED-CONFIG-v1\0`; version
   distinction is carried by the configuration-version projection member,
   keeping v1 identities byte-identical.

## Excluded Responsibilities

Phase 2B destination containment, nearest-existing-ancestor handling,
artifact persistence, generic write/create/overwrite/delete/rename/move,
source-code editing, filesystem mutation, RuntimeGrant/approval, execution,
ExecutionBundle storage, ExecutionResult storage, TrustedReceipt behavior,
MCP tools, Pi/pi-guard behavior, PointOfUseInputs v2, and any actual
filesystem operation.

## Final Git State

- Staging: empty; no commit; no push, tag, release, publication,
  installation, or deployment.
- Differences from HEAD: 7 modified tracked paths (`src/trusted/types.ts`,
  `src/trusted/validate.ts`, `src/trusted/findings.ts`,
  `src/trusted/identity.ts`, `src/trusted/index.ts`,
  `docs/design/trusted-workspace-and-ceiling-configuration.md`,
  `tests/trusted/version.test.ts` (single expectation update)); and 10
  untracked paths, comprising exactly:
  - 1 production module: `src/trusted/artifact-location.ts`;
  - 7 test files: `tests/trusted/artifact-location-versioning.test.ts`,
    `artifact-location-directory.test.ts`, `artifact-location-identity.test.ts`,
    `artifact-location-lookup.test.ts`, `artifact-location-hostile.test.ts`,
    `artifact-location-scope.test.ts`, and
    `artifact-location-evidence.test.ts`;
  - 1 fixture/helper: `tests/trusted/artifact-location-helpers.ts`;
  - 1 implementation report:
    `docs/reports/wp-6-phase-2b-p-trusted-artifact-location-implementation-report.md`.
  Explicit arithmetic: 1 production module + 7 test files + 1
  fixture/helper + 1 report = 10 untracked paths; the complete working tree
  contains 7 modified tracked paths + 10 untracked paths = 17 total paths;
  zero deletions; zero renames.
- No Phase-2B destination-containment behavior exists; no Phase-3 behavior
  exists; `src/index.ts`, `package.json`, `package-lock.json`,
  `src/internal/**`, `src/pointofuse/**`, `src/api/**`, `src/adapters/**`,
  `schemas/**`, `fixtures/**`, `src/generated/**`, semantic rules, and
  digest vectors are untouched.

## Unresolved Findings

None within Phase-2B-P scope after the F-2BP-FR-01 security correction.
Pending decisions (not findings): Phase-2B-P acceptance and commit require
a final independent security rereview; Phase 2B destination containment is
a separate later package; Phase 3 requires a
separate authorization.

## Recommendation

Recommend a final independent security rereview of the F-2BP-FR-01-
corrected Phase-2B-P implementation and this report before any acceptance
or commit decision.
