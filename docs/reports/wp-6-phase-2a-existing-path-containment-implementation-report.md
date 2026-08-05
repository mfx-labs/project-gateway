# WP-6 Phase 2A Implementation Report — Existing-Path Inspection Containment Core

**Status:** Implementation report for WP-6 Phase 2A (implemented under the
externally granted WP-6 Phase 2A Human Implementation Authorization).
WP-6 is NOT closed; Phase 2A is NOT accepted; no commit was created.
Phase 2B and Phase 3 (PointOfUseInputs v2) are NOT authorized and have not
started. A focused independent review is required before Phase 2A may be
accepted and committed.

## Baseline

- Repository: `/home/chef/Documents/Project_Gateway_MCP`; branch `main`;
  baseline HEAD `a93eacad45e439b88a77b695023c3352cb520df3`
  (`feat: establish WP-6 trusted configuration foundation`); parent
  `52c69bff027da5c3534edf5d782c667aff4c2e93`.
- Initial Git state: staging empty; working tree clean; zero untracked
  paths; no tag on HEAD; no Phase-2 source existed; Phase 1 authoritative.
- Baseline verification: production typecheck PASS; test typecheck PASS;
  repository-default tests 695/695 (0 fail, 0 skipped, 0 todo; duplicate
  executions 0); conformance 531/531; schemas 51/51; semantic rules 114/114;
  digest vectors 19/19; generated corpus byte-reproducible.

## Authoritative Sources

- WP-0 scope and principles (remote-producer zone; untrusted request data;
  MVP write boundary = validated artifact drafts in configured artifact
  locations only; no deletion, no generic mutation, no source editing);
- ADR-001 (product boundary), ADR-002 (trust/approval boundary),
  ADR-004 (MVP capability boundary), ADR-023…ADR-027;
- `trusted-workspace-and-ceiling-configuration.md` (Path Resolution and
  Containment Rules; F-EL1 root uniqueness; F-EL2 non-existent/rename
  containment; F-EL3 host lane; F-EL4 classification; F-EL5 snapshot
  hardening);
- the approved Phase-2 boundary-correction review (F-P2-1…F-P2-3 corrected
  dispositions);
- the committed Phase-1 implementation and its report;
- `capability-vocabulary.md`, `artifact-domain-model.md`,
  `artifact-responsibility-matrix.md`, `glossary.md`.

Authority order honored: WP-0 product boundary → accepted ADRs → normative
design contracts → explicit human Phase-2A authorization → committed source
contracts → reports.

## Exact Phase-2A Scope

Implemented (deterministic, fail-closed, I/O-free prospective
containment-decision core for EXISTING paths only):

1. containment protocol version (`1`; explicit; required; unknown versions
   fail closed; no inference; identity-bound);
2. untrusted existing-path request model (workspace ID, workspace-relative
   path, purpose, expected configuration identity; strict shape);
3. descriptor-derived request snapshot and strict recursive unknown-field
   rejection (committed Phase-1 pattern);
4. workspace-relative path grammar (root token `.`; absolute/drive/UNC/NUL/
   control/separator/component rules; `..` pops bounded by the workspace
   root; byte-exact Unicode);
5. workspace lookup against an already validated configuration (unknown
   workspace fails closed);
6. trusted internal combination of the canonical workspace root with
   validated relative components (POSIX component algorithm; request data
   can never select, replace, or infer the root);
7. injected typed existing-path resolver boundary (exactly one invocation
   per decision; Phase-1 `RootPathResolver` adapter provided);
8. component-boundary containment under the selected workspace root
   (sibling-prefix safe; escape and ambiguity fail closed);
9. read/inspect purpose discrimination (shared containment semantics; no
   capability or authority);
10. deterministic typed containment findings (TCP-001…TCP-021; separate
    namespace; root-safe static messages; stable ordering);
11. deterministic containment-decision identity (JCS + domain-separated
    SHA-256; binds protocol version, operation class, purpose, configuration
    identity, host lane, workspace ID, canonical relative path, resolved
    internal path, revalidation requirement);
