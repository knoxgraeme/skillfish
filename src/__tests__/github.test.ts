/**
 * Tests for GitHub API error handling.
 * Uses mocked fetch to test error paths without network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  findAllSkillMdFiles,
  fetchRecursiveTree,
  getSkillSha,
  RateLimitError,
  RepoNotFoundError,
  NetworkError,
  GitHubApiError,
} from '../lib/github.js';
import { fetchWithRetry } from '../lib/http.js';
import type { GitTreeItem } from '../utils.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock sleep to speed up tests
vi.mock('../utils.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../utils.js')>();
  return {
    ...original,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock auth module so tests control token availability
vi.mock('../lib/auth.js', () => ({
  getGitHubToken: vi.fn(),
  hasGitHubToken: vi.fn(),
  resetGitHubTokenCache: vi.fn(),
}));

import { getGitHubToken, hasGitHubToken } from '../lib/auth.js';
const mockGetGitHubToken = vi.mocked(getGitHubToken);
const mockHasGitHubToken = vi.mocked(hasGitHubToken);

describe('fetchWithRetry', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockGetGitHubToken.mockReturnValue(undefined);
    mockHasGitHubToken.mockReturnValue(false);
  });

  it('returns response on successful fetch', async () => {
    const mockResponse = new Response('ok', { status: 200 });
    mockFetch.mockResolvedValueOnce(mockResponse);

    const res = await fetchWithRetry('https://api.example.com', {});

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry on 4xx client errors', async () => {
    const mockResponse = new Response('not found', { status: 404 });
    mockFetch.mockResolvedValueOnce(mockResponse);

    const res = await fetchWithRetry('https://api.example.com', {});

    expect(res.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx server errors with exponential backoff', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockResolvedValueOnce(new Response('error', { status: 502 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const res = await fetchWithRetry('https://api.example.com', {}, 3);

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('retries on network errors', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const res = await fetchWithRetry('https://api.example.com', {}, 2);

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries exceeded on server errors', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockResolvedValueOnce(new Response('error', { status: 500 }));

    // When all retries return 500, it returns the last response
    const res = await fetchWithRetry('https://api.example.com', {}, 3);
    expect(res.status).toBe(500);
  });

  it('throws after max retries exceeded on network errors', async () => {
    const networkError = new Error('Connection refused');
    mockFetch
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError);

    await expect(fetchWithRetry('https://api.example.com', {}, 3)).rejects.toThrow(
      'Connection refused',
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

describe('findAllSkillMdFiles', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockGetGitHubToken.mockReturnValue(undefined);
    mockHasGitHubToken.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns skill paths on successful API response', async () => {
    const repoResponse = { default_branch: 'main' };
    const treeResponse = {
      sha: 'a'.repeat(40), // Valid 40-char hex SHA
      tree: [
        { path: 'SKILL.md', type: 'blob' },
        { path: 'skills/foo/SKILL.md', type: 'blob' },
        { path: 'README.md', type: 'blob' },
      ],
    };
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(repoResponse), { status: 200 })) // repo metadata
      .mockResolvedValueOnce(new Response(JSON.stringify(treeResponse), { status: 200 })); // tree

    const result = await findAllSkillMdFiles('owner', 'repo');

    expect(result.paths).toEqual(['SKILL.md', 'skills/foo/SKILL.md']);
    expect(result.branch).toBe('main');
  });

  it('throws RateLimitError when rate limited on repo fetch', async () => {
    const resetTime = Math.floor(Date.now() / 1000) + 3600;
    const headers = new Headers({
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(resetTime),
    });
    mockFetch.mockResolvedValueOnce(new Response('rate limited', { status: 403, headers }));

    await expect(findAllSkillMdFiles('owner', 'repo')).rejects.toThrow(RateLimitError);
  });

  it('works with non-standard default branches like canary', async () => {
    const repoResponse = { default_branch: 'canary' };
    const treeResponse = {
      sha: 'b'.repeat(40), // Valid 40-char hex SHA
      tree: [{ path: 'SKILL.md', type: 'blob' }],
    };
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(repoResponse), { status: 200 })) // repo metadata
      .mockResolvedValueOnce(new Response(JSON.stringify(treeResponse), { status: 200 })); // tree

    const result = await findAllSkillMdFiles('owner', 'repo');

    expect(result.paths).toEqual(['SKILL.md']);
    expect(result.branch).toBe('canary');
  });

  it('throws RepoNotFoundError when repo does not exist', async () => {
    mockFetch.mockResolvedValueOnce(new Response('not found', { status: 404 })); // repo metadata

    await expect(findAllSkillMdFiles('owner', 'repo')).rejects.toThrow(RepoNotFoundError);
  });

  it('throws GitHubApiError on malformed tree response', async () => {
    const repoResponse = { default_branch: 'main' };
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(repoResponse), { status: 200 })) // repo metadata
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tree: 'not-an-array' }), { status: 200 }),
      ); // malformed tree

    await expect(findAllSkillMdFiles('owner', 'repo')).rejects.toThrow(GitHubApiError);
  });

  it('throws GitHubApiError when tree items lack required fields', async () => {
    const repoResponse = { default_branch: 'main' };
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(repoResponse), { status: 200 })) // repo metadata
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tree: [{ invalid: true }] }), { status: 200 }),
      ); // invalid tree

    await expect(findAllSkillMdFiles('owner', 'repo')).rejects.toThrow(GitHubApiError);
  });

  it('throws NetworkError on network failure', async () => {
    const networkError = new Error('Network error');
    mockFetch.mockRejectedValueOnce(networkError); // repo metadata fails

    await expect(findAllSkillMdFiles('owner', 'repo')).rejects.toThrow(NetworkError);
  });

  it('returns empty paths array when tree has no SKILL.md files', async () => {
    const repoResponse = { default_branch: 'main' };
    const treeResponse = {
      sha: 'c'.repeat(40), // Valid 40-char hex SHA
      tree: [
        { path: 'README.md', type: 'blob' },
        { path: 'src/index.ts', type: 'blob' },
      ],
    };
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(repoResponse), { status: 200 })) // repo metadata
      .mockResolvedValueOnce(new Response(JSON.stringify(treeResponse), { status: 200 })); // tree

    const result = await findAllSkillMdFiles('owner', 'repo');

    expect(result.paths).toEqual([]);
    expect(result.branch).toBe('main');
  });

  it('returns tree items in discovery result', async () => {
    const repoResponse = { default_branch: 'main' };
    const treeResponse = {
      sha: 'd'.repeat(40), // Valid 40-char hex SHA
      tree: [
        { path: 'SKILL.md', type: 'blob', sha: 'rootblob123' },
        { path: 'skills', type: 'tree', sha: 'skillsdir456' },
        { path: 'skills/foo', type: 'tree', sha: 'foodir789' },
        { path: 'skills/foo/SKILL.md', type: 'blob', sha: 'fooblob000' },
      ],
    };
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(repoResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(treeResponse), { status: 200 }));

    const result = await findAllSkillMdFiles('owner', 'repo');

    expect(result.tree).toHaveLength(4);
    expect(result.tree[0]).toEqual({ path: 'SKILL.md', type: 'blob', sha: 'rootblob123' });
  });
});

describe('fetchRecursiveTree', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockGetGitHubToken.mockReturnValue(undefined);
    mockHasGitHubToken.mockReturnValue(false);
  });

  it('returns sha and tree on successful API response', async () => {
    const treeResponse = {
      sha: 'e'.repeat(40),
      tree: [
        { path: 'SKILL.md', type: 'blob', sha: 'blob123' },
        { path: 'skills/foo', type: 'tree', sha: 'tree456' },
      ],
    };
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(treeResponse), { status: 200 }));

    const result = await fetchRecursiveTree('owner', 'repo', 'main');

    expect(result.sha).toBe('e'.repeat(40));
    expect(result.tree).toHaveLength(2);
    expect(result.tree[0]).toEqual({ path: 'SKILL.md', type: 'blob', sha: 'blob123' });
  });

  it('throws RateLimitError when rate limited', async () => {
    const resetTime = Math.floor(Date.now() / 1000) + 3600;
    const headers = new Headers({
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(resetTime),
    });
    mockFetch.mockResolvedValueOnce(new Response('rate limited', { status: 403, headers }));

    await expect(fetchRecursiveTree('owner', 'repo', 'main')).rejects.toThrow(RateLimitError);
  });

  it('throws RepoNotFoundError when repo does not exist', async () => {
    mockFetch.mockResolvedValueOnce(new Response('not found', { status: 404 }));

    await expect(fetchRecursiveTree('owner', 'repo', 'main')).rejects.toThrow(RepoNotFoundError);
  });

  it('throws GitHubApiError on malformed tree response', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ tree: 'not-an-array' }), { status: 200 }),
    );

    await expect(fetchRecursiveTree('owner', 'repo', 'main')).rejects.toThrow(GitHubApiError);
  });

  it('throws GitHubApiError when sha is missing', async () => {
    const treeResponse = {
      tree: [{ path: 'SKILL.md', type: 'blob' }],
    };
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(treeResponse), { status: 200 }));

    await expect(fetchRecursiveTree('owner', 'repo', 'main')).rejects.toThrow(
      /Invalid or missing sha field/,
    );
  });

  it('throws GitHubApiError when sha is invalid format', async () => {
    const treeResponse = {
      sha: 'invalid-sha',
      tree: [{ path: 'SKILL.md', type: 'blob' }],
    };
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(treeResponse), { status: 200 }));

    await expect(fetchRecursiveTree('owner', 'repo', 'main')).rejects.toThrow(GitHubApiError);
  });

  it('throws NetworkError on network failure', async () => {
    const networkError = new Error('Network error');
    mockFetch.mockRejectedValueOnce(networkError);

    await expect(fetchRecursiveTree('owner', 'repo', 'main')).rejects.toThrow(NetworkError);
  });

  it('throws GitHubApiError on non-ok response', async () => {
    // fetchWithRetry retries 3 times on 5xx, so mock all retries
    mockFetch
      .mockResolvedValueOnce(new Response('server error', { status: 500 }))
      .mockResolvedValueOnce(new Response('server error', { status: 500 }))
      .mockResolvedValueOnce(new Response('server error', { status: 500 }));

    await expect(fetchRecursiveTree('owner', 'repo', 'main')).rejects.toThrow(GitHubApiError);
  });

  it('returns empty tree array when tree is missing', async () => {
    const treeResponse = {
      sha: 'f'.repeat(40),
      // tree field is missing
    };
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(treeResponse), { status: 200 }));

    const result = await fetchRecursiveTree('owner', 'repo', 'main');

    expect(result.sha).toBe('f'.repeat(40));
    expect(result.tree).toEqual([]);
  });
});

describe('GitHub auth header forwarding', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sends Authorization header when token is available', async () => {
    mockGetGitHubToken.mockReturnValue('my-secret-token');
    mockHasGitHubToken.mockReturnValue(true);

    const repoResponse = { default_branch: 'main' };
    const treeResponse = {
      sha: 'a'.repeat(40),
      tree: [{ path: 'SKILL.md', type: 'blob' }],
    };
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(repoResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(treeResponse), { status: 200 }));

    await findAllSkillMdFiles('owner', 'repo');

    const firstCall = mockFetch.mock.calls[0];
    const requestInit = firstCall[1] as RequestInit;
    expect((requestInit.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer my-secret-token',
    );
  });

  it('does not send Authorization header when no token is available', async () => {
    mockGetGitHubToken.mockReturnValue(undefined);
    mockHasGitHubToken.mockReturnValue(false);

    const repoResponse = { default_branch: 'main' };
    const treeResponse = {
      sha: 'a'.repeat(40),
      tree: [{ path: 'SKILL.md', type: 'blob' }],
    };
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(repoResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(treeResponse), { status: 200 }));

    await findAllSkillMdFiles('owner', 'repo');

    const firstCall = mockFetch.mock.calls[0];
    const requestInit = firstCall[1] as RequestInit;
    expect((requestInit.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('includes GITHUB_TOKEN hint in RepoNotFoundError when no token is set', async () => {
    mockGetGitHubToken.mockReturnValue(undefined);
    mockHasGitHubToken.mockReturnValue(false);
    mockFetch.mockResolvedValueOnce(new Response('not found', { status: 404 }));

    await expect(fetchRecursiveTree('owner', 'repo', 'main')).rejects.toThrow(
      /GITHUB_TOKEN if this is a private repository/,
    );
  });

  it('does not include GITHUB_TOKEN hint when a token is already set', async () => {
    mockGetGitHubToken.mockReturnValue('tok');
    mockHasGitHubToken.mockReturnValue(true);
    mockFetch.mockResolvedValueOnce(new Response('not found', { status: 404 }));

    const err = await fetchRecursiveTree('owner', 'repo', 'main').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepoNotFoundError);
    const message = (err as RepoNotFoundError).message;
    expect(message).not.toContain('GITHUB_TOKEN');
    expect(message).toMatch(/Check the owner\/repo name\.$/);
  });
});

describe('getSkillSha', () => {
  const tree: GitTreeItem[] = [
    { path: 'SKILL.md', type: 'blob', sha: 'rootblob123' },
    { path: 'skills', type: 'tree', sha: 'skillsdir456' },
    { path: 'skills/foo', type: 'tree', sha: 'foodir789' },
    { path: 'skills/foo/SKILL.md', type: 'blob', sha: 'fooblob000' },
    { path: 'skills/bar', type: 'tree', sha: 'bardir111' },
    { path: 'skills/bar/SKILL.md', type: 'blob', sha: 'barblob222' },
  ];

  it('returns blob SHA for root-level skill', () => {
    expect(getSkillSha(tree, 'SKILL.md')).toBe('rootblob123');
  });

  it('returns directory SHA for subdirectory skill', () => {
    expect(getSkillSha(tree, 'skills/foo/SKILL.md')).toBe('foodir789');
  });

  it('returns directory SHA for nested skill', () => {
    expect(getSkillSha(tree, 'skills/bar/SKILL.md')).toBe('bardir111');
  });

  it('returns undefined when path not found', () => {
    expect(getSkillSha(tree, 'nonexistent/SKILL.md')).toBeUndefined();
  });

  it('returns undefined for empty tree', () => {
    expect(getSkillSha([], 'SKILL.md')).toBeUndefined();
  });

  it('returns undefined when SKILL.md blob not found at root', () => {
    const treeWithoutRoot: GitTreeItem[] = [{ path: 'README.md', type: 'blob', sha: 'readme123' }];
    expect(getSkillSha(treeWithoutRoot, 'SKILL.md')).toBeUndefined();
  });

  it('handles deeply nested skill paths', () => {
    const deepTree: GitTreeItem[] = [
      { path: 'plugins/community/auth', type: 'tree', sha: 'authdir999' },
      { path: 'plugins/community/auth/SKILL.md', type: 'blob', sha: 'authblob999' },
    ];
    expect(getSkillSha(deepTree, 'plugins/community/auth/SKILL.md')).toBe('authdir999');
  });
});
