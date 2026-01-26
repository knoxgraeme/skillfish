/**
 * `skillfish submit` command - Submit skills to the registry for discovery.
 */

import { Command } from 'commander';
import { dirname, basename } from 'path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  parseFrontmatter,
  toTitleCase,
  truncate,
  batchMap,
  isInputTTY,
  isTTY,
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
import { submitSkillsToRegistry, buildSkillUrl, type SkillSubmission } from '../lib/registry.js';

// === Types ===

interface SubmitCommandOptions {
  yes?: boolean;
  all?: boolean;
}

interface SkillMetadata {
  path: string; // Full path to SKILL.md
  dir: string; // Directory containing SKILL.md
  name: string; // From frontmatter or folder name
  description: string; // From frontmatter or empty
}

// === Command Definition ===

export const submitCommand = new Command('submit')
  .description('Submit skills to the registry for discovery')
  .argument('<repo>', 'GitHub repository (owner/repo)')
  .argument('[skill-name]', 'Submit a specific skill by name (from SKILL.md frontmatter)')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('--all', 'Submit all skills found in the repository')
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText(
    'after',
    `
Examples:
  $ skillfish submit owner/repo                  Discover and select skills to submit
  $ skillfish submit owner/repo my-skill         Submit a specific skill by name
  $ skillfish submit owner/repo --all            Submit all skills in the repository
  $ skillfish submit owner/repo -y               Skip confirmation prompt`,
  )
  .action(
    async (
      repoArg: string,
      skillNameArg: string | undefined,
      options: SubmitCommandOptions,
      command: Command,
    ) => {
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

      const skipConfirm = options.yes ?? false;
      const submitAll = options.all ?? false;

      // Parse repo format - supports owner/repo
      const parts = repoArg.split('/');
      let owner: string;
      let repo: string;

      if (parts.length < 2) {
        exitWithError('Invalid format. Use: owner/repo', EXIT_CODES.INVALID_ARGS);
      }

      [owner, repo] = parts as [string, string];

      // Validate owner/repo (security: prevent injection)
      if (!owner || !repo || !isValidName(owner) || !isValidName(repo)) {
        exitWithError('Invalid repository format. Use: owner/repo', EXIT_CODES.INVALID_ARGS);
      }

      // 1. Discover skills in the repository
      const discoveryResult = await discoverSkillsForSubmit(
        owner,
        repo,
        submitAll,
        jsonMode,
        jsonOutput,
        skillNameArg,
      );

      if (!discoveryResult || discoveryResult.skills.length === 0) {
        if (jsonMode) {
          outputJsonAndExit(EXIT_CODES.NOT_FOUND);
        }
        process.exit(EXIT_CODES.NOT_FOUND);
      }

      const { skills: selectedSkills, branch } = discoveryResult;

      // 2. Confirm submission
      if (!skipConfirm && !jsonMode && isInputTTY()) {
        const shouldSubmit = await confirmSubmitBatch(
          owner,
          repo,
          selectedSkills.map((s) => s.name),
        );
        if (!shouldSubmit) {
          p.outro(pc.dim('Cancelled'));
          process.exit(EXIT_CODES.SUCCESS);
        }
      }

      // 3. Build submission payloads
      const submissions: SkillSubmission[] = selectedSkills.map((skill) => ({
        skill_url: buildSkillUrl(owner, repo, branch, skill.dir),
        owner,
        repo,
        skill_name: skill.name,
        path: skill.dir === SKILL_FILENAME ? '' : skill.dir,
      }));

      // 4. Submit to registry
      let spinner: ReturnType<typeof p.spinner> | null = null;
      if (!jsonMode) {
        spinner = p.spinner();
        spinner.start(
          `Submitting ${submissions.length} skill${submissions.length === 1 ? '' : 's'} to registry...`,
        );
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

        // Process results
        for (const submitted of result.submitted) {
          if (submitted.success) {
            jsonOutput.submitted.push({
              skill_name: submitted.skill_name,
              skill_url:
                submissions.find((s) => s.skill_name === submitted.skill_name)?.skill_url ?? '',
              owner,
              repo,
              path: submissions.find((s) => s.skill_name === submitted.skill_name)?.path ?? '',
            });
            if (!jsonMode) {
              console.log(
                `  ${pc.green('✓')} ${submitted.skill_name}${submitted.message ? pc.dim(` - ${submitted.message}`) : ''}`,
              );
            }
          } else {
            jsonOutput.failed.push({
              skill_name: submitted.skill_name,
              reason: submitted.error ?? 'Unknown error',
            });
            if (!jsonMode) {
              console.log(
                `  ${pc.red('✗')} ${submitted.skill_name}${submitted.error ? pc.dim(` - ${submitted.error}`) : ''}`,
              );
            }
          }
        }

        // Add any batch-level errors
        for (const error of result.errors) {
          addError(error);
        }
      } catch (err) {
        if (spinner) {
          spinner.stop(pc.red('Submission failed'));
        }

        const errorMsg = err instanceof Error ? err.message : String(err);
        exitWithError(`Registry submission failed: ${errorMsg}`, EXIT_CODES.NETWORK_ERROR, true);
      }

      // Summary
      if (jsonMode) {
        outputJsonAndExit(EXIT_CODES.SUCCESS);
      }

      console.log();
      const submittedCount = jsonOutput.submitted.length;
      const failedCount = jsonOutput.failed.length;

      if (submittedCount > 0) {
        p.outro(
          pc.green(
            `Done! Submitted ${submittedCount} skill${submittedCount === 1 ? '' : 's'} to the registry`,
          ),
        );
      } else if (failedCount > 0) {
        p.outro(pc.red(`Failed to submit ${failedCount} skill${failedCount === 1 ? '' : 's'}`));
      } else {
        p.outro(pc.yellow('No skills submitted'));
      }
      process.exit(EXIT_CODES.SUCCESS);
    },
  );

