/**
 * Security tests for the installer module.
 * Tests symlink protection, path traversal prevention, and input validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { safeCopyDir } from '../lib/installer.js';
import { invokeCli } from './invoke-cli.js';

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
