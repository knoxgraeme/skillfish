/**
 * Tests for agent detection logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { homedir } from 'os';
import {
  AGENT_CONFIGS,
  detectAgent,
  buildAgents,
  getDetectedAgents,
  getAgentSkillDir,
  type AgentConfig,
} from '../lib/agents.js';

// Mock fs and os modules
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: vi.fn(),
}));

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockHomedir = homedir as ReturnType<typeof vi.fn>;

describe('agents.ts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockHomedir.mockReturnValue('/home/user');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('AGENT_CONFIGS', () => {
    it('exports non-empty agent configurations', () => {
      expect(AGENT_CONFIGS.length).toBeGreaterThan(0);
    });

    it('all configs have required fields', () => {
      for (const config of AGENT_CONFIGS) {
        expect(config.name).toBeDefined();
        expect(config.name.length).toBeGreaterThan(0);
        expect(config.dir).toBeDefined();
        expect(config.homePaths).toBeInstanceOf(Array);
        expect(config.cwdPaths).toBeInstanceOf(Array);
      }
    });

    it('includes Claude Code agent', () => {
      const claude = AGENT_CONFIGS.find((c) => c.name === 'Claude Code');
      expect(claude).toBeDefined();
      expect(claude?.dir).toBe('.claude/skills');
    });

    it('includes Cursor agent', () => {
      const cursor = AGENT_CONFIGS.find((c) => c.name === 'Cursor');
      expect(cursor).toBeDefined();
      expect(cursor?.dir).toBe('.cursor/skills');
    });
  });

  describe('detectAgent', () => {
    const testConfig: AgentConfig = {
      name: 'Test Agent',
      dir: '.test/skills',
      homePaths: ['.test/config.json', '.test'],
      cwdPaths: ['.test'],
    };

    it('detects agent when homePath exists', () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path === '/home/user/.test/config.json';
      });

      expect(detectAgent(testConfig)).toBe(true);
    });

    it('detects agent when cwdPath exists', () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path.endsWith('/.test') && !path.startsWith('/home');
      });

      expect(detectAgent(testConfig, '/project')).toBe(true);
    });

    it('returns false when no paths exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(detectAgent(testConfig)).toBe(false);
    });

    it('checks homePaths before cwdPaths', () => {
      const calls: string[] = [];
      mockExistsSync.mockImplementation((path: string) => {
        calls.push(path);
        return path === '/home/user/.test/config.json';
      });

      detectAgent(testConfig);

      // First calls should be to home paths
      expect(calls[0]).toContain('/home/user');
    });

    it('uses process.cwd() when baseDir not provided', () => {
      const originalCwd = process.cwd;
      process.cwd = () => '/mock/cwd';

      mockExistsSync.mockImplementation((path: string) => {
        return path === '/mock/cwd/.test';
      });

      expect(detectAgent(testConfig)).toBe(true);

      process.cwd = originalCwd;
    });
  });

  describe('buildAgents', () => {
    it('returns array of agents with correct structure', () => {
      mockExistsSync.mockReturnValue(false);

      const agents = buildAgents();

      expect(agents.length).toBe(AGENT_CONFIGS.length);
      for (const agent of agents) {
        expect(agent.name).toBeDefined();
        expect(agent.dir).toBeDefined();
        expect(typeof agent.detect).toBe('function');
      }
    });

    it('detect function uses correct baseDir', () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path === '/custom/base/.claude';
      });

      const agents = buildAgents('/custom/base');
      const claudeAgent = agents.find((a) => a.name === 'Claude Code');

      expect(claudeAgent?.detect()).toBe(true);
    });
  });

  describe('getDetectedAgents', () => {
    it('returns empty array when no agents detected', () => {
      mockExistsSync.mockReturnValue(false);

      const detected = getDetectedAgents();

      expect(detected).toEqual([]);
    });

    it('returns only detected agents', () => {
      // Only Claude Code paths exist
      mockExistsSync.mockImplementation((path: string) => {
        return (
          path === '/home/user/.claude/settings.json' ||
          path === '/home/user/.claude/projects.json' ||
          path === '/home/user/.claude/credentials.json'
        );
      });

      const detected = getDetectedAgents();

      expect(detected.length).toBe(1);
      expect(detected[0].name).toBe('Claude Code');
    });

    it('returns multiple agents when multiple detected', () => {
      // Claude and Cursor paths exist
      mockExistsSync.mockImplementation((path: string) => {
        return (
          path === '/home/user/.claude/settings.json' ||
          path === '/home/user/.cursor/extensions'
        );
      });

      const detected = getDetectedAgents();

      expect(detected.length).toBe(2);
      expect(detected.map((a) => a.name)).toContain('Claude Code');
      expect(detected.map((a) => a.name)).toContain('Cursor');
    });

    it('uses baseDir parameter for detection', () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path === '/project/.claude';
      });

      const detected = getDetectedAgents('/project');

      expect(detected.length).toBe(1);
      expect(detected[0].name).toBe('Claude Code');
    });
  });

  describe('getAgentSkillDir', () => {
    it('returns correct path for agent with baseDir', () => {
      const agent = { name: 'Claude Code', dir: '.claude/skills', detect: () => true };

      expect(getAgentSkillDir(agent, '/home/user')).toBe('/home/user/.claude/skills');
    });

    it('works with AgentConfig', () => {
      const config = AGENT_CONFIGS.find((c) => c.name === 'Claude Code')!;

      expect(getAgentSkillDir(config, '/base')).toBe('/base/.claude/skills');
    });

    it('handles project base directory', () => {
      const agent = { name: 'Cursor', dir: '.cursor/skills', detect: () => true };

      expect(getAgentSkillDir(agent, '/project')).toBe('/project/.cursor/skills');
    });
  });
});
