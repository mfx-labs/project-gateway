/**
 * Artifact semantic self-validation dispatch (phase 7): executes the registered
 * evaluator-owned rules applicable to the subject kind. The dispatch source is
 * the implementation-owned rule table (`evaluatorFor`), never the conformance
 * manifest. Rules classified as structural/graph/raw/canonical/pipeline are
 * enforced by their respective phases.
 */
import { type Finding } from '../internal/report.js';
import type { ArtifactKindId } from '../schema/select.js';
import { evaluatorRulesForArtifact, evaluatorFor } from './rules.js';

export function evaluateArtifactSemantics(
  kind: ArtifactKindId,
  model: Readonly<Record<string, unknown>>,
  subjectIdentity: string,
): Finding[] {
  const findings: Finding[] = [];
  for (const ruleId of evaluatorRulesForArtifact(kind)) {
    const evaluate = evaluatorFor(ruleId);
    if (!evaluate) continue;
    findings.push(...evaluate({ kind, model, subjectIdentity }));
  }
  return findings;
}
