/**
 * T017: Filesystem artifact store implementing IArtifactStore
 * Read/write resource JSON files, policy XML, API specs, associations, wiki markdown
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import he from 'he';
import { IArtifactStore } from './iartifact-store.js';
import { ResourceDescriptor } from '../models/types.js';
import {
  buildArtifactDirectory,
  buildArtifactFilePath,
  buildPolicyFilePath,
  buildSpecificationFilePath,
  buildAssociationFilePath,
  parseArtifactPath,
} from '../lib/resource-path.js';
import { logger } from '../lib/logger.js';

export class ArtifactStore implements IArtifactStore {
  async writeResource(
    baseDir: string,
    descriptor: ResourceDescriptor,
    json: Record<string, unknown>
  ): Promise<void> {
    const filePath = buildArtifactFilePath(baseDir, descriptor);
    
    if (!filePath) {
      logger.debug(`No info file for resource type ${descriptor.type}`);
      return;
    }

    await this.ensureDirectory(path.dirname(filePath));
    
    const content = JSON.stringify(json, null, 2);
    await fs.writeFile(filePath, content, 'utf-8');
    
    logger.debug(`Wrote resource to ${filePath}`);
  }

  async writeContent(
    baseDir: string,
    descriptor: ResourceDescriptor,
    content: string,
    contentType: 'policy' | 'specification',
    format?: string
  ): Promise<void> {
    let filePath: string;
    // Decode HTML entities in policy XML that APIM returns in JSON format
    let fileContent = content;

    if (contentType === 'policy') {
      filePath = buildPolicyFilePath(baseDir, descriptor);
      fileContent = he.decode(content);
    } else if (contentType === 'specification') {
      const specFormat = (format ?? 'yaml') as 'yaml' | 'json' | 'graphql' | 'wsdl' | 'wadl';
      filePath = buildSpecificationFilePath(baseDir, descriptor, specFormat);
    } else {
      const exhaustive: never = contentType;
      throw new Error(`Unknown content type: ${String(exhaustive)}`);
    }

    await this.ensureDirectory(path.dirname(filePath));
    await fs.writeFile(filePath, fileContent, 'utf-8');
    
    logger.debug(`Wrote ${contentType} to ${filePath}`);
  }

  async writeAssociation(
    baseDir: string,
    descriptor: ResourceDescriptor,
    associationType: 'apis' | 'groups' | 'tags',
    names: string[]
  ): Promise<void> {
    const filePath = buildAssociationFilePath(baseDir, descriptor, associationType);
    
    await this.ensureDirectory(path.dirname(filePath));
    
    const content = JSON.stringify(names.map(name => ({ name })), null, 2);
    await fs.writeFile(filePath, content, 'utf-8');
    
    logger.debug(`Wrote ${associationType} association to ${filePath}`);
  }

  async readResource(
    baseDir: string,
    descriptor: ResourceDescriptor
  ): Promise<Record<string, unknown> | undefined> {
    const filePath = buildArtifactFilePath(baseDir, descriptor);
    
    if (!filePath) {
      return undefined;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const json = JSON.parse(content) as Record<string, unknown>;
      logger.debug(`Read resource from ${filePath}`);
      return json;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw new Error(`Failed to read resource from ${filePath}: ${(error as Error).message}`, { cause: error });
    }
  }

  async readContent(
    baseDir: string,
    descriptor: ResourceDescriptor,
    contentType: 'policy' | 'specification'
  ): Promise<{ content: string; format?: string } | undefined> {
    if (contentType === 'policy') {
      const filePath = buildPolicyFilePath(baseDir, descriptor);
      
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        logger.debug(`Read policy from ${filePath}`);
        return { content };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return undefined;
        }
        throw error;
      }
    } else if (contentType === 'specification') {
      // Try different specification formats
      const formats: Array<'yaml' | 'json' | 'graphql' | 'wsdl' | 'wadl'> = [
        'yaml',
        'json',
        'graphql',
        'wsdl',
        'wadl',
      ];

      for (const format of formats) {
        try {
          const filePath = buildSpecificationFilePath(baseDir, descriptor, format);
          const content = await fs.readFile(filePath, 'utf-8');
          logger.debug(`Read specification from ${filePath}`);
          return { content, format };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            continue;
          }
          throw error;
        }
      }

      return undefined;
    }

    const exhaustive: never = contentType;
    throw new Error(`Unknown content type: ${String(exhaustive)}`);
  }

  async readAssociation(
    baseDir: string,
    descriptor: ResourceDescriptor,
    associationType: 'apis' | 'groups' | 'tags'
  ): Promise<string[]> {
    const filePath = buildAssociationFilePath(baseDir, descriptor, associationType);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const json = JSON.parse(content) as Array<{ name: string }>;
      logger.debug(`Read ${associationType} association from ${filePath}`);
      return json.map(item => item.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw new Error(`Failed to read association from ${filePath}: ${(error as Error).message}`, { cause: error });
    }
  }

  async listResources(baseDir: string): Promise<ResourceDescriptor[]> {
    const descriptors: ResourceDescriptor[] = [];
    
    try {
      await this.walkDirectory(baseDir, baseDir, descriptors);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug(`Base directory does not exist: ${baseDir}`);
        return [];
      }
      throw error;
    }

    logger.debug(`Listed ${descriptors.length} resources from ${baseDir}`);
    return descriptors;
  }

  async deleteResource(
    baseDir: string,
    descriptor: ResourceDescriptor
  ): Promise<void> {
    const directory = buildArtifactDirectory(baseDir, descriptor);
    
    try {
      await fs.rm(directory, { recursive: true, force: true });
      logger.debug(`Deleted resource directory ${directory}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Already deleted, no-op
        return;
      }
      throw new Error(`Failed to delete resource: ${(error as Error).message}`, { cause: error });
    }
  }

  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create directory ${dirPath}: ${(error as Error).message}`, { cause: error });
    }
  }

  private async walkDirectory(
    currentPath: string,
    baseDir: string,
    descriptors: ResourceDescriptor[]
  ): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await this.walkDirectory(fullPath, baseDir, descriptors);
      } else if (entry.isFile()) {
        // Try to parse file path into descriptor
        const descriptor = parseArtifactPath(baseDir, fullPath);
        if (descriptor) {
          // Avoid duplicates (some types share directories)
          if (!descriptors.some(d => this.descriptorEquals(d, descriptor))) {
            descriptors.push(descriptor);
          }
        }
      }
    }
  }

  private descriptorEquals(a: ResourceDescriptor, b: ResourceDescriptor): boolean {
    return (
      a.type === b.type &&
      a.nameParts.length === b.nameParts.length &&
      a.nameParts.every((p, i) => p === b.nameParts[i]) &&
      a.workspace === b.workspace
    );
  }
}
