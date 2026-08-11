/**
 * WP-14C — Pi short-action bridge and `gateway-load` command.
 *
 * The short Pi action is ONE command/action (exact spelling is an
 * implementation detail; `/gateway-load` is the chosen Gateway-specific
 * name) that requires no artifact path, no pasted artifact, and no
 * natural-language load prompt. It resolves → controlled-reads → validates
 * → correlates → renders → injects the resolved proposal set through the
 * committed WP-5A host-bridge injection mechanism (`before_agent_start`
 * message injection).
 *
 * INJECTION: one successful action injects ONE immutable proposal-context
 * message (`pgw.proposal-load`). A failed load injects NOTHING — the
 * injection handler is armed only after successful resolution. Reload is
 * fresh on every invocation (fresh discovery/reads/validation/selection/
 * correlation) and the new load visibly supersedes the prior Gateway load
 * (load ID + supersedes marker). The committed Pi transcript seam cannot
 * necessarily delete prior messages: physical transcript replacement is
 * never claimed; explicit supersession semantics prevent silent
 * stale/duplicate interpretation.
 *
 * STATE: the ONLY state is a minimal in-memory per-workspace record of the
 * previously injected load ID (supersession identification). No durable
 * selection database, no watcher, no scheduler, no keyboard daemon.
 *
 * AUTHORITY: loading prepares Pi context; it does not authorize Pi
 * execution. No approval, issuance, revocation, RuntimeGrant, activation,
 * execution, publication, receipt, or pi-guard interaction exists here;
 * the WP-12/WP-13 execution path is untouched.
 */
import { resolveProposalLoad, validateLoadOptions } from './core.js';
import { isBrandedLoadPlan } from './internal/brand.js';
import type { PiHostSurface } from '../adapters/pi/index.js';
import type { ProposalLoadLane, ProposalLoadPlan, ProposalLoadResult } from './types.js';

/** Chosen short-command spelling (implementation detail; Pi extension host name). */
export const GATEWAY_LOAD_COMMAND = 'gateway-load';

/** Minimal in-memory session record: identifies the previously injected Gateway load. */
export interface ProposalLoadSessionRegistry {
  readonly record: (workspaceId: string, loadId: string) => void;
  readonly previous: (workspaceId: string) => string | undefined;
}

/** Create the minimal in-memory session registry (never durable). */
export function createProposalLoadSessionRegistry(): ProposalLoadSessionRegistry {
  const byWorkspace = new Map<string, string>();
  return Object.freeze({
    record(workspaceId: string, loadId: string): void {
      byWorkspace.set(workspaceId, loadId);
    },
    previous(workspaceId: string): string | undefined {
      return byWorkspace.get(workspaceId);
    },
  });
}

export interface ProposalLoadBridge {
  readonly plan: ProposalLoadPlan;
  readonly hostIdentity: string;
  readonly hostVersion: string;
  readonly armed: boolean;
  /** Idempotent arm: only an armed bridge injects on `before_agent_start`. */
  readonly armInjection: () => { readonly ok: true };
}

export type ProposalLoadBridgeResult =
  | { readonly ok: true; readonly bridge: ProposalLoadBridge }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * Create the narrow host bridge for one immutable proposal-context load
 * plan. Mirrors the committed WP-5A bridge pattern with the distinct
 * proposal-load plan type and message class. Injection happens only when
 * armed, and only on `before_agent_start` host events.
 */
export function createProposalLoadBridge(surface: PiHostSurface, plan: ProposalLoadPlan): ProposalLoadBridgeResult {
  if (surface === null || typeof surface !== 'object') {
    return { ok: false, code: 'host-incompatible', message: 'Pi host surface is missing' };
  }
  if (typeof surface.on !== 'function') {
    return { ok: false, code: 'host-incompatible', message: 'Pi host surface does not expose the extension event API' };
  }
  if (!isBrandedLoadPlan(plan)) {
    return { ok: false, code: 'plan-invalid', message: 'supplied plan is not a validated proposal-context load plan' };
  }
  let armed = false;
  surface.on('before_agent_start', () => {
    if (!armed) return undefined;
    return {
      message: {
        customType: 'pgw.proposal-load',
        content: plan.renderedPrompt,
        display: true,
      },
    };
  });
  const bridge: ProposalLoadBridge = {
    plan,
    hostIdentity: surface.hostIdentity,
    hostVersion: surface.hostVersion,
    get armed() {
      return armed;
    },
    armInjection() {
      armed = true;
      return { ok: true };
    },
  };
  return { ok: true, bridge: Object.freeze(bridge) };
}

/** Bounded visible feedback: loaded kinds + exact revisions, omitted kinds, load identity. */
export function buildLoadFeedback(plan: ProposalLoadPlan): string {
  const loaded = plan.loaded.map((a) => `${a.kind} ${a.revisionId}`).join(', ');
  const omitted = plan.omittedKinds.length > 0 ? `; omitted: ${plan.omittedKinds.join(', ')}` : '';
  const supersedes = plan.supersedesLoadId !== undefined ? ` (supersedes ${plan.supersedesLoadId})` : '';
  return `Loaded: ${loaded}${omitted}. Load ${plan.loadId}${supersedes}.`;
}

export type GatewayLoadOutcome =
  | { readonly ok: true; readonly plan: ProposalLoadPlan; readonly bridge: ProposalLoadBridge; readonly feedback: string }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly feedback: string };

export interface GatewayLoadInput {
  /** Pi extension host surface (injection seam). */
  readonly surface: PiHostSurface;
  /** Host-owned load lane (trusted configuration + WP-7 reader + surface schema registry). */
  readonly lane: ProposalLoadLane;
  /** Host/operator load options (closed fields; Model-C pins). */
  readonly options: unknown;
  /** Minimal in-memory session registry (supersession identification). */
  readonly sessions?: ProposalLoadSessionRegistry;
}

/**
 * The short Pi action: resolve → validate → correlate → render → inject.
 * A failed load injects nothing and returns typed feedback.
 */
export async function performGatewayLoad(input: GatewayLoadInput): Promise<GatewayLoadOutcome> {
  // The prior-load lookup needs only the workspace selector; validation is
  // pure and cheap, and `resolveProposalLoad` re-validates authoritatively.
  const preValidated = validateLoadOptions(input.options);
  const previousLoadId = preValidated.ok ? input.sessions?.previous(preValidated.options.workspaceId) : undefined;
  const result: ProposalLoadResult = await resolveProposalLoad(input.lane, input.options, {
    ...(previousLoadId !== undefined && previousLoadId !== '' ? { supersedesLoadId: previousLoadId } : {}),
  });
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, feedback: `Load failed: ${result.code}.` };
  }
  const bridgeResult = createProposalLoadBridge(input.surface, result.plan);
  if (!bridgeResult.ok) {
    return { ok: false, code: bridgeResult.code, message: bridgeResult.message, feedback: `Load failed: ${bridgeResult.code}.` };
  }
  bridgeResult.bridge.armInjection();
  input.sessions?.record(result.plan.workspaceId, result.plan.loadId);
  return { ok: true, plan: result.plan, bridge: bridgeResult.bridge, feedback: buildLoadFeedback(result.plan) };
}
