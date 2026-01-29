/**
 * Registry API client for skill submission.
 */

import { sleep } from '../utils.js';

// === Constants ===
const API_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

// Registry API endpoint
const REGISTRY_API_URL = 'https://mcpmarket.com/api/submit-url';

// === Types ===

/**
 * Skill submission payload sent to the registry API.
 */
export interface SkillSubmission {
  skill_url: string;
  owner: string;
  repo: string;
  skill_name: string;
  path: string;
}

/**
 * Response from the registry API for a single skill submission.
 */
export interface SubmissionResponse {
  success: boolean;
  skill_name: string;
  message?: string;
  error?: string;
}

/**
 * Batch submission response from the registry API.
 */
export interface BatchSubmissionResponse {
  success: boolean;
  submitted: SubmissionResponse[];
  errors: string[];
}

// === Error Types ===

/**
 * Thrown when the registry API returns an error.
 */
export class RegistryApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = 'RegistryApiError';
  }
}

/**
 * Thrown on network errors when contacting the registry.
 */
export class RegistryNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryNetworkError';
  }
}

// === Helper Functions ===

/**
 * Fetch with retry and exponential backoff.
 */
async function fetchWithRetry(
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

// === API Functions ===

/**
 * Submit skills to the registry.
 * Submits at the repo level - the backend discovers individual skills.
 *
 * @param skills - Array of skill submissions (deduplicated by repo)
 * @returns BatchSubmissionResponse with results for each skill
 * @throws {RegistryNetworkError} On network errors
 * @throws {RegistryApiError} On API errors
 */
export async function submitSkillsToRegistry(
  skills: SkillSubmission[],
): Promise<BatchSubmissionResponse> {
  // Deduplicate by repo - API accepts repo-level submissions
  const repoMap = new Map<string, SkillSubmission[]>();
  for (const skill of skills) {
    const repoKey = `${skill.owner}/${skill.repo}`;
    if (!repoMap.has(repoKey)) {
      repoMap.set(repoKey, []);
    }
    repoMap.get(repoKey)!.push(skill);
  }

  const submitted: SubmissionResponse[] = [];
  const errors: string[] = [];

  // Submit each unique repo
  for (const [repoKey, repoSkills] of repoMap) {
    const [owner, repo] = repoKey.split('/');
    const repoUrl = `https://github.com/${owner}/${repo}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const res = await fetchWithRetry(
        REGISTRY_API_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'skillfish-cli',
          },
          body: JSON.stringify({ url: repoUrl, type: 'skill' }),
          signal: controller.signal,
        },
        MAX_RETRIES,
      );

      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        message?: string;
        submission_id?: number;
      };

      if (res.ok && data.success) {
        // Mark all skills from this repo as submitted
        for (const skill of repoSkills) {
          submitted.push({
            success: true,
            skill_name: skill.skill_name,
            message: data.message || 'Submitted for review',
          });
        }
      } else {
        // Handle specific error cases
        const errorMsg = data.error || `Failed to submit ${repoKey}`;
        for (const skill of repoSkills) {
          submitted.push({
            success: false,
            skill_name: skill.skill_name,
            error: errorMsg,
          });
        }
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error && err.name === 'AbortError'
          ? 'Request timed out'
          : err instanceof Error
            ? err.message
            : 'Network error';

      for (const skill of repoSkills) {
        submitted.push({
          success: false,
          skill_name: skill.skill_name,
          error: errorMsg,
        });
      }
      errors.push(`${repoKey}: ${errorMsg}`);
    } finally {
      clearTimeout(timeoutId);
    }

    // Small delay between requests to avoid rate limiting
    if (repoMap.size > 1) {
      await sleep(200);
    }
  }

  return {
    success: submitted.every((s) => s.success),
    submitted,
    errors,
  };
}

/**
 * Build the GitHub URL for a skill.
 */
export function buildSkillUrl(owner: string, repo: string, branch: string, path: string): string {
  if (!path || path === 'SKILL.md' || path === '.') {
    return `https://github.com/${owner}/${repo}`;
  }
  // Remove SKILL.md suffix if present
  const cleanPath = path.replace(/\/SKILL\.md$/, '');
  return `https://github.com/${owner}/${repo}/tree/${branch}/${cleanPath}`;
}
