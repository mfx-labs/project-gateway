/**
 * WP-8-C initialization module barrel (private to the repository). Exports
 * the orchestrator and the pure aggregate classifier. The provisioning owner
 * and state functions are reachable through the orchestrator; direct
 * provision imports are internal to the initialization component.
 */
export { initializeTrustedStore } from './initialize.js';
export type { InitializeRequest } from './initialize.js';
export { classifyAggregateState } from './state.js';
