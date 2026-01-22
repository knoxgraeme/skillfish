/**
 * Tests for the `skillfish remove` command.
 */

import { describe, it, expect } from 'vitest';
import { invokeCli } from './invoke-cli.js';

describe('remove command', () => {
  it('shows help with --help', () => {
    const { stdout, exitCode } = invokeCli(['remove', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Remove an installed skill');
    expect(stdout).toContain('--yes');
    expect(stdout).toContain('--all');
    expect(stdout).toContain('--agent');
  });

  it('requires a skill name or --all flag in non-interactive mode', () => {
    // Test via JSON mode which is non-interactive
    const { stdout, exitCode } = invokeCli(['--json', 'remove']);
    expect(exitCode).toBe(2); // EXIT_INVALID_ARGS
    const json = JSON.parse(stdout);
    expect(json.success).toBe(false);
    expect(json.errors[0]).toContain('specify a skill name');
  });

  it('outputs valid JSON with --json flag when skill not found', () => {
    const { stdout, exitCode } = invokeCli(['--json', 'remove', 'nonexistent-skill']);
    expect(exitCode).toBe(4); // EXIT_NOT_FOUND
    expect(() => JSON.parse(stdout)).not.toThrow();
    const json = JSON.parse(stdout);
    expect(json.success).toBe(false);
    expect(json.errors.length).toBeGreaterThan(0);
  });

  it('outputs valid JSON with --json flag and --all when no skills', () => {
    const { stdout, exitCode } = invokeCli(['--json', 'remove', '--all']);
    // Should output valid JSON even when no skills found
    expect(() => JSON.parse(stdout)).not.toThrow();
    const json = JSON.parse(stdout);
    expect(json).toHaveProperty('removed');
    expect(json).toHaveProperty('errors');
  });

  it('reports error when agent not found', () => {
    const { stdout, exitCode } = invokeCli(['--json', 'remove', 'some-skill', '--agent', 'NonexistentAgent']);
    expect(exitCode).toBe(4); // EXIT_NOT_FOUND
    const json = JSON.parse(stdout);
    expect(json.success).toBe(false);
    expect(json.errors[0]).toContain('not found');
  });
});
