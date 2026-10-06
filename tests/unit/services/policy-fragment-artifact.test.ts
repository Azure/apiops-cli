// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';
import type { IArtifactStore } from '../../../src/clients/iartifact-store.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import type { ResourceDescriptor } from '../../../src/models/types.js';
import {
  readPolicyFragmentArtifact,
  writePolicyFragmentArtifact,
} from '../../../src/services/policy-fragment-artifact.js';

function createMockStore() {
  return {
    writeResource: vi.fn().mockResolvedValue(undefined),
    writeContent: vi.fn().mockResolvedValue(undefined),
    writeAssociation: vi.fn(),
    readResource: vi.fn().mockResolvedValue(undefined),
    readContent: vi.fn().mockResolvedValue(undefined),
    readAssociation: vi.fn(),
    listResources: vi.fn(),
    deleteResource: vi.fn(),
    commitStagedExtraction: vi.fn(),
  } satisfies IArtifactStore;
}

const descriptor: ResourceDescriptor = {
  type: ResourceType.PolicyFragment,
  nameParts: ['shared-auth'],
};

describe('policy-fragment-artifact', () => {
  it('reads a legacy JSON-only fragment', async () => {
    const store = createMockStore();
    const information = {
      properties: {
        description: 'Shared authentication',
        value: '<fragment><base /></fragment>',
        format: 'rawxml',
      },
    };
    store.readResource.mockResolvedValue(information);

    await expect(
      readPolicyFragmentArtifact(store, '/source', descriptor)
    ).resolves.toEqual(information);
  });

  it('reads an XML-only fragment', async () => {
    const store = createMockStore();
    store.readContent.mockResolvedValue({
      content: '<fragment><base /></fragment>',
    });

    await expect(
      readPolicyFragmentArtifact(store, '/source', descriptor)
    ).resolves.toEqual({
      properties: {
        value: '<fragment><base /></fragment>',
        format: 'rawxml',
      },
    });
  });

  it('merges split metadata with authoritative XML content', async () => {
    const store = createMockStore();
    store.readResource.mockResolvedValue({
      properties: {
        description: 'Shared authentication',
        value: '<fragment>legacy</fragment>',
        format: 'xml',
      },
    });
    store.readContent.mockResolvedValue({
      content: '<fragment><base /></fragment>',
    });

    await expect(
      readPolicyFragmentArtifact(store, '/source', descriptor)
    ).resolves.toEqual({
      properties: {
        description: 'Shared authentication',
        value: '<fragment><base /></fragment>',
        format: 'rawxml',
      },
    });
  });

  it('writes extracted metadata and policy content separately', async () => {
    const store = createMockStore();
    const json = {
      name: 'shared-auth',
      properties: {
        description: 'Shared authentication',
        value: '<fragment><base /></fragment>',
        format: 'rawxml',
      },
    };

    await writePolicyFragmentArtifact(store, '/output', descriptor, json);

    expect(store.writeResource).toHaveBeenCalledWith('/output', descriptor, {
      name: 'shared-auth',
      properties: {
        description: 'Shared authentication',
      },
    });
    expect(store.writeContent).toHaveBeenCalledWith(
      '/output',
      descriptor,
      '<fragment><base /></fragment>',
      'policy'
    );
  });
});
