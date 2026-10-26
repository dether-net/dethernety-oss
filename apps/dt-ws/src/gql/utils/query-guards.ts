import {
  ArgumentNode,
  DocumentNode,
  FragmentDefinitionNode,
  getNamedType,
  getOperationAST,
  GraphQLError,
  GraphQLInputObjectType,
  GraphQLInputType,
  GraphQLNamedType,
  GraphQLSchema,
  isAbstractType,
  isInputObjectType,
  isInputType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  Kind,
  OperationDefinitionNode,
  parse,
  SelectionSetNode,
  specifiedRules,
  ValidationContext,
  typeFromAST,
  validate as graphqlValidate,
  ValidationRule,
  valueFromAST,
} from 'graphql';
import { getComplexity, simpleEstimator } from 'graphql-query-complexity';

/**
 * Shared query-guard logic for BOTH GraphQL transports (Apollo on /graphql
 * and graphql-sse on /graphql/stream). One implementation so the limits can
 * never drift apart again: a query rejected on one transport is rejected on
 * the other.
 */

export interface QueryGuardConfig {
  queryDepthLimit: number;
  queryComplexityLimit: number;
}

/**
 * Depth-limit validation rules (empty when the limit is disabled). A non-positive limit is an internal path, not a
 * supported way to turn the guard off: GQL_QUERY_DEPTH_LIMIT itself is validated as 1-50.
 */
export function buildValidationRules(config: QueryGuardConfig): ValidationRule[] {
  return config.queryDepthLimit > 0 ? [depthLimitRule(config.queryDepthLimit)] : [];
}

/**
 * Refuses an operation whose selections nest deeper than `maxDepth`: a top-level field is at depth 0, a field's
 * selections one level below it, a fragment's selections at the level it is spread, and an introspection field
 * (`__schema`, `__type`, ...) is not followed. A fragment's own depth is measured once, however often it is spread, and
 * nothing is measured past one level beyond the limit, so the check costs at most one pass over the document. A spread of an unknown fragment or a fragment cycle measures as 0 here;
 * the specified rules refuse both.
 */
export function depthLimitRule(maxDepth: number): ValidationRule {
  // Measured from the Document visitor, not when the rule is built: graphql's validate catches the abort its error cap
  // throws only while it visits.
  return (context: ValidationContext) => ({ Document: () => checkDepth(context, maxDepth) });
}

function checkDepth(context: ValidationContext, maxDepth: number): void {
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const definition of context.getDocument().definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition);
  }
  // Depths are measured up to one past the limit: deeper nesting changes no answer, and the recursion through fields
  // stays that shallow (inline fragments, which add no depth, nest as deep as the document does).
  const cap = maxDepth + 1;
  const fragmentDepths = new Map<string, number>();
  const measuring = new Set<string>();
  /** The depth of `set`'s selections, or `budget` if they nest deeper. */
  const depthOf = (set: SelectionSetNode, budget: number): number => {
    let deepest = 0;
    for (const selection of set.selections) {
      if (deepest >= budget) break;
      let depth = 0;
      if (selection.kind === Kind.FIELD) {
        if (selection.selectionSet && !selection.name.value.startsWith('__')) {
          depth = 1 + depthOf(selection.selectionSet, budget - 1);
        }
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        depth = depthOf(selection.selectionSet, budget);
      } else {
        const name = selection.name.value;
        const fragment = fragments.get(name);
        if (fragment && !measuring.has(name)) {
          let known = fragmentDepths.get(name);
          if (known === undefined) {
            measuring.add(name);
            known = depthOf(fragment.selectionSet, cap);
            measuring.delete(name);
            fragmentDepths.set(name, known);
          }
          depth = Math.min(known, budget);
        }
      }
      deepest = Math.max(deepest, depth);
    }
    return deepest;
  };
  for (const definition of context.getDocument().definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
    if (depthOf(definition.selectionSet, cap) > maxDepth) {
      const name = definition.name?.value ?? '';
      context.reportError(new GraphQLError(`'${name}' exceeds maximum operation depth of ${maxDepth}`, { nodes: [definition] }));
    }
  }
}

