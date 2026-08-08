/**
 * WP-10 Slice 1 — transport-free draft-proposal core.
 *
 * NORMATIVE BASIS (repository authority, not this comment):
 * - WP-10 (roadmap): "Artifact drafting tools. Objective: draft-proposal
 *   creation for the six artifact kinds (WP-1 producer boundary). ...
 *   Prohibited: persistence, approval, issuance. Invariants: drafts never
 *   self-approve." Closure gate: "Drafts validate but never self-approve."
 * - WP-1 artifact responsibility matrix
 *   (`docs/design/artifact-responsibility-matrix.md`): ChatGPT Web and local
 *   humans are the permitted content producers of exactly five PROSPECTIVE
 *   artifacts (TaskSpec, AuthorityPolicy, ContextManifest, CompletionContract,
 *   ExecutionBundle). ExecutionResult is produced only by the completion
 *   evaluator (retrospective) and is NOT ChatGPT-draftable. Trusted lifecycle
 *   records and TrustedWorkspaceConfiguration are not artifacts.
 * - Identity-versioning reference
 *   (`docs/design/artifact-identity-versioning-reference-lifecycle-protocol.md`):
 *   a producer MAY propose an instance ID and revision ID in a draft
 *   (syntactically validated here; assignment/acceptance belongs to the
 *   trusted identity registrar at registration time — NOT this core).
 *   `revision.digest` is DERIVED: it must be the recomputed artifact digest
 *   over the canonical projection and is never producer-supplied.
 *
 * BOUNDARY: this module is transport-free (no MCP SDK, no stdio runtime, no
 * network listener, no ChatGPT connectivity). Draft proposals are in-memory
 * plain data. Nothing here persists, sanctions, mints, activates, revokes,
 * grants, executes, or projects authority. A draft result confers zero
 * authority at any trusted boundary (replay tests prove plain-data
 * lookalikes fail every genuine brand verifier). Deterministic: no clock, no
 * randomness, no process identity.
 *
 * FLOW: closed draft request → duplicate-key-rejecting raw JSON intake
 * (accepted WP-4 scanner, artifact byte limit) → draftable-kind /
 * envelope-kind correlation → derived digest construction (accepted canonical
 * projection) → accepted WP-4 self-validation → immutable draft-proposal
 * result. WP-4 remains the sole validation authority; construction reuses
 * only accepted repository APIs and introduces no second serializer, no
 * second schema, and no second digest computation.
 *
 * SLICE 2 INJECTION SEAM: `createDraftProposalWithSchemaRegistry` is the
 * shared implementation under an explicit host-supplied `SchemaRegistry`
 * (WP-10 host/surface-aware drafting: a selected surface's exact registered
 * registry is the validation context). `createDraftProposal` remains the
 * public/default wrapper that supplies the fresh default registry. The
 * registry is validation context ONLY: injecting one grants no persistence,
 * approval, issuance, activation, execution, or workspace access.
 */
import { parseRawJsonInput, createSchemaRegistry, validateArtifactSelf, computeArtifactDigest } from '../api/validate.js';
import type { SchemaRegistry } from '../schema/registry.js';
import type { ValidatedArtifact, ValidationLevel } from '../api/types.js';

/** Exact ChatGPT-producible (draftable) prospective artifact kinds (WP-1 responsibility matrix). */
export const DRAFTABLE_ARTIFACT_KINDS = ['TaskSpec', 'AuthorityPolicy', 'ContextManifest', 'CompletionContract', 'ExecutionBundle'] as const;
export type DraftableArtifactKindId = (typeof DRAFTABLE_ARTIFACT_KINDS)[number];

/** Exact non-draftable artifact kinds: retrospective/evaluator-owned (WP-1 matrix). */
export const NON_DRAFTABLE_ARTIFACT_KINDS = ['ExecutionResult'] as const;
export type NonDraftableArtifactKindId = (typeof NON_DRAFTABLE_ARTIFACT_KINDS)[number];

/** True only for the exact closed draftable vocabulary (no lookalike/spelling variants). */
export function isDraftableArtifactKind(value: unknown): value is DraftableArtifactKindId {
  return typeof value === 'string' && (DRAFTABLE_ARTIFACT_KINDS as readonly string[]).includes(value);
}

