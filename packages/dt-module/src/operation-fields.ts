/**
 * The operation fields: three attributes the platform serves on every component and security-boundary
 * class template and guide, whatever module the class comes from. A component's operator says who
 * builds or runs its own software; a boundary's says who runs the execution environment of what is
 * drawn directly in it. The product and the version name the software.
 *
 * Both serving implementations ({@link DtFileOpaModule}, {@link DtRemoteModule}) extend a class's
 * own template and guide here, and remove every reserved attribute from evaluation input: no class
 * policy reads them, and they never leave the deployment in an evaluation request.
 *
 * dt-core holds the same keys and values with the rules that read them (its
 * `operation-determination` module). dt-core is ESM and this package is CommonJS, so the constants are
 * kept here as well; a test fails when the two copies differ.
 */

/** Who runs the element's own software (component) or the environment it draws (boundary). */
export const OPERATION_OPERATOR_KEY = 'dethernety_operated_by';
/** The vendor and product name. */
export const OPERATION_PRODUCT_KEY = 'dethernety_product';
/** The version the customer runs. Components only. */
export const OPERATION_VERSION_KEY = 'dethernety_product_version';

/** Every attribute key starting with this prefix (exact case) is reserved for platform-served fields. */
export const RESERVED_ATTRIBUTE_PREFIX = 'dethernety_';

export const OPERATOR_VALUES = Object.freeze(['CUSTOMER', 'VENDOR'] as const);

/** The class types that carry operation fields, and which fields each carries. */
export const OPERATION_FIELD_KEYS = Object.freeze({
  component: Object.freeze([OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY, OPERATION_VERSION_KEY] as const),
  securityBoundary: Object.freeze([OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY] as const),
});
export type OperatedClassType = keyof typeof OPERATION_FIELD_KEYS;

/** The label of the category the fields are served under, per class type. */
export const OPERATION_CATEGORY_LABEL: Readonly<Record<OperatedClassType, string>> = Object.freeze({
  component: 'Operation & version',
  securityBoundary: 'Operation',
});

const OPERATOR_TITLES: Record<(typeof OPERATOR_VALUES)[number], string> = {
  CUSTOMER: 'You (your organisation)',
  VENDOR: 'A vendor',
};

const isOperated = (classType: string | undefined): classType is OperatedClassType =>
  classType === 'component' || classType === 'securityBoundary';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isReserved = (key: unknown): boolean => typeof key === 'string' && key.startsWith(RESERVED_ATTRIBUTE_PREFIX);

/** Whether a uischema scope reaches a reserved key at any depth or through any combinator: JSONForms
 * binds a scope by its segments, so `#/allOf/0/properties/dethernety_x` reaches `dethernety_x` too. */
const scopeIsReserved = (scope: string): boolean =>
  scope.split('/').some((segment) => isReserved(segment.replace(/~1/g, '/').replace(/~0/g, '~')));

/**
 * The class type a class's `path` attribute names. The path is `<module>/<typeDir>/<class>`, so the
 * type is its second-to-last segment, whichever separator the host OS used.
 */
export function classTypeFromPath(classPath: string | undefined | null): string | undefined {
  if (typeof classPath !== 'string') return undefined;
  const segments = classPath.split(/[\\/]+/).filter(Boolean);
  return segments.length >= 2 ? segments[segments.length - 2] : undefined;
}

// ── Template ─────────────────────────────────────────────────────────────────────────────────

