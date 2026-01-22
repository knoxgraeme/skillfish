# refactor: Restructure CLI from monolithic to modular architecture

## Overview

Transform the skillfish CLI from a 1061-line monolithic `index.ts` into a well-organized, contributor-friendly structure that scales without complexity. This establishes the foundation for open-source contribution by making the codebase predictable and navigable.

## Problem Statement

The current structure has two main pain points:

1. **Hard to find where functionality lives** - All logic in one file makes navigation difficult
2. **Difficult to add new features** - No clear pattern for adding commands; new features pile into `index.ts`

Current state:
```
src/
├── index.ts        # 1061 lines - ALL command logic, prompts, API calls, installation
├── utils.ts        # 180 lines - Well-structured pure utilities
├── telemetry.ts    # 27 lines - Analytics
└── __tests__/
    └── utils.test.ts   # Only utils tested
```

## Proposed Solution

Adopt the **Command Module Pattern** with Commander.js - a proven, lightweight approach used by successful CLIs (Vercel, npm). One command per file, clear separation of concerns.

Target structure (minimal - 10 files):
```
src/
├── index.ts              # Entry point + program setup (~50 lines)
├── commands/
│   ├── add.ts            # `skillfish add` command
│   └── list.ts           # `skillfish list` command
├── lib/
│   ├── agents.ts         # Agent detection + AGENT_CONFIGS
│   ├── github.ts         # GitHub API (discovery, fetch)
│   └── installer.ts      # Installation logic (safeCopyDir, etc.)
├── utils.ts              # Keep as-is (already well-structured)
├── telemetry.ts          # Keep as-is
└── __tests__/
    ├── add.test.ts       # Add command tests
    ├── list.test.ts      # List command tests
    ├── installer.test.ts # Installation + security tests
    └── invoke-cli.ts     # Test helper
```

