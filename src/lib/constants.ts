/**
 * Shared constants for skillfish CLI.
 */

// === Exit Codes ===

/**
 * Exit codes for skillfish CLI commands.
 *
 * These follow POSIX conventions where 0 is success and non-zero indicates error.
 * The specific codes help agents and scripts understand failure reasons without
 * parsing error messages.
 *
 * | Code | Constant        | Meaning                                        |
 * |------|-----------------|------------------------------------------------|
 * | 0    | SUCCESS         | Command completed successfully                 |
 * | 1    | GENERAL_ERROR   | Unspecified error (fallback)                   |
 * | 2    | INVALID_ARGS    | Invalid arguments or options provided          |
 * | 3    | NETWORK_ERROR   | Network failure (timeout, rate limit, etc.)    |
 * | 4    | NOT_FOUND       | Requested resource not found (skill, agent)    |
 */
export const EXIT_CODES = {
  /** Command completed successfully */
  SUCCESS: 0,
  /** Unspecified error (fallback) */
  GENERAL_ERROR: 1,
  /** Invalid arguments or options provided */
  INVALID_ARGS: 2,
  /** Network failure (timeout, rate limit, etc.) */
  NETWORK_ERROR: 3,
  /** Requested resource not found (skill, agent) */
  NOT_FOUND: 4,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

// === Error Codes (for JSON output) ===

/**
 * Structured error codes for JSON output.
 * These provide machine-readable error classification for automation.
 */
export const ERROR_CODES = {
  /** Invalid arguments or options */
  INVALID_ARGS: 'INVALID_ARGS',
  /** GitHub API rate limit exceeded */
  RATE_LIMITED: 'RATE_LIMITED',
  /** Repository not found on GitHub */
  REPO_NOT_FOUND: 'REPO_NOT_FOUND',
  /** Network timeout or connection error */
  NETWORK_ERROR: 'NETWORK_ERROR',
  /** SKILL.md not found in repository */
  SKILL_NOT_FOUND: 'SKILL_NOT_FOUND',
  /** No agents detected on system */
  NO_AGENTS: 'NO_AGENTS',
  /** User cancelled the operation */
  CANCELLED: 'CANCELLED',
  /** File system operation failed */
  FS_ERROR: 'FS_ERROR',
  /** General/unclassified error */
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// === Name Validation ===

/**
 * Pattern for validating safe names (owner, repo, skill, agent names).
 * Only allows alphanumeric characters, dots, hyphens, and underscores.
 */
export const SAFE_NAME_PATTERN = /^[\w.-]+$/;

/**
 * Validates a name against the safe name pattern.
 */
export function isValidName(name: string): boolean {
  return SAFE_NAME_PATTERN.test(name);
}