12. immutable prospective containment result with
    `pointOfUseRevalidationRequired: true`;
13. no result and no identity on any failure;
14. tests (126 new, incl. 30 security-correction tests) and this report.

Not implemented (excluded per authorization): absolute request-path support,
generic path access, non-existent destination handling, nearest-existing-
ancestor handling, artifact-draft destination containment, generic write,
generic create, overwrite, deletion, rename or move, temporary-file
publication, atomic replacement, source-code editing, Git mutation, actual
filesystem resolver, actual filesystem read or write, persistence, MCP
project tools, PointOfUseInputs v2, effective-authority intersection, AUT-*
evaluator changes, Artifact Core schemas, conformance fixtures or vectors,
RuntimeGrant or approval behavior, Pi, pi-guard, execution, ExecutionResult,
TrustedReceipt.

## Trust Classification

Trusted: gateway enforcement code; validated `TrustedWorkspaceConfiguration`;
validated workspace record; configured host lane; injected trusted
existing-path resolver. Untrusted: candidate path, workspace ID, purpose,
and expected configuration identity supplied by a request; prompts; MCP
requests; ChatGPT-generated content; repository content; artifact content;
project-visible documents; external producer data. Validation proves
structure and containment only; it never makes request data trusted and
never grants authority. A request-supplied existence assertion is never
accepted as evidence (no such field exists; unknown fields fail closed).

## Request Schema

Exactly five protocol-significant fields:

- `containmentProtocolVersion` (string; must equal `1`);
- `workspaceId` (string; must be registered in the validated configuration);
- `path` (string; workspace-relative, see grammar below);
- `purpose` (string; exactly `read` | `inspect`);
- `expectedConfigurationIdentity` (string; mandatory; must equal the
  validated configuration identity exactly; never inferred).

Any other field → TCP-003. Any structural/hostile input → TCP-019/TCP-002.

## Relative-Path Grammar and Root-Path Representation

- The workspace root is represented by the exact token `.` (single explicit
  representation; empty paths are rejected, TCP-006);
- POSIX absolute (`/...`), Windows drive-absolute (`C:\...`, `C:/...`),
  and UNC (`\\...`) request paths are rejected (TCP-005);
