/**
 * Semantic rule catalog: all 114 approved rule IDs with stable phases,
 * categories, enforcement classification, and — where the rule has a real
 * evaluator — an implementation-owned evaluator emitting only its own rule ID.
 *
 * Enforcement classification (implementation-owned, never derived from the
 * conformance manifest):
 *   - `evaluator`: executed by the semantic engine at its phase;
 *   - `structural`: the closed V1 schema rejects every representable violation;
 *     the structural-enforcement mapping (schema resource + keyword + path)
 *     supplies the rule ID when the structural phase rejects;
 *   - `graph`: enforced by lifecycle/registry graph evaluation;
 *   - `raw` / `canonical`: enforced by the raw scanner / canonical-input phase;
 *   - `pipeline`: enforced by the digest/ordering/identity pipeline.
 */
import { mk, type Finding } from '../internal/report.js';
import type { FailureCategory, ValidationPhase } from '../internal/phase.js';
import type { ArtifactKindId, LifecycleRecordType } from '../schema/select.js';

export type EnforcementKind = 'evaluator' | 'structural' | 'graph' | 'raw' | 'canonical' | 'pipeline';

export interface RuleDef {
  readonly id: string;
  readonly title: string;
  readonly phase: ValidationPhase;
  readonly category: FailureCategory;
  readonly subject: string;
  readonly enforcement: EnforcementKind;
  readonly kinds?: readonly ArtifactKindId[];
  readonly recordTypes?: readonly LifecycleRecordType[];
}

export interface RuleContext {
  readonly kind?: ArtifactKindId;
  readonly model: Readonly<Record<string, unknown>>;
  readonly subjectIdentity?: string;
}

type EvalFn = (ctx: RuleContext) => Finding[];

const RULES = new Map<string, RuleDef>();
const EVALS = new Map<string, EvalFn>();

function emit(phase: ValidationPhase, category: FailureCategory, ruleId: string, key: string, msg: string, ctx: RuleContext, location = ''): Finding {
  return mk(phase, category, key, msg, { ruleIds: [ruleId], subjectIdentity: ctx.subjectIdentity, location });
}

function def(
  id: string,
  title: string,
  phase: ValidationPhase,
  category: FailureCategory,
  subject: string,
  enforcement: EnforcementKind,
  evaluate: EvalFn | null = null,
  kinds?: readonly ArtifactKindId[],
  recordTypes?: readonly LifecycleRecordType[],
): void {
  RULES.set(id, { id, title, phase, category, subject, enforcement, kinds, recordTypes });
  if (evaluate) EVALS.set(id, evaluate);
}

export function ruleIds(): string[] {
  return [...RULES.keys()].sort();
}

export function ruleDef(id: string): RuleDef | undefined {
  return RULES.get(id);
}

export function enforcementKind(id: string): EnforcementKind {
  return RULES.get(id)?.enforcement ?? 'structural';
}

/** Dispatch source: returns the evaluator for a rule, if one exists. */
export function evaluatorFor(id: string): EvalFn | undefined {
  return EVALS.get(id);
}

/** All evaluator-owned rules applicable to an artifact kind. */
export function evaluatorRulesForArtifact(kind: ArtifactKindId): string[] {
  return [...RULES.entries()]
    .filter(([, r]) => r.enforcement === 'evaluator' && (r.kinds === undefined || r.kinds.includes(kind)))
    .map(([id]) => id)
    .sort();
}

/** All evaluator-owned rules applicable to a lifecycle record type. */
export function evaluatorRulesForRecord(recordType: LifecycleRecordType): string[] {
  return [...RULES.entries()]
    .filter(([, r]) => r.enforcement === 'evaluator' && (r.recordTypes === undefined || r.recordTypes.includes(recordType)))
    .map(([id]) => id)
    .sort();
}

