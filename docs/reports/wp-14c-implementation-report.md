# WP-14C Implementation Report — Pi Zero-Transfer Artifact Loading

**Work package:** WP-14C (Pi zero-transfer artifact loading; human-
authorized implementation).
**Phase:** implementation candidate — NOT committed, NOT closed. Review
gate: senior review.
**Baseline:** `abd5a38cd8c48617d877c4cfe26df7c0c1106f9f` (`docs: establish
WP-14C proposal loading contract`; branch `main`).
**Nothing staged or committed.** No push/tag/release/deploy. WP-15 not
begun. Contract is the committed WP-14C pre-implementation contract
decision (incl. SCR-WP14C-001 correction); no redesign.

## 1. Files Changed

**New:**
- `src/loading/types.ts` — proposal-load types, bounds, and the closed
  load-options/lane/plan shapes (transport-free).
- `src/loading/core.ts` — the Model-C resolver: candidate discovery,
  load-time validation, selection, and SCR-WP14C-001 in-set correlation.
- `src/loading/plan.ts` — the distinct branded proposal-context load
  plan and rendering (reuses committed WP-5A render primitives).
- `src/loading/internal/brand.ts` — module-private plan branding
  (distinct from the execution `PiInvocationPlan` brand).
- `src/loading/bridge.ts` — the short Pi action (`gateway-load`):
  `before_agent_start`-style injection bridge, minimal in-memory session
  registry (supersession identification), bounded feedback.
- `src/loading/index.ts` — package barrel.
- `tests/loading/load.test.ts` — 23 focused tests (selection, validation,
  correlation, rendering/authority, command/reload, confinement).
- `tests/loading/static-guard.test.ts` — import-graph and vocabulary
  guards for the proposal-load boundary.
- `package.json` — `./loading` export subpath (mirrors `./pi-adapter`).

No committed source/test/schema changed. No WP-7/WP-10/WP-11/WP-14
boundary modified.

## 2. Chosen Pi Command

`gateway-load` (exported `GATEWAY_LOAD_COMMAND`; exact spelling is an
implementation detail per contract §12). The action is one host function
(`performGatewayLoad(surface, lane, options, sessions?)`) that requires
no artifact path, no pasted artifact, and no natural-language load
prompt — only the opaque `workspaceId` and optional host pins.

## 3. Resolver Architecture

`resolveProposalLoad(lane, options, extras?)`:

- **Discovery** — WP-7 `list-directory` on the configured artifact
  location (relative path derived host-side from the validated workspace
  record; never caller-supplied), filtered by the exact WP-14A
  destination convention `PROPOSAL_CANDIDATE_FILE_RE`
  (`<kind>.<instanceId>.<revisionId>.json`); kindHint file/symlink only;
  per-kind candidate cap (250) beyond which the kind fails closed
  `ambiguous-selection`.
- **Reads** — WP-7 `read-text` with the WP-3 artifact byte bound (1 MiB,
  single source `INPUT_BYTE_LIMITS.artifact`); truncated reads can never
  validate.
- **Validation** — committed WP-10 composition
  (`createDraftProposalWithSchemaRegistry`) under the surface's exact
  `SchemaRegistry`; canonical-byte continuity enforced (file bytes MUST
  equal the recomputed canonical projection — the persisted WP-14A
  format is the digest-absent canonical form); filename/content
  identity + revision correlation (filename alone never trusted).
- **Selection** — Model C exactly: pinned kinds are required (missing →
  `missing-required`; unreadable → `controlled-read-failure`; invalid /
  identity mismatch → `invalid-artifact`); unpinned kinds 0 → omit, 1 →
  include, >1 → `ambiguous-selection`; zero overall → `no-candidate`.
  No mtime/ctime, no lexical revision ordering, no enumeration order, no
  durable `CurrentSelectionRecord`.
