# WP-5A Pi Adapter Implementation Report

## Baseline

- Branch: `main`; baseline HEAD: `45bfd9714cccba04b19d4ebc0f85b8a72c2f9c02`
  (`feat: establish WP-4 artifact core library`); working tree clean; staging
  empty; WP-4 committed, human-approved, and closed on `main`.
- Committed WP-4 regression suite re-run before implementation: typecheck PASS,
  test typecheck PASS, build PASS, unit 139/139, integration 90/90, security
  14/14 (total 243/243), conformance 531/531 with zero mismatches, 51/51
  schemas compiled, 114/114 rule IDs, 19/19 digest vectors, generated corpus
  byte-reproducible.

## Local Pi Environment (Inspected, No Web Research)

- Executable: `/home/chef/.local/share/pi-node/node-v22.23.2-linux-x64/bin/pi`
- Version: `0.83.0`; package identity: `@earendil-works/pi-coding-agent`
- Type declarations: `dist/index.d.ts`, `dist/core/extensions/types.d.ts`
  (public, documented in `docs/extensions.md`)
- Extension registration model: default factory receiving `ExtensionAPI`;
  event subscription via `pi.on(event, handler)`; prompt injection via
  `before_agent_start` message return; session/turn/message/tool/settle/
  shutdown lifecycle events. WP-5A never reads or interprets the Pi tool
  inventory (`getActiveTools()` / `getAllTools()` are never called); tool
  inventory and authority projection are reserved for WP-5B.
- Unsupported/unstable APIs: no public 0.83.0 cancellation event (cancellation
  is host-supplied); TUI/provider-payload/session-storage internals out of
  lane; no undocumented fallback exists.

## Package/Module Boundary

- Adapter under `src/adapters/pi/**`; package subpath
  `@project-gateway/artifact-core/pi-adapter` (`exports` map, `dist` files
  cover it); root Artifact Core namespace gains no Pi-specific exports.
- Narrow root exports added for adapter consumption (types
  `EligibilityReport`, `ImmutableModel`, `RequestedUse`, `ValidationLevel`;
  functions `exactReferencesEqual`, `workspaceBindingsEqual`); WP-4 behavior
  and totals unchanged; regression tests in the existing WP-4 suites still
  pass.
- No Pi dependency added (environment-gated dynamic import only); no package
  or TypeScript dependency changes.

## Files Created

Production (14): `src/adapters/pi/{index,types,projection,render,context,compatibility,host-bridge,observation,host-harness,findings}.ts` +
`src/adapters/pi/internal/{brand,unicode,media-type,input-shape}.ts`.
Tests (12 test files): `tests/pi-adapter/unit/{projection,context,completion,compatibility,observation,unicode,media-type,input-shape,render}.test.ts`,
`tests/pi-adapter/integration/bridge.test.ts`,
`tests/pi-adapter/security/security.test.ts`,
`tests/pi-adapter/compatibility/harness.test.ts`; plus non-test helpers
`tests/pi-adapter/helpers.ts`, `tests/pi-adapter/helpers/world.ts`,
`tests/pi-adapter/unit/mock-surface.ts`, `tests/pi-adapter/compatibility/local-lane.ts`,
and harness fixture packages under `tests/pi-adapter/fixtures/pi-packages/`.
Docs (9): `docs/design/pi-adapter-{architecture,prompt-projection,host-compatibility,observation-model}.md`,
`docs/design/wp-5a-open-decisions.md`,
`docs/decisions/ADR-020/021/022-*.md`,
`docs/reports/wp-5a-pi-adapter-implementation-report.md`.
Modified: `package.json` (subpath export + adapter test scripts),
`src/index.ts` (narrow adapter-facing exports),
`tests/security/security.test.ts` (adapter boundary excluded from the WP-4
I/O scan; the adapter has its own dedicated security suite),
`docs/design/glossary.md` (six new adapter glossary entries).

## Public Pi Adapter API

`inspectPiHostCompatibility(capability)`, `projectExecutionBundleToPi(input)`,
`validatePiInvocationPlan(plan)`, `createPiHostBridge(surface, plan)`,
`observePiExecution(bridge, opts)`, `isPiInvocationPlan(value)`,
`isPiExecutionObservation(value)` — plus typed capability/plan/observation/
input/finding types. Immutable branded outputs; no Pi internals, Ajv, or
Artifact Core internals exposed; no authority-enforcement API.

`renderContextBlock(...)` (public subpath export, low-level renderer):
documented runtime contract — total and non-throwing for expected caller
input. Malformed media (non-string, malformed, or wildcard values) renders
as the fixed placeholder `mediaType=invalid` with the stable findings
`context.media-malformed` / `context.media-undeclared`; the raw caller value
is never interpolated and no conversion hook is invoked. Non-string context
IDs and labels render as the placeholder `invalid`. Valid inputs render
byte-identically to validated plan output.

