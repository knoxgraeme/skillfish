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
import { computeTreeSha, getLocalEditStatus } from '../lib/integrity.js';
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

describe('getLocalEditStatus', () => {
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

  it('is unchanged when content matches the recorded contentSha', () => {
    const manifest = baseManifest({ contentSha: computeTreeSha(dir) });
    expect(getLocalEditStatus(dir, manifest)).toBe('unchanged');
  });

  it('detects edited, added and deleted files', () => {
    const manifest = baseManifest({ contentSha: computeTreeSha(dir) });

    writeFileSync(join(dir, 'SKILL.md'), '# Demo\n\nMy local tweak\n');
    expect(getLocalEditStatus(dir, manifest)).toBe('modified');

    writeFileSync(join(dir, 'SKILL.md'), '# Demo\n');
    writeFileSync(join(dir, 'notes.md'), 'mine\n');
    expect(getLocalEditStatus(dir, manifest)).toBe('modified');

    rmSync(join(dir, 'notes.md'));
    rmSync(join(dir, 'references', 'guide.md'));
    expect(getLocalEditStatus(dir, manifest)).toBe('modified');
  });

  it('compares older installs against the stored tree sha', () => {
    // Manifests written before contentSha existed hold the GitHub tree SHA,
    // which equals the git tree hash of the untouched installed directory.
    const manifest = baseManifest({ sha: computeTreeSha(dir) });
    expect(getLocalEditStatus(dir, manifest)).toBe('unchanged');

    // Without contentSha a mismatch can't be pinned on the user: sha may be a
    // commit SHA, or Windows may hide executable bits.
    writeFileSync(join(dir, 'SKILL.md'), '# Demo\n\nMy local tweak\n');
    expect(getLocalEditStatus(dir, manifest)).toBe('unknown');
    expect(getLocalEditStatus(dir, baseManifest({ sha: 'c'.repeat(40) }))).toBe('unknown');
  });

  it('accepts an untouched older root-level install whose sha is the SKILL.md blob', () => {
    writeFileSync(join(dir, 'README.md'), 'rest of the repo\n');
    const manifest = baseManifest({ path: '.', sha: gitBlobSha(join(dir, 'SKILL.md')) });
    expect(getLocalEditStatus(dir, manifest)).toBe('unchanged');
  });

  it('cannot verify an older root-level install whose sha matches nothing', () => {
    // After `update`, root-level manifests hold a commit SHA, indistinguishable
    // offline from the blob SHA of an edited SKILL.md.
    const manifest = baseManifest({ path: '.', sha: gitBlobSha(join(dir, 'SKILL.md')) });
    writeFileSync(join(dir, 'SKILL.md'), '# Demo\n\nMy local tweak\n');
    expect(getLocalEditStatus(dir, manifest)).toBe('unknown');

    const commitShaManifest = baseManifest({ path: '.', sha: 'c'.repeat(40) });
    expect(getLocalEditStatus(dir, commitShaManifest)).toBe('unknown');
  });

  it('treats an unreadable skill directory as modified', () => {
    const manifest = baseManifest({ contentSha: computeTreeSha(dir) });
    rmSync(dir, { recursive: true, force: true });
    expect(getLocalEditStatus(dir, manifest)).toBe('modified');
  });
});
