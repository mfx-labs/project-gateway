/**
 * WP-5B enforcement test world: a validated WP-5A plan + correlated
 * eligibility + activation decision + standard effective surface + a
 * hermetic pi-guard v0.1.2 fake, assembled into a `GuardEnforcementInput`.
 */
import { projectExecutionBundleToPi } from '../../../src/adapters/pi/projection.js';
import {
  observeEffectiveSurface,
  type GuardEnforcementInput,
  type EffectiveToolSurface,
} from '../../../src/adapters/pi/enforcement/index.js';
import {
  ATTEMPT_ID,
  OCCURRENCE_ID,
  WORKSPACE,
  buildWorld,
  type PiTestWorld,
} from '../helpers.js';
import { createFakeGuard, verifiedPackageInspection, type FakeGuard, type FakeGuardMode } from './fake-guard.js';

export const HOST_TIMESTAMP = '2026-08-04T06:20:00.000Z';
export const TIMESTAMP_SOURCE = 'pgw:host:clock';
export const GRANT_ID = 'pgw:l:syn-grant-1';

export function tool(name: string, source = 'builtin'): { name: string; sourceInfo: { source: string } } {
  return { name, sourceInfo: { source } };
}

/** Standard effective Pi surface used by enforcement tests (research-shaped). */
export const STANDARD_INVENTORY: readonly { name: string; sourceInfo: { source: string } }[] = [
  tool('read'),
  tool('grep'),
  tool('find'),
  tool('ls'),
  tool('bash'),
  tool('edit'),
  tool('write'),
  tool('ffgrep'),
  tool('fffind'),
  tool('git_inspect', 'pi-guard'),
  tool('web_search', 'npm:pi-web-access'),
  tool('fetch_content', 'npm:pi-web-access'),
];

export function standardSurface(sampledAt = HOST_TIMESTAMP): EffectiveToolSurface {
  const observed = observeEffectiveSurface(
    STANDARD_INVENTORY,
    ['read', 'grep', 'find', 'ls', 'bash'],
    sampledAt,
  );
  if (!observed.ok || observed.surface === undefined) throw new Error('standard surface observation failed');
  return observed.surface;
}

export interface EnforcementWorld {
  readonly plan: import('../../../src/adapters/pi/types.js').PiInvocationPlan;
  readonly base: Omit<GuardEnforcementInput, 'guard' | 'surface'>;
  readonly input: (over?: Partial<GuardEnforcementInput>) => GuardEnforcementInput;
}

/** Build a complete enforcement world over the corpus minimal bundle. */
export function buildEnforcementWorld(guardMode: FakeGuardMode = 'normal'): { world: EnforcementWorld; fake: FakeGuard } {
  const w: PiTestWorld = buildWorld();
  const planResult = projectExecutionBundleToPi(w.input());
  if (!planResult.ok || planResult.plan === undefined) {
    throw new Error('enforcement test plan projection failed');
  }
  const fake = createFakeGuard(guardMode);
  const base: Omit<GuardEnforcementInput, 'guard' | 'surface'> = {
    plan: planResult.plan,
    eligibility: w.eligibility,
    activation: {
      decision: 'accepted',
      runtimeGrantId: GRANT_ID,
      reservedOccurrenceId: OCCURRENCE_ID,
      resolvedOccurrenceId: OCCURRENCE_ID,
      attemptId: ATTEMPT_ID,
      grantCurrent: true,
    },
    workspaceIdentity: WORKSPACE,
    capabilityVocabularyVersion: '1',
    expectedToolSources: [],
    evaluatorVersion: '2',
    piHost: { piIdentity: '@earendil-works/pi-coding-agent', piVersion: '0.83.0' },
    consumer: { consumerId: 'project-gateway.fixture-consumer', supportedProtocolFeatures: [], supportedConsumerCapabilities: [], supportedExtensionNamespaces: [] },
    hostTimestamp: HOST_TIMESTAMP,
    timestampSource: TIMESTAMP_SOURCE,
  };
  const input = (over: Partial<GuardEnforcementInput> = {}): GuardEnforcementInput => ({
    ...base,
    guard: { packageInspection: verifiedPackageInspection(), api: fake.api },
    surface: standardSurface(),
    ...over,
  });
  return { world: { plan: planResult.plan, base, input }, fake };
}
