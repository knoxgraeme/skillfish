/**
 * `skillfish submit` command - Submit skills to the registry for discovery.
 */

import { Command } from 'commander';
import { dirname, basename } from 'path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { trackCommand } from '../telemetry.js';
import {
  parseFrontmatter,
  batchMap,
  isInputTTY,
  isTTY,
  createSubmitJsonOutput,
  type SubmitJsonOutput,
} from '../utils.js';
import {
  findAllSkillMdFiles,
  fetchSkillMdContent,
  SKILL_FILENAME,
  RateLimitError,
  RepoNotFoundError,
  NetworkError,
  GitHubApiError,
} from '../lib/github.js';
import { EXIT_CODES, isValidName, type ExitCode } from '../lib/constants.js';
import { submitSkillsToRegistry, type SkillSubmission } from '../lib/registry.js';

// === Types ===

interface SubmitCommandOptions {
  yes?: boolean;
}

interface SkillMetadata {
  path: string; // Full path to SKILL.md
  dir: string; // Directory containing SKILL.md
  name: string; // From frontmatter or folder name
  description: string; // From frontmatter or empty
}

// === Command Definition ===

export const submitCommand = new Command('submit')
  .description('Submit a repository to the skill registry for discovery')
  .argument('<repo>', 'GitHub repository (owner/repo or URL)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText(
    'after',
    `
Examples:
  $ skillfish submit owner/repo                        Submit repository
  $ skillfish submit https://github.com/owner/repo     Submit via URL
  $ skillfish submit owner/repo -y                     Skip confirmation`,
  )
  .action(async (repoArg: string, options: SubmitCommandOptions, command: Command) => {
    const jsonMode = command.parent?.opts().json ?? false;
    const jsonOutput = createSubmitJsonOutput();
    const version = command.parent?.opts().version ?? '0.0.0';

    // Helper to add error and optionally output JSON
    function addError(message: string): void {
      jsonOutput.errors.push(message);
      jsonOutput.success = false;
    }

    function outputJsonAndExit(exitCode: number): never {
      jsonOutput.exit_code = exitCode;
      console.log(JSON.stringify(jsonOutput, null, 2));
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
        console.error(message);
      }
      process.exit(exitCode);
    }

    // Show banner and intro (TTY only, not in JSON mode)
    if (isTTY() && !jsonMode) {
      console.log();
      console.log(pc.cyan('     ≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋'));
      console.log(`       ${pc.cyan('><>')}  ${pc.bold('SKILL FISH')}  ${pc.cyan('><>')}`);
      console.log(pc.cyan('     ≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋'));
      console.log();
      p.intro(`${pc.bgCyan(pc.black(' skillfish submit '))} ${pc.dim(`v${version}`)}`);
    }

    // Track command usage (fire and forget)
    void trackCommand('submit');

    const skipConfirm = options.yes ?? false;

    // Parse repo format - supports owner/repo or full GitHub URL
    let owner: string;
    let repo: string;

    if (repoArg.includes('github.com')) {
      // Parse GitHub URL: https://github.com/owner/repo or github.com/owner/repo
      try {
        const url = new URL(repoArg.startsWith('http') ? repoArg : `https://${repoArg}`);
        // Validate hostname to prevent malicious URLs like github.com.evil.com
        if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
          exitWithError(
            'Only github.com URLs are supported. Use: https://github.com/owner/repo',
            EXIT_CODES.INVALID_ARGS,
          );
        }
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts.length < 2) {
          exitWithError(
            'Invalid GitHub URL. Use: https://github.com/owner/repo',
            EXIT_CODES.INVALID_ARGS,
          );
        }
        [owner, repo] = pathParts as [string, string];
      } catch {
        exitWithError(
          'Invalid GitHub URL. Use: https://github.com/owner/repo',
          EXIT_CODES.INVALID_ARGS,
        );
      }
    } else {
      // Parse owner/repo format
      const parts = repoArg.split('/');
      if (parts.length < 2) {
        exitWithError(
          'Invalid format. Use: owner/repo or https://github.com/owner/repo',
          EXIT_CODES.INVALID_ARGS,
        );
      }
      [owner, repo] = parts as [string, string];
    }

    // Validate owner/repo (security: prevent injection)
    if (!owner || !repo || !isValidName(owner) || !isValidName(repo)) {
      exitWithError('Invalid repository format. Use: owner/repo', EXIT_CODES.INVALID_ARGS);
    }

    // 1. Discover skills in the repository
    const discoveryResult = await discoverSkillsInRepo(owner, repo, jsonMode, jsonOutput);

    if (!discoveryResult || discoveryResult.skills.length === 0) {
      if (jsonMode) {
        outputJsonAndExit(EXIT_CODES.NOT_FOUND);
      }
      process.exit(EXIT_CODES.NOT_FOUND);
    }

    const { skills } = discoveryResult;

    // 2. List discovered skills
    if (!jsonMode) {
      console.log();
      for (const skill of skills) {
        console.log(`  ${pc.cyan('•')} ${skill.name}`);
      }
      console.log();
    }

    // 3. Confirm submission
    if (!skipConfirm && !jsonMode && isInputTTY()) {
      const shouldSubmit = await p.confirm({
        message: `Submit ${pc.cyan(`${owner}/${repo}`)} to the registry?`,
        initialValue: true,
      });

      if (p.isCancel(shouldSubmit) || !shouldSubmit) {
        p.outro(pc.dim('Cancelled'));
        process.exit(EXIT_CODES.SUCCESS);
      }
    }

    // 4. Build submission payload (repo-level)
    const submissions: SkillSubmission[] = [
      {
        url: `https://github.com/${owner}/${repo}`,
        owner,
        repo,
        skill: repo,
        path: '',
      },
    ];

    // 5. Submit to registry
    let spinner: ReturnType<typeof p.spinner> | null = null;
    if (!jsonMode) {
      spinner = p.spinner();
      spinner.start(`Submitting ${owner}/${repo} to registry...`);
    }

    try {
      const result = await submitSkillsToRegistry(submissions);

      if (spinner) {
        if (result.success) {
          spinner.stop(pc.green('Submitted'));
        } else {
          spinner.stop(pc.red('Submission failed'));
        }
      }

      // Process result
      const submission = result.submitted[0];
      if (submission?.success) {
        jsonOutput.submitted.push({
          skill: repo,
          url: `https://github.com/${owner}/${repo}`,
          owner,
          repo,
          path: '',
        });
        // Store found skill names for JSON output
        jsonOutput.skills_found = skills.map((s) => s.name);
      } else {
        jsonOutput.failed.push({
          skill: repo,
          reason: submission?.error ?? 'Unknown error',
        });
      }
    } catch (err) {
      if (spinner) {
        spinner.stop(pc.red('Submission failed'));
      }

      // Sanitize error message - only show known error types
      let errorMsg = 'Unable to connect to registry';
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          errorMsg = 'Request timed out';
        } else if (err.message.includes('registry') || err.message.includes('network')) {
          errorMsg = err.message;
        }
      }
      exitWithError(`Registry submission failed: ${errorMsg}`, EXIT_CODES.NETWORK_ERROR, true);
    }

    // Summary
    if (jsonMode) {
      outputJsonAndExit(EXIT_CODES.SUCCESS);
    }

    if (jsonOutput.submitted.length > 0) {
      const skillCount = skills.length;
      p.outro(
        pc.green(`Submitted! ${skillCount} skill${skillCount === 1 ? '' : 's'} will be reviewed.`),
      );
    } else {
      const errorReason = jsonOutput.failed[0]?.reason ?? 'Submission failed';
      p.outro(pc.red(errorReason));
    }
    process.exit(EXIT_CODES.SUCCESS);
  });