- `\` anywhere is rejected (TCP-006; unsupported on the POSIX lane);
- NUL and control characters (`\u0000`, `< 0x20`) are rejected (TCP-008);
- leading, trailing, and repeated separators are rejected (TCP-005/TCP-006;
  no silent cleanup at the untrusted request boundary);
- interior `.` components are rejected as ambiguous (TCP-006); the only
  accepted `.` form is the exact root token;
- `..` components are carried and popped during the trusted internal
  combination, bounded by the WORKSPACE ROOT: a pop that would rise above
  the workspace root fails closed as traversal escape (TCP-007); safe
  interior pops normalize (e.g. `a/b/..` → `a`; `a/..` → the root);
- Unicode bytes are preserved exactly; no NFC/NFD/case-folding/locale/
  compatibility normalization is ever applied (NFC and NFD paths are
  byte-distinct and produce different identities);
- candidate paths are never treated as trusted after validation.

## Trusted Root-Combination Algorithm

`combineWorkspaceRootAndComponents` (package-internal): the canonical root
comes only from the validated workspace record; validated relative
components are popped/normalized against the workspace-root boundary with a
component stack; the absolute candidate is formed with POSIX component
semantics (never naive string concatenation) and re-canonicalized with the
committed `canonicalizeRootLexically`. The internal absolute candidate is
package-internal: never in findings, never in public identity strings,
never returned through package-root or external-facing APIs.

## Resolver Interface

`ExistingPathResolver = (absolutePath: string) => ExistingPathResolution`,
where `ExistingPathResolution = { ok: true; canonical: string } | { ok:
false; code: 'not-found' | 'loop' | 'error' }`. The resolver is injected by
a trusted host-boundary caller; the core performs no `node:fs` calls. A
missing or non-function resolver fails closed (TCP-012); a thrown resolver
fails closed (TCP-013); `not-found` (broken/unresolved path) → TCP-014;
`loop` → TCP-015; `error` → TCP-013. Resolver results are lexically
re-canonicalized under the supported POSIX lane; relative, Windows, UNC,
NUL/control, and otherwise malformed results fail closed (TCP-016). The
committed Phase-1 `RootPathResolver` is adapted via the module-local
`fromRootPathResolver` helper. Exactly one resolver invocation per decision
(no repeated-evidence inconsistency within a decision); stateful resolvers
across decisions are within the accepted stable-operand determinism scoping.

## Existing-Path Containment Algorithm

1. Trusted operands (host lane, resolver) checked first.
2. Descriptor-derived snapshot of the untrusted request; strict shape.
3. Protocol version; 4. purpose; 5. expected configuration identity;
6. workspace lookup; 7. relative-path grammar; 8. trusted combination;
9. exactly one resolution; 10. re-canonicalization of the resolver result;
11. component-boundary containment under the selected workspace root
   (`isRootAncestorOrEqual`); 12. defense-in-depth: the resolved path must
   not fall under any other registered workspace root (unreachable for
   valid Phase-1 configurations, which prohibit overlapping roots; kept
   explicit); 13. immutable decision + deterministic identity (only after
   all validation succeeds); 14. no result/identity on any failure.

The read or inspection itself is never performed.

## Containment Protocol Version

`CONTAINMENT_PROTOCOL_VERSION = '1'` — one exact canonical representation;
explicit and required; unknown versions fail closed (TCP-001); no version
inference; no implicit upgrade or downgrade; bound into the decision
identity.

## Finding Codes (TCP-001…TCP-021)

TCP-001 unsupported/missing containment protocol version; TCP-002 malformed
request structure; TCP-003 strict unknown-field violation; TCP-004
unsupported purpose or operation; TCP-005 absolute request path; TCP-006
empty or malformed relative path; TCP-007 traversal escape; TCP-008 NUL or
control character; TCP-009 unknown workspace; TCP-010 configuration
identity mismatch; TCP-011 unsupported trusted host lane; TCP-012 missing
resolver; TCP-013 resolver failure; TCP-014 broken or unresolved existing
path; TCP-015 symlink loop; TCP-016 malformed resolver result; TCP-017
resolved path outside workspace; TCP-018 root or workspace ambiguity;
TCP-019 structural snapshot failure; TCP-020 decision identity failure;
TCP-021 unrecognized or non-genuine validated configuration (correction
F-2A-01).

Stable IDs; deterministic ordering (code → location → messageKey,
locale-independent); static root-safe messages; no raw root, absolute
candidate path, or secret; no partial success result; no decision identity
on failure; immutable findings.

## Result Model

Successful decision: `containmentProtocolVersion`, `operationClass`
(`existing-path`), `purpose`, `configurationIdentity`, `workspaceId`,
`canonicalWorkspaceRelativePath` (`''` = root), `resolvedAbsolutePath`
(internal, trusted-process only), `decisionIdentity`, and
`pointOfUseRevalidationRequired: true`. Classification: prospective
trusted-process decision data — not authority, not approval, not
RuntimeGrant, not an Artifact Core aggregate, not ExecutionResult, not
TrustedReceipt. Failure: deterministic typed findings only; no success
result; no identity confusable with success; no raw root disclosure.

## Decision Identity

JCS (RFC 8785, committed serializer) + SHA-256 over domain
`PGAP-TRUSTED-CONTAINMENT-v1\0`, formatted `sha-256:<hex>`. Binds:
containment protocol version, operation class, purpose, trusted
configuration identity, host lane, workspace ID, canonical
workspace-relative path, canonical resolved internal path, and the
point-of-use revalidation requirement. Locale-independent ordering; fixed
canonical shape; explicit omission rules (none needed in the fixed key
set); UTF-8 canonical bytes; stable domain prefix; no identity on failure;
changed purpose/path/workspace/configuration/resolver-result all change the
identity; registration order non-semantic; no raw path exposed by the
digest. Never called approval, authority, RuntimeGrant, or receipt
identity.

## TOCTOU Limitation

The result is prospective only and states `pointOfUseRevalidationRequired:
true`. Phase 2A does not claim atomic filesystem authorization, race-free
opening, protection after evaluation, or elimination of symlink races; WP-7
must revalidate at the actual read or inspection point. No timestamps,
expiry, freshness duration, or time-based assumptions exist.

## Supported Host Lane

Inherited from the validated configuration (Phase-1 F-EL3): Linux x86_64,
POSIX-style filesystem semantics, UTF-8, Node.js 22.x. The evaluator
verifies the configuration's lane is the accepted lane (TCP-011) and never
probes the host.

Phase-2A acceptance remains pending a final independent rereview.

## Security Correction (F-2A-01 / F-2A-02, second round)

### History

The focused review of the Phase-2A implementation returned CORRECTIONS REQUIRED
with two MAJOR findings, both remediated under the externally granted WP-6
Phase 2A security-correction authorization:

- **F-2A-01 (MAJOR):** an arbitrary caller-created object structurally
  shaped like a `ValidatedTrustedWorkspaceConfiguration` (accepted host
  lane, syntactically valid configuration identity, workspace record with
  attacker-selected `canonicalRoot`) was accepted by the containment
  evaluator. Reproduction (pre-correction, verbatim): forged config with
  `canonicalRoot: '/attacker/root'` → `evaluateExistingPathContainment`
  returned `ok:true`, invoked the resolver once, and produced a decision
  identity over `/attacker/root/x`.
- **F-2A-02 (MAJOR, human-promoted product-boundary issue):** Phase-1
  accepted canonical workspace root `/`. Reproduction (pre-correction,
  verbatim): a configuration whose workspace root was `/` validated with
  `canonicalRoot: '/'`, and the Phase-2A evaluator then returned `ok:true`
  for request path `etc/passwd` under `/etc/passwd` — the entire host
  filesystem became one contained workspace, contrary to the WP-0 product
  ceiling (explicit-project scoping; no generic filesystem access). A
  configured `/workspace` whose resolver returned `/` also validated to
  `canonicalRoot: '/'`.

### F-2A-01 Correction — Runtime Configuration Genuineness

- New module `src/trusted/configuration-brand.ts`: a module-private
  `WeakSet` brand following the accepted WP-5A runtime-branding pattern
  (`markValidatedTrustedWorkspaceConfiguration`, `isGenuineValidatedTrustedWorkspaceConfiguration`).
- `src/trusted/validate.ts`: the exact final validated configuration object
  is branded after complete construction and deep freezing (the
  intermediate object with `identity: ''` is never branded; failed or
  partial validation never reaches the brand; a marking failure cannot
  yield partial success).
- `src/trusted/containment-validate.ts`: the genuineness check is step 0,
  before any configuration field (`hostLane`, `identity`, `workspaces`,
  `canonicalRoot`) is read, before workspace lookup, before candidate-root
  combination, before resolver invocation, and before decision identity
  computation → new finding **TCP-021** (unrecognized or non-genuine
  validated configuration), `ok:false`, no decision, no identity, zero
  resolver calls.
- `src/trusted/validate.ts` `lookupValidatedWorkspace`: defense-in-depth —
  a non-genuine configuration returns `undefined`; a forged object can
  never retrieve a trusted canonical root through this helper.
- Brand properties: module-private; non-serialized; absent from identity,
  projections, canonical bytes, findings, and declarations; not
  caller-constructible; lost by spread, shallow/deep clone, JSON
  round-trip, structured reconstruction, lookalikes, and Proxy wrapping;
  process-local; multiple successful validations produce multiple
  independently branded objects; no authority beyond genuineness.
- Neither the marking operation nor the predicate is exported from
  `src/trusted/index.ts` or the package root.

### F-2A-02 Correction — Prohibited Whole-Filesystem Workspace Root

- `src/trusted/validate.ts`: after final canonical resolution (which
  includes resolver output and lexical re-canonicalization), a canonical
  workspace root equal to `/` fails the ENTIRE load with new finding
  **TCF-029** (forbidden whole-filesystem workspace root), before
  root-uniqueness success, before identity computation, before branding,
  and before successful result construction. This catches literal `/`,
  repeated separators (`//`, `///`, `/./`), lexical forms normalizing to
  `/` (`/workspace/..`), resolver output `/`, and symlinked or aliased
  configured roots resolving to `/`.