function properties(classType: OperatedClassType): Record<string, unknown> {
  const operatorDescription =
    classType === 'component'
      ? 'Who builds or runs the software of this element: you, or a vendor whose service you use.'
      : 'Who runs the execution environment of what is drawn directly in this boundary: you, or a vendor.';
  const props: Record<string, unknown> = {
    [OPERATION_OPERATOR_KEY]: {
      type: 'string',
      title: 'Operated by',
      description: operatorDescription,
      oneOf: OPERATOR_VALUES.map((value) => ({ const: value, title: OPERATOR_TITLES[value] })),
    },
    [OPERATION_PRODUCT_KEY]: {
      type: 'string',
      title: 'Product',
      description: 'The vendor and product name, for example "PostgreSQL" or the name of the service you use.',
      maxLength: 200,
    },
  };
  if (classType === 'component') {
    props[OPERATION_VERSION_KEY] = {
      type: 'string',
      title: 'Version',
      description: 'The version you run. Not asked for an element a vendor operates.',
      maxLength: 64,
    };
  }
  return props;
}

function category(classType: OperatedClassType): Record<string, unknown> {
  const control = (key: string) => ({ type: 'Control', scope: `#/properties/${key}` });
  const elements: unknown[] = [
    { type: 'HorizontalLayout', elements: [control(OPERATION_OPERATOR_KEY), control(OPERATION_PRODUCT_KEY)] },
  ];
  if (classType === 'component') {
    elements.push({
      ...control(OPERATION_VERSION_KEY),
      rule: { effect: 'HIDE', condition: { scope: `#/properties/${OPERATION_OPERATOR_KEY}`, schema: { const: 'VENDOR' } } },
    });
  }
  return { type: 'Category', label: OPERATION_CATEGORY_LABEL[classType], elements };
}

/** A uischema element without the Controls that point at a reserved key, and without the layouts that
 * held only those. `null` when nothing of it is left. Elements that hold none are returned as they are. */
function withoutReservedControls(element: unknown): unknown {
  if (!isRecord(element)) return element;
  if (element.type === 'Control' && typeof element.scope === 'string') {
    return scopeIsReserved(element.scope) ? null : element;
  }
  const children = element.elements;
  if (!Array.isArray(children)) return element;
  const kept = children.map(withoutReservedControls).filter((e) => e !== null);
  const changed = kept.length !== children.length || kept.some((e, i) => e !== children[i]);
  if (!changed) return element;
  return kept.length === 0 ? null : { ...element, elements: kept };
}

/**
 * The template with the operation fields of its class type: the properties after the existing ones,
 * and one category after the existing categories. The platform owns the reserved prefix, so anything a
 * template itself declares under it (properties, `required` entries, Controls) is replaced by the
 * platform's own; applying this twice gives the same result as once. Anything else is returned as it
 * came: a class type without fields, or a template without `schema.properties` or without a root
 * `Categorization`. `required` keeps its other entries; the fields are optional.
 *
 * The result shares the input's nested objects that it does not change, so a caller should hand it a
 * template it owns, such as a fresh parse.
 */
export function withOperationFields(template: unknown, classType: string | undefined): unknown {
  if (!isOperated(classType) || !isRecord(template)) return template;
  const schema = template.schema;
  const uischema = template.uischema;
  if (!isRecord(schema) || !isRecord(schema.properties)) return template;
  if (!isRecord(uischema) || uischema.type !== 'Categorization' || !Array.isArray(uischema.elements)) return template;

  const own = Object.fromEntries(Object.entries(schema.properties).filter(([key]) => !isReserved(key)));
  const nextSchema: Record<string, unknown> = { ...schema, properties: { ...own, ...properties(classType) } };
  if (Array.isArray(schema.required) && schema.required.some(isReserved)) {
    nextSchema.required = schema.required.filter((key) => !isReserved(key));
  }
  const categories = uischema.elements.map(withoutReservedControls).filter((e) => e !== null);
  return { ...template, schema: nextSchema, uischema: { ...uischema, elements: [...categories, category(classType)] } };
}

// ── Guide ────────────────────────────────────────────────────────────────────────────────────

// The guide panel keys a field's steps by `type`, so each step of one field has its own.
const step = (type: string, instruction: string) => ({
  type,
  instruction,
  command: null,
  file_path: null,
  navigation: null,
  expected_output: null,
});

/**
 * Appended to every operation-field guide entry: a tool that fills each empty field would otherwise write "unknown"
 * or a guess, which reads as an answer.
 */
