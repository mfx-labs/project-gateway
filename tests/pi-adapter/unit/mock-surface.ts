/**
 * Shared mock Pi host surface for bridge tests.
 */
import type { PiHostSurface } from '../../../src/adapters/pi/types.js';

export interface MockSurface extends PiHostSurface {
  readonly handlers: Map<string, (event: unknown, ctx?: unknown) => unknown>;
  /** Tool-inventory access is tracked to prove WP-5A never reads it. */
  readonly toolReads: { count: number };
  readonly toolRegistrations: { count: number };
  readonly messages: { customType: string; content: string; display: boolean }[];
  readonly getActiveTools?: () => readonly string[];
  readonly getAllTools?: () => readonly { name: string; description?: string }[];
  readonly sendMessage?: (message: unknown, options?: unknown) => void;
}

export function mockSurface(over: Partial<MockSurface> = {}): MockSurface {
  const handlers = new Map<string, (event: unknown, ctx?: unknown) => unknown>();
  const toolReads = { count: 0 };
  const toolRegistrations = { count: 0 };
  const messages: { customType: string; content: string; display: boolean }[] = [];
  const surface: MockSurface = {
    hostIdentity: '@earendil-works/pi-coding-agent',
    hostVersion: '0.83.0',
    handlers,
    toolReads,
    toolRegistrations,
    messages,
    on: (event, handler) => {
      handlers.set(event, handler);
    },
    getActiveTools: () => {
      toolReads.count++;
      return ['read', 'bash'];
    },
    getAllTools: () => {
      toolReads.count++;
      return [{ name: 'read' }, { name: 'bash' }];
    },
    sendMessage: (message: unknown) => {
      const m = message as { customType?: string; content?: string; display?: boolean };
      messages.push({ customType: String(m.customType ?? ''), content: String(m.content ?? ''), display: m.display === true });
    },
    ...over,
  };
  return surface;
}

/** Fire a host event through the mock surface handler registry. */
export function fire(surface: MockSurface, event: string, payload: unknown, ctx?: unknown): unknown {
  const handler = surface.handlers.get(event);
  if (!handler) throw new Error(`no handler registered for ${event}`);
  return handler(payload, ctx);
}

/** A Pi-0.83.0-shaped context with a session manager. */
export function hostCtx(sessionId: string): { sessionManager: { getSessionId: () => string } } {
  return { sessionManager: { getSessionId: () => sessionId } };
}
