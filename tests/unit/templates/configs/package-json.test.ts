// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for package.json template generator
 */

import { describe, it, expect } from 'vitest';
import { generatePackageJson } from '../../../../src/templates/configs/package-json.js';

describe('configs/package-json', () => {
  describe('generatePackageJson', () => {
    describe('local mode', () => {
      it('should generate valid JSON', () => {
        const content = generatePackageJson({ mode: 'local', tarballRelPath: '.apiops/apiops-0.1.0.tgz' });
        expect(() => JSON.parse(content)).not.toThrow();
      });

      it('should include file: dependency for the tarball', () => {
        const content = generatePackageJson({ mode: 'local', tarballRelPath: '.apiops/apiops-0.1.0.tgz' });
        const pkg = JSON.parse(content);
        expect(pkg.dependencies.apiops).toBe('file:.apiops/apiops-0.1.0.tgz');
      });

      it('should set private to true', () => {
        const content = generatePackageJson({ mode: 'local', tarballRelPath: '.apiops/apiops-0.1.0.tgz' });
        const pkg = JSON.parse(content);
        expect(pkg.private).toBe(true);
      });

      it('should include name and version', () => {
        const content = generatePackageJson({ mode: 'local', tarballRelPath: '.apiops/apiops-0.1.0.tgz' });
        const pkg = JSON.parse(content);
        expect(pkg.name).toBeTruthy();
        expect(pkg.version).toBeTruthy();
      });

      it('should use forward slashes in dependency path', () => {
        // Even if path.join produces backslashes on Windows, the output should use /
        const content = generatePackageJson({ mode: 'local', tarballRelPath: '.apiops\\apiops-0.1.0.tgz' });
        const pkg = JSON.parse(content);
        expect(pkg.dependencies.apiops).toBe('file:.apiops/apiops-0.1.0.tgz');
      });

      it('should end with a newline', () => {
        const content = generatePackageJson({ mode: 'local', tarballRelPath: '.apiops/apiops-0.1.0.tgz' });
        expect(content.endsWith('\n')).toBe(true);
      });
    });

    describe('npm mode', () => {
      it('should generate valid JSON', () => {
        const content = generatePackageJson({ mode: 'npm' });
        expect(() => JSON.parse(content)).not.toThrow();
      });

      it('should include @peterhauge/apiops-cli dependency', () => {
        const content = generatePackageJson({ mode: 'npm' });
        const pkg = JSON.parse(content);
        expect(pkg.dependencies['@peterhauge/apiops-cli']).toBe('latest');
      });

      it('should NOT include apiops dependency', () => {
        const content = generatePackageJson({ mode: 'npm' });
        const pkg = JSON.parse(content);
        expect(pkg.dependencies.apiops).toBeUndefined();
      });

      it('should set private to true', () => {
        const content = generatePackageJson({ mode: 'npm' });
        const pkg = JSON.parse(content);
        expect(pkg.private).toBe(true);
      });

      it('should include name and version', () => {
        const content = generatePackageJson({ mode: 'npm' });
        const pkg = JSON.parse(content);
        expect(pkg.name).toBeTruthy();
        expect(pkg.version).toBeTruthy();
      });

      it('should end with a newline', () => {
        const content = generatePackageJson({ mode: 'npm' });
        expect(content.endsWith('\n')).toBe(true);
      });
    });
  });
});
