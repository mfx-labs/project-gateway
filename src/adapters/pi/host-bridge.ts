/**
 * Narrow Pi host bridge prototype (WP-5A).
 *
 * The bridge accepts one immutable `PiInvocationPlan`, injects the trusted
 * adapter preamble, task, context data, completion criteria, and correlation
 * metadata through the supported Pi prompt-injection mechanism
 * (`before_agent_start` message injection), and observes session/turn
 * lifecycle, model completion, tool-call attempts (as data), settle, and
 * shutdown. It never authorizes, disables, or enables tools, never changes
 * pi-guard mode, never mutates Pi settings, never installs extensions, never
 * starts Pi, and never writes lifecycle state.
 *
 * The bridge binds to a narrow structural `PiHostSurface` matching the public
 * `@earendil-works/pi-coding-agent` (0.83.0) ExtensionAPI subset; actual Pi
 * integration is environment-gated (see `host-harness.ts`). Cancellation is
 * not a distinct public 0.83.0 extension event: it is recorded only when the
 * integration layer supplies a host cancellation observation.
 */
import { snapshotJson } from '../../index.js';
import { piFinding, sortFindings } from './findings.js';
import { isBrandedPlan, isBrandedObservation } from './internal/brand.js';
import { observePiExecution } from './observation.js';
import type {
  PiExecutionObservation,
  PiFinding,
  PiHostBridge,
  PiHostBridgeResult,
  PiHostSurface,
  PiInvocationPlan,
} from './types.js';

export type { PiHostBridge, PiHostBridgeResult };

interface BridgeState {
  events: import('./types.js').PiCapturedEvent[];
  sessionCorrelationId?: string;
  turnCorrelationId?: string;
  cancellationObserved: boolean;
  armed: boolean;
  shutdownSeen: boolean;
}

function capture(state: BridgeState, kind: string, data: unknown): void {
  state.events.push({
    kind,
    sequence: state.events.length,
    data: snapshotJson(data) as Record<string, unknown>,
    ...(state.shutdownSeen ? { late: true } : {}),
  });
}

function ctxSessionId(ctx: unknown): string | undefined {
  if (ctx === null || typeof ctx !== 'object') return undefined;
  const sessionManager = (ctx as Record<string, unknown>)['sessionManager'];
  if (sessionManager === null || typeof sessionManager !== 'object') return undefined;
  const getSessionId = (sessionManager as Record<string, unknown>)['getSessionId'];
  if (typeof getSessionId !== 'function') return undefined;
  const value = (getSessionId as () => unknown).call(sessionManager);
  return typeof value === 'string' ? value : undefined;
}