- **Correlation** — SCR-WP14C-001: over the ALREADY-selected set only;
  ContextManifest `project-gateway.artifact-revision` selectors targeting
  the four proposal kinds are mandatory in-set. Field comparison reuses the
  committed authoritative exact-reference equality primitive
  (`exactReferencesEqual` in `src/internal/protocol-equality.js` — the same
  comparator family the committed self-resolution machinery uses) over a
  synthetic reference built from the loaded artifact's freshly validated
  identity: protocol version, target kind ID AND VERSION, instance,
  revision, digest, and workspace binding are all compared
  fail-closed (missing/malformed fields never match);
  missing/mismatch/conflict fails the whole load `incompatible-set`;
  selectors targeting other kinds are external/declarative (never
  resolved, never scanned, no load-success effect). References never
  expand or modify the selected set.
- **Plan** — `renderProposalLoadPlan` brands the immutable plan.

## 4. Configuration Additions

`ProposalLoadOptions` — closed host/operator selection input:
`{ workspaceId, pins?: {kind, instanceId, revisionId}[] }`. Pins use the
schema-enforced `pgw:i:`/`pgw:r:` identity patterns; duplicate pins and
unknown fields fail `invalid-options`; a pinned kind outside the four
proposal kinds fails `unsupported-kind-version`. No paths, no content,
no validation flags, no authority operands; secret-free; never
MCP-caller-writable. The lane (`ProposalLoadLane`) is host-owned: trusted
configuration + WP-7 reader + surface schema registry.

## 5. Load-Time Validation Chain

```text
candidate file → WP-7 controlled read → parse → canonical projection
check → committed WP-4 structural validation → semantic validation →
canonicalization/derived digest → filename/content identity + revision
verification → Model-C inclusion → set correlation → render/inject
```

Fresh on every invocation; no trust in prior persistence, prior drafts,
caller flags, or filenames.

## 6. SCR-WP14C-001 Correlation Implementation

In-set exact-reference verification over the selected set using the
committed reference schema (`EXACT_REFERENCE_SCHEMA` via the surface
registry — the same schema the committed self-resolution machinery
applies) and the committed per-field comparison semantics (protocol
version, kind id/version, instance, revision, digest, workspace
binding). Registration-identity verification steps of the committed
for-use path are NOT invoked: they are lifecycle territory and would
either always fail for proposals or require fabricated evidence — both
prohibited by contract §8. Filesystem presence outside the selected set
never satisfies a reference; nothing is scanned or loaded to satisfy one.

## 7. Rendering / Injection Composition

Renders one immutable `pgw.proposal-load` message reusing committed
WP-5A primitives: `renderTaskSection` (TaskSpec — the ONLY
instruction-bearing section), `renderContextInventory` +
`renderContextBlock` (ContextManifest, AuthorityPolicy as non-operative
data; per-block 128 KiB bound with explicit surfaced truncation),
`renderCompletionCriteria` (CompletionContract), `renderPrompt`,
`renderCorrelationFooter` (load ID, workspace, loaded revisions, omitted
kinds, supersedes). Data-artifact blocks use the committed `text/plain`
text representation so the canonical content is actually injected (see
SIR-WP14C-001 correction below). A distinct fixed proposal-load preamble
states the context is untrusted data and that loading grants no execution
authority; no execution-projector preamble, no eligibility/pi-guard
statement. The plan is a distinct branded type — never a
`PiInvocationPlan` — and the bridge (`createProposalLoadBridge`) mirrors
the WP-5A `before_agent_start` injection pattern with its own message
class; injection only when armed, and arming happens only after a
successful load (a failed load injects nothing).

## 8. Reload / Supersession Behavior

Every invocation is fresh (discovery, reads, validation, selection,
correlation). The minimal in-memory session registry
(`createProposalLoadSessionRegistry`) records only the previously
injected load ID per workspace; the new load renders an explicit
`supersedes <loadId>` footer entry when a prior load exists. Physical
transcript replacement is never claimed (the committed Pi seam cannot
delete prior messages); explicit supersession semantics prevent silent
stale/duplicate interpretation. No durable selection state, no watcher,
no scheduler.

