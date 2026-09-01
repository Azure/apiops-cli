// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Git diff service
 * Compute changed resource artifacts between commits using simple-git.
 * Maps file paths to ResourceDescriptors for incremental publish.
 */

import { simpleGit, SimpleGit } from 'simple-git';
import * as path from 'node:path';
import { ResourceDescriptor } from '../models/types.js';
import { ResourceType } from '../models/resource-types.js';
import { parseArtifactChangePath } from '../lib/resource-path.js';
import { logger } from '../lib/logger.js';

export interface GitDiffResult {
  /** Resources modified or added in this commit */
  changedDescriptors: ResourceDescriptor[];
  /** Resources deleted in this commit */
  deletedDescriptors: ResourceDescriptor[];
}

/**
 * Compute which resource artifacts changed between commitId~1 and commitId.
 * Uses simple-git. Maps file paths to ResourceDescriptors.
 * Returns empty arrays if git is unavailable or path not in a repo.
 * 
 * @param sourceDir - Root artifact directory
 * @param commitId - Commit SHA to diff against its parent
 * @returns Changed and deleted resource descriptors
 */
export async function computeGitDiff(
  sourceDir: string,
  commitId: string
): Promise<GitDiffResult> {
  try {
    const git: SimpleGit = simpleGit(sourceDir);

    // Check if we're in a git repository
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      logger.warn('Not in a git repository; skipping incremental diff');
      return { changedDescriptors: [], deletedDescriptors: [] };
    }

    // Verify the commit exists
    try {
      await git.revparse([commitId]);
    } catch {
      logger.warn(`Commit ${commitId} not found; skipping incremental diff`);
      return { changedDescriptors: [], deletedDescriptors: [] };
    }

    // Check if parent commit exists (handle first commit case)
    const parentCommit = `${commitId}~1`;
    let hasParent = true;
    try {
      await git.revparse([parentCommit]);
    } catch {
      logger.debug(`Commit ${commitId} has no parent (first commit); treating all files as added`);
      hasParent = false;
    }

    // Get diff between parent and current commit
    // If no parent, diff against empty tree (shows all files as added)
    const diffTarget = hasParent ? parentCommit : '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // Git empty tree SHA
    const diffOutput = await git.diff(['--name-status', '--relative', diffTarget, commitId]);

    const result = parseDiffOutput(diffOutput, sourceDir);
    try {
      await addRemovedAssociations(
        git,
        diffOutput,
        sourceDir,
        diffTarget,
        commitId,
        result
      );
    } catch (error) {
      throw new AssociationDiffError(error);
    }
    return result;
  } catch (error) {
    if (error instanceof AssociationDiffError) {
      throw error.originalError;
    }
    logger.warn(`Git diff failed: ${error instanceof Error ? error.message : String(error)}`);
    return { changedDescriptors: [], deletedDescriptors: [] };
  }
}

class AssociationDiffError extends Error {
  readonly originalError: Error;

  constructor(error: unknown) {
    const originalError = error instanceof Error ? error : new Error(String(error));
    super(originalError.message);
    this.originalError = originalError;
  }
}

/**
 * Parse git diff --name-status output into changed and deleted descriptors.
 * 
 * Format: Each line is "{status}\t{filepath}"
 * - M = modified
 * - A = added
 * - D = deleted
 * - R = renamed (includes old and new paths)
 * - C = copied
 * 
 * @param diffOutput - Raw output from git diff --name-status
 * @param sourceDir - Base directory for artifact paths
 * @returns Parsed descriptors
 */
function parseDiffOutput(diffOutput: string, sourceDir: string): GitDiffResult {
  const changedDescriptors: ResourceDescriptor[] = [];
  const deletedDescriptors: ResourceDescriptor[] = [];
  const seenChanged = new Set<string>();
  const seenDeleted = new Set<string>();

  const lines = diffOutput.split('\n').filter((line) => line.trim());

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 2) {
      continue;
    }

    const status = parts[0]?.charAt(0); // Get first character (M, A, D, R, C)
    if (!status) {
      continue;
    }

    if (status === 'D') {
      if (isManagedAssociationPath(parts[1], sourceDir)) {
        addDescriptorFromDiffPath(parts[1], sourceDir, changedDescriptors, seenChanged);
      } else {
        addDescriptorFromDiffPath(parts[1], sourceDir, deletedDescriptors, seenDeleted);
      }
    } else if (status === 'M' || status === 'A') {
      addDescriptorFromDiffPath(parts[1], sourceDir, changedDescriptors, seenChanged);
    } else if (status === 'R') {
      // Renames are effectively delete(old) + add(new)
      if (isManagedAssociationPath(parts[1], sourceDir)) {
        addDescriptorFromDiffPath(parts[1], sourceDir, changedDescriptors, seenChanged);
      } else {
        addDescriptorFromDiffPath(parts[1], sourceDir, deletedDescriptors, seenDeleted);
      }
      addDescriptorFromDiffPath(parts[2], sourceDir, changedDescriptors, seenChanged);
    } else if (status === 'C') {
      // Copies only introduce/modify the new destination path
      addDescriptorFromDiffPath(parts[2], sourceDir, changedDescriptors, seenChanged);
    }

  }

  logger.debug(
    `Git diff found ${changedDescriptors.length} changed, ${deletedDescriptors.length} deleted resources`
  );

  return { changedDescriptors, deletedDescriptors };
}

function isManagedAssociationPath(
  diffPath: string | undefined,
  sourceDir: string
): boolean {
  if (!diffPath || !['apis.json', 'groups.json', 'tags.json'].includes(path.basename(diffPath))) {
    return false;
  }

  const descriptor = parseDescriptorFromDiffPath(sourceDir, diffPath);
  return descriptor?.type === ResourceType.Product ||
    (path.basename(diffPath) === 'apis.json' && descriptor?.type === ResourceType.GatewayApi);
}

