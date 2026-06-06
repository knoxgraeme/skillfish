/**
 * Tests for the `skillfish submit` command.
 */

import { describe, it, expect } from 'vitest';
import { invokeCli } from './invoke-cli.js';

describe('submit command', () => {
  it('shows help with --help', () => {
    const { stdout, exitCode } = invokeCli(['submit', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Submit a repository to the skill registry');
  });

  it('requires a repository argument', () => {
    const { exitCode, stderr } = invokeCli(['submit']);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("required argument 'repo'");
  });

  it('rejects invalid repo format (single part)', () => {
    const { exitCode, stderr } = invokeCli(['submit', 'invalid']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid format');
  });

  it('rejects invalid characters in owner/repo', () => {
    const { exitCode, stderr } = invokeCli(['submit', 'owner;evil/repo']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid repository format');
  });

  it('outputs valid JSON with --json flag for invalid format', () => {
    const { stdout, exitCode } = invokeCli(['--json', 'submit', 'invalid']);
    expect(exitCode).toBe(2);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const json = JSON.parse(stdout);
    expect(json.success).toBe(false);
    expect(json.exit_code).toBe(2);
    expect(json.errors.length).toBeGreaterThan(0);
  });

  it('rejects non-github.com URLs', () => {
    // URL must contain 'github.com' to trigger URL parsing path; hostname check catches spoofs
    const { exitCode, stderr } = invokeCli(['submit', 'https://github.com.evil.com/owner/repo']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Only github.com URLs');
  });

  it('outputs success:false and non-zero exit_code when --json and registry fails', () => {
    // Use a repo that does not exist on GitHub so discovery fails before registry call,
    // confirming the command reports failure correctly via JSON output.
    const { stdout, exitCode } = invokeCli([
      '--json',
      'submit',
      'skillfish-test-nonexistent-owner-xyz/nonexistent-repo-xyz',
      '--yes',
    ]);
    expect(exitCode).not.toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const json = JSON.parse(stdout);
    expect(json.success).toBe(false);
    expect(json.exit_code).not.toBe(0);
  }, 30_000);
});
