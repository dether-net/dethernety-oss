/**
 * The name an imported model is given: the name in its archive, or, when a model of that name is already in the
 * folder it lands in, the next free "<name> (n)". Names compare trimmed and without regard to case, as a reader
 * would tell two models apart. A name that already ends in " (n)" counts on from its base.
 */
export function suggestModelName (name: string, taken: string[]): string {
  const wanted = name.trim()
  const used = new Set(taken.map(t => t.trim().toLowerCase()))
  if (!used.has(wanted.toLowerCase())) return wanted
  const base = wanted.replace(/ \(\d+\)$/, '')
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}
