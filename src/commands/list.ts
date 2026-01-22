/**
 * `skillfish list` command - List installed skills.
 */

import { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, rmSync } from 'fs';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { getDetectedAgents, getAgentSkillDir, type Agent } from '../lib/agents.js';
import { listInstalledSkillsInDir } from '../lib/installer.js';
import { EXIT_CODES, type ExitCode } from '../lib/constants.js';
import { isInputTTY, type ListJsonOutput, type InstalledSkill } from '../utils.js';

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
  .addHelpText('after', `
Examples:
  $ skillfish list                        List all installed skills
  $ skillfish list --agent "Claude Code"  List skills for a specific agent
  $ skillfish list --project              List skills in current project
  $ skillfish list --global               List global skills only`)
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

    function exitWithError(message: string, exitCode: ExitCode, data: Partial<ListJsonOutput> = {}): never {
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
        { installed: [], agents_detected: [] }
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
              const item: InstalledSkill = { agent: agent.name, skill, path: skillPath, location: 'global' };
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
              const item: InstalledSkill = { agent: agent.name, skill, path: skillPath, location: 'project' };
              installed.push(item);
              projectSkills.push(item);
            }
          }
        }
      }

      return { installed, globalSkills, projectSkills };
    }

    // Helper to display skills for an agent
    function displaySkills(
      globalSkills: InstalledSkill[],
      projectSkills: InstalledSkill[],
      agentName?: string
    ): void {
      const title = agentName ? `Skills for ${agentName}` : 'Installed skills';
      console.log();
      p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim(title)}`);

      let hasContent = false;

      if (checkGlobal && globalSkills.length > 0) {
        console.log();
        console.log(pc.bold(pc.underline('Global (~/.)')));
        for (const item of globalSkills) {
          console.log(`  ${pc.green('•')} ${item.skill}`);
        }
        hasContent = true;
      }

      if (checkProject && projectSkills.length > 0) {
        console.log();
        console.log(pc.bold(pc.underline('Project (./)')));
        for (const item of projectSkills) {
          console.log(`  ${pc.green('•')} ${item.skill}`);
        }
        hasContent = true;
      }

      const total = globalSkills.length + projectSkills.length;
      console.log();
      if (total === 0) {
        p.outro(pc.dim('No skills installed'));
      } else {
        p.outro(`${pc.cyan(total.toString())} skill${total === 1 ? '' : 's'}`);
      }
    }

    // Filter to specific agent if --agent flag provided
    if (agentFilter) {
      const found = detected.filter(
        (a) => a.name.toLowerCase() === agentFilter.toLowerCase()
      );
      if (found.length === 0) {
        exitWithError(
          `Agent "${agentFilter}" not found. Detected: ${detected.map((a) => a.name).join(', ')}`,
          EXIT_CODES.NOT_FOUND,
          { installed: [], agents_detected: detected.map((a) => a.name) }
        );
      }
      const { installed, globalSkills, projectSkills } = collectSkills(found);

      if (jsonMode) {
        outputJsonAndExit(EXIT_CODES.SUCCESS, {
          installed,
          agents_detected: detected.map((a) => a.name),
        });
      }

      displaySkills(globalSkills, projectSkills, found[0].name);
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

    // Interactive mode: show agent selector with skill management
    if (isInputTTY()) {
      console.log();
      p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim('Manage skills')}`);

      // Build options with skill counts in label (always visible)
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

      // Get skills for selected agent
      const { installed: agentSkills } = collectSkills([selectedAgent]);

      if (agentSkills.length === 0) {
        p.log.info(`No skills installed for ${pc.cyan(selectedAgent.name)}`);
        p.outro(pc.dim('Done'));
        process.exit(EXIT_CODES.SUCCESS);
      }

      // Single multi-select: select skills to remove (or none to exit)
      const skillOptions = agentSkills.map((item) => ({
        value: item.path,
        label: item.skill,
        hint: item.location ?? 'global',
      }));

      const toRemove = await p.multiselect({
        message: `${selectedAgent.name} skills ${pc.dim('(select to remove, enter to confirm)')}`,
        options: skillOptions,
        required: false,
      });

      if (p.isCancel(toRemove)) {
        p.cancel('Cancelled');
        process.exit(EXIT_CODES.SUCCESS);
      }

      if (toRemove.length === 0) {
        p.outro(pc.dim('No changes'));
        process.exit(EXIT_CODES.SUCCESS);
      }

      // Confirm removal
      const skillNames = toRemove.map((path) => {
        const found = agentSkills.find((s) => s.path === path);
        return found?.skill || path;
      });

      console.log();
      p.log.warn(pc.yellow('Skills to remove:'));
      for (const name of skillNames) {
        console.log(`  ${pc.red('•')} ${name}`);
      }

      const confirm = await p.confirm({
        message: `Remove ${toRemove.length} skill${toRemove.length === 1 ? '' : 's'}?`,
        initialValue: false,
      });

      if (p.isCancel(confirm) || !confirm) {
        p.cancel('Cancelled');
        process.exit(EXIT_CODES.SUCCESS);
      }

      // Perform removal
      let removed = 0;
      for (const skillPath of toRemove) {
        try {
          if (existsSync(skillPath)) {
            rmSync(skillPath, { recursive: true });
            const skillName = agentSkills.find((s) => s.path === skillPath)?.skill || skillPath;
            console.log(`  ${pc.green('✓')} Removed ${skillName}`);
            removed++;
          }
        } catch (err) {
          const skillName = agentSkills.find((s) => s.path === skillPath)?.skill || skillPath;
          console.log(`  ${pc.red('✗')} Failed to remove ${skillName}`);
        }
      }

      console.log();
      if (removed > 0) {
        p.outro(pc.green(`Removed ${removed} skill${removed === 1 ? '' : 's'}`));
      } else {
        p.outro(pc.yellow('No skills removed'));
      }
      process.exit(EXIT_CODES.SUCCESS);
    }

    // Non-interactive mode without agent filter: show all agents with skills
    const { installed, globalSkills, projectSkills } = collectSkills(detected);

    console.log();
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
      p.outro(`${pc.cyan(installed.length.toString())} skill${installed.length === 1 ? '' : 's'} total`);
    }
    process.exit(EXIT_CODES.SUCCESS);
  });