export const LEAVE_EMPTY_UNLESS_KNOWN = 'Leave this field empty unless you know the answer: never enter "unknown" or a guess.';

function guideEntries(classType: OperatedClassType): Record<string, unknown>[] {
  const operator =
    classType === 'component'
      ? {
          option_description:
            'Who builds or runs the software of this element. Choose a vendor when a vendor builds and runs it and you hold only the settings it offers, as with a hosted service you configure. Choose yourself when you build or run it, including when you build it on a vendor\'s platform.',
          how_to_obtain: [
            step('note', 'Check the contract or the service description: who runs the software, and which settings it offers you.'),
            step('process_audit', 'Ask who builds, deploys and patches it: your own teams, or the vendor.'),
          ],
        }
      : {
          option_description:
            'Who runs the execution environment of what is drawn directly in this boundary, such as the hosts, the hypervisors or the platform runtime. Draw each element in the boundary that runs its environment.',
          how_to_obtain: [
            step('note', 'Check who runs the hosts or the platform this boundary stands for: your own teams, or a cloud or software vendor.'),
          ],
        };
  const entries: Record<string, unknown>[] = [
    {
      option_name: OPERATION_OPERATOR_KEY,
      ...operator,
      security_impact:
        'Decides who can act on a finding: a setting you hold, or a matter of the vendor\'s assurance. Settings a vendor offers you stay yours either way.',
      typical_values: [...OPERATOR_VALUES],
      value_type: 'enum',
    },
    {
      option_name: OPERATION_PRODUCT_KEY,
      option_description: 'The vendor and product name of this element\'s software or service.',
      security_impact: 'Names whom to ask for assurance about a vendor-run element.',
      how_to_obtain: [
        step('config_file', 'Read it from the container image or package name, the deployment manifest, or the contract.'),
      ],
      typical_values: [],
      value_type: 'string',
    },
  ];
  if (classType === 'component') {
    entries.push({
      option_name: OPERATION_VERSION_KEY,
      option_description: 'The version of the software you run. Not asked for an element a vendor operates.',
      security_impact: 'Ties the element to the releases and fixes that apply to it.',
      how_to_obtain: [
        step('config_file', 'Read the exact version from the image tag, the lockfile or package manifest, the Helm chart\'s appVersion, or the Terraform lock file.'),
        step('note', 'A floating tag such as "latest" or a version range is not a version; record the version it resolves to.'),
      ],
      typical_values: [],
      value_type: 'string',
    });
  }
  return entries.map((entry) => ({ ...entry, option_description: `${entry.option_description} ${LEAVE_EMPTY_UNLESS_KNOWN}` }));
}

/**
 * The guide with one entry per operation field of its class type appended, in place of any entry the
 * guide itself has for a reserved key. A guide that is not an array is returned as it came.
 */
export function withOperationGuide(guide: unknown, classType: string | undefined): unknown {
  if (!isOperated(classType) || !Array.isArray(guide)) return guide;
  const own = guide.filter((entry) => !(isRecord(entry) && isReserved(entry.option_name)));
  return [...own, ...guideEntries(classType)];
}

/**
 * Served template or guide text with the operation fields of its class type. Text that does not
 * parse, or that the fields leave as it was, is returned with its exact bytes.
 */
export function withOperationContent(kind: 'template' | 'guide', content: string, classType: string | undefined): string {
  if (!isOperated(classType)) return content;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }
  const extended = kind === 'template' ? withOperationFields(parsed, classType) : withOperationGuide(parsed, classType);
  return extended === parsed ? content : JSON.stringify(extended);
}

// ── Evaluation input ─────────────────────────────────────────────────────────────────────────

/** The attributes without any reserved key (including the flattened list forms of one). */
export function withoutReservedAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  if (!Object.keys(attributes).some(isReserved)) return attributes;
  return Object.fromEntries(Object.entries(attributes).filter(([key]) => !isReserved(key)));
}
