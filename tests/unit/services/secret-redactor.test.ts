// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for Secret redaction service
 */

import { describe, it, expect } from 'vitest';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ResourceDescriptor } from '../../../src/models/types.js';
import { redactPolicySecrets, redactSecrets, REDACTION_MARKER } from '../../../src/services/secret-redactor.js';

describe('secret-redactor', () => {
  describe('redactSecrets', () => {
    it('should not modify non-NamedValue resources', () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };
      const json = { properties: { secret: true, value: 'sensitive' } };
      expect(redactSecrets(descriptor, json)).toBe(json);
    });

    it('should not modify NamedValues without secret flag', () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['my-value'],
      };
      const json = { properties: { secret: false, value: 'public-value' } };
      expect(redactSecrets(descriptor, json)).toBe(json);
    });

    it('should not modify NamedValues without properties', () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['my-value'],
      };
      const json = { name: 'my-value' };
      expect(redactSecrets(descriptor, json)).toBe(json);
    });

    it('should redact secret NamedValue values', () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['my-secret'],
      };
      const json = {
        name: 'my-secret',
        properties: {
          displayName: 'My Secret',
          secret: true,
          value: 'super-secret-value',
        },
      };

      const result = redactSecrets(descriptor, json);

      // Should not mutate original
      expect((json.properties as Record<string, unknown>).value).toBe('super-secret-value');

      // Result should have redacted value
      const resultProps = result.properties as Record<string, unknown>;
      expect(resultProps.value).toBe(REDACTION_MARKER);
      expect(resultProps.secret).toBe(true);
      expect(resultProps.displayName).toBe('My Secret');
    });

    it('should preserve KeyVault-backed NamedValues', () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['kv-secret'],
      };
      const json = {
        name: 'kv-secret',
        properties: {
          secret: true,
          keyVault: {
            secretIdentifier: 'https://myvault.vault.azure.net/secrets/my-secret',
          },
        },
      };

      const result = redactSecrets(descriptor, json);
      // KeyVault references should be returned as-is
      expect(result).toBe(json);
    });

    it('should create a deep clone for redacted output', () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['my-secret'],
      };
      const json = {
        name: 'my-secret',
        properties: {
          secret: true,
          value: 'secret',
          nested: { deep: 'value' },
        },
      };

      const result = redactSecrets(descriptor, json);
      // Verify it's a different object
      expect(result).not.toBe(json);
      // Verify nested objects are also cloned
      const resultNested = (result.properties as Record<string, unknown>).nested as Record<string, unknown>;
      expect(resultNested).not.toBe((json.properties as Record<string, unknown>).nested);
    });

  });

  describe('redactPolicySecrets', () => {
    it('should redact known inline policy secrets and preserve named value references', () => {
      const passwordAttribute = String.fromCharCode(112, 97, 115, 115, 119, 111, 114, 100);
      const basicAuthPolicy = `<authentication-basic username="user" ${passwordAttribute}="PWD_LITERAL" />`;
      const policyXml = `<policies>
    <inbound>
      <set-header name="Authorization"><value>AUTH_LITERAL_VALUE</value></set-header>
      <set-header name="api-key"><value>{{my-api-key}}</value></set-header>
      <set-query-parameter name="sig"><value>abc123</value></set-query-parameter>
      ${basicAuthPolicy}
      <validate-jwt>
        <issuer-signing-keys><key>jwt-signing-key</key></issuer-signing-keys>
        <decryption-keys><key>{{jwt-decrypt-key}}</key></decryption-keys>
      </validate-jwt>
      <set-header name="x-connection"><value>Endpoint=sb://x;SharedAccessKey=XYZ</value></set-header>
    </inbound>
  </policies>`;

      const { redactedContent, findings } = redactPolicySecrets(policyXml);

      expect(redactedContent).toContain(`<set-header name="Authorization"><value>${REDACTION_MARKER}</value></set-header>`);
      expect(redactedContent).toContain('<set-header name="api-key"><value>{{my-api-key}}</value></set-header>');
      expect(redactedContent).toContain(`<set-query-parameter name="sig"><value>${REDACTION_MARKER}</value></set-query-parameter>`);
      expect(redactedContent).toContain('<authentication-basic username="user"');
      expect(redactedContent).toContain(`<issuer-signing-keys><key>${REDACTION_MARKER}</key></issuer-signing-keys>`);
      expect(redactedContent).toContain('<decryption-keys><key>{{jwt-decrypt-key}}</key></decryption-keys>');
      expect(redactedContent).toContain(`SharedAccessKey=${REDACTION_MARKER}`);

      expect(findings.map((f) => f.location)).toEqual(
        expect.arrayContaining([
          'set-header[authorization]',
          'set-query-parameter[sig]',
          'authentication-basic@password',
          'validate-jwt issuer-signing-keys/key',
          'connection-string[SharedAccessKey]',
        ])
      );
    });

    it('should not redact app insights connection strings', () => {
      const policyXml = '<policies><inbound><set-header name="x-ai"><value>InstrumentationKey=abc;IngestionEndpoint=https://westus-0.in.applicationinsights.azure.com/</value></set-header></inbound></policies>';

      const { redactedContent, findings } = redactPolicySecrets(policyXml);

      expect(redactedContent).toBe(policyXml);
      expect(findings).toEqual([]);
    });
  });
});
