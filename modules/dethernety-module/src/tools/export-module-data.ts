/**
 * Export module class data from Neo4j/Memgraph database to CSV files.
 *
 * This script connects to the database, queries for all classes provided by
 * a module (via MODULE_PROVIDES_CLASS relationship), and exports them to
 * CSV files that can be loaded via LOAD CSV.
 *
 * Usage:
 *   npx tsx src/tools/export-module-data.ts --module dethernety
 *   npx tsx src/tools/export-module-data.ts --module dethernety --output ./dist/data
 *
 * Environment variables:
 *   NEO4J_URI      - Database URI (default: bolt://localhost:7687)
 *   NEO4J_USERNAME - Username (default: neo4j)
 *   NEO4J_PASSWORD - Password (default: password)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import neo4j, { Driver, Session } from 'neo4j-driver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database configuration from environment
const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USERNAME = process.env.NEO4J_USERNAME || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD;
if (!NEO4J_PASSWORD) {
  console.warn('Warning: NEO4J_PASSWORD not set. Set it via environment variable.');
}

// Class types to export
const CLASS_TYPES = [
  'DTComponentClass',
  'DTControlClass',
  'DTDataFlowClass',
  'DTSecurityBoundaryClass',
  'DTIssueClass',
  'DTDataClass'
] as const;

type ClassType = typeof CLASS_TYPES[number];

interface ClassRecord {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type?: string;
  template?: string;
  configurationOptionsGuide?: string;
  regoPolicies?: string;
}

interface ModuleInfo {
  name: string;
  version: string;
  description: string;
  author: string;
  icon: string;
}

/**
 * Escape a value for CSV format (RFC 4180 compliant)
 */
function escapeCSV(value: string | undefined | null): string {
  if (value === undefined || value === null) {
    return '';
  }
  const str = String(value);
  // If the value contains quotes, commas, or newlines, wrap in quotes and escape internal quotes
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Base64 encode a string to preserve newlines through Memgraph's LOAD CSV
 * Memgraph's CSV parser corrupts multiline strings, so we encode them
 */
function base64Encode(value: string | undefined | null): string {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  return Buffer.from(value, 'utf-8').toString('base64');
}

/**
 * Parse command line arguments
 */
function parseArgs(): { moduleName: string; outputDir: string } {
  const args = process.argv.slice(2);
  let moduleName = '';
  let outputDir = path.join(__dirname, '../../dist/data');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--module' || args[i] === '-m') {
      moduleName = args[++i];
    } else if (args[i] === '--output' || args[i] === '-o') {
      outputDir = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: npx tsx src/tools/export-module-data.ts [options]

Options:
  --module, -m <name>   Module name to export (required)
  --output, -o <dir>    Output directory (default: ./dist/data)
  --help, -h            Show this help message

Environment variables:
  NEO4J_URI             Database URI (default: bolt://localhost:7687)
  NEO4J_USERNAME        Username (default: neo4j)
  NEO4J_PASSWORD        Password (default: password)

Example:
  npx tsx src/tools/export-module-data.ts --module dethernety
`);
      process.exit(0);
    }
  }

  if (!moduleName) {
    console.error('Error: --module is required');
    console.error('Usage: npx tsx src/tools/export-module-data.ts --module <name>');
    process.exit(1);
  }

  return { moduleName, outputDir };
}

/**
 * Query module info from database
 */
async function getModuleInfo(session: Session, moduleName: string): Promise<ModuleInfo | null> {
  const result = await session.run(
    `MATCH (m:DTModule {name: $name})
     RETURN m.name as name, m.version as version, m.description as description,
            m.author as author, m.icon as icon`,
    { name: moduleName }
  );

  if (result.records.length === 0) {
    return null;
  }

  const record = result.records[0];
  return {
    name: record.get('name'),
    version: record.get('version') || '1.0.0',
    description: record.get('description') || '',
    author: record.get('author') || '',
    icon: record.get('icon') || 'system'
  };
}

/**
 * Query classes of a specific type from the database
 */
async function getClassesByType(
  session: Session,
  moduleName: string,
  classType: ClassType
): Promise<ClassRecord[]> {
  const result = await session.run(
    `MATCH (m:DTModule {name: $moduleName})-[:MODULE_PROVIDES_CLASS]->(c:${classType})
     RETURN c.id as id, c.name as name, c.description as description,
            c.category as category, c.type as type, c.template as template,
            c.configurationOptionsGuide as configurationOptionsGuide,
            c.regoPolicies as regoPolicies`,
    { moduleName }
  );

  return result.records.map(record => ({
    id: record.get('id'),
    name: record.get('name'),
    description: record.get('description'),
    category: record.get('category'),
    type: record.get('type'),
    template: record.get('template'),
    configurationOptionsGuide: record.get('configurationOptionsGuide'),
    regoPolicies: record.get('regoPolicies')
  }));
}

/**
 * Write a CSV file for a class type
 */
function writeCSV(outputDir: string, classType: string, records: ClassRecord[]): void {
  const filePath = path.join(outputDir, `${classType}.csv`);

  // CSV headers
  const headers = ['id', 'name', 'description', 'category', 'type', 'template', 'configurationOptionsGuide', 'regoPolicies'];

  const lines: string[] = [];
  lines.push(headers.join(','));

  for (const record of records) {
    const row = [
      escapeCSV(record.id),
      escapeCSV(record.name),
      escapeCSV(record.description),
      escapeCSV(record.category),
      escapeCSV(record.type),
      escapeCSV(record.template),
      // Base64 encode the guide to preserve newlines through Memgraph's LOAD CSV
      escapeCSV(base64Encode(record.configurationOptionsGuide)),
      // Base64 encode regoPolicies to preserve newlines through Memgraph's LOAD CSV
      escapeCSV(base64Encode(record.regoPolicies))
    ];
    lines.push(row.join(','));
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  console.log(`  Written: ${classType}.csv (${records.length} records)`);
}

/**
 * Generate the module Cypher script
 */
function writeModuleCypher(outputDir: string, moduleInfo: ModuleInfo): void {
  const filePath = path.join(outputDir, '01-module.cypher');
  // Note: No // comments - Memgraph mgconsole doesn't handle them when piped via stdin
  const content = `MERGE (m:DTModule {name: '${moduleInfo.name}'})
SET m.description = '${moduleInfo.description.replace(/'/g, "\\'")}',
    m.version = '${moduleInfo.version}',
    m.author = '${moduleInfo.author.replace(/'/g, "\\'")}',
    m.icon = '${moduleInfo.icon}',
    m.updatedAt = datetime();
