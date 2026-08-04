/**
 * WP-6 Phase 1 correction F-4: strict recursive unknown-field rejection.
 *
 * Unknown fields are malformed configuration at every object layer; misspelled
 * or future fields are never silently ignored; symbol keys fail closed at the
 * snapshot boundary; configuration identity is computed only after strict
 * shape validation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrustedWorkspaceConfiguration } from '../../src/trusted/index.js';
import { validConfig, validWorkspace, validOptions } from './helpers.js';

const expectUnknownField = (input: Record<string, unknown>): void => {
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(report.ok, false, JSON.stringify(input));
  assert.equal(report.findings[0]!.code, 'TCF-025');
  assert.equal(report.findings[0]!.messageKey, 'trusted-config.unknown-field');
  assert.equal(report.configuration, undefined);
};

test('F4: unknown top-level field fails closed', () => {
  expectUnknownField(validConfig({ unknownTopLevel: 'x' }));
});

test('F4: unknown provenance field fails closed', () => {
  expectUnknownField(validConfig({ provenance: { sourceKind: 'trusted-local-control-plane', extra: 1 } }));
});

test('F4: unknown workspace-record field fails closed', () => {
  expectUnknownField(validConfig({ workspaces: [validWorkspace({ extra: 'x' })] }));
});

test('F4: unknown capability-ceiling container field fails closed', () => {
  expectUnknownField(validConfig({ globalCapabilityCeiling: { capabilities: [], extra: 'x' } }));
});

test('F4: unknown trustedExtensionSet field fails closed', () => {
  expectUnknownField(
    validConfig({ trustedExtensionSet: { version: '1', permittedExtensionIds: [], extra: 'x' } }),
  );
});

test('F4: unknown web-access declaration field fails closed', () => {
  expectUnknownField(
    validConfig({
      trustedExtensionSet: {
        version: '1',
        trustedWebAccess: [{ packageId: 'pi-web-access', version: '0.1.0', extra: 'x' }],
      },
    }),
  );
});

test('F4: unknown expected-tool-source field fails closed', () => {
  expectUnknownField(
    validConfig({
      trustedExtensionSet: {
        version: '1',
        expectedToolSources: [{ toolName: 'web_search', packageId: 'pi-web-access', scope: 'package', extra: 'x' }],
      },
    }),
  );
});

test('F4: common misspellings fail closed', () => {
  expectUnknownField(validConfig({ globalActionCeilng: 5 }));
  expectUnknownField(validConfig({ workspaces: [validWorkspace({ workspaceIdentifer: 'pgw:w:aaaaaaaaaaaaaaaa' })] }));
  expectUnknownField(validConfig({ provenance: { sourceKnd: 'trusted-local-control-plane' } }));
  expectUnknownField(
    validConfig({
      trustedExtensionSet: {
        version: '1',
        trustedWebAccess: [{ packageID: 'pi-web-access', version: '0.1.0' }],
      },
    }),
  );
});

test('F4: unknown symbol keys fail closed at the snapshot boundary', () => {
  const input = validConfig();
  (input as Record<symbol, unknown>)[Symbol('workspaces')] = [];
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-016'); // snapshot-stage rejection
});

test('F4: unknown fields containing hostile values still fail closed', () => {
  // A getter-bearing unknown field fails at the snapshot boundary.
  const getterInput = validConfig();
  Object.defineProperty(getterInput, 'hidden', { enumerable: true, get: () => 1 });
  const g = validateTrustedWorkspaceConfiguration(getterInput, validOptions());
  assert.equal(g.ok, false);
  assert.equal(g.findings[0]!.code, 'TCF-016');
  // A cyclic unknown field fails at the snapshot boundary.
  const cyclicInput = validConfig();
  (cyclicInput as Record<string, unknown>)['loop'] = cyclicInput;
  const c = validateTrustedWorkspaceConfiguration(cyclicInput, validOptions());
  assert.equal(c.ok, false);
  assert.equal(c.findings[0]!.code, 'TCF-016');
});

test('F4: an input with ignored fields can never share a trusted identity', () => {
  // Two inputs that differ only in unknown fields are both rejected; no
  // accepted configuration can carry an ignored field, so no identity
  // collision from ignored fields is possible.
  const clean = validateTrustedWorkspaceConfiguration(validConfig(), validOptions());
  assert.equal(clean.ok, true);
  const dirty = validateTrustedWorkspaceConfiguration(validConfig({ ignored: true }), validOptions());
  assert.equal(dirty.ok, false);
  assert.equal(dirty.configuration, undefined);
  // And the well-formed configuration's identity never includes unknown bytes.
  assert.equal(clean.configuration!.identity.includes('ignored'), false);
});

test('F4: unknown field is reported before version-dependent semantics inside a record', () => {
  // Deterministic ordering: strict shape check precedes record semantics.
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: [validWorkspace({ extra: 'x', workspaceId: '' })] }),
    validOptions(),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-025');
});

test('F4: unknown field findings are deterministic and typed', () => {
  const a = validateTrustedWorkspaceConfiguration(validConfig({ stray: 1 }), validOptions());
  const b = validateTrustedWorkspaceConfiguration(validConfig({ stray: 1 }), validOptions());
  assert.deepEqual(a, b);
  assert.equal(a.findings[0]!.message, 'configuration contains a field that is not part of the trusted configuration protocol');
});
