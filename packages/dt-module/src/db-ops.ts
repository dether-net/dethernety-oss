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
  
        // If we're at the last key, assign the value.
        if (i === keys.length - 1) {
          current[k] = value;
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
          session.close();
          return result.records[0].get(attribute);
        });
    } catch (error) {
      console.error(`Error getting attribute ${attribute} for node ${id}:`, error);
      throw error;
    } finally {
      session.close();
    } 
  }

  /**
   * Gets the attributes of a module.
   * @param name The name of the module
   * @returns The attributes
   */
  async getModuleAttributes(name: string): Promise<object> {
    let session: any = null;
    try {
      session = this.driver.session();
      return await session
        .run(`MATCH (m:Module {name: $name}) RETURN m.attributes AS attributes`, { name })
        .then((result: any) => {
          session.close();
          const retValue = result.records[0].get('attributes') as string;
          if (retValue) {
            const parsedAttributes = JSON.parse(retValue);
            return parsedAttributes;
          }
          return {};
        });
    } catch (error) {
      console.error(`Error getting attributes for module ${name}:`, error);
      throw error;
    } finally {
      session.close();
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
      return session
        .run(`MATCH (n {id: $id})-[:IS_INSTANCE_OF]->(c) RETURN c.id AS classId`, { id })
        .then((result: any) => {
          return result.records[0].get('classId');
        });
    } catch (error) {
      console.error(`Error getting class id for node ${id}:`, error);
      throw error;
    } finally {
      session.close();
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
      session.close();
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
          return this.unflattenProperties(result.records[0].get('attributes').properties);
        });
    } catch (error) {
      console.error(`Error getting attributes for class relation ${
        id
      }:`, error);
      throw error;
    } finally {
      session.close();
    }
  }
}
