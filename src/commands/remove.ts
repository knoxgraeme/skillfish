/**
 * `skillfish remove` command - Remove installed skills.
 */

import { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, rmSync } from 'fs';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { printBanner } from '../lib/banner.js';
import {
  getDetectedAgentsForLocation,
  getAgentSkillDir,
  type Agent,
  type DetectionLocation,
} from '../lib/agents.js';
import { listInstalledSkillsInDir } from '../lib/installer.js';
import { isTTY, isInputTTY } from '../utils.js';
import { EXIT_CODES, type ExitCode } from '../lib/constants.js';
import type { RemoveJsonOutput } from '../utils.js';

// === Types ===

interface RemoveCommandOptions {
  yes?: boolean;
  all?: boolean;
  project?: boolean;
  global?: boolean;
  agent?: string;
}

interface SkillToRemove {
  skill: string;
  agent: Agent;
  path: string;
  location: 'global' | 'project';
}

// === Command Definition ===

export const removeCommand = new Command('remove')
  .description('Remove an installed skill from your agents')
  .argument('[skill]', 'Name of the skill to remove')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('--all', 'Remove all installed skills')
  .option('--project', 'Remove from current project only (./.claude)')
  .option('--global', 'Remove from home directory only (~/.claude)')
  .option('--agent <name>', 'Remove from a specific agent only')
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText(
    'after',
    `
Examples:
  $ skillfish remove                    Interactive skill picker
  $ skillfish remove my-skill           Remove a skill by name
  $ skillfish remove --all              Remove all installed skills
  $ skillfish remove my-skill --project Remove from current project only
  $ skillfish remove my-skill --agent "Claude Code"  Remove from specific agent`,
  )
  .action(async (skillArg: string | undefined, options: RemoveCommandOptions, command: Command) => {
    const jsonMode = command.parent?.opts().json ?? false;
    const version = command.parent?.opts().version ?? '0.0.0';

    const result: RemoveJsonOutput = {
      success: true,
      removed: [],
      errors: [],
    };

    function addError(message: string): void {
      result.errors.push(message);
      result.success = false;
    }

    function outputJsonAndExit(exitCode: ExitCode): never {
      result.exit_code = exitCode;
      console.log(JSON.stringify(result, null, 2));
      process.exit(exitCode);
    }

    /**
     * Unified error handler that handles both JSON and TTY modes.
     */
    function exitWithError(message: string, exitCode: ExitCode, useClackLog = false): never {
      if (jsonMode) {
        addError(message);
        outputJsonAndExit(exitCode);
      }
      if (useClackLog) {
        p.log.error(message);
      } else {
        console.error(`Error: ${message}`);
      }
      process.exit(exitCode);
    }

    // Show banner (TTY only, not in JSON mode)
    if (isTTY() && !jsonMode) {
      printBanner();
      p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim(`v${version}`)}`);
    }

    const skipConfirm = options.yes ?? false;
    const removeAll = options.all ?? false;
    const projectFlag = options.project ?? false;
    const globalFlag = options.global ?? false;
    const targetAgentName = options.agent;

    // Validate flag conflicts
    if (projectFlag && globalFlag) {
      exitWithError(
        'Cannot use both --project and --global. Choose one.',
        EXIT_CODES.INVALID_ARGS,
        true,
      );
    }

    // Determine which locations to check
    // By default, check both global and project. Flags narrow it down.
    const checkGlobal = !projectFlag; // Check global unless --project is set
    const checkProject = !globalFlag; // Check project unless --global is set

    // Determine detection location based on flags
    const detectionLocation: DetectionLocation =
      projectFlag && !globalFlag ? 'project' : globalFlag && !projectFlag ? 'global' : 'both';

    // Detect agents for the appropriate location
    const detected = getDetectedAgentsForLocation(detectionLocation, process.cwd());

    if (detected.length === 0) {
      const locationHint =
        detectionLocation === 'project'
          ? 'No agents configured in this project.'
          : detectionLocation === 'global'
            ? 'No agents installed globally.'
            : 'No agents detected.';
      const suggestion =
        detectionLocation === 'project'
          ? ' Create an agent directory (e.g., .claude/) or use --global.'
          : ' Install Claude Code, Cursor, or another supported agent first.';

      exitWithError(locationHint + suggestion, EXIT_CODES.GENERAL_ERROR, true);
    }

    // Filter to target agent if specified
    let targetAgents: readonly Agent[] = detected;
    if (targetAgentName) {
      const found = detected.filter((a) => a.name.toLowerCase() === targetAgentName.toLowerCase());
      if (found.length === 0) {
        exitWithError(
          `Agent "${targetAgentName}" not found. Detected agents: ${detected.map((a) => a.name).join(', ')}`,
          EXIT_CODES.NOT_FOUND,
          true, // useClackLog
        );
      }
      targetAgents = found;
    }

    // Helper to collect all installed skills across locations
    function collectAllSkills(): SkillToRemove[] {
      const skills: SkillToRemove[] = [];
      const seenPaths = new Set<string>();

      for (const agent of targetAgents) {
        if (checkGlobal) {
          const globalDir = getAgentSkillDir(agent, homedir());
          const installed = listInstalledSkillsInDir(globalDir);
          for (const skill of installed) {
            const skillPath = join(globalDir, skill);
            if (!seenPaths.has(skillPath)) {
              seenPaths.add(skillPath);
              skills.push({ skill, agent, path: skillPath, location: 'global' });
            }
          }
        }
        if (checkProject) {
          const projectDir = getAgentSkillDir(agent, process.cwd());
          const installed = listInstalledSkillsInDir(projectDir);
          for (const skill of installed) {
            const skillPath = join(projectDir, skill);
            if (!seenPaths.has(skillPath)) {
              seenPaths.add(skillPath);
              skills.push({ skill, agent, path: skillPath, location: 'project' });
            }
          }
        }
      }

      return skills;
    }

    // Helper to perform the actual removal
    async function performRemoval(skillsToRemove: SkillToRemove[]): Promise<void> {
      for (const item of skillsToRemove) {
        try {
          if (existsSync(item.path)) {
            rmSync(item.path, { recursive: true });
            result.removed.push({
              skill: item.skill,
              agent: item.agent.name,
              path: item.path,
            });
            if (!jsonMode) {
              console.log(
                `  ${pc.green('✓')} Removed ${item.skill} ${pc.dim(`from ${item.agent.name}`)}`,
              );
            }
          }
        } catch (err) {
          const errorMsg = `Failed to remove ${item.skill}: ${err instanceof Error ? err.message : String(err)}`;
          addError(errorMsg);
          if (!jsonMode) {
            console.log(`  ${pc.red('✗')} ${errorMsg}`);
          }
        }
      }
    }

    // Helper to collect skills for a specific agent
    function collectSkillsForAgent(agent: Agent): SkillToRemove[] {
      const skills: SkillToRemove[] = [];
      const seenPaths = new Set<string>();

      if (checkGlobal) {
        const globalDir = getAgentSkillDir(agent, homedir());
        const installed = listInstalledSkillsInDir(globalDir);
        for (const skill of installed) {
          const skillPath = join(globalDir, skill);
          if (!seenPaths.has(skillPath)) {
            seenPaths.add(skillPath);
            skills.push({ skill, agent, path: skillPath, location: 'global' });
          }
        }
      }
      if (checkProject) {
        const projectDir = getAgentSkillDir(agent, process.cwd());
        const installed = listInstalledSkillsInDir(projectDir);
        for (const skill of installed) {
          const skillPath = join(projectDir, skill);
          if (!seenPaths.has(skillPath)) {
            seenPaths.add(skillPath);
            skills.push({ skill, agent, path: skillPath, location: 'project' });
          }
        }
      }

      return skills;
    }

    // Interactive mode: no skill name and no --all flag
    if (!skillArg && !removeAll) {
      // In non-interactive mode, require explicit skill name or --all
      if (!isInputTTY() || jsonMode) {
        exitWithError(
          'Please specify a skill name or use --all to remove all skills (non-interactive mode)',
          EXIT_CODES.INVALID_ARGS,
        );
      }

      // Step 1: Show agent selector with skill counts
      const agentOptions = targetAgents.map((agent) => {
        const skills = collectSkillsForAgent(agent);
        const count = skills.length;
        return {
          value: agent.name,
          label: `${agent.name} ${pc.dim(`(${count})`)}`,
        };
      });

      const selectedAgentName = await p.select({
        message: 'Select an agent',
        options: agentOptions,
      });

      if (p.isCancel(selectedAgentName)) {
        p.cancel('Cancelled');
        process.exit(EXIT_CODES.SUCCESS);
      }

      const selectedAgent = targetAgents.find((a) => a.name === selectedAgentName);
      if (!selectedAgent) {
        process.exit(EXIT_CODES.SUCCESS);
      }

      // Step 2: Get skills for selected agent, split by location
      const agentSkills = collectSkillsForAgent(selectedAgent);
      const globalSkills = agentSkills.filter((s) => s.location === 'global');
      const projectSkills = agentSkills.filter((s) => s.location === 'project');

      if (agentSkills.length === 0) {
        p.log.info(`No skills installed for ${pc.cyan(selectedAgent.name)}`);
        p.outro(pc.dim('Done'));
        process.exit(EXIT_CODES.SUCCESS);
      }

      // Step 3: If both locations have skills, let user choose location
      let skillsToShow: SkillToRemove[];
      const hasBothLocations = globalSkills.length > 0 && projectSkills.length > 0;

      if (hasBothLocations) {
        const locationOptions = [
          { value: 'global' as const, label: `Global (~/) ${pc.dim(`(${globalSkills.length})`)}` },
          {
            value: 'project' as const,
            label: `Project (./) ${pc.dim(`(${projectSkills.length})`)}`,
          },
        ];

        const selectedLocation = await p.select({
          message: 'Select location',
          options: locationOptions,
        });

        if (p.isCancel(selectedLocation)) {
          p.cancel('Cancelled');
          process.exit(EXIT_CODES.SUCCESS);
        }

        skillsToShow = selectedLocation === 'global' ? globalSkills : projectSkills;
      } else {
        // Only one location has skills, use that
        skillsToShow = globalSkills.length > 0 ? globalSkills : projectSkills;
      }

      // Step 4: Show skill selector for the chosen location
      const skillOptions = skillsToShow.map((item) => ({
        value: item.path,
        label: item.skill,
      }));

      const toRemove = await p.multiselect({
        message: `Select skills to remove ${pc.dim('(space to select, enter to confirm)')}`,
        options: skillOptions,
        required: false,
      });

      if (p.isCancel(toRemove)) {
        p.cancel('Cancelled');
        process.exit(EXIT_CODES.SUCCESS);
      }

      if (toRemove.length === 0) {
        p.outro(pc.dim('No skills selected'));
        process.exit(EXIT_CODES.SUCCESS);
      }

      const selectedSkills = skillsToShow.filter((s) => toRemove.includes(s.path));

      // Confirm removal
      console.log();
      p.log.warn(pc.yellow('Skills to remove:'));
      for (const item of selectedSkills) {
        console.log(`  ${pc.red('•')} ${item.skill}`);
      }

      const confirm = await p.confirm({
        message: `Remove ${selectedSkills.length} skill${selectedSkills.length === 1 ? '' : 's'}?`,
        initialValue: false,
      });

      if (p.isCancel(confirm) || !confirm) {
        p.cancel('Cancelled');
        process.exit(EXIT_CODES.SUCCESS);
      }

      // Perform removal
      await performRemoval(selectedSkills);

      // Output results
      console.log();
      if (result.removed.length > 0) {
        p.outro(
          pc.green(
            `Done! Removed ${result.removed.length} skill${result.removed.length === 1 ? '' : 's'}`,
          ),
        );
      } else {
        p.outro(pc.yellow('No skills removed'));
      }
      process.exit(result.success ? EXIT_CODES.SUCCESS : EXIT_CODES.GENERAL_ERROR);
    }

    // Non-interactive mode: find skills to remove based on skillArg or --all
    const allSkills = collectAllSkills();
    let skillsToRemove: SkillToRemove[];

    if (removeAll) {
      skillsToRemove = allSkills;
    } else {
      // Filter to matching skill name
      skillsToRemove = allSkills.filter((s) => s.skill === skillArg);
    }

    if (skillsToRemove.length === 0) {
      const errorMsg = removeAll
        ? 'No skills installed to remove'
        : `Skill "${skillArg}" not found`;
      if (jsonMode) {
        addError(errorMsg);
        outputJsonAndExit(EXIT_CODES.NOT_FOUND);
      }
      p.log.warn(errorMsg);
      process.exit(EXIT_CODES.NOT_FOUND);
    }

    // Confirmation prompt (unless --yes is used)
    if (!skipConfirm && !jsonMode && isInputTTY()) {
      console.log();
      p.log.warn(pc.yellow('The following skills will be removed:'));
      for (const item of skillsToRemove) {
        console.log(
          `  ${pc.red('•')} ${item.skill} ${pc.dim(`(${item.agent.name}, ${item.location})`)}`,
        );
      }
      console.log();

      const proceed = await p.confirm({
        message: `Remove ${skillsToRemove.length} skill${skillsToRemove.length === 1 ? '' : 's'}?`,
        initialValue: false,
      });

      if (p.isCancel(proceed) || !proceed) {
        p.cancel('Cancelled');
        process.exit(EXIT_CODES.SUCCESS);
      }
    }

    // Perform removal
    await performRemoval(skillsToRemove);

    // Output results
    if (jsonMode) {
      outputJsonAndExit(result.success ? EXIT_CODES.SUCCESS : EXIT_CODES.GENERAL_ERROR);
    }

    console.log();
    if (result.removed.length > 0) {
      p.outro(
        pc.green(
          `Done! Removed ${result.removed.length} skill${result.removed.length === 1 ? '' : 's'}`,
        ),
      );
    } else {
      p.outro(pc.yellow('No skills removed'));
    }
    process.exit(result.success ? EXIT_CODES.SUCCESS : EXIT_CODES.GENERAL_ERROR);
  });
