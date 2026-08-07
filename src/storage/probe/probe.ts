/**
 * WP-8-C filesystem compatibility probe (FSL-001…010; DS-22).
 *
 * Runs only inside already verified namespace `tmp/` directories, after
 * provisional namespace creation and before any metadata durability. No
 * system temporary directory, repository path, or workspace path is used.
 * Probe failure creates no StoreMetadata and maps to
 * `ERR-STO-FS-UNSUPPORTED` with a bounded, disclosure-safe diagnostic.
 *
 * Error mapping (FSL-007/008/009): ENOSPC → ERR-STO-NO-SPACE, EDQUOT →
 * ERR-STO-QUOTA-EXCEEDED, EROFS → ERR-STO-READONLY-FS, EXDEV →
 * ERR-STO-CROSS-DEVICE, EINVAL on directory fsync → ERR-STO-FS-UNSUPPORTED,
 * other I/O failures → ERR-STO-FS-UNSUPPORTED.
 */
import { openSync, closeSync, fsyncSync, fstatSync, linkSync, symlinkSync, readFileSync } from 'node:fs';
import { constants } from 'node:fs';
import type { InitializationCapability, RecoveryCapability } from '../capabilities/authenticity.js';
import type { ProbeResultProfile } from '../types.js';
import { newScratchOwnership } from './scratch.js';

const { O_CREAT, O_EXCL, O_WRONLY, O_RDONLY, O_NOFOLLOW, O_DIRECTORY } = constants;

export interface ProbeOutcome {
  readonly ok: boolean;
  readonly profile?: ProbeResultProfile;
  readonly code?: string;
  readonly message?: string;
}

/** Deterministic mapping of an fs error to the closed vocabulary (pure). */
export function mapProbeError(err: unknown): { readonly code: string; readonly message: string } {
  const code = (err as NodeJS.ErrnoException).code;
  switch (code) {
    case 'ENOSPC':
      return { code: 'ERR-STO-NO-SPACE', message: 'capacity limit reached during compatibility probe' };
    case 'EDQUOT':
      return { code: 'ERR-STO-QUOTA-EXCEEDED', message: 'quota exceeded during compatibility probe' };
    case 'EROFS':
      return { code: 'ERR-STO-READONLY-FS', message: 'filesystem is read-only' };
    case 'EXDEV':
      return { code: 'ERR-STO-CROSS-DEVICE', message: 'cross-device condition during compatibility probe' };
    case 'EINVAL':
      return { code: 'ERR-STO-FS-UNSUPPORTED', message: 'filesystem lacks a required primitive' };
    case 'EPERM':
    case 'EACCES':
      return { code: 'ERR-STO-PERM-DENIED', message: 'permission denied during compatibility probe' };
    default:
      return { code: 'ERR-STO-FS-UNSUPPORTED', message: 'filesystem compatibility probe failed' };
  }
}

function fail(err: unknown): ProbeOutcome {
  const mapped = mapProbeError(err);
  return { ok: false, code: mapped.code, message: mapped.message };
}

interface ProbeFacts {
  readonly sameDevice: boolean;
  readonly hardLink: 'supported' | 'unsupported';
  readonly directoryFsync: 'supported' | 'unsupported';
  readonly regularFileFsync: 'supported' | 'unsupported';
  readonly exclusiveCreation: 'supported' | 'unsupported';
  readonly noFollow: 'supported' | 'unsupported';
  readonly caseSensitive: boolean;
}

/**
 * Probe one namespace `tmp/` directory's primitives. All scratch stays
 * inside it and every created object is recorded for exact-name cleanup.
 */
/** Minimal probe authority: any mutation-capable capability verifying its exact operation. */
type ProbeCapability = { verify(op: string): { readonly ok: boolean; readonly reason?: string } };

