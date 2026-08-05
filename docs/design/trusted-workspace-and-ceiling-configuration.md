# Trusted Workspace and Ceiling Configuration Contract

**Status:** Accepted — human-approved and authoritative.

Defines the contract only; no configuration loader is implemented. Resolves
the trusted-configuration portion of F-SEQ-1. Normative ownership decision:
ADR-024 (Accepted). Approved by the externally granted human approval of the
Post-WP-5A planning package (approval decision date 2026-08-05; planning
commit `97022a49d9029449f304a2b1e47f9dc8da4d4a89`; accepted final review:
POST-WP-5A FINAL DOCUMENTATION SPOT CHECK: ACCEPTED; open findings at
approval: zero). Acceptance derives from the external human decision, not
from the documentation operator. This document defines the authoritative
contract only; no configuration loader, Pi integration, pi-guard
integration, or WP-6 implementation is provided by this document.
Cross-references: `capability-vocabulary.md`, `post-wp5a-roadmap.md`
(WP-6, WP-8, WP-12), `project-gateway-scope-and-principles.md` (WP-0),
ADR-002, ADR-003.

## Scope

This contract defines how a trusted local control plane configures:

- the **global authority ceiling** (capability set + numeric action limits);
- the **workspace authority ceiling** (per-workspace capability set + numeric
  action limits);
- **workspace identifiers** (opaque, caller-visible tokens);
- **workspace roots** (trusted-local filesystem paths);
- **workspace-root containment** rules;
- project-visible versus trusted-local path separation;
- unknown-workspace and malformed-configuration behavior.

It does not define the physical storage format or loader implementation;
those are WP-8 (storage) and WP-6 (config core) implementation details that
must conform to this contract.

## Trust Properties (required)

1. **Trusted configuration is external to repository-controlled content.**
   Configuration lives in a trusted-local store owned by the control plane
   (WP-8 persistence), never in repository files, artifact documents, or
   `.pi`/project-visible governance files.
2. **Repository files cannot grant, widen, or alter authority.** No artifact,
   README, instruction file, or repository-local policy file may add or
   remove entries from any ceiling, workspace registration, or configuration
   value.
3. **Workspace IDs exposed to ChatGPT are opaque identifiers, not trusted
   filesystem roots.** The only workspace-visible token is an opaque
   identifier (e.g. `pgw:w:<opaque>`); the mapping to a filesystem root is
   trusted-local configuration and never exposed as an authority input.
4. **Filesystem roots remain local trusted configuration.** Root paths are
   supplied by the trusted config store only; no consumer-supplied path may
   register or widen a root.
5. **Unknown workspaces fail closed.** Any workspace identifier not present
   in the trusted configuration is denied all authority-relevant actions.
6. **Paths outside the configured root fail closed.** Any path that resolves
   outside the configured workspace root is denied.
7. **Symlink, traversal, normalization, and root-escape behavior is explicit.**
   Resolution rules (defined below) must be applied deterministically before
   any path-based decision.
8. **Global and workspace ceilings can only narrow authority.** Ceilings are
   upper bounds; an approved AuthorityPolicy, RuntimeGrant, or consumer
   declaration can never exceed them. Effective authority is the
   intersection (see `pi-guard-compatibility-and-authority-projection.md`).
9. **Missing or malformed ceiling configuration denies affected actions.**
   Absent ceiling entries, unparseable values, unknown capability IDs, and
   inconsistent numeric limits deny the affected capabilities (default
   deny).
10. **Configuration changes require an explicit local trusted operation.**
    Updates are performed by a trusted local administrator/control-plane
    operation; there is no repository-triggered update path.

## Trusted Extension Set (F-F2)

Trusted Workspace Configuration owns a versioned trusted-local
configuration element **`trustedExtensionSet`** that binds the permitted
Pi/pi-guard effective host surface. The contract covers:

1. permitted extension or package identities;
2. expected effective source identity for security-relevant tools;
3. supported Pi built-in tool identities;
4. trusted web-access extension identities and versions;
5. treatment of user, project, temporary, package, and top-level
   registration scopes;
6. expected source path or package identity rules without exposing
   machine-specific roots to ChatGPT;
7. behavior when `sourceInfo` is missing (security-critical tools fail
   closed; non-critical tools follow the documented fallback);
8. behavior when source identity is malformed (fail closed);
9. behavior when the effective source is unexpected (fail closed);
10. behavior when the effective tool name is unknown (denied);
11. versioning and canonical identity of the trusted extension set;
12. provenance and update ownership (trusted local operation only);
13. fail-closed malformed or missing behavior;
14. repository influence prohibition.

Trust rules (normative):

- the trusted extension set is trusted-local and external to
  repository-controlled content;
- repository files cannot add, replace, or authorize extension identities;
- repository-local `.pi` configuration is not automatically Project
  Gateway governance;
- the set may only narrow the permitted effective host surface;
- membership in the set does not itself grant a capability (effective
  authority and consumer support are still required);
- unknown or unexpected sources fail closed;
- a security-critical tool with unavailable source identity fails closed;
- built-ins require an explicitly defined trusted treatment;
- trusted web-access registration must match its reviewed package identity
  and compatibility record.

Ownership (F-F2): WP-6 owns the trusted-extension-set schema or contract,
configuration validation, configuration identity, provenance,
deterministic canonicalization, fail-closed loading behavior, and the
trusted update boundary. WP-6 does **not** own Pi tool inventory sampling,
authority projection, pi-guard activation, or execution (those remain
WP-5B). WP-15's optional hardening (uncollapsed registration visibility,
stronger host compatibility probes, stronger trusted extension-manifest
verification) does not replace WP-6 as the trusted extension-set owner;
WP-15 may later strengthen verification of WP-6's trusted declarations
through a separately reviewed contract.

## Configuration Model (contract-level)

- **Global ceiling:** one authoritative record containing:
  - `capabilities`: a set of canonical capability IDs (vocabulary per
    `capability-vocabulary.md`); absent = empty set = deny all;
  - `actionLimits`: optional numeric limits (e.g. max actions) with exact
    semantics defined per limit type; absent = no numeric limit, but never a
    widening of capability sets;
  - `version`: configuration version identifier.
- **Workspace ceiling:** one record per registered workspace containing the
  same shape plus:
  - `workspaceId`: opaque identifier;
  - `root`: trusted-local absolute filesystem path;
  - containment rules (below).
- **Configuration provenance:** each record carries its own identity and
  version; loading verifies well-formedness; malformed records are treated as
  absent (deny), never as permissive defaults.
- **Configuration versioning:** every update increments the record version;
  consumers bind to the version they validated; mixed-version reads are
  rejected.
- **Configuration update ownership:** only the trusted control plane
  (WP-12) through an explicit local trusted operation may write the config
  store (WP-8). No other component may mutate it.

## Path Resolution and Containment Rules

1. Canonicalize the candidate path with the configured root as base.
2. Resolve all symlinks and normalize `.`/`..` segments lexically first,
   then re-resolve symlinks until a fixed point is reached (bounded
   iteration; exceeding the bound fails closed).
3. A path is contained if and only if its fully resolved absolute form is
   within the resolved root (either equal to the root or under it).
4. Symlinks pointing outside the root fail closed (the link target is not
   within the root).
5. Traversal segments that escape the root fail closed.
6. Case sensitivity, drive/volume handling, and separators follow the host
   platform's canonical form, applied consistently; any ambiguity fails
   closed.
7. Root-escape attempts, regardless of success, produce a fail-closed
   finding and deny the action.

## Default-Deny Behavior

- Unknown workspace → deny.
- Unknown capability ID → deny (and record an unsupported-required-capability
  finding if the capability was required).
- Missing ceiling → deny affected actions.
- Malformed configuration → deny affected actions; the malformed record is
  reported as configuration error, never bypassed.
