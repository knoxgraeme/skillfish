/**
 * Utility functions for skillfish CLI.
 * These are pure functions extracted for testability.
 */

import { normalize, isAbsolute, basename } from 'path';

/**
 * Validates a path to prevent directory traversal attacks.
 * Ensures path doesn't escape the intended directory.
 */
export function isValidPath(pathStr: string): boolean {
  // Reject absolute paths
  if (isAbsolute(pathStr)) return false;

  // Normalize and check for directory traversal
  const normalized = normalize(pathStr);
  if (normalized.startsWith('..') || normalized.includes('/../')) return false;

  // Only allow alphanumeric, dots, hyphens, underscores, and forward slashes
  if (!/^[\w./-]+$/.test(pathStr)) return false;

  // Reject paths that could be problematic
  if (pathStr.includes('//') || pathStr.startsWith('/')) return false;

  return true;
}

/**
 * Type for GitHub tree API item.
 */
export interface GitTreeItem {
  path: string;
  type: string;
  mode?: string;
  sha?: string;
  size?: number;
  url?: string;
}

/**
 * Type for GitHub tree API response.
 */
export interface GitTreeResponse {
  tree?: GitTreeItem[];
  sha?: string;
  url?: string;
  truncated?: boolean;
}

/**
 * Type guard for GitHub tree API response.
 * Validates the response structure at runtime.
 */
export function isGitTreeResponse(data: unknown): data is GitTreeResponse {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;

  // tree is optional, but if present must be an array
  if ('tree' in obj && obj.tree !== undefined) {
    if (!Array.isArray(obj.tree)) return false;
    // Validate each item has required fields
    for (const item of obj.tree) {
      if (typeof item !== 'object' || item === null) return false;
      const entry = item as Record<string, unknown>;
      if (typeof entry.path !== 'string') return false;
      if (typeof entry.type !== 'string') return false;
    }
  }
  return true;
}

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Extracts name and description fields with fallbacks.
 */
export function parseFrontmatter(content: string): { name?: string; description?: string } {
  // Match frontmatter block: ---\n...\n---
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const yaml = match[1];

  // Extract name (handles quoted and unquoted values)
  const nameMatch = yaml.match(/^name:\s*["']?(.+?)["']?\s*$/m);
  const name = nameMatch?.[1]?.trim();

  // Extract description (handles quoted and unquoted values)
  const descMatch = yaml.match(/^description:\s*["']?(.+?)["']?\s*$/m);
  const description = descMatch?.[1]?.trim();

  return { name, description };
}

/**
 * Derive skill name from path and repo name.
 */
export function deriveSkillName(skillPath: string, repoName: string): string {
  if (skillPath === 'SKILL.md' || skillPath === './SKILL.md') {
    return repoName;
  }

  const normalized = skillPath.replace(/\/SKILL\.md$/i, '');
  const name = basename(normalized);

  if (!/^[\w.-]+$/.test(name)) {
    return repoName;
  }

  return name;
}

/**
 * Convert kebab-case or snake_case to Title Case.
 * "skill-lookup" → "Skill Lookup"
 * "my_cool_skill" → "My Cool Skill"
 */
export function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Truncate text to a maximum length, adding ellipsis if needed.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trim() + '…';
}

/**
 * Extract SKILL.md paths from validated GitHub tree response.
 */
export function extractSkillPaths(data: GitTreeResponse, skillFilename = 'SKILL.md'): string[] {
  if (!data.tree) return [];
  return data.tree
    .filter((item) => item.type === 'blob' && item.path.endsWith(skillFilename))
    .map((item) => item.path);
}

/**
 * Sleep for a specified duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Process items with bounded concurrency.
 * Prevents overwhelming resources with unbounded parallel requests.
 *
 * @param items - Items to process
 * @param fn - Async function to apply to each item
 * @param concurrency - Maximum concurrent operations (default: 10)
 */
export async function batchMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 10,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex]);
    }
  }

  // Start workers up to concurrency limit
  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

// === JSON Output Types ===

/**
 * Common installed skill structure used across commands.
 */
export interface InstalledSkill {
  skill: string;
  agent: string;
  path: string;
  location?: 'global' | 'project';
}

/**
 * Base JSON output with fields common to all commands.
 * All command-specific types extend this for API consistency.
 */
export interface BaseJsonOutput {
  success: boolean;
  exit_code?: number;
  errors: string[];
}

/**
 * JSON output for the `add` command.
 */
export interface AddJsonOutput extends BaseJsonOutput {
  installed: InstalledSkill[];
  skipped: { skill: string; agent: string; reason: string }[];
  skills_found?: string[];
}

/**
 * JSON output for the `list` command.
 */
export interface ListJsonOutput extends BaseJsonOutput {
  installed: InstalledSkill[];
  agents_detected: string[];
}

/**
 * JSON output for the `remove` command.
 */
export interface RemoveJsonOutput extends BaseJsonOutput {
  removed: InstalledSkill[];
}

/**
 * Outdated skill information for update command.
 */
export interface OutdatedSkill {
  skill: string;
  agent: string;
  path: string;
  location: 'global' | 'project';
  localSha: string;
  remoteSha: string;
  source: string; // "owner/repo"
}

/**
 * JSON output for the `update` command.
 */
export interface UpdateJsonOutput extends BaseJsonOutput {
  outdated: OutdatedSkill[];
  updated: InstalledSkill[];
}

/** @deprecated Use AddJsonOutput instead */
export type JsonOutput = AddJsonOutput;

/**
 * Create a fresh JSON output object for the add command.
 */
export function createJsonOutput(): AddJsonOutput {
  return {
    success: true,
    installed: [],
    skipped: [],
    errors: [],
  };
}

/**
 * Check if stdout is a TTY (interactive terminal).
 */
export function isTTY(): boolean {
  return process.stdout.isTTY === true;
}

/**
 * Check if stdin is a TTY (interactive terminal).
 */
export function isInputTTY(): boolean {
  return process.stdin.isTTY === true;
}