## Invocation-Plan Structure

`PiInvocationPlan`: protocol version, consumer identity/version, supported Pi
lane, five exact references, occurrence/attempt IDs, preamble, task section,
context sections, completion criteria, correlation footer, context inventory,
subject correlations, expected observation contract, capability compatibility,
deterministic findings, status `projection-ready`, `piGuardEnforcementPending:
true`, and the rendered prompt (deep-frozen snapshot, WeakSet-branded).

## Prompt Projection Strategy

Fixed-order segments: trusted adapter preamble (static code), TaskSpec-only
task section, ContextManifest metadata inventory, untrusted context data
blocks, CompletionContract criteria, correlation footer. Deterministic for
equal inputs; bounded by adapter limits and the host prompt maximum.

## Context-Isolation Strategy

Exact manifest correlation (unknown/duplicate/missing/extra rejected), manifest
ordering, per-item/total/count bounds, explicit-only truncation, text media
types plus declared `base64-context` for binary, authority-looking provenance
rejected, and length-prefixed fixed-delimiter blocks that are collision-proof
by construction.

## CompletionContract Strategy

Checks render as prospective criteria for later assessment; no permission,
self-approval, or receipt language; exact reference preserved.

## AuthorityPolicy Non-Operative Handling

Correlated by exact reference and digest only; content never rendered; plan
states pi-guard enforcement is pending; RuntimeGrant never interpreted.

## Pi Capability Fingerprint

SHA-256 over the canonical required-surface serialization (package identity,
version, adapter API version, injection/transport, prompt size, encodings,
media types, six event classes, correlation, ordering, required features);
declared-order normalized; deterministic, documented, testable,
non-authoritative.

## Host Bridge Strategy

Narrow structural `PiHostSurface` matching the documented 0.83.0 ExtensionAPI
subset; injects via `before_agent_start` message; observes session/turn/
message/tool/settle/shutdown events as data; never blocks or mutates tools,
never changes settings, never installs, never starts Pi, never writes
lifecycle state; correlation via read-only `sessionManager.getSessionId()`.

## Observation Model

`PiExecutionObservation`: session/turn correlation, host timestamps as
observational strings (no `Date.now`), completion status (completed/cancelled/
error/not-observed), ordered tool-call observations, host errors, model/usage
observations when supplied, completeness, and explicit flags
`isAdapterObservation`, `isExecutionResult: false`, `isTrustedReceipt: false`,
`impliesAuthorization: false`, `toolObservationImpliesPermission: false`.

## Tests Added by Category

- Unit (projection 22, context 33, completion 9, compatibility 36,
  observation 10, unicode 15, media-type 9, input-shape 64, render 33):
  input/bundle correlation, task projection, context isolation, completion
  criteria, authority separation, host compatibility, observation model,
  Unicode byte model, the shared media-type parser, the F-1 public-input
  shape gate, the F-2 public-renderer coercion boundary, the A-1 renderer
  bound matrix, and the A-2/A-3 capability and context-item descriptor
  snapshot matrices.
- Integration (bridge 16): plan acceptance/forgery, deterministic injection,
  arming semantics, late-event classification, completion/cancellation/
  error/tool observation, no tool/settings mutation, no lifecycle writes,
  correlation preservation.
- Security (12): no hidden I/O, gated harness boundary, no `Date.now`,
  no global state, no caller mutation, deep immutability, unforgeable brands,
  getter non-invocation, prototype-pollution inertness, bounded rendering,
  deterministic output, no path leakage, fixed delimiters.
- Compatibility (13): env gating, path resolution, fail-closed missing
  package, real installed Pi 0.83.0 inspection (no skips in this
  environment), no model request, adapter surface contract, fixture-package
  failure cases, and the A-4 fixture commit-visibility guard.
- Totals: unit 231, integration 16, security 12, compatibility 13 =
  **272/272** (duplicate executions 0; skipped 0).

## Final Results (Post-Acceptance-Correction)

- Pi adapter (unique): unit **231** (projection 22, context 33, completion 9,
  compatibility 36, observation 10, unicode 15, media-type 9, input-shape 64,
  render 33), integration **16**, security **12**, compatibility **13** =
  **272/272**.
- Previous WP-4 tests (unique): **243/243** (no regressions).
- Full unique total: **515/515**; duplicate executions: **0**; full runner
  reports exactly **515/515** (no ambiguous "total": unique and runner counts
  are identical).
