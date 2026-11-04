// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for keyvault-checker service (ARM-based approach)
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import {
  checkKeyVaultSecretAccess,
  type KeyVaultArmClientFactory,
  type KeyVaultCheckContext,
} from '../../../src/services/keyvault-checker.js';
import { ArmHttpClient, type ArmTokenCredential } from '../../../src/clients/arm-http-client.js';
import { logger } from '../../../src/lib/logger.js';

/** Stands in for DefaultAzureCredential, which only the default client factory creates. */
const identityMock = vi.hoisted(() => ({
  constructed: 0,
  getToken: vi.fn(),
}));

vi.mock('@azure/identity', async (importOriginal) => ({
  // Keep the real getBearerTokenProvider (the SDK token cycler) around the mocked credential.
  ...(await importOriginal<typeof import('@azure/identity')>()),
  DefaultAzureCredential: class {
    constructor() {
      identityMock.constructed++;
    }
    getToken = identityMock.getToken;
  },
}));

describe('checkKeyVaultSecretAccess', () => {
  let mockGetToken: ReturnType<typeof vi.fn>;
  let mockArmRequest: ReturnType<typeof vi.fn>;
  let mockArmClientFactory: KeyVaultArmClientFactory & ReturnType<typeof vi.fn>;

  const validSecretIdentifier = 'https://myvault.vault.azure.net/secrets/my-secret';

  const apimContext: KeyVaultCheckContext = {
    subscriptionId: 'sub-1',
    resourceGroup: 'rg-1',
    serviceName: 'apim-1',
    armBaseUrl: 'https://management.azure.com',
    authScope: 'https://management.azure.com/.default',
  };

  /** Build a minimal ARM response stub */
  function armResponse(status: number, body: unknown) {
    return { status, json: () => Promise.resolve(body) };
  }

  /** APIM service JSON with a system-assigned identity */
  function apimWithSystemIdentity(principalId: string) {
    return {
      identity: {
        type: 'SystemAssigned',
        principalId,
      },
    };
  }

  /** APIM service JSON with a user-assigned identity */
  function apimWithUserIdentity(clientId: string, principalId: string) {
    return {
      identity: {
        type: 'UserAssigned',
        userAssignedIdentities: {
          '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ManagedIdentity/userAssignedIdentities/my-mi': {
            clientId,
            principalId,
          },
        },
      },
    };
  }

  /** Vault list response (subscription resource search) */
  function vaultListResponse(vaultId: string) {
    return { value: [{ id: vaultId }] };
  }

  /** Vault GET response with RBAC enabled */
  function vaultWithRbac() {
    return { properties: { enableRbacAuthorization: true } };
  }

  /** Vault GET response with access-policy mode */
  function vaultWithAccessPolicies(policies: unknown[]) {
    return { properties: { enableRbacAuthorization: false, accessPolicies: policies } };
  }

  /** Role assignment whose roleDefinitionId ends with the given GUID */
  function roleAssignment(roleGuid: string) {
    return {
      properties: {
        roleDefinitionId: `/subscriptions/sub-1/providers/Microsoft.Authorization/roleDefinitions/${roleGuid}`,
      },
    };
  }

  const VAULT_RESOURCE_ID =
    '/subscriptions/sub-1/resourceGroups/vault-rg/providers/Microsoft.KeyVault/vaults/myvault';

  beforeEach(() => {
    mockGetToken = vi.fn().mockResolvedValue('fake-arm-token');
    mockArmRequest = vi.fn();
    mockArmClientFactory = vi.fn().mockReturnValue({
      getToken: mockGetToken,
      request: mockArmRequest,
    }) as KeyVaultArmClientFactory & ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /* ------------------------------------------------------------------ */
  /*  Parsing errors                                                    */
  /* ------------------------------------------------------------------ */

  it('should throw KeyVaultAccessError for invalid secretIdentifier', async () => {
    await expect(
      checkKeyVaultSecretAccess(
        'not-a-url', undefined, apimContext,
        mockArmClientFactory,
      ),
    ).rejects.toMatchObject({
      name: 'KeyVaultAccessError',
      message: expect.stringContaining('Invalid Key Vault secretIdentifier'),
    });
  });

  it('should throw KeyVaultAccessError when secretIdentifier is missing the secret name', async () => {
    await expect(
      checkKeyVaultSecretAccess(
        'https://myvault.vault.azure.net/', undefined, apimContext,
        mockArmClientFactory,
      ),
    ).rejects.toMatchObject({
      name: 'KeyVaultAccessError',
      message: expect.stringContaining('Invalid Key Vault secretIdentifier'),
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Token acquisition failure                                         */
  /* ------------------------------------------------------------------ */

  it('should return without error when ARM token cannot be acquired', async () => {
    mockGetToken.mockRejectedValueOnce(new Error('No credential available'));

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).resolves.toBeUndefined();

    expect(mockArmRequest).not.toHaveBeenCalled();
  });

  it('should warn and skip when the ARM client cannot be created', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const factory = vi.fn<KeyVaultArmClientFactory>(() => {
      throw new Error('Invalid AZURE_CLIENT_ID');
    });

    await expect(
      checkKeyVaultSecretAccess(validSecretIdentifier, undefined, apimContext, factory),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      'Unable to acquire ARM token — skipping Key Vault pre-flight check. (Error: Invalid AZURE_CLIENT_ID)',
    );
    warnSpy.mockRestore();
  });

  /* ------------------------------------------------------------------ */
  /*  APIM identity resolution                                          */
  /* ------------------------------------------------------------------ */

  it('should throw when APIM service has no identity', async () => {
    mockArmRequest.mockResolvedValueOnce(armResponse(200, { /* no identity */ }));

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).rejects.toMatchObject({
      name: 'KeyVaultAccessError',
      message: expect.stringContaining('no managed identity configured'),
    });
  });

  it('should throw when system-assigned identity has no principalId', async () => {
    mockArmRequest.mockResolvedValueOnce(
      armResponse(200, { identity: { type: 'SystemAssigned' } }),
    );

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).rejects.toMatchObject({
      name: 'KeyVaultAccessError',
      message: expect.stringContaining('no system-assigned managed identity'),
    });
  });

  it('should throw when user-assigned identity clientId is not on APIM', async () => {
    mockArmRequest.mockResolvedValueOnce(
      armResponse(200, apimWithUserIdentity('other-client-id', 'other-principal')),
    );

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, 'missing-client-id', apimContext,
        mockArmClientFactory,
      ),
    ).rejects.toMatchObject({
      name: 'KeyVaultAccessError',
      message: expect.stringContaining("clientId 'missing-client-id'"),
    });
  });

  it('should skip when APIM service fetch fails (non-200)', async () => {
    mockArmRequest.mockResolvedValueOnce(armResponse(403, {}));

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).resolves.toBeUndefined();
  });

  it('should skip when APIM service fetch throws', async () => {
    mockArmRequest.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).resolves.toBeUndefined();
  });

  /* ------------------------------------------------------------------ */
  /*  Vault lookup                                                      */
  /* ------------------------------------------------------------------ */

  it('should skip when vault is not found in subscription', async () => {
    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, { value: [] }));

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).resolves.toBeUndefined();
  });

  it('should skip when vault list request fails', async () => {
    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockRejectedValueOnce(new Error('Network error'));

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).resolves.toBeUndefined();
  });

  it('should skip when vault GET returns non-200', async () => {
    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(404, {}));

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).resolves.toBeUndefined();
  });

  /* ------------------------------------------------------------------ */
  /*  RBAC mode                                                         */
  /* ------------------------------------------------------------------ */

  it('should succeed when RBAC Key Vault Secrets User role is assigned', async () => {
    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithRbac()))
      // Role assignments
      .mockResolvedValueOnce(
        armResponse(200, { value: [roleAssignment('4633458b-17de-408a-b874-0445c86b69e6')] }),
      );

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).resolves.toBeUndefined();
  });

  it('should succeed when RBAC Key Vault Administrator role is assigned', async () => {
    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithRbac()))
      .mockResolvedValueOnce(
        armResponse(200, { value: [roleAssignment('00482a5a-887f-4fb3-b363-3b7fe8e74483')] }),
      );

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).resolves.toBeUndefined();
  });

  it('should throw when RBAC shows zero role assignments for the principal', async () => {
    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithRbac()))
      .mockResolvedValueOnce(armResponse(200, { value: [] }));

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).rejects.toMatchObject({
      name: 'KeyVaultAccessError',
      message: expect.stringContaining('no RBAC role assignments'),
    });
  });

  it('should log access as confirmed only when an RBAC role grants it', async () => {
    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithRbac()))
      .mockResolvedValueOnce(
        armResponse(200, { value: [roleAssignment('4633458b-17de-408a-b874-0445c86b69e6')] }),
      );

    await checkKeyVaultSecretAccess(
      validSecretIdentifier, undefined, apimContext,
      mockArmClientFactory,
    );

    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('Key Vault access confirmed'));
  });

  it('should not log access as confirmed when the RBAC check is skipped', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithRbac()))
      .mockResolvedValueOnce(armResponse(403, { error: { code: 'AuthorizationFailed' } }));

    await checkKeyVaultSecretAccess(
      validSecretIdentifier, undefined, apimContext,
      mockArmClientFactory,
    );

    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to list role assignments (HTTP 403) — skipping RBAC pre-flight check for 'myvault'.",
    );
    expect(debugSpy).not.toHaveBeenCalledWith(expect.stringContaining('Key Vault access confirmed'));
  });

  it('should succeed when custom role has getSecret dataAction (slow path)', async () => {
    const customRoleGuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithRbac()))
      // Role assignments — unknown GUID triggers slow path
      .mockResolvedValueOnce(
        armResponse(200, { value: [roleAssignment(customRoleGuid)] }),
      )
      // Role definition GET — has the required dataAction
      .mockResolvedValueOnce(
        armResponse(200, {
          properties: {
            permissions: [{
              dataActions: ['Microsoft.KeyVault/vaults/secrets/getSecret/action'],
            }],
          },
        }),
      );

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).resolves.toBeUndefined();
  });

  it('should succeed when custom role has wildcard dataAction', async () => {
    const customRoleGuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithRbac()))
      .mockResolvedValueOnce(
        armResponse(200, { value: [roleAssignment(customRoleGuid)] }),
      )
      .mockResolvedValueOnce(
        armResponse(200, {
          properties: {
            permissions: [{
              dataActions: ['Microsoft.KeyVault/vaults/secrets/*'],
            }],
          },
        }),
      );

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).resolves.toBeUndefined();
  });

  it('should throw when custom role dataActions do not include secret get', async () => {
    const customRoleGuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithRbac()))
      .mockResolvedValueOnce(
        armResponse(200, { value: [roleAssignment(customRoleGuid)] }),
      )
      .mockResolvedValueOnce(
        armResponse(200, {
          properties: {
            permissions: [{
              dataActions: ['Microsoft.KeyVault/vaults/secrets/setSecret/action'],
            }],
          },
        }),
      );

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).rejects.toMatchObject({
      name: 'KeyVaultAccessError',
      message: expect.stringContaining('data-action'),
    });
  });

  it('should throw when custom role has getSecret but notDataActions denies it', async () => {
    const customRoleGuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithRbac()))
      .mockResolvedValueOnce(
        armResponse(200, { value: [roleAssignment(customRoleGuid)] }),
      )
      .mockResolvedValueOnce(
        armResponse(200, {
          properties: {
            permissions: [{
              dataActions: ['Microsoft.KeyVault/vaults/secrets/getSecret/action'],
              notDataActions: ['Microsoft.KeyVault/vaults/secrets/getSecret/action'],
            }],
          },
        }),
      );

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).rejects.toMatchObject({
      name: 'KeyVaultAccessError',
    });
  });

  it('should throw when the only custom role definition cannot be read', async () => {
    const customRoleGuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithRbac()))
      .mockResolvedValueOnce(
        armResponse(200, { value: [roleAssignment(customRoleGuid)] }),
      )
      .mockResolvedValueOnce(armResponse(403, { error: { code: 'AuthorizationFailed' } }));

    // An unreadable role definition is skipped, so no role is left to grant access.
    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).rejects.toMatchObject({
      name: 'KeyVaultAccessError',
      message: expect.stringContaining('data-action'),
    });
  });

  it('should skip an unreadable role definition and confirm access from the next one', async () => {
    const unreadableRoleGuid = 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee';
    const grantingRoleGuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);

    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithRbac()))
      .mockResolvedValueOnce(
        armResponse(200, {
          value: [roleAssignment(unreadableRoleGuid), roleAssignment(grantingRoleGuid)],
        }),
      )
      .mockResolvedValueOnce(armResponse(403, { error: { code: 'AuthorizationFailed' } }))
      .mockResolvedValueOnce(
        armResponse(200, {
          properties: {
            permissions: [{
              dataActions: ['Microsoft.KeyVault/vaults/secrets/getSecret/action'],
            }],
          },
        }),
      );

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).resolves.toBeUndefined();
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('Key Vault access confirmed'));
  });

  it('should skip RBAC check when role assignments fetch fails', async () => {
    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithRbac()))
      .mockRejectedValueOnce(new Error('Network error'));

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).resolves.toBeUndefined();
  });

  /* ------------------------------------------------------------------ */
  /*  Access-policy mode                                                */
  /* ------------------------------------------------------------------ */

  it('should succeed when access policy grants secret GET', async () => {
    const policies = [{
      objectId: 'principal-1',
      permissions: { secrets: ['get', 'list'] },
    }];

    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithAccessPolicies(policies)));

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).resolves.toBeUndefined();
  });

  it('should succeed when access policy grants "all" secrets permission', async () => {
    const policies = [{
      objectId: 'principal-1',
      permissions: { secrets: ['all'] },
    }];

    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithAccessPolicies(policies)));

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).resolves.toBeUndefined();
  });

  it('should throw when no access policy matches the principal', async () => {
    const policies = [{
      objectId: 'other-principal',
      permissions: { secrets: ['get'] },
    }];

    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithAccessPolicies(policies)));

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).rejects.toMatchObject({
      name: 'KeyVaultAccessError',
      message: expect.stringContaining("does not have an access policy"),
    });
  });

  it('should throw when the vault has no access policies', async () => {
    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, { properties: { enableRbacAuthorization: false } }));

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).rejects.toMatchObject({
      name: 'KeyVaultAccessError',
      message: expect.stringContaining("does not have an access policy"),
    });
  });

  it('should throw when access policy exists but lacks secret GET', async () => {
    const policies = [{
      objectId: 'principal-1',
      permissions: { secrets: ['list'] },
    }];

    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithAccessPolicies(policies)));

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockArmClientFactory,
      ),
    ).rejects.toMatchObject({
      name: 'KeyVaultAccessError',
      message: expect.stringContaining("does not have an access policy"),
    });
  });

  it('should log access as confirmed when the principal\'s own access policy grants secret GET', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    const policies = [
      { objectId: 'other-principal', permissions: { secrets: ['list'] } },
      { objectId: 'PRINCIPAL-1', permissions: { secrets: ['List', 'Get'] } },
    ];

    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithAccessPolicies(policies)));

    await checkKeyVaultSecretAccess(
      validSecretIdentifier, undefined, apimContext,
      mockArmClientFactory,
    );

    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('Key Vault access confirmed'));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  /* ------------------------------------------------------------------ */
  /*  User-assigned identity                                            */
  /* ------------------------------------------------------------------ */

  it('should resolve user-assigned identity and check RBAC', async () => {
    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithUserIdentity('ua-client', 'ua-principal')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithRbac()))
      .mockResolvedValueOnce(
        armResponse(200, { value: [roleAssignment('4633458b-17de-408a-b874-0445c86b69e6')] }),
      );

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, 'ua-client', apimContext,
        mockArmClientFactory,
      ),
    ).resolves.toBeUndefined();

    // The role-assignment query should filter by ua-principal
    const roleAssignmentUrl = mockArmRequest.mock.calls[3][0] as string;
    expect(roleAssignmentUrl).toContain('ua-principal');
  });

  /* ------------------------------------------------------------------ */
  /*  Versioned secret identifier                                       */
  /* ------------------------------------------------------------------ */

  it('should handle secretIdentifier with a version segment', async () => {
    mockArmRequest
      .mockResolvedValueOnce(armResponse(200, apimWithSystemIdentity('principal-1')))
      .mockResolvedValueOnce(armResponse(200, vaultListResponse(VAULT_RESOURCE_ID)))
      .mockResolvedValueOnce(armResponse(200, vaultWithRbac()))
      .mockResolvedValueOnce(
        armResponse(200, { value: [roleAssignment('4633458b-17de-408a-b874-0445c86b69e6')] }),
      );

    await expect(
      checkKeyVaultSecretAccess(
        'https://myvault.vault.azure.net/secrets/my-secret/abc123version',
        undefined,
        apimContext,
        mockArmClientFactory,
      ),
    ).resolves.toBeUndefined();
  });
});