- Bounded absolute project roots remain valid: `/workspace`,
  `/srv/projects/example`, `/home/user/project`.
- The prohibition is a global product-ceiling rule, not a caller
  preference; trusted local configuration is constrained by the product
  ceiling.

### Configuration-Version Decision

`TRUSTED_CONFIGURATION_VERSION` remains `'1'`: the correction removes a
globally prohibited value (`/`) from the accepted input domain and adds a
runtime genuineness property that is not part of the canonical shape. No
field or interpretation of any accepted value changes; every configuration
that validated before and still validates has the identical identity
(identity projection and canonical bytes unchanged; the brand is absent
from canonical bytes). No previously valid successful identity changes.
The configuration version is not incremented for a security-bug
correction per repository versioning rules.

### Finding-Code Changes

- TCF-029 added to the Phase-1 trusted-configuration finding model (28 →
  29 codes).
- TCP-021 added to the Phase-2A containment finding model (20 → 21
  codes).

### New Tests and Corrected Totals

- `tests/trusted/configuration-brand.test.ts` (17 tests): genuine
  acceptance; plain forged lookalike; correct-digest forged; attacker-root
  forged; spread; shallow clone; deep JSON clone; manually deep-frozen
  clone; Proxy wrap; separately validated equivalent accepted; failed
  validation produces no brand; non-genuine fails before resolver
  invocation (zero calls); no decision/identity; lookup defense; brand
  absent from serialization/projection/digest bytes/findings; no barrel or
  package-root export; containment protocol version still required for
  genuine configurations.