- Test additions since the acceptance correction: input-shape +21 (43 → 64)
  eligibility/requested-use/registry/subject-correlations/artifact-brand
  matrices (F-A4) = **+21** adapter tests (251 → 272).
- Conformance: **531/531**, 0 mismatches; schemas **51/51**; rules **114/114**;
  vectors **19/19**; generated corpus byte-reproducible.
- Strict production typecheck and test typecheck pass; build passes; root
  exports and `./pi-adapter` subpath exports resolve; internal subpaths remain
  blocked (tested).
- Dependency audit: no dependencies added or changed.
- Real Pi 0.83.0 harness: executed with the explicit local-lane path
  (package identity and version verified, all required runtime exports
  present, compatible); harness without the environment gate returns the
  stable gated result; wrong-path/wrong-package fixture cases fail closed.
- Security audit: no test file imports another test file; no tool-inventory
  reads; no `Date.now`; no filesystem/network/shell/Git behavior outside the
  gated harness; no Pi settings or `~/.pi` mutation; no model request; no
  tool execution; malformed media values (capability declarations and
  context items) fail closed with stable findings and never throw through the
  public projection and renderer APIs; no conversion hook, accessor, or
  proxy trap is invoked by adapter parsing; the public renderer renders
  malformed media as the fixed `mediaType=invalid` placeholder; every public
  projection container (capability, limits, context items, eligibility,
  subject correlations, requested use, registry) is read through own data
  descriptors into immutable snapshots, so expected malformed public
  projection input across all containers fails through typed findings and
  never escapes as a raw exception, never invokes caller getters, and never
  triggers Proxy `get` traps.

## Supported Host Lane

Linux x86_64; Node.js v22.23.2; Pi 0.83.0; Artifact Core at commit
`45bfd97…`; UTF-8; isolated local extension compatibility harness; no live
model request; no active tool execution.

## Focused Correction After Independent Human Review (F1–F8)

**F1 (MAJOR) — test discovery and evidence accuracy.** `projection.test.ts`
defined 22 tests and exported `buildWorldWith`; three other test files imported
it, so Node's test runner registered and executed the 22 projection tests in
each importing process (66 duplicate executions; runner reported 407 while the
unique total was 341). Correction: `buildWorldWith` moved to the non-test
helper `tests/pi-adapter/helpers/world.ts`; all importers updated; a test-tree
audit confirms no `*.test.ts` file imports another test file. State after
F1–F8 (superseded by the R-1/R-2 test additions; see "Final Results" for the
current totals): WP-4 243; WP-5A unit 98 (projection 22, context 25,
completion 9, compatibility 17, observation 10, unicode 15), integration 16,
security 12, compatibility 12; WP-5A total 138; full unique total 381;
duplicate executions 0; full runner 381/381. (Focused tests were added for
F2/F5/F6/F7/F8, so the unique total increased from the reviewed 341.)

**F2 (MINOR) — empty media capability must not pass.** `inspectPiHostCompatibility`
now requires the approved textual context representation (`text/plain`) and
rejects empty, malformed, wildcard, parameterized, or non-string media
declarations with stable findings (`host.text-media-missing`,
`host.media-malformed`, `host.media-wildcard-unsupported`). Binary support is
claimed only when `base64-context` is explicitly declared. The fingerprint
reflects the declared surface deterministically.

**F3 (MINOR) — correct Pi 0.83.0 timestamp documentation.** Documentation now
states that `turn_start` is the only public 0.83.0 timestamp source; completion,
settle, and shutdown events generally supply no public timestamps; the adapter
records a timestamp only when the host supplies one, never synthesizes trusted
timestamps, uses no `Date.now()` fallback, and treats missing end timestamps as
expected on this lane. Files: `pi-adapter-observation-model.md`,
`pi-adapter-host-compatibility.md`, `pi-adapter-architecture.md`, ADR-022.

**F4 (MINOR) — remove false tool-inventory claims.** Documentation now states
that WP-5A never reads or interprets the Pi tool inventory
(`getActiveTools()`/`getAllTools()` are not called; the optional surface fields
were removed from `PiHostSurface`); tool inventory and authority projection are
reserved for WP-5B; tool-call attempts are observed through lifecycle events
only and observation never implies permission. Tests assert zero inventory
reads. Files: `pi-adapter-architecture.md`, `pi-adapter-host-compatibility.md`,
ADR-020, ADR-022, `src/adapters/pi/types.ts`.

