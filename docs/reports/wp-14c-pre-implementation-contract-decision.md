# WP-14C — Pi Zero-Transfer Artifact Loading — Pre-Implementation Contract Decision

**Work package:** WP-14C — Pi zero-transfer artifact loading.
**Phase:** contract decision only (documentation only; no implementation
authorized by this document; no source/test/schema/fixture/package/runtime
change made; nothing staged or committed).
**Status:** WP-14 is CLOSED. The WP-14C product requirement is
human-approved (approved product requirement: the user invokes a short Pi
command/keyword/hotkey and Pi resolves, validates, and loads the intended
artifact/bundle without copy/paste, upload/download, manual path
transcription, or a natural-language loading prompt). The bounded contract
analysis and the two architecture decisions were human-approved:

1. **Selection model: Model C** — explicit pins + uniqueness-only
   fallback.
2. **Resolved proposal-set semantics** — explicit-pinned kinds are
   REQUIRED; an unpinned kind with zero valid candidates is OMITTED; an
   unpinned kind with exactly one valid candidate is INCLUDED; multiple
   valid candidates for an unpinned kind fail closed
   (`ambiguous-selection`); at least one artifact must resolve;
   cross-artifact inconsistency fails closed.

**WP-14C implementation remains NOT STARTED and NOT AUTHORIZED**:
subsequent explicit human implementation authorization is required.
**WP-15 remains BLOCKED** until WP-14C closes (roadmap order
`WP-14 → WP-14C → WP-15`).
**Focused correction record (SCR-WP14C-001, MAJOR — §8 cross-artifact
consistency requiredness undefined):** CLOSED by this docs-only
correction. §8 now pins: Model-C selection remains the sole determiner of
the resolved proposal set (references never expand/recursively discover/
modify the set); ContextManifest artifact-revision selectors targeting
the four proposal kinds are MANDATORY in-set references (exact target
must already be present and resolve exactly via the committed
`resolveExactArtifactReference` self-resolution machinery; missing /
mismatch / conflict → `incompatible-set`, whole load fails, no partial
injection; filesystem presence outside the set does not satisfy the
reference); selectors targeting any other kind are external/declarative
(not resolved, not scanned, no load-success effect, no registry/
lifecycle evidence); only proposal/self-resolution semantics are used —
no registry-grade resolution, `AcceptedRegistryContext`, lifecycle
graph, bundle eligibility, or issued-reference authority.
**Baseline:** HEAD `b8945dd0910319f640bb3760a10f64b35d91204c` (branch
`main`; `feat: close WP-14 ChatGPT connectivity`); this phase adds
documentation only.

## 1. Objective

WP-14C provides one short Pi-facing action that

> resolves → controlled-reads → validates → correlates → renders →
> injects

the intended **resolved proposal set** into Pi context without
copy/paste, upload/download, manual artifact path transcription, or
natural-language "read these files" prompting. Loading transfers context
only. It does NOT authorize execution.

## 2. Terminology

- **Resolved proposal set** — the normative load-unit term: any
  non-empty subset of `TaskSpec`, `AuthorityPolicy`, `ContextManifest`,
  `CompletionContract` selected per §5.
- This set is NEVER called an `ExecutionBundle`. WP-14C MUST NOT
  construct or persist an `ExecutionBundle`.
- A command may carry a user-friendly name such as `/gateway-load` or
  equivalent; exact command spelling is an implementation detail.
  Normative documents avoid `/load-bundle` terminology to prevent
  confusion with `ExecutionBundle`.

## 3. Pi Integration Boundary

WP-14C reuses the committed WP-5A host integration mechanics:

- the existing Pi extension/host bridge seam
  (`src/adapters/pi/host-bridge.ts` — `createPiHostBridge` and its
  `before_agent_start` message-injection contract);
- committed render primitives and markers
  (`src/adapters/pi/render.ts` — `TRUSTED_ADAPTER_PREAMBLE`,
  `[PGW-TASK]`, `[PGW-CTX-BEGIN]`/`[PGW-CTX-END]`, `renderTaskSection`,
  `renderContextBlock(s)`, `renderContextInventory`,
  `renderCompletionCriteria`, `renderCorrelationFooter`, `renderPrompt`;
  `src/adapters/pi/context.ts` — `manifestEntries`,
  `correlateContextItems`).

Critically: WP-14C MUST NOT manufacture or satisfy the lifecycle
eligibility requirements of the execution-authorized `PiProjectionInput`
pipeline (bundle at `point-of-use-eligible`, members at
`registry-compatible`, `EligibilityReport` evidence). Those levels and
evidence are lifecycle-granted (WP-12/WP-13 path) and are NOT available
to proposal loading. WP-14C reuses render/injection mechanics only where
safe and creates a distinct **proposal-context load plan/type** (own
branding, proposal-level validation facts, load ID) semantically separate
from eligibility, approval, issuance, RuntimeGrant, activation, and Pi
execution.

