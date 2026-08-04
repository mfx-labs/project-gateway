# Project Gateway MCP — Trusted Lifecycle Protocol

**Status:** Normative WP-2 lifecycle companion
**Companion to:** `docs/design/artifact-identity-versioning-reference-lifecycle-protocol.md`

## Purpose and Scope

This document defines the trusted-local records and transition rules that make artifact lifecycle and execution facts usable without placing those facts in repositories or project-visible artifact content. It covers validation, approval, issuance, revocation, runtime grants, activation, execution occurrences and attempts, result publication, trusted receipts, supersession, audit, and point-of-use verification.

It does not define a database, files, signatures, process topology, UI, schema, API, or retention implementation. A deployment MAY colocate roles, but it MUST preserve the record responsibilities and trust boundaries defined here.

## Trust Boundary and Common Record Rules

All lifecycle records are maintained outside managed repositories by the trusted local control plane. Artifact content, annotations, repository paths, Git history, ChatGPT Web, and producer claims MUST NOT create, alter, revoke, or prove a trusted lifecycle record.

Every trusted record MUST be immutable, have an opaque trusted record ID, identify its creation time and responsible trusted role, and bind exact protocol subjects. A later decision is represented by a new record; it MUST NOT rewrite an artifact revision or earlier record. Exact storage, signature, and audit-log mechanics remain outside scope.

A trusted record subject is always a complete exact subject as applicable:

- artifact protocol and kind version;
- artifact instance ID, revision ID, and canonical digest;
- trusted workspace ID;
- exact reference and exact `RegistrySnapshotReference` where registry-governed semantics are used;
- exact prior lifecycle record IDs; and
- execution occurrence and attempt IDs for execution facts.

A path, filename, display name, alias, `latest` selector, repository location, Git commit, producer attribution, or embedded status is never a trusted record subject.

## Record Taxonomy

### Common conceptual record shape

The following is a normative abstract record shape. It is not a storage schema.

```json
{
  "record_type": "<trusted-record-type>",
  "record_id": "pgw:l:<opaque-128-bit-random-lowercase-hex>",
  "created_at": "<trusted-utc-time>",
  "responsible_role": "<trusted-role>",
  "subject": { "<exact-binding-targets>": "<placeholder>" },
  "correlations": { "<other-exact-record-or-execution-ids>": "<placeholder>" }
}
```

A trusted record ID MUST be opaque, non-reusable, and distinct from every artifact, workspace, registry snapshot, activation, occurrence, attempt, result, reference, and receipt ID. When serialized, trusted timestamps SHOULD use the UTC form `YYYY-MM-DDTHH:MM:SS.sssZ`.

### Record responsibilities

