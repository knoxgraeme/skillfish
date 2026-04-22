/**
 * Skill installation logic.
 * Handles downloading, validating, and installing skills to agent directories.
 */

import { existsSync, mkdirSync, cpSync, rmSync, lstatSync, readdirSync, renameSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { downloadTemplate } from 'giget';
import { getAgentSkillDir, type Agent } from './agents.js';
import { getGitHubToken, hasGitHubToken } from './auth.js';
import { SKILL_FILENAME } from './github.js';
import {
  writeManifest,
  type SkillManifest,
  type SkillSource,
  MANIFEST_VERSION,
} from './manifest.js';

// === Types ===

export interface InstallResult {
  installed: { skill: string; agent: string; path: string }[];
  skipped: { skill: string; agent: string; reason: string }[];
  warnings: string[];
  failed: boolean;
  failureReason?: string;
}

export interface InstallOptions {
  force: boolean;
  baseDir: string;
  /** Branch to clone from. If not specified, giget will use the repository's default branch. */
  branch?: string;
  /** Tree SHA for manifest tracking. If provided, .skillfish.json will be written. */
  sha?: string;
  /** User's pinned ref (e.g., "v1.0.0", "main") - preserves original request */
  ref?: string;
  /** How the skill was installed - defaults to 'manual' */
  source?: SkillSource;
}

/**
 * Validates a branch name for safe use in giget source strings.
 * Git branch names can contain alphanumerics, dots, hyphens, underscores, and slashes.
 * We explicitly reject '#' which is used as a delimiter in giget syntax.
 */
function isValidBranchName(branch: string): boolean {
  if (!branch || branch.length > 255) return false;
  // Allow alphanumerics, dots, hyphens, underscores, and slashes (for feature branches)
  // Reject anything else, especially '#' which would break giget parsing
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
            `Could not copy ${entry.name}: ${err instanceof Error ? err.message : 'unknown error'}`,
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
  options: InstallOptions,
): Promise<InstallResult> {
  const result: InstallResult = {
    installed: [],
    skipped: [],
    warnings: [],
    failed: false,
  };

  const { force, baseDir, branch, sha, ref, source } = options;

  const tmpDir = join(homedir(), '.cache', 'skillfish', `${owner}-${repo}-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });

  try {
    // Download skill using giget (tarball-based, works reliably on all repo sizes)
    // Build giget source: github:owner/repo[/subpath][#branch]
    const downloadPath = skillPath === SKILL_FILENAME || skillPath === '.' ? '' : skillPath;
    let gigetSource = downloadPath
      ? `github:${owner}/${repo}/${downloadPath}`
      : `github:${owner}/${repo}`;

    // Append branch if specified (critical for repos with non-standard default branches like 'canary')
    // Validate branch name to prevent injection attacks via malformed branch names
    if (branch) {
      if (!isValidBranchName(branch)) {
        throw new Error(`Invalid branch name: ${branch}`);
      }
      gigetSource = `${gigetSource}#${branch}`;
    }

    const githubToken = getGitHubToken();
    await downloadTemplate(gigetSource, {
      dir: tmpDir,
      forceClean: true,
      ...(githubToken ? { auth: githubToken } : {}),
    });

    // Validate download
    const skillMdPath = join(tmpDir, SKILL_FILENAME);
    if (!existsSync(skillMdPath)) {
      throw new SkillMdNotFoundError(skillPath);
    }

    // Copy to each agent directory
    for (const agent of agents) {
      const agentSkillDir = getAgentSkillDir(agent, baseDir);
      const destDir = join(agentSkillDir, skillName);

      if (existsSync(destDir) && !force) {
        result.skipped.push({
          skill: skillName,
          agent: agent.name,
          reason: 'Already exists (use --force to overwrite)',
        });
        continue;
      }

      // Create parent directory
      mkdirSync(agentSkillDir, { recursive: true, mode: 0o700 });

      // Atomic install: backup existing directory before overwrite (allows rollback on failure)
      const backupDir = `${destDir}.skillfish-backup`;
      let hasBackup = false;

      if (existsSync(destDir)) {
        // Remove any stale backup from previous failed install
        if (existsSync(backupDir)) {
          // Security: check if backup is a symlink before recursive delete
          const backupStat = lstatSync(backupDir);
          if (backupStat.isSymbolicLink()) {
            rmSync(backupDir);
          } else {
            rmSync(backupDir, { recursive: true });
          }
        }
        try {
          renameSync(destDir, backupDir);
          hasBackup = true;
        } catch (renameErr) {
          // Handle cross-filesystem case (EXDEV) - fall back to delete without backup
          if ((renameErr as NodeJS.ErrnoException).code === 'EXDEV') {
            result.warnings.push(
              `${skillName}: Cross-filesystem install, backup protection disabled`,
            );
            rmSync(destDir, { recursive: true });
          } else {
            throw renameErr;
          }
        }
      }

      try {
        // Use safe copy to skip symlinks (security: prevents symlink attacks)
        const copyResult = safeCopyDir(tmpDir, destDir);
        result.warnings.push(...copyResult.warnings.map((w) => `${skillName}: ${w}`));

        // Write manifest for tracking if SHA is provided
        // Manifest failure is non-critical - skill works, just update tracking is broken
        if (sha && branch) {
          try {
            const manifest: SkillManifest = {
              version: MANIFEST_VERSION,
              name: skillName,
              owner,
              repo,
              path: skillPath === SKILL_FILENAME ? '.' : skillPath,
              branch,
              sha,
              ref: ref,
              source: source as SkillSource | undefined,
            };
            writeManifest(destDir, manifest);
          } catch (manifestErr) {
            const msg = manifestErr instanceof Error ? manifestErr.message : String(manifestErr);
            result.warnings.push(
              `${skillName}: Installed but manifest write failed (update tracking disabled): ${msg}`,
            );
          }
        }

        // Success - remove backup (non-critical, don't fail install if cleanup fails)
        if (hasBackup) {
          try {
            rmSync(backupDir, { recursive: true, force: true });
          } catch {
            result.warnings.push(
              `${skillName}: Installed successfully but backup cleanup failed at ${backupDir}`,
            );
          }
        }

        result.installed.push({
          skill: skillName,
          agent: agent.name,
          path: destDir,
        });
      } catch (copyErr) {
        // Rollback on failure - restore the original skill
        if (hasBackup) {
          try {
            if (existsSync(destDir)) {
              rmSync(destDir, { recursive: true, force: true });
            }
            renameSync(backupDir, destDir);
            result.warnings.push(
              `${skillName}: Installation failed for ${agent.name}, restored previous version`,
            );
          } catch (rollbackErr) {
            // Critical: rollback failed - preserve backup for manual recovery
            const rollbackMsg =
              rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
            result.warnings.push(
              `${skillName}: CRITICAL - Installation failed and rollback failed for ${agent.name}. ` +
                `Manual recovery may be needed from ${backupDir}. Rollback error: ${rollbackMsg}`,
            );
          }
        }
        throw copyErr;
      }
    }
  } catch (err: unknown) {
    result.failed = true;
    if (err instanceof SkillMdNotFoundError) {
      result.failureReason = err.message;
    } else {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Provide more helpful error messages for common failures
      if (errMsg.includes('404') || errMsg.includes('Not Found')) {
        const hint = hasGitHubToken() ? '' : ' (set GITHUB_TOKEN if this is a private repository)';
        result.failureReason = `Repository or path not found: ${owner}/${repo}${skillPath !== SKILL_FILENAME ? `/${skillPath}` : ''}${hint}`;
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