- `tests/trusted/forbidden-root.test.ts` (13 tests): literal `/`;
  repeated separators; lexical forms; resolver returning `/`; non-root
  configured path resolving to `/`; single-workspace `/`; multi-workspace
  containing `/` fails the entire load; no configuration/identity/brand;
  findings disclose no raw roots; bounded roots remain valid; nested
  bounded root; Phase-2A cannot obtain a decision under `/` (forged
  `/`-rooted config independently rejected by TCP-021 with zero resolver
  calls); genuine configurations unaffected.
- Corrected totals: Phase-2A suite 126 (96 + 30); trusted suite 276
  (150 + 126); complete default suite **821** (515 legacy + 30 shared +
  150 Phase-1 trusted + 96 Phase-2A + 30 correction).

### Path-Length Note Disposition

No arbitrary Phase-2A path-length limit was added. Phase 2A remains total
and deterministic for finite input strings; request-envelope and transport
size ceilings are deferred to their owning boundary; no filesystem
`PATH_MAX` assumption is imported into the I/O-free protocol core. This is
a documented deferred design consideration, not an open Phase-2A finding.

### Verification Evidence (post-correction)

- Production and test typecheck: PASS.
- `npm test`: 821/821 pass, 0 fail, 0 skipped, 0 todo; every test exactly
  once.
- Direct Phase-2A suite: 126/126; direct Phase-1 trusted suite: 150/150;
  shared snapshot: 30/30; legacy WP-4/WP-5A: 545/545.
- Conformance 531/531; schemas 51/51; semantic rules 114/114; digest
  vectors 19/19; corpus byte-reproducible.
- No-I/O scan passes (dist-wide, covers `dist/trusted/**` incl. the brand
  module).
- All 30 correction smokes pass (genuine success; forged/correct-digest/
  clone rejection with TCP-021, zero resolver calls, no decision/identity;
  lookup defense; literal `/` and resolver-to-`/` rejection with TCF-029;
  bounded roots valid; `/etc/passwd` impossible under a genuine bounded
  root; decision-identity and configuration-identity regression).

Phase-2A acceptance remains pending a final independent rereview.

## Files Added

Production (`src/trusted/**`):

- `configuration-brand.ts` — module-private runtime genuineness brand
  (correction F-2A-01);
