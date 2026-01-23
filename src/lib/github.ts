/**
 * GitHub API functions for skill discovery and fetching.
 */

import { isGitTreeResponse, extractSkillPaths, sleep } from '../utils.js';

// === Constants ===
const API_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000]; // Exponential backoff
const FALLBACK_BRANCHES = ['main', 'master'] as const;
export const SKILL_FILENAME = 'SKILL.md';

// === Types ===

/**
 * Result of skill discovery including branch information.
 */
export interface SkillDiscoveryResult {
  paths: string[];
  branch: string;
}

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
 * Fetch the default branch name for a repository.
 * Uses the GitHub repos API which returns repository metadata including default_branch.
 *
 * @throws {RepoNotFoundError} When the repository is not found
 * @throws {RateLimitError} When GitHub API rate limit is exceeded
 * @throws {NetworkError} On network errors
 */
export async function fetchDefaultBranch(owner: string, repo: string): Promise<string> {
  const headers: Record<string, string> = { 'User-Agent': 'skillfish' };
  const url = `https://api.github.com/repos/${owner}/${repo}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

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

    if (res.status === 404) {
      throw new RepoNotFoundError(owner, repo);
    }

    if (!res.ok) {
      throw new GitHubApiError(`GitHub API returned status ${res.status}`);
    }

    const data = await res.json() as { default_branch?: string };
    if (!data.default_branch) {
      throw new GitHubApiError('Repository metadata missing default_branch field');
    }

    return data.default_branch;
  } catch (err: unknown) {
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
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param path - Path to file within repository
 * @param branch - Specific branch to fetch from (if not provided, tries fallback branches)
 */
export async function fetchSkillMdContent(
  owner: string,
  repo: string,
  path: string,
  branch?: string
): Promise<string | null> {
  const headers = { 'User-Agent': 'skillfish' };

  // If branch is specified, try only that branch
  if (branch) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
    try {
      const res = await fetchWithRetry(url, { headers }, 2);
      if (!res.ok) return null;
      return res.text();
    } catch {
      return null;
    }
  }

  // Try fallback branches in parallel
  const results = await Promise.allSettled(
    FALLBACK_BRANCHES.map(async (b) => {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/${path}`;
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
 * First fetches the actual default branch, then searches for skills on that branch.
 * Falls back to main/master if default branch detection fails.
 *
 * @returns SkillDiscoveryResult with paths and the branch they were found on
 * @throws {RateLimitError} When GitHub API rate limit is exceeded
 * @throws {RepoNotFoundError} When the repository is not found
 * @throws {NetworkError} On network errors (timeout, connection refused)
 * @throws {GitHubApiError} When the API response format is unexpected
 */
export async function findAllSkillMdFiles(owner: string, repo: string): Promise<SkillDiscoveryResult> {
  const headers: Record<string, string> = { 'User-Agent': 'skillfish' };

  // First, try to get the actual default branch from repo metadata
  let branchesToTry: string[];
  try {
    const defaultBranch = await fetchDefaultBranch(owner, repo);
    // Put default branch first, then fallbacks (in case default branch tree fetch fails)
    branchesToTry = [defaultBranch, ...FALLBACK_BRANCHES.filter(b => b !== defaultBranch)];
  } catch (err) {
    // If repo doesn't exist or rate limited, throw immediately
    if (err instanceof RepoNotFoundError || err instanceof RateLimitError) {
      throw err;
    }
    // For other errors (network issues, etc.), fall back to trying common branches
    branchesToTry = [...FALLBACK_BRANCHES];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    // Try each branch sequentially to conserve rate limit
    for (const branch of branchesToTry) {
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

        const paths = extractSkillPaths(rawData, SKILL_FILENAME);
        return { paths, branch };
      } catch (err) {
        // Re-throw typed errors
        if (
          err instanceof RateLimitError ||
          err instanceof GitHubApiError
        ) {
          throw err;
        }
        // If this is the last branch, let the error propagate
        if (branch === branchesToTry[branchesToTry.length - 1]) {
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
