/**
 * WP-6 Phase 1: numeric ceilings (test category F).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTrustedWorkspaceConfiguration,
  computeTrustedConfigurationIdentity,
} from '../../src/trusted/index.js';
import { validConfig, validWorkspace, validOptions } from './helpers.js';

const validCeilings = (globalActionCeiling: unknown, actionCeiling: unknown) =>
  validConfig({
    ...(globalActionCeiling !== undefined ? { globalActionCeiling } : {}),
    workspaces: [
      ...(actionCeiling !== undefined ? [validWorkspace({ actionCeiling })] : [validWorkspace()]),
    ],
  });

test('F: zero is an explicit zero ceiling', () => {
  const report = validateTrustedWorkspaceConfiguration(validCeilings(0, 0), validOptions());
  assert.equal(report.ok, true);
  assert.equal(report.configuration!.globalActionCeiling, 0);
  assert.equal(report.configuration!.workspaces[0]!.actionCeiling, 0);
});

test('F: positive safe integers validate', () => {
  const report = validateTrustedWorkspaceConfiguration(validCeilings(1, Number.MAX_SAFE_INTEGER), validOptions());
  assert.equal(report.ok, true);
  assert.equal(report.configuration!.globalActionCeiling, 1);
  assert.equal(report.configuration!.workspaces[0]!.actionCeiling, Number.MAX_SAFE_INTEGER);
});

test('F: missing ceilings are preserved as no quantitative restriction', () => {
  const report = validateTrustedWorkspaceConfiguration(validCeilings(undefined, undefined), validOptions());
  assert.equal(report.ok, true);
  assert.equal(report.configuration!.globalActionCeiling, undefined);
  assert.equal(report.configuration!.workspaces[0]!.actionCeiling, undefined);
});

test('F: negative, fractional, NaN, and infinite values fail closed', () => {
  // NaN and ±Infinity are rejected at the descriptor-snapshot stage (TCF-016,
  // non-finite numbers are not representable in the canonical input);
  // negative and fractional finite values are rejected by the numeric
  // validator (TCF-014). All fail closed with no validated configuration.
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const report = validateTrustedWorkspaceConfiguration(validCeilings(bad, bad), validOptions());
    assert.equal(report.ok, false, String(bad));
    assert.equal(report.findings[0]!.code, 'TCF-016');
  }
  for (const bad of [-1, 1.5]) {
    const report = validateTrustedWorkspaceConfiguration(validCeilings(bad, bad), validOptions());
    assert.equal(report.ok, false, String(bad));
    assert.equal(report.findings[0]!.code, 'TCF-014');
    assert.equal(report.findings[0]!.messageKey, 'trusted-config.numeric-ceiling-malformed');
  }
});

test('F: unsafe integers fail closed', () => {
  const report = validateTrustedWorkspaceConfiguration(validCeilings(Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1), validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-014');
});

test('F: negative zero is canonicalized to zero', () => {
  const report = validateTrustedWorkspaceConfiguration(validCeilings(-0, -0), validOptions());
  assert.equal(report.ok, true);
  assert.equal(report.configuration!.globalActionCeiling, 0);
  assert.equal(report.configuration!.workspaces[0]!.actionCeiling, 0);
});

test('F: canonical decimal identity (no exponent notation)', () => {
  const a = validateTrustedWorkspaceConfiguration(validCeilings(1000000, 1), validOptions()).configuration!;
  assert.ok(computeTrustedConfigurationIdentity(a).canonicalUtf8.includes('"globalActionCeiling":1000000'));
  assert.ok(!computeTrustedConfigurationIdentity(a).canonicalUtf8.includes('e+'));
  const b = validateTrustedWorkspaceConfiguration(validCeilings(1000000, 1), validOptions()).configuration!;
  assert.equal(a.identity, b.identity);
});

test('F: non-number ceilings fail closed', () => {
  for (const bad of ['5', null, true, {}, []]) {
    const report = validateTrustedWorkspaceConfiguration(validCeilings(bad, bad), validOptions());
    assert.equal(report.ok, false, String(bad));
    assert.equal(report.findings[0]!.code, 'TCF-014');
  }
});

test('F: a failing numeric ceiling never grants permission', () => {
  // Invalid numeric input must fail the whole load; it can never be treated as
  // "no restriction".
  const report = validateTrustedWorkspaceConfiguration(validCeilings(Number.NaN, undefined), validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.configuration, undefined);
});
