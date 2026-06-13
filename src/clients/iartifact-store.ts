// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * IArtifactStore interface
 * Abstraction over local filesystem for reading/writing APIM artifact files
 */

import { ResourceDescriptor } from '../models/types.js';

export interface IArtifactStore {
  /**
   * Write a resource's JSON payload to the artifact directory.
   * Creates parent directories as needed.
   * File path is derived from the descriptor using standard naming conventions.
   */
  writeResource(
    baseDir: string,
    descriptor: ResourceDescriptor,
    json: Record<string, unknown>
  ): Promise<void>;

  /**
   * Write raw content (policy XML, API specification) to a file.
   * Path is derived from descriptor + content type.
   */
  writeContent(
    baseDir: string,
    descriptor: ResourceDescriptor,
    content: string,
    contentType: 'policy' | 'specification',
    format?: string
  ): Promise<void>;

  /**
   * Write an association file (e.g., product → apis.json, product → groups.json, product → tags.json).
   */
  writeAssociation(
    baseDir: string,
    descriptor: ResourceDescriptor,
    associationType: 'apis' | 'groups' | 'tags',
    names: string[]
  ): Promise<void>;

  /**
   * Read a resource's JSON payload from the artifact directory.
   * Returns undefined if the file doesn't exist.
   */
  readResource(
    baseDir: string,
    descriptor: ResourceDescriptor
  ): Promise<Record<string, unknown> | undefined>;

  /**
   * Read raw content (policy XML, API specification) from a file.
   * Returns undefined if the file doesn't exist.
   */
  readContent(
    baseDir: string,
    descriptor: ResourceDescriptor,
    contentType: 'policy' | 'specification'
  ): Promise<{ content: string; format?: string } | undefined>;

  /**
   * Read an association file.
   * Returns empty array if file doesn't exist.
   */
  readAssociation(
    baseDir: string,
    descriptor: ResourceDescriptor,
    associationType: 'apis' | 'groups' | 'tags'
  ): Promise<string[]>;

  /**
   * List all resource descriptors found in the artifact directory.
   * Walks the directory tree and parses paths back into descriptors.
   */
  listResources(baseDir: string): Promise<ResourceDescriptor[]>;

  /**
   * Delete a resource's artifacts (info file + associated content files).
   */
  deleteResource(
    baseDir: string,
    descriptor: ResourceDescriptor
  ): Promise<void>;
}
