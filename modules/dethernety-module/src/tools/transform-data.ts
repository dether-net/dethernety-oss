/**
 * Transform dethernety.json data into CSV files for Memgraph LOAD CSV ingestion.
 *
 * The source JSON file contains multi-line JSON objects with structure:
 * { m: DTModule node, l: relationship, c: class node }
 *
 * This script outputs separate CSV files per class type:
 * - DTComponentClass.csv
 * - DTControlClass.csv
 * - DTDataFlowClass.csv
 * - DTSecurityBoundaryClass.csv
 * - DTIssueClass.csv
 * - DTDataClass.csv
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ClassProperties {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type?: string;
  template?: string;
  configurationOptionsGuide?: string;
  regoPolicies?: string;
  __elementId__?: string;
}

interface ClassNode {
  id: number;
  labels: string[];
  properties: ClassProperties;
  type: string;
}

interface Record {
  m: any;  // DTModule node
  l: any;  // relationship
  c: ClassNode;  // class node
}

const CLASS_TYPES = [
  'DTComponentClass',
  'DTControlClass',
  'DTDataFlowClass',
  'DTSecurityBoundaryClass',
  'DTIssueClass',
  'DTDataClass'
];

/**
 * Escape a value for CSV format (RFC 4180 compliant)
 */
function escapeCSV(value: string | undefined): string {
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
function base64Encode(value: string | undefined): string {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  return Buffer.from(value, 'utf-8').toString('base64');
}

/**
 * Parse multi-line JSON file where objects are separated by newlines
 */
function parseMultiLineJSON(content: string): Record[] {
  const records: Record[] = [];

  // Split by '}\n{' pattern to separate JSON objects
  // This handles the multi-line JSON format where each object spans multiple lines
  const objectStrings = content.split(/\}\s*\n\s*\{/);

  for (let i = 0; i < objectStrings.length; i++) {
    let objStr = objectStrings[i];

    // Fix the split - add back braces
    if (i === 0) {
      objStr = objStr + '}';
    } else if (i === objectStrings.length - 1) {
      objStr = '{' + objStr;
    } else {
      objStr = '{' + objStr + '}';
    }

    try {
      const record = JSON.parse(objStr) as Record;
      records.push(record);
    } catch (e) {
      console.error(`Failed to parse JSON object at index ${i}:`, e);
    }
  }

  return records;
}

/**
 * Group records by class type
 */
function groupByClassType(records: Record[]): Map<string, ClassProperties[]> {
  const grouped = new Map<string, ClassProperties[]>();

  // Initialize empty arrays for all class types
  for (const classType of CLASS_TYPES) {
    grouped.set(classType, []);
  }

  for (const record of records) {
    if (record.c && record.c.labels) {
      for (const label of record.c.labels) {
        if (CLASS_TYPES.includes(label)) {
          const classes = grouped.get(label)!;
          classes.push(record.c.properties);
        }
      }
    }
  }

  return grouped;
}

/**
 * Write a CSV file for a class type
 */
function writeCSV(outputDir: string, classType: string, records: ClassProperties[]): void {
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
  console.log(`  Written: ${filePath} (${records.length} records)`);
}

function main(): void {
  const projectRoot = path.resolve(__dirname, '../..');
  const inputFile = path.join(projectRoot, 'data', 'dethernety.json');
  const outputDir = path.join(projectRoot, 'dist', 'data');

  console.log('Transforming dethernety.json to CSV files...');
  console.log(`  Input: ${inputFile}`);
  console.log(`  Output: ${outputDir}`);

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Read and parse the JSON file
  const content = fs.readFileSync(inputFile, 'utf8');
  const records = parseMultiLineJSON(content);
  console.log(`  Parsed ${records.length} records`);

  // Group by class type
  const grouped = groupByClassType(records);

  // Write CSV files
  for (const [classType, classRecords] of grouped) {
    if (classRecords.length > 0) {
      writeCSV(outputDir, classType, classRecords);
    }
  }

  console.log('Done!');
}

main();
