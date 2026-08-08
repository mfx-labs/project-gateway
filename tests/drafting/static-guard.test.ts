/**
 * WP-10 Slice 1 — drafting-core static security guard.
 *
 * Proves the transport-free draft core:
 *   - imports only the accepted pure validation/canonicalization APIs;
 *   - never imports the MCP SDK, the stdio runtime, storage writers,
 *     lifecycle/approval/issuance/activation creators, pi-guard, execution,
 *     tunnel, network, subprocess, or generic filesystem APIs;
 *   - is deterministic (no clock, randomness, or process identity);
 *   - keeps the exact draftable vocabulary and rejects the exact
 *     non-draftable kind;
 *   - routes validation through the accepted WP-4 entry
 *     (`validateArtifactSelf`) and duplicate-key-rejecting raw intake
 *     (`parseRawJsonInput`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const DRAFTING_SRC = join(REPO, 'src', 'drafting');

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...collectTsFiles(full));
    else if (name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function rel(file: string): string {
  return file.slice(REPO.length + 1);
}

const draftingFiles = collectTsFiles(DRAFTING_SRC);
assert.ok(draftingFiles.length >= 1, 'the drafting source tree must exist');

/** Exact closed import allowlist for the transport-free core. */
const ALLOWED_IMPORTS: readonly string[] = [
  '../api/validate.js',
  '../api/types.js',
  '../schema/registry.js',
];

test('drafting static guard: imports stay within the pure validation/canonicalization allowlist', () => {
  for (const file of draftingFiles) {
    const content = readFileSync(file, 'utf8');
    const importRe = /(?:import|export)\s+[^'"]*?from\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(content)) !== null) {
      const specifier = m[1]!;
      assert.ok(
        ALLOWED_IMPORTS.includes(specifier),
        `${rel(file)} must not import ${specifier} (closed allowlist: ${ALLOWED_IMPORTS.join(', ')})`,
      );
    }
  }
});

test('drafting static guard: no MCP SDK, runtime, network, subprocess, filesystem, or authority vocabulary', () => {
  for (const file of draftingFiles) {
    const content = readFileSync(file, 'utf8');
    for (const forbidden of [
      '@modelcontextprotocol',
      'node:fs',
      'node:child_process',
      'node:net',
      'node:http',
      'node:https',
      'node:tls',
      'node:dgram',
      'WebSocket',
      'tunnel',
      'oauth',
      'OAuth',
      'spawn(',
      'exec(',
      'console.log',
      'process.stdout',
      'process.stderr',
      'Math.random',
      'Date.now',
      'crypto.randomUUID',
      'process.getuid',
      'process.pid',
      // storage writers / mutation
      'publishRecord',
      'publishImmutableRecord',
      'createStorageWriteActionProvenance',
      'createTrustedWriteRequest',
      'createStorageBootstrapActionProvenance',
      'createTrustedStorageBootstrapInput',
      'createRecoveryActionProvenance',
      'createTrustedRecoveryRequest',
      'createRetentionActionProvenance',
      'createTrustedRetentionRequest',
      'acquireWriterLock',
      'releaseWriterLock',
      'breakWriterLock',
      'executeConfigurationRecovery',
      'persistRecoveryConfigurationMetadata',
      'writeFileSync',
      'mkdirSync',
      'rmSync',
      'chmodSync',
      'renameSync',
      'unlinkSync',
      // lifecycle / authority
      'createWriteCapability',
      'createReadCapability',
      'createVerifyCapability',
      'createRecoveryCapability',
      'createRetentionCapability',
      'createInitializationCapability',
      'createProvisioningCapability',
      'createRecoveryPublicationPermit',
      'createRetentionPublicationPermit',
      'markValidatedTrustedWorkspaceConfiguration',
      'RuntimeGrant',
      'issue(',
      'activate(',
      'revoke(',
      // pi-guard / execution / MCP runtime / registry
      'pi-guard',
      'piGuard',
      'createMcpInspectionRegistry',
      'createMcpServer',
      'serveStdio',
      'StdioServerTransport',
      'registerTool',
    ]) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not use ${forbidden}`);
    }
  }
});

test('drafting static guard: exact vocabulary and WP-4 authority routing', () => {
  const source = readFileSync(join(DRAFTING_SRC, 'proposal.ts'), 'utf8');
  assert.equal(/DRAFTABLE_ARTIFACT_KINDS = \['TaskSpec', 'AuthorityPolicy', 'ContextManifest', 'CompletionContract', 'ExecutionBundle'\]/.test(source), true);
  assert.equal(/NON_DRAFTABLE_ARTIFACT_KINDS = \['ExecutionResult'\]/.test(source), true);
  assert.equal(source.includes('validateArtifactSelf'), true, 'WP-4 self-validation is the validation authority');
  assert.equal(source.includes('parseRawJsonInput'), true, 'duplicate-key-rejecting raw intake is reused');
  assert.equal(source.includes('createSchemaRegistry'), true);
  assert.equal(source.includes('computeArtifactDigest'), true, 'the accepted canonical projection derives the digest');
  assert.equal(source.includes('revision.digest is derived'), true, 'derived-member rule is documented in code');
  // No other production file may exist in the drafting tree.
  assert.deepEqual(draftingFiles.map(rel), ['src/drafting/proposal.ts'], 'exactly one drafting core module');
});
