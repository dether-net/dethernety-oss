/**
 * A write lock on a node, taken inside a Cypher statement, for check-then-write
 * sequences that must hold on both graph engines.
 *
 * Neo4j runs read-committed: a statement that reads a node and then writes it
 * can act on a value another transaction has already changed, and two writers
 * can both pass the same check. Writing a property takes the node's exclusive
 * lock, held until commit, and every read after it sees the latest committed
 * state; a concurrent writer that took the lock first makes this one wait.
 * Memgraph runs snapshot isolation: the same write makes a concurrent writer of
 * the node fail with a conflict instead of waiting.
 *
 * The clause sets a property and removes it again, so nothing is left on the
 * node. Put it right after the MATCH that binds the node and before any read
 * the write depends on.
 */

const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `SET v._lock = true REMOVE v._lock` for the bound node variable `variable`. */
export function writeLockClause(variable: string): string {
  if (!VARIABLE.test(variable)) throw new Error(`invalid variable for a write lock: ${JSON.stringify(variable)}`);
  return `SET ${variable}._lock = true REMOVE ${variable}._lock`;
}
