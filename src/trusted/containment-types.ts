/**
 * WP-6 Phase 2A: existing-path containment protocol types (TCP protocol v1).
 *
 * The Phase-2A request is UNTRUSTED request data (WP-0 remote-producer zone:
 * ChatGPT/MCP requests, prompts, generated content, repository and artifact
 * content). It is validated for structure and containment only; validation
 * never makes request data trusted and never grants authority.
 *
 * The request carries exactly:
 * - containment protocol version (explicit, mandatory, no inference);
 * - an opaque workspace ID (correlated against the validated configuration);
 * - a workspace-relative candidate path (never an absolute path; the request
 *   cannot select or infer a local root);
 * - a purpose discriminator (`read` | `inspect`; shared containment
 *   semantics; grants no capability or authority);
 * - the expected trusted configuration identity (mandatory; must equal the
 *   validated configuration identity exactly; never inferred).
 *
 * Trusted operands (gateway enforcement code, validated configuration,
 * validated workspace record, configured host lane, injected trusted
 * existing-path resolver) are supplied through options by a trusted caller;
 * request data can never supply them.
 *
 * This module performs no filesystem, network, or process I/O.
 */
import type { ValidatedTrustedWorkspaceConfiguration } from './types.js';
import type { ExistingPathResolver } from './containment-resolver.js';

/** Exact initial containment protocol version (canonical, single representation). */
export const CONTAINMENT_PROTOCOL_VERSION = '1';

/** Single containment operation class for Phase 2A: existing paths only. */
export const CONTAINMENT_OPERATION_CLASS = 'existing-path';

/** Purpose discriminators: shared containment semantics, no authority. */
export const CONTAINMENT_PURPOSES = ['read', 'inspect'] as const;

export type ContainmentPurpose = (typeof CONTAINMENT_PURPOSES)[number];

/**
 * Untrusted Phase-2A request input (workspace-relative existing-path
 * containment). All fields are request data; none are trusted operands.
 */
export interface ExistingPathContainmentRequestInput {
  readonly containmentProtocolVersion: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly purpose: string;
  readonly expectedConfigurationIdentity: string;
}

/** Trusted Phase-2A options: supplied by a trusted caller, never by request data. */
export interface ExistingPathContainmentOptions {
  /** Already validated, deeply immutable Phase-1 TrustedWorkspaceConfiguration. */
  readonly configuration: ValidatedTrustedWorkspaceConfiguration;
  /** Injected trusted existing-path resolver (host-boundary; the core is I/O-free). */
  readonly resolveExistingPath: ExistingPathResolver;
}

/**
 * Immutable prospective containment decision for an existing path.
 * Trusted-process-internal: `resolvedAbsolutePath` is a raw internal
 * absolute path that must never cross the package root, MCP, ChatGPT-facing,
 * finding, or public-identity boundary.
 */
export interface ExistingPathContainmentDecision {
  readonly containmentProtocolVersion: typeof CONTAINMENT_PROTOCOL_VERSION;
  readonly operationClass: typeof CONTAINMENT_OPERATION_CLASS;
  readonly purpose: ContainmentPurpose;
  /** Exact identity of the validated configuration the decision was evaluated against. */
  readonly configurationIdentity: string;
  readonly workspaceId: string;
  /** Canonical workspace-relative path (`''` = the workspace root). */
  readonly canonicalWorkspaceRelativePath: string;
  /**
   * Trusted-process-internal canonical resolved absolute path. Never exposed
   * through package-root APIs, findings, public identity, or external
   * projections (correction F-5 pattern).
   */
  readonly resolvedAbsolutePath: string;
  /** Deterministic decision identity (`sha-256:<hex>`; binds no raw path). */
  readonly decisionIdentity: string;
  /** Phase-2A decisions are prospective only; the operation owner MUST revalidate. */
  readonly pointOfUseRevalidationRequired: true;
}
