/**
 * `skillfish list` command - List installed skills.
 */

import { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { printBanner } from '../lib/banner.js';
import { getDetectedAgents, getAgentSkillDir, type Agent } from '../lib/agents.js';
import { listInstalledSkillsInDir } from '../lib/installer.js';
import { EXIT_CODES, type ExitCode } from '../lib/constants.js';
import { isTTY, isInputTTY, type ListJsonOutput, type InstalledSkill } from '../utils.js';

// === Types ===

interface ListCommandOptions {
  project?: boolean;
  global?: boolean;
  agent?: string;
}

export const listCommand = new Command('list')
  .description('List installed skills across all detected agents')
  .option('--project', 'List project-level skills only (./.claude)')
  .option('--global', 'List global skills only (~/.claude)')
  .option('--agent <name>', 'Filter to a specific agent')
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText(
    'after',
    `
Examples:
  $ skillfish list                        List all installed skills
  $ skillfish list --agent "Claude Code"  List skills for a specific agent
  $ skillfish list --project              List skills in current project
  $ skillfish list --global               List global skills only`,
  )
  .action(async (options: ListCommandOptions, command: Command) => {
    const jsonMode = command.parent?.opts().json ?? false;
    const projectFlag = options.project ?? false;
    const globalFlag = options.global ?? false;
    const agentFilter = options.agent;

    // JSON output state (typed as ListJsonOutput)
    const jsonOutput: Partial<ListJsonOutput> = {
      success: true,
      errors: [],
    };

    function addError(message: string): void {
      jsonOutput.errors!.push(message);
      jsonOutput.success = false;
    }

    function outputJsonAndExit(exitCode: ExitCode, data: Partial<ListJsonOutput> = {}): never {
      const output: ListJsonOutput = {
        success: jsonOutput.success!,
        exit_code: exitCode,
        errors: jsonOutput.errors!,
        installed: data.installed ?? [],
        agents_detected: data.agents_detected ?? [],
      };
      console.log(JSON.stringify(output, null, 2));
      process.exit(exitCode);
    }

    function exitWithError(
      message: string,
      exitCode: ExitCode,
      data: Partial<ListJsonOutput> = {},
    ): never {
      if (jsonMode) {
        addError(message);
        outputJsonAndExit(exitCode, data);
      }
      p.log.error(message);
      process.exit(exitCode);
    }

    // Determine which locations to check
    // By default, check both global and project. Flags narrow it down.
    const checkGlobal = !projectFlag; // Check global unless --project is set
    const checkProject = !globalFlag; // Check project unless --global is set

    // Detect agents
    const detected = getDetectedAgents();

    if (detected.length === 0) {
      exitWithError(
        'No agents detected. Install Claude Code, Cursor, or another supported agent first.',
        EXIT_CODES.GENERAL_ERROR,
        { installed: [], agents_detected: [] },
      );
    }

    // Helper to collect skills for given agents
    function collectSkills(agents: readonly Agent[]): {
      installed: InstalledSkill[];
      globalSkills: InstalledSkill[];
      projectSkills: InstalledSkill[];
    } {
      const installed: InstalledSkill[] = [];
      const globalSkills: InstalledSkill[] = [];
      const projectSkills: InstalledSkill[] = [];
      const seenPaths = new Set<string>();

      for (const agent of agents) {
        if (checkGlobal) {
          const globalDir = getAgentSkillDir(agent, homedir());
          const skills = listInstalledSkillsInDir(globalDir);
          for (const skill of skills) {
            const skillPath = join(globalDir, skill);
            if (!seenPaths.has(skillPath)) {
              seenPaths.add(skillPath);
              const item: InstalledSkill = {
                agent: agent.name,
                skill,
                path: skillPath,
                location: 'global',
              };
              installed.push(item);
              globalSkills.push(item);
            }
          }
        }
        if (checkProject) {
          const projectDir = getAgentSkillDir(agent, process.cwd());
          const skills = listInstalledSkillsInDir(projectDir);
          for (const skill of skills) {
            const skillPath = join(projectDir, skill);
            // Skip if already seen (avoids duplicates when cwd is under home)
            if (!seenPaths.has(skillPath)) {
              seenPaths.add(skillPath);
              const item: InstalledSkill = {
                agent: agent.name,
                skill,
                path: skillPath,
                location: 'project',
              };
              installed.push(item);
              projectSkills.push(item);
            }
          }
        }
      }

      return { installed, globalSkills, projectSkills };
    }

    // Helper to display skills for a single location
    function displaySkillsForLocation(skills: InstalledSkill[], locationLabel: string): void {
      console.log();
      console.log(pc.bold(pc.underline(locationLabel)));
      for (const item of skills) {
        console.log(`  ${pc.green('•')} ${item.skill}`);
      }
      console.log();
      p.outro(`${pc.cyan(skills.length.toString())} skill${skills.length === 1 ? '' : 's'}`);
    }

    // Filter to specific agent if --agent flag provided
    if (agentFilter) {
      const found = detected.filter((a) => a.name.toLowerCase() === agentFilter.toLowerCase());
      if (found.length === 0) {
        exitWithError(
          `Agent "${agentFilter}" not found. Detected: ${detected.map((a) => a.name).join(', ')}`,
          EXIT_CODES.NOT_FOUND,
          { installed: [], agents_detected: detected.map((a) => a.name) },
        );
      }
      const { installed, globalSkills, projectSkills } = collectSkills(found);

      if (jsonMode) {
        outputJsonAndExit(EXIT_CODES.SUCCESS, {
          installed,
          agents_detected: detected.map((a) => a.name),
        });
      }

      // Display intro (TTY only, not in JSON mode)
      if (isTTY() && !jsonMode) {
        printBanner();
      }
      p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim(`Skills for ${found[0].name}`)}`);

      if (globalSkills.length === 0 && projectSkills.length === 0) {
        p.outro(pc.dim('No skills installed'));
        process.exit(EXIT_CODES.SUCCESS);
      }

      // If both locations have skills, show location selector (same as interactive)
      const hasBothLocations = globalSkills.length > 0 && projectSkills.length > 0;

      if (hasBothLocations && isInputTTY()) {
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

        const skillsToShow = selectedLocation === 'global' ? globalSkills : projectSkills;
        const locationLabel = selectedLocation === 'global' ? 'Global (~/)' : 'Project (./)';
        displaySkillsForLocation(skillsToShow, locationLabel);
      } else {
        // Non-interactive or single location: show available skills
        if (globalSkills.length > 0) {
          displaySkillsForLocation(globalSkills, 'Global (~/)');
        } else {
          displaySkillsForLocation(projectSkills, 'Project (./)');
        }
      }
      process.exit(EXIT_CODES.SUCCESS);
    }

    // JSON mode without agent filter: return all skills
    if (jsonMode) {
      const { installed } = collectSkills(detected);
      outputJsonAndExit(EXIT_CODES.SUCCESS, {
        installed,
        agents_detected: detected.map((a) => a.name),
      });
    }

    // Interactive mode: show agent selector
    if (isInputTTY()) {
      if (isTTY() && !jsonMode) {
        printBanner();
      }
      p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim('Installed skills')}`);

      // Step 1: Build options with skill counts in label (always visible)
      const agentOptions = detected.map((agent) => {
        const { installed } = collectSkills([agent]);
        const count = installed.length;
        return {
          value: agent.name,
          label: `${agent.name} ${pc.dim(`(${count})`)}`,
        };
      });

      const selected = await p.select({
        message: 'Select an agent',
        options: agentOptions,
      });

      if (p.isCancel(selected)) {
        p.cancel('Cancelled');
        process.exit(EXIT_CODES.SUCCESS);
      }

      const selectedAgent = detected.find((a) => a.name === selected);
      if (!selectedAgent) {
        process.exit(EXIT_CODES.SUCCESS);
      }

      // Step 2: Get skills for selected agent
      const { globalSkills, projectSkills } = collectSkills([selectedAgent]);
      const hasBothLocations = globalSkills.length > 0 && projectSkills.length > 0;

      if (globalSkills.length === 0 && projectSkills.length === 0) {
        p.log.info(`No skills installed for ${pc.cyan(selectedAgent.name)}`);
        p.outro(pc.dim('Done'));
        process.exit(EXIT_CODES.SUCCESS);
      }

      // Step 3: If both locations have skills, let user choose location
      let skillsToShow: InstalledSkill[];
      let locationLabel: string;

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
        locationLabel = selectedLocation === 'global' ? 'Global (~/)' : 'Project (./)';
      } else {
        // Only one location has skills, use that
        if (globalSkills.length > 0) {
          skillsToShow = globalSkills;
          locationLabel = 'Global (~/)';
        } else {
          skillsToShow = projectSkills;
          locationLabel = 'Project (./)';
        }
      }

      // Step 4: Display skills for selected location
      displaySkillsForLocation(skillsToShow, locationLabel);
      process.exit(EXIT_CODES.SUCCESS);
    }

    // Non-interactive mode: display all agents with skills
    const { installed, globalSkills, projectSkills } = collectSkills(detected);

    if (isTTY() && !jsonMode) {
      printBanner();
    }
    p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim('Installed skills')}`);
    console.log();
    console.log(pc.bold('Detected Agents'));
    console.log(`  ${detected.map((a) => a.name).join(', ')}`);

    // Group by agent
    function displayByAgent(skills: InstalledSkill[], location: string): boolean {
      const byAgent = new Map<string, string[]>();
      for (const item of skills) {
        const list = byAgent.get(item.agent) || [];
        list.push(item.skill);
        byAgent.set(item.agent, list);
      }
      if (byAgent.size === 0) return false;

      console.log();
      console.log(pc.bold(pc.underline(location)));
      for (const [agent, agentSkills] of byAgent) {
        console.log(`  ${pc.cyan(agent)} ${pc.dim(`(${agentSkills.length})`)}`);
        for (const skill of agentSkills) {
          console.log(`    ${pc.green('•')} ${skill}`);
        }
      }
      return true;
    }

    if (checkGlobal) displayByAgent(globalSkills, 'Global (~/)');
    if (checkProject) displayByAgent(projectSkills, 'Project (./)');

    console.log();
    if (installed.length === 0) {
      p.outro(pc.dim('No skills installed'));
    } else {
      p.outro(
        `${pc.cyan(installed.length.toString())} skill${installed.length === 1 ? '' : 's'} total`,
      );
    }
    process.exit(EXIT_CODES.SUCCESS);
  });
