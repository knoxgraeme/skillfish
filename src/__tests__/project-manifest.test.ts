import { describe, it, expect } from 'vitest';
import {
  parseSkillEntry,
  deriveSkillDirName,
  formatSkillEntry,
  detectCollisions,
  parseAllEntries,
  type ParsedSkillEntry,
  type ProjectManifest,
} from '../lib/project-manifest.js';

describe('parseSkillEntry', () => {
  it('parses owner/repo format', () => {
    const result = parseSkillEntry('owner/repo');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.entry.owner).toBe('owner');
      expect(result.entry.repo).toBe('repo');
      expect(result.entry.ref).toBeUndefined();
      expect(result.entry.path).toBeUndefined();
    }
  });

  it('parses owner/repo@ref format', () => {
    const result = parseSkillEntry('owner/repo@v1.0.0');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.entry.owner).toBe('owner');
      expect(result.entry.repo).toBe('repo');
      expect(result.entry.ref).toBe('v1.0.0');
      expect(result.entry.path).toBeUndefined();
    }
  });

  it('parses owner/repo@ref/path format', () => {
    const result = parseSkillEntry('owner/repo@v2.0.0/plugins/my-skill');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.entry.owner).toBe('owner');
      expect(result.entry.repo).toBe('repo');
      expect(result.entry.ref).toBe('v2.0.0');
      expect(result.entry.path).toBe('plugins/my-skill');
    }
  });

  it('parses owner/repo/path format (no ref)', () => {
    const result = parseSkillEntry('owner/repo/skills/my-skill');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.entry.owner).toBe('owner');
      expect(result.entry.repo).toBe('repo');
      expect(result.entry.ref).toBeUndefined();
      expect(result.entry.path).toBe('skills/my-skill');
    }
  });

  it('parses ref with path (first slash after @ separates ref from path)', () => {
    // Note: When using @ref/path, the first slash separates ref from path
    // For branch names with slashes, don't include a path component
    const result = parseSkillEntry('owner/repo@v1.0.0/plugins/skill');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.entry.ref).toBe('v1.0.0');
      expect(result.entry.path).toBe('plugins/skill');
    }
  });

  it('parses ref without path (entire part after @ is ref)', () => {
    const result = parseSkillEntry('owner/repo@feature-branch');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.entry.ref).toBe('feature-branch');
      expect(result.entry.path).toBeUndefined();
    }
  });

  it('parses commit SHA refs', () => {
    const result = parseSkillEntry('owner/repo@abc123f');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.entry.ref).toBe('abc123f');
    }
  });

  it('rejects empty entry', () => {
    const result = parseSkillEntry('');
    expect(result.success).toBe(false);
  });

  it('rejects missing owner/repo format', () => {
    const result = parseSkillEntry('just-a-name');
    expect(result.success).toBe(false);
  });

  it('rejects invalid owner name', () => {
    const result = parseSkillEntry('invalid owner/repo');
    expect(result.success).toBe(false);
  });

  it('rejects invalid repo name', () => {
    const result = parseSkillEntry('owner/invalid repo');
    expect(result.success).toBe(false);
  });

  it('rejects directory traversal in path', () => {
    const result = parseSkillEntry('owner/repo@main/../../../etc/passwd');
    expect(result.success).toBe(false);
  });
});

describe('deriveSkillDirName', () => {
  it('uses repo name for root skills', () => {
    const entry: ParsedSkillEntry = {
      owner: 'owner',
      repo: 'my-skill',
      original: 'owner/my-skill',
    };
    expect(deriveSkillDirName(entry)).toBe('my-skill');
  });

  it('uses last path component for subdirectory skills', () => {
    const entry: ParsedSkillEntry = {
      owner: 'owner',
      repo: 'repo',
      path: 'plugins/my-skill',
      original: 'owner/repo/plugins/my-skill',
    };
    expect(deriveSkillDirName(entry)).toBe('my-skill');
  });

  it('handles deep paths', () => {
    const entry: ParsedSkillEntry = {
      owner: 'owner',
      repo: 'repo',
      path: 'a/b/c/d/skill-name',
      original: 'owner/repo/a/b/c/d/skill-name',
    };
    expect(deriveSkillDirName(entry)).toBe('skill-name');
  });

  it('throws for invalid derived skill name', () => {
    const entry: ParsedSkillEntry = {
      owner: 'owner',
      repo: 'repo',
      path: 'plugins/invalid name with spaces',
      original: 'owner/repo/plugins/invalid name with spaces',
    };
    expect(() => deriveSkillDirName(entry)).toThrow('Invalid skill name');
  });
});

describe('formatSkillEntry', () => {
  it('formats owner/repo', () => {
    const entry: ParsedSkillEntry = {
      owner: 'owner',
      repo: 'repo',
      original: '',
    };
    expect(formatSkillEntry(entry)).toBe('owner/repo');
  });

  it('formats owner/repo@ref', () => {
    const entry: ParsedSkillEntry = {
      owner: 'owner',
      repo: 'repo',
      ref: 'v1.0.0',
      original: '',
    };
    expect(formatSkillEntry(entry)).toBe('owner/repo@v1.0.0');
  });

  it('formats owner/repo@ref/path', () => {
    const entry: ParsedSkillEntry = {
      owner: 'owner',
      repo: 'repo',
      ref: 'v1.0.0',
      path: 'plugins/skill',
      original: '',
    };
    expect(formatSkillEntry(entry)).toBe('owner/repo@v1.0.0/plugins/skill');
  });

  it('formats owner/repo/path (no ref)', () => {
    const entry: ParsedSkillEntry = {
      owner: 'owner',
      repo: 'repo',
      path: 'plugins/skill',
      original: '',
    };
    expect(formatSkillEntry(entry)).toBe('owner/repo/plugins/skill');
  });
});

