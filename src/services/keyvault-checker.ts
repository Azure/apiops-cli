// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Key Vault access pre-flight check for KeyVault-backed NamedValues.
 *
 * Validates that the APIM service's managed identity has been granted access
 * to the Key Vault secret. Uses Azure ARM APIs to:
 *   1. Retrieve the APIM service identity (system- or user-assigned)
 *   2. Locate the Key Vault resource in the subscription
 *   3. Check RBAC role assignments or access policies
 *
 * ARM calls go through the shared ArmHttpClient (retry on 429/5xx/network
 * errors). This check is best-effort when infrastructure queries fail (ARM
 * token, vault in another subscription, etc.) — a warning is logged and the
 * check is skipped. Hard errors are raised only for definitive
 * misconfigurations such as "APIM has no managed identity" or "no matching
 * RBAC / access policy".
 */

import { logger } from '../lib/logger.js';
import { errorMessage } from '../lib/error-message.js';
import { ArmHttpClient, HttpError, discardBody } from '../clients/arm-http-client.js';
import type { IArmHttpClient } from '../clients/iarm-http-client.js';

/* ------------------------------------------------------------------ */
/*  ARM API versions                                                  */
/* ------------------------------------------------------------------ */
const APIM_API_VERSION = '2024-05-01';
const RESOURCES_API_VERSION = '2021-04-01';
const KEYVAULT_API_VERSION = '2023-07-01';
const AUTHZ_API_VERSION = '2022-04-01';

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
  /**
   * ARM base URL of the target cloud, without a trailing slash
   * (e.g. `https://management.usgovcloudapi.net`).
   */
  armBaseUrl: string;
  /** OAuth2 scope for ARM token requests in the target cloud. */
  authScope: string;
}

/** Creates the ARM client for the target cloud's auth scope (injectable for testing). */
export type KeyVaultArmClientFactory = (authScope: string) => IArmHttpClient;

/** Minimal response shape from an ARM HTTP call. */
interface ArmResponse {
  status: number;
  json(): Promise<unknown>;
}

/* ------------------------------------------------------------------ */
/*  Default production implementations                                */
/* ------------------------------------------------------------------ */

/**
 * ARM clients created by the default factory, one per auth scope, so every
 * Key Vault check in a run shares a credential and its cached token.
 */
const defaultArmClients = new Map<string, IArmHttpClient>();

function defaultArmClientFactory(authScope: string): IArmHttpClient {
  let client = defaultArmClients.get(authScope);
  if (!client) {
    client = new ArmHttpClient({ authScope });
    defaultArmClients.set(authScope, client);
  }
  return client;
}

/**
 * GET an ARM URL. Non-OK responses (thrown by the client as `HttpError`
 * once retries are exhausted) are returned as their status so callers can
 * warn and skip; other errors (e.g. network failures) are thrown. Callers
 * read the body only of a 200, so any other returned response (e.g. the 404
 * the client passes through for GET) has its body released here.
 */
async function armGet(armClient: IArmHttpClient, url: string): Promise<ArmResponse> {
  try {
    const response = await armClient.request(url, { headers: { Accept: 'application/json' } });
    if (response.status !== 200) {
      await discardBody(response);
      return withoutBody(response.status);
    }
    return { status: response.status, json: () => response.json() as Promise<unknown> };
  } catch (error) {
    if (error instanceof HttpError) {
      return withoutBody(error.status);
    }
    throw error;
  }
}

