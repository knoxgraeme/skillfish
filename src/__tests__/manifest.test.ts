/**
 * Tests for manifest handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import {
  readManifest,
  writeManifest,
  hasManifest,
  MANIFEST_FILENAME,
  MANIFEST_VERSION,
  type SkillManifest,
} from '../lib/manifest.js';

describe('manifest', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skillfish-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('writeManifest', () => {
    it('writes valid manifest JSON', () => {
      const manifest: SkillManifest = {
        version: MANIFEST_VERSION,
        owner: 'test-owner',
        repo: 'test-repo',
        path: 'skills/test-skill',
        branch: 'main',
        sha: 'abc123def456',
      };

      writeManifest(testDir, manifest);

      const content = readFileSync(join(testDir, MANIFEST_FILENAME), 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed).toEqual(manifest);
    });

    it('formats JSON with 2-space indentation', () => {
      const manifest: SkillManifest = {
        version: MANIFEST_VERSION,
        owner: 'test',
        repo: 'repo',
        path: '.',
        branch: 'main',
        sha: 'abc',
      };

      writeManifest(testDir, manifest);

      const content = readFileSync(join(testDir, MANIFEST_FILENAME), 'utf-8');
      expect(content).toContain('\n  "version"');
    });
  });

  describe('readManifest', () => {
    it('reads valid manifest', () => {
      const manifest: SkillManifest = {
        version: MANIFEST_VERSION,
        owner: 'anthropics',
        repo: 'claude-code-skills',
        path: 'skills/commit-message',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(manifest));

      const result = readManifest(testDir);

      expect(result).toEqual(manifest);
    });

    it('returns null for missing manifest', () => {
      const result = readManifest(testDir);

      expect(result).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      writeFileSync(join(testDir, MANIFEST_FILENAME), 'not json');

      const result = readManifest(testDir);

      expect(result).toBeNull();
    });

    it('returns null for manifest with wrong version', () => {
      const invalidManifest = {
        version: 999,
        owner: 'test',
        repo: 'test',
        path: '.',
        branch: 'main',
        sha: 'abc',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(invalidManifest));

      const result = readManifest(testDir);

      expect(result).toBeNull();
    });

    it('returns null for manifest missing required fields', () => {
      const incompleteManifest = {
        version: MANIFEST_VERSION,
        owner: 'test',
        // missing repo, path, branch, sha
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(incompleteManifest));

      const result = readManifest(testDir);

      expect(result).toBeNull();
    });

    it('returns null for manifest with wrong field types', () => {
      const invalidManifest = {
        version: MANIFEST_VERSION,
        owner: 123, // should be string
        repo: 'test',
        path: '.',
        branch: 'main',
        sha: 'abc',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(invalidManifest));

      const result = readManifest(testDir);

      expect(result).toBeNull();
    });

    it('returns null for manifest with invalid SHA format', () => {
      const invalidManifest = {
        version: MANIFEST_VERSION,
        owner: 'test-owner',
        repo: 'test-repo',
        path: '.',
        branch: 'main',
        sha: 'not-a-valid-sha', // must be 40 hex chars
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(invalidManifest));

      const result = readManifest(testDir);

      expect(result).toBeNull();
    });

    it('returns null for manifest with path traversal', () => {
      const invalidManifest = {
        version: MANIFEST_VERSION,
        owner: 'test-owner',
        repo: 'test-repo',
        path: '../../../etc/passwd',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(invalidManifest));

      const result = readManifest(testDir);

      expect(result).toBeNull();
    });

    it('returns null for manifest with invalid owner name', () => {
      const invalidManifest = {
        version: MANIFEST_VERSION,
        owner: 'test;rm -rf /',
        repo: 'test-repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(invalidManifest));

      const result = readManifest(testDir);

      expect(result).toBeNull();
    });

    it('returns null for manifest with invalid branch name', () => {
      const invalidManifest = {
        version: MANIFEST_VERSION,
        owner: 'test-owner',
        repo: 'test-repo',
        path: '.',
        branch: 'main; echo pwned',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(invalidManifest));

      const result = readManifest(testDir);

      expect(result).toBeNull();
    });

    it('accepts valid manifest with complex branch name', () => {
      const validManifest = {
        version: MANIFEST_VERSION,
        owner: 'test-owner',
        repo: 'test-repo',
        path: 'skills/my-skill',
        branch: 'feature/add-new-skill_v2.0',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(validManifest));

      const result = readManifest(testDir);

      expect(result).toEqual(validManifest);
    });
  });

  describe('hasManifest', () => {
    it('returns true when manifest exists', () => {
      writeFileSync(join(testDir, MANIFEST_FILENAME), '{}');

      expect(hasManifest(testDir)).toBe(true);
    });

    it('returns false when manifest does not exist', () => {
      expect(hasManifest(testDir)).toBe(false);
    });

    it('returns false for non-existent directory', () => {
      expect(hasManifest('/non/existent/path')).toBe(false);
    });
  });
});
