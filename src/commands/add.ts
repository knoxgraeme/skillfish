/**
 * `skillfish add` command - Install a skill from a GitHub repository.
 */

import { Command } from 'commander';
import { homedir } from 'os';
import { dirname, basename } from 'path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { printBanner } from '../lib/banner.js';
import { trackCommand, trackInstall } from '../telemetry.js';
import {
  isValidPath,
  parseFrontmatter,
  deriveSkillName,
  toTitleCase,
  truncate,
  batchMap,
  createJsonOutput,
  isInputTTY,
  isTTY,
  type AddJsonOutput,
} from '../utils.js';
import {
  getDetectedAgentsForLocation,
  type Agent,
  type DetectionLocation,
  AGENT_CONFIGS,
} from '../lib/agents.js';
import {
  findAllSkillMdFiles,
  fetchSkillMdContent,
  fetchDefaultBranch,
  fetchTreeSha,
  getSkillSha,
  SKILL_FILENAME,
  RateLimitError,
  RepoNotFoundError,
  NetworkError,
  GitHubApiError,
  type SkillDiscoveryResult,
} from '../lib/github.js';
import type { GitTreeItem } from '../utils.js';
import { installSkill } from '../lib/installer.js';
import { EXIT_CODES, isValidName, type ExitCode } from '../lib/constants.js';

// === Types ===

interface AddCommandOptions {
  force?: boolean;
  yes?: boolean;
  all?: boolean;
  project?: boolean;
  global?: boolean;
  path?: string;
}

interface SkillMetadata {
  path: string; // Full path to SKILL.md
  dir: string; // Directory containing SKILL.md
  name: string; // From frontmatter or folder name
  description: string; // From frontmatter or empty
}

// === Command Definition ===

