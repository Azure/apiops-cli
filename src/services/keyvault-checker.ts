/**
 * Key Vault access pre-flight check for KeyVault-backed NamedValues.
 *
 * Validates that the APIM service's managed identity has been granted access
 * to the Key Vault secret. Uses Azure ARM APIs to:
 *   1. Retrieve the APIM service identity (system- or user-assigned)
 *   2. Locate the Key Vault resource in the subscription
 *   3. Check RBAC role assignments or access policies
 *
 * This check is best-effort when infrastructure queries fail (ARM token,
 * vault in another subscription, etc.) — a warning is logged and the check
 * is skipped. Hard errors are raised only for definitive misconfigurations
 * such as "APIM has no managed identity" or "no matching RBAC / access policy".
 */

import { DefaultAzureCredential } from '@azure/identity';
import { logger } from '../lib/logger.js';
import { USER_AGENT } from '../lib/user-agent.js';

/* ------------------------------------------------------------------ */
/*  ARM API versions                                                  */
/* ------------------------------------------------------------------ */
const APIM_API_VERSION = '2024-05-01';
const RESOURCES_API_VERSION = '2021-04-01';
const KEYVAULT_API_VERSION = '2023-07-01';
const AUTHZ_API_VERSION = '2022-04-01';

/** ARM management scope */
const ARM_SCOPE = 'https://management.azure.com/.default';

/**
 * Well-known Azure RBAC role-definition GUIDs that grant
 * the `Microsoft.KeyVault/vaults/secrets/getSecret/action` data-action.
 * Used only as a fast-path optimisation — if none match we still resolve
 * each role definition to inspect its dataActions.
 */
const SECRET_GET_ROLE_IDS = new Set([
  '4633458b-17de-408a-b874-0445c86b69e6', // Key Vault Secrets User
  'b86a8fe4-44ce-4948-aee5-eccb2c155cd7', // Key Vault Secrets Officer
  '00482a5a-887f-4fb3-b363-3b7fe8e74483', // Key Vault Administrator
]);

/* ------------------------------------------------------------------ */
/*  Public types                                                      */
/* ------------------------------------------------------------------ */

/**
 * Error thrown when the APIM managed identity clearly lacks access to
 * Key Vault, or the APIM service is missing the required identity
 * configuration. Signals that the publish should fail immediately.
 */
export class KeyVaultAccessError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'KeyVaultAccessError';
  }
}

/** APIM service context needed by the ARM-based check. */
export interface KeyVaultCheckContext {
  subscriptionId: string;
  resourceGroup: string;
  serviceName: string;
}

/** Minimal response shape from an ARM HTTP call. */
export interface ArmResponse {
  status: number;
  json(): Promise<unknown>;
}

/** Injectable ARM HTTP call — production uses `fetch`, tests supply a stub. */
export type ArmRequestFn = (url: string, token: string) => Promise<ArmResponse>;

/** Provides ARM bearer tokens. */
export interface TokenProvider {
  getToken(scopes: string | string[]): Promise<{ token: string }>;
}

/** Factory for creating token providers (injectable for testing). */
export type TokenProviderFactory = () => TokenProvider;

/* ------------------------------------------------------------------ */
/*  Default production implementations                                */
/* ------------------------------------------------------------------ */

function defaultTokenProviderFactory(): TokenProvider {
  return new DefaultAzureCredential();
}

