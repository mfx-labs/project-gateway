// GENERATED FILE — do not edit. Regenerate with: npm run generate
// Source of truth: schemas/catalog.json and schemas/** (committed WP-3 package).
export const SCHEMA_CATALOG = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:project-gateway:schema:catalog:1.0:schema-catalog",
  "catalog_version": "1.0",
  "schema_resources": [
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:common:annotations",
      "path": "schemas/artifact/1.0/common/annotations.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "artifact presentation annotations",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:common:artifact-envelope",
      "path": "schemas/artifact/1.0/common/artifact-envelope.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "complete common artifact envelope",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:annotations",
        "urn:project-gateway:schema:artifact:1.0:common:extension-declaration",
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:artifact:1.0:common:kind-descriptor",
        "urn:project-gateway:schema:artifact:1.0:common:protocol-descriptor",
        "urn:project-gateway:schema:artifact:1.0:common:requirements",
        "urn:project-gateway:schema:artifact:1.0:common:revision-descriptor",
        "urn:project-gateway:schema:artifact:1.0:common:workspace-binding",
        "urn:project-gateway:schema:artifact:1.0:kinds:authority-policy-body",
        "urn:project-gateway:schema:artifact:1.0:kinds:completion-contract-body",
        "urn:project-gateway:schema:artifact:1.0:kinds:context-manifest-body",
        "urn:project-gateway:schema:artifact:1.0:kinds:execution-bundle-body",
        "urn:project-gateway:schema:artifact:1.0:kinds:execution-result-body",
        "urn:project-gateway:schema:artifact:1.0:kinds:task-spec-body"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:common:artifact-instance-id",
      "path": "schemas/artifact/1.0/common/artifact-instance-id.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "artifact instance ID",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:common:digest-string",
      "path": "schemas/artifact/1.0/common/digest-string.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "digest string",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:common:evidence-reference",
      "path": "schemas/artifact/1.0/common/evidence-reference.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "bounded evidence reference",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference",
        "urn:project-gateway:schema:artifact:1.0:common:identifiers"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference",
      "path": "schemas/artifact/1.0/common/exact-artifact-reference.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "exact artifact reference",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:artifact:1.0:common:kind-descriptor",
        "urn:project-gateway:schema:artifact:1.0:common:workspace-binding"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:common:extension-declaration",
      "path": "schemas/artifact/1.0/common/extension-declaration.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "registered extension declaration",
      "dependencies": [],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:common:identifiers",
      "path": "schemas/artifact/1.0/common/identifiers.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "identifier",
      "dependencies": [],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:common:kind-descriptor",
      "path": "schemas/artifact/1.0/common/kind-descriptor.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "artifact kind descriptor",
      "dependencies": [],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:common:protocol-descriptor",
      "path": "schemas/artifact/1.0/common/protocol-descriptor.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "artifact protocol descriptor",
      "dependencies": [],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:common:registered-requirement",
      "path": "schemas/artifact/1.0/common/registered-requirement.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "registered feature or capability requirement",
      "dependencies": [],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:common:requirements",
      "path": "schemas/artifact/1.0/common/requirements.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "artifact requirements",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:registered-requirement"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:common:revision-descriptor",
      "path": "schemas/artifact/1.0/common/revision-descriptor.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "artifact revision descriptor",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference",
        "urn:project-gateway:schema:artifact:1.0:common:identifiers"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:common:utc-timestamp",
      "path": "schemas/artifact/1.0/common/utc-timestamp.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "normalized UTC timestamp string",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:common:workspace-binding",
      "path": "schemas/artifact/1.0/common/workspace-binding.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "workspace binding",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:kinds:authority-policy",
      "path": "schemas/artifact/1.0/kinds/authority-policy.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "complete AuthorityPolicy artifact",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:artifact-envelope"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:kinds:authority-policy-body",
      "path": "schemas/artifact/1.0/kinds/authority-policy-body.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "AuthorityPolicy body",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:artifact:1.0:common:registered-requirement"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:kinds:completion-contract",
      "path": "schemas/artifact/1.0/kinds/completion-contract.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "complete CompletionContract artifact",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:artifact-envelope"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:kinds:completion-contract-body",
      "path": "schemas/artifact/1.0/kinds/completion-contract-body.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "CompletionContract body",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:kinds:context-manifest",
      "path": "schemas/artifact/1.0/kinds/context-manifest.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "complete ContextManifest artifact",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:artifact-envelope"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:kinds:context-manifest-body",
      "path": "schemas/artifact/1.0/kinds/context-manifest-body.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "ContextManifest body",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference",
        "urn:project-gateway:schema:artifact:1.0:common:identifiers"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:kinds:execution-bundle",
      "path": "schemas/artifact/1.0/kinds/execution-bundle.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "complete ExecutionBundle artifact",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:artifact-envelope"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:kinds:execution-bundle-body",
      "path": "schemas/artifact/1.0/kinds/execution-bundle-body.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "ExecutionBundle body",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:kinds:execution-result",
      "path": "schemas/artifact/1.0/kinds/execution-result.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "complete ExecutionResult artifact",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:artifact-envelope"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:kinds:execution-result-body",
      "path": "schemas/artifact/1.0/kinds/execution-result-body.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "ExecutionResult body",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:evidence-reference",
        "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference",
        "urn:project-gateway:schema:artifact:1.0:common:identifiers"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:kinds:task-spec",
      "path": "schemas/artifact/1.0/kinds/task-spec.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "complete TaskSpec artifact",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:artifact-envelope"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:artifact:1.0:kinds:task-spec-body",
      "path": "schemas/artifact/1.0/kinds/task-spec-body.json",
      "profile": "artifact",
      "version": "1.0",
      "subject_type": "TaskSpec body",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:lifecycle:1.0:common:components",
      "path": "schemas/lifecycle/1.0/common/components.json",
      "profile": "lifecycle",
      "version": "1.0",
      "subject_type": "trusted lifecycle component header",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:artifact:1.0:common:kind-descriptor",
        "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:lifecycle:1.0:records:activation-record",
      "path": "schemas/lifecycle/1.0/records/activation-record.json",
      "profile": "lifecycle",
      "version": "1.0",
      "subject_type": "ActivationRecord",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference",
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:lifecycle:1.0:records:approval-record",
      "path": "schemas/lifecycle/1.0/records/approval-record.json",
      "profile": "lifecycle",
      "version": "1.0",
      "subject_type": "ApprovalRecord",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:artifact:1.0:common:requirements",
        "urn:project-gateway:schema:lifecycle:1.0:common:components",
        "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:lifecycle:1.0:records:authoritative-audit-event",
      "path": "schemas/lifecycle/1.0/records/authoritative-audit-event.json",
      "profile": "lifecycle",
      "version": "1.0",
      "subject_type": "AuthoritativeAuditEvent",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:lifecycle:1.0:records:execution-attempt-record",
      "path": "schemas/lifecycle/1.0/records/execution-attempt-record.json",
      "profile": "lifecycle",
      "version": "1.0",
      "subject_type": "ExecutionAttemptRecord",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference",
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:lifecycle:1.0:records:execution-outcome-record",
      "path": "schemas/lifecycle/1.0/records/execution-outcome-record.json",
      "profile": "lifecycle",
      "version": "1.0",
      "subject_type": "ExecutionOutcomeRecord",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference",
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:lifecycle:1.0:records:execution-occurrence-record",
      "path": "schemas/lifecycle/1.0/records/execution-occurrence-record.json",
      "profile": "lifecycle",
      "version": "1.0",
      "subject_type": "ExecutionOccurrenceRecord",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference",
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:lifecycle:1.0:records:execution-summary-record",
      "path": "schemas/lifecycle/1.0/records/execution-summary-record.json",
      "profile": "lifecycle",
      "version": "1.0",
      "subject_type": "ExecutionSummaryRecord",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:lifecycle:1.0:records:issuance-record",
      "path": "schemas/lifecycle/1.0/records/issuance-record.json",
      "profile": "lifecycle",
      "version": "1.0",
      "subject_type": "IssuanceRecord",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:lifecycle:1.0:common:components",
        "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:lifecycle:1.0:records:migration-record",
      "path": "schemas/lifecycle/1.0/records/migration-record.json",
      "profile": "lifecycle",
      "version": "1.0",
      "subject_type": "MigrationRecord",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:lifecycle:1.0:common:components",
        "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:lifecycle:1.0:records:result-publication-record",
      "path": "schemas/lifecycle/1.0/records/result-publication-record.json",
      "profile": "lifecycle",
      "version": "1.0",
      "subject_type": "ResultPublicationRecord",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference",
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:lifecycle:1.0:common:components",
        "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:lifecycle:1.0:records:revocation-record",
      "path": "schemas/lifecycle/1.0/records/revocation-record.json",
      "profile": "lifecycle",
      "version": "1.0",
      "subject_type": "RevocationRecord",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:lifecycle:1.0:records:runtime-grant",
      "path": "schemas/lifecycle/1.0/records/runtime-grant.json",
      "profile": "lifecycle",
      "version": "1.0",
      "subject_type": "RuntimeGrant",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference",
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:lifecycle:1.0:common:components",
        "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:lifecycle:1.0:records:supersession-record",
      "path": "schemas/lifecycle/1.0/records/supersession-record.json",
      "profile": "lifecycle",
      "version": "1.0",
      "subject_type": "SupersessionRecord",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:lifecycle:1.0:common:components",
        "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:lifecycle:1.0:records:trusted-receipt",
      "path": "schemas/lifecycle/1.0/records/trusted-receipt.json",
      "profile": "lifecycle",
      "version": "1.0",
      "subject_type": "TrustedReceipt",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:lifecycle:1.0:records:validation-record",
      "path": "schemas/lifecycle/1.0/records/validation-record.json",
      "profile": "lifecycle",
      "version": "1.0",
      "subject_type": "ValidationRecord",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:lifecycle:1.0:common:components",
        "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:registry:1.0:deprecation-declaration",
      "path": "schemas/registry/1.0/deprecation-declaration.json",
      "profile": "registry",
      "version": "1.0",
      "subject_type": "registry deprecation declaration",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:registry:1.0:extension-contract-entry",
      "path": "schemas/registry/1.0/extension-contract-entry.json",
      "profile": "registry",
      "version": "1.0",
      "subject_type": "registry extension contract entry",
      "dependencies": [
        "urn:project-gateway:schema:registry:1.0:deprecation-declaration",
        "urn:project-gateway:schema:registry:1.0:supersession-declaration"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:registry:1.0:feature-capability-registration",
      "path": "schemas/registry/1.0/feature-capability-registration.json",
      "profile": "registry",
      "version": "1.0",
      "subject_type": "registry feature/capability registration",
      "dependencies": [
        "urn:project-gateway:schema:registry:1.0:governance-security-review"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:registry:1.0:governance-security-review",
      "path": "schemas/registry/1.0/governance-security-review.json",
      "profile": "registry",
      "version": "1.0",
      "subject_type": "registry governance security review",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:registry:1.0:protocol-kind-compatibility-declaration",
      "path": "schemas/registry/1.0/protocol-kind-compatibility-declaration.json",
      "profile": "registry",
      "version": "1.0",
      "subject_type": "protocol/kind compatibility declaration",
      "dependencies": [],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:registry:1.0:registry-namespace-entry",
      "path": "schemas/registry/1.0/registry-namespace-entry.json",
      "profile": "registry",
      "version": "1.0",
      "subject_type": "registry namespace entry",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:registry:1.0:extension-contract-entry",
        "urn:project-gateway:schema:registry:1.0:governance-security-review"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:registry:1.0:registry-snapshot",
      "path": "schemas/registry/1.0/registry-snapshot.json",
      "profile": "registry",
      "version": "1.0",
      "subject_type": "RegistrySnapshot",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers",
        "urn:project-gateway:schema:registry:1.0:feature-capability-registration",
        "urn:project-gateway:schema:registry:1.0:governance-security-review",
        "urn:project-gateway:schema:registry:1.0:protocol-kind-compatibility-declaration",
        "urn:project-gateway:schema:registry:1.0:registry-namespace-entry"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference",
      "path": "schemas/registry/1.0/registry-snapshot-reference.json",
      "profile": "registry",
      "version": "1.0",
      "subject_type": "RegistrySnapshotReference",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers"
      ],
      "normative_status": "normative"
    },
    {
      "schema_id": "urn:project-gateway:schema:registry:1.0:supersession-declaration",
      "path": "schemas/registry/1.0/supersession-declaration.json",
      "profile": "registry",
      "version": "1.0",
      "subject_type": "registry supersession declaration",
      "dependencies": [
        "urn:project-gateway:schema:artifact:1.0:common:identifiers"
      ],
      "normative_status": "normative"
    }
  ]
} as const;

