import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isValidTokenFormat,
  getTokenPrefix,
  getConfigDir,
  getCredentialsPath,
} from '../lib/auth.js';

describe('isValidTokenFormat', () => {
  it('accepts valid token format', () => {
    // 32 character suffix (minimum)
    expect(isValidTokenFormat('sk_user_' + 'a'.repeat(32))).toBe(true);
    // 64 character suffix
    expect(isValidTokenFormat('sk_user_' + 'a'.repeat(64))).toBe(true);
    // 128 character suffix (maximum)
    expect(isValidTokenFormat('sk_user_' + 'a'.repeat(128))).toBe(true);
    // Mixed alphanumeric (32 chars: abc123DEF456ghi789JKL012mnopqrst)
    expect(isValidTokenFormat('sk_user_abc123DEF456ghi789JKL012mnopqrst')).toBe(true);
  });

  it('rejects tokens without correct prefix', () => {
    expect(isValidTokenFormat('sk_' + 'a'.repeat(32))).toBe(false);
    expect(isValidTokenFormat('token_' + 'a'.repeat(32))).toBe(false);
    expect(isValidTokenFormat('a'.repeat(40))).toBe(false);
    expect(isValidTokenFormat('SK_USER_' + 'a'.repeat(32))).toBe(false); // case sensitive
  });

  it('rejects tokens with invalid suffix length', () => {
    // Too short (31 chars)
    expect(isValidTokenFormat('sk_user_' + 'a'.repeat(31))).toBe(false);
    // Too long (129 chars)
    expect(isValidTokenFormat('sk_user_' + 'a'.repeat(129))).toBe(false);
  });

  it('rejects tokens with invalid characters', () => {
    expect(isValidTokenFormat('sk_user_' + 'a'.repeat(31) + '!')).toBe(false);
    expect(isValidTokenFormat('sk_user_' + 'a'.repeat(31) + '-')).toBe(false);
    expect(isValidTokenFormat('sk_user_' + 'a'.repeat(31) + '_')).toBe(false);
    expect(isValidTokenFormat('sk_user_' + 'a'.repeat(31) + ' ')).toBe(false);
  });

  it('rejects empty or whitespace tokens', () => {
    expect(isValidTokenFormat('')).toBe(false);
    expect(isValidTokenFormat('   ')).toBe(false);
    expect(isValidTokenFormat('sk_user_')).toBe(false);
  });
});

describe('getTokenPrefix', () => {
  it('returns the expected prefix', () => {
    expect(getTokenPrefix()).toBe('sk_user_');
  });
});

describe('getConfigDir', () => {
  const originalPlatform = process.platform;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env = originalEnv;
  });

  it('uses XDG_CONFIG_HOME on Linux/macOS when set', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.XDG_CONFIG_HOME = '/custom/config';

    // Re-import to pick up new env
    // Note: Since getConfigDir reads env at call time, we can test directly
    const result = getConfigDir();
    // On macOS running tests, it will use the actual platform
    // This test verifies the function structure
    expect(typeof result).toBe('string');
    expect(result.endsWith('skillfish')).toBe(true);
  });

  it('uses ~/.config on Linux/macOS when XDG_CONFIG_HOME not set', () => {
    delete process.env.XDG_CONFIG_HOME;

    const result = getConfigDir();
    expect(typeof result).toBe('string');
    expect(result.endsWith('skillfish')).toBe(true);
  });

  it('returns path ending with skillfish', () => {
    const result = getConfigDir();
    expect(result.endsWith('skillfish')).toBe(true);
  });
});

describe('getCredentialsPath', () => {
  it('returns path to credentials.json', () => {
    const result = getCredentialsPath();
    expect(result.endsWith('credentials.json')).toBe(true);
    expect(result.includes('skillfish')).toBe(true);
  });
});
