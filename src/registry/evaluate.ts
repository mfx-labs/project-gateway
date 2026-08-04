/**
 * Registry evaluation: RegistrySnapshot semantics (REG-003/005/007) and
 * artifact/consumer registry compatibility (REG-005/006/007, ART-007, BND-007,
 * AUT-003, SEC-003). Deterministic; caller-supplied accepted snapshots only.
 */
import { mk, type Finding } from '../internal/report.js';
import type { AcceptedRegistryContext, ConsumerSupportDeclaration } from '../api/types.js';

const GOVERNED_NAMESPACES = new Set(['project-gateway.conformance-tag', 'example.review-evidence']);

/** Semantic evaluation of a RegistrySnapshot subject (phase 10). */
export function evaluateRegistrySnapshot(model: Readonly<Record<string, unknown>>): Finding[] {
  const findings: Finding[] = [];
  const entries = Array.isArray(model['namespace_entries']) ? (model['namespace_entries'] as Record<string, unknown>[]) : [];
  const seen = new Map<string, number>();
  for (const entry of entries) {
    const ns = typeof entry['namespace'] === 'string' ? entry['namespace'] : '';
    const count = seen.get(ns) ?? 0;
    seen.set(ns, count + 1);
    if (!GOVERNED_NAMESPACES.has(ns)) {
      findings.push(
        mk('semantic-registry-validation', 'REGISTRY-INCOMPATIBILITY', 'registry.unregistered-namespace', 'snapshot registers a namespace outside the governed V1 set', {
          ruleIds: ['REG-005'],
          subjectIdentity: String(model['snapshot_id'] ?? ''),
          location: '/namespace_entries',
        }),
      );
    }
    const contracts = Array.isArray(entry['extension_contracts']) ? (entry['extension_contracts'] as Record<string, unknown>[]) : [];
    for (const c of contracts) {
      const modes = Array.isArray(c['supported_modes']) ? (c['supported_modes'] as string[]) : [];
      if (modes.includes('optional') && c['ignore_safety'] !== 'ignore-safe') {
        findings.push(
          mk('semantic-registry-validation', 'REGISTRY-INCOMPATIBILITY', 'registry.optional-unsafe', 'registry declares an optional contract that is not ignore-safe', {
            ruleIds: ['REG-007'],
            subjectIdentity: String(model['snapshot_id'] ?? ''),
            location: '/namespace_entries',
          }),
        );
      }
    }
  }
  for (const [, count] of seen) {
    if (count > 1) {
      findings.push(
        mk('semantic-registry-validation', 'REGISTRY-INCOMPATIBILITY', 'registry.namespace-collision', 'a namespace/version pair has more than one authoritative registration', {
          ruleIds: ['REG-003'],
          subjectIdentity: String(model['snapshot_id'] ?? ''),
          location: '/namespace_entries',
        }),
      );
    }
  }
  return findings;
}

