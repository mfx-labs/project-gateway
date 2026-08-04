# Project Gateway MCP — Structural Validation Profile

**Status:** Normative WP-3 validation profile
**Companion documents:** `artifact-schema-and-validation-profile.md` and `semantic-validation-rules.md`

## Purpose

Structural validation determines whether raw untrusted input can become one accepted JSON data model governed by one local V1 schema resource. It establishes conformance only. It MUST NOT approve, issue, grant, activate, publish, establish evaluator provenance, establish trusted workspace registration, or create any trusted lifecycle fact.

This profile applies to artifact revisions, registry snapshots, exact references, trusted lifecycle records, and fixtures. The semantic and trusted phases that follow are mandatory whenever their inputs are required for consumption.

## Normative Ordered Pipeline

A validator MUST execute applicable phases in this order. A failure in an earlier required phase prevents all later authority-dependent use.

| Phase | Name (manifest `validation_phase`) | Applies to | Required action | Failure categories |
| ---: | --- | --- | --- | --- |
| 1 | Raw JSON intake (`raw-json-intake`) | Artifact, registry, lifecycle, raw fixture | Enforce byte limit before decoding; decode UTF-8; reject malformed JSON and duplicate member names at every object depth before ordinary object construction; enforce valid Unicode (including unpaired surrogate escapes) and nesting limit | `RAW-PARSE-FAILURE`, `DUPLICATE-MEMBER`, `INVALID-UNICODE`, `RESOURCE-LIMIT` |
| 2 | Canonical-input preconditions (`canonical-input-validation`) | Digest-covered artifact/registry input | Check NFC without transformation; reject unpaired surrogates, non-finite values, unsafe integers, prohibited/null ambiguity, and invalid timestamp form | `NON-NFC-STRING`, `INVALID-UNICODE`, `UNSAFE-INTEGER`, `AMBIGUOUS-VALUE` |
| 3 | Schema identification (`schema-identification`) | All parsed subjects | Identify exactly one local schema from protocol ID/version, kind/type, and registry format; reject producer-controlled or remote substitution | `UNKNOWN-SCHEMA-RESOURCE`, `UNSUPPORTED-PROTOCOL-OR-KIND` |
| 4 | Draft 2020-12 schema validation (`structural-schema-validation`) | Parsed subjects | Validate against the cataloged local schema; enforce closed members, required fields, patterns, enums, local bounds, and explicit nullability | `STRUCTURAL-SCHEMA-FAILURE` |
| 5 | Canonical ordering and derived assertion (`canonicalization-and-digest-verification`) | Artifact/registry subjects | Check canonical ordering of every protocol-defined set-like array (preserving ordered arrays); form the defined projection, serialize with RFC 8785 JCS UTF-8, recompute the domain-separated SHA-256 digest, and compare derived assertions | `CANONICAL-ORDER-FAILURE`, `CANONICALIZATION-FAILURE`, `DIGEST-MISMATCH` |
| 6 | Identity registration (`identity-registration`) | Canonical artifacts | Check registrar-backed instance/revision binding and one generation-zero identity before semantic references use the subject | `IDENTITY-CONFLICT` |
| 7 | Semantic self-validation (`semantic-self-validation`) | Canonical subjects | Apply all applicable self-subject rules from the semantic catalog | Subject-specific semantic category |
| 8 | Exact-reference resolution (`exact-reference-resolution`) | References and compositions | Resolve only exact targets and verify every reference component | `EXACT-REFERENCE-FAILURE` |
| 9 | Cross-artifact/workspace compatibility (`cross-artifact-compatibility`) | Bundle/result/prospective use | Apply aggregate, workspace, lineage, and graph compatibility rules | `WORKSPACE-FAILURE`, `AGGREGATE-RESPONSIBILITY-FAILURE`, `LINEAGE-FAILURE` |
| 10 | Registry compatibility (`registry-compatibility`; registry-subject semantics use `semantic-registry-validation`) | Registry-governed semantics | Verify exact accepted snapshot, registered contracts, ignore safety, and support context | `REGISTRY-INCOMPATIBILITY`, `CONSUMER-SUPPORT-FAILURE` |
| 11 | Trusted lifecycle verification (`trusted-lifecycle-verification`) | Approval, issuance, activation, publication | Verify exact trusted records, current state, reservation cardinality, occurrence/attempt relationships, and provenance | `LIFECYCLE-FAILURE`, `ACTIVATION-FAILURE`, `RESULT-PUBLICATION-FAILURE` |
| 12 | Consumer support verification (`consumer-support-verification`) | Consumption, activation | Verify current consumer support declarations for the exact use | `CONSUMER-SUPPORT-FAILURE` |
| 13 | Point-of-use eligibility (`point-of-use-eligibility`) | Consumption, activation, privileged result use | Verify current support, revocation, ceilings, grant, receipt correlation, and use-specific eligibility | `RECEIPT-CORRELATION-FAILURE`, `CONSUMER-SUPPORT-FAILURE`, `POINT-OF-USE-FAILURE` |

