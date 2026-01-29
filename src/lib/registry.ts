/**
 * Registry API client for skill submission.
 */

import { sleep } from '../utils.js';
import { fetchWithRetry, MAX_RETRIES } from './http.js';

// Registry API endpoint
const REGISTRY_API_URL = 'https://mcpmarket.com/api/submit-url';

// === Types ===

/**
 * Skill submission payload sent to the registry API.
 */
export interface SkillSubmission {
  url: string;
  owner: string;
  repo: string;
  skill: string;
  path: string;
}

/**
 * Response from the registry API for a single skill submission.
 */
export interface SubmissionResponse {
  success: boolean;
  skill: string;
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

// === API Functions ===

/**
 * Submit skills to the registry.
 * Submits at the repo level - the backend discovers individual skills.
 *
 * @param skills - Array of skill submissions (deduplicated by repo)
 * @returns BatchSubmissionResponse with results for each skill
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
        },
        MAX_RETRIES,
      );

      // Validate Content-Type before parsing JSON
      const contentType = res.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        throw new Error('Unexpected response type from registry');
      }

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
            skill: skill.skill,
            message: data.message || 'Submitted for review',
          });
        }
      } else {
        // Handle specific error cases
        const errorMsg = data.error || `Failed to submit ${repoKey}`;
        for (const skill of repoSkills) {
          submitted.push({
            success: false,
            skill: skill.skill,
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
          skill: skill.skill,
          error: errorMsg,
        });
      }
      errors.push(`${repoKey}: ${errorMsg}`);
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
