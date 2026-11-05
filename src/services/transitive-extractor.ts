// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { IApimClient } from '../clients/iapim-client.js';
import type { IArtifactStore } from '../clients/iartifact-store.js';
import type { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import { ResourceType } from '../models/resource-types.js';
import { getResourceDescriptorKey } from '../lib/resource-path.js';
import { buildResourceLabel } from '../lib/resource-uri.js';
import { logger } from '../lib/logger.js';
import { runParallel } from '../lib/parallel-runner.js';
import { redactSecrets } from './secret-redactor.js';
import { findTransitiveDependencies, scanLiquidNamedValueCandidates } from './transitive-resolver.js';
import type { ExtractedResource } from './resource-extractor.js';

const DEFAULT_CONCURRENCY = 5;

export interface TransitiveResourceArtifact {
  descriptor: ResourceDescriptor;
  json: Record<string, unknown>;
}

/**
 * Add an API's or product's extracted policies to the policies scanned for
 * dependencies, keyed `api:{name}:policy:{n}` / `product:{name}:policy:{n}`.
 */
export function collectPolicies(
  collected: Map<string, string>,
  owner: 'api' | 'product',
  name: string,
  policies: ReadonlyArray<string | undefined>
): void {
  policies.forEach((policy, index) => {
    if (policy !== undefined) {
      collected.set(`${owner}:${name}:policy:${index}`, policy);
    }
  });
}

/**
 * The extracted API children that reference other resources: diagnostics
 * (their logger) and tag links (the tag).
 */
export function apiDependencyResources(apiResult: {
  diagnostics: ReadonlyArray<ExtractedResource>;
  tags: ReadonlyArray<ExtractedResource>;
}): TransitiveResourceArtifact[] {
  return [...apiResult.diagnostics, ...apiResult.tags]
    .filter((extracted) => extracted.status === 'success')
    .map(({ descriptor, json }) => ({ descriptor, json }));
}

export interface TransitiveExtractionResult {
  extractedDescriptors: ResourceDescriptor[];
  /** Dependencies that were not found or could not be extracted. */
  failedDescriptors: ResourceDescriptor[];
  errorCount: number;
}

interface TransitiveTaskResult {
  dep: ResourceDescriptor;
  json?: Record<string, unknown>;
  /**
   * Resolved to a resource already extracted or claimed by another reference,
   * or to one the filter excludes by name.
   */
  skipped?: boolean;
}

/**
 * Per-context (keyed by baseUrl) index of named value displayName, and
 * resource name where no display name claims it (lower case, as names are
 * compared everywhere else) → resource name.
 * Stored as promises so concurrent tasks share a single LIST call.
 */
type NamedValueNameIndex = Map<string, Promise<Map<string, string>>>;

async function loadNamedValueNames(
  client: IApimClient,
  context: ApimServiceContext
): Promise<Map<string, string>> {
  const byDisplayName = new Map<string, string>();
  const resourceNames: string[] = [];
  try {
    for await (const json of client.listResources(context, ResourceType.NamedValue)) {
      const name = json.name;
      const displayName = (json.properties as Record<string, unknown> | undefined)?.displayName;
      if (typeof name === 'string') {
        resourceNames.push(name);
        if (typeof displayName === 'string') {
          byDisplayName.set(displayName.toLowerCase(), name);
        }
      }
    }
    // A reference matches a display name first, as in APIM, then a resource name.
    for (const name of resourceNames) {
      if (!byDisplayName.has(name.toLowerCase())) {
        byDisplayName.set(name.toLowerCase(), name);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Failed to list named values for display name resolution; ` +
      `falling back to resolving {{references}} as resource names: ${message}`
    );
  }
  return byDisplayName;
}

/** The named value name index for a context, listed once and shared. */
function namedValueNames(
  client: IApimClient,
  context: ApimServiceContext,
  index: NamedValueNameIndex
): Promise<Map<string, string>> {
  let names = index.get(context.baseUrl);
  if (!names) {
    names = loadNamedValueNames(client, context);
    index.set(context.baseUrl, names);
  }
  return names;
}

/**
 * Policies reference named values as {{displayName}}, but the ARM GET endpoint
 * is keyed by resource name. Map the reference to the resource name when they
 * differ; otherwise return the descriptor unchanged.
 */
async function resolveNamedValueDescriptor(
  client: IApimClient,
  context: ApimServiceContext,
  dep: ResourceDescriptor,
  index: NamedValueNameIndex
): Promise<ResourceDescriptor> {
  const ref = dep.nameParts[0] ?? '';
  const name = (await namedValueNames(client, context, index)).get(ref.toLowerCase());
  if (!name || name === ref) {
    return dep;
  }

  logger.debug(`Resolved named value reference "{{${ref}}}" to resource name "${name}"`);
  return { ...dep, nameParts: [name] };
}

/** The `{{name}}`s in a policy fragment's Liquid bodies (scanLiquidNamedValueCandidates). */
function fragmentLiquidCandidates({ descriptor, json }: TransitiveResourceArtifact): string[] {
  if (descriptor.type !== ResourceType.PolicyFragment) {
    return [];
  }
  const properties = json.properties as Record<string, unknown> | undefined;
  return [properties?.value, properties?.policyContent]
    .filter((text): text is string => typeof text === 'string')
    .flatMap(scanLiquidNamedValueCandidates);
}

/**
 * The named values Liquid bodies reference: each `{{name}}` candidate that a
 * named value in this scope has as its display or resource name. The others
 * are Liquid, skipped without a warning.
 */
async function liquidNamedValueDependencies(
  client: IApimClient,
  context: ApimServiceContext,
  candidates: ReadonlySet<string>,
  workspace: string | undefined,
  index: NamedValueNameIndex
): Promise<ResourceDescriptor[]> {
  if (candidates.size === 0) {
    return [];
  }
  const names = await namedValueNames(client, context, index);
  return [...candidates]
    .filter((candidate) => names.has(candidate.toLowerCase()))
    .map((candidate) => ({ type: ResourceType.NamedValue, nameParts: [candidate], workspace }));
}

export interface TransitiveExtractionOptions {
  /** Workspace being extracted; its resources are fetched through `context`. */
  workspace?: string;
  /** Service-level context, for dependencies outside the workspace. */
  serviceContext?: ApimServiceContext;
  /** Dependencies already known from links (a product's groups and tags). */
  linkedDependencies?: ResourceDescriptor[];
  /**
   * Dependencies not to extract: ones the filter excludes by name, or ones
   * the caller knows are extracted already.
   */
  skip?: (dep: ResourceDescriptor) => boolean;
}

export async function extractTransitiveDependencies(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  outputDir: string,
  policies: Map<string, string>,
  apis: Map<string, Record<string, unknown>>,
  resources: TransitiveResourceArtifact[],
  alreadyExtracted: ResourceDescriptor[],
  {
    workspace,
    serviceContext,
    linkedDependencies = [],
    skip = () => false,
  }: TransitiveExtractionOptions = {}
): Promise<TransitiveExtractionResult> {
  const attempted = new Set(alreadyExtracted.map(getResourceDescriptorKey));
  const claimedNamedValues = new Set(alreadyExtracted.map(getResourceDescriptorKey));
  const extractedDescriptors: ResourceDescriptor[] = [];
  const failedDescriptors: ResourceDescriptor[] = [];
  const namedValueIndex: NamedValueNameIndex = new Map();
  let errorCount = 0;
  let foundDependencies = false;

  // The {{name}}s in Liquid bodies: the policies' found once, and each
  // fragment's as it is extracted.
  const liquidCandidates = new Set([...policies.values()].flatMap(scanLiquidNamedValueCandidates));
  let resourcesScanned = 0;

  while (true) {
    for (; resourcesScanned < resources.length; resourcesScanned++) {
      fragmentLiquidCandidates(resources[resourcesScanned]).forEach((name) => liquidCandidates.add(name));
    }
    const newDeps = [
      ...findTransitiveDependencies(policies, apis, workspace, resources),
      ...linkedDependencies,
      ...await liquidNamedValueDependencies(client, context, liquidCandidates, workspace, namedValueIndex),
    ].filter((dep) => !attempted.has(getResourceDescriptorKey(dep)) && !skip(dep));

    if (newDeps.length === 0) {
      if (!foundDependencies) {
        logger.debug('No additional transitive dependencies found');
      }
      return { extractedDescriptors, failedDescriptors, errorCount };
    }

    foundDependencies = true;
    logger.info(`Found ${newDeps.length} transitive dependencies to extract`);
    for (const dep of newDeps) {
      attempted.add(getResourceDescriptorKey(dep));
    }

    const tasks = newDeps.map((dep) => async (): Promise<TransitiveTaskResult> => {
      try {
        const dependencyContext =
          serviceContext && dep.workspace !== workspace ? serviceContext : context;
        let target = dep;
        if (dep.type === ResourceType.NamedValue) {
          target = await resolveNamedValueDescriptor(client, dependencyContext, dep, namedValueIndex);
          const targetKey = getResourceDescriptorKey(target);
          // A {{displayName}} reference is checked again under the resource
          // name it resolves to, which is what an exclusion names.
          if (target !== dep && skip(target)) {
            return { dep: target, skipped: true };
          }
          if (claimedNamedValues.has(targetKey)) {
            return { dep: target, skipped: true };
          }
          claimedNamedValues.add(targetKey);
        }
        const json = await client.getResource(dependencyContext, target);
        if (json) {
          const safeJson = redactSecrets(target, json);
          await store.writeResource(outputDir, target, safeJson);
          logger.info(`Extracted transitive dependency ${buildResourceLabel(target)}`);
          return { dep: target, json: safeJson };
        }
        logger.warn(`Transitive dependency ${buildResourceLabel(target)} was not found`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          `Failed to extract transitive dependency ${buildResourceLabel(dep)}: ${message}`
        );
      }
      return { dep };
    });

    const taskResults = await runParallel(tasks, DEFAULT_CONCURRENCY);
    for (const taskResult of taskResults) {
      const value = taskResult.status === 'fulfilled' ? taskResult.value : undefined;
      if (value?.skipped) {
        continue;
      }
      if (!value?.json) {
        errorCount++;
        if (value) {
          failedDescriptors.push(value.dep);
        }
        continue;
      }

      extractedDescriptors.push(value.dep);
      resources.push({
        descriptor: value.dep,
        json: value.json,
      });
    }
  }
}
