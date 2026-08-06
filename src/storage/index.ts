/**
 * WP-8-B/WP-8-C internal storage barrel (private to the repository).
 *
 * PRIVATE TO THE REPOSITORY: `src/storage/**` is not exported from the
 * package root (`src/index.ts` is unchanged), is never registered as an MCP
 * tool or adapter, and exposes no public mutation surface.
 *
 * WP-8-C: this barrel exports the initialization orchestrator and types
 * only. The capability creator, the trusted-input creator, and the
 * action-provenance creator are deliberately NOT re-exported here (their
 * exact import edges are enforced by the static guard). Production
 * initialization is unreachable: a genuine action provenance can only be
 * minted by its creator, which no production module may import.
 */
export * from './types.js';
export * from './format/index.js';
export * from './layout/index.js';
export * from './errors/index.js';
export * from './limits/index.js';
export * from './configuration/index.js';
export * from './root/index.js';
export * from './metadata/index.js';
export * from './probe/index.js';
export * from './trusted-input/index.js';
export * from './capabilities/index.js';
export * from './initialization/index.js';
