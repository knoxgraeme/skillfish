/**
 * Command-level tests for `skillfish add --agent` routing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { addCommand } from '../commands/add.js';
import { getDetectedAgentsForLocation, type Agent } from '../lib/agents.js';
import { fetchDefaultBranch, fetchTreeSha } from '../lib/github.js';
import { installSkill } from '../lib/installer.js';

vi.mock('../lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/agents.js')>();
  return { ...actual, getDetectedAgentsForLocation: vi.fn() };
});

vi.mock('../lib/github.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/github.js')>();
  return {
    ...actual,
    fetchDefaultBranch: vi.fn(),
    fetchTreeSha: vi.fn(),
  };
});

vi.mock('../lib/installer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/installer.js')>();
  return { ...actual, installSkill: vi.fn() };
});

vi.mock('../telemetry.js', () => ({
  trackCommand: vi.fn(),
  trackInstall: vi.fn(),
}));

const mockGetDetectedAgents = vi.mocked(getDetectedAgentsForLocation);
const mockFetchDefaultBranch = vi.mocked(fetchDefaultBranch);
const mockFetchTreeSha = vi.mocked(fetchTreeSha);
const mockInstallSkill = vi.mocked(installSkill);

class ProcessExit extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

const detectedAgents: readonly Agent[] = [
  { name: 'Claude Code', dir: '.claude/skills', detect: () => true },
  { name: 'Cursor', dir: '.cursor/skills', detect: () => true },
  { name: 'Codex', dir: '.codex/skills', detect: () => true },
];

const program = new Command().option('--json');
program.setOptionValue('json', true);
program.setOptionValue('version', 'test');
program.addCommand(addCommand);

async function runAdd(args: string[]): Promise<{ exitCode: number; output: unknown }> {
  const output: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
    output.push(String(message));
  });
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new ProcessExit(typeof code === 'number' ? code : Number(code ?? 0));
  });

  for (const option of ['force', 'yes', 'all', 'project', 'global', 'path']) {
    addCommand.setOptionValue(option, undefined);
  }
  addCommand.setOptionValue('agent', undefined);

  let exitCode = -1;
  try {
    await program.parseAsync(['node', 'skillfish', 'add', ...args]);
  } catch (error) {
    if (!(error instanceof ProcessExit)) {
      throw error;
    }
    exitCode = error.code;
  }

  return { exitCode, output: JSON.parse(output.at(-1) ?? '{}') };
}

describe('add command agent routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDetectedAgents.mockReturnValue(detectedAgents);
    mockFetchDefaultBranch.mockResolvedValue('main');
    mockFetchTreeSha.mockResolvedValue('root-sha');
    mockInstallSkill.mockResolvedValue({
      installed: [],
      skipped: [],
      warnings: [],
      failed: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes only repeated requested agents to the installer', async () => {
    const result = await runAdd([
      'owner/repo',
      '--path',
      'skills/example',
      '--global',
      '--agent',
      'claude code',
      '--agent',
      'Cursor',
      '--agent',
      'CLAUDE CODE',
    ]);

    expect(result.exitCode).toBe(0);
    expect(mockInstallSkill).toHaveBeenCalledOnce();
    expect(mockInstallSkill.mock.calls[0][4].map((agent) => agent.name)).toEqual([
      'Claude Code',
      'Cursor',
    ]);
  });

  it('rejects mixed valid and unknown agents before installation', async () => {
    const result = await runAdd([
      'owner/repo',
      '--path',
      'skills/example',
      '--global',
      '--agent',
      'Cursor',
      '--agent',
      'Unknown Agent',
    ]);

    expect(result.exitCode).toBe(4);
    expect(mockInstallSkill).not.toHaveBeenCalled();
    expect(result.output).toMatchObject({
      success: false,
      exit_code: 4,
      errors: [expect.stringContaining('Unknown Agent')],
    });
  });

  it('passes all detected agents when --agent is omitted', async () => {
    const result = await runAdd(['owner/repo', '--path', 'skills/example', '--global']);

    expect(result.exitCode).toBe(0);
    expect(mockInstallSkill).toHaveBeenCalledOnce();
    expect(mockInstallSkill.mock.calls[0][4].map((agent) => agent.name)).toEqual([
      'Claude Code',
      'Cursor',
      'Codex',
    ]);
  });
});
