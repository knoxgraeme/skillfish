/**
 * Tests for the `skillfish list` command.
 */

import { describe, it, expect } from 'vitest';
import { invokeCli } from './invoke-cli.js';

describe('list command', () => {
  it('shows help with --help', () => {
    const { stdout, exitCode } = invokeCli(['list', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('List installed skills');
    expect(stdout).toContain('--project');
    expect(stdout).toContain('--global');
  });

  it('outputs valid JSON with --json flag', () => {
    const { stdout, exitCode } = invokeCli(['--json', 'list']);
    expect(exitCode).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const json = JSON.parse(stdout);
    expect(json).toHaveProperty('success');
    expect(json).toHaveProperty('installed');
    expect(json).toHaveProperty('agents_detected');
    expect(Array.isArray(json.installed)).toBe(true);
    expect(Array.isArray(json.agents_detected)).toBe(true);
  });

  it('accepts --project flag', () => {
    const { stdout, exitCode } = invokeCli(['--json', 'list', '--project']);
    expect(exitCode).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.success).toBe(true);
  });

  it('accepts --global flag', () => {
    const { stdout, exitCode } = invokeCli(['--json', 'list', '--global']);
    expect(exitCode).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.success).toBe(true);
  });

  it('returns installed skills with correct structure', () => {
    const { stdout, exitCode } = invokeCli(['--json', 'list']);
    expect(exitCode).toBe(0);
    const json = JSON.parse(stdout);

    // If there are installed skills, verify structure
    if (json.installed.length > 0) {
      const skill = json.installed[0];
      expect(skill).toHaveProperty('agent');
      expect(skill).toHaveProperty('skill');
      expect(skill).toHaveProperty('path');
      expect(typeof skill.agent).toBe('string');
      expect(typeof skill.skill).toBe('string');
      expect(typeof skill.path).toBe('string');
    }
  });
});