export const addCommand = new Command('add')
  .description('Install a skill from a GitHub repository')
  .argument('<repo>', 'GitHub repository (owner/repo or owner/repo/plugin/skill)')
  .argument('[skill-name]', 'Install a specific skill by name (from SKILL.md frontmatter)')
  .option('--force', 'Overwrite existing skills without prompting')
  .option('-y, --yes', 'Skip all confirmation prompts')
  .option('--all', 'Install all skills found in the repository')
  .option('--project', 'Install to current project (./.claude)')
  .option('--global', 'Install to home directory (~/.claude)')
  .option('--path <path>', 'Path to a specific skill in the repository')
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText(
    'after',
    `
Examples:
  $ skillfish add owner/repo                  Install from a repository
  $ skillfish add owner/repo my-skill         Install skill by name
  $ skillfish add owner/repo --all            Install all skills in repo
  $ skillfish add owner/repo/plugin/skill     Install a specific skill by path
  $ skillfish add owner/repo --path path/to   Install skill at specific path
  $ skillfish add owner/repo --project        Install to current project only`,
  )
  .action(
    async (
      repoArg: string,
      skillNameArg: string | undefined,
      options: AddCommandOptions,
      command: Command,
    ) => {
      const jsonMode = command.parent?.opts().json ?? false;
      const jsonOutput = createJsonOutput();
      const version = command.parent?.opts().version ?? '0.0.0';

      // Helper to add error and optionally output JSON
      function addError(message: string): void {
        jsonOutput.errors.push(message);
        jsonOutput.success = false;
      }

      function outputJsonAndExit(exitCode: number): never {
        jsonOutput.exit_code = exitCode;
        console.log(JSON.stringify(jsonOutput, null, 2));
        process.exit(exitCode);
      }

      /**
       * Unified error handler that handles both JSON and TTY modes.
       * In JSON mode: adds error to output and exits with JSON.
       * In TTY mode: logs error to console and exits.
       * @param useClackLog - Use p.log.error() instead of console.error()
       */
      function exitWithError(message: string, exitCode: ExitCode, useClackLog = false): never {
        if (jsonMode) {
          addError(message);
          outputJsonAndExit(exitCode);
        }
        if (useClackLog) {
          p.log.error(message);
        } else {
          console.error(message);
        }
        process.exit(exitCode);
      }

      // Show banner and intro (TTY only, not in JSON mode)
      if (isTTY() && !jsonMode) {
        printBanner();
        p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim(`v${version}`)}`);
      }

      // Track command usage (fire and forget)
      void trackCommand('add');

      const force = options.force ?? false;
      const trustSource = options.yes ?? false;
      const installAll = options.all ?? false;
      const projectFlag = options.project ?? false;
      const globalFlag = options.global ?? false;
      let explicitPath: string | null = options.path ?? null;

      // Validate flag conflicts
      if (projectFlag && globalFlag) {
        exitWithError(
          'Cannot use both --project and --global. Choose one.',
          EXIT_CODES.INVALID_ARGS,
        );
      }

      // Validate --path if provided
      if (explicitPath !== null) {
        if (!isValidPath(explicitPath)) {
          exitWithError(
            'Invalid --path value. Path must be relative and contain only safe characters.',
            EXIT_CODES.INVALID_ARGS,
          );
        }
      }

      // Parse repo format - supports owner/repo and owner/repo/path/to/skill
      const parts = repoArg.split('/');
      let owner: string;
      let repo: string;

      if (parts.length < 2) {
        exitWithError(
          'Invalid format. Use: owner/repo or owner/repo/path/to/skill',
          EXIT_CODES.INVALID_ARGS,
        );
      }

      [owner, repo] = parts as [string, string];

      // If path components exist after owner/repo, use them as the skill path
      if (parts.length > 2) {
        const pathParts = parts.slice(2);
        // Security: validate each path component
        for (const part of pathParts) {
          if (!isValidName(part)) {
            exitWithError(
              'Invalid path component. Use only alphanumeric characters, dots, hyphens, and underscores.',
              EXIT_CODES.INVALID_ARGS,
            );
          }
        }
        explicitPath = explicitPath || pathParts.join('/');
        if (!jsonMode) {
          console.log(`Installing skill from: ${explicitPath}`);
        }
      }

      // Validate owner/repo (security: prevent injection)
      if (!owner || !repo || !isValidName(owner) || !isValidName(repo)) {
        exitWithError('Invalid repository format. Use: owner/repo', EXIT_CODES.INVALID_ARGS);
      }

      // 1. Discover or select skills
      let discoveryResult: {
        paths: string[];
        branch: string | undefined;
        sha: string | undefined;
        tree: GitTreeItem[];
      } | null;
      if (explicitPath) {
        // For explicit paths, we still need to fetch the default branch and SHA for tracking
        try {
          const branch = await fetchDefaultBranch(owner, repo);
          // Fetch tree SHA for manifest tracking
          let sha: string | undefined;
          try {
            sha = await fetchTreeSha(owner, repo, branch);
          } catch {
            // If we can't fetch SHA, install without manifest tracking
            sha = undefined;
          }
          // For explicit paths, we don't have the tree (would require extra API call)
          // The sha will be root tree SHA - acceptable for explicit path installs
          discoveryResult = { paths: [explicitPath], branch, sha, tree: [] };
        } catch {
          // If we can't fetch the branch, let degit try its own detection
          discoveryResult = { paths: [explicitPath], branch: undefined, sha: undefined, tree: [] };
        }
      } else {
        discoveryResult = await discoverSkillPaths(
          owner,
          repo,
          installAll,
          jsonMode,
          jsonOutput,
          skillNameArg,
        );
      }

      if (!discoveryResult || discoveryResult.paths.length === 0) {
        if (jsonMode) {
          outputJsonAndExit(EXIT_CODES.NOT_FOUND);
        }
        process.exit(EXIT_CODES.NOT_FOUND);
      }

      const {
        paths: skillPaths,
        branch: discoveredBranch,
        sha: discoveredSha,
        tree: discoveredTree,
      } = discoveryResult;

      // 2. Determine install location (global vs project)
      const { baseDir, location } = await selectInstallLocation(projectFlag, globalFlag, jsonMode);
      const isLocal = location === 'project';

      // 3. Select agents to install to (location-aware detection)
      const detected = getDetectedAgentsForLocation(location, process.cwd());

      if (detected.length === 0) {
        // No agents detected for this location - provide helpful guidance
        const locationLabel = isLocal ? 'this project' : 'your system';
        const errorMsg = `No agents detected in ${locationLabel}.`;
        const hint = isLocal
          ? 'Create an agent directory (e.g., .claude/) or use --global to install globally.'
          : 'Install Claude Code, Cursor, or another supported agent first.';

        if (jsonMode) {
          addError(`${errorMsg} ${hint}`);
          outputJsonAndExit(EXIT_CODES.GENERAL_ERROR);
        }
        p.log.error(errorMsg);
        p.log.info(pc.dim(hint));
        if (!isLocal) {
          p.outro(pc.dim('https://skill.fish/agents'));
        }
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }

      let targetAgents: readonly Agent[];

      if (!isInputTTY() || jsonMode) {
        // Non-TTY or JSON mode: use all detected agents
        if (!jsonMode) {
          console.log(
            `Installing to ${detected.length} agent(s): ${detected.map((a) => a.name).join(', ')}`,
          );
        }
        targetAgents = detected;
      } else {
        // Interactive: let user choose from detected agents
        targetAgents = await selectAgents(detected, isLocal, jsonMode);
      }

      // Install each selected skill
      let totalInstalled = 0;
      let totalSkipped = 0;

      // SECURITY: Ask for confirmation before installation (unless --yes is used)
      // Single confirmation for all selected skills
      if (!trustSource && !jsonMode && isInputTTY()) {
        const skillNames = skillPaths.map((sp) => deriveSkillName(sp, repo));
        const shouldInstall = await confirmInstallBatch(owner, repo, skillNames);
        if (!shouldInstall) {
          for (const skillName of skillNames) {
            p.log.warn(`Skipped ${pc.bold(skillName)} (not confirmed)`);
            jsonOutput.skipped.push({ skill: skillName, agent: 'all', reason: 'User declined' });
          }
          p.outro(pc.dim('Cancelled'));
          process.exit(EXIT_CODES.SUCCESS);
        }
      }

      for (const skillPath of skillPaths) {
        const skillName = deriveSkillName(skillPath, repo);

        // Show install progress
        let spinner: ReturnType<typeof p.spinner> | null = null;
        if (!jsonMode) {
          p.log.step(`Installing ${pc.bold(skillName)}`);
          spinner = p.spinner();
          spinner.start(`Downloading ${skillName}...`);
        }

        // Get directory-specific SHA for better update tracking
        // skillPath is either 'SKILL.md' or a directory like 'skills/foo'
        const skillMdPath =
          skillPath === SKILL_FILENAME ? SKILL_FILENAME : `${skillPath}/${SKILL_FILENAME}`;
        const skillSha = getSkillSha(discoveredTree, skillMdPath) ?? discoveredSha;

        const result = await installSkill(owner, repo, skillPath, skillName, targetAgents, {
          force,
          baseDir,
          branch: discoveredBranch,
          sha: skillSha,
          source: 'manual',
        });

        if (spinner) {
          if (result.failed) {
            spinner.stop(pc.red(`${SKILL_FILENAME} not found`));
          } else {
            spinner.stop(pc.green('Installed'));
          }
        }

        // Handle result
        if (result.failed) {
          if (jsonMode) {
            addError(`Install failed: ${result.failureReason}`);
          } else {
            console.error(pc.red(`Error: ${result.failureReason}`));
          }
          continue;
        }

        // Log installed/skipped for this skill
        const pathPrefix = isLocal ? '.' : '~';

        for (const installed of result.installed) {
          if (!jsonMode) {
            const displayPath = `${pathPrefix}/${AGENT_CONFIGS.find((c) => c.name === installed.agent)?.dir ?? 'skills'}/${skillName}`;
            console.log(`  ${pc.green('✓')} ${installed.agent} ${pc.dim(`→ ${displayPath}`)}`);
          }
          jsonOutput.installed.push(installed);
        }

        for (const skipped of result.skipped) {
          if (!jsonMode) {
            console.log(`  ${pc.yellow('●')} ${skipped.agent} ${pc.dim('(already installed)')}`);
          }
          jsonOutput.skipped.push(skipped);
        }

        // Add warnings as errors in JSON output
        for (const warning of result.warnings) {
          jsonOutput.errors.push(warning);
          if (!jsonMode) {
            console.log(`  ${pc.yellow('!')} ${warning}`);
          }
        }

        totalInstalled += result.installed.length;
        totalSkipped += result.skipped.length;

        // Track successful installs (fire and forget)
        if (result.installed.length > 0) {
          void trackInstall(owner, repo);
        }
      }

      // Summary
      if (jsonMode) {
        outputJsonAndExit(EXIT_CODES.SUCCESS);
      }

      console.log();
      if (totalInstalled > 0) {
        p.outro(
          pc.green(`Done! Installed ${totalInstalled} skill${totalInstalled === 1 ? '' : 's'}`),
        );
      } else if (totalSkipped > 0) {
        p.outro(
          pc.yellow(
            `Skipped ${totalSkipped} existing skill${totalSkipped === 1 ? '' : 's'} - use --force to overwrite`,
          ),
        );
      } else {
        p.outro(pc.yellow('No skills installed'));
      }
      process.exit(EXIT_CODES.SUCCESS);
    },
  );

// === Helper Functions ===

interface LocationResult {
  baseDir: string;
  location: DetectionLocation;
}

async function selectInstallLocation(
  projectFlag: boolean,
  globalFlag: boolean,
  jsonMode: boolean,
): Promise<LocationResult> {
  // If flag specified, use it
  if (projectFlag) {
    if (!jsonMode) {
      p.log.info(
        `Location: ${pc.cyan('Project')} ${pc.dim('(./')}${pc.dim(AGENT_CONFIGS[0].dir)}${pc.dim(')')}`,
      );
    }
    return { baseDir: process.cwd(), location: 'project' };
  }
  if (globalFlag) {
    if (!jsonMode) {
      p.log.info(
        `Location: ${pc.cyan('Global')} ${pc.dim('(~/')}${pc.dim(AGENT_CONFIGS[0].dir)}${pc.dim(')')}`,
      );
    }
    return { baseDir: homedir(), location: 'global' };
  }

  // Non-TTY or JSON mode defaults to global
  if (!isInputTTY() || jsonMode) {
    return { baseDir: homedir(), location: 'global' };
  }

  // Interactive selection
  const locationChoice = await p.select({
    message: 'Install location',
    options: [
      {
        value: 'global' as const,
        label: 'Global',
        hint: 'Available in all projects',
      },
      {
        value: 'project' as const,
        label: 'Project',
        hint: 'For this project only',
      },
    ],
  });

  if (p.isCancel(locationChoice)) {
    p.cancel('Cancelled');
    process.exit(EXIT_CODES.SUCCESS);
  }

  return locationChoice === 'project'
    ? { baseDir: process.cwd(), location: 'project' }
    : { baseDir: homedir(), location: 'global' };
}

async function selectAgents(
  agents: readonly Agent[],
  isLocal: boolean,
  jsonMode: boolean,
): Promise<readonly Agent[]> {
  const pathPrefix = isLocal ? '.' : '~';

  // Show detected agents
  if (!jsonMode) {
    p.log.info(
      `Detected ${pc.cyan(agents.length.toString())} agent${agents.length === 1 ? '' : 's'}: ${agents.map((a) => a.name).join(', ')}`,
    );
  }

  const installAll = await p.confirm({
    message: 'Install to all detected agents?',
    initialValue: true,
  });

  if (p.isCancel(installAll)) {
    p.cancel('Cancelled');
    process.exit(EXIT_CODES.SUCCESS);
  }

  if (installAll) {
    return agents;
  }

  // User wants to choose specific agents
  const options = agents.map((a) => ({
    value: a.name,
    label: a.name,
    hint: `${pathPrefix}/${a.dir}`,
  }));

  const selected = await p.multiselect({
    message: 'Select agents',
    options,
    required: true,
  });

  if (p.isCancel(selected)) {
    p.cancel('Cancelled');
    process.exit(EXIT_CODES.SUCCESS);
  }

  return agents.filter((a) => selected.includes(a.name));
}

async function discoverSkillPaths(
  owner: string,
  repo: string,
  installAll: boolean,
  jsonMode: boolean,
  jsonOutput: AddJsonOutput,
  targetSkillName?: string,
): Promise<{ paths: string[]; branch: string; sha: string; tree: GitTreeItem[] } | null> {
  let skillDiscovery: SkillDiscoveryResult;

  try {
    skillDiscovery = await findAllSkillMdFiles(owner, repo);
  } catch (err) {
    let errorMsg: string;
    let exitCode: ExitCode = EXIT_CODES.GENERAL_ERROR;

    if (err instanceof RateLimitError) {
      errorMsg = err.message;
      exitCode = EXIT_CODES.NETWORK_ERROR;
    } else if (err instanceof RepoNotFoundError) {
      errorMsg = err.message;
      exitCode = EXIT_CODES.NOT_FOUND;
    } else if (err instanceof NetworkError) {
      errorMsg = err.message;
      exitCode = EXIT_CODES.NETWORK_ERROR;
    } else if (err instanceof GitHubApiError) {
      errorMsg = err.message;
    } else {
      errorMsg = err instanceof Error ? err.message : String(err);
    }

    if (jsonMode) {
      jsonOutput.errors.push(errorMsg);
      jsonOutput.success = false;
      console.log(JSON.stringify(jsonOutput, null, 2));
    } else {
      p.log.error(errorMsg);
    }
    process.exit(exitCode);
  }

  const { paths: skillPaths, branch, sha, tree } = skillDiscovery;

  if (skillPaths.length === 0) {
    const errorMsg = `No ${SKILL_FILENAME} found in repository`;
    if (jsonMode) {
      jsonOutput.errors.push(errorMsg);
      jsonOutput.success = false;
    } else {
      p.log.error(errorMsg);
    }
    return null;
  }

  // Fetch frontmatter metadata for all skills in parallel
  let spinner: ReturnType<typeof p.spinner> | null = null;
  if (!jsonMode) {
    spinner = p.spinner();
    spinner.start('Fetching skill metadata...');
  }

  // Fetch metadata with bounded concurrency (max 10 parallel requests)
  const skills = await batchMap(
    skillPaths,
    async (sp): Promise<SkillMetadata> => {
      const skillDir = sp === SKILL_FILENAME ? '.' : dirname(sp);
      const folderName = sp === SKILL_FILENAME ? repo : basename(skillDir);

      // Fetch raw content to parse frontmatter (use discovered branch)
      const content = await fetchSkillMdContent(owner, repo, sp, branch);
      const frontmatter = content ? parseFrontmatter(content) : {};

      return {
        path: sp,
        dir: skillDir === '.' ? SKILL_FILENAME : skillDir,
        name: frontmatter.name || folderName,
        description: frontmatter.description || '',
      };
    },
    10,
  );

  if (spinner) {
    spinner.stop(
      `Found ${pc.cyan(skills.length.toString())} skill${skills.length === 1 ? '' : 's'}`,
    );
  }

  // Store found skills in JSON output
  jsonOutput.skills_found = skills.map((s) => s.name);

  // If a specific skill name was requested, find and return it
  if (targetSkillName) {
    // Normalize for flexible matching: lowercase, replace spaces/underscores with hyphens
    const normalize = (s: string) => s.toLowerCase().replace(/[\s_]+/g, '-');
    const normalizedTarget = normalize(targetSkillName);

    // Try multiple matching strategies
    const matchedSkill = skills.find((s) => {
      const normalizedName = normalize(s.name);
      const normalizedDir = normalize(s.dir);
      const dirBasename = normalize(s.dir.split('/').pop() || '');

      return (
        normalizedName === normalizedTarget || // Exact name match (normalized)
        normalizedDir === normalizedTarget || // Exact dir match
        dirBasename === normalizedTarget || // Directory basename match
        s.name.toLowerCase() === targetSkillName.toLowerCase() // Original case-insensitive
      );
    });

    if (matchedSkill) {
      const displayName = toTitleCase(matchedSkill.name);
      const desc = matchedSkill.description ? truncate(matchedSkill.description, 60) : '';
      if (!jsonMode) {
        p.log.info(`${pc.bold(displayName)}${desc ? pc.dim(` - ${desc}`) : ''}`);
      }
      return { paths: [matchedSkill.dir], branch, sha, tree };
    }

    // Skill not found - show available skills
    const errorMsg = `Skill "${targetSkillName}" not found in repository`;
    if (jsonMode) {
      jsonOutput.errors.push(errorMsg);
      jsonOutput.success = false;
    } else {
      p.log.error(errorMsg);
      console.log(`\nAvailable skills in ${owner}/${repo}:`);
      for (const skill of skills) {
        const displayName = toTitleCase(skill.name);
        const desc = skill.description ? pc.dim(` - ${truncate(skill.description, 80)}`) : '';
        console.log(`  - ${pc.cyan(skill.name)} ${displayName}${desc}`);
      }
    }
    return null;
  }

  if (skills.length === 1) {
    const skill = skills[0];
    const displayName = toTitleCase(skill.name);
    const desc = skill.description ? truncate(skill.description, 60) : '';
    if (!jsonMode) {
      p.log.info(`${pc.bold(displayName)}${desc ? pc.dim(` - ${desc}`) : ''}`);
    }
    return { paths: [skill.dir], branch, sha, tree };
  }

  // Build options for selection with frontmatter metadata
  // No hints - @clack/prompts has rendering issues with long option lists
  const optionsList = skills.map((skill) => ({
    value: skill.dir,
    label: toTitleCase(skill.name),
  }));

  // Non-TTY or JSON mode: require --all or --path for multiple skills
  if (!isInputTTY() || jsonMode) {
    // If --all flag is set, install all skills
    if (installAll) {
      if (!jsonMode) {
        console.log(`Installing all ${skills.length} skills`);
      }
      return { paths: skills.map((s) => s.dir), branch, sha, tree };
    }

    // Otherwise, list skills and exit with guidance
    if (jsonMode) {
      jsonOutput.errors.push('Multiple skills found. Specify skill name, use --path, or --all.');
      jsonOutput.success = false;
    } else {
      console.log(`\nFound ${skills.length} skills in this repository:`);
      for (const skill of skills) {
        const displayName = toTitleCase(skill.name);
        const desc = skill.description ? pc.dim(` - ${truncate(skill.description, 80)}`) : '';
        console.log(`  - ${pc.cyan(skill.name)} ${displayName}${desc}`);
      }
      console.error(
        '\nMultiple skills found. Specify skill name, use --path, or --all (non-interactive mode).',
      );
    }
    return null;
  }

  // Interactive multi-select
  const selected = await p.multiselect({
    message: 'Select skills to install',
    options: optionsList,
    required: true,
  });

  if (p.isCancel(selected)) {
    p.cancel('Cancelled');
    process.exit(EXIT_CODES.SUCCESS);
  }

  return { paths: selected, branch, sha, tree };
}

/**
 * SECURITY: Show warning and ask for user confirmation before installing.
 * This mitigates supply chain attacks by making users acknowledge the source.
 * Handles batch confirmation for multiple skills at once.
 */
async function confirmInstallBatch(
  owner: string,
  repo: string,
  skillNames: string[],
): Promise<boolean> {
  console.log();
  p.log.warn(pc.yellow('Skills can instruct AI agents to perform actions on your behalf.'));
  console.log(pc.dim(`  Source: github.com/${owner}/${repo}`));
  console.log(pc.dim('  Use --yes to skip this prompt for trusted sources.'));

  if (skillNames.length > 1) {
    console.log();
    console.log(pc.dim('  Skills to install:'));
    for (const name of skillNames) {
      console.log(pc.dim(`    • ${name}`));
    }
  }
  console.log();

  const skillLabel =
    skillNames.length === 1
      ? pc.bold(skillNames[0])
      : `${pc.bold(skillNames.length.toString())} skills`;

  const proceed = await p.confirm({
    message: `Install ${skillLabel} from ${pc.cyan(`${owner}/${repo}`)}?`,
    initialValue: true,
  });

  if (p.isCancel(proceed)) {
    return false;
  }

  return proceed;
}
