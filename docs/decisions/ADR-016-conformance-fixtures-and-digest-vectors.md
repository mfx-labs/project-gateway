# ADR-016 — Conformance Fixtures and Digest Vectors

## Status

Accepted

## Context

Future Artifact Core work needs reproducible proof that independent implementations make the same structural, semantic, canonicalization, registry, reference, lifecycle, and result-publication decisions. Filename-based tests and placeholder digests would not establish a protocol conformance contract.

## Decision

WP-3 establishes `fixtures/` as a normative manifest-driven corpus that is an executable oracle, not descriptive metadata. `fixtures/manifest.json` assigns every test stable fixture ID, path(s), subject type, validation phase (the actual first failing phase), expected pass/fail, exact schema ID where a single-subject schema applies (otherwise explicit `null` for raw inputs, canonical-input failures, schema-selection failures, multi-subject graphs, and vectors), semantic rule IDs, failure category, dependencies, exact registry context where applicable, notes, and normative status. Manifest dependencies are stable fixture IDs that are executable evaluation prerequisites: they must exist in the same manifest, must be unique and canonically ordered within an entry, must not use paths or inferred filename relationships, must not name the dependent entry itself, and must form a valid deterministic acyclic graph.

The corpus includes valid/invalid artifacts, registry snapshots, lifecycle records, exact-reference graphs, workflows, raw malformed inputs, schema-resource coverage, and canonicalization vectors. Every single-subject manifest entry names the schema that actually applies to its subject; graph and workflow entries never declare an arbitrary single schema. Later-phase failure fixtures pass all earlier structural phases first, and individual graph subjects are schema-valid before relationships and trusted state are rejected. Raw malformed/duplicate/unpaired-surrogate inputs are retained as literal `.json.raw` files.

Digest vectors contain actual canonical UTF-8 text/projections and actual domain-separated SHA-256 values. Artifact vectors use `PGAP-ARTIFACT-REVISION-v1\u0000`; registry vectors use `PGAP-REGISTRY-SNAPSHOT-v1\u0000`. The values were calculated by an external temporary standard-library tool and independently cross-checked with installed SHA-256 utilities over stored canonical text plus the exact domain prefix. No calculation implementation is committed.

Every schema resource has passing/failing coverage, and every semantic rule has manifest-driven passing/failing coverage. Fixture changes that alter outcomes, digest values, dependency graphs, rule mappings, or canonical bytes require reviewed protocol evolution.

## Rationale

A stable manifest prevents test runners from guessing outcomes from filenames and allows the same corpus to test independent future implementations. Raw inputs preserve parser-boundary security cases. Actual vectors make canonicalization/domain separation testable rather than descriptive.

## Consequences

- Test runners must use the manifest as the source of expected behavior.
- A runner must not normalize, repair, reserialize, or infer raw malformed inputs before testing them.
- Vector and workflow outcomes are protocol contract, not implementation-specific tests.
- A future schema/semantic change must update catalog, fixtures, vectors, and compatibility/migration documentation consistently.
- The corpus remains data only and does not introduce a validator, hashing library, storage, evaluator, adapter, or runtime implementation.

## Rejected Alternatives

1. **Placeholder or self-asserted digest values:** Rejected because they do not test canonicalization or domain separation.
2. **Directory-name-driven test behavior:** Rejected because test semantics must be stable even when files move.
3. **Parseable substitutes for malformed input:** Rejected because they lose duplicate-key and raw Unicode failure conditions.
4. **Only unit-like schema examples:** Rejected because protocol correctness also depends on cross-artifact, lifecycle, registry, and point-of-use graphs.
5. **Commit a production calculator/validator with fixtures:** Rejected because WP-3 is a conformance package, not an implementation work package.
