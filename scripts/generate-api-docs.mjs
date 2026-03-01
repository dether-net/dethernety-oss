#!/usr/bin/env node

/**
 * Generates markdown API documentation from the GraphQL schema.
 * Reads descriptions from GraphQL's native """...""" and "..." syntax.
 *
 * Usage: node scripts/generate-api-docs.mjs
 * Output: docs/architecture/backend/GRAPHQL_API_REFERENCE.md
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// Resolve graphql from the dt-ws workspace where it's installed
const { parse } = require(join(dirname(fileURLToPath(import.meta.url)), '..', 'apps/dt-ws/node_modules/graphql'))

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SCHEMA_PATH = join(ROOT, 'apps/dt-ws/schema/schema.graphql')
const OUTPUT_PATH = join(ROOT, 'docs/architecture/backend/GRAPHQL_API_REFERENCE.md')

// --- SDL parsing ---

const sdl = readFileSync(SCHEMA_PATH, 'utf8')
const doc = parse(sdl)

/**
 * Get the description string from an AST node.
 */
function getDescription(node) {
  return node?.description?.value || null
}

/**
 * Format a GraphQL type reference as a readable string.
 */
function formatType(typeNode) {
  if (!typeNode) return 'unknown'
  switch (typeNode.kind) {
    case 'NonNullType':
      return formatType(typeNode.type) + '!'
    case 'ListType':
      return '[' + formatType(typeNode.type) + ']'
    case 'NamedType':
      return typeNode.name.value
    default:
      return 'unknown'
  }
}

/**
 * Extract the relationship type from @relationship directive, if present.
 */
function getRelationship(field) {
  const dir = field.directives?.find(d => d.name.value === 'relationship')
  if (!dir) return null
  const typeArg = dir.arguments?.find(a => a.name.value === 'type')
  const dirArg = dir.arguments?.find(a => a.name.value === 'direction')
  return {
    type: typeArg?.value?.value,
    direction: dirArg?.value?.value
  }
}

/**
 * Check if field has @customResolver directive.
 */
function isCustomResolver(field) {
  return field.directives?.some(d => d.name.value === 'customResolver') ?? false
}

/**
 * Check if field has @cypher directive.
 */
function hasCypher(field) {
  return field.directives?.some(d => d.name.value === 'cypher') ?? false
}

// --- Categorize definitions ---

const enums = []
const interfaces = []
const coreTypes = []
const classTypes = []
const mitreTypes = []
const utilityTypes = []
const queries = []
const mutations = []
const subscriptions = []

for (const def of doc.definitions) {
  const name = def.name?.value
  if (!name) continue

  switch (def.kind) {
    case 'EnumTypeDefinition':
      enums.push(def)
      break

    case 'InterfaceTypeDefinition':
      interfaces.push(def)
      break

    case 'ObjectTypeDefinition':
      if (name === 'Query') {
        for (const field of def.fields ?? []) {
          queries.push(field)
        }
      } else if (name === 'Mutation') {
        for (const field of def.fields ?? []) {
          mutations.push(field)
        }
      } else if (name === 'Subscription') {
        for (const field of def.fields ?? []) {
          subscriptions.push(field)
        }
      } else if (name.startsWith('Mitre')) {
        mitreTypes.push(def)
      } else if (name.endsWith('Class')) {
        classTypes.push(def)
      } else if (['AnalysisStatus', 'DeletionStats', 'Session', 'AddElementsToIssueResult', 'ResponseMetadata', 'AIResponse', 'IssueElement'].includes(name)) {
        utilityTypes.push(def)
      } else {
        coreTypes.push(def)
      }
      break
  }
}

// --- Markdown generation ---

const out = []

function emit(line = '') {
  out.push(line)
}

function emitFieldsTable(fields) {
  emit('| Field | Type | Description |')
  emit('|-------|------|-------------|')

  for (const field of fields) {
    const name = field.name.value
    const type = formatType(field.type)
    const rel = getRelationship(field)
    const custom = isCustomResolver(field)
    const cypher = hasCypher(field)

    // Get description from AST
    let desc = getDescription(field)

    // Add notes for special directives
    const notes = []
    if (rel) notes.push(`${rel.direction === 'OUT' ? '→' : '←'} \`${rel.type}\``)
    if (custom) notes.push('custom resolver')
    if (cypher && !rel && !desc?.toLowerCase().includes('computed')) notes.push('computed')

    let description = desc || ''
    if (notes.length > 0) {
      const noteStr = notes.join(', ')
      description = description ? `${description} (${noteStr})` : noteStr
    }

    emit(`| \`${name}\` | \`${type}\` | ${description} |`)
  }
  emit('')
}

function emitArgs(args) {
  if (!args || args.length === 0) return
  emit('')
  emit('**Arguments:**')
  emit('')
  emit('| Argument | Type |')
  emit('|----------|------|')
  for (const arg of args) {
    emit(`| \`${arg.name.value}\` | \`${formatType(arg.type)}\` |`)
  }
  emit('')
}

