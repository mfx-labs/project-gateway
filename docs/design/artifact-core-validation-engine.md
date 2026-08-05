# Artifact Core Validation Engine

**Status:** Normative WP-4 design
**Applies to:** `src/engine/`, `src/json/`, `src/canonical/`, `src/digest/`, `src/semantic/`, `src/lifecycle/`, `src/pointofuse/`, `src/conformance/`

## Phase Ordering

The engine executes the approved ordered pipeline. A failure in an earlier
required phase prevents all later authority-dependent use:

1. `raw-json-intake` — bounds, UTF-8, duplicate members, malformed JSON, Unicode;
2. `canonical-input-validation` — NFC, safe integers, timestamps, ambiguity;
3. `schema-identification` — exact discriminator-based schema selection;
4. `structural-schema-validation` — closed Draft 2020-12 contracts (Ajv 8.20.0,
   offline, `$id`-registered);
5. `canonicalization-and-digest-verification` — canonical set ordering, RFC 8785
   serialization, domain-separated SHA-256, derived-digest comparison;
6. `identity-registration` — proposed-registration conflict checks only;
7. `semantic-self-validation` — responsibility and natural-language checks;
8. `exact-reference-resolution` — resolver revalidation and field comparison;
9. `cross-artifact-compatibility` — bundle workspace, binding, and lineage checks;
10. `registry-compatibility` / `semantic-registry-validation` — snapshot and
    artifact/consumer registry semantics;
11. `trusted-lifecycle-verification` — lifecycle graph rules;
12. `consumer-support-verification` — support declarations (reserved for
    caller-driven use; not directly exercised by the corpus);
13. `point-of-use-eligibility` — current time, revocations, ceilings, and support.

## Explicit Phase Gates

`validateArtifactRevision` stops exactly at the requested `through` phase. The
pipeline never executes a later phase for an earlier gate and never labels a
subject beyond the phases it executed:

| `through` phase | Returned marker / wrapper level | Notes |
| --- | --- | --- |
| `canonical-input-validation` | report `level: canonical-input-valid` | stops immediately after canonical-input validation; no structural/semantic claim |
| `schema-identification` | report `level: canonical-input-valid` + `schemaId` | stops after schema selection |
| `structural-schema-validation` | wrapper `structural-valid` | stops after structural validation |
| `canonicalization-and-digest-verification` | wrapper `digest-verified` | stops after projection, serialization, digest calculation and verification |
| `identity-registration` | wrapper `digest-verified` | proposed-registration checks only; never mutates identity state |
| `semantic-self-validation` | wrapper `self-semantic-valid` | stops after self-semantic validation |
| `registry-compatibility` | wrapper `registry-compatible` | only after actual registry and consumer-support evaluation; missing registry inputs fail closed |
| later phases | highest executed level | later lifecycle/point-of-use levels are assigned only by their own entry points |

## Identity Modes

Phase 6 never mixes proposed registration with existing-registration
verification:

- `checkProposedRegistration(subject, identity)` detects instance reuse,
  revision reuse, digest conflicts, predecessor conflicts, and generation
  conflicts; it runs only when the `identity-registration` phase is explicitly
  requested and never mutates identity state.
- `verifyExistingRegistration(subject, identity)` confirms the instance exists,
  the revision exists and belongs to the instance, and the registered digest,
  generation, predecessor, and workspace binding match; it never rejects a
  valid already-registered genesis revision as new instance reuse and never
  registers.
- `validateArtifactForUse` uses existing-registration verification only and
  never runs proposed-registration conflict checks.

## Structural versus Semantic Execution

- Structural phases are implemented by the raw scanner, canonical-input checks,
  schema identification, and the offline validator registry.
- Semantic rules use stable IDs from `docs/design/semantic-validation-rules.md`.
  Rules whose violations the closed schemas eliminate are registered as
  structurally enforced: their earliest phase is satisfied by the structural
  rejection, and no impossible later-phase representation is executed.
- The semantic engine emits deterministic findings with stable categories and
  rule IDs, and never performs trusted lifecycle actions.

## Canonicalization and Digest Verification

- Artifact projection excludes only `annotations` and `revision.digest`; the
  artifact domain is `PGAP-ARTIFACT-REVISION-v1\0`.
- Registry projection excludes only `snapshot_digest`; the registry domain is
  `PGAP-REGISTRY-SNAPSHOT-v1\0`.
- RFC 8785 serialization sorts object keys by UTF-16 code units, uses shortest
  control-character escapes, emits safe integers only, and never reorders
  arrays. All 36 committed digest vectors (the WP-3 set plus the WP-6 Phase-3
  PointOfUse input/result vectors) are recomputed by the test suite and the
  conformance runner.

## Rule Dispatch

Every one of the 116 semantic rule IDs has an implementation-owned
classification: a real semantic evaluator, an explicit structural-enforcement
mapping (schema resource + validator keyword + path → rule IDs), a graph/
trusted-state evaluator, or a raw/canonical/pipeline enforcement. The dispatch
source is the registered rule table, never the conformance manifest. The
manifest supplies expected outcomes for comparison only.

## Structural-Enforcement Mapping

