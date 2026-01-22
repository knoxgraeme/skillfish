import { describe, it, expect } from 'vitest';
import {
  isValidPath,
  isGitTreeResponse,
  parseFrontmatter,
  deriveSkillName,
  toTitleCase,
  truncate,
  extractSkillPaths,
} from '../utils.js';

describe('isValidPath', () => {
  it('accepts valid relative paths', () => {
    expect(isValidPath('skills/my-skill')).toBe(true);
    expect(isValidPath('SKILL.md')).toBe(true);
    expect(isValidPath('plugins/foo/skills/bar')).toBe(true);
    expect(isValidPath('my_skill')).toBe(true);
    expect(isValidPath('skill.v2')).toBe(true);
  });

  it('rejects absolute paths', () => {
    expect(isValidPath('/etc/passwd')).toBe(false);
    expect(isValidPath('/home/user/skills')).toBe(false);
  });

  it('rejects directory traversal attempts', () => {
    expect(isValidPath('../etc/passwd')).toBe(false);
    expect(isValidPath('skills/../../../etc/passwd')).toBe(false);
    expect(isValidPath('..\\windows\\system32')).toBe(false);
  });

  it('rejects paths with special characters', () => {
    expect(isValidPath('skill;rm -rf /')).toBe(false);
    expect(isValidPath('skill`whoami`')).toBe(false);
    expect(isValidPath('skill$(cat /etc/passwd)')).toBe(false);
    expect(isValidPath('skill|evil')).toBe(false);
  });

  it('rejects paths with double slashes', () => {
    expect(isValidPath('skills//evil')).toBe(false);
  });

  it('rejects paths starting with slash', () => {
    expect(isValidPath('/skills')).toBe(false);
  });
});

describe('isGitTreeResponse', () => {
  it('accepts valid tree response', () => {
    const validResponse = {
      tree: [
        { path: 'SKILL.md', type: 'blob' },
        { path: 'skills/foo/SKILL.md', type: 'blob' },
      ],
      sha: 'abc123',
    };
    expect(isGitTreeResponse(validResponse)).toBe(true);
  });

  it('accepts response with empty tree', () => {
    expect(isGitTreeResponse({ tree: [] })).toBe(true);
  });

  it('accepts response without tree field', () => {
    expect(isGitTreeResponse({ sha: 'abc123' })).toBe(true);
  });

  it('rejects null', () => {
    expect(isGitTreeResponse(null)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isGitTreeResponse('string')).toBe(false);
    expect(isGitTreeResponse(123)).toBe(false);
    expect(isGitTreeResponse(undefined)).toBe(false);
  });

  it('rejects tree that is not an array', () => {
    expect(isGitTreeResponse({ tree: 'not an array' })).toBe(false);
    expect(isGitTreeResponse({ tree: {} })).toBe(false);
  });

  it('rejects tree items without required fields', () => {
    expect(isGitTreeResponse({ tree: [{ path: 'test' }] })).toBe(false); // missing type
    expect(isGitTreeResponse({ tree: [{ type: 'blob' }] })).toBe(false); // missing path
    expect(isGitTreeResponse({ tree: [{ path: 123, type: 'blob' }] })).toBe(false); // path not string
  });
});

describe('parseFrontmatter', () => {
  it('parses name and description', () => {
    const content = `---
name: My Skill
description: A helpful skill
---

# Skill Content`;
    expect(parseFrontmatter(content)).toEqual({
      name: 'My Skill',
      description: 'A helpful skill',
    });
  });

  it('handles quoted values', () => {
    const content = `---
name: "Quoted Skill"
description: 'Single quoted'
---`;
    expect(parseFrontmatter(content)).toEqual({
      name: 'Quoted Skill',
      description: 'Single quoted',
    });
  });

  it('returns empty object for no frontmatter', () => {
    const content = '# Just a Heading\n\nSome content';
    expect(parseFrontmatter(content)).toEqual({});
  });

  it('handles missing fields', () => {
    const content = `---
name: Only Name
---`;
    expect(parseFrontmatter(content)).toEqual({ name: 'Only Name' });
  });

  it('handles Windows line endings', () => {
    const content = '---\r\nname: Windows Skill\r\ndescription: CRLF test\r\n---\r\n';
    expect(parseFrontmatter(content)).toEqual({
      name: 'Windows Skill',
      description: 'CRLF test',
    });
  });
});

describe('deriveSkillName', () => {
  it('returns repo name for root SKILL.md', () => {
    expect(deriveSkillName('SKILL.md', 'my-repo')).toBe('my-repo');
    expect(deriveSkillName('./SKILL.md', 'my-repo')).toBe('my-repo');
  });

  it('extracts folder name from path', () => {
    expect(deriveSkillName('skills/code-review', 'repo')).toBe('code-review');
    expect(deriveSkillName('plugins/foo/skills/bar', 'repo')).toBe('bar');
    expect(deriveSkillName('skills/my-skill/SKILL.md', 'repo')).toBe('my-skill');
  });

  it('falls back to repo name for invalid folder names', () => {
    expect(deriveSkillName('skills/bad name with spaces', 'fallback-repo')).toBe('fallback-repo');
  });
});

describe('toTitleCase', () => {
  it('converts kebab-case to Title Case', () => {
    expect(toTitleCase('skill-lookup')).toBe('Skill Lookup');
    expect(toTitleCase('my-cool-skill')).toBe('My Cool Skill');
  });

  it('converts snake_case to Title Case', () => {
    expect(toTitleCase('my_cool_skill')).toBe('My Cool Skill');
  });

  it('handles mixed separators', () => {
    expect(toTitleCase('skill-name_v2')).toBe('Skill Name V2');
  });

  it('handles single word', () => {
    expect(toTitleCase('skill')).toBe('Skill');
  });

  it('handles already capitalized', () => {
    expect(toTitleCase('SKILL')).toBe('SKILL');
  });
});

describe('truncate', () => {
  it('returns short text unchanged', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('exactly10!', 10)).toBe('exactly10!');
  });

  it('truncates long text with ellipsis', () => {
    expect(truncate('This is a long description that needs truncation', 20)).toBe('This is a long desc…');
  });

  it('trims whitespace before ellipsis', () => {
    // With maxLength=15, slice to 14, then trim, add ellipsis
    // "Word boundary " (14 chars) -> trimmed -> "Word boundary" + "…"
    expect(truncate('Word boundary test here', 15)).toBe('Word boundary…');
  });
});

describe('extractSkillPaths', () => {
  it('extracts SKILL.md paths from tree', () => {
    const response = {
      tree: [
        { path: 'README.md', type: 'blob' },
        { path: 'SKILL.md', type: 'blob' },
        { path: 'skills/foo/SKILL.md', type: 'blob' },
        { path: 'skills/bar', type: 'tree' }, // directory, not blob
        { path: 'skills/bar/SKILL.md', type: 'blob' },
      ],
    };

    const paths = extractSkillPaths(response);
    expect(paths).toEqual([
      'SKILL.md',
      'skills/foo/SKILL.md',
      'skills/bar/SKILL.md',
    ]);
  });

  it('returns empty array for empty tree', () => {
    expect(extractSkillPaths({ tree: [] })).toEqual([]);
  });

  it('returns empty array for no tree', () => {
    expect(extractSkillPaths({})).toEqual([]);
  });

  it('filters out non-blob types', () => {
    const response = {
      tree: [
        { path: 'SKILL.md', type: 'tree' }, // directory with same name
        { path: 'real/SKILL.md', type: 'blob' },
      ],
    };
    expect(extractSkillPaths(response)).toEqual(['real/SKILL.md']);
  });
});
