// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Stale pulled-in dependencies for `extract --remove-stale`.
 *
 * A filtered extract pulls in resources its selection depends on (tags,
 * groups, loggers, named values and so on) even when the filter leaves their
 * type out. Those artifacts are outside the filter's scope, so --remove-stale
 * does not remove them as it does selected resources. Other filtered extracts
 * into the same output can depend on them too, so one is only stale when it
 * was a dependency of this filter's selection and nothing left in the output
 * still references it.
 */

import type { IArtifactStore } from '../clients/iartifact-store.js';
import type { FilterConfig } from '../models/config.js';
import type { ResourceDescriptor } from '../models/types.js';
import { getResourceDescriptorKey } from '../lib/resource-path.js';
import { buildResourceLabel } from '../lib/resource-uri.js';
import { logger } from '../lib/logger.js';
import { runParallel } from '../lib/parallel-runner.js';
import { isInRemoveStaleScope } from './filter-service.js';
import { createArtifactReferenceResolver, scanArtifactReferences } from './transitive-resolver.js';

/** Artifact files read at once while scanning references: the extract's own concurrency. */
const SCAN_CONCURRENCY = 5;

interface ArtifactLocation {
  descriptor: ResourceDescriptor;
  /** The directory the artifact is read from: staging for staged ones. */
  dir: string;
}

/**
 * The references in each artifact, read in parallel. An artifact that can't
 * be read is reported in `failed` rather than failing the scan.
 */
async function scanAll(
  store: IArtifactStore,
  artifacts: ReadonlyArray<ArtifactLocation>
): Promise<{ references: ResourceDescriptor[]; failed: ResourceDescriptor[] }> {
  const results = await runParallel(
    artifacts.map(({ descriptor, dir }) => () => scanArtifactReferences(store, dir, descriptor)),
    SCAN_CONCURRENCY
  );
  const references: ResourceDescriptor[] = [];
  const failed: ResourceDescriptor[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      references.push(...(result.value ?? []));
    } else {
      logger.warn(`Unable to scan ${buildResourceLabel(artifacts[index].descriptor)} for references: ${String(result.reason)}`);
      failed.push(artifacts[index].descriptor);
    }
  });
  return { references, failed };
}

/**
 * The artifacts in `outputDir` that this extract's selection used to depend
 * on (directly or through other pulled-in artifacts), that this extract did
 * not write again, and that no artifact left after committing it references.
 *
 * Artifacts left in the output are scanned, in parallel, until every
 * candidate is known to be needed; this only runs when there is a candidate.
 * If an artifact left in the output can't be scanned, nothing is reported
 * stale, since it could reference any candidate.
 *
 * @param outputDir - The existing output
 * @param stagingDir - This extract's staged output
 * @param filter - The filter the extract ran with
 */
export async function findStaleDependencies(
  store: IArtifactStore,
  outputDir: string,
  stagingDir: string,
  filter: FilterConfig
): Promise<ResourceDescriptor[]> {
  const existing = await store.listResources(outputDir);
  const staged = await store.listResources(stagingDir);
  const key = getResourceDescriptorKey;
  const stagedKeys = new Set(staged.map(key));
  // In step with what --remove-stale removes when not written again.
  const isSelected = (descriptor: ResourceDescriptor): boolean => isInRemoveStaleScope(descriptor, filter);
  // Only an artifact outside the selection that this extract did not write
  // again can be stale; often there is none, and nothing needs reading.
  const kept = existing.filter((descriptor) => !stagedKeys.has(key(descriptor)) && !isSelected(descriptor));
  if (kept.length === 0) {
    return [];
  }

  // What the selection depended on before this extract, followed through
  // pulled-in artifacts (a logger's named value, say).
  const resolveExisting = createArtifactReferenceResolver(
    existing,
    (descriptor) => store.readResource(outputDir, descriptor)
  );
  const candidates = new Map<string, ResourceDescriptor>();
  let wave: ArtifactLocation[] = existing.filter(isSelected).map((descriptor) => ({ descriptor, dir: outputDir }));
  while (wave.length > 0) {
    // An artifact that can't be scanned contributes no candidates, which only keeps more.
    const { references } = await scanAll(store, wave);
    wave = [];
    for (const reference of references) {
      const target = await resolveExisting(reference);
      if (!target || isSelected(target) || stagedKeys.has(key(target)) || candidates.has(key(target))) {
        continue;
      }
      candidates.set(key(target), target);
      wave.push({ descriptor: target, dir: outputDir });
    }
  }
  if (candidates.size === 0) {
    return [];
  }

  // What is left after the commit: everything staged, and every existing
  // artifact that --remove-stale keeps. A candidate anything left references
  // is still needed, and so is whatever that candidate references.
  const resolveRemaining = createArtifactReferenceResolver(
    [...staged, ...kept],
    (descriptor) => store.readResource(stagedKeys.has(key(descriptor)) ? stagingDir : outputDir, descriptor)
  );
  const stale = new Map(candidates);
  const referrers: ArtifactLocation[] = [
    ...staged.map((descriptor) => ({ descriptor, dir: stagingDir })),
    ...kept.filter((descriptor) => !candidates.has(key(descriptor))).map((descriptor) => ({ descriptor, dir: outputDir })),
  ];
  // Scan until nothing is left to rescue: an artifact not yet started is
  // skipped once every candidate is known to be needed, and a rescued
  // candidate's own references are scanned in the next round.
  let round = referrers;
  while (stale.size > 0 && round.length > 0) {
    const rescued: ArtifactLocation[] = [];
    const failed: ResourceDescriptor[] = [];
    await runParallel(
      round.map(({ descriptor, dir }) => async () => {
        if (stale.size === 0 || failed.length > 0) {
          return;
        }
        let references: ResourceDescriptor[];
        try {
          references = await scanArtifactReferences(store, dir, descriptor);
        } catch (error) {
          logger.warn(`Unable to scan ${buildResourceLabel(descriptor)} for references: ${String(error)}`);
          failed.push(descriptor);
          return;
        }
        for (const reference of references) {
          const target = await resolveRemaining(reference);
          if (target && stale.delete(key(target))) {
            rescued.push({ descriptor: target, dir: outputDir });
          }
        }
      }),
      SCAN_CONCURRENCY
    );
    if (failed.length > 0) {
      logger.warn('Keeping every pulled-in dependency, since not every artifact could be checked for references');
      return [];
    }
    round = rescued;
  }

  return [...stale.values()];
}