`;

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`  Written: 01-module.cypher`);
}

/**
 * Generate the classes loading Cypher script
 */
function writeClassesCypher(outputDir: string, moduleName: string, classTypes: ClassType[]): void {
  const filePath = path.join(outputDir, '02-classes.cypher');
  // Note: No // comments - Memgraph mgconsole doesn't handle them when piped via stdin

  let content = '';

  for (const classType of classTypes) {
    // Memgraph syntax: LOAD CSV FROM ... WITH HEADER AS row
    // Path: /var/lib/memgraph/import/{moduleName}/{classType}.csv
    content += `LOAD CSV FROM '/var/lib/memgraph/import/${moduleName}/${classType}.csv' WITH HEADER AS row
MERGE (c:${classType} {id: row.id})
SET c.name = row.name,
    c.description = row.description,
    c.category = row.category,
    c.type = row.type,
    c.template = row.template,
    c.configurationOptionsGuide = row.configurationOptionsGuide,
    c.regoPolicies = row.regoPolicies
WITH c
MATCH (m:DTModule {name: '${moduleName}'})
MERGE (m)-[:MODULE_PROVIDES_CLASS]->(c);

`;
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`  Written: 02-classes.cypher`);
}

async function main(): Promise<void> {
  const { moduleName, outputDir } = parseArgs();

  console.log('Exporting module data from database...');
  console.log(`  Module: ${moduleName}`);
  console.log(`  Database: ${NEO4J_URI}`);
  console.log(`  Output: ${outputDir}`);

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Connect to database
  const driver: Driver = neo4j.driver(
    NEO4J_URI,
    neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD)
  );

  const session: Session = driver.session();

  try {
    // Get module info
    const moduleInfo = await getModuleInfo(session, moduleName);
    if (!moduleInfo) {
      console.error(`Error: Module '${moduleName}' not found in database`);
      process.exit(1);
    }

    console.log(`\n  Found module: ${moduleInfo.name} v${moduleInfo.version}`);
    console.log(`  Description: ${moduleInfo.description}`);

    // Write module Cypher script
    console.log('\nGenerating Cypher scripts...');
    writeModuleCypher(outputDir, moduleInfo);

    // Export each class type
    console.log('\nExporting class data...');
    const exportedTypes: ClassType[] = [];

    for (const classType of CLASS_TYPES) {
      const records = await getClassesByType(session, moduleName, classType);
      if (records.length > 0) {
        writeCSV(outputDir, classType, records);
        exportedTypes.push(classType);
      }
    }

    // Write classes loading Cypher script (only for types that have data)
    writeClassesCypher(outputDir, moduleName, exportedTypes);

    console.log('\nExport complete!');
    console.log(`  Total class types exported: ${exportedTypes.length}`);

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