- `containment-types.ts` — protocol version, operation class, purposes,
  request/options/decision types;
- `containment-findings.ts` — TCP-001…TCP-021 typed finding model, report
  shape, deterministic sorting, fail-report builder;
- `containment-path.ts` — workspace-relative path grammar and trusted
  root-combination algorithm;
- `containment-resolver.ts` — typed injected resolver boundary and the
  Phase-1 `RootPathResolver` adapter;
- `containment-identity.ts` — containment decision projection, domain-
  separated digest, digest pattern;
- `containment-validate.ts` — `evaluateExistingPathContainment` decision
  evaluator;
- narrow additions to `src/trusted/index.ts` (internal barrel entry points
  only; no low-level helpers barrel-exported).

Tests (`tests/trusted/**`):

- `containment-helpers.ts` (fixtures: validated config, request factory,
  identity/map fake resolvers);
- `containment-request.test.ts` — request trust and path form + purpose
  vocabulary;
- `containment-correlation.test.ts` — configuration/workspace correlation;
- `containment-resolution.test.ts` — existing-path resolution and
  containment;
- `containment-identity.test.ts` — decision identity;
- `containment-hostile.test.ts` — hostile runtime input hardening;
- `containment-boundary.test.ts` — result/TOCTOU, product boundary, root
  secrecy.

Documentation:

- `docs/design/trusted-workspace-and-ceiling-configuration.md` — narrow
  clarification section (candidate-path trust classification, Phase 2A
  scope, MVP mutation exclusions, Phase 2B blocker);
- `docs/reports/wp-6-phase-2a-existing-path-containment-implementation-report.md`
  (this report).

## Files Modified

- `src/trusted/index.ts` — narrow internal barrel additions only.
- `src/trusted/validate.ts` — runtime genuineness branding of the final
  validated configuration; whole-filesystem root `/` prohibition (TCF-029)
  after final canonical resolution; `lookupValidatedWorkspace` genuineness
  defense (correction F-2A-01/F-2A-02).
- `src/trusted/findings.ts` — TCF-029 added to the finding model.
- `src/trusted/containment-validate.ts` — TCP-021 genuineness check as
  evaluation step 0 (correction F-2A-01).
- `src/trusted/containment-findings.ts` — TCP-021 added to the finding
  model.
- `docs/design/trusted-workspace-and-ceiling-configuration.md` — narrow
  clarification sections (trust classification, Phase 2A scope, MVP
  mutation exclusions, Phase 2B blocker, runtime genuineness, whole-
  filesystem root prohibition); no existing sections rewritten.

No other path changed. `src/index.ts`, `package.json`,
`package-lock.json`, `src/pointofuse/evaluate.ts`, `src/api`,
`src/adapters/**`, `schemas/**`, `fixtures/**`, `src/generated/**`,
semantic rules, digest vectors, and all excluded areas are untouched.

## Test Inventory

Phase-2A tests (8 files, 126 tests, all verified by direct execution and by
the default `npm test`; the committed `dist-test/tests/trusted/*.test.js`
glob discovers them automatically — no package.json change):

- `containment-request.test.ts` (20): valid relative paths; root token;
  POSIX/drive/UNC absolute rejection; backslash; empty path; interior dots;
  safe `..` pops and escape rejection; leading/trailing/repeated separators;
  NUL/control; NFC/NFD byte distinction; repository/prompt-derived strings;
  purpose read/inspect and identity difference; mutation-class purpose
  rejection; no mutation result fields; parser/combination units; missing
  path; version missing/unsupported/unknown; no version inference;
  workspaceId required/unknown.
- `containment-correlation.test.ts` (8): exact configuration identity;
  stale identity; unknown workspace; per-record root correlation; order
  independence; root/lane/ceilings/provenance/version cannot be supplied by
  the request; path content cannot switch workspaces; identity binding.
- `containment-resolution.test.ts` (20): root path; direct/deep children;
  normalized children; sibling-prefix boundary; internal symlink; symlink
  escape; broken link; loop; resolver error; throwing resolver; missing and
  non-function resolvers; malformed resolver results (relative/Windows/
  UNC/NUL/control); ancestor-of-root result; re-canonicalization;
  single-invocation evidence; stateful resolver; mutation after evaluation;
  workspace mismatch; configuration identity mismatch.
