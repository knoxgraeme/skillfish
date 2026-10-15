/**
 * Tests for registry search error handling.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchSkillsInRegistry } from '../lib/registry.js';

function mockJsonResponse(body: unknown, status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

describe('searchSkillsInRegistry error handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns string error when API error is a string', async () => {
    mockJsonResponse({ error: 'Bad query' }, 400);
    const res = await searchSkillsInRegistry('x');
    expect(res.success).toBe(false);
    expect(res.error).toBe('Bad query');
  });

  it('coerces object error with message to a string', async () => {
    mockJsonResponse({ error: { message: 'Rate limited', code: 42 } }, 429);
    const res = await searchSkillsInRegistry('x');
    expect(res.success).toBe(false);
    expect(typeof res.error).toBe('string');
    expect(res.error).toBe('Rate limited');
  });

  it('falls back to status message for non-string error without message', async () => {
    mockJsonResponse({ error: { code: 42 } }, 403);
    const res = await searchSkillsInRegistry('x');
    expect(res.error).toBe('Registry error: 403');
  });
});
