// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { IArtifactStore } from '../clients/iartifact-store.js';
import type { ResourceDescriptor } from '../models/types.js';
import { ResourceType } from '../models/resource-types.js';
import { redactAndWarnPolicySecrets } from './secret-redactor.js';

export type PolicyFragmentValueSource =
  | 'policy.xml'
  | 'policyFragmentInformation.json';

export interface PolicyFragmentArtifactDetails {
  payload: Record<string, unknown>;
  valueSource?: PolicyFragmentValueSource;
}

function getProperties(
  json: Record<string, unknown> | undefined
): Record<string, unknown> {
  const properties = json?.properties;
  return properties !== null && typeof properties === 'object' && !Array.isArray(properties)
    ? properties as Record<string, unknown>
    : {};
}

export function hasPolicyFragmentValue(
  artifact: Record<string, unknown> | undefined
): boolean {
  return typeof getProperties(artifact).value === 'string';
}

/**
 * Read a policy fragment using the Azure APIops artifact contract.
 *
 * Either policyFragmentInformation.json or policy.xml may represent the
 * fragment. When both exist, JSON metadata is retained and policy.xml supplies
 * the authoritative value and format.
 */
export async function readPolicyFragmentArtifact(
  store: IArtifactStore,
  baseDir: string,
  descriptor: ResourceDescriptor
): Promise<Record<string, unknown> | undefined> {
  return (await readPolicyFragmentArtifactDetails(store, baseDir, descriptor))
    ?.payload;
}

export async function readPolicyFragmentArtifactDetails(
  store: IArtifactStore,
  baseDir: string,
  descriptor: ResourceDescriptor
): Promise<PolicyFragmentArtifactDetails | undefined> {
  if (descriptor.type !== ResourceType.PolicyFragment) {
    throw new Error(`Expected PolicyFragment descriptor, got ${descriptor.type}`);
  }

  const [information, policyContent] = await Promise.all([
    store.readResource(baseDir, descriptor),
    store.readContent(baseDir, descriptor, 'policy'),
  ]);

  if (!information && !policyContent) {
    return undefined;
  }

  if (!policyContent) {
    return {
      payload: information!,
      valueSource: hasPolicyFragmentValue(information)
        ? 'policyFragmentInformation.json'
        : undefined,
    };
  }

  return {
    payload: {
      ...(information ?? {}),
      properties: {
        ...getProperties(information),
        value: policyContent.content,
        format: 'rawxml',
      },
    },
    valueSource: 'policy.xml',
  };
}

/**
 * Write an extracted policy fragment using the Azure APIops split layout:
 * metadata in policyFragmentInformation.json and content in policy.xml.
 */
export async function writePolicyFragmentArtifact(
  store: IArtifactStore,
  baseDir: string,
  descriptor: ResourceDescriptor,
  json: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (descriptor.type !== ResourceType.PolicyFragment) {
    throw new Error(`Expected PolicyFragment descriptor, got ${descriptor.type}`);
  }

  const properties = getProperties(json);
  const { value, format: _format, ...metadataProperties } = properties;
  const information = {
    ...json,
    properties: metadataProperties,
  };

  await store.writeResource(baseDir, descriptor, information);

  if (typeof value !== 'string') {
    return json;
  }

  const redactedContent = redactAndWarnPolicySecrets(descriptor, value);
  await store.writeContent(baseDir, descriptor, redactedContent, 'policy');

  return {
    ...json,
    properties: {
      ...properties,
      value: redactedContent,
    },
  };
}
