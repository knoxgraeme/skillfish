/**
 * `skillfish logout` command - Remove stored authentication credentials.
 */

import { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { printBanner } from '../lib/banner.js';
import { clearToken, isEnvTokenSet } from '../lib/auth.js';
import { isTTY, type LogoutJsonOutput } from '../utils.js';
import { EXIT_CODES } from '../lib/constants.js';

// === Types ===

// No command-specific options for logout

// === Command Definition ===

export const logoutCommand = new Command('logout')
  .description('Remove stored authentication credentials')
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText(
    'after',
    `
Examples:
  $ skillfish logout   Remove stored credentials`,
  )
  .action(async (_options: Record<string, never>, command: Command) => {
    const jsonMode = command.parent?.opts().json ?? false;
    const version = command.parent?.opts().version ?? '0.0.0';

    const jsonOutput: LogoutJsonOutput = {
      success: true,
      errors: [],
    };

    function outputJsonAndExit(exitCode: number): never {
      jsonOutput.exit_code = exitCode;
      console.log(JSON.stringify(jsonOutput, null, 2));
      process.exit(exitCode);
    }

    // Show banner and intro (TTY only, not in JSON mode)
    if (isTTY() && !jsonMode) {
      printBanner();
      p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim(`v${version}`)}`);
    }

    // Clear stored credentials
    const wasLoggedIn = await clearToken();

    // Warn if environment variable is still set (TTY only)
    if (isTTY() && !jsonMode && isEnvTokenSet()) {
      p.log.warn(pc.yellow('Note: SKILLFISH_TOKEN environment variable is still set'));
    }

    if (jsonMode) {
      outputJsonAndExit(EXIT_CODES.SUCCESS);
    }

    if (wasLoggedIn) {
      p.log.success('Logged out');
    } else {
      p.log.info('Already logged out');
    }

    p.outro(pc.dim('Credentials removed'));
    process.exit(EXIT_CODES.SUCCESS);
  });
