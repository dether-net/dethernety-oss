/**
 * Coerce a neo4j `Integer` to a plain JS value at the graph→policy-engine seam.
 *
 * The base library is deliberately driver-agnostic (the driver is typed `any` to avoid a
 * `neo4j-driver` dependency — see interfaces/module-interface.ts), so the `Integer` is
 * duck-typed by its shape rather than via `neo4j.isInt`. Real driver values are `Integer`
 * instances carrying `toNumber`/`inSafeRange`; anything without that shape (strings,
 * booleans, plain objects, neo4j temporal/spatial types, bare `{low,high}` POJOs that never
 * occur in production) falls through untouched — never a crash.
 *
 * Without this, a lossless `Integer` is `JSON.stringify`-d into Rego as `{"low":8080,"high":0}`.
 * In Rego's total ordering an object outranks every number, so a rule like `input.port > 1024`
 * compares object-vs-number and fires for *every* port; `< 1024` never fires. Coercing a
 * safe-range Integer to a plain number makes numeric policies evaluate correctly and identically
 * on Neo4j and Memgraph. An out-of-range value (|v| > 2^53 — not reachable for realistic
 * attributes such as ports) is preserved losslessly as its exact decimal string instead of a
 * lossy number; a string still mis-orders against a number in Rego, so this only avoids
 * precision loss, it does not make the (unreachable) out-of-range comparison meaningful.
 *
 * Recurses into arrays: only the UI flattens attributes to scalar leaf keys before saving —
 * non-UI writers (import, direct API) persist native lists, whose Integer elements would
 * otherwise reach the leaf wrapped in an array and reintroduce the misfire for array-valued
 * numeric attributes (`input.open_ports[_] > 1024`). Bolt property values are scalars or lists
 * of scalars, so arrays are the only container to descend.
 */
function coerceNeoInt(v: any): any {
  if (Array.isArray(v)) return v.map(coerceNeoInt);
  if (
    v !== null &&
    typeof v === 'object' &&
    typeof v.low === 'number' &&
    typeof v.high === 'number' &&
    typeof v.toNumber === 'function' &&
    typeof v.inSafeRange === 'function'
  ) {
    return v.inSafeRange() ? v.toNumber() : v.toString();
  }
  return v;
}

export class DbOps {
  private driver: any;

  constructor(driver: any) {
    this.driver = driver;
  }

  /**
   * Unflattens a nested object.
   * @param obj The object to unflatten
   * @returns 
   */
  unflattenProperties(obj: any): any {
    const result: any = {};
  
    // Iterate over each flat key in the object.
    for (const flatKey in obj) {
      if (!obj.hasOwnProperty(flatKey)) continue;
      const value = obj[flatKey];
  
      // Use a regex to extract both property names and array indices.
      // This regex matches either a sequence of characters that are not a dot or square bracket,
      // or matches a number inside square brackets.
      const regex = /([^\.\[\]]+)|\[(\d+)\]/g;
      const keys: (string | number)[] = [];
      let match;
      while ((match = regex.exec(flatKey)) !== null) {
        if (match[1] !== undefined) {
          if (match[1] === '__proto__' || match[1] === 'constructor' || match[1] === 'prototype') {
            continue;
          }
          keys.push(match[1]);
        } else if (match[2] !== undefined) {
          keys.push(Number(match[2])); // Convert array index to a number.
        }
      }
  
      // Now rebuild the nested structure from the keys.
      let current = result;
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
  
        // If we're at the last key, assign the value (coercing neo4j Integers to plain
        // JS values at this single leaf point — every scalar, nested key and array element
        // passes through here).
        if (i === keys.length - 1) {
          current[k] = coerceNeoInt(value);
        } else {
          // Decide whether the next key is a number (an array index) or a property.
          const nextKey = keys[i + 1];
  
          if (typeof nextKey === 'number') {
            // The next key is a number, so we need an array at the current position.
            if (!Array.isArray(current[k])) {
              current[k] = [];
            }
          } else {
            // Otherwise, we need an object.
            if (typeof current[k] !== 'object' || current[k] === null) {
              current[k] = {};
            }
          }
          // Move deeper into the nested structure.
          current = current[k];
        }
      }
    }
    return result;
  }

  /**
   * Gets an attribute from a node.
   * @param id The id of the node
   * @param attribute The attribute to get
   * @returns The attribute
   */
  async getAttribute(id: string, attribute: string): Promise<any> {
    // Validate attribute name to prevent Cypher injection
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(attribute)) {
      throw new Error(`Invalid attribute name: ${attribute}`);
    }
    let session: any = null;
    try {
      session = this.driver.session();
      return await session
        .run(`MATCH (n) WHERE n.id = $id RETURN n.${attribute} AS ${attribute}`, { id })
        .then((result: any) => {
          if (result.records.length === 0) {
            throw new Error(`No node found for id "${id}"`);
          }
          return result.records[0].get(attribute);
        });
    } catch (error) {
      console.error(`Error getting attribute ${attribute} for node ${id}:`, error);
      throw error;
    } finally {
      if (session) await session.close();
    }
  }

  /**
   * Gets the id of a class.
   * @param id The id of the node
   * @returns The id of the class
   */
  async getClassId(id: string): Promise<string> {
    const session = this.driver.session();

    try {
      return await session
        .run(`MATCH (n {id: $id})-[:IS_INSTANCE_OF]->(c) RETURN c.id AS classId`, { id })
        .then((result: any) => {
          if (result.records.length === 0) {
            throw new Error(`No class found for node id "${id}"`);
          }
          return result.records[0].get('classId');
        });
    } catch (error) {
      console.error(`Error getting class id for node ${id}:`, error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Gets the ids of a class.
   * @param id The id of the node
   * @returns The ids of the class
   */
  async getClassIds(id: string): Promise<string[]> {
    let session: any = null;

    try {
      session = this.driver.session();
      return await session
        .run(`MATCH (n {id: $id})-[:IS_INSTANCE_OF]->(c) RETURN c.id AS classId`, { id })
        .then((result: any) => {
          return result.records.map((record: any) => record.get('classId'));
        });
    } catch (error) {
      console.error(`Error getting class ids for nodes ${id}:`, error);
      throw error;
    } finally {
      if (session) await session.close();
    }
  }

  /**
   * Gets the attributes of a class relation.
   * @param id The id of the node
   * @param classId The id of the class
   * @returns The attributes
   */
  async getInstantiationAttributes(id: string, classId: string): Promise<any> {
    let session: any = null;

    try {
      session = this.driver.session();
      return await session
        .run(
          `
          MATCH (c {id: $id})
          OPTIONAL MATCH (c)-[r:IS_INSTANCE_OF]->(c2)
          WHERE c2.id = $classId
          RETURN COALESCE(r, {}) AS attributes
          `,
          { id, classId },
        )
        .then((result: any) => {
          if (result.records.length === 0) {
            return null;
          }
          return this.unflattenProperties(result.records[0].get('attributes').properties);
        });
    } catch (error) {
      console.error(`Error getting attributes for class relation ${
        id
      }:`, error);
      throw error;
    } finally {
      if (session) await session.close();
    }
  }
}