When a closed schema rejects a subject, rule IDs are derived from the schema
resource, the validator keyword, and the error path or offending property
(for example `unevaluatedProperties` with property `task_instruction` on the
AuthorityPolicy body maps to `AUT-004`; `enum` on `/target/record_type` maps to
`LFC-005`/`LFC-006`). This mapping is implementation-owned and documented in
`src/internal/structural-map.ts`.

## Actual-versus-Expected Conformance Separation

The runner produces actual success/failure, first failing phase, categories,
rule IDs, and schema IDs from implementation logic; expected values are read
only after execution for comparison. Altering any expected value (rule ID,
category, phase, schema ID, or pass/fail) produces a mismatch, and the altered
expected value is never emitted as an actual finding.

## Independent Schema-Resource Selection

Schema-resource (`SCH-*`) fixtures never use `expected_schema_id` to choose the
schema. The execution target is resolved from an implementation-owned
fixture-path → catalog mapping (`src/internal/schema-resource-map.ts`); the two
shared `identifier-instance` fixture paths are disambiguated by the entry's
subject-type label (fixture metadata separate from expected outcome).
`actualSchemaId` is produced from that resolution and compared against
`expected_schema_id` afterwards, so mutating `expected_schema_id` produces a
mismatch.

## Canonical-Vector Comparison

`evaluateVector()` returns an actual evaluation object: actual success/failure,
actual phase, actual category, actual rule IDs, actual canonical projection,
actual canonical UTF-8, actual digest, and actual rejection reason. Digest
vectors recompute every canonical text, serialized digest, and projection;
multi-model vectors assert canonical identity injectivity (distinct models
never collapse to one canonical identity); rejection vectors run the actual
raw/canonical/pipeline evaluators; source-model declared digests must
recompute. `RULE-*` vector entries (RULE-ART-008-FAIL/PASS,
RULE-REG-009-FAIL/PASS, RULE-SEC-001-PASS, RULE-SEC-002-PASS) are routed
through the same common comparison logic as all other entries; `CAN-*` entries
use the vector comparison (invariant violations always mismatch; rejection
vectors compare actual phase and category with the declared outcome). Rule IDs
on `CAN-*` entries are nominal coverage labels and are never emitted as actual
findings.

## Canonical Exclusion Traversal and Unicode Surrogates

Canonical-input validation excludes exactly the canonical projection: the
entire top-level `annotations` subtree and the `revision.digest` value for
artifacts, and the `snapshot_digest` value for registry snapshots, by structural
path. Nested members merely named `annotations` or `digest` remain digest
covered. Digest-covered object member names and values are NFC-checked.
Valid escaped surrogate pairs and literal supplementary characters are
accepted; isolated surrogates are rejected without replacement or repair; raw
JavaScript strings are scanned in UTF-16 code units before encoding so
`TextEncoder` can never silently substitute U+FFFD.

Rules dispatch by artifact kind, record type, and phase. The conformance runner
records for every manifest entry the observed first failing phase and compares
it with the declared phase; a `RULE-*` entry is satisfied when a finding at the
declared phase carries the entry's rule ID and a matching failure category.

## Protocol Equality

All protocol equality decisions (workspace binding, exact artifact reference,
ExecutionBundle reference) use the authoritative comparators in
`src/internal/protocol-equality.ts` — never ordinary `JSON.stringify`. This
covers cross-artifact member-binding compatibility (REF-005/WSP-003/WSP-005),
lineage binding continuity (LIN-007/MIG-001), and lifecycle retry bundle
stability (EXE-006). Semantically identical values with different member
insertion order compare equal; genuine protocol differences still produce the
approved findings with the approved rule IDs and failure categories.

## Graph Validation

Lifecycle graph evaluation operates over caller-supplied records: approval and
issuance separation, activation cardinality and denial terminality, occurrence
and attempt ordering, retry allowances and subject stability, receipt facts,
publication binding and competition, supersession, migration without lifecycle
transfer, and registry-context continuity. Findings are attributed only to the
records owned by the evaluated entry. Attempt-ordinal checks evaluate the valid
attempt context plus the entry's own attempts so invalid corpus variants cannot
pollute valid evaluations.

## Point-of-Use Evaluation

Pure evaluation over the exact verified `ExecutionBundle` and its exact trusted
lifecycle chain, with injected current time, ceilings, consumer support,
revocations, and records. It locates only records related to the exact bundle
revision, the four exact member revisions, the accepted registry context, the
exact `RuntimeGrant`, and the requested workspace; requires validation,
approval, issuance, and grant (plus activation or pre-activation state for the
requested operation); fails closed on missing lifecycle state or a missing
grant; enforces every grant `narrowed_constraint`; applies revocations only to
related revocable records; and sorts findings before choosing the first
failing phase. It never starts execution, mutates counts, creates grants or
activations, or claims persisted trusted state.

## Deterministic Reporting

Findings sort by phase, category, rule ID, subject identity, location, and
message key. Equal inputs with equal injected state produce byte-identical
reports. Reports never contain absolute filesystem paths or implementation
exception text.

## Conformance Execution

`ConformanceRunner` loads the embedded manifest and corpus, validates dependency
metadata, evaluates entries in deterministic order, executes only the phases
applicable to each declared outcome, and reports mismatches by fixture ID with a
stable reason. The committed corpus executes 587/587 entries with zero
mismatches.
