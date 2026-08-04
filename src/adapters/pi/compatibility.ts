/**
 * Pi host capability model and drift detection (WP-5A).
 *
 * Compatibility binds to observable API properties, never to the version
 * string alone. A deterministic, documented, non-authoritative capability
 * fingerprint is derived from the required API surface; missing or changed
 * required properties reject projection or host binding with a stable
 * compatibility finding and no fallback through undocumented behavior.
 */
import { createHash } from 'node:crypto';
import { piFinding, sortFindings } from './findings.js';
import { readCapabilitySnapshot, type CapabilitySnapshot } from './internal/input-shape.js';
import { capabilityEntryString, parseMediaDeclaration, declaredMediaTypes } from './internal/media-type.js';
import {
  PI_ADAPTER_PROTOCOL_VERSION,
  PI_CONSUMER_IDENTITY,
  PI_CONSUMER_VERSION,
  SUPPORTED_PI_LANE,
} from './types.js';
import type { PiCapabilityCompatibility, PiFinding, PiHostCapabilityDeclaration } from './types.js';

/** Supported Pi package identity and version lane (inspected locally). */
export const SUPPORTED_PI_PACKAGE_ID = '@earendil-works/pi-coding-agent';
export const SUPPORTED_PI_VERSION = '0.83.0';

/** Required prompt injection mechanisms. */
const REQUIRED_PROMPT_INJECTION = ['before-agent-start-message'] as const;
/** Required context transport. */
const REQUIRED_CONTEXT_TRANSPORT = ['length-prefixed-data-blocks'] as const;
/** Required session lifecycle events. */
const REQUIRED_SESSION_EVENTS = ['session_start', 'session_shutdown'] as const;
/** Required turn lifecycle events. */
const REQUIRED_TURN_EVENTS = ['turn_start', 'turn_end'] as const;
/** Required result observation events. */
const REQUIRED_RESULT_EVENTS = ['message_end', 'agent_end', 'agent_settled'] as const;
/** Required tool-call observation events. */
const REQUIRED_TOOL_EVENTS = ['tool_execution_start', 'tool_execution_end', 'tool_call'] as const;
/** Required cancellation observation events. */
const REQUIRED_CANCELLATION_EVENTS = ['agent_settled'] as const;
/** Required shutdown observation events. */
const REQUIRED_SHUTDOWN_EVENTS = ['session_shutdown'] as const;
/** Required text encodings. */
const REQUIRED_TEXT_ENCODINGS = ['utf-8'] as const;
/** Minimum required media capability: the approved textual context
 *  representation (`text/plain`). */
const REQUIRED_TEXT_MEDIA = ['text/plain'] as const;

function hasAll(have: unknown, need: readonly string[]): string[] {
  // non-array capability lists are treated as declaring nothing (fail closed;
  // never coerced, never crashed)
  if (!Array.isArray(have)) return [...need];
  return need.filter((n) => !(have as readonly unknown[]).includes(n));
}

function sortedArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...values].map((v) => capabilityEntryString(v)).sort();
}

/** Canonicalize a list of declared values for fingerprinting. */
function canonicalList(label: string, values: unknown): string {
  return `${label}=[${sortedArray(values).join(',')}]`;
}

/** Canonical scalar representation for fingerprinting and messages: primitive
 *  strings verbatim; finite numbers and booleans via their primitive string
 *  form; everything else by runtime type tag. Never coerces and never invokes
 *  caller hooks (F-1/F-3). */
function canonScalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return capabilityEntryString(value);
}

/**
 * Deterministic host capability fingerprint: SHA-256 over the canonical
 * serialization of the required observable API surface. Non-authoritative;
 * used only for compatibility detection and drift reporting. The capability
 * container is read through own data descriptors only (A-2): getters,
 * accessors, Proxy `get` traps, and conversion hooks never execute, and
 * malformed containers produce a stable deterministic fingerprint without
 * crashing.
 */
export function hostCapabilityFingerprint(capability: PiHostCapabilityDeclaration): string {
  const result = readCapabilitySnapshot(capability);
  if (!result.ok) return fingerprintFromSnapshotFailure(result.findings);
  return fingerprintFromSnapshot(result.snapshot);
}

