/**
 * Each element records, per class it is bound to, the policy hash its findings were last
 * evaluated under: a list of `<classId><separator><policyHash>` strings in one element property.
 * A binding whose stamp differs from its class's current `policyHash` was evaluated under an
 * older policy, and is re-evaluated (`FindingReevaluationService`).
 *
 * The property is internal: it is not in the GraphQL schema, so no query, dt-core selection or
 * export can read it.
 */
export const POLICY_STAMPS_PROPERTY = 'classPolicyStamps';

/** The unit separator: it never occurs in a class id, so a stamp's class part cannot match another class's. */
export const POLICY_STAMP_SEPARATOR = String.fromCharCode(0x1f);

/** The stamp of an evaluation of class `classId` under the policy with hash `policyHash`. */
export function policyStamp(classId: string, policyHash: string): string {
  return `${classId}${POLICY_STAMP_SEPARATOR}${policyHash}`;
}

/**
 * Replace the element's stamp for one class. Anchored at the element and gated on the element
 * still being bound to the class, so a binding removed meanwhile is not stamped.
 */
export const STAMP_POLICY_CYPHER = `
  MATCH (c {id: $elementId})
  WITH c
  MATCH (c)-[:IS_INSTANCE_OF]->(t)
  WHERE t.id = $classId
  SET c.${POLICY_STAMPS_PROPERTY} =
    [s IN coalesce(c.${POLICY_STAMPS_PROPERTY}, []) WHERE NOT s STARTS WITH $classPrefix] + [$stamp]
  RETURN count(c) AS stamped
`;

/** Parameters of STAMP_POLICY_CYPHER. */
export function stampPolicyParams(elementId: string, classId: string, policyHash: string) {
  return {
    elementId,
    classId,
    classPrefix: `${classId}${POLICY_STAMP_SEPARATOR}`,
    stamp: policyStamp(classId, policyHash),
  };
}