**F5 (MINOR) — clarify bridge injection contract.** The contract is now
explicit and documented: one bridge instance per host surface; hook-driven
injection through the registered `before_agent_start` handler; `armInjection()`
(renamed from `injectPlan()`) only arms the plan and is idempotent; one
injection per `before_agent_start` event; repeated turns may legitimately
receive repeated injection; the integration layer is responsible for preventing
duplicate bridge registration (no host-owned registration token exists in the
public 0.83.0 API); WP-5A keeps no mutable global host registry. Events
captured after `session_shutdown` are classified late (`late: true`), excluded
from completion/tool derivation, and reported with the stable finding
`observation.late-event`. Files: `src/adapters/pi/types.ts`,
`src/adapters/pi/host-bridge.ts`, `src/adapters/pi/observation.ts`.

**F6 (MINOR) — define text media matching.** Exact media-type matching after
narrow normalization (lowercase type/subtype; parameters stripped for item
matching only; capability declarations must be bare type/subtype tokens).
`text/plain` does not authorize `text/markdown`; wildcards are unsupported and
rejected; case normalization applies to type/subtype only; no silent media
coercion (binary is rendered as base64 only). Files:
`src/adapters/pi/compatibility.ts`, `src/adapters/pi/context.ts`.

**F7 (NOTE) — unify text length and safe truncation semantics.** One
authoritative UTF-8 byte text-bound model (`src/adapters/pi/internal/unicode.ts`):
`utf8ByteLength`, `validateUnicodeScalarText`, `truncateUtf8WithoutSplittingScalar`.
All limits renamed to byte units (`maxContextItemBytes`, `maxTotalContextBytes`,
`maxPlanBytes`, `maxPromptBytes`); truncation returns the longest valid Unicode
prefix within the limit and never splits a scalar; isolated surrogates are
rejected before rendering (no U+FFFD replacement, no normalization); frame
declared byte lengths exactly match emitted UTF-8 payloads; explicit truncation
metadata reports original and emitted byte lengths. Files:
`src/adapters/pi/{types,context,render,projection}.ts`,
`src/adapters/pi/internal/unicode.ts` (new).

**F8 (NOTE) — remove machine-specific harness assumption from the primary
path.** `PGW_PI_PACKAGE_PATH` (or an explicit path) is the authoritative harness
input; without the gate the harness is inert with a stable gated result. The
machine-specific default moved to the clearly labeled local-lane helper
`tests/pi-adapter/compatibility/local-lane.ts`; production behavior never
depends on it. Fixture packages under
`tests/pi-adapter/fixtures/pi-packages/` cover wrong identity, wrong version,
missing export, missing manifest, and non-package paths. The harness never
scans the filesystem, reads `~/.pi`, or modifies configuration.

**F9 — out of scope (unchanged pre-existing WP-4 unused symbols).** The unused
symbols reported in `src/conformance/runner.ts`, `src/engine/identity.ts`, and
`src/pointofuse/evaluate.ts` were present at the WP-4 baseline and were not
modified.

## Final Correction After Focused Rereview (R-1–R-4)

**R-1 (MODERATE) — malformed media values must not throw.** Media
normalization previously assumed a string (`mediaType.split(...)`), so
caller-supplied `undefined`, numbers, arrays, objects, or wrapper objects in
`PiResolvedContextItem.mediaType` or capability `mediaTypes` entries could
escape as uncaught `TypeError`s from `projectExecutionBundleToPi(...)`.
Correction: one authoritative parser
(`src/adapters/pi/internal/media-type.ts`) now owns media parsing and
normalization for both capability inspection and context correlation. It
accepts `unknown`, validates `typeof value === 'string'` before any string
operation, never coerces with `String(...)`, never invokes `toString`/
`valueOf`/getters/proxy conversion traps, and returns typed parse results.
Malformed or non-string context-item media values now fail closed with the
stable finding `context.media-malformed` (distinct from `context.media-undeclared`
for syntactically valid but undeclared media and `context.media-unsupported`
for binary media without declared base64 transport); wildcard item media
remains rejected as `context.media-undeclared`. Non-string context text fails
closed with `context.text-malformed`; the renderer and Unicode helpers guard
non-string text/bytes defensively and never throw. Tests: 8 new context tests
plus 9 media-type parser tests, covering undefined/null/number/boolean/array/
object/wrapper/accessor/proxy/throwing-hook values with assertions that no
hook is invoked, caller input is not mutated, findings are deterministic, no
plan is produced, and projection returns a typed failure.

