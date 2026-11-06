// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * The rules for what a `{{reference}}` to a named value means, in one place
 * for extract and publish:
 *
 * - It names the named value in its own scope (the service, or one
 *   workspace) with that display name, ignoring case (NamedValueNames). APIM
 *   matches display names only: it rejects a policy whose reference is only a
 *   named value's resource name.
 * - A policy attribute set to one (backend-id="{{name}}") names the resource
 *   its value gives, when the value is known (namedValueTargetName).
 *
 * Extract builds the names from the named values APIM lists; publish builds
 * them from the artifacts. On publish a reference can use either the display
 * name a named value is published with (overrides applied) or, where an
 * override changes it, its display name in the source.
 */

/** A named value as far as matching references to it goes. */
export interface NamedValueEntry {
  /** Its resource name. */
  name: string;
  /** Its display name (on publish, with overrides applied), when known. */
  displayName?: unknown;
  /**
   * On publish, its display name in the source. A reference to it still names
   * the named value where an override changes the display name; a display
   * name another named value is published with wins over it.
   */
  sourceDisplayName?: unknown;
}

/** The named values of one scope, matched as APIM matches a `{{reference}}`. */
export class NamedValueNames {
  /** Lower-case display name → resource name. */
  private readonly byReference = new Map<string, string>();

  constructor(namedValues: Iterable<NamedValueEntry>) {
    const entries = [...namedValues];
    for (const key of ['sourceDisplayName', 'displayName'] as const) {
      for (const entry of entries) {
        const displayName = entry[key];
        if (typeof displayName === 'string') {
          this.byReference.set(displayName.toLowerCase(), entry.name);
        }
      }
    }
  }

  /**
   * The resource name of the named value with the reference as its display
   * name, or undefined when none has it.
   */
  resolve(reference: string): string | undefined {
    return this.byReference.get(reference.toLowerCase());
  }
}

/**
 * NamedValueNames for each scope of the given named values, built on first
 * use.
 */
export function namedValueNamesByScope(
  namedValues: Iterable<NamedValueEntry & { workspace?: string }>
): (workspace: string | undefined) => NamedValueNames {
  const byScope = new Map<string, Array<NamedValueEntry & { workspace?: string }>>();
  for (const entry of namedValues) {
    const scope = entry.workspace?.toLowerCase() ?? '';
    byScope.set(scope, [...(byScope.get(scope) ?? []), entry]);
  }
  const built = new Map<string, NamedValueNames>();
  return (workspace) => {
    const scope = workspace?.toLowerCase() ?? '';
    let names = built.get(scope);
    if (!names) {
      names = new NamedValueNames(byScope.get(scope) ?? []);
      built.set(scope, names);
    }
    return names;
  };
}

/**
 * The resource name a named value's value gives a policy attribute set to it,
 * or undefined when it gives none: a secret named value's value isn't known,
 * nor is a Key Vault one's, and a value that is itself a policy expression or
 * named value reference names no resource here.
 */
export function namedValueTargetName(json: Record<string, unknown>): string | undefined {
  const properties = json.properties as Record<string, unknown> | undefined;
  const value = typeof properties?.value === 'string' ? properties.value.trim() : '';
  return properties?.secret === true || value.startsWith('@') || value.includes('{{') ? undefined : value || undefined;
}
