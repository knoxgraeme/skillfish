/**
 * Skill installation logic.
 * Handles downloading, validating, and installing skills to agent directories.
 */

import {
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
  lstatSync,
  readdirSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { join, dirname, resolve } from 'path';
import { randomUUID } from 'crypto';
import degit from 'degit';
import type { Agent } from './agents.js';
import { SKILL_FILENAME, fetchWithRetry } from './github.js';
import { isValidPath, isGitTreeResponse } from '../utils.js';

// === Types ===

export interface InstallResult {
  installed: Array<{ skill: string; agent: string; path: string }>;
  skipped: Array<{ skill: string; agent: string; reason: string }>;
  warnings: string[];
  failed: boolean;
  failureReason?: string;
}

export interface InstallOptions {
  force: boolean;
  baseDir: string;
  /** Branch to clone from. If not specified, degit will use default branch detection. */
  branch?: string;
}

/**
 * Validates a branch name for safe use in degit paths.
 * Git branch names can contain alphanumerics, dots, hyphens, underscores, and slashes.
 * We explicitly reject '#' which is used as a delimiter in degit syntax.
 */
function isValidBranchName(branch: string): boolean {
  if (!branch || branch.length > 255) return false;
  // Allow alphanumerics, dots, hyphens, underscores, and slashes (for feature branches)
  // Reject anything else, especially '#' which would break degit parsing
  return /^[\w./-]+$/.test(branch) && !branch.includes('#');
}

export interface CopyResult {
  warnings: string[];
}

// === Error Types ===

/**
 * Thrown when SKILL.md is not found in downloaded content.
 */
export class SkillMdNotFoundError extends Error {
  constructor(public skillPath: string) {
    super(`${SKILL_FILENAME} not found in downloaded content. Path may be incorrect.`);
    this.name = 'SkillMdNotFoundError';
  }
}

// === Functions ===

/**
 * Maximum number of files to download via GitHub API fallback.
 * Prevents excessive API calls for unexpectedly large directories.
 */
const MAX_FILES_TO_DOWNLOAD = 100;

/**
 * Fallback download using GitHub API when degit fails.
 * Uses the tree API to list files, then downloads each via raw.githubusercontent.com.
 * This is more reliable for large repos where degit's ref resolution can fail.
 *
 * SECURITY: Validates all file paths to prevent directory traversal attacks.
 */
async function downloadViaGitHubApi(
  owner: string,
  repo: string,
  subPath: string,
  branch: string,
  destDir: string
): Promise<void> {
  const headers = { 'User-Agent': 'skillfish' };

  // URL-encode branch name to handle special characters safely
  const encodedBranch = encodeURIComponent(branch);

  // Get the tree for the specific path
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodedBranch}?recursive=1`;
  const treeRes = await fetchWithRetry(treeUrl, { headers });

  if (!treeRes.ok) {
    throw new Error(`Failed to fetch repository tree: ${treeRes.status}`);
  }

  const treeData: unknown = await treeRes.json();

  // Validate response structure at runtime
  if (!isGitTreeResponse(treeData)) {
    throw new Error('Invalid tree response from GitHub API');
  }

  if (!treeData.tree || treeData.tree.length === 0) {
    throw new Error('Empty tree response from GitHub API');
  }

  // Warn if tree is truncated (very large repos)
  if (treeData.truncated) {
    // Continue anyway - we'll get what we can
  }

  // Filter to files within our target path
  const prefix = subPath ? `${subPath}/` : '';
  const targetFiles = treeData.tree.filter(
    (item) =>
      item.type === 'blob' &&
      (subPath === '' || item.path === subPath || item.path.startsWith(prefix))
  );

  if (targetFiles.length === 0) {
    throw new Error(`No files found at path: ${subPath || '(root)'}`);
  }

  // Limit file count to prevent excessive downloads
  if (targetFiles.length > MAX_FILES_TO_DOWNLOAD) {
    throw new Error(
      `Too many files (${targetFiles.length}) at path. Maximum is ${MAX_FILES_TO_DOWNLOAD}.`
    );
  }

  // Resolve destDir once for security checks
  const resolvedDestDir = resolve(destDir);

  // Download each file
  for (const file of targetFiles) {
    // Calculate relative path from subPath
    const relativePath = subPath ? file.path.slice(prefix.length) : file.path;

    // SECURITY: Validate relative path to prevent directory traversal
    if (!isValidPath(relativePath)) {
      throw new Error(`Invalid file path in repository: ${file.path}`);
    }

    const destPath = resolve(destDir, relativePath);

    // SECURITY: Double-check that resolved path is within destDir
    if (!destPath.startsWith(resolvedDestDir + '/') && destPath !== resolvedDestDir) {
      throw new Error(`Path traversal detected: ${file.path}`);
    }

    // URL-encode file path for the raw URL
    const encodedFilePath = file.path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodedBranch}/${encodedFilePath}`;
    const fileRes = await fetchWithRetry(rawUrl, { headers }, 2);

    if (!fileRes.ok) {
      throw new Error(`Failed to download ${file.path}: ${fileRes.status}`);
    }

    // Use arrayBuffer for binary-safe file handling
    const buffer = Buffer.from(await fileRes.arrayBuffer());

    // Create parent directories
    mkdirSync(dirname(destPath), { recursive: true, mode: 0o700 });
    writeFileSync(destPath, buffer, { mode: 0o600 });
  }
}

