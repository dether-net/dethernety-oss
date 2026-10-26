import { writeLockClause } from '@dethernety/dt-module';
import type { DatabaseTransaction } from '../../interfaces/set-instantiation-attributes.interface';

/**
 * Lock an element for the rest of a write transaction that reads its findings or its class
 * binding and then writes them.
 *
 * Within one process `runExclusive` already serialises these writers per element. The database
 * lock is what holds across processes: on Neo4j, whose reads are read-committed, a second
 * transaction waits here and then reads what the first committed, so two writers cannot both find
 * a finding absent and create it twice, or both read the same binding and rewire it. On Memgraph
 * the second transaction conflicts instead, and `executeWrite` retries it.
 *
 * Call it first in the transaction, before any read the writes depend on. Taking it again later in
 * the same transaction is harmless.
 */
export const LOCK_ELEMENT_CYPHER = `MATCH (c {id: $elementId}) ${writeLockClause('c')}`;

export async function lockElementInTx(tx: DatabaseTransaction, elementId: string): Promise<void> {
  await tx.run(LOCK_ELEMENT_CYPHER, { elementId });
}
