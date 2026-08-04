# WP-3 Open Decisions

## Focused Correction Pass (Resolved)

The focused review findings were resolved without architecture change:

- External `$ref` values are absolute schema URNs matching cataloged `$id` values; fragment-only references are resource-local; catalog paths are packaging only; standard Draft 2020-12 resolution succeeds offline (verified with an installed Ajv 8.20.0 Draft 2020-12 validator).
- `expected_schema_id` entries now name the exact schema of each single-subject fixture (or explicit `null` for raw, canonical-input, schema-selection, graph, and vector fixtures).
- Later-phase failure fixtures pass all earlier structural phases first; graph subjects are individually schema-valid; namespace collision is a semantic `REG-003` failure and migration lifecycle transfer is an invalid trusted graph, each with a preserved structural counterpart.
- Every rule retains passing and failing coverage; digest vectors recompute exactly; raw inputs fail at the declared raw/canonical-input phase.

## Final Dependency-Metadata Correction (Resolved)

The remaining dependency-metadata findings were resolved without schema, fixture, or rule changes:

- Fixture-manifest `dependencies` values are canonical fixture IDs only: the seven path-valued values were replaced with their canonical base-fixture IDs, all entries are unique, sorted, self-free, and acyclic, and every target exists in the manifest.
- Schema catalog `dependencies` lists are exact direct external `$ref` base-URN sets: all 51 resources were recomputed from the schema documents (14 lifecycle record entries corrected), with fragments removed, transitive references excluded, no paths, and every target cataloged.
- Executable verification (Ajv 8.20.0 Draft 2020-12) passes all schema compilation, structural, later-phase, workflow-subject, rule-coverage, and digest-vector checks.

No unresolved WP-3 schema or conformance decisions.
