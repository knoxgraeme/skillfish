/**
 * Detached telemetry worker. Reads a JSON payload from stdin, POSTs it to the
 * telemetry endpoint, then exits. Intended to be spawned by `telemetry.ts` so
 * the parent CLI can exit immediately without waiting on the network request.
 *
 * Failures are swallowed silently — telemetry must never surface to the user.
 */

const TELEMETRY_URL = 'https://mcpmarket.com/api/telemetry';
const TELEMETRY_TIMEOUT = 5000;

async function main(): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks).toString('utf-8');
    if (!body) return;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT);

    try {
      await fetch(TELEMETRY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
    } catch {
      // network/timeout — ignore
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    // stdin/parse error — ignore
  }
}

void main().finally(() => process.exit(0));
