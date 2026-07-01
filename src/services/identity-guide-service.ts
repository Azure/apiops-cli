// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Identity setup guide generator
 * Returns the static manual guide content for the selected CI provider.
 */

import {
  azureDevOpsIdentityGuideTemplate,
  githubActionsIdentityGuideTemplate,
} from '../templates/generated/embedded-markdown.js';

export interface IdentityGuideService {
  generateGitHubActionsGuide(): string;
  generateAzureDevOpsGuide(): string;
}

class IdentityGuideServiceImpl implements IdentityGuideService {
  generateGitHubActionsGuide(): string {
    return githubActionsIdentityGuideTemplate;
  }

  generateAzureDevOpsGuide(): string {
    return azureDevOpsIdentityGuideTemplate;
  }
}

export const identityGuideService: IdentityGuideService = new IdentityGuideServiceImpl();
