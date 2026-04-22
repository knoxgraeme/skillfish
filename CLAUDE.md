# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

skillfish is a CLI tool that installs AI agent skills from GitHub repositories. It supports 17+ AI agents including Claude Code, Cursor, Windsurf, Codex, Copilot, Gemini CLI, and others. Skills are markdown files (SKILL.md) that provide instructions to AI agents.

## Commands

```bash
# Build
npm run build          # Compile TypeScript to dist/

# Development
npm run dev            # Watch mode compilation
npm link               # Link for local testing, then run: skillfish add owner/repo

# Testing
npm test               # Run all tests once
npm run test:watch     # Watch mode
npx vitest run src/__tests__/utils.test.ts  # Run a single test file

# Code Quality
npm run lint           # Run ESLint
npm run lint:fix       # Run ESLint with auto-fix
npm run format         # Format with Prettier
npm run format:check   # Check formatting
npm run typecheck      # TypeScript type checking
```

## Architecture

### Entry Point & CLI Structure

- `src/index.ts` - CLI entry point using Commander.js, registers subcommands
- `src/commands/add.ts` - Install skills from GitHub repos
- `src/commands/init.ts` - Create new skill templates with SKILL.md and optional directories
- `src/commands/list.ts` - List installed skills
- `src/commands/remove.ts` - Remove installed skills
- `src/commands/update.ts` - Check for and apply updates to installed skills
- `src/commands/submit.ts` - Submit skills to the registry (accepts GitHub URLs or owner/repo)
- `src/commands/search.ts` - Search for skills in the registry
- `src/commands/bundle.ts` - Create `skillfish.json` manifest from installed skills (marks skills as manifest-managed)
- `src/commands/install.ts` - Install/sync skills from `skillfish.json` manifest (adds new, updates changed refs, removes stale)

### Core Libraries

- `src/lib/agents.ts` - Agent detection and configuration (AGENT_CONFIGS array defines all supported agents with their detection paths and skill directories)
- `src/lib/banner.ts` - ASCII art logo and banner display (`printBanner()` for commands, `getBannerText()` for Commander help text). Supports truecolor gradient with `NO_COLOR` fallback
- `src/lib/github.ts` - GitHub API functions (tree fetching, rate limit handling)
- `src/lib/http.ts` - Shared HTTP utilities (fetchWithRetry with timeout and exponential backoff)
- `src/lib/installer.ts` - Skill installation logic (downloads via giget tarball, validates SKILL.md exists, copies to agent directories)
- `src/lib/manifest.ts` - Per-skill manifest handling (reads/writes `.skillfish.json` inside each skill directory for tracking origin and version)
- `src/lib/project-manifest.ts` - Project manifest handling (reads/writes `skillfish.json` at project or home root for declarative skill installation)
- `src/lib/registry.ts` - Registry API client for skill submission and search (mcpmarket.com)
- `src/lib/constants.ts` - Exit codes (EXIT_CODES), machine-readable error codes (ERROR_CODES) for JSON output, and name validation utilities

### Utilities

- `src/utils.ts` - Pure functions for path validation, frontmatter parsing, type guards for GitHub API responses
- `src/telemetry.ts` - Anonymous install tracking (disabled with DO_NOT_TRACK=1 or CI=true)
- `src/lib/auth.ts` - GitHub token resolution (`getGitHubToken()`, `hasGitHubToken()`). Reads `SKILLFISH_GITHUB_TOKEN` > `GITHUB_TOKEN` > `GH_TOKEN`, falls back to `gh auth token`. Token is cached per-process; call `resetGitHubTokenCache()` in tests.

### Key Patterns

**Agent Detection**: Agents are detected by checking for config files in `~/` (global) and `./` (project). The `AGENT_CONFIGS` array in `agents.ts` defines detection paths for each agent.

**Dual Output Modes**: All commands support both interactive (TTY with @clack/prompts) and JSON modes (--json flag). JSON output includes structured exit_code and error arrays.

**Security**: Path validation prevents directory traversal attacks. Name validation (`isValidName()` in constants.ts) ensures owner/repo names only contain safe characters (`/^[\w.-]+$/`). The `init` command has its own stricter `isValidSkillName()` for authored skill names (lowercase, no dots, no consecutive separators, max 64 chars). Symlinks are skipped during copy operations. User confirmation is required before installation (bypass with --yes).

**Exit Codes**: 0=success, 1=general error, 2=invalid args, 3=network error, 4=not found