describe('checkKeyVaultSecretAccess in sovereign clouds', () => {
  const VAULT_RESOURCE_ID =
    '/subscriptions/sub-1/resourceGroups/vault-rg/providers/Microsoft.KeyVault/vaults/myvault';
  const CUSTOM_ROLE_DEFINITION_ID =
    '/subscriptions/sub-1/providers/Microsoft.Authorization/roleDefinitions/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  function armResponse(status: number, body: unknown) {
    return { status, json: () => Promise.resolve(body) };
  }

  const clouds = [
    {
      name: 'usgov',
      armBaseUrl: 'https://management.usgovcloudapi.net',
      authScope: 'https://management.usgovcloudapi.net/.default',
      secretIdentifier: 'https://myvault.vault.usgovcloudapi.net/secrets/my-secret',
    },
    {
      name: 'china',
      armBaseUrl: 'https://management.chinacloudapi.cn',
      authScope: 'https://management.chinacloudapi.cn/.default',
      secretIdentifier: 'https://myvault.vault.azure.cn/secrets/my-secret',
    },
  ];

  it.each(clouds)(
    'should use the $name ARM scope and endpoint for every request',
    async ({ armBaseUrl, authScope, secretIdentifier }) => {
      const getToken = vi.fn().mockResolvedValue('fake-arm-token');
      const armRequest = vi.fn()
        .mockResolvedValueOnce(armResponse(200, {
          identity: { type: 'SystemAssigned', principalId: 'principal-1' },
        }))
        .mockResolvedValueOnce(armResponse(200, { value: [{ id: VAULT_RESOURCE_ID }] }))
        .mockResolvedValueOnce(armResponse(200, { properties: { enableRbacAuthorization: true } }))
        // Unknown role GUID forces the role-definition GET (slow path)
        .mockResolvedValueOnce(armResponse(200, {
          value: [{ properties: { roleDefinitionId: CUSTOM_ROLE_DEFINITION_ID } }],
        }))
        .mockResolvedValueOnce(armResponse(200, {
          properties: {
            permissions: [{ dataActions: ['Microsoft.KeyVault/vaults/secrets/getSecret/action'] }],
          },
        }));
      const armClientFactory = vi.fn(() => ({ getToken, request: armRequest }));

      await expect(
        checkKeyVaultSecretAccess(
          secretIdentifier,
          undefined,
          {
            subscriptionId: 'sub-1',
            resourceGroup: 'rg-1',
            serviceName: 'apim-1',
            armBaseUrl,
            authScope,
          },
          armClientFactory,
        ),
      ).resolves.toBeUndefined();

      expect(armClientFactory).toHaveBeenCalledWith(authScope);
      expect(getToken).toHaveBeenCalled();

      const urls = armRequest.mock.calls.map((call) => call[0] as string);
      expect(urls).toHaveLength(5);
      for (const url of urls) {
        expect(new URL(url).origin).toBe(armBaseUrl);
      }
      expect(urls[0]).toContain(
        '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1?',
      );
      expect(urls[1]).toContain('/subscriptions/sub-1/resources?');
      expect(urls[2]).toContain(`${armBaseUrl}${VAULT_RESOURCE_ID}?`);
      expect(urls[3]).toContain(
        `${armBaseUrl}${VAULT_RESOURCE_ID}/providers/Microsoft.Authorization/roleAssignments?`,
      );
      expect(urls[4]).toContain(`${armBaseUrl}${CUSTOM_ROLE_DEFINITION_ID}?`);
    },
  );

  it.each([
    'https://myvault.vault.usgovcloudapi.net/secrets/my-secret/abc123version',
    'https://myvault.vault.azure.cn/secrets/my-secret',
    'https://myvault.vault.microsoftazure.de/secrets/my-secret',
  ])('should parse the vault name from sovereign-cloud secret URI %s', async (secretIdentifier) => {
    const armRequest = vi.fn()
      .mockResolvedValueOnce(armResponse(200, {
        identity: { type: 'SystemAssigned', principalId: 'principal-1' },
      }))
      // Vault not found → soft-skip after the lookup, which carries the parsed name
      .mockResolvedValueOnce(armResponse(200, { value: [] }));

    await expect(
      checkKeyVaultSecretAccess(
        secretIdentifier,
        undefined,
        {
          subscriptionId: 'sub-1',
          resourceGroup: 'rg-1',
          serviceName: 'apim-1',
          armBaseUrl: 'https://management.usgovcloudapi.net',
          authScope: 'https://management.usgovcloudapi.net/.default',
        },
        () => ({ getToken: vi.fn().mockResolvedValue('fake-arm-token'), request: armRequest }),
      ),
    ).resolves.toBeUndefined();

    const vaultSearchUrl = armRequest.mock.calls[1][0] as string;
    expect(decodeURIComponent(vaultSearchUrl)).toContain("name eq 'myvault'");
  });
});