| Record | Sole responsibility | Trust owner / creation authority | Exact subject and bindings | Scope, immutability, and revocation/supersession behavior | Primary consumer | MUST NOT do |
| --- | --- | --- | --- | --- | --- | --- |
| `ValidationRecord` | Preserve one structural/semantic assessment | Recognized structural/semantic validator | Revision, digest, protocol/kind versions, validator profile, exact `RegistrySnapshotReference`, outcomes | Immutable historical assessment; later assessment is a new record, not revocation | Approver, issuer, compatibility evaluator | Approve, issue, grant, activate, or publish a result |
| `ApprovalRecord` | Approve one prospective artifact for a workspace and purpose | Trusted approver | Exact subject, validation record(s), workspace, purpose, required semantic set, exact registry context where required | Immutable revocable usability decision; active only while not revoked/expired/superseded for scope | Issuer and activation authority | Issue, grant, activate, or approve another subject |
| `IssuanceRecord` | Make one approved prospective subject usable for stated scope | Trusted issuer | Exact subject, approval record, workspace, use/consumer class, validity/use bound, permitted registry context | Immutable revocable usability decision; current use requires no applicable revocation/expiry | Activation authority and bounded consumer | Substitute for approval, grant, or activation |
| `RevocationRecord` | Withdraw current usability or publication of one permitted target | Trusted revocation authority | Exact `ApprovalRecord`, `IssuanceRecord`, `RuntimeGrant`, or `ResultPublicationRecord`; scope, effective point, reason | Immutable historical revocation decision; effect checked at point of use | Every point-of-use verifier | Delete content, rewrite history, or revoke an event/assessment fact |
| `RuntimeGrant` | Narrow effective authority for one reserved occurrence | Trusted runtime-grant authority | Bundle, workspace, reserved occurrence ID, allowed attempt bound, validity, narrowed authority | Immutable revocable usability decision; a denied activation permanently closes it for activation/execution use | Activation authority and authority enforcer | Widen ceiling/policy/consumer support, approve, issue, activate, or authorize another reservation |
| `ActivationRecord` | Record exactly one accepted or denied decision for one reserved occurrence | Trusted activation authority | Bundle, workspace, required issuances, runtime grant, reserved occurrence ID, exact registry context, decision | Immutable historical fact; `accepted` creates one occurrence, `denied` permanently closes reservation and grant | Execution recorder, auditor, and evaluator correlator | Alter bundle, create authority beyond grant, become a receipt/result, or reuse the reservation |
| `ExecutionOccurrenceRecord` | Establish a successful activation's one execution subject | Trusted control plane | Accepted activation, bundle, workspace, occurrence ID, grant | Immutable historical fact; one and only one may exist for accepted activation | Attempt recorder, evaluator, result publisher, and auditor | Report an attempt outcome, exist after denial, or evaluator conclusion |
| `ExecutionAttemptRecord` | Establish one ordered execution run within an occurrence | Trusted execution recorder | Accepted activation, occurrence, attempt ID, ordinal, grant-use correlation | Immutable historical fact; each started attempt gets one | Receipt producer, evaluator, result publisher, and auditor | Change bundle/workspace/grant, exist without accepted occurrence, or publish a result |
| `TrustedReceipt` | Report trusted lifecycle or execution event facts | Trusted receipt producer | Exact event subject; occurrence/attempt where applicable; event time/disposition | Immutable historical fact; can corroborate later result publication | Point-of-use verifier and privileged result consumer | Become `ExecutionResult`, approve, alter requirements, or be revoked as an erased fact |
| `ResultPublicationRecord` | Attest evaluator provenance, unique result-instance association, and result use scope | Trusted result publisher after compatible evaluator action | Unique result instance, result revision/digest, evaluator, validation, bundle, workspace, occurrence, attempt, receipt correlation when required, exact registry context, scope | Immutable revocable publication decision; one current publication per instance/scope requires no revocation/supersession | Review, completion, automation, and reporting consumers | Replace receipt, grant authority, issue a prospective artifact, or publish a second result instance for the attempt |
| `SupersessionRecord` | Select a successor for a stated use/reporting scope | Trusted lifecycle authority | Prior subject/record, successor subject/record, scope, reason | Immutable historical decision; later supersession may select another current subject but cannot revoke this event | Lifecycle resolver and scoped consumer | Mutate content, transfer lifecycle authority implicitly, or switch a result attempt to another instance |
| `ExecutionSummaryRecord` | Correlate ordered per-attempt history for trusted reporting | Trusted reporting authority | Occurrence and exact attempt/receipt/result-publication links | Optional immutable historical reporting fact | Reporting reviewer or auditor | Become a core result, completion proof, or revocable event fact |
| `MigrationRecord` | Correlate exact old/new protocol subjects | Trusted migration authority | Old/new exact subjects and reviewed transformation profile | Immutable historical fact; no artifact lineage, identity, or lifecycle transfer | Migration resolver and historical reader | Convert path/import claim into approval or issuance, or represent migration as lineage |
| `AuthoritativeAuditEvent` | Preserve an audit fact about a trusted record/event | Trusted control plane | Exact record/event, actor role, time, correlations | Immutable, append-only historical fact | Auditor and control-plane reviewer | Replace its primary lifecycle record or be revoked as an erased fact |

