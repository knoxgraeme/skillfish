/**
 * `skillfish whoami` command - Display the currently authenticated user.
 */

import { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { printBanner } from '../lib/banner.js';
import { getToken, validateToken, clearToken } from '../lib/auth.js';
import { isTTY, type WhoamiJsonOutput } from '../utils.js';
import { EXIT_CODES, type ExitCode } from '../lib/constants.js';

// === Types ===

// No command-specific options for whoami

// === Command Definition ===

export const whoamiCommand = new Command('whoami')
  .description('Display the currently authenticated user')
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText(
    'after',
    `
Examples:
  $ skillfish whoami   Show current user`,
  )
  .action(async (_options: Record<string, never>, command: Command) => {
    const jsonMode = command.parent?.opts().json ?? false;
    const version = command.parent?.opts().version ?? '0.0.0';

    const jsonOutput: WhoamiJsonOutput = {
      success: true,
      logged_in: false,
      errors: [],
    };

    function addError(message: string): void {
      jsonOutput.errors.push(message);
      jsonOutput.success = false;
    }

    function outputJsonAndExit(exitCode: number): never {
      jsonOutput.exit_code = exitCode;
      console.log(JSON.stringify(jsonOutput, null, 2));
      process.exit(exitCode);
    }

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
      printBanner();
      p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim(`v${version}`)}`);
    }

    // Get token (env var or file)
    const tokenInfo = getToken();

    if (!tokenInfo) {
      // Not logged in - not an error
      if (jsonMode) {
        outputJsonAndExit(EXIT_CODES.SUCCESS);
      }

      p.log.info("Not logged in. Run 'skillfish login' to authenticate.");
      p.outro(pc.dim('https://skill.fish/settings/tokens'));
      process.exit(EXIT_CODES.SUCCESS);
    }

    // Validate token with API
    let spinner: ReturnType<typeof p.spinner> | null = null;
    if (!jsonMode) {
      spinner = p.spinner();
      spinner.start('Fetching user info...');
    }

    const result = await validateToken(tokenInfo.token);

    if (!result.valid) {
      if (spinner) {
        spinner.stop(pc.red('Failed'));
      }

      // If token is invalid/expired and stored in file, clear it
      if (result.error !== 'network_error' && tokenInfo.source === 'file') {
        await clearToken();
        if (!jsonMode) {
          p.log.warn(pc.dim('Cleared invalid stored credentials'));
        }
      }

      const exitCode =
        result.error === 'network_error' ? EXIT_CODES.NETWORK_ERROR : EXIT_CODES.INVALID_ARGS;

      exitWithError(result.message, exitCode, true);
    }

    if (spinner) {
      spinner.stop(pc.green('Authenticated'));
    }

    // Success
    jsonOutput.logged_in = true;
    jsonOutput.user = result.user;
    jsonOutput.email = result.email;
    jsonOutput.token_source = tokenInfo.source;

    if (jsonMode) {
      outputJsonAndExit(EXIT_CODES.SUCCESS);
    }

    p.log.success(
      `Logged in as ${pc.bold(result.user)}${result.email ? ` (${result.email})` : ''}`,
    );

    const sourceLabel = tokenInfo.source === 'env' ? 'environment variable' : 'credentials file';
    p.outro(pc.dim(`Token source: ${sourceLabel}`));

    process.exit(EXIT_CODES.SUCCESS);
  });