/**
 * Recursively copies a directory while skipping symlinks for security.
 * This prevents symlink attacks where malicious repos could link to sensitive files.
 *
 * SECURITY: Uses double-check pattern to minimize TOCTOU race window.
 * The second lstatSync check immediately before cpSync reduces (but doesn't
 * eliminate) the window for a race condition attack.
 *
 * @returns CopyResult with any warnings generated during copy
 */
export function safeCopyDir(src: string, dest: string): CopyResult {
  const warnings: string[] = [];

  function copyRecursive(srcPath: string, destPath: string): void {
    mkdirSync(destPath, { recursive: true, mode: 0o700 });

    const entries = readdirSync(srcPath, { withFileTypes: true });
    for (const entry of entries) {
      const entrySrc = join(srcPath, entry.name);
      const entryDest = join(destPath, entry.name);

      // First check: Skip symlinks for security
      if (entry.isSymbolicLink()) {
        warnings.push(`Skipped symlink: ${entry.name}`);
        continue;
      }

      if (entry.isDirectory()) {
        copyRecursive(entrySrc, entryDest);
      } else if (entry.isFile()) {
        // SECURITY: Second check immediately before copy to minimize TOCTOU window
        // This doesn't eliminate the race but significantly reduces the attack window
        try {
          const stat = lstatSync(entrySrc);
          if (stat.isSymbolicLink()) {
            warnings.push(`Skipped symlink (detected on copy): ${entry.name}`);
            continue;
          }
          cpSync(entrySrc, entryDest);
        } catch (err) {
          // File may have been removed/changed between readdir and copy
          warnings.push(
            `Could not copy ${entry.name}: ${err instanceof Error ? err.message : 'unknown error'}`
          );
        }
      }
    }
  }

  copyRecursive(src, dest);
  return { warnings };
}

/**
 * Download and install a skill to multiple agent directories.
 *
 * @param owner - GitHub repository owner
 * @param repo - GitHub repository name
 * @param skillPath - Path to skill within repository (or SKILL.md for root)
 * @param skillName - Name to use for the installed skill directory
 * @param agents - List of agents to install to
 * @param options - Installation options (force, baseDir)
 * @returns InstallResult with details of what was installed/skipped
 */
