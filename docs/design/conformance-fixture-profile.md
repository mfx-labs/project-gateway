# Project Gateway MCP — Conformance Fixture Profile

**Status:** Normative WP-3 fixture profile
**Manifest:** `fixtures/manifest.json`

## Purpose

The fixture corpus is a normative, deterministic, implementation-independent conformance resource for the WP-3 schema and validation contract. A conforming future Artifact Core, validator, canonicalizer, lifecycle verifier, or registry resolver must use the manifest as the test oracle rather than infer behavior from directory names, filenames, parser behavior, or incidental JSON presentation.

Fixtures are test data only. They do not constitute trusted workspace configuration, an actual registry service, approval, issuance, grant, activation, receipt, evaluator, or runtime implementation.

## Fixture Layout

```text
fixtures/
  manifest.json
  artifacts/
    valid/
    invalid/
  registry/
    valid/
    invalid/
  lifecycle/
    valid/
    invalid/
  canonicalization/
    artifact/
    registry/
  references/
    valid/
    invalid/
  workflows/
    valid/
    invalid/
  schema-resources/
    valid/
    invalid/
```

The required roots separate subject classes and expected purpose. `schema-resources/` provides direct passing/failing coverage for reusable schema resources; it never replaces the complete artifact, registry, lifecycle, reference, or workflow corpus.

## Manifest Contract

`fixtures/manifest.json` is JSON with stable fixture IDs sorted lexicographically. Every entry contains all of these members:

| Member | Meaning |
| --- | --- |
| `fixture_id` | Stable, unique, filename-independent identifier. |
| `paths` | One or more repository-relative raw/JSON fixture paths. |
| `subject_type` | Artifact kind, registry/lifecycle/reference subject, raw input, vector, workflow, or schema component. |
| `validation_phase` | First phase expected to determine the stated outcome, from the normative pipeline: `raw-json-intake`, `canonical-input-validation`, `schema-identification`, `structural-schema-validation`, `canonicalization-and-digest-verification`, `identity-registration`, `semantic-self-validation`, `exact-reference-resolution`, `cross-artifact-compatibility`, `registry-compatibility` (registry-subject semantics: `semantic-registry-validation`), `trusted-lifecycle-verification`, `consumer-support-verification`, `point-of-use-eligibility`. A fixture declared at a later phase MUST pass every earlier required phase first. |
| `expected_result` | Exactly `pass` or `fail`. |
| `expected_schema_id` | Exact local cataloged URN of the schema that actually applies to the single-subject input (complete artifact-kind schema, exact record schema, registry subject schema, or exact-reference schema), otherwise explicit `null` (raw inputs, canonical-input failures, schema-selection failures, multi-subject graphs/workflows, vectors). A multi-subject graph MUST NOT declare an arbitrary single schema. |
| `expected_semantic_rule_ids` | Applicable stable conformance rule IDs; may be empty only for direct schema-resource coverage with no semantic assertion. |
| `expected_failure_category` | Stable failure category for `fail`, otherwise explicit `null`. |
| `dependencies` | Canonical fixture IDs that must be available before evaluation; dependencies are evaluation prerequisites, never schema resources, paths, rule IDs, or labels. Values must exactly match existing `fixture_id` values, must be unique within the entry, must be sorted in ascending fixture-ID order, must not name the entry itself, and must form an acyclic graph. A fixture path remains only in the entry’s `paths` field and is never repeated as dependency identity. |
| `registry_snapshot_reference` | Exact required registry context where applicable, otherwise explicit `null`. |
| `notes` | Non-authoritative explanation only. |
| `normative` | Always `true` for the V1 corpus. |

Every physical fixture input is represented directly by an entry or as an explicitly named source input of a vector entry. Rule coverage entries reuse exact underlying paths intentionally: one artifact can demonstrate multiple independent invariants under distinct fixture IDs without changing the subject. When one physical fixture supports several rule entries, each mapped rule must genuinely be exercised by the fixture’s primary failure reason; the expected first failing phase and rule set are explicit in every entry. A `RULE-*` entry inherits the exact schema of its base fixture and agrees with it.

## Naming and Determinism

- Fixture IDs are stable and unique. A filename rename does not change semantics or fixture ID.
- File content uses fixed opaque-looking deterministic test identifiers so expected references and digests are reproducible; the identifier pattern test is not an entropy test.
- Fixture paths use lower-case descriptive names. Directory placement is explanatory only; manifest outcome controls.
- Arrays that are set-like in protocol content are serialized in canonical order in valid fixtures. Negative order/duplicate cases are named explicitly.
- Every security-sensitive schema constraint has a targeted failure input where safely representable. The corpus avoids broad failures with several unrelated primary causes.

## Raw Invalid Inputs

Malformed JSON, duplicate-key JSON, and unpaired-surrogate JSON are intentionally stored as `.json.raw`. A runner MUST feed their literal bytes into phase 1. It MUST NOT parse them with a permissive parser, construct an equivalent in-memory object, normalize them, or reserialize them before asserting the expected failure.

Non-NFC fixtures remain parseable JSON where needed so phase 2 can demonstrate rejection of the original accepted parsed model. The expected outcome is rejection, never normalization.

## Artifact Corpus

For every core kind, the corpus includes a minimal valid genesis revision, representative valid optional content, a valid successor, explicit empty requirements/extensions, and a valid registered-extension form. The corpus exercises portable `TaskSpec`/`CompletionContract` use and bound-only policy/context/bundle/result use.

Bundle fixtures point to actual fixture artifacts through full digest-pinned references. Result fixtures point to an actual fixture bundle and fixed occurrence/attempt identities. They remain project-visible content; trusted evaluator ownership is tested only through lifecycle/publication fixtures.

