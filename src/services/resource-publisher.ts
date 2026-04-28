/**
 * T031: Generic resource publisher
 * Read resource from IArtifactStore, apply overrides, PUT via IApimClient.
 * Handles all 33 resource types using ResourceType metadata.
 * MUST preserve opaque JSON per FR-009.
 */

import type { IApimClient } from '../clients/iapim-client.js';
import type { IArtifactStore } from '../clients/iartifact-store.js';
import type { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import type { PublishConfig } from '../models/config.js';
import { ResourceType } from '../models/resource-types.js';
import { applyOverrides } from './override-merger.js';
import { checkKeyVaultSecretAccess } from './keyvault-checker.js';
import { getNamePart } from '../lib/resource-path.js';

export interface ResourcePublishResult {
  descriptor: ResourceDescriptor;
  status: 'success' | 'failed' | 'skipped';
  action: 'put' | 'delete' | 'noop';
  error?: Error;
}

/**
 * Policy resource types that have external XML content
 */
const POLICY_TYPES = new Set<ResourceType>([
  ResourceType.ServicePolicy,
  ResourceType.ProductPolicy,
  ResourceType.ApiPolicy,
  ResourceType.ApiOperationPolicy,
  ResourceType.GraphQLResolverPolicy,
]);

/**
 * Association resource types that read from association files
 */
const ASSOCIATION_TYPES = new Map<ResourceType, 'apis' | 'groups'>([
  [ResourceType.ProductApi, 'apis'],
  [ResourceType.ProductGroup, 'groups'],
  [ResourceType.GatewayApi, 'apis'],
]);

/**
 * Maps association resource types to their parent resource types.
 * readAssociation / buildAssociationFilePath expect a Product or Gateway
 * descriptor, not the association child type itself.
 */
const ASSOCIATION_PARENT_TYPES = new Map<ResourceType, ResourceType>([
  [ResourceType.ProductApi, ResourceType.Product],
  [ResourceType.ProductGroup, ResourceType.Product],
  [ResourceType.GatewayApi, ResourceType.Gateway],
]);

/**
 * Wiki resource types that read markdown content
 */
const WIKI_TYPES = new Set<ResourceType>([
  ResourceType.ApiWiki,
  ResourceType.ProductWiki,
]);

/**
 * Publish a single resource: read from store, apply overrides, PUT to APIM.
 * Preserves opaque JSON (FR-009). Uses applyOverrides for env-specific values.
 * Returns 'skipped' if resource file doesn't exist in store.
 */
export async function publishResource(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  descriptor: ResourceDescriptor,
  config: PublishConfig
): Promise<ResourcePublishResult> {
  try {
    // Handle association types (ProductApi, ProductGroup, GatewayApi)
    const associationType = ASSOCIATION_TYPES.get(descriptor.type);
    if (associationType) {
      return await publishAssociation(
        client,
        store,
        context,
        descriptor,
        config,
        associationType
      );
    }

    // Handle wiki types
    if (WIKI_TYPES.has(descriptor.type)) {
      return await publishWiki(client, store, context, descriptor, config);
    }

    // Handle policy types — artifact is policy.xml (raw XML), not a JSON info file
    if (POLICY_TYPES.has(descriptor.type)) {
      return await publishPolicy(client, store, context, descriptor, config);
    }

    // Read resource JSON from store
    let json = await store.readResource(config.sourceDir, descriptor);
    if (!json) {
      return {
        descriptor,
        status: 'skipped',
        action: 'noop',
      };
    }

    // Apply overrides (deep merge, preserves opaque structure)
    json = applyOverrides(descriptor, json, config.overrides);

    // For KeyVault-backed NamedValues:
    //   1. Strip properties.value — APIM must not receive both keyVault and value
    //      in the same PUT body, as it causes indefinite provisioning or rejection.
    //   2. Pre-flight access check — verify the managed identity has GET access
    //      to the secret before attempting the PUT. Surfaces permission errors
    //      early and fails fast instead of polling until timeout.
    if (descriptor.type === ResourceType.NamedValue) {
      const props = json.properties as Record<string, unknown> | undefined;
      const kvBlock = props?.keyVault as Record<string, unknown> | undefined;
      if (kvBlock != null) {
        const { value: _omit, ...propsWithoutValue } = props!;
        json = { ...json, properties: propsWithoutValue };

        const secretIdentifier = kvBlock.secretIdentifier as string | undefined;
        const identityClientId = kvBlock.identityClientId as string | undefined;
        if (secretIdentifier) {
          await checkKeyVaultSecretAccess(secretIdentifier, identityClientId, {
            subscriptionId: context.subscriptionId,
            resourceGroup: context.resourceGroup,
            serviceName: context.serviceName,
          });
        }
      }
    }

    // Normalize Subscription scope.
    // APIM stores scope as a full ARM resource path (e.g.
    // "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.ApiManagement/service/{svc}/apis")
    // but the PUT endpoint requires a relative APIM path (e.g. "/apis" or
    // "/apis/{apiId}" or "/products/{productId}").  Strip the service base path
    // prefix when it is present so that the publish round-trip works correctly.
    // HOWEVER: Skip publishing subscriptions with root-level scope (e.g. the built-in
    // "master" subscription), as APIM treats these as read-only system resources
    // and returns ValidationError when attempting to update them.
    if (descriptor.type === ResourceType.Subscription) {
      const props = json.properties as Record<string, unknown> | undefined;
      const scope = props?.scope as string | undefined;
      
      // Built-in master subscription has scope ending with the service path (no /apis or /products suffix)
      // Skip it since APIM doesn't allow updates to built-in subscriptions
      if (scope && (scope.endsWith('/') || (!scope.includes('/apis') && !scope.includes('/products')))) {
        return {
          descriptor,
          status: 'skipped',
          action: 'noop',
        };
      }
      
      json = normalizeSubscriptionScope(json, context);
    }

    // PUT to APIM
    await client.putResource(context, descriptor, json);

    return {
      descriptor,
      status: 'success',
      action: 'put',
    };
  } catch (error) {
    return {
      descriptor,
      status: 'failed',
      action: 'noop',
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Publish association resource (ProductApi, ProductGroup, GatewayApi)
 */
async function publishAssociation(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  descriptor: ResourceDescriptor,
  config: PublishConfig,
  associationType: 'apis' | 'groups'
): Promise<ResourcePublishResult> {
  try {
    // buildAssociationFilePath (called inside readAssociation) only accepts
    // Product or Gateway descriptors — not the association child types
    // (ProductApi, ProductGroup, GatewayApi).  Derive the parent descriptor.
    const parentType = ASSOCIATION_PARENT_TYPES.get(descriptor.type)!;
    const parentDescriptor: ResourceDescriptor = {
      type: parentType,
      nameParts: [getNamePart(descriptor.nameParts, 0)],
      workspace: descriptor.workspace,
    };
    const names = await store.readAssociation(
      config.sourceDir,
      parentDescriptor,
      associationType
    );

    // Create association for each name
    for (const name of names) {
      const assocDescriptor: ResourceDescriptor = {
        type: descriptor.type,
        nameParts: [getNamePart(descriptor.nameParts, 0), name],
      };
      // PUT empty body for association (APIM uses PUT to create association)
      await client.putResource(context, assocDescriptor, {});
    }

    return {
      descriptor,
      status: 'success',
      action: 'put',
    };
  } catch (error) {
    return {
      descriptor,
      status: 'failed',
      action: 'noop',
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Publish wiki resource (ApiWiki, ProductWiki)
 */
async function publishWiki(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  descriptor: ResourceDescriptor,
  config: PublishConfig
): Promise<ResourcePublishResult> {
  try {
    const wikiContent = await store.readContent(
      config.sourceDir,
      descriptor,
      'specification'
    );

    if (!wikiContent) {
      return {
        descriptor,
        status: 'skipped',
        action: 'noop',
      };
    }

    // Build wiki payload
    const payload: Record<string, unknown> = {
      properties: {
        documents: [
          {
            documentId: 'default',
            content: wikiContent.content,
          },
        ],
      },
    };

    await client.putResource(context, descriptor, payload);

    return {
      descriptor,
      status: 'success',
      action: 'put',
    };
  } catch (error) {
    return {
      descriptor,
      status: 'failed',
      action: 'noop',
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Publish policy resource (ServicePolicy, ApiPolicy, ProductPolicy, ApiOperationPolicy,
 * GraphQLResolverPolicy). The artifact on disk is a raw policy.xml file; there is no
 * separate JSON info file for these types. Reads the XML and PUTs it with format=rawxml.
 */
async function publishPolicy(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  descriptor: ResourceDescriptor,
  config: PublishConfig
): Promise<ResourcePublishResult> {
  try {
    const policyContent = await store.readContent(
      config.sourceDir,
      descriptor,
      'policy'
    );

    if (!policyContent) {
      return {
        descriptor,
        status: 'skipped',
        action: 'noop',
      };
    }

    const payload: Record<string, unknown> = {
      properties: {
        value: policyContent.content,
        format: 'rawxml',
      },
    };

    await client.putResource(context, descriptor, payload);

    return {
      descriptor,
      status: 'success',
      action: 'put',
    };
  } catch (error) {
    return {
      descriptor,
      status: 'failed',
      action: 'noop',
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Normalise the `properties.scope` field of a Subscription resource.
 *
 * APIM returns scope as a full ARM resource path on GET, e.g.:
 *   /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.ApiManagement/service/{svc}/apis
 *
 * The PUT endpoint requires a relative APIM path, e.g.:
 *   /apis
 *   /apis/{apiId}
 *   /products/{productId}
 *
 * Strip the service base ARM path prefix when it is present so that the
 * extract → publish round-trip works without manual edits.
 */
function normalizeSubscriptionScope(
  json: Record<string, unknown>,
  context: ApimServiceContext
): Record<string, unknown> {
  const props = json.properties as Record<string, unknown> | undefined;
  if (!props) return json;

  const scope = props.scope as string | undefined;
  if (!scope) return json;

  // The ARM path prefix lives between "management.azure.com" and the first
  // APIM-relative segment.  Derive it from baseUrl by stripping the protocol+host.
  const armPathPrefix = context.baseUrl.replace(/^https?:\/\/[^/]+/, '');

  if (scope.startsWith(armPathPrefix)) {
    const relativeScope = scope.slice(armPathPrefix.length) || '/';
    return {
      ...json,
      properties: { ...props, scope: relativeScope },
    };
  }

  return json;
}