/**
 * One closed draft-proposal request. `kind` is the exact draftable artifact
 * kind and MUST equal the candidate envelope's own `kind.id` (cross-checked;
 * mismatch is a request error). `content` is the raw JSON candidate artifact
 * envelope with `revision.digest` ABSENT (a derived member). No filesystem,
 * root, workspace path, approval/issuance/activation flag, grant, or
 * execution request field exists.
 */
export interface DraftProposalRequest {
  readonly kind: DraftableArtifactKindId;
  readonly content: string;
}

/** Closed draft-core error vocabulary (never errno, paths, stacks, or trusted objects). */
export type DraftErrorCode = 'invalid-draft-request' | 'unsupported-artifact-kind' | 'limit-exceeded' | 'internal-adapter-failure';

export interface DraftErrorResult {
  readonly ok: false;
  readonly error: { readonly code: DraftErrorCode; readonly message: string };
}

/** Bounded finding projection (same subset the WP-9 adapter exposes; no raw message text). */
export interface DraftFinding {
  readonly phase: string;
  readonly category: string;
  readonly ruleIds: readonly string[];
  readonly messageKey: string;
  readonly schemaId?: string;
  readonly subjectIdentity?: string;
  readonly location?: string;
}

/**
 * Valid draft-proposal result. Plain frozen data: the complete candidate
 * envelope (with the derived digest), the accepted WP-4 digest/canonical
 * bytes, and the accepted validation level. The model is the WP-4 snapshot.
 * Presence of this result implies NOTHING about approval, issuance,
 * activation, registration, or executability.
 */
export interface ValidDraftProposalResult {
  readonly ok: true;
  readonly valid: true;
  readonly kind: DraftableArtifactKindId;
  readonly proposal: {
    readonly instanceId: string;
    readonly revisionId: string;
    readonly digest: string;
    readonly canonicalUtf8: string;
    readonly level: ValidationLevel;
    readonly model: ValidatedArtifact['model'];
  };
  readonly validation: { readonly level: ValidationLevel; readonly ruleIds: readonly string[] };
}

/**
 * Invalid draft-proposal conclusion: the draft REQUEST was legitimate and was
 * processed; the candidate artifact content failed accepted WP-4 validation.
 * Bounded findings (rule IDs, phase, category, location) are exposed for
 * iterative correction without any persistence.
 */
export interface InvalidDraftProposalResult {
  readonly ok: true;
  readonly valid: false;
  readonly kind: DraftableArtifactKindId;
  readonly findings: readonly DraftFinding[];
}

export type DraftProposalResult = ValidDraftProposalResult | InvalidDraftProposalResult | DraftErrorResult;

function errorResult(code: DraftErrorCode, message: string): DraftErrorResult {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message }) });
}