**R-2 (MINOR) — non-string capability media declarations must fail
inspection.** `inspectPiHostCompatibility(...)` previously applied
`String(m)` to capability `mediaTypes` entries, so string-coercible
non-strings such as `[['text/plain']]` passed inspection as `text/plain`.
Correction: all string coercion removed; entries are validated by actual
runtime type and syntax. Non-string, wrapper, accessor-bearing, sparse,
non-array, wildcard, parameterized, and malformed declarations fail closed
with `host.media-malformed` / `host.media-wildcard-unsupported`;
`host.text-media-missing` continues to report a missing required `text/plain`.
Fingerprint construction is coercion-free (`capabilityEntryString` maps
non-strings by runtime type tag), deterministic, and never crashes for
malformed declarations; equivalent reordered valid declarations retain
identical fingerprints. Other caller-controlled capability lists (events,
encodings, transport, features) were audited: non-array lists fail closed
through the required-entry check, object entries are matched by identity
only (never coerced), and fingerprinting is safe for all lists. Tests: 8 new
compatibility tests.

**R-3 (MINOR) — implementation-report consistency.** All stale sections were
reconciled with actual runner output at that point: "Files Created" (13
production files, 10 test files plus helpers), "Tests Added by Category"
(current per-file breakdowns and totals), "Final Results" (123/16/12/12 =
163 adapter, 243 WP-4, 406 full, duplicates 0), and the tool-inventory
wording. (Those R-3-era counts are superseded by the F-1–F-4 correction
totals in "Files Created" and "Final Results" below.) The report no
longer claims WP-5A reads or observes the Pi tool inventory anywhere;
historical pre-correction totals (341/407 with 66 duplicate executions)
remain only in the F1 section, explicitly labeled as pre-correction evidence.

**R-4 (NOTE) — Unicode test comment.** The comment in
`tests/pi-adapter/unit/unicode.test.ts` claiming a supplementary character
fits a 4-byte budget was corrected to describe the actual 5-byte requirement
(`'a'` + 4-byte scalar); the assertions were already correct and unchanged.

## Final Public-Boundary Correction (F-1–F-4)

**F-1 (MODERATE) — public projection input must fail through typed findings.**
`projectExecutionBundleToPi(...)` previously dereferenced missing or
malformed caller input before its fail gate: `capability: undefined` (with a
context item) escaped as a `TypeError` from `capability.mediaTypes`,
`limits: undefined` (with a context item) escaped from
`limits.maxContextItemCount`, a null context-item entry escaped from
`item.contextId`, and a capability without `requiredFeatures` escaped from
`.includes(...)` when a validated subject declared a protocol feature.
Correction: one explicit shape gate
(`src/adapters/pi/internal/input-shape.ts`, new) runs before any projection,
correlation, rendering, fingerprinting, or feature lookup and validates the
input container, capability container and scalar identity/version fields,
limits shape (non-negative safe-integer byte/count bounds, boolean
`allowTruncation`), the `contextItems` container, and every context item
(plain runtime object; own data properties for required fields; primitive
`contextId`/`label`; non-negative safe-integer `byteLength`; object
`provenance`; boolean `truncated`; optional fields data-property-only).
Validation uses `typeof`, `Array.isArray`, `Object.getPrototypeOf`, and
`Object.getOwnPropertyDescriptor` only — no getter, accessor, `toString`,
`valueOf`, or proxy conversion trap is ever invoked, and input is never
mutated. New stable findings: `input.invalid`,
`host.capability-malformed`, `input.limits-malformed`,
`context.item-malformed`; existing keys (`host.capability-missing`,
`input.limits-missing`, `context.items-missing`, `host.required-feature-unknown`)
are reused where semantically correct. The required-feature check is now
null-safe and coercion-free: only primitive-string entries of a verified
array are considered, and missing/non-array/non-string declarations are
treated as declaring nothing (`semantic.feature-unsupported`).
`correlateContextItems(...)` (public subpath export) received the same
defensive capability/limits/item-shape guards for standalone callers.
Tests: 33 new input-shape tests covering the full F-1 matrix (top-level
containers, capability scalars, limits fields, item entries, accessors,
proxies, required features).

**F-2 (MODERATE) — public renderer must not coerce caller media values.**
`renderContextBlock(...)` (public subpath export) interpolated the raw caller
`mediaType` into its block header, so a `Symbol` threw a `TypeError` and an
object could have its `toString` invoked. Correction: the authoritative media
parser classifies every media value; only a successfully parsed primitive
string is interpolated, and malformed or wildcard media renders as the fixed
placeholder `mediaType=invalid` with the stable findings
`context.media-malformed` / `context.media-undeclared`. Non-string
`contextId`/`label` render as the fixed placeholder `invalid`. The renderer
is now documented as total and non-throwing for expected caller input:
`renderContextBlock`, `renderContextBlocks` (non-array items, malformed
limits), `renderContextInventory`, `renderCorrelationFooter`,
`renderTaskSection`, `renderCompletionCriteria` (null/primitive models), and
`renderPrompt` (non-string segments, non-array blocks) all fail closed with
stable findings or deterministic placeholder output and never perform
implicit conversion of caller-controlled values. Valid inputs render
byte-identically to the pre-correction output (verified by the unchanged
projection and Unicode suites). Tests: 27 new renderer tests covering the
full F-2 media matrix with hook counters.