### Revocation taxonomy and historical fact preservation

Only `ApprovalRecord`, `IssuanceRecord`, `RuntimeGrant`, and `ResultPublicationRecord` are revocable usability or publication records. A `RevocationRecord` MAY target only one exact record of one of those types for a stated scope. Revocation never deletes artifact content or trusted records.

`ValidationRecord`, `ActivationRecord`, `ExecutionOccurrenceRecord`, `ExecutionAttemptRecord`, `TrustedReceipt`, `ExecutionSummaryRecord`, `MigrationRecord`, `SupersessionRecord`, and `AuthoritativeAuditEvent` are historical fact or assessment records. They MUST NOT be revoked as though the underlying event never occurred. A later `ValidationRecord` MAY supersede an earlier assessment for a stated current use, and a later trusted record MAY mark an earlier fact obsolete, superseded, contradicted, or unacceptable for a defined current use, but neither may mutate or erase it. `SupersessionRecord` is itself historical and cannot be revoked by later supersession.

`ValidationRecord` records a conformance assessment. A control plane MAY require it before approval, but the record itself remains non-authorizing. `AuthoritativeAuditEvent` is an audit correlation fact and does not replace the record whose action it describes.

## Lifecycle Model for Prospective Artifacts

### Separate state categories

The protocol distinguishes these categories rather than embedding an all-purpose status field in an artifact:

| Category | Meaning | Where it exists |
| --- | --- | --- |
| Draft content | Producer-proposed project-visible content | Artifact document or pre-envelope working content |
| Canonical revision | Immutable canonical artifact projection with registered ID and digest | Artifact document plus identity registration |
| Validation assessment | Structural and semantic conformance result | `ValidationRecord` |
| Approval state | Trusted acceptance for a workspace and purpose | `ApprovalRecord` and current revocation state |
| Issuance state | Trusted availability for a defined consumer/use | `IssuanceRecord` and current revocation state |
| Execution eligibility | Current ability to activate a bundle | Point-of-use decision over all records/configuration |
| Runtime activation | Trusted decision plus occurrence creation | `ActivationRecord` and `ExecutionOccurrenceRecord` |

The protocol recognizes the words `draft`, `structurally valid`, `semantically valid`, `validated`, `approved`, `issued`, `revoked`, and `superseded` only through this model. A document field claiming one of them has no authoritative effect.

### Transition model

```text
untrusted draft
  -> canonical revision and identity registration
  -> ValidationRecord(s) with structural and semantic pass
  -> active ApprovalRecord for exact workspace/purpose
  -> active IssuanceRecord for exact workspace/use
  -> current eligibility check
  -> RuntimeGrant with reserved occurrence ID
  -> one immutable ActivationRecord (`accepted` or `denied`)
  -> ExecutionOccurrenceRecord only when accepted
  -> zero or more ExecutionAttemptRecord / TrustedReceipt facts
```

A failed or denied decision is still auditable but does not silently advance the subject. No arrow in this model implies the next one.

### Validation

Validation is external and reproducible. A `ValidationRecord` MUST identify the exact artifact revision/digest, validator profile, protocol and kind version, exact `RegistrySnapshotReference`, structural outcome, semantic outcome, and relevant exact-reference/compatibility findings. Every digest-covered string MUST already be Unicode NFC. A non-NFC string MUST be rejected. The protocol MUST NOT silently normalize artifact content. Structural validation MUST reject duplicate member names before parser ambiguity, invalid Unicode or unpaired surrogates, and any digest-covered string that is not already NFC. It MUST NOT silently normalize, rewrite, repair, or replace artifact strings; RFC 8785 JCS serializes only the accepted data model.

