/**
 * `skillfish init` command - Generate a template skill.
 */

import { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { getDetectedAgents, getAgentSkillDir, type Agent } from '../lib/agents.js';
import { SKILL_FILENAME } from '../lib/github.js';
import { EXIT_CODES, type ExitCode } from '../lib/constants.js';
import { isInputTTY, isTTY, type InitJsonOutput } from '../utils.js';

// === Types ===

interface InitCommandOptions {
  yes?: boolean;
  project?: boolean;
  global?: boolean;
  name?: string;
  description?: string;
  author?: string;
  version?: string;
  license?: string;
}

// === Validation ===

/**
 * Validates skill name format.
 * Must be lowercase, use hyphens or underscores, no spaces, no consecutive hyphens.
 */
function isValidSkillName(name: string): boolean {
  // Must start and end with alphanumeric, contain only lowercase, numbers, hyphens, underscores
  if (!/^[a-z0-9][a-z0-9_-]*[a-z0-9]$|^[a-z0-9]$/.test(name)) {
    return false;
  }
  // No consecutive hyphens or underscores
  if (/[-_]{2,}/.test(name)) {
    return false;
  }
  // Reasonable length
  if (name.length < 1 || name.length > 64) {
    return false;
  }
  return true;
}

/**
 * Convert user input to valid skill name format.
 */
function normalizeSkillName(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // spaces to hyphens
    .replace(/[^a-z0-9_-]/g, '') // remove invalid chars
    .replace(/[-_]{2,}/g, '-'); // collapse multiple separators
}

// === Template Generation ===

interface SkillMetadata {
  name: string;
  description: string;
  author?: string;
  version?: string;
  license?: string;
}

const OPTIONAL_DIRS = [
  { value: 'scripts', label: 'scripts/', hint: 'Executable code (Python, Bash, JS)' },
  { value: 'references', label: 'references/', hint: 'Additional documentation' },
  { value: 'assets', label: 'assets/', hint: 'Templates, images, data files' },
] as const;

type OptionalDir = (typeof OPTIONAL_DIRS)[number]['value'];

/**
 * Quote a YAML value if it contains characters that could break parsing.
 * Wraps in double quotes and escapes internal double quotes/backslashes.
 */
function yamlQuote(value: string): string {
  // If the value contains any YAML-special characters, quote it
  if (/[:#[\]{}&*!|>'"%@`\n\r\\,]/.test(value) || value.startsWith('-') || value.startsWith('?')) {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
    return `"${escaped}"`;
  }
  return value;
}

/**
 * Generate SKILL.md content with frontmatter and template.
 */
function generateSkillMd(meta: SkillMetadata, dirs: readonly OptionalDir[]): string {
  const frontmatterLines = [
    '---',
    `name: ${yamlQuote(meta.name)}`,
    `description: ${yamlQuote(meta.description)}`,
  ];

  if (meta.license) {
    frontmatterLines.push(`license: ${yamlQuote(meta.license)}`);
  }

  if (meta.author || meta.version) {
    frontmatterLines.push('metadata:');
    if (meta.author) {
      frontmatterLines.push(`  author: ${yamlQuote(meta.author)}`);
    }
    if (meta.version) {
      frontmatterLines.push(`  version: ${yamlQuote(meta.version)}`);
    }
  }

  frontmatterLines.push('---');

  const sections: string[] = [
    `${frontmatterLines.join('\n')}`,
    `# ${meta.name}`,
    meta.description,
    `## Instructions\n\n<!-- Add your skill instructions here. This is what the AI agent will read and follow. -->`,
    `## Examples\n\n<!-- Provide examples of how this skill should be used. -->`,
  ];

  if (dirs.includes('references')) {
    sections.push(
      `## References\n\n<!-- Reference additional docs from the references/ directory. -->\n<!-- Example: See [detailed guide](references/REFERENCE.md) for more info. -->`,
    );
  } else {
    sections.push(
      `## References\n\n<!-- Link to documentation, APIs, or other resources the agent might need. -->`,
    );
  }

  if (dirs.includes('scripts')) {
    sections.push(
      `## Scripts\n\n<!-- Executable code is available in the scripts/ directory. -->\n<!-- Example: Run scripts/setup.sh to configure the environment. -->`,
    );
  }

  return sections.join('\n\n') + '\n';
}

// === Command Definition ===

export const initCommand = new Command('init')
  .description('Create a new skill template')
  .option('--name <name>', 'Skill name (lowercase, hyphens)')
  .option('--description <desc>', 'Skill description')
  .option('--author <author>', 'Skill author')
  .option('--version <version>', 'Skill version (default: 1.0.0)')
  .option('--license <license>', 'Skill license (e.g., MIT, Apache-2.0)')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('--project', 'Create in current project (./.claude)')
  .option('--global', 'Create in home directory (~/.claude)')
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText(
    'after',
    `
Examples:
  $ skillfish init                            Interactive skill creation
  $ skillfish init --name my-skill            Create skill with specified name
  $ skillfish init --project                  Create in current project
  $ skillfish init --name my-skill --yes      Non-interactive creation`,
  )
  .action(async (options: InitCommandOptions, command: Command) => {
    const jsonMode = command.parent?.opts().json ?? false;
    const version = command.parent?.opts().version ?? '0.0.0';

    // JSON output state
    const jsonOutput: InitJsonOutput = {
      success: true,
      errors: [],
      created: [],
      skipped: [],
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
      p.intro(
        `${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim(`v${version}`)} ${pc.dim('· Create a skill')}`,
      );
    }

    const skipPrompts = options.yes ?? false;
    const projectFlag = options.project ?? false;
    const globalFlag = options.global ?? false;

    if (projectFlag && globalFlag) {
      exitWithError('Cannot use both --project and --global. Choose one.', EXIT_CODES.INVALID_ARGS);
    }

    // 1. Get skill name
    let skillName: string;

    if (options.name) {
      // Validate provided name
      const normalized = normalizeSkillName(options.name);
      if (!isValidSkillName(normalized)) {
        exitWithError(
          'Invalid skill name. Use lowercase letters, numbers, and hyphens (e.g., my-skill).',
          EXIT_CODES.INVALID_ARGS,
        );
      }
      skillName = normalized;
    } else if (!isInputTTY() || jsonMode) {
      exitWithError(
        'Skill name is required. Use --name <name> in non-interactive mode.',
        EXIT_CODES.INVALID_ARGS,
      );
    } else {
      // Interactive prompt for skill name
      const nameInput = await p.text({
        message: 'Skill name',
        placeholder: 'my-skill',
        validate: (value) => {
          const normalized = normalizeSkillName(value);
          if (!normalized) {
            return 'Skill name is required';
          }
          if (!isValidSkillName(normalized)) {
            return 'Use lowercase letters, numbers, and hyphens (e.g., my-skill)';
          }
        },
      });

      if (p.isCancel(nameInput)) {
        p.cancel('Cancelled');
        process.exit(EXIT_CODES.SUCCESS);
      }

      skillName = normalizeSkillName(nameInput as string);
    }

    // 2. Get skill description
    let skillDescription: string;

    if (options.description) {
      skillDescription = options.description;
    } else if (!isInputTTY() || jsonMode) {
      exitWithError(
        'Skill description is required. Use --description <desc> in non-interactive mode.',
        EXIT_CODES.INVALID_ARGS,
      );
    } else {
      const descInput = await p.text({
        message: 'Description',
        placeholder: 'What does this skill do?',
        validate: (value) => {
          if (!value.trim()) {
            return 'Description is required';
          }
        },
      });

      if (p.isCancel(descInput)) {
        p.cancel('Cancelled');
        process.exit(EXIT_CODES.SUCCESS);
      }

      skillDescription = (descInput as string).trim();
    }

    // 3. Optional metadata (author, version, license) - only prompt interactively
    let author = options.author;
    let skillVersion = options.version || '1.0.0';
    let license = options.license;

    if (isInputTTY() && !jsonMode && !skipPrompts) {
      const addMetadata = await p.confirm({
        message: 'Add optional metadata (author, license)?',
        initialValue: false,
      });

      if (p.isCancel(addMetadata)) {
        p.cancel('Cancelled');
        process.exit(EXIT_CODES.SUCCESS);
      }

      if (addMetadata) {
        const authorInput = await p.text({
          message: 'Author',
          placeholder: 'your-name or your-org (optional)',
        });

        if (p.isCancel(authorInput)) {
          p.cancel('Cancelled');
          process.exit(EXIT_CODES.SUCCESS);
        }

        author = (authorInput as string).trim() || undefined;

        const licenseInput = await p.select({
          message: 'License',
          options: [
            { value: '', label: 'None' },
            { value: 'MIT', label: 'MIT' },
            { value: 'Apache-2.0', label: 'Apache-2.0' },
            { value: 'BSD-3-Clause', label: 'BSD-3-Clause' },
            { value: 'GPL-3.0', label: 'GPL-3.0' },
            { value: 'AGPL-3.0', label: 'AGPL-3.0' },
            { value: 'Unlicense', label: 'Unlicense' },
          ],
        });

        if (p.isCancel(licenseInput)) {
          p.cancel('Cancelled');
          process.exit(EXIT_CODES.SUCCESS);
        }

        license = (licenseInput as string) || undefined;
      }
    }

    // 4. Select optional directories
    let optionalDirs: readonly OptionalDir[] = [];

    if (isInputTTY() && !jsonMode && !skipPrompts) {
      const addDirs = await p.confirm({
        message: 'Include optional directories (scripts/, references/, assets/)?',
        initialValue: false,
      });

      if (p.isCancel(addDirs)) {
        p.cancel('Cancelled');
        process.exit(EXIT_CODES.SUCCESS);
      }

      if (addDirs) {
        const selected = await p.multiselect({
          message: 'Select directories to include',
          options: OPTIONAL_DIRS.map((d) => ({
            value: d.value,
            label: d.label,
            hint: d.hint,
          })),
          required: false,
        });

        if (p.isCancel(selected)) {
          p.cancel('Cancelled');
          process.exit(EXIT_CODES.SUCCESS);
        }

        optionalDirs = selected as OptionalDir[];
      }
    }

    // 5. Determine install location (global vs project)
    const baseDir = await selectInstallLocation(projectFlag, globalFlag, jsonMode);

    // 6. Select agents to create skill for
    const detected = getDetectedAgents();

    if (detected.length === 0) {
      const errorMsg =
        'No agents detected. Install Claude Code, Cursor, or another supported agent first.';
      if (jsonMode) {
        addError(errorMsg);
        outputJsonAndExit(EXIT_CODES.GENERAL_ERROR);
      }
      p.log.error(errorMsg);
      p.outro(pc.dim('https://skill.fish/agents'));
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }

    let targetAgents: readonly Agent[];

    if (!isInputTTY() || jsonMode || skipPrompts) {
      // Non-TTY or JSON mode or --yes: use all detected agents
      if (!jsonMode) {
        console.log(
          `Creating for ${detected.length} agent(s): ${detected.map((a) => a.name).join(', ')}`,
        );
      }
      targetAgents = detected;
    } else {
      // Interactive: let user choose from detected agents
      const isLocal = baseDir !== homedir();
      targetAgents = await selectAgents(detected, isLocal, jsonMode);
    }

    // 7. Create the skill
    const skillMeta: SkillMetadata = {
      name: skillName,
      description: skillDescription,
      author,
      version: skillVersion,
      license,
    };

    const skillContent = generateSkillMd(skillMeta, optionalDirs);
    const isLocal = baseDir !== homedir();
    const pathPrefix = isLocal ? '.' : '~';

    if (!jsonMode) {
      p.log.step(`Creating ${pc.bold(skillName)}`);
    }

    let created = 0;
    let skipped = 0;

    for (const agent of targetAgents) {
      const skillDir = join(getAgentSkillDir(agent, baseDir), skillName);
      const skillFilePath = join(skillDir, SKILL_FILENAME);

      // Check if skill already exists
      if (existsSync(skillFilePath)) {
        if (!jsonMode) {
          console.log(`  ${pc.yellow('●')} ${agent.name} ${pc.dim('(already exists)')}`);
        }
        jsonOutput.skipped.push({
          skill: skillName,
          agent: agent.name,
          reason: 'Already exists',
        });
        skipped++;
        continue;
      }

      // Create skill directory and SKILL.md
      try {
        mkdirSync(skillDir, { recursive: true, mode: 0o700 });
        writeFileSync(skillFilePath, skillContent, { mode: 0o600 });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (!jsonMode) {
          console.log(`  ${pc.red('✗')} ${agent.name} ${pc.dim(`(${errMsg})`)}`);
        }
        addError(`Failed to create skill for ${agent.name}: ${errMsg}`);
        continue;
      }

      // Create optional directories (non-fatal — SKILL.md is already written)
      for (const dir of optionalDirs) {
        try {
          mkdirSync(join(skillDir, dir), { recursive: true, mode: 0o700 });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (!jsonMode) {
            console.log(
              `  ${pc.yellow('!')} ${agent.name}: failed to create ${dir}/ ${pc.dim(`(${errMsg})`)}`,
            );
          }
          jsonOutput.errors.push(`Failed to create ${dir}/ for ${agent.name}: ${errMsg}`);
        }
      }

      const displayPath = `${pathPrefix}/${agent.dir}/${skillName}`;
      if (!jsonMode) {
        console.log(`  ${pc.green('✓')} ${agent.name} ${pc.dim(`→ ${displayPath}`)}`);
      }

      jsonOutput.created.push({
        skill: skillName,
        agent: agent.name,
        path: skillDir,
      });
      created++;
    }

    // Summary
    if (jsonMode) {
      outputJsonAndExit(jsonOutput.success ? EXIT_CODES.SUCCESS : EXIT_CODES.GENERAL_ERROR);
    }

    console.log();
    if (created > 0) {
      p.log.success(`Created ${pc.bold(skillName)}`);
      console.log();
      console.log(pc.dim('  Next steps:'));
      console.log(pc.dim(`  1. Edit ${SKILL_FILENAME} to add your instructions`));
      if (optionalDirs.length > 0) {
        console.log(pc.dim(`  2. Add files to ${optionalDirs.map((d) => `${d}/`).join(', ')}`));
        console.log(pc.dim('  3. Test with your AI agent'));
        console.log(pc.dim('  4. Share on skill.fish or GitHub'));
      } else {
        console.log(pc.dim('  2. Test with your AI agent'));
        console.log(pc.dim('  3. Share on skill.fish or GitHub'));
      }
      console.log();
      p.outro(pc.green(`Done! Created ${created} skill${created === 1 ? '' : 's'}`));
    } else if (skipped > 0) {
      p.outro(pc.yellow(`Skill "${skillName}" already exists for all selected agents`));
    } else {
      p.outro(pc.yellow('No skills created'));
    }
    process.exit(created > 0 || skipped > 0 ? EXIT_CODES.SUCCESS : EXIT_CODES.GENERAL_ERROR);
  });

// === Helper Functions ===

async function selectInstallLocation(
  projectFlag: boolean,
  globalFlag: boolean,
  jsonMode: boolean,
): Promise<string> {
  // If flag specified, use it
  if (projectFlag) {
    if (!jsonMode) {
      p.log.info(`Location: ${pc.cyan('Project')} ${pc.dim('(current directory)')}`);
    }
    return process.cwd();
  }
  if (globalFlag) {
    if (!jsonMode) {
      p.log.info(`Location: ${pc.cyan('Global')} ${pc.dim('(home directory)')}`);
    }
    return homedir();
  }

  // Non-TTY or JSON mode defaults to project (more common for init)
  if (!isInputTTY() || jsonMode) {
    return process.cwd();
  }

  // Interactive selection
  const location = await p.select({
    message: 'Install location',
    options: [
      {
        value: 'project',
        label: 'Project',
        hint: 'For this project only (recommended)',
      },
      {
        value: 'global',
        label: 'Global',
        hint: 'Available in all projects',
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
    message: 'Create for all detected agents?',
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
