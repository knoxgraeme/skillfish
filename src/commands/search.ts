/**
 * `skillfish search` command - Search for skills in the registry.
 */

import { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { printBanner } from '../lib/banner.js';
import { trackCommand } from '../telemetry.js';
import { searchSkillsInRegistry, type SearchResult } from '../lib/registry.js';
import { EXIT_CODES, type ExitCode } from '../lib/constants.js';
import { isTTY, truncate, type SearchJsonOutput, type SearchResultItem } from '../utils.js';

// === Types ===

interface SearchCommandOptions {
  limit?: string;
}

// === Command Definition ===

export const searchCommand = new Command('search')
  .description('Search for skills in the registry')
  .argument('<query>', 'Search query')
  .option('-l, --limit <n>', 'Maximum number of results (default: 5)')
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText(
    'after',
    `
Examples:
  $ skillfish search github             Search for "github" skills
  $ skillfish search "code review"      Search with multiple words
  $ skillfish search git --limit 3      Limit results to 3`,
  )
  .action(async (query: string, options: SearchCommandOptions, command: Command) => {
    const jsonMode = command.parent?.opts().json ?? false;

    // JSON output state
    const jsonOutput: Partial<SearchJsonOutput> = {
      success: true,
      errors: [],
    };

    function addError(message: string): void {
      jsonOutput.errors!.push(message);
      jsonOutput.success = false;
    }

    function outputJsonAndExit(
      exitCode: ExitCode,
      queryStr: string,
      data: Partial<SearchJsonOutput> = {},
    ): never {
      const output: SearchJsonOutput = {
        success: jsonOutput.success!,
        exit_code: exitCode,
        errors: jsonOutput.errors!,
        query: queryStr,
        results: data.results ?? [],
        total_count: data.total_count ?? 0,
      };
      console.log(JSON.stringify(output, null, 2));
      process.exit(exitCode);
    }

    function exitWithError(message: string, exitCode: ExitCode, queryStr: string = query): never {
      if (jsonMode) {
        addError(message);
        outputJsonAndExit(exitCode, queryStr, { results: [], total_count: 0 });
      }
      p.log.error(message);
      process.exit(exitCode);
    }

    // Validate query
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      exitWithError('Search query cannot be empty', EXIT_CODES.INVALID_ARGS, trimmedQuery);
    }
    if (trimmedQuery.length > 200) {
      exitWithError(
        'Search query too long (max 200 characters)',
        EXIT_CODES.INVALID_ARGS,
        trimmedQuery,
      );
    }

    // Parse limit option
    const limitStr = options.limit ?? '5';
    const limit = parseInt(limitStr, 10);
    if (isNaN(limit) || limit < 1 || limit > 50) {
      exitWithError(
        'Limit must be a number between 1 and 50',
        EXIT_CODES.INVALID_ARGS,
        trimmedQuery,
      );
    }

    // Display banner and intro (TTY only, not in JSON mode)
    if (isTTY() && !jsonMode) {
      printBanner();
      p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim('Search')}`);
    }

    // Track command usage (fire and forget)
    trackCommand('search');

    // Show spinner while searching
    let response;
    if (!jsonMode) {
      const spinner = p.spinner();
      spinner.start(`Searching for "${trimmedQuery}"...`);
      response = await searchSkillsInRegistry(trimmedQuery, limit);
      spinner.stop(response.success ? 'Search complete' : 'Search failed');
    } else {
      response = await searchSkillsInRegistry(trimmedQuery, limit);
    }

    if (!response.success) {
      exitWithError(
        response.error ?? 'Failed to search registry',
        EXIT_CODES.NETWORK_ERROR,
        trimmedQuery,
      );
    }

    // Transform results for JSON output
    const jsonResults: SearchResultItem[] = response.results.map((r: SearchResult) => ({
      name: r.name,
      slug: r.slug,
      owner: r.owner,
      github: r.github,
      url: `https://www.skill.fish/skill/${r.slug}`,
      description: r.description,
      stars: r.stars,
    }));

    // JSON output
    if (jsonMode) {
      outputJsonAndExit(EXIT_CODES.SUCCESS, trimmedQuery, {
        results: jsonResults,
        total_count: response.totalCount,
      });
    }

    // TTY output
    if (response.results.length === 0) {
      p.log.info(pc.dim('No skills found matching your query'));
      p.outro(pc.dim('Try different search terms'));
      process.exit(EXIT_CODES.SUCCESS);
    }

    console.log();
    console.log(
      pc.bold(`Found ${response.results.length} skill${response.results.length === 1 ? '' : 's'}:`),
    );
    console.log();

    // Display results
    for (let i = 0; i < response.results.length; i++) {
      const result = response.results[i];
      const num = pc.dim(`${i + 1}.`);
      const name = pc.bold(pc.cyan(result.name));

      // First line: number and name
      console.log(`  ${num} ${name}`);

      // Second line: description (truncated)
      if (result.description) {
        const desc = truncate(result.description, 70);
        console.log(`     ${pc.dim(desc)}`);
      }

      // Third line: clickable link
      const skillUrl = `https://www.skill.fish/skill/${result.slug}`;
      console.log(`     ${pc.underline(skillUrl)}`);
      console.log();
    }

    p.outro(pc.dim('Search more at https://www.skill.fish'));
    process.exit(EXIT_CODES.SUCCESS);
  });
