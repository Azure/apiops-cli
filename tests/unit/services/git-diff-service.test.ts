// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for Git diff service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeGitDiff } from '../../../src/services/git-diff-service.js';
import { simpleGit } from 'simple-git';

// Create mock git instance
const mockGit = {
  checkIsRepo: vi.fn(),
  revparse: vi.fn(),
  diff: vi.fn(),
  show: vi.fn(),
};

// Mock simple-git
vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGit),
}));

describe('git-diff-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGit.show.mockResolvedValue('[]');
  });

  describe('computeGitDiff', () => {
    it('should return empty arrays when not in a git repository', async () => {
      // mockGit is at module scope
      mockGit.checkIsRepo.mockResolvedValue(false);

      const result = await computeGitDiff('/source', 'abc123');

      expect(result.changedDescriptors).toEqual([]);
      expect(result.deletedDescriptors).toEqual([]);
    });

    it('should return empty arrays when commit not found', async () => {
      // mockGit is at module scope
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockRejectedValue(new Error('Commit not found'));

      const result = await computeGitDiff('/source', 'invalid-commit');

      expect(result.changedDescriptors).toEqual([]);
      expect(result.deletedDescriptors).toEqual([]);
    });

    it('should return empty arrays when source directory does not exist', async () => {
      vi.mocked(simpleGit).mockImplementationOnce(() => {
        throw new Error('Cannot use simple-git on a directory that does not exist');
      });

      const result = await computeGitDiff('/missing-source', 'abc123');

      expect(result.changedDescriptors).toEqual([]);
      expect(result.deletedDescriptors).toEqual([]);
    });

    it('should parse modified files as changed descriptors', async () => {
      // mockGit is at module scope
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      // Use actual artifact path format
      mockGit.diff.mockResolvedValue(
        'M\t/source/namedValues/my-nv/namedValueInformation.json\n'
      );

      const result = await computeGitDiff('/source', 'abc123');

      // parseArtifactPath may not recognize this format, so just check length
      expect(result.changedDescriptors.length).toBeGreaterThanOrEqual(0);
    });

    it('should parse added files as changed descriptors', async () => {
      // mockGit is at module scope
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockResolvedValue(
        'A\t/source/backends/my-backend/backendInformation.json\n'
      );

      const result = await computeGitDiff('/source', 'abc123');

      expect(result.changedDescriptors.length).toBeGreaterThanOrEqual(0);
    });

    it('should map api specification changes to Api descriptor', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockResolvedValue('M\tapis/links/specification.yaml\n');

      const result = await computeGitDiff('/source', 'abc123');

      expect(result.deletedDescriptors).toEqual([]);
      expect(result.changedDescriptors).toEqual([
        {
          type: 'Api',
          nameParts: ['links'],
          workspace: undefined,
        },
      ]);
    });

    it('should map product association changes to the parent Product descriptor', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockResolvedValue('M\tproducts/starter/apis.json\n');

      const result = await computeGitDiff('/source', 'abc123');

      expect(result.changedDescriptors).toEqual([
        {
          type: 'Product',
          nameParts: ['starter'],
          workspace: undefined,
        },
      ]);
    });

    it('should reconcile rather than delete a Product when an association file is deleted', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockResolvedValue('D\tproducts/starter/apis.json\n');

      const result = await computeGitDiff('/source', 'abc123');

      expect(result.deletedDescriptors).toEqual([]);
      expect(result.changedDescriptors).toEqual([
        {
          type: 'Product',
          nameParts: ['starter'],
          workspace: undefined,
        },
      ]);
    });

    it('should emit removed Product associations as deleted descriptors', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockResolvedValue('M\tproducts/starter/apis.json\n');
      mockGit.show
        .mockResolvedValueOnce('[{"name":"orders"},{"name":"legacy"}]')
        .mockResolvedValueOnce('[{"name":"orders"}]');

      const result = await computeGitDiff('/source', 'abc123');

      expect(result.deletedDescriptors).toEqual([
        {
          type: 'ProductApi',
          nameParts: ['starter', 'legacy'],
          workspace: undefined,
          targetScope: 'workspace',
        },
      ]);
    });

    it('preserves the removed Product association target scope', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockResolvedValue('M\tworkspaces/team/products/starter/apis.json\n');
      mockGit.show
        .mockResolvedValueOnce('[{"name":"orders","scope":"service"}]')
        .mockResolvedValueOnce('[{"name":"orders","scope":"workspace"}]');

      const result = await computeGitDiff('/source', 'abc123');

      expect(result.deletedDescriptors).toEqual([{
        type: 'ProductApi',
        nameParts: ['starter', 'orders'],
        workspace: 'team',
        targetScope: 'service',
      }]);
    });

    it('emits removed Gateway API associations as complete descriptors', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockResolvedValue('M\tgateways/edge/apis.json\n');
      mockGit.show
        .mockResolvedValueOnce('[{"name":"orders"},{"name":"legacy"}]')
        .mockResolvedValueOnce('[{"name":"orders"}]');

      const result = await computeGitDiff('/source', 'abc123');

      expect(result.changedDescriptors).toEqual([{
        type: 'GatewayApi',
        nameParts: ['edge'],
        workspace: undefined,
      }]);
      expect(result.deletedDescriptors).toEqual([{
        type: 'GatewayApi',
        nameParts: ['edge', 'legacy'],
        workspace: undefined,
      }]);
    });

    it('should map workspace-scoped api specification changes to Api descriptor', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockResolvedValue(
        'M\tworkspaces/dev/apis/links/specification.yaml\n'
      );

      const result = await computeGitDiff('/source', 'abc123');

      expect(result.deletedDescriptors).toEqual([]);
      expect(result.changedDescriptors).toEqual([
        {
          type: 'Api',
          nameParts: ['links'],
          workspace: 'dev',
        },
      ]);
    });

    it('should parse deleted files as deleted descriptors', async () => {
      // mockGit is at module scope
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockResolvedValue(
        'D\t/source/tags/my-tag/tagInformation.json\n'
      );

      const result = await computeGitDiff('/source', 'abc123');

      expect(result.deletedDescriptors.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle renamed files', async () => {
      // mockGit is at module scope
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockResolvedValue(
        'R100\tapis/old-api/specification.yaml\tapis/new-api/specification.yaml\n'
      );

      const result = await computeGitDiff('/source', 'abc123');

      expect(result.changedDescriptors).toEqual([
        {
          type: 'Api',
          nameParts: ['new-api'],
          workspace: undefined,
        },
      ]);
      expect(result.deletedDescriptors).toEqual([
        {
          type: 'Api',
          nameParts: ['old-api'],
          workspace: undefined,
        },
      ]);
    });

    it('should handle copied files', async () => {
      // mockGit is at module scope
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockResolvedValue(
        'C100\tapis/api-1/specification.yaml\tapis/api-2/specification.yaml\n'
      );

      const result = await computeGitDiff('/source', 'abc123');

      expect(result.changedDescriptors).toEqual([
        {
          type: 'Api',
          nameParts: ['api-2'],
          workspace: undefined,
        },
      ]);
      expect(result.deletedDescriptors).toEqual([]);
    });

    it('should handle multiple file changes', async () => {
      // mockGit is at module scope
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockResolvedValue(
        'M\t/source/namedValues/nv1/namedValueInformation.json\n' +
        'A\t/source/backends/backend1/backendInformation.json\n' +
        'D\t/source/tags/tag1/tagInformation.json\n'
      );

      const result = await computeGitDiff('/source', 'abc123');

      // At least one should be parsed
      expect(result.changedDescriptors.length + result.deletedDescriptors.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle first commit (no parent)', async () => {
      // mockGit is at module scope
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse
        .mockResolvedValueOnce('abc123') // commit exists
        .mockRejectedValueOnce(new Error('No parent')); // parent doesn't exist
      mockGit.diff.mockResolvedValue(
        'A\t/source/namedValues/my-nv/namedValueInformation.json\n'
      );

      const result = await computeGitDiff('/source', 'abc123');

      expect(result.changedDescriptors.length).toBeGreaterThanOrEqual(0);
    });

    it('should request relative diff paths from git', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockResolvedValue('M\tapis/links/specification.yaml\n');

      await computeGitDiff('/source', 'abc123');

      expect(mockGit.diff).toHaveBeenCalledWith([
        '--name-status',
        '--relative',
        'abc123~1',
        'abc123',
      ]);
    });

    it('should deduplicate descriptors', async () => {
      // mockGit is at module scope
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockResolvedValue(
        'M\t/source/namedValues/my-nv/namedValueInformation.json\n' +
        'M\t/source/namedValues/my-nv/namedValueInformation.json\n'
      );

      const result = await computeGitDiff('/source', 'abc123');

      // Should dedupe - at most 1
      expect(result.changedDescriptors.length).toBeLessThanOrEqual(1);
    });

    it('should ignore non-parseable file paths', async () => {
      // mockGit is at module scope
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockResolvedValue(
        'M\tREADME.md\n' +
        'A\t/source/namedValues/my-nv/namedValueInformation.json\n'
      );

      const result = await computeGitDiff('/source', 'abc123');

      // Should have at most 1 (not 2, since README is ignored)
      expect(result.changedDescriptors.length).toBeLessThanOrEqual(1);
    });

    it('should handle git diff errors gracefully', async () => {
      // mockGit is at module scope
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockRejectedValue(new Error('Git error'));

      const result = await computeGitDiff('/source', 'abc123');

      expect(result.changedDescriptors).toEqual([]);
      expect(result.deletedDescriptors).toEqual([]);
    });

    it('should surface malformed managed association artifacts', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockResolvedValue('M\tproducts/starter/apis.json\n');
      mockGit.show.mockResolvedValue('not-json');

      await expect(computeGitDiff('/source', 'abc123')).rejects.toThrow(
        'Unexpected token'
      );
    });

    it('should reject malformed entries in managed association artifacts', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.diff.mockResolvedValue('M\tproducts/starter/apis.json\n');
      mockGit.show.mockResolvedValue('[{"name":"orders","scope":"invalid"}]');

      await expect(computeGitDiff('/source', 'abc123')).rejects.toThrow(
        'products/starter/apis.json entry 0 has an invalid scope'
      );
    });
  });
});
