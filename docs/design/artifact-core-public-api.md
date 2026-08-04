# Artifact Core Public API

**Status:** Normative WP-4 API design
**Package:** `@project-gateway/artifact-core`

## Operations

| Operation | Signature summary | Notes |
| --- | --- | --- |
| `parseRawJsonInput` | `(bytes\|string, {subjectClass}) → {ok, model} \| {ok:false, report}` | Duplicate-member rejection, bounds, Unicode checks. |
| `createSchemaRegistry` | `() → SchemaRegistry` | Fresh offline registry per instance; 51 resources compile eagerly. |
| `validateArtifactSelf` | `(model, registry, inputs?) → report & {value?}` | Pipeline through semantic self-validation; wrapper level `self-semantic-valid`. |
| `validateArtifactRevision` | `(model, registry, through, inputs?) → report & {value?}` | Controlled pipeline through an explicit phase; no ambiguous default; wrapper level reflects the phase. |
| `validateArtifactForUse` | `(model, registry, inputs, requestedUse) → report & {value?}` | Full pipeline with existing-registration identity verification, exact bundle-member resolution (registry + consumer support context), and exact lifecycle-chain effective-authority evaluation; fails closed on missing registry/resolver/identity/lifecycle/grant inputs. |
| `validateArtifactInput` | `(bytes\|string, registry, opts) → report & {value?}` | Raw intake plus full validation. |
| `validateRegistrySnapshot` | `(model, registry) → report & {value?}` | Canonical-input, structural, digest, and semantic registry checks. |
| `validateLifecycleRecord` | `(model, registry) → report & {value?}` | Structural record validation and schema identification. |
| `computeArtifactDigest` / `computeRegistryDigest` | `(model) → {canonicalUtf8, digest, domain}` | Domain-separated SHA-256 over the approved projection. |
| `verifyArtifactDigestValue` / `verifyRegistryDigestValue` | `(model, declared) → boolean` | Exact normalized digest comparison. |
| `resolveExactArtifactReference` | `(reference, registry, {identity, resolver}) → report & {value?}` | Self resolution: target fully revalidated through self-semantic validation; never claims registry compatibility. |
| `resolveExactArtifactReferenceForUse` | `(reference, registry, {identity, resolver, registryContext, consumerSupport, workspaceId?}) → report & {value?}` | For-use resolution: target revalidated through registry compatibility and consumer support; `registry-compatible` only after actual registry evaluation. |
| `validateReferenceModel` / `validateReferenceModelForUse` | `(model, context) → report & {value?}` | Self and for-use exact-reference validation primitives. |
| `validateLifecycleGraph` | `(records, entryRecordIds, registry, artifactMaps, results, entryInstances) → report` | Pure graph evaluation. |
| `evaluatePointOfUseEligibility` | `(inputs) → EligibilityReport` | Complete effective authority over the exact bundle and its exact lifecycle chain; every input is decision-bearing; missing required state fails closed. |
| `ConformanceRunner` | `new ConformanceRunner().run() → summary` | Executes the complete embedded WP-3 manifest. |

## Validated Wrappers

Every wrapper carries an explicit `level` and a runtime brand checked by public
membership guards (`isBrandedArtifact`, `isBrandedRegistry`, `isBrandedRecord`);
unvalidated JSON can never be confused with validated subjects, and a
caller-created lookalike, spread, clone, or proxy fails the brand guard.
Membership branding is module-private (`WeakSet`): no brand symbol or property
is stored on the wrapper, `Object.getOwnPropertySymbols(wrapper)` reveals
nothing, and membership is valid only within the physical module instance that
created the wrapper.

Unvalidated JSON can never be confused with validated subjects:

- `AcceptedModel` — a parsed, canonical-input-validated data model;
- `ValidatedArtifact` — structurally and canonically validated artifact revision
  (kind, instance ID, revision ID, digest, canonical UTF-8, frozen model);
- `ValidatedRegistrySnapshot` — validated snapshot with `snapshotId` and digest;
- `ValidatedLifecycleRecord` — structurally validated record.

Each wrapper carries a unique brand membership and exposes a frozen model; the
library never mutates caller-owned input. The `level` on a wrapper records the
highest phase that actually executed; `isLevelAtLeast(level, required)`
implements the validation-level guard so a lower-level wrapper is never
accepted where a higher-level wrapper is required.

## Injected Interfaces

`RequestedUse` (capability, capability version, operation class, resource class, scope, workspace) is the exact operation evaluated at point of use; `RevocationView` supplies effective revocations by target record; `IdentityStateView` supplies registration state that the library only verifies (existing-registration mode) or checks for proposed conflicts (`identity-registration` phase) — it never registers.

- `IdentityStateView` — `findInstance`, `findRevision`, `findPredecessor`.
- `ExactSubjectResolver` — `resolve(reference)`; returned subjects are untrusted.
- `AcceptedRegistryContext` — protocol id/format/snapshot id/digest plus the
  validated snapshot.
- `ConsumerSupportDeclaration` — supported features, capabilities, and extension
  namespaces.
- `LifecycleStateView` — accepted records by ID.
- `RevocationView` — effective revocations by target record ID.
- `PointOfUseInputs` — current time, ceilings, support, identity, resolver,
  registry, lifecycle, revocations, the exact `bundle` (required), the
  resolved `policy` (required), and an optional `grant` hint (located and
  correlated from the lifecycle records when absent).

`MemoryIdentityState` is provided for tests and the conformance runner only; it
is not persistent storage.

## Protocol Equality

Workspace bindings, exact artifact references, and bundle references are
compared by explicit protocol fields only (`mode` and `workspace_id` for
bindings; protocol version, artifact kind and kind version, instance ID,
revision ID, canonical digest, and workspace binding for references). Ordinary
JSON member insertion order is irrelevant to equality, and ordinary
`JSON.stringify` is not a protocol equality mechanism (the RFC 8785 canonical
serializer remains digest output only). Missing or structurally invalid fields
fail closed; accessors are never invoked and inherited properties are never
consulted.

## Error/Report Model

Expected invalid input returns a typed `ValidationReport` rather than throwing:

- `ok`; `firstFailingPhase`; `category` (stable WP-3 failure category);
- `schemaId`; `subjectIdentity`; `ruleIds`; `findings`.

Each finding carries `phase`, `category`, `ruleIds`, optional `schemaId` /
`subjectIdentity` / JSON-pointer `location`, a stable `messageKey`, and a
deterministic `message`. Findings sort by phase, category, rule ID, subject
identity, location, then message key. No absolute filesystem path ever appears
in a report. Unexpected programmer errors may throw but are never presented as
conformance failures, and Ajv-specific error objects never leak into the API.

## Compatibility and Versioning

The package is private (`"private": true`) during development and exposes only
reviewed public modules through `src/index.ts` plus the `exports` map
(`dist/index.js`, `dist/index.d.ts`). Internal registries, parser internals, and
dependency-specific objects are never exported. API changes follow the
WP-2 major/minor classification once the package is released.