/**
 * A graphql `validate` drop-in that appends the depth rules to the spec
 * rules — the shape graphql-sse's `validate` handler option expects.
 */
export function buildGuardedValidate(config: QueryGuardConfig): typeof graphqlValidate {
  const extraRules = buildValidationRules(config);
  return ((schema, documentAST, rules, options) =>
    graphqlValidate(
      schema,
      documentAST,
      [...(rules ?? specifiedRules), ...extraRules],
      options,
    )) as typeof graphqlValidate;
}

/**
 * Complexity gate — needs request variables, so it runs post-parse
 * (Apollo: didResolveOperation plugin hook; SSE: onSubscribe). Throws when
 * the computed complexity exceeds the limit; no-op when disabled.
 */
export function assertComplexityWithinLimit(args: {
  schema: GraphQLSchema;
  operationName?: string | null;
  document: DocumentNode;
  variables?: Record<string, unknown> | null;
  limit: number;
}): void {
  if (args.limit <= 0) return;
  const complexity = getComplexity({
    schema: args.schema,
    operationName: args.operationName ?? undefined,
    query: args.document,
    variables: args.variables || {},
    estimators: [simpleEstimator({ defaultComplexity: 1 })],
  });
  if (complexity > args.limit) {
    throw new GraphQLError(`Query too complex: ${complexity}. Maximum allowed: ${args.limit}`, {
      extensions: { code: 'BAD_USER_INPUT', http: { status: 400 } },
    });
  }
}

/**
 * The per-request guards every transport runs on a validated operation, with its variables: the relationship-filter
 * limits, then the complexity limit (a no-op when disabled). Throws a GraphQLError with code BAD_USER_INPUT (HTTP 400)
 * at the first refusal.
 */
export function assertRequestGuards(args: {
  schema: GraphQLSchema;
  document: DocumentNode;
  operationName?: string | null;
  variables?: Record<string, unknown> | null;
  config: QueryGuardConfig;
}): void {
  assertRelationshipFiltersWithinLimits({
    schema: args.schema,
    document: args.document,
    operationName: args.operationName,
    variables: args.variables,
  });
  assertComplexityWithinLimit({
    schema: args.schema,
    operationName: args.operationName,
    document: args.document,
    variables: args.variables,
    limit: args.config.queryComplexityLimit,
  });
}

/**
 * The Apollo plugin that runs the per-request guards on the HTTP transport. They need the request's variables, which
 * the validation phase does not have, so they run in didResolveOperation, after Apollo has validated the document (a
 * static createComplexityRule would not see variables either).
 */
export function buildApolloQueryGuardPlugin(schema: GraphQLSchema, config: QueryGuardConfig) {
  return {
    async requestDidStart() {
      return {
        async didResolveOperation(requestContext: {
          request: { operationName?: string | null; variables?: Record<string, unknown> | null };
          document: DocumentNode;
        }) {
          const { request, document } = requestContext;
          assertRequestGuards({ schema, document, operationName: request.operationName, variables: request.variables, config });
        },
      };
    },
  };
}

/**
 * graphql-ws's `onSubscribe`: the guards the HTTP and SSE transports run, for every operation the socket carries
 * (graphql-ws runs queries and mutations as well as subscriptions): the depth rules, the relationship-filter limits
 * and the complexity limit. A refusal is returned as GraphQL errors, which graphql-ws sends without executing anything;
 * returning nothing lets graphql-ws parse, validate and run the operation itself. A document that does not parse is
 * left to graphql-ws, whose own parse reports it.
 */
export function buildGraphqlWsOnSubscribe(schema: GraphQLSchema, config: QueryGuardConfig) {
  const guardedValidate = buildGuardedValidate(config);
  return (
    _ctx: unknown,
    _id: string,
    payload: { query: string; operationName?: string | null; variables?: Record<string, unknown> | null },
  ): readonly GraphQLError[] | undefined => {
    let document: DocumentNode;
    try {
      document = parse(payload.query);
    } catch {
      return undefined;
    }
    const errors = guardedValidate(schema, document);
    if (errors.length > 0) return errors;
    try {
      assertRequestGuards({ schema, document, operationName: payload.operationName, variables: payload.variables, config });
    } catch (error) {
      return [error instanceof GraphQLError ? error : new GraphQLError(error instanceof Error ? error.message : String(error))];
    }
    return undefined;
  };
}