**Terminal Color Conventions**: When using raw ANSI escape sequences (e.g. truecolor `\x1b[38;2;...`), always check `NO_COLOR` env var (https://no-color.org) before emitting them. `picocolors` handles this automatically for its own functions, but raw escapes bypass it. The `banner.ts` module demonstrates the correct pattern with `isColorDisabled()`.

**Commander.js Help Styling**: Help styles are defined in `src/index.ts` as a typed `HelpConfiguration` object and propagated to all subcommands via a loop after `addCommand()` calls. The propagation loop must run after all commands are registered — this is an ordering dependency documented with a comment.

### Command Structure Convention

All commands in `src/commands/` follow this structure. New commands must match these conventions:

**File layout** (in order):
1. JSDoc comment: `` `skillfish <name>` command - Description ``
2. Imports (external, then internal libs, then utils/constants)
3. `// === Types ===` section with `<Name>CommandOptions` interface
4. Any command-specific types, constants, or pure functions
5. `// === Command Definition ===` with exported `const <name>Command`
6. `// === Helper Functions ===` section for extracted async helpers

**Inside the `.action()` callback:**
1. Read `jsonMode` and `version` from `command.parent?.opts()`
2. Initialize typed JSON output object (type defined in `utils.ts`, extending `BaseJsonOutput`)
3. Define inner helpers: `addError()`, `outputJsonAndExit()`, `exitWithError()`
4. Banner block: `if (isTTY() && !jsonMode) { printBanner(); p.intro(...); }` — **every command must use this exact guard pattern**, even if JSON mode exits earlier in the flow. Do not rely on control-flow-based guards (e.g. "JSON exits before this line"); always use the explicit `isTTY() && !jsonMode` check.
5. Read and destructure CLI options with `?? false` / `?? null` defaults
6. Command logic with `@clack/prompts` for interactive mode
7. Every prompt result checked with `p.isCancel()` → `p.cancel('Cancelled')` → `process.exit(EXIT_CODES.SUCCESS)`
8. JSON summary via `outputJsonAndExit()` before TTY summary
9. `process.exit()` at the end of the action

**Helper function signatures:** Functions like `selectInstallLocation(projectFlag, globalFlag, jsonMode)` and `selectAgents(agents, isLocal, jsonMode)` always accept `jsonMode` and guard any `@clack/prompts` log output with `if (!jsonMode)`.

**Non-TTY defaults:** `add` defaults to global (`homedir()`); `init` defaults to project (`process.cwd()`). When `--project`/`--global` are both passed, commands should reject with `EXIT_CODES.INVALID_ARGS`.

**JSON output types** are defined in `src/utils.ts` and extend `BaseJsonOutput` (`success`, `exit_code`, `errors`). Each command adds its own fields (e.g., `installed`, `created`, `removed`, `outdated`).

### Manifest System

Two distinct manifest files work together for skill tracking:

**Per-skill manifest** (`.skillfish.json` inside each skill directory):
- Tracks skill origin: `owner`, `repo`, `path`, `branch`, `sha`, `ref`
- `name` field (v2): installed directory name, used for matching
- `source` field: `'manifest'` or `'manual'` (undefined defaults to `'manual'`)
- Written by `installer.ts` during installation
- Key function: `getManifestKey(manifest)` returns `"owner/repo/path"` for matching

**Project manifest** (`skillfish.json` at project root or `~/`):
- Declarative list of skills to install: `{ "version": 1, "skills": ["owner/repo", "owner/repo@v1.0.0"] }`
- Created by `skillfish bundle`, consumed by `skillfish install`
- Key function: `buildManifestKey(owner, repo, path)` returns matching key format

**Critical: The `source` field determines removal behavior:**
- `source: 'manifest'` — skill can be auto-removed by `skillfish install` when removed from project manifest
- `source: 'manual'` (or undefined) — skill is protected from auto-removal
- `skillfish add` sets source to undefined (manual)
- `skillfish bundle` updates existing skills to `source: 'manifest'`
- `skillfish install` sets `source: 'manifest'` for new installs

**Removal logic** (`install.ts`): A skill is removed only if `source === 'manifest'` AND its key is NOT in the project manifest. This protects manually installed skills.

## Adding Agent Support

Add entry to `AGENT_CONFIGS` in `src/lib/agents.ts`:

```typescript
{
  name: 'Agent Name',
  dir: '.agent/skills',
  homePaths: ['.agent/config.json'],  // Files in ~/
  cwdPaths: ['.agent'],               // Files in ./
}
```

## Testing

Tests are in `src/__tests__/`. Tests focus on pure utility functions. Use Vitest assertions. Test files follow `*.test.ts` naming convention.

## Maintaining This File

Update CLAUDE.md when:
- Adding new commands (`src/commands/`)
- Adding new library modules (`src/lib/`)
- Changing exit codes or error handling patterns
- Modifying agent detection logic or adding new agents
- Adding new npm scripts
- Adding terminal output that uses raw ANSI escapes (document NO_COLOR compliance)
- Changing banner or help styling patterns
- Modifying manifest schema, matching logic, or `source` field behavior

Keep this file focused on architecture and patterns. User-facing documentation belongs in README.md.