**F-3 (MINOR) — `maxPromptBytes` must be a valid positive number.**
`capability.maxPromptBytes <= 0` previously admitted `NaN`, strings,
booleans, fractions, unsafe integers, and Infinity through numeric coercion,
silently disabling the host prompt bound. Correction:
`inspectPiHostCompatibility` now requires `typeof === 'number'`,
`Number.isSafeInteger`, and `> 0` (stable finding `host.prompt-bound-malformed`;
`undefined` keeps `host.max-prompt-missing`); `planWithinHostBounds` gained a
defensive bound check so direct internal misuse also fails closed; capability
fingerprinting uses a hook-free canonical scalar representation and never
throws for malformed containers; finding messages use the same canonical
form. All other caller-controlled numeric limits (`maxContextItemBytes`,
`maxTotalContextBytes`, `maxPlanBytes`, `maxContextItemCount`) are validated
as non-negative safe integers by the F-1 gate. Tests: 11 new compatibility
tests plus the F-1 limits-matrix tests.

**F-4 (MINOR) — implementation-report file inventory.** The report now lists
`docs/design/glossary.md` in the modified-file inventory and describes the
actual tracked modified set (four paths: `package.json`, `src/index.ts`,
`tests/security/security.test.ts`, `docs/design/glossary.md`); the
Git-state statement no longer claims only two WP-4-era files changed. The
correction-session file counts of the earlier review are not reconstructible
from Git (the whole WP-5A changeset is one uncommitted set) and are replaced
by the authoritative final uncommitted-changeset inventory below.

## Final Acceptance Correction (A-1–A-5)

**A-1 (MAJOR) — public `renderContextBlock` maxBytes strictly validated.**
`renderContextBlock` previously accepted a caller-controlled `maxBytes`
without runtime validation: numeric strings were coerced, `true`/`null`/
bigint/Number wrappers were coerced, objects could invoke `valueOf`, Symbols
threw raw `TypeError`s, and NaN/Infinity/non-numeric strings silently
disabled the bound. Correction: `maxBytes` is validated as a non-negative
safe integer (`typeof === 'number'`, `Number.isSafeInteger`, `>= 0`) before
any comparison, arithmetic, or truncation; malformed bounds (numeric and
non-numeric strings, booleans, null, undefined, bigint, wrappers, NaN,
±Infinity, negatives, fractions, unsafe integers, arrays, objects with
`valueOf`/`toString`, Symbols, proxies with coercion traps) fail closed with
the stable finding `render.bound-malformed` and a deterministic empty block —
never coerced, never silently disabled, never throwing. `allowTruncation`
must be a boolean; any other value is treated as false (truncation denied).
Valid bounds preserve byte-exact framing and scalar-safe truncation. Tests:
6 new renderer tests (A-1 matrix with hook counters).

**A-2 (MODERATE) — capability fields read through own data descriptors.**
The shape gate previously protected only the three identity scalar fields;
all other capability fields (`mediaTypes`, `maxPromptBytes`,
`requiredFeatures`, event lists, transport, encodings, correlation flags)
were read through ordinary property access, so accessor getters executed and
throwing accessors or Proxy `get` traps escaped as raw exceptions. Correction:
`readCapabilitySnapshot` reads every protocol-significant capability field
once through its own data descriptor; accessor-bearing, inherited-only, or
trap-throwing fields fail closed with `host.capability-malformed`; absent
fields snapshot as undefined and are reported by the inspector with its
stable semantic findings; list fields are copied through per-index
descriptors (Proxy `get` traps never execute); compatibility inspection,
fingerprinting, correlation, required-feature checks, and renderer-bound
checks all operate on the immutable snapshot and never re-read the original
caller object. Tests: 10 new input-shape tests (per-field accessor/throwing
accessor/inherited/Proxy trap matrices with hook counters).

**A-3 (MODERATE) — context-item fields read through validated descriptor
values.** The shape gate verified descriptors but later read values through
ordinary property access, so a Proxy whose `get` trap threw for `contextId`
escaped as a raw exception. Correction: `snapshotContextItem` and
`readRenderItemFields` read every required and optional item field
(`contextId`, `label`, `mediaType`, `text`, `bytes`, `byteLength`,
`provenance`, `truncated`, `contentDigest`) through own data descriptors;
correlation, media matching, byte validation, truncation, and rendering
never return to the original caller item. Structural Proxy trap failures
(`getPrototypeOf`, `getOwnPropertyDescriptor`) become stable
`context.item-malformed` findings. Non-string `mediaType`/`text` remain
classified by correlation as `context.media-malformed` /
`context.text-malformed` (R-1 contract preserved); the standalone renderer
keeps its F-2 placeholder behavior for non-string values.