describe('detectCollisions', () => {
  it('returns empty for unique skill names', () => {
    const entries = ['owner/skill-a', 'owner/skill-b', 'other/skill-c'];
    expect(detectCollisions(entries)).toEqual([]);
  });

  it('detects collision from same repo name', () => {
    const entries = ['owner-a/my-skill', 'owner-b/my-skill'];
    const collisions = detectCollisions(entries);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].name).toBe('my-skill');
    expect(collisions[0].entry1).toBe('owner-a/my-skill');
    expect(collisions[0].entry2).toBe('owner-b/my-skill');
  });

  it('detects collision from path basename matching repo name', () => {
    const entries = ['owner/my-skill', 'other/repo/plugins/my-skill'];
    const collisions = detectCollisions(entries);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].name).toBe('my-skill');
  });

  it('handles multiple collisions', () => {
    const entries = ['a/skill-1', 'b/skill-1', 'c/skill-2', 'd/skill-2'];
    const collisions = detectCollisions(entries);
    expect(collisions).toHaveLength(2);
  });

  it('ignores invalid entries', () => {
    const entries = ['valid/entry', 'invalid-entry', 'also-valid/entry-2'];
    const collisions = detectCollisions(entries);
    expect(collisions).toEqual([]);
  });
});

describe('parseAllEntries', () => {
  it('parses valid entries', () => {
    const manifest: ProjectManifest = {
      version: 1,
      skills: ['owner/repo', 'other/skill@v1.0.0'],
    };
    const { entries, errors } = parseAllEntries(manifest);
    expect(entries).toHaveLength(2);
    expect(errors).toHaveLength(0);
  });

  it('reports errors for invalid entries', () => {
    const manifest: ProjectManifest = {
      version: 1,
      skills: ['valid/entry', 'invalid', 'also-valid/entry'],
    };
    const { entries, errors } = parseAllEntries(manifest);
    expect(entries).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('invalid');
  });

  it('handles empty skills array', () => {
    const manifest: ProjectManifest = {
      version: 1,
      skills: [],
    };
    const { entries, errors } = parseAllEntries(manifest);
    expect(entries).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

describe('ref change detection (for install command logic)', () => {
  // These tests verify the ref comparison logic used in install.ts
  // The comparison is: existingRef !== newRef

  // Helper to simulate ref comparison as done in install.ts
  function shouldReinstall(existingRef: string | undefined, newRef: string | undefined): boolean {
    return existingRef !== newRef;
  }

  it('detects ref change from undefined to defined', () => {
    expect(shouldReinstall(undefined, 'v1.0.0')).toBe(true); // Should trigger reinstall
  });

  it('detects ref change from defined to undefined', () => {
    expect(shouldReinstall('v1.0.0', undefined)).toBe(true); // Should trigger reinstall
  });

  it('detects ref change between different versions', () => {
    expect(shouldReinstall('v1.0.0', 'v2.0.0')).toBe(true); // Should trigger reinstall
  });

  it('skips when refs are identical', () => {
    expect(shouldReinstall('v1.0.0', 'v1.0.0')).toBe(false); // Should skip
  });

  it('skips when both refs are undefined', () => {
    expect(shouldReinstall(undefined, undefined)).toBe(false); // Should skip
  });

  it('preserves ref through parse/format roundtrip', () => {
    const original = 'owner/repo@v1.2.3';
    const result = parseSkillEntry(original);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.entry.ref).toBe('v1.2.3');
      expect(formatSkillEntry(result.entry)).toBe(original);
    }
  });

  it('preserves undefined ref through parse/format roundtrip', () => {
    const original = 'owner/repo';
    const result = parseSkillEntry(original);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.entry.ref).toBeUndefined();
      expect(formatSkillEntry(result.entry)).toBe(original);
    }
  });

  it('handles semver-style refs', () => {
    const refs = ['v1.0.0', 'v2.0.0-beta.1', 'v1.0.0-rc.1'];
    for (const ref of refs) {
      const result = parseSkillEntry(`owner/repo@${ref}`);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.entry.ref).toBe(ref);
      }
    }
  });

  it('handles branch-style refs', () => {
    const refs = ['main', 'develop', 'feature-branch', 'release-1.0'];
    for (const ref of refs) {
      const result = parseSkillEntry(`owner/repo@${ref}`);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.entry.ref).toBe(ref);
      }
    }
  });

  it('handles commit SHA refs (short and full)', () => {
    const shortSha = 'abc123f';
    const fullSha = 'abc123def456abc123def456abc123def456abc1';

    const shortResult = parseSkillEntry(`owner/repo@${shortSha}`);
    expect(shortResult.success).toBe(true);
    if (shortResult.success) {
      expect(shortResult.entry.ref).toBe(shortSha);
    }

    const fullResult = parseSkillEntry(`owner/repo@${fullSha}`);
    expect(fullResult.success).toBe(true);
    if (fullResult.success) {
      expect(fullResult.entry.ref).toBe(fullSha);
    }
  });
});
