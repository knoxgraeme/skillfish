/**
 * Shared HTTP utilities for skillfish CLI.
 *
 * This module provides common HTTP functionality used by both:
 * - GitHub API client (github.ts)
 * - Registry API client (registry.ts)
 *
 * Centralizing fetch logic ensures consistent timeout handling,
 * retry behavior, and error handling across all API calls.
 */

import { sleep } from '../utils.js';

// === Constants ===
export const API_TIMEOUT_MS = 10000;
export const MAX_RETRIES = 3;
export const RETRY_DELAYS_MS = [1000, 2000, 4000]; // Exponential backoff

/**
 * Fetch with retry and exponential backoff.
 * Retries on network errors and 5xx responses.
 *
 * @param url - The URL to fetch
 * @param options - Fetch options (headers, method, body, etc.)
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @returns The fetch Response
 * @throws Error on network failure after all retries exhausted
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = MAX_RETRIES,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Create a per-attempt timeout if no signal provided
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    // If caller provided a signal, abort when either signal fires
    const callerSignal = options.signal;
    if (callerSignal) {
      callerSignal.addEventListener('abort', () => controller.abort());
    }

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

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
      clearTimeout(timeoutId);
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
