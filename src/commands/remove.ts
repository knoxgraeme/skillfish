/**
 * `skillfish remove` command - Remove installed skills.
 */

import { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, rmSync } from 'fs';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { getDetectedAgents, getAgentSkillDir, type Agent } from '../lib/agents.js';
import { listInstalledSkillsInDir } from '../lib/installer.js';
import { isTTY, isInputTTY } from '../utils.js';
import { EXIT_CODES, type ExitCode } from '../lib/constants.js';
import type { RemoveJsonOutput, InstalledSkill } from '../utils.js';

// === Types ===

interface RemoveCommandOptions {
  yes?: boolean;
  all?: boolean;
  project?: boolean;
  global?: boolean;
  agent?: string;
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
  .addHelpText('after', `
Examples:
  $ skillfish remove my-skill           Remove a skill by name
  $ skillfish remove --all              Remove all installed skills
  $ skillfish remove my-skill --agent Claude  Remove from specific agent`)
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
      console.log();
      console.log(pc.cyan('     ≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋'));
      console.log(`       ${pc.cyan('><>')}  ${pc.bold('SKILL FISH')}  ${pc.cyan('><>')}`);
      console.log(pc.cyan('     ≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋'));
      console.log();
      p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim(`v${version}`)}`);
    }

    const skipConfirm = options.yes ?? false;
    const removeAll = options.all ?? false;
    const projectFlag = options.project ?? false;
    const globalFlag = options.global ?? false;
    const targetAgentName = options.agent;

    // Validate args: need either skill name or --all
    if (!skillArg && !removeAll) {
      exitWithError(
        'Please specify a skill name or use --all to remove all skills',
        EXIT_CODES.GENERAL_ERROR
      );
    }

    // Determine base directory
    const baseDir = projectFlag ? process.cwd() : globalFlag ? homedir() : homedir();

    // Detect agents
    const detected = getDetectedAgents();

    if (detected.length === 0) {
      exitWithError(
        'No agents detected. Install Claude Code, Cursor, or another supported agent first.',
        EXIT_CODES.GENERAL_ERROR,
        true // useClackLog
      );
    }

    // Filter to target agent if specified
    let targetAgents: readonly Agent[] = detected;
    if (targetAgentName) {
      const found = detected.filter(
        (a) => a.name.toLowerCase() === targetAgentName.toLowerCase()
      );
      if (found.length === 0) {
        exitWithError(
          `Agent "${targetAgentName}" not found. Detected agents: ${detected.map((a) => a.name).join(', ')}`,
          EXIT_CODES.NOT_FOUND,
          true // useClackLog
        );
      }
      targetAgents = found;
    }

    // Find skills to remove
    const skillsToRemove: Array<{ skill: string; agent: Agent; path: string }> = [];

    for (const agent of targetAgents) {
      const skillDir = getAgentSkillDir(agent, baseDir);
      const installed = listInstalledSkillsInDir(skillDir);

      if (removeAll) {
        // Remove all skills for this agent
        for (const skill of installed) {
          skillsToRemove.push({
            skill,
            agent,
            path: join(skillDir, skill),
          });
        }
      } else if (skillArg) {
        // Remove specific skill if it exists
        if (installed.includes(skillArg)) {
          skillsToRemove.push({
            skill: skillArg,
            agent,
            path: join(skillDir, skillArg),
          });
        }
      }
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
        console.log(`  ${pc.red('•')} ${item.skill} ${pc.dim(`(${item.agent.name})`)}`);
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
            console.log(`  ${pc.green('✓')} Removed ${item.skill} ${pc.dim(`from ${item.agent.name}`)}`);
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

    // Output results
    if (jsonMode) {
      outputJsonAndExit(result.success ? EXIT_CODES.SUCCESS : EXIT_CODES.GENERAL_ERROR);
    }

    console.log();
    if (result.removed.length > 0) {
      p.outro(pc.green(`Done! Removed ${result.removed.length} skill${result.removed.length === 1 ? '' : 's'}`));
    } else {
      p.outro(pc.yellow('No skills removed'));
    }
    process.exit(result.success ? EXIT_CODES.SUCCESS : EXIT_CODES.GENERAL_ERROR);
  });