// === Helper Functions ===

/**
 * Discover skills in a repository.
 */
async function discoverSkillsInRepo(
  owner: string,
  repo: string,
  jsonMode: boolean,
  jsonOutput: SubmitJsonOutput,
): Promise<{ skills: SkillMetadata[] } | null> {
  let skillDiscovery;

  try {
    skillDiscovery = await findAllSkillMdFiles(owner, repo);
  } catch (err) {
    let errorMsg: string;
    let exitCode: ExitCode = EXIT_CODES.GENERAL_ERROR;

    if (err instanceof RateLimitError) {
      errorMsg = err.message;
      exitCode = EXIT_CODES.NETWORK_ERROR;
    } else if (err instanceof RepoNotFoundError) {
      errorMsg = err.message;
      exitCode = EXIT_CODES.NOT_FOUND;
    } else if (err instanceof NetworkError) {
      errorMsg = err.message;
      exitCode = EXIT_CODES.NETWORK_ERROR;
    } else if (err instanceof GitHubApiError) {
      errorMsg = err.message;
    } else {
      errorMsg = err instanceof Error ? err.message : String(err);
    }

    if (jsonMode) {
      jsonOutput.errors.push(errorMsg);
      jsonOutput.success = false;
      console.log(JSON.stringify(jsonOutput, null, 2));
    } else {
      p.log.error(errorMsg);
    }
    process.exit(exitCode);
  }

  const { paths: skillPaths, branch } = skillDiscovery;

  if (skillPaths.length === 0) {
    const errorMsg = `No ${SKILL_FILENAME} found in repository`;
    if (jsonMode) {
      jsonOutput.errors.push(errorMsg);
      jsonOutput.success = false;
    } else {
      p.log.error(errorMsg);
    }
    return null;
  }

  // Fetch frontmatter metadata for all skills
  let spinner: ReturnType<typeof p.spinner> | null = null;
  if (!jsonMode) {
    spinner = p.spinner();
    spinner.start('Discovering skills...');
  }

  const skills = await batchMap(
    skillPaths,
    async (sp): Promise<SkillMetadata> => {
      const skillDir = sp === SKILL_FILENAME ? '.' : dirname(sp);
      const folderName = sp === SKILL_FILENAME ? repo : basename(skillDir);

      const content = await fetchSkillMdContent(owner, repo, sp, branch);
      const frontmatter = content ? parseFrontmatter(content) : {};

      return {
        path: sp,
        dir: skillDir === '.' ? SKILL_FILENAME : skillDir,
        name: frontmatter.name || folderName,
        description: frontmatter.description || '',
      };
    },
    10,
  );

  if (spinner) {
    spinner.stop(
      `Found ${pc.cyan(skills.length.toString())} skill${skills.length === 1 ? '' : 's'} in ${pc.cyan(`${owner}/${repo}`)}`,
    );
  }

  return { skills };
}