/**
 * Limits on how much Cypher a request's arguments make @neo4j/graphql write, and how much of it the database has to
 * plan. dt-ws translates on its event loop, so a request past them stalls every other request while it is translated.
 * The counts follow how the library renders an input: a relationship filter once per type the relationship can lead to
 * (28 for the `Element` interface) and `all` twice, an aggregate filter like a `some`, a filter on a `@cypher` field at
 * {@link CYPHER_FILTER_COST} (more for one that walks a variable-length path), and everything under a filter or an
 * operand on an interface once per member type. A condition on a stored property costs nothing against the budget; its
 * values count against the scalar size.
 */
export const RELATIONSHIP_FILTER_LIMITS = {
  /**
   * The largest weighted cost of a request's filters, summed over every place they run. The largest a platform client
   * sends is 58 (dt-core's component delete: `some` on Exposure.element and Analysis.element, 28 each, and two concrete
   * ones); no client's cost grows with a list it sends, as lists go into scalar `in` conditions.
   */
  maxBudget: 300,
  /**
   * The most input objects a request's `where` arguments may hold, each counted once per type it is rendered for. The
   * largest a platform client sends is 42 (dt-core's issue search).
   */
  maxFilterObjects: 1000,
  /**
   * The most input objects a request's arguments may hold in all, counted the same way. A platform client's request
   * grows only with links that carry a justification, which are operands of their own: a countermeasure create's
   * technique links and a boundary update's conduits, about 5 objects each. A countermeasure create is 25 objects and
   * 5 per link, so the limit is reached at 495 links on one countermeasure.
   */
  maxInputObjects: 2500,
  /**
   * The most relationship operands a request's mutation inputs may hold (each item of a connect, disconnect, create,
   * update or delete under a relationship), each counted at the number of types its target can be. Each one renders
   * subqueries of its own. The same justified links are a platform client's only operands that grow, one per link (a
   * countermeasure create reaches this limit at 639 links, past the object limit); where a link carries nothing but its
   * target, dt-core sends all the ids in one operand's `in` list.
   */
  maxRelationshipOperands: 640,
  /**
   * The most characters a request's scalar values may come to (a string its length, any other scalar one), counted
   * once for every place they are used: @neo4j/graphql writes a value into its own Cypher parameter each time a
   * variable is referenced. What a platform client sends grows with what it carries (an `in` list of ids, a class's
   * schema and policy text), and uses each value once; over HTTP such a request holds no more than the 1 MB body limit.
   */
  maxScalarSize: 4_000_000,
  /** The deepest an input value may nest; the deepest a platform client sends is 9 levels. */
  maxInputDepth: 64,
  /** The most selections the walk visits once fragments are expanded, which bounds the check's own cost. */
  maxSelections: 10_000,
} as const;

/**
 * Filter prices beyond the relationship quantifiers: a filter on a `@cypher` field runs the field's statement in
 * subqueries of its own, and one whose statement walks a variable-length path does so per row. No platform client
 * filters on a `@cypher` field or with an aggregate.
 */
const CYPHER_FILTER_COST = 2;
const CYPHER_PATH_FILTER_COST = 10;

/** The `@cypher` fields of a schema, by type and field, with the cost of a filter on each; see registerCypherFields. */
const cypherFieldCosts = new WeakMap<GraphQLSchema, Map<string, number>>();

/**
 * Records which fields of `schema` are `@cypher` fields, from the type definitions it was built from: the executable
 * schema @neo4j/graphql returns keeps no directives. Without it, filters on those fields go unpriced.
 */
