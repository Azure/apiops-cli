# Contract: IApimClient

**Purpose**: Abstraction over Azure APIM REST API calls. Enables unit testing with mocked responses and contract testing against recorded HTTP fixtures.

---

## Interface Definition

```typescript
interface IApimClient {
  /**
   * List all resources of a given type. Handles ARM pagination (nextLink).
   * Returns an async iterable of raw JSON objects from the `value` array.
   */
  listResources(
    context: ApimServiceContext,
    type: ResourceType,
    parent?: ResourceDescriptor
  ): AsyncIterable<Record<string, unknown>>;

  /**
   * Get a single resource by descriptor.
   * Returns the raw JSON response body, or undefined if 404.
   */
  getResource(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor
  ): Promise<Record<string, unknown> | undefined>;

  /**
   * Create or update a resource (PUT).
   * Returns the response JSON body.
   * Polls provisioningState for long-running operations.
   */
  putResource(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>>;

  /**
   * Delete a resource (DELETE).
   * Returns true if deleted, false if already absent (404).
   * Polls provisioningState for long-running operations.
   */
  deleteResource(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor
  ): Promise<boolean>;

  /**
   * List API revisions for a given API.
   * Returns an async iterable of revision metadata objects.
   */
  listApiRevisions(
    context: ApimServiceContext,
    apiName: string
  ): AsyncIterable<Record<string, unknown>>;

  /**
   * Get the API specification (OpenAPI/GraphQL/WSDL/WADL) content.
   * Returns the raw content string and detected format.
   */
  getApiSpecification(
    context: ApimServiceContext,
    apiName: string
  ): Promise<{ content: string; format: 'yaml' | 'json' | 'graphql' | 'wsdl' | 'wadl' } | undefined>;
}
```

---

## Behavioral Contract

| Method | Input | Success | Not Found | Error |
|--------|-------|---------|-----------|-------|
| `listResources` | Valid type + optional parent | Yields 0+ JSON objects | Empty iterable | Throws on 5xx, retries on 429 |
| `getResource` | Valid descriptor | Returns JSON | Returns `undefined` | Throws on 5xx |
| `putResource` | Valid descriptor + payload | Returns response JSON | N/A (PUT creates) | Throws on 4xx/5xx |
| `deleteResource` | Valid descriptor | Returns `true` | Returns `false` | Throws on 5xx |
| `listApiRevisions` | API name | Yields 0+ revision objects | Empty iterable | Throws on 5xx |
| `getApiSpecification` | API name | Returns content + format | Returns `undefined` | Throws on 5xx |

**Retry behavior**: All methods retry on HTTP 429 (respecting `Retry-After`) and 5xx (exponential backoff, max 3 retries).

**Concurrency**: Implementations must be safe for concurrent calls from different resource type extractors.
