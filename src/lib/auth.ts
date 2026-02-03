/**
 * Authentication utilities for skillfish CLI.
 *
 * Handles token storage, retrieval, and validation for the skillfish.io API.
 * Follows XDG Base Directory specification for config file locations.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { fetchWithRetry } from './http.js';

// === Constants ===

/** Environment variable for token override */
const TOKEN_ENV_VAR = 'SKILLFISH_TOKEN';

/** Token prefix for validation */
const TOKEN_PREFIX = 'sk_user_';

/** Token format regex: sk_user_ followed by 32-128 alphanumeric characters */
const TOKEN_PATTERN = /^sk_user_[a-zA-Z0-9]{32,128}$/;

/** API endpoint for token validation */
const API_BASE_URL = 'https://skill.fish/api/v1';

/** File permissions: owner read/write only */
const FILE_MODE = 0o600;

/** Directory permissions: owner only */
const DIR_MODE = 0o700;

// === Types ===

/** Result of token validation against the API */
export type TokenValidationResult =
  | { valid: true; user: string; email: string }
  | { valid: false; error: 'invalid_token' | 'expired' | 'network_error'; message: string };

/** Source of the token (environment variable or file) */
export type TokenSource = 'env' | 'file';

/** Token with its source */
export interface TokenInfo {
  token: string;
  source: TokenSource;
}

/** Credentials file schema */
interface Credentials {
  token: string;
}

// === Error Classes ===

/**
 * Error thrown for authentication-related failures.
 */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

// === Path Functions ===

/**
 * Get XDG-compliant config directory for skillfish.
 * - Linux/macOS: ~/.config/skillfish (or $XDG_CONFIG_HOME/skillfish)
 * - Windows: %APPDATA%\skillfish
 */
export function getConfigDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? homedir(), 'skillfish');
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'skillfish');
}

/**
 * Get path to the credentials file.
 */
export function getCredentialsPath(): string {
  return join(getConfigDir(), 'credentials.json');
}

// === Token Operations ===

/**
 * Get the current token, checking environment variable first.
 * @returns Token info with source, or null if not authenticated
 */
export function getToken(): TokenInfo | null {
  // Environment variable takes precedence
  const envToken = process.env[TOKEN_ENV_VAR];
  if (envToken) {
    return { token: envToken, source: 'env' };
  }

  // Fall back to stored credentials
  const storedToken = readStoredToken();
  if (storedToken) {
    return { token: storedToken, source: 'file' };
  }

  return null;
}

/**
 * Read token from the credentials file.
 * @returns Token string or null if not found/invalid
 */
function readStoredToken(): string | null {
  const credentialsPath = getCredentialsPath();

  if (!existsSync(credentialsPath)) {
    return null;
  }

  try {
    const content = readFileSync(credentialsPath, 'utf-8');
    const data = JSON.parse(content) as unknown;

    if (!isValidCredentials(data)) {
      return null;
    }

    return data.token;
  } catch {
    // JSON parse error or file read error
    return null;
  }
}

/**
 * Store a token in the credentials file.
 * Creates the config directory if it doesn't exist.
 * Uses atomic write (temp file + rename) to prevent corruption.
 *
 * @param token - The token to store
 * @throws Error if write fails
 */
export async function storeToken(token: string): Promise<void> {
  const configDir = getConfigDir();
  const credentialsPath = getCredentialsPath();
  const tempPath = join(configDir, `.credentials.json.tmp.${process.pid}`);

  // Ensure config directory exists with secure permissions
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: DIR_MODE });
  }

  const credentials: Credentials = { token };
  const content = JSON.stringify(credentials, null, 2);

  try {
    // Write to temp file with secure permissions
    writeFileSync(tempPath, content, { encoding: 'utf-8', mode: FILE_MODE });
    // Atomic rename
    renameSync(tempPath, credentialsPath);
  } catch (err) {
    // Clean up temp file on failure
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Remove stored credentials.
 * @returns true if credentials were removed, false if they didn't exist
 */
export async function clearToken(): Promise<boolean> {
  const credentialsPath = getCredentialsPath();

  if (!existsSync(credentialsPath)) {
    return false;
  }

  try {
    unlinkSync(credentialsPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if environment variable is set (for logout warning).
 */
export function isEnvTokenSet(): boolean {
  return !!process.env[TOKEN_ENV_VAR];
}

// === Token Validation ===

/**
 * Validate token format locally.
 * @param token - Token to validate
 * @returns true if format is valid
 */
export function isValidTokenFormat(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/**
 * Get the expected token prefix for error messages.
 */
export function getTokenPrefix(): string {
  return TOKEN_PREFIX;
}

/**
 * Validate a token against the API.
 * @param token - Token to validate
 * @returns Validation result with user info or error
 */
export async function validateToken(token: string): Promise<TokenValidationResult> {
  try {
    const response = await fetchWithRetry(`${API_BASE_URL}/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (response.ok) {
      const data = (await response.json()) as unknown;

      // Validate response structure
      if (isValidUserResponse(data)) {
        return {
          valid: true,
          user: data.username ?? data.name ?? 'unknown',
          email: data.email ?? '',
        };
      }

      return {
        valid: false,
        error: 'invalid_token',
        message: 'Invalid response from API',
      };
    }

    // Handle specific error codes
    if (response.status === 401) {
      return {
        valid: false,
        error: 'invalid_token',
        message: 'Invalid or expired token',
      };
    }

    if (response.status === 403) {
      return {
        valid: false,
        error: 'expired',
        message: 'Token has been revoked',
      };
    }

    return {
      valid: false,
      error: 'network_error',
      message: `API returned status ${response.status}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      valid: false,
      error: 'network_error',
      message: `Network error: ${message}`,
    };
  }
}

// === Type Guards ===

/**
 * Type guard for credentials file structure.
 */
function isValidCredentials(data: unknown): data is Credentials {
  return (
    typeof data === 'object' &&
    data !== null &&
    'token' in data &&
    typeof (data as Record<string, unknown>).token === 'string'
  );
}

/**
 * Type guard for API user response.
 * Accepts responses with username or name field, plus optional email.
 */
function isValidUserResponse(
  data: unknown,
): data is { username?: string; name?: string; email?: string } {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  // Must have either username or name
  const hasIdentifier =
    (typeof obj.username === 'string' && obj.username.length > 0) ||
    (typeof obj.name === 'string' && obj.name.length > 0);
  // Email is optional but must be string if present
  const emailValid = obj.email === undefined || typeof obj.email === 'string';
  return hasIdentifier && emailValid;
}