- No configuration loaded (fresh environment) → deny all
  authority-relevant actions until the trusted config store is present.

## Relationship to Existing Contracts

- WP-4 `PointOfUseInputs.globalActionCeiling` /
  `workspaceActionCeiling` (numeric action ceilings) remain the validated
  numeric-action operand; the capability-level ceilings defined here are the
  capability-set operand. Both narrow; neither widens (AUT-001 semantics in
  `src/pointofuse/evaluate.ts` are preserved).
- The opaque workspace identifier is the `pgw:w:` token already used in
  artifact workspace bindings; this contract adds the trusted mapping from
  that token to a root.
- ADR-002 l.22: control-plane authoritative state stays outside managed
  repositories; this contract is the configuration facet of that boundary.

## Capability-Ceiling Evaluator Integration (F-01, Model A)

Artifact Core is the only authoritative effective-authority evaluator, and
it currently accepts only the numeric `globalActionCeiling` /
`workspaceActionCeiling`. The capability-set ceilings defined in this
contract therefore require a narrowly scoped, reviewed **Artifact Core
point-of-use boundary extension** that WP-6 owns:

- optional `globalCapabilityCeiling` / `workspaceCapabilityCeiling` inputs
  on `PointOfUseInputs` / `EffectiveAuthorityInputs` (capability set +
  vocabulary version binding per ADR-025);
- capability-version compatibility checks (mismatch fails closed);
- deterministic capability-set canonicalization (sorted, deduplicated);
- intersection of the capability ceilings with the approved AuthorityPolicy,
  RuntimeGrant, and consumer support (deny wins; unknown denied);
- new fail-closed findings (missing/malformed/unknown ceiling entries,
  version mismatch);
- conformance fixtures, AUT-* rules, and digest/semantic vectors;
- **evaluator interface version (F-R6):** the capability-aware interface is
  **`PointOfUseInputs v2`**; the numeric-only shape is the legacy
  compatibility shape (`PointOfUseInputs v1`). Production evaluations whose
  trusted workspace configuration contains capability ceilings must supply
  them to every point-of-use evaluation; omitting a configured ceiling is a
  fail-closed input-correlation error. The v1 compatibility shape is usable
  only on an explicitly identified legacy/test path with no configured
  ceiling, no required capability-aware semantics, and an explicit consumer
  declaration; a legacy consumer must never silently accept a capability-
  aware input it cannot evaluate. Mixed interface versions fail closed
  unless a reviewed conversion rule exists; canonical evaluation-input
  identities include the interface version, so v1 and v2 inputs never share
  an identity. WP-6 owns implementation and conformance migration; Artifact
  Core remains long-term owner of evaluation semantics; WP-4 remains the
  committed numeric-only baseline. It is not a replacement of the
  numeric-only model.

Evaluation order (normative): (1) capability authorization by the five-set
intersection; (2) numeric ceilings further narrow already-authorized
actions; (3) numeric ceilings never grant a capability; (4) capability
presence never bypasses numeric limits. WP-5B consumes the validated
`EligibilityReport` and never recomputes the intersection.

## Numeric Ceiling Semantics (F-07)

For every numeric ceiling type (`globalActionCeiling`,
`workspaceActionCeiling`, grant `max-actions`):

- **Unit:** counted actions of the limited operation class.
- **Integer domain:** non-negative safe integers (`Number.isSafeInteger`),
  minimum `0`, maximum `Number.MAX_SAFE_INTEGER`.
- **Zero:** denies the limited action quantity (zero allowed actions).
- **Missing (optional):** no additional quantitative restriction from that
  operand — never permission; the capability must still be independently
  authorized by the five-set intersection.
- **Overflow/unsafe values:** values above `Number.MAX_SAFE_INTEGER` fail
  closed during trusted-config loading.
- **Malformed values:** fractional, negative, infinite, NaN, non-numeric,
  or overflowed values fail closed during trusted-config loading; there is
  no arithmetic wraparound.