async function addRemovedAssociations(
  git: SimpleGit,
  diffOutput: string,
  sourceDir: string,
  baseCommit: string,
  targetCommit: string,
  result: GitDiffResult
): Promise<void> {
  const seenDeleted = new Set(result.deletedDescriptors.map(descriptorKey));
  const lines = diffOutput.split('\n').filter((line) => line.trim());

  for (const line of lines) {
    const parts = line.split('\t');
    const status = parts[0]?.charAt(0);
    const oldPath = parts[1];
    if (
      !status ||
      !['M', 'D', 'R'].includes(status) ||
      !oldPath ||
      !isManagedAssociationPath(oldPath, sourceDir)
    ) {
      continue;
    }

    const newPath = status === 'R' ? parts[2] : oldPath;
    const parent = parseDescriptorFromDiffPath(sourceDir, oldPath);
    if (!parent) {
      continue;
    }

    const oldEntries = await readAssociationEntriesAtCommit(git, baseCommit, oldPath);
    const sameAssociation =
      status !== 'D' &&
      newPath !== undefined &&
      path.basename(newPath) === path.basename(oldPath) &&
      descriptorKey(parseDescriptorFromDiffPath(sourceDir, newPath) ?? parent) ===
        descriptorKey(parent);
    const newEntries = sameAssociation
      ? await readAssociationEntriesAtCommit(git, targetCommit, newPath)
      : [];
    const currentKeys = new Set(newEntries.map(associationEntryKey));
    const associationType = parent.type === ResourceType.GatewayApi
      ? ResourceType.GatewayApi
      : productAssociationType(path.basename(oldPath));

    for (const entry of oldEntries) {
      if (currentKeys.has(associationEntryKey(entry))) {
        continue;
      }
      const descriptor: ResourceDescriptor = {
        type: associationType,
        nameParts: [parent.nameParts[0] ?? '', entry.name],
        workspace: parent.workspace,
        ...(parent.type === ResourceType.Product
          ? { targetScope: entry.scope ?? 'workspace' }
          : {}),
      };
      addUniqueDescriptor(
        result.deletedDescriptors,
        seenDeleted,
        descriptor,
        descriptorKey(descriptor)
      );
    }
  }
}

interface StoredAssociationEntry {
  name: string;
  scope?: 'service' | 'workspace';
}

async function readAssociationEntriesAtCommit(
  git: SimpleGit,
  commit: string,
  filePath: string
): Promise<StoredAssociationEntry[]> {
  try {
    const content = await git.show([`${commit}:./${filePath}`]);
    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      throw new Error(`Association artifact ${filePath} is not a JSON array`);
    }
    return parsed.map((entry, index): StoredAssociationEntry => {
      if (typeof entry !== 'object' || entry === null) {
        throw new Error(`Association artifact ${filePath} entry ${index} is not an object`);
      }
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.name !== 'string' || candidate.name.length === 0) {
        throw new Error(`Association artifact ${filePath} entry ${index} has an invalid name`);
      }
      if (
        candidate.scope !== undefined &&
        candidate.scope !== 'service' &&
        candidate.scope !== 'workspace'
      ) {
        throw new Error(`Association artifact ${filePath} entry ${index} has an invalid scope`);
      }
      return {
        name: candidate.name,
        ...(candidate.scope ? { scope: candidate.scope } : {}),
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('does not exist') || message.includes('exists on disk')) {
      return [];
    }
    throw error;
  }
}

function associationEntryKey(entry: StoredAssociationEntry): string {
  return `${entry.scope ?? 'workspace'}:${entry.name}`.toLowerCase();
}

function productAssociationType(fileName: string): ResourceType {
  switch (fileName) {
    case 'apis.json':
      return ResourceType.ProductApi;
    case 'groups.json':
      return ResourceType.ProductGroup;
    case 'tags.json':
      return ResourceType.ProductTag;
    default:
      throw new Error(`Unsupported Product association artifact: ${fileName}`);
  }
}

/**
 * Create a unique key for a resource descriptor to enable deduplication.
 */
function descriptorKey(descriptor: ResourceDescriptor): string {
  return [
    descriptor.type,
    ...descriptor.nameParts,
    descriptor.workspace ?? '',
    descriptor.targetScope ?? '',
  ].join('::');
}

function addUniqueDescriptor(
  target: ResourceDescriptor[],
  seen: Set<string>,
  descriptor: ResourceDescriptor,
  key: string
): void {
  if (seen.has(key)) {
    return;
  }

  target.push(descriptor);
  seen.add(key);
}

/**
 * Parse a git diff path into a resource descriptor and add it to the target list.
 * No-op when path is missing, not parseable, or descriptor was already seen.
 */
function addDescriptorFromDiffPath(
  diffPath: string | undefined,
  sourceDir: string,
  target: ResourceDescriptor[],
  seen: Set<string>
): void {
  if (!diffPath) {
    return;
  }

  const descriptor = parseDescriptorFromDiffPath(sourceDir, diffPath);
  if (!descriptor) {
    return;
  }

  addUniqueDescriptor(target, seen, descriptor, descriptorKey(descriptor));
}

function parseDescriptorFromDiffPath(
  sourceDir: string,
  diffPath: string
): ResourceDescriptor | undefined {
  const absolutePath = path.isAbsolute(diffPath)
    ? diffPath
    : path.join(sourceDir, diffPath);

  return parseArtifactChangePath(sourceDir, absolutePath);
}
