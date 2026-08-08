/**
 * WP-12 Slice 1 — host-side / process-level decision coordination
 * (FSCR-W12-001).
 *
 * The WP-12 decision coordination lock is HOST-SIDE / PROCESS-LEVEL
 * decision serialization ONLY. It is NOT a second WP-8 writer lock, NOT a
 * custom filesystem lock file inside the WP-8 `locks/` directory, NOT a new
 * WP-8 layout artifact, NOT a modification of `src/storage/locks`, NOT a
 * nested acquisition of the existing WP-8 writer lock, and NOT a new
 * persistence protocol. It creates no filesystem entry anywhere, and it
 * provides NO cross-process exclusion.
 *
 * The default implementation is an in-process keyed reentrancy guard: the
 * same lifecycle decision key cannot be entered twice concurrently (or
 * re-entrantly) within the trusted control-plane process. Because the
 * Slice-1 core is synchronous, the guard's observable contract is: exactly
 * one in-flight decision per key; a second overlapping acquisition of the
 * same key fails closed with `LockContentionError` (mapped to
 * `lock-conflict` by the core). Release is guaranteed on success, typed
 * denial, and thrown errors (try/finally).
 *
 * Supported host composition (Slice 1): ONE control-plane instance per
 * store. Multi-process control-plane composition against the same store is
 * NOT serialized by this mechanism; only WP-8's per-record publication lock
 * applies then, and such composition is outside the Slice-1 supported
 * surface (fail closed / reject unsupported composition at the host).
 *
 * Pure module: no I/O, no persistence, no authority.
 */
import type { DecisionCoordinator } from './types.js';

/** Raised when the same decision key is already held (in-process contention). */
export class LockContentionError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`decision coordination lock is already held for key ${key}`);
    this.name = 'LockContentionError';
    this.key = key;
  }
}

/**
 * In-process keyed decision coordinator. Hosts MAY inject their own
 * implementation; the ordering contract (acquire → read → revalidate →
 * publish → verify → release) is enforced by the core, never reversed, and
 * the internal WP-8 writer lock is never held manually while calling
 * `publishRecord`.
 */
export function createProcessLocalCoordinator(): DecisionCoordinator {
  const held = new Map<string, boolean>();
  return Object.freeze({
    withLock<T>(key: string, fn: () => T): T {
      if (held.get(key) === true) throw new LockContentionError(key);
      held.set(key, true);
      try {
        return fn();
      } finally {
        held.delete(key);
      }
    },
  });
}