- **Canonical representation:** plain decimal safe-integer form; no
  exponential notation; no Infinity sentinel. An explicit unlimited
  sentinel, if ever needed, must be defined by a reviewed contract change
  rather than by omission or `Infinity`.
- **Intersection:** the applicable limit is the minimum of the finite
  ceilings (global, workspace, grant) that are present.

## Workspace Identity and Root Uniqueness (F-EL1)

- Every workspace identifier must map to exactly one workspace record.
- Duplicate workspace identifiers are malformed configuration; duplicate
  identifiers fail the **entire** trusted configuration load. Duplicate
  resolution by first-wins, last-wins, merge, or load order is prohibited.
- Canonical-root comparison applies after the contract's required
  normalization and resolution steps:
  1. exact duplicate canonical roots are prohibited unless a future
     reviewed aliasing contract explicitly permits them;
  2. parent-child or otherwise overlapping workspace roots are prohibited
     in v1;
  3. overlap ambiguity fails the entire trusted configuration load;
  4. a root must not contain another registered root;
  5. symlink-resolved overlap must be checked, not only lexical overlap;
  6. case-folding ambiguity on the supported host lane fails closed;
  7. no first-match or longest-prefix routing is permitted.
- The v1 prohibition prevents one filesystem object from receiving
  different workspace ceilings depending on lookup order.

## Non-Existent Paths and Rename Containment (F-EL2)

**Non-existent destination paths.** A path that does not yet exist is
contained when: (1) the nearest existing ancestor resolves under the
trusted workspace root; (2) that existing ancestor resolves within the
trusted root; (3) only validated remaining path components are lexically
appended; (4) `..`, absolute resets, empty ambiguous components, or
normalization that escapes the root are rejected; (5) any existing
intermediate symlink that resolves outside the root is rejected; (6)
containment is revalidated at the actual later filesystem operation; (7)
the WP-6 decision is prospective and does not eliminate TOCTOU risk; (8)
WP-7 or WP-11 performs point-of-use filesystem revalidation for actual
read or write operations.

**Rename or move.** A rename or move is contained only when: (1) the source
is independently contained; (2) the destination is independently contained;
(3) the source exists and resolves inside the trusted root; (4) the
destination's existing ancestor resolves inside the same trusted root; (5)
neither endpoint crosses workspace roots; (6) both endpoints belong to the
same workspace identity unless a later reviewed cross-workspace operation
contract exists; (7) any ambiguity fails closed.

WP-6 defines and returns these containment decisions. WP-11 owns the later
controlled mutation and point-of-use race handling.

## Candidate-Path Trust Classification and Phase Slicing (Phase 2A)

Narrow clarification adopted with the Phase-2A implementation:

- Candidate paths are **untrusted workspace-relative request data** (WP-0
  remote-producer zone): ChatGPT/MCP requests, prompts, generated content,
  repository content, artifact content, and project-visible documents are
  never trusted configuration and never select or infer a local root.
- The primary Phase-2A request protocol accepts workspace-relative paths
  only; absolute request paths (POSIX, Windows drive, UNC) are rejected.
  The candidate path is combined with the trusted canonical workspace root
  only inside the trusted process using a reviewed POSIX component
  algorithm.
- Phase 2A covers existing-path containment decisions only (read/inspect
  purposes, prospective, point-of-use revalidation required). It performs
  no filesystem operation and grants no authority.
- File deletion and generic mutations (generic write, create, overwrite,
  rename, move, source-code editing) are outside the MVP per WP-0 and
  ADR-001/004 and are not containment operation classes.
- Phase 2B (artifact-draft destination containment) remains blocked until a
  trusted artifact location is authoritative and identity-bound (an
  additive, separately reviewed configuration prerequisite); a workspace
  root is not an artifact location.

## Runtime Genuineness and Whole-Filesystem Root Prohibition (F-2A-01/F-2A-02)

