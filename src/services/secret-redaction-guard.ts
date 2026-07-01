// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Secret redaction pre-flight guard
 *
 * Scans the set of artifacts that are about to be published for leftover
 * redaction markers ('*** REDACTED ***'). Any finding aborts the entire
 * publish before a single PUT is issued (for both real and dry-run modes),
 * so a partially-published service can never result from placeholder secrets.
 *
 * Detection mirrors the per-resource publish guards:
 *   - Policies: build the publish payload, apply overrides, then check the
 *     merged `properties.value` for the marker (an override may legitimately
 *     replace the value with clean content).
 *   - Named values: read the resource, apply overrides; KeyVault-backed values
 *     have their `value` stripped before publish and are therefore ignored;
 *     otherwise a `secret === true` value that exactly equals the marker is a
 *     finding.
 */

import type { IArtifactStore } from '../clients/iartifact-store.js';
import type { PublishConfig } from '../models/config.js';
import type { ResourceDescriptor } from '../models/types.js';
import { ResourceType } from '../models/resource-types.js';
import { applyOverrides } from './override-merger.js';
import { POLICY_TYPES } from './resource-publisher.js';
import { REDACTION_MARKER } from './secret-redactor.js';
import { buildResourceLabel } from '../lib/resource-uri.js';

/**
 * A single artifact that still contains a redaction marker after overrides.
 */
export interface RedactionMarkerFinding {
  /** The descriptor for the offending artifact. */
  descriptor: ResourceDescriptor;
  /** Human-readable resource label (e.g. `apis/echo/policies/policy`). */
  label: string;
  /** Where the marker was found (e.g. `policy.xml`, `properties.value`). */
  location: string;
}

/**
 * Scan the supplied descriptors for leftover redaction markers in the content
 * that would actually be published (i.e. after overrides are applied).
 *
 * Returns every finding so the caller can report all offenders at once rather
 * than failing on the first one.
 */
export async function scanForRedactionMarkers(
  store: IArtifactStore,
  config: PublishConfig,
  descriptors: ResourceDescriptor[]
): Promise<RedactionMarkerFinding[]> {
  const findings: RedactionMarkerFinding[] = [];

  for (const descriptor of descriptors) {
    if (POLICY_TYPES.has(descriptor.type)) {
      const finding = await scanPolicy(store, config, descriptor);
      if (finding) findings.push(finding);
    } else if (descriptor.type === ResourceType.NamedValue) {
      const finding = await scanNamedValue(store, config, descriptor);
      if (finding) findings.push(finding);
    }
  }

  return findings;
}

async function scanPolicy(
  store: IArtifactStore,
  config: PublishConfig,
  descriptor: ResourceDescriptor
): Promise<RedactionMarkerFinding | undefined> {
  const policyContent = await store.readContent(config.sourceDir, descriptor, 'policy');
  if (!policyContent) {
    return undefined;
  }

  const payload: Record<string, unknown> = {
    properties: {
      value: policyContent.content,
      format: 'rawxml',
    },
  };

  const merged = applyOverrides(descriptor, payload, config.overrides);
  const mergedProps = merged.properties as Record<string, unknown> | undefined;
  const mergedValue = mergedProps?.value;

  if (typeof mergedValue === 'string' && mergedValue.includes(REDACTION_MARKER)) {
    return {
      descriptor,
      label: buildResourceLabel(descriptor),
      location: 'policy.xml',
    };
  }

  return undefined;
}

async function scanNamedValue(
  store: IArtifactStore,
  config: PublishConfig,
  descriptor: ResourceDescriptor
): Promise<RedactionMarkerFinding | undefined> {
  const json = await store.readResource(config.sourceDir, descriptor);
  if (!json) {
    return undefined;
  }

  const merged = applyOverrides(descriptor, json, config.overrides);
  const props = merged.properties as Record<string, unknown> | undefined;

  // KeyVault-backed named values have `properties.value` stripped before publish,
  // so any marker still present in the file is never sent to APIM.
  if (props?.keyVault != null) {
    return undefined;
  }

  if (props?.secret === true && props.value === REDACTION_MARKER) {
    return {
      descriptor,
      label: buildResourceLabel(descriptor),
      location: 'properties.value',
    };
  }

  return undefined;
}
