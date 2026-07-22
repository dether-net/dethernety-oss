/**
 * Payload minimization — the single, testable enforcement point.
 *
 * A remote module evaluates a class instance's configuration by sending its
 * attributes to a content service. Only the attributes the class *schema*
 * declares may leave the deployment: the element's id, name, description, graph
 * topology, and any free text are not part of the evaluation payload and must
 * never be serialized onto the wire. The class schema is the allowlist.
 *
 * This is deliberately one small pure function so it can be unit-tested in
 * isolation and referenced from exactly one call site (the evaluation path).
 */

/** The slice of a class template's JSON Schema this module reads. */
export interface JsonSchema {
  properties?: Record<string, unknown>;
}

/**
 * Return only the attribute keys the schema declares, dropping everything else.
 *
 * A missing or empty `properties` yields an empty object — the caller treats an
 * empty allowlist as a hard precondition failure (an eval against no attributes
 * would masquerade as evaluated-clean), never as a legitimate "evaluate with
 * nothing". Values are passed through by reference; primitives and arrays of
 * primitives are the only shapes a class schema declares.
 */
export function stripToSchema(
  attributes: Record<string, unknown>,
  schema: JsonSchema,
): Record<string, unknown> {
  const allowed = new Set(Object.keys(schema.properties ?? {}));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(attributes)) {
    if (allowed.has(key)) out[key] = attributes[key];
  }
  return out;
}
