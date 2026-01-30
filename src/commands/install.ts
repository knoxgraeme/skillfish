/**
 * `skillfish install` command - Install skills from a manifest file.
 */

import { Command } from 'commander';
import { existsSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { printBanner } from '../lib/banner.js';
import {
  getDetectedAgentsForLocation,
  getAgentSkillDir,
  type Agent,
  type DetectionLocation,
  AGENT_CONFIGS,
} from '../lib/agents.js';
import { installSkill, listInstalledSkillsInDir } from '../lib/installer.js';
import { readManifest, type SkillManifest } from '../lib/manifest.js';
import {
  readProjectManifest,
  getProjectManifestPath,
  parseAllEntries,
  detectCollisions,
  deriveSkillDirName,
  type ParsedSkillEntry,
} from '../lib/project-manifest.js';
import {
  fetchDefaultBranch,
  fetchRecursiveTree,
  getSkillSha,
  SKILL_FILENAME,
  RateLimitError,
  RepoNotFoundError,
  NetworkError,
  GitHubApiError,
} from '../lib/github.js';
import { EXIT_CODES, type ExitCode } from '../lib/constants.js';
import { isTTY, isInputTTY, type InstallJsonOutput } from '../utils.js';

// === Types ===

interface InstallCommandOptions {
  global?: boolean;
  yes?: boolean;
  dryRun?: boolean;
}

/**
 * Installed skill with manifest information.
 */
interface InstalledSkillInfo {
  name: string;
  agent: Agent;
  path: string;
  manifest: SkillManifest | null;
}

/**
 * Action to take for a skill entry.
 */
type SkillAction =
  | { type: 'install'; entry: ParsedSkillEntry; reason: string }
  | { type: 'skip'; entry: ParsedSkillEntry; reason: string }
  | { type: 'reinstall'; entry: ParsedSkillEntry; reason: string };

// === Command Definition ===

export const installCommand = new Command('install')
  .description('Install skills from a .skillfish.json manifest')
  .option('--global', 'Install from ~/.skillfish.json to global location')
  .option('-y, --yes', 'Skip all confirmation prompts')
  .option('--dry-run', 'Show what would happen without making changes')
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText(
    'after',
    `
Examples:
  $ skillfish install              Install skills from ./.skillfish.json
  $ skillfish install --global     Install skills from ~/.skillfish.json
  $ skillfish install --dry-run    Preview changes without installing
  $ skillfish install --yes        Skip confirmation prompts`,
  )
  .action(async (options: InstallCommandOptions, command: Command) => {
    const jsonMode = command.parent?.opts().json ?? false;
    const version = command.parent?.opts().version ?? '0.0.0';
    const globalFlag = options.global ?? false;
    const skipPrompts = options.yes ?? false;
    const dryRun = options.dryRun ?? false;

    // JSON output state
    const jsonOutput: InstallJsonOutput = {
      success: true,
      exit_code: EXIT_CODES.SUCCESS,
      errors: [],
      manifest_path: null,
      dry_run: dryRun,
      skills_found: [],
      installed: [],
      skipped: [],
      removed: [],
      conflicts: [],
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
    const location: DetectionLocation = globalFlag ? 'global' : 'project';
    const baseDir = globalFlag ? homedir() : process.cwd();
    const manifestPath = getProjectManifestPath(globalFlag);

    jsonOutput.manifest_path = manifestPath;

    // Read manifest
    const manifest = readProjectManifest(manifestPath);

    if (!manifest) {
      const displayPath = globalFlag ? '~/.skillfish.json' : '.skillfish.json';
      if (!existsSync(manifestPath)) {
        exitWithError(
          `No manifest found at ${displayPath}. Run ${pc.cyan('skillfish bundle')} to generate one from installed skills.`,
          EXIT_CODES.NOT_FOUND,
        );
      } else {
        exitWithError(
          `Invalid manifest at ${displayPath}. Check the file format.`,
          EXIT_CODES.INVALID_ARGS,
        );
      }
    }

    // Parse and validate entries
    const { entries, errors: parseErrors } = parseAllEntries(manifest);

    for (const error of parseErrors) {
      addError(`Parse error: ${error}`);
      if (!jsonMode) {
        p.log.warn(`${pc.yellow('!')} ${error}`);
      }
    }

    if (entries.length === 0) {
      if (parseErrors.length > 0) {
        exitWithError('No valid skill entries found in manifest.', EXIT_CODES.INVALID_ARGS);
      }
      if (!jsonMode) {
        p.log.info('No skills listed in manifest.');
      }
      if (jsonMode) {
        outputJsonAndExit(EXIT_CODES.SUCCESS);
      }
      p.outro(pc.dim('Done'));
      process.exit(EXIT_CODES.SUCCESS);
    }

    jsonOutput.skills_found = entries.map((e) => e.original);

    // Detect collisions
    const collisions = detectCollisions(manifest.skills);

    if (collisions.length > 0) {
      for (const collision of collisions) {
        const msg = `Skill name collision: '${collision.name}' would be installed by both ${collision.entry1} and ${collision.entry2}`;
        addError(msg);
        jsonOutput.conflicts.push({ skill: collision.name, reason: msg });
        if (!jsonMode) {
          p.log.error(msg);
        }
      }
      exitWithError(
        `${collisions.length} collision(s) found. Fix the manifest and try again.`,
        EXIT_CODES.INVALID_ARGS,
      );
    }

    // Detect agents
    const detected = getDetectedAgentsForLocation(location, process.cwd());

    if (detected.length === 0) {
      const locationLabel = globalFlag ? 'globally' : 'in this project';
      exitWithError(
        `No agents detected ${locationLabel}. Install Claude Code, Cursor, or another supported agent first.`,
        EXIT_CODES.GENERAL_ERROR,
      );
    }

    // Agent selection (interactive or auto)
    let targetAgents: readonly Agent[];

    if (!isInputTTY() || jsonMode || skipPrompts) {
      targetAgents = detected;
      if (!jsonMode) {
        console.log(
          `Installing to ${detected.length} agent(s): ${detected.map((a) => a.name).join(', ')}`,
        );
      }
    } else {
      // Interactive agent selection
      if (!jsonMode) {
        p.log.info(
          `Detected ${pc.cyan(detected.length.toString())} agent${detected.length === 1 ? '' : 's'}: ${detected.map((a) => a.name).join(', ')}`,
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
        targetAgents = detected;
      } else {
        const pathPrefix = globalFlag ? '~' : '.';
        const agentOptions = detected.map((a) => ({
          value: a.name,
          label: a.name,
          hint: `${pathPrefix}/${a.dir}`,
        }));

        const selected = await p.multiselect({
          message: 'Select agents',
          options: agentOptions,
          required: true,
        });

        if (p.isCancel(selected)) {
          p.cancel('Cancelled');
          process.exit(EXIT_CODES.SUCCESS);
        }

        targetAgents = detected.filter((a) => selected.includes(a.name));
      }
    }

    // Scan currently installed skills
    const installedSkills = scanInstalledSkills(targetAgents, baseDir);

    // Check for manual conflicts (skill exists with source='manual')
    const manualConflicts: { entry: ParsedSkillEntry; existing: InstalledSkillInfo }[] = [];

    for (const entry of entries) {
      const skillName = deriveSkillDirName(entry);
      const existing = installedSkills.find((s) => s.name === skillName);

      if (existing && existing.manifest) {
        const source = existing.manifest.source ?? 'manual';
        if (source === 'manual') {
          manualConflicts.push({ entry, existing });
        }
      }
    }

    if (manualConflicts.length > 0) {
      for (const conflict of manualConflicts) {
        const skillName = deriveSkillDirName(conflict.entry);
        const msg = `Skill '${skillName}' already exists as a manual install. Remove it first with \`skillfish remove ${skillName}\` or remove it from the manifest.`;
        addError(msg);
        jsonOutput.conflicts.push({ skill: skillName, reason: 'Manual install conflict' });
        if (!jsonMode) {
          p.log.error(msg);
        }
      }
      exitWithError(
        `${manualConflicts.length} manual conflict(s) found. See above for details.`,
        EXIT_CODES.INVALID_ARGS,
      );
    }

    // Determine actions for each entry
    const actions: SkillAction[] = [];

    for (const entry of entries) {
      const skillName = deriveSkillDirName(entry);
      const existing = installedSkills.find((s) => s.name === skillName);

      if (!existing) {
        actions.push({ type: 'install', entry, reason: 'Not installed' });
      } else if (!existing.manifest) {
        // No manifest - treat as manual install (shouldn't happen if we check above)
        actions.push({ type: 'install', entry, reason: 'No tracking info' });
      } else {
        // Compare refs
        const existingRef = existing.manifest.ref;
        const newRef = entry.ref;

        if (existingRef === newRef) {
          actions.push({ type: 'skip', entry, reason: 'Already installed at same ref' });
        } else {
          const reason = existingRef
            ? `Ref changed: ${existingRef} → ${newRef ?? 'latest'}`
            : `Pinning to ref: ${newRef}`;
          actions.push({ type: 'reinstall', entry, reason });
        }
      }
    }

    // Find skills to remove (source='manifest' but no longer in manifest)
    const manifestSkillNames = new Set(entries.map((e) => deriveSkillDirName(e)));
    const toRemove: InstalledSkillInfo[] = [];

    for (const skill of installedSkills) {
      if (!skill.manifest) continue;
      const source = skill.manifest.source ?? 'manual';
      if (source === 'manifest' && !manifestSkillNames.has(skill.name)) {
        toRemove.push(skill);
      }
    }

    // Show dry run summary
    if (dryRun) {
      if (!jsonMode) {
        console.log();
        p.log.info(pc.yellow('Dry run - no changes will be made:'));
        console.log();

        const installs = actions.filter((a) => a.type === 'install' || a.type === 'reinstall');
        const skips = actions.filter((a) => a.type === 'skip');

        if (installs.length > 0) {
          console.log(pc.bold('Would install:'));
          for (const action of installs) {
            const name = deriveSkillDirName(action.entry);
            console.log(`  ${pc.green('•')} ${name} ${pc.dim(`(${action.reason})`)}`);
          }
          console.log();
        }

        if (skips.length > 0) {
          console.log(pc.bold('Would skip:'));
          for (const action of skips) {
            const name = deriveSkillDirName(action.entry);
            console.log(`  ${pc.yellow('•')} ${name} ${pc.dim(`(${action.reason})`)}`);
          }
          console.log();
        }

        if (toRemove.length > 0) {
          console.log(pc.bold('Would remove:'));
          for (const skill of toRemove) {
            console.log(`  ${pc.red('•')} ${skill.name} ${pc.dim('(no longer in manifest)')}`);
          }
          console.log();
        }

        p.outro(pc.dim('Dry run complete'));
      }

      // Populate JSON output for dry run
      for (const action of actions) {
        const name = deriveSkillDirName(action.entry);
        if (action.type === 'skip') {
          jsonOutput.skipped.push({ skill: name, reason: action.reason });
        }
      }

      for (const skill of toRemove) {
        jsonOutput.removed.push({ skill: skill.name, agent: skill.agent.name });
      }

      if (jsonMode) {
        outputJsonAndExit(EXIT_CODES.SUCCESS);
      }
      process.exit(EXIT_CODES.SUCCESS);
    }

    // Execute installations
    const toInstall = actions.filter((a) => a.type === 'install' || a.type === 'reinstall');
    const toSkip = actions.filter((a) => a.type === 'skip');

    // Add skipped to JSON output
    for (const action of toSkip) {
      const name = deriveSkillDirName(action.entry);
      jsonOutput.skipped.push({ skill: name, reason: action.reason });
      if (!jsonMode) {
        console.log(`  ${pc.yellow('●')} ${name} ${pc.dim(`skipped (${action.reason})`)}`);
      }
    }

    // Install skills
    let installCount = 0;
    let failCount = 0;

    for (const action of toInstall) {
      const entry = action.entry;
      const skillName = deriveSkillDirName(entry);

      let spinner: ReturnType<typeof p.spinner> | null = null;
      if (!jsonMode) {
        spinner = p.spinner();
        spinner.start(`Installing ${skillName}...`);
      }

      try {
        // Fetch branch and SHA for the entry
        const branch = entry.ref ?? (await fetchDefaultBranch(entry.owner, entry.repo));
        const { sha, tree } = await fetchRecursiveTree(entry.owner, entry.repo, branch);

        // Get directory-specific SHA
        const skillPath = entry.path ?? SKILL_FILENAME;
        const skillMdPath =
          skillPath === SKILL_FILENAME ? SKILL_FILENAME : `${skillPath}/${SKILL_FILENAME}`;
        const skillSha = getSkillSha(tree, skillMdPath) ?? sha;

        // Install the skill
        const result = await installSkill(
          entry.owner,
          entry.repo,
          skillPath,
          skillName,
          targetAgents,
          {
            force: true, // Always force for manifest installs (we've already checked conflicts)
            baseDir,
            branch,
            sha: skillSha,
            ref: entry.ref,
            source: 'manifest',
          },
        );

        if (result.failed) {
          failCount++;
          if (spinner) {
            spinner.stop(pc.red(`${skillName} failed`));
          }
          addError(`Failed to install ${skillName}: ${result.failureReason}`);
        } else {
          installCount += result.installed.length;
          if (spinner) {
            spinner.stop(pc.green(`${skillName} installed`));
          }

          for (const installed of result.installed) {
            jsonOutput.installed.push(installed);
            if (!jsonMode) {
              const pathPrefix = globalFlag ? '~' : '.';
              const displayPath = `${pathPrefix}/${AGENT_CONFIGS.find((c) => c.name === installed.agent)?.dir ?? 'skills'}/${skillName}`;
              console.log(`    ${pc.green('✓')} ${installed.agent} ${pc.dim(`→ ${displayPath}`)}`);
            }
          }

          for (const warning of result.warnings) {
            addError(warning);
            if (!jsonMode) {
              console.log(`    ${pc.yellow('!')} ${warning}`);
            }
          }
        }
      } catch (err) {
        failCount++;
        if (spinner) {
          spinner.stop(pc.red(`${skillName} failed`));
        }

        let errorMsg: string;
        if (err instanceof RateLimitError) {
          errorMsg = err.message;
        } else if (err instanceof RepoNotFoundError) {
          errorMsg = `Repository not found: ${entry.owner}/${entry.repo}`;
        } else if (err instanceof NetworkError || err instanceof GitHubApiError) {
          errorMsg = err.message;
        } else {
          errorMsg = err instanceof Error ? err.message : String(err);
        }

        addError(`Failed to install ${skillName}: ${errorMsg}`);
        if (!jsonMode) {
          console.log(`    ${pc.red('✗')} ${errorMsg}`);
        }
      }
    }

    // Remove stale manifest skills
    let removeCount = 0;

    for (const skill of toRemove) {
      if (!jsonMode) {
        console.log(`  ${pc.red('✗')} ${skill.name} ${pc.dim('removed (no longer in manifest)')}`);
      }

      try {
        rmSync(skill.path, { recursive: true, force: true });
        removeCount++;
        jsonOutput.removed.push({ skill: skill.name, agent: skill.agent.name });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addError(`Failed to remove ${skill.name}: ${msg}`);
        if (!jsonMode) {
          console.log(`    ${pc.red('!')} Failed to remove: ${msg}`);
        }
      }
    }

    // Summary
    if (jsonMode) {
      const exitCode = failCount > 0 ? EXIT_CODES.GENERAL_ERROR : EXIT_CODES.SUCCESS;
      outputJsonAndExit(exitCode);
    }

    console.log();
    const parts: string[] = [];
    if (installCount > 0) {
      parts.push(`installed ${installCount}`);
    }
    if (toSkip.length > 0) {
      parts.push(`skipped ${toSkip.length}`);
    }
    if (removeCount > 0) {
      parts.push(`removed ${removeCount}`);
    }
    if (failCount > 0) {
      parts.push(`failed ${failCount}`);
    }

    if (parts.length === 0) {
      p.outro(pc.dim('No changes made'));
    } else {
      const summary = parts.join(', ');
      const color = failCount > 0 ? pc.yellow : pc.green;
      p.outro(color(`Done! ${summary[0].toUpperCase()}${summary.slice(1)}`));
    }

    process.exit(failCount > 0 ? EXIT_CODES.GENERAL_ERROR : EXIT_CODES.SUCCESS);
  });

// === Helper Functions ===

/**
 * Scan for installed skills across all agents for a given location.
 */
function scanInstalledSkills(agents: readonly Agent[], baseDir: string): InstalledSkillInfo[] {
  const installed: InstalledSkillInfo[] = [];
  const seenNames = new Set<string>();

  for (const agent of agents) {
    const skillDir = getAgentSkillDir(agent, baseDir);
    const skills = listInstalledSkillsInDir(skillDir);

    for (const skillName of skills) {
      // Only record once per skill name (first agent wins)
      if (seenNames.has(skillName)) {
        continue;
      }
      seenNames.add(skillName);

      const skillPath = join(skillDir, skillName);
      const manifest = readManifest(skillPath);

      installed.push({
        name: skillName,
        agent,
        path: skillPath,
        manifest,
      });
    }
  }

  return installed;
}