Narrow security corrections adopted with the Phase-2A security correction:

- Only a runtime-genuine configuration produced by a successful Phase-1
  validation may provide workspace roots to later trusted consumers
  (containment evaluation, workspace lookup). Genuineness is represented by
  a module-private runtime brand (accepted WeakSet pattern); structural
  lookalikes, clones, spreads, JSON round-trips, Proxy wrappers, and
  correct-digest imitations are not validated configurations and are
  rejected fail closed.
- The canonical workspace root `/` is prohibited. A configured workspace
  must represent a bounded local project; `/` represents the complete host
  filesystem and violates explicit-project scoping and the prohibition on
  generic filesystem access. The prohibition derives from the global
  project/generic-filesystem product ceiling and applies even when `/` is
  supplied by a trusted local administrator (trusted local configuration is
  constrained by the product ceiling). Rejection occurs after final
  canonical resolution: literal `/`, repeated separators, lexical forms
  normalizing to `/`, resolver output `/`, and symlinked or aliased
  configured roots resolving to `/` all fail the entire trusted
  configuration load.
- Candidate paths remain untrusted; Phase 2A remains existing-path-only;
  Phase 2B remains blocked.

## Trusted Artifact-Location Configuration (Phase 2B-P)

Narrow normative addition adopted with the Phase-2B-P implementation
(authoritative with the explicit version-2 configuration protocol):

- Trusted configuration version `2` extends each workspace record with one
  optional `artifactLocation` field containing a configured absolute
  trusted-local path (plain string). Version 1 remains accepted,
  byte-identical in identity, and unchanged in behavior; version-1 input
  carrying the version-2 field fails strict unknown-field rejection; no
  implicit migration and no workspace-root fallback exist.
- Artifact-location cardinality is zero or one per version-2 workspace;
  omission means no artifact-draft persistence location and grants no write
  authority; omission and presence produce different canonical projections.
- The configured artifact location is resolved exactly once through an
  injected trusted ArtifactLocationResolver (the configuration core
  performs no filesystem I/O). Successful validation proves the final
  canonical target exists at validation time and is a directory; regular
  files, sockets, FIFOs, devices, unknown entry types, broken links, loops,
  inaccessible, ambiguous, and generic resolution errors fail closed.
- The final canonical artifact directory must be a strict component-boundary
  descendant of the canonical workspace root (equality prohibited), must
  not be `/`, and must not resolve outside the workspace or under another
  registered workspace. Only the final canonical directory is stored and
  identity-bound.
- The default ChatGPT-facing draft-location scope is exactly four
  prospective draft aggregates: TaskSpec, AuthorityPolicy, ContextManifest,
  CompletionContract. ExecutionBundle (derived/reference composition
  aggregate) is not automatically a ChatGPT-authored draft and receives no
  storage or persistence contract here; ExecutionResult (retrospective
  execution output) is not a draft, is not TrustedReceipt, and receives no
  storage or persistence contract here.
- The configured directory is not write authority: it defines only the
  region in which validated structured drafts of the four prospective draft
  aggregates may later be considered for persistence (Phase 2B/WP-11);
  destination containment, nearest-existing-ancestor handling, persistence,
  and point-of-use race handling remain outside this prerequisite.
- ArtifactLocationResolver evidence boundary (correction F-2BP-FR-01): the
  resolver implementation is trusted, but its return value is STRICT tagged
  protocol evidence that is descriptor-captured exactly once — protocol-
  field getters and accessors are never invoked, Proxy `get` traps never
  fire for protocol values, prototype-inherited fields are not accepted,
  unknown fields and malformed tags fail closed, and malformed evidence
  fails closed with a typed configuration finding; no exception escapes
  for ordinary malformed evidence. The Phase-1 RootPathResolver contract is
  unaffected.

## Prospective Artifact-Draft Destination Containment (Phase 2B)

Narrow normative addition adopted with the Phase-2B implementation
(authoritative with the explicit Phase-2B destination-containment protocol):

