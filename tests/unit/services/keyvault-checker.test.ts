/**
 * Unit tests for keyvault-checker service (ARM-based approach)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkKeyVaultSecretAccess,
  type TokenProviderFactory,
  type KeyVaultCheckContext,
} from '../../../src/services/keyvault-checker.js';
import { USER_AGENT } from '../../../src/lib/user-agent.js';

describe('checkKeyVaultSecretAccess', () => {
  let mockGetToken: ReturnType<typeof vi.fn>;
  let mockTokenProviderFactory: TokenProviderFactory;
  let mockArmRequest: ReturnType<typeof vi.fn>;

  const validSecretIdentifier = 'https://myvault.vault.azure.net/secrets/my-secret';

  const apimContext: KeyVaultCheckContext = {
    subscriptionId: 'sub-1',
    resourceGroup: 'rg-1',
    serviceName: 'apim-1',
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
    mockGetToken = vi.fn().mockResolvedValue({ token: 'fake-arm-token' });
    mockTokenProviderFactory = vi.fn().mockReturnValue({ getToken: mockGetToken });
    mockArmRequest = vi.fn();
  });

  /* ------------------------------------------------------------------ */
  /*  Parsing errors                                                    */
  /* ------------------------------------------------------------------ */

  it('should throw KeyVaultAccessError for invalid secretIdentifier', async () => {
    await expect(
      checkKeyVaultSecretAccess(
        'not-a-url', undefined, apimContext,
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
      ),
    ).resolves.toBeUndefined();

    expect(mockArmRequest).not.toHaveBeenCalled();
  });

  /* ------------------------------------------------------------------ */
  /*  APIM identity resolution                                          */
  /* ------------------------------------------------------------------ */

  it('should throw when APIM service has no identity', async () => {
    mockArmRequest.mockResolvedValueOnce(armResponse(200, { /* no identity */ }));

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
      ),
    ).resolves.toBeUndefined();
  });

  it('should skip when APIM service fetch throws', async () => {
    mockArmRequest.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      checkKeyVaultSecretAccess(
        validSecretIdentifier, undefined, apimContext,
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
      ),
    ).rejects.toMatchObject({
      name: 'KeyVaultAccessError',
      message: expect.stringContaining('no RBAC role assignments'),
    });
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
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
      ),
    ).rejects.toMatchObject({
      name: 'KeyVaultAccessError',
    });
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
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory, mockArmRequest,
      ),
    ).rejects.toMatchObject({
      name: 'KeyVaultAccessError',
      message: expect.stringContaining("does not have an access policy"),
    });
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
        mockTokenProviderFactory, mockArmRequest,
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
        mockTokenProviderFactory,
        mockArmRequest,
      ),
    ).resolves.toBeUndefined();
  });
});

describe('defaultArmRequest User-Agent header', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should include User-Agent header when defaultArmRequest is used', async () => {
    // Arrange: mock all ARM responses so checkKeyVaultSecretAccess runs to completion
    const apimIdentity = {
      identity: { type: 'SystemAssigned', principalId: 'pid-1' },
    };
    const vaultList = { value: [{ id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.KeyVault/vaults/myvault' }] };
    const vaultDetail = {
      properties: {
        enableRbacAuthorization: false,
        accessPolicies: [
          {
            objectId: 'pid-1',
            permissions: { secrets: ['get'] },
          },
        ],
      },
    };

    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify(apimIdentity), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(vaultList), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(vaultDetail), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const mockTokenProviderFactory: TokenProviderFactory = () => ({
      getToken: vi.fn().mockResolvedValue({ token: 'fake-arm-token' }),
    });

    await checkKeyVaultSecretAccess(
      'https://myvault.vault.azure.net/secrets/my-secret',
      undefined,
      { subscriptionId: 'sub-1', resourceGroup: 'rg-1', serviceName: 'apim-1' },
      mockTokenProviderFactory,
      // No armRequest override — uses defaultArmRequest which must include User-Agent
    );

    // All three fetch calls should include the User-Agent header
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(0);
    for (const call of fetchSpy.mock.calls) {
      const [_url, init] = call as [string, RequestInit];
      const headers = new Headers(init?.headers);
      expect(headers.get('User-Agent')).toBe(USER_AGENT);
    }
  });
});
