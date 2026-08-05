/**
 * WP-6 Phase 3A: descriptor-safe capture of the exact router request shell
 * (contract Sections 3, 6, 10, 11). The shell carries only the route version,
 * the legacy declaration, and the nested input reference; nested protocol data
 * is captured separately (input-capture). No branch selection and no semantic
 * evaluation occur in Phase 3A.
 *
 * Capture rules: exact own-key set per variant; own enumerable data
 * descriptors only; inherited fields, accessors (rejected without invocation),
 * symbols, non-enumerable fields, unknown fields, missing descriptors,
 * structural traps, and revoked Proxies fail closed; zero Proxy `get`; zero
 * getter invocation; every accepted value is extracted exactly once.
 */
import {
  LEGACY_COMPATIBILITY_MODE,
  ROUTE_PROTOCOL_VERSION_1,
  ROUTE_PROTOCOL_VERSION_2,
  type VersionedPointOfUseRouterRequest,
} from './router-types.js';

export type RouterShellFailureCode = 'shell-structural' | 'route-tag' | 'legacy-declaration';

export type CapturedRouterShell =
  | {
      readonly variant: 'v1';
      readonly routeProtocolVersion: typeof ROUTE_PROTOCOL_VERSION_1;
      readonly legacyCompatibilityMode: typeof LEGACY_COMPATIBILITY_MODE;
      /** Nested input reference, extracted exactly once (not deep-captured here). */
      readonly inputs: unknown;
    }
  | {
      readonly variant: 'v2';
      readonly routeProtocolVersion: typeof ROUTE_PROTOCOL_VERSION_2;
      /** Nested input reference, extracted exactly once (not deep-captured here). */
      readonly inputs: unknown;
    };

export type RouterShellCaptureResult =
  | { readonly ok: true; readonly shell: CapturedRouterShell }
  | { readonly ok: false; readonly code: RouterShellFailureCode };

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  try {
    return !Array.isArray(value);
  } catch {
    // A revoked Proxy cannot be structurally classified: fail closed.
    return false;
  }
}

/**
 * Extract one shell field through its own property descriptor. Returns the
 * value only for an own enumerable data descriptor; accessors, non-enumerable
 * fields, missing descriptors, and descriptor traps fail closed. Never reads
 * through ordinary property access, so Proxy `get` traps never fire and
 * getters are never invoked.
 */
function extractShellField(value: Record<string, unknown>, key: string): unknown | undefined {
  let desc: PropertyDescriptor | undefined;
  try {
    desc = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  if (desc === undefined) return undefined;
  if (desc.get !== undefined || desc.set !== undefined) return undefined;
  if (!desc.enumerable) return undefined;
  return desc.value;
}

/**
 * Capture the router request shell. Deterministic failure precedence
 * (contract Section 11): shell structural failure (unknown/missing/hostile
 * fields) precedes outer route-version failure, which precedes
 * legacy-declaration failure.
 */
export function captureRouterRequest(value: unknown): RouterShellCaptureResult {
  if (!isRecord(value)) {
    return { ok: false, code: 'shell-structural' };
  }
  let keys: string[];
  let symbols: symbol[];
  try {
    keys = Object.getOwnPropertyNames(value);
    symbols = Object.getOwnPropertySymbols(value);
  } catch {
    // Structural traps (ownKeys) and revoked Proxies fail closed.
    return { ok: false, code: 'shell-structural' };
  }
  if (symbols.length > 0) {
    return { ok: false, code: 'shell-structural' };
  }
  const has = (k: string): boolean => keys.includes(k);

  // v1 variant: exact three-key shape.
  if (keys.length === 3 && has('routeProtocolVersion') && has('legacyCompatibilityMode') && has('inputs')) {
    const route = extractShellField(value, 'routeProtocolVersion');
    if (route === undefined) return { ok: false, code: 'shell-structural' };
    if (route !== ROUTE_PROTOCOL_VERSION_1) return { ok: false, code: 'route-tag' };
    const legacy = extractShellField(value, 'legacyCompatibilityMode');
    if (legacy === undefined) return { ok: false, code: 'shell-structural' };
    if (legacy !== LEGACY_COMPATIBILITY_MODE) return { ok: false, code: 'legacy-declaration' };
    const inputs = extractShellField(value, 'inputs');
    if (inputs === undefined) return { ok: false, code: 'shell-structural' };
    return {
      ok: true,
      shell: { variant: 'v1', routeProtocolVersion: ROUTE_PROTOCOL_VERSION_1, legacyCompatibilityMode: LEGACY_COMPATIBILITY_MODE, inputs },
    };
  }

  // v2 variant: exact two-key shape (legacyCompatibilityMode forbidden).
  if (keys.length === 2 && has('routeProtocolVersion') && has('inputs')) {
    const route = extractShellField(value, 'routeProtocolVersion');
    if (route === undefined) return { ok: false, code: 'shell-structural' };
    if (route !== ROUTE_PROTOCOL_VERSION_2) return { ok: false, code: 'route-tag' };
    const inputs = extractShellField(value, 'inputs');
    if (inputs === undefined) return { ok: false, code: 'shell-structural' };
    return { ok: true, shell: { variant: 'v2', routeProtocolVersion: ROUTE_PROTOCOL_VERSION_2, inputs } };
  }

  return { ok: false, code: 'shell-structural' };
}

/**
 * Convenience type guard over the exact normative union: a captured shell
 * always corresponds to a valid `VersionedPointOfUseRouterRequest` shape at
 * the type level (runtime inputs are still captured, never trusted).
 */
export function shellAsRouterRequest(shell: CapturedRouterShell): VersionedPointOfUseRouterRequest {
  if (shell.variant === 'v1') {
    return {
      routeProtocolVersion: ROUTE_PROTOCOL_VERSION_1,
      legacyCompatibilityMode: LEGACY_COMPATIBILITY_MODE,
      inputs: shell.inputs as never,
    };
  }
  return {
    routeProtocolVersion: ROUTE_PROTOCOL_VERSION_2,
    inputs: shell.inputs as never,
  };
}