## 4. Candidate Discovery

Discovery is limited to the configured artifact location, using the
committed WP-14A destination convention:

```text
<kind>.<instanceId>.<revisionId>.json
```

Requirements:

- WP-7 controlled directory/read boundaries only (`list-directory`,
  `read-text`);
- exact supported naming patterns only (schema-enforced
  `pgw:i:`/`pgw:r:` identity patterns; single component);
- no arbitrary caller path;
- no recursive filesystem scan;
- no shell;
- no generic source-file loader;
- no repository-declared "current" or priority flag is honored.

## 5. Selection — Model C (APPROVED)

Trusted/operator-local configuration may define exact pins per kind
(exact instance identity/revision per kind).

For each supported kind:

### Explicitly pinned

The exact configured identity/revision MUST resolve. Failure cases
(missing, duplicate, unreadable, invalid, identity/revision mismatch)
abort the ENTIRE load (`missing-required`).

### Unpinned

After controlled discovery and validation:

- zero valid candidates → OMIT the kind;
- exactly one valid candidate → INCLUDE it;
- more than one valid candidate → `ambiguous-selection`, fail the
  ENTIRE load.

At least one artifact must be included; if none resolve, return typed
`no-candidate`.

MUST NOT be used: mtime, ctime, lexical revision ordering, "latest"
semantics, filesystem enumeration order, any durable
`CurrentSelectionRecord`. Revision IDs are opaque and do not encode
chronology.

## 6. Trusted versus Project-Visible Inputs

Trusted/operator-local (host configuration):

- workspace binding;
- configured artifact location;
- optional exact instance/revision pins per kind;
- resolution mode/configuration required by the implementation.

Project-visible (candidate data only):

- artifact candidate bytes;
- artifact identities/revisions;
- references already defined by artifact schemas.

Repository content cannot declare "load me", "current", priority, or
authority over selection policy; the resolver never honors such claims.

## 7. Point-of-Use Validation

Every selected candidate is freshly validated at load time:

```text
candidate file
→ WP-7 controlled read
→ structural validation
→ semantic validation
→ canonicalization / derived digest
→ identity/revision verification
→ set correlation
→ render/inject
```

`set correlation` (§8) verifies the already-resolved set; it never
selects or loads additional candidates.

Reuse existing WP-4/WP-10 validation machinery
(`validateArtifactSelf` under the exact surface `SchemaRegistry`,
`computeArtifactDigest`/digest verification).

MUST NOT trust: prior ChatGPT persistence; prior `draft-artifact`
output; caller `valid=true`; filename identity alone.

Fail closed on: malformed artifact; unsupported kind/version;
identity/revision mismatch; controlled-read failure; invalid artifact.

## 8. Cross-Artifact Consistency (SCR-WP14C-001 correction; pinned)

### Selection remains authoritative

Model C (§5) ALONE determines the resolved proposal set. The sequence is:

```text
Model-C selection
→ resolved proposal set
→ exact-reference consistency verification
→ render/inject
```

NOT:

```text
reference discovery → recursive artifact loading → expanded set
```

Correlation verifies the selected set; it NEVER selects additional
artifacts. References MUST NOT expand, recursively discover, or modify
the Model-C selected set.

### Mandatory in-set references

For an included `ContextManifest` exact artifact-revision selector whose
`target_kind` is one of the four WP-14C proposal kinds — `TaskSpec`,
`AuthorityPolicy`, `ContextManifest`, `CompletionContract` — the
reference is MANDATORY and in-set:

- the exact referenced instance/revision MUST already be present in the
  resolved proposal set;
- the reference MUST resolve exactly using the committed self-resolution
  machinery (`resolveExactArtifactReference` — the plain, non-ForUse
  variant; no registry context);
- missing target → `incompatible-set`;
- identity/revision mismatch → `incompatible-set`;
- conflicting/duplicate resolution → `incompatible-set`;
- the ENTIRE load fails;
- no partial injection occurs.

Filesystem presence outside the resolved set does NOT satisfy the
reference. WP-14C does NOT scan or load another candidate merely to
satisfy it.

### External/declarative references

If a selector targets any artifact kind OUTSIDE the four proposal kinds:

- WP-14C treats it as external/declarative context;
- WP-14C does NOT resolve it;
- WP-14C does NOT scan for it;
- its presence or absence does NOT determine proposal-load success;
- it MUST NOT create `registry-compatible` or lifecycle evidence.

### Authority boundary

WP-14C uses ONLY proposal/self-resolution semantics. It MUST NOT invoke
or emulate: registry-grade resolution
(`resolveExactArtifactReferenceForUse`/`AcceptedRegistryContext`),
lifecycle graph compatibility, bundle eligibility, or issued-reference
authority. WP-12/WP-13 authority semantics remain untouched. WP-14C MUST
NOT fabricate `registry-compatible` or lifecycle eligibility evidence,
and MUST NOT elevate proposal artifacts to lifecycle-granted validation
levels.

