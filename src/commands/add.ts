/**
 * `skillfish add` command - Install a skill from a GitHub repository.
 */

import { Command } from 'commander';
import { homedir } from 'os';
import { dirname, basename } from 'path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { trackInstall } from '../telemetry.js';
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
import { getDetectedAgents, type Agent, AGENT_CONFIGS } from '../lib/agents.js';
import {
  findAllSkillMdFiles,
  fetchSkillMdContent,
  SKILL_FILENAME,
  RateLimitError,
  RepoNotFoundError,
  NetworkError,
  GitHubApiError,
} from '../lib/github.js';
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

type SkillMetadata = {
  path: string; // Full path to SKILL.md
  dir: string; // Directory containing SKILL.md
  name: string; // From frontmatter or folder name
  description: string; // From frontmatter or empty
};

// === Command Definition ===

export const addCommand = new Command('add')
  .description('Install a skill from a GitHub repository')
  .argument('<repo>', 'GitHub repository (owner/repo or owner/repo/plugin/skill)')
  .option('--force', 'Overwrite existing skills without prompting')
  .option('-y, --yes', 'Skip all confirmation prompts')
  .option('--all', 'Install all skills found in the repository')
  .option('--project', 'Install to current project (./.claude)')
  .option('--global', 'Install to home directory (~/.claude)')
  .option('--path <path>', 'Path to a specific skill in the repository')
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText('after', `
Examples:
  $ skillfish add owner/repo                  Install from a repository
  $ skillfish add owner/repo --all            Install all skills in repo
  $ skillfish add owner/repo/plugin/skill     Install a specific skill
  $ skillfish add owner/repo --path path/to   Install skill at specific path
  $ skillfish add owner/repo --project        Install to current project only`)
  .action(async (repoArg: string, options: AddCommandOptions, command: Command) => {
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
      console.log();
      console.log(pc.cyan('     ≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋'));
      console.log(`       ${pc.cyan('><>')}  ${pc.bold('SKILL FISH')}  ${pc.cyan('><>')}`);
      console.log(pc.cyan('     ≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋'));
      console.log();
      p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim(`v${version}`)}`);
    }

    const force = options.force ?? false;
    const trustSource = options.yes ?? false;
    const installAll = options.all ?? false;
    const projectFlag = options.project ?? false;
    const globalFlag = options.global ?? false;
    let explicitPath: string | null = options.path ?? null;

    // Validate --path if provided
    if (explicitPath !== null) {
      if (!isValidPath(explicitPath)) {
        exitWithError(
          'Invalid --path value. Path must be relative and contain only safe characters.',
          EXIT_CODES.INVALID_ARGS
        );
      }
    }

    // Parse repo format - supports both owner/repo and owner/repo/plugin/skill
    const parts = repoArg.split('/');
    let owner: string;
    let repo: string;

    if (parts.length === 2) {
      [owner, repo] = parts;
    } else if (parts.length === 4) {
      const [o, r, plugin, skill] = parts;
      owner = o;
      repo = r;
      // Security: validate plugin and skill names
      if (!isValidName(plugin) || !isValidName(skill)) {
        exitWithError(
          'Invalid plugin or skill name. Use only alphanumeric characters, dots, hyphens, and underscores.',
          EXIT_CODES.INVALID_ARGS
        );
      }
      explicitPath = explicitPath || `plugins/${plugin}/skills/${skill}`;
      if (!jsonMode) {
        console.log(`Installing skill from: ${plugin}/${skill}`);
      }
    } else {
      exitWithError(
        'Invalid format. Use: owner/repo or owner/repo/plugin/skill',
        EXIT_CODES.INVALID_ARGS
      );
    }

    // Validate owner/repo (security: prevent injection)
    if (!owner || !repo || !isValidName(owner) || !isValidName(repo)) {
      exitWithError('Invalid repository format. Use: owner/repo', EXIT_CODES.INVALID_ARGS);
    }

    // 1. Discover or select skills
    const skillPaths = explicitPath
      ? [explicitPath]
      : await discoverSkillPaths(owner, repo, installAll, jsonMode, jsonOutput);

    if (!skillPaths || skillPaths.length === 0) {
      if (jsonMode) {
        outputJsonAndExit(EXIT_CODES.NOT_FOUND);
      }
      process.exit(EXIT_CODES.NOT_FOUND);
    }

    // 2. Determine install location (global vs project)
    const baseDir = await selectInstallLocation(projectFlag, globalFlag, jsonMode);

    // 3. Select agents to install to
    const detected = getDetectedAgents();

    if (detected.length === 0) {
      const errorMsg = 'No agents detected. Install Claude Code, Cursor, or another supported agent first.';
      if (jsonMode) {
        addError(errorMsg);
        outputJsonAndExit(EXIT_CODES.GENERAL_ERROR);
      }
      p.log.error(errorMsg);
      p.outro(pc.dim('https://skill.fish/agents'));
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }

    let targetAgents: readonly Agent[];

    if (!isInputTTY() || jsonMode) {
      // Non-TTY or JSON mode: use all detected agents
      if (!jsonMode) {
        console.log(`Installing to ${detected.length} agent(s): ${detected.map((a) => a.name).join(', ')}`);
      }
      targetAgents = detected;
    } else {
      // Interactive: let user choose from detected agents
      const isLocal = baseDir !== homedir();
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

      const result = await installSkill(owner, repo, skillPath, skillName, targetAgents, {
        force,
        baseDir,
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
      const isLocal = baseDir !== homedir();
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

      // Track successful installs (fire-and-forget telemetry)
      if (result.installed.length > 0) {
        // Construct github value to match skills.github column format: owner/repo/path/to/skill
        const skillDir = skillPath.replace(/\/?SKILL\.md$/i, '').replace(/^\.?\/?/, '');
        const github = skillDir ? `${owner}/${repo}/${skillDir}` : `${owner}/${repo}`;
        trackInstall(github);
      }
    }

    // Summary
    if (jsonMode) {
      outputJsonAndExit(EXIT_CODES.SUCCESS);
    }

    console.log();
    if (totalInstalled > 0) {
      p.outro(pc.green(`Done! Installed ${totalInstalled} skill${totalInstalled === 1 ? '' : 's'}`));
    } else if (totalSkipped > 0) {
      p.outro(pc.yellow(`Skipped ${totalSkipped} existing skill${totalSkipped === 1 ? '' : 's'} - use --force to overwrite`));
    } else {
      p.outro(pc.yellow('No skills installed'));
    }
    process.exit(EXIT_CODES.SUCCESS);
  });

// === Helper Functions ===

async function selectInstallLocation(
  projectFlag: boolean,
  globalFlag: boolean,
  jsonMode: boolean
): Promise<string> {
  // If flag specified, use it
  if (projectFlag) {
    if (!jsonMode) {
      p.log.info(
        `Location: ${pc.cyan('Project')} ${pc.dim('(./')}${pc.dim(AGENT_CONFIGS[0].dir)}${pc.dim(')')}`
      );
    }
    return process.cwd();
  }
  if (globalFlag) {
    if (!jsonMode) {
      p.log.info(
        `Location: ${pc.cyan('Global')} ${pc.dim('(~/')}${pc.dim(AGENT_CONFIGS[0].dir)}${pc.dim(')')}`
      );
    }
    return homedir();
  }

  // Non-TTY or JSON mode defaults to global
  if (!isInputTTY() || jsonMode) {
    return homedir();
  }

  // Interactive selection
  const location = await p.select({
    message: 'Install location',
    options: [
      {
        value: 'global',
        label: 'Global',
        hint: 'Available in all projects',
      },
      {
        value: 'project',
        label: 'Project',
        hint: 'For this project only',
      },
    ],
  });

  if (p.isCancel(location)) {
    p.cancel('Cancelled');
    process.exit(EXIT_CODES.SUCCESS);
  }

  return location === 'project' ? process.cwd() : homedir();
}

async function selectAgents(
  agents: readonly Agent[],
  isLocal: boolean,
  jsonMode: boolean
): Promise<readonly Agent[]> {
  const pathPrefix = isLocal ? '.' : '~';

  // Show detected agents
  if (!jsonMode) {
    p.log.info(
      `Detected ${pc.cyan(agents.length.toString())} agent${agents.length === 1 ? '' : 's'}: ${agents.map((a) => a.name).join(', ')}`
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
  jsonOutput: AddJsonOutput
): Promise<string[] | null> {
  let skillPaths: string[];

  try {
    skillPaths = await findAllSkillMdFiles(owner, repo);
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

      // Fetch raw content to parse frontmatter
      const content = await fetchSkillMdContent(owner, repo, sp);
      const frontmatter = content ? parseFrontmatter(content) : {};

      return {
        path: sp,
        dir: skillDir === '.' ? SKILL_FILENAME : skillDir,
        name: frontmatter.name || folderName,
        description: frontmatter.description || '',
      };
    },
    10
  );

  if (spinner) {
    spinner.stop(`Found ${pc.cyan(skills.length.toString())} skill${skills.length === 1 ? '' : 's'}`);
  }

  // Store found skills in JSON output
  jsonOutput.skills_found = skills.map((s) => s.name);

  if (skills.length === 1) {
    const skill = skills[0];
    const displayName = toTitleCase(skill.name);
    const desc = skill.description ? truncate(skill.description, 60) : '';
    if (!jsonMode) {
      p.log.info(`${pc.bold(displayName)}${desc ? pc.dim(` - ${desc}`) : ''}`);
    }
    return [skill.dir];
  }

  // Build options for selection with frontmatter metadata
  // Title in label, description in hint (shows on focus)
  const optionsList = skills.map((skill) => ({
    value: skill.dir,
    label: pc.bold(toTitleCase(skill.name)),
    hint: skill.description || undefined,
  }));

  // Non-TTY or JSON mode: require --all or --path for multiple skills
  if (!isInputTTY() || jsonMode) {
    // If --all flag is set, install all skills
    if (installAll) {
      if (!jsonMode) {
        console.log(`Installing all ${skills.length} skills`);
      }
      return skills.map((s) => s.dir);
    }

    // Otherwise, list skills and exit with guidance
    if (jsonMode) {
      jsonOutput.errors.push('Multiple skills found. Use --path or --all to specify which one(s).');
      jsonOutput.success = false;
    } else {
      console.log(`\nFound ${skills.length} skills in this repository:`);
      for (const skill of skills) {
        const displayName = toTitleCase(skill.name);
        const desc = skill.description ? pc.dim(` - ${truncate(skill.description, 80)}`) : '';
        console.log(`  - ${displayName}${desc}`);
      }
      console.error('\nMultiple skills found. Use --path or --all to specify which one(s) (non-interactive mode).');
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

  return selected;
}

/**
 * SECURITY: Show warning and ask for user confirmation before installing.
 * This mitigates supply chain attacks by making users acknowledge the source.
 * Handles batch confirmation for multiple skills at once.
 */
async function confirmInstallBatch(owner: string, repo: string, skillNames: string[]): Promise<boolean> {
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

  const skillLabel = skillNames.length === 1
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
