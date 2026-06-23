/**
 * Manifest handling for skill tracking.
 * Each installed skill has a .skillfish.json file that tracks its origin.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { isValidName } from './constants.js';
import { isValidPath } from '../utils.js';

// === Constants ===

export const MANIFEST_FILENAME = '.skillfish.json';
export const MANIFEST_VERSION = 2;

/** Supported manifest versions for reading (we write latest only) */
const SUPPORTED_VERSIONS = [1, 2] as const;

/** Git SHA format: 40 hexadecimal characters */
const SHA_PATTERN = /^[a-f0-9]{40}$/;

/** Git branch name pattern (alphanumerics, dots, hyphens, underscores, slashes) */
const BRANCH_PATTERN = /^[\w./-]+$/;

/** Git ref pattern for tags, branches, or commit SHAs (more permissive than branch) */
const REF_PATTERN = /^[\w./@-]+$/;

/** Maximum length for ref strings */
const MAX_REF_LENGTH = 255;

// === Types ===

/** How a skill was installed */
export type SkillSource = 'manifest' | 'manual';

/**
 * Manifest schema for tracking installed skills.
 * Stored in .skillfish.json within each skill directory.
 */
export interface SkillManifest {
  /** Schema version for future migrations */
  version: 1 | 2;
  /** Installed directory name (added in v2, used for matching) */
  name?: string;
  /** Git provider - defaults to 'github' for backwards compatibility */
  provider?: string;
  /** Repository owner (or namespace for GitLab) */
  owner: string;
  /** Repository name */
  repo: string;
  /** Path within repo (e.g., "skills/my-skill" or ".") - used for downloads */
  path: string;
  /** Branch at install time */
  branch: string;
  /** Tree SHA at install time (from git/trees response) */
  sha: string;
  /** User's pinned ref (e.g., "v1.0.0", "main") - preserves original request */
  ref?: string;
  /** How the skill was installed - defaults to 'manual' for backwards compatibility */
  source?: SkillSource;
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
 * Write manifest to a skill directory atomically.
 * Uses temp file + rename pattern to prevent partial writes from being visible.
 *
 * @param skillDir - Path to the skill directory
 * @param manifest - Manifest data to write
 */
export function writeManifest(skillDir: string, manifest: SkillManifest): void {
  const manifestPath = join(skillDir, MANIFEST_FILENAME);
  const tempPath = join(skillDir, `.${MANIFEST_FILENAME}.tmp.${process.pid}`);
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
 * Check if a skill directory has a manifest.
 *
 * @param skillDir - Path to the skill directory
 * @returns true if manifest exists
 */
export function hasManifest(skillDir: string): boolean {
  return existsSync(join(skillDir, MANIFEST_FILENAME));
}

/**
 * Build a canonical key for matching skills.
 * Format: "owner/repo/path" where path is "." for root skills.
 * This key uniquely identifies a skill's source location.
 *
 * @param manifest - Skill manifest
 * @returns Canonical key string
 */
export function getManifestKey(manifest: SkillManifest): string {
  return `${manifest.owner}/${manifest.repo}/${manifest.path}`;
}

/**
 * Build a canonical key from parsed skill entry components.
 * Format: "owner/repo/path" where path is "." for root skills.
 *
 * @param owner - GitHub repository owner
 * @param repo - GitHub repository name
 * @param path - Path within repo (or undefined for root)
 * @returns Canonical key string
 */
export function buildManifestKey(owner: string, repo: string, path?: string): string {
  return `${owner}/${repo}/${path ?? '.'}`;
}

/**
 * Attempt to heal an invalid manifest file.
 * Reads the file loosely, fixes known issues (like old source format),
 * upgrades v1 to v2 (adding name field), rewrites it, and returns the healed manifest.
 *
 * @param skillDir - Path to the skill directory
 * @returns Healed manifest or null if unrecoverable
 */
export function healManifest(skillDir: string): SkillManifest | null {
  const manifestPath = join(skillDir, MANIFEST_FILENAME);

  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const content = readFileSync(manifestPath, 'utf-8');
    const data = JSON.parse(content) as Record<string, unknown>;

    // Check version is supported (v1 or v2)
    if (!SUPPORTED_VERSIONS.includes(data.version as 1 | 2)) {
      return null;
    }

    // Check if it has the basic required fields
    if (
      typeof data.owner !== 'string' ||
      typeof data.repo !== 'string' ||
      typeof data.path !== 'string' ||
      typeof data.branch !== 'string' ||
      typeof data.sha !== 'string'
    ) {
      return null; // Missing required fields, can't heal
    }

    // Validate owner/repo/path/branch/sha content
    if (!isValidName(data.owner) || !isValidName(data.repo)) {
      return null;
    }
    if (data.path !== '.' && !isValidPath(data.path)) {
      return null;
    }

    // Fix source field if it's not a valid value
    let source: SkillSource | undefined;
    if (data.source === 'manifest' || data.source === 'manual') {
      source = data.source;
    } else if (typeof data.source === 'string') {
      // Old format like "github:owner/repo/path#branch" - treat as manual
      source = 'manual';
    }

    // Derive name from directory if not present (v1 to v2 migration)
    const dirName = basename(skillDir);
    const name = typeof data.name === 'string' && isValidName(data.name) ? data.name : dirName;

    // Build the healed manifest (always upgrade to latest version)
    const healed: SkillManifest = {
      version: MANIFEST_VERSION,
      name,
      owner: data.owner,
      repo: data.repo,
      path: data.path,
      branch: data.branch,
      sha: data.sha,
    };

    // Preserve provider if valid
    if (
      typeof data.provider === 'string' &&
      data.provider.length > 0 &&
      data.provider.length <= 64 &&
      /^[\w.-]+$/.test(data.provider)
    ) {
      healed.provider = data.provider;
    }

    // Validate and preserve ref if valid
    if (typeof data.ref === 'string') {
      if (REF_PATTERN.test(data.ref) && data.ref.length <= MAX_REF_LENGTH) {
        healed.ref = data.ref;
      }
      // Invalid refs are silently dropped during healing
    }
    if (source) {
      healed.source = source;
    }

    // Write the healed manifest back
    writeManifest(skillDir, healed);

    return healed;
  } catch {
    return null;
  }
}

/**
 * Type guard to validate manifest structure and content.
 * Validates both field types and content to prevent tampered manifests
 * from causing unintended API requests or file operations.
 * Supports both v1 and v2 manifests for backwards compatibility.
 */
function isValidManifest(data: unknown): data is SkillManifest {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  // Check version is supported
  if (!SUPPORTED_VERSIONS.includes(obj.version as 1 | 2)) {
    return false;
  }

  // Check required field types
  if (
    typeof obj.owner !== 'string' ||
    typeof obj.repo !== 'string' ||
    typeof obj.path !== 'string' ||
    typeof obj.branch !== 'string' ||
    typeof obj.sha !== 'string'
  ) {
    return false;
  }

  // Validate optional fields if present
  if (obj.ref !== undefined && typeof obj.ref !== 'string') {
    return false;
  }
  if (obj.source !== undefined && obj.source !== 'manifest' && obj.source !== 'manual') {
    return false;
  }
  // name is optional in v1, but if present must be valid
  if (obj.name !== undefined && (typeof obj.name !== 'string' || !isValidName(obj.name))) {
    return false;
  }
  // provider is optional; if present must be a non-empty string of safe characters
  if (
    obj.provider !== undefined &&
    (typeof obj.provider !== 'string' ||
      obj.provider.length === 0 ||
      obj.provider.length > 64 ||
      !/^[\w.-]+$/.test(obj.provider))
  ) {
    return false;
  }

  // Validate content to prevent tampered manifests
  const { owner, repo, path, branch, sha, ref } = obj;

  // Owner and repo must be valid GitHub names
  if (!isValidName(owner) || !isValidName(repo)) {
    return false;
  }

  // Path must be safe (no traversal) - "." is valid for root
  if (path !== '.' && !isValidPath(path)) {
    return false;
  }

  // Branch must match git branch pattern
  if (!BRANCH_PATTERN.test(branch) || branch.length > 255) {
    return false;
  }

  // SHA must be valid git SHA format (40 hex chars)
  if (!SHA_PATTERN.test(sha)) {
    return false;
  }

  // Ref must match git ref pattern if present (tags, branches, or commit SHAs)
  if (ref !== undefined) {
    // Allow semver tags (v1.0.0), branches (main, feature/foo), and short/full SHAs
    if (!REF_PATTERN.test(ref) || ref.length > 255) {
      return false;
    }
  }

  return true;
}
