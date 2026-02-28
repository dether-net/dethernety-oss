/**
 * File Utilities for Dethereal MCP Server
 *
 * Provides file backup and manipulation utilities.
 */

import { promises as fs } from 'fs'
import path from 'path'

/**
 * Create a versioned backup of a file with timestamp
 *
 * @param filePath - The file to backup
 * @returns The path to the backup file, or null if backup was skipped (file doesn't exist)
 */
export async function createVersionedBackup(filePath: string): Promise<string | null> {
  try {
    // Check if file exists
    await fs.access(filePath)
  } catch {
    // File doesn't exist, skip backup
    return null
  }

  // Generate backup filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.dirname(filePath)
  const ext = path.extname(filePath)
  const base = path.basename(filePath, ext)
  const backupPath = path.join(dir, `${base}.${timestamp}${ext}`)

  // Copy file to backup location
  await fs.copyFile(filePath, backupPath)

  return backupPath
}

/**
 * Read a JSON file and parse it
 *
 * @param filePath - Path to the JSON file
 * @returns Parsed JSON content
 */
export async function readJsonFile(filePath: string): Promise<any> {
  const content = await fs.readFile(filePath, 'utf-8')
  return JSON.parse(content)
}

/**
 * Write JSON to a file with optional indentation
 *
 * @param filePath - Path to write to
 * @param data - Data to write
 * @param indent - JSON indentation (default: 2)
 */
export async function writeJsonFile(
  filePath: string,
  data: any,
  indent: number = 2
): Promise<void> {
  const content = JSON.stringify(data, null, indent)
  await fs.writeFile(filePath, content, 'utf-8')
}

/**
 * Ensure a directory exists, creating it if necessary
 *
 * @param dirPath - Directory path to ensure
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

/**
 * Check if a path exists
 *
 * @param filePath - Path to check
 * @returns True if the path exists
 */
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Get file stats safely
 *
 * @param filePath - Path to check
 * @returns File stats or null if not found
 */
export async function getFileStats(filePath: string): Promise<import('fs').Stats | null> {
  try {
    return await fs.stat(filePath)
  } catch {
    return null
  }
}
