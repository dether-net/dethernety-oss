import {
  parse,
  Kind,
  type DocumentNode,
  type DefinitionNode,
  type FieldDefinitionNode,
} from 'graphql';

/**
 * Extracts declared type-field pairs from a GraphQL SDL fragment.
 *
 * Accepts either a raw SDL string or a pre-parsed DocumentNode
 * (to avoid redundant parsing when the caller already has the AST).
 *
 * Handles:
 * - type Foo { bar: String }           --> "Foo.bar"
 * - extend type Query { myField: Int } --> "Query.myField"
 *
 * Excludes input types, enums, unions, interfaces, and scalars
 * (these do not have field resolvers).
 *
 * @returns Set of "TypeName.fieldName" strings
 */
export function extractDeclaredFields(sdlOrDoc: string | DocumentNode): Set<string> {
  const fields = new Set<string>();

  let doc: DocumentNode;
  if (typeof sdlOrDoc === 'string') {
    try {
      doc = parse(sdlOrDoc);
    } catch {
      return fields;
    }
  } else {
    doc = sdlOrDoc;
  }

  for (const def of doc.definitions) {
    if (!hasFieldDefinitions(def)) continue;

    const typeName = def.name.value;
    for (const field of def.fields || []) {
      fields.add(`${typeName}.${field.name.value}`);
    }
  }

  return fields;
}

/**
 * Type guard: definition kinds that can have field definitions with resolvers.
 */
function hasFieldDefinitions(
  def: DefinitionNode,
): def is DefinitionNode & {
  name: { value: string };
  fields?: readonly FieldDefinitionNode[];
} {
  return (
    def.kind === Kind.OBJECT_TYPE_DEFINITION ||
    def.kind === Kind.OBJECT_TYPE_EXTENSION
  );
}
