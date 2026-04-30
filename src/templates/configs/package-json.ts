/**
 * Generates a package.json for the target repo that references
 * either a local apiops CLI tarball or the public npm package.
 */

export type PackageJsonConfig =
  | { mode: 'local'; tarballRelPath: string }
  | { mode: 'npm' };

export function generatePackageJson(config: PackageJsonConfig): string {
  const pkg: Record<string, unknown> = {
    name: 'apim-ops-repo',
    version: '1.0.0',
    private: true,
    description: 'Azure API Management configuration-as-code repository',
    dependencies: {},
  };

  if (config.mode === 'local') {
    // Use forward slashes in the file: dependency regardless of OS
    const posixPath = config.tarballRelPath.replace(/\\/g, '/');
    (pkg.dependencies as Record<string, string>).apiops = `file:${posixPath}`;
  } else {
    // Public npm registry mode
    (pkg.dependencies as Record<string, string>)['@peterhauge/apiops-cli'] = 'latest';
  }

  return JSON.stringify(pkg, null, 2) + '\n';
}