- A prospective artifact-draft destination request is UNTRUSTED
  artifact-root-relative request data (one or more non-empty components,
  single `/` separators, Unicode accepted without normalization). Empty,
  `.`, `..`, absolute (leading slash), Windows drive, UNC, backslash,
  repeated or trailing separators, NUL, prohibited control characters, and
  empty components are rejected; destination equality with the artifact root
  is structurally impossible. A fixed documented maximum request size bound
  applies before any resolver invocation. Unlike the Phase-2A workspace-
  relative grammar, `..` is rejected outright (no bounded pops) per F-EL2.
- Alias model (Model B, alias-aware resolution): the authoritative committed
  contract — F-EL2 (non-existent destination paths: the nearest existing
  ancestor resolves within the trusted root; only validated remaining
  components are lexically appended; any existing intermediate symlink that
  resolves outside the root is rejected) and the Path Resolution and
  Containment Rules (a path is contained if and only if its fully resolved
  absolute form is within the resolved root) — requires intermediate
  ancestor symlinks to be resolved, not rejected. Phase 2B therefore
  separates the LEXICAL request prefix (whose entry exists and resolves to a
  directory) from the CANONICAL existing directory ancestor (the resolved
  form of that prefix). The lexical-to-canonical correlation is trusted host
  evidence supplied by the injected ProspectiveDestinationResolver; the pure
  core verifies structural correlation (exact prefix, exact tail,
  prefix-plus-tail equals the request, root canonical correlation, ancestor
  canonical containment, exact entry-kind literals, target-state/tail
  consistency) and never claims core-side proof of alias resolution. The
  core never requires `canonical ancestor + lexical tail == lexical absolute
  destination` (invalid across aliases). A zero-length lexical prefix means
  the ancestor is the artifact root itself.
- The resolver is a dedicated trusted injected boundary (distinct from
  RootPathResolver, ExistingPathResolver, and ArtifactLocationResolver). It
  receives exactly one internally constructed request (protocol version,
  configuration-bound canonical artifact root, derived absolute prospective
  destination) and returns one strict success or failure record. Success
  evidence is one exact eight-own-key observed-state record: current
  canonical artifact root, artifact-root entry kind `directory`, lexical
  existing-directory prefix components, canonical existing directory
  ancestor, existing-ancestor entry kind `directory`, destination tail
  components, and target state (`missing`, `existing-file`,
  `existing-directory`, `existing-symlink`, `dangling-symlink`,
  `unsupported-kind`). Failure evidence is one exact three-own-key
  subject-aware record (`artifact-root` | `existing-ancestor` |
  `final-target` | `resolution` plus a closed code vocabulary with a
  documented subject/code compatibility table). Evidence is descriptor-
  captured exactly once under the F-2BP-FR-01 requirements (no getters, zero
  Proxy `get`, accessors/inherited/symbols/non-enumerable/unsupported
  prototypes/unknown fields rejected, traps and revoked Proxies converted to
  typed findings, no escaping exception, exactly one invocation).
- Artifact-root freshness: Phase 2B revalidates the configuration-bound
  canonical artifact-root path (never the raw alias discarded by Phase-2B-P)
  at evaluation time; the observed current canonical root must exactly equal
  the configuration-bound root, the root entry kind must be `directory`, and
  the canonical existing directory ancestor must equal the root or lie
  strictly beneath it at a component boundary. A deleted, non-directory,
  redirected, or differently resolving root fails closed. Replacement at the
  same canonical path remains subject to immediate point-of-use
  revalidation.
- Existing-target policy: only a `missing` final target may produce a
  prospective containment decision (create-only MVP). Every existing final
  target — regular file, directory, symlink, dangling symlink, or
  unsupported kind — is rejected with a deterministic finding; no overwrite
  authority is created by detecting an existing state. An existing final
  symlink is never treated as missing and never becomes the directory
  ancestor.
