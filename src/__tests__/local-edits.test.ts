/**
 * Tests for local-edit detection (issue #88).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import {
  hashSkillDir,
  isSkillModified,
  readManifest,
  writeManifest,
  MANIFEST_VERSION,
  type SkillManifest,
} from '../lib/manifest.js';

describe('local edit detection', () => {
  let dir: string;
  const base = (contentHash?: string): SkillManifest => ({
    version: MANIFEST_VERSION,
    name: 'pdf',
    owner: 'o',
    repo: 'r',
    path: 'skills/pdf',
    branch: 'main',
    sha: 'a'.repeat(40),
    ...(contentHash ? { contentHash } : {}),
  });

  beforeEach(() => {
    dir = join(tmpdir(), `skillfish-test-${randomUUID()}`);
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), 'hello');
    writeFileSync(join(dir, 'sub', 'a.txt'), 'a');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('hash ignores the manifest file itself', () => {
    const h = hashSkillDir(dir);
    writeManifest(dir, base(h));
    expect(hashSkillDir(dir)).toBe(h);
  });

  it('is unmodified right after install', () => {
    const m = base(hashSkillDir(dir));
    writeManifest(dir, m);
    expect(isSkillModified(dir, readManifest(dir))).toBe(false);
  });

  it('detects edited, added and removed files', () => {
    const m = base(hashSkillDir(dir));
    appendFileSync(join(dir, 'SKILL.md'), ' my rule');
    expect(isSkillModified(dir, m)).toBe(true);
    rmSync(join(dir, 'SKILL.md'));
    writeFileSync(join(dir, 'SKILL.md'), 'hello');
    expect(isSkillModified(dir, m)).toBe(false);
    writeFileSync(join(dir, 'new.md'), 'x');
    expect(isSkillModified(dir, m)).toBe(true);
  });

  it('treats skills without a contentHash as unmodified', () => {
    appendFileSync(join(dir, 'SKILL.md'), ' edit');
    expect(isSkillModified(dir, base())).toBe(false);
    expect(isSkillModified(dir, null)).toBe(false);
  });

  it('rejects a malformed contentHash in the manifest', () => {
    writeManifest(dir, { ...base(), contentHash: 'nothex' });
    expect(readManifest(dir)).toBeNull();
  });
});