// ---------------------------------------------------------------------------
// text-pattern helpers shared by evaluators
// ---------------------------------------------------------------------------
const AUTHORITY_RE =
  /\b(authoriz(?:e|ed|ation)|approv(?:e|ed|al)|issu(?:e|ed|ance)|grant(?:s|ed)?|activ(?:at(?:e|ed|ion))|receipt|publish(?:ed|ation)|execute(?:s)? (?:commands?|arbitrary)|trusted ceiling|ceiling:)/i;
const LIFECYCLE_CLAIM_RE = /\b(approv|issu|grant|receipt|activ|revok|publish|ceiling)/i;
const OBSERVED_RE =
  /\b(observed(?: completion)?|outcome was (?:pass|fail)|(?:has|have) (?:passed|failed|completed)|completed (?:successfully|with pass)|the (?:check|completion) (?:passed|failed|was satisfied))/i;
const CONTEXT_DELEGATION_RE =
  /\b(follow|obey|apply|execute|treat as (?:instruction|command)) (?:every|all|the|embedded|selected|any)[^.]{0,40}(instruction|command|directive|step)s?[^.]{0,30}(context|selected context|embedded|documented)/i;
const MIGRATION_RE = /\bmigrat(?:e|ion|ed)\b/i;
const REWRITE_RE = /\b(rewrit(?:e|ten|ing)|amended?|next attempt|objective is|will now|must now)\b/i;
const CEILING_RE = /\b(ceiling|unlimited actions|no limit|max(?:imum)? actions?)\b/i;

interface Texts {
  body: string[];
  annotations: string[];
}

function collect(ctx: RuleContext): Texts {
  const body: string[] = [];
  const annotations: string[] = [];
  const b = ctx.model['body'];
  if (b && typeof b === 'object') {
    const bodyObj = b as Record<string, unknown>;
    for (const key of ['objective', 'instructions', 'expected_deliverables', 'outcome_constraints', 'project_data_citations', 'observed_outputs', 'violations']) {
      const v = bodyObj[key];
      if (typeof v === 'string') body.push(v);
      else if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === 'object') {
            const r = item as Record<string, unknown>;
            for (const k of ['text', 'statement', 'description', 'summary']) {
              if (typeof r[k] === 'string') body.push(r[k]);
            }
          }
        }
      }
    }
  }
  const ann = ctx.model['annotations'];
  if (ann && typeof ann === 'object') {
    const a = ann as Record<string, unknown>;
    for (const k of ['title', 'description', 'producer_attribution']) {
      if (typeof a[k] === 'string') annotations.push(a[k]);
    }
    for (const k of ['labels', 'comments']) {
      const v = a[k];
      if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') annotations.push(x);
    }
  }
  return { body, annotations };
}

function hasAuthorityText(t: string): boolean {
  return AUTHORITY_RE.test(t);
}
function hasLifecycleClaim(t: string): boolean {
  return AUTHORITY_RE.test(t) && LIFECYCLE_CLAIM_RE.test(t);
}
function hasObservedOutcome(t: string): boolean {
  return OBSERVED_RE.test(t);
}
function hasContextDelegation(t: string): boolean {
  return CONTEXT_DELEGATION_RE.test(t);
}
function hasMigrationClaim(t: string): boolean {
  return MIGRATION_RE.test(t);
}
function hasRewriteClaim(t: string): boolean {
  return REWRITE_RE.test(t);
}
function hasCeilingClaim(t: string): boolean {
  return CEILING_RE.test(t);
}

function textMatches(ctx: RuleContext, test: (t: string) => boolean, includeAnnotations: boolean): boolean {
  const { body, annotations } = collect(ctx);
  const pool = includeAnnotations ? [...body, ...annotations] : body;
  return pool.some(test);
}

// ---------------------------------------------------------------------------
// rule registry
// ---------------------------------------------------------------------------
const ALL_KINDS: readonly ArtifactKindId[] = ['TaskSpec', 'AuthorityPolicy', 'ContextManifest', 'CompletionContract', 'ExecutionBundle', 'ExecutionResult'];

