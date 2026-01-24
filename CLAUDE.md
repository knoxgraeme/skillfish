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
```

## Architecture

### Entry Point & CLI Structure

- `src/index.ts` - CLI entry point using Commander.js, registers subcommands
- `src/commands/add.ts` - Install skills from GitHub repos
- `src/commands/list.ts` - List installed skills
- `src/commands/remove.ts` - Remove installed skills

### Core Libraries

- `src/lib/agents.ts` - Agent detection and configuration (AGENT_CONFIGS array defines all supported agents with their detection paths and skill directories)
- `src/lib/github.ts` - GitHub API functions (tree fetching, rate limit handling, retry logic with exponential backoff)
- `src/lib/installer.ts` - Skill installation logic (downloads via giget tarball, validates SKILL.md exists, copies to agent directories)
- `src/lib/constants.ts` - Exit codes and error codes for structured output

### Utilities

- `src/utils.ts` - Pure functions for path validation, frontmatter parsing, type guards for GitHub API responses
- `src/telemetry.ts` - Anonymous install tracking (disabled with DO_NOT_TRACK=1 or CI=true)

### Key Patterns

**Agent Detection**: Agents are detected by checking for config files in `~/` (global) and `./` (project). The `AGENT_CONFIGS` array in `agents.ts` defines detection paths for each agent.

**Dual Output Modes**: All commands support both interactive (TTY with @clack/prompts) and JSON modes (--json flag). JSON output includes structured exit_code and error arrays.

**Security**: Path validation prevents directory traversal attacks. Symlinks are skipped during copy operations. User confirmation is required before installation (bypass with --yes).

**Exit Codes**: 0=success, 1=general error, 2=invalid args, 3=network error, 4=not found

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
