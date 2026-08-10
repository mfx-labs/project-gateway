/**
 * Implementation-owned structural-enforcement mapping.
 *
 * When a closed schema rejects a subject, the applicable semantic rule IDs are
 * derived from the schema resource, the validator keyword, and the error path
 * or offending property — never from the conformance manifest. This is the
 * explicit mapping required for structurally enforced rules.
 */
import type { SchemaErrorLike } from '../schema/registry.js';

const EXACT_REFERENCE = 'urn:project-gateway:schema:artifact:1.0:common:exact-artifact-reference';

const AUTHORITY_POLICY = 'urn:project-gateway:schema:artifact:1.0:kinds:authority-policy';
const COMPLETION_CONTRACT = 'urn:project-gateway:schema:artifact:1.0:kinds:completion-contract';
const CONTEXT_MANIFEST = 'urn:project-gateway:schema:artifact:1.0:kinds:context-manifest';
const EXECUTION_BUNDLE = 'urn:project-gateway:schema:artifact:1.0:kinds:execution-bundle';
const EXECUTION_OUTCOME_RECORD = 'urn:project-gateway:schema:lifecycle:1.0:records:execution-outcome-record';
const REVOCATION_RECORD = 'urn:project-gateway:schema:lifecycle:1.0:records:revocation-record';
const ARTIFACT_KIND_PREFIX = 'urn:project-gateway:schema:artifact:1.0:kinds:';

interface ErrorLike {
  readonly keyword: string;
  readonly instancePath: string;
  readonly params?: { readonly unevaluatedProperty?: string; readonly missingProperty?: string };
}

function has(
  errors: readonly ErrorLike[],
  keyword: string,
  pathPred: (p: string) => boolean,
  prop?: string,
): boolean {
  return errors.some((e) => {
    if (e.keyword !== keyword) return false;
    if (!pathPred(e.instancePath)) return false;
    if (prop === undefined) return true;
    return e.params?.unevaluatedProperty === prop || e.params?.missingProperty === prop;
  });
}