A successful validation assessment MUST NOT establish approval, issuance, consumer support, workspace authorization, runtime grant, activation, or result publication. A later registry snapshot, workspace, or consumer change can make current use ineligible without rewriting the historical validation fact.

### Approval

An `ApprovalRecord` MAY apply only to `TaskSpec`, `AuthorityPolicy`, `ContextManifest`, `CompletionContract`, or `ExecutionBundle`. It MUST bind:

- exact protocol ID/version, kind ID/version, instance ID, revision ID, and canonical digest;
- one trusted workspace ID;
- a specific approved purpose;
- exact successful validation record(s);
- the required extension/feature context and exact accepted `RegistrySnapshotReference` or exact accepted registry context;
- the trusted approver role; and
- any explicit validity end or additional narrowing condition.

Approval is workspace-scoped even for portable task and completion revisions. A portable revision can receive multiple separate approvals for different workspaces. No approval may be widened, copied, or replayed to another workspace, another revision, a different purpose, or a changed extension set.

### Issuance

An `IssuanceRecord` MAY apply only to an approved prospective artifact or bundle. It MUST bind the exact approved subject, active approval record, workspace, intended use or consumer class, and any validity or use-count bound.

All four exact prospective members of a consumable bundle MUST each have their own active workspace-scoped approval and issuance. The bundle MUST have its own active workspace-scoped approval and issuance. Neither bundle issuance nor bundle approval substitutes for a referenced artifact's issuance or approval, and the inverse is also prohibited.

Bundle issuance defaults to one successful activation. A trusted issuer MAY expressly grant a finite larger maximum activation count. Each activation remains a separate decision and occurrence.

### Revocation, expiry, and supersession

A `RevocationRecord` targets only an `ApprovalRecord`, `IssuanceRecord`, `RuntimeGrant`, or `ResultPublicationRecord`, rather than editing an artifact or revoking a historical event. It MUST specify the exact target, effect scope, effective point, and reason. A revoked approval prevents future matching issuance and activation. A revoked issuance prevents future matching activation. A revoked grant prevents further grant use. A revoked publication prevents use under its publication scope. Validation assessments, activation decisions, occurrences, attempts, receipts, summaries, migrations, supersessions, and audit events remain immutable historical facts.

A validity end is a record-level limit, not a mutable artifact state. When a record expires, it cannot be used for its intended scope. Reissuance after an issuance revocation or expiry requires a new issuance based on a currently valid matching approval and current checks. A revocation does not silently reinstate itself.

A `SupersessionRecord` identifies a successor for an explicit purpose. It does not mutate, delete, revoke, or automatically transfer approval/issuance from the previous subject. Historical artifacts and records remain inspectable subject to independent read policy.

### Current-use effects of trusted configuration changes

Changes in trusted extension-registry policy, consumer support, workspace ceilings, or global ceilings do not rewrite historical lifecycle records. They are evaluated at point of use:

- a required extension removed or unsupported by the current exact accepted registry snapshot context blocks consumption;
- a consumer that no longer supports a required semantic blocks its own consumption;
- a changed workspace or global ceiling can make effective authority ineligible for activation or a later authority-dependent action; and
- unavailable current trusted state blocks authority-dependent use.

## Runtime Grant, Activation, Occurrence, Attempt, and Retry Protocol

### Reserved occurrence identity

The trusted control plane allocates a fresh opaque occurrence ID using `pgw:o:` plus 32 lowercase hexadecimal characters before or atomically with the grant/activation decision. Before successful activation, it is a reserved identifier only; it is not yet an occurrence and MUST NOT be reported by an `ExecutionResult`. One reserved occurrence ID MAY be used by exactly one activation decision.

A `RuntimeGrant` is per execution occurrence. It binds that reserved occurrence ID, one exact bundle revision, one trusted workspace, an explicit finite attempt allowance, validity boundaries, and only narrowed effective authority. It cannot authorize another occurrence, a different bundle, a different workspace, or greater authority. A denied activation permanently closes its grant for activation and execution use; a later request requires a fresh reservation and fresh grant.

