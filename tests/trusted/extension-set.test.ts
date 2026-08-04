/**
 * WP-6 Phase 1: trustedExtensionSet declarations (test category G).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrustedWorkspaceConfiguration, EXTENSION_SCOPES } from '../../src/trusted/index.js';
import { validConfig, validOptions } from './helpers.js';

const baseSet = {
  version: '1',
  permittedExtensionIds: ['pi-guard'],
  supportedBuiltinToolIds: ['bash', 'edit'],
  trustedWebAccess: [{ packageId: 'pi-web-access', version: '0.1.0' }],
  expectedToolSources: [{ toolName: 'web_search', packageId: 'pi-web-access', scope: 'package' }],
};

test('G: valid package identity and built-in declarations validate', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig({ trustedExtensionSet: baseSet }), validOptions());
  assert.equal(report.ok, true);
  const set = report.configuration!.trustedExtensionSet!;
  assert.equal(set.version, '1');
  assert.deepEqual([...set.permittedExtensionIds], ['pi-guard']);
  assert.deepEqual([...set.supportedBuiltinToolIds], ['bash', 'edit']);
});

test('G: reviewed web-access declaration validates', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig({ trustedExtensionSet: baseSet }), validOptions());
  assert.equal(report.ok, true);
  assert.equal(report.configuration!.trustedExtensionSet!.trustedWebAccess.length, 1);
});

test('G: malformed package or source identity fails closed', () => {
  for (const set of [
    { ...baseSet, permittedExtensionIds: ['bad identity'] },
    { ...baseSet, permittedExtensionIds: ['a/b'] },
    { ...baseSet, supportedBuiltinToolIds: [''] },
    { ...baseSet, trustedWebAccess: [{ packageId: '', version: '0.1.0' }] },
    { ...baseSet, trustedWebAccess: [{ packageId: 'pi-web-access', version: '' }] },
    { ...baseSet, expectedToolSources: [{ toolName: '', packageId: 'pi-web-access', scope: 'package' }] },
    { ...baseSet, expectedToolSources: [{ toolName: 'web_search', packageId: '', scope: 'package' }] },
  ]) {
    const report = validateTrustedWorkspaceConfiguration(validConfig({ trustedExtensionSet: set }), validOptions());
    assert.equal(report.ok, false, JSON.stringify(set));
    assert.equal(report.findings[0]!.code, 'TCF-022');
  }
});

test('G: unsupported scope fails closed', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({
      trustedExtensionSet: {
        ...baseSet,
        expectedToolSources: [{ toolName: 'web_search', packageId: 'pi-web-access', scope: 'system' }],
      },
    }),
    validOptions(),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-023');
});

test('G: all accepted scopes validate', () => {
  for (const scope of EXTENSION_SCOPES) {
    const report = validateTrustedWorkspaceConfiguration(
      validConfig({
        trustedExtensionSet: {
          ...baseSet,
          expectedToolSources: [{ toolName: 'web_search', packageId: 'pi-web-access', scope }],
        },
      }),
      validOptions(),
    );
    assert.equal(report.ok, true, scope);
  }
});

test('G: missing security-critical source expectation fields fail closed', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({
      trustedExtensionSet: {
        ...baseSet,
        expectedToolSources: [{ toolName: 'web_search', scope: 'package' }], // packageId missing
      },
    }),
    validOptions(),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-022');
});

test('G: duplicate declarations fail closed', () => {
  for (const set of [
    { ...baseSet, permittedExtensionIds: ['pi-guard', 'pi-guard'] },
    { ...baseSet, trustedWebAccess: [{ packageId: 'pi-web-access', version: '0.1.0' }, { packageId: 'pi-web-access', version: '0.1.0' }] },
    {
      ...baseSet,
      expectedToolSources: [
        { toolName: 'web_search', packageId: 'pi-web-access', scope: 'package' },
        { toolName: 'web_search', packageId: 'pi-web-access', scope: 'package' },
      ],
    },
  ]) {
    const report = validateTrustedWorkspaceConfiguration(validConfig({ trustedExtensionSet: set }), validOptions());
    assert.equal(report.ok, false, JSON.stringify(set));
    assert.equal(report.findings[0]!.code, 'TCF-024');
  }
});

test('G: canonical ordering of declarations', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({
      trustedExtensionSet: {
        ...baseSet,
        permittedExtensionIds: ['zz-tool', 'aa-tool'],
        trustedWebAccess: [
          { packageId: 'zz-web', version: '1.0.0' },
          { packageId: 'aa-web', version: '0.1.0' },
        ],
      },
    }),
    validOptions(),
  );
  assert.equal(report.ok, true);
  const set = report.configuration!.trustedExtensionSet!;
  assert.deepEqual([...set.permittedExtensionIds], ['aa-tool', 'zz-tool']);
  assert.deepEqual(
    set.trustedWebAccess.map((e) => e.packageId),
    ['aa-web', 'zz-web'],
  );
});

test('G: missing extension-set version fails closed', () => {
  const set = { ...baseSet };
  delete (set as Record<string, unknown>)['version'];
  const report = validateTrustedWorkspaceConfiguration(validConfig({ trustedExtensionSet: set }), validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-015');
});

test('G: membership creates no authority', () => {
  // Membership is a validated declaration only: no capability, grant, or
  // authority field exists on the validated model.
  const report = validateTrustedWorkspaceConfiguration(validConfig({ trustedExtensionSet: baseSet }), validOptions());
  assert.equal(report.ok, true);
  const set = report.configuration!.trustedExtensionSet! as unknown as Record<string, unknown>;
  assert.equal(set['capabilities'], undefined);
  assert.equal(set['authority'], undefined);
  assert.equal(set['grant'], undefined);
});
