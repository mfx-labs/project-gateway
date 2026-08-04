/**
 * Consumer-neutral protocol-equality comparators (W4-F1).
 *
 * JSON object member insertion order is not semantically significant.
 * Ordinary `JSON.stringify` is therefore never a protocol equality mechanism.
 * This module is the single authoritative owner of:
 *
 * - `workspaceBindingsEqual` — workspace-binding equality by explicit protocol
 *   fields (`mode`, and for `bound` bindings `workspace_id`);
 * - `exactReferencesEqual` — exact artifact reference equality by every
 *   protocol-significant field (protocol version, artifact kind, kind version,
 *   instance ID, revision ID, canonical digest, workspace binding);
 * - `bundleReferencesEqual` — ExecutionBundle reference equality (the exact
 *   reference shape used by lifecycle `bundle` members).
 *
 * Semantics:
 * - equality is field-based and insertion-order independent;
 * - a portable binding and a bound binding are never equal;
 * - different workspace IDs are never equal;
 * - missing, non-string, unknown, or structurally invalid fields fail closed
 *   (never equal);
 * - only own data properties of plain JSON objects are read: accessors are
 *   never invoked and inherited properties are never consulted, so arbitrary
 *   class instances are not accepted;
 * - comparators are pure, deterministic, and never mutate their operands.
 *
 * Module boundary: imports nothing; exposes no mutable state; no dependency
 * on validators or high-level pipeline modules.
 */

interface JsonObject {
  readonly [key: string]: unknown;
}

/** True only for plain JSON objects (own data properties, object/null prototype). */
function isJsonObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Read an own data property as a string without invoking accessors and without
 * consulting inherited properties. Returns undefined when the property is
 * absent, non-string, or an accessor (fail closed).
 */
function ownString(value: JsonObject, key: string): string | undefined {
  const desc = Object.getOwnPropertyDescriptor(value, key);
  if (desc === undefined) return undefined;
  if (desc.get !== undefined || desc.set !== undefined) return undefined;
  return typeof desc.value === 'string' ? desc.value : undefined;
}

/** Read an own data property as a nested JSON object (fail closed otherwise). */
function ownObject(value: JsonObject, key: string): JsonObject | undefined {
  const desc = Object.getOwnPropertyDescriptor(value, key);
  if (desc === undefined) return undefined;
  if (desc.get !== undefined || desc.set !== undefined) return undefined;
  return isJsonObject(desc.value) ? desc.value : undefined;
}

/**
 * Authoritative workspace-binding equality.
 *
 * - both values must be plain JSON objects with a `mode` of `portable` or
 *   `bound` (unknown modes fail closed);
 * - `portable` bindings are equal to other portable bindings regardless of
 *   member insertion order or non-protocol presentation members;
 * - `bound` bindings are equal only when both carry the exact same
 *   `workspace_id` (member insertion order is irrelevant);
 * - a portable and a bound binding are never equal.
 */
export function workspaceBindingsEqual(a: unknown, b: unknown): boolean {
  if (!isJsonObject(a) || !isJsonObject(b)) return false;
  const am = ownString(a, 'mode');
  const bm = ownString(b, 'mode');
  if (am === undefined || am !== bm) return false;
  if (am === 'portable') return true;
  if (am !== 'bound') return false;
  const aw = ownString(a, 'workspace_id');
  const bw = ownString(b, 'workspace_id');
  if (aw === undefined || bw === undefined) return false;
  return aw === bw;
}

/**
 * Authoritative exact artifact reference equality. Every protocol-significant
 * field must be present and equal:
 *
 * - `target_protocol_version`;
 * - `target_kind.id` and `target_kind.version`;
 * - `target_instance_id`;
 * - `target_revision_id`;
 * - `target_digest`;
 * - `target_workspace_binding` (via `workspaceBindingsEqual`).
 *
 * Member insertion order, display serialization, filenames, paths, aliases,
 * queries, and non-protocol presentation members are never compared. Any
 * difference in a protocol-significant field compares unequal; missing or
 * malformed fields fail closed.
 */
export function exactReferencesEqual(a: unknown, b: unknown): boolean {
  if (!isJsonObject(a) || !isJsonObject(b)) return false;
  if (ownString(a, 'target_protocol_version') !== ownString(b, 'target_protocol_version')) return false;
  const ka = ownObject(a, 'target_kind');
  const kb = ownObject(b, 'target_kind');
  if (ka === undefined || kb === undefined) return false;
  if (ownString(ka, 'id') !== ownString(kb, 'id')) return false;
  if (ownString(ka, 'version') !== ownString(kb, 'version')) return false;
  if (ownString(a, 'target_instance_id') !== ownString(b, 'target_instance_id')) return false;
  if (ownString(a, 'target_revision_id') !== ownString(b, 'target_revision_id')) return false;
  if (ownString(a, 'target_digest') !== ownString(b, 'target_digest')) return false;
  return workspaceBindingsEqual(a['target_workspace_binding'], b['target_workspace_binding']);
}

/**
 * Authoritative ExecutionBundle reference equality: the lifecycle `bundle`
 * member of grant/activation/attempt records uses the exact artifact reference
 * shape, so equality is exact-reference equality over the same fields.
 */
export function bundleReferencesEqual(a: unknown, b: unknown): boolean {
  return exactReferencesEqual(a, b);
}
