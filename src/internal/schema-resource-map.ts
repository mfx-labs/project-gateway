/**
 * Implementation-owned schema-resource selection for `SCH-*` schema-resource
 * fixtures (Correction 4A).
 *
 * The schema execution target is resolved independently of the manifest's
 * `expected_schema_id`:
 * - the fixture path is mapped to the local catalog schema resource through
 *   this implementation-owned table;
 * - for the two shared fixture paths that legitimately cover two different
 *   schema resources (the `identifier-instance` string is covered by both
 *   `artifact-instance-id` and `identifiers`), the subject-type label is used
 *   as fixture metadata separate from the expected outcome;
 * - `expected_schema_id` is read only by the comparison step, never to choose
 *   the schema, so mutating it produces a mismatch.
 */
import { SCHEMA_CATALOG } from '../generated/schema-bundle.js';

/** Fixture path → catalog schema resource (implementation-owned). */
const SCHEMA_RESOURCE_BY_FIXTURE: Readonly<Record<string, string>> = Object.freeze({
  'fixtures/schema-resources/invalid/activation-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:activation-record',
  'fixtures/schema-resources/invalid/annotations.json': 'urn:project-gateway:schema:artifact:1.0:common:annotations',
  'fixtures/schema-resources/invalid/approval-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:approval-record',
  'fixtures/schema-resources/invalid/artifact-envelope.json': 'urn:project-gateway:schema:artifact:1.0:common:artifact-envelope',
  'fixtures/schema-resources/invalid/authoritative-audit-event.json': 'urn:project-gateway:schema:lifecycle:1.0:records:authoritative-audit-event',
  'fixtures/schema-resources/invalid/authority-policy.json': 'urn:project-gateway:schema:artifact:1.0:kinds:authority-policy',
  'fixtures/schema-resources/invalid/bundle-body.json': 'urn:project-gateway:schema:artifact:1.0:kinds:execution-bundle-body',
  'fixtures/schema-resources/invalid/compatibility.json': 'urn:project-gateway:schema:registry:1.0:protocol-kind-compatibility-declaration',
  'fixtures/schema-resources/invalid/completion-body.json': 'urn:project-gateway:schema:artifact:1.0:kinds:completion-contract-body',
  'fixtures/schema-resources/invalid/completion-contract.json': 'urn:project-gateway:schema:artifact:1.0:kinds:completion-contract',
  'fixtures/schema-resources/invalid/context-body.json': 'urn:project-gateway:schema:artifact:1.0:kinds:context-manifest-body',
  'fixtures/schema-resources/invalid/context-manifest.json': 'urn:project-gateway:schema:artifact:1.0:kinds:context-manifest',
  'fixtures/schema-resources/invalid/deprecation.json': 'urn:project-gateway:schema:registry:1.0:deprecation-declaration',
  'fixtures/schema-resources/invalid/digest-string.json': 'urn:project-gateway:schema:artifact:1.0:common:digest-string',
  'fixtures/schema-resources/invalid/evidence-reference.json': 'urn:project-gateway:schema:artifact:1.0:common:evidence-reference',
  'fixtures/schema-resources/invalid/exact-artifact-reference.json': 'urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference',
  'fixtures/schema-resources/invalid/execution-attempt-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:execution-attempt-record',
  'fixtures/schema-resources/invalid/execution-bundle.json': 'urn:project-gateway:schema:artifact:1.0:kinds:execution-bundle',
  'fixtures/schema-resources/invalid/execution-occurrence-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:execution-occurrence-record',
  'fixtures/schema-resources/invalid/execution-result.json': 'urn:project-gateway:schema:artifact:1.0:kinds:execution-result',
  'fixtures/schema-resources/invalid/execution-summary-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:execution-summary-record',
  'fixtures/schema-resources/invalid/extension-contract.json': 'urn:project-gateway:schema:registry:1.0:extension-contract-entry',
  'fixtures/schema-resources/invalid/extension-declaration.json': 'urn:project-gateway:schema:artifact:1.0:common:extension-declaration',
  'fixtures/schema-resources/invalid/feature-registration.json': 'urn:project-gateway:schema:registry:1.0:feature-capability-registration',
  'fixtures/schema-resources/invalid/governance-review.json': 'urn:project-gateway:schema:registry:1.0:governance-security-review',
  'fixtures/schema-resources/invalid/issuance-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:issuance-record',
  'fixtures/schema-resources/invalid/kind-descriptor.json': 'urn:project-gateway:schema:artifact:1.0:common:kind-descriptor',
  'fixtures/schema-resources/invalid/lifecycle-header.json': 'urn:project-gateway:schema:lifecycle:1.0:common:components',
  'fixtures/schema-resources/invalid/migration-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:migration-record',
  'fixtures/schema-resources/invalid/namespace-entry.json': 'urn:project-gateway:schema:registry:1.0:registry-namespace-entry',
  'fixtures/schema-resources/invalid/policy-body.json': 'urn:project-gateway:schema:artifact:1.0:kinds:authority-policy-body',
  'fixtures/schema-resources/invalid/protocol-descriptor.json': 'urn:project-gateway:schema:artifact:1.0:common:protocol-descriptor',
  'fixtures/schema-resources/invalid/registered-requirement.json': 'urn:project-gateway:schema:artifact:1.0:common:registered-requirement',
  'fixtures/schema-resources/invalid/registry-snapshot-reference.json': 'urn:project-gateway:schema:registry:1.0:registry-snapshot-reference',
  'fixtures/schema-resources/invalid/registry-snapshot.json': 'urn:project-gateway:schema:registry:1.0:registry-snapshot',
  'fixtures/schema-resources/invalid/registry-supersession.json': 'urn:project-gateway:schema:registry:1.0:supersession-declaration',
  'fixtures/schema-resources/invalid/requirements.json': 'urn:project-gateway:schema:artifact:1.0:common:requirements',
  'fixtures/schema-resources/invalid/result-body.json': 'urn:project-gateway:schema:artifact:1.0:kinds:execution-result-body',
  'fixtures/schema-resources/invalid/result-publication-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:result-publication-record',
  'fixtures/schema-resources/invalid/revision-descriptor.json': 'urn:project-gateway:schema:artifact:1.0:common:revision-descriptor',
  'fixtures/schema-resources/invalid/revocation-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:revocation-record',
  'fixtures/schema-resources/invalid/runtime-grant.json': 'urn:project-gateway:schema:lifecycle:1.0:records:runtime-grant',
  'fixtures/schema-resources/invalid/supersession-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:supersession-record',
  'fixtures/schema-resources/invalid/task-body.json': 'urn:project-gateway:schema:artifact:1.0:kinds:task-spec-body',
  'fixtures/schema-resources/invalid/task-spec.json': 'urn:project-gateway:schema:artifact:1.0:kinds:task-spec',
  'fixtures/schema-resources/invalid/trusted-receipt.json': 'urn:project-gateway:schema:lifecycle:1.0:records:trusted-receipt',
  'fixtures/schema-resources/invalid/utc-timestamp.json': 'urn:project-gateway:schema:artifact:1.0:common:utc-timestamp',
  'fixtures/schema-resources/invalid/validation-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:validation-record',
  'fixtures/schema-resources/invalid/workspace-binding.json': 'urn:project-gateway:schema:artifact:1.0:common:workspace-binding',
  'fixtures/schema-resources/valid/activation-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:activation-record',
  'fixtures/schema-resources/valid/annotations.json': 'urn:project-gateway:schema:artifact:1.0:common:annotations',
  'fixtures/schema-resources/valid/approval-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:approval-record',
  'fixtures/schema-resources/valid/artifact-envelope.json': 'urn:project-gateway:schema:artifact:1.0:common:artifact-envelope',
  'fixtures/schema-resources/valid/authoritative-audit-event.json': 'urn:project-gateway:schema:lifecycle:1.0:records:authoritative-audit-event',
  'fixtures/schema-resources/valid/authority-policy.json': 'urn:project-gateway:schema:artifact:1.0:kinds:authority-policy',
  'fixtures/schema-resources/valid/bundle-body.json': 'urn:project-gateway:schema:artifact:1.0:kinds:execution-bundle-body',
  'fixtures/schema-resources/valid/compatibility.json': 'urn:project-gateway:schema:registry:1.0:protocol-kind-compatibility-declaration',
  'fixtures/schema-resources/valid/completion-body.json': 'urn:project-gateway:schema:artifact:1.0:kinds:completion-contract-body',
  'fixtures/schema-resources/valid/completion-contract.json': 'urn:project-gateway:schema:artifact:1.0:kinds:completion-contract',
  'fixtures/schema-resources/valid/context-body.json': 'urn:project-gateway:schema:artifact:1.0:kinds:context-manifest-body',
  'fixtures/schema-resources/valid/context-manifest.json': 'urn:project-gateway:schema:artifact:1.0:kinds:context-manifest',
  'fixtures/schema-resources/valid/deprecation.json': 'urn:project-gateway:schema:registry:1.0:deprecation-declaration',
  'fixtures/schema-resources/valid/digest-string.json': 'urn:project-gateway:schema:artifact:1.0:common:digest-string',
  'fixtures/schema-resources/valid/evidence-reference.json': 'urn:project-gateway:schema:artifact:1.0:common:evidence-reference',
  'fixtures/schema-resources/valid/exact-artifact-reference.json': 'urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference',
  'fixtures/schema-resources/valid/execution-attempt-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:execution-attempt-record',
  'fixtures/schema-resources/valid/execution-bundle.json': 'urn:project-gateway:schema:artifact:1.0:kinds:execution-bundle',
  'fixtures/schema-resources/valid/execution-occurrence-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:execution-occurrence-record',
  'fixtures/schema-resources/valid/execution-result.json': 'urn:project-gateway:schema:artifact:1.0:kinds:execution-result',
  'fixtures/schema-resources/valid/execution-summary-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:execution-summary-record',
  'fixtures/schema-resources/valid/extension-contract.json': 'urn:project-gateway:schema:registry:1.0:extension-contract-entry',
  'fixtures/schema-resources/valid/extension-declaration.json': 'urn:project-gateway:schema:artifact:1.0:common:extension-declaration',
  'fixtures/schema-resources/valid/feature-registration.json': 'urn:project-gateway:schema:registry:1.0:feature-capability-registration',
  'fixtures/schema-resources/valid/governance-review.json': 'urn:project-gateway:schema:registry:1.0:governance-security-review',
  'fixtures/schema-resources/valid/issuance-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:issuance-record',
  'fixtures/schema-resources/valid/kind-descriptor.json': 'urn:project-gateway:schema:artifact:1.0:common:kind-descriptor',
  'fixtures/schema-resources/valid/lifecycle-header.json': 'urn:project-gateway:schema:lifecycle:1.0:common:components',
  'fixtures/schema-resources/valid/migration-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:migration-record',
  'fixtures/schema-resources/valid/namespace-entry.json': 'urn:project-gateway:schema:registry:1.0:registry-namespace-entry',
  'fixtures/schema-resources/valid/policy-body.json': 'urn:project-gateway:schema:artifact:1.0:kinds:authority-policy-body',
  'fixtures/schema-resources/valid/protocol-descriptor.json': 'urn:project-gateway:schema:artifact:1.0:common:protocol-descriptor',
  'fixtures/schema-resources/valid/registered-requirement.json': 'urn:project-gateway:schema:artifact:1.0:common:registered-requirement',
  'fixtures/schema-resources/valid/registry-snapshot-reference.json': 'urn:project-gateway:schema:registry:1.0:registry-snapshot-reference',
  'fixtures/schema-resources/valid/registry-snapshot.json': 'urn:project-gateway:schema:registry:1.0:registry-snapshot',
  'fixtures/schema-resources/valid/registry-supersession.json': 'urn:project-gateway:schema:registry:1.0:supersession-declaration',
  'fixtures/schema-resources/valid/requirements.json': 'urn:project-gateway:schema:artifact:1.0:common:requirements',
  'fixtures/schema-resources/valid/result-body.json': 'urn:project-gateway:schema:artifact:1.0:kinds:execution-result-body',
  'fixtures/schema-resources/valid/result-publication-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:result-publication-record',
  'fixtures/schema-resources/valid/revision-descriptor.json': 'urn:project-gateway:schema:artifact:1.0:common:revision-descriptor',
  'fixtures/schema-resources/valid/revocation-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:revocation-record',
  'fixtures/schema-resources/valid/runtime-grant.json': 'urn:project-gateway:schema:lifecycle:1.0:records:runtime-grant',
  'fixtures/schema-resources/valid/supersession-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:supersession-record',
  'fixtures/schema-resources/valid/task-body.json': 'urn:project-gateway:schema:artifact:1.0:kinds:task-spec-body',
  'fixtures/schema-resources/valid/task-spec.json': 'urn:project-gateway:schema:artifact:1.0:kinds:task-spec',
  'fixtures/schema-resources/valid/trusted-receipt.json': 'urn:project-gateway:schema:lifecycle:1.0:records:trusted-receipt',
  'fixtures/schema-resources/valid/utc-timestamp.json': 'urn:project-gateway:schema:artifact:1.0:common:utc-timestamp',
  'fixtures/schema-resources/valid/validation-record.json': 'urn:project-gateway:schema:lifecycle:1.0:records:validation-record',
  'fixtures/schema-resources/valid/workspace-binding.json': 'urn:project-gateway:schema:artifact:1.0:common:workspace-binding',
});