// --- shared artifact rules --------------------------------------------------
def('ART-001', 'Kind/body responsibility', 'semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'All artifacts', 'evaluator',
  (ctx) => textMatches(ctx, hasAuthorityText, false) && ctx.kind !== 'AuthorityPolicy'
    ? [emit('semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'ART-001', 'semantic.authority-in-content', 'artifact content expresses authority outside AuthorityPolicy', ctx, '/body')]
    : [], ALL_KINDS);
def('ART-002', 'No lifecycle state in artifacts', 'semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'All artifacts', 'evaluator',
  (ctx) => textMatches(ctx, hasLifecycleClaim, true)
    ? [emit('semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'ART-002', 'semantic.lifecycle-claim', 'artifact content claims trusted lifecycle state', ctx, '/annotations')]
    : [], ALL_KINDS);
def('ART-003', 'Authority locality', 'semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'All artifacts', 'evaluator',
  (ctx) => textMatches(ctx, hasAuthorityText, false) && ctx.kind !== 'AuthorityPolicy'
    ? [emit('semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'ART-003', 'semantic.authority-locality', 'authority is expressed outside AuthorityPolicy', ctx, '/body')]
    : [], ALL_KINDS);
def('ART-004', 'Prospective/result separation', 'semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'All artifacts', 'evaluator',
  (ctx) => textMatches(ctx, hasObservedOutcome, false) && ctx.kind !== 'ExecutionResult'
    ? [emit('semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'ART-004', 'semantic.observed-outcome', 'prospective artifact embeds observed result semantics', ctx, '/body')]
    : [], ALL_KINDS);
def('ART-005', 'Canonical content identity', 'canonicalization-and-digest-verification', 'DIGEST-MISMATCH', 'Canonical artifact', 'pipeline');
def('ART-006', 'Annotation non-authority', 'semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'Artifact annotations', 'evaluator',
  (ctx) => textMatches(ctx, hasLifecycleClaim, true)
    ? [emit('semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'ART-006', 'semantic.annotation-claim', 'annotation content claims trusted lifecycle state', ctx, '/annotations')]
    : [], ALL_KINDS);
def('ART-007', 'Required semantics fail closed', 'registry-compatibility', 'CONSUMER-SUPPORT-FAILURE', 'Artifact and consumer', 'graph');
def('ART-008', 'Canonical set ordering', 'canonicalization-and-digest-verification', 'CANONICAL-ORDER-FAILURE', 'Canonical artifact', 'pipeline');

// --- identity/lineage --------------------------------------------------------
def('LIN-001', 'Globally non-reused instance ID', 'identity-registration', 'IDENTITY-CONFLICT', 'Artifact registration', 'pipeline');
def('LIN-002', 'Revision-ID binding', 'identity-registration', 'IDENTITY-CONFLICT', 'Artifact registration', 'pipeline');
def('LIN-003', 'Genesis shape', 'structural-schema-validation', 'LINEAGE-FAILURE', 'Revision', 'structural');
def('LIN-004', 'Exact predecessor subject', 'exact-reference-resolution', 'LINEAGE-FAILURE', 'Successor revision', 'graph');
def('LIN-005', 'Generation increment', 'exact-reference-resolution', 'LINEAGE-FAILURE', 'Successor revision', 'graph');
def('LIN-006', 'No merge lineage', 'raw-json-intake', 'DUPLICATE-MEMBER', 'Revision/raw input', 'raw');
def('LIN-007', 'Binding continuity', 'cross-artifact-compatibility', 'WORKSPACE-FAILURE', 'Successor revision', 'graph');
def('LIN-008', 'No lifecycle inheritance', 'trusted-lifecycle-verification', 'LIFECYCLE-FAILURE', 'Lineage/lifecycle use', 'graph');

// --- references --------------------------------------------------------------
def('REF-001', 'Exact target resolution', 'exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'Exact reference', 'graph');
def('REF-002', 'Kind/version match', 'exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'Exact reference', 'graph');
def('REF-003', 'Instance/revision match', 'exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'Exact reference', 'graph');
def('REF-004', 'Digest match', 'exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'Exact reference', 'graph');
def('REF-005', 'Workspace-binding match', 'exact-reference-resolution', 'WORKSPACE-FAILURE', 'Exact reference', 'graph');
def('REF-006', 'No aliases or paths', 'schema-identification', 'EXACT-REFERENCE-FAILURE', 'Reference input', 'raw');
def('REF-007', 'No hidden fallback', 'schema-identification', 'EXACT-REFERENCE-FAILURE', 'Reference/bundle', 'raw');
def('REF-008', 'Acyclic graph', 'exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'Artifact graph', 'graph');
def('REF-009', 'Provisional nonconsumability', 'schema-identification', 'EXACT-REFERENCE-FAILURE', 'Draft reference', 'raw');

// --- workspace ----------------------------------------------------------------
def('WSP-001', 'Intrinsic binding', 'structural-schema-validation', 'WORKSPACE-FAILURE', 'Bound core kinds', 'structural');
def('WSP-002', 'Limited portability', 'structural-schema-validation', 'WORKSPACE-FAILURE', 'All core kinds', 'structural');
def('WSP-003', 'One bundle workspace', 'cross-artifact-compatibility', 'WORKSPACE-FAILURE', 'Bundle', 'graph');
def('WSP-004', 'Policy/context alignment', 'exact-reference-resolution', 'WORKSPACE-FAILURE', 'Bundle', 'graph');
def('WSP-005', 'Bound task/contract alignment', 'cross-artifact-compatibility', 'WORKSPACE-FAILURE', 'Bundle', 'graph');
def('WSP-006', 'Portable use is scoped', 'trusted-lifecycle-verification', 'LIFECYCLE-FAILURE', 'Portable execution use', 'graph');
def('WSP-007', 'Result occurrence workspace', 'cross-artifact-compatibility', 'WORKSPACE-FAILURE', 'Result/publication', 'graph');
def('WSP-008', 'No workspace bridge', 'cross-artifact-compatibility', 'WORKSPACE-FAILURE', 'Cross-subject graph', 'graph');

// --- TaskSpec -----------------------------------------------------------------
def('TSK-001', 'Direct instruction content', 'semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'TaskSpec', 'evaluator',
  (ctx) => textMatches(ctx, hasContextDelegation, false)
    ? [emit('semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'TSK-001', 'semantic.context-delegation', 'task delegates instruction authority to context', ctx, '/body')]
    : [], ['TaskSpec']);
def('TSK-002', 'No delegated instruction authority', 'semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'TaskSpec', 'evaluator',
  (ctx) => textMatches(ctx, hasContextDelegation, false)
    ? [emit('semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'TSK-002', 'semantic.delegated-instruction', 'task treats context as an independent instruction source', ctx, '/body')]
    : [], ['TaskSpec']);
def('TSK-003', 'No authority semantics', 'semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'TaskSpec', 'evaluator',
  (ctx) => textMatches(ctx, hasAuthorityText, false)
    ? [emit('semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'TSK-003', 'semantic.task-authority', 'task content grants or requests authority', ctx, '/body')]
    : [], ['TaskSpec']);
def('TSK-004', 'No completion outcome', 'semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'TaskSpec', 'evaluator',
  (ctx) => textMatches(ctx, hasObservedOutcome, false)
    ? [emit('semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'TSK-004', 'semantic.task-outcome', 'task embeds observed completion outcome', ctx, '/body')]
    : [], ['TaskSpec']);
def('TSK-005', 'Prospective deliverables', 'semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'TaskSpec', 'evaluator',
  (ctx) => textMatches(ctx, hasObservedOutcome, false)
    ? [emit('semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'TSK-005', 'semantic.deliverable-outcome', 'deliverable content claims observed status', ctx, '/body')]
    : [], ['TaskSpec']);

// --- AuthorityPolicy ----------------------------------------------------------
def('AUT-000', 'Configured capability ceiling denies', 'point-of-use-eligibility', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'Trusted configuration/use', 'graph');
def('AUT-001', 'Narrowing only', 'point-of-use-eligibility', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'AuthorityPolicy/use', 'graph');
def('AUT-002', 'Deny retained', 'point-of-use-eligibility', 'POINT-OF-USE-FAILURE', 'AuthorityPolicy/use', 'graph');
def('AUT-003', 'Unknown operation denied', 'registry-compatibility', 'CONSUMER-SUPPORT-FAILURE', 'AuthorityPolicy/use', 'graph');
def('AUT-004', 'No task or command', 'structural-schema-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'AuthorityPolicy', 'structural');
def('AUT-005', 'Registered scope contract', 'structural-schema-validation', 'REGISTRY-INCOMPATIBILITY', 'AuthorityPolicy', 'structural');
def('AUT-006', 'No ceiling impersonation', 'semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'AuthorityPolicy', 'evaluator',
  (ctx) => textMatches(ctx, hasCeilingClaim, true)
    ? [emit('semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'AUT-006', 'authority.ceiling-claim', 'policy content impersonates a trusted ceiling', ctx, '/annotations')]
    : [], ['AuthorityPolicy']);

// --- ContextManifest (structurally enforced) ---------------------------------
def('CTX-001', 'Bounded selector', 'structural-schema-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'ContextManifest', 'structural');
def('CTX-002', 'Context is data', 'structural-schema-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'ContextManifest/consumer', 'structural');
def('CTX-003', 'No instruction promotion', 'structural-schema-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'Context/task/consumer', 'structural');
def('CTX-004', 'No authority/read bypass', 'structural-schema-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'ContextManifest', 'structural');
def('CTX-005', 'No escape/fallback', 'structural-schema-validation', 'WORKSPACE-FAILURE', 'ContextManifest', 'structural');
def('CTX-006', 'Independent read authority', 'structural-schema-validation', 'POINT-OF-USE-FAILURE', 'Context consumption', 'structural');

// --- CompletionContract (structurally enforced) ------------------------------
def('CMP-001', 'Prospective-only checks', 'structural-schema-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'CompletionContract', 'structural');
def('CMP-002', 'Checks do not grant authority', 'structural-schema-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'CompletionContract/use', 'structural');
def('CMP-003', 'No observed outcome', 'structural-schema-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'CompletionContract', 'structural');
def('CMP-004', 'Registered check support', 'structural-schema-validation', 'REGISTRY-INCOMPATIBILITY', 'CompletionContract', 'structural');
def('CMP-005', 'Consumer-neutral evidence', 'structural-schema-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'CompletionContract', 'structural');

// --- ExecutionBundle -----------------------------------------------------------
def('BND-001', 'Four mandatory members', 'structural-schema-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'ExecutionBundle', 'structural');
def('BND-002', 'Required target kinds', 'exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'ExecutionBundle', 'graph');
def('BND-003', 'No result member', 'structural-schema-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'ExecutionBundle', 'structural');
def('BND-004', 'No inline replacement/fallback', 'structural-schema-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'ExecutionBundle', 'structural');
def('BND-005', 'No semantic merge', 'structural-schema-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'ExecutionBundle', 'structural');
def('BND-006', 'No activation/grant', 'structural-schema-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'ExecutionBundle', 'structural');
def('BND-007', 'Required compatibility support', 'registry-compatibility', 'CONSUMER-SUPPORT-FAILURE', 'Bundle consumption', 'graph');
def('BND-008', 'One workspace/acyclic composition', 'exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'ExecutionBundle', 'graph');

// --- ExecutionResult ------------------------------------------------------------
def('RES-001', 'Retrospective-only', 'semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'ExecutionResult', 'evaluator',
  (ctx) => textMatches(ctx, hasRewriteClaim, false)
    ? [emit('semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'RES-001', 'semantic.prospective-content', 'result content is not retrospective', ctx, '/body')]
    : [], ['ExecutionResult']);
def('RES-002', 'Exact reported subject', 'exact-reference-resolution', 'EXACT-REFERENCE-FAILURE', 'ExecutionResult', 'graph');
def('RES-003', 'Same workspace', 'cross-artifact-compatibility', 'WORKSPACE-FAILURE', 'ExecutionResult', 'graph');
def('RES-004', 'No prospective rewrite', 'semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'ExecutionResult', 'evaluator',
  (ctx) => textMatches(ctx, hasRewriteClaim, false)
    ? [emit('semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'RES-004', 'semantic.rewrite', 'result content rewrites prospective artifacts', ctx, '/body')]
    : [], ['ExecutionResult']);
def('RES-005', 'One instance per attempt', 'trusted-lifecycle-verification', 'RESULT-PUBLICATION-FAILURE', 'Result/publication', 'graph');
def('RES-006', 'Correction retains instance', 'trusted-lifecycle-verification', 'RESULT-PUBLICATION-FAILURE', 'Result correction', 'graph');
def('RES-007', 'No receipt impersonation', 'trusted-lifecycle-verification', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'ExecutionResult', 'graph');

// --- registry ------------------------------------------------------------------
def('REG-001', 'Exact snapshot identity', 'registry-compatibility', 'REGISTRY-INCOMPATIBILITY', 'Registry/lifecycle', 'graph');
def('REG-002', 'Trusted registry governance', 'registry-compatibility', 'REGISTRY-INCOMPATIBILITY', 'Registry selection', 'graph');
def('REG-003', 'Namespace/version uniqueness', 'semantic-registry-validation', 'REGISTRY-INCOMPATIBILITY', 'RegistrySnapshot', 'graph');
def('REG-004', 'Snapshot digest domain', 'canonicalization-and-digest-verification', 'DIGEST-MISMATCH', 'RegistrySnapshot', 'pipeline');
def('REG-005', 'Registered declaration match', 'semantic-registry-validation', 'REGISTRY-INCOMPATIBILITY', 'Artifact/registry', 'graph');
def('REG-006', 'Required extension enforcement', 'registry-compatibility', 'CONSUMER-SUPPORT-FAILURE', 'Artifact consumption', 'graph');
def('REG-007', 'Optional ignore safety', 'semantic-registry-validation', 'REGISTRY-INCOMPATIBILITY', 'Artifact consumption', 'graph');
def('REG-008', 'Registry-context continuity', 'registry-compatibility', 'REGISTRY-INCOMPATIBILITY', 'Lifecycle/use', 'graph');
def('REG-009', 'Canonical registry set ordering', 'canonicalization-and-digest-verification', 'CANONICAL-ORDER-FAILURE', 'RegistrySnapshot', 'pipeline');

// --- lifecycle -----------------------------------------------------------------
def('LFC-001', 'Validation is not approval', 'trusted-lifecycle-verification', 'LIFECYCLE-FAILURE', 'Lifecycle records', 'graph');
def('LFC-002', 'Exact approval scope', 'trusted-lifecycle-verification', 'LIFECYCLE-FAILURE', 'ApprovalRecord', 'graph');
def('LFC-003', 'Issuance requires approval', 'trusted-lifecycle-verification', 'LIFECYCLE-FAILURE', 'IssuanceRecord', 'graph');
def('LFC-004', 'Member and bundle lifecycle', 'trusted-lifecycle-verification', 'LIFECYCLE-FAILURE', 'Bundle activation', 'graph');
def('LFC-005', 'Revocation target enum', 'structural-schema-validation', 'LIFECYCLE-FAILURE', 'RevocationRecord', 'structural');
def('LFC-006', 'Historical facts immutable', 'structural-schema-validation', 'LIFECYCLE-FAILURE', 'Historical records', 'structural');
def('LFC-007', 'Current revocation/expiry', 'point-of-use-eligibility', 'POINT-OF-USE-FAILURE', 'Privileged use', 'graph');
def('LFC-008', 'Grant narrowing/reservation', 'trusted-lifecycle-verification', 'LIFECYCLE-FAILURE', 'RuntimeGrant', 'graph');
def('LFC-009', 'Distinct record responsibility', 'schema-identification', 'LIFECYCLE-FAILURE', 'All records', 'raw');
def('LFC-010', 'Exact lifecycle registry context', 'registry-compatibility', 'REGISTRY-INCOMPATIBILITY', 'All records', 'graph');
def('LFC-011', 'Content cannot establish lifecycle', 'semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'Artifact/lifecycle use', 'evaluator',
  (ctx) => textMatches(ctx, hasLifecycleClaim, true)
    ? [emit('semantic-self-validation', 'AGGREGATE-RESPONSIBILITY-FAILURE', 'LFC-011', 'semantic.content-lifecycle', 'artifact content cannot establish lifecycle state', ctx, '/annotations')]
    : [], ALL_KINDS);
def('LFC-012', 'RuntimeGrant record type', 'point-of-use-eligibility', 'POINT-OF-USE-FAILURE', 'RuntimeGrant', 'graph');

// --- activation/occurrence/retry ------------------------------------------------
def('EXE-001', 'One activation decision', 'trusted-lifecycle-verification', 'ACTIVATION-FAILURE', 'Activation', 'graph');
def('EXE-002', 'Denial is terminal', 'trusted-lifecycle-verification', 'ACTIVATION-FAILURE', 'Activation', 'graph');
def('EXE-003', 'Accepted creates one occurrence', 'trusted-lifecycle-verification', 'ACTIVATION-FAILURE', 'Activation/occurrence', 'graph');
def('EXE-004', 'Attempts require accepted occurrence', 'trusted-lifecycle-verification', 'ACTIVATION-FAILURE', 'Attempt', 'graph');
def('EXE-005', 'Ordered retry/allowance', 'trusted-lifecycle-verification', 'ACTIVATION-FAILURE', 'Attempt/retry', 'graph');
def('EXE-006', 'Retry subject stability', 'trusted-lifecycle-verification', 'ACTIVATION-FAILURE', 'Retry', 'graph');
def('EXE-007', 'Point-of-use revalidation', 'point-of-use-eligibility', 'POINT-OF-USE-FAILURE', 'Activation/retry', 'graph');
def('EXE-008', 'Attempt receipt facts', 'trusted-lifecycle-verification', 'LIFECYCLE-FAILURE', 'Attempt/result', 'graph');
def('EXE-009', 'Denied reservation has no result', 'trusted-lifecycle-verification', 'ACTIVATION-FAILURE', 'Denial/result publication', 'graph');

// --- result publication ----------------------------------------------------------
def('PUB-001', 'First evaluator association', 'trusted-lifecycle-verification', 'RESULT-PUBLICATION-FAILURE', 'Result publication', 'graph');
def('PUB-002', 'Second instance rejected', 'trusted-lifecycle-verification', 'RESULT-PUBLICATION-FAILURE', 'Result publication', 'graph');
def('PUB-003', 'Exact publication binding', 'trusted-lifecycle-verification', 'RESULT-PUBLICATION-FAILURE', 'ResultPublicationRecord', 'graph');
def('PUB-004', 'Ordinary-review threshold', 'trusted-lifecycle-verification', 'RESULT-PUBLICATION-FAILURE', 'Ordinary review', 'graph');
def('PUB-005', 'Privileged receipt correlation', 'point-of-use-eligibility', 'RECEIPT-CORRELATION-FAILURE', 'Privileged result use', 'graph');
def('PUB-006', 'Competing publication handling', 'trusted-lifecycle-verification', 'RESULT-PUBLICATION-FAILURE', 'Publication set', 'graph');
def('PUB-007', 'Correction/supersession', 'trusted-lifecycle-verification', 'RESULT-PUBLICATION-FAILURE', 'Result correction', 'graph');
def('PUB-008', 'Publication is not authority/receipt', 'trusted-lifecycle-verification', 'RESULT-PUBLICATION-FAILURE', 'Publication/use', 'graph');

// --- migration/security ------------------------------------------------------------
def('MIG-001', 'New subject for identity/binding change', 'cross-artifact-compatibility', 'LINEAGE-FAILURE', 'Migration/revision', 'graph');
def('MIG-002', 'Explicit migration only', 'semantic-self-validation', 'LIFECYCLE-FAILURE', 'Migration', 'evaluator',
  (ctx) => textMatches(ctx, hasMigrationClaim, false)
    ? [emit('semantic-self-validation', 'LIFECYCLE-FAILURE', 'MIG-002', 'migration.claim-without-record', 'artifact content claims migration without a trusted MigrationRecord', ctx, '/body')]
    : [], ['TaskSpec']);
def('MIG-003', 'No lifecycle transfer', 'trusted-lifecycle-verification', 'LIFECYCLE-FAILURE', 'Migration/use', 'graph');
def('MIG-004', 'Historical resolvability', 'trusted-lifecycle-verification', 'LIFECYCLE-FAILURE', 'Migration history', 'graph');
def('SEC-001', 'Duplicate-key rejection', 'raw-json-intake', 'DUPLICATE-MEMBER', 'Raw input', 'raw');
def('SEC-002', 'NFC validation, never transformation', 'canonical-input-validation', 'NON-NFC-STRING', 'Artifact/registry raw input', 'canonical');
def('SEC-003', 'Consumer support is independent', 'registry-compatibility', 'CONSUMER-SUPPORT-FAILURE', 'Consumer use', 'graph');

export {
  AUTHORITY_RE,
  OBSERVED_RE,
  CONTEXT_DELEGATION_RE,
  MIGRATION_RE,
  REWRITE_RE,
  EXTENSION_RELIANCE_RE,
} from './patterns.js';

/** Result-instance conflict findings (phase 11, trusted lifecycle graph). */
export function secondResultConflictFindings(
  ctx: RuleContext,
  correctionWithNewInstance: boolean,
): Finding[] {
  const out: Finding[] = [];
  out.push(
    emit('trusted-lifecycle-verification', 'RESULT-PUBLICATION-FAILURE', 'PUB-001', 'publication.first-association', 'an attempt has a conflicting evaluator result association', ctx, '/body'),
    emit('trusted-lifecycle-verification', 'RESULT-PUBLICATION-FAILURE', 'PUB-002', 'publication.second-instance', 'an attempt has more than one evaluator-produced result instance', ctx, '/body'),
    emit('trusted-lifecycle-verification', 'RESULT-PUBLICATION-FAILURE', 'RES-005', 'publication.one-instance', 'an attempt has more than one evaluator-produced result instance', ctx, '/body'),
  );
  if (correctionWithNewInstance) {
    out.push(
      emit('trusted-lifecycle-verification', 'RESULT-PUBLICATION-FAILURE', 'RES-006', 'publication.correction-instance', 'a result correction introduces a new instance', ctx, '/body'),
      emit('trusted-lifecycle-verification', 'RESULT-PUBLICATION-FAILURE', 'PUB-007', 'publication.correction-new-instance', 'a correction must remain within the established result instance', ctx, '/body'),
    );
  }
  return out;
}
