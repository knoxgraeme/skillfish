/**
 * GitHub API functions for skill discovery and fetching.
 */

import { isGitTreeResponse, extractSkillPaths, sleep } from '../utils.js';

// === Constants ===
const API_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000]; // Exponential backoff
export const SKILL_FILENAME = 'SKILL.md';

// === Types ===

/**
 * Result of skill discovery including branch and SHA information.
 */
export interface SkillDiscoveryResult {
  paths: string[];
  branch: string;
  /** Tree SHA from git/trees response - changes when any file in repo changes */
  sha: string;
}

// === Error Types ===

/**
 * Thrown when GitHub API rate limit is exceeded.
 */
export class RateLimitError extends Error {
  constructor(public resetTime?: Date) {
    super(
      `GitHub API rate limit exceeded${resetTime ? `. Resets at ${resetTime.toISOString()}` : '. Please try again later.'}`,
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
    public repo: string,
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

// === Helper Functions ===

/**
 * Check if a response indicates rate limiting and throw RateLimitError if so.
 * @throws {RateLimitError} When rate limit is exceeded
 */
function checkRateLimit(res: Response): void {
  if (res.status === 403) {
    const remaining = res.headers.get('X-RateLimit-Remaining');
    if (remaining === '0') {
      const resetHeader = res.headers.get('X-RateLimit-Reset');
      const resetTime = resetHeader ? new Date(parseInt(resetHeader) * 1000) : undefined;
      throw new RateLimitError(resetTime);
    }
  }
}

/**
 * Wrap unknown errors in appropriate typed errors.
 * Re-throws known error types, wraps others in NetworkError.
 * @throws {RateLimitError | RepoNotFoundError | GitHubApiError | NetworkError}
 */
function wrapApiError(err: unknown): never {
  // Re-throw known error types
  if (
    err instanceof RateLimitError ||
    err instanceof RepoNotFoundError ||
    err instanceof GitHubApiError
  ) {
    throw err;
  }

  // Handle timeout errors
  if (err instanceof Error && err.name === 'AbortError') {
    throw new NetworkError('Request timed out. Check your network connection.');
  }

  // Wrap unknown errors as NetworkError
  throw new NetworkError(`Network error: ${err instanceof Error ? err.message : 'unknown error'}`);
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

    checkRateLimit(res);

    if (res.status === 404) {
      throw new RepoNotFoundError(owner, repo);
    }

    if (!res.ok) {
      throw new GitHubApiError(`GitHub API returned status ${res.status}`);
    }

    const data = (await res.json()) as { default_branch?: string };
    if (typeof data.default_branch !== 'string' || !data.default_branch) {
      throw new GitHubApiError('Repository metadata missing or invalid default_branch field');
    }

    return data.default_branch;
  } catch (err: unknown) {
    wrapApiError(err);
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
  maxRetries: number = MAX_RETRIES,
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
 */
export async function fetchSkillMdContent(
  owner: string,
  repo: string,
  path: string,
  branch: string,
): Promise<string | null> {
  const headers = { 'User-Agent': 'skillfish' };
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;

  try {
    const res = await fetchWithRetry(url, { headers }, 2);
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

/**
 * Fetch the tree SHA for a repository branch.
 * Used for update checks - compares stored SHA with current SHA.
 *
 * @throws {RepoNotFoundError} When the repository is not found
 * @throws {RateLimitError} When GitHub API rate limit is exceeded
 * @throws {NetworkError} On network errors
 * @throws {GitHubApiError} When the API response format is unexpected
 */
export async function fetchTreeSha(owner: string, repo: string, branch: string): Promise<string> {
  const headers: Record<string, string> = { 'User-Agent': 'skillfish' };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}`;
    const res = await fetchWithRetry(url, { headers, signal: controller.signal });

    checkRateLimit(res);

    if (res.status === 404) {
      throw new RepoNotFoundError(owner, repo);
    }

    if (!res.ok) {
      throw new GitHubApiError(`GitHub API returned status ${res.status}`);
    }

    const data = (await res.json()) as { sha?: string };
    if (typeof data.sha !== 'string' || !/^[a-f0-9]{40}$/.test(data.sha)) {
      throw new GitHubApiError('Invalid or missing sha field in tree response');
    }

    return data.sha;
  } catch (err: unknown) {
    wrapApiError(err);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Find all SKILL.md files in a GitHub repository.
 * Fetches the default branch, then searches for skills on that branch.
 *
 * @returns SkillDiscoveryResult with paths and the branch they were found on
 * @throws {RateLimitError} When GitHub API rate limit is exceeded
 * @throws {RepoNotFoundError} When the repository is not found
 * @throws {NetworkError} On network errors (timeout, connection refused)
 * @throws {GitHubApiError} When the API response format is unexpected
 */
export async function findAllSkillMdFiles(
  owner: string,
  repo: string,
): Promise<SkillDiscoveryResult> {
  const headers: Record<string, string> = { 'User-Agent': 'skillfish' };

  // Get the default branch
  const branch = await fetchDefaultBranch(owner, repo);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const res = await fetchWithRetry(url, { headers, signal: controller.signal });

    checkRateLimit(res);

    if (!res.ok) {
      throw new GitHubApiError(`GitHub API returned status ${res.status}`);
    }

    const rawData: unknown = await res.json();

    if (!isGitTreeResponse(rawData)) {
      throw new GitHubApiError('Unexpected response format from GitHub API.');
    }

    const paths = extractSkillPaths(rawData, SKILL_FILENAME);
    const sha = rawData.sha ?? '';
    return { paths, branch, sha };
  } catch (err: unknown) {
    wrapApiError(err);
  } finally {
    clearTimeout(timeoutId);
  }
}