/** Artifact/consumer registry compatibility (phase 10). */
export function evaluateArtifactRegistryCompatibility(
  model: Readonly<Record<string, unknown>>,
  ctx: { registry: AcceptedRegistryContext; consumerSupport?: ConsumerSupportDeclaration },
): Finding[] {
  const findings: Finding[] = [];
  const extensions = Array.isArray(model['extensions']) ? (model['extensions'] as Record<string, unknown>[]) : [];
  const snapshot = ctx.registry.snapshot;
  const contracts = new Map<string, { modes: string[]; ignoreSafe: boolean }>();
  const entries = Array.isArray(snapshot.model['namespace_entries'])
    ? (snapshot.model['namespace_entries'] as Record<string, unknown>[])
    : [];
  for (const entry of entries) {
    const ns = typeof entry['namespace'] === 'string' ? entry['namespace'] : '';
    const list = Array.isArray(entry['extension_contracts']) ? (entry['extension_contracts'] as Record<string, unknown>[]) : [];
    for (const c of list) {
      const modes = Array.isArray(c['supported_modes']) ? (c['supported_modes'] as string[]) : [];
      contracts.set(`${ns}:${String(c['version'] ?? '')}`, {
        modes,
        ignoreSafe: c['ignore_safety'] === 'ignore-safe',
      });
    }
  }
  for (const ext of extensions) {
    const ns = String(ext['namespace'] ?? '');
    const version = String(ext['version'] ?? '');
    const mode = String(ext['mode'] ?? '');
    const contract = contracts.get(`${ns}:${version}`);
    if (!contract) {
      findings.push(
        mk('registry-compatibility', 'REGISTRY-INCOMPATIBILITY', 'registry.unknown-extension', 'extension namespace/version is not registered in the accepted snapshot', {
          ruleIds: ['REG-005'],
          location: '/extensions',
        }),
      );
      continue;
    }
    if (mode === 'required' && !contract.modes.includes('required')) {
      findings.push(
        mk('registry-compatibility', 'REGISTRY-INCOMPATIBILITY', 'registry.required-unsupported', 'artifact requires an extension the accepted registry does not support in required mode', {
          ruleIds: ['REG-006'],
          location: '/extensions',
        }),
      );
      findings.push(
        mk('registry-compatibility', 'CONSUMER-SUPPORT-FAILURE', 'registry.required-unsupported-consumer', 'artifact requires semantics the consumer does not support', {
          ruleIds: ['ART-007', 'AUT-003', 'BND-007', 'SEC-003', 'REG-006'],
          location: '/extensions',
        }),
      );
      continue;
    }
    if (mode === 'optional' && !contract.ignoreSafe) {
      findings.push(
        mk('registry-compatibility', 'REGISTRY-INCOMPATIBILITY', 'registry.optional-unsafe', 'artifact declares an optional extension that is not ignore-safe', {
          ruleIds: ['REG-007'],
          location: '/extensions',
        }),
      );
    }
  }
  // requirements vs consumer support
  const requirements = model['requirements'] as Record<string, unknown> | undefined;
  const features = Array.isArray(requirements?.['protocol_features']) ? (requirements['protocol_features'] as Record<string, unknown>[]) : [];
  const capabilities = Array.isArray(requirements?.['consumer_capabilities']) ? (requirements['consumer_capabilities'] as Record<string, unknown>[]) : [];
  const support = ctx.consumerSupport;
  if (support) {
    for (const f of features) {
      if (!support.supportedProtocolFeatures.includes(String(f['id'] ?? ''))) {
        findings.push(
          mk('registry-compatibility', 'CONSUMER-SUPPORT-FAILURE', 'registry.feature-unsupported', 'consumer does not support a required protocol feature', {
            ruleIds: ['ART-007', 'BND-007', 'SEC-003'],
            location: '/requirements/protocol_features',
          }),
        );
      }
    }
    for (const c of capabilities) {
      if (!support.supportedConsumerCapabilities.includes(String(c['id'] ?? ''))) {
        findings.push(
          mk('registry-compatibility', 'CONSUMER-SUPPORT-FAILURE', 'registry.capability-unsupported', 'consumer does not support a required consumer capability', {
            ruleIds: ['ART-007', 'BND-007', 'SEC-003'],
            location: '/requirements/consumer_capabilities',
          }),
        );
      }
    }
    for (const ext of extensions) {
      const ns = String(ext['namespace'] ?? '');
      if (!support.supportedExtensionNamespaces.includes(ns)) {
        findings.push(
          mk('registry-compatibility', 'CONSUMER-SUPPORT-FAILURE', 'registry.extension-unsupported', 'consumer does not support a declared extension namespace', {
            ruleIds: ['ART-007', 'BND-007', 'SEC-003'],
            location: '/extensions',
          }),
        );
      }
    }
  }
  return findings;
}

/** Optional-extension reliance detection (REG-007 artifact side). */
export function optionalExtensionReliance(
  model: Readonly<Record<string, unknown>>,
): Finding | undefined {
  const body = model['body'];
  if (!body || typeof body !== 'object') return undefined;
  const texts: string[] = [];
  const b = body as Record<string, unknown>;
  const instructions = b['instructions'];
  if (Array.isArray(instructions)) {
    for (const item of instructions) {
      const t = (item as Record<string, unknown>)['text'];
      if (typeof t === 'string') texts.push(t);
    }
  }
  const citationTexts = b['project_data_citations'];
  if (Array.isArray(citationTexts)) {
    for (const item of citationTexts) {
      const s = (item as Record<string, unknown>)['summary'];
      if (typeof s === 'string') texts.push(s);
    }
  }
  const RELIANCE = /\b(apply|use|honor|follow|check|verify|record|report)[^.]{0,60}(tag|classification|extension|conformance-tag|review-evidence)\b/i;
  for (const t of texts) {
    if (RELIANCE.test(t)) {
      return mk('registry-compatibility', 'REGISTRY-INCOMPATIBILITY', 'registry.optional-reliance', 'artifact relies on an optional extension that is not ignore-safe for this use', {
        ruleIds: ['REG-007'],
        location: '/body',
      });
    }
  }
  return undefined;
}