### Activation

An activation authority MUST accept an activation only when all of these checks pass for the same workspace:

1. the exact bundle reference resolves and its digest verifies;
2. the bundle contains exactly one exact `TaskSpec`, `AuthorityPolicy`, `ContextManifest`, and `CompletionContract` revision;
3. each required prospective subject and the bundle have active matching approval and issuance;
4. all required protocol features, capabilities, extensions, consumer support, and exact permitted registry snapshot context are available;
5. all core bindings resolve to the bundle workspace and no unauthorized cross-workspace reference exists;
6. current revocation and validity status is available and permits use;
7. global ceiling, workspace ceiling, approved policy, runtime grant, and consumer support intersect without an attempted expansion; and
8. the bundle issuance has remaining activation use.

Every activation decision MUST create exactly one immutable `ActivationRecord` whose decision is `accepted` or `denied`. An accepted record permanently consumes the reserved occurrence ID and creates exactly one `ExecutionOccurrenceRecord` with that ID; attempts may occur only under that occurrence and grant. A denied record MUST create no occurrence and no attempt, permanently closes the reserved occurrence ID and associated runtime grant for activation and execution use, and MAY have a trusted receipt/audit event explaining the denial. It MUST NOT later become accepted or produce an evaluator-produced `ExecutionResult`.

A later activation request MUST allocate a fresh reserved occurrence ID, fresh `RuntimeGrant`, and new `ActivationRecord`. No occurrence ID may have more than one activation decision, both denied and accepted decisions, or more than one occurrence record. Revoking a grant after accepted activation can block later grant-dependent actions or retries, but does not erase the historical activation, occurrence, or already-recorded attempts.

### Occurrence and attempt cardinality

One execution occurrence has one exact bundle, workspace, activation, and occurrence runtime grant. It has zero or more ordered attempts. An attempt begins only when an `ExecutionAttemptRecord` is created. Its ordinal begins at one and increases by one without duplication for that occurrence.

A retry is an attempt with ordinal greater than one. It MUST retain the same occurrence, bundle, workspace, and grant. It MAY reuse the occurrence grant only while its explicit attempt allowance has remaining capacity, its validity window has not ended, it is not revoked, and every required point-of-use check remains valid. A retry must not change policy, context, task, completion, extension set, consumer compatibility, or workspace through retry metadata.

A new activation creates a new occurrence and therefore a new grant. A retry is not a new activation. An activation denial creates no attempt. A cancelled occurrence before any attempt has an occurrence receipt but no attempt. A started attempt that is abandoned, rejected, denied during enforcement, cancelled, timed out, crashed, or otherwise incomplete MUST have an attempt record and trusted receipt(s) describing the trusted facts available.

### Results and retry grouping

The protocol never fabricates an evaluator observation. An attempt may have no evaluator-produced result when an evaluator cannot produce a compatible result. That absence blocks completion-status use, automation, and authoritative result reporting; it does not erase trusted execution receipts. Candidate forms may be multiple provisional drafts, but they have no trusted attempt-to-result-instance ownership.

The first successful compatible evaluator adoption or origination for an exact workspace, bundle, occurrence, and attempt MUST atomically establish the one unique evaluator-produced `ExecutionResult` instance for that attempt in trusted correlation state. A second distinct result instance for that attempt is prohibited. Every correction, clarification, or replacement MUST retain that result instance ID, create a new immutable successor revision, and retain the exact workspace, bundle, occurrence, and attempt association. Multiple distinct attempts and occurrences may refer to the same bundle. A core `ExecutionResult` MUST NOT aggregate retries.

If an aggregate retry view is required, a trusted `ExecutionSummaryRecord` MAY correlate exact ordered attempt, receipt, and result-publication facts. It is reporting state only; it MUST NOT alter per-attempt result meaning, create authority, or serve as prospective completion proof.

