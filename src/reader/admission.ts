/**
 * WP-7 — Concurrency admission controller.
 *
 * Maximum 4 active operations. Fifth concurrent admission fails immediately
 * with ERR-LIMIT-CONCURRENCY. No internal waiting queue. Disposal is
 * idempotent; no operation may begin after disposal.
 */
import { type OperationCorrelation } from './types.js';
import { errLimitConcurrency } from './errors.js';

export class ConcurrencyController {
  private _active = 0;
  private _disposed = false;
  readonly maxConcurrent: number;

  constructor(maxConcurrent = 4) {
    this.maxConcurrent = maxConcurrent;
  }

  get active(): number {
    return this._active;
  }

  get disposed(): boolean {
    return this._disposed;
  }

  /** Try to admit an operation. Returns null on success, or a failure on rejection. */
  tryAdmit(correlation: OperationCorrelation): ReturnType<typeof errLimitConcurrency> | null {
    if (this._disposed) {
      return errLimitConcurrency(correlation);
    }
    if (this._active >= this.maxConcurrent) {
      return errLimitConcurrency(correlation);
    }
    this._active++;
    return null;
  }

  /** Release an operation slot. */
  release(): void {
    if (this._active > 0) {
      this._active--;
    }
  }

  /** Dispose the controller. After disposal, all admissions fail. */
  dispose(): void {
    this._disposed = true;
  }

  /** Wrap an async operation with admission/release. */
  async run<T>(
    correlation: OperationCorrelation,
    fn: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T | ReturnType<typeof errLimitConcurrency>> {
    const rejection = this.tryAdmit(correlation);
    if (rejection) return rejection;
    try {
      return await fn(signal);
    } finally {
      this.release();
    }
  }
}
