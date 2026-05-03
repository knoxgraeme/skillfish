/**
 * Anonymous CLI usage telemetry.
 *
 * Telemetry is dispatched to a detached child process (`telemetry-worker.js`)
 * that owns the HTTP request and survives the parent's exit. This means:
 *   - The CLI returns to the user immediately, never blocked by network I/O.
 *   - `process.exit()` in command code does not abort the in-flight POST.
 *
 * Disabled when `DO_NOT_TRACK=1` or `CI=true`. Also disabled when the module
 * is loaded from TypeScript source (dev/test via tsx) since the compiled
 * worker only exists in `dist/`.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

/**
 * Treat any non-empty value other than "0"/"false" as "disabled". This matches
 * the de-facto behavior of the consoledonottrack.com convention used by other
 * CLI tools — `DO_NOT_TRACK=true`, `DO_NOT_TRACK=yes`, etc. all disable.
 */
function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== '' && normalized !== '0' && normalized !== 'false';
}

function isTelemetryDisabled(): boolean {
  return isTruthyEnv(process.env.DO_NOT_TRACK) || isTruthyEnv(process.env.CI);
}

function dispatch(payload: Record<string, unknown>): void {
  if (isTelemetryDisabled()) return;

  // The worker only ships as a compiled .js artifact. When loaded from .ts
  // source (tsx in dev/test), there is no worker to spawn — skip silently.
  if (import.meta.url.endsWith('.ts')) return;

  try {
    const workerPath = fileURLToPath(new URL('./telemetry-worker.js', import.meta.url));
    const child = spawn(process.execPath, [workerPath], {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });

    // Swallow spawn errors (ENOENT, EPERM, etc.) — telemetry must not surface.
    child.on('error', () => {});

    // Detach from the parent's reference count so process.exit() doesn't wait.
    child.unref();

    // Small JSON payloads fit comfortably in the kernel pipe buffer, so this
    // write completes synchronously and the child can read it after the parent
    // exits.
    child.stdin?.end(JSON.stringify(payload));
  } catch {
    // ignore
  }
}

/**
 * Track a command execution. Fire-and-forget; returns immediately.
 *
 * @param command The command name (e.g., 'add', 'bundle', 'install')
 */
export function trackCommand(command: string): void {
  if (!command) return;
  dispatch({ event_type: 'command', command });
}

/**
 * Track a skill install. Fire-and-forget; returns immediately.
 * Inserts into telemetry_events and increments skill download count.
 *
 * @param command The command that triggered the install ('add' or 'install')
 * @param owner GitHub repository owner
 * @param repo GitHub repository name
 * @param skillName Name of the skill being installed
 * @param platform Names of the agents the skill was installed to (e.g. ['Claude Code', 'Cursor'])
 * @param path Path to the skill within the repo. Undefined for root-level
 *   skills (whole repo is one skill). For monorepos, this disambiguates
 *   sibling skills (e.g. 'skills/council' vs 'skills/marketing').
 */
export function trackInstall(
  command: string,
  owner: string,
  repo: string,
  skillName: string,
  platform: readonly string[] = [],
  path?: string,
): void {
  if (!command || !owner || !repo || !skillName) return;
  // Canonical skill key: 'owner/repo' for root skills, 'owner/repo/path'
  // for skills nested in a monorepo. Without the path component, every
  // skill in a monorepo collapses to the same key.
  const normalizedPath = path?.trim().replace(/^\/+|\/+$/g, '') || undefined;
  const skillKey = normalizedPath ? `${owner}/${repo}/${normalizedPath}` : `${owner}/${repo}`;
  // platform is a single text column on telemetry_events. We send a
  // comma-separated, de-duplicated list so one install stays one row
  // (preserving download-count semantics). Agent names contain no commas.
  const platformText = Array.from(new Set(platform)).join(', ');
  dispatch({
    event_type: 'install',
    command,
    skill_key: skillKey,
    // Fields for skill count increment
    owner,
    repo,
    skill_name: skillName,
    platform: platformText,
  });
}
