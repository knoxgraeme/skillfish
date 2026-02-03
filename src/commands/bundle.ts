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
import {
  readManifest,
  hasManifest,
  healManifest,
  writeManifest,
  MANIFEST_VERSION,
  type SkillManifest,
} from '../lib/manifest.js';
import {
  writeProjectManifest,
  getProjectManifestPath,
  formatSkillEntry,
  type ProjectManifest,
  PROJECT_MANIFEST_VERSION,
} from '../lib/project-manifest.js';
import { EXIT_CODES, type ExitCode } from '../lib/constants.js';
import { isTTY, isInputTTY, type BundleJsonOutput } from '../utils.js';
import type { DetectionLocation } from '../lib/agents.js';

// === Types ===

interface BundleCommandOptions {
  global?: boolean;
  project?: boolean;
}

interface LocationResult {
  baseDir: string;
  location: DetectionLocation;
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
  .description('Bundle installed skills into a skillfish.json manifest')
  .option('--global', 'Bundle global skills to ~/skillfish.json')
  .option('--project', 'Bundle project skills to ./skillfish.json')
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText(
    'after',
    `
Examples:
  $ skillfish bundle              Bundle project skills to ./skillfish.json
  $ skillfish bundle --global     Bundle global skills to ~/skillfish.json
  $ skillfish bundle --json       Output bundled skills as JSON`,
  )
  .action(async (options: BundleCommandOptions, command: Command) => {
    const jsonMode = command.parent?.opts().json ?? false;
    const version = command.parent?.opts().version ?? '0.0.0';
    const globalFlag = options.global ?? false;
    const projectFlag = options.project ?? false;

    // Reject conflicting flags
    if (globalFlag && projectFlag) {
      if (jsonMode) {
        console.log(
          JSON.stringify({
            success: false,
            exit_code: EXIT_CODES.INVALID_ARGS,
            errors: ['Cannot specify both --global and --project'],
            skills: [],
            saved_to: null,
            skipped_local: [],
          }),
        );
        process.exit(EXIT_CODES.INVALID_ARGS);
      }
      p.log.error('Cannot specify both --global and --project');
      process.exit(EXIT_CODES.INVALID_ARGS);
    }

    // JSON output state
    const jsonOutput: BundleJsonOutput = {
      success: true,
      exit_code: EXIT_CODES.SUCCESS,
      errors: [],
      skills: [],
      saved_to: null,
      skipped_local: [],
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

    // Determine scope (interactive if no flags specified)
    const { baseDir, location } = await selectBundleLocation(projectFlag, globalFlag, jsonMode);
    const manifestPath = getProjectManifestPath(location === 'global');

    // Detect agents for this location
    const detected = getDetectedAgentsForLocation(location, process.cwd());

    if (detected.length === 0) {
      const locationLabel = location === 'global' ? 'globally' : 'in this project';
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

    // Build skill entries from discovered skills (only external skills)
    const { entries: skillEntries, skippedLocal } = buildSkillEntries(discoveredSkills);

    // Deduplicate entries (same skill may be installed to multiple agents)
    const uniqueEntries = [...new Set(skillEntries)];
    const uniqueSkipped = [...new Set(skippedLocal)];

    // Calculate counts for clear messaging
    const totalScanned = discoveredSkills.length;
    const localCount = uniqueSkipped.length;
    const externalCount = uniqueEntries.length;
    const duplicateCount = skillEntries.length - uniqueEntries.length;

    // Show scanning result with breakdown
    if (spinner) {
      const parts: string[] = [];
      if (externalCount > 0) {
        parts.push(`${externalCount} external`);
      }
      if (localCount > 0) {
        parts.push(`${localCount} local`);
      }
      if (duplicateCount > 0) {
        parts.push(`${duplicateCount} duplicates across agents`);
      }

      const breakdown = parts.length > 0 ? ` (${parts.join(', ')})` : '';
      spinner.stop(`Scanned ${pc.cyan(totalScanned.toString())} skill installations${breakdown}`);
    }

    // Record skipped local skills in JSON output
    jsonOutput.skipped_local = uniqueSkipped;

    // Show skipped local skills detail
    if (uniqueSkipped.length > 0 && !jsonMode) {
      p.log.info(pc.dim(`Local skills: ${uniqueSkipped.join(', ')}`));
      p.log.info(
        pc.dim('Local skills are version-controlled with your project, not in the manifest.'),
      );
    }

    // Handle case where all skills were local
    if (uniqueEntries.length === 0) {
      if (jsonMode) {
        outputJsonAndExit(EXIT_CODES.SUCCESS);
      }

      console.log();
      p.log.info(pc.dim('No external skills to bundle.'));
      p.log.info(
        pc.dim(`Run ${pc.cyan('skillfish add owner/repo')} to install external skills first.`),
      );
      p.outro(pc.dim('Done'));
      process.exit(EXIT_CODES.SUCCESS);
    }

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

    // Update per-skill manifests to mark them as manifest-managed
    // Also upgrade to v2 with name field if missing
    // This prevents "manual install conflict" errors when running `skillfish install`
    for (const skill of discoveredSkills) {
      if (skill.manifest && (skill.manifest.source !== 'manifest' || !skill.manifest.name)) {
        const updatedManifest: SkillManifest = {
          ...skill.manifest,
          version: MANIFEST_VERSION,
          name: skill.name,
          source: 'manifest',
        };
        try {
          writeManifest(skill.path, updatedManifest);
        } catch {
          // Non-fatal: log warning but continue
          addError(`Warning: Could not update manifest for ${skill.name}`);
        }
      }
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
    p.log.success(`Created ${pc.cyan(globalFlag ? '~/skillfish.json' : 'skillfish.json')}`);

    if (globalFlag) {
      p.log.info(pc.dim('Tip: Add ~/skillfish.json to your dotfiles for cross-machine sync.'));
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

      // Read manifest if available, try to heal if invalid
      let manifest = readManifest(skillPath);
      if (!manifest && hasManifest(skillPath)) {
        // Manifest exists but failed validation - try to heal it
        manifest = healManifest(skillPath);
      }

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
 * Result of building skill entries.
 */
interface BuildSkillEntriesResult {
  /** Skill entries that can be bundled (external skills with manifests) */
  entries: string[];
  /** Names of local skills that were skipped */
  skippedLocal: string[];
}

/**
 * Build skill entry strings from discovered skills.
 * Only includes external skills (those with manifests from GitHub).
 * Skips local skills (created via `skillfish init`) that have no manifest.
 */
function buildSkillEntries(skills: DiscoveredSkill[]): BuildSkillEntriesResult {
  const entries: string[] = [];
  const skippedLocal: string[] = [];

  for (const skill of skills) {
    if (skill.manifest) {
      // External skill - has manifest with GitHub origin
      const entry = formatSkillEntry({
        owner: skill.manifest.owner,
        repo: skill.manifest.repo,
        ref: skill.manifest.ref,
        path: skill.manifest.path === '.' ? undefined : skill.manifest.path,
        original: '',
      });
      entries.push(entry);
    } else {
      // Local skill (no manifest) - skip it
      // These are created via `skillfish init` and version-controlled with the project
      skippedLocal.push(skill.name);
    }
  }

  return { entries, skippedLocal };
}

/**
 * Select bundle location interactively or from flags.
 */
async function selectBundleLocation(
  projectFlag: boolean,
  globalFlag: boolean,
  jsonMode: boolean,
): Promise<LocationResult> {
  // If flag specified, use it
  if (projectFlag) {
    if (!jsonMode) {
      p.log.info(`Location: ${pc.cyan('Project')} ${pc.dim('(skillfish.json)')}`);
    }
    return { baseDir: process.cwd(), location: 'project' };
  }
  if (globalFlag) {
    if (!jsonMode) {
      p.log.info(`Location: ${pc.cyan('Global')} ${pc.dim('(~/skillfish.json)')}`);
    }
    return { baseDir: homedir(), location: 'global' };
  }

  // Non-TTY or JSON mode defaults to project (bundle what's here)
  if (!isInputTTY() || jsonMode) {
    return { baseDir: process.cwd(), location: 'project' };
  }

  // Interactive selection (Global first to match `add` command)
  const locationChoice = await p.select({
    message: 'Bundle location',
    options: [
      {
        value: 'global' as const,
        label: 'Global',
        hint: 'Create ~/skillfish.json',
      },
      {
        value: 'project' as const,
        label: 'Project',
        hint: 'Create ./skillfish.json',
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