/** Map schema-resource identity + validator errors to implementation-owned rule IDs. */
export function structuralRuleIds(schemaId: string, errors: readonly SchemaErrorLike[]): readonly string[] {
  const rules = new Set<string>();
  const errs = errors as readonly ErrorLike[];
  if (schemaId === AUTHORITY_POLICY) {
    if (has(errs, 'unevaluatedProperties', (p) => p === '/body', 'task_instruction')) rules.add('AUT-004');
    if (has(errs, 'enum', (p) => p.includes('/capability/id'))) rules.add('AUT-005');
  }
  if (schemaId === COMPLETION_CONTRACT) {
    if (has(errs, 'unevaluatedProperties', (p) => p.startsWith('/body/checks/'), 'check_permission')) {
      rules.add('CMP-002');
      rules.add('CMP-005');
    }
    if (has(errs, 'unevaluatedProperties', (p) => p.startsWith('/body/checks/'), 'observed_outcome')) {
      rules.add('CMP-001');
      rules.add('CMP-003');
    }
    if (has(errs, 'oneOf', (p) => p.includes('/check')) || has(errs, 'const', (p) => p.includes('/check/type'))) {
      rules.add('CMP-004');
    }
  }
  if (schemaId === CONTEXT_MANIFEST) {
    if (has(errs, 'enum', (p) => p.includes('/purpose'))) {
      rules.add('CTX-002');
      rules.add('CTX-003');
      rules.add('CTX-004');
    }
    if (has(errs, 'oneOf', (p) => p.includes('/selector'))) {
      rules.add('CTX-001');
      rules.add('CTX-005');
      rules.add('CTX-006');
    }
  }
  if (schemaId === EXECUTION_BUNDLE) {
    if (has(errs, 'required', (p) => p === '/body')) rules.add('BND-001');
    if (has(errs, 'unevaluatedProperties', (p) => p === '/body', 'execution_result')) rules.add('BND-003');
    if (has(errs, 'unevaluatedProperties', (p) => p === '/body')) {
      rules.add('BND-004');
      rules.add('BND-005');
      rules.add('BND-006');
    }
  }
  if (schemaId.startsWith(ARTIFACT_KIND_PREFIX)) {
    if (has(errs, 'oneOf', (p) => p === '/revision')) rules.add('LIN-003');
    if (has(errs, 'oneOf', (p) => p === '/workspace_binding')) {
      rules.add('WSP-001');
      rules.add('WSP-002');
    }
  }
  if (schemaId === EXECUTION_OUTCOME_RECORD) {
    // EXE-011 (observation evidence trust): the evidence reference must be a
    // genuine committed external-evidence form with an opaque evidence id,
    // canonical digest, and committed media type/role.
    if (has(errs, 'required', (p) => p === '', 'observation_evidence')) rules.add('EXE-011');
    if (has(errs, 'pattern', (p) => p.includes('/observation_evidence/evidence_id'))) rules.add('EXE-011');
    if (has(errs, 'pattern', (p) => p.includes('/observation_evidence/content_digest'))) rules.add('EXE-011');
    if (has(errs, 'const', (p) => p.includes('/observation_evidence/declared_media_type') || p.includes('/observation_evidence/observation_role') || p.includes('/observation_evidence/kind'))) rules.add('EXE-011');
  }
  if (schemaId === REVOCATION_RECORD) {
    if (has(errs, 'enum', (p) => p.includes('/target/record_type'))) {
      rules.add('LFC-005');
      rules.add('LFC-006');
    }
  }
  if (schemaId === EXACT_REFERENCE) {
    if (has(errs, 'const', (p) => p.includes('/target_protocol_version')) || has(errs, 'const', (p) => p.includes('/target_kind'))) {
      rules.add('REF-002');
    }
    if (has(errs, 'pattern', (p) => p.includes('/target_instance_id') || p.includes('/target_revision_id'))) {
      rules.add('REF-003');
    }
    if (has(errs, 'pattern', (p) => p.includes('/target_digest'))) {
      rules.add('REF-004');
    }
    if (has(errs, 'oneOf', (p) => p.includes('/target_workspace_binding'))) {
      rules.add('REF-005');
    }
  }
  return [...rules].sort();
}

/** Implementation-owned rule IDs for raw-intake failures by category and content. */
export function rawRuleIds(category: string, message = ''): readonly string[] {
  if (category === 'DUPLICATE-MEMBER') {
    // a duplicate member named `predecessor` is a merge-lineage attempt (LIN-006)
    if (message.includes('predecessor')) return ['SEC-001', 'LIN-006'];
    return ['SEC-001'];
  }
  return [];
}

/** Implementation-owned rule IDs for canonical-input failures by category. */
export function canonicalRuleIds(category: string): readonly string[] {
  if (category === 'NON-NFC-STRING') return ['SEC-002'];
  return [];
}

/** Implementation-owned rule IDs for schema-selection failures. */
export function selectionRuleIds(selection: {
  readonly category?: string;
  readonly message?: string;
}): readonly string[] {
  // an unknown lifecycle record discriminator violates distinct-record
  // responsibility (LFC-009); other selection failures carry no semantic rule
  if (selection.message !== undefined && selection.message.includes('lifecycle record type')) {
    return ['LFC-009'];
  }
  return [];
}

/** Implementation-owned rule IDs for non-exact-reference-shaped inputs. */
export function referenceInputRuleIds(model: Record<string, unknown>): readonly string[] {
  if (model['fallbacks'] !== undefined || model['fallback'] !== undefined || model['primary'] !== undefined) {
    return ['REF-007'];
  }
  const ref = model['reference'];
  if (typeof ref === 'string') {
    if (ref === 'latest' || /\blatest\b|\brange\b/.test(ref)) return ['REF-009'];
    if (/^(\.{0,2}\/|git:|[0-9a-f]{1,63}$)/.test(ref) || ref.includes('.json') || ref.includes(':')) return ['REF-006'];
    return ['REF-006'];
  }
  if (typeof model['target_digest'] === 'string') return ['REF-006'];
  return ['REF-006'];
}