- `containment-identity.test.ts` (13): deterministic repetition; purpose/
  path/workspace/configuration/resolver-result changes; protocol-version
  binding; order independence; independent digest recomputation; no identity
  on failure; digest discloses no path; canonical ordering; no authority
  fields.
- `containment-hostile.test.ts` (16): ordinary getters; throwing getters;
  Proxy `get` zero calls; missing descriptors; non-enumerable fields;
  accessors; symbols; cycles; unsupported prototypes; mutation during
  snapshot; mutation after snapshot; deep freeze; strict unknown fields;
  non-object input; no identity on hostile input; resolver-evidence cannot
  be request-supplied.
- `containment-boundary.test.ts` (19): prospective classification and
  revalidation marker; no timestamp/expiry; no authority/approval/grant/
  execution/receipt fields; failure produces no partial success; finding
  determinism; no mutation vocabulary; no I/O side effects; package-root
  negative exports; barrel scope; resolver consulted once for evidence only;
  no root disclosure in findings/digest/workspace IDs; no canonical bytes in
  the result; package-root domain leak scan; internal resolved paths;
  ok/findings invariants; configuration identity mismatch; configuration
  immutability and continued Phase-1 usability.

## Full Regression Results

- Production typecheck: PASS; test typecheck: PASS.
- Repository-default `npm test`: **821/821 pass, 0 fail, 0 skipped, 0 todo**
  (515 legacy + 30 shared + 150 Phase-1 trusted + 96 Phase-2A + 30
  correction; every test executes exactly once — total equals the sum of
  unique files; duplicate executions 0).
- Direct Phase-2A trusted suite: `node --test dist-test/tests/trusted/containment-*.test.js dist-test/tests/trusted/configuration-brand.test.js dist-test/tests/trusted/forbidden-root.test.js`
  → 126/126.
- Original Phase-1 trusted suite: 150/150 (unchanged).
- Shared snapshot regressions: 16/16 (arrays) + 14/14 (objects).
- Legacy WP-4/WP-5A globs: 545/545.
- Conformance: 531/531; schemas: 51/51; semantic rules: 114/114; digest
  vectors: 19/19; generated corpus byte-reproducible.
- No-I/O scan: the committed dist-wide forbidden-I/O scan covers
  `dist/trusted/**` and passes; `src/trusted/containment-*.ts` and
  `src/trusted/configuration-brand.ts` import only `node:crypto`
  (identity) and internal trusted modules.
- Package-root negative export smoke: the package root exposes no
  Phase-2A API, type, constant, digest domain, or brand operation.
- No dependency added; package.json and package-lock.json unchanged.

## Root-Secrecy Verification

Findings never contain root, absolute path, or request content; decision
digest strings are `sha-256:<hex>` with no path material; workspace IDs are
opaque; the decision result carries no canonical bytes; internal resolved
absolute paths exist only inside the trusted-process result and are absent
from the package export map and the package-root surface (verified by
tests).

## No-I/O Verification

`src/trusted/containment-*.ts` performs no filesystem, network, process,
Git, or time I/O (only `node:crypto` hashing in `containment-identity.ts`);
resolution is caller-injected; the committed security suite (dist-wide
forbidden-I/O scan) passes with the new modules built into `dist/trusted/**`.

## Product-Boundary Verification

The Phase-2A surface contains no write, create, persist, delete, rename,
move, execute, Git, shell, network, MCP, Pi, pi-guard, persistence, or
authority semantics: no such operation class, purpose, finding success
path, identity value, or result field exists; deletion and generic
mutation classes are rejected at the purpose boundary (TCP-004) and are
absent from the vocabulary; the only write-related concept (persist-validated-
artifact-draft) is deliberately deferred to Phase 2B, which remains blocked
on a trusted artifact-location prerequisite.

## Known Limitations

1. The typed resolver distinguishes `not-found`, `loop`, and `error`
   failures; finer host-level classification (e.g. permission-denied) is a
   host-boundary concern outside the I/O-free core.