Invalid artifact/reference fixtures cover malformed syntax, duplicate members, Unicode/NFC, safe integer limits, envelope shape, identifiers, annotations, extensions, digest mismatch, identity collision, lineage, binding continuity, aliases, resolution mismatch, fallback, circular graph, responsibility boundaries, and result correlation.

## Registry Corpus

Registry fixtures exercise the separate `RegistrySnapshot` shape, exact snapshot reference, governance review, namespace/contract registration, feature/capability registration, digest assertion, namespace collision, unsafe optional semantics, non-NFC data, and duplicate members. Namespace collision is a semantic failure: two structurally distinct entries register the same namespace/version with conflicting authoritative contract properties and fail `REG-003` at `semantic-registry-validation`; a separate duplicate-item fixture covers the schema `uniqueItems` structural rejection.

The V1 registry fixture contains the closed `project-gateway.conformance-tag` and `example.review-evidence` optional ignore-safe test extensions. They are conformance profile entries, not producer-controlled registry semantics. The invalid unsafe-optional snapshot is deliberately not accepted for trusted use.

## Canonicalization and Digest Vectors

Each vector records, as applicable:

- source raw JSON or fixture paths;
- accepted parsed data model or explicit rejection expectation;
- canonical projection;
- exact canonical UTF-8 text;
- digest domain;
- actual expected SHA-256 hexadecimal value and serialized digest; and
- applicable rule IDs.

Artifact vectors cover object-key ordering, exclusion of `annotations` and `revision.digest`, ordered arrays, safe integer boundary, NFC acceptance/rejection, duplicate-key rejection, canonical-content changes, annotation-only digest stability, and artifact-domain separation.

Registry vectors cover exact snapshot projection, snapshot ID inclusion, canonical namespace ordering, namespace/registration content change, NFC/duplicate-key rejection, registry-domain separation, and distinction from artifact hashing.

Expected values were computed with a temporary standard-library Python calculation tool outside the repository. The input set for computed canonical-byte vectors intentionally uses safe integers and strings for which `json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)` is equivalent to RFC 8785 JCS. It prepended the exact UTF-8 domain bytes including NUL, then used SHA-256. Critical digests are independently checked from their stored canonical UTF-8 text with `openssl dgst -sha256` or `sha256sum` over the domain-prefixed bytes. The temporary calculator is not committed and is not production canonicalization code.

## Reference and Workflow Fixtures

Reference fixtures cover exact genesis/successor references, portable task/contract selection by bound bundle, matching policy/context, result-to-bundle reference, path/Git/latest/partial-digest rejection, wrong target elements, unresolved target, hidden fallback, binding mismatch, and cycle rejection.

Workflow fixtures are complete multi-record graphs, not status flags. Valid workflows cover:

1. validation, approval, and issuance;
2. four-member plus bundle lifecycle;
3. accepted activation, occurrence, attempt, and receipt;
4. ordered retry under one occurrence/grant;
5. candidate/result validation/publication/ordinary review/receipt-correlated privileged use;
6. result correction/supersession within one result instance; and
7. migration between exact generation-zero subjects without lifecycle transfer.

Invalid workflows cover lifecycle shortcuts, missing member issuance, revoked use, denied activation reuse, occurrence/attempt violations, retry substitution, result conflict, missing registry context, missing privileged receipt correlation, migration-as-lineage, and lifecycle transfer. The lifecycle-transfer workflow is a five-subject graph: old artifact, new generation-zero artifact, valid `MigrationRecord`, old-subject approval, and an issuance that attempts to reuse the old approval for the new subject; every subject is individually schema-valid and the graph fails trusted lifecycle validation because migration never transfers authority.

## Test-Runner Obligations

A conformance runner MUST:

1. parse the manifest before selecting a fixture;
2. use literal raw bytes for `.json.raw` inputs;
3. load schema resources only from the local catalog and resolve every `$ref` offline;
4. apply the structural/semantic phase order exactly;
5. verify the stated schema ID before asserting a schema outcome;
6. load all dependency fixture IDs before cross-subject validation;
7. use the exact declared registry snapshot reference where present;
8. compare actual pass/fail, failure category, and applicable rule IDs to the manifest;
9. recompute canonical projections/digests rather than trust a fixture assertion;
10. treat a fixture expected to fail as non-consumable even when an ordinary parser can inspect it;
11. reject a manifest entry when the observed first failing phase differs from the declared phase; and
12. verify every subject of a graph/workflow fixture passes its individual schema before evaluating relationships or trusted state.

A runner must not silently fix input, select a nearby schema/version/snapshot, infer a target from a filename, or turn a candidate result/evidence link into trusted state.

## Structural Enforcement of Semantic Rules

The V1 schemas are closed contracts. Where a closed schema eliminates every representable form of a rule’s violation (for example an unknown member, an enum restriction, or a binding-mode restriction), the rule’s fail fixture is declared at `structural-schema-validation` and the rule row in the semantic catalog records that structural phase. The rule remains cataloged because the same invariant also binds cross-subject, registry, lifecycle, and point-of-use evaluation at later phases. Structural closure fixtures and semantic responsibility fixtures are kept separate wherever both are valuable; the manifest is the executable oracle for which phase actually determines each outcome.

## Immutability and Evolution

Fixtures, vector outputs, and manifest outcomes are normative for V1. A change to an expected canonical byte sequence, digest, schema result, semantic outcome, fixture ID, dependency graph, or rule mapping changes the conformance contract and requires reviewed protocol/schema evolution. Additive fixtures may be added under a compatible reviewed contract, but an approved existing fixture must not be edited in place to hide a regression.
