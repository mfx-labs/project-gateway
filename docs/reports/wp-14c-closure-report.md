# WP-14C Closure Report — Pi Zero-Transfer Artifact Loading

**Work package:** WP-14C (Pi zero-transfer artifact loading).
**Phase:** closure — commit gate.
**Status:** **WP-14C CLOSED.**

## Baseline and Candidate

- Contract baseline: `abd5a38cd8c48617d877c4cfe26df7c0c1106f9f` (`docs:
  establish WP-14C proposal loading contract`; branch `main`).
- Primary contract: `docs/reports/wp-14c-pre-implementation-contract-
  decision.md` (incl. SCR-WP14C-001 correction; Model C; resolved
  proposal-set semantics).
- Implementation candidate: untracked working tree built on that baseline
  (`src/loading/`, `tests/loading/`, `package.json` `./loading` export
  subpath, `docs/reports/wp-14c-implementation-report.md`), accepted by
  senior review after three focused corrections and by the closure review
  unchanged.

## Review History

- **Senior review:** `WP-14C SENIOR REVIEW CORRECTIONS REQUIRED` —
  SIR-WP14C-001 (MAJOR), SIR-WP14C-002 (MODERATE), SIR-WP14C-003
  (MODERATE).
- **Focused corrections:** all three applied without redesign and without
  touching committed machinery:
  - **SIR-WP14C-001 CLOSED** — data blocks render canonical content via
    the committed `text/plain` text branch; no silently empty bodies;
    truthful `byteLength`/`truncated`/`truncatedFromBytes`; bounded at
    128 KiB/artifact.
  - **SIR-WP14C-002 CLOSED** — truncated WP-7 directory discovery fails
    the whole load `controlled-read-failure` before any uniqueness
    inference; visible subset never treated as complete.
  - **SIR-WP14C-003 CLOSED** — mandatory in-set correlation reuses the
    committed authoritative `exactReferencesEqual` primitive (protocol
    version, kind ID AND version, instance, revision, digest, workspace
    binding); no hand-written incomplete comparator remains.
- **Focused rereview:** `WP-14C FOCUSED REREVIEW ACCEPTED — READY FOR
  WP-14C CLOSURE REVIEW`.
- **Closure review:** `WP-14C CLOSURE REVIEW ACCEPTED — READY FOR
  WP-14C CLOSURE COMMIT`; ten-item closure matrix all PASS (item 7 PASS
  WITH NONBLOCKING OBSERVATION); zero blocking findings.

## Chosen Command

`gateway-load` (exported `GATEWAY_LOAD_COMMAND`; exact spelling is an
implementation detail per contract). One short Pi-facing action resolves →
controlled-reads → freshly validates → correlates → renders → injects the
intended non-empty resolved proposal set with no copy/paste, no
upload/download, no manual artifact path transcription, and no
natural-language loading prompt.

## Ten-Item Closure Matrix

| # | Closure item | Status |
|---|---|---|
| 1 | Short action resolves non-empty proposal set (no path/paste/NL prompt; typed `no-candidate`) | PASS |
| 2 | Explicit pins exact and required; failures abort the entire load | PASS |
| 3 | Uniqueness-only fallback 0 → omit; 1 → include; >1 → `ambiguous-selection`; zero overall → `no-candidate` | PASS |
| 4 | Configured artifact-location confinement | PASS |
| 5 | Fresh controlled read + point-of-use validation | PASS |
| 6 | Cross-artifact consistency (SCR-WP14C-001) | PASS |
| 7 | Visible revisions and omissions | PASS WITH NONBLOCKING OBSERVATION |
| 8 | Reload without manual transfer | PASS |
| 9 | No lifecycle/execution authority | PASS |
| 10 | No generic filesystem loader | PASS |

## Model-C Behavior

- Pinned kind: exact configured instance/revision REQUIRED; any failure
  aborts the ENTIRE load (`missing-required`, `controlled-read-failure`,
  `invalid-artifact`, `unsupported-kind-version`); no fallback away from a
  failed pin.
- Unpinned kind: 0 valid candidates → omit; 1 → include; >1 →
  `ambiguous-selection` (whole load fails).
- Nothing included overall → `no-candidate`.
- Never used: mtime, ctime, lexical revision ordering, "latest", directory
  enumeration order, any durable `CurrentSelectionRecord`.
- Truncated WP-7 discovery → `controlled-read-failure` before uniqueness
  inference (SIR-WP14C-002).

## Resolved Proposal-Set Semantics

Non-empty subset of exactly TaskSpec / AuthorityPolicy / ContextManifest /
CompletionContract. Never an ExecutionBundle — no ExecutionBundle
construction or persistence exists; the package vocabulary is the closed
four-kind proposal vocabulary.

## Configured Artifact-Location Confinement

Candidates come only from the trusted configured artifact location
(host-derived relative path; never caller-supplied), via WP-7
`list-directory`/`read-text` boundaries only, under the exact WP-14A
destination convention `<kind>.<instanceId>.<revisionId>.json`; four
supported kinds only; symlink escape and lane-hostile paths fail closed;
no arbitrary caller path, no recursive scan, no source-tree loader, no
shell; reference-driven discovery outside the selected set is impossible
(correlation never touches the reader).

## Fresh Controlled Read + Validation