async function defaultArmRequest(url: string, token: string): Promise<ArmResponse> {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  headers.set('User-Agent', USER_AGENT);
  const response = await fetch(url, { headers });
  return {
    status: response.status,
    json: () => response.json() as Promise<unknown>,
  };
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * Verify that the APIM service's managed identity has access to the
 * specified Key Vault secret via ARM RBAC or access policies.
 *
 * @param secretIdentifier  Full Key Vault secret URI, e.g.
 *   `https://myvault.vault.azure.net/secrets/my-secret[/version]`
 * @param identityClientId  Client ID of the user-assigned managed identity
 *   that APIM will use. Omit for system-assigned identity.
 * @param apimContext  Subscription / resource-group / service-name of the
 *   APIM instance.
 * @param tokenProviderFactory  (testing) Override the ARM credential.
 * @param armRequest  (testing) Override the HTTP call.
 */
export async function checkKeyVaultSecretAccess(
  secretIdentifier: string,
  identityClientId: string | undefined,
  apimContext: KeyVaultCheckContext,
  tokenProviderFactory: TokenProviderFactory = defaultTokenProviderFactory,
  armRequest: ArmRequestFn = defaultArmRequest,
): Promise<void> {
  /* ---- 1. Parse vault name & secret name from the URI ---- */
  let vaultName: string;
  let secretName: string;

  try {
    const url = new URL(secretIdentifier);
    vaultName = url.hostname.split('.')[0];
    const segments = url.pathname.split('/').filter(Boolean);
    secretName = segments[1] ?? '';
    if (!secretName) throw new Error('Missing secret name in path');
    if (!vaultName) throw new Error('Missing vault name in host');
  } catch (error) {
    throw new KeyVaultAccessError(
      `Invalid Key Vault secretIdentifier: '${secretIdentifier}'`,
      { cause: error },
    );
  }

  /* ---- 2. Acquire ARM token ---- */
  const credential = tokenProviderFactory();
  let token: string;
  try {
    token = (await credential.getToken(ARM_SCOPE)).token;
  } catch (error) {
    logger.warn(
      `Unable to acquire ARM token — skipping Key Vault pre-flight check. ` +
      `(Error: ${(error as Error).message})`,
    );
    return;
  }

  /* ---- 3. Get APIM service identity ---- */
  const { principalId, identityLabel } = await resolveApimPrincipal(
    apimContext,
    identityClientId,
    token,
    armRequest,
  );
  if (!principalId) return; // soft-skip — warning already logged

  logger.debug(
    `Pre-flight: APIM ${identityLabel} principalId = ${principalId}`,
  );

  /* ---- 4. Locate the vault in the same subscription ---- */
  const vault = await findVaultInSubscription(
    apimContext.subscriptionId,
    vaultName,
    token,
    armRequest,
  );
  if (!vault) return; // soft-skip — warning already logged

  /* ---- 5. Check RBAC or access-policy permissions ---- */
  const vaultProps = (vault.json as Record<string, unknown>)
    .properties as Record<string, unknown>;

  if (vaultProps?.enableRbacAuthorization === true) {
    await checkRbacAccess(
      vault.resourceId,
      principalId,
      identityLabel,
      vaultName,
      secretName,
      token,
      armRequest,
    );
  } else {
    checkAccessPolicies(
      vaultProps,
      principalId,
      identityLabel,
      vaultName,
      secretName,
    );
  }

  logger.debug(
    `Key Vault access confirmed for APIM ${identityLabel} ` +
    `on secret '${secretName}' in vault '${vaultName}'`,
  );
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Resolve the APIM managed-identity principal ID via the ARM service resource.
 *
 * Returns `{ principalId, identityLabel }` on success.
 * Throws `KeyVaultAccessError` when APIM has no identity or the specified
 * user-assigned identity is not found.
 * Returns `{ principalId: undefined }` when the ARM call itself fails
 * (warns and degrades gracefully).
 */
async function resolveApimPrincipal(
  ctx: KeyVaultCheckContext,
  identityClientId: string | undefined,
  token: string,
  armRequest: ArmRequestFn,
): Promise<{ principalId: string | undefined; identityLabel: string }> {
  const identityLabel = identityClientId
    ? `user-assigned identity '${identityClientId}'`
    : 'system-assigned identity';

  const apimUrl =
    `https://management.azure.com/subscriptions/${ctx.subscriptionId}` +
    `/resourceGroups/${ctx.resourceGroup}` +
    `/providers/Microsoft.ApiManagement/service/${ctx.serviceName}` +
    `?api-version=${APIM_API_VERSION}`;

  let apimJson: Record<string, unknown>;
  try {
    const resp = await armRequest(apimUrl, token);
    if (resp.status !== 200) {
      logger.warn(
        `Failed to fetch APIM service (HTTP ${resp.status}) — ` +
        `skipping Key Vault pre-flight check.`,
      );
      return { principalId: undefined, identityLabel };
    }
    apimJson = (await resp.json()) as Record<string, unknown>;
  } catch (error) {
    logger.warn(
      `Failed to fetch APIM service — skipping Key Vault pre-flight check. ` +
      `(Error: ${(error as Error).message})`,
    );
    return { principalId: undefined, identityLabel };
  }

  const identity = apimJson.identity as Record<string, unknown> | undefined;

  if (!identity) {
    throw new KeyVaultAccessError(
      `APIM service '${ctx.serviceName}' has no managed identity configured. ` +
      `KeyVault-backed NamedValues require a managed identity to access secrets.`,
    );
  }

  let principalId: string | undefined;

  if (identityClientId) {
    // User-assigned: find the matching clientId in userAssignedIdentities
    const uaMap = identity.userAssignedIdentities as
      | Record<string, { principalId?: string; clientId?: string }>
      | undefined;
    if (uaMap) {
      for (const entry of Object.values(uaMap)) {
        if (entry.clientId === identityClientId) {
          principalId = entry.principalId;
          break;
        }
      }
    }
    if (!principalId) {
      throw new KeyVaultAccessError(
        `User-assigned managed identity with clientId '${identityClientId}' ` +
        `not found on APIM service '${ctx.serviceName}'.`,
      );
    }
  } else {
    principalId = identity.principalId as string | undefined;
    if (!principalId) {
      throw new KeyVaultAccessError(
        `APIM service '${ctx.serviceName}' has no system-assigned managed ` +
        `identity enabled. KeyVault-backed NamedValues require a managed identity.`,
      );
    }
  }

  return { principalId, identityLabel };
}

/**
 * Search for a Key Vault resource in the given subscription by vault name.
 * Returns the vault's resource ID and its full JSON, or `undefined` when the
 * vault is not found (e.g. it lives in a different subscription).
 */
async function findVaultInSubscription(
  subscriptionId: string,
  vaultName: string,
  token: string,
  armRequest: ArmRequestFn,
): Promise<{ resourceId: string; json: unknown } | undefined> {
  const filter = encodeURIComponent(
    `resourceType eq 'Microsoft.KeyVault/vaults' and name eq '${vaultName}'`,
  );
  const listUrl =
    `https://management.azure.com/subscriptions/${subscriptionId}` +
    `/resources?$filter=${filter}&api-version=${RESOURCES_API_VERSION}`;

  let vaultResourceId: string | undefined;
  try {
    const resp = await armRequest(listUrl, token);
    if (resp.status !== 200) {
      logger.warn(
        `Failed to search for Key Vault '${vaultName}' (HTTP ${resp.status}) — ` +
        `skipping pre-flight check.`,
      );
      return undefined;
    }
    const body = (await resp.json()) as { value?: Array<{ id: string }> };
    vaultResourceId = body.value?.[0]?.id;
  } catch (error) {
    logger.warn(
      `Failed to search for Key Vault '${vaultName}' — skipping pre-flight check. ` +
      `(Error: ${(error as Error).message})`,
    );
    return undefined;
  }

  if (!vaultResourceId) {
    logger.warn(
      `Key Vault '${vaultName}' not found in subscription '${subscriptionId}'. ` +
      `It may be in a different subscription — skipping pre-flight access check.`,
    );
    return undefined;
  }

  // GET the vault resource to read properties (RBAC mode, access policies)
  const vaultUrl =
    `https://management.azure.com${vaultResourceId}` +
    `?api-version=${KEYVAULT_API_VERSION}`;

  try {
    const resp = await armRequest(vaultUrl, token);
    if (resp.status !== 200) {
      logger.warn(
        `Failed to read Key Vault '${vaultName}' (HTTP ${resp.status}) — ` +
        `skipping pre-flight check.`,
      );
      return undefined;
    }
    const json = await resp.json();
    return { resourceId: vaultResourceId, json };
  } catch (error) {
    logger.warn(
      `Failed to read Key Vault '${vaultName}' — skipping pre-flight check. ` +
      `(Error: ${(error as Error).message})`,
    );
    return undefined;
  }
}

/** The data-action that grants secret read access in Key Vault RBAC. */
const SECRET_GET_DATA_ACTION = 'microsoft.keyvault/vaults/secrets/getsecret/action';

/** Wildcard patterns that also grant the secret-get data-action. */
const SECRET_GET_WILDCARDS = [
  'microsoft.keyvault/vaults/secrets/*',
  'microsoft.keyvault/vaults/*',
  'microsoft.keyvault/*',
  '*',
];

/**
 * RBAC-mode check: list role assignments on the vault for the given principal.
 * Throws `KeyVaultAccessError` when no assignments exist at all, or when
 * none of the assigned roles grant the secret-get data-action.
 *
 * Strategy (fast-path first):
 *   1. Check if any assignment matches a well-known role GUID — skip role
 *      definition resolution if so.
 *   2. Otherwise, GET each role definition and inspect its `permissions[].dataActions`
 *      for the `Microsoft.KeyVault/vaults/secrets/getSecret/action` data-action.
 */
async function checkRbacAccess(
  vaultResourceId: string,
  principalId: string,
  identityLabel: string,
  vaultName: string,
  secretName: string,
  token: string,
  armRequest: ArmRequestFn,
): Promise<void> {
  const filter = encodeURIComponent(`principalId eq '${principalId}'`);
  const url =
    `https://management.azure.com${vaultResourceId}` +
    `/providers/Microsoft.Authorization/roleAssignments` +
    `?$filter=${filter}&api-version=${AUTHZ_API_VERSION}`;

  let assignments: Array<Record<string, unknown>>;
  try {
    const resp = await armRequest(url, token);
    if (resp.status !== 200) {
      logger.warn(
        `Failed to list role assignments (HTTP ${resp.status}) — ` +
        `skipping RBAC pre-flight check for '${vaultName}'.`,
      );
      return;
    }
    const body = (await resp.json()) as {
      value?: Array<Record<string, unknown>>;
    };
    assignments = body.value ?? [];
  } catch (error) {
    logger.warn(
      `Failed to list role assignments — skipping RBAC pre-flight check. ` +
      `(Error: ${(error as Error).message})`,
    );
    return;
  }

  if (assignments.length === 0) {
    throw new KeyVaultAccessError(
      `APIM ${identityLabel} (principalId: ${principalId}) has no RBAC role ` +
      `assignments on Key Vault '${vaultName}'. ` +
      `Grant the identity 'Key Vault Secrets User' role on the vault ` +
      `so APIM can read secret '${secretName}'.`,
    );
  }

  // --- Fast path: match well-known role GUIDs ---
  const hasKnownRole = assignments.some((a) => {
    const roleDefId = (
      (a.properties as Record<string, unknown>)?.roleDefinitionId as string
    ) ?? '';
    const roleGuid = roleDefId.split('/').pop()?.toLowerCase() ?? '';
    return SECRET_GET_ROLE_IDS.has(roleGuid);
  });

  if (hasKnownRole) {
    return; // confirmed — no need to resolve definitions
  }

  // --- Slow path: resolve each role definition and check dataActions ---
  logger.debug(
    `No well-known secret role found; resolving ${assignments.length} role ` +
    `definition(s) to check dataActions.`,
  );

  for (const assignment of assignments) {
    const roleDefId = (
      (assignment.properties as Record<string, unknown>)?.roleDefinitionId as string
    ) ?? '';
    if (!roleDefId) continue;

    const hasAccess = await roleDefinitionGrantsSecretGet(
      roleDefId, token, armRequest,
    );
    if (hasAccess) return; // confirmed via dataActions
  }

  throw new KeyVaultAccessError(
    `APIM ${identityLabel} (principalId: ${principalId}) has ` +
    `${assignments.length} RBAC role assignment(s) on Key Vault '${vaultName}', ` +
    `but none grant the '${SECRET_GET_DATA_ACTION}' data-action. ` +
    `Grant the identity 'Key Vault Secrets User' role on the vault ` +
    `so APIM can read secret '${secretName}'.`,
  );
}

/**
 * GET a role definition by its full ARM ID and check whether any of its
 * `permissions[].dataActions` grant the secret-get data-action.
 *
 * Returns `undefined` (rather than `false`) when the definition cannot be
 * fetched — the caller should treat this as inconclusive and keep checking.
 */
async function roleDefinitionGrantsSecretGet(
  roleDefinitionId: string,
  token: string,
  armRequest: ArmRequestFn,
): Promise<boolean | undefined> {
  const url =
    `https://management.azure.com${roleDefinitionId}` +
    `?api-version=${AUTHZ_API_VERSION}`;

  let json: Record<string, unknown>;
  try {
    const resp = await armRequest(url, token);
    if (resp.status !== 200) {
      logger.debug(
        `Failed to fetch role definition (HTTP ${resp.status}): ${roleDefinitionId}`,
      );
      return undefined;
    }
    json = (await resp.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const props = json.properties as Record<string, unknown> | undefined;
  const permissions = (props?.permissions ?? []) as Array<Record<string, unknown>>;

  for (const perm of permissions) {
    const dataActions = (perm.dataActions ?? []) as string[];
    const hasAction = dataActions.some((da) => {
      const lower = da.toLowerCase();
      return lower === SECRET_GET_DATA_ACTION ||
        SECRET_GET_WILDCARDS.includes(lower);
    });
    if (hasAction) {
      // Also check notDataActions don't deny it
      const notDataActions = (perm.notDataActions ?? []) as string[];
      const denied = notDataActions.some((nda) => {
        const lower = nda.toLowerCase();
        return lower === SECRET_GET_DATA_ACTION ||
          SECRET_GET_WILDCARDS.includes(lower);
      });
      if (!denied) return true;
    }
  }

  return false;
}

/**
 * Access-policy mode check: scan the vault's `accessPolicies` array for the
 * APIM principal with `secrets.get` permission.
 * Throws `KeyVaultAccessError` when no matching policy is found.
 */
function checkAccessPolicies(
  vaultProperties: Record<string, unknown>,
  principalId: string,
  identityLabel: string,
  vaultName: string,
  secretName: string,
): void {
  const policies =
    (vaultProperties?.accessPolicies as Array<Record<string, unknown>>) ?? [];

  const match = policies.find((p) => {
    if ((p.objectId as string)?.toLowerCase() !== principalId.toLowerCase()) {
      return false;
    }
    const perms = p.permissions as Record<string, unknown> | undefined;
    const secretPerms = (perms?.secrets as string[]) ?? [];
    return secretPerms.some(
      (s) => s.toLowerCase() === 'get' || s.toLowerCase() === 'all',
    );
  });

  if (!match) {
    throw new KeyVaultAccessError(
      `APIM ${identityLabel} (principalId: ${principalId}) does not have an ` +
      `access policy with 'get' secret permission on Key Vault '${vaultName}'. ` +
      `Add an access policy granting 'get' on secrets for the identity, ` +
      `or enable RBAC authorization and assign 'Key Vault Secrets User'. ` +
      `Secret: '${secretName}'.`,
    );
  }
}
