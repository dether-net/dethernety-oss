/**
 * The values both supported databases store as a property: a primitive (string, number, boolean) or a
 * homogeneous list of primitives. A null value removes the property and is accepted; a null element
 * inside a list is not, because Neo4j refuses a list that holds null. Memgraph would store it, so a write
 * that works on one engine and fails on the other is refused here, before the database sees it.
 *
 * Returns a violation message, or null when the value can be stored. A list's element is named by its
 * index; `undefined` and an array hole count as null, because the driver sends both as null.
 */
export function describeNonPrimitiveValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return null;
  if (Array.isArray(value)) {
    let elemType: string | null = null;
    // An index loop, so a hole (`!(i in value)`) is told apart from an explicit undefined.
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) return `list element ${i} is missing; remove the empty entry (a list cannot hold null)`;
      const elem: unknown = value[i];
      if (elem === null || elem === undefined) {
        return `list element ${i} is ${elem === null ? 'null' : 'undefined'}; remove the empty entry (a list cannot hold null)`;
      }
      const et = typeof elem;
      if (et !== 'string' && et !== 'number' && et !== 'boolean') {
        return `list elements must be primitives (string|number|boolean); got ${et === 'object' ? (Array.isArray(elem) ? 'nested array' : 'nested object') : et}`;
      }
      if (elemType === null) {
        elemType = et;
      } else if (elemType !== et) {
        return `list must be homogeneous; saw both ${elemType} and ${et}`;
      }
    }
    return null;
  }
  return `value must be a primitive or a list of primitives; got ${t === 'object' ? 'nested object' : t}`;
}

/** Every key of a property map whose value cannot be stored, with the reason. */
export function propertyViolations(properties: Record<string, unknown>): { key: string; violation: string }[] {
  const out: { key: string; violation: string }[] = [];
  for (const [key, value] of Object.entries(properties)) {
    const violation = describeNonPrimitiveValue(value);
    if (violation) out.push({ key, violation });
  }
  return out;
}

/**
 * Throws, naming the first key that cannot be stored and why, unless every value of the map can be. The callers'
 * error wrappers name the class or module.
 */
export function assertStorableProperties(properties: Record<string, unknown>): void {
  const [first] = propertyViolations(properties);
  if (first) throw new Error(`property ${first.key} cannot be stored: ${first.violation}`);
}
