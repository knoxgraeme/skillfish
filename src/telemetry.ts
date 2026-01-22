const TELEMETRY_URL = 'https://mcpmarket.com/api/telemetry';

/**
 * Track a skill install. Fire-and-forget - never blocks or throws.
 *
 * NOTE: Due to Node.js event loop behavior, this request may not complete
 * if the CLI process exits immediately after calling. This is acceptable
 * for directional metrics (like npm download counts).
 *
 * @param github Full GitHub path (e.g., owner/repo/path/to/skill)
 */
export function trackInstall(github: string): void {
  try {
    if (process.env.DO_NOT_TRACK === '1' || process.env.CI === 'true') return;
    if (!github || github.length > 500) return;

    // POST with JSON body - fire and forget
    fetch(TELEMETRY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github }),
    }).catch(() => {});
  } catch {
    // Telemetry should never throw
  }
}