/** Create the narrow host bridge for one immutable plan. */
export function createPiHostBridge(surface: PiHostSurface, plan: PiInvocationPlan): PiHostBridgeResult & { bridge?: PiHostBridge } {
  if (!surface || typeof surface !== 'object') {
    return { ok: false, findings: Object.freeze([piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'bridge.surface-missing', 'Pi host surface is missing')]) };
  }
  if (typeof surface.on !== 'function') {
    return { ok: false, findings: Object.freeze([piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'bridge.on-missing', 'Pi host surface does not expose the extension event API')]) };
  }
  if (!plan || typeof plan !== 'object' || !isBrandedPlan(plan)) {
    return { ok: false, findings: Object.freeze([piFinding('PI-ADAPTER-INPUT-INVALID', 'bridge.plan-forged', 'supplied plan is not a validated Pi invocation plan')]) };
  }
  if (plan.status !== 'projection-ready') {
    return { ok: false, findings: Object.freeze([piFinding('PI-ADAPTER-INPUT-INVALID', 'bridge.plan-status', 'supplied plan is not projection-ready')]) };
  }

  const state: BridgeState = { events: [], cancellationObserved: false, armed: false, shutdownSeen: false };

  const observe = (kind: string) => (event: unknown, ctx?: unknown): unknown => {
    capture(state, kind, event);
    if (kind === 'session_start') {
      state.sessionCorrelationId = ctxSessionId(ctx) ?? state.sessionCorrelationId;
    }
    if (kind === 'session_shutdown') {
      state.shutdownSeen = true;
    }
    return undefined;
  };

  surface.on('session_start', observe('session_start'));
  surface.on('session_shutdown', observe('session_shutdown'));
  surface.on('turn_start', (event) => {
    capture(state, 'turn_start', event);
    const data = event as Record<string, unknown> | null;
    if (data && typeof data['turnIndex'] === 'number') state.turnCorrelationId = `turn:${data['turnIndex']}`;
    return undefined;
  });
  surface.on('turn_end', observe('turn_end'));
  surface.on('message_end', observe('message_end'));
  surface.on('tool_execution_start', observe('tool_execution_start'));
  surface.on('tool_execution_end', observe('tool_execution_end'));
  surface.on('tool_call', (event) => {
    // observe only: never block, never mutate input, never authorize
    capture(state, 'tool_call', event);
    return undefined;
  });
  surface.on('agent_end', observe('agent_end'));
  surface.on('agent_settled', observe('agent_settled'));
  surface.on('before_agent_start', () => {
    // documented prompt-injection mechanism: inject one immutable message
    return {
      message: {
        customType: 'pgw.projection',
        content: plan.renderedPrompt,
        display: true,
      },
    };
  });

  const bridge: PiHostBridge = {
    plan,
    hostIdentity: surface.hostIdentity,
    hostVersion: surface.hostVersion,
    get armed() {
      return state.armed;
    },
    get capturedEvents() {
      return state.events;
    },
    get sessionCorrelationId() {
      return state.sessionCorrelationId;
    },
    get turnCorrelationId() {
      return state.turnCorrelationId;
    },
    get cancellationObserved() {
      return state.cancellationObserved;
    },
    armInjection() {
      // arming is idempotent and never performs direct host injection: the
      // registered `before_agent_start` handler performs the injection on
      // each host event (one injection per event, repeated turns may receive
      // repeated injection by documented contract)
      state.armed = true;
      return { ok: true };
    },
    recordCancellation() {
      state.cancellationObserved = true;
    },
    observe(opts) {
      return observePiExecution(bridge, opts);
    },
  };
  return { ok: true, bridge };
}

/**
 * Verify a plan wrapper: branded, projection-ready, structurally complete.
 * Returns typed findings; never throws for expected invalid input.
 */
export function validatePiInvocationPlan(plan: unknown): { ok: boolean; findings: readonly PiFinding[] } {
  const findings: PiFinding[] = [];
  if (plan === null || typeof plan !== 'object' || !isBrandedPlan(plan)) {
    return { ok: false, findings: Object.freeze([piFinding('PI-ADAPTER-INPUT-INVALID', 'plan.forged', 'value is not a validated Pi invocation plan')]) };
  }
  const p = plan as PiInvocationPlan;
  if (p.status !== 'projection-ready') {
    findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'plan.status', `plan status is ${p.status}, expected projection-ready`));
  }
  if (p.piGuardEnforcementPending !== true) {
    findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'plan.pi-guard-statement', 'plan does not state that pi-guard enforcement is pending'));
  }
  if (typeof p.renderedPrompt !== 'string' || p.renderedPrompt === '') {
    findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'plan.prompt-missing', 'plan has no rendered prompt'));
  }
  for (const field of ['bundleReference', 'taskReference', 'authorityPolicyReference', 'contextManifestReference', 'completionContractReference'] as const) {
    if (!p[field] || typeof p[field] !== 'object') {
      findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'plan.reference-missing', `plan is missing the ${field}`));
    }
  }
  if (typeof p.occurrenceId !== 'string' || p.occurrenceId === '' || typeof p.attemptId !== 'string' || p.attemptId === '') {
    findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'plan.correlation-missing', 'plan is missing occurrence or attempt correlation'));
  }
  return { ok: findings.length === 0, findings: Object.freeze(sortFindings(findings)) };
}

/** Observation guard: value is a branded adapter observation. */
export function isPiExecutionObservation(value: unknown): value is PiExecutionObservation {
  return value !== null && typeof value === 'object' && isBrandedObservation(value);
}

/** Plan guard: value is a branded, validated Pi invocation plan. */
export function isPiInvocationPlan(value: unknown): value is PiInvocationPlan {
  return value !== null && typeof value === 'object' && isBrandedPlan(value);
}
