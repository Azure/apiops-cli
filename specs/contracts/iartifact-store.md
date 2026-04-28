# Contract: IArtifactStore

**Purpose**: Abstraction over the local filesystem for reading/writing APIM artifact files. Enables unit testing without filesystem I/O and contract testing to verify directory layout correctness.

---

## Interface Definition

```typescript
interface IArtifactStore {
  /**
   * Write a resource's JSON payload to the artifact directory.
   * Creates parent directories as needed.
   * File path is derived from the descriptor using standard naming conventions.
   */
  writeResource(
    baseDir: string,
    descriptor: ResourceDescriptor,
    json: Record<string, unknown>
  ): Promise<void>;

  /**
   * Write raw content (policy XML, API specification) to a file.
   * Path is derived from descriptor + content type.
   */
  writeContent(
    baseDir: string,
    descriptor: ResourceDescriptor,
    content: string,
    contentType: 'policy' | 'specification',
    format?: string  // e.g., 'yaml', 'json', 'graphql', 'wsdl', 'wadl'
  ): Promise<void>;

  /**
   * Write an association file (e.g., product → apis.json, product → groups.json).
   */
  writeAssociation(
    baseDir: string,
    descriptor: ResourceDescriptor,
    associationType: 'apis' | 'groups',
    names: string[]
  ): Promise<void>;

  /**
   * Read a resource's JSON payload from the artifact directory.
   * Returns undefined if the file doesn't exist.
   */
  readResource(
    baseDir: string,
    descriptor: ResourceDescriptor
  ): Promise<Record<string, unknown> | undefined>;

  /**
   * Read raw content (policy XML, API specification) from a file.
   * Returns undefined if the file doesn't exist.
   */
  readContent(
    baseDir: string,
    descriptor: ResourceDescriptor,
    contentType: 'policy' | 'specification'
  ): Promise<{ content: string; format?: string } | undefined>;

  /**
   * Read an association file.
   * Returns empty array if file doesn't exist.
   */
  readAssociation(
    baseDir: string,
    descriptor: ResourceDescriptor,
    associationType: 'apis' | 'groups'
  ): Promise<string[]>;

  /**
   * List all resource descriptors found in the artifact directory.
   * Walks the directory tree and parses paths back into descriptors.
   */
  listResources(
    baseDir: string
  ): Promise<ResourceDescriptor[]>;

  /**
   * Delete a resource's artifacts (info file + associated content files).
   */
  deleteResource(
    baseDir: string,
    descriptor: ResourceDescriptor
  ): Promise<void>;
}
```

---

## Path Mapping Contract

The artifact store maps between `ResourceDescriptor` and filesystem paths using these rules:

| ResourceType | Directory Pattern | Info File |
|-------------|------------------|-----------|
| `NamedValue` | `{base}/namedValues/{name}/` | `namedValueInformation.json` |
| `Tag` | `{base}/tags/{name}/` | `tagInformation.json` |
| `Api` | `{base}/apis/{name}/` | `apiInformation.json` |
| `Api` (revision) | `{base}/apis/{rootName};rev={N}/` | `apiInformation.json` |
| `Product` | `{base}/products/{name}/` | `productInformation.json` |
| `ServicePolicy` | `{base}/` | `policy.xml` |
| `ApiOperation` | `{base}/apis/{apiName}/operations/{opName}/` | — |
| (workspace) | `{base}/workspaces/{ws}/{type path}` | (same as above) |

See [data-model.md](data-model.md) ResourceType table for complete mapping.

**Invariants**:
- `writeResource(base, desc, json)` followed by `readResource(base, desc)` returns deep-equal JSON
- `listResources(base)` returns a descriptor for every resource previously written
- Directory separators are normalized to OS-native (path.join)
- File encoding: UTF-8 without BOM
