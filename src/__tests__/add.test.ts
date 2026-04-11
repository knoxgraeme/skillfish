/**
 * Tests for the `skillfish add` command.
 */

import { describe, it, expect } from 'vitest';
import { invokeCli } from './invoke-cli.js';

describe('add command', () => {
  it('shows help with --help', () => {
    const { stdout, exitCode } = invokeCli(['add', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Install a skill from a GitHub repository');
    expect(stdout).toContain('--force');
    expect(stdout).toContain('--yes');
    expect(stdout).toContain('--all');
  });

  it('requires a repository argument', () => {
    const { exitCode, stderr } = invokeCli(['add']);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("required argument 'repo'");
  });

  it('exits with error for invalid repo format (single part)', () => {
    const { exitCode, stderr } = invokeCli(['add', 'invalid']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid format');
  });

  it('accepts three-part format as owner/repo/path', () => {
    // Three parts is now valid: owner/repo/path
    // Use --json --yes --global to skip interactive prompts and fail fast
    const { stdout } = invokeCli(['--json', 'add', 'owner/repo/extra', '--yes', '--global']);
    const json = JSON.parse(stdout);
    // Should not fail with format validation error - it should proceed past parsing
    const hasFormatError = json.errors?.some((e: string) => e.includes('Invalid format'));
    expect(hasFormatError).not.toBe(true);
  }, 30_000);

  it('rejects invalid characters in owner/repo', () => {
    const { exitCode, stderr } = invokeCli(['add', 'owner;evil/repo']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid repository format');
  });

  it('rejects invalid characters in path components', () => {
    const { exitCode, stderr } = invokeCli(['add', 'owner/repo/plugin;evil/skill']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid path component');
  });

  it('outputs valid JSON with --json flag on error', () => {
    const { stdout, exitCode } = invokeCli(['--json', 'add', 'invalid']);
    expect(exitCode).toBe(2);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const json = JSON.parse(stdout);
    expect(json.success).toBe(false);
    expect(json.errors).toContain('Invalid format. Use: owner/repo or owner/repo/path/to/skill');
  });

  it('validates --path argument rejects directory traversal', () => {
    const { exitCode, stderr } = invokeCli(['add', 'owner/repo', '--path', '../../../etc']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --path value');
  });

  it('validates --path argument rejects absolute paths', () => {
    const { exitCode, stderr } = invokeCli(['add', 'owner/repo', '--path', '/etc/passwd']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --path value');
  });

  it('validates --path argument rejects special characters', () => {
    const { exitCode, stderr } = invokeCli(['add', 'owner/repo', '--path', 'skill;rm -rf /']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --path value');
  });
});