Phases 1 through 5 are the structural/canonical pipeline. Phases 6 through 13 are semantic or trusted checks, listed here to make the complete pipeline unambiguous. A fixture that fails at a later phase must pass every earlier required phase; the manifest records the actual first failing phase for every fixture.

## Raw Intake Rules

1. Inputs are raw UTF-8 octets, not preconstructed language-native objects.
2. Artifact input is limited to 1 MiB, registry input to 512 KiB, lifecycle input to 256 KiB, and all input to at most 32 JSON nesting levels.
3. A duplicate key MUST be detected and rejected before an ordinary parser can discard, overwrite, or select one occurrence. A parser mode that silently retains first or last duplicate is nonconformant.
4. Invalid UTF-8, invalid JSON escapes, and unpaired Unicode surrogate code points MUST be rejected. A replacement character or repair is not permitted.
5. `.json.raw` fixtures are raw-input test subjects. A runner MUST feed their literal bytes to phase 1 and MUST NOT parse-and-reserialize them before evaluation.

## Canonical-Input Rules

The artifact and registry profiles use RFC 8785 JCS only after the accepted data model passes the following preconditions:

- Every digest-covered string is already Unicode NFC. A non-NFC string fails; no implementation may normalize, rewrite, repair, or replace it.
- All digest-covered JSON numbers are safe integers in the inclusive range `-9007199254740991` through `9007199254740991`.
- Semantic decimals, arbitrary-precision values, binary data, and opaque byte sequences use a registered string representation rather than JSON numbers.
- `null` is valid only where the selected schema explicitly permits it. Missing and `null` are distinct.
- Digest-covered timestamps use `YYYY-MM-DDTHH:MM:SS.sssZ` exactly.
- Ordered arrays retain their declared order. Set-like arrays must be unique and already sorted by their documented canonical identifier.

NFC checking and unpaired-surrogate detection must also be independently performed by a conforming canonicalizer because JSON Schema cannot reliably establish all Unicode conditions across runtimes.

## Schema Selection and Offline Resolution

Artifact selection uses the exact `protocol.id`, `protocol.version`, `protocol.canonicalization`, `kind.id`, and `kind.version`. Lifecycle selection uses `record_type`; registry selection uses the registry protocol ID and format version. The local catalog maps those selectors to stable URN resource identities.

A producer, repository file, artifact extension, annotation, registry label, URL, path, or `$schema` value MUST NOT select another schema. Every external `$ref` is an absolute schema URN matching the target resource’s exact `$id`; fragment-only references are allowed only within the same resource. Resolution uses the catalog’s `$id`-to-resource registry under standard Draft 2020-12 URI rules; catalog paths are packaging locations only, and no custom relative-file resolver or network retrieval is permitted during validation. `format` is annotation-only and is never a security decision.

## Canonical Projection and Digest Checks

For an artifact, phase 6 omits only `annotations` and `revision.digest` from the canonical projection. It uses:

```text
SHA-256(UTF-8("PGAP-ARTIFACT-REVISION-v1\u0000") || JCS(projection))
```

For a registry snapshot, phase 6 omits only `snapshot_digest` and uses:

```text
SHA-256(UTF-8("PGAP-REGISTRY-SNAPSHOT-v1\u0000") || JCS(projection))
```

The serialized assertion is `sha-256:` plus 64 lowercase hexadecimal characters. Artifact and registry domains are distinct and non-substitutable. A source file hash, Git object ID, pretty-printed serialization, annotations, raw source bytes, or another domain is never a substitute.

## Canonical Set Ordering

The following arrays are set-like and must be unique and canonical-order checked at phase 5:

