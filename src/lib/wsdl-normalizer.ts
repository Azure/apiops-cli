// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * WSDL normalizer
 *
 * APIM's WSDL export regenerates the document from its internal API model and
 * has a known defect: `wsdl:part element="..."` references are qualified with
 * the WSDL targetNamespace prefix (`tns`) even when the element is declared in
 * a different inline schema namespace. APIM's own importer then rejects the
 * document with "Could not resolve type '{ns}Element'", breaking the
 * extract → publish round trip for multi-namespace WSDLs.
 *
 * This module rewrites such unresolvable part references to the prefix of the
 * inline schema that actually declares the element. Only references that are
 * (a) unresolvable as-is and (b) declared in exactly one inline schema are
 * rewritten; everything else is left untouched.
 */

import { logger } from './logger.js';

const NAME = String.raw`[\w.-]+`;

/**
 * Apply all WSDL export-defect normalizations needed for the extract →
 * publish round trip.
 */
export function normalizeWsdl(wsdl: string): string {
  return normalizeWsdlServicePorts(normalizeWsdlPartReferences(wsdl));
}

/**
 * Normalize `wsdl:part` element references so they resolve against the inline
 * schemas of the document. Returns the input unchanged when no fix is needed.
 */
export function normalizeWsdlPartReferences(wsdl: string): string {
  const rootMatch = new RegExp(`<(?:${NAME}:)?definitions\\b[^>]*>`).exec(wsdl);
  if (!rootMatch) {
    return wsdl;
  }

  const prefixToNs = parseXmlnsDeclarations(rootMatch[0]);
  const globalElements = collectGlobalSchemaElements(wsdl);
  if (globalElements.size === 0) {
    return wsdl;
  }

  // First declared prefix wins for each namespace
  const nsToPrefix = new Map<string, string>();
  for (const [prefix, ns] of prefixToNs) {
    if (!nsToPrefix.has(ns)) {
      nsToPrefix.set(ns, prefix);
    }
  }

  const newDeclarations: string[] = [];
  let generatedPrefixCounter = 0;

  const partRef = new RegExp(
    `(<(?:${NAME}:)?part\\b[^>]*?\\belement=")(?:(${NAME}):)?(${NAME})(")`,
    'g'
  );

  const rewritten = wsdl.replace(
    partRef,
    (full, before: string, prefix: string | undefined, localName: string, after: string) => {
      // Only fix prefixed references resolvable at the root — anything else
      // (local xmlns declarations, unprefixed refs) is left untouched.
      if (!prefix) {
        return full;
      }
      const referencedNs = prefixToNs.get(prefix);
      if (!referencedNs) {
        return full;
      }

      const declaredIn = globalElements.get(localName);
      // Skip unknown or ambiguous elements (declared in several schemas)
      if (!declaredIn || declaredIn.size !== 1) {
        return full;
      }
      const actualNs = [...declaredIn][0];
      if (actualNs === undefined || referencedNs === actualNs) {
        return full; // already resolvable
      }

      let fixedPrefix = nsToPrefix.get(actualNs);
      if (!fixedPrefix) {
        fixedPrefix = `apiopsns${generatedPrefixCounter++}`;
        nsToPrefix.set(actualNs, fixedPrefix);
        newDeclarations.push(`xmlns:${fixedPrefix}="${actualNs}"`);
      }

      logger.debug(
        `WSDL normalizer: rewriting wsdl:part reference ${prefix}:${localName} → ` +
        `${fixedPrefix}:${localName} (element is declared in "${actualNs}")`
      );
      return `${before}${fixedPrefix}:${localName}${after}`;
    }
  );

  if (rewritten === wsdl) {
    return wsdl;
  }

  if (newDeclarations.length > 0) {
    const rootTag = rootMatch[0];
    const patchedRoot = `${rootTag.slice(0, -1)} ${newDeclarations.join(' ')}>`;
    return rewritten.replace(rootTag, patchedRoot);
  }

  return rewritten;
}

/**
 * APIM's WSDL export emits one `wsdl:port` per configured proxy hostname, but
 * its importer only accepts a single service endpoint ("Multiple service
 * endpoints available, only one can be imported at a time"). Keep the first
 * port of each `wsdl:service` and drop the rest.
 */
export function normalizeWsdlServicePorts(wsdl: string): string {
  const serviceRe = new RegExp(
    `<(${NAME}:)?service\\b[^>]*>[\\s\\S]*?</\\1?service>`,
    'g'
  );

  return wsdl.replace(serviceRe, (serviceBlock) => {
    const portRe = new RegExp(
      `\\s*<(${NAME}:)?port\\b[^>]*(?:/>|>[\\s\\S]*?</\\1?port>)`,
      'g'
    );
    const ports = serviceBlock.match(portRe);
    if (!ports || ports.length <= 1) {
      return serviceBlock;
    }

    logger.debug(
      `WSDL normalizer: keeping first of ${ports.length} wsdl:port endpoints`
    );
    let first = true;
    return serviceBlock.replace(portRe, (port) => {
      if (first) {
        first = false;
        return port;
      }
      return '';
    });
  });
}

/** Parse `xmlns:prefix="ns"` declarations from a single tag string. */
function parseXmlnsDeclarations(tag: string): Map<string, string> {  const map = new Map<string, string>();
  for (const m of tag.matchAll(new RegExp(`xmlns:(${NAME})="([^"]*)"`, 'g'))) {
    map.set(m[1], m[2]);
  }
  return map;
}

/**
 * Collect global (top-level) `xs:element` declarations from every inline
 * schema, keyed by element name → set of schema targetNamespaces.
 * Uses a depth-tracking tag scanner so nested local elements are ignored.
 */
function collectGlobalSchemaElements(wsdl: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const tagRe = /<!--[\s\S]*?-->|<[^>]+>/g;

  let schemaNs: string | undefined;
  let depth = 0; // open-ancestor count relative to the current schema

  for (const m of wsdl.matchAll(tagRe)) {
    const raw = m[0];
    if (raw.startsWith('<!--') || raw.startsWith('<?') || raw.startsWith('<![')) {
      continue;
    }

    const isClose = raw.startsWith('</');
    const isSelfClosing = raw.endsWith('/>');
    const nameMatch = new RegExp(`^</?(?:${NAME}:)?(${NAME})`).exec(raw);
    if (!nameMatch) {
      continue;
    }
    const localName = nameMatch[1];

    if (schemaNs === undefined) {
      if (!isClose && !isSelfClosing && localName === 'schema') {
        schemaNs = /targetNamespace="([^"]*)"/.exec(raw)?.[1];
        depth = 1;
      }
      continue;
    }

    if (isClose) {
      depth--;
      if (depth === 0) {
        schemaNs = undefined;
      }
      continue;
    }

    // depth === 1 → direct child of the schema, i.e. a global declaration
    if (localName === 'element' && depth === 1 && schemaNs) {
      const name = /\bname="([^"]*)"/.exec(raw)?.[1];
      if (name) {
        let set = map.get(name);
        if (!set) {
          set = new Set<string>();
          map.set(name, set);
        }
        set.add(schemaNs);
      }
    }

    if (!isSelfClosing) {
      depth++;
    }
  }

  return map;
}
