// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for validateAndBuildEnvMapping (env-mapping-validator)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateAndBuildEnvMapping } from '../../../src/services/env-mapping-validator.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import type { ResourceDescriptor } from '../../../src/models/types.js';
import type { OverrideConfig, PublishConfig } from '../../../src/models/config.js';
import { LogLevel, logger } from '../../../src/lib/logger.js';
import type { ApimServiceContext } from '../../../src/models/types.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const testContext: ApimServiceContext = {
  subscriptionId: 'sub-1',
  resourceGroup: 'rg-1',
  serviceName: 'apim-1',
  apiVersion: '2024-05-01',
  baseUrl:
    'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1',
};

function makeConfig(overrides?: OverrideConfig): PublishConfig {
  return {
    service: testContext,
    sourceDir: '/source',
    dryRun: false,
    deleteUnmatched: false,
    logLevel: LogLevel.INFO,
    overrides,
  };
}

function makeDescriptor(type: ResourceType, name: string): ResourceDescriptor {
  return { type, nameParts: [name] };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('validateAndBuildEnvMapping', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── No environment block ────────────────────────────────────────────────

  it('no overrides → no mapping, no warnings or info', () => {
    const config = makeConfig(undefined);
    validateAndBuildEnvMapping(undefined, [], config);
    expect(config.envMapping).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('overrides with no environment block → no mapping, no warnings or info', () => {
    const config = makeConfig({ apis: { 'my-api': { properties: {} } } });
    validateAndBuildEnvMapping(config.overrides, [], config);
    expect(config.envMapping).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  // ─── Missing name affix → hard error ─────────────────────────────────────

  it('environment block with no namePrefix and no nameSuffix → throws', () => {
    const overrides: OverrideConfig = { environment: {} };
    const config = makeConfig(overrides);
    expect(() => validateAndBuildEnvMapping(overrides, [], config)).toThrow(
      /at least one of 'namePrefix' or 'nameSuffix'/
    );
    expect(config.envMapping).toBeUndefined();
  });

  it('environment block with only apiPathPrefix → throws (path-only unsupported)', () => {
    const overrides: OverrideConfig = { environment: { apiPathPrefix: 'dev/' } };
    const config = makeConfig(overrides);
    expect(() => validateAndBuildEnvMapping(overrides, [], config)).toThrow(
      /Path-only isolation via 'apiPathPrefix' alone is not supported/
    );
    expect(config.envMapping).toBeUndefined();
  });

  it('environment block with only whitespace namePrefix → throws', () => {
    const overrides: OverrideConfig = { environment: { namePrefix: '   ', nameSuffix: '' } };
    const config = makeConfig(overrides);
    expect(() => validateAndBuildEnvMapping(overrides, [], config)).toThrow(
      /at least one of 'namePrefix' or 'nameSuffix'/
    );
  });

  it('environment block with only appliesTo (no affix) → throws', () => {
    const overrides: OverrideConfig = { environment: { appliesTo: ['Api'] } };
    const config = makeConfig(overrides);
    expect(() => validateAndBuildEnvMapping(overrides, [], config)).toThrow(
      /at least one of 'namePrefix' or 'nameSuffix'/
    );
  });

  // ─── Valid mapping built ─────────────────────────────────────────────────

  it('environment with prefix + default appliesTo → mapping built, one info log', () => {
    const overrides: OverrideConfig = {
      environment: { namePrefix: 'dev-' },
    };
    const config = makeConfig(overrides);
    validateAndBuildEnvMapping(overrides, [], config);

    expect(config.envMapping).toBeDefined();
    expect(config.envMapping!.prefix).toBe('dev-');
    expect(config.envMapping!.suffix).toBe('');
    // Default appliesTo has 11 types
    expect(config.envMapping!.appliesTo.size).toBe(11);

    expect(infoSpy).toHaveBeenCalledOnce();
    expect(infoSpy.mock.calls[0]![0]).toContain('prefix="dev-"');
    expect(infoSpy.mock.calls[0]![0]).toContain('suffix=""');
    expect(infoSpy.mock.calls[0]![0]).toContain('applies to 11 types');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // ─── Error: non-affixable types ──────────────────────────────────────────

  it('appliesTo contains "ServicePolicy" → throws with clear message', () => {
    const overrides: OverrideConfig = {
      environment: {
        namePrefix: 'dev-',
        appliesTo: ['Api', 'ServicePolicy'],
      },
    };
    const config = makeConfig(overrides);
    expect(() => validateAndBuildEnvMapping(overrides, [], config)).toThrow(
      /non-affixable type\(s\): ServicePolicy/
    );
    expect(config.envMapping).toBeUndefined();
  });

  it('appliesTo contains multiple non-affixable types → lists all offenders', () => {
    const overrides: OverrideConfig = {
      environment: {
        namePrefix: 'dev-',
        appliesTo: ['Api', 'ServicePolicy', 'ApiPolicy'],
      },
    };
    const config = makeConfig(overrides);
    expect(() => validateAndBuildEnvMapping(overrides, [], config)).toThrow(
      /ServicePolicy.*ApiPolicy|ApiPolicy.*ServicePolicy/
    );
  });

  // ─── Error: unknown type names ───────────────────────────────────────────

  it('appliesTo contains "NotARealType" → throws listing unknown type', () => {
    const overrides: OverrideConfig = {
      environment: {
        namePrefix: 'dev-',
        appliesTo: ['Api', 'NotARealType'],
      },
    };
    const config = makeConfig(overrides);
    expect(() => validateAndBuildEnvMapping(overrides, [], config)).toThrow(
      /unknown resource type\(s\): NotARealType/
    );
    expect(config.envMapping).toBeUndefined();
  });

  it('appliesTo contains multiple unknown types → lists all in error', () => {
    const overrides: OverrideConfig = {
      environment: {
        namePrefix: 'dev-',
        appliesTo: ['Foo', 'Bar'],
      },
    };
    const config = makeConfig(overrides);
    expect(() => validateAndBuildEnvMapping(overrides, [], config)).toThrow(/Foo.*Bar|Bar.*Foo/);
  });

  // ─── Warn: invalid affix chars ───────────────────────────────────────────

  it('namePrefix with invalid chars → warning logged, mapping still built', () => {
    const overrides: OverrideConfig = {
      environment: { namePrefix: 'dev@' },
    };
    const config = makeConfig(overrides);
    validateAndBuildEnvMapping(overrides, [], config);

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain('namePrefix');
    expect(warnSpy.mock.calls[0]![0]).toContain('dev@');
    expect(config.envMapping).toBeDefined();
    expect(infoSpy).toHaveBeenCalledOnce();
  });

  it('nameSuffix with invalid chars → warning logged', () => {
    const overrides: OverrideConfig = {
      environment: { nameSuffix: '-qa!' },
    };
    const config = makeConfig(overrides);
    validateAndBuildEnvMapping(overrides, [], config);

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain('nameSuffix');
    expect(warnSpy.mock.calls[0]![0]).toContain('-qa!');
  });

  it('valid prefix/suffix chars → no warning', () => {
    const overrides: OverrideConfig = {
      environment: { namePrefix: 'dev-', nameSuffix: '-v2' },
    };
    const config = makeConfig(overrides);
    validateAndBuildEnvMapping(overrides, [], config);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // ─── Warn: apiPathPrefix with no Api descriptors ─────────────────────────

  it('apiPathPrefix set but zero Api descriptors → warning logged', () => {
    const overrides: OverrideConfig = {
      environment: { namePrefix: 'dev-', apiPathPrefix: 'dev/' },
    };
    const nonApiDescriptors: ResourceDescriptor[] = [
      makeDescriptor(ResourceType.Product, 'my-product'),
    ];
    const config = makeConfig(overrides);
    validateAndBuildEnvMapping(overrides, nonApiDescriptors, config);

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain('apiPathPrefix');
    expect(warnSpy.mock.calls[0]![0]).toContain('no Api resources');
  });

  it('apiPathPrefix set and Api descriptors present → no apiPathPrefix warning', () => {
    const overrides: OverrideConfig = {
      environment: { namePrefix: 'dev-', apiPathPrefix: 'dev/' },
    };
    const descriptors: ResourceDescriptor[] = [makeDescriptor(ResourceType.Api, 'petstore')];
    const config = makeConfig(overrides);
    validateAndBuildEnvMapping(overrides, descriptors, config);

    const apiWarn = warnSpy.mock.calls.find((c) =>
      String(c[0]).includes('apiPathPrefix')
    );
    expect(apiWarn).toBeUndefined();
  });

  // ─── Warn: affixed name exceeds APIM 80-char limit ───────────────────────

  it('affixed name exceeds 80 chars → warning with name, length, and type', () => {
    const overrides: OverrideConfig = {
      environment: { namePrefix: 'production-us-east-', nameSuffix: '-v2-stable' },
    };
    // canonical is 60 chars → 60 + 19 (prefix) + 10 (suffix) = 89
    const longCanonical = 'enterprise-billing-reconciliation-service-consolidated-api-x';
    expect(longCanonical.length).toBe(60);
    const descriptors: ResourceDescriptor[] = [makeDescriptor(ResourceType.Api, longCanonical)];
    const config = makeConfig(overrides);
    validateAndBuildEnvMapping(overrides, descriptors, config);

    const lengthWarn = warnSpy.mock.calls.find((c) =>
      String(c[0]).includes('exceeding APIM\'s 80-character')
    );
    expect(lengthWarn).toBeDefined();
    expect(String(lengthWarn![0])).toContain(`production-us-east-${longCanonical}-v2-stable`);
    expect(String(lengthWarn![0])).toContain('89 characters');
    expect(String(lengthWarn![0])).toContain('Api');
  });

  it('affixed name exactly 80 chars → no length warning', () => {
    const overrides: OverrideConfig = {
      environment: { namePrefix: 'dev-' }, // 4 chars
    };
    const canonical = 'a'.repeat(76); // 4 + 76 = 80
    const descriptors: ResourceDescriptor[] = [makeDescriptor(ResourceType.Api, canonical)];
    const config = makeConfig(overrides);
    validateAndBuildEnvMapping(overrides, descriptors, config);

    const lengthWarn = warnSpy.mock.calls.find((c) =>
      String(c[0]).includes('80-character')
    );
    expect(lengthWarn).toBeUndefined();
  });

  it('affixed name would exceed 80 chars but type not in appliesTo → no warning', () => {
    const overrides: OverrideConfig = {
      environment: {
        namePrefix: 'production-us-east-',
        nameSuffix: '-v2-stable',
        appliesTo: ['Api'], // Product not in appliesTo
      },
    };
    const longCanonical = 'a'.repeat(60);
    const descriptors: ResourceDescriptor[] = [
      makeDescriptor(ResourceType.Product, longCanonical),
    ];
    const config = makeConfig(overrides);
    validateAndBuildEnvMapping(overrides, descriptors, config);

    const lengthWarn = warnSpy.mock.calls.find((c) =>
      String(c[0]).includes('80-character')
    );
    expect(lengthWarn).toBeUndefined();
  });

  // ─── Warn: override entry references unknown resource ────────────────────

  it('apis override references name not in artifact descriptors → warning logged', () => {
    const overrides: OverrideConfig = {
      environment: { namePrefix: 'dev-' },
      apis: { 'old-api-name': { properties: {} } },
    };
    const descriptors: ResourceDescriptor[] = [makeDescriptor(ResourceType.Api, 'current-api')];
    const config = makeConfig(overrides);
    validateAndBuildEnvMapping(overrides, descriptors, config);

    const staleWarn = warnSpy.mock.calls.find((c) => String(c[0]).includes('old-api-name'));
    expect(staleWarn).toBeDefined();
    expect(String(staleWarn![0])).toContain('overrides.apis');
  });

  it('apis override matches existing descriptor → no stale-override warning', () => {
    const overrides: OverrideConfig = {
      environment: { namePrefix: 'dev-' },
      apis: { petstore: { properties: { displayName: 'Pet Store Dev' } } },
    };
    const descriptors: ResourceDescriptor[] = [makeDescriptor(ResourceType.Api, 'petstore')];
    const config = makeConfig(overrides);
    validateAndBuildEnvMapping(overrides, descriptors, config);

    const staleWarn = warnSpy.mock.calls.find((c) => String(c[0]).includes('stale'));
    expect(staleWarn).toBeUndefined();
  });

  // ─── envMapping stored on config ─────────────────────────────────────────

  it('populates config.envMapping with the built mapping', () => {
    const overrides: OverrideConfig = {
      environment: {
        namePrefix: 'qa-',
        nameSuffix: '-v1',
        appliesTo: ['Api', 'Product'],
      },
    };
    const config = makeConfig(overrides);
    validateAndBuildEnvMapping(overrides, [], config);

    expect(config.envMapping).toBeDefined();
    expect(config.envMapping!.prefix).toBe('qa-');
    expect(config.envMapping!.suffix).toBe('-v1');
    expect(config.envMapping!.appliesTo.has(ResourceType.Api)).toBe(true);
    expect(config.envMapping!.appliesTo.has(ResourceType.Product)).toBe(true);
    expect(config.envMapping!.appliesTo.size).toBe(2);
  });
});
