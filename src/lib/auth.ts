/**
 * GitHub authentication helpers for skillfish.
 */

import { execFileSync } from 'child_process';

// Module-scoped cache: undefined = not yet resolved, null = resolved to no token
let cachedToken: string | null | undefined = undefined;

/**
 * Resolve a GitHub token from the environment or the local `gh` CLI.
 *
 * Priority:
 *   1. SKILLFISH_GITHUB_TOKEN
 *   2. GITHUB_TOKEN
 *   3. GH_TOKEN
 *   4. `gh auth token` (if gh is on PATH and the user is logged in)
 */
export function getGitHubToken(): string | undefined {
  if (cachedToken !== undefined) {
    return cachedToken ?? undefined;
  }

  const fromEnv =
    process.env.SKILLFISH_GITHUB_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim();

  if (fromEnv) {
    cachedToken = fromEnv;
    return cachedToken;
  }

  // Fallback: ask the gh CLI for the active token (~50 ms, silent on failure)
  try {
    const raw = execFileSync('gh', ['auth', 'token'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    })
      .toString()
      .trim();
    cachedToken = raw || null;
  } catch {
    cachedToken = null;
  }

  return cachedToken ?? undefined;
}

/** Returns true when a GitHub token is available. */
export function hasGitHubToken(): boolean {
  return getGitHubToken() !== undefined;
}

/** Reset the per-process token cache. Intended for use in tests only. */
export function resetGitHubTokenCache(): void {
  cachedToken = undefined;
}
