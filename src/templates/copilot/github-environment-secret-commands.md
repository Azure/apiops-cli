# {{ENV}} environment secrets
gh secret set AZURE_SUBSCRIPTION_ID --body "${AZURE_SUBSCRIPTION_ID_{{ENV_UPPER}}}" --env {{ENV}}
gh secret set APIM_RESOURCE_GROUP_{{ENV_UPPER}} --body "${APIM_RG_{{ENV_UPPER}}}" --env {{ENV}}
gh secret set APIM_SERVICE_NAME_{{ENV_UPPER}} --body "${APIM_NAME_{{ENV_UPPER}}}" --env {{ENV}}
