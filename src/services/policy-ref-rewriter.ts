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
 *   Only tokens/attribute values whose exact text is present in the
 *   corresponding known set are rewritten. This naturally excludes APIM
 *   runtime context references such as {{context.request.headers.foo}}
 *   because those strings will never appear as artifact resource names.
 */

import { ResourceType } from '../models/resource-types.js';
import type { EnvMapping } from './env-mapper.js';
import { toDeployedName } from './env-mapper.js';
import type { KnownArtifactSets } from '../models/config.js';

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/**
 * Matches {{token}} with optional whitespace inside the braces.
 * Group 1 = token name (no whitespace).
 */
const NV_PATTERN = /\{\{\s*([A-Za-z0-9._-]+)\s*\}\}/g;

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
 *   1. `{{tokenName}}` — NamedValue reference. Only rewritten when
 *      tokenName ∈ knownArtifactSets.namedValues AND
 *      ResourceType.NamedValue ∈ mapping.appliesTo.
 *   2. `fragment-id="name"` on <include-fragment>. Only rewritten when
 *      name ∈ knownArtifactSets.fragments AND
 *      ResourceType.PolicyFragment ∈ mapping.appliesTo.
 *   3. `backend-id="name"` on <set-backend-service>. Only rewritten when
 *      name ∈ knownArtifactSets.backends AND
 *      ResourceType.Backend ∈ mapping.appliesTo.
 *
 * Returns the input unchanged if `mapping` is undefined or no matches apply.
 */
export function rewritePolicyRefs(
  xml: string,
  mapping: EnvMapping | undefined,
  known: KnownArtifactSets,
): string {
  if (mapping === undefined) return xml;

  let result = xml;

  if (mapping.appliesTo.has(ResourceType.NamedValue)) {
    result = result.replace(NV_PATTERN, (match, name: string) => {
      if (!known.namedValues.has(name)) return match;
      return `{{${toDeployedName(name, ResourceType.NamedValue, mapping)}}}`;
    });
  }

  if (mapping.appliesTo.has(ResourceType.PolicyFragment)) {
    result = result.replace(FRAGMENT_PATTERN, (match, prefix: string, quote: string, id: string) => {
      if (!known.fragments.has(id)) return match;
      return `${prefix}${quote}${toDeployedName(id, ResourceType.PolicyFragment, mapping)}${quote}`;
    });
  }

  if (mapping.appliesTo.has(ResourceType.Backend)) {
    result = result.replace(BACKEND_PATTERN, (match, prefix: string, quote: string, id: string) => {
      if (!known.backends.has(id)) return match;
      return `${prefix}${quote}${toDeployedName(id, ResourceType.Backend, mapping)}${quote}`;
    });
  }

  return result;
}
