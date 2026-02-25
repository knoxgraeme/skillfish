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
export interface AgentConfig {
  readonly name: string;
  readonly dir: string;
  readonly homePaths: readonly string[]; // Paths to check in ~/
  readonly cwdPaths: readonly string[]; // Paths to check in ./
}

export const AGENT_CONFIGS: readonly AgentConfig[] = [
  // === Primary Agents (widely used) ===
  {
    name: 'Claude Code',
    dir: '.claude/skills',
    homePaths: ['.claude'],
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
    name: 'Augment',
    dir: '.augment/rules',
    homePaths: ['.augment'],
    cwdPaths: ['.augment'],
  },
  {
    name: 'OpenClaw',
    dir: 'skills',
    homePaths: ['.moltbot'],
    cwdPaths: ['skills'],
  },
  {
    name: 'CodeBuddy',
    dir: '.codebuddy/skills',
    homePaths: ['.codebuddy'],
    cwdPaths: ['.codebuddy'],
  },
  {
    name: 'Command Code',
    dir: '.commandcode/skills',
    homePaths: ['.commandcode'],
    cwdPaths: ['.commandcode'],
  },
  {
    name: 'Crush',
    dir: '.crush/skills',
    homePaths: ['.config/crush'],
    cwdPaths: ['.crush'],
  },
  {
    name: 'Kode',
    dir: '.kode/skills',
    homePaths: ['.kode'],
    cwdPaths: ['.kode'],
  },
  {
    name: 'Mistral Vibe',
    dir: '.vibe/skills',
    homePaths: ['.vibe'],
    cwdPaths: ['.vibe'],
  },
  {
    name: 'Mux',
    dir: '.mux/skills',
    homePaths: ['.mux'],
    cwdPaths: ['.mux'],
  },
  {
    name: 'OpenClaude IDE',
    dir: '.openclaude/skills',
    homePaths: ['.openclaude'],
    cwdPaths: ['.openclaude'],
  },
  {
    name: 'OpenHands',
    dir: '.openhands/skills',
    homePaths: ['.openhands'],
    cwdPaths: ['.openhands'],
  },
  {
    name: 'Qoder',
    dir: '.qoder/skills',
    homePaths: ['.qoder'],
    cwdPaths: ['.qoder'],
  },
  {
    name: 'Qwen Code',
    dir: '.qwen/skills',
    homePaths: ['.qwen'],
    cwdPaths: ['.qwen'],
  },
  {
    name: 'Replit',
    dir: '.agent/skills',
    homePaths: [], // Project-only agent
    cwdPaths: ['.agent', '.replit'],
  },
  {
    name: 'Trae CN',
    dir: '.trae/skills',
    homePaths: ['.trae-cn'],
    cwdPaths: ['.trae'],
  },
  {
    name: 'Neovate',
    dir: '.neovate/skills',
    homePaths: ['.neovate'],
    cwdPaths: ['.neovate'],
  },
  {
    name: 'AdaL',
    dir: '.adal/skills',
    homePaths: ['.adal'],
    cwdPaths: ['.adal'],
  },
];

/**
 * Check if an agent is installed globally (in home directory).
 */
export function detectAgentGlobally(config: AgentConfig): boolean {
  const home = homedir();
  return config.homePaths.some((p) => existsSync(join(home, p)));
}

/**
 * Check if an agent is configured in a specific project directory.
 */
export function detectAgentInProject(config: AgentConfig, projectDir: string): boolean {
  return config.cwdPaths.some((p) => existsSync(join(projectDir, p)));
}

/**
 * Check if an agent is detected (globally OR in project).
 * Use this for combined detection when location hasn't been chosen yet.
 */
export function detectAgent(config: AgentConfig, projectDir?: string): boolean {
  const cwd = projectDir ?? process.cwd();
  return detectAgentGlobally(config) || detectAgentInProject(config, cwd);
}

/**
 * Runtime agent type with detect function.
 */
export interface Agent {
  readonly name: string;
  readonly dir: string;
  readonly detect: () => boolean;
}

/**
 * Location context for agent detection.
 */
export type DetectionLocation = 'global' | 'project' | 'both';

/**
 * Get detected agents for a specific location context.
 * - 'global': Only agents installed globally (homePaths)
 * - 'project': Only agents configured in the project (cwdPaths)
 * - 'both': Agents detected in either location (current behavior)
 */
export function getDetectedAgentsForLocation(
  location: DetectionLocation,
  projectDir?: string,
): readonly Agent[] {
  const cwd = projectDir ?? process.cwd();

  return AGENT_CONFIGS.filter((config) => {
    switch (location) {
      case 'global':
        return detectAgentGlobally(config);
      case 'project':
        return detectAgentInProject(config, cwd);
      case 'both':
        return detectAgent(config, cwd);
    }
  }).map((config) => ({
    name: config.name,
    dir: config.dir,
    detect: () => detectAgent(config, cwd),
  }));
}

/**
 * Get the skill directory path for an agent.
 */
export function getAgentSkillDir(agent: Agent | AgentConfig, baseDir: string): string {
  return join(baseDir, agent.dir);
}
