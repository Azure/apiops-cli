/**
 * Generates a package.json for the target repo that references
 * the apiops CLI tarball via a local file dependency.
 */

export interface PackageJsonConfig {
  /** Relative path from the target repo root to the copied tarball (e.g. '.apiops/apiops-0.1.0.tgz') */
  tarballRelPath: string;
}

export function generatePackageJson(config: PackageJsonConfig): string {
  // Use forward slashes in the file: dependency regardless of OS
  const posixPath = config.tarballRelPath.replace(/\\/g, '/');

  const pkg = {
    name: 'apim-ops-repo',
    version: '1.0.0',
    private: true,
    description: 'Azure API Management configuration-as-code repository',
    dependencies: {
      apiops: `file:${posixPath}`,
    },
  };

  return JSON.stringify(pkg, null, 2) + '\n';
}
