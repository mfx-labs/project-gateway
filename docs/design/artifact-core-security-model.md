# Artifact Core Security Model

**Status:** Normative WP-4 design
**Applies to:** all production modules

## Untrusted Input

All artifact, registry, lifecycle, and reference content is untrusted project
data. No input can create trusted state: validation never approves, issues,
grants, activates, publishes, establishes evaluator provenance, registers a
workspace, or creates a receipt.

## Duplicate-Key Threat

A purpose-built scanner rejects duplicate object members at every depth before
any ordinary object construction. First-wins, last-wins, and permissive parser
behavior are prohibited. The scanner also enforces byte limits, nesting limits,
valid UTF-8, and unpaired-surrogate rejection before `JSON.parse` is invoked on
the now-safe text.

## Unicode Threat

Digest-covered strings must already be NFC; non-NFC input is rejected and never
silently normalized or repaired. Unpaired surrogate escapes and raw surrogate
bytes are rejected at intake. The canonical serializer emits valid UTF-8 only.

## Resource Exhaustion

Input byte limits (artifact 1 MiB, registry 512 KiB, lifecycle 256 KiB) and a
32-level nesting limit come from the WP-3 profile. Traversal is bounded; the
scanner is iterative per container and recursion depth is capped.

## Prototype Pollution

Parsed models are constructed via `JSON.parse` on scanned-safe text and are
accessed with own-property iteration. Prototype-looking keys (`__proto__`,
`constructor`) are inert: the security suite verifies no pollution occurs and
that the library introduces no new protocol rejection rules for them.

## Schema Substitution

Schema selection uses only approved discriminators (protocol id/version,
canonicalization, kind, record type, registry format). Producer-controlled
`$schema` values, paths, labels, and network sources never select a schema. The
catalog registry registers all 51 resources by exact `$id`; external `$ref`
values are absolute URNs resolved offline under standard Draft 2020-12 rules.
Network schema retrieval is structurally impossible (the validator's loader
throws).

## Resolver Substitution

Exact-reference resolution treats resolver output as untrusted: the returned
subject is revalidated through the full structural, canonical, and digest
pipeline, and every reference field (protocol version, kind, instance, revision,
digest, workspace binding) is compared. Paths, aliases, `latest`, Git
revisions, queries, partial digests, and fallback lists are never resolvable.

## Registry Substitution

Registry evaluation binds the exact accepted snapshot ID and digest. Unknown or
unaccepted snapshots, unregistered namespaces, unsupported required extensions,
and unsafe optional contracts fail closed. Repository or artifact content can
never create registry authority.

## Surrogate Repair Threat

The raw scanner validates UTF-16 code units before UTF-8 encoding for
caller-provided strings, so `TextEncoder` can never silently replace a lone
surrogate with U+FFFD; bytes are decoded strictly with fatal errors. Valid
escaped surrogate pairs and literal supplementary characters are accepted and
produce the same accepted value. No normalization, repair, replacement, or
recombination of invalid input ever occurs.

## Caller Reference Mutation

Validated wrappers own deep immutable snapshots; no nested reference is shared
with caller input, and later caller mutation cannot alter the validated model,
canonical bytes, digest, or findings.

## Oracle Contamination

The conformance runner never copies expected rule IDs, categories, phases, or
schema IDs from the manifest into actual findings. Actual findings come from
implementation-owned evaluators and the structural-enforcement mapping; the
manifest is read only for comparison, and altered expectations produce
mismatches. Schema-resource fixtures resolve their execution target from an
implementation-owned fixture-path → catalog mapping, never from
`expected_schema_id`; canonical-vector entries produce an actual evaluation
object that is compared (never trusted) — a mutated expected digest, rule ID,
category, phase, or pass/fail produces a mismatch.

## Insertion-Order-Dependent Equality

JSON object member insertion order is not semantically significant, and
ordinary `JSON.stringify` is never used as a protocol equality mechanism.
Workspace bindings, exact artifact references, and bundle references are
compared by explicit protocol fields through the authoritative comparators in
`src/internal/protocol-equality.ts`, so semantically identical values with
reordered members cannot produce false REF-005/WSP-003/WSP-005/LIN-007/MIG-001/
EXE-006 findings, while genuine protocol differences still deny. Comparators
read only own data properties of plain JSON objects (accessors never invoked,
inherited properties never consulted) and fail closed on missing or
structurally invalid fields.

## Ignored Authority Input Threat

Point-of-use evaluation uses every supplied decision input (requested use,
revocations, workspace, identity, resolver, registry, lifecycle, ceilings,
policy, grant, consumer support). No decision-critical input is silently
ignored; missing required dependencies fail closed.

## Missing-Grant False Allow

Point-of-use evaluation begins from the exact verified `ExecutionBundle` and
its exact lifecycle chain. A missing `RuntimeGrant` (or a grant bound to
another bundle or workspace) fails closed, as does missing validation,
approval, issuance, or activation state. Empty lifecycle state can never yield
eligibility.

## Unrelated-Record False Deny

Only lifecycle records related to the exact bundle revision, the exact four
member revisions, the accepted registry context, the exact `RuntimeGrant`, and
the requested workspace are evaluated. An unrelated revoked approval, revoked
grant, or workspace-scoped record never affects the result; revocations apply
only to related revocable records, and historical fact records are never
revocable.

## Validation-Level Escalation

A wrapper's `level` records exactly the phases that executed. The pipeline
stops at the requested `through` phase and never labels a subject
`registry-compatible` without actual registry evaluation or
`point-of-use-eligible` without actual point-of-use evaluation; missing
registry inputs fail closed. `isLevelAtLeast` rejects lower-level wrappers
where higher-level wrappers are required.

## Forgeable Symbol Marker

Runtime branding is module-private `WeakSet` membership: no brand symbol,
string property, exported token, or global symbol exists on a wrapper, so
`Object.getOwnPropertySymbols(wrapper)` reveals no brand capability and a
spread, clone, proxy, or forged lookalike is never a member. Membership is
valid only within the physical module instance that created the wrapper.

## Global Traversal-State Contamination

Snapshot traversal state (recursion stack, completed set, depth) is local to
each top-level `snapshotJson()` call and cleaned up with `try/finally`; no
module-global WeakMap or WeakSet holds traversal state. A failed nested
traversal cannot contaminate the same input on a later call, another input,
another library instance, or concurrent/reentrant calls. Repeated acyclic
shared references are accepted and materialized as independent immutable JSON
subtrees; true cycles are rejected deterministically.

## Resolver Substitution and Schema Bypass

Resolver output is untrusted and fully revalidated; handwritten shape guards
are never authoritative (the exact-reference schema is the validator), and
workspace-binding comparison is semantic rather than serialization-order
dependent.

## Hidden I/O Prohibition

Production modules import only `node:crypto` and the embedded generated bundles.
The security test suite scans compiled output for `node:fs`, `node:net`,
`node:http`, `node:https`, `node:child_process`, `fetch`, `process.env`, and
`Date.now` and fails if any appears in protocol code. Time-dependent decisions
use caller-injected time exclusively.

## Lifecycle-Authority Boundary

Validation results are conformance reports only. The library never persists
lifecycle state, never creates records, never mutates use counts, and never
claims that trusted state has been persisted. Approval, issuance, grant,
activation, occurrence, receipt, publication, and point-of-use evaluation are
pure functions over caller-supplied records and state views.
