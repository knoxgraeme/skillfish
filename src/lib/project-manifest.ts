/**
 * Project manifest handling for declarative skill installation.
 * Reads/writes skillfish.json at project or global level.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join, dirname, basename } from 'path';
import { isValidName } from './constants.js';
import { isValidPath } from '../utils.js';

// === Constants ===

export const PROJECT_MANIFEST_FILENAME = 'skillfish.json';
export const PROJECT_MANIFEST_VERSION = 1;

// === Types ===

/**
 * Project manifest schema for declarative skill installation.
 * Stored in skillfish.json at project root or home directory.
 */
export interface ProjectManifest {
  /** Schema version for future migrations */
  version: 1;
  /** Array of skill entries: "owner/repo[@ref][/path]" */
  skills: string[];
}

/**
 * Parsed skill entry from manifest.
 */
export interface ParsedSkillEntry {
  /** GitHub repository owner */
  owner: string;
  /** GitHub repository name */
  repo: string;
  /** User's pinned ref (tag, branch, or commit SHA) */
  ref?: string;
  /** Path within repo to skill directory */
  path?: string;
  /** Original entry string for error messages */
  original: string;
}

/**
 * Result of parsing a skill entry.
 */
export type ParseResult =
  | { success: true; entry: ParsedSkillEntry }
  | { success: false; error: string; original: string };

/**
 * Collision between two skill entries.
 */
export interface SkillCollision {
  /** The derived skill name that would collide */
  name: string;
  /** First entry that uses this name */
  entry1: string;
  /** Second entry that uses this name */
  entry2: string;
}

// === Functions ===

/**
 * Get the path to the project manifest file.
 *
 * @param global - If true, returns path to ~/skillfish.json
 * @returns Path to the manifest file
 */
export function getProjectManifestPath(global: boolean): string {
  const baseDir = global ? homedir() : process.cwd();
  return join(baseDir, PROJECT_MANIFEST_FILENAME);
}

/**
 * Read and parse a project manifest file.
 *
 * @param manifestPath - Path to the manifest file
 * @returns Parsed manifest or null if not found/invalid
 */
