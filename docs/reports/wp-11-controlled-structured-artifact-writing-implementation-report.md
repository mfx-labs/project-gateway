# WP-11 Controlled Structured Artifact Writing — Implementation Report (Slice 1)

**Slice:** WP-11 slice 1 — transport-free create-only controlled-write core.
**Status:** CLOSED — implementation candidate (uncommitted) completed the
accepted review sequence: senior review (SR-W11-S1-001…005), first focused
correction, first focused rereview (FR-W11-S1-001), second focused
correction, second focused rereview (accepted). Final closure authorized;
see §6.
**Baseline:** `e4b85daee8fc2cd51919232b417d25dee72c7401` (WP-10 closure).
**Normative contract (roadmap):** WP-11 — "Controlled structured artifact
writing. Objective: workspace-contained writes of validated drafts. Inputs:
WP-10 drafts, WP-6 containment, WP-7 reader. Outputs: contained artifact
files. Owned: controlled writes. Prohibited: approval, execution.
Invariants: writes confined to configured roots; no lifecycle authority."
Closure gate: "Writes confined to configured workspace roots; no lifecycle
authority." Normative prerequisites WP-6, WP-7, WP-10 are CLOSED.

## 1. Slice Boundary

Slice 1 introduces exactly one capability: create-only persistence of one
already-accepted WP-10 `ValidDraftProposalResult` (ok:true, valid:true) as
a new structured artifact draft file inside the host-configured
`artifactLocation` region of one version-2 workspace. The operation is
transport-free, create-only, fail-closed, containment-bound,
point-of-use revalidated, exact-byte preserving, and performed through an
injected host write executor. No MCP surface, no `surfaceId` routing, no
replace/update/CAS, no directory creation, no ExecutionBundle or
ExecutionResult persistence, no lifecycle/store/audit/Git side effects, no
network/tunnel behavior.

## 2. Service-User Ownership Prerequisite (host composition)

The executor enforces a fixed service-user ownership check on the
descriptor-verified artifact-location parent used for creation and on the
created file itself (`fstat` UID equality with the running service user).
This is a host-composition prerequisite of the supported Slice 1 lane, not
a caller-controlled write authority:

- the supported host composition requires the descriptor-verified
  artifact-location parent used for creation to satisfy the
  service-user ownership requirement enforced by the executor;
- the created file is likewise verified against the service user;
- unsupported ownership layouts (e.g., root-owned or group-shared
  artifact locations under a non-root service user) fail closed;
- the requirement is implementation-owned and documented here; it is not
  a project-wide ownership policy, it does not grant lifecycle authority,
  and it does not change artifact identity or persistence vocabulary.

## 3. Correction Record (SR-W11-S1-001…005)

- **SR-W11-S1-001 (MAJOR) — descriptor-anchored write.** The executor now
  anchors the mutation to a retained artifact-root descriptor (accepted
  WP-7/reader lane pattern: `openSync(root, O_RDONLY|O_DIRECTORY|
  O_NOFOLLOW)`, then `/proc/self/fd/<rootFd>/…`), builds the parent/target
  paths from the accepted decision's RESOLVED canonical existing-directory
  ancestor plus the missing tail (never a caller lexical absolute path),
  verifies the opened parent's descriptor-bound resolution path against
  the accepted canonical ancestor (`parent-not-verified` on divergence),
  creates the target through the anchored parent with
  `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW`, and performs partial-write cleanup
  through the same verified parent descriptor. TOCTOU elimination is not
  claimed; the accepted SYM-009/SYM-010/SYM-011 model is preserved.
  Deterministic race tests prove the reviewed exploit (intermediate
  component swapped to a symlink after revalidation) no longer creates a
  file outside the configured region, and that a post-anchor root
  replacement cannot redirect the create.
- **SR-W11-S1-002 (MODERATE) — digest correlation.** The core now rejects
  a draft whose `canonicalUtf8` does not recompute to its declared digest
  under the accepted domain-separated digest computation
  (`computeArtifactDigestOverCanonicalUtf8` in `src/digest/index.ts` — the
  single accepted digest implementation; no second serializer/hash
  contract). Failure is a deterministic `draft-not-writeable` /
  `ERR-WRITE-DRAFT-DIGEST-MISMATCH` outcome before containment or executor
  authority is reached. Negative tests cover a forged digest, mutated
  canonical bytes, and bounded non-JSON bytes.
- **SR-W11-S1-003 (MINOR) — guard coverage.** The dedicated static guard
  now also forbids `fetch(`, bare `fs` import spellings, `fs/promises`
  forms, `require('fs')`, and dynamic fs imports, and asserts the
  descriptor-anchored executor pattern — equivalent-or-stronger than the
  generic dist scan from which `src/writing` is excluded by boundary.
- **SR-W11-S1-004 (MINOR) — tests.** Added: parent-final-component symlink
  fail-closed branch, umask independence of the fixed 0o600 mode,
  bounded-write-loop semantics (short writes continue; zero/negative/
  non-integer/oversize/throwing results fail closed), close-failure
  non-success via the `afterWrite` seam (real EBADF), intermediate-swap
  and root-replacement race tests with actual filesystem-state assertions,
  and anchored cleanup verification.