describe('checkKeyVaultSecretAccess through ArmHttpClient', () => {
  const apimContextForUserAgentTest: KeyVaultCheckContext = {
    subscriptionId: 'sub-1',
    resourceGroup: 'rg-1',
    serviceName: 'apim-1',
    armBaseUrl: 'https://management.azure.com',
    authScope: 'https://management.azure.com/.default',
  };
  let fetchSpy: ReturnType<typeof vi.fn>;
  let getToken: Mock<ArmTokenCredential['getToken']>;
  let delays: number[];

  /** Real ArmHttpClient with a stub credential and instant retry delays. */
  function armHttpClientFactory(authScope: string): ArmHttpClient {
    return new ArmHttpClient({
      authScope,
      credential: { getToken },
      delay: async (ms) => {
        delays.push(ms);
      },
    });
  }

  function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  }

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    getToken = vi.fn<ArmTokenCredential['getToken']>().mockResolvedValue({
      token: 'fake-arm-token',
      expiresOnTimestamp: Date.now() + 3600_000,
    });
    delays = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const VAULT_ID = '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.KeyVault/vaults/myvault';
  it('should request the token for the cloud scope and send it as a bearer token', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, {}));

    await expect(
      checkKeyVaultSecretAccess(
        'https://myvault.vault.usgovcloudapi.net/secrets/my-secret',
        undefined,
        {
          ...apimContextForUserAgentTest,
          armBaseUrl: 'https://management.usgovcloudapi.net',
          authScope: 'https://management.usgovcloudapi.net/.default',
        },
        armHttpClientFactory,
      ),
    ).rejects.toMatchObject({ name: 'KeyVaultAccessError' });

    expect(getToken).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledWith('https://management.usgovcloudapi.net/.default');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).origin).toBe('https://management.usgovcloudapi.net');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer fake-arm-token');
    expect(headers.get('Accept')).toBe('application/json');
  });

  it('should warn and skip when an ARM call fails with a client error, without retrying', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    fetchSpy.mockResolvedValueOnce(jsonResponse(403, { error: { code: 'AuthorizationFailed' } }));

    await expect(
      checkKeyVaultSecretAccess(
        'https://myvault.vault.azure.net/secrets/my-secret',
        undefined,
        apimContextForUserAgentTest,
        armHttpClientFactory,
      ),
    ).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to fetch APIM service (HTTP 403) — skipping Key Vault pre-flight check.',
    );
  });

  it('should warn and skip when an ARM call keeps failing with a server error', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(200, { identity: { type: 'SystemAssigned', principalId: 'pid-1' } }))
      .mockImplementation(async () => new Response('down', { status: 503 }));

    await expect(
      checkKeyVaultSecretAccess(
        'https://myvault.vault.azure.net/secrets/my-secret',
        undefined,
        apimContextForUserAgentTest,
        armHttpClientFactory,
      ),
    ).resolves.toBeUndefined();

    // 1 APIM GET + 4 attempts at the vault search
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to search for Key Vault 'myvault' (HTTP 503) — skipping pre-flight check.",
    );
  });

  it('should cancel the unread body of a 404 it skips the check for', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const cancel = vi.fn();
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(200, { identity: { type: 'SystemAssigned', principalId: 'pid-1' } }))
      .mockResolvedValueOnce(jsonResponse(200, { value: [{ id: VAULT_ID }] }))
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 404 }));

    await expect(
      checkKeyVaultSecretAccess(
        'https://myvault.vault.azure.net/secrets/my-secret',
        undefined,
        apimContextForUserAgentTest,
        armHttpClientFactory,
      ),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to read Key Vault 'myvault' (HTTP 404) — skipping pre-flight check.",
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('checkKeyVaultSecretAccess with the default ARM client', () => {
  // The default factory keeps its clients for the whole run (module), so each
  // test uses auth scopes of its own.
  function context(authScope: string): KeyVaultCheckContext {
    return {
      subscriptionId: 'sub-1',
      resourceGroup: 'rg-1',
      serviceName: 'apim-1',
      armBaseUrl: 'https://management.azure.com',
      authScope,
    };
  }

  beforeEach(() => {
    identityMock.constructed = 0;
    identityMock.getToken.mockReset();
    identityMock.getToken.mockImplementation(async () => ({
      token: 'fake-arm-token',
      expiresOnTimestamp: Date.now() + 60 * 60 * 1000,
    }));
    // Every check stops at the APIM service GET (404) and skips.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should reuse one client and its token for checks with the same auth scope', async () => {
    const ctx = context('https://reuse.example/.default');

    await checkKeyVaultSecretAccess('https://v1.vault.azure.net/secrets/s1', undefined, ctx);
    await checkKeyVaultSecretAccess('https://v2.vault.azure.net/secrets/s2', undefined, ctx);

    expect(identityMock.constructed).toBe(1);
    expect(identityMock.getToken).toHaveBeenCalledTimes(1);
    expect(identityMock.getToken).toHaveBeenCalledWith('https://reuse.example/.default');
  });
});