- The decision is prospective trusted-process containment data: it grants no
  write, overwrite, persistence, approval, RuntimeGrant, or execution
  authority and contains no timestamp or freshness duration. It binds the
  destination-containment protocol version, operation class
  (`artifact-draft-destination`), purpose
  (`persist-validated-artifact-draft`), configuration identity, host lane,
  workspace ID, artifact kind, canonical artifact-relative destination,
  current canonical artifact root, lexical prefix, canonical ancestor,
  destination tail, target state `missing`, and the literal
  `pointOfUseRevalidationRequired: true` marker; identity uses the distinct
  domain `PGAP-TRUSTED-DESTINATION-v1\0`. Point-of-use revalidation by
  WP-11 immediately before any actual mutation remains mandatory; the
  decision does not prove that a later write is safe.
- Findings use the new TAD namespace (contiguous from TAD-001), deterministic
  ordering, static root-safe path-safe messages, and the documented 18-stage
  precedence (configuration genuineness, configuration version, workspace,
  artifact-location presence, expected configuration identity, artifact
  kind, request structure, destination grammar and size, resolver presence,
  resolver invocation, evidence capture and shape, artifact-root state,
  root canonical correlation, ancestor state, prefix/containment
  correlation, tail/target-state cross-validation, existing-target policy,
  decision identity). Descriptor-derived capture of the untrusted request is
  a SAFETY BOUNDARY PRE-STEP, not a semantic stage: it executes after the
  configuration genuineness and version gates and before any request-field
  read; if capture fails, TAD-007 is returned before any request-dependent
  semantic stage (workspace, artifact-location presence, expected identity,
  artifact kind, destination grammar) can be evaluated, and stages 3–8 are
  evaluated only against the detached captured snapshot, never the original
  caller object. Failure yields no decision and no decision identity; the
  resolver is invoked zero times before the resolver stage and exactly once
  when reached.

## Supported WP-6 Host Lane (F-EL3)

Initial WP-6 supported lane: **Linux; x86_64; POSIX-style filesystem
semantics; UTF-8 locale; Node.js 22.x, with the verified project lane at
Node 22.23.2**; path comparisons and case behavior as observed on the
supported Linux filesystem lane. macOS, Windows, case-insensitive
filesystems, network filesystems, and non-POSIX path semantics are
**unverified**; unverified host lanes fail compatibility eligibility unless
separately reviewed. The contract does not claim host-independent
filesystem guarantees have been proven. Exact patch-level Node pinning may
remain an implementation-plan decision if API behavior is unchanged; the
major lane is explicit here. No package dependency is added.

## TrustedWorkspaceConfiguration Classification (F-EL4)

`TrustedWorkspaceConfiguration` is:

- a trusted-local control-plane configuration object;
- repository-external;
- schema-governed or type-governed within the local gateway
  implementation;
- prospective configuration input.

It is **not**: one of the six Artifact Core aggregates; an artifact kind; a
lifecycle record; an approval record; a RuntimeGrant; an ExecutionResult; a
TrustedReceipt.

WP-6 must not add a seventh Artifact Core aggregate, add a new artifact
kind, or alter the WP-3 artifact schema catalog for this object, unless a
later explicit architecture decision authorizes that change. If a
machine-readable schema is used, it is a **local configuration schema
outside the Artifact Core aggregate catalog**.

## Runtime-Input Hardening Invariant (F-EL5)

WP-6 must reuse the established WP-4 and WP-5A descriptor-derived snapshot
pattern for accepted runtime JavaScript objects:

1. protocol-significant properties are captured exactly once;
2. ordinary getters are not invoked;
3. Proxy `get` traps are not used for protocol-significant reads;
4. property descriptors or another reviewed hook-resistant mechanism are
   used;
5. structural introspection failures produce typed fail-closed findings;
6. captured snapshots are deeply immutable;
7. caller containers are not reread after snapshot construction;
8. later caller or Proxy mutation cannot change configuration identity,
   workspace lookup, ceilings, trustedExtensionSet, containment inputs,
   PointOfUseInputs v2 contents, or findings already produced;
