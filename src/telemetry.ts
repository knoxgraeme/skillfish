const SUPABASE_URL = 'https://wulqksgnqhecytjqllyw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1bHFrc2ducWhlY3l0anFsbHl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI3MTQyMzQsImV4cCI6MjA1ODI5MDIzNH0.wNKfhgboViKNBWDr1AFsguh8y5hL0tXFH6oaUI5BMS0';

/**
 * Track a skill install. Fire-and-forget - never blocks or throws.
 *
 * NOTE: Due to Node.js event loop behavior, this request may not complete
 * if the CLI process exits immediately after calling. This is acceptable
 * for directional metrics (like npm download counts).
 *
 * @param github Full GitHub path matching the skills.github column (e.g., owner/repo/path/to/skill)
 */
export function trackInstall(github: string): void {
  try {
    if (process.env.DO_NOT_TRACK === '1' || process.env.CI === 'true') return;
    if (!github || github.length > 500) return;

    fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_skill_install`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_github: github }),
    }).catch(() => {});
  } catch {
    // Telemetry should never throw
  }
}
