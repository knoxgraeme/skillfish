/**
 * `skillfish list` command - List installed skills.
 */

import { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { getDetectedAgents, getAgentSkillDir } from '../lib/agents.js';
import { listInstalledSkillsInDir } from '../lib/installer.js';

// === Exit Codes ===
const EXIT_SUCCESS = 0;
const EXIT_GENERAL_ERROR = 1;

type InstalledSkill = { agent: string; skill: string; path: string };

export const listCommand = new Command('list')
  .description('List installed skills')
  .option('--project', 'List project skills only')
  .option('--global', 'List global skills only')
  .action(async (options, command) => {
    const jsonMode = command.parent?.opts().json ?? false;
    const projectFlag = options.project ?? false;
    const globalFlag = options.global ?? false;

    // Determine base directory
    const baseDir = projectFlag ? process.cwd() : globalFlag ? homedir() : homedir();

    // Detect agents
    const detected = getDetectedAgents();

    if (detected.length === 0) {
      if (jsonMode) {
        console.log(
          JSON.stringify({
            success: false,
            installed: [],
            agents_detected: [],
            errors: ['No agents detected'],
          })
        );
      } else {
        p.log.error('No agents detected. Install Claude Code, Cursor, or another supported agent first.');
      }
      process.exit(EXIT_GENERAL_ERROR);
    }

    // Collect installed skills
    const installed: InstalledSkill[] = [];

    for (const agent of detected) {
      const skillDir = getAgentSkillDir(agent, baseDir);
      const skills = listInstalledSkillsInDir(skillDir);

      for (const skill of skills) {
        installed.push({
          agent: agent.name,
          skill,
          path: join(skillDir, skill),
        });
      }
    }

    // Output results
    if (jsonMode) {
      console.log(
        JSON.stringify(
          {
            success: true,
            installed,
            agents_detected: detected.map((a) => a.name),
          },
          null,
          2
        )
      );
      process.exit(EXIT_SUCCESS);
    }

    // Human-readable output
    if (installed.length === 0) {
      p.log.info('No skills installed');
      process.exit(EXIT_SUCCESS);
    }

    console.log();
    p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim('Installed skills')}`);

    // Group by agent
    const byAgent = new Map<string, string[]>();
    for (const item of installed) {
      const list = byAgent.get(item.agent) || [];
      list.push(item.skill);
      byAgent.set(item.agent, list);
    }

    for (const [agent, skills] of byAgent) {
      console.log();
      console.log(pc.bold(agent));
      for (const skill of skills) {
        console.log(`  ${pc.green('•')} ${skill}`);
      }
    }

    console.log();
    p.outro(`${pc.cyan(installed.length.toString())} skill${installed.length === 1 ? '' : 's'} installed`);
    process.exit(EXIT_SUCCESS);
  });
