/**
 * Offline schema resource registry: loads the committed catalog and schema
 * documents, verifies `$id`/catalog consistency, registers all resources with a
 * per-instance Ajv Draft 2020-12 validator, and compiles them under standard
 * `$id`-based resolution. No network, path-based identity, or shared global state.
 */
import AjvModule from 'ajv/dist/2020.js';
import { SCHEMA_CATALOG, SCHEMA_DOCUMENTS } from '../generated/schema-bundle.js';

/** Minimal structural surface of the Draft 2020-12 validator used by the registry. */
export interface SchemaErrorLike {
  readonly keyword: string;
  readonly instancePath: string;
  readonly message?: string;
}
interface ValidatorLike {
  (data: unknown): boolean;
  readonly errors?: readonly SchemaErrorLike[] | null;
}
interface AjvLike {
  addSchema(schema: object, key: string): void;
  getSchema(key: string): ValidatorLike | undefined;
  validateSchema(schema: object): boolean;
  readonly errors?: readonly SchemaErrorLike[] | null;
}

export interface CatalogEntry {
  readonly schema_id: string;
  readonly path: string;
  readonly profile: string;
  readonly version: string;
  readonly subject_type: string;
  readonly dependencies: readonly string[];
  readonly normative_status: string;
}

export class SchemaRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaRegistryError';
  }
}

export class SchemaRegistry {
  private readonly ajv: AjvLike;
  private readonly byId: ReadonlyMap<string, CatalogEntry>;
  private readonly schemaIds: readonly string[];

  constructor() {
    const catalog = SCHEMA_CATALOG as unknown as { schema_resources: CatalogEntry[] };
    const byId = new Map<string, CatalogEntry>();
    const ids = new Set<string>();
    for (const entry of catalog.schema_resources) {
      if (ids.has(entry.schema_id)) throw new SchemaRegistryError(`duplicate catalog schema_id: ${entry.schema_id}`);
      ids.add(entry.schema_id);
      byId.set(entry.schema_id, entry);
      const doc = SCHEMA_DOCUMENTS[entry.schema_id];
      if (doc === undefined) throw new SchemaRegistryError(`missing schema document for ${entry.schema_id}`);
      const model = doc as { $id?: string; $schema?: string };
      if (model.$id !== entry.schema_id) {
        throw new SchemaRegistryError(`$id mismatch for ${entry.schema_id}`);
      }
      if (model.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
        throw new SchemaRegistryError(`non-Draft-2020-12 schema: ${entry.schema_id}`);
      }
    }
    this.byId = byId;
    this.schemaIds = Object.freeze([...ids].sort());

    const ctor = AjvModule as unknown as new (opts?: Record<string, unknown>) => AjvLike;
    this.ajv = new ctor({
      allErrors: true,
      strict: false, // schemas are reviewed artifacts; strictness is enforced by our own catalog/ref audits
      validateFormats: false, // `format` is annotation-only per WP-3
      allowUnionTypes: false,
      validateSchema: true,
      loadSchema: () => {
        throw new SchemaRegistryError('network schema retrieval is prohibited');
      },
    });
    for (const id of this.schemaIds) {
      if (!this.ajv.validateSchema(SCHEMA_DOCUMENTS[id] as object)) {
        throw new SchemaRegistryError(`schema fails Draft 2020-12 meta-validation: ${id}`);
      }
      this.ajv.addSchema(SCHEMA_DOCUMENTS[id] as object, id);
    }
    // Eagerly compile every resource so resolution failures surface at construction.
    for (const id of this.schemaIds) {
      const validator = this.ajv.getSchema(id);
      if (!validator) throw new SchemaRegistryError(`schema failed to compile under standard resolution: ${id}`);
    }
  }

  get schemaIdsList(): readonly string[] {
    return this.schemaIds;
  }

  has(schemaId: string): boolean {
    return this.byId.has(schemaId);
  }

  entry(schemaId: string): CatalogEntry | undefined {
    return this.byId.get(schemaId);
  }

  /** Validate an instance against a cataloged schema. Returns structured errors. */
  validate(schemaId: string, instance: unknown): { valid: boolean; errors: readonly SchemaErrorLike[] } {
    const validator = this.ajv.getSchema(schemaId);
    if (!validator) throw new SchemaRegistryError(`unknown schema: ${schemaId}`);
    const valid = validator(instance) as boolean;
    return { valid, errors: validator.errors ?? [] };
  }

  /** Map validator errors to a deterministic structural-failure message set. */
  static describeErrors(errors: readonly SchemaErrorLike[]): readonly { keyword: string; pointer: string; message: string }[] {
    return errors.map((e) => ({
      keyword: e.keyword,
      pointer: e.instancePath,
      message: e.message ?? 'schema constraint failed',
    }));
  }
}
