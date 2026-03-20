import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Read a schema.graphql file from the given directory.
 * Used by DTModule base classes as the default getSchemaExtension() implementation.
 *
 * @param dirname - Directory to look for schema.graphql (typically __dirname of the compiled module)
 * @returns The GraphQL SDL content, or undefined if no schema.graphql exists
 */
export async function readSchemaExtension(dirname: string): Promise<string | undefined> {
  const schemaPath = path.join(dirname, 'schema.graphql');
  try {
    const content = await fs.readFile(schemaPath, 'utf-8');
    return content?.trim() || undefined;
  } catch {
    return undefined;
  }
}
