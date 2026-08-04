/**
 * Pi execution observation model (WP-5A).
 *
 * An observation is an immutable, runtime-branded adapter record of what the
 * host reported: session/turn correlation, completion text, tool-call
 * attempts, cancellation, and host errors. It is explicitly NOT an
 * ExecutionResult, NOT a TrustedReceipt, and NOT proof of authorization;
 * tool-call observation never implies permission.
 */
import { snapshotJson } from '../../index.js';
import { sortFindings } from './findings.js';
import { brandObservationWrapper } from './internal/brand.js';
import { PI_ADAPTER_PROTOCOL_VERSION } from './types.js';
import type {
  PiCapturedEvent,
  PiExecutionObservation,
  PiFinding,
  PiHostBridge,
  PiToolCallObservation,
} from './types.js';

/** Derive the observation from a bridge's captured host events. */
export function observePiExecution(
  bridge: PiHostBridge,
  opts: { sessionCorrelationId?: string; turnCorrelationId?: string; cancelled?: boolean } = {},
): PiExecutionObservation {
  const findings: PiFinding[] = [];
  const events = bridge.capturedEvents;
  const sessionId = opts.sessionCorrelationId ?? bridge.sessionCorrelationId;
  const turnId = opts.turnCorrelationId ?? bridge.turnCorrelationId;



  const toolCalls: PiToolCallObservation[] = [];
  const hostErrors: string[] = [];
  let completionText: string | undefined;
  let completionStatus: PiExecutionObservation['completionStatus'] = 'not-observed';
  let cancellationObserved = false;
  let shutdownObserved = false;
  let startObservedAt: string | undefined;
  let endObservedAt: string | undefined;
  let modelId: string | undefined;
  let providerId: string | undefined;
  let usage: Record<string, unknown> | undefined;

  let toolSequence = 0;
  const toolEnds = new Map<string, PiToolCallObservation>();
  for (const event of events) {
    if (event.late === true) {
      // events after session_shutdown are classified late: captured as data,
      // excluded from completion/tool derivation, reported with a stable finding
      findings.push({ category: 'PI-ADAPTER-CORRELATION-MISMATCH', key: 'observation.late-event', message: `host event ${event.kind} arrived after session shutdown`, location: `/${event.kind}` });
      continue;
    }
    const data = event.data as Record<string, unknown>;
    const timestampOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);
    switch (event.kind) {
      case 'session_start': {
        const reason = typeof data['reason'] === 'string' ? data['reason'] : 'startup';
        if (reason !== 'startup') {
          findings.push({ category: 'PI-ADAPTER-CORRELATION-MISMATCH', key: 'observation.session-restart', message: `session restarted with reason ${reason}`, location: '/session_start' });
        }
        break;
      }
      case 'turn_start': {
        const timestamp = timestampOf(data['timestamp']);
        if (timestamp !== undefined && startObservedAt === undefined) startObservedAt = timestamp;
        break;
      }
      case 'tool_execution_start': {
        const toolCallId = typeof data['toolCallId'] === 'string' ? data['toolCallId'] : '';
        const toolName = typeof data['toolName'] === 'string' ? data['toolName'] : '';
        toolCalls.push({ toolCallId, toolName, sequence: toolSequence++, observed: true });
        break;
      }
      case 'tool_execution_end': {
        const toolCallId = typeof data['toolCallId'] === 'string' ? data['toolCallId'] : '';
        const isError = data['isError'] === true;
        if (isError) hostErrors.push(`tool:${toolCallId}`);
        toolEnds.set(toolCallId, { toolCallId, toolName: typeof data['toolName'] === 'string' ? data['toolName'] : '', sequence: toolSequence++, observed: true });
        break;
      }
      case 'message_end': {
        const rawMessage = data['message'];
        const message = rawMessage !== null && typeof rawMessage === 'object' ? (rawMessage as Record<string, unknown>) : undefined;
        const role = typeof message?.['role'] === 'string' ? message['role'] : '';
        if (message !== undefined && role === 'assistant') {
          const content = message['content'];
          if (Array.isArray(content)) {
            const text = content
              .map((part) => (part && typeof part === 'object' && typeof (part as Record<string, unknown>)['text'] === 'string' ? (part as Record<string, unknown>)['text'] as string : ''))
              .join('');
            if (text) completionText = text;
          } else if (typeof content === 'string') {
            completionText = content;
          }
          const model = message['model'] as Record<string, unknown> | undefined;
          if (model) {
            modelId = typeof model['id'] === 'string' ? model['id'] : undefined;
            providerId = typeof model['provider'] === 'string' ? model['provider'] : undefined;
          }
          const msgUsage = message['usage'] as Record<string, unknown> | undefined;
          if (msgUsage) usage = msgUsage;
        }
        break;
      }
      case 'agent_settled': {
        const timestamp = timestampOf(data['timestamp']);
        if (timestamp !== undefined && endObservedAt === undefined) endObservedAt = timestamp;
        break;
      }
      case 'session_shutdown': {
        shutdownObserved = true;
        const timestamp = timestampOf(data['timestamp']);
        if (timestamp !== undefined && endObservedAt === undefined) endObservedAt = timestamp;
        break;
      }
      default:
        break;
    }
  }

  if (opts.cancelled === true || bridge.cancellationObserved) {
    cancellationObserved = true;
    completionStatus = 'cancelled';
  } else if (hostErrors.length > 0) {
    completionStatus = 'error';
  } else if (completionText !== undefined) {
    completionStatus = 'completed';
  }

  const completeness: PiExecutionObservation['completeness'] = cancellationObserved
    ? 'cancelled'
    : completionStatus === 'completed' && shutdownObserved
      ? 'complete'
      : 'partial';

  const observation: PiExecutionObservation = {
    protocolVersion: PI_ADAPTER_PROTOCOL_VERSION,
    piHostIdentity: bridge.hostIdentity,
    piHostVersion: bridge.hostVersion,
    bundleReference: bridge.plan.bundleReference,
    occurrenceId: bridge.plan.occurrenceId,
    attemptId: bridge.plan.attemptId,
    ...(sessionId !== undefined ? { sessionCorrelationId: sessionId } : {}),
    ...(turnId !== undefined ? { turnCorrelationId: turnId } : {}),
    ...(startObservedAt !== undefined ? { startObservedAt } : {}),
    ...(endObservedAt !== undefined ? { endObservedAt } : {}),
    ...(completionText !== undefined ? { completionText } : {}),
    completionStatus,
    cancellationObserved,
    hostErrors: Object.freeze([...hostErrors]),
    toolCalls: Object.freeze([...toolCalls, ...toolEnds.values()].sort((a, b) => a.sequence - b.sequence)),
    ...(modelId !== undefined || providerId !== undefined || usage !== undefined ? { model: Object.freeze({ ...(modelId !== undefined ? { modelId } : {}), ...(providerId !== undefined ? { providerId } : {}), ...(usage !== undefined ? { usage } : {}) }) } : {}),
    findings: Object.freeze(sortFindings(findings)),
    completeness,
    isAdapterObservation: true,
    isExecutionResult: false,
    isTrustedReceipt: false,
    impliesAuthorization: false,
    toolObservationImpliesPermission: false,
  };

  const snapshot = snapshotJson(observation) as PiExecutionObservation;
  const wrapper = Object.freeze({ ...snapshot }) as unknown as PiExecutionObservation;
  brandObservationWrapper(wrapper);
  return wrapper;
}

export type { PiCapturedEvent };
