/**
 * T036: Git diff service
 * Compute changed resource artifacts between commits using simple-git.
 * Maps file paths to ResourceDescriptors for incremental publish.
 */

import { simpleGit, SimpleGit } from 'simple-git';
import * as path from 'node:path';
import { ResourceDescriptor } from '../models/types.js';
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

    return parseDiffOutput(diffOutput, sourceDir);
  } catch (error) {
    logger.warn(`Git diff failed: ${error instanceof Error ? error.message : String(error)}`);
    return { changedDescriptors: [], deletedDescriptors: [] };
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
      addDescriptorFromDiffPath(parts[1], sourceDir, deletedDescriptors, seenDeleted);
    } else if (status === 'M' || status === 'A') {
      addDescriptorFromDiffPath(parts[1], sourceDir, changedDescriptors, seenChanged);
    } else if (status === 'R') {
      // Renames are effectively delete(old) + add(new)
      addDescriptorFromDiffPath(parts[1], sourceDir, deletedDescriptors, seenDeleted);
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

/**
 * Create a unique key for a resource descriptor to enable deduplication.
 */
function descriptorKey(descriptor: ResourceDescriptor): string {
  return [descriptor.type, ...descriptor.nameParts, descriptor.workspace ?? ''].join('::');
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