## 9. Authority-Isolation Evidence

- No lifecycle/control-plane/execution/publication/storage/writing/
  enforcement/pi-guard imports anywhere in `src/loading/` (static-guard
  test over the import statements).
- No `PiProjectionInput`, `EligibilityReport`, `AcceptedRegistryContext`,
  RuntimeGrant, activation, receipt, or pi-guard operand exists in the
  plan, core, or bridge (static-guard + behavioral tests).
- Loading prepares Pi context; it does not authorize Pi execution — the
  plan preamble states this; the execution projection pipeline
  (`src/adapters/pi/projection.ts`) is untouched and remains the only
  execution-authorized path.

## 10. Filesystem Confinement

Discovery is strictly scoped to the configured artifact location
(host-derived relative path) via WP-7 controlled list/read boundaries;
no arbitrary path argument, no recursive scan, no shell, no generic
source-file loader; symlink escape fails closed
(`controlled-read-failure`); non-candidate files are ignored; WP-7
typed failures are mapped to the closed load vocabulary with redacted
messages (no absolute roots — asserted in tests).

## 11. Focused Tests and Results

| Suite | Result |
|---|---|
| `tests/loading/load.test.js` (23 new) | 23/23 |
| `tests/loading/static-guard.test.js` (3 new) | 3/3 |
| `tests/pi-adapter/unit/*` (neighbor) | 253/253 incl. drafting |

Coverage: explicit pin success; pinned missing → `missing-required`;
unpinned 0 → omit; 1 → include; >1 → `ambiguous-selection`; none →
`no-candidate`; malformed/semantic-invalid/identity-mismatch rejection;
fresh revalidation (digest recomputed on reload; malformed stops the
load); correlation success; mandatory target absent → `incompatible-set`;
on-disk-but-not-in-set → still `incompatible-set` (no set expansion);
external/declarative kind not resolved; truncated WP-7 listing fails
closed `controlled-read-failure` (no uniqueness from the visible
subset); exact-reference comparison enforces target kind version;
failed correlation injects nothing; TaskSpec-only instruction
rendering; AuthorityPolicy non-operative; data-artifact BODIES present
with truthful byte/truncation metadata; distinct plan (no status /
pi-guard / eligibility fields); short command needs no path; injection
message shape (`pgw.proposal-load`); failed load injects nothing;
reload picks up new unambiguous state with visible supersede + load ID;
deterministic load ID; artifact-location-only discovery; symlink escape
fail-closed; closed-field options; bridge rejects non-branded plans.

Per the testing policy, no broad WP-6…WP-14 regression was run; only
new WP-14C tests and directly affected Pi-adapter/drafting neighbors.

## 12. Limitations

- Live Pi host integration remains environment-gated (the committed
  WP-5A harness pattern): the bridge composes the same
  `before_agent_start` injection contract; an actual Pi extension
  registration of the `gateway-load` command is a host-integration
  concern at the same environment-gated seam as WP-5A.
- `gateway-load` command spelling is implementation detail
  (GATEWAY_LOAD_COMMAND); OS hotkey binding remains optional external
  UX sugar.
- Context-block rendering is bounded at 128 KiB per artifact with
  explicit truncation surfaced in the plan; the loaded set itself is
  always complete and validated.
- Session registry is in-memory only (per contract); a host restart
  loses the supersede linkage (no durable selection state exists by
  design).

## Focused Corrections (SIR-WP14C-001 / 002 / 003)

Senior review required three corrections; all applied without redesign
and without touching committed machinery.

### SIR-WP14C-001 — data artifacts now actually injected (MAJOR)

**Root cause:** `renderProposalLoadPlan` passed the canonical artifact
content to the committed `renderContextBlock` with
`mediaType: 'application/json'`. That renderer consumes the text payload
only for `text/*` media; `application/json` falls into the binary
(base64) branch, which rendered an empty block body (byteLength=0) while
the plan/feedback still reported the artifact as loaded.