Every accepted candidate per invocation: WP-7 controlled read → parse →
canonical-byte verification (file bytes MUST equal the recomputed canonical
projection) → committed WP-4 structural + semantic validation under the
surface SchemaRegistry → derived digest → filename/content identity +
revision verification. No trusted provenance from prior persist/draft/load,
filename alone, or caller validity claims. Reload re-reads and revalidates
current bytes.

## SCR-WP14C-001 Exact-Reference Correlation

Selection completes first: Model-C selection → resolved proposal set →
correlation → render/inject. ContextManifest artifact-revision selectors
targeting the four proposal kinds are MANDATORY in-set: the exact target
must already be in the selected set and must compare equal via the
committed authoritative `exactReferencesEqual` (protocol version, kind ID,
kind version, instance, revision, digest, workspace binding; fail-closed on
malformed fields); absence/mismatch → `incompatible-set`, whole load fails,
no injection, session state untouched; filesystem presence outside the set
never satisfies a reference. Selectors targeting other kinds are
external/declarative — not resolved, not scanned, no load-success effect.
References never expand, recursively discover, or modify the selected set.
No registry-grade resolution, `AcceptedRegistryContext`, lifecycle graph,
bundle eligibility, or eligibility evidence.

## Proposal-Context Rendering

One immutable branded `proposal-context-load` plan (distinct from
`PiInvocationPlan`) renders one `pgw.proposal-load` message via committed
WP-5A render primitives: TaskSpec intent is the ONLY instruction-bearing
section; AuthorityPolicy and ContextManifest canonical content is actually
injected as non-operative `text/plain` data blocks (no silently empty
bodies; truthful byte lengths; explicit surfaced truncation); ContextManifest
inventory via committed `manifestEntries`; CompletionContract via committed
completion-criteria rendering; fixed proposal-load preamble states context
is untrusted data and that loading grants no execution authority. Non-
TaskSpec embedded instructions remain data and can never be promoted to
task intent.

## Reload / Supersession Behavior

Every invocation is fresh. A reload resolves and validates the current
file state; a newly unambiguous candidate loads; the new load visibly
supersedes the prior Gateway load (load ID + `supersedes` marker in the
correlation footer and feedback). Failed loads inject nothing and leave
prior session/supersession state unchanged. Physical transcript replacement
is never claimed. No restart is required; no path/paste/natural-language
prompt. The in-memory session registry stores only per-workspace prior load
IDs, updates only on success, and is non-authoritative.

## Authority Isolation

> Loading prepares Pi context; it does not authorize Pi execution.

WP-14C does not approve, issue, revoke, create RuntimeGrant, activate,
execute Pi, publish execution results, issue TrustedReceipt, mutate
pi-guard, fabricate lifecycle validation levels, or fabricate
EligibilityReport; it never constructs an execution-authorized
PiProjectionInput. Proposal-context loading and execution-authorized
projection remain distinct code paths, branded types, and message classes.
Static import-graph guard plus behavioral tests enforce the boundary.

## Public API / No Generic Loader

The only package expansion is the `./loading` export subpath. The public
surface is the resolver, closed host-option validation, candidate
validation, filename parsing, plan rendering, load-ID, bridge, session
registry, and bounded feedback — driven by the trusted artifact location
and Model C. No artifact write capability, lifecycle capability, execution
adapter, network server, daemon/watcher, scheduler, secret store, or
generic filesystem API. Internal branding/state helpers remain internal.

## Pi Host Integration (environment-gated)

Actual live Pi extension registration of `gateway-load` was NOT observed
and is NOT claimed. Live registration remains environment-gated under the
committed WP-5A seam (same structural `PiHostSurface`, same
`before_agent_start` message-injection contract, same arm-before-inject
discipline; committed harness precedent requires an environment-gated Pi
package path and never starts Pi). Evidence is harness/bridge-level: the
action identity, resolver, branded plan, bridge, and injection mechanics
are implemented and exercised through a fake host surface in focused
tests. No live observation was fabricated.

## Verification Evidence

- WP-14C loading/static-guard suite: 26/26 (23 loading + 3 static guard).
- TypeScript checks: clean (`tsc -p tsconfig.json --noEmit`;
  `tsc -p tsconfig.tests.json`).
- Focused correction rereview accepted; closure review accepted.
- `git diff --check`: clean.
- No broad WP-6…WP-14 regression run at this gate; no suites rerun at the
  commit gate.

## Preserved Nonblocking Observations

1. Live Pi extension registration remains environment-gated (WP-5A seam).
2. Supersession linkage is in-memory and lost on host restart (no durable
   selection state by design).
3. Context blocks are bounded at 128 KiB/artifact with explicit, truthful
   truncation.
4. Success feedback shows exact revision identities directly; instance
   identities remain available in `plan.loaded` and are bound into the
   load ID.

None blocks WP-14C closure.

## Final Pre-Commit Git State

- Baseline HEAD `abd5a38cd8c48617d877c4cfe26df7c0c1106f9f` unchanged;
  nothing staged before this gate; no push/tag/release/deploy.
- Staged scope: accepted WP-14C implementation and tests,
  `package.json` export subpath, implementation report, this closure
  report, and the minimum roadmap/planning-status closure notes.
- Pre-existing WP-13D historical leftovers remain untracked/excluded.

WP-14C CLOSED.