| Array | Canonical key |
| --- | --- |
| `requirements.protocol_features` | `class:id:version` |
| `requirements.consumer_capabilities` | `class:id:version` |
| `extensions` | `namespace:version` |
| Policy required semantics | `class:id:version` |
| Registry namespace entries | `namespace` (sortedness at phase 5; uniqueness of the namespace/version registration pair is the semantic rule `REG-003` at phase 10, while schema `uniqueItems` rejects structurally identical entries at phase 4) |
| Registry extension contracts | `version` |
| Registry feature/capability registrations | `class:id:version` |
| Lifecycle record-ID sets | lexicographic record ID |
| Result publication scopes | enum spelling |

Arrays such as task instructions, expected deliverables, context items, checks, bundle member fields, attempts, and result observations are ordered sequences. Their order is canonical content and must not be sorted by a validator.

## Failure Model

A conforming implementation reports stable categories, not implementation exception strings:

| Category | Meaning |
| --- | --- |
| `RAW-PARSE-FAILURE` | Input cannot be parsed as valid raw JSON. |
| `DUPLICATE-MEMBER` | A duplicate object member was observed before object construction. |
| `INVALID-UNICODE` | UTF-8 or Unicode scalar validity failed. |
| `NON-NFC-STRING` | A digest-covered string was not already NFC. |
| `UNSAFE-INTEGER` | A digest-covered numeric value is outside the safe-integer contract. |
| `RESOURCE-LIMIT` | A protocol input bound was exceeded. |
| `UNKNOWN-SCHEMA-RESOURCE` | No cataloged exact schema is available. |
| `UNSUPPORTED-PROTOCOL-OR-KIND` | The declared protocol/kind contract is not supported. |
| `STRUCTURAL-SCHEMA-FAILURE` | A Draft 2020-12 local structural contract failed. |
| `CANONICAL-ORDER-FAILURE` | A set-like array is duplicated or not canonically sorted. |
| `CANONICALIZATION-FAILURE` | The accepted data model cannot produce the required canonical bytes. |
| `DIGEST-MISMATCH` | A derived digest assertion does not equal recomputation. |
| `IDENTITY-CONFLICT` | Instance/revision identity registration conflicts. |
| `LINEAGE-FAILURE` | Predecessor, generation, one-parent, or continuity invariant fails. |
| `EXACT-REFERENCE-FAILURE` | An exact target cannot be resolved or exactly verified. |
| `WORKSPACE-FAILURE` | Binding, trusted scope, or cross-workspace compatibility fails. |
| `AGGREGATE-RESPONSIBILITY-FAILURE` | Content crosses an artifact sole-responsibility boundary. |
| `REGISTRY-INCOMPATIBILITY` | Snapshot, contract, namespace, requiredness, or ignore-safety fails. |
| `LIFECYCLE-FAILURE` | A trusted record/state prerequisite is absent or mismatched. |
| `ACTIVATION-FAILURE` | Activation/reservation/occurrence/attempt invariant fails. |
| `RESULT-PUBLICATION-FAILURE` | Evaluator association, result instance, scope, or publication invariant fails. |
| `RECEIPT-CORRELATION-FAILURE` | A receipt-required result use lacks matching trusted receipt correlation. |
| `CONSUMER-SUPPORT-FAILURE` | Consumer support is unavailable or incompatible. |
| `POINT-OF-USE-FAILURE` | Current revocation, validity, authority, or trusted state prevents the use. |

## Subject-Specific Application

| Subject/use | Required final phase before the stated outcome |
| --- | --- |
| Untrusted draft inspection | Phase 1 only if raw inspection is possible; no authority outcome |
| Canonical artifact revision | Phase 8; no approval/issuance outcome |
| Registry snapshot acceptance | Phase 10 under trusted configuration |
| Trusted lifecycle record creation | Phase 11, by a trusted control-plane role |
| Bundle consumption | Phase 10 plus required current lifecycle phase |
| Activation | Phase 13 with current authority and reservation checks (point-of-use eligibility) |
| Ordinary evaluator-produced result review | Phase 11 with active ordinary-review publication |
| Completion, automation, authoritative result use | Phase 13 with receipt correlation and current support (point-of-use eligibility) |

## Trust Limitations

A successful structural outcome means only that an untrusted value has one accepted shape and, where applicable, canonical bytes/digest. It never means the producer is trusted, a workspace is registered, an identity has authority, a policy is approved, a bundle is issued, an execution is active, a result is evaluator-produced, or a receipt exists. Those claims remain exclusively in semantic/trusted records and point-of-use checks.
