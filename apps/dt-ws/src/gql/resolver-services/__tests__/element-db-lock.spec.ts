import { LOCK_ELEMENT_CYPHER, lockElementInTx } from '../shared/element-db-lock';

/** The element's database lock: the element matched by id, then the write-lock clause, in one statement. */
describe('lockElementInTx', () => {
  it('runs the lock statement for the element in the given transaction', async () => {
    const tx = { run: jest.fn(async () => ({ records: [] })) };
    await lockElementInTx(tx, 'el-1');
    expect(LOCK_ELEMENT_CYPHER).toBe('MATCH (c {id: $elementId}) SET c._lock = true REMOVE c._lock');
    expect(tx.run).toHaveBeenCalledWith(LOCK_ELEMENT_CYPHER, { elementId: 'el-1' });
  });
});