export function registerCypherFields(schema: GraphQLSchema, typeDefs: string): void {
  const costs = new Map<string, number>();
  for (const definition of parse(typeDefs).definitions) {
    if (
      definition.kind !== Kind.OBJECT_TYPE_DEFINITION &&
      definition.kind !== Kind.OBJECT_TYPE_EXTENSION &&
      definition.kind !== Kind.INTERFACE_TYPE_DEFINITION &&
      definition.kind !== Kind.INTERFACE_TYPE_EXTENSION
    ) {
      continue;
    }
    for (const field of definition.fields ?? []) {
      const cypher = field.directives?.find((directive) => directive.name.value === 'cypher');
      if (!cypher) continue;
      const statement = cypher.arguments?.find((argument) => argument.name.value === 'statement')?.value;
      const text = statement && statement.kind === Kind.STRING ? statement.value : '';
      // A relationship pattern with `*` in it, `-[:REL*]-`: a variable-length path.
      const walksPath = /-\[[^\]]*\*/.test(text);
      costs.set(`${definition.name.value}.${field.name.value}`, walksPath ? CYPHER_PATH_FILTER_COST : CYPHER_FILTER_COST);
    }
  }
  cypherFieldCosts.set(schema, costs);
}

/**
 * Refuses a request whose relationship filters Neo4j cannot plan or should not have to:
 * - a `single` filter on a relationship whose target is an interface or a union. @neo4j/graphql renders it as a XOR
 *   of one `single(...)` predicate per member type, and Neo4j's planner rewrites a XOR chain into a form that grows
 *   exponentially with its length: on `Element`'s 28 members one request exhausts the database's heap while it is
 *   still being planned, and the database answers nothing until a restart. Ids are unique, so `some` answers what
 *   `single` was meant to; `some`, `all` and `none` render as an OR or an AND, which grows linearly;
 * - arguments past any of {@link RELATIONSHIP_FILTER_LIMITS}: filters whose weighted cost exceeds the budget (the
 *   linear forms still multiply: 28 predicates for each `some` on `Element`), too many input objects in all or in the
 *   `where` arguments, too many relationship operands in a mutation's inputs, scalar values too large once counted
 *   for every place they are used, and input nested too deep.
 *
 * Runs post-parse with the request's variables (Apollo: didResolveOperation; SSE and graphql-ws: onSubscribe), on the
 * operation `operationName` selects, with its variables' defaults applied as execution applies them; a request that
 * selects no single operation is refused. Fragments are
 * expanded where they are spread, so a filter counts once for every place it runs. A literal that does not coerce, a
 * variable that holds something other than an object where an input object is expected, and a field its type does not
 * define are refused here, as coercion would refuse them.
 * Throws a GraphQLError with code BAD_USER_INPUT (HTTP 400).
 */
export function assertRelationshipFiltersWithinLimits(args: {
  schema: GraphQLSchema;
  document: DocumentNode;
  operationName?: string | null;
  variables?: Record<string, unknown> | null;
}): void {
  const walk = new FilterWalk(args.schema, args.document);
  const refusal = walk.run(args.variables ?? {}, args.operationName);
  if (refusal) {
    throw new GraphQLError(refusal, { extensions: { code: 'BAD_USER_INPUT', http: { status: 400 } } });
  }
}

/** Raised inside the walk to stop it at the first refusal. */
class Refusal {
  constructor(readonly message: string) {}
}

/**
 * Where the walk is in one argument: its path, how deep it nests, whether it is inside a `where`, and how many times
 * @neo4j/graphql renders it (once per member type under a filter or an operand on an interface or union).
 */
interface InputFrame {
  path: string;
  depth: number;
  inWhere: boolean;
  multiplier: number;
}

/** The limits the walk counts against, by counter. */
const LIMIT_OF = {
  inputObjects: RELATIONSHIP_FILTER_LIMITS.maxInputObjects,
  filterObjects: RELATIONSHIP_FILTER_LIMITS.maxFilterObjects,
  operands: RELATIONSHIP_FILTER_LIMITS.maxRelationshipOperands,
  scalarSize: RELATIONSHIP_FILTER_LIMITS.maxScalarSize,
} as const;

