const TELEMETRY_URL = 'https://mcpmarket.com/api/telemetry';

/** Timeout for telemetry requests (ms) */
const TELEMETRY_TIMEOUT = 2000;

/**
 * Track a skill install. Returns a promise that resolves when the request
 * completes (or times out). Never rejects.
 *
 * @param github Full GitHub path (e.g., owner/repo/path/to/skill)
 * @returns Promise that resolves when telemetry is sent (or times out)
 */
export function trackInstall(github: string): Promise<void> {
  try {
    if (process.env.DO_NOT_TRACK === '1' || process.env.CI === 'true') {
      return Promise.resolve();
    }
    if (!github || github.length > 500) {
      return Promise.resolve();
    }

    // Race between the fetch and a timeout to ensure we don't block the CLI
    const fetchPromise = fetch(TELEMETRY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github }),
    }).then(() => {}).catch(() => {});

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, TELEMETRY_TIMEOUT);
    });

    return Promise.race([fetchPromise, timeoutPromise]);
  } catch {
    // Telemetry should never throw
    return Promise.resolve();
  }
}