function findingOf(f: { readonly phase: string; readonly category: string; readonly ruleIds: readonly string[]; readonly messageKey: string; readonly schemaId?: string; readonly subjectIdentity?: string; readonly location?: string }): DraftFinding {
  return Object.freeze({
    phase: f.phase,
    category: f.category,
    ruleIds: Object.freeze([...f.ruleIds]),
    ...(f.schemaId !== undefined ? { schemaId: f.schemaId } : {}),
    ...(f.subjectIdentity !== undefined ? { subjectIdentity: f.subjectIdentity } : {}),
    ...(f.location !== undefined ? { location: f.location } : {}),
    messageKey: f.messageKey,
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * Public/default draft entry: construct and validate one draft proposal under
 * the fresh default schema registry (accepted Slice 1 semantics, unchanged).
 * Deterministic; no side effects.
 */
export function createDraftProposal(request: DraftProposalRequest): DraftProposalResult {
  return createDraftProposalWithSchemaRegistry(request, createSchemaRegistry());
}

/**
 * Shared implementation (WP-10 Slice 2 injection seam): construct and
 * validate one draft proposal under an EXPLICIT host-supplied schema
 * registry. This is the exact accepted Slice 1 algorithm; the ONLY difference
 * is the registry source. The registry is host-owned validation context and
 * never grants persistence, lifecycle authority, execution, or workspace
 * access.
 *
 * Request errors (closed shape, vocabulary, kind correlation, derived-member
 * presence, raw JSON intake, size bound) return `ok: false` with the closed
 * code. A well-formed request whose candidate artifact fails accepted WP-4
 * validation returns a normal `ok: true, valid: false` draft conclusion with
 * bounded findings — never a flattened generic error. Deterministic; no side
 * effects.
 */
export function createDraftProposalWithSchemaRegistry(request: DraftProposalRequest, schemaRegistry: SchemaRegistry): DraftProposalResult {
  try {
    if (typeof request !== 'object' || request === null || Array.isArray(request)) {
      return errorResult('invalid-draft-request', 'draft request must be an object');
    }
    const keys = Object.keys(request as unknown as Readonly<Record<string, unknown>>);
    for (const key of keys) {
      if (key !== 'kind' && key !== 'content') {
        return errorResult('invalid-draft-request', `unknown draft request field: ${key}`);
      }
    }
    const kind = (request as unknown as Readonly<Record<string, unknown>>)['kind'];
    if (!isDraftableArtifactKind(kind)) {
      // Covers ExecutionResult, lifecycle-record types, and close lookalike
      // spellings: the closed vocabulary admits no variant.
      return errorResult('unsupported-artifact-kind', 'the requested artifact kind is outside the closed ChatGPT-draftable vocabulary');
    }
    const content = (request as unknown as Readonly<Record<string, unknown>>)['content'];
    if (typeof content !== 'string' || content.length === 0) {
      return errorResult('invalid-draft-request', 'draft content must be a non-empty JSON string');
    }
    const parsed = parseRawJsonInput(content, { subjectClass: 'artifact' });
    if (!parsed.ok) {
      const category = parsed.report.findings[0]?.category ?? '';
      if (category === 'RESOURCE-LIMIT') {
        return errorResult('limit-exceeded', 'draft content exceeds the accepted artifact input byte bound');
      }
      return errorResult('invalid-draft-request', 'draft content is not valid artifact JSON');
    }
    // Object-envelope shape guard (F1 correction): a syntactically valid JSON
    // value that is not a non-null, non-array object can never be an Artifact
    // envelope (canonical envelopes are JSON objects). This is an explicit
    // request-taxonomy path — never an exception, never an internal failure.
    const parsedModel = parsed.model;
    if (typeof parsedModel !== 'object' || parsedModel === null || Array.isArray(parsedModel)) {
      return errorResult('invalid-draft-request', 'draft content must be a JSON object envelope');
    }
    const model = parsedModel as Readonly<Record<string, unknown>>;
    const contentKind = (model['kind'] as Readonly<Record<string, unknown>> | undefined)?.['id'];
    if (contentKind !== kind) {
      // Also rejects non-artifact content (lifecycle records, registry
      // snapshots, arbitrary JSON) whose envelope kind cannot correlate.
      return errorResult('invalid-draft-request', 'draft content kind does not match the requested kind');
    }
    const revision = (model['revision'] as Readonly<Record<string, unknown>> | undefined) ?? {};
    if (revision['digest'] !== undefined) {
      // The digest is a derived member of the canonical projection; it is
      // never accepted from the producer (identity-versioning reference).
      return errorResult('invalid-draft-request', 'revision.digest is derived by the draft core and must be absent from draft content');
    }
    // Construction: the ONLY transformation is inserting the accepted derived
    // digest over the accepted canonical projection. No second serializer,
    // no reordering, no normalization, no identity minting.
    const { digest } = computeArtifactDigest(model);
    const candidate: Readonly<Record<string, unknown>> = { ...model, revision: { ...revision, digest } };
    const report = validateArtifactSelf(candidate, schemaRegistry);
    if (!report.ok || report.value === undefined) {
      return Object.freeze({
        ok: true,
        valid: false,
        kind,
        findings: Object.freeze(report.findings.map(findingOf)),
      });
    }
    const value = report.value as ValidatedArtifact;
    const proposal = deepFreeze({
      instanceId: value.instanceId,
      revisionId: value.revisionId,
      digest: value.digest,
      canonicalUtf8: value.canonicalUtf8,
      level: value.level,
      model: value.model,
    });
    return Object.freeze({
      ok: true,
      valid: true,
      kind,
      proposal,
      validation: Object.freeze({ level: value.level, ruleIds: Object.freeze([...report.ruleIds]) }),
    });
  } catch {
    // Unexpected failure: fixed redacted message; never internal details.
    return errorResult('internal-adapter-failure', 'the draft proposal could not be completed; no internal details are exposed');
  }
}