- **SR-W11-S1-005 (MINOR) — ownership prerequisite.** Recorded in §2 above.

## 3a. Correction Round 2 — FR-W11-S1-001 (single-component create invariant)

The second focused rereview found the descriptor-anchored correction still
permitted a multi-component `destinationTailComponents` array to reach the
create/unlink path via `tail.join('/')` (O_NOFOLLOW protects only a final
component, so a tail intermediate that is a symlink — pre-existing or
raced — could redirect the create outside the artifact root). Correction
round 2 enforces the single-component create invariant in the executor
BEFORE any filesystem operation: `destinationTailComponents.length === 1`
is required for the create/unlink path (`verifiedParentFd +
finalComponent`); a zero-length tail is invalid evidence, and a
multi-component tail (missing intermediate directories; Slice 1 has no
directory-creation authority) fails closed as the established
`missing-parent` outcome. No tail component is ever traversed, followed,
or created; no `tail.join` path exists. Scenarios A (raced missing tail
component), B (pre-existing tail symlink, no race), and E (verified
ancestor + multi-component missing tail) are covered by regression tests
asserting real filesystem state. All round-1 descriptor-anchor protections
(root anchor, parent descriptor verification, resolution-path identity
check, post-anchor root replacement safety, descriptor-bound cleanup) are
preserved unchanged.

## 4. Boundaries (unchanged by the correction)

- Writeable kinds: exactly TaskSpec, AuthorityPolicy, ContextManifest,
  CompletionContract (accepted `ARTIFACT_DRAFT_LOCATION_KINDS`); all other
  kinds, lifecycle/control-plane records, grants, approvals, registry
  artifacts, and lookalikes rejected.
- Create-only: only a target proven missing by both accepted evaluations
  proceeds; every existing-target state fails closed; raced appearance is
  an exclusive-create conflict; no truncate/overwrite/replace/update/CAS.
- Bytes: exactly `draft.proposal.canonicalUtf8`, verbatim; no
  reserialization, newline, pretty printing, wrapper, or normalization.
- Authority: the write requires the full conjunction of runtime-genuine
  version-2 configuration, configured artifactLocation, accepted writeable
  draft, conformant destination request, accepted prospective containment,
  successful point-of-use revalidation, and the injected host executor. A
  valid draft is data, not write authority.
- Mutation scope: success creates exactly one artifact file; zero
  lifecycle/store/audit/Git/config/parent-directory mutation.
- The core remains I/O-free; `evaluateProspectiveArtifactDestination`
  remains the single containment authority; no parallel containment
  algorithm, second grammar, second kind vocabulary, second serializer, or
  second digest definition exists.

## 5. Verification (this correction run)

Typecheck, build, and test compilation pass; writing suite passes (see the
correction report for exact counts); the default suite's sole failure
remains the accepted environment mismatch (expected Pi 0.83.0, installed
Pi 0.84.1), unchanged and not normalized. No source/test/package/Git
mutation beyond the authorized correction paths; nothing committed.

## 6. Closure Record

**Accepted rereview state (authoritative).**

- SR-W11-S1-001 — CLOSED
- SR-W11-S1-002 — CLOSED
- SR-W11-S1-003 — CLOSED
- SR-W11-S1-004 — CLOSED
- SR-W11-S1-005 — CLOSED
- FR-W11-S1-001 — CLOSED

Second focused rereview verdict: `SECOND FOCUSED CORRECTION ACCEPTED —
READY FOR CLOSURE AUTHORIZATION`. No unresolved CRITICAL, MAJOR, or
MODERATE findings remain; no new blocking finding remains.

**Final closure verification (pre-commit).** Typecheck, build, and test
compilation pass; writing suite 50/50 (run twice); security 15/15;
drafting 22/22; mcp/unit 76/76; runtime 31/31; trusted 570/570;
pointofuse-v2 232/232; unit 169/169; integration 100/100; storage 431
pass / 2 expected skips; storage crash 5/5; pi-adapter 271 pass / 1 known
failure; WP-7 discovery guard OK; WP-7 validated runner 165/165; default
`npm test` 1536 pass / 1 fail. The sole failure is the known environment
mismatch: expected Pi 0.83.0, installed Pi 0.84.1 (F8 version assertion),
unrelated to WP-11, not normalized. `git diff --check` clean; the closure
commit contains only the authorized WP-11 Slice 1 paths; no
push/tag/release/publication/install/deploy occurred.

**Closure status:** WP-11 SLICE 1 CLOSED — transport-free create-only
controlled-write core: accepted WP-10 draft + configured artifact location
+ untrusted artifact-root-relative destination + WP-6 prospective
containment + mandatory point-of-use revalidation + descriptor-bound host
executor → exclusive creation of exactly one new artifact file. No broader
authority is granted; no later WP-11 slice and no WP-12/WP-5B/WP-13/WP-14/
WP-15 work was started.