function probeDirectory(
  capability: ProbeCapability,
  expectedOperation: string,
  tmpPath: string,
  actionIdentity: string,
  ordinalBase: number,
  sameDevice: boolean,
): ProbeOutcome {
  const check = capability.verify(expectedOperation);
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'capability is not usable at a probe boundary' };
  }
  const scratch = newScratchOwnership(tmpPath);
  let ordinal = ordinalBase;
  let hardLink: 'supported' | 'unsupported' = 'unsupported';
  let directoryFsync: 'supported' | 'unsupported' = 'unsupported';
  let regularFileFsync: 'supported' | 'unsupported' = 'unsupported';
  let exclusiveCreation: 'supported' | 'unsupported' = 'unsupported';
  let noFollow: 'supported' | 'unsupported' = 'unsupported';
  let caseSensitive = false;
  try {
    // Exclusive creation + no-follow + file fsync + descriptor round-trip.
    const filePath = scratch.create(actionIdentity, ordinal++, 'file');
    if (filePath === undefined) {
      return { ok: false, code: 'ERR-STO-FS-UNSUPPORTED', message: 'exclusive scratch creation failed' };
    }
    const readFd = openSync(filePath, O_RDONLY | O_NOFOLLOW);
    try {
      const stat = fstatSync(readFd);
      if (!stat.isFile()) return { ok: false, code: 'ERR-STO-FS-UNSUPPORTED', message: 'scratch object is not a regular file' };
      fsyncSync(readFd);
      regularFileFsync = 'supported';
      const bytes = readFileSync(readFd);
      if (bytes.toString('utf8') !== 'probe') return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'scratch round-trip failed' };
    } finally {
      closeSync(readFd);
    }
    // Exclusive creation is mandatory: a second creation at the same name must fail.
    if (scratch.create(actionIdentity, ordinalBase, 'file') !== undefined) {
      return { ok: false, code: 'ERR-STO-FS-UNSUPPORTED', message: 'exclusive creation semantics are not honored' };
    }
    exclusiveCreation = 'supported';
    // Hard-link support (atomic publication primitive proxy; FSL-005).
    const linkName = `${tmpPath}/probe-${ordinal.toString(16)}-link`;
    try {
      linkSync(filePath, linkName);
      scratch.record(linkName);
      const linkFd = openSync(linkName, O_RDONLY | O_NOFOLLOW);
      try {
        fstatSync(linkFd);
      } finally {
        closeSync(linkFd);
      }
      hardLink = 'supported';
    } catch (err) {
      return fail(err);
    }
    // No-follow semantics: opening a symlink with O_NOFOLLOW must fail.
    const linkTarget = scratch.create(actionIdentity, ordinal++, 'symlink-target');
    if (linkTarget === undefined) return { ok: false, code: 'ERR-STO-FS-UNSUPPORTED', message: 'scratch symlink creation failed' };
    const noFollowName = `${tmpPath}/probe-${ordinal.toString(16)}-nofollow`;
    try {
      symlinkSync(linkTarget, noFollowName);
      scratch.record(noFollowName);
    } catch (err) {
      return fail(err);
    }
    let noFollowHolds = false;
    try {
      const nf = openSync(noFollowName, O_RDONLY | O_NOFOLLOW);
      closeSync(nf);
    } catch {
      noFollowHolds = true; // ELOOP expected: no-follow is honored
    }
    if (!noFollowHolds) {
      return { ok: false, code: 'ERR-STO-FS-UNSUPPORTED', message: 'no-follow semantics are not honored' };
    }
    noFollow = 'supported';
    // Case behavior: distinct case names must not collide (case-sensitive lane).
    const caseName = `${tmpPath}/probe-${ordinal.toString(16)}-Case`;
    try {
      const cf = openSync(caseName, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0o600);
      closeSync(cf);
      scratch.record(caseName);
      const twin = `${tmpPath}/probe-${ordinal.toString(16)}-case`;
      const tf = openSync(twin, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0o600);
      closeSync(tf);
      scratch.record(twin);
      caseSensitive = true;
    } catch {
      caseSensitive = false; // collided twin: case-insensitive lane
    }
    // Directory fsync.
    let dirFd: number | undefined;
    try {
      dirFd = openSync(tmpPath, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
      fsyncSync(dirFd);
      directoryFsync = 'supported';
    } catch (err) {
      return fail(err);
    } finally {
      if (dirFd !== undefined) closeSync(dirFd);
    }
    return {
      ok: true,
      profile: {
        sameDevice,
        hardLink,
        directoryFsync,
        regularFileFsync,
        exclusiveCreation,
        noFollow,
        caseSensitive,
      },
    };
  } catch (err) {
    return fail(err);
  } finally {
    scratch.cleanup();
  }
}

/**
 * Run the bounded compatibility probe inside both verified namespace `tmp/`
 * directories. Same-device (FSL-004) is verified via descriptor identity of
 * scratch created in each namespace.
 */
/**
 * WP-8-M recovery-gated compatibility probe (ADR-036 §5): identical to
 * `runCompatibilityProbe` but gated on the exact
 * `recover-configuration-namespace` recovery operation, so the expected
 * configuration bytes derived by configuration-namespace recovery use the
 * SAME deterministic trusted-input-to-storage transformation (probe facts
 * included) as normal initialization — never a second serialization format.
 */
