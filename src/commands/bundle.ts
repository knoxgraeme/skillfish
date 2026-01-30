/**
 * `skillfish bundle` command - Bundle installed skills into a manifest file.
 */

import { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { printBanner } from '../lib/banner.js';
import { getDetectedAgentsForLocation, getAgentSkillDir, type Agent } from '../lib/agents.js';
import { listInstalledSkillsInDir } from '../lib/installer.js';
import { readManifest, type SkillManifest } from '../lib/manifest.js';
import {
  writeProjectManifest,
  getProjectManifestPath,
  formatSkillEntry,
  type ProjectManifest,
  PROJECT_MANIFEST_VERSION,
} from '../lib/project-manifest.js';
import { EXIT_CODES, type ExitCode } from '../lib/constants.js';
import { isTTY, type BundleJsonOutput } from '../utils.js';

// === Types ===

interface BundleCommandOptions {
  global?: boolean;
}

/**
 * Discovered skill from scanning agent directories.
 */
interface DiscoveredSkill {
  name: string;
  agent: Agent;
  path: string;
  manifest: SkillManifest | null;
}

// === Command Definition ===

export const bundleCommand = new Command('bundle')
  .description('Bundle installed skills into a .skillfish.json manifest')
  .option('--global', 'Bundle global skills to ~/.skillfish.json')
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText(
    'after',
    `
Examples:
  $ skillfish bundle              Bundle project skills to ./.skillfish.json
  $ skillfish bundle --global     Bundle global skills to ~/.skillfish.json
  $ skillfish bundle --json       Output bundled skills as JSON`,
  )
  .action(async (options: BundleCommandOptions, command: Command) => {
    const jsonMode = command.parent?.opts().json ?? false;
    const version = command.parent?.opts().version ?? '0.0.0';
    const globalFlag = options.global ?? false;

    // JSON output state
    const jsonOutput: BundleJsonOutput = {
      success: true,
      exit_code: EXIT_CODES.SUCCESS,
      errors: [],
      skills: [],
      saved_to: null,
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

    // Determine scope
    const location = globalFlag ? 'global' : 'project';
    const baseDir = globalFlag ? homedir() : process.cwd();
    const manifestPath = getProjectManifestPath(globalFlag);

    // Detect agents for this location
    const detected = getDetectedAgentsForLocation(location, process.cwd());

    if (detected.length === 0) {
      const locationLabel = globalFlag ? 'globally' : 'in this project';
      exitWithError(
        `No agents detected ${locationLabel}. Install Claude Code, Cursor, or another supported agent first.`,
        EXIT_CODES.GENERAL_ERROR,
      );
    }

    // Show scanning spinner
    let spinner: ReturnType<typeof p.spinner> | null = null;
    if (!jsonMode) {
      spinner = p.spinner();
      spinner.start(`Scanning ${location} skills...`);
    }

    // Scan for installed skills
    const discoveredSkills = scanInstalledSkills(detected, baseDir);

    if (discoveredSkills.length === 0) {
      if (spinner) {
        spinner.stop(pc.yellow('No skills found'));
      }

      if (jsonMode) {
        outputJsonAndExit(EXIT_CODES.SUCCESS);
      }

      console.log();
      p.log.info(pc.dim(`No skills found in ${location} scope.`));
      p.log.info(pc.dim(`Run ${pc.cyan('skillfish add owner/repo')} to install skills first.`));
      p.outro(pc.dim('Done'));
      process.exit(EXIT_CODES.SUCCESS);
    }

    if (spinner) {
      spinner.stop(
        `Found ${pc.cyan(discoveredSkills.length.toString())} skill${discoveredSkills.length === 1 ? '' : 's'}`,
      );
    }

    // Build skill entries from discovered skills
    const skillEntries = buildSkillEntries(discoveredSkills);

    // Deduplicate entries (same skill may be installed to multiple agents)
    const uniqueEntries = [...new Set(skillEntries)];

    // Create manifest
    const manifest: ProjectManifest = {
      version: PROJECT_MANIFEST_VERSION,
      skills: uniqueEntries,
    };

    // Write manifest
    try {
      writeProjectManifest(manifestPath, manifest);
      jsonOutput.skills = uniqueEntries;
      jsonOutput.saved_to = manifestPath;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      exitWithError(`Failed to write manifest: ${msg}`, EXIT_CODES.GENERAL_ERROR);
    }

    // Output results
    if (jsonMode) {
      outputJsonAndExit(EXIT_CODES.SUCCESS);
    }

    console.log();
    for (const entry of uniqueEntries) {
      console.log(`  ${pc.green('•')} ${entry}`);
    }

    console.log();
    p.log.success(`Created ${pc.cyan(globalFlag ? '~/.skillfish.json' : '.skillfish.json')}`);

    if (globalFlag) {
      p.log.info(pc.dim('Tip: Add ~/.skillfish.json to your dotfiles for cross-machine sync.'));
    } else {
      p.log.info(
        pc.dim(`Commit this file and run ${pc.cyan('skillfish install')} to sync with your team.`),
      );
    }

    p.outro(pc.green('Done'));
    process.exit(EXIT_CODES.SUCCESS);
  });

// === Helper Functions ===

/**
 * Scan for installed skills across all detected agents.
 */
function scanInstalledSkills(agents: readonly Agent[], baseDir: string): DiscoveredSkill[] {
  const discovered: DiscoveredSkill[] = [];
  const seenPaths = new Set<string>();

  for (const agent of agents) {
    const skillDir = getAgentSkillDir(agent, baseDir);
    const skills = listInstalledSkillsInDir(skillDir);

    for (const skillName of skills) {
      const skillPath = join(skillDir, skillName);

      // Avoid duplicates (same skill path from different detection methods)
      if (seenPaths.has(skillPath)) {
        continue;
      }
      seenPaths.add(skillPath);

      // Read manifest if available
      const manifest = readManifest(skillPath);

      discovered.push({
        name: skillName,
        agent,
        path: skillPath,
        manifest,
      });
    }
  }

  return discovered;
}

/**
 * Build skill entry strings from discovered skills.
 * Uses manifest data when available, falls back to skill name when not.
 */
function buildSkillEntries(skills: DiscoveredSkill[]): string[] {
  const entries: string[] = [];

  for (const skill of skills) {
    if (skill.manifest) {
      // Build entry from manifest
      const entry = formatSkillEntry({
        owner: skill.manifest.owner,
        repo: skill.manifest.repo,
        ref: skill.manifest.ref,
        path: skill.manifest.path === '.' ? undefined : skill.manifest.path,
        original: '',
      });
      entries.push(entry);
    } else {
      // No manifest - we can't determine the source
      // This skill was installed before manifest tracking
      // We'll use the skill name as a placeholder, but warn the user
      // (In practice, this will be rare for skills installed with newer versions)
      entries.push(`unknown/${skill.name}`);
    }
  }

  return entries;
}
