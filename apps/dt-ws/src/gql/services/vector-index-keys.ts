/**
 * Vector index keys as Memgraph reports them, and a rebuild that restores an index to its key.
 *
 * Memgraph 3.8.1 can recover a label+property vector index from a snapshot under a different label or
 * property than the one it was created on. Writes to the intended label and property then never reach
 * the index, and nodes of the reported label and property do. Later Memgraph releases recover the key
 * correctly, but a snapshot written while an index was mis-keyed keeps the wrong key. An index whose
 * reported key differs from the intended one is therefore dropped and created again: creating a vector
 * index indexes every node that already carries the property.
 */

export interface VectorIndexKey {
  label: string;
  property: string;
  /** Entries the index holds. */
  size: number;
}

export interface VectorIndexSpec {
  indexName: string;
  label: string;
  property: string;
  dimensions: number;
  capacity: number;
}

function toNumber(value: any): number {
  return Math.floor(typeof value === 'number' ? value : Number(value?.toNumber?.() ?? value));
}

/**
 * The label, property and size of every vector index, by index name. Newer Memgraph prints the label
 * with a leading colon; it is removed. Null when the database does not project these columns.
 */
export async function readVectorIndexKeys(session: any): Promise<Map<string, VectorIndexKey> | null> {
  try {
    const result = await session.executeRead((tx: any) =>
      tx.run(
        'CALL vector_search.show_index_info() YIELD index_name, label, property, size RETURN index_name, label, property, size',
      ),
    );
    const keys = new Map<string, VectorIndexKey>();
    for (const record of result.records as any[]) {
      keys.set(record.get('index_name'), {
        label: String(record.get('label')).replace(/^:/, ''),
        property: String(record.get('property')),
        size: toNumber(record.get('size')),
      });
    }
    return keys;
  } catch {
    return null;
  }
}

/** Whether a reported key differs from the intended label and property. */
export function isMiskeyed(key: VectorIndexKey | undefined, spec: Pick<VectorIndexSpec, 'label' | 'property'>): boolean {
  return key !== undefined && (key.label !== spec.label || key.property !== spec.property);
}

/**
 * Drop a vector index and create it again on its intended key. DDL runs as auto-committing statements:
 * Memgraph rejects vector index DDL inside explicit or multi-statement transactions.
 */
export async function rebuildVectorIndex(session: any, spec: VectorIndexSpec): Promise<void> {
  await session.run(`DROP VECTOR INDEX ${spec.indexName}`);
  await session.run(
    `CREATE VECTOR INDEX ${spec.indexName} ON :${spec.label}(${spec.property}) ` +
      `WITH CONFIG {"dimension": ${spec.dimensions}, "capacity": ${spec.capacity}, "metric": "cos"}`,
  );
}
