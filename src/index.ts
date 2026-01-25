#!/usr/bin/env node
/**
 * skillfish CLI - Install AI agent skills from GitHub
 *
 * Entry point that sets up Commander.js and imports commands.
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { addCommand } from './commands/add.js';
import { listCommand } from './commands/list.js';
import { removeCommand } from './commands/remove.js';

// Read version from package.json (single source of truth)
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

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
  .configureHelp({
    sortSubcommands: true,
  })
  .addHelpText(
    'after',
    `
Examples:
  $ skillfish add owner/repo                 Install skills from a repository
  $ skillfish add owner/repo/plugin/skill    Install a specific skill
  $ skillfish list                           Show installed skills
  $ skillfish remove my-skill                Remove a skill

Documentation: https://skill.fish`,
  );

// Store version in options for commands to access
program.hook('preAction', (thisCommand) => {
  thisCommand.setOptionValue('version', pkg.version);
});

// Add subcommands
program.addCommand(addCommand);
program.addCommand(listCommand);
program.addCommand(removeCommand);

// Handle --json flag for help output
program.on('option:json', () => {
  // JSON mode is handled by commands
});

// Parse and run
program.parseAsync(process.argv).catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
