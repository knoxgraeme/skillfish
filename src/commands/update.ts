/**
 * `skillfish update` command - Check for and apply updates to installed skills.
 */

import { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { printBanner } from '../lib/banner.js';
import { getDetectedAgentsForLocation, getAgentSkillDir, type Agent } from '../lib/agents.js';
import { listInstalledSkillsInDir, installSkill } from '../lib/installer.js';
import { readManifest, type SkillManifest } from '../lib/manifest.js';
import {
  fetchRecursiveTree,
  getSkillSha,
  RateLimitError,
  RepoNotFoundError,
  NetworkError,
  GitHubApiError,
} from '../lib/github.js';
import type { GitTreeItem } from '../utils.js';
import { EXIT_CODES, type ExitCode } from '../lib/constants.js';
import { isInputTTY, isTTY, type UpdateJsonOutput } from '../utils.js';

// === Types ===

interface UpdateCommandOptions {
  yes?: boolean;
}

/**
 * Tracked skill with manifest information.
 */
interface TrackedSkill {
  skill: string;
  agent: Agent;
  path: string;
  location: 'global' | 'project';
  manifest: SkillManifest;
}

// === Command Definition ===

export const updateCommand = new Command('update')
  .description('Check for and apply updates to installed skills')
  .option('-y, --yes', 'Update all outdated skills without prompting')
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText(
    'after',
    `
Examples:
  $ skillfish update                  Check for updates interactively
  $ skillfish update --yes            Update all outdated skills
  $ skillfish update --json           Check for updates (JSON output)
  $ skillfish update --yes --json     Update all outdated skills (JSON output)`,
  )
  .action(async (options: UpdateCommandOptions, command: Command) => {
    const jsonMode = command.parent?.opts().json ?? false;
    const autoUpdate = options.yes ?? false;
    const version = command.parent?.opts().version ?? '0.0.0';

    // JSON output state
    const jsonOutput: UpdateJsonOutput = {
      success: true,
      exit_code: EXIT_CODES.SUCCESS,
      errors: [],
      outdated: [],
      updated: [],
    };

    function addError(message: string): void {
      jsonOutput.errors.push(message);
      jsonOutput.success = false;
    }

    function outputJsonAndExit(exitCode: ExitCode): never {
      jsonOutput.exit_code = exitCode;
      console.log(JSON.stringify(jsonOutput, null, 2));
      process.exit(exitCode);
    }

    function exitWithError(message: string, exitCode: ExitCode): never {
      if (jsonMode) {
        addError(message);
        outputJsonAndExit(exitCode);
      }
      p.log.error(message);
      process.exit(exitCode);
    }

    // Show banner (TTY only, not in JSON mode)
    if (isTTY() && !jsonMode) {
      printBanner();
      p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim(`v${version}`)}`);
    }

    // Detect agents (check both global and project for updates)
    const detected = getDetectedAgentsForLocation('both', process.cwd());

    if (detected.length === 0) {
      exitWithError(
        'No agents detected. Install Claude Code, Cursor, or another supported agent first.',
        EXIT_CODES.GENERAL_ERROR,
      );
    }

    // Show checking spinner
    let checkSpinner: ReturnType<typeof p.spinner> | null = null;
    if (!jsonMode) {
      checkSpinner = p.spinner();
      checkSpinner.start('Checking for updates...');
    }

    // Collect all tracked skills (skills with manifests)
    const trackedSkills = collectTrackedSkills(detected);

    if (trackedSkills.length === 0) {
      if (checkSpinner) {
        checkSpinner.stop(pc.yellow('No tracked skills found'));
      }

      if (jsonMode) {
        outputJsonAndExit(EXIT_CODES.SUCCESS);
      }

      console.log();
      p.log.info(pc.dim("Skills installed before this version don't have tracking info."));
      p.log.info(pc.dim('Reinstall skills with `skillfish add` to enable updates.'));
      p.outro(pc.dim('Done'));
      process.exit(EXIT_CODES.SUCCESS);
    }

    // Check for updates
    const { outdated, errors, rateLimitHit } = await checkForUpdates(trackedSkills);

    if (checkSpinner) {
      if (rateLimitHit) {
        checkSpinner.stop(pc.yellow('Rate limit reached'));
      } else if (outdated.length > 0) {
        checkSpinner.stop(
          `Found ${pc.cyan(outdated.length.toString())} outdated skill${outdated.length === 1 ? '' : 's'}`,
        );
      } else {
        checkSpinner.stop(pc.green('All skills are up to date'));
      }
    }

    // Add any errors to output
    for (const error of errors) {
      addError(error);
    }

    // Build outdated skills for JSON output
    jsonOutput.outdated = outdated.map((s) => ({
      skill: s.skill,
      agent: s.agent.name,
      path: s.path,
      location: s.location,
      localSha: s.manifest.sha,
      remoteSha: s.remoteSha,
      source: `${s.manifest.owner}/${s.manifest.repo}`,
    }));

    // If rate limit hit, report and exit
    if (rateLimitHit) {
      if (jsonMode) {
        outputJsonAndExit(EXIT_CODES.NETWORK_ERROR);
      }
      p.log.warn('GitHub API rate limit exceeded. Try again later.');
      process.exit(EXIT_CODES.NETWORK_ERROR);
    }

    // No updates available
    if (outdated.length === 0) {
      if (jsonMode) {
        outputJsonAndExit(EXIT_CODES.SUCCESS);
      }
      p.outro(pc.green('All skills are up to date'));
      process.exit(EXIT_CODES.SUCCESS);
    }

    // Display outdated skills (TTY mode)
    if (!jsonMode) {
      console.log();
      for (const skill of outdated) {
        const locationLabel = skill.location === 'global' ? pc.dim('global') : pc.dim('project');
        const shortLocal = skill.manifest.sha.substring(0, 7);
        const shortRemote = skill.remoteSha.substring(0, 7);
        console.log(
          `  ${pc.yellow('•')} ${pc.bold(skill.skill)} (${skill.agent.name}, ${locationLabel})`,
        );
        console.log(`    ${pc.dim(shortLocal)} → ${pc.cyan(shortRemote)}`);
      }
      console.log();
    }

    // If --json without --yes: check mode only - don't apply updates
    if (jsonMode && !autoUpdate) {
      outputJsonAndExit(EXIT_CODES.SUCCESS);
    }

    // Prompt for confirmation (unless --yes)
    if (!autoUpdate && isInputTTY() && !jsonMode) {
      const proceed = await p.confirm({
        message: `Update all ${outdated.length} skill${outdated.length === 1 ? '' : 's'}?`,
        initialValue: true,
      });

      if (p.isCancel(proceed) || !proceed) {
        p.cancel('Cancelled');
        process.exit(EXIT_CODES.SUCCESS);
      }
    }

    // Apply updates
    let updatedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < outdated.length; i++) {
      const skill = outdated[i];
      const progress = `[${i + 1}/${outdated.length}]`;

      let updateSpinner: ReturnType<typeof p.spinner> | null = null;
      if (!jsonMode) {
        updateSpinner = p.spinner();
        updateSpinner.start(`${progress} Updating ${skill.skill}...`);
      }

      const result = await installSkill(
        skill.manifest.owner,
        skill.manifest.repo,
        skill.manifest.path,
        skill.skill,
        [skill.agent],
        {
          force: true,
          baseDir: skill.location === 'global' ? homedir() : process.cwd(),
          branch: skill.manifest.branch,
          sha: skill.remoteSha,
        },
      );

      if (result.failed) {
        failedCount++;
        if (updateSpinner) {
          updateSpinner.stop(pc.red(`${progress} ${skill.skill} failed`));
        }
        addError(`Failed to update ${skill.skill}: ${result.failureReason}`);
      } else {
        updatedCount++;
        if (updateSpinner) {
          updateSpinner.stop(pc.green(`${progress} ${skill.skill} updated`));
        }
        jsonOutput.updated.push({
          skill: skill.skill,
          agent: skill.agent.name,
          path: skill.path,
          location: skill.location,
        });
      }
    }

    // Summary
    if (jsonMode) {
      const exitCode = failedCount > 0 ? EXIT_CODES.GENERAL_ERROR : EXIT_CODES.SUCCESS;
      outputJsonAndExit(exitCode);
    }

    console.log();
    if (failedCount > 0) {
      p.outro(
        pc.yellow(
          `Updated ${updatedCount} of ${outdated.length} skill${outdated.length === 1 ? '' : 's'}`,
        ),
      );
      process.exit(EXIT_CODES.GENERAL_ERROR);
    } else {
      p.outro(
        pc.green(`Updated ${updatedCount} skill${updatedCount === 1 ? '' : 's'} successfully`),
      );
      process.exit(EXIT_CODES.SUCCESS);
    }
  });

// === Helper Functions ===

/**
 * Collect all installed skills that have manifests (tracked skills).
 */
function collectTrackedSkills(agents: readonly Agent[]): TrackedSkill[] {
  const tracked: TrackedSkill[] = [];
  const seenPaths = new Set<string>();

  for (const agent of agents) {
    // Check global skills
    const globalDir = getAgentSkillDir(agent, homedir());
    const globalSkills = listInstalledSkillsInDir(globalDir);

    for (const skill of globalSkills) {
      const skillPath = join(globalDir, skill);
      if (seenPaths.has(skillPath)) continue;
      seenPaths.add(skillPath);

      const manifest = readManifest(skillPath);
      if (manifest) {
        tracked.push({
          skill,
          agent,
          path: skillPath,
          location: 'global',
          manifest,
        });
      }
    }

    // Check project skills
    const projectDir = getAgentSkillDir(agent, process.cwd());
    const projectSkills = listInstalledSkillsInDir(projectDir);

    for (const skill of projectSkills) {
      const skillPath = join(projectDir, skill);
      if (seenPaths.has(skillPath)) continue;
      seenPaths.add(skillPath);

      const manifest = readManifest(skillPath);
      if (manifest) {
        tracked.push({
          skill,
          agent,
          path: skillPath,
          location: 'project',
          manifest,
        });
      }
    }
  }

  return tracked;
}

/**
 * Check which tracked skills have updates available.
 * Caches recursive tree lookups to avoid duplicate API calls for skills from the same repo.
 * Uses directory-level SHA comparison for accurate change detection.
 */
async function checkForUpdates(skills: TrackedSkill[]): Promise<{
  outdated: (TrackedSkill & { remoteSha: string })[];
  errors: string[];
  rateLimitHit: boolean;
}> {
  const outdated: (TrackedSkill & { remoteSha: string })[] = [];
  const errors: string[] = [];
  let rateLimitHit = false;

  // Cache full tree lookups by owner/repo/branch to avoid duplicate API calls
  const treeCache = new Map<string, { rootSha: string; tree: GitTreeItem[] }>();
  const errorCache = new Map<string, Error>();

  for (const skill of skills) {
    const cacheKey = `${skill.manifest.owner}/${skill.manifest.repo}/${skill.manifest.branch}`;

    // Check if we already have a cached error for this repo
    const cachedError = errorCache.get(cacheKey);
    if (cachedError) {
      if (cachedError instanceof RepoNotFoundError) {
        errors.push(
          `${skill.skill}: Repository not found (${skill.manifest.owner}/${skill.manifest.repo})`,
        );
      } else if (cachedError instanceof NetworkError) {
        errors.push(`${skill.skill}: ${cachedError.message}`);
      } else if (cachedError instanceof GitHubApiError) {
        errors.push(`${skill.skill}: ${cachedError.message}`);
      } else {
        errors.push(`${skill.skill}: ${cachedError.message}`);
      }
      continue;
    }

    // Check if we already have a cached tree for this repo
    let cached = treeCache.get(cacheKey);

    if (!cached) {
      try {
        const { sha, tree } = await fetchRecursiveTree(
          skill.manifest.owner,
          skill.manifest.repo,
          skill.manifest.branch,
        );
        cached = { rootSha: sha, tree };
        treeCache.set(cacheKey, cached);
      } catch (err) {
        if (err instanceof RateLimitError) {
          rateLimitHit = true;
          break; // Stop checking on rate limit
        }

        // Cache the error for other skills from the same repo
        if (err instanceof Error) {
          errorCache.set(cacheKey, err);
        }

        if (err instanceof RepoNotFoundError) {
          errors.push(
            `${skill.skill}: Repository not found (${skill.manifest.owner}/${skill.manifest.repo})`,
          );
        } else if (err instanceof NetworkError) {
          errors.push(`${skill.skill}: ${err.message}`);
        } else if (err instanceof GitHubApiError) {
          errors.push(`${skill.skill}: ${err.message}`);
        } else {
          errors.push(`${skill.skill}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
        continue;
      }
    }

    // Get directory-specific SHA for accurate change detection
    // Falls back to root SHA for backward compatibility with old manifests
    const remoteSha = getSkillSha(cached.tree, skill.manifest.path) ?? cached.rootSha;

    if (skill.manifest.sha !== remoteSha) {
      outdated.push({ ...skill, remoteSha });
    }
  }

  return { outdated, errors, rateLimitHit };
}
