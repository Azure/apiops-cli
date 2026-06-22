// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Artifact scanner
 * Scans an extracted APIM artifact directory and identifies resource types and
 * their properties (e.g. which named values are secrets, backend URLs, etc.)
 * to feed into the interactive configure flow.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../lib/logger.js';

export interface ScannedApi {
  name: string;
}

export interface ScannedNamedValue {
  name: string;
  /** True when the APIM resource has secret: true in its properties */
  isSecret: boolean;
  /** The plaintext value (only present for non-secret named values) */
  currentValue?: string;
}

export interface ScannedBackend {
  name: string;
  /** The backend URL from the extracted JSON */
  url?: string;
}

export interface ScannedLogger {
  name: string;
  loggerType?: string;
}

export interface ScannedDiagnostic {
  name: string;
}

export interface ScannedProduct {
  name: string;
}

/**
 * Aggregated view of all resources found in an artifact directory.
 */
export interface ScannedArtifacts {
  apis: ScannedApi[];
  namedValues: ScannedNamedValue[];
  backends: ScannedBackend[];
  loggers: ScannedLogger[];
  diagnostics: ScannedDiagnostic[];
  products: ScannedProduct[];
}

export interface ArtifactScanner {
  scan(artifactDir: string): Promise<ScannedArtifacts>;
}

class ArtifactScannerImpl implements ArtifactScanner {
  async scan(artifactDir: string): Promise<ScannedArtifacts> {
    const result: ScannedArtifacts = {
      apis: [],
      namedValues: [],
      backends: [],
      loggers: [],
      diagnostics: [],
      products: [],
    };

    const absDir = path.resolve(artifactDir);

    if (!(await this.dirExists(absDir))) {
      logger.debug(`Artifact directory not found: ${absDir}`);
      return result;
    }

    const [apis, namedValues, backends, loggers, diagnostics, products] =
      await Promise.all([
        this.scanApis(absDir),
        this.scanNamedValues(absDir),
        this.scanBackends(absDir),
        this.scanLoggers(absDir),
        this.scanDiagnostics(absDir),
        this.scanProducts(absDir),
      ]);

    result.apis = apis;
    result.namedValues = namedValues;
    result.backends = backends;
    result.loggers = loggers;
    result.diagnostics = diagnostics;
    result.products = products;

    return result;
  }

  private async scanApis(baseDir: string): Promise<ScannedApi[]> {
    const apisDir = path.join(baseDir, 'apis');
    const names = await this.listSubdirectories(apisDir);
    // Filter out revision directories (e.g. "api-name;rev=2")
    return names
      .filter((n) => !n.includes(';rev='))
      .map((name) => ({ name }));
  }

  private async scanNamedValues(baseDir: string): Promise<ScannedNamedValue[]> {
    const nvDir = path.join(baseDir, 'namedValues');
    const names = await this.listSubdirectories(nvDir);
    const results: ScannedNamedValue[] = [];

    for (const name of names) {
      const infoFile = path.join(nvDir, name, 'namedValueInformation.json');
      let isSecret = false;
      let currentValue: string | undefined;

      try {
        const raw = await fs.readFile(infoFile, 'utf-8');
        const json = JSON.parse(raw) as Record<string, unknown>;
        const props = json.properties as Record<string, unknown> | undefined;
        if (props) {
          isSecret = props.secret === true;
          if (!isSecret && typeof props.value === 'string') {
            currentValue = props.value;
          }
        }
      } catch {
        // File missing or unreadable — treat as non-secret
      }

      results.push({ name, isSecret, currentValue });
    }

    return results;
  }

  private async scanBackends(baseDir: string): Promise<ScannedBackend[]> {
    const backendsDir = path.join(baseDir, 'backends');
    const names = await this.listSubdirectories(backendsDir);
    const results: ScannedBackend[] = [];

    for (const name of names) {
      const infoFile = path.join(backendsDir, name, 'backendInformation.json');
      let url: string | undefined;

      try {
        const raw = await fs.readFile(infoFile, 'utf-8');
        const json = JSON.parse(raw) as Record<string, unknown>;
        const props = json.properties as Record<string, unknown> | undefined;
        if (props && typeof props.url === 'string') {
          url = props.url;
        }
      } catch {
        // File missing or unreadable
      }

      results.push({ name, url });
    }

    return results;
  }

  private async scanLoggers(baseDir: string): Promise<ScannedLogger[]> {
    const loggersDir = path.join(baseDir, 'loggers');
    const names = await this.listSubdirectories(loggersDir);
    const results: ScannedLogger[] = [];

    for (const name of names) {
      const infoFile = path.join(loggersDir, name, 'loggerInformation.json');
      let loggerType: string | undefined;

      try {
        const raw = await fs.readFile(infoFile, 'utf-8');
        const json = JSON.parse(raw) as Record<string, unknown>;
        const props = json.properties as Record<string, unknown> | undefined;
        if (props && typeof props.loggerType === 'string') {
          loggerType = props.loggerType;
        }
      } catch {
        // File missing or unreadable
      }

      results.push({ name, loggerType });
    }

    return results;
  }

  private async scanDiagnostics(baseDir: string): Promise<ScannedDiagnostic[]> {
    const diagDir = path.join(baseDir, 'diagnostics');
    const names = await this.listSubdirectories(diagDir);
    return names.map((name) => ({ name }));
  }

  private async scanProducts(baseDir: string): Promise<ScannedProduct[]> {
    const productsDir = path.join(baseDir, 'products');
    const names = await this.listSubdirectories(productsDir);
    return names.map((name) => ({ name }));
  }

  /**
   * List immediate subdirectory names within a directory.
   * Returns an empty array if the directory doesn't exist.
   */
  private async listSubdirectories(dir: string): Promise<string[]> {
    if (!(await this.dirExists(dir))) {
      return [];
    }

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  private async dirExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
}

export const artifactScanner: ArtifactScanner = new ArtifactScannerImpl();
