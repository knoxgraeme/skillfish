#!/usr/bin/env node
/**
 * skillfish CLI - Install AI agent skills from GitHub
 *
 * Entry point that sets up Commander.js and imports commands.
 */

import { Command, type HelpConfiguration } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pc from 'picocolors';
import updateNotifier from 'update-notifier';
import { getBannerText } from './lib/banner.js';
import { addCommand } from './commands/add.js';
import { initCommand } from './commands/init.js';
import { listCommand } from './commands/list.js';
import { removeCommand } from './commands/remove.js';
import { searchCommand } from './commands/search.js';
import { updateCommand } from './commands/update.js';
import { submitCommand } from './commands/submit.js';

// Read version from package.json (single source of truth)
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

// Check for updates (runs in background, non-blocking)
const notifier = updateNotifier({ pkg });

// Shared help styling for all commands
const helpStyles: HelpConfiguration = {
  sortSubcommands: true,
  styleTitle: (str: string) => pc.bold(pc.underline(str)),
  styleCommandText: (str: string) => pc.bold(pc.cyan(str)),
  styleSubcommandText: (str: string) => pc.cyan(str),
  styleOptionText: (str: string) => pc.yellow(str),
  styleArgumentText: (str: string) => pc.dim(str),
  styleDescriptionText: (str: string) => pc.dim(str),
};

const program = new Command()
  .name('skillfish')
  .description('Install and manage AI agent skills from GitHub repositories')
  .version(pkg.version, '-v, --version', 'Show version number')
  .option('--json', 'Output as JSON (for automation)')
  .helpOption('-h, --help', 'Display help for command')
  .helpCommand('help [command]', 'Display help for command')
  .configureOutput({
    // Write help to stdout so it can be piped
    writeOut: (str) => process.stdout.write(str),
    writeErr: (str) => process.stderr.write(str),
  })
  .configureHelp(helpStyles)
  .addHelpText('beforeAll', () => (process.stdout.isTTY ? getBannerText() : ''))
  .addHelpText('after', () => {
    const isTTY = process.stdout.isTTY;
    const examples = [
      ['skillfish add owner/repo', 'Install skills from a repository'],
      ['skillfish add owner/repo/plugin/skill', 'Install a specific skill'],
      ['skillfish init', 'Create a new skill template'],
      ['skillfish list', 'Show installed skills'],
      ['skillfish remove my-skill', 'Remove a skill'],
    ];

    const title = isTTY ? pc.bold(pc.underline('Examples:')) : 'Examples:';
    const lines = examples.map(([cmd, desc]) => {
      const prefix = isTTY ? pc.dim('  $ ') : '  $ ';
      const command = isTTY ? pc.cyan(cmd) : cmd;
      // Pad to align descriptions
      const padding = ' '.repeat(Math.max(1, 42 - cmd.length));
      const description = isTTY ? pc.dim(desc) : desc;
      return `${prefix}${command}${padding}${description}`;
    });

    const docUrl = isTTY ? pc.bold(pc.cyan('https://skill.fish')) : 'https://skill.fish';
    const docLabel = isTTY ? pc.dim('Documentation:') : 'Documentation:';

    return `\n${title}\n${lines.join('\n')}\n\n${docLabel} ${docUrl}`;
  });

// Store version in options for commands to access
program.hook('preAction', (thisCommand) => {
  thisCommand.setOptionValue('version', pkg.version);
});

// Add subcommands
program.addCommand(addCommand);
program.addCommand(initCommand);
program.addCommand(listCommand);
program.addCommand(removeCommand);
program.addCommand(searchCommand);
program.addCommand(updateCommand);
program.addCommand(submitCommand);

// Propagate help styling to all subcommands (must run after all addCommand() calls)
for (const cmd of program.commands) {
  cmd.configureHelp(helpStyles);
}

// Handle --json flag for help output
program.on('option:json', () => {
  // JSON mode is handled by commands
});

// Parse and run
program
  .parseAsync(process.argv)
  .then(() => {
    // Show update notification after command completes (if update available)
    notifier.notify({
      message: `Update available: {currentVersion} → {latestVersion}
Run: npx skillfish@latest
Or:  npm i -g skillfish`,
    });
  })
  .catch((err) => {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