/** A non-200 result: callers read the body only of a 200, so it has none. */
function withoutBody(status: number): ArmResponse {
  return { status, json: () => Promise.resolve(undefined) };
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * Verify that the APIM service's managed identity has access to the
 * specified Key Vault secret via ARM RBAC or access policies.
 *
 * @param secretIdentifier  Full Key Vault secret URI, e.g.
 *   `https://myvault.vault.azure.net/secrets/my-secret[/version]`.
 *   Only the first host label (the vault name) is used, so sovereign-cloud
 *   vault suffixes (e.g. `vault.usgovcloudapi.net`) are accepted.
 * @param identityClientId  Client ID of the user-assigned managed identity
 *   that APIM will use. Omit for system-assigned identity.
 * @param apimContext  Subscription / resource-group / service-name of the
 *   APIM instance, plus the ARM base URL and auth scope of its cloud.
 * @param armClientFactory  (testing) Override the ARM client, created with
 *   `apimContext.authScope`. The default reuses one client per auth scope.
 */
export async function checkKeyVaultSecretAccess(
  secretIdentifier: string,
  identityClientId: string | undefined,
  apimContext: KeyVaultCheckContext,
  armClientFactory: KeyVaultArmClientFactory = defaultArmClientFactory,
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
  let armClient: IArmHttpClient;
  try {
    // Created and fetched up front so a missing or misconfigured credential
    // skips the check with one clear warning; the client caches the token
    // for the requests below.
    armClient = armClientFactory(apimContext.authScope);
    await armClient.getToken();
  } catch (error) {
    logger.warn(
      `Unable to acquire ARM token — skipping Key Vault pre-flight check. ` +
      `(Error: ${errorMessage(error)})`,
    );
    return;
  }

  /* ---- 3. Get APIM service identity ---- */
  const { principalId, identityLabel } = await resolveApimPrincipal(
    apimContext,
    identityClientId,
    armClient,
  );
  if (!principalId) return; // soft-skip — warning already logged

  logger.debug(
    `Pre-flight: APIM ${identityLabel} principalId = ${principalId}`,
  );

  /* ---- 4. Locate the vault in the same subscription ---- */
  const vault = await findVaultInSubscription(
    apimContext.armBaseUrl,
    apimContext.subscriptionId,
    vaultName,
    armClient,
  );
  if (!vault) return; // soft-skip — warning already logged

  /* ---- 5. Check RBAC or access-policy permissions ---- */
  const vaultProps = (vault.json as Record<string, unknown>)
    .properties as Record<string, unknown>;

  if (vaultProps?.enableRbacAuthorization === true) {
    const confirmed = await checkRbacAccess(
      apimContext.armBaseUrl,
      vault.resourceId,
      principalId,
      identityLabel,
      vaultName,
      secretName,
      armClient,
    );
    if (!confirmed) return; // soft-skip — warning already logged
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
  armClient: IArmHttpClient,
): Promise<{ principalId: string | undefined; identityLabel: string }> {
  const identityLabel = identityClientId
    ? `user-assigned identity '${identityClientId}'`
    : 'system-assigned identity';

  const apimUrl =
    `${ctx.armBaseUrl}/subscriptions/${ctx.subscriptionId}` +
    `/resourceGroups/${ctx.resourceGroup}` +
    `/providers/Microsoft.ApiManagement/service/${ctx.serviceName}` +
    `?api-version=${APIM_API_VERSION}`;

  let apimJson: Record<string, unknown>;
  try {
    const resp = await armGet(armClient, apimUrl);
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
      `(Error: ${errorMessage(error)})`,
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
  armBaseUrl: string,
  subscriptionId: string,
  vaultName: string,
  armClient: IArmHttpClient,
): Promise<{ resourceId: string; json: unknown } | undefined> {
  const filter = encodeURIComponent(
    `resourceType eq 'Microsoft.KeyVault/vaults' and name eq '${vaultName}'`,
  );
  const listUrl =
    `${armBaseUrl}/subscriptions/${subscriptionId}` +
    `/resources?$filter=${filter}&api-version=${RESOURCES_API_VERSION}`;

  let vaultResourceId: string | undefined;
  try {
    const resp = await armGet(armClient, listUrl);
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
      `(Error: ${errorMessage(error)})`,
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
    `${armBaseUrl}${vaultResourceId}` +
    `?api-version=${KEYVAULT_API_VERSION}`;

  try {
    const resp = await armGet(armClient, vaultUrl);
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
      `(Error: ${errorMessage(error)})`,
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
 * Returns true when access is confirmed, false when the role assignments
 * could not be listed and the check was skipped (a warning has been logged).
 *
 * Strategy (fast-path first):
 *   1. Check if any assignment matches a well-known role GUID — skip role
 *      definition resolution if so.
 *   2. Otherwise, GET each role definition and inspect its `permissions[].dataActions`
 *      for the `Microsoft.KeyVault/vaults/secrets/getSecret/action` data-action.
 */
async function checkRbacAccess(
  armBaseUrl: string,
  vaultResourceId: string,
  principalId: string,
  identityLabel: string,
  vaultName: string,
  secretName: string,
  armClient: IArmHttpClient,
): Promise<boolean> {
  const filter = encodeURIComponent(`principalId eq '${principalId}'`);
  const url =
    `${armBaseUrl}${vaultResourceId}` +
    `/providers/Microsoft.Authorization/roleAssignments` +
    `?$filter=${filter}&api-version=${AUTHZ_API_VERSION}`;

  let assignments: Array<Record<string, unknown>>;
  try {
    const resp = await armGet(armClient, url);
    if (resp.status !== 200) {
      logger.warn(
        `Failed to list role assignments (HTTP ${resp.status}) — ` +
        `skipping RBAC pre-flight check for '${vaultName}'.`,
      );
      return false;
    }
    const body = (await resp.json()) as {
      value?: Array<Record<string, unknown>>;
    };
    assignments = body.value ?? [];
  } catch (error) {
    logger.warn(
      `Failed to list role assignments — skipping RBAC pre-flight check. ` +
      `(Error: ${errorMessage(error)})`,
    );
    return false;
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
    return true; // confirmed — no need to resolve definitions
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
      armBaseUrl, roleDefId, armClient,
    );
    if (hasAccess) return true; // confirmed via dataActions
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
  armBaseUrl: string,
  roleDefinitionId: string,
  armClient: IArmHttpClient,
): Promise<boolean | undefined> {
  const url =
    `${armBaseUrl}${roleDefinitionId}` +
    `?api-version=${AUTHZ_API_VERSION}`;

  let json: Record<string, unknown>;
  try {
    const resp = await armGet(armClient, url);
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
