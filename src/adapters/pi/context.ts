/**
 * ContextManifest correlation and context safety (WP-5A).
 *
 * Resolved context items are caller-supplied data only. Every item must bind
 * to exactly one ContextManifest entry; unknown, duplicate, extra, or missing
 * required items are rejected; ordering follows the manifest ordering; size
 * bounds and explicit-truncation policy are enforced; binary or unsupported
 * media types fail closed unless the host capability declares a safe
 * representation; context never supplies roles, system/developer messages,
 * tool policy, approval state, or grant state.
 */
import { piFinding, sortFindings } from './findings.js';
import { readCapabilitySnapshot, readLimitsSnapshot, snapshotContextItemsArray, type ContextItemSnapshot } from './internal/input-shape.js';
import { declaredMediaTypes, parseMediaType } from './internal/media-type.js';
import { hasLoneSurrogate, utf8ByteLength } from './internal/unicode.js';
import type {
  PiAdapterLimits,
  PiFinding,
  PiHostCapabilityDeclaration,
  PiResolvedContextItem,
} from './types.js';
import type { ImmutableModel } from '../../index.js';

/** ContextManifest entry shape (validated model). */
export interface ContextManifestEntry {
  readonly contextId: string;
  readonly requirement: string;
  readonly priority: number;
  readonly purpose: string;
  readonly integrityMode?: string;
  readonly expectedContentDigest?: string;
}

/** Extract manifest entries deterministically (manifest order preserved).
 *  Defensive: non-object manifests yield no entries and never throw. */
export function manifestEntries(manifest: ImmutableModel): ContextManifestEntry[] {
  if (manifest === null || typeof manifest !== 'object') return [];
  const body = manifest['body'] as ImmutableModel | undefined;
  const items = Array.isArray(body?.['items']) ? (body['items'] as ImmutableModel[]) : [];
  const entries: ContextManifestEntry[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const id = typeof item['context_id'] === 'string' ? item['context_id'] : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const integrity = item['integrity'] as ImmutableModel | undefined;
    entries.push({
      contextId: id,
      requirement: typeof item['requirement'] === 'string' ? item['requirement'] : 'optional',
      priority: typeof item['priority'] === 'number' ? item['priority'] : 0,
      purpose: typeof item['purpose'] === 'string' ? item['purpose'] : '',
      integrityMode: typeof integrity?.['mode'] === 'string' ? integrity['mode'] : undefined,
      expectedContentDigest: typeof integrity?.['expected_content_digest'] === 'string' ? integrity['expected_content_digest'] : undefined,
    });
  }
  return entries;
}

/**
 * Correlate and validate resolved context items against the manifest.
 * Returns findings (empty on success) and the manifest-ordered item list.
 */