/** The refusal for each counter, naming where the request passed it. */
const REFUSAL_OF: Record<keyof typeof LIMIT_OF, (path: string) => string> = {
  inputObjects: (path) =>
    `The request's arguments hold more than ${LIMIT_OF.inputObjects} input objects, exceeded at "${path}".`,
  filterObjects: (path) =>
    `The request's where arguments hold more than ${LIMIT_OF.filterObjects} input objects, exceeded at "${path}".`,
  operands: (path) =>
    `The request's mutation inputs hold more than ${LIMIT_OF.operands} relationship operands, exceeded at "${path}": ` +
    'each connect, disconnect, create, update or delete under a relationship counts once per type its target can be ' +
    '(28 on Element).',
  scalarSize: (path) =>
    `The request's scalar values come to more than ${LIMIT_OF.scalarSize} characters, exceeded at "${path}": a value ` +
    'counts once for every place it is used, including each place a variable is referenced.',
};

class FilterWalk {
  private readonly fragments = new Map<string, FragmentDefinitionNode>();
  private budget = 0;
  private readonly counts = { inputObjects: 0, filterObjects: 0, operands: 0, scalarSize: 0 };
  private readonly sizes = new WeakMap<object, number>();
  private readonly argumentValues = new WeakMap<ArgumentNode, { type: GraphQLInputType; value: unknown }>();
  private selections = 0;
  private readonly cypherCosts: Map<string, number>;

