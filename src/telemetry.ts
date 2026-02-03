const TELEMETRY_URL = 'https://mcpmarket.com/api/telemetry';

/** Timeout for telemetry requests (ms) */
const TELEMETRY_TIMEOUT = 5000;

/**
 * Send a telemetry payload. Returns a promise that resolves when the request
 * completes (or times out). Never rejects.
 */
function sendTelemetry(payload: Record<string, unknown>): Promise<void> {
  try {
    if (process.env.DO_NOT_TRACK === '1' || process.env.CI === 'true') {
      return Promise.resolve();
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT);

    return fetch(TELEMETRY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then(() => {})
      .catch(() => {})
      .finally(() => clearTimeout(timeoutId));
  } catch {
    return Promise.resolve();
  }
}

/**
 * Track a command execution. Fire and forget.
 *
 * @param command The command name (e.g., 'add', 'bundle', 'install')
 * @returns Promise that resolves when telemetry is sent (or times out)
 */
export function trackCommand(command: string): Promise<void> {
  if (!command) return Promise.resolve();
  return sendTelemetry({ type: 'command', command });
}

/**
 * Track a skill install. Also increments skill download count on backend.
 * Maintains backward-compatible payload format.
 *
 * @param owner GitHub repository owner
 * @param repo GitHub repository name
 * @returns Promise that resolves when telemetry is sent (or times out)
 */
export function trackInstall(owner: string, repo: string): Promise<void> {
  if (!owner || !repo) return Promise.resolve();
  return sendTelemetry({ owner, repo });
}