**A-4 (MODERATE) — fixture payloads commit-visible.** The root `dist/`
ignore rule excluded the three harness fixture payloads
(`tests/pi-adapter/fixtures/pi-packages/{missing-export,wrong-identity,wrong-version}/dist/index.js`),
so a clean commit would omit them and the F8 fixture tests would fail in a
fresh clone (missing `harness.version-export-drift` /
`harness.export-missing`). Correction: `.gitignore` now re-includes only the
fixture tree with explicit negations; production `dist/` output remains
ignored. Verified with `git check-ignore`, `git status --untracked-files=all`
(8 fixture files visible), and a clean-clone simulation (all five fixture
semantics reproduce). One regression guard test added.

**A-5 (MINOR) — report narrative counts corrected.** The F-1 narrative now
states 33 input-shape tests and the F-2 narrative 27 renderer tests;
additions arithmetic: 33 + 27 + 11 = 71 (input-shape + render +
compatibility), matching the observed 163 → 234 adapter increase. Current
totals after A-1–A-4 test additions were 494/494 full (historical;
superseded by the F-A4 totals in "Final Results").

## Final Evidence-Container Boundary Correction (F-A4/F-RPT)

**F-A4 (MAJOR) — eligibility, requested-use, and registry evidence containers
are read through own data descriptors.** The eligibility report,
`subjectCorrelations`, the requested-use declaration, and the accepted
registry context were still read through ordinary property access after the
shape gate: caller getters executed, throwing getters and Proxy `get` traps
escaped as raw exceptions from `projectExecutionBundleToPi(...)`, and
inherited-only eligibility fields could be accepted. Correction (in
`src/adapters/pi/internal/input-shape.ts`): four new descriptor-driven
snapshots — `EligibilitySnapshot` (`eligible` primitive boolean,
`capability`/`workspaceId` primitive strings, nested
`subjectCorrelations`), `SubjectCorrelationsSnapshot` (plain object of
primitive-string values; optional `bundleInstance` keeps the documented
lenient correlation semantics), `RequestedUseSnapshot` (`capability`/
`workspaceId` primitive strings; optional input), and
`RegistryContextSnapshot` (the four identity strings; the branded `snapshot`
member is never read). Every field is read through its own data descriptor;
accessor-bearing, inherited-only, or trap-throwing fields fail closed with
the new stable findings `input.eligibility-malformed`,
`input.requested-use-malformed`, `input.registry-malformed` (missing
containers keep the existing `input.eligibility-missing` /
`input.registry-missing`). The fail gate now runs only after all evidence
snapshots pass, and projection correlation/rendering read only the frozen
snapshots — no original eligibility/requested-use/registry object is ever
read again. Exact bundle (`bundleInstance`), workspace, and requested-use
correlation are preserved on the snapshots with the existing stable
`input.eligibility-correlation` finding for well-formed mismatches. The four
artifact subjects continue to pass the Artifact Core runtime brand check
before any nested artifact access (spread/serialized/proxy/descriptor
lookalikes fail closed with `input.unvalidated`). Tests: 21 new input-shape
tests (per-container undefined/null/primitive/array/class-instance/missing/
inherited/accessor/throwing-accessor/Proxy-`get`/Proxy-structural matrices
with hook and trap counters, correlation preservation, registry footer
rendering, caller non-mutation, artifact-brand lookalike matrix).

**F-RPT (MINOR) — report no-throw scope corrected.** The Final Results
security-audit claim is now scoped to the verified boundary: every public
projection container is descriptor-snapshotted, so expected malformed input
across all containers returns typed findings with zero getter and zero Proxy
`get` invocation. The previous eligibility/registry property-access gap is
fully corrected and no longer a limitation.

## Resolved After Final Correction

All five residual acceptance findings (A-1…A-5) and both final confirmation
findings (F-A4, F-RPT) are resolved. No new
findings are open. F1–F9 and R-1–R-4 closed behavior is preserved: no test
file imports another test file; unique and runner totals match (515/515,
duplicates 0); media capability requirements, exact non-widening matching,
UTF-8 byte limits with Unicode-safe truncation, hook-driven bridge injection
with late-event classification, no tool-inventory reads, corrected Pi 0.83.0
timestamp documentation, and the explicit environment-gated harness contract
are unchanged and re-verified. The F-1 public-input gate, F-2 public-renderer
boundary, F-3 prompt-bound validation, F-4 report inventory, and the A-1–A-4
descriptor-snapshot and fixture corrections are complete: expected malformed
caller input fails through typed findings with zero hook invocation, the
public renderer performs no implicit conversion of caller-controlled values
(including the `maxBytes` bound), capability and context-item containers are
read only through own data descriptors, and all harness fixture payloads are
commit-visible.

