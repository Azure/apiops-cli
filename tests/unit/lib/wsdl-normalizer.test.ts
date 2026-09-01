// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for the WSDL normalizer
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeWsdl,
  normalizeWsdlPartReferences,
  normalizeWsdlServicePorts,
} from '../../../src/lib/wsdl-normalizer.js';

/** Reproduces APIM's broken WSDL export: parts reference tns instead of ns1. */
function buildBrokenWsdl(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
    xmlns:tns="https://example.org/service/v1"
    targetNamespace="https://example.org/service/v1"
    xmlns:ns1="https://example.org/messages/v1">
    <wsdl:types>
        <xs:schema targetNamespace="https://example.org/common/v1"
            xmlns:xs="http://www.w3.org/2001/XMLSchema">
            <xs:complexType name="RequestContextType">
                <xs:sequence>
                    <xs:element name="correlationId" type="xs:string" />
                </xs:sequence>
            </xs:complexType>
        </xs:schema>
        <xs:schema targetNamespace="https://example.org/messages/v1"
            xmlns:xs="http://www.w3.org/2001/XMLSchema">
            <xs:import namespace="https://example.org/common/v1" />
            <xs:element name="GetCustomerRequest">
                <xs:complexType>
                    <xs:sequence>
                        <xs:element name="customerId" type="xs:string" />
                    </xs:sequence>
                </xs:complexType>
            </xs:element>
            <xs:element name="GetCustomerResponse">
                <xs:complexType>
                    <xs:sequence>
                        <xs:element name="status" type="xs:string" />
                    </xs:sequence>
                </xs:complexType>
            </xs:element>
        </xs:schema>
    </wsdl:types>
    <wsdl:message name="GetCustomer_InputMessage">
        <wsdl:part name="parameters" element="tns:GetCustomerRequest" />
    </wsdl:message>
    <wsdl:message name="GetCustomer_OutputMessage">
        <wsdl:part name="parameters" element="tns:GetCustomerResponse" />
    </wsdl:message>
</wsdl:definitions>`;
}

describe('normalizeWsdlPartReferences', () => {
  it('rewrites part references to the schema namespace that declares the element', () => {
    const result = normalizeWsdlPartReferences(buildBrokenWsdl());

    expect(result).toContain('element="ns1:GetCustomerRequest"');
    expect(result).toContain('element="ns1:GetCustomerResponse"');
    expect(result).not.toContain('element="tns:GetCustomerRequest"');
  });

  it('leaves already-correct references untouched', () => {
    const correct = buildBrokenWsdl()
      .replace('element="tns:GetCustomerRequest"', 'element="ns1:GetCustomerRequest"')
      .replace('element="tns:GetCustomerResponse"', 'element="ns1:GetCustomerResponse"');

    expect(normalizeWsdlPartReferences(correct)).toBe(correct);
  });

  it('adds a namespace declaration when no root prefix exists for the schema namespace', () => {
    const noPrefix = buildBrokenWsdl().replace(
      ' xmlns:ns1="https://example.org/messages/v1"',
      ''
    );

    const result = normalizeWsdlPartReferences(noPrefix);

    expect(result).toContain('xmlns:apiopsns0="https://example.org/messages/v1"');
    expect(result).toContain('element="apiopsns0:GetCustomerRequest"');
  });

  it('does not rewrite references to elements declared in multiple schemas', () => {
    const ambiguous = buildBrokenWsdl().replace(
      '<xs:complexType name="RequestContextType">',
      `<xs:element name="GetCustomerRequest">
                <xs:complexType />
            </xs:element>
            <xs:complexType name="RequestContextType">`
    );

    const result = normalizeWsdlPartReferences(ambiguous);

    expect(result).toContain('element="tns:GetCustomerRequest"');
  });

  it('does not rewrite references with prefixes not declared at the root', () => {
    const undeclared = buildBrokenWsdl().replace(
      'element="tns:GetCustomerRequest"',
      'element="mystery:GetCustomerRequest"'
    );

    const result = normalizeWsdlPartReferences(undeclared);

    expect(result).toContain('element="mystery:GetCustomerRequest"');
  });

  it('ignores nested local element declarations when resolving', () => {
    // "customerId" is only a local element inside a complexType — a part
    // referencing it must not be rewritten to the messages namespace.
    const localRef = buildBrokenWsdl().replace(
      'element="tns:GetCustomerRequest"',
      'element="tns:customerId"'
    );

    const result = normalizeWsdlPartReferences(localRef);

    expect(result).toContain('element="tns:customerId"');
  });

  it('returns non-WSDL content unchanged', () => {
    const openapi = '{"openapi":"3.0.1","info":{"title":"x"}}';
    expect(normalizeWsdlPartReferences(openapi)).toBe(openapi);
  });
});

describe('normalizeWsdlServicePorts', () => {
  const multiPortService = `<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/">
    <wsdl:service name="Svc">
        <wsdl:port name="Svc-1" binding="tns:Svc">
            <address location="https://gw-one.example.com/x" xmlns="http://schemas.xmlsoap.org/wsdl/soap/" />
        </wsdl:port>
        <wsdl:port name="Svc-2" binding="tns:Svc">
            <address location="https://gw-two.example.com/x" xmlns="http://schemas.xmlsoap.org/wsdl/soap/" />
        </wsdl:port>
    </wsdl:service>
</wsdl:definitions>`;

  it('keeps only the first port when a service has multiple ports', () => {
    const result = normalizeWsdlServicePorts(multiPortService);

    expect(result).toContain('name="Svc-1"');
    expect(result).not.toContain('name="Svc-2"');
    expect(result).toContain('gw-one.example.com');
    expect(result).not.toContain('gw-two.example.com');
  });

  it('leaves a single-port service unchanged', () => {
    const single = multiPortService.replace(
      /\s*<wsdl:port name="Svc-2"[\s\S]*?<\/wsdl:port>/,
      ''
    );

    expect(normalizeWsdlServicePorts(single)).toBe(single);
  });
});

describe('normalizeWsdl', () => {
  it('applies both part-reference and service-port normalizations', () => {
    const broken = buildBrokenWsdl().replace(
      '</wsdl:definitions>',
      `<wsdl:service name="Svc">
        <wsdl:port name="P1" binding="tns:B"><address location="https://a/x" /></wsdl:port>
        <wsdl:port name="P2" binding="tns:B"><address location="https://b/x" /></wsdl:port>
    </wsdl:service>\n</wsdl:definitions>`
    );

    const result = normalizeWsdl(broken);

    expect(result).toContain('element="ns1:GetCustomerRequest"');
    expect(result).not.toContain('name="P2"');
  });
});