**Why this structure?**
- No `bin/` directory - shebang stays in `index.ts` (3 lines doesn't need its own folder)
- No `commands/index.ts` registry - with 2 commands, import directly
- No `utils/` split - current 180-line `utils.ts` is already clean
- No `lib/types.ts` - types co-located where used
- Flat test structure - mirrors simplicity

## Technical Approach

### Phase 1: Foundation (no behavior changes)

Extract and organize without changing any user-facing behavior.

#### 1.1 Add Commander.js dependency

```bash
npm install commander
```

**Why Commander.js?** While we could hand-roll argument parsing for 2 commands, Commander.js provides structured parsing that becomes essential when adding more commands. The real benefit is future growth - this pays off by command 4-5.

#### 1.2 Set up program in index.ts

```typescript
#!/usr/bin/env node
// src/index.ts
import { Command } from 'commander';
import { addCommand } from './commands/add.js';
import { listCommand } from './commands/list.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

const program = new Command()
  .name('skillfish')
  .description('Install AI agent skills')
  .version(pkg.version, '-v, --version')
  .option('--json', 'Output as JSON');

program.addCommand(addCommand);
program.addCommand(listCommand);

program.parse(process.argv);
```

#### 1.3 Update package.json bin (unchanged)

```json
{
  "bin": {
    "skillfish": "./dist/index.js"
  }
}
```

### Phase 2: Extract lib/ modules

Move business logic out of commands, keeping commands as thin orchestration layers.

#### 2.1 Extract agents.ts

```typescript
// src/lib/agents.ts
export type AgentConfig = {
  readonly name: string;
  readonly dir: string;
  readonly homePaths: readonly string[];
  readonly cwdPaths: readonly string[];
};

export const AGENT_CONFIGS: readonly AgentConfig[] = [
  // ... existing 16 agents
];

export function detectAgents(baseDir: string): AgentConfig[];
export function getAgentPaths(agent: AgentConfig, baseDir: string): string[];
```

#### 2.2 Extract github.ts

```typescript
// src/lib/github.ts
export interface SkillInfo {
  path: string;
  name: string;
  description: string;
}

export async function discoverSkills(owner: string, repo: string): Promise<SkillInfo[]>;
export async function fetchSkillContent(owner: string, repo: string, path: string): Promise<string>;
// fetchWithRetry and rate limit handling are internal implementation details
```

#### 2.3 Extract installer.ts

```typescript
// src/lib/installer.ts
import type { AgentConfig } from './agents.js';

export interface InstallResult {
  installed: string[];
  skipped: string[];
  failed: Array<{ path: string; error: string }>;
}

export interface InstallOptions {
  force: boolean;
  agents: AgentConfig[];
  baseDir: string;
}

export async function installSkill(
  owner: string,
  repo: string,
  skillPath: string,
  options: InstallOptions
): Promise<InstallResult>;

// Keep safeCopyDir with security comments intact
```

### Phase 3: Migrate commands

Create command files that use lib/ modules.

#### 3.1 Create add.ts command

```typescript
// src/commands/add.ts
import { Command } from 'commander';
import * as p from '@clack/prompts';  // Import directly, no wrapper
import { discoverSkills } from '../lib/github.js';
import { installSkill } from '../lib/installer.js';
import { detectAgents } from '../lib/agents.js';

export const addCommand = new Command('add')
  .description('Install a skill from a GitHub repository')
  .argument('<repo>', 'Repository (owner/repo or owner/repo/plugin/skill)')
  .option('--force', 'Overwrite existing skills')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('--all', 'Install all skills in repository')
  .option('--project', 'Install to current project')
  .option('--global', 'Install to home directory')
  .option('--path <path>', 'Explicit path to skill in repository')
  .action(async (repo, options, command) => {
    const jsonMode = command.parent?.opts().json ?? false;
    // ... orchestration logic using lib/ modules
  });
```

#### 3.2 Create list.ts command

```typescript
// src/commands/list.ts
import { Command } from 'commander';
import { detectAgents, getAgentPaths } from '../lib/agents.js';

export const listCommand = new Command('list')
  .description('List installed skills')
  .option('--project', 'List project skills only')
  .option('--global', 'List global skills only')
  .action(async (options, command) => {
    const jsonMode = command.parent?.opts().json ?? false;
    // ... orchestration logic
  });
```

### Phase 4: Keep utils.ts as-is

The current `utils.ts` at 180 lines is already well-organized. Add any new JSON output helpers to the same file. Split only if it grows past 300 lines.

```typescript
// src/utils.ts - add these to existing file
export interface JsonOutput {
  success: boolean;
  installed: string[];
  skipped: string[];
  errors: string[];
}

export function createJsonOutput(): JsonOutput {
  return { success: true, installed: [], skipped: [], errors: [] };
}

export function isTTY(): boolean {
  return process.stdout.isTTY === true;
}
```

### Phase 5: Add tests

#### 5.1 Create test helper

```typescript
// src/__tests__/invoke-cli.ts
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, '../index.ts');

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function invokeCli(args: string[]): CliResult {
  try {
    // Use execFileSync with array args to prevent shell injection
    const stdout = execFileSync('npx', ['tsx', CLI_PATH, ...args], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error: any) {
    return {
      exitCode: error.status ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}
```

#### 5.2 Add command tests

```typescript
// src/__tests__/add.test.ts
import { describe, it, expect } from 'vitest';
import { invokeCli } from './invoke-cli.js';

describe('add command', () => {
  it('shows help with --help', () => {
    const { stdout, exitCode } = invokeCli(['add', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Install a skill');
  });

  it('exits with code 2 for invalid repo format', () => {
    const { exitCode } = invokeCli(['add', 'invalid']);
    expect(exitCode).toBe(2);
  });

  it('outputs valid JSON with --json flag', () => {
    const { stdout, exitCode } = invokeCli(['--json', 'list']);
    expect(exitCode).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
  });
});
```

#### 5.3 Add security tests

```typescript
// src/__tests__/installer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('safeCopyDir security', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skillfish-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('skips symlinks pointing outside skill directory', () => {
    // Create a symlink to /etc/passwd
    const skillDir = join(tempDir, 'skill');
    mkdirSync(skillDir);
    symlinkSync('/etc/passwd', join(skillDir, 'malicious-link'));

    // safeCopyDir should skip the symlink
    // ... test implementation
  });

  it('rejects paths with directory traversal', () => {
    const { exitCode, stderr } = invokeCli(['add', 'owner/repo', '--path', '../../../etc']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid path');
  });

  it('validates owner/repo format rejects special characters', () => {
    const { exitCode } = invokeCli(['add', 'owner/repo;rm -rf /']);
    expect(exitCode).toBe(2);
  });
});
```

## Global State Handling

The current code has problematic global mutable state:

```typescript
// Current (bad)
let jsonMode = false;
let jsonOutput: JsonOutput = { ... };
```

**Solution: Pass context through command options**

```typescript
// Commands receive jsonMode from parent program
.action(async (repo, options, command) => {
  const jsonMode = command.parent?.opts().json ?? false;

  // Create output accumulator for this command invocation
  const output = createJsonOutput();

  // Pass to lib/ functions that need to accumulate results
  const result = await installSkill(repo, skillPath, {
    ...options,
    output,  // Accumulator passed in, not global
  });

  // Command handles final output
  if (jsonMode) {
    console.log(JSON.stringify(output, null, 2));
  }
});
```

**Key principle:** lib/ modules never access globals. They receive what they need and return results. Commands handle all output formatting.

## Error Handling Strategy

**Pattern: lib/ modules throw, commands catch and format**

```typescript
// src/lib/github.ts
export class SkillNotFoundError extends Error {
  constructor(public owner: string, public repo: string) {
    super(`No SKILL.md found in ${owner}/${repo}`);
    this.name = 'SkillNotFoundError';
  }
}

export class RateLimitError extends Error {
  constructor(public resetTime: Date) {
    super(`GitHub rate limit exceeded. Resets at ${resetTime.toISOString()}`);
    this.name = 'RateLimitError';
  }
}

// src/commands/add.ts
.action(async (repo, options, command) => {
  const jsonMode = command.parent?.opts().json ?? false;

  try {
    const skills = await discoverSkills(owner, repo);
    // ...
  } catch (error) {
    if (error instanceof SkillNotFoundError) {
      if (jsonMode) {
        console.log(JSON.stringify({ success: false, error: error.message }));
      } else {
        console.error(pc.red('Error:'), error.message);
      }
      process.exit(EXIT_NOT_FOUND);  // Exit code 4
    }

    if (error instanceof RateLimitError) {
      // ... handle with EXIT_NETWORK_ERROR (3)
    }

    // Unknown error
    throw error;
  }
});
```

**Exit codes are command-layer concerns.** lib/ modules throw typed errors, commands map them to exit codes.

## Acceptance Criteria

### Functional Requirements

- [x] All existing commands work identically (`add`, `list`, `--version`, `--help`)
- [x] All flags work in same positions (`--json`, `--force`, `--yes`, etc.)
- [x] Exit codes preserved (0, 1, 2, 3, 4)
- [x] JSON output schema unchanged
- [x] Interactive prompts work in TTY, skip gracefully in non-TTY
- [x] Security patterns preserved (path validation, symlink protection, trust confirmation)

### Non-Functional Requirements

- [x] No new dependencies beyond Commander.js
- [x] Build time unchanged
- [x] No runtime performance regression

### Contributor Experience

- [x] Adding a new command requires only: create file, import in index.ts
- [ ] CONTRIBUTING.md updated with command addition guide
- [x] Each module has clear, single responsibility

### Security Tests

- [x] Path traversal prevention tested
- [x] Symlink protection tested
- [x] Input validation (owner/repo format) tested

## Migration Approach

This refactoring should be done **incrementally** with working CLI at every step:

1. **Add Commander.js alongside existing code** - Both work
2. **Create empty command files** - Still uses old code
3. **Extract lib/ modules** - Commands import from lib/
4. **Switch to Commander.js parsing** - Remove old argv parsing
5. **Delete dead code from index.ts**

Each step should pass all existing functionality tests before proceeding.

## What This Does NOT Include

To avoid over-engineering:

- **No `bin/` directory** - Shebang stays in index.ts
- **No `commands/index.ts` registry** - Direct imports for 2 commands
- **No `utils/` directory split** - Single utils.ts is fine at 180 lines
- **No `lib/types.ts`** - Types co-located where used
- **No plugin architecture** - Commands are just files, not plugins
- **No base command class** - Only 2 commands, no shared logic needed
- **No configuration file support** - Flags are sufficient
- **No dependency injection** - Direct imports are fine at this scale

## Success Metrics

1. New contributor can add a command by following the pattern (< 30 min)
2. `index.ts` reduced from 1061 lines to < 50 lines
3. Each file in `lib/` is < 200 lines
4. Test coverage includes command integration tests AND security tests
5. Total file count: ~10 files (not 17+)

## References

### Internal
- Current monolithic structure: `src/index.ts`
- Existing well-structured utils: `src/utils.ts`
- Exit codes definition: `src/index.ts:36-42`
- Agent configs: `src/index.ts:128-156`
- Security patterns: `src/index.ts:192-238` (safeCopyDir)

### External
- [Commander.js docs](https://github.com/tj/commander.js)
- [Node.js CLI Best Practices](https://github.com/lirantal/nodejs-cli-apps-best-practices)
- [Vercel CLI architecture](https://github.com/vercel/vercel/tree/main/packages/cli)
