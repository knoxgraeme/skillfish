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
  healManifest,
  getManifestKey,
  buildManifestKey,
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
        name: 'test-skill',
        owner: 'test-owner',
        repo: 'test-repo',
        path: 'skills/test-skill',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeManifest(testDir, manifest);

      const content = readFileSync(join(testDir, MANIFEST_FILENAME), 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed).toEqual(manifest);
    });

    it('formats JSON with 2-space indentation', () => {
      const manifest: SkillManifest = {
        version: MANIFEST_VERSION,
        name: 'repo',
        owner: 'test',
        repo: 'repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeManifest(testDir, manifest);

      const content = readFileSync(join(testDir, MANIFEST_FILENAME), 'utf-8');
      expect(content).toContain('\n  "version"');
    });
  });

  describe('readManifest', () => {
    it('reads valid v2 manifest with name', () => {
      const manifest: SkillManifest = {
        version: MANIFEST_VERSION,
        name: 'commit-message',
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

    it('reads valid v1 manifest without name (backwards compatible)', () => {
      const v1Manifest = {
        version: 1,
        owner: 'anthropics',
        repo: 'claude-code-skills',
        path: 'skills/commit-message',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(v1Manifest));

      const result = readManifest(testDir);

      expect(result).not.toBeNull();
      expect(result!.owner).toBe('anthropics');
      expect(result!.name).toBeUndefined(); // v1 doesn't have name
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

    it('returns null for manifest with unsupported version', () => {
      const invalidManifest = {
        version: 999,
        owner: 'test',
        repo: 'test',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
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
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
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

    it('returns null for manifest with invalid name', () => {
      const invalidManifest = {
        version: MANIFEST_VERSION,
        name: 'invalid name with spaces',
        owner: 'test-owner',
        repo: 'test-repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(invalidManifest));

      const result = readManifest(testDir);

      expect(result).toBeNull();
    });

    it('accepts valid manifest with complex branch name', () => {
      const validManifest = {
        version: MANIFEST_VERSION,
        name: 'my-skill',
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

  describe('healManifest', () => {
    it('returns null for non-existent manifest', () => {
      const result = healManifest(testDir);
      expect(result).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      writeFileSync(join(testDir, MANIFEST_FILENAME), 'not json');

      const result = healManifest(testDir);
      expect(result).toBeNull();
    });

    it('returns null for manifest missing required fields', () => {
      const incompleteManifest = {
        version: 1,
        owner: 'test',
        // missing repo, path, branch, sha
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(incompleteManifest));

      const result = healManifest(testDir);
      expect(result).toBeNull();
    });

    it('returns null for manifest with invalid owner', () => {
      const invalidManifest = {
        version: 1,
        owner: 'test;rm -rf /',
        repo: 'test-repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(invalidManifest));

      const result = healManifest(testDir);
      expect(result).toBeNull();
    });

    it('returns null for manifest with path traversal', () => {
      const invalidManifest = {
        version: 1,
        owner: 'test-owner',
        repo: 'test-repo',
        path: '../../../etc/passwd',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(invalidManifest));

      const result = healManifest(testDir);
      expect(result).toBeNull();
    });

    it('upgrades v1 manifest to v2 and adds name from directory', () => {
      const v1Manifest = {
        version: 1,
        owner: 'test-owner',
        repo: 'test-repo',
        path: 'skills/my-skill',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(v1Manifest));

      const result = healManifest(testDir);

      expect(result).not.toBeNull();
      expect(result!.version).toBe(MANIFEST_VERSION); // Upgraded to v2
      // Name is derived from directory basename (testDir in this case)
      expect(result!.name).toBeDefined();
      expect(result!.owner).toBe('test-owner');
      expect(result!.repo).toBe('test-repo');
    });

    it('heals manifest with old source string format', () => {
      // Old format used full source strings like "github:owner/repo/path#branch"
      const oldFormatManifest = {
        version: 1,
        owner: 'test-owner',
        repo: 'test-repo',
        path: 'skills/my-skill',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
        source: 'github:test-owner/test-repo/skills/my-skill#main',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(oldFormatManifest));

      const result = healManifest(testDir);

      expect(result).not.toBeNull();
      expect(result!.source).toBe('manual'); // Old format gets healed to 'manual'
      expect(result!.version).toBe(MANIFEST_VERSION); // Upgraded to v2
      expect(result!.name).toBeDefined(); // Name added
      expect(result!.owner).toBe('test-owner');
      expect(result!.repo).toBe('test-repo');
    });

    it('preserves valid source field', () => {
      const validManifest = {
        version: 1,
        owner: 'test-owner',
        repo: 'test-repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
        source: 'manifest',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(validManifest));

      const result = healManifest(testDir);

      expect(result).not.toBeNull();
      expect(result!.source).toBe('manifest');
    });

    it('preserves valid ref field', () => {
      const manifestWithRef = {
        version: 1,
        owner: 'test-owner',
        repo: 'test-repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
        ref: 'v1.0.0',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(manifestWithRef));

      const result = healManifest(testDir);

      expect(result).not.toBeNull();
      expect(result!.ref).toBe('v1.0.0');
    });

    it('preserves existing valid name field', () => {
      const manifestWithName = {
        version: MANIFEST_VERSION,
        name: 'my-custom-name',
        owner: 'test-owner',
        repo: 'test-repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(manifestWithName));

      const result = healManifest(testDir);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('my-custom-name');
    });

    it('drops invalid ref field during healing', () => {
      const manifestWithInvalidRef = {
        version: 1,
        owner: 'test-owner',
        repo: 'test-repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
        ref: 'v1.0.0; rm -rf /', // Invalid: contains shell metacharacters
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(manifestWithInvalidRef));

      const result = healManifest(testDir);

      expect(result).not.toBeNull();
      expect(result!.ref).toBeUndefined(); // Invalid ref should be dropped
    });

    it('rewrites healed manifest atomically', () => {
      const oldFormatManifest = {
        version: 1,
        owner: 'test-owner',
        repo: 'test-repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
        source: 'github:test-owner/test-repo#main', // Old format
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(oldFormatManifest));

      healManifest(testDir);

      // Read the file back and verify it was rewritten
      const content = readFileSync(join(testDir, MANIFEST_FILENAME), 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.source).toBe('manual');
      expect(parsed.version).toBe(MANIFEST_VERSION);
      expect(parsed.name).toBeDefined(); // Name added during heal
    });

    it('returns already valid v2 manifest with same values', () => {
      const validManifest: SkillManifest = {
        version: MANIFEST_VERSION,
        name: 'test-skill',
        owner: 'test-owner',
        repo: 'test-repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
        source: 'manual',
        ref: 'v2.0.0',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(validManifest));

      const result = healManifest(testDir);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('test-skill');
      expect(result!.source).toBe('manual');
      expect(result!.ref).toBe('v2.0.0');
    });
  });

  describe('getManifestKey', () => {
    it('builds key from manifest fields', () => {
      const manifest: SkillManifest = {
        version: MANIFEST_VERSION,
        name: 'my-skill',
        owner: 'test-owner',
        repo: 'test-repo',
        path: 'skills/my-skill',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      expect(getManifestKey(manifest)).toBe('test-owner/test-repo/skills/my-skill');
    });

    it('uses "." path for root skills', () => {
      const manifest: SkillManifest = {
        version: MANIFEST_VERSION,
        name: 'test-repo',
        owner: 'test-owner',
        repo: 'test-repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      expect(getManifestKey(manifest)).toBe('test-owner/test-repo/.');
    });
  });

  describe('buildManifestKey', () => {
    it('builds key from components', () => {
      expect(buildManifestKey('owner', 'repo', 'skills/my-skill')).toBe(
        'owner/repo/skills/my-skill',
      );
    });

    it('defaults path to "." when undefined', () => {
      expect(buildManifestKey('owner', 'repo')).toBe('owner/repo/.');
    });

    it('defaults path to "." when explicitly undefined', () => {
      expect(buildManifestKey('owner', 'repo', undefined)).toBe('owner/repo/.');
    });
  });

  describe('provider field', () => {
    it('reads manifest with provider field', () => {
      const manifest = {
        version: MANIFEST_VERSION,
        name: 'test-skill',
        provider: 'gitlab',
        owner: 'test-owner',
        repo: 'test-repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(manifest));

      const result = readManifest(testDir);

      expect(result).not.toBeNull();
      expect(result!.provider).toBe('gitlab');
    });

    it('reads manifest without provider field (backwards compatible)', () => {
      const manifest = {
        version: MANIFEST_VERSION,
        name: 'test-skill',
        owner: 'test-owner',
        repo: 'test-repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(manifest));

      const result = readManifest(testDir);

      expect(result).not.toBeNull();
      expect(result!.provider).toBeUndefined();
    });

    it('rejects manifest with invalid provider value', () => {
      const manifest = {
        version: MANIFEST_VERSION,
        name: 'test-skill',
        provider: 'gitlab; rm -rf /', // contains spaces and shell metacharacters
        owner: 'test-owner',
        repo: 'test-repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(manifest));

      const result = readManifest(testDir);

      expect(result).toBeNull();
    });

    it('healManifest preserves provider field', () => {
      const manifest = {
        version: 1,
        provider: 'gitlab',
        owner: 'test-owner',
        repo: 'test-repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(manifest));

      const result = healManifest(testDir);

      expect(result).not.toBeNull();
      expect(result!.provider).toBe('gitlab');
    });

    it('healManifest drops invalid provider field', () => {
      const manifest = {
        version: 1,
        provider: 'gitlab; rm -rf /',
        owner: 'test-owner',
        repo: 'test-repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeFileSync(join(testDir, MANIFEST_FILENAME), JSON.stringify(manifest));

      const result = healManifest(testDir);

      expect(result).not.toBeNull();
      expect(result!.provider).toBeUndefined();
    });

    it('writeManifest round-trips provider field', () => {
      const manifest: SkillManifest = {
        version: MANIFEST_VERSION,
        name: 'test-skill',
        provider: 'bitbucket',
        owner: 'test-owner',
        repo: 'test-repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };

      writeManifest(testDir, manifest);

      const result = readManifest(testDir);

      expect(result).not.toBeNull();
      expect(result!.provider).toBe('bitbucket');
    });
  });

  describe('key matching between entry and manifest', () => {
    // These tests verify that keys built from parsed skillfish.json entries
    // match keys built from per-skill manifests - critical for removal logic

    it('root-level skill: entry path undefined matches manifest path "."', () => {
      // Entry from skillfish.json: "owner/repo" → path: undefined
      const entryKey = buildManifestKey('owner', 'repo', undefined);

      // Per-skill manifest has path: "."
      const manifest: SkillManifest = {
        version: MANIFEST_VERSION,
        name: 'repo',
        owner: 'owner',
        repo: 'repo',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };
      const manifestKey = getManifestKey(manifest);

      expect(entryKey).toBe(manifestKey);
      expect(entryKey).toBe('owner/repo/.');
    });

    it('subdirectory skill: entry path matches manifest path', () => {
      // Entry from skillfish.json: "owner/repo/skills/my-skill" → path: "skills/my-skill"
      const entryKey = buildManifestKey('owner', 'repo', 'skills/my-skill');

      // Per-skill manifest has same path
      const manifest: SkillManifest = {
        version: MANIFEST_VERSION,
        name: 'my-skill',
        owner: 'owner',
        repo: 'repo',
        path: 'skills/my-skill',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
      };
      const manifestKey = getManifestKey(manifest);

      expect(entryKey).toBe(manifestKey);
      expect(entryKey).toBe('owner/repo/skills/my-skill');
    });

    it('removal detection: skill NOT in manifest should be flagged', () => {
      // Simulates the install command's removal logic
      const manifestKeys = new Set([
        buildManifestKey('owner', 'other-repo', undefined), // "owner/other-repo/."
      ]);

      const installedManifest: SkillManifest = {
        version: MANIFEST_VERSION,
        name: 'my-skill',
        owner: 'owner',
        repo: 'my-skill',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
        source: 'manifest',
      };
      const installedKey = getManifestKey(installedManifest);

      // This skill should be flagged for removal because its key is not in manifestKeys
      const shouldRemove =
        installedManifest.source === 'manifest' && !manifestKeys.has(installedKey);

      expect(shouldRemove).toBe(true);
    });

    it('removal detection: skill IN manifest should NOT be flagged', () => {
      // Simulates the install command's removal logic
      const manifestKeys = new Set([
        buildManifestKey('owner', 'my-skill', undefined), // "owner/my-skill/."
      ]);

      const installedManifest: SkillManifest = {
        version: MANIFEST_VERSION,
        name: 'my-skill',
        owner: 'owner',
        repo: 'my-skill',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
        source: 'manifest',
      };
      const installedKey = getManifestKey(installedManifest);

      // This skill should NOT be flagged for removal because its key is in manifestKeys
      const shouldRemove =
        installedManifest.source === 'manifest' && !manifestKeys.has(installedKey);

      expect(shouldRemove).toBe(false);
    });

    it('removal detection: manual source should NOT be flagged', () => {
      // Skills installed via `skillfish add` have source: undefined (defaults to 'manual')
      const manifestKeys = new Set<string>(); // Empty manifest

      const installedManifest: SkillManifest = {
        version: MANIFEST_VERSION,
        name: 'my-skill',
        owner: 'owner',
        repo: 'my-skill',
        path: '.',
        branch: 'main',
        sha: 'fc6274d15fa3ae2ab983129fb037999f264ba9a7',
        // source: undefined → defaults to 'manual'
      };
      const installedKey = getManifestKey(installedManifest);
      const source = installedManifest.source ?? 'manual';

      // Manual skills should NOT be flagged for removal
      const shouldRemove = source === 'manifest' && !manifestKeys.has(installedKey);

      expect(shouldRemove).toBe(false);
    });
  });
});
