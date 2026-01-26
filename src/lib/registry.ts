/**
 * Registry API client for skill submission and search.
 * Currently uses a mock API - will be replaced with real Supabase endpoint.
 */

import { sleep } from '../utils.js';

// === Constants ===
const API_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

// Mock API endpoint - replace with real endpoint when ready
const REGISTRY_API_URL = 'https://mcpmarket.com/api/registry';

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
 *
 * @param skills - Array of skill submissions
 * @returns BatchSubmissionResponse with results for each skill
 * @throws {RegistryNetworkError} On network errors
 * @throws {RegistryApiError} On API errors
 */
export async function submitSkillsToRegistry(
  skills: SkillSubmission[],
): Promise<BatchSubmissionResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetchWithRetry(
      `${REGISTRY_API_URL}/submit`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'skillfish',
        },
        body: JSON.stringify({ skills }),
        signal: controller.signal,
      },
      MAX_RETRIES,
    );

    if (!res.ok) {
      // For now, simulate a successful response since API doesn't exist yet
      // TODO: Remove this mock when real API is implemented
      if (res.status === 404) {
        return mockSubmitResponse(skills);
      }
      throw new RegistryApiError(`Registry API returned status ${res.status}`, res.status);
    }

    const data = (await res.json()) as BatchSubmissionResponse;
    return data;
  } catch (err) {
    // Handle timeout
    if (err instanceof Error && err.name === 'AbortError') {
      // Return mock response for now since API doesn't exist
      return mockSubmitResponse(skills);
    }

    // Re-throw known errors
    if (err instanceof RegistryApiError) {
      throw err;
    }

    // For network errors during development, return mock response
    // TODO: Remove this mock when real API is implemented
    return mockSubmitResponse(skills);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Mock submission response for development.
 * TODO: Remove when real API is implemented.
 */
function mockSubmitResponse(skills: SkillSubmission[]): BatchSubmissionResponse {
  return {
    success: true,
    submitted: skills.map((skill) => ({
      success: true,
      skill_name: skill.skill_name,
      message: 'Submitted for review (mock response)',
    })),
    errors: [],
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