  constructor(
    private readonly schema: GraphQLSchema,
    private readonly document: DocumentNode,
  ) {
    for (const definition of document.definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION) this.fragments.set(definition.name.value, definition);
    }
    this.cypherCosts = cypherFieldCosts.get(schema) ?? new Map();
  }

  /**
   * The refusal message, or undefined when the request is within every limit. Only the operation the request runs is
   * walked: the one `operationName` names, as execution picks it on every transport. A request that selects no single
   * operation (several and no name, or a name none has) is refused, so nothing runs that was not walked.
   */
  run(variables: Record<string, unknown>, operationName?: string | null): string | undefined {
    try {
      const operation = getOperationAST(this.document, operationName);
      if (!operation) {
        throw new Refusal(
          operationName != null
            ? `The request has no operation named "${String(operationName)}".`
            : 'The request holds several operations: name the one to run with operationName.',
        );
      }
      const root = this.schema.getRootType(operation.operation);
      if (root) this.selectionSet(operation.selectionSet, root, this.declared(operation, variables), new Set());
      return undefined;
    } catch (error) {
      if (error instanceof Refusal) return error.message;
      throw error;
    }
  }

  /**
   * The variables the operation declares, each one the request leaves out set to its default, as execution sets it.
   * Variables it does not declare are left out: nothing in the operation can refer to them.
   */
  private declared(operation: OperationDefinitionNode, variables: Record<string, unknown>): Record<string, unknown> {
    const effective: Record<string, unknown> = Object.create(null);
    for (const definition of operation.variableDefinitions ?? []) {
      const name = definition.variable.name.value;
      if (Object.prototype.hasOwnProperty.call(variables, name) && variables[name] !== undefined) {
        effective[name] = variables[name];
        continue;
      }
      if (!definition.defaultValue) continue;
      const type = typeFromAST(this.schema, definition.type);
      if (type && isInputType(type)) effective[name] = valueFromAST(definition.defaultValue, type);
    }
    return effective;
  }

  private selectionSet(
    set: SelectionSetNode,
    parent: GraphQLNamedType,
    variables: Record<string, unknown>,
    spreading: Set<string>,
  ): void {
    for (const selection of set.selections) {
      if (++this.selections > RELATIONSHIP_FILTER_LIMITS.maxSelections) {
        throw new Refusal(
          `The request has more than ${RELATIONSHIP_FILTER_LIMITS.maxSelections} selections once its fragments are ` +
            'expanded.',
        );
      }
      if (selection.kind === Kind.FIELD) {
        const field = isObjectType(parent) || isInterfaceType(parent) ? parent.getFields()[selection.name.value] : undefined;
        if (!field) continue;
        for (const argument of selection.arguments ?? []) {
          const definition = field.args.find((arg) => arg.name === argument.name.value);
          if (!definition) continue;
          const value = this.argumentValue(argument, definition.type, variables);
          const isWhere = argument.name.value === 'where';
          if (value === undefined) {
            // A variable the request leaves out leaves the argument out. A literal that does not coerce is refused, as
            // execution refuses it: the complexity check after this walk would read it again at every spread.
            if (argument.value.kind === Kind.VARIABLE) continue;
            throw new Refusal(`The value of "${argument.name.value}" does not match its type, ${String(definition.type)}.`);
          }
          this.value(value, definition.type, { path: argument.name.value, depth: 0, inWhere: isWhere, multiplier: 1 });
        }
        if (selection.selectionSet) this.selectionSet(selection.selectionSet, getNamedType(field.type), variables, spreading);
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        const type = selection.typeCondition ? this.schema.getType(selection.typeCondition.name.value) : parent;
        if (type) this.selectionSet(selection.selectionSet, type, variables, spreading);
      } else {
        const name = selection.name.value;
        const fragment = this.fragments.get(name);
        // A fragment that spreads itself is refused by validation; here it is not followed twice.
        if (!fragment || spreading.has(name)) continue;
        const type = this.schema.getType(fragment.typeCondition.name.value);
        if (!type) continue;
        spreading.add(name);
        this.selectionSet(fragment.selectionSet, type, variables, spreading);
        spreading.delete(name);
      }
    }
  }

  /**
   * Walks one input value of type `type`: refuses `single` on an abstract target, and adds up the costs. A scalar value
   * is sized whole, without walking its items.
   */
  private value(value: unknown, type: GraphQLInputType, at: InputFrame): void {
    if (value === null || value === undefined) return;
    if (at.depth > RELATIONSHIP_FILTER_LIMITS.maxInputDepth) {
      throw new Refusal(`The input at "${at.path}" is nested deeper than ${RELATIONSHIP_FILTER_LIMITS.maxInputDepth} levels.`);
    }
    if (!isInputObjectType(getNamedType(type))) {
      this.count('scalarSize', this.sizeOf(value, at) * at.multiplier, at.path);
      return;
    }
    if (isNonNullType(type)) return this.value(value, type.ofType, at);
    if (isListType(type)) {
      const item = { ...at, depth: at.depth + 1 };
      // A single value where a list is expected is coerced to a one-item list.
      if (!Array.isArray(value)) return this.value(value, type.ofType, item);
      value.forEach((entry, i) => {
        const path = `${at.path}[${i}]`;
        // A null entry renders nothing, but visiting it is work: it counts as one input object.
        if (entry === null || entry === undefined) return this.count('inputObjects', at.multiplier, path);
        this.value(entry, type.ofType, { ...item, path });
      });
      return;
    }
    if (!isInputObjectType(type)) return;
    // Coercion refuses these too; refusing them here keeps the walk from visiting entries no limit counts.
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new Refusal(`The input at "${at.path}" is not an object, where ${type.name} is expected.`);
    }

    const rendered = at.multiplier * this.countObject(type, at);
    const fields = type.getFields();
    const owner = whereTarget(type.name);
    for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
      const field = fields[key];
      const path = `${at.path}.${key}`;
      if (!field) throw new Refusal(`The input at "${path}" is not a field of ${type.name}.`);
      if (fieldValue === null || fieldValue === undefined) continue;
      let multiplier = rendered;
      const quantifier = quantifierOf(type, key);
      if (quantifier) {
        if (quantifier === 'SINGLE' && targetsAbstractType(this.schema, field.type)) {
          throw new Refusal(
            `The filter at "${path}" uses "single" on a relationship to an interface or union type, which is ` +
              'not supported: use "some" instead.',
          );
        }
        // `all` renders its filter twice: no member fails it, and at least one member meets it.
        multiplier = rendered * memberCount(this.schema, field.type) * (quantifier === 'ALL' ? 2 : 1);
        this.charge(multiplier, path);
      }
      const aggregated = aggregateTarget(type, key);
      if (aggregated) this.charge(memberCount(this.schema, aggregated) * rendered, path);
      const cypherCost = owner ? this.cypherCosts.get(`${owner}.${baseField(key)}`) : undefined;
      if (cypherCost) this.charge(cypherCost * rendered, path);
      this.value(fieldValue, field.type, { ...at, path, depth: at.depth + 1, multiplier });
    }
  }

  /**
   * Counts one input object against the object and operand limits, and returns how many times its fields render
   * relative to it: once per member type its target can be for a relationship operand, once otherwise.
   */
  private countObject(type: GraphQLInputObjectType, at: InputFrame): number {
    this.count('inputObjects', at.multiplier, at.path);
    if (at.inWhere) this.count('filterObjects', at.multiplier, at.path);
    if (!OPERAND_TYPE.test(type.name)) return 1;
    const members = operandMembers(this.schema, type);
    this.count('operands', members * at.multiplier, at.path);
    return members;
  }

  /**
   * The size of a scalar value: a string's length and any other scalar one, a list or a JSON value its entries summed,
   * and nothing less than one, so every entry counts. A value the request refers to many times is measured once, and counted at each use.
   */
  private sizeOf(value: unknown, at: InputFrame, depth = at.depth): number {
    if (typeof value === 'string') return Math.max(1, value.length);
    if (value === null || typeof value !== 'object') return 1;
    if (depth > RELATIONSHIP_FILTER_LIMITS.maxInputDepth) {
      throw new Refusal(`The input at "${at.path}" is nested deeper than ${RELATIONSHIP_FILTER_LIMITS.maxInputDepth} levels.`);
    }
    const known = this.sizes.get(value);
    if (known !== undefined) return known;
    let size = 0;
    for (const [key, entry] of Object.entries(value)) {
      size += (Array.isArray(value) ? 0 : key.length) + this.sizeOf(entry, at, depth + 1);
      if (size > RELATIONSHIP_FILTER_LIMITS.maxScalarSize) break;
    }
    this.sizes.set(value, Math.max(1, size));
    return Math.max(1, size);
  }

  /**
   * An argument's value, read once per argument: a fragment spread many times is read once, not at every spread. The
   * variables are the same for the whole walk, so the value is too.
   */
  private argumentValue(argument: ArgumentNode, type: GraphQLInputType, variables: Record<string, unknown>): unknown {
    const known = this.argumentValues.get(argument);
    if (known && known.type === type) return known.value;
    const value = valueFromAST(argument.value, type, variables);
    this.argumentValues.set(argument, { type, value });
    return value;
  }

  private count(counter: keyof typeof LIMIT_OF, amount: number, path: string): void {
    this.counts[counter] += amount;
    if (this.counts[counter] <= LIMIT_OF[counter]) return;
    throw new Refusal(REFUSAL_OF[counter](path));
  }

  private charge(cost: number, path: string): void {
    this.budget += cost;
    if (this.budget > RELATIONSHIP_FILTER_LIMITS.maxBudget) {
      throw new Refusal(
        `The request's filters cost more than the limit of ${RELATIONSHIP_FILTER_LIMITS.maxBudget}, exceeded at ` +
          `"${path}": each relationship or aggregate filter costs the number of types it can match (28 on Element), ` +
          '"all" twice, and a filter on a computed field more.',
      );
    }
  }
}

