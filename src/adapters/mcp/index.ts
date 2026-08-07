/**
 * @project-gateway/artifact-core/mcp
 *
 * WP-9 MCP inspection surface (slice 1: transport-free protocol/tool
 * layer). Read-only MCP-facing inspection tools backed exclusively by
 * existing accepted domain APIs (WP-4 artifact validation, WP-8 exact
 * read and authoritative registry view).
 *
 * Transport ownership is NOT part of this slice: the surface is a typed
 * request/response boundary that a future MCP server transport shim
 * (stdlib/stdio/SSE) can host. No storage authority, capability,
 * provenance, or trusted-input creator is exported; results are plain
 * frozen data and confer zero authority.
 */
export { createMcpInspectionSurface, mapDomainError } from './inspect.js';
export { createInspectionContext } from './context.js';
export { createMcpInspectionRegistry, SURFACE_ID_RE } from './registry.js';
export type { McpStoreRegistrationInput, McpInspectionRegistry, RegistryResult } from './registry.js';
export { MCP_INSPECTION_TOOLS, MCP_ERROR_CODES } from './types.js';
export type { McpInspectionContext, McpInspectionContextInput, McpInspectionSurface, McpInspectionTool, McpErrorCode, McpInspectionRequest, McpInspectionResponse, McpToolDescriptor } from './types.js';
export { decodeContinuation, encodeContinuation, validateInspectionRequest } from './validate.js';
export type { ValidationIssue } from './validate.js';
