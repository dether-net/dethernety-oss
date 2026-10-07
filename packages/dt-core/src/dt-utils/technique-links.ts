import type { TechniqueLink } from '../interfaces/core-types-interface.js'

/** One `…Connection` selection of a relationship to MITRE nodes, with the edge's justification. */
export type TechniqueLinkConnection = {
  edges: Array<{ node: { id: string }; properties?: { justification?: string | null } | null }>
}

/** A connect entry for one MITRE link, carrying its justification on the edge when there is one. */
export function techniqueLinkConnect(link: TechniqueLink) {
  return {
    where: { node: { id: { eq: link.id } } },
    ...(link.justification != null ? { edge: { justification: link.justification } } : {}),
  }
}

/** The links of one `…Connection` selection, as target id and edge justification. */
export function fromLinkConnection(connection: TechniqueLinkConnection | undefined | null): TechniqueLink[] {
  return (connection?.edges ?? []).map(edge => ({
    id: edge.node.id,
    justification: edge.properties?.justification ?? null,
  }))
}