2. The workspace root is represented by the exact request token `.`;
   empty-string requests are rejected (explicit single representation).
3. Interior `.` request components are rejected (strict request boundary);
   only `..` pops are normalized, bounded by the workspace root.
4. `a/..` normalizes to the workspace root (contained); only pops above the
   workspace root escape.
5. Resolver-result re-canonicalization uses the committed Phase-1 lexical
   canonicalization; resolver evidence is trusted, but normalized and
   re-verified deterministically.
6. Defense-in-depth cross-workspace ambiguity check (TCP-018) is
   unreachable for validated Phase-1 configurations (overlapping roots are
   prohibited); it is kept as an explicit invariant.
7. Decisions are prospective; WP-7 performs actual point-of-use read/
   inspection revalidation. No time-based freshness exists.

## Excluded Responsibilities

Phase 2B (artifact-draft destination containment — blocked on trusted
artifact location), PointOfUseInputs v2 / Phase 3 (evaluator migration,
AUT-* rules, conformance fixtures and vectors), WP-7 project reads, WP-8
persistence, WP-9 MCP tools, WP-11 controlled writes, deletion, rename/
move, execution, RuntimeGrant/approval, Pi, pi-guard, TrustedReceipt, and
any actual filesystem operation.

## Final Git State

- Staging: empty; no commit; no push, tag, release, publication,
  installation, or deployment.
- Differences from HEAD: modified `src/trusted/index.ts` (narrow barrel
  additions), `src/trusted/validate.ts`, `src/trusted/findings.ts`, and
  `docs/design/trusted-workspace-and-ceiling-configuration.md` (narrow
  clarifications); untracked `src/trusted/configuration-brand.ts`,
  `src/trusted/containment-*.ts` (6 files), `tests/trusted/containment-*.test.ts`
  (6 files), `tests/trusted/configuration-brand.test.ts`,
  `tests/trusted/forbidden-root.test.ts`, `tests/trusted/containment-helpers.ts`,
  and this report under `docs/reports/`.
- No Phase-2B or Phase-3 behavior exists.

## Unresolved Findings

None within Phase 2A scope after the F-2A-01/F-2A-02 security correction.
The path-length/request-envelope bound is a documented deferred design
consideration (owning boundary to be determined), not an open finding.
Pending decisions (not findings): Phase-2A acceptance and commit require a
final independent rereview; Phase 2B requires the trusted artifact-location
prerequisite; Phase 3 requires a separate authorization.

## Recommendation

Recommend a focused independent review of the Phase-2A implementation and
this report before any acceptance or commit decision.

## F-2A-FR-01 Correction History

Final security rereview verdict: `WP-6 PHASE 2A FINAL SECURITY REREVIEW: CORRECTIONS REQUIRED`.

- `F-2A-FR-01 — MINOR`: stale finding-catalog ranges in the module
  documentation of `src/trusted/containment-findings.ts`.
- Exact stale ranges corrected (comment-only): `TCF-001…TCF-028` →
  `TCF-001…TCF-029`; `TCP-001…TCP-020` → `TCP-001…TCP-021`.
- The implemented catalogs are `TCF-001…TCF-029` and `TCP-001…TCP-021`;
  the module comment now matches.
- Comment-only correction: no runtime/type/constant/finding-code/message/
  ordering/export/identity/verification change was made.
- Documentation range text in this report aligned to the implemented
  catalog (`TCP-001…TCP-020` → `TCP-001…TCP-021`).
- Final verification evidence: production and test typechecks pass;
  repository-default `npm test` 821/821; direct trusted suite 276/276;
  direct Phase-2A suite 96/96; configuration-brand 17/17; forbidden-root
  13/13; conformance 531/531; schemas 51/51; semantic rules 114/114;
  digest vectors 19/19; generated corpus byte-reproducible; finding-catalog
  uniqueness scan passes; no stale `TCF-001…TCF-028` or `TCP-001…TCP-020`
  containment-module comment remains.
- Phase-2A acceptance remains pending one final bounded rereview.