/**
 * Shared fixture paths covered by two schema resources; disambiguated by the
 * entry's subject-type label (fixture metadata separate from expected outcome).
 */
const SHARED_FIXTURE_SUBJECTS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  'fixtures/schema-resources/invalid/identifier-instance.json': Object.freeze({
    'artifact instance ID': 'urn:project-gateway:schema:artifact:1.0:common:artifact-instance-id',
    identifier: 'urn:project-gateway:schema:artifact:1.0:common:identifiers',
  }),
  'fixtures/schema-resources/valid/identifier-instance.json': Object.freeze({
    'artifact instance ID': 'urn:project-gateway:schema:artifact:1.0:common:artifact-instance-id',
    identifier: 'urn:project-gateway:schema:artifact:1.0:common:identifiers',
  }),
});

const CATALOG_IDS: ReadonlySet<string> = new Set(
  (SCHEMA_CATALOG as unknown as { schema_resources: { schema_id: string }[] }).schema_resources.map((e) => e.schema_id),
);

/** Resolve the schema resource for a schema-resource fixture (or undefined). */
export function schemaResourceForFixture(fixturePath: string, subjectType: string): string | undefined {
  const shared = SHARED_FIXTURE_SUBJECTS[fixturePath];
  if (shared !== undefined) {
    return shared[subjectType];
  }
  return SCHEMA_RESOURCE_BY_FIXTURE[fixturePath];
}

/** Implementation-owned guard: every mapped resource must exist in the catalog. */
export function assertSchemaResourceMapIntegrity(): void {
  for (const id of Object.values(SCHEMA_RESOURCE_BY_FIXTURE)) {
    if (!CATALOG_IDS.has(id)) throw new Error(`schema-resource map references unknown catalog schema: ${id}`);
  }
  for (const table of Object.values(SHARED_FIXTURE_SUBJECTS)) {
    for (const id of Object.values(table)) {
      if (!CATALOG_IDS.has(id)) throw new Error(`schema-resource map references unknown catalog schema: ${id}`);
    }
  }
}
