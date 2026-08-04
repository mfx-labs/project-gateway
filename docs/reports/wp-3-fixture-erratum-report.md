# WP-3 Fixture Erratum Report — Registry Digest Mismatch Fixture

## Committed WP-3 Baseline

- Branch: `main`; committed baseline HEAD:
  `1a7036692e1b0ca40a6ca5c6412302cc372f4137`
  (`feat: establish WP-3 schema conformance package`).
- Uncommitted at the time of this erratum: the WP-4 Artifact Core implementation
  (package, `src/**`, `tests/**`, WP-4 documents, ADR-017…019,
  `docs/reports/wp-4-implementation-report.md`, authorized glossary additions).

## Affected Fixture

`fixtures/lifecycle/invalid/approval-registry-digest-mismatch.json`

## Affected Manifest Entries

| Entry | Phase | Rule | Category |
| --- | --- | --- | --- |
| `LFC-I-190B087B` | `registry-compatibility` | `REG-008` | `REGISTRY-INCOMPATIBILITY` |
| `RULE-REG-008-FAIL` | `registry-compatibility` | `REG-008` | `REGISTRY-INCOMPATIBILITY` |

Both entries declare the invalid approval fixture as their subject and expect
failure at registry compatibility with `REG-008` and
`REGISTRY-INCOMPATIBILITY`.

## Exact Defect

The invalid fixture was byte-identical to the valid
`fixtures/lifecycle/valid/approval-task.json` except for its `record_id`. Its
`registry_snapshot_reference` used the same snapshot ID
(`pgw:g:3fb51a11f2b23ba8c171326cbba7eb64`) and the same digest as the accepted
snapshot (`sha-256:613112612ee7803db00c6e51826b3a63ee6ce6732b17c9b09ae8aff00db47c05`),
so it could not fail `REG-008` (registry-context continuity) under any
evaluation that accepts the valid approval. The earlier WP-3 correction pass had
regenerated this record with the standard snapshot reference, erasing the
intended mismatch.

## Exact One-Value Correction

`registry_snapshot_digest` changed from:

```text
sha-256:613112612ee7803db00c6e51826b3a63ee6ce6732b17c9b09ae8aff00db47c05
```

to:

```text
sha-256:613112612ee7803db00c6e51826b3a63ee6ce6732b17c9b09ae8aff00db47c04
```

Every other field of the fixture is preserved. The Git diff for the fixture
contains exactly one value change. The replacement digest retains the exact
`sha-256:` prefix, contains exactly 64 lowercase hexadecimal characters, differs
from the accepted snapshot digest, and is not used by any other committed
registry snapshot, reference, or record.

## Why the Previous Value Could Not Satisfy REG-008

`REG-008` requires every registry-dependent lifecycle decision to bind the exact
accepted registry context. With the previous value, the record's reference
matched the accepted snapshot exactly (ID and digest), so the record satisfied
the registry-context check and produced no finding. The corrected value keeps
the snapshot ID valid and the digest syntactically valid while making the
binding unequal to the accepted snapshot, so the record fails closed at registry
compatibility with `REG-008` and `REGISTRY-INCOMPATIBILITY`.

## Structural-Validation Result

The corrected fixture passes its exact schema
(`urn:project-gateway:schema:lifecycle:1.0:records:approval-record`) under
standard Draft 2020-12 validation (Ajv 8.20.0, offline `$id` registry). Raw
parsing, canonical-input checks, schema selection, and structural validation all
pass.

## First-Failing-Phase Result

The first failure occurs at `registry-compatibility` (phase 10):
`LFC-I-190B087B` and `RULE-REG-008-FAIL` both now pass their declared oracle
with `REG-008` and `REGISTRY-INCOMPATIBILITY`.

## Full WP-3 Audit Result

- Schema resources: 51/51 meta-validated and compiled under standard Draft
  2020-12 resolution (0 failures).
- Manifest entries: 531/531 conformance expectations pass.
- Semantic rule IDs: 114/114 retain PASS and FAIL coverage.
- Digest vectors: 19/19 recompute exactly.
- Manifest dependency audit: pass (0 path-valued, 0 missing, 0 cycles).
- Schema catalog dependency audit: pass (0 mismatches, 0 unresolved targets).
- Structural pass/fail checks: 204 pass / 96 fail as declared.
- First-failing-phase checks: all later-phase fixtures pass earlier phases.
- Workflow subjects: 59/59 individually schema-valid.
- Raw/canonical-input fixture phases: unchanged and passing.
- No schema, manifest entry, rule ID, phase, failure category, digest vector,
  or accepted registry snapshot changed.

## Git Diff Summary

- `fixtures/lifecycle/invalid/approval-registry-digest-mismatch.json`: one line
  changed (the digest value).
- No other WP-3 file changed.
- WP-4 uncommitted implementation remains untouched by this erratum.

## Statement

Human approval of this WP-3 fixture erratum is still required. The erratum
changes only the committed fixture value needed to represent its declared
`REG-008` failure; no protocol rule, schema, manifest expectation, or accepted
snapshot data was altered.
