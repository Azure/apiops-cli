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

import type { EnvMapping } from './env-mapper.js';
import { toDeployedName } from './env-mapper.js';
import type { KnownArtifactSets } from '../models/config.js';
import { POLICY_REFERENCE_PATTERNS, replaceNamedValueReferences } from './transitive-resolver.js';

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
 *   2. An attribute that names a resource (POLICY_REFERENCE_PATTERNS:
 *      backend-id, embeddings-backend-id, fragment-id, logger-id, schema-id).
 *      Rewritten when its type ∈ mapping.appliesTo and the source has that
 *      resource in the policy's scope.
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

  // An attribute that names a resource (backend-id, fragment-id, logger-id,
  // schema-id ...) names one in the policy's scope. A policy expression or a
  // named value (rewritten above) names none here.
  for (const { type, pattern } of POLICY_REFERENCE_PATTERNS) {
    if (!mapping.appliesTo.has(type)) continue;
    result = result.replace(pattern, (match: string, quote: string, value: string) => {
      if (value.startsWith('@') || value.includes('{{') || !known.has(type, value, workspace)) return match;
      return `${match.slice(0, match.length - value.length - quote.length)}${toDeployedName(value, type, mapping)}${quote}`;
    });
  }

  return result;
}
