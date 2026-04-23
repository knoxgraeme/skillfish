/**
 * GitHub API functions for skill discovery and fetching.
 */

import { isGitTreeResponse, extractSkillPaths, type GitTreeItem } from '../utils.js';
import { fetchWithRetry } from './http.js';
import { getGitHubToken, hasGitHubToken } from './auth.js';

export const SKILL_FILENAME = 'SKILL.md';

// === Types ===

/**
 * Result of skill discovery including branch and SHA information.
 */
export interface SkillDiscoveryResult {
  paths: string[];
  branch: string;
  /** Root tree SHA from git/trees response - changes when any file in repo changes */
  sha: string;
  /** Raw tree items for directory-level SHA lookups */
  tree: GitTreeItem[];
}

// === Helper Functions ===

/**
 * Get the SHA for a skill path from a git tree.
 * - For subdirectory skills: returns the directory's tree SHA
 * - For root-level skills: returns the SKILL.md blob SHA
 *
 * This enables directory-level change detection instead of repo-level,
 * reducing false "outdated" notifications when unrelated files change.
 */
export function getSkillSha(tree: GitTreeItem[], skillPath: string): string | undefined {
  // Root-level skill - use the blob SHA of SKILL.md itself
  if (skillPath === SKILL_FILENAME) {
    const blob = tree.find((item) => item.path === SKILL_FILENAME && item.type === 'blob');
    return blob?.sha;
  }

  // Subdirectory skill - use the directory's tree SHA
  const dirPath = skillPath.replace(/\/SKILL\.md$/, '');
  const dir = tree.find((item) => item.path === dirPath && item.type === 'tree');
  return dir?.sha;
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
    const hint = hasGitHubToken()
      ? ''
      : ', or set GITHUB_TOKEN if this is a private repository (or run `gh auth login`)';
    super(`Repository not found: ${owner}/${repo}. Check the owner/repo name${hint}.`);
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

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': 'skillfish' };
  const token = getGitHubToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

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
  const headers = githubHeaders();
  const url = `https://api.github.com/repos/${owner}/${repo}`;

  try {
    const res = await fetchWithRetry(url, { headers });

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
  }
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
  const headers = githubHeaders();
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
  const headers = githubHeaders();
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}`;

  try {
    const res = await fetchWithRetry(url, { headers });

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
  }
}

/**
 * Fetch the recursive tree for a repository branch.
 * Returns both the root SHA and the full tree for directory-level SHA lookups.
 *
 * @throws {RepoNotFoundError} When the repository is not found
 * @throws {RateLimitError} When GitHub API rate limit is exceeded
 * @throws {NetworkError} On network errors
 * @throws {GitHubApiError} When the API response format is unexpected
 */
export async function fetchRecursiveTree(
  owner: string,
  repo: string,
  branch: string,
): Promise<{ sha: string; tree: GitTreeItem[] }> {
  const headers = githubHeaders();
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

  try {
    const res = await fetchWithRetry(url, { headers });

    checkRateLimit(res);

    if (res.status === 404) {
      throw new RepoNotFoundError(owner, repo);
    }

    if (!res.ok) {
      throw new GitHubApiError(`GitHub API returned status ${res.status}`);
    }

    const rawData: unknown = await res.json();

    if (!isGitTreeResponse(rawData)) {
      throw new GitHubApiError('Unexpected response format from GitHub API.');
    }

    const sha = rawData.sha;
    if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)) {
      throw new GitHubApiError('Invalid or missing sha field in tree response');
    }

    const tree = rawData.tree ?? [];

    return { sha, tree };
  } catch (err: unknown) {
    wrapApiError(err);
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
  // Get the default branch
  const branch = await fetchDefaultBranch(owner, repo);

  // Fetch the recursive tree (reuses fetchRecursiveTree to avoid duplication)
  const { sha, tree } = await fetchRecursiveTree(owner, repo, branch);

  // Extract SKILL.md paths from the tree
  const paths = extractSkillPaths({ tree }, SKILL_FILENAME);

  return { paths, branch, sha, tree };
}
