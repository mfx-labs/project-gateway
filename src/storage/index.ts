/**
 * WP-8-B internal storage barrel (WP-8-B non-mutating foundation).
 *
 * PRIVATE TO THE REPOSITORY: `src/storage/**` is not exported from the
 * package root (`src/index.ts` is unchanged), is never registered as an MCP
 * tool or adapter, and exposes no public mutation surface.
 *
 * This phase provides pure, deterministic storage-domain representations
 * and algorithms only. It establishes no storage authority and implements
 * no persistence: no module in this tree imports filesystem, process,
 * child-process, worker, network, environment, timer, or randomness
 * facilities, and no capability instance or factory exists (CAP-013;
 * WP-8-B scope).
 */
export * from './types.js';
export * from './format/index.js';
export * from './layout/index.js';
export * from './errors/index.js';
export * from './limits/index.js';
export * from './configuration/index.js';
