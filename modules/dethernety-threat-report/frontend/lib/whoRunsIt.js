// The words for who runs an element, over what the snapshot froze at generate time (`doc.operation`). Pure, and free
// of dt-core values: the rules ran in the backend. It states a declaration and how it was decided, never a judgement.

export const WHO_RUNS_COPY = Object.freeze({
  title: 'Who runs it',
  vendorDeclared: 'A vendor, as declared',
  youDeclared: 'You (your organisation), as declared',
  vendorFromZone: 'A vendor, read from its Vendor zone; not declared',
  notDeclared: 'Not declared; treated as yours',
  invalid: 'The declared value is not valid; treated as yours',
  product: (name) => `Product: ${name}`,
  environmentVendor: (name) => `Its environment, ${name}: a vendor, as declared`,
  environmentYou: (name) => `Its environment, ${name}: you (your organisation), as declared`,
  environmentInvalid: (name) => `Its environment, ${name}: the declared value is not valid`,
  runsEnvironment: (count) =>
    `Declared as running the environment of ${count} component${count === 1 ? '' : 's'} drawn directly in it`,
  recreate: 'Recreate the report to see who runs each element',
  unavailable: 'Who runs it could not be worked out for this report',
  noneDeclared: 'No element declares who runs it.',
})

// `elements` is keyed by model-controlled ids: read own keys only.
function entryOf(operation, elementId) {
  const elements = operation?.elements
  if (!elements || typeof elements !== 'object') return null
  return Object.prototype.hasOwnProperty.call(elements, elementId) ? elements[elementId] : null
}

function operatorText(operator) {
  if (operator?.source === 'invalid') return WHO_RUNS_COPY.invalid
  if (operator?.source === 'zone') return WHO_RUNS_COPY.vendorFromZone
  if (operator?.source === 'declared') return operator.party === 'VENDOR' ? WHO_RUNS_COPY.vendorDeclared : WHO_RUNS_COPY.youDeclared
  return WHO_RUNS_COPY.notDeclared
}

function environmentText(hosting) {
  if (hosting.source === 'invalid') return WHO_RUNS_COPY.environmentInvalid(hosting.name)
  return hosting.party === 'VENDOR'
    ? WHO_RUNS_COPY.environmentVendor(hosting.name)
    : WHO_RUNS_COPY.environmentYou(hosting.name)
}

/** The texts for one resolved element, in order. */
export function entryTexts(entry) {
  const texts = [operatorText(entry.operator)]
  if (entry.product) texts.push(WHO_RUNS_COPY.product(entry.product))
  if (entry.drawnComponents) texts.push(WHO_RUNS_COPY.runsEnvironment(entry.drawnComponents))
  if (entry.hosting) texts.push(environmentText(entry.hosting))
  return texts
}

/**
 * The profile's block for a component or boundary. A snapshot from before this was gathered has no block, and asks to
 * be recreated rather than showing a default; `unavailable` says it could not be worked out. Both show no operator.
 *
 * @returns {{ state: 'resolved'|'recreate'|'unavailable', texts: string[] }}
 */
export function whoRunsItView(operation, elementId) {
  if (!operation || typeof operation !== 'object') return { state: 'recreate', texts: [WHO_RUNS_COPY.recreate] }
  const entry = operation.state === 'resolved' ? entryOf(operation, elementId) : null
  if (!entry) return { state: 'unavailable', texts: [WHO_RUNS_COPY.unavailable] }
  return { state: 'resolved', texts: entryTexts(entry) }
}

/** One line for the exposure detail; null when there is nothing resolved to say. */
export function whoRunsItLine(operation, elementId) {
  if (operation?.state !== 'resolved') return null
  const entry = entryOf(operation, elementId)
  return entry ? `${WHO_RUNS_COPY.title}: ${entryTexts(entry).join('. ')}.` : null
}

/** Whether there is more to say of an element than the default: the HTML export lists these. */
export function hasOperationToShow(entry) {
  return Boolean(entry) && (entry.operator?.source !== 'default' || Boolean(entry.product) || Boolean(entry.hosting))
}
