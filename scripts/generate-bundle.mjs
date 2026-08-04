#!/usr/bin/env node
/**
 * Deterministic WP-4 bundle generator (development tool, not production code).
 *
 * Reads the committed WP-3 schema catalog, schema documents, conformance manifest,
 * and fixture inputs from the repository and emits two TypeScript modules under
 * src/generated/ so the production library performs no runtime filesystem or
 * network I/O. The schemas and fixtures remain the source of truth; this script
 * only mirrors them deterministically.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// ---- schema bundle
const catalog = JSON.parse(readFileSync(join(ROOT, 'schemas/catalog.json'), 'utf8'));
const schemaDocs = {};
for (const r of catalog.schema_resources) {
  const doc = JSON.parse(readFileSync(join(ROOT, r.path), 'utf8'));
  if (doc.$id !== r.schema_id) throw new Error(`catalog/$id mismatch: ${r.path}`);
  schemaDocs[r.schema_id] = doc;
}
const json = (v) => JSON.stringify(v, null, 2);
writeFileSync(
  join(ROOT, 'src/generated/schema-bundle.ts'),
  `// GENERATED FILE — do not edit. Regenerate with: npm run generate\n` +
  `// Source of truth: schemas/catalog.json and schemas/** (committed WP-3 package).\n` +
  `export const SCHEMA_CATALOG = ${json(catalog)} as const;\n\n` +
  `export const SCHEMA_DOCUMENTS: Record<string, unknown> = ${json(schemaDocs)};\n`,
);

// ---- corpus bundle (manifest + literal fixture bytes)
const manifest = JSON.parse(readFileSync(join(ROOT, 'fixtures/manifest.json'), 'utf8'));
const inputs = {};
for (const e of manifest.fixtures) {
  for (const rel of e.paths) inputs[rel] = true;
}
// also include vector source fixtures referenced by canonicalization vectors
for (const p of walk(join(ROOT, 'fixtures/canonicalization'))) {
  const rel = relative(ROOT, p);
  const doc = JSON.parse(readFileSync(p, 'utf8'));
  for (const k of ['source_fixture', 'source_fixtures']) {
    const v = doc[k];
    if (typeof v === 'string') inputs[v] = true;
    else if (Array.isArray(v)) for (const x of v) inputs[x] = true;
  }
  void rel;
}
const corpus = {};
for (const rel of Object.keys(inputs).sort()) {
  const bytes = readFileSync(join(ROOT, rel));
  corpus[rel] = bytes.toString('base64');
}
writeFileSync(
  join(ROOT, 'src/generated/corpus-bundle.ts'),
  `// GENERATED FILE — do not edit. Regenerate with: npm run generate\n` +
  `// Source of truth: fixtures/manifest.json and fixtures/** (committed WP-3 package).\n` +
  `export const CONFORMANCE_MANIFEST = ${json(manifest)};\n\n` +
  `// base64-encoded literal bytes of every fixture input.\n` +
  `export const CORPUS_INPUTS: Record<string, string> = ${json(corpus)};\n`,
);
console.log(`generated ${Object.keys(schemaDocs).length} schemas, ${Object.keys(corpus).length} corpus inputs`);
