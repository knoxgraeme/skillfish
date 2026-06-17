/**
 * Tests for the registry API client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { submitSkillsToRegistry, searchSkillsInRegistry } from '../lib/registry.js';

// Helper to build a mock Response
function mockResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  const headersObj = new Headers({ 'content-type': 'text/plain', ...headers });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  } as unknown as Response;
}

describe('submitSkillsToRegistry', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a clear rate-limit error on 429 without retry-after', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(429, 'Too Many Requests'));

    const result = await submitSkillsToRegistry([
      {
        url: 'https://github.com/owner/repo',
        owner: 'owner',
        repo: 'repo',
        skill: 'repo',
        path: '',
      },
    ]);

    expect(result.success).toBe(false);
    expect(result.submitted[0].error).toMatch(/rate limit exceeded/i);
    expect(result.submitted[0].error).toContain('429');
    expect(result.submitted[0].error).not.toContain('non-JSON');
  });

  it('includes retry-after hint when header is present on 429', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse(429, 'Too Many Requests', { 'retry-after': '60' }),
    );

    const result = await submitSkillsToRegistry([
      {
        url: 'https://github.com/owner/repo',
        owner: 'owner',
        repo: 'repo',
        skill: 'repo',
        path: '',
      },
    ]);

    expect(result.submitted[0].error).toContain('60 seconds');
  });
});

describe('searchSkillsInRegistry', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a clear rate-limit error on 429 without retry-after', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(429, 'Too Many Requests'));

    const result = await searchSkillsInRegistry('some-query');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rate limit exceeded/i);
    expect(result.error).toContain('429');
    expect(result.error).not.toContain('non-JSON');
  });

  it('includes retry-after hint when header is present on 429', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse(429, 'Too Many Requests', { 'retry-after': '30' }),
    );

    const result = await searchSkillsInRegistry('some-query');

    expect(result.error).toContain('30 seconds');
  });
});
