// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for ARM resource ID helpers
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../src/lib/logger.js';
import {
  armLastName,
  armNameAfter,
  armReferenceWorkspace,
  armScope,
  decodeArmSegment,
} from '../../../src/lib/arm-id.js';

const SERVICE = '/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiManagement/service/apim';

describe('arm-id', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should decode a segment, and keep a malformed one as it is with a warning', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    expect(decodeArmSegment('echo%20api')).toBe('echo api');
    expect(decodeArmSegment('bad%E0%A4%A')).toBe('bad%E0%A4%A');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['/loggers/app-insights', 'loggers', 'app-insights'],
    [`${SERVICE}/workspaces/team-a/Loggers/ws%20logger`, 'loggers', 'ws logger'],
    [`${SERVICE}/apis/orders/operations/get`, 'apis', 'orders'],
    [`${SERVICE}/apis/orders`, 'products', undefined],
    ['/subscriptions/s/resourceGroups/products/providers/Microsoft.ApiManagement/service/apim/apis/orders', 'products', undefined],
    ['/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiManagement/service/loggers/loggers/l', 'loggers', 'l'],
    [`${SERVICE}/workspaces/backends/backends/member`, 'backends', 'member'],
    ['/workspaces/products/products/gold', 'products', 'gold'],
  ])('should read the name after a segment in %s', (id, segment, expected) => {
    expect(armNameAfter(id, segment)).toBe(expected);
  });

  it.each([
    [`${SERVICE}/groups/administrators`, 'administrators'],
    [`${SERVICE}/apis/echo%20api/`, 'echo api'],
    ['', undefined],
  ])('should read the last name of %j', (id, expected) => {
    expect(armLastName(id)).toBe(expected);
  });

  it.each([
    [`${SERVICE}/workspaces/team-a/groups/devs`, 'workspace'],
    [`${SERVICE}/workspaces/team-a`, 'workspace'],
    [`${SERVICE}/groups/administrators`, 'service'],
    ['/subscriptions/s/resourceGroups/workspaces/providers/Microsoft.ApiManagement/service/apim/groups/g', 'service'],
    ['/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiManagement/service/workspaces/groups/g', 'service'],
    [`${SERVICE.replace('Microsoft.ApiManagement', 'microsoft.apimanagement')}/WORKSPACES/ws/groups/g`, 'workspace'],
  ])('should read the scope of %s', (id, expected) => {
    expect(armScope(id)).toBe(expected);
  });

  it.each([
    [`${SERVICE}/workspaces/team-a/loggers/l`, 'other', 'team-a'],
    [`${SERVICE}/loggers/l`, 'team-a', undefined],
    ['/subscriptions/s/resourceGroups/workspaces/providers/Microsoft.ApiManagement/service/apim/loggers/l', 'team-a', undefined],
    ['/loggers/l', 'team-a', 'team-a'],
    ['/loggers/l', undefined, undefined],
  ])('should read the workspace %s points into (referenced from %s)', (id, fallback, expected) => {
    expect(armReferenceWorkspace(id, fallback)).toBe(expected);
  });
});
