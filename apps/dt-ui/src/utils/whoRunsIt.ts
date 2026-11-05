import { hostingOf, operatorOf, OPERATION_PRODUCT_KEY } from '@dethernety/dt-core'
import type { HostingResolution, OperationAttributeBag, OperatorResolution, Zone } from '@dethernety/dt-core'

/**
 * The "Who runs it" line: what an element's saved declaration says about who runs it and who runs its environment,
 * through dt-core's own rules. It states the declaration and how it was decided, and never a judgement. The version
 * is not read: it stays in the form.
 */

/** The element's own declaration: still loading, read, failed to read, not read (no template), or no class to read. */
export type OwnReadState = 'loading' | 'read' | 'failed' | 'not-read' | 'no-class'

/** The parent boundary's declaration: nothing to read (no hosting possible), loading, read, or failed to read. */
export type ParentReadState = 'none' | 'loading' | 'read' | 'failed'

/** Every word the line shows. */
export const WHO_RUNS_COPY = {
  label: 'Who runs it',
  vendorDeclared: 'A vendor, as declared',
  youDeclared: 'You (your organisation), as declared',
  vendorFromZone: 'A vendor, read from its Vendor zone; not declared',
  notDeclared: 'Not declared; treated as yours',
  invalid: 'The declared value is not valid; treated as yours',
  reading: 'Reading the declaration…',
  notRead: 'The declaration could not be read',
  product: (name: string) => `Product: ${name}`,
  environmentVendor: (name: string) => `Its environment, ${name}: a vendor, as declared`,
  environmentYou: (name: string) => `Its environment, ${name}: you (your organisation), as declared`,
  environmentInvalid: (name: string) => `Its environment, ${name}: the declared value is not valid`,
  environmentNotRead: (name: string) => `Its environment, ${name}: the declaration could not be read`,
  runsEnvironment: (count: number) =>
    `Declared as running the environment of ${count} component${count === 1 ? '' : 's'} drawn directly in it`,
  unavailable: "This class's attributes are not available here",
} as const

/** The longest product text shown; the field allows 200 characters, and nothing enforces it on a direct write. */
const PRODUCT_MAX = 200

/** The product the bag names: trimmed, in Unicode NFC, cut to `PRODUCT_MAX`; none for anything but a non-empty string. */
export function productOf(bag: OperationAttributeBag): string | undefined {
  const value = bag?.[OPERATION_PRODUCT_KEY]
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value.trim().normalize('NFC').slice(0, PRODUCT_MAX)
}

const hasElementOfType = (element: unknown, type: string): boolean => {
  if (!element || typeof element !== 'object') return false
  const e = element as { type?: unknown; elements?: unknown }
  if (e.type === type) return true
  return Array.isArray(e.elements) && e.elements.some((child) => hasElementOfType(child, type))
}

/**
 * Whether a class template is the notice a remote module serves when the class's content is not available to the
 * caller: no properties and only labels. Its stored declaration still reads, so the line can show it.
 */
export function isUnavailableNotice(template: unknown): boolean {
  if (!template || typeof template !== 'object') return false
  const { schema, uischema } = template as { schema?: { properties?: unknown }; uischema?: unknown }
  const properties = schema?.properties
  if (!properties || typeof properties !== 'object' || Object.keys(properties).length > 0) return false
  return hasElementOfType(uischema, 'Label') && !hasElementOfType(uischema, 'Control')
}

const operatorText = (operator: OperatorResolution): string => {
  if (operator.source === 'invalid') return WHO_RUNS_COPY.invalid
  if (operator.source === 'zone') return WHO_RUNS_COPY.vendorFromZone
  if (operator.source === 'declared') return operator.party === 'VENDOR' ? WHO_RUNS_COPY.vendorDeclared : WHO_RUNS_COPY.youDeclared
  return WHO_RUNS_COPY.notDeclared
}

const environmentText = (hosting: HostingResolution, name: string): string | undefined => {
  if (hosting.source === 'undeclared') return undefined
  if (hosting.source === 'invalid') return WHO_RUNS_COPY.environmentInvalid(name)
  return hosting.party === 'VENDOR' ? WHO_RUNS_COPY.environmentVendor(name) : WHO_RUNS_COPY.environmentYou(name)
}

export interface WhoRunsItInput {
  kind: 'component' | 'boundary'
  ownState: OwnReadState
  /** The element's stored attributes, as saved. */
  ownBag: OperationAttributeBag
  /** The zone the element's own operator can fall back on. */
  effectiveZone: Zone
  /** Whether the class's template is the not-available notice. */
  unavailable?: boolean
  /** Components: the parent boundary when it is classed and not the model's root. */
  parent?: { id: string; name: string; state: ParentReadState; bag?: OperationAttributeBag }
  /** Boundaries: the components drawn directly in it; none for the model's root, which never hosts. */
  drawnComponents?: number
}

/** The texts of the line, in order. */
export function whoRunsItTexts(input: WhoRunsItInput): string[] {
  const texts: string[] = []
  if (input.ownState === 'loading') {
    texts.push(WHO_RUNS_COPY.reading)
  } else if (input.ownState === 'failed' || input.ownState === 'not-read') {
    texts.push(WHO_RUNS_COPY.notRead)
  } else {
    const bags = input.ownState === 'read' ? [input.ownBag] : []
    const operator = operatorOf({ bags, effectiveZone: input.effectiveZone })
    texts.push(operatorText(operator))
    const product = input.ownState === 'read' ? productOf(input.ownBag) : undefined
    if (product) texts.push(WHO_RUNS_COPY.product(product))
    if (input.kind === 'boundary' && operator.source === 'declared' && operator.party === 'VENDOR' && input.drawnComponents) {
      texts.push(WHO_RUNS_COPY.runsEnvironment(input.drawnComponents))
    }
  }

  if (input.kind === 'component' && input.parent) {
    const { id, name, state, bag } = input.parent
    if (state === 'failed') {
      texts.push(WHO_RUNS_COPY.environmentNotRead(name))
    } else if (state === 'read') {
      const environment = environmentText(hostingOf({ id, classed: true, isDefaultBoundary: false, bags: [bag] }), name)
      if (environment) texts.push(environment)
    }
  }
  if (input.unavailable) texts.push(WHO_RUNS_COPY.unavailable)
  return texts
}
