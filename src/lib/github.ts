/**
 * GitHub API functions for skill discovery and fetching.
 */

import { isGitTreeResponse, extractSkillPaths, sleep } from '../utils.js';

// === Constants ===
const API_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000]; // Exponential backoff
const DEFAULT_BRANCHES = ['main', 'master'] as const;
export const SKILL_FILENAME = 'SKILL.md';

// === Error Types ===

/**
 * Thrown when GitHub API rate limit is exceeded.
 */
export class RateLimitError extends Error {
  constructor(public resetTime?: Date) {
    super(
      `GitHub API rate limit exceeded${resetTime ? `. Resets at ${resetTime.toISOString()}` : '. Please try again later.'}`
    );
    this.name = 'RateLimitError';
  }
}

/**
 * Thrown when the repository is not found.
 */
export class RepoNotFoundError extends Error {
  constructor(
    public owner: string,
    public repo: string
  ) {
    super(`Repository not found: ${owner}/${repo}. Check the owner/repo name.`);
    this.name = 'RepoNotFoundError';
  }
}

/**
 * Thrown on network errors (timeout, connection refused, etc.).
 */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Thrown when GitHub API returns unexpected response format.
 */
export class GitHubApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

// === Functions ===

/**
 * Fetch with retry and exponential backoff.
 * Retries on network errors and 5xx responses.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);

      // Success or client error (4xx) - don't retry
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        return res;
      }

      // Server error (5xx) - retry
      if (res.status >= 500) {
        lastError = new Error(`Server error: ${res.status}`);
        if (attempt < maxRetries - 1) {
          await sleep(RETRY_DELAYS_MS[attempt] || 4000);
          continue;
        }
      }

      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Network error - retry
      if (attempt < maxRetries - 1) {
        await sleep(RETRY_DELAYS_MS[attempt] || 4000);
        continue;
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

/**
 * Fetch raw SKILL.md content from GitHub.
 * Uses raw.githubusercontent.com which is not rate-limited like the API.
 * Tries both main and master branches in parallel for better performance.
 */
export async function fetchSkillMdContent(
  owner: string,
  repo: string,
  path: string
): Promise<string | null> {
  const headers = { 'User-Agent': 'skillfish' };

  // Try both branches in parallel
  const results = await Promise.allSettled(
    DEFAULT_BRANCHES.map(async (branch) => {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
      const res = await fetchWithRetry(url, { headers }, 2);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
  );

  // Return first successful result
  for (const result of results) {
    if (result.status === 'fulfilled') {
      return result.value;
    }
  }

  return null;
}

/**
 * Find all SKILL.md files in a GitHub repository.
 * Uses sequential branch checking to conserve API rate limit (60/hr unauthenticated).
 *
 * @throws {RateLimitError} When GitHub API rate limit is exceeded
 * @throws {RepoNotFoundError} When the repository is not found
 * @throws {NetworkError} On network errors (timeout, connection refused)
 * @throws {GitHubApiError} When the API response format is unexpected
 */
export async function findAllSkillMdFiles(owner: string, repo: string): Promise<string[]> {
  const headers: Record<string, string> = { 'User-Agent': 'skillfish' };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    // Try each branch sequentially to conserve rate limit
    for (const branch of DEFAULT_BRANCHES) {
      const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

      try {
        const res = await fetchWithRetry(url, { headers, signal: controller.signal });

        // Check for rate limiting
        if (res.status === 403) {
          const remaining = res.headers.get('X-RateLimit-Remaining');
          if (remaining === '0') {
            const resetHeader = res.headers.get('X-RateLimit-Reset');
            const resetTime = resetHeader ? new Date(parseInt(resetHeader) * 1000) : undefined;
            throw new RateLimitError(resetTime);
          }
        }

        // 404 means branch doesn't exist, try next
        if (res.status === 404) {
          continue;
        }

        if (!res.ok) {
          continue;
        }

        const rawData: unknown = await res.json();

        if (!isGitTreeResponse(rawData)) {
          throw new GitHubApiError('Unexpected response format from GitHub API.');
        }

        return extractSkillPaths(rawData, SKILL_FILENAME);
      } catch (err) {
        // Re-throw typed errors
        if (
          err instanceof RateLimitError ||
          err instanceof GitHubApiError
        ) {
          throw err;
        }
        // If this is the last branch, let the error propagate
        if (branch === DEFAULT_BRANCHES[DEFAULT_BRANCHES.length - 1]) {
          throw err;
        }
        // Otherwise try next branch
        continue;
      }
    }

    // No branch found
    throw new RepoNotFoundError(owner, repo);
  } catch (err: unknown) {
    // Re-throw typed errors
    if (
      err instanceof RateLimitError ||
      err instanceof RepoNotFoundError ||
      err instanceof GitHubApiError
    ) {
      throw err;
    }

    if (err instanceof Error && err.name === 'AbortError') {
      throw new NetworkError('Request timed out. Check your network connection.');
    }

    throw new NetworkError(
      `Network error: ${err instanceof Error ? err.message : 'unknown error'}`
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