export const SCHEMA_DOCUMENTS: Record<string, unknown> = {
  "urn:project-gateway:schema:artifact:1.0:common:annotations": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:common:annotations",
    "title": "Non-canonical presentation annotations",
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 256
      },
      "description": {
        "type": "string",
        "minLength": 1,
        "maxLength": 4096
      },
      "labels": {
        "type": "array",
        "items": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9-]{0,63}$",
          "minLength": 1,
          "maxLength": 64
        },
        "uniqueItems": true,
        "maxItems": 16
      },
      "comments": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024
        },
        "maxItems": 16
      },
      "producer_attribution": {
        "type": "string",
        "minLength": 1,
        "maxLength": 256
      },
      "created_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:artifact:1.0:common:artifact-envelope": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:common:artifact-envelope",
    "title": "Complete V1 common artifact envelope with closed kind discrimination",
    "type": "object",
    "required": [
      "protocol",
      "kind",
      "instance_id",
      "revision",
      "workspace_binding",
      "requirements",
      "extensions",
      "body"
    ],
    "properties": {
      "protocol": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:protocol-descriptor"
      },
      "kind": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:kind-descriptor"
      },
      "instance_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/artifactInstanceId"
      },
      "revision": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:revision-descriptor"
      },
      "workspace_binding": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:workspace-binding"
      },
      "requirements": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:requirements"
      },
      "extensions": {
        "type": "array",
        "maxItems": 32,
        "uniqueItems": true,
        "items": {
          "$ref": "urn:project-gateway:schema:artifact:1.0:common:extension-declaration"
        }
      },
      "annotations": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:annotations"
      }
    },
    "oneOf": [
      {
        "properties": {
          "kind": {
            "type": "object",
            "required": [
              "id",
              "version"
            ],
            "properties": {
              "id": {
                "const": "TaskSpec"
              },
              "version": {
                "const": "1.0"
              }
            },
            "unevaluatedProperties": false
          },
          "workspace_binding": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:workspace-binding"
          },
          "body": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:kinds:task-spec-body"
          }
        }
      },
      {
        "properties": {
          "kind": {
            "type": "object",
            "required": [
              "id",
              "version"
            ],
            "properties": {
              "id": {
                "const": "AuthorityPolicy"
              },
              "version": {
                "const": "1.0"
              }
            },
            "unevaluatedProperties": false
          },
          "workspace_binding": {
            "type": "object",
            "required": [
              "mode",
              "workspace_id"
            ],
            "properties": {
              "mode": {
                "const": "bound"
              },
              "workspace_id": {
                "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/workspaceId"
              }
            },
            "unevaluatedProperties": false
          },
          "body": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:kinds:authority-policy-body"
          }
        }
      },
      {
        "properties": {
          "kind": {
            "type": "object",
            "required": [
              "id",
              "version"
            ],
            "properties": {
              "id": {
                "const": "ContextManifest"
              },
              "version": {
                "const": "1.0"
              }
            },
            "unevaluatedProperties": false
          },
          "workspace_binding": {
            "type": "object",
            "required": [
              "mode",
              "workspace_id"
            ],
            "properties": {
              "mode": {
                "const": "bound"
              },
              "workspace_id": {
                "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/workspaceId"
              }
            },
            "unevaluatedProperties": false
          },
          "body": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:kinds:context-manifest-body"
          }
        }
      },
      {
        "properties": {
          "kind": {
            "type": "object",
            "required": [
              "id",
              "version"
            ],
            "properties": {
              "id": {
                "const": "CompletionContract"
              },
              "version": {
                "const": "1.0"
              }
            },
            "unevaluatedProperties": false
          },
          "workspace_binding": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:workspace-binding"
          },
          "body": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:kinds:completion-contract-body"
          }
        }
      },
      {
        "properties": {
          "kind": {
            "type": "object",
            "required": [
              "id",
              "version"
            ],
            "properties": {
              "id": {
                "const": "ExecutionBundle"
              },
              "version": {
                "const": "1.0"
              }
            },
            "unevaluatedProperties": false
          },
          "workspace_binding": {
            "type": "object",
            "required": [
              "mode",
              "workspace_id"
            ],
            "properties": {
              "mode": {
                "const": "bound"
              },
              "workspace_id": {
                "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/workspaceId"
              }
            },
            "unevaluatedProperties": false
          },
          "body": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:kinds:execution-bundle-body"
          }
        }
      },
      {
        "properties": {
          "kind": {
            "type": "object",
            "required": [
              "id",
              "version"
            ],
            "properties": {
              "id": {
                "const": "ExecutionResult"
              },
              "version": {
                "const": "1.0"
              }
            },
            "unevaluatedProperties": false
          },
          "workspace_binding": {
            "type": "object",
            "required": [
              "mode",
              "workspace_id"
            ],
            "properties": {
              "mode": {
                "const": "bound"
              },
              "workspace_id": {
                "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/workspaceId"
              }
            },
            "unevaluatedProperties": false
          },
          "body": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:kinds:execution-result-body"
          }
        }
      }
    ],
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:artifact:1.0:common:artifact-instance-id": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:common:artifact-instance-id",
    "title": "Artifact instance ID",
    "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/artifactInstanceId"
  },
  "urn:project-gateway:schema:artifact:1.0:common:digest-string": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:common:digest-string",
    "title": "Serialized SHA-256 digest string",
    "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/digest"
  },
  "urn:project-gateway:schema:artifact:1.0:common:evidence-reference": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:common:evidence-reference",
    "title": "Bounded evidence reference with explicit trust class",
    "oneOf": [
      {
        "type": "object",
        "required": [
          "kind",
          "artifact"
        ],
        "properties": {
          "kind": {
            "const": "artifact-reference"
          },
          "artifact": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference"
          }
        },
        "unevaluatedProperties": false
      },
      {
        "type": "object",
        "required": [
          "kind",
          "receipt_record_id"
        ],
        "properties": {
          "kind": {
            "const": "trusted-receipt-reference"
          },
          "receipt_record_id": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
          }
        },
        "unevaluatedProperties": false
      },
      {
        "type": "object",
        "required": [
          "kind",
          "workspace_id",
          "resource_id",
          "content_digest",
          "observation_role"
        ],
        "properties": {
          "kind": {
            "const": "workspace-resource-observation"
          },
          "workspace_id": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/workspaceId"
          },
          "resource_id": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/selectorId"
          },
          "content_digest": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/digest"
          },
          "observation_role": {
            "enum": [
              "input",
              "output",
              "changed-resource",
              "evaluation-evidence"
            ]
          }
        },
        "unevaluatedProperties": false
      },
      {
        "type": "object",
        "required": [
          "kind",
          "evidence_id",
          "content_digest",
          "declared_media_type",
          "observation_role"
        ],
        "properties": {
          "kind": {
            "const": "external-evidence"
          },
          "evidence_id": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/evidenceId"
          },
          "content_digest": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/digest"
          },
          "declared_media_type": {
            "type": "string",
            "pattern": "^[a-z]+/[a-z0-9.+-]+$",
            "maxLength": 128
          },
          "observation_role": {
            "enum": [
              "input",
              "output",
              "evaluation-evidence"
            ]
          }
        },
        "unevaluatedProperties": false
      }
    ]
  },
  "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference",
    "title": "Exact artifact reference",
    "type": "object",
    "required": [
      "target_protocol_version",
      "target_kind",
      "target_instance_id",
      "target_revision_id",
      "target_digest",
      "target_workspace_binding"
    ],
    "properties": {
      "target_protocol_version": {
        "const": "1.0"
      },
      "target_kind": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:kind-descriptor"
      },
      "target_instance_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/artifactInstanceId"
      },
      "target_revision_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/revisionId"
      },
      "target_digest": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/digest"
      },
      "target_workspace_binding": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:workspace-binding"
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:artifact:1.0:common:extension-declaration": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:common:extension-declaration",
    "title": "Closed declarations for registry-recognized V1 extensions",
    "oneOf": [
      {
        "type": "object",
        "required": [
          "namespace",
          "version",
          "mode",
          "payload"
        ],
        "properties": {
          "namespace": {
            "const": "project-gateway.conformance-tag"
          },
          "version": {
            "const": "1.0"
          },
          "mode": {
            "enum": [
              "required",
              "optional"
            ]
          },
          "payload": {
            "type": "object",
            "required": [
              "tag",
              "classification"
            ],
            "properties": {
              "tag": {
                "type": "string",
                "pattern": "^[a-z][a-z0-9-]{0,63}$",
                "minLength": 1,
                "maxLength": 64
              },
              "classification": {
                "enum": [
                  "non-authoritative",
                  "fixture-only"
                ]
              }
            },
            "unevaluatedProperties": false
          }
        },
        "unevaluatedProperties": false
      },
      {
        "type": "object",
        "required": [
          "namespace",
          "version",
          "mode",
          "payload"
        ],
        "properties": {
          "namespace": {
            "const": "example.review-evidence"
          },
          "version": {
            "const": "1.0"
          },
          "mode": {
            "enum": [
              "required",
              "optional"
            ]
          },
          "payload": {
            "type": "object",
            "required": [
              "evidence_class",
              "summary"
            ],
            "properties": {
              "evidence_class": {
                "enum": [
                  "fixture-only"
                ]
              },
              "summary": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256
              }
            },
            "unevaluatedProperties": false
          }
        },
        "unevaluatedProperties": false
      }
    ]
  },
  "urn:project-gateway:schema:artifact:1.0:common:identifiers": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:common:identifiers",
    "title": "Project Gateway identifier and scalar syntax set",
    "description": "A reusable closed scalar set. Opaque fixture values are deterministic only for reproducible tests.",
    "oneOf": [
      {
        "$ref": "#/$defs/artifactInstanceId"
      },
      {
        "$ref": "#/$defs/revisionId"
      },
      {
        "$ref": "#/$defs/workspaceId"
      },
      {
        "$ref": "#/$defs/registrySnapshotId"
      },
      {
        "$ref": "#/$defs/lifecycleRecordId"
      },
      {
        "$ref": "#/$defs/occurrenceId"
      },
      {
        "$ref": "#/$defs/attemptId"
      },
      {
        "$ref": "#/$defs/selectorId"
      },
      {
        "$ref": "#/$defs/evidenceId"
      },
      {
        "$ref": "#/$defs/evaluatorId"
      },
      {
        "$ref": "#/$defs/capabilityProfileId"
      },
      {
        "$ref": "#/$defs/governanceReviewId"
      },
      {
        "$ref": "#/$defs/digest"
      },
      {
        "$ref": "#/$defs/version"
      },
      {
        "$ref": "#/$defs/timestamp"
      }
    ],
    "$defs": {
      "artifactInstanceId": {
        "type": "string",
        "pattern": "^pgw:i:[0-9a-f]{32}$"
      },
      "revisionId": {
        "type": "string",
        "pattern": "^pgw:r:[0-9a-f]{32}$"
      },
      "workspaceId": {
        "type": "string",
        "pattern": "^pgw:w:[0-9a-f]{32}$"
      },
      "registrySnapshotId": {
        "type": "string",
        "pattern": "^pgw:g:[0-9a-f]{32}$"
      },
      "lifecycleRecordId": {
        "type": "string",
        "pattern": "^pgw:l:[0-9a-f]{32}$"
      },
      "occurrenceId": {
        "type": "string",
        "pattern": "^pgw:o:[0-9a-f]{32}$"
      },
      "attemptId": {
        "type": "string",
        "pattern": "^pgw:a:[0-9a-f]{32}$"
      },
      "selectorId": {
        "type": "string",
        "pattern": "^pgw:s:[0-9a-f]{32}$"
      },
      "evidenceId": {
        "type": "string",
        "pattern": "^pgw:e:[0-9a-f]{32}$"
      },
      "evaluatorId": {
        "type": "string",
        "pattern": "^pgw:ev:[0-9a-f]{32}$"
      },
      "capabilityProfileId": {
        "type": "string",
        "pattern": "^pgw:cp:[0-9a-f]{32}$"
      },
      "governanceReviewId": {
        "type": "string",
        "pattern": "^pgw:gr:[0-9a-f]{32}$"
      },
      "digest": {
        "type": "string",
        "pattern": "^sha-256:[0-9a-f]{64}$"
      },
      "version": {
        "type": "string",
        "pattern": "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
        "maxLength": 21
      },
      "timestamp": {
        "type": "string",
        "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$",
        "maxLength": 24
      },
      "namespace": {
        "type": "string",
        "pattern": "^(?:[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$",
        "minLength": 3,
        "maxLength": 253
      },
      "localId": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9-]{0,63}$",
        "minLength": 1,
        "maxLength": 64
      },
      "semanticRuleId": {
        "type": "string",
        "pattern": "^(ART|TSK|AUT|CTX|CMP|BND|RES|REF|WSP|LIN|REG|LFC|EXE|PUB|MIG|SEC)-[0-9]{3}$"
      },
      "safeInteger": {
        "type": "integer",
        "minimum": -9007199254740991,
        "maximum": 9007199254740991
      },
      "nonNegativeSafeInteger": {
        "type": "integer",
        "minimum": 0,
        "maximum": 9007199254740991
      }
    }
  },
  "urn:project-gateway:schema:artifact:1.0:common:kind-descriptor": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:common:kind-descriptor",
    "title": "Core artifact kind descriptor",
    "type": "object",
    "required": [
      "id",
      "version"
    ],
    "properties": {
      "id": {
        "enum": [
          "TaskSpec",
          "AuthorityPolicy",
          "ContextManifest",
          "CompletionContract",
          "ExecutionBundle",
          "ExecutionResult"
        ]
      },
      "version": {
        "const": "1.0"
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:artifact:1.0:common:protocol-descriptor": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:common:protocol-descriptor",
    "title": "Artifact protocol descriptor",
    "type": "object",
    "required": [
      "id",
      "version",
      "canonicalization"
    ],
    "properties": {
      "id": {
        "const": "project-gateway.artifact"
      },
      "version": {
        "const": "1.0"
      },
      "canonicalization": {
        "const": "jcs-rfc8785-v1"
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:artifact:1.0:common:registered-requirement": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:common:registered-requirement",
    "title": "Registered requirement under the V1 conformance registry profile",
    "oneOf": [
      {
        "type": "object",
        "required": [
          "class",
          "id",
          "version"
        ],
        "properties": {
          "class": {
            "const": "protocol-feature"
          },
          "id": {
            "enum": [
              "project-gateway.conformance-alpha",
              "project-gateway.conformance-beta",
              "project-gateway.conformance-fixture"
            ]
          },
          "version": {
            "const": "1.0"
          }
        },
        "unevaluatedProperties": false
      },
      {
        "type": "object",
        "required": [
          "class",
          "id",
          "version"
        ],
        "properties": {
          "class": {
            "const": "consumer-capability"
          },
          "id": {
            "const": "project-gateway.fixture-consumer"
          },
          "version": {
            "const": "1.0"
          }
        },
        "unevaluatedProperties": false
      }
    ]
  },
  "urn:project-gateway:schema:artifact:1.0:common:requirements": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:common:requirements",
    "title": "Registered protocol feature and consumer capability requirements",
    "type": "object",
    "required": [
      "protocol_features",
      "consumer_capabilities"
    ],
    "properties": {
      "protocol_features": {
        "type": "array",
        "items": {
          "allOf": [
            {
              "$ref": "urn:project-gateway:schema:artifact:1.0:common:registered-requirement"
            },
            {
              "properties": {
                "class": {
                  "const": "protocol-feature"
                }
              }
            }
          ]
        },
        "uniqueItems": true,
        "maxItems": 32
      },
      "consumer_capabilities": {
        "type": "array",
        "items": {
          "allOf": [
            {
              "$ref": "urn:project-gateway:schema:artifact:1.0:common:registered-requirement"
            },
            {
              "properties": {
                "class": {
                  "const": "consumer-capability"
                }
              }
            }
          ]
        },
        "uniqueItems": true,
        "maxItems": 32
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:artifact:1.0:common:revision-descriptor": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:common:revision-descriptor",
    "title": "Artifact revision descriptor",
    "type": "object",
    "required": [
      "id",
      "generation",
      "predecessor",
      "digest"
    ],
    "properties": {
      "id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/revisionId"
      },
      "generation": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/nonNegativeSafeInteger"
      },
      "predecessor": {
        "oneOf": [
          {
            "type": "null"
          },
          {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference"
          }
        ]
      },
      "digest": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/digest"
      }
    },
    "oneOf": [
      {
        "properties": {
          "generation": {
            "const": 0
          },
          "predecessor": {
            "type": "null"
          }
        }
      },
      {
        "properties": {
          "generation": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "predecessor": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference"
          }
        }
      }
    ],
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:artifact:1.0:common:utc-timestamp": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:common:utc-timestamp",
    "title": "Normalized UTC timestamp string",
    "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
  },
  "urn:project-gateway:schema:artifact:1.0:common:workspace-binding": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:common:workspace-binding",
    "title": "Digest-covered workspace binding",
    "oneOf": [
      {
        "type": "object",
        "required": [
          "mode"
        ],
        "properties": {
          "mode": {
            "const": "portable"
          }
        },
        "unevaluatedProperties": false
      },
      {
        "type": "object",
        "required": [
          "mode",
          "workspace_id"
        ],
        "properties": {
          "mode": {
            "const": "bound"
          },
          "workspace_id": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/workspaceId"
          }
        },
        "unevaluatedProperties": false
      }
    ]
  },
  "urn:project-gateway:schema:artifact:1.0:kinds:authority-policy": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:kinds:authority-policy",
    "title": "Complete AuthorityPolicy V1 artifact",
    "allOf": [
      {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:artifact-envelope"
      },
      {
        "properties": {
          "kind": {
            "type": "object",
            "properties": {
              "id": {
                "const": "AuthorityPolicy"
              },
              "version": {
                "const": "1.0"
              }
            },
            "required": [
              "id",
              "version"
            ]
          }
        }
      }
    ]
  },
  "urn:project-gateway:schema:artifact:1.0:kinds:authority-policy-body": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:kinds:authority-policy-body",
    "title": "AuthorityPolicy consumer-neutral narrowing body",
    "type": "object",
    "required": [
      "rules"
    ],
    "properties": {
      "rules": {
        "type": "array",
        "minItems": 1,
        "maxItems": 64,
        "items": {
          "type": "object",
          "required": [
            "rule_id",
            "effect",
            "capability",
            "scope",
            "constraints",
            "required_semantics"
          ],
          "properties": {
            "rule_id": {
              "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/localId"
            },
            "effect": {
              "enum": [
                "allow",
                "deny"
              ]
            },
            "capability": {
              "type": "object",
              "required": [
                "id",
                "version"
              ],
              "properties": {
                "id": {
                  "enum": [
                    "project-gateway.workspace-read",
                    "project-gateway.artifact-draft-write",
                    "project-gateway.git-read"
                  ]
                },
                "version": {
                  "const": "1.0"
                }
              },
              "unevaluatedProperties": false
            },
            "scope": {
              "type": "object",
              "required": [
                "scope_type",
                "version",
                "resource_classes",
                "operation_classes"
              ],
              "properties": {
                "scope_type": {
                  "const": "project-gateway.resource-class-scope"
                },
                "version": {
                  "const": "1.0"
                },
                "resource_classes": {
                  "type": "array",
                  "minItems": 1,
                  "maxItems": 8,
                  "uniqueItems": true,
                  "items": {
                    "enum": [
                      "configured-artifact-area",
                      "project-documentation",
                      "project-source",
                      "git-metadata"
                    ]
                  }
                },
                "operation_classes": {
                  "type": "array",
                  "minItems": 1,
                  "maxItems": 8,
                  "uniqueItems": true,
                  "items": {
                    "enum": [
                      "read",
                      "write-artifact-draft",
                      "inspect-git"
                    ]
                  }
                }
              },
              "unevaluatedProperties": false
            },
            "constraints": {
              "type": "array",
              "maxItems": 16,
              "items": {
                "oneOf": [
                  {
                    "type": "object",
                    "required": [
                      "type",
                      "value"
                    ],
                    "properties": {
                      "type": {
                        "const": "max-actions"
                      },
                      "value": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      }
                    },
                    "unevaluatedProperties": false
                  },
                  {
                    "type": "object",
                    "required": [
                      "type",
                      "value"
                    ],
                    "properties": {
                      "type": {
                        "const": "max-resources"
                      },
                      "value": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      }
                    },
                    "unevaluatedProperties": false
                  },
                  {
                    "type": "object",
                    "required": [
                      "type",
                      "value"
                    ],
                    "properties": {
                      "type": {
                        "const": "read-only"
                      },
                      "value": {
                        "const": true
                      }
                    },
                    "unevaluatedProperties": false
                  },
                  {
                    "type": "object",
                    "required": [
                      "type",
                      "value"
                    ],
                    "properties": {
                      "type": {
                        "const": "require-exact-resource"
                      },
                      "value": {
                        "const": true
                      }
                    },
                    "unevaluatedProperties": false
                  }
                ]
              }
            },
            "required_semantics": {
              "type": "array",
              "maxItems": 16,
              "uniqueItems": true,
              "items": {
                "$ref": "urn:project-gateway:schema:artifact:1.0:common:registered-requirement"
              }
            }
          },
          "unevaluatedProperties": false
        }
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:artifact:1.0:kinds:completion-contract": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:kinds:completion-contract",
    "title": "Complete CompletionContract V1 artifact",
    "allOf": [
      {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:artifact-envelope"
      },
      {
        "properties": {
          "kind": {
            "type": "object",
            "properties": {
              "id": {
                "const": "CompletionContract"
              },
              "version": {
                "const": "1.0"
              }
            },
            "required": [
              "id",
              "version"
            ]
          }
        }
      }
    ]
  },
  "urn:project-gateway:schema:artifact:1.0:kinds:completion-contract-body": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:kinds:completion-contract-body",
    "title": "CompletionContract prospective proof body",
    "type": "object",
    "required": [
      "checks"
    ],
    "properties": {
      "checks": {
        "type": "array",
        "minItems": 1,
        "maxItems": 128,
        "items": {
          "type": "object",
          "required": [
            "check_id",
            "evaluation_status",
            "check",
            "required_evidence",
            "acceptance_conditions"
          ],
          "properties": {
            "check_id": {
              "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/localId"
            },
            "evaluation_status": {
              "enum": [
                "required",
                "optional"
              ]
            },
            "check": {
              "oneOf": [
                {
                  "type": "object",
                  "required": [
                    "type",
                    "version",
                    "expected_deliverable_ids"
                  ],
                  "properties": {
                    "type": {
                      "const": "project-gateway.deliverable-presence"
                    },
                    "version": {
                      "const": "1.0"
                    },
                    "expected_deliverable_ids": {
                      "type": "array",
                      "minItems": 1,
                      "maxItems": 64,
                      "uniqueItems": true,
                      "items": {
                        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/localId"
                      }
                    }
                  },
                  "unevaluatedProperties": false
                },
                {
                  "type": "object",
                  "required": [
                    "type",
                    "version",
                    "required_evidence_kinds"
                  ],
                  "properties": {
                    "type": {
                      "const": "project-gateway.evidence-presence"
                    },
                    "version": {
                      "const": "1.0"
                    },
                    "required_evidence_kinds": {
                      "type": "array",
                      "minItems": 1,
                      "maxItems": 4,
                      "uniqueItems": true,
                      "items": {
                        "enum": [
                          "artifact-reference",
                          "workspace-resource-observation",
                          "external-evidence"
                        ]
                      }
                    }
                  },
                  "unevaluatedProperties": false
                }
              ]
            },
            "required_evidence": {
              "type": "array",
              "maxItems": 16,
              "items": {
                "type": "object",
                "required": [
                  "requirement_id",
                  "kind"
                ],
                "properties": {
                  "requirement_id": {
                    "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/localId"
                  },
                  "kind": {
                    "enum": [
                      "produced-artifact",
                      "workspace-resource-observation",
                      "external-evidence"
                    ]
                  }
                },
                "unevaluatedProperties": false
              }
            },
            "acceptance_conditions": {
              "type": "array",
              "minItems": 1,
              "maxItems": 16,
              "items": {
                "type": "object",
                "required": [
                  "condition_id",
                  "type"
                ],
                "properties": {
                  "condition_id": {
                    "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/localId"
                  },
                  "type": {
                    "enum": [
                      "all-identified-deliverables-present",
                      "all-required-evidence-present",
                      "no-reported-violations"
                    ]
                  }
                },
                "unevaluatedProperties": false
              }
            }
          },
          "unevaluatedProperties": false
        }
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:artifact:1.0:kinds:context-manifest": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:kinds:context-manifest",
    "title": "Complete ContextManifest V1 artifact",
    "allOf": [
      {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:artifact-envelope"
      },
      {
        "properties": {
          "kind": {
            "type": "object",
            "properties": {
              "id": {
                "const": "ContextManifest"
              },
              "version": {
                "const": "1.0"
              }
            },
            "required": [
              "id",
              "version"
            ]
          }
        }
      }
    ]
  },
  "urn:project-gateway:schema:artifact:1.0:kinds:context-manifest-body": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:kinds:context-manifest-body",
    "title": "ContextManifest bounded data-selection body",
    "type": "object",
    "required": [
      "selection_mode",
      "items"
    ],
    "properties": {
      "selection_mode": {
        "enum": [
          "none",
          "items"
        ]
      },
      "items": {
        "type": "array",
        "maxItems": 128,
        "items": {
          "type": "object",
          "required": [
            "context_id",
            "requirement",
            "priority",
            "purpose",
            "integrity",
            "selector"
          ],
          "properties": {
            "context_id": {
              "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/localId"
            },
            "requirement": {
              "enum": [
                "required",
                "optional"
              ]
            },
            "priority": {
              "type": "integer",
              "minimum": 0,
              "maximum": 1000
            },
            "purpose": {
              "enum": [
                "background",
                "specification",
                "evidence",
                "constraint",
                "fact"
              ]
            },
            "integrity": {
              "oneOf": [
                {
                  "type": "object",
                  "required": [
                    "mode"
                  ],
                  "properties": {
                    "mode": {
                      "const": "none"
                    }
                  },
                  "unevaluatedProperties": false
                },
                {
                  "type": "object",
                  "required": [
                    "mode",
                    "expected_content_digest"
                  ],
                  "properties": {
                    "mode": {
                      "const": "sha-256"
                    },
                    "expected_content_digest": {
                      "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/digest"
                    }
                  },
                  "unevaluatedProperties": false
                }
              ]
            },
            "selector": {
              "oneOf": [
                {
                  "type": "object",
                  "required": [
                    "selector_type",
                    "version",
                    "resource_id"
                  ],
                  "properties": {
                    "selector_type": {
                      "const": "project-gateway.workspace-resource-id"
                    },
                    "version": {
                      "const": "1.0"
                    },
                    "resource_id": {
                      "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/selectorId"
                    }
                  },
                  "unevaluatedProperties": false
                },
                {
                  "type": "object",
                  "required": [
                    "selector_type",
                    "version",
                    "artifact"
                  ],
                  "properties": {
                    "selector_type": {
                      "const": "project-gateway.artifact-revision"
                    },
                    "version": {
                      "const": "1.0"
                    },
                    "artifact": {
                      "$ref": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference"
                    }
                  },
                  "unevaluatedProperties": false
                }
              ]
            }
          },
          "unevaluatedProperties": false
        }
      }
    },
    "allOf": [
      {
        "if": {
          "properties": {
            "selection_mode": {
              "const": "none"
            }
          }
        },
        "then": {
          "properties": {
            "items": {
              "maxItems": 0
            }
          }
        },
        "else": {
          "properties": {
            "items": {
              "minItems": 1
            }
          }
        }
      }
    ],
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:artifact:1.0:kinds:execution-bundle": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:kinds:execution-bundle",
    "title": "Complete ExecutionBundle V1 artifact",
    "allOf": [
      {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:artifact-envelope"
      },
      {
        "properties": {
          "kind": {
            "type": "object",
            "properties": {
              "id": {
                "const": "ExecutionBundle"
              },
              "version": {
                "const": "1.0"
              }
            },
            "required": [
              "id",
              "version"
            ]
          }
        }
      }
    ]
  },
  "urn:project-gateway:schema:artifact:1.0:kinds:execution-bundle-body": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:kinds:execution-bundle-body",
    "title": "ExecutionBundle exact four-member composition body",
    "type": "object",
    "required": [
      "task",
      "authority_policy",
      "context_manifest",
      "completion_contract"
    ],
    "properties": {
      "task": {
        "allOf": [
          {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference"
          },
          {
            "properties": {
              "target_kind": {
                "properties": {
                  "id": {
                    "const": "TaskSpec"
                  },
                  "version": {
                    "const": "1.0"
                  }
                }
              }
            }
          }
        ]
      },
      "authority_policy": {
        "allOf": [
          {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference"
          },
          {
            "properties": {
              "target_kind": {
                "properties": {
                  "id": {
                    "const": "AuthorityPolicy"
                  },
                  "version": {
                    "const": "1.0"
                  }
                }
              }
            }
          }
        ]
      },
      "context_manifest": {
        "allOf": [
          {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference"
          },
          {
            "properties": {
              "target_kind": {
                "properties": {
                  "id": {
                    "const": "ContextManifest"
                  },
                  "version": {
                    "const": "1.0"
                  }
                }
              }
            }
          }
        ]
      },
      "completion_contract": {
        "allOf": [
          {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference"
          },
          {
            "properties": {
              "target_kind": {
                "properties": {
                  "id": {
                    "const": "CompletionContract"
                  },
                  "version": {
                    "const": "1.0"
                  }
                }
              }
            }
          }
        ]
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:artifact:1.0:kinds:execution-result": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:kinds:execution-result",
    "title": "Complete ExecutionResult V1 artifact",
    "allOf": [
      {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:artifact-envelope"
      },
      {
        "properties": {
          "kind": {
            "type": "object",
            "properties": {
              "id": {
                "const": "ExecutionResult"
              },
              "version": {
                "const": "1.0"
              }
            },
            "required": [
              "id",
              "version"
            ]
          }
        }
      }
    ]
  },
  "urn:project-gateway:schema:artifact:1.0:kinds:execution-result-body": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:kinds:execution-result-body",
    "title": "ExecutionResult retrospective observation body",
    "type": "object",
    "required": [
      "reported_bundle",
      "reported_occurrence_id",
      "reported_attempt_id",
      "disposition",
      "observed_outputs",
      "observed_changed_resources",
      "completion_check_observations",
      "violations",
      "produced_artifact_references",
      "evidence_references"
    ],
    "properties": {
      "reported_bundle": {
        "allOf": [
          {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference"
          },
          {
            "properties": {
              "target_kind": {
                "properties": {
                  "id": {
                    "const": "ExecutionBundle"
                  },
                  "version": {
                    "const": "1.0"
                  }
                }
              }
            }
          }
        ]
      },
      "reported_occurrence_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/occurrenceId"
      },
      "reported_attempt_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/attemptId"
      },
      "disposition": {
        "enum": [
          "completed",
          "incomplete",
          "failed",
          "cancelled",
          "timed-out",
          "crashed",
          "rejected"
        ]
      },
      "observed_outputs": {
        "type": "array",
        "maxItems": 256,
        "items": {
          "type": "object",
          "required": [
            "output_id",
            "kind",
            "text"
          ],
          "properties": {
            "output_id": {
              "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/localId"
            },
            "kind": {
              "enum": [
                "summary",
                "artifact",
                "message"
              ]
            },
            "text": {
              "type": "string",
              "minLength": 1,
              "maxLength": 8192
            }
          },
          "unevaluatedProperties": false
        }
      },
      "observed_changed_resources": {
        "type": "array",
        "maxItems": 256,
        "items": {
          "allOf": [
            {
              "$ref": "urn:project-gateway:schema:artifact:1.0:common:evidence-reference"
            },
            {
              "properties": {
                "kind": {
                  "const": "workspace-resource-observation"
                }
              }
            }
          ]
        }
      },
      "completion_check_observations": {
        "type": "array",
        "maxItems": 128,
        "items": {
          "type": "object",
          "required": [
            "check_id",
            "status",
            "evidence"
          ],
          "properties": {
            "check_id": {
              "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/localId"
            },
            "status": {
              "enum": [
                "satisfied",
                "not-satisfied",
                "not-evaluated"
              ]
            },
            "evidence": {
              "type": "array",
              "maxItems": 16,
              "items": {
                "$ref": "urn:project-gateway:schema:artifact:1.0:common:evidence-reference"
              }
            }
          },
          "unevaluatedProperties": false
        }
      },
      "violations": {
        "type": "array",
        "maxItems": 128,
        "items": {
          "type": "object",
          "required": [
            "violation_id",
            "category",
            "summary"
          ],
          "properties": {
            "violation_id": {
              "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/localId"
            },
            "category": {
              "enum": [
                "policy",
                "completion",
                "runtime",
                "integrity"
              ]
            },
            "summary": {
              "type": "string",
              "minLength": 1,
              "maxLength": 4096
            }
          },
          "unevaluatedProperties": false
        }
      },
      "produced_artifact_references": {
        "type": "array",
        "maxItems": 128,
        "items": {
          "$ref": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference"
        }
      },
      "evidence_references": {
        "type": "array",
        "maxItems": 256,
        "items": {
          "$ref": "urn:project-gateway:schema:artifact:1.0:common:evidence-reference"
        }
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:artifact:1.0:kinds:task-spec": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:kinds:task-spec",
    "title": "Complete TaskSpec V1 artifact",
    "allOf": [
      {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:artifact-envelope"
      },
      {
        "properties": {
          "kind": {
            "type": "object",
            "properties": {
              "id": {
                "const": "TaskSpec"
              },
              "version": {
                "const": "1.0"
              }
            },
            "required": [
              "id",
              "version"
            ]
          }
        }
      }
    ]
  },
  "urn:project-gateway:schema:artifact:1.0:kinds:task-spec-body": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:artifact:1.0:kinds:task-spec-body",
    "title": "TaskSpec direct task-intent body",
    "type": "object",
    "required": [
      "objective",
      "instructions",
      "expected_deliverables",
      "outcome_constraints",
      "project_data_citations"
    ],
    "properties": {
      "objective": {
        "type": "string",
        "minLength": 1,
        "maxLength": 4096
      },
      "instructions": {
        "type": "array",
        "minItems": 1,
        "maxItems": 64,
        "items": {
          "type": "object",
          "required": [
            "instruction_id",
            "text"
          ],
          "properties": {
            "instruction_id": {
              "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/localId"
            },
            "text": {
              "type": "string",
              "minLength": 1,
              "maxLength": 8192
            }
          },
          "unevaluatedProperties": false
        }
      },
      "expected_deliverables": {
        "type": "array",
        "minItems": 1,
        "maxItems": 64,
        "items": {
          "type": "object",
          "required": [
            "deliverable_id",
            "description",
            "kind"
          ],
          "properties": {
            "deliverable_id": {
              "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/localId"
            },
            "description": {
              "type": "string",
              "minLength": 1,
              "maxLength": 2048
            },
            "kind": {
              "enum": [
                "document",
                "artifact",
                "report",
                "change-description"
              ]
            }
          },
          "unevaluatedProperties": false
        }
      },
      "outcome_constraints": {
        "type": "array",
        "maxItems": 64,
        "items": {
          "type": "object",
          "required": [
            "constraint_id",
            "statement"
          ],
          "properties": {
            "constraint_id": {
              "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/localId"
            },
            "statement": {
              "type": "string",
              "minLength": 1,
              "maxLength": 2048
            }
          },
          "unevaluatedProperties": false
        }
      },
      "project_data_citations": {
        "type": "array",
        "maxItems": 64,
        "items": {
          "type": "object",
          "required": [
            "citation_id",
            "relationship",
            "summary"
          ],
          "properties": {
            "citation_id": {
              "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/localId"
            },
            "relationship": {
              "enum": [
                "informational",
                "outcome-constraint"
              ]
            },
            "summary": {
              "type": "string",
              "minLength": 1,
              "maxLength": 2048
            }
          },
          "unevaluatedProperties": false
        }
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:lifecycle:1.0:common:components": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:lifecycle:1.0:common:components",
    "title": "Closed trusted lifecycle common component header",
    "type": "object",
    "required": [
      "record_id",
      "created_at",
      "responsible_role",
      "registry_snapshot_reference"
    ],
    "properties": {
      "record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "created_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "responsible_role": {
        "enum": [
          "trusted-validator",
          "trusted-approver",
          "trusted-issuer",
          "trusted-revocation-authority",
          "trusted-runtime-grant-authority",
          "trusted-activation-authority",
          "trusted-execution-recorder",
          "trusted-receipt-producer",
          "trusted-result-publisher",
          "trusted-lifecycle-authority",
          "trusted-reporting-authority",
          "trusted-migration-authority",
          "trusted-control-plane"
        ]
      },
      "registry_snapshot_reference": {
        "$ref": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      }
    },
    "unevaluatedProperties": false,
    "$defs": {
      "exactArtifactSubject": {
        "type": "object",
        "required": [
          "protocol_version",
          "kind",
          "instance_id",
          "revision_id",
          "digest",
          "workspace_id"
        ],
        "properties": {
          "protocol_version": {
            "const": "1.0"
          },
          "kind": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:kind-descriptor"
          },
          "instance_id": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/artifactInstanceId"
          },
          "revision_id": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/revisionId"
          },
          "digest": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/digest"
          },
          "workspace_id": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/workspaceId"
          }
        },
        "unevaluatedProperties": false
      },
      "validityBound": {
        "type": "object",
        "required": [
          "not_before",
          "not_after"
        ],
        "properties": {
          "not_before": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
          },
          "not_after": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
          }
        },
        "unevaluatedProperties": false
      },
      "publicationScope": {
        "enum": [
          "ordinary-review",
          "completion-status",
          "downstream-automation",
          "authoritative-reporting"
        ]
      },
      "evaluatorProvenance": {
        "type": "object",
        "required": [
          "evaluator_id",
          "capability_profile_id"
        ],
        "properties": {
          "evaluator_id": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/evaluatorId"
          },
          "capability_profile_id": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/capabilityProfileId"
          }
        },
        "unevaluatedProperties": false
      }
    }
  },
  "urn:project-gateway:schema:lifecycle:1.0:records:activation-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:lifecycle:1.0:records:activation-record",
    "title": "ActivationRecord",
    "type": "object",
    "required": [
      "record_type",
      "record_id",
      "created_at",
      "responsible_role",
      "registry_snapshot_reference",
      "bundle",
      "workspace_id",
      "required_issuance_record_ids",
      "runtime_grant_id",
      "reserved_occurrence_id",
      "decision"
    ],
    "properties": {
      "record_type": {
        "const": "ActivationRecord"
      },
      "record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "created_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "responsible_role": {
        "const": "trusted-activation-authority"
      },
      "registry_snapshot_reference": {
        "$ref": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      },
      "bundle": {
        "allOf": [
          {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference"
          },
          {
            "properties": {
              "target_kind": {
                "properties": {
                  "id": {
                    "const": "ExecutionBundle"
                  }
                }
              }
            }
          }
        ]
      },
      "workspace_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/workspaceId"
      },
      "required_issuance_record_ids": {
        "type": "array",
        "minItems": 5,
        "maxItems": 5,
        "uniqueItems": true,
        "items": {
          "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
        }
      },
      "runtime_grant_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "reserved_occurrence_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/occurrenceId"
      },
      "decision": {
        "enum": [
          "accepted",
          "denied"
        ]
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:lifecycle:1.0:records:approval-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:lifecycle:1.0:records:approval-record",
    "title": "ApprovalRecord",
    "type": "object",
    "required": [
      "record_type",
      "record_id",
      "created_at",
      "responsible_role",
      "registry_snapshot_reference",
      "subject",
      "workspace_id",
      "purpose",
      "validation_record_ids",
      "required_semantics",
      "valid_until"
    ],
    "properties": {
      "record_type": {
        "const": "ApprovalRecord"
      },
      "record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "created_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "responsible_role": {
        "const": "trusted-approver"
      },
      "registry_snapshot_reference": {
        "$ref": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      },
      "subject": {
        "allOf": [
          {
            "$ref": "urn:project-gateway:schema:lifecycle:1.0:common:components#/$defs/exactArtifactSubject"
          },
          {
            "properties": {
              "kind": {
                "properties": {
                  "id": {
                    "enum": [
                      "TaskSpec",
                      "AuthorityPolicy",
                      "ContextManifest",
                      "CompletionContract",
                      "ExecutionBundle"
                    ]
                  }
                }
              }
            }
          }
        ]
      },
      "workspace_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/workspaceId"
      },
      "purpose": {
        "enum": [
          "execution-use"
        ]
      },
      "validation_record_ids": {
        "type": "array",
        "minItems": 1,
        "maxItems": 16,
        "uniqueItems": true,
        "items": {
          "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
        }
      },
      "required_semantics": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:requirements"
      },
      "valid_until": {
        "oneOf": [
          {
            "type": "null"
          },
          {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
          }
        ]
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:lifecycle:1.0:records:authoritative-audit-event": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:lifecycle:1.0:records:authoritative-audit-event",
    "title": "AuthoritativeAuditEvent",
    "type": "object",
    "required": [
      "record_type",
      "record_id",
      "created_at",
      "responsible_role",
      "registry_snapshot_reference",
      "event_type",
      "primary_record_id",
      "correlation_record_ids"
    ],
    "properties": {
      "record_type": {
        "const": "AuthoritativeAuditEvent"
      },
      "record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "created_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "responsible_role": {
        "const": "trusted-control-plane"
      },
      "registry_snapshot_reference": {
        "$ref": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      },
      "event_type": {
        "enum": [
          "record-created",
          "record-revoked",
          "validity-evaluated",
          "activation-decided",
          "occurrence-transitioned",
          "attempt-transitioned",
          "result-published",
          "superseded",
          "receipt-correlated"
        ]
      },
      "primary_record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "correlation_record_ids": {
        "type": "array",
        "maxItems": 64,
        "uniqueItems": true,
        "items": {
          "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
        }
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:lifecycle:1.0:records:execution-attempt-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:lifecycle:1.0:records:execution-attempt-record",
    "title": "ExecutionAttemptRecord",
    "type": "object",
    "required": [
      "record_type",
      "record_id",
      "created_at",
      "responsible_role",
      "registry_snapshot_reference",
      "activation_record_id",
      "occurrence_id",
      "attempt_id",
      "ordinal",
      "bundle",
      "workspace_id",
      "runtime_grant_id"
    ],
    "properties": {
      "record_type": {
        "const": "ExecutionAttemptRecord"
      },
      "record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "created_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "responsible_role": {
        "const": "trusted-execution-recorder"
      },
      "registry_snapshot_reference": {
        "$ref": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      },
      "activation_record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "occurrence_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/occurrenceId"
      },
      "attempt_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/attemptId"
      },
      "ordinal": {
        "type": "integer",
        "minimum": 1,
        "maximum": 64
      },
      "bundle": {
        "allOf": [
          {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference"
          },
          {
            "properties": {
              "target_kind": {
                "properties": {
                  "id": {
                    "const": "ExecutionBundle"
                  }
                }
              }
            }
          }
        ]
      },
      "workspace_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/workspaceId"
      },
      "runtime_grant_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:lifecycle:1.0:records:execution-outcome-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:lifecycle:1.0:records:execution-outcome-record",
    "title": "ExecutionOutcomeRecord",
    "type": "object",
    "required": [
      "record_type",
      "record_id",
      "created_at",
      "responsible_role",
      "registry_snapshot_reference",
      "workspace_id",
      "bundle",
      "occurrence_id",
      "attempt_id",
      "ordinal",
      "execution_attempt_record_id",
      "disposition",
      "observation_evidence"
    ],
    "properties": {
      "record_type": {
        "const": "ExecutionOutcomeRecord"
      },
      "record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "created_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "responsible_role": {
        "const": "trusted-execution-outcome-recorder"
      },
      "registry_snapshot_reference": {
        "$ref": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      },
      "workspace_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/workspaceId"
      },
      "bundle": {
        "allOf": [
          {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference"
          },
          {
            "properties": {
              "target_kind": {
                "properties": {
                  "id": {
                    "const": "ExecutionBundle"
                  }
                }
              }
            }
          }
        ]
      },
      "occurrence_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/occurrenceId"
      },
      "attempt_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/attemptId"
      },
      "ordinal": {
        "type": "integer",
        "minimum": 1,
        "maximum": 64
      },
      "execution_attempt_record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "disposition": {
        "enum": [
          "completed",
          "incomplete",
          "failed",
          "cancelled",
          "timed-out",
          "crashed",
          "rejected"
        ]
      },
      "observation_evidence": {
        "type": "object",
        "required": [
          "kind",
          "evidence_id",
          "content_digest",
          "declared_media_type",
          "observation_role"
        ],
        "properties": {
          "kind": {
            "const": "external-evidence"
          },
          "evidence_id": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/evidenceId"
          },
          "content_digest": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/digest"
          },
          "declared_media_type": {
            "const": "application/json"
          },
          "observation_role": {
            "const": "evaluation-evidence"
          }
        },
        "unevaluatedProperties": false
      },
      "enforcement_evidence": {
        "type": "object",
        "required": [
          "projection_identity",
          "evidence_fingerprint"
        ],
        "properties": {
          "projection_identity": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/digest"
          },
          "evidence_fingerprint": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/digest"
          }
        },
        "unevaluatedProperties": false
      },
      "result_association": {
        "type": "object",
        "required": [
          "instance_id",
          "revision_digest",
          "association_mode",
          "validation_record_id"
        ],
        "properties": {
          "instance_id": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/artifactInstanceId"
          },
          "revision_digest": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/digest"
          },
          "association_mode": {
            "enum": [
              "originated",
              "adopted"
            ]
          },
          "validation_record_id": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
          }
        },
        "unevaluatedProperties": false
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:lifecycle:1.0:records:execution-occurrence-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:lifecycle:1.0:records:execution-occurrence-record",
    "title": "ExecutionOccurrenceRecord",
    "type": "object",
    "required": [
      "record_type",
      "record_id",
      "created_at",
      "responsible_role",
      "registry_snapshot_reference",
      "activation_record_id",
      "bundle",
      "workspace_id",
      "occurrence_id",
      "runtime_grant_id"
    ],
    "properties": {
      "record_type": {
        "const": "ExecutionOccurrenceRecord"
      },
      "record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "created_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "responsible_role": {
        "const": "trusted-control-plane"
      },
      "registry_snapshot_reference": {
        "$ref": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      },
      "activation_record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "bundle": {
        "allOf": [
          {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference"
          },
          {
            "properties": {
              "target_kind": {
                "properties": {
                  "id": {
                    "const": "ExecutionBundle"
                  }
                }
              }
            }
          }
        ]
      },
      "workspace_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/workspaceId"
      },
      "occurrence_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/occurrenceId"
      },
      "runtime_grant_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:lifecycle:1.0:records:execution-summary-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:lifecycle:1.0:records:execution-summary-record",
    "title": "ExecutionSummaryRecord",
    "type": "object",
    "required": [
      "record_type",
      "record_id",
      "created_at",
      "responsible_role",
      "registry_snapshot_reference",
      "workspace_id",
      "occurrence_id",
      "attempts"
    ],
    "properties": {
      "record_type": {
        "const": "ExecutionSummaryRecord"
      },
      "record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "created_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "responsible_role": {
        "const": "trusted-reporting-authority"
      },
      "registry_snapshot_reference": {
        "$ref": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      },
      "workspace_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/workspaceId"
      },
      "occurrence_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/occurrenceId"
      },
      "attempts": {
        "type": "array",
        "minItems": 1,
        "maxItems": 64,
        "items": {
          "type": "object",
          "required": [
            "attempt_id",
            "ordinal",
            "receipt_record_ids",
            "result_publication_record_id"
          ],
          "properties": {
            "attempt_id": {
              "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/attemptId"
            },
            "ordinal": {
              "type": "integer",
              "minimum": 1,
              "maximum": 64
            },
            "receipt_record_ids": {
              "type": "array",
              "minItems": 1,
              "maxItems": 16,
              "uniqueItems": true,
              "items": {
                "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
              }
            },
            "result_publication_record_id": {
              "oneOf": [
                {
                  "type": "null"
                },
                {
                  "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
                }
              ]
            }
          },
          "unevaluatedProperties": false
        }
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:lifecycle:1.0:records:issuance-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:lifecycle:1.0:records:issuance-record",
    "title": "IssuanceRecord",
    "type": "object",
    "required": [
      "record_type",
      "record_id",
      "created_at",
      "responsible_role",
      "registry_snapshot_reference",
      "subject",
      "approval_record_id",
      "workspace_id",
      "use_class",
      "activation_limit",
      "valid_until"
    ],
    "properties": {
      "record_type": {
        "const": "IssuanceRecord"
      },
      "record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "created_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "responsible_role": {
        "const": "trusted-issuer"
      },
      "registry_snapshot_reference": {
        "$ref": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      },
      "subject": {
        "allOf": [
          {
            "$ref": "urn:project-gateway:schema:lifecycle:1.0:common:components#/$defs/exactArtifactSubject"
          },
          {
            "properties": {
              "kind": {
                "properties": {
                  "id": {
                    "enum": [
                      "TaskSpec",
                      "AuthorityPolicy",
                      "ContextManifest",
                      "CompletionContract",
                      "ExecutionBundle"
                    ]
                  }
                }
              }
            }
          }
        ]
      },
      "approval_record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "workspace_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/workspaceId"
      },
      "use_class": {
        "enum": [
          "execution-use"
        ]
      },
      "activation_limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 64
      },
      "valid_until": {
        "oneOf": [
          {
            "type": "null"
          },
          {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
          }
        ]
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:lifecycle:1.0:records:migration-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:lifecycle:1.0:records:migration-record",
    "title": "MigrationRecord",
    "type": "object",
    "required": [
      "record_type",
      "record_id",
      "created_at",
      "responsible_role",
      "registry_snapshot_reference",
      "old_subject",
      "new_subject",
      "transformation_profile",
      "scope"
    ],
    "properties": {
      "record_type": {
        "const": "MigrationRecord"
      },
      "record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "created_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "responsible_role": {
        "const": "trusted-migration-authority"
      },
      "registry_snapshot_reference": {
        "$ref": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      },
      "old_subject": {
        "$ref": "urn:project-gateway:schema:lifecycle:1.0:common:components#/$defs/exactArtifactSubject"
      },
      "new_subject": {
        "$ref": "urn:project-gateway:schema:lifecycle:1.0:common:components#/$defs/exactArtifactSubject"
      },
      "transformation_profile": {
        "type": "object",
        "required": [
          "id",
          "version"
        ],
        "properties": {
          "id": {
            "const": "project-gateway.explicit-migration"
          },
          "version": {
            "const": "1.0"
          }
        },
        "unevaluatedProperties": false
      },
      "scope": {
        "enum": [
          "historical-correlation",
          "import-correlation"
        ]
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:lifecycle:1.0:records:result-publication-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:lifecycle:1.0:records:result-publication-record",
    "title": "ResultPublicationRecord",
    "type": "object",
    "required": [
      "record_type",
      "record_id",
      "created_at",
      "responsible_role",
      "registry_snapshot_reference",
      "result_subject",
      "evaluator_provenance",
      "association_mode",
      "validation_record_id",
      "bundle",
      "workspace_id",
      "occurrence_id",
      "attempt_id",
      "publication_scopes",
      "receipt_correlations"
    ],
    "properties": {
      "record_type": {
        "const": "ResultPublicationRecord"
      },
      "record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "created_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "responsible_role": {
        "const": "trusted-result-publisher"
      },
      "registry_snapshot_reference": {
        "$ref": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      },
      "result_subject": {
        "allOf": [
          {
            "$ref": "urn:project-gateway:schema:lifecycle:1.0:common:components#/$defs/exactArtifactSubject"
          },
          {
            "properties": {
              "kind": {
                "properties": {
                  "id": {
                    "const": "ExecutionResult"
                  }
                }
              }
            }
          }
        ]
      },
      "evaluator_provenance": {
        "$ref": "urn:project-gateway:schema:lifecycle:1.0:common:components#/$defs/evaluatorProvenance"
      },
      "association_mode": {
        "enum": [
          "originated",
          "adopted"
        ]
      },
      "validation_record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "bundle": {
        "allOf": [
          {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference"
          },
          {
            "properties": {
              "target_kind": {
                "properties": {
                  "id": {
                    "const": "ExecutionBundle"
                  }
                }
              }
            }
          }
        ]
      },
      "workspace_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/workspaceId"
      },
      "occurrence_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/occurrenceId"
      },
      "attempt_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/attemptId"
      },
      "publication_scopes": {
        "type": "array",
        "minItems": 1,
        "maxItems": 4,
        "uniqueItems": true,
        "items": {
          "$ref": "urn:project-gateway:schema:lifecycle:1.0:common:components#/$defs/publicationScope"
        }
      },
      "receipt_correlations": {
        "type": "array",
        "maxItems": 16,
        "uniqueItems": true,
        "items": {
          "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
        }
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:lifecycle:1.0:records:revocation-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:lifecycle:1.0:records:revocation-record",
    "title": "RevocationRecord",
    "type": "object",
    "required": [
      "record_type",
      "record_id",
      "created_at",
      "responsible_role",
      "registry_snapshot_reference",
      "target",
      "scope",
      "effective_at",
      "reason_code"
    ],
    "properties": {
      "record_type": {
        "const": "RevocationRecord"
      },
      "record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "created_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "responsible_role": {
        "const": "trusted-revocation-authority"
      },
      "registry_snapshot_reference": {
        "$ref": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      },
      "target": {
        "type": "object",
        "required": [
          "record_type",
          "record_id"
        ],
        "properties": {
          "record_type": {
            "enum": [
              "ApprovalRecord",
              "IssuanceRecord",
              "RuntimeGrant",
              "ResultPublicationRecord"
            ]
          },
          "record_id": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
          }
        },
        "unevaluatedProperties": false
      },
      "scope": {
        "enum": [
          "all-uses",
          "execution-use",
          "ordinary-review",
          "completion-status",
          "downstream-automation",
          "authoritative-reporting"
        ]
      },
      "effective_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "reason_code": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9-]{0,63}$",
        "maxLength": 64
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:lifecycle:1.0:records:runtime-grant": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:lifecycle:1.0:records:runtime-grant",
    "title": "RuntimeGrant",
    "type": "object",
    "required": [
      "record_type",
      "record_id",
      "created_at",
      "responsible_role",
      "registry_snapshot_reference",
      "bundle",
      "workspace_id",
      "reserved_occurrence_id",
      "attempt_limit",
      "validity",
      "narrowed_constraints"
    ],
    "properties": {
      "record_type": {
        "const": "RuntimeGrant"
      },
      "record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "created_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "responsible_role": {
        "const": "trusted-runtime-grant-authority"
      },
      "registry_snapshot_reference": {
        "$ref": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      },
      "bundle": {
        "allOf": [
          {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference"
          },
          {
            "properties": {
              "target_kind": {
                "properties": {
                  "id": {
                    "const": "ExecutionBundle"
                  }
                }
              }
            }
          }
        ]
      },
      "workspace_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/workspaceId"
      },
      "reserved_occurrence_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/occurrenceId"
      },
      "attempt_limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 64
      },
      "validity": {
        "$ref": "urn:project-gateway:schema:lifecycle:1.0:common:components#/$defs/validityBound"
      },
      "narrowed_constraints": {
        "type": "array",
        "maxItems": 16,
        "items": {
          "oneOf": [
            {
              "type": "object",
              "required": [
                "type",
                "value"
              ],
              "properties": {
                "type": {
                  "const": "max-actions"
                },
                "value": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 9007199254740991
                }
              },
              "unevaluatedProperties": false
            },
            {
              "type": "object",
              "required": [
                "type",
                "value"
              ],
              "properties": {
                "type": {
                  "const": "max-resources"
                },
                "value": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 9007199254740991
                }
              },
              "unevaluatedProperties": false
            },
            {
              "type": "object",
              "required": [
                "type",
                "value"
              ],
              "properties": {
                "type": {
                  "const": "read-only"
                },
                "value": {
                  "const": true
                }
              },
              "unevaluatedProperties": false
            },
            {
              "type": "object",
              "required": [
                "type",
                "value"
              ],
              "properties": {
                "type": {
                  "const": "require-exact-resource"
                },
                "value": {
                  "const": true
                }
              },
              "unevaluatedProperties": false
            }
          ]
        }
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:lifecycle:1.0:records:supersession-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:lifecycle:1.0:records:supersession-record",
    "title": "SupersessionRecord",
    "type": "object",
    "required": [
      "record_type",
      "record_id",
      "created_at",
      "responsible_role",
      "registry_snapshot_reference",
      "prior",
      "successor",
      "scope",
      "reason_code"
    ],
    "properties": {
      "record_type": {
        "const": "SupersessionRecord"
      },
      "record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "created_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "responsible_role": {
        "const": "trusted-lifecycle-authority"
      },
      "registry_snapshot_reference": {
        "$ref": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      },
      "prior": {
        "oneOf": [
          {
            "type": "object",
            "required": [
              "subject_type",
              "artifact_subject"
            ],
            "properties": {
              "subject_type": {
                "const": "artifact-revision"
              },
              "artifact_subject": {
                "$ref": "urn:project-gateway:schema:lifecycle:1.0:common:components#/$defs/exactArtifactSubject"
              }
            },
            "unevaluatedProperties": false
          },
          {
            "type": "object",
            "required": [
              "subject_type",
              "record_id"
            ],
            "properties": {
              "subject_type": {
                "const": "result-publication"
              },
              "record_id": {
                "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
              }
            },
            "unevaluatedProperties": false
          }
        ]
      },
      "successor": {
        "oneOf": [
          {
            "type": "object",
            "required": [
              "subject_type",
              "artifact_subject"
            ],
            "properties": {
              "subject_type": {
                "const": "artifact-revision"
              },
              "artifact_subject": {
                "$ref": "urn:project-gateway:schema:lifecycle:1.0:common:components#/$defs/exactArtifactSubject"
              }
            },
            "unevaluatedProperties": false
          },
          {
            "type": "object",
            "required": [
              "subject_type",
              "record_id"
            ],
            "properties": {
              "subject_type": {
                "const": "result-publication"
              },
              "record_id": {
                "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
              }
            },
            "unevaluatedProperties": false
          }
        ]
      },
      "scope": {
        "$ref": "urn:project-gateway:schema:lifecycle:1.0:common:components#/$defs/publicationScope"
      },
      "reason_code": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9-]{0,63}$",
        "maxLength": 64
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:lifecycle:1.0:records:trusted-receipt": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:lifecycle:1.0:records:trusted-receipt",
    "title": "TrustedReceipt",
    "type": "object",
    "required": [
      "record_type",
      "record_id",
      "created_at",
      "responsible_role",
      "registry_snapshot_reference",
      "event_type",
      "event_record_id",
      "workspace_id",
      "disposition"
    ],
    "properties": {
      "record_type": {
        "const": "TrustedReceipt"
      },
      "record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "created_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "responsible_role": {
        "const": "trusted-receipt-producer"
      },
      "registry_snapshot_reference": {
        "$ref": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      },
      "event_type": {
        "enum": [
          "activation-decision",
          "occurrence-start",
          "attempt-start",
          "attempt-end",
          "enforcement-denial",
          "cancellation",
          "timeout",
          "crash",
          "result-publication-correlation"
        ]
      },
      "event_record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "workspace_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/workspaceId"
      },
      "occurrence_id": {
        "oneOf": [
          {
            "type": "null"
          },
          {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/occurrenceId"
          }
        ]
      },
      "attempt_id": {
        "oneOf": [
          {
            "type": "null"
          },
          {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/attemptId"
          }
        ]
      },
      "disposition": {
        "enum": [
          "accepted",
          "denied",
          "started",
          "completed",
          "failed",
          "cancelled",
          "timed-out",
          "crashed",
          "incomplete",
          "rejected"
        ]
      }
    },
    "if": {
      "properties": {
        "event_type": {
          "const": "activation-decision"
        },
        "disposition": {
          "const": "denied"
        }
      },
      "required": [
        "event_type",
        "disposition"
      ]
    },
    "then": {
      "not": {
        "anyOf": [
          {
            "required": [
              "occurrence_id"
            ]
          },
          {
            "required": [
              "attempt_id"
            ]
          }
        ]
      }
    },
    "else": {
      "required": [
        "occurrence_id",
        "attempt_id"
      ]
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:lifecycle:1.0:records:validation-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:lifecycle:1.0:records:validation-record",
    "title": "ValidationRecord",
    "type": "object",
    "required": [
      "record_type",
      "record_id",
      "created_at",
      "responsible_role",
      "registry_snapshot_reference",
      "subject",
      "validator_profile",
      "structural_outcome",
      "semantic_outcome",
      "findings"
    ],
    "properties": {
      "record_type": {
        "const": "ValidationRecord"
      },
      "record_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/lifecycleRecordId"
      },
      "created_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "responsible_role": {
        "const": "trusted-validator"
      },
      "registry_snapshot_reference": {
        "$ref": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference"
      },
      "subject": {
        "$ref": "urn:project-gateway:schema:lifecycle:1.0:common:components#/$defs/exactArtifactSubject"
      },
      "validator_profile": {
        "type": "object",
        "required": [
          "id",
          "version"
        ],
        "properties": {
          "id": {
            "const": "project-gateway.structural-semantic-v1"
          },
          "version": {
            "const": "1.0"
          }
        },
        "unevaluatedProperties": false
      },
      "structural_outcome": {
        "enum": [
          "pass",
          "fail"
        ]
      },
      "semantic_outcome": {
        "enum": [
          "pass",
          "fail"
        ]
      },
      "findings": {
        "type": "array",
        "maxItems": 128,
        "items": {
          "type": "object",
          "required": [
            "rule_id",
            "category"
          ],
          "properties": {
            "rule_id": {
              "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/semanticRuleId"
            },
            "category": {
              "type": "string",
              "pattern": "^[a-z][a-z0-9-]{0,63}$",
              "maxLength": 64
            }
          },
          "unevaluatedProperties": false
        }
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:registry:1.0:deprecation-declaration": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:registry:1.0:deprecation-declaration",
    "title": "Registry deprecation declaration",
    "oneOf": [
      {
        "type": "object",
        "required": [
          "status"
        ],
        "properties": {
          "status": {
            "const": "active"
          }
        },
        "unevaluatedProperties": false
      },
      {
        "type": "object",
        "required": [
          "status",
          "deprecated_at",
          "reason_code"
        ],
        "properties": {
          "status": {
            "const": "deprecated"
          },
          "deprecated_at": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
          },
          "reason_code": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9-]{0,63}$",
            "minLength": 1,
            "maxLength": 64
          }
        },
        "unevaluatedProperties": false
      }
    ]
  },
  "urn:project-gateway:schema:registry:1.0:extension-contract-entry": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:registry:1.0:extension-contract-entry",
    "title": "Registered extension contract entry",
    "type": "object",
    "required": [
      "version",
      "payload_schema_id",
      "semantic_contract_ids",
      "supported_kinds",
      "supported_modes",
      "ignore_safety",
      "deprecation",
      "supersession"
    ],
    "properties": {
      "version": {
        "const": "1.0"
      },
      "payload_schema_id": {
        "const": "urn:project-gateway:schema:artifact:1.0:common:extension-declaration"
      },
      "semantic_contract_ids": {
        "type": "array",
        "minItems": 1,
        "maxItems": 16,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^(ART|TSK|AUT|CTX|CMP|BND|RES|REF|WSP|LIN|REG|LFC|EXE|PUB|MIG|SEC)-[0-9]{3}$"
        }
      },
      "supported_kinds": {
        "type": "array",
        "minItems": 1,
        "maxItems": 6,
        "uniqueItems": true,
        "items": {
          "type": "object",
          "required": [
            "kind_id",
            "kind_version"
          ],
          "properties": {
            "kind_id": {
              "enum": [
                "TaskSpec",
                "AuthorityPolicy",
                "ContextManifest",
                "CompletionContract",
                "ExecutionBundle",
                "ExecutionResult"
              ]
            },
            "kind_version": {
              "const": "1.0"
            }
          },
          "unevaluatedProperties": false
        }
      },
      "supported_modes": {
        "type": "array",
        "minItems": 1,
        "maxItems": 2,
        "uniqueItems": true,
        "items": {
          "enum": [
            "required",
            "optional"
          ]
        }
      },
      "ignore_safety": {
        "enum": [
          "ignore-safe",
          "not-ignore-safe"
        ]
      },
      "deprecation": {
        "$ref": "urn:project-gateway:schema:registry:1.0:deprecation-declaration"
      },
      "supersession": {
        "$ref": "urn:project-gateway:schema:registry:1.0:supersession-declaration"
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:registry:1.0:feature-capability-registration": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:registry:1.0:feature-capability-registration",
    "title": "Registered protocol feature or consumer capability",
    "type": "object",
    "required": [
      "class",
      "id",
      "version",
      "security_review"
    ],
    "properties": {
      "class": {
        "enum": [
          "protocol-feature",
          "consumer-capability"
        ]
      },
      "id": {
        "enum": [
          "project-gateway.conformance-alpha",
          "project-gateway.conformance-beta",
          "project-gateway.conformance-fixture",
          "project-gateway.fixture-consumer",
          "project-gateway.workspace-read",
          "project-gateway.artifact-draft-write",
          "project-gateway.git-read"
        ]
      },
      "version": {
        "const": "1.0"
      },
      "security_review": {
        "$ref": "urn:project-gateway:schema:registry:1.0:governance-security-review"
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:registry:1.0:governance-security-review": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:registry:1.0:governance-security-review",
    "title": "Immutable registry governance and security-review declaration",
    "type": "object",
    "required": [
      "review_id",
      "status",
      "reviewed_at",
      "governing_role"
    ],
    "properties": {
      "review_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/governanceReviewId"
      },
      "status": {
        "const": "approved"
      },
      "reviewed_at": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/timestamp"
      },
      "governing_role": {
        "const": "human-approved-protocol-registry"
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:registry:1.0:protocol-kind-compatibility-declaration": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:registry:1.0:protocol-kind-compatibility-declaration",
    "title": "Exact V1 protocol and kind compatibility declaration",
    "type": "object",
    "required": [
      "artifact_protocol_id",
      "artifact_protocol_version",
      "kind_versions"
    ],
    "properties": {
      "artifact_protocol_id": {
        "const": "project-gateway.artifact"
      },
      "artifact_protocol_version": {
        "const": "1.0"
      },
      "kind_versions": {
        "type": "array",
        "minItems": 6,
        "maxItems": 6,
        "uniqueItems": true,
        "items": {
          "type": "object",
          "required": [
            "kind_id",
            "kind_version"
          ],
          "properties": {
            "kind_id": {
              "enum": [
                "TaskSpec",
                "AuthorityPolicy",
                "ContextManifest",
                "CompletionContract",
                "ExecutionBundle",
                "ExecutionResult"
              ]
            },
            "kind_version": {
              "const": "1.0"
            }
          },
          "unevaluatedProperties": false
        }
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:registry:1.0:registry-namespace-entry": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:registry:1.0:registry-namespace-entry",
    "title": "Registry namespace entry",
    "type": "object",
    "required": [
      "namespace",
      "owner_id",
      "security_review",
      "extension_contracts"
    ],
    "properties": {
      "namespace": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/namespace"
      },
      "owner_id": {
        "const": "project-gateway.protocol-registry"
      },
      "security_review": {
        "$ref": "urn:project-gateway:schema:registry:1.0:governance-security-review"
      },
      "extension_contracts": {
        "type": "array",
        "minItems": 1,
        "maxItems": 32,
        "uniqueItems": true,
        "items": {
          "$ref": "urn:project-gateway:schema:registry:1.0:extension-contract-entry"
        }
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:registry:1.0:registry-snapshot": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:registry:1.0:registry-snapshot",
    "title": "Immutable RegistrySnapshot canonical subject",
    "type": "object",
    "required": [
      "registry_protocol_id",
      "registry_snapshot_format_version",
      "canonicalization",
      "snapshot_id",
      "protocol_compatibility",
      "namespace_entries",
      "feature_capability_registrations",
      "governance_security_review",
      "snapshot_digest"
    ],
    "properties": {
      "registry_protocol_id": {
        "const": "project-gateway.registry"
      },
      "registry_snapshot_format_version": {
        "const": "1.0"
      },
      "canonicalization": {
        "const": "jcs-rfc8785-v1"
      },
      "snapshot_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/registrySnapshotId"
      },
      "protocol_compatibility": {
        "$ref": "urn:project-gateway:schema:registry:1.0:protocol-kind-compatibility-declaration"
      },
      "namespace_entries": {
        "type": "array",
        "minItems": 1,
        "maxItems": 64,
        "uniqueItems": true,
        "items": {
          "$ref": "urn:project-gateway:schema:registry:1.0:registry-namespace-entry"
        }
      },
      "feature_capability_registrations": {
        "type": "array",
        "maxItems": 64,
        "uniqueItems": true,
        "items": {
          "$ref": "urn:project-gateway:schema:registry:1.0:feature-capability-registration"
        }
      },
      "governance_security_review": {
        "$ref": "urn:project-gateway:schema:registry:1.0:governance-security-review"
      },
      "snapshot_digest": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/digest"
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:registry:1.0:registry-snapshot-reference",
    "title": "Exact RegistrySnapshotReference",
    "type": "object",
    "required": [
      "registry_protocol_id",
      "registry_snapshot_format_version",
      "registry_snapshot_id",
      "registry_snapshot_digest",
      "protocol_compatibility"
    ],
    "properties": {
      "registry_protocol_id": {
        "const": "project-gateway.registry"
      },
      "registry_snapshot_format_version": {
        "const": "1.0"
      },
      "registry_snapshot_id": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/registrySnapshotId"
      },
      "registry_snapshot_digest": {
        "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/digest"
      },
      "protocol_compatibility": {
        "type": "object",
        "required": [
          "mode",
          "artifact_protocol_id",
          "artifact_protocol_version"
        ],
        "properties": {
          "mode": {
            "const": "exact-release"
          },
          "artifact_protocol_id": {
            "const": "project-gateway.artifact"
          },
          "artifact_protocol_version": {
            "const": "1.0"
          }
        },
        "unevaluatedProperties": false
      }
    },
    "unevaluatedProperties": false
  },
  "urn:project-gateway:schema:registry:1.0:supersession-declaration": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:project-gateway:schema:registry:1.0:supersession-declaration",
    "title": "Registry extension-contract supersession declaration",
    "oneOf": [
      {
        "type": "null"
      },
      {
        "type": "object",
        "required": [
          "successor_namespace",
          "successor_version"
        ],
        "properties": {
          "successor_namespace": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/namespace"
          },
          "successor_version": {
            "$ref": "urn:project-gateway:schema:artifact:1.0:common:identifiers#/$defs/version"
          }
        },
        "unevaluatedProperties": false
      }
    ]
  }
};
