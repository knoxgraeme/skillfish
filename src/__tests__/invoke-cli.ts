/**
 * Test helper for invoking the CLI.
 * Uses execFileSync with array args to prevent shell injection.
 */

import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, '../index.ts');

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Invoke the CLI with the given arguments.
 *
 * @param args - Command line arguments
 * @returns CliResult with exit code, stdout, and stderr
 */
export function invokeCli(args: string[]): CliResult {
  try {
    // Use execFileSync with array args to prevent shell injection
    const stdout = execFileSync('npx', ['tsx', CLI_PATH, ...args], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error: unknown) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}
