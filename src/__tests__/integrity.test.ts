/**
 * Tests for local modification detection.
 * computeTreeSha must match git's own tree hashing, because legacy manifests
 * only store the GitHub tree SHA of the installed directory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, symlinkSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { computeTreeSha, isSkillModified } from '../lib/integrity.js';
import type { SkillManifest } from '../lib/manifest.js';

function gitWriteTree(dir: string): string {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' }).trim();
  git('init', '-q');
  git('add', '-A');
  return git('write-tree');
}

function gitBlobSha(file: string): string {
  return execFileSync('git', ['hash-object', file], { encoding: 'utf-8' }).trim();
}

function baseManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    version: 2,
    owner: 'owner',
    repo: 'repo',
    path: 'skills/demo',
    branch: 'main',
    sha: '0'.repeat(40),
    ...overrides,
  };
}

describe('computeTreeSha', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'skillfish-integrity-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('matches git write-tree for nested directories and git sort order', () => {
    writeFileSync(join(dir, 'SKILL.md'), '# Demo\n');
    // git sorts directories as "name/": "a-b" < "a/" < "a0"
    mkdirSync(join(dir, 'a', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'a', 'deep', 'ref.md'), 'nested\n');
    writeFileSync(join(dir, 'a-b'), 'dash\n');
    writeFileSync(join(dir, 'a0'), 'zero\n');
    writeFileSync(join(dir, 'empty.txt'), '');

    const expected = gitWriteTree(dir);
    rmSync(join(dir, '.git'), { recursive: true, force: true });

    expect(computeTreeSha(dir)).toBe(expected);
  });

  it.skipIf(process.platform === 'win32')('matches git for executable files', () => {
    writeFileSync(join(dir, 'SKILL.md'), '# Demo\n');
    mkdirSync(join(dir, 'scripts'));
    writeFileSync(join(dir, 'scripts', 'run.sh'), '#!/bin/sh\necho hi\n');
    chmodSync(join(dir, 'scripts', 'run.sh'), 0o755);

    const expected = gitWriteTree(dir);
    rmSync(join(dir, '.git'), { recursive: true, force: true });

    expect(computeTreeSha(dir)).toBe(expected);
  });

  it('ignores the skillfish manifest, .DS_Store, empty directories and symlinks', () => {
    writeFileSync(join(dir, 'SKILL.md'), '# Demo\n');
    const before = computeTreeSha(dir);

    writeFileSync(join(dir, '.skillfish.json'), '{}');
    writeFileSync(join(dir, '.DS_Store'), 'finder');
    mkdirSync(join(dir, 'empty', 'nested'), { recursive: true });
    symlinkSync(join(dir, 'SKILL.md'), join(dir, 'link.md'));

    expect(computeTreeSha(dir)).toBe(before);
  });
});

describe('isSkillModified', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'skillfish-modified-'));
    writeFileSync(join(dir, 'SKILL.md'), '# Demo\n');
    mkdirSync(join(dir, 'references'));
    writeFileSync(join(dir, 'references', 'guide.md'), 'guide\n');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is false when content matches the recorded contentSha', () => {
    const manifest = baseManifest({ contentSha: computeTreeSha(dir) });
    expect(isSkillModified(dir, manifest)).toBe(false);
  });

  it('detects edited, added and deleted files', () => {
    const manifest = baseManifest({ contentSha: computeTreeSha(dir) });

    writeFileSync(join(dir, 'SKILL.md'), '# Demo\n\nMy local tweak\n');
    expect(isSkillModified(dir, manifest)).toBe(true);

    writeFileSync(join(dir, 'SKILL.md'), '# Demo\n');
    writeFileSync(join(dir, 'notes.md'), 'mine\n');
    expect(isSkillModified(dir, manifest)).toBe(true);

    rmSync(join(dir, 'notes.md'));
    rmSync(join(dir, 'references', 'guide.md'));
    expect(isSkillModified(dir, manifest)).toBe(true);
  });

  it('protects legacy installs by comparing against the stored tree sha', () => {
    // Manifests written before contentSha existed hold the GitHub tree SHA,
    // which equals the git tree hash of the untouched installed directory.
    const manifest = baseManifest({ sha: computeTreeSha(dir) });
    expect(isSkillModified(dir, manifest)).toBe(false);

    writeFileSync(join(dir, 'SKILL.md'), '# Demo\n\nMy local tweak\n');
    expect(isSkillModified(dir, manifest)).toBe(true);
  });

  it('protects legacy root-level installs whose sha is the SKILL.md blob', () => {
    writeFileSync(join(dir, 'README.md'), 'rest of the repo\n');
    const manifest = baseManifest({ path: '.', sha: gitBlobSha(join(dir, 'SKILL.md')) });
    expect(isSkillModified(dir, manifest)).toBe(false);

    writeFileSync(join(dir, 'SKILL.md'), '# Demo\n\nMy local tweak\n');
    expect(isSkillModified(dir, manifest)).toBe(true);
  });

  it('treats an unreadable skill directory as modified', () => {
    const manifest = baseManifest({ contentSha: computeTreeSha(dir) });
    rmSync(dir, { recursive: true, force: true });
    expect(isSkillModified(dir, manifest)).toBe(true);
  });
});