export async function installSkill(
  owner: string,
  repo: string,
  skillPath: string,
  skillName: string,
  agents: readonly Agent[],
  options: InstallOptions
): Promise<InstallResult> {
  const result: InstallResult = {
    installed: [],
    skipped: [],
    warnings: [],
    failed: false,
  };

  const { force, baseDir, branch } = options;

  const tmpDir = join(homedir(), '.cache', 'skillfish', `${owner}-${repo}-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });

  try {
    // Download skill
    // Build degit path: owner/repo[/subpath][#branch]
    const downloadPath = skillPath === SKILL_FILENAME ? '' : skillPath;
    let degitPath = downloadPath ? `${owner}/${repo}/${downloadPath}` : `${owner}/${repo}`;

    // Append branch if specified (critical for repos with non-standard default branches like 'canary')
    // Validate branch name to prevent injection attacks via malformed branch names
    if (branch) {
      if (!isValidBranchName(branch)) {
        throw new Error(`Invalid branch name: ${branch}`);
      }
      degitPath = `${degitPath}#${branch}`;
    }

    // Try degit first, fall back to GitHub API if it fails
    try {
      const emitter = degit(degitPath, { cache: false, force: true });
      await emitter.clone(tmpDir);
    } catch (degitErr) {
      // Degit can fail on large repos - try GitHub API fallback
      const degitErrMsg = degitErr instanceof Error ? degitErr.message : String(degitErr);
      if (degitErrMsg.includes('could not find commit hash') && branch) {
        // Use GitHub API as fallback
        await downloadViaGitHubApi(owner, repo, downloadPath, branch, tmpDir);
      } else {
        // Re-throw if it's not a recoverable degit error
        throw degitErr;
      }
    }

    // Validate download
    const skillMdPath = join(tmpDir, SKILL_FILENAME);
    if (!existsSync(skillMdPath)) {
      throw new SkillMdNotFoundError(skillPath);
    }

    // Copy to each agent directory
    for (const agent of agents) {
      const destDir = join(baseDir, agent.dir, skillName);

      if (existsSync(destDir) && !force) {
        result.skipped.push({
          skill: skillName,
          agent: agent.name,
          reason: 'Already exists (use --force to overwrite)',
        });
        continue;
      }

      // Create parent directory and remove existing if force
      mkdirSync(join(baseDir, agent.dir), { recursive: true, mode: 0o700 });
      if (existsSync(destDir)) {
        rmSync(destDir, { recursive: true });
      }

      // Use safe copy to skip symlinks (security: prevents symlink attacks)
      const copyResult = safeCopyDir(tmpDir, destDir);
      result.warnings.push(...copyResult.warnings.map((w) => `${skillName}: ${w}`));

      result.installed.push({
        skill: skillName,
        agent: agent.name,
        path: destDir,
      });
    }
  } catch (err: unknown) {
    result.failed = true;
    if (err instanceof SkillMdNotFoundError) {
      result.failureReason = err.message;
    } else {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Provide more helpful error messages for common degit failures
      // Match "could not find commit hash for HEAD" or "could not find commit hash for <branch>"
      if (errMsg.includes('could not find commit hash')) {
        const branchInfo = branch ? ` (branch: ${branch})` : '';
        result.failureReason = `Could not clone repository. The branch or path may not exist, or there may be a network issue. Tried: ${owner}/${repo}${skillPath !== SKILL_FILENAME ? `/${skillPath}` : ''}${branchInfo}`;
      } else if (errMsg.includes('404')) {
        result.failureReason = `Repository or path not found: ${owner}/${repo}${skillPath !== SKILL_FILENAME ? `/${skillPath}` : ''}`;
      } else {
        result.failureReason = errMsg;
      }
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  return result;
}

/**
 * List installed skills for a given agent directory.
 *
 * @param skillDir - Path to the agent's skills directory
 * @returns Array of skill names that have a valid SKILL.md
 */
export function listInstalledSkillsInDir(skillDir: string): string[] {
  if (!existsSync(skillDir)) {
    return [];
  }

  try {
    return readdirSync(skillDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => existsSync(join(skillDir, entry.name, SKILL_FILENAME)))
      .map((entry) => entry.name);
  } catch {
    // Directory might not be readable
    return [];
  }
}
