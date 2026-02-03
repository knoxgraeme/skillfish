/**
 * `skillfish login` command - Authenticate with skillfish.io.
 */

import { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { printBanner } from '../lib/banner.js';
import {
  getToken,
  storeToken,
  validateToken,
  isValidTokenFormat,
  getTokenPrefix,
} from '../lib/auth.js';
import { isTTY, isInputTTY, type LoginJsonOutput } from '../utils.js';
import { EXIT_CODES, type ExitCode } from '../lib/constants.js';

// === Types ===

interface LoginCommandOptions {
  token?: string;
}

// === Command Definition ===

export const loginCommand = new Command('login')
  .description('Authenticate with skillfish.io')
  .option('-t, --token <token>', 'API token (for CI/automation)')
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText(
    'after',
    `
Examples:
  $ skillfish login                  Interactive token prompt
  $ skillfish login --token sk_...   Direct token input (CI/automation)
  $ SKILLFISH_TOKEN=sk_... skillfish whoami   Use environment variable`,
  )
  .action(async (options: LoginCommandOptions, command: Command) => {
    const jsonMode = command.parent?.opts().json ?? false;
    const version = command.parent?.opts().version ?? '0.0.0';

    const jsonOutput: LoginJsonOutput = {
      success: true,
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

    const tokenArg = options.token?.trim() ?? null;

    // Non-TTY without --token: error
    if (!tokenArg && !isInputTTY()) {
      exitWithError(
        'Token required. Use --token or set SKILLFISH_TOKEN environment variable.',
        EXIT_CODES.INVALID_ARGS,
      );
    }

    let token: string;

    if (tokenArg) {
      // Direct token input (--token flag)
      token = tokenArg;
    } else {
      // Interactive mode - check if already logged in
      const existingToken = getToken();
      if (existingToken) {
        const overwrite = await p.confirm({
          message: 'Already logged in. Overwrite existing credentials?',
          initialValue: false,
        });

        if (p.isCancel(overwrite)) {
          p.cancel('Cancelled');
          process.exit(EXIT_CODES.SUCCESS);
        }

        if (!overwrite) {
          p.outro(pc.dim('Keeping existing credentials'));
          process.exit(EXIT_CODES.SUCCESS);
        }
      }

      // Prompt for token
      if (!jsonMode) {
        p.log.info(pc.dim(`Get your token from ${pc.cyan('https://skill.fish/settings/tokens')}`));
      }

      const tokenInput = await p.password({
        message: 'Enter your API token',
        mask: '*',
      });

      if (p.isCancel(tokenInput)) {
        p.cancel('Cancelled');
        process.exit(EXIT_CODES.SUCCESS);
      }

      token = (tokenInput as string).trim();
    }

    // Validate token format locally
    if (!isValidTokenFormat(token)) {
      exitWithError(
        `Invalid token format. Token must start with '${getTokenPrefix()}'. Get your token from https://skill.fish/settings/tokens`,
        EXIT_CODES.INVALID_ARGS,
        !tokenArg, // Use clack log for interactive mode
      );
    }

    // Validate token with API
    let spinner: ReturnType<typeof p.spinner> | null = null;
    if (!jsonMode) {
      spinner = p.spinner();
      spinner.start('Validating token...');
    }

    const result = await validateToken(token);

    if (!result.valid) {
      if (spinner) {
        spinner.stop(pc.red('Validation failed'));
      }

      const exitCode =
        result.error === 'network_error' ? EXIT_CODES.NETWORK_ERROR : EXIT_CODES.INVALID_ARGS;

      exitWithError(result.message, exitCode, !tokenArg);
    }

    // Store token
    try {
      await storeToken(token);
    } catch (err) {
      if (spinner) {
        spinner.stop(pc.red('Failed to store token'));
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      exitWithError(`Failed to store credentials: ${message}`, EXIT_CODES.GENERAL_ERROR, !tokenArg);
    }

    if (spinner) {
      spinner.stop(pc.green('Logged in'));
    }

    // Success output
    jsonOutput.user = result.user;
    jsonOutput.email = result.email;

    if (jsonMode) {
      outputJsonAndExit(EXIT_CODES.SUCCESS);
    }

    p.log.success(
      `Logged in as ${pc.bold(result.user)}${result.email ? ` (${result.email})` : ''}`,
    );
    p.outro(pc.dim('Credentials saved'));
    process.exit(EXIT_CODES.SUCCESS);
  });
