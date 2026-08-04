# Trusted Workspace and Ceiling Configuration Contract (Planning Draft)

**Status:** Planning draft — not approved. Defines the contract only; no
configuration loader is implemented. Resolves the trusted-configuration
portion of F-SEQ-1. Normative ownership decision: ADR-024. Cross-references:
`capability-vocabulary.md`, `post-wp5a-roadmap.md` (WP-6, WP-8, WP-12),
`project-gateway-scope-and-principles.md` (WP-0), ADR-002, ADR-003.

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
