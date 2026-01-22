/**
 * Security tests for the installer module.
 * Tests symlink protection, path traversal prevention, and input validation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { safeCopyDir, installSkill, SkillMdNotFoundError } from '../lib/installer.js';
import { invokeCli } from './invoke-cli.js';
import type { Agent } from '../lib/agents.js';

describe('safeCopyDir security', () => {
  let tempDir: string;
  let srcDir: string;
  let destDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skillfish-test-'));
    srcDir = join(tempDir, 'src');
    destDir = join(tempDir, 'dest');
    mkdirSync(srcDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('copies regular files correctly', () => {
    writeFileSync(join(srcDir, 'file.txt'), 'hello world');

    const result = safeCopyDir(srcDir, destDir);

    expect(result.warnings).toHaveLength(0);
    expect(existsSync(join(destDir, 'file.txt'))).toBe(true);
    expect(readFileSync(join(destDir, 'file.txt'), 'utf-8')).toBe('hello world');
  });

  it('copies nested directories correctly', () => {
    mkdirSync(join(srcDir, 'nested'));
    writeFileSync(join(srcDir, 'nested', 'deep.txt'), 'nested content');

    const result = safeCopyDir(srcDir, destDir);

    expect(result.warnings).toHaveLength(0);
    expect(existsSync(join(destDir, 'nested', 'deep.txt'))).toBe(true);
    expect(readFileSync(join(destDir, 'nested', 'deep.txt'), 'utf-8')).toBe('nested content');
  });

  it('skips symlinks and returns warning', () => {
    writeFileSync(join(srcDir, 'real.txt'), 'real content');
    symlinkSync(join(srcDir, 'real.txt'), join(srcDir, 'link.txt'));

    const result = safeCopyDir(srcDir, destDir);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Skipped symlink');
    expect(result.warnings[0]).toContain('link.txt');
    expect(existsSync(join(destDir, 'real.txt'))).toBe(true);
    expect(existsSync(join(destDir, 'link.txt'))).toBe(false);
  });

  it('skips symlinks pointing outside the directory', () => {
    // Create a file outside the source directory
    const outsideFile = join(tempDir, 'outside.txt');
    writeFileSync(outsideFile, 'sensitive data');

    // Create a symlink inside src pointing to the outside file
    symlinkSync(outsideFile, join(srcDir, 'malicious-link'));

    const result = safeCopyDir(srcDir, destDir);

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('Skipped symlink'))).toBe(true);
    expect(existsSync(join(destDir, 'malicious-link'))).toBe(false);
  });

  it('handles empty directories', () => {
    const result = safeCopyDir(srcDir, destDir);

    expect(result.warnings).toHaveLength(0);
    expect(existsSync(destDir)).toBe(true);
  });

  it('copies multiple files correctly', () => {
    writeFileSync(join(srcDir, 'file1.txt'), 'content1');
    writeFileSync(join(srcDir, 'file2.txt'), 'content2');
    writeFileSync(join(srcDir, 'SKILL.md'), '# Skill');

    const result = safeCopyDir(srcDir, destDir);

    expect(result.warnings).toHaveLength(0);
    expect(existsSync(join(destDir, 'file1.txt'))).toBe(true);
    expect(existsSync(join(destDir, 'file2.txt'))).toBe(true);
    expect(existsSync(join(destDir, 'SKILL.md'))).toBe(true);
  });
});

describe('CLI input validation', () => {
  it('rejects paths with directory traversal', () => {
    const { exitCode, stderr } = invokeCli(['add', 'owner/repo', '--path', '../../../etc']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --path value');
  });

  it('validates owner/repo format rejects special characters', () => {
    const { exitCode, stderr } = invokeCli(['add', 'owner/repo;rm -rf /']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid format');
  });

  it('rejects command injection in owner name', () => {
    const { exitCode, stderr } = invokeCli(['add', '$(whoami)/repo']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid repository format');
  });

  it('rejects command injection in repo name', () => {
    const { exitCode, stderr } = invokeCli(['add', 'owner/`id`']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid repository format');
  });

  it('rejects pipe characters in repo name', () => {
    const { exitCode, stderr } = invokeCli(['add', 'owner/repo|evil']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid repository format');
  });

  it('rejects paths starting with slash', () => {
    const { exitCode, stderr } = invokeCli(['add', 'owner/repo', '--path', '/absolute/path']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --path value');
  });

  it('rejects paths with double slashes', () => {
    const { exitCode, stderr } = invokeCli(['add', 'owner/repo', '--path', 'skills//evil']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --path value');
  });

  it('rejects backslash traversal attempts', () => {
    const { exitCode, stderr } = invokeCli(['add', 'owner/repo', '--path', '..\\windows\\system32']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --path value');
  });
});

// Mock degit for installSkill tests
vi.mock('degit', () => {
  return {
    default: vi.fn(),
  };
});

describe('installSkill', () => {
  let tempDir: string;
  let mockDegit: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'skillfish-install-test-'));

    // Get the mocked degit
    const degitModule = await import('degit');
    mockDegit = degitModule.default as ReturnType<typeof vi.fn>;
    mockDegit.mockReset();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  const createMockAgent = (name: string, dir: string): Agent => ({
    name,
    dir,
    detect: () => true,
  });

  it('installs skill to multiple agents', async () => {
    // Mock degit to simulate successful download with SKILL.md
    mockDegit.mockReturnValue({
      clone: vi.fn().mockImplementation(async (destDir: string) => {
        mkdirSync(destDir, { recursive: true });
        writeFileSync(join(destDir, 'SKILL.md'), '# Test Skill');
        writeFileSync(join(destDir, 'README.md'), '# README');
      }),
    });

    const agents = [
      createMockAgent('Agent1', '.agent1/skills'),
      createMockAgent('Agent2', '.agent2/skills'),
    ];

    const result = await installSkill('owner', 'repo', 'SKILL.md', 'test-skill', agents, {
      force: false,
      baseDir: tempDir,
    });

    expect(result.failed).toBe(false);
    expect(result.installed).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);

    // Verify files were copied
    expect(existsSync(join(tempDir, '.agent1/skills', 'test-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tempDir, '.agent2/skills', 'test-skill', 'SKILL.md'))).toBe(true);
  });

  it('skips existing skill without --force', async () => {
    // Pre-create the skill directory
    const existingDir = join(tempDir, '.agent1/skills', 'test-skill');
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(join(existingDir, 'SKILL.md'), '# Existing');

    mockDegit.mockReturnValue({
      clone: vi.fn().mockImplementation(async (destDir: string) => {
        mkdirSync(destDir, { recursive: true });
        writeFileSync(join(destDir, 'SKILL.md'), '# New Skill');
      }),
    });

    const agents = [createMockAgent('Agent1', '.agent1/skills')];

    const result = await installSkill('owner', 'repo', 'SKILL.md', 'test-skill', agents, {
      force: false,
      baseDir: tempDir,
    });

    expect(result.failed).toBe(false);
    expect(result.installed).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('Already exists');

    // Verify original file unchanged
    expect(readFileSync(join(existingDir, 'SKILL.md'), 'utf-8')).toBe('# Existing');
  });

  it('overwrites existing skill with --force', async () => {
    // Pre-create the skill directory
    const existingDir = join(tempDir, '.agent1/skills', 'test-skill');
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(join(existingDir, 'SKILL.md'), '# Existing');

    mockDegit.mockReturnValue({
      clone: vi.fn().mockImplementation(async (destDir: string) => {
        mkdirSync(destDir, { recursive: true });
        writeFileSync(join(destDir, 'SKILL.md'), '# New Skill');
      }),
    });

    const agents = [createMockAgent('Agent1', '.agent1/skills')];

    const result = await installSkill('owner', 'repo', 'SKILL.md', 'test-skill', agents, {
      force: true,
      baseDir: tempDir,
    });

    expect(result.failed).toBe(false);
    expect(result.installed).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);

    // Verify file was overwritten
    expect(readFileSync(join(existingDir, 'SKILL.md'), 'utf-8')).toBe('# New Skill');
  });

  it('fails when SKILL.md not found in download', async () => {
    mockDegit.mockReturnValue({
      clone: vi.fn().mockImplementation(async (destDir: string) => {
        // Download succeeds but no SKILL.md
        mkdirSync(destDir, { recursive: true });
        writeFileSync(join(destDir, 'README.md'), '# No skill here');
      }),
    });

    const agents = [createMockAgent('Agent1', '.agent1/skills')];

    const result = await installSkill('owner', 'repo', 'invalid/path', 'test-skill', agents, {
      force: false,
      baseDir: tempDir,
    });

    expect(result.failed).toBe(true);
    expect(result.failureReason).toContain('SKILL.md not found');
    expect(result.installed).toHaveLength(0);
  });

  it('cleans up temp directory on failure', async () => {
    mockDegit.mockReturnValue({
      clone: vi.fn().mockRejectedValue(new Error('Network error')),
    });

    const agents = [createMockAgent('Agent1', '.agent1/skills')];

    const result = await installSkill('owner', 'repo', 'SKILL.md', 'test-skill', agents, {
      force: false,
      baseDir: tempDir,
    });

    expect(result.failed).toBe(true);
    expect(result.failureReason).toContain('Network error');

    // Temp directory should be cleaned up (no lingering cache directories)
    // We can't directly test this since the cache dir is in ~/.cache,
    // but the function should have called rmSync in the finally block
  });

  it('handles degit errors gracefully', async () => {
    mockDegit.mockReturnValue({
      clone: vi.fn().mockRejectedValue(new Error('could not find commit hash')),
    });

    const agents = [createMockAgent('Agent1', '.agent1/skills')];

    const result = await installSkill('owner', 'repo', 'SKILL.md', 'test-skill', agents, {
      force: false,
      baseDir: tempDir,
    });

    expect(result.failed).toBe(true);
    expect(result.failureReason).toContain('could not find commit hash');
  });
});