// === Helper Functions ===

/**
 * Create a fresh JSON output object for the submit command.
 */
function createSubmitJsonOutput(): SubmitJsonOutput {
  return {
    success: true,
    submitted: [],
    failed: [],
    skills_found: [],
    errors: [],
  };
}

/**
 * Discover skills in a repository for submission.
 */
async function discoverSkillsForSubmit(
  owner: string,
  repo: string,
  submitAll: boolean,
  jsonMode: boolean,
  jsonOutput: SubmitJsonOutput,
  targetSkillName?: string,
): Promise<{ skills: SkillMetadata[]; branch: string } | null> {
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

  // Fetch frontmatter metadata for all skills in parallel
  let spinner: ReturnType<typeof p.spinner> | null = null;
  if (!jsonMode) {
    spinner = p.spinner();
    spinner.start('Fetching skill metadata...');
  }

  // Fetch metadata with bounded concurrency (max 10 parallel requests)
  const skills = await batchMap(
    skillPaths,
    async (sp): Promise<SkillMetadata> => {
      const skillDir = sp === SKILL_FILENAME ? '.' : dirname(sp);
      const folderName = sp === SKILL_FILENAME ? repo : basename(skillDir);

      // Fetch raw content to parse frontmatter
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
      `Found ${pc.cyan(skills.length.toString())} skill${skills.length === 1 ? '' : 's'}`,
    );
  }

  // Store found skills in JSON output
  jsonOutput.skills_found = skills.map((s) => s.name);

  // If a specific skill name was requested, find and return it
  if (targetSkillName) {
    const normalize = (s: string) => s.toLowerCase().replace(/[\s_]+/g, '-');
    const normalizedTarget = normalize(targetSkillName);

    const matchedSkill = skills.find((s) => {
      const normalizedName = normalize(s.name);
      const normalizedDir = normalize(s.dir);
      const dirBasename = normalize(s.dir.split('/').pop() || '');

      return (
        normalizedName === normalizedTarget ||
        normalizedDir === normalizedTarget ||
        dirBasename === normalizedTarget ||
        s.name.toLowerCase() === targetSkillName.toLowerCase()
      );
    });

    if (matchedSkill) {
      const displayName = toTitleCase(matchedSkill.name);
      const desc = matchedSkill.description ? truncate(matchedSkill.description, 60) : '';
      if (!jsonMode) {
        p.log.info(`${pc.bold(displayName)}${desc ? pc.dim(` - ${desc}`) : ''}`);
      }
      return { skills: [matchedSkill], branch };
    }

    // Skill not found - show available skills
    const errorMsg = `Skill "${targetSkillName}" not found in repository`;
    if (jsonMode) {
      jsonOutput.errors.push(errorMsg);
      jsonOutput.success = false;
    } else {
      p.log.error(errorMsg);
      console.log(`\nAvailable skills in ${owner}/${repo}:`);
      for (const skill of skills) {
        const displayName = toTitleCase(skill.name);
        const desc = skill.description ? pc.dim(` - ${truncate(skill.description, 80)}`) : '';
        console.log(`  - ${pc.cyan(skill.name)} ${displayName}${desc}`);
      }
    }
    return null;
  }

  // Single skill - return it directly
  if (skills.length === 1) {
    const skill = skills[0];
    const displayName = toTitleCase(skill.name);
    const desc = skill.description ? truncate(skill.description, 60) : '';
    if (!jsonMode) {
      p.log.info(`${pc.bold(displayName)}${desc ? pc.dim(` - ${desc}`) : ''}`);
    }
    return { skills: [skill], branch };
  }

  // Multiple skills - handle based on mode
  const optionsList = skills.map((skill) => ({
    value: skill,
    label: toTitleCase(skill.name),
  }));

  // Non-TTY or JSON mode: require --all flag for multiple skills
  if (!isInputTTY() || jsonMode) {
    if (submitAll) {
      if (!jsonMode) {
        console.log(`Submitting all ${skills.length} skills`);
      }
      return { skills, branch };
    }

    // List skills and exit with guidance
    if (jsonMode) {
      jsonOutput.errors.push('Multiple skills found. Specify skill name or use --all.');
      jsonOutput.success = false;
    } else {
      console.log(`\nFound ${skills.length} skills in this repository:`);
      for (const skill of skills) {
        const displayName = toTitleCase(skill.name);
        const desc = skill.description ? pc.dim(` - ${truncate(skill.description, 80)}`) : '';
        console.log(`  - ${pc.cyan(skill.name)} ${displayName}${desc}`);
      }
      console.error(
        '\nMultiple skills found. Specify skill name or use --all (non-interactive mode).',
      );
    }
    return null;
  }

  // Interactive multi-select
  const selected = await p.multiselect({
    message: 'Select skills to submit to the registry',
    options: optionsList,
    required: true,
  });

  if (p.isCancel(selected)) {
    p.cancel('Cancelled');
    process.exit(EXIT_CODES.SUCCESS);
  }

  return { skills: selected, branch };
}

/**
 * Show confirmation prompt before submitting skills.
 */
async function confirmSubmitBatch(
  owner: string,
  repo: string,
  skillNames: string[],
): Promise<boolean> {
  console.log();
  p.log.info(pc.cyan('Skills will be submitted to the public registry for discovery.'));
  console.log(pc.dim(`  Source: github.com/${owner}/${repo}`));
  console.log(pc.dim('  Use --yes to skip this prompt.'));

  if (skillNames.length > 1) {
    console.log();
    console.log(pc.dim('  Skills to submit:'));
    for (const name of skillNames) {
      console.log(pc.dim(`    • ${name}`));
    }
  }
  console.log();

  const skillLabel =
    skillNames.length === 1
      ? pc.bold(skillNames[0])
      : `${pc.bold(skillNames.length.toString())} skills`;

  const proceed = await p.confirm({
    message: `Submit ${skillLabel} from ${pc.cyan(`${owner}/${repo}`)} to the registry?`,
    initialValue: true,
  });

  if (p.isCancel(proceed)) {
    return false;
  }

  return proceed;
}
