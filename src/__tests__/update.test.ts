/**
 * Tests for the update command.
 */

import { describe, it, expect } from 'vitest';
import { invokeCli } from './invoke-cli.js';

describe('update command', () => {
  it('shows help with --help', () => {
    const { stdout, exitCode } = invokeCli(['update', '--help']);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Check for and apply updates');
    expect(stdout).toContain('--yes');
  });

  it('outputs valid JSON with --json flag', () => {
    const { stdout, exitCode } = invokeCli(['--json', 'update']);

    expect(exitCode).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();

    const output = JSON.parse(stdout);
    expect(output).toHaveProperty('success');
    expect(output).toHaveProperty('exit_code');
    expect(output).toHaveProperty('errors');
    expect(output).toHaveProperty('outdated');
    expect(output).toHaveProperty('updated');
    expect(Array.isArray(output.outdated)).toBe(true);
    expect(Array.isArray(output.updated)).toBe(true);
    expect(Array.isArray(output.errors)).toBe(true);
  });

  it('accepts --yes flag with --json', () => {
    const { stdout, exitCode } = invokeCli(['--json', 'update', '--yes']);

    // Should exit successfully (no tracked skills in test environment)
    expect(exitCode).toBe(0);

    const output = JSON.parse(stdout);
    expect(output.success).toBe(true);
    expect(output.outdated).toEqual([]);
    expect(output.updated).toEqual([]);
  });

  it('returns success when no tracked skills found', () => {
    const { stdout, exitCode } = invokeCli(['--json', 'update']);

    expect(exitCode).toBe(0);

    const output = JSON.parse(stdout);
    expect(output.success).toBe(true);
    expect(output.outdated).toEqual([]);
  });

  it('returns valid exit_code in JSON output', () => {
    const { stdout, exitCode } = invokeCli(['--json', 'update']);

    expect(exitCode).toBe(0);

    const output = JSON.parse(stdout);
    expect(output.exit_code).toBe(0);
  });
});
