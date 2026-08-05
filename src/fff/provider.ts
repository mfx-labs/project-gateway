/**
 * WP-7 — FFF discovery capability and deterministic internal provider.
 *
 * The provider receives only a bounded capability (listDirectory, readText,
 * cancellation, scan-budget). No direct filesystem access, absolute roots,
 * or Git access.
 */
import { Buffer } from 'node:buffer';
import { WP7_LIMITS, type OperationResult, type OperationCorrelation, type TrustedOperationControl, success, fail } from '../reader/types.js';
import { validateTrustedOperationControl } from '../reader/types.js';
import { validateAndCaptureRequest } from '../reader/capture.js';
import { errReqInvalid, errFffUnavailable, errFffTimeout, errFffMalformed, errOpCancelled } from '../reader/errors.js';
import { ConcurrencyController } from '../reader/admission.js';
import type { WorkspaceInspectionService } from '../reader/service.js';

// ---------------------------------------------------------------------------
// FFF capability — the bounded interface given to the provider
// ---------------------------------------------------------------------------

export interface FffCapability {
  readonly workspaceId: string;
  readonly reader: WorkspaceInspectionService;
  readonly budget: FffScanBudget;
}

export interface FffScanBudget {
  visitedEntries: number;
  candidateFiles: number;
  totalContentBytes: number;
}

export function createFffScanBudget(): FffScanBudget {
  return { visitedEntries: 0, candidateFiles: 0, totalContentBytes: 0 };
}

