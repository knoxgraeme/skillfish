/**
 * `skillfish install` command - Install skills from a manifest file.
 */

import { Command } from 'commander';
import { existsSync, rmSync, lstatSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { printBanner } from '../lib/banner.js';
import { trackCommand, trackInstall } from '../telemetry.js';
import {
  getDetectedAgentsForLocation,
  getAgentSkillDir,
  type Agent,
  type DetectionLocation,
} from '../lib/agents.js';
import { installSkill, listInstalledSkillsInDir } from '../lib/installer.js';
import {
  readManifest,
  getManifestKey,
  buildManifestKey,
  type SkillManifest,
} from '../lib/manifest.js';
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
import { isTTY, isInputTTY, batchMap, type InstallJsonOutput } from '../utils.js';

// === Types ===

interface InstallCommandOptions {
  global?: boolean;
  project?: boolean;
  yes?: boolean;
  dryRun?: boolean;
}

/**
 * A single installation of a skill to one agent.
 */
interface SkillInstallation {
  agent: Agent;
  path: string;
  manifest: SkillManifest | null;
}

/**
 * Installed skill with all its installations across agents.
 * A skill can be installed to multiple agents, and we track each separately.
 */
interface InstalledSkillInfo {
  name: string;
  /** Canonical key (owner/repo/path) from manifest, or null if no manifest */
  manifestKey: string | null;
  /** All installations of this skill across agents */
  installations: SkillInstallation[];
}

/**
 * Action to take for a skill entry.
 */
type SkillAction =
  | { type: 'install'; entry: ParsedSkillEntry; reason: string; targetAgents: readonly Agent[] }
  | { type: 'skip'; entry: ParsedSkillEntry; reason: string }
  | { type: 'reinstall'; entry: ParsedSkillEntry; reason: string; targetAgents: readonly Agent[] };

// === Command Definition ===

export const installCommand = new Command('install')
  .description('Install skills from a skillfish.json manifest')
  .option('--global', 'Install from ~/skillfish.json to global location')
  .option('--project', 'Install from ./skillfish.json to project location')
  .option('-y, --yes', 'Skip all confirmation prompts')
  .option('--dry-run', 'Show what would happen without making changes')
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText(
    'after',
    `
Examples:
  $ skillfish install              Install skills (interactive location selection)
  $ skillfish install --project    Install skills from ./skillfish.json
  $ skillfish install --global     Install skills from ~/skillfish.json
  $ skillfish install --dry-run    Preview changes without installing
  $ skillfish install --yes        Skip confirmation prompts`,
  )
  .action(async (options: InstallCommandOptions, command: Command) => {
    const jsonMode = command.parent?.opts().json ?? false;
    const version = command.parent?.opts().version ?? '0.0.0';
    const globalFlag = options.global ?? false;
    const projectFlag = options.project ?? false;
    const skipPrompts = options.yes ?? false;
    const dryRun = options.dryRun ?? false;

    // Reject conflicting flags
    if (globalFlag && projectFlag) {
      if (jsonMode) {
        console.log(
          JSON.stringify({
            success: false,
            exit_code: EXIT_CODES.INVALID_ARGS,
            errors: ['Cannot specify both --global and --project'],
          }),
        );
        process.exit(EXIT_CODES.INVALID_ARGS);
      }
      p.log.error('Cannot specify both --global and --project');
      process.exit(EXIT_CODES.INVALID_ARGS);
    }

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

    // Track command usage (fire and forget)
    void trackCommand('install');

    // Determine scope (interactive if no flags specified)
    const { location, baseDir, manifestPath } = await selectInstallLocation(
      projectFlag,
      globalFlag,
      jsonMode,
    );

    jsonOutput.manifest_path = manifestPath;

    // Read manifest
    const manifest = readProjectManifest(manifestPath);

    if (!manifest) {
      const displayPath = globalFlag ? '~/skillfish.json' : 'skillfish.json';
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

    // Check for conflicts:
    // - Skills with source='manual' (installed via `skillfish add`)
    // - Skills without manifests (local skills or old installs without tracking)
    // We check the first installation's manifest as representative (all should match)
    const conflicts: { entry: ParsedSkillEntry; existing: InstalledSkillInfo; type: string }[] = [];

    for (const entry of entries) {
      const skillName = deriveSkillDirName(entry);
      const existing = installedSkills.find((s) => s.name === skillName);

      if (existing && existing.installations.length > 0) {
        // Use first installation's manifest as representative
        const firstInstall = existing.installations[0];
        if (!firstInstall.manifest) {
          // Skill exists without manifest - could be local skill or old install
          conflicts.push({ entry, existing, type: 'untracked' });
        } else {
          const source = firstInstall.manifest.source ?? 'manual';
          if (source === 'manual') {
            conflicts.push({ entry, existing, type: 'manual' });
          }
        }
      }
    }

    if (conflicts.length > 0) {
      for (const conflict of conflicts) {
        const skillName = deriveSkillDirName(conflict.entry);
        const typeLabel = conflict.type === 'manual' ? 'a manual install' : 'an untracked skill';
        const msg = `Skill '${skillName}' already exists as ${typeLabel}. Remove it first with \`skillfish remove ${skillName}\` or remove it from the manifest.`;
        addError(msg);
        jsonOutput.conflicts.push({ skill: skillName, reason: `${conflict.type} conflict` });
        if (!jsonMode) {
          p.log.error(msg);
        }
      }
      exitWithError(
        `${conflicts.length} conflict(s) found. See above for details.`,
        EXIT_CODES.INVALID_ARGS,
      );
    }

    // Determine actions for each entry
    // Check which target agents are missing the skill
    const actions: SkillAction[] = [];

    for (const entry of entries) {
      const skillName = deriveSkillDirName(entry);
      const entryKey = buildManifestKey(entry.owner, entry.repo, entry.path);
      const existing = installedSkills.find((s) => s.name === skillName);

      if (!existing) {
        // Not installed anywhere - install to all target agents
        actions.push({ type: 'install', entry, reason: 'Not installed', targetAgents });
      } else if (existing.installations.length === 0) {
        // Shouldn't happen, but handle gracefully
        actions.push({ type: 'install', entry, reason: 'Not installed', targetAgents });
      } else {
        // Use first installation's manifest as representative
        const firstInstall = existing.installations[0];

        if (!firstInstall.manifest) {
          // This shouldn't happen - we catch untracked skills as conflicts above
          // But handle gracefully just in case
          actions.push({ type: 'skip', entry, reason: 'Untracked skill - remove first' });
          continue;
        }

        // Check if source changed (different owner/repo/path, same directory name)
        if (existing.manifestKey !== entryKey) {
          // Source changed - reinstall from new source
          actions.push({
            type: 'reinstall',
            entry,
            reason: `Source changed: ${existing.manifestKey} → ${entryKey}`,
            targetAgents,
          });
          continue;
        }

        // Same source - compare refs
        const existingRef = firstInstall.manifest.ref;
        const newRef = entry.ref;

        if (existingRef !== newRef) {
          // Ref changed - reinstall to all target agents
          const reason = existingRef
            ? `Ref changed: ${existingRef} → ${newRef ?? 'latest'}`
            : `Pinning to ref: ${newRef}`;
          actions.push({ type: 'reinstall', entry, reason, targetAgents });
        } else {
          // Same ref - check if any target agents are missing the skill
          const installedAgentNames = new Set(existing.installations.map((i) => i.agent.name));
          const missingAgents = targetAgents.filter((a) => !installedAgentNames.has(a.name));

          if (missingAgents.length === 0) {
            // All target agents have the skill - skip
            actions.push({ type: 'skip', entry, reason: 'Already installed at same ref' });
          } else if (missingAgents.length === targetAgents.length) {
            // No target agents have the skill (installed to non-target agents only)
            actions.push({ type: 'install', entry, reason: 'Not installed', targetAgents });
          } else {
            // Some agents have it, some don't - install to missing agents only
            const missingNames = missingAgents.map((a) => a.name).join(', ');
            actions.push({
              type: 'install',
              entry,
              reason: `Missing from: ${missingNames}`,
              targetAgents: missingAgents,
            });
          }
        }
      }
    }

    // Find skills to remove (source='manifest' but no longer in manifest)
    // Match by manifest key (owner/repo/path) for robust identification
    const manifestKeys = new Set(entries.map((e) => buildManifestKey(e.owner, e.repo, e.path)));
    const toRemove: InstalledSkillInfo[] = [];

    for (const skill of installedSkills) {
      if (skill.installations.length === 0) continue;
      const firstInstall = skill.installations[0];
      if (!firstInstall.manifest) continue;
      const source = firstInstall.manifest.source ?? 'manual';
      // Use manifest key for matching instead of directory name
      if (source === 'manifest' && skill.manifestKey && !manifestKeys.has(skill.manifestKey)) {
        toRemove.push(skill);
      }
    }

    // Show dry run summary
    if (dryRun) {
      if (!jsonMode) {
        console.log();
        p.log.info(pc.yellow('Dry run - no changes will be made:'));
        console.log();

        const installs = actions.filter(
          (a): a is SkillAction & { type: 'install' | 'reinstall' } =>
            a.type === 'install' || a.type === 'reinstall',
        );
        const skips = actions.filter((a) => a.type === 'skip');

        if (installs.length > 0) {
          console.log(pc.bold('Would install:'));
          for (const action of installs) {
            const name = deriveSkillDirName(action.entry);
            // Show which agents will receive the skill
            const agentInfo =
              action.targetAgents.length < targetAgents.length
                ? ` → ${action.targetAgents.map((a) => a.name).join(', ')}`
                : '';
            console.log(`  ${pc.green('•')} ${name}${agentInfo} ${pc.dim(`(${action.reason})`)}`);
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
            const agentNames = skill.installations.map((i) => i.agent.name).join(', ');
            console.log(
              `  ${pc.red('•')} ${skill.name} ${pc.dim(`(no longer in manifest, from ${agentNames})`)}`,
            );
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
        // Record all installations that would be removed
        for (const installation of skill.installations) {
          jsonOutput.removed.push({ skill: skill.name, agent: installation.agent.name });
        }
      }

      if (jsonMode) {
        outputJsonAndExit(EXIT_CODES.SUCCESS);
      }
      process.exit(EXIT_CODES.SUCCESS);
    }

    // Prepare installation plan
    const toInstall = actions.filter((a) => a.type === 'install' || a.type === 'reinstall');
    const toSkip = actions.filter((a) => a.type === 'skip');

    // Show what will happen
    if (!jsonMode && (toInstall.length > 0 || toRemove.length > 0)) {
      console.log();
      if (toInstall.length > 0) {
        console.log(pc.bold('Will install:'));
        for (const action of toInstall) {
          const name = deriveSkillDirName(action.entry);
          // Show which agents will receive the skill
          const agentInfo =
            action.targetAgents.length < targetAgents.length
              ? ` → ${action.targetAgents.map((a) => a.name).join(', ')}`
              : '';
          console.log(`  ${pc.green('•')} ${name}${agentInfo} ${pc.dim(`(${action.reason})`)}`);
        }
      }
      if (toSkip.length > 0) {
        console.log(pc.bold('Will skip:'));
        for (const action of toSkip) {
          const name = deriveSkillDirName(action.entry);
          console.log(`  ${pc.yellow('•')} ${name} ${pc.dim(`(${action.reason})`)}`);
        }
      }
      if (toRemove.length > 0) {
        console.log(pc.bold('Will remove:'));
        for (const skill of toRemove) {
          const agentNames = skill.installations.map((i) => i.agent.name).join(', ');
          console.log(
            `  ${pc.red('•')} ${skill.name} ${pc.dim(`(no longer in manifest, from ${agentNames})`)}`,
          );
        }
      }
      console.log();
    }

    // Nothing to do
    if (toInstall.length === 0 && toRemove.length === 0) {
      // Add skipped to JSON output
      for (const action of toSkip) {
        const name = deriveSkillDirName(action.entry);
        jsonOutput.skipped.push({ skill: name, reason: action.reason });
      }

      if (jsonMode) {
        outputJsonAndExit(EXIT_CODES.SUCCESS);
      }

      p.log.info('All skills are up to date.');
      p.outro(pc.dim('Done'));
      process.exit(EXIT_CODES.SUCCESS);
    }

    // Confirmation prompt (unless --yes or non-TTY)
    if (!skipPrompts && isInputTTY() && !jsonMode) {
      const confirmInstall = await p.confirm({
        message: `Proceed with installation?`,
        initialValue: true,
      });

      if (p.isCancel(confirmInstall) || !confirmInstall) {
        p.cancel('Cancelled');
        process.exit(EXIT_CODES.SUCCESS);
      }
    }

    // Add skipped to JSON output
    for (const action of toSkip) {
      const name = deriveSkillDirName(action.entry);
      jsonOutput.skipped.push({ skill: name, reason: action.reason });
    }

    // Install skills in parallel with bounded concurrency
    // Use concurrency of 5 to respect GitHub rate limits while improving performance
    const INSTALL_CONCURRENCY = 5;

    interface InstallResult {
      skillName: string;
      success: boolean;
      installCount: number;
      errorMsg?: string;
    }

    // Track progress for spinner updates
    let completedCount = 0;
    const totalCount = toInstall.length;

    // Start spinner for installation progress
    let installSpinner: ReturnType<typeof p.spinner> | null = null;
    if (!jsonMode && totalCount > 0) {
      installSpinner = p.spinner();
      installSpinner.start(`Installing skills... (0/${totalCount})`);
    }

    const installResults = await batchMap(
      toInstall,
      async (action): Promise<InstallResult> => {
        const entry = action.entry;
        const skillName = deriveSkillDirName(entry);
        // Use action-specific target agents (may be subset of all targets if some already have the skill)
        const actionTargetAgents = action.targetAgents;

        try {
          // Fetch branch and SHA for the entry
          const branch = entry.ref ?? (await fetchDefaultBranch(entry.owner, entry.repo));
          const { sha, tree } = await fetchRecursiveTree(entry.owner, entry.repo, branch);

          // Get directory-specific SHA
          const skillPath = entry.path ?? SKILL_FILENAME;
          const skillMdPath =
            skillPath === SKILL_FILENAME ? SKILL_FILENAME : `${skillPath}/${SKILL_FILENAME}`;
          const skillSha = getSkillSha(tree, skillMdPath) ?? sha;

          // Install the skill to target agents
          const result = await installSkill(
            entry.owner,
            entry.repo,
            skillPath,
            skillName,
            actionTargetAgents,
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
            // Update progress spinner even on failure
            completedCount++;
            if (installSpinner) {
              installSpinner.message(`Installing skills... (${completedCount}/${totalCount})`);
            }
            return {
              skillName,
              success: false,
              installCount: 0,
              errorMsg: result.failureReason,
            };
          }

          // Record installed skills
          for (const installed of result.installed) {
            jsonOutput.installed.push(installed);
          }

          // Record warnings as errors
          for (const warning of result.warnings) {
            addError(warning);
          }

          // Update progress spinner
          completedCount++;
          if (installSpinner) {
            installSpinner.message(`Installing skills... (${completedCount}/${totalCount})`);
          }

          return {
            skillName,
            success: true,
            installCount: result.installed.length,
          };
        } catch (err) {
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

          // Update progress spinner even on failure
          completedCount++;
          if (installSpinner) {
            installSpinner.message(`Installing skills... (${completedCount}/${totalCount})`);
          }

          return {
            skillName,
            success: false,
            installCount: 0,
            errorMsg,
          };
        }
      },
      INSTALL_CONCURRENCY,
    );

    // Stop the installation spinner
    if (installSpinner) {
      installSpinner.stop(
        `Installed ${pc.cyan(totalCount.toString())} skill${totalCount === 1 ? '' : 's'}`,
      );
    }

    // Process results and update counts (count skills, not installations)
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < installResults.length; i++) {
      const result = installResults[i];
      const action = toInstall[i];

      if (result.success) {
        successCount++;
        // Track successful installs (fire and forget)
        void trackInstall('install', action.entry.owner, action.entry.repo, result.skillName);
        if (!jsonMode) {
          // Show which agents it was installed to if it's a partial install
          const agentCount = action.targetAgents.length;
          const agentSuffix =
            agentCount < targetAgents.length
              ? pc.dim(` (to ${action.targetAgents.map((a) => a.name).join(', ')})`)
              : '';
          console.log(`  ${pc.green('✓')} ${result.skillName} installed${agentSuffix}`);
        }
      } else {
        failCount++;
        addError(`Failed to install ${result.skillName}: ${result.errorMsg}`);
        if (!jsonMode) {
          console.log(`  ${pc.red('✗')} ${result.skillName} failed: ${result.errorMsg}`);
        }
      }
    }

    // Remove stale manifest skills
    // Re-read manifest before each deletion to prevent race condition
    // (manifest could have changed during async installation phase)
    let removeCount = 0;

    for (const skill of toRemove) {
      // Re-read manifest to verify skill is still absent (race condition protection)
      const currentManifest = readProjectManifest(manifestPath);
      if (currentManifest) {
        const { entries: currentEntries } = parseAllEntries(currentManifest);
        const currentKeys = new Set(
          currentEntries.map((e) => buildManifestKey(e.owner, e.repo, e.path)),
        );

        // Skip removal if skill was added back to manifest (match by key)
        if (skill.manifestKey && currentKeys.has(skill.manifestKey)) {
          if (!jsonMode) {
            console.log(
              `  ${pc.yellow('○')} ${skill.name} ${pc.dim('kept (added back to manifest)')}`,
            );
          }
          continue;
        }
      }

      if (!jsonMode) {
        const agentNames = skill.installations.map((i) => i.agent.name).join(', ');
        console.log(
          `  ${pc.red('✗')} ${skill.name} ${pc.dim(`removed from ${agentNames} (no longer in manifest)`)}`,
        );
      }

      // Remove from all installations
      let skillRemoved = false;
      for (const installation of skill.installations) {
        try {
          // Security: check if path is a symlink before recursive delete
          const stat = lstatSync(installation.path);
          if (stat.isSymbolicLink()) {
            rmSync(installation.path);
          } else {
            rmSync(installation.path, { recursive: true, force: true });
          }
          jsonOutput.removed.push({ skill: skill.name, agent: installation.agent.name });
          skillRemoved = true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          addError(`Failed to remove ${skill.name} from ${installation.agent.name}: ${msg}`);
          if (!jsonMode) {
            console.log(
              `    ${pc.red('!')} Failed to remove from ${installation.agent.name}: ${msg}`,
            );
          }
        }
      }

      if (skillRemoved) {
        removeCount++;
      }
    }

    // Summary
    if (jsonMode) {
      const exitCode = failCount > 0 ? EXIT_CODES.GENERAL_ERROR : EXIT_CODES.SUCCESS;
      outputJsonAndExit(exitCode);
    }

    console.log();
    const parts: string[] = [];
    if (successCount > 0) {
      parts.push(`${successCount} installed`);
    }
    if (toSkip.length > 0) {
      parts.push(`${toSkip.length} skipped`);
    }
    if (removeCount > 0) {
      parts.push(`${removeCount} removed`);
    }
    if (failCount > 0) {
      parts.push(`${failCount} failed`);
    }

    if (parts.length === 0) {
      p.outro(pc.dim('No changes made'));
    } else {
      const summary = parts.join(', ');
      const color = failCount > 0 ? pc.yellow : pc.green;
      p.outro(color(`Done: ${summary}`));
    }

    process.exit(failCount > 0 ? EXIT_CODES.GENERAL_ERROR : EXIT_CODES.SUCCESS);
  });

// === Helper Functions ===

/**
 * Scan for installed skills across all agents for a given location.
 * Tracks ALL installations of each skill across agents (not just the first).
 */
function scanInstalledSkills(agents: readonly Agent[], baseDir: string): InstalledSkillInfo[] {
  // Map skill name -> InstalledSkillInfo (with multiple installations)
  const skillMap = new Map<string, InstalledSkillInfo>();

  for (const agent of agents) {
    const skillDir = getAgentSkillDir(agent, baseDir);
    const skills = listInstalledSkillsInDir(skillDir);

    for (const skillName of skills) {
      const skillPath = join(skillDir, skillName);
      const manifest = readManifest(skillPath);

      const installation: SkillInstallation = {
        agent,
        path: skillPath,
        manifest,
      };

      const existing = skillMap.get(skillName);
      if (existing) {
        // Add this agent's installation to existing skill record
        existing.installations.push(installation);
      } else {
        // Create new skill record with manifest key for matching
        const manifestKey = manifest ? getManifestKey(manifest) : null;
        skillMap.set(skillName, {
          name: skillName,
          manifestKey,
          installations: [installation],
        });
      }
    }
  }

  return Array.from(skillMap.values());
}

/**
 * Result of location selection.
 */
interface LocationResult {
  location: DetectionLocation;
  baseDir: string;
  manifestPath: string;
}

/**
 * Select install location interactively or from flags.
 */
async function selectInstallLocation(
  projectFlag: boolean,
  globalFlag: boolean,
  jsonMode: boolean,
): Promise<LocationResult> {
  const projectManifestPath = getProjectManifestPath(false);
  const globalManifestPath = getProjectManifestPath(true);
  const hasProjectManifest = existsSync(projectManifestPath);
  const hasGlobalManifest = existsSync(globalManifestPath);

  // If flag specified, use it (error handling happens later if manifest missing)
  if (projectFlag) {
    if (!jsonMode) {
      p.log.info(`Location: ${pc.cyan('Project')} ${pc.dim('(skillfish.json)')}`);
    }
    return { location: 'project', baseDir: process.cwd(), manifestPath: projectManifestPath };
  }
  if (globalFlag) {
    if (!jsonMode) {
      p.log.info(`Location: ${pc.cyan('Global')} ${pc.dim('(~/skillfish.json)')}`);
    }
    return { location: 'global', baseDir: homedir(), manifestPath: globalManifestPath };
  }

  // Non-TTY or JSON mode defaults to project
  if (!isInputTTY() || jsonMode) {
    return { location: 'project', baseDir: process.cwd(), manifestPath: projectManifestPath };
  }

  // Check what manifests exist
  if (!hasProjectManifest && !hasGlobalManifest) {
    p.log.error('No manifest found.');
    p.log.info(
      pc.dim(`Run ${pc.cyan('skillfish bundle')} to create a manifest from installed skills.`),
    );
    process.exit(EXIT_CODES.NOT_FOUND);
  }

  // If only one exists, use it automatically
  if (hasProjectManifest && !hasGlobalManifest) {
    p.log.info(`Location: ${pc.cyan('Project')} ${pc.dim('(skillfish.json)')}`);
    return { location: 'project', baseDir: process.cwd(), manifestPath: projectManifestPath };
  }
  if (hasGlobalManifest && !hasProjectManifest) {
    p.log.info(`Location: ${pc.cyan('Global')} ${pc.dim('(~/skillfish.json)')}`);
    return { location: 'global', baseDir: homedir(), manifestPath: globalManifestPath };
  }

  // Both exist - let user choose (Global first to match `add` command)
  const locationChoice = await p.select({
    message: 'Install location',
    options: [
      {
        value: 'global' as const,
        label: 'Global',
        hint: '~/skillfish.json',
      },
      {
        value: 'project' as const,
        label: 'Project',
        hint: './skillfish.json',
      },
    ],
  });

  if (p.isCancel(locationChoice)) {
    p.cancel('Cancelled');
    process.exit(EXIT_CODES.SUCCESS);
  }

  const isGlobal = locationChoice === 'global';
  return {
    location: locationChoice,
    baseDir: isGlobal ? homedir() : process.cwd(),
    manifestPath: isGlobal ? globalManifestPath : projectManifestPath,
  };
}