/** Deterministic fingerprint over the canonical required-surface serialization. */
function fingerprintFromSnapshot(cap: CapabilitySnapshot): string {
  const canonical = [
    `piPackageId=${canonScalar(cap.piPackageId)}`,
    `piVersion=${canonScalar(cap.piVersion)}`,
    `adapterApiVersion=${canonScalar(cap.adapterApiVersion)}`,
    canonicalList('promptInjection', cap.promptInjection),
    canonicalList('contextTransport', cap.contextTransport),
    `maxPromptBytes=${canonScalar(cap.maxPromptBytes)}`,
    canonicalList('textEncodings', cap.textEncodings),
    canonicalList('mediaTypes', cap.mediaTypes),
    canonicalList('sessionLifecycleEvents', cap.sessionLifecycleEvents),
    canonicalList('turnLifecycleEvents', cap.turnLifecycleEvents),
    canonicalList('resultObservationEvents', cap.resultObservationEvents),
    canonicalList('toolCallObservationEvents', cap.toolCallObservationEvents),
    canonicalList('cancellationObservationEvents', cap.cancellationObservationEvents),
    canonicalList('shutdownObservationEvents', cap.shutdownObservationEvents),
    `correlationMetadataSupported=${canonScalar(cap.correlationMetadataSupported)}`,
    `deterministicOrdering=${canonScalar(cap.deterministicOrdering)}`,
    canonicalList('requiredFeatures', cap.requiredFeatures),
  ].join('|');
  return 'sha-256:' + createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Deterministic fingerprint for a capability that failed the descriptor gate. */
function fingerprintFromSnapshotFailure(findings: readonly PiFinding[]): string {
  const canonical = findings.map((f) => `${f.key}@${f.location ?? ''}`).join('|');
  return 'sha-256:' + createHash('sha256').update(`malformed-capability|${canonical}`, 'utf8').digest('hex');
}

/**
 * Verify a host capability declaration against the supported Pi 0.83.0 lane.
 * Unknown required semantics fail closed; no undocumented fallback exists.
 * The declaration is read through own data descriptors only (A-2): getters,
 * accessors, Proxy `get` traps, and conversion hooks never execute, and
 * descriptor-shape failures become stable `host.capability-malformed` /
 * `host.capability-missing` findings.
 */
export function inspectPiHostCompatibility(capability: PiHostCapabilityDeclaration): PiCapabilityCompatibility {
  const result = readCapabilitySnapshot(capability);
  if (!result.ok) {
    return Object.freeze({
      compatible: false,
      fingerprint: fingerprintFromSnapshotFailure(result.findings),
      supportedLane: SUPPORTED_PI_LANE,
      observed: Object.freeze({}),
      findings: Object.freeze(result.findings),
    });
  }
  return inspectCapabilitySnapshot(result.snapshot);
}

/** Compatibility verification over a validated capability snapshot. */
function inspectCapabilitySnapshot(cap: CapabilitySnapshot): PiCapabilityCompatibility {
  const findings: PiFinding[] = [];
  if (cap.piPackageId !== SUPPORTED_PI_PACKAGE_ID) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.package-identity', `unsupported Pi package identity ${canonScalar(cap.piPackageId)}`, '/piPackageId'));
  }
  if (cap.piVersion !== SUPPORTED_PI_VERSION) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.version-drift', `unsupported Pi version ${canonScalar(cap.piVersion)}; supported lane is ${SUPPORTED_PI_VERSION}`, '/piVersion'));
  }
  if (cap.adapterApiVersion !== PI_ADAPTER_PROTOCOL_VERSION) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.adapter-api-version', `unsupported adapter API version ${canonScalar(cap.adapterApiVersion)}`, '/adapterApiVersion'));
  }
  for (const missing of hasAll(cap.promptInjection ?? [], REQUIRED_PROMPT_INJECTION)) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.prompt-injection-missing', `required prompt injection mechanism ${missing} is missing`, '/promptInjection'));
  }
  for (const missing of hasAll(cap.contextTransport ?? [], REQUIRED_CONTEXT_TRANSPORT)) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.context-transport-missing', `required context transport ${missing} is missing`, '/contextTransport'));
  }
  for (const missing of hasAll(cap.sessionLifecycleEvents ?? [], REQUIRED_SESSION_EVENTS)) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.session-events-missing', `required session lifecycle event ${missing} is missing`, '/sessionLifecycleEvents'));
  }
  for (const missing of hasAll(cap.turnLifecycleEvents ?? [], REQUIRED_TURN_EVENTS)) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.turn-events-missing', `required turn lifecycle event ${missing} is missing`, '/turnLifecycleEvents'));
  }
  for (const missing of hasAll(cap.resultObservationEvents ?? [], REQUIRED_RESULT_EVENTS)) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.result-observation-missing', `required result observation event ${missing} is missing`, '/resultObservationEvents'));
  }
  for (const missing of hasAll(cap.toolCallObservationEvents ?? [], REQUIRED_TOOL_EVENTS)) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.tool-observation-missing', `required tool-call observation event ${missing} is missing`, '/toolCallObservationEvents'));
  }
  for (const missing of hasAll(cap.cancellationObservationEvents ?? [], REQUIRED_CANCELLATION_EVENTS)) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.cancellation-observation-missing', `required cancellation observation event ${missing} is missing`, '/cancellationObservationEvents'));
  }
  for (const missing of hasAll(cap.shutdownObservationEvents ?? [], REQUIRED_SHUTDOWN_EVENTS)) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.shutdown-observation-missing', `required shutdown observation event ${missing} is missing`, '/shutdownObservationEvents'));
  }
  for (const missing of hasAll(cap.textEncodings ?? [], REQUIRED_TEXT_ENCODINGS)) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.encoding-missing', `required text encoding ${missing} is missing`, '/textEncodings'));
  }
  // media capability: at least the approved textual representation is required;
  // empty, unknown, or malformed media declarations fail closed. Entries are
  // validated by actual runtime type and syntax — never coerced with String().
  if (cap.mediaTypes === undefined) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.text-media-missing', 'host declares no media types; text/plain is required', '/mediaTypes'));
  } else if (!Array.isArray(cap.mediaTypes)) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.media-malformed', 'host mediaTypes declaration is not an array', '/mediaTypes'));
  } else if (cap.mediaTypes.length === 0) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.text-media-missing', 'host declares no media types; text/plain is required', '/mediaTypes'));
  } else {
    for (const media of cap.mediaTypes) {
      // sparse-array holes iterate as undefined and are rejected as non-strings
      const parsed = parseMediaDeclaration(media);
      if (parsed.status === 'wildcard') {
        findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.media-wildcard-unsupported', `media declaration ${parsed.raw ?? ''} uses an unsupported wildcard`, '/mediaTypes'));
      } else if (parsed.status !== 'valid') {
        findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.media-malformed', `media declaration ${parsed.raw ?? ''} is malformed or not a string`, '/mediaTypes'));
      }
    }
    const normalized = declaredMediaTypes(cap.mediaTypes);
    for (const missing of REQUIRED_TEXT_MEDIA) {
      if (!normalized.includes(missing)) {
        findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.text-media-missing', `required text media type ${missing} is missing`, '/mediaTypes'));
      }
    }
  }
  if (cap.maxPromptBytes === undefined) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.max-prompt-missing', 'host maximum prompt size is missing', '/maxPromptBytes'));
  } else if (typeof cap.maxPromptBytes !== 'number' || !Number.isSafeInteger(cap.maxPromptBytes) || cap.maxPromptBytes <= 0) {
    // F-3: the host prompt bound must be a positive safe-integer byte count;
    // strings, booleans, NaN, Infinity, fractions, zero, negatives, and
    // unsafe integers fail closed without any numeric coercion
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.prompt-bound-malformed', 'host maximum prompt size must be a positive safe-integer byte count', '/maxPromptBytes'));
  }
  if (cap.correlationMetadataSupported !== true) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.correlation-unsupported', 'host does not support correlation metadata', '/correlationMetadataSupported'));
  }
  if (cap.deterministicOrdering !== true) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.ordering-not-deterministic', 'host does not guarantee deterministic ordering', '/deterministicOrdering'));
  }
  // unknown required features fail closed
  const KNOWN_FEATURES = new Set<string>(['base64-context', 'text-context', 'length-prefixed-data-blocks', 'before-agent-start-message']);
  if (cap.requiredFeatures !== undefined && !Array.isArray(cap.requiredFeatures)) {
    findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.required-feature-unknown', 'required features declaration is not an array', '/requiredFeatures'));
  } else if (Array.isArray(cap.requiredFeatures)) {
    for (const feature of cap.requiredFeatures) {
      if (!KNOWN_FEATURES.has(capabilityEntryString(feature))) {
        findings.push(piFinding('PI-ADAPTER-HOST-INCOMPATIBLE', 'host.required-feature-unknown', `unsupported required host feature ${capabilityEntryString(feature)}`, '/requiredFeatures'));
      }
    }
  }

  const sorted = sortFindings(findings);
  return Object.freeze({
    compatible: sorted.length === 0,
    fingerprint: fingerprintFromSnapshot(cap),
    supportedLane: SUPPORTED_PI_LANE,
    observed: Object.freeze({
      piPackageId: canonScalar(cap.piPackageId),
      piVersion: canonScalar(cap.piVersion),
      adapterApiVersion: canonScalar(cap.adapterApiVersion),
      consumerIdentity: PI_CONSUMER_IDENTITY,
      consumerVersion: PI_CONSUMER_VERSION,
      adapterProtocolVersion: PI_ADAPTER_PROTOCOL_VERSION,
    }),
    findings: Object.freeze(sorted),
  });
}
