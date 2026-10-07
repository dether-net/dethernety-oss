/**
 * The public page of a MITRE ATT&CK or ATLAS id, built the way the MITRE data's own `ref_url`
 * values are: attack.mitre.org splits a sub-technique into a path segment (T1003/001), while
 * atlas.mitre.org keeps the dotted id (AML.T0051.000).
 *
 * Returns null for anything else (D3FEND ids have no id-based URL; their pages are named).
 */
export function mitreUrl(id: string | null | undefined): string | null {
  if (!id) return null
  const attackTechnique = /^T(\d{4})(?:\.(\d{3}))?$/.exec(id)
  if (attackTechnique) {
    const [, base, sub] = attackTechnique
    return `https://attack.mitre.org/techniques/T${base}${sub ? `/${sub}` : ''}`
  }
  if (/^M\d{4}$/.test(id)) return `https://attack.mitre.org/mitigations/${id}`
  if (/^AML\.T\d{4}(\.\d{3})?$/.test(id)) return `https://atlas.mitre.org/techniques/${id}`
  if (/^AML\.M\d{4}$/.test(id)) return `https://atlas.mitre.org/mitigations/${id}`
  return null
}
