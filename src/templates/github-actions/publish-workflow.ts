/**
 * T044: GitHub Actions publish workflow template
 * Push-to-main trigger with commit ID choice, environment selection, and multi-env stages
 */

export interface PublishWorkflowConfig {
  artifactDir: string;
  environments: string[];
  approvalEnvironments?: string[];
}

export function generatePublishWorkflow(config: PublishWorkflowConfig): string {
  const envChoices = config.environments.map((env) => `          - ${env}`).join('\n');
  const approvalSet = new Set(config.approvalEnvironments ?? []);

  const envJobs = config.environments.map((env, idx) => {
    const autoDeployComment = idx === 0
      ? `    # To enable automatic deployment on push to main, uncomment the condition below:
    # if: github.event.inputs.ENVIRONMENT == '${env}' || github.event_name == 'push'`
      : `    # To enable automatic deployment on push to main, uncomment the condition below:
    # if: github.event.inputs.ENVIRONMENT == '${env}' || github.event_name == 'push'
    # And change needs to: needs: [get-commit, publish-${config.environments[idx - 1]}]`;

    const approvalComment = approvalSet.has(env)
      ? `    # ⚠️  APPROVAL REQUIRED: Configure required reviewers for the '${env}' environment in
    # GitHub repository settings: Settings → Environments → ${env} → Required reviewers
    # The job will pause here until an approver reviews and approves the deployment.\n`
      : '';

    return `  publish-${env}:
${autoDeployComment}
${approvalComment}    if: github.event.inputs.ENVIRONMENT == '${env}'
    runs-on: ubuntu-latest
    environment: ${env}
    needs: get-commit
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