## Unresolved Decisions / Known Limitations

- **No unresolved WP-5A Pi Adapter decisions.**
- **Deterministic-guarantee scope.** Deterministic equivalence is guaranteed
  for stable/plain runtime inputs. Intentionally stateful structural Proxies
  whose property descriptors change between observations are outside that
  equivalence guarantee: the adapter makes no claim that a hostile object
  deliberately returning inconsistent structural metadata between descriptor
  observations produces byte-equivalent output. This does not weaken safety:
  each protocol-significant field is captured exactly once into a frozen
  descriptor-derived snapshot, and all subsequent validation, correlation,
  and rendering use only that snapshot, so later caller-object or Proxy
  changes cannot alter the captured values, semantic correlation, prompt
  rendering, plan contents, or findings already produced. Stateful structural
  Proxy behavior cannot bypass validation, cause original-container rereads,
  invoke ordinary `get` traps after snapshot capture, create authority, or
  change the plan status (`projection-ready`) or
  `piGuardEnforcementPending: true`. Structural introspection failures fail
  closed through typed findings rather than raw exceptions.
- The evidence-container boundary is fully descriptor-driven: eligibility,
  subject correlations, requested use, and registry are snapshotted through
  own data descriptors like capability, limits, and context items; no
  original-container property reads remain.
- The bridge is a structural prototype bound to the documented 0.83.0
  extension surface; actual host wiring requires the environment-gated harness
  and an integration layer that supplies a live `ExtensionAPI` (out of scope
  for WP-5A).
- Pi 0.83.0 has no public cancellation extension event; cancellation is
  host-supplied.
- The harness inspects the locally installed package only when
  `PGW_PI_PACKAGE_PATH` (or an explicit path) is provided.
- WP-5A never reads or interprets the Pi tool inventory; tool inventory and
  authority projection are reserved for WP-5B.

## Git State

- Only authorized paths changed/created (adapter sources, adapter tests,
  package/tsconfig configuration for the subpath, narrow root exports,
  adapter docs/ADRs/report, WP-4 security test boundary note, glossary
  entries). Staging empty; branch and HEAD unchanged; no Git-state mutation;
  no WP-0…WP-4 files modified beyond the four narrow pre-existing-file
  changes (the two root-export lines in `src/index.ts`, the subpath and test
  scripts in `package.json`, the WP-4 security test boundary exclusion, and
  the glossary additions in `docs/design/glossary.md`); WP-3 files untouched.
- Final uncommitted changeset (authoritative; correction-session splits are
  not reconstructible from Git): **52 paths — 5 tracked modified
  (`package.json`, `src/index.ts`, `tests/security/security.test.ts`,
  `docs/design/glossary.md`, `.gitignore`) and 47 untracked** (14 new
  production files including `internal/input-shape.ts`, 12 new test files
  including `unit/input-shape.test.ts` and `unit/render.test.ts`, 4 non-test
  helpers, 8 harness fixture files, 9 new documentation files).

## Verdict

**WP-5A EVIDENCE-BOUNDARY CORRECTION COMPLETE — READY FOR FINAL ACCEPTANCE**

All five acceptance findings (A-1…A-5) and both final confirmation findings
(F-A4 evidence-container snapshots, F-RPT report scope) are corrected and
verified on executable evidence: the public renderer performs no implicit
conversion of any caller-controlled value including the `maxBytes` bound;
capability, limits, context items, eligibility, subject correlations,
requested use, and registry are all read only through own data descriptors
into immutable snapshots, so getters, accessors, and Proxy `get` traps never
execute and structural Proxy trap failures become stable typed findings;
all harness fixture payloads are commit-visible and fresh-clone semantics
reproduce; and the report inventory matches the actual uncommitted changeset
(5 tracked modified including `.gitignore`, 47 untracked, 52 total).
F-1–F-4, R-1–R-4, and F1–F9 closed behavior is preserved. WP-4 regressions
pass (243/243, 531/531, 51/51, 114/114, 19/19, corpus byte-reproducible);
the WP-5A suite is 272/272 and the full suite 515/515 with zero duplicates
and zero skips; the real Pi 0.83.0 harness passes with the explicit
local-lane path and is inert without the gate. Human review and explicit
approval are required before WP-5A may be committed and closed; no human
approval and no closure are claimed.