type Quantifier = 'SOME' | 'ALL' | 'NONE' | 'SINGLE';

const QUANTIFIER_SUFFIXES = 'SOME|ALL|NONE|SINGLE';
const DEPRECATED_QUANTIFIER = new RegExp(`_(${QUANTIFIER_SUFFIXES})$`);
const OPERATOR_SUFFIX = new RegExp(
  `_(EQ|IN|LT|LTE|GT|GTE|CONTAINS|STARTS_WITH|ENDS_WITH|MATCHES|INCLUDES|${QUANTIFIER_SUFFIXES})$`,
);

/**
 * The quantifier `key` applies, if any: `some` / `all` / `none` / `single` in a relationship or connection filter, or
 * the deprecated `<field>_SOME` … `<field>Connection_SINGLE` the library still generates, which render the same way.
 */
function quantifierOf(type: GraphQLInputObjectType, key: string): Quantifier | undefined {
  if (/(RelationshipFilters|ConnectionFilters)$/.test(type.name) && /^(some|all|none|single)$/.test(key)) {
    return key.toUpperCase() as Quantifier;
  }
  const deprecated = DEPRECATED_QUANTIFIER.exec(key);
  return deprecated ? (deprecated[1] as Quantifier) : undefined;
}

/** The input types of the items of a mutation's connect, disconnect, create, update or delete under a relationship. */
const OPERAND_TYPE = /(ConnectFieldInput|DisconnectFieldInput|CreateFieldInput|DeleteFieldInput|UpdateConnectionInput)$/;