export function budgetExhausted(budget: FffScanBudget): boolean {
  return (
    budget.visitedEntries >= WP7_LIMITS.FFF_MAX_VISITED_ENTRIES ||
    budget.candidateFiles >= WP7_LIMITS.FFF_MAX_CANDIDATE_FILES ||
    budget.totalContentBytes >= WP7_LIMITS.FFF_MAX_TOTAL_CONTENT_BYTES
  );
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

interface Candidate {
  path: string;
  basename: string;
  score: number;
  snippet?: string;
}

/**
 * Compute the score for a candidate file.
 */
function computeScore(
  path: string,
  basename: string,
  query: string,
  contentPreview: string | null,
): { score: number; snippet?: string } {
  let score = 0;
  let snippet: string | undefined;

  // Basename match
  if (basename.includes(query)) {
    score += 1000;
  }

  // Full path match
  if (path.includes(query)) {
    score += 500;
  }

  // Content occurrences (literal, non-overlapping)
  if (contentPreview !== null && contentPreview.length > 0) {
    let occurrences = 0;
    let pos = 0;
    while ((pos = contentPreview.indexOf(query, pos)) !== -1) {
      occurrences++;
      pos += query.length;
      if (occurrences >= 100) break;
    }
    const capped = Math.min(occurrences, 100);
    score += capped;

    // Snippet around first occurrence
    if (occurrences > 0) {
      const firstPos = contentPreview.indexOf(query);
      const snippetStart = Math.max(0, firstPos - 100);
      const snippetEnd = Math.min(contentPreview.length, firstPos + query.length + 100);
      let rawSnippet = contentPreview.substring(snippetStart, snippetEnd);
      // Ensure valid UTF-8 boundaries
      const snippetBuf = Buffer.from(rawSnippet, 'utf8');
      if (snippetBuf.length > WP7_LIMITS.FFF_MAX_SNIPPET_BYTES) {
        rawSnippet = snippetBuf.subarray(0, WP7_LIMITS.FFF_MAX_SNIPPET_BYTES).toString('utf8');
      }
      snippet = rawSnippet;
    }
  }

  return { score, snippet };
}

/**
 * Check if content contains NUL bytes (binary file).
 */
function containsNul(content: string): boolean {
  return content.includes('\0');
}

// ---------------------------------------------------------------------------
// Deterministic internal FFF provider
// ---------------------------------------------------------------------------

export class FffProvider {
  private readonly capability: FffCapability;
  private readonly concurrency: ConcurrencyController;

  constructor(capability: FffCapability) {
    this.capability = capability;
    this.concurrency = new ConcurrencyController(WP7_LIMITS.MAX_CONCURRENT_OPERATIONS);
  }

  async discover(
    raw: unknown,
    control: TrustedOperationControl,
  ): Promise<OperationResult> {
    const corr: OperationCorrelation = { workspaceId: this.capability.workspaceId, operation: 'fff-discover' };

    const ctrlResult = validateTrustedOperationControl(control);
    if (!ctrlResult.ok) return fail(errReqInvalid(ctrlResult.message, corr));
    const signal = ctrlResult.signal ?? new AbortController().signal;

    if (signal.aborted) return fail(errOpCancelled(corr));

    const admissionRejection = this.concurrency.tryAdmit(corr);
    if (admissionRejection) return fail(admissionRejection);

    let released = false;
    const release = () => { if (!released) { released = true; this.concurrency.release(); } };

    try {
      if (signal.aborted) { release(); return fail(errOpCancelled(corr)); }
      let onAbort: (() => void) | null = null;
      const abortPromise = new Promise<never>((_, reject) => {
        onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
      });
      // Listener cleanup on every settling path.
      const cleanup = () => { if (onAbort) { signal.removeEventListener('abort', onAbort); onAbort = null; } };

      const captured = validateAndCaptureRequest(raw, corr);
      if (!captured.ok) { cleanup(); release(); return fail(captured.failure); }
      const data = captured.data;

      if (data.operation !== 'fff-discover') {
        cleanup();
        release();
        return fail(errReqInvalid('operation mismatch', corr));
      }

      if (!data.query) {
        cleanup();
        release();
        return fail(errReqInvalid('query is required', corr));
      }

      const query = data.query;
      const maxResults = data.maxResults ?? WP7_LIMITS.FFF_MAX_RESULTS;

      const result = await Promise.race([
        this._discover(query, maxResults, signal, corr),
        abortPromise,
      ]);
      cleanup();
      release();
      return result;
    } catch (err: unknown) {
      release();
      if (err instanceof DOMException && err.name === 'AbortError') {
        return fail(errOpCancelled(corr));
      }
      return fail(errOpCancelled(corr));
    }
  }

  private async _discover(
    query: string,
    maxResults: number,
    signal: AbortSignal,
    corr: OperationCorrelation,
  ): Promise<OperationResult> {
    const budget = createFffScanBudget();
    const candidates: Candidate[] = [];

    // Breadth-first traversal from root
    const queue: string[] = ['']; // relative path '' = workspace root (internal)
    let depth = 0;

    while (queue.length > 0 && depth <= WP7_LIMITS.FFF_MAX_DEPTH) {
      if (signal.aborted) return fail(errOpCancelled(corr));
      if (budgetExhausted(budget)) break;

      const levelSize = queue.length;
      const levelEntries: { name: string; kindHint: string; parentPath: string }[] = [];

      for (let i = 0; i < levelSize; i++) {
        const dirPath = queue.shift()!;
        if (signal.aborted) return fail(errOpCancelled(corr));

        // List directory via controlled reader
        const listResult = await this.capability.reader.listDirectory(
          {
            operation: 'list-directory',
            workspaceId: this.capability.workspaceId,
            path: dirPath === '' ? '.' : dirPath, // request token '.' for root
            maxEntries: WP7_LIMITS.MAX_DIRECTORY_ENTRIES,
          },
          {},
        );

        if (!listResult.ok) continue; // skip inaccessible directories

        const listValue = listResult.value as { entries: readonly { name: string; kindHint: string }[]; truncated: boolean };

        for (const entry of listValue.entries) {
          budget.visitedEntries++;
          if (budgetExhausted(budget)) break;

          const relPath = dirPath === '' ? entry.name : `${dirPath}/${entry.name}`;

          if (entry.kindHint === 'directory') {
            // Enqueue for next BFS level
            levelEntries.push({ name: entry.name, kindHint: 'directory', parentPath: dirPath });
          } else if (entry.kindHint === 'file') {
            // Candidate regular file (kindHint non-authoritative)
            budget.candidateFiles++;
            if (budgetExhausted(budget)) break;

            // Try to read content for scoring
            let contentPreview: string | null = null;
            if (budget.totalContentBytes < WP7_LIMITS.FFF_MAX_TOTAL_CONTENT_BYTES) {
              const readResult = await this.capability.reader.readText(
                {
                  operation: 'read-text',
                  workspaceId: this.capability.workspaceId,
                  path: relPath,
                  maxBytes: WP7_LIMITS.FFF_PER_FILE_WINDOW,
                },
                {},
              );
              if (readResult.ok) {
                const textVal = readResult.value as { text: string; byteLength: number };
                if (!containsNul(textVal.text)) {
                  contentPreview = textVal.text;
                  budget.totalContentBytes += Buffer.from(contentPreview, 'utf8').length;
                }
              }
            }

            const basename = entry.name;
            const { score, snippet } = computeScore(relPath, basename, query, contentPreview);
            if (score > 0) {
              candidates.push({ path: relPath, basename, score, snippet });
            }
          }
          // symlink, other → not followed, not scored
        }
      }

      // Add directories for next BFS level (byte-order sorted)
      levelEntries.sort((a, b) => {
        const bufA = Buffer.from(a.name, 'utf8');
        const bufB = Buffer.from(b.name, 'utf8');
        const len = Math.min(bufA.length, bufB.length);
        for (let i = 0; i < len; i++) {
          const diff = (bufA[i] ?? 0) - (bufB[i] ?? 0);
          if (diff !== 0) return diff;
        }
        return bufA.length - bufB.length;
      });
      for (const entry of levelEntries) {
        const relPath = entry.parentPath === '' ? entry.name : `${entry.parentPath}/${entry.name}`;
        queue.push(relPath);
      }

      depth++;
    }

    // Deduplicate by path (should already be unique from BFS)
    const seen = new Set<string>();
    const unique = candidates.filter(c => {
      if (seen.has(c.path)) return false;
      seen.add(c.path);
      return true;
    });

    // Sort: score descending, path ascending
    unique.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });

    const truncated = unique.length > maxResults || budgetExhausted(budget);
    const items = unique.slice(0, maxResults).map(c => ({
      path: c.path,
      score: c.score,
      snippet: c.snippet,
    }));

    return success({ items: Object.freeze(items), truncated }, corr);
  }
}

/**
 * Create a new FFF provider bound to a workspace inspection service.
 * This is the WP-7-B default binding.
 */
export function createFffProvider(
  workspaceId: string,
  reader: WorkspaceInspectionService,
): FffProvider {
  return new FffProvider({ workspaceId, reader, budget: createFffScanBudget() });
}