**Correction:** data-artifact blocks now use the committed adapter text
media `text/plain`, which routes the canonical content through the
renderer's text branch with explicit bounded truncation (never empty;
truncation surfaced as `truncated=true` + `truncatedFromBytes` in the
block header and plan meta). AuthorityPolicy and ContextManifest
canonical content is now present in the rendered proposal-context
message as non-operative data; TaskSpec remains the only
instruction-bearing section; CompletionContract rendering unchanged.
`byteLength`/`truncated` metadata is truthful (derived from the rendered
source data). No global renderer change: committed `render.ts` is
untouched.

**Evidence:** regression test now asserts the rendered block BODY
contains the exact AuthorityPolicy and ContextManifest canonical bytes,
`byteLength > 0`, `truncated=false` truthfulness, and negative assertions
that neither content ever enters the task section.

### SIR-WP14C-002 — truncated discovery fails closed (MODERATE)

**Root cause:** `discoverCandidates` ignored the truthful `truncated`
flag WP-7 `list-directory` returns when a directory exceeds the entry
bound; a bounded enumeration-order-dependent visible subset could then
produce a false uniqueness result.

**Correction:** immediately after a successful controlled listing, a
`truncated: true` result fails the ENTIRE load with the closed typed
mapping `controlled-read-failure` (redacted; no absolute roots) before
any Model-C 0/1/>1 resolution. Uniqueness is never inferred from the
visible subset; `ambiguous-selection` is never reported unless multiple
valid candidates were actually established.

**Evidence:** focused test injects a truthful truncated listing through
the WP-7 service boundary (stub lane reader; no >10 000 real files
needed) with a visible single valid candidate: the load fails
`controlled-read-failure`, no plan is produced, nothing is injected, and
prior supersession/session state is unchanged.

### SIR-WP14C-003 — exact reference comparison includes kind version (MODERATE)

**Root cause:** the initial correlation implementation hand-rolled the
per-field comparison and compared `target_kind.id` but not
`target_kind.version`, drifting from committed self-resolution
semantics; the report's claim of "kind id/version" parity overstated the
code. (Note: the committed `kind-descriptor` schema constrains reference
kind versions to `1.0`, so a mismatched version is also rejected at
reference-schema validation — the comparison is defense in depth and
keeps parity with `resolveExactArtifactReference`.)

**Correction:** the hand-rolled field loop is replaced by the committed
authoritative equality primitive `exactReferencesEqual`
(`src/internal/protocol-equality.js` — the comparator family the
committed self-resolution machinery delegates to), applied to the
selector reference against a synthetic reference built from the loaded
artifact's freshly validated identity. Compared fields: protocol
version, target kind ID AND VERSION, instance identity, revision
identity, digest, workspace binding (via `workspaceBindingsEqual`);
missing/malformed fields fail closed. A `target_kind.version` mismatch
fails the whole load `incompatible-set`. No registry-grade machinery
(`resolveExactArtifactReferenceForUse`, `AcceptedRegistryContext`,
lifecycle semantics) is used. `verifyInSetCorrelation` is exported from
`core.ts` for focused testing only (absent from the public package
barrel).

**Evidence:** focused test drives `verifyInSetCorrelation` directly with
a synthetic loaded set: same kind ID + correct version correlates
successfully; same kind ID + wrong target kind version fails
`incompatible-set`; and the load-path correlation-failure test proves a
failed correlation injects nothing and leaves session state unchanged.

## 13. Git State

- Baseline HEAD `abd5a38cd8c48617d877c4cfe26df7c0c1106f9f` unchanged;
  nothing staged, nothing committed; no push/tag/release/deploy.
- Working tree: `package.json` modified (export subpath); `src/loading/`
  (6 source files) and `tests/loading/` (2 test files) new.
- Pre-existing untracked WP-13D historical leftovers untouched.

WP-14C IMPLEMENTATION COMPLETE — READY FOR SENIOR REVIEW