## ExecutionResult Provenance, Publication, and Consumption

### Candidate versus evaluator-produced content

A candidate `ExecutionResult` is untrusted project-visible content. Its kind, body, annotation, path, author name, or result-like appearance cannot establish evaluator provenance or the unique result-instance association for an attempt.

The first compatible completion evaluator may do one of two things after structural and semantic validation:

- **originate** one new immutable result instance for the attempt; or
- **adopt** one exact validated candidate revision, atomically establishing its instance as the unique evaluator-produced instance for that attempt without changing its digest-covered content.

In either case, a trusted result publisher MUST create a `ResultPublicationRecord` binding that unique instance. This is the sole protocol fact that makes the result evaluator-produced and published for a stated scope. Once the association exists, an evaluator MUST NOT originate or adopt a different result instance for the same attempt. The evaluator remains the result producer; the trusted publisher does not rewrite the retrospective body or become the receipt producer.

### Publication prerequisites and bindings

A `ResultPublicationRecord` MUST bind:

- the unique result instance ID plus exact result protocol/kind version, revision ID, and canonical digest;
- the compatible evaluator identity and capability/profile identity recognized by trusted local policy;
- whether the evaluator originated or adopted the result;
- exact passing result `ValidationRecord`;
- exact reported `ExecutionBundle` revision and its digest;
- exact trusted workspace ID;
- exact execution occurrence and attempt ID;
- the publication consumption scope;
- exact registry snapshot context; and
- exact trusted receipt correlation whenever a scope requires it.

A result publication MAY have `ordinary-review` scope after validation and evaluator provenance are verified. It MUST have exact matching trusted receipt correlation before it includes `completion-status`, `downstream-automation`, or `authoritative-reporting` scope. For one result instance and one publication scope, at most one active current publication MAY apply; a later current publication for that scope MUST explicitly supersede or revoke the earlier current publication. A result publisher MUST reject a publication whose unique result instance, result revision, bundle, workspace, occurrence, attempt, evaluator profile, registry context, or receipt correlation does not match.

### Consumption rules

| Intended use | Minimum condition | Receipt correlation required? |
| --- | --- | --- |
| Untrusted inspection by local human or ChatGPT | Project-visible candidate or any result content under ordinary read policy | No |
| Ordinary review of evaluator-produced result | Validated result plus active `ResultPublicationRecord` with evaluator provenance and `ordinary-review` scope | No |
| Completion-status consumption | Active publication with `completion-status` scope, matching receipt correlation, current non-revocation, compatible evaluator/consumer support | Yes |
| Downstream automation | Active publication with `downstream-automation` scope, matching receipt correlation, current non-revocation, compatible consumer support, and independent authority where actions occur | Yes |
| Authoritative reporting | Active publication with `authoritative-reporting` scope, matching receipt correlation, current non-revocation, compatible reporting consumer | Yes |

No result use can widen authority. Automation still needs independent effective authority, including applicable ceilings, policy, grant, and consumer support. A publication does not issue or activate a bundle and does not replace trusted receipts.

### Corrections, withdrawal, and historical auditability

A correction to result body, occurrence/attempt claim, bundle reference, evidence reference, extension, or other digest-covered content creates a new immutable revision of the same unique result instance. The correction MUST retain the same workspace, bundle, occurrence, and attempt association. The earlier revision remains historical project-visible content. It is not edited or deleted.

A later valid result publication may be linked to the earlier publication by `SupersessionRecord` only within the same result instance. The record identifies the exact prior and successor publication and the affected use scope. It does not transfer receipt correlation, evaluator provenance, or attempt association without binding them again.

A `RevocationRecord` may withdraw a publication for a stated scope. It does not delete the result or make its earlier observations disappear. A withdrawn result MAY remain inspectable as untrusted historical content but MUST NOT be used through the revoked publication scope.

## Trusted Receipts and Audit Requirements