export function runCompatibilityProbeRecovery(
  capability: RecoveryCapability,
  actionIdentity: string,
  configTmpPath: string,
  storeTmpPath: string,
): ProbeOutcome {
  const check = capability.verify('recover-configuration-namespace');
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery capability is not usable at a probe boundary' };
  }
  const configScratch = newScratchOwnership(configTmpPath);
  const storeScratch = newScratchOwnership(storeTmpPath);
  let configFd: number | undefined;
  let storeFd: number | undefined;
  let sameDevice = false;
  try {
    const cPath = configScratch.create(actionIdentity, 0, 'file');
    const sPath = storeScratch.create(actionIdentity, 1, 'file');
    if (cPath === undefined || sPath === undefined) {
      return { ok: false, code: 'ERR-STO-FS-UNSUPPORTED', message: 'same-device probe scratch could not be created' };
    }
    configFd = openSync(cPath, O_RDONLY | O_NOFOLLOW);
    storeFd = openSync(sPath, O_RDONLY | O_NOFOLLOW);
    const cStat = fstatSync(configFd);
    const sStat = fstatSync(storeFd);
    if (Number(cStat.dev) !== Number(sStat.dev)) {
      return { ok: false, code: 'ERR-STO-CROSS-DEVICE', message: 'authoritative namespaces are not on the same device' };
    }
    sameDevice = true;
  } catch (err) {
    return fail(err);
  } finally {
    if (configFd !== undefined) closeSync(configFd);
    if (storeFd !== undefined) closeSync(storeFd);
    configScratch.cleanup();
    storeScratch.cleanup();
  }
  const configResult = probeDirectory(capability, 'recover-configuration-namespace', configTmpPath, actionIdentity, 2, sameDevice);
  if (!configResult.ok) return configResult;
  const storeResult = probeDirectory(capability, 'recover-configuration-namespace', storeTmpPath, actionIdentity, 100, sameDevice);
  if (!storeResult.ok) return storeResult;
  const profile: ProbeResultProfile = {
    sameDevice,
    hardLink: configResult.profile?.hardLink === 'supported' && storeResult.profile?.hardLink === 'supported' ? 'supported' : 'unsupported',
    directoryFsync: configResult.profile?.directoryFsync === 'supported' && storeResult.profile?.directoryFsync === 'supported' ? 'supported' : 'unsupported',
    regularFileFsync: configResult.profile?.regularFileFsync === 'supported' && storeResult.profile?.regularFileFsync === 'supported' ? 'supported' : 'unsupported',
    exclusiveCreation: configResult.profile?.exclusiveCreation === 'supported' && storeResult.profile?.exclusiveCreation === 'supported' ? 'supported' : 'unsupported',
    noFollow: configResult.profile?.noFollow === 'supported' && storeResult.profile?.noFollow === 'supported' ? 'supported' : 'unsupported',
    caseSensitive: configResult.profile?.caseSensitive === true && storeResult.profile?.caseSensitive === true,
  };
  return { ok: true, profile };
}

export function runCompatibilityProbe(
  capability: InitializationCapability,
  actionIdentity: string,
  configTmpPath: string,
  storeTmpPath: string,
): ProbeOutcome {
  const check = capability.verify('namespace-initialize');
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'initialization capability is not usable at a probe boundary' };
  }
  const configScratch = newScratchOwnership(configTmpPath);
  const storeScratch = newScratchOwnership(storeTmpPath);
  let configFd: number | undefined;
  let storeFd: number | undefined;
  let sameDevice = false;
  try {
    const cPath = configScratch.create(actionIdentity, 0, 'file');
    const sPath = storeScratch.create(actionIdentity, 1, 'file');
    if (cPath === undefined || sPath === undefined) {
      return { ok: false, code: 'ERR-STO-FS-UNSUPPORTED', message: 'same-device probe scratch could not be created' };
    }
    configFd = openSync(cPath, O_RDONLY | O_NOFOLLOW);
    storeFd = openSync(sPath, O_RDONLY | O_NOFOLLOW);
    const cStat = fstatSync(configFd);
    const sStat = fstatSync(storeFd);
    if (Number(cStat.dev) !== Number(sStat.dev)) {
      return { ok: false, code: 'ERR-STO-CROSS-DEVICE', message: 'authoritative namespaces are not on the same device' };
    }
    sameDevice = true;
  } catch (err) {
    return fail(err);
  } finally {
    if (configFd !== undefined) closeSync(configFd);
    if (storeFd !== undefined) closeSync(storeFd);
    configScratch.cleanup();
    storeScratch.cleanup();
  }
  const configResult = probeDirectory(capability, 'namespace-initialize', configTmpPath, actionIdentity, 2, sameDevice);
  if (!configResult.ok) return configResult;
  const storeResult = probeDirectory(capability, 'namespace-initialize', storeTmpPath, actionIdentity, 100, sameDevice);
  if (!storeResult.ok) return storeResult;
  const profile: ProbeResultProfile = {
    sameDevice,
    hardLink: configResult.profile?.hardLink === 'supported' && storeResult.profile?.hardLink === 'supported' ? 'supported' : 'unsupported',
    directoryFsync: configResult.profile?.directoryFsync === 'supported' && storeResult.profile?.directoryFsync === 'supported' ? 'supported' : 'unsupported',
    regularFileFsync: configResult.profile?.regularFileFsync === 'supported' && storeResult.profile?.regularFileFsync === 'supported' ? 'supported' : 'unsupported',
    exclusiveCreation: configResult.profile?.exclusiveCreation === 'supported' && storeResult.profile?.exclusiveCreation === 'supported' ? 'supported' : 'unsupported',
    noFollow: configResult.profile?.noFollow === 'supported' && storeResult.profile?.noFollow === 'supported' ? 'supported' : 'unsupported',
    caseSensitive: configResult.profile?.caseSensitive === true && storeResult.profile?.caseSensitive === true,
  };
  return { ok: true, profile };
}