export function correlateContextItems(
  manifest: ImmutableModel,
  capability: PiHostCapabilityDeclaration,
  limits: PiAdapterLimits,
  items: readonly PiResolvedContextItem[],
): { findings: PiFinding[]; ordered: PiResolvedContextItem[] } {
  const findings: PiFinding[] = [];
  const entries = manifestEntries(manifest);

  // standalone-call safety (A-2/A-3): capability, limits, and every item are
  // read through own data descriptors into plain immutable snapshots before
  // any dereference; malformed containers fail closed with stable findings
  // and never throw, and the original caller objects are never read again.
  // In the projection path the public-input gate has already produced these
  // snapshots, so no duplicate findings are produced there.
  const capabilityResult = readCapabilitySnapshot(capability);
  const capSnap = capabilityResult.ok ? capabilityResult.snapshot : undefined;
  if (!capabilityResult.ok) {
    findings.push(...capabilityResult.findings);
  }
  const limitsResult = readLimitsSnapshot(limits);
  const limitsSnap = limitsResult.ok ? limitsResult.snapshot : undefined;
  if (!limitsResult.ok) {
    findings.push(piFinding('PI-ADAPTER-INPUT-INVALID', 'input.limits-missing', 'adapter limits are missing or malformed', '/limits'));
  }
  const itemsResult = snapshotContextItemsArray(items);
  const itemSnapshots: readonly ContextItemSnapshot[] = itemsResult.ok ? itemsResult.snapshots : [];
  if (!itemsResult.ok) {
    findings.push(piFinding('PI-ADAPTER-CONTEXT-MISMATCH', 'context.items-missing', 'resolved context items are missing', '/contextItems'));
  } else {
    for (const { index, reason } of itemsResult.malformed) {
      findings.push(piFinding('PI-ADAPTER-CONTEXT-MISMATCH', 'context.item-malformed', `context item at index ${index} is malformed: ${reason}`, `/contextItems/${index}`));
    }
  }

  // unknown context item IDs are rejected
  const entryById = new Map(entries.map((e) => [e.contextId, e]));
  const seen = new Set<string>();
  for (const item of itemSnapshots) {
    if (seen.has(item.contextId)) {
      findings.push(piFinding('PI-ADAPTER-CONTEXT-MISMATCH', 'context.duplicate', `duplicate context item ${item.contextId}`, `/contextItems`));
    }
    seen.add(item.contextId);
    const entry = entryById.get(item.contextId);
    if (!entry) {
      findings.push(piFinding('PI-ADAPTER-CONTEXT-MISMATCH', 'context.unknown', `context item ${item.contextId} is not selected by the ContextManifest`, `/contextItems/${item.contextId}`));
    }
  }
  // missing required context items are rejected
  for (const entry of entries) {
    if (entry.requirement === 'required' && !itemSnapshots.some((i) => i.contextId === entry.contextId)) {
      findings.push(piFinding('PI-ADAPTER-CONTEXT-MISMATCH', 'context.missing-required', `required context item ${entry.contextId} is missing`, `/manifest`));
    }
  }
  // the caller cannot inject additional context not selected by the manifest
  // (extras are already rejected as unknown above)

  // item count bound
  if (limitsSnap !== undefined && itemSnapshots.length > limitsSnap.maxContextItemCount) {
    findings.push(piFinding('PI-ADAPTER-CONTEXT-BOUND-EXCEEDED', 'context.count-bound', `context item count ${itemSnapshots.length} exceeds the bound ${limitsSnap.maxContextItemCount}`, '/contextItems'));
  }

  // per-item media type, size, and truncation policy
  for (const item of itemSnapshots) {
    const entry = entryById.get(item.contextId);
    const location = `/contextItems/${item.contextId}`;
    // text payload: primitive strings only; non-string text is malformed
    const textValue = item.text;
    if (item.textNonString) {
      findings.push(piFinding('PI-ADAPTER-CONTEXT-MISMATCH', 'context.text-malformed', `context item ${item.contextId} text is not a string`, location));
    }
    const byteLength = item.bytes !== undefined ? item.bytes.byteLength : utf8ByteLength(textValue ?? '');
    if (byteLength !== item.byteLength) {
      findings.push(piFinding('PI-ADAPTER-CONTEXT-MISMATCH', 'context.length-mismatch', `context item ${item.contextId} declared byte length does not match its content`, location));
    }
    const declaredLength = item.byteLength;
    // exact media-type matching after narrow normalization: text/plain does
    // not authorize text/markdown unless explicitly declared; wildcards are
    // unsupported; binary requires the exact declaration plus base64-context.
    // Malformed or non-string media values fail closed with a stable finding
    // and never throw (R-1).
    const rawMedia = item.mediaTypeNonString ? '' : item.mediaType;
    const parsedMedia = rawMedia !== '' ? parseMediaType(rawMedia) : { status: 'not-a-string' as const };
    const itemMedia = parsedMedia.status === 'valid' ? parsedMedia.normalized : undefined;
    const mediaMalformed = item.mediaTypeNonString || parsedMedia.status === 'not-a-string' || parsedMedia.status === 'malformed';
    if (mediaMalformed) {
      findings.push(piFinding('PI-ADAPTER-CONTEXT-MISMATCH', 'context.media-malformed', `context item ${item.contextId} media type is malformed or not a string`, `${location}/mediaType`));
    }
    if (parsedMedia.status === 'wildcard') {
      // wildcard item media types are unsupported: they can never be declared
      // by the capability (wildcards are rejected at inspection)
      findings.push(piFinding('PI-ADAPTER-UNSUPPORTED-MEDIA', 'context.media-undeclared', `media type ${item.mediaType} uses an unsupported wildcard`, `${location}/mediaType`));
    }
    const declared = capSnap !== undefined ? declaredMediaTypes(capSnap.mediaTypes) : [];
    const mediaDeclared = itemMedia !== undefined && declared.includes(itemMedia);
    if (itemMedia !== undefined && !mediaDeclared) {
      findings.push(piFinding('PI-ADAPTER-UNSUPPORTED-MEDIA', 'context.media-undeclared', `media type ${rawMedia ?? ''} is not declared by the host capability`, `${location}/mediaType`));
    }
    const isText = itemMedia !== undefined && itemMedia.startsWith('text/');
    if (isText) {
      // text items: scalar-valid input required; isolated surrogates are
      // rejected before rendering (never replaced with U+FFFD)
      if (textValue !== undefined && hasLoneSurrogate(textValue)) {
        findings.push(piFinding('PI-ADAPTER-CONTEXT-MISMATCH', 'context.invalid-unicode', `context item ${item.contextId} text contains an isolated surrogate`, location));
      }
    } else if (itemMedia !== undefined) {
      // binary or unsupported media types fail closed unless the host
      // capability explicitly declares a safe transport representation
      const base64Supported =
        capSnap !== undefined && Array.isArray(capSnap.requiredFeatures)
          ? (capSnap.requiredFeatures as readonly unknown[]).some((f) => f === 'base64-context')
          : false;
      if (!base64Supported) {
        findings.push(piFinding('PI-ADAPTER-UNSUPPORTED-MEDIA', 'context.media-unsupported', `media type ${rawMedia ?? ''} is not supported for context projection`, `${location}/mediaType`));
      }
    }
    if (limitsSnap !== undefined && declaredLength > limitsSnap.maxContextItemBytes) {
      if (limitsSnap.allowTruncation) {
        // explicit truncation is represented; silent truncation never happens
      } else {
        findings.push(piFinding('PI-ADAPTER-CONTEXT-BOUND-EXCEEDED', 'context.item-bound', `context item ${item.contextId} exceeds the per-item bound ${limitsSnap.maxContextItemBytes} bytes`, location));
      }
    }
    if (entry && entry.integrityMode === 'sha-256' && entry.expectedContentDigest && item.contentDigest !== undefined && item.contentDigest !== entry.expectedContentDigest) {
      findings.push(piFinding('PI-ADAPTER-CONTEXT-MISMATCH', 'context.digest-mismatch', `context item ${item.contextId} digest does not match the manifest expectation`, `${location}/contentDigest`));
    }
  }

  // aggregate bounds (UTF-8 bytes)
  const totalBytes = itemSnapshots.reduce((acc, item) => acc + item.byteLength, 0);
  if (limitsSnap !== undefined && totalBytes > limitsSnap.maxTotalContextBytes) {
    if (!limitsSnap.allowTruncation) {
      findings.push(piFinding('PI-ADAPTER-CONTEXT-BOUND-EXCEEDED', 'context.total-bound', `total context size ${totalBytes} bytes exceeds the bound ${limitsSnap.maxTotalContextBytes} bytes`, '/contextItems'));
    }
  }

  // context must not supply role/system/developer/tool-policy state
  for (const item of itemSnapshots) {
    const keys = Object.keys(item.provenance).map((k) => k.toLowerCase());
    for (const k of ['role', 'system', 'developer', 'tool_policy', 'approval', 'grant']) {
      if (keys.some((x) => x.includes(k))) {
        findings.push(piFinding('PI-ADAPTER-CONTEXT-MISMATCH', 'context.authority-metadata', `context item ${item.contextId} carries authority-looking provenance metadata`, `/contextItems/${item.contextId}/provenance`));
      }
    }
  }

  // deterministic ordering: manifest order (entry priority order preserved)
  const byId = new Map(itemSnapshots.map((i) => [i.contextId, i]));
  const ordered: PiResolvedContextItem[] = [];
  for (const entry of entries) {
    const item = byId.get(entry.contextId);
    if (item) ordered.push(item as PiResolvedContextItem);
  }

  return { findings: sortFindings(findings), ordered };
}
