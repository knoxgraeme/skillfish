/**
 * Agent configuration and detection logic.
 * Supports all agents from the Agent Skills specification: https://agentskills.io
 */

import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Agent configuration - data-driven for easier maintenance.
 * Detection checks home directory (agent installed globally) and cwd (local project).
 */
export type AgentConfig = {
  readonly name: string;
  readonly dir: string;
  readonly homePaths: readonly string[]; // Paths to check in ~/
  readonly cwdPaths: readonly string[]; // Paths to check in ./
};

export const AGENT_CONFIGS: readonly AgentConfig[] = [
  // === Primary Agents (widely used) ===
  {
    name: 'Claude Code',
    dir: '.claude/skills',
    homePaths: ['.claude/settings.json', '.claude/projects.json', '.claude/credentials.json'],
    cwdPaths: ['.claude'],
  },
  {
    name: 'Cursor',
    dir: '.cursor/skills',
    homePaths: ['.cursor/extensions', '.cursor/argv.json'],
    cwdPaths: ['.cursor'],
  },
  {
    name: 'Windsurf',
    dir: '.codeium/windsurf/skills',
    homePaths: ['.codeium/windsurf/config.json', '.codeium/windsurf/argv.json'],
    cwdPaths: ['.codeium/windsurf'],
  },
  {
    name: 'Codex',
    dir: '.codex/skills',
    homePaths: ['.codex/config.json', '.codex/settings.json', '.codex'],
    cwdPaths: ['.codex'],
  },
  {
    name: 'GitHub Copilot',
    dir: '.github/skills',
    homePaths: ['.copilot/config.json', '.copilot'],
    cwdPaths: ['.github/skills', '.github/copilot-instructions.md'],
  },
  {
    name: 'Gemini CLI',
    dir: '.gemini/skills',
    homePaths: ['.gemini'],
    cwdPaths: ['.gemini'],
  },
  {
    name: 'OpenCode',
    dir: '.opencode/skills',
    homePaths: ['.config/opencode', '.opencode'],
    cwdPaths: ['.opencode'],
  },
  {
    name: 'Goose',
    dir: '.goose/skills',
    homePaths: ['.config/goose'],
    cwdPaths: ['.goose'],
  },
  // === Secondary Agents ===
  {
    name: 'Amp',
    dir: '.agents/skills',
    homePaths: ['.config/amp'],
    cwdPaths: ['.agents'],
  },
  {
    name: 'Roo Code',
    dir: '.roo/skills',
    homePaths: ['.roo'],
    cwdPaths: ['.roo'],
  },
  {
    name: 'Kiro CLI',
    dir: '.kiro/skills',
    homePaths: ['.kiro'],
    cwdPaths: ['.kiro'],
  },
  {
    name: 'Kilo Code',
    dir: '.kilocode/skills',
    homePaths: ['.kilocode'],
    cwdPaths: ['.kilocode'],
  },
  {
    name: 'Trae',
    dir: '.trae/skills',
    homePaths: ['.trae'],
    cwdPaths: ['.trae'],
  },
  {
    name: 'Cline',
    dir: '.cline/skills',
    homePaths: ['.cline/settings.json', '.cline'],
    cwdPaths: ['.cline'],
  },
  // === Additional Agents ===
  {
    name: 'Antigravity',
    dir: '.gemini/antigravity/skills',
    homePaths: ['.gemini/antigravity'],
    cwdPaths: ['.agent'],
  },
  {
    name: 'Droid',
    dir: '.factory/skills',
    homePaths: ['.factory'],
    cwdPaths: ['.factory'],
  },
  {
    name: 'Clawdbot',
    dir: '.clawdbot/skills',
    homePaths: ['.clawdbot'],
    cwdPaths: ['.clawdbot'],
  },
];

/**
 * Check if an agent is detected on the system.
 * Checks home directory paths first, then current working directory paths.
 */
export function detectAgent(config: AgentConfig, baseDir?: string): boolean {
  const home = homedir();
  const cwd = baseDir ?? process.cwd();

  return (
    config.homePaths.some((p) => existsSync(join(home, p))) ||
    config.cwdPaths.some((p) => existsSync(join(cwd, p)))
  );
}

/**
 * Runtime agent type with detect function.
 */
export type Agent = {
  readonly name: string;
  readonly dir: string;
  readonly detect: () => boolean;
};

/**
 * Build AGENTS array from config (preserves existing API).
 */
export function buildAgents(baseDir?: string): readonly Agent[] {
  return AGENT_CONFIGS.map((config) => ({
    name: config.name,
    dir: config.dir,
    detect: () => detectAgent(config, baseDir),
  }));
}

/**
 * Get all detected agents.
 */
export function getDetectedAgents(baseDir?: string): readonly Agent[] {
  return buildAgents(baseDir).filter((a) => a.detect());
}

/**
 * Get the skill directory path for an agent.
 */
export function getAgentSkillDir(agent: Agent | AgentConfig, baseDir: string): string {
  return join(baseDir, agent.dir);
}