A `TrustedReceipt` is a distinct trusted local fact record. It MAY attest an approval, issuance, revocation, grant use, activation decision, occurrence start, attempt start/end, enforcement denial, cancellation, timeout, crash, result-publication correlation, or other control-plane event. It MUST identify its exact event subject and correlation context.

An `ExecutionResult` may report observations that align with a receipt, but it MUST NOT contain, replace, or establish a receipt. A result's claim that an occurrence happened is untrusted until a trusted record independently corroborates it for any receipt-required use.

The control plane MUST produce authoritative audit events for creation, revocation, expiry evaluation where material, activation decision, occurrence/attempt transition, result publication, supersession, and receipt correlation decisions. Audit events MUST preserve correlation to exact underlying records. They MUST NOT become an alternate shortcut that bypasses the primary record's validation rules.

## Point-of-Use Verification

A consumer or control-plane role MUST verify the required current facts at the point each privileged use occurs.

| Use | Required current verification |
| --- | --- |
| Structural/semantic validation | Exact envelope, canonical digest, identity/lineage/binding continuity, reference resolution, exact `RegistrySnapshotReference`, responsibility boundaries |
| Approval | Passing validation, exact subject, workspace/purpose scope, exact required registry context, approver independence and policy |
| Issuance | Active matching approval, permitted current registry context, current revocation/expiry, workspace and intended use |
| Bundle activation | All exact references; all four individual and bundle approvals/issuances; workspace; exact registry/consumer support context; ceilings; policy; grant; issuance use count; current revocation |
| Authority-dependent execution action | Current effective authority and grant use, current revocation, supported capability, normal workspace/read policy |
| Retry | Same occurrence/bundle/workspace/grant, remaining grant attempt allowance, current validity/revocation/support |
| Evaluator-produced ordinary review | Unique result-instance association, result validation, evaluator provenance, active ordinary-review publication, exact registry context |
| Completion, automation, authoritative reporting | Unique result-instance association, result publication scope, matching receipt correlation, current revocation, exact compatible registry/consumer support context; independent authority where action is taken |

When a required trusted record, exact registry snapshot context, revocation state, workspace configuration, consumer support declaration, unique result-instance association, or receipt correlation cannot be established, the affected authority-dependent use MUST fail closed. Untrusted inspection may remain available under separate ordinary read policy.

## Prohibited Shortcuts

The following shortcuts are prohibited:

- treating validation as approval, approval as issuance, issuance as activation, or a grant as a capability expansion;
- treating a bundle as a lifecycle record, activation command, or source of runtime authority;
- treating a repository document, annotation, path, Git revision, or producer claim as lifecycle state;
- treating a result publication as a trusted receipt or prospective issuance;
- treating a receipt as an evaluator result or a completion contract;
- treating retry metadata as permission to change a bundle, workspace, policy, context, completion contract, or consumer support;
- treating a historical record's continued inspectability as current usability; and
- deleting or rewriting an artifact or trusted record to express revocation, correction, or supersession.

## Lifecycle Completion Criteria and Handoff

Later lifecycle, validator, registry, adapter, and conformance work MUST preserve this record separation and implement no storage or topology shortcut that collapses it. In particular, later work must provide:

1. exact-subject binding and current-record evaluation for every trusted decision;
2. atomic or equivalently safe occurrence-ID reservation, one accepted-or-denied activation decision, terminal denied-grant closure, and occurrence correlation;
3. explicit per-attempt records and receipt facts;
4. one-result-instance-per-attempt correlation plus result publication only after evaluator provenance and validation;
5. receipt correlation before completion-status, automation, or authoritative reporting;
6. append-only revocation and supersession behavior that revokes only usability/publication records, not historical facts;
7. exact registry snapshot context and workspace-scoped approval and issuance; and
8. fail-closed behavior when trusted local state is unavailable.

This document defines protocol responsibilities only. It does not authorize lifecycle storage, runtime execution, or implementation work.
