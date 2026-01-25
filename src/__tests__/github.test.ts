/**
 * Tests for GitHub API error handling.
 * Uses mocked fetch to test error paths without network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchWithRetry,
  findAllSkillMdFiles,
  RateLimitError,
  RepoNotFoundError,
  NetworkError,
  GitHubApiError,
} from '../lib/github.js';

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

describe('fetchWithRetry', () => {
  beforeEach(() => {
    mockFetch.mockReset();
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns skill paths on successful API response', async () => {
    const repoResponse = { default_branch: 'main' };
    const treeResponse = {
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
});
