// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, it, expect } from 'vitest';
import { normalizeResource, type NormalizeContext } from '../../../src/lib/compare-normalizer.js';

const context: NormalizeContext = {
  sourceServiceName: 'src-apim',
  targetServiceName: 'tgt-apim',
  sourceSubscriptionId: '00000000-0000-0000-0000-000000000001',
  targetSubscriptionId: '00000000-0000-0000-0000-000000000001',
  sourceResourceGroup: 'src-apim-rg',
  targetResourceGroup: 'tgt-apim-rg',
};

describe('compare-normalizer', () => {
  it('normalizes backend function resourceId when only resource group differs', () => {
    const source = {
      properties: {
        resourceId:
          '/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/src-function-rg/providers/Microsoft.Web/sites/src-backend-function',
      },
    };
    const target = {
      properties: {
        resourceId:
          '/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/tgt-function-rg/providers/Microsoft.Web/sites/src-backend-function',
      },
    };

    const sourceNorm = normalizeResource(source, context);
    const targetNorm = normalizeResource(target, context);

    expect(sourceNorm).toEqual(targetNorm);
    expect((sourceNorm.properties as Record<string, unknown>).resourceId).toBe(
      '/subscriptions/{{sub}}/resourceGroups/{{rg}}/providers/Microsoft.Web/sites/src-backend-function',
    );
  });

  it('normalizes backend logic app resourceId when only resource group differs', () => {
    const source = {
      properties: {
        resourceId:
          '/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/src-logicapp-rg/providers/Microsoft.Logic/workflows/src-backend-logicapp',
      },
    };
    const target = {
      properties: {
        resourceId:
          '/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/tgt-logicapp-rg/providers/Microsoft.Logic/workflows/src-backend-logicapp',
      },
    };

    const sourceNorm = normalizeResource(source, context);
    const targetNorm = normalizeResource(target, context);

    expect(sourceNorm).toEqual(targetNorm);
    expect((sourceNorm.properties as Record<string, unknown>).resourceId).toBe(
      '/subscriptions/{{sub}}/resourceGroups/{{rg}}/providers/Microsoft.Logic/workflows/src-backend-logicapp',
    );
  });

  it('keeps meaningful provider or resource-name differences', () => {
    const source = {
      properties: {
        resourceId:
          '/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/src-function-rg/providers/Microsoft.Web/sites/src-backend-function',
      },
    };
    const target = {
      properties: {
        resourceId:
          '/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/tgt-function-rg/providers/Microsoft.Logic/workflows/src-backend-function',
      },
    };

    const sourceNorm = normalizeResource(source, context);
    const targetNorm = normalizeResource(target, context);

    expect(sourceNorm).not.toEqual(targetNorm);
  });
});
