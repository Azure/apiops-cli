// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Rewrites cross-resource references inside APIM policy XML strings from
 * canonical → deployed names.
 *
 * Design trade-off — regex, not XML parsing:
 *   Aligns with the repo's opaque-payload philosophy (FR-009). XML comments
 *   (<!--...-->) and CDATA sections are NOT explicitly excluded; a token like
 *   {{name}} inside a comment would technically be rewritten. This risk is
 *   acceptable because the known-set filter is the primary safety guard —
 *   only names present in the canonical artifact set are rewritten, so a
 *   false positive requires an artifact to be named exactly like a comment
 *   token, which is extremely unlikely in practice.
 *
 * Known-set filter safety:
 *   Only tokens that are the display name of a named value in the source, and
 *   attribute values that name a resource in the source, are rewritten. This
 *   naturally excludes APIM runtime context references such as
 *   {{context.request.headers.foo}}, which no named value has as its name.
 */

import { ResourceType } from '../models/resource-types.js';
import type { EnvMapping } from './env-mapper.js';
import { toDeployedName } from './env-mapper.js';
import type { KnownArtifactSets } from '../models/config.js';
import { replaceNamedValueReferences } from './transitive-resolver.js';

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/**
 * Matches the fragment-id attribute on an <include-fragment> element.
 * Groups: 1 = tag prefix through `=`, 2 = opening quote, 3 = id value,
 *          4 = closing quote (backreference to group 2).
 */
const FRAGMENT_PATTERN = /(<include-fragment\b[^>]*\bfragment-id\s*=\s*)(["'])([^"'>]+)(\2)/gi;

/**
 * Matches the backend-id attribute on a <set-backend-service> element.
 * Groups: 1 = tag prefix through `=`, 2 = opening quote, 3 = id value,
 *          4 = closing quote (backreference to group 2).
 */
const BACKEND_PATTERN = /(<set-backend-service\b[^>]*\bbackend-id\s*=\s*)(["'])([^"'>]+)(\2)/gi;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type { KnownArtifactSets } from '../models/config.js';

/**
 * Rewrite cross-resource refs inside a policy XML string from canonical →
 * deployed names.
 *
 * Handled reference styles:
 *   1. `{{token}}` — a named value reference where APIM substitutes one
 *      (replaceNamedValueReferences: inside a Liquid body, only a bare
 *      `{{name}}`), resolved as APIM resolves it (by
 *      display name, ignoring case, in the policy's scope) and rewritten to the
 *      display name that named value is deployed with
 *      (KnownArtifactSets.deployedNamedValueReference). Rewritten even without
 *      a mapping when an explicit displayName override changes it.
 *   2. `fragment-id="name"` on <include-fragment>. Only rewritten when the
 *      source has that fragment in the policy's scope AND
 *      ResourceType.PolicyFragment ∈ mapping.appliesTo.
 *   3. `backend-id="name"` on <set-backend-service>. Only rewritten when the
 *      source has that backend in the policy's scope AND
 *      ResourceType.Backend ∈ mapping.appliesTo.
 *
 * @param workspace - The policy's workspace, if any: references name
 *   resources in its own scope
 */
export function rewritePolicyRefs(
  xml: string,
  mapping: EnvMapping | undefined,
  known: KnownArtifactSets,
  workspace?: string,
): string {
  // A token names the named value with that display name in the policy's
  // scope, and becomes the display name it is deployed with: changed by an
  // explicit displayName override even without a mapping. APIM matches
  // display names ignoring case, so one that differs only in case is kept.
  let result = replaceNamedValueReferences(xml, (name, match) => {
    const deployed = known.deployedNamedValueReference(name, workspace);
    return deployed === undefined || deployed.toLowerCase() === name.toLowerCase() ? match : `{{${deployed}}}`;
  });

  if (mapping === undefined) return result;

  if (mapping.appliesTo.has(ResourceType.PolicyFragment)) {
    result = result.replace(FRAGMENT_PATTERN, (match, prefix: string, quote: string, id: string) => {
      if (!known.has(ResourceType.PolicyFragment, id, workspace)) return match;
      return `${prefix}${quote}${toDeployedName(id, ResourceType.PolicyFragment, mapping)}${quote}`;
    });
  }

  if (mapping.appliesTo.has(ResourceType.Backend)) {
    result = result.replace(BACKEND_PATTERN, (match, prefix: string, quote: string, id: string) => {
      if (!known.has(ResourceType.Backend, id, workspace)) return match;
      return `${prefix}${quote}${toDeployedName(id, ResourceType.Backend, mapping)}${quote}`;
    });
  }

  return result;
}
