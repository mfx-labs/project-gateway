/**
 * Bundle and cross-artifact compatibility (phase 9): one workspace, policy/context
 * alignment, binding declarations vs actual targets, result/bundle workspace, and
 * lineage workspace checks. Evaluates compatibility only.
 */
import { mk, type Finding } from '../internal/report.js';
import type { ArtifactKindId } from '../schema/select.js';
import { workspaceBindingsEqual } from '../internal/protocol-equality.js';

export interface CrossArtifactContext {
  readonly kind: ArtifactKindId;
  readonly model: Readonly<Record<string, unknown>>;
  readonly subjectIdentity: string;
  /** Resolve an exact reference to its untrusted raw model (already revalidated). */
  readonly resolveTarget: (reference: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>> | undefined;
}

function bindingOf(model: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
  const b = model['workspace_binding'];
  return b && typeof b === 'object' ? (b as Record<string, unknown>) : undefined;
}

function workspaceOf(binding: Record<string, unknown> | undefined): string | undefined {
  const w = binding?.['workspace_id'];
  return typeof w === 'string' ? w : undefined;
}

export function evaluateCrossArtifact(ctx: CrossArtifactContext): Finding[] {
  const findings: Finding[] = [];
  const ownBinding = bindingOf(ctx.model);
  const ownWorkspace = workspaceOf(ownBinding);

  // bundle composition checks
  if (ctx.kind === 'ExecutionBundle') {
    const body = ctx.model['body'] as Record<string, unknown> | undefined;
    const members = ['task', 'authority_policy', 'context_manifest', 'completion_contract'] as const;
    for (const member of members) {
      const ref = body?.[member];
      if (!ref || typeof ref !== 'object') continue;
      const r = ref as Record<string, unknown>;
      const target = ctx.resolveTarget(r);
      const declaredBinding = r['target_workspace_binding'] as Record<string, unknown> | undefined;
      const declaredWorkspace = workspaceOf(declaredBinding);
      const actualBinding = target ? bindingOf(target) : undefined;
      const actualWorkspace = workspaceOf(actualBinding);
      // reference declaration must match the actual target binding (REF-005 at phase 9 for bundle members)
      if (target && declaredBinding && actualBinding && !workspaceBindingsEqual(declaredBinding, actualBinding)) {
        findings.push(
          mk('cross-artifact-compatibility', 'WORKSPACE-FAILURE', 'workspace.reference-binding', 'bundle member reference binding does not match the target artifact', {
            ruleIds: ['REF-005', 'WSP-003', 'WSP-005'],
            subjectIdentity: ctx.subjectIdentity,
            location: `/body/${member}`,
          }),
        );
      }
      // bound members must be in the bundle workspace
      if (ownWorkspace && declaredWorkspace && declaredWorkspace !== ownWorkspace) {
        findings.push(
          mk('cross-artifact-compatibility', 'WORKSPACE-FAILURE', 'workspace.member-mismatch', 'bundle member resolves to a different workspace', {
            ruleIds: ['WSP-003', 'WSP-004', 'WSP-005'],
            subjectIdentity: ctx.subjectIdentity,
            location: `/body/${member}`,
          }),
        );
      }
      // bound targets must match the bundle workspace
      if (ownWorkspace && actualWorkspace && actualWorkspace !== ownWorkspace) {
        findings.push(
          mk('cross-artifact-compatibility', 'WORKSPACE-FAILURE', 'workspace.target-mismatch', 'bundle member target is bound to a different workspace', {
            ruleIds: ['WSP-003', 'WSP-005'],
            subjectIdentity: ctx.subjectIdentity,
            location: `/body/${member}`,
          }),
        );
      }
    }
  }

  // result workspace alignment (RES-003 / WSP-007)
  if (ctx.kind === 'ExecutionResult') {
    const body = ctx.model['body'] as Record<string, unknown> | undefined;
    const bundleRef = body?.['reported_bundle'] as Record<string, unknown> | undefined;
    const target = bundleRef ? ctx.resolveTarget(bundleRef) : undefined;
    const targetWorkspace = target ? workspaceOf(bindingOf(target)) : undefined;
    if (ownWorkspace && targetWorkspace && ownWorkspace !== targetWorkspace) {
      findings.push(
        mk('cross-artifact-compatibility', 'WORKSPACE-FAILURE', 'workspace.result-mismatch', 'result workspace does not match the reported bundle workspace', {
          ruleIds: ['RES-003', 'WSP-007'],
          subjectIdentity: ctx.subjectIdentity,
          location: '/body/reported_bundle',
        }),
      );
    }
  }

  // lineage workspace checks (LIN-007 binding continuity, WSP-008 no bridge)
  const revision = ctx.model['revision'] as Record<string, unknown> | undefined;
  const pred = revision?.['predecessor'];
  if (pred && typeof pred === 'object') {
    const p = pred as Record<string, unknown>;
    const predBinding = p['target_workspace_binding'] as Record<string, unknown> | undefined;
    if (ownBinding && predBinding && !workspaceBindingsEqual(ownBinding, predBinding)) {
      findings.push(
        mk('cross-artifact-compatibility', 'WORKSPACE-FAILURE', 'lineage.binding-continuity', 'successor binding differs from the predecessor binding declaration', {
          ruleIds: ['LIN-007'],
          subjectIdentity: ctx.subjectIdentity,
          location: '/workspace_binding',
        }),
      );
      findings.push(
        mk('cross-artifact-compatibility', 'LINEAGE-FAILURE', 'lineage.binding-change-subject', 'a binding change requires a new generation-zero subject', {
          ruleIds: ['MIG-001'],
          subjectIdentity: ctx.subjectIdentity,
          location: '/workspace_binding',
        }),
      );
    }
    const predWorkspace = workspaceOf(predBinding);
    if (predWorkspace && ownWorkspace && predWorkspace !== ownWorkspace) {
      findings.push(
        mk('cross-artifact-compatibility', 'WORKSPACE-FAILURE', 'workspace.bridge', 'lineage or reference bridges workspace boundaries', {
          ruleIds: ['WSP-008'],
          subjectIdentity: ctx.subjectIdentity,
          location: '/revision/predecessor',
        }),
      );
    }
  }

  return findings;
}
