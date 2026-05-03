/**
 * `skillfish list` command - List installed skills.
 */

import { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { printBanner } from '../lib/banner.js';
import { trackCommand } from '../telemetry.js';
import {
  getDetectedAgentsForLocation,
  getAgentSkillDir,
  type Agent,
  type DetectionLocation,
} from '../lib/agents.js';
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

    // Validate flag conflicts
    if (projectFlag && globalFlag) {
      exitWithError(
        'Cannot use both --project and --global. Choose one.',
        EXIT_CODES.INVALID_ARGS,
        {
          installed: [],
          agents_detected: [],
        },
      );
    }

    // Track command usage (fire and forget)
    trackCommand('list');

    // Determine which locations to check
    // By default, check both global and project. Flags narrow it down.
    const checkGlobal = !projectFlag; // Check global unless --project is set
    const checkProject = !globalFlag; // Check project unless --global is set

    // Determine detection location based on flags
    const detectionLocation: DetectionLocation =
      projectFlag && !globalFlag ? 'project' : globalFlag && !projectFlag ? 'global' : 'both';

    // Detect agents for the appropriate location
    const detected = getDetectedAgentsForLocation(detectionLocation, process.cwd());

    // When a specific location flag is used and no agents found, return empty results (not an error)
    // Only error when no flags specified (location='both') and no agents found anywhere
    if (detected.length === 0) {
      if (detectionLocation === 'both') {
        exitWithError(
          'No agents detected. Install Claude Code, Cursor, or another supported agent first.',
          EXIT_CODES.GENERAL_ERROR,
          { installed: [], agents_detected: [] },
        );
      }

      // For --project or --global with no agents, return success with empty list
      if (jsonMode) {
        outputJsonAndExit(EXIT_CODES.SUCCESS, { installed: [], agents_detected: [] });
      }

      if (isTTY()) {
        printBanner();
      }
      p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim('Installed skills')}`);
      const locationLabel = detectionLocation === 'project' ? 'project' : 'globally';
      p.outro(pc.dim(`No agents configured ${locationLabel}`));
      process.exit(EXIT_CODES.SUCCESS);
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

    // Interactive mode: location-first flow
    if (isInputTTY()) {
      if (isTTY() && !jsonMode) {
        printBanner();
      }
      p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim('Installed skills')}`);

      // Step 1: Choose location first
      const locationChoice = await p.select({
        message: 'View skills in',
        options: [
          { value: 'global' as const, label: 'Global', hint: 'Skills in ~/' },
          { value: 'project' as const, label: 'Project', hint: 'Skills in ./' },
        ],
      });

      if (p.isCancel(locationChoice)) {
        p.cancel('Cancelled');
        process.exit(EXIT_CODES.SUCCESS);
      }

      // Step 2: Detect agents for the chosen location
      const locationAgents = getDetectedAgentsForLocation(locationChoice, process.cwd());
      const isLocal = locationChoice === 'project';
      const locationLabel = isLocal ? 'Project (./)' : 'Global (~/)';

      if (locationAgents.length === 0) {
        const hint = isLocal
          ? 'No agents configured in this project.'
          : 'No agents installed globally.';
        p.log.info(pc.dim(hint));
        p.outro(pc.dim('Done'));
        process.exit(EXIT_CODES.SUCCESS);
      }

      // Step 3: Collect skills for this location only
      const collectSkillsForLocation = (agents: readonly Agent[]): InstalledSkill[] => {
        const skills: InstalledSkill[] = [];
        const baseDir = isLocal ? process.cwd() : homedir();
        for (const agent of agents) {
          const skillDir = getAgentSkillDir(agent, baseDir);
          const installed = listInstalledSkillsInDir(skillDir);
          for (const skill of installed) {
            skills.push({
              agent: agent.name,
              skill,
              path: join(skillDir, skill),
              location: locationChoice,
            });
          }
        }
        return skills;
      };

      const allSkills = collectSkillsForLocation(locationAgents);

      if (allSkills.length === 0) {
        p.log.info(`No skills installed in ${locationLabel}`);
        p.outro(pc.dim('Done'));
        process.exit(EXIT_CODES.SUCCESS);
      }

      // Step 4: If multiple agents have skills, let user select one (or show all)
      const agentSkillCounts = new Map<string, number>();
      for (const skill of allSkills) {
        agentSkillCounts.set(skill.agent, (agentSkillCounts.get(skill.agent) || 0) + 1);
      }

      if (agentSkillCounts.size === 1) {
        // Only one agent has skills, show them directly
        displaySkillsForLocation(allSkills, locationLabel);
        process.exit(EXIT_CODES.SUCCESS);
      }

      // Multiple agents - let user choose
      const agentOptions = Array.from(agentSkillCounts.entries()).map(([name, count]) => ({
        value: name,
        label: `${name} ${pc.dim(`(${count})`)}`,
      }));

      const selectedAgent = await p.select({
        message: 'Select an agent',
        options: agentOptions,
      });

      if (p.isCancel(selectedAgent)) {
        p.cancel('Cancelled');
        process.exit(EXIT_CODES.SUCCESS);
      }

      const filteredSkills = allSkills.filter((s) => s.agent === selectedAgent);
      displaySkillsForLocation(filteredSkills, locationLabel);
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