function emitTypeSection(def) {
  const name = def.name.value
  emit(`### ${name}`)
  emit('')

  // Type description from AST
  const desc = getDescription(def)
  if (desc) {
    emit(desc)
    emit('')
  }

  // Interfaces
  const ifaces = def.interfaces?.map(i => i.name.value) ?? []
  if (ifaces.length > 0) {
    emit(`Implements: ${ifaces.map(i => `\`${i}\``).join(', ')}`)
    emit('')
  }

  // Fields
  const fields = def.fields ?? []
  if (fields.length > 0) {
    emitFieldsTable(fields)
  }
}

// --- Assemble document ---

emit('# GraphQL API reference')
emit('')
emit('> Auto-generated from [`schema.graphql`](../../../apps/dt-ws/schema/schema.graphql).')
emit('> Regenerate with `pnpm docs:api`.')
emit('')
emit('> **For frontend and MCP integrations:** prefer the `dt-core` TypeScript library')
emit('> (`packages/dt-core/`) over raw GraphQL queries. dt-core wraps every call with')
emit('> retry logic, mutex protection, and request deduplication.')
emit('> See [Data Access Layer](../dt-core/DATA_ACCESS_LAYER.md).')
emit('')
emit('---')
emit('')

// Table of contents
emit('## Contents')
emit('')
emit('- [Enums](#enums)')
emit('- [Interfaces](#interfaces)')
emit('- [Core types](#core-types)')
emit('- [Class types](#class-types)')
emit('- [MITRE framework types](#mitre-framework-types)')
emit('- [Utility types](#utility-types)')
emit('- [Queries](#queries)')
emit('- [Mutations](#mutations)')
emit('- [Subscription](#subscription)')
emit('')
emit('---')
emit('')

// Enums
emit('## Enums')
emit('')
for (const def of enums) {
  const name = def.name.value
  emit(`### ${name}`)
  emit('')
  const desc = getDescription(def)
  if (desc) {
    emit(desc)
    emit('')
  }
  emit('| Value | Description |')
  emit('|-------|-------------|')
  for (const val of def.values ?? []) {
    const valDesc = getDescription(val) || ''
    emit(`| \`${val.name.value}\` | ${valDesc} |`)
  }
  emit('')
}

// Interfaces
emit('## Interfaces')
emit('')
for (const def of interfaces) {
  emitTypeSection(def)
}

// Core types
emit('## Core types')
emit('')
for (const def of coreTypes) {
  emitTypeSection(def)
}

// Class types
emit('## Class types')
emit('')
emit('Class types define the categories available within modules. Components, data flows,')
emit('security boundaries, controls, data items, analyses, and issues are all instances of')
emit('their respective class types.')
emit('')
for (const def of classTypes) {
  emitTypeSection(def)
}

// MITRE types
emit('## MITRE framework types')
emit('')
emit('Types for MITRE ATT&CK techniques/tactics/mitigations and D3FEND techniques/tactics.')
emit('')
for (const def of mitreTypes) {
  emitTypeSection(def)
}

// Utility types
emit('## Utility types')
emit('')
emit('Helper types used as return values or nested structures.')
emit('')
for (const def of utilityTypes) {
  emitTypeSection(def)
}

// Queries
emit('## Queries')
emit('')
emit('All queries require authentication (`@authentication`).')
emit('')
for (const field of queries) {
  const name = field.name.value
  emit(`### ${name}`)
  emit('')
  const desc = getDescription(field)
  if (desc) {
    emit(desc)
    emit('')
  }
  emit(`**Returns:** \`${formatType(field.type)}\``)
  emitArgs(field.arguments)
}

// Mutations
emit('## Mutations')
emit('')
emit('All mutations require authentication (`@authentication`).')
emit('')
for (const field of mutations) {
  const name = field.name.value
  emit(`### ${name}`)
  emit('')
  const desc = getDescription(field)
  if (desc) {
    emit(desc)
    emit('')
  }
  emit(`**Returns:** \`${formatType(field.type)}\``)
  emitArgs(field.arguments)
}

// Subscription
emit('## Subscription')
emit('')
emit('Subscription auth is enforced by `JwtAuthGuard` on the controller, not by')
emit('the `@authentication` directive (which `@neo4j/graphql` does not support on subscriptions).')
emit('')
for (const field of subscriptions) {
  const name = field.name.value
  emit(`### ${name}`)
  emit('')
  const desc = getDescription(field)
  if (desc) {
    emit(desc)
    emit('')
  }
  emit(`**Returns:** \`${formatType(field.type)}\``)
  emitArgs(field.arguments)
}

// Write output
const content = out.join('\n') + '\n'
writeFileSync(OUTPUT_PATH, content)

const typeCount = coreTypes.length + classTypes.length + mitreTypes.length + utilityTypes.length + interfaces.length
console.log(`Generated ${OUTPUT_PATH}`)
console.log(`  ${enums.length} enums, ${typeCount} types, ${queries.length} queries, ${mutations.length} mutations, ${subscriptions.length} subscriptions`)