export function readProjectManifest(manifestPath: string): ProjectManifest | null {
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const content = readFileSync(manifestPath, 'utf-8');
    const data = JSON.parse(content) as unknown;

    if (!isValidProjectManifest(data)) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Write a project manifest file atomically.
 * Uses temp file + rename pattern to prevent partial writes from being visible.
 *
 * @param manifestPath - Path to write the manifest
 * @param manifest - Manifest data to write
 */
export function writeProjectManifest(manifestPath: string, manifest: ProjectManifest): void {
  const dir = dirname(manifestPath);
  const tempPath = join(dir, `.${basename(manifestPath)}.tmp.${process.pid}`);
  const content = JSON.stringify(manifest, null, 2);

  try {
    // Write to temp file first
    writeFileSync(tempPath, content, 'utf-8');
    // Atomic rename (on POSIX systems)
    renameSync(tempPath, manifestPath);
  } catch (err) {
    // Clean up temp file on failure
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Parse a skill entry string into its components.
 *
 * Supports formats:
 * - owner/repo
 * - owner/repo@v1.0.0
 * - owner/repo@main
 * - owner/repo/path/to/skill
 * - owner/repo@v2.0.0/path/to/skill
 *
 * Note: When using @ref/path format, the ref cannot contain slashes.
 * For branch names with slashes, omit the path component.
 *
 * @param entry - Skill entry string
 * @returns Parsed entry or error
 */
export function parseSkillEntry(entry: string): ParseResult {
  if (!entry || typeof entry !== 'string') {
    return { success: false, error: 'Empty or invalid entry', original: entry };
  }

  const trimmed = entry.trim();
  if (!trimmed) {
    return { success: false, error: 'Empty entry', original: entry };
  }

  // Split on @ to separate ref (owner/repo@ref or owner/repo@ref/path)
  const atIndex = trimmed.indexOf('@');

  let ref: string | undefined;
  let path: string | undefined;
  let owner: string;
  let repo: string;

  if (atIndex !== -1) {
    // Format: owner/repo@ref[/path]
    const ownerRepoPart = trimmed.slice(0, atIndex);
    const refAndPath = trimmed.slice(atIndex + 1);

    // Parse owner/repo
    const slashIndex = ownerRepoPart.indexOf('/');
    if (slashIndex === -1) {
      return { success: false, error: 'Missing owner/repo format', original: entry };
    }

    owner = ownerRepoPart.slice(0, slashIndex);
    repo = ownerRepoPart.slice(slashIndex + 1);

    if (!owner || !repo) {
      return { success: false, error: 'Missing owner or repo', original: entry };
    }

    if (!isValidName(owner)) {
      return { success: false, error: `Invalid owner name: ${owner}`, original: entry };
    }

    if (!isValidName(repo)) {
      return { success: false, error: `Invalid repo name: ${repo}`, original: entry };
    }

    // Parse ref and optional path
    // First slash after @ separates ref from path
    const refSlashIndex = refAndPath.indexOf('/');
    if (refSlashIndex !== -1) {
      ref = refAndPath.slice(0, refSlashIndex);
      path = refAndPath.slice(refSlashIndex + 1);
    } else {
      ref = refAndPath;
    }

    // Validate ref
    if (!ref || !/^[\w.@-]+$/.test(ref)) {
      return { success: false, error: `Invalid ref: ${ref}`, original: entry };
    }
  } else {
    // Format: owner/repo[/path]
    // Split into parts and take first two as owner/repo
    const parts = trimmed.split('/');

    if (parts.length < 2) {
      return { success: false, error: 'Missing owner/repo format', original: entry };
    }

    owner = parts[0];
    repo = parts[1];

    if (!owner || !repo) {
      return { success: false, error: 'Missing owner or repo', original: entry };
    }

    if (!isValidName(owner)) {
      return { success: false, error: `Invalid owner name: ${owner}`, original: entry };
    }

    if (!isValidName(repo)) {
      return { success: false, error: `Invalid repo name: ${repo}`, original: entry };
    }

    // Remaining parts form the path
    if (parts.length > 2) {
      path = parts.slice(2).join('/');
    }
  }

  // Validate path if present
  if (path && !isValidPath(path)) {
    return { success: false, error: `Invalid path: ${path}`, original: entry };
  }

  return {
    success: true,
    entry: {
      owner,
      repo,
      ref,
      path,
      original: entry,
    },
  };
}

/**
 * Derive the skill directory name from a parsed entry.
 * This is the name that will be used in the agent's skills directory.
 *
 * @param entry - Parsed skill entry
 * @returns Directory name for the skill
 * @throws Error if derived name is invalid
 */
export function deriveSkillDirName(entry: ParsedSkillEntry): string {
  let name: string;
  if (entry.path) {
    // Use the last component of the path
    const parts = entry.path.split('/');
    name = parts[parts.length - 1];
  } else {
    // Use repo name for root-level skills
    name = entry.repo;
  }

  // Validate derived name to prevent hidden directories or invalid names
  if (!isValidName(name)) {
    throw new Error(`Invalid skill name derived from entry: ${name}`);
  }

  return name;
}

/**
 * Format a parsed entry back to its canonical string form.
 *
 * @param entry - Parsed skill entry
 * @returns Formatted entry string
 */
export function formatSkillEntry(entry: ParsedSkillEntry): string {
  let result = `${entry.owner}/${entry.repo}`;
  if (entry.ref) {
    result += `@${entry.ref}`;
  }
  if (entry.path) {
    result += `/${entry.path}`;
  }
  return result;
}

/**
 * Detect name collisions between skill entries.
 * Two entries collide if they would install to the same directory name.
 *
 * @param entries - Array of skill entry strings
 * @returns Array of collisions found
 */
export function detectCollisions(entries: string[]): SkillCollision[] {
  const collisions: SkillCollision[] = [];
  const nameToEntry = new Map<string, string>();

  for (const entry of entries) {
    const result = parseSkillEntry(entry);
    if (!result.success) {
      continue; // Skip invalid entries (they'll be reported elsewhere)
    }

    const name = deriveSkillDirName(result.entry);
    const existing = nameToEntry.get(name);

    if (existing) {
      collisions.push({
        name,
        entry1: existing,
        entry2: entry,
      });
    } else {
      nameToEntry.set(name, entry);
    }
  }

  return collisions;
}

/**
 * Parse all entries from a manifest, returning valid entries and errors.
 *
 * @param manifest - Project manifest
 * @returns Parsed entries and any errors
 */
export function parseAllEntries(manifest: ProjectManifest): {
  entries: ParsedSkillEntry[];
  errors: string[];
} {
  const entries: ParsedSkillEntry[] = [];
  const errors: string[] = [];

  for (const entry of manifest.skills) {
    const result = parseSkillEntry(entry);
    if (result.success) {
      entries.push(result.entry);
    } else {
      errors.push(`${result.original}: ${result.error}`);
    }
  }

  return { entries, errors };
}

// === Private Functions ===

/**
 * Type guard to validate project manifest structure.
 */
function isValidProjectManifest(data: unknown): data is ProjectManifest {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  if (obj.version !== PROJECT_MANIFEST_VERSION) {
    return false;
  }

  if (!Array.isArray(obj.skills)) {
    return false;
  }

  // All skills must be strings
  for (const skill of obj.skills) {
    if (typeof skill !== 'string') {
      return false;
    }
  }

  return true;
}
