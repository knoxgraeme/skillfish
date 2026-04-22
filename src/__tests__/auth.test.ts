/**
 * Tests for GitHub authentication token resolution.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getGitHubToken, hasGitHubToken, resetGitHubTokenCache } from '../lib/auth.js';

// Mock child_process so we don't shell out to `gh` in tests
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'child_process';
const mockExecFileSync = vi.mocked(execFileSync);

describe('getGitHubToken', () => {
  beforeEach(() => {
    resetGitHubTokenCache();
    process.env.SKILLFISH_GITHUB_TOKEN = '';
    process.env.GITHUB_TOKEN = '';
    process.env.GH_TOKEN = '';
    mockExecFileSync.mockReset();
  });

  afterEach(() => {
    process.env.SKILLFISH_GITHUB_TOKEN = '';
    process.env.GITHUB_TOKEN = '';
    process.env.GH_TOKEN = '';
  });

  it('returns undefined when no token is available', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('gh not found');
    });
    expect(getGitHubToken()).toBeUndefined();
  });

  it('reads SKILLFISH_GITHUB_TOKEN first', () => {
    process.env.SKILLFISH_GITHUB_TOKEN = 'skillfish-tok';
    process.env.GITHUB_TOKEN = 'github-tok';
    process.env.GH_TOKEN = 'gh-tok';
    expect(getGitHubToken()).toBe('skillfish-tok');
  });

  it('falls back to GITHUB_TOKEN when SKILLFISH_GITHUB_TOKEN is unset', () => {
    process.env.GITHUB_TOKEN = 'github-tok';
    process.env.GH_TOKEN = 'gh-tok';
    expect(getGitHubToken()).toBe('github-tok');
  });

  it('falls back to GH_TOKEN when GITHUB_TOKEN is unset', () => {
    process.env.GH_TOKEN = 'gh-tok';
    expect(getGitHubToken()).toBe('gh-tok');
  });

  it('treats empty string env vars as unset', () => {
    process.env.GITHUB_TOKEN = '   ';
    mockExecFileSync.mockImplementation(() => {
      throw new Error('gh not found');
    });
    expect(getGitHubToken()).toBeUndefined();
  });

  it('falls back to gh auth token when no env vars are set', () => {
    mockExecFileSync.mockReturnValue(Buffer.from('gh-cli-token\n'));
    expect(getGitHubToken()).toBe('gh-cli-token');
  });

  it('returns undefined when gh auth token returns empty string', () => {
    mockExecFileSync.mockReturnValue(Buffer.from('  \n'));
    expect(getGitHubToken()).toBeUndefined();
  });

  it('returns undefined when gh is not installed', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(getGitHubToken()).toBeUndefined();
  });

  it('caches the resolved token across calls', () => {
    process.env.GITHUB_TOKEN = 'cached-tok';
    getGitHubToken();
    process.env.GITHUB_TOKEN = '';
    // Still returns the cached value
    expect(getGitHubToken()).toBe('cached-tok');
  });

  it('resetGitHubTokenCache clears the cache', () => {
    process.env.GITHUB_TOKEN = 'first-tok';
    getGitHubToken();
    resetGitHubTokenCache();
    process.env.GITHUB_TOKEN = '';
    mockExecFileSync.mockImplementation(() => {
      throw new Error('gh not found');
    });
    expect(getGitHubToken()).toBeUndefined();
  });
});

describe('hasGitHubToken', () => {
  beforeEach(() => {
    resetGitHubTokenCache();
    process.env.GITHUB_TOKEN = '';
    mockExecFileSync.mockReset();
  });

  afterEach(() => {
    process.env.GITHUB_TOKEN = '';
  });

  it('returns true when a token is present', () => {
    process.env.GITHUB_TOKEN = 'some-token';
    expect(hasGitHubToken()).toBe(true);
  });

  it('returns false when no token is available', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('gh not found');
    });
    expect(hasGitHubToken()).toBe(false);
  });
});