## 9. Context Rendering Semantics

Committed artifact semantics are preserved:

- **TaskSpec** — its task intent is the ONLY proposal content rendered
  as instruction-bearing task intent (`renderTaskSection`);
- **ContextManifest** — bounded context inventory/content via committed
  context render primitives;
- **AuthorityPolicy** — non-operative data/context; it MUST NOT become
  self-authorizing because it is loaded;
- **CompletionContract** — committed completion-criteria semantics.

Non-TaskSpec embedded instructions remain data/context, never task
instructions.

## 10. Injection and Reload Semantics

One successful short action injects ONE immutable Gateway
proposal-context message/load.

A reload MUST: perform fresh discovery; perform fresh controlled reads;
perform fresh validation/correlation; resolve the set again; inject a
new proposal-context load; visibly identify the exact revisions loaded;
identify that the new load supersedes the prior Gateway load when such a
prior load exists.

The committed Pi transcript seam cannot necessarily delete prior
messages; therefore: do NOT claim physical transcript replacement; use
explicit supersession semantics (load ID + supersedes-marker); prevent
silent stale/duplicate interpretation. No durable selection database, no
watcher.

## 11. Feedback

Success feedback identifies: load ID; loaded kinds; exact
instance/revision identities; omitted unpinned kinds.

Semantic shape:

```text
Loaded: TaskSpec <rev>, ContextManifest <rev>; omitted: AuthorityPolicy, CompletionContract.
```

Failures distinguish at least: `no-candidate`, `ambiguous-selection`,
`missing-required`, `invalid-artifact`, `incompatible-set`,
`unsupported-kind-version`, `controlled-read-failure`.

No absolute roots. No trusted configuration details. No silent partial
load.

## 12. Short Invocation / Hotkey

The Pi extension command is the product capability; exact command name is
an implementation detail. It must require no artifact paths, no pasted
artifact content, no natural-language load prompt. OS/terminal hotkey
binding is optional UX sugar only. No keyboard daemon, watcher,
scheduler, event bus, or background file monitor.

## 13. Authority Isolation

> Loading prepares Pi context; it does not authorize Pi execution.

WP-14C MUST NOT approve, issue, revoke, create RuntimeGrant, activate,
execute, publish execution results, issue TrustedReceipt, mutate
pi-guard, or bypass WP-12/WP-13 execution authority. Proposal-context
loading and execution-authorized projection remain distinct paths.

## 14. Minimal Implementation Shape

Future implementation is authorized to contain only the minimum needed
for:

- proposal candidate resolver;
- Model-C selection;
- load-time validation/correlation;
- proposal-context load plan/rendering;
- Pi command/host injection;
- bounded feedback;
- focused tests.

Do NOT create WP-14C-A/B/C unless a real implementation dependency
appears. Do NOT redesign WP-7, WP-10, WP-11, WP-12, WP-13, or WP-14.

## 15. Closure Gate

WP-14C may close only when evidence proves:

1. one short Pi action resolves a non-empty intended proposal set;
2. explicit pins are exact and required;
3. uniqueness-only fallback behaves: 0 → omit; 1 → include; >1 → fail
   closed;
4. candidates come only from the configured artifact location;
5. every loaded artifact is controlled-read and freshly validated;
6. cross-artifact inconsistency fails closed — mandatory in-set
   ContextManifest proposal references (targeting the four proposal
   kinds) must resolve exactly within the selected set;
   external/declarative references never affect load success;
7. exact loaded revisions and omissions are visible;
8. reload can pick up a newly unambiguous revision without
   path/paste/natural-language prompt;
9. loading grants no lifecycle/execution authority;
10. no generic filesystem loader exists.

## 16. Roadmap State

- WP-14: CLOSED
- WP-14C contract: ESTABLISHED (this document; human decisions approved)
- WP-14C implementation: NOT STARTED / NOT AUTHORIZED
- WP-15: BLOCKED

## 17. Verification (docs-only)

- Contract consistency inspected against WP-5A host bridge/projection
  boundaries (`src/adapters/pi/host-bridge.ts`, `projection.ts`,
  `render.ts`, `context.ts`), WP-7 controlled read/config boundaries,
  WP-4/WP-10 validation machinery, WP-12/WP-13 execution authority
  separation, and WP-14A persisted artifact layout.
- No runtime tests run (docs-only phase).
- `git diff --check` clean; nothing staged or committed.

## 18. Git State

- Baseline HEAD `b8945dd0910319f640bb3760a10f64b35d91204c` unchanged;
  nothing staged, nothing committed; no push/tag/release/deploy.
- Pre-existing untracked WP-13D historical leftovers untouched.

## Remaining Architecture Decisions

NONE.

WP-14C CONTRACT ESTABLISHED — READY FOR HUMAN IMPLEMENTATION AUTHORIZATION
