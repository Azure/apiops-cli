/**
 * T044: GitHub Actions publish workflow template
 * Push-to-main trigger with commit ID choice, environment selection, and multi-env stages
 */

export interface PublishWorkflowConfig {
  artifactDir: string;
  environments: string[];
}

export function generatePublishWorkflow(config: PublishWorkflowConfig): string {
  const envChoices = config.environments.map((env) => `          - ${env}`).join('\n');

  const envJobs = config.environments.map((env, idx) => {
    const previousEnvironment = idx > 0 ? config.environments[idx - 1] : null;
    const needs = previousEnvironment ? `[get-commit, publish-${previousEnvironment}]` : 'get-commit';

    const jobComment = idx === 0
      ? `    # Automatically deploys to ${env} on push to main (incremental mode) or when selected via workflow_dispatch`
      : `    # Deploys to ${env} after ${previousEnvironment} succeeds (sequential promotion).
    # To require human approval before deploying to ${env}:
    #   1. Go to Settings > Environments > ${env} in your GitHub repository
    #   2. Add "Required reviewers" under "Environment protection rules"`;

    const jobCondition = `github.event.inputs.ENVIRONMENT == '${env}' || github.event_name == 'push'`;

    return `  publish-${env}:
${jobComment}
    if: ${jobCondition}
    runs-on: ubuntu-latest
    environment: ${env}
    needs: ${needs}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install dependencies
        run: npm install

      - name: Azure Login (Federated Credential)
        uses: azure/login@v2
        with:
          client-id: \${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Publish to ${env} (incremental - last commit only)
        if: \${{ github.event.inputs.COMMIT_ID_CHOICE != 'publish-all-artifacts-in-repo' }}
        run: |
          npx apiops publish \\
            --subscription-id \${{ secrets.AZURE_SUBSCRIPTION_ID }} \\
            --resource-group \${{ secrets.APIM_RESOURCE_GROUP_${env.toUpperCase()} }} \\
            --service-name \${{ secrets.APIM_SERVICE_NAME_${env.toUpperCase()} }} \\
            --source ${config.artifactDir} \\
            --commit-id \${{ needs.get-commit.outputs.commit_id }}

      - name: Publish to ${env} (all artifacts)
        if: \${{ github.event.inputs.COMMIT_ID_CHOICE == 'publish-all-artifacts-in-repo' }}
        run: |
          npx apiops publish \\
            --subscription-id \${{ secrets.AZURE_SUBSCRIPTION_ID }} \\
            --resource-group \${{ secrets.APIM_RESOURCE_GROUP_${env.toUpperCase()} }} \\
            --service-name \${{ secrets.APIM_SERVICE_NAME_${env.toUpperCase()} }} \\
            --source ${config.artifactDir}
`;
  }).join('\n');

  return `name: Run APIM Publisher

on:
  push:
    branches:
      - main
    paths:
      - '${config.artifactDir}/**'
      - 'configuration.*.yaml'
  workflow_dispatch:
    inputs:
      COMMIT_ID_CHOICE:
        description: 'Choose "publish-all-artifacts-in-repo" only when you want to force republishing all artifacts (e.g. after build failure). Otherwise stick with the default behavior of "publish-artifacts-in-last-commit"'
        required: true
        type: choice
        default: publish-artifacts-in-last-commit
        options:
          - publish-artifacts-in-last-commit
          - publish-all-artifacts-in-repo
      ENVIRONMENT:
        description: 'Choose which environment to publish to'
        required: true
        type: choice
        default: ${config.environments[0]}
        options:
${envChoices}

permissions:
  id-token: write
  contents: read

jobs:
  get-commit:
    runs-on: ubuntu-latest
    outputs:
      commit_id: \${{ steps.commit.outputs.commit_id }}
    steps:
      - name: Set the Commit Id
        id: commit
        run: echo "commit_id=\${GITHUB_SHA}" >> $GITHUB_OUTPUT

${envJobs}
`;
}

