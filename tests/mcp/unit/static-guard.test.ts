/**
 * WP-9 MCP inspection surface (slice 1) — static security guards.
 *
 * Proves the adapter is a pure read-only routing layer:
 *   - imports NO filesystem API, subprocess, or shell;
 *   - never reaches storage publication, recovery mutation, retention
 *     execution, lock mutation, configuration recovery mutation, or any
 *     capability/provenance/trusted-input CREATOR;
 *   - consumes only read-only/pure domain modules (exact allowlist);
 *   - exposes no authority creator or permit through its entry point;
 *   - contains no timers, randomness, or environment dependence;
 *   - the `./mcp` package export maps to the adapter entry point only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..', '..');
const MCP_SRC = join(REPO, 'src', 'adapters', 'mcp');

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

const mcpFiles = collectTsFiles(MCP_SRC);
assert.ok(mcpFiles.length >= 4, 'the MCP adapter source tree must exist');

test('mcp static guard: no filesystem, subprocess, shell, timers, randomness, or environment access', () => {
  for (const file of mcpFiles) {
    const content = readFileSync(file, 'utf8');
    for (const forbidden of ['node:fs', 'node:child_process', 'child_process', 'execSync', 'spawnSync', 'spawn(', 'exec(', 'process.env', 'Math.random', 'Date.now', 'setTimeout', 'setInterval', 'require(']) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not use ${forbidden}`);
    }
  }
});

test('mcp static guard: imports stay inside the exact read-only/pure domain allowlist', () => {
  const allowedPrefixes = [
    './types.js',
    './validate.js',
    './context.js',
    './inspect.js',
    './index.js',
    'node:buffer',
    '../../api/validate.js',
    '../../schema/registry.js',
    '../../storage/read/index.js',
    '../../storage/read/read-record.js',
    '../../storage/registry/compose.js',
    '../../storage/trusted-input/bootstrap-input.js',
    '../../storage/format/index.js',
    '../../storage/format/taxonomy.js',
    '../../storage/format/identifier.js',
    '../../storage/types.js',
  ];
  for (const file of mcpFiles) {
    const content = readFileSync(file, 'utf8');
    const importMatches = content.matchAll(/^import[^\n]*?from\s+['"]([^'"]+)['"]/gm);
    for (const match of importMatches) {
      const specifier = match[1]!;
      const allowed = allowedPrefixes.some((p) => specifier === p || specifier.startsWith(p));
      assert.equal(allowed, true, `${rel(file)} imports ${specifier} outside the read-only allowlist`);
    }
    // The storage BARREL must never be imported (it re-exports mutation).
    assert.equal(content.includes("'../../storage/index.js'"), false, `${rel(file)} must not import the storage barrel`);
    // No mutation vocabulary anywhere in the adapter.
    for (const forbidden of ['publishRecord', 'publishImmutableRecord', 'publishRecoveryBoundRecord', 'executeRecoveryMutation', 'executeRetentionMutation', 'acquireWriterLock', 'releaseWriterLock', 'breakWriterLock', 'executeConfigurationRecovery', 'persistRecoveryConfigurationMetadata', 'createWriteCapability', 'createRecoveryCapability', 'createRetentionCapability', 'createInitializationCapability', 'createTrustedStorageBootstrapInput', 'createStorageBootstrapActionProvenance', 'createStorageWriteActionProvenance', 'createRecoveryActionProvenance', 'createRetentionActionProvenance', 'createTrustedWriteRequest', 'createTrustedRecoveryRequest', 'createTrustedRetentionRequest', 'unlinkSync', 'renameSync', 'writeFileSync', 'mkdirSync', 'rmSync', 'chmodSync', 'chownSync', 'copyFileSync', 'openSync']) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reach ${forbidden}`);
    }
  }
});

test('mcp static guard: entry point exports no authority creator, permit, or raw reader', () => {
  const entry = readFileSync(join(MCP_SRC, 'index.ts'), 'utf8');
  for (const forbidden of ['createRecoveryCapability', 'createWriteCapability', 'createRetentionCapability', 'createConfigurationRecoveryMetadataPermit', 'createRecoveryPublicationPermit', 'createTrustedStorageBootstrapInput', 'persistRecoveryConfigurationMetadata', 'publishRecord', 'executeRecoveryMutation', 'readFileSync', 'openSync']) {
    assert.equal(entry.includes(forbidden), false, `entry must not export ${forbidden}`);
  }
  assert.equal(/createMcpInspectionSurface/.test(entry), true, 'the entry must export the surface factory');
  assert.equal(/createInspectionContext/.test(entry), true, 'the entry must export the context factory');
});

test('mcp static guard: package export maps ./mcp to the adapter entry point only', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { exports?: Record<string, { types?: string; import?: string }> };
  assert.equal(pkg.exports?.['./mcp']?.import, './dist/adapters/mcp/index.js');
  assert.equal(pkg.exports?.['./mcp']?.types, './dist/adapters/mcp/index.d.ts');
});

test('mcp static guard: the adapter is transport-free (no server/runtime imports) and dependency-free', () => {
  for (const file of mcpFiles) {
    const content = readFileSync(file, 'utf8');
    for (const forbidden of ['@modelcontextprotocol', 'mcp/', 'net.createServer', 'http.createServer', 'WebSocket', 'node:net', 'node:http']) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not import a transport or server runtime`);
    }
  }
});
