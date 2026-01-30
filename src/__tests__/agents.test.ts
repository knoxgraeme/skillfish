/**
 * Tests for agent detection logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { homedir } from 'os';
import {
  AGENT_CONFIGS,
  detectAgent,
  detectAgentGlobally,
  detectAgentInProject,
  getDetectedAgentsForLocation,
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

  describe('detectAgentGlobally', () => {
    const testConfig: AgentConfig = {
      name: 'Test Agent',
      dir: '.test/skills',
      homePaths: ['.test/config.json', '.test'],
      cwdPaths: ['.test'],
    };

    it('returns true when homePath exists', () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path === '/home/user/.test/config.json';
      });

      expect(detectAgentGlobally(testConfig)).toBe(true);
    });

    it('returns false when no homePaths exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(detectAgentGlobally(testConfig)).toBe(false);
    });

    it('ignores cwdPaths', () => {
      // Only cwdPath exists, not homePath
      mockExistsSync.mockImplementation((path: string) => {
        return path === '/some/project/.test';
      });

      expect(detectAgentGlobally(testConfig)).toBe(false);
    });
  });

  describe('detectAgentInProject', () => {
    const testConfig: AgentConfig = {
      name: 'Test Agent',
      dir: '.test/skills',
      homePaths: ['.test/config.json'],
      cwdPaths: ['.test'],
    };

    it('returns true when cwdPath exists in project', () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path === '/project/.test';
      });

      expect(detectAgentInProject(testConfig, '/project')).toBe(true);
    });

    it('returns false when cwdPath does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(detectAgentInProject(testConfig, '/project')).toBe(false);
    });

    it('ignores homePaths', () => {
      // Only homePath exists, not cwdPath
      mockExistsSync.mockImplementation((path: string) => {
        return path === '/home/user/.test/config.json';
      });

      expect(detectAgentInProject(testConfig, '/project')).toBe(false);
    });
  });

  describe('getDetectedAgentsForLocation', () => {
    it('returns empty array when no agents detected', () => {
      mockExistsSync.mockReturnValue(false);

      const detected = getDetectedAgentsForLocation('both');

      expect(detected).toEqual([]);
    });

    it('detects global agents with location=global', () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path === '/home/user/.claude/settings.json';
      });

      const detected = getDetectedAgentsForLocation('global');

      expect(detected.length).toBe(1);
      expect(detected[0].name).toBe('Claude Code');
    });

    it('detects project agents with location=project', () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path === '/project/.claude';
      });

      const detected = getDetectedAgentsForLocation('project', '/project');

      expect(detected.length).toBe(1);
      expect(detected[0].name).toBe('Claude Code');
    });

    it('detects both global and project with location=both', () => {
      mockExistsSync.mockImplementation((path: string) => {
        return (
          path === '/home/user/.claude/settings.json' || path === '/home/user/.cursor/extensions'
        );
      });

      const detected = getDetectedAgentsForLocation('both');

      expect(detected.length).toBe(2);
      expect(detected.map((a) => a.name)).toContain('Claude Code');
      expect(detected.map((a) => a.name)).toContain('Cursor');
    });

    it('location=global ignores project paths', () => {
      // Only project path exists
      mockExistsSync.mockImplementation((path: string) => {
        return path === '/project/.claude';
      });

      const detected = getDetectedAgentsForLocation('global', '/project');

      expect(detected.length).toBe(0);
    });

    it('location=project ignores global paths', () => {
      // Only global path exists
      mockExistsSync.mockImplementation((path: string) => {
        return path === '/home/user/.claude/settings.json';
      });

      const detected = getDetectedAgentsForLocation('project', '/project');

      expect(detected.length).toBe(0);
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