9. deterministic guarantees are scoped consistently with the WP-5A
   stable/plain-input rule for intentionally stateful structural Proxies;
10. hostile-input tests cover getters, Proxy traps,
    mutation-after-validation, descriptor changes, cyclic values, and
    unsupported prototypes.
11. object capture performs one structural key-enumeration pass in which
    every listed own string key must carry exactly one own data property
    descriptor: a listed key whose descriptor lookup returns `undefined`, a
    listed non-enumerable own string property, and a listed accessor
    property each fail closed as typed structural failures; a listed key is
    never silently omitted (silent omission of an advertised restrictive
    field such as a capability or numeric ceiling would widen effective
    authority and would collapse identity into the identity of a genuinely
    absent field).

This invariant is assigned to WP-6 implementation and security tests.

## Configuration Validation Contract — Normative Additions

Adopted by the externally granted Phase-1 correction authorization (WP-6
Phase 1 security remediation, decisions 1–10) and recorded here as
authoritative implementation rules for the trusted configuration core.

### Strict Unknown-Field Policy (correction F-4)

- Unknown fields are malformed configuration. Recursive strict-shape
  validation is required at every object layer: top-level configuration,
  provenance, workspace records, capability-ceiling containers, numeric
  ceiling containers, trustedExtensionSet, web-access declarations,
  expected tool-source declarations, and any other protocol object.
- Misspelled or future fields must not be silently ignored; a misspelled
  field can silently remove an intended restriction, which is a
  fail-open-adjacent configuration hazard.
- Version evolution requires an explicitly accepted configuration version;
  future fields are not an upgrade signal.
- No later consumer may interpret a field that was omitted from validation
  and identity.
- Symbol keys are not representable in the canonical JSON input contract
  and fail closed at the snapshot boundary.
- Unknown-field failure is typed and deterministic (TCF-025).

### Root Resolver Requirement (correction F-2)

- Trusted production validation requires an injected `RootPathResolver`;
  the resolver is the only host-boundary abstraction of the I/O-free core.
- No lexical-only input may produce a validated configuration; a missing
  resolver fails closed with a dedicated finding (TCF-026).
- Every accepted workspace root must have a resolver result, and resolver
  results are lexically recanonicalized. Broken paths, loops, thrown
  errors, malformed results, and relative or outside-lane results fail
  closed (TCF-008).
- Duplicate and overlap evaluation always uses resolved canonical roots;
  the accepted validated model contains no unresolved-validation mode;
  configuration identity binds resolved canonical roots. No
  identity-invisible lexical-only downgrade exists.

### Trusted Host-Lane Operand (correction F-7)

- Validation requires an explicit trusted host-lane compatibility operand
  (`hostLane`). The core never ambiently probes the host: no `process`,
  environment-variable, path, or runtime-global reads.
- Only the accepted lane value (`linux-x86_64-posix-utf8-node22`,
  corresponding to Linux x86_64, POSIX-style filesystem semantics, UTF-8
  locale, Node.js 22.x per F-EL3) can produce a validated configuration.
  Missing (TCF-027) and unsupported (TCF-028) lanes fail closed before any
  input handling; unsupported lanes fail before identity calculation.
- The accepted lane is bound into the validated configuration, the
  canonical identity projection, and the identity digest, and the resolver
  contract is interpreted under that lane.

### Root Secrecy Boundary (correction F-5)

- Raw canonical roots are trusted-process internal data. They are never
  MCP, ChatGPT, user-facing, or package-root API output; later external
  projections must use opaque workspace identity only.
- Any root-bearing internal object requires an explicit trusted-process
  boundary; the package root exposes no trusted configuration runtime API
  and no root-bearing types.
- Findings, public digest strings, and opaque workspace identifiers never
  disclose roots; canonical bytes stay local to identity computation and
  are not returned through the validated runtime result.