/** The member types a relationship operand's target can be, from its `where` (a create's target is concrete). */
function operandMembers(schema: GraphQLSchema, type: GraphQLInputObjectType): number {
  const where = type.getFields().where;
  return where ? memberCount(schema, where.type) : 1;
}

/**
 * The member type of the relationship an aggregate filter `key` aggregates, if it is one: `<field>Aggregate` beside a
 * relationship filter `<field>`, or `aggregate` in a connection filter.
 */
function aggregateTarget(type: GraphQLInputObjectType, key: string): GraphQLInputType | undefined {
  const fields = type.getFields();
  if (key === 'aggregate' && /ConnectionFilters$/.test(type.name)) return fields.some?.type;
  if (!key.endsWith('Aggregate')) return undefined;
  const relationship = fields[key.slice(0, -'Aggregate'.length)];
  const named = relationship && getNamedType(relationship.type);
  return named && isInputObjectType(named) ? named.getFields().some?.type : undefined;
}

/** The field a `where` key filters: the key without its operator suffix (`count_GT` filters `count`). */
function baseField(key: string): string {
  return key.replace(OPERATOR_SUFFIX, '');
}

/** The type a `<Target>Where` input filters, by name. */
function whereTarget(name: string): string | undefined {
  return name.endsWith('Where') ? name.slice(0, -'Where'.length) : undefined;
}

/** The node type a relationship filter's member type filters: `<Target>Where`, or a connection filter's `node`. */
function filteredType(schema: GraphQLSchema, type: GraphQLInputType): GraphQLNamedType | undefined {
  const named = getNamedType(type);
  if (!isInputObjectType(named)) return undefined;
  const fields = named.getFields();
  if (fields.node) return filteredType(schema, fields.node.type);
  const target = whereTarget(named.name);
  return target ? (schema.getType(target) ?? undefined) : undefined;
}

/**
 * The member types of a union's connection filter: it holds one `<…>ConnectionWhere` with a `node` per member type,
 * under the member's name.
 */
function unionConnectionMembers(schema: GraphQLSchema, type: GraphQLInputType): number {
  const named = getNamedType(type);
  if (!isInputObjectType(named) || named.getFields().node) return 0;
  return Object.values(named.getFields()).filter((field) => {
    const inner = getNamedType(field.type);
    return isObjectType(schema.getType(field.name)) && isInputObjectType(inner) && inner.getFields().node !== undefined;
  }).length;
}

/** Whether a relationship filter's member type filters nodes of an interface or union. */
function targetsAbstractType(schema: GraphQLSchema, type: GraphQLInputType): boolean {
  const target = filteredType(schema, type);
  return (target !== undefined && isAbstractType(target)) || unionConnectionMembers(schema, type) > 0;
}

/** How many types a relationship filter can match: the members of an interface or union, else 1. */
function memberCount(schema: GraphQLSchema, type: GraphQLInputType): number {
  const target = filteredType(schema, type);
  if (target && isAbstractType(target)) return Math.max(1, schema.getPossibleTypes(target).length);
  return Math.max(1, unionConnectionMembers(schema, type));
}
