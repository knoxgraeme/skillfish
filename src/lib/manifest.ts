/**
 * Manifest handling for skill tracking.
 * Each installed skill has a .skillfish.json file that tracks its origin.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// === Constants ===

export const MANIFEST_FILENAME = '.skillfish.json';
export const MANIFEST_VERSION = 1;

// === Types ===

/**
 * Manifest schema for tracking installed skills.
 * Stored in .skillfish.json within each skill directory.
 */
export interface SkillManifest {
  /** Schema version for future migrations */
  version: 1;
  /** GitHub repository owner */
  owner: string;
  /** GitHub repository name */
  repo: string;
  /** Path within repo (e.g., "skills/my-skill" or ".") */
  path: string;
  /** Branch at install time */
  branch: string;
  /** Tree SHA at install time (from git/trees response) */
  sha: string;
}

// === Functions ===

/**
 * Read manifest from a skill directory.
 *
 * @param skillDir - Path to the skill directory
 * @returns Parsed manifest or null if not found/invalid
 */
export function readManifest(skillDir: string): SkillManifest | null {
  const manifestPath = join(skillDir, MANIFEST_FILENAME);

  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const content = readFileSync(manifestPath, 'utf-8');
    const data = JSON.parse(content) as unknown;

    // Validate manifest structure
    if (!isValidManifest(data)) {
      return null;
    }

    return data;
  } catch {
    // JSON parse error or file read error
    return null;
  }
}

/**
 * Write manifest to a skill directory.
 *
 * @param skillDir - Path to the skill directory
 * @param manifest - Manifest data to write
 */
export function writeManifest(skillDir: string, manifest: SkillManifest): void {
  const manifestPath = join(skillDir, MANIFEST_FILENAME);
  const content = JSON.stringify(manifest, null, 2);
  writeFileSync(manifestPath, content, 'utf-8');
}

/**
 * Check if a skill directory has a manifest.
 *
 * @param skillDir - Path to the skill directory
 * @returns true if manifest exists
 */
export function hasManifest(skillDir: string): boolean {
  return existsSync(join(skillDir, MANIFEST_FILENAME));
}

/**
 * Type guard to validate manifest structure.
 */
function isValidManifest(data: unknown): data is SkillManifest {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  return (
    obj.version === MANIFEST_VERSION &&
    typeof obj.owner === 'string' &&
    typeof obj.repo === 'string' &&
    typeof obj.path === 'string' &&
    typeof obj.branch === 'string' &&
    typeof obj.sha === 'string'
  );
}
