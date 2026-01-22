#!/usr/bin/env node
import { existsSync, mkdirSync, cpSync, rmSync, lstatSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname, basename } from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import degit from 'degit';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { trackInstall } from './telemetry.js';
import {
  isValidPath,
  isGitTreeResponse,
  parseFrontmatter,
  deriveSkillName,
  toTitleCase,
  truncate,
  extractSkillPaths,
  sleep,
  batchMap,
  type GitTreeResponse,
} from './utils.js';

// Read version from package.json (single source of truth)
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
const VERSION: string = packageJson.version;

// === Constants ===
const API_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000]; // Exponential backoff
const DEFAULT_BRANCHES = ['main', 'master'] as const;
const SKILL_FILENAME = 'SKILL.md';

// === Exit Codes ===
const EXIT_SUCCESS = 0;
const EXIT_GENERAL_ERROR = 1;
const EXIT_INVALID_ARGS = 2;
const EXIT_NETWORK_ERROR = 3;
const EXIT_NOT_FOUND = 4;
const EXIT_CANCELLED = 0; // User cancellation is not an error

// Type imports from utils.js are used for GitTreeResponse

/**
 * Fetch with retry and exponential backoff.
 * Retries on network errors and 5xx responses.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);

      // Success or client error (4xx) - don't retry
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        return res;
      }

      // Server error (5xx) - retry
      if (res.status >= 500) {
        lastError = new Error(`Server error: ${res.status}`);
        if (attempt < maxRetries - 1) {
          await sleep(RETRY_DELAYS_MS[attempt] || 4000);
          continue;
        }
      }

      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Network error - retry
      if (attempt < maxRetries - 1) {
        await sleep(RETRY_DELAYS_MS[attempt] || 4000);
        continue;
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

// === JSON Output Support ===
type JsonOutput = {
  success: boolean;
  installed: Array<{ skill: string; agent: string; path: string }>;
  skipped: Array<{ skill: string; agent: string; reason: string }>;
  errors: string[];
  skills_found?: string[];
};

let jsonMode = false;
let jsonOutput: JsonOutput = {
  success: true,
  installed: [],
  skipped: [],
  errors: [],
};

function resetJsonOutput(): void {
  jsonOutput = {
    success: true,
    installed: [],
    skipped: [],
    errors: [],
  };
}

function addJsonError(message: string): void {
  jsonOutput.errors.push(message);
  jsonOutput.success = false;
}

function outputJson(): void {
  console.log(JSON.stringify(jsonOutput, null, 2));
}

// Agent configuration - data-driven for easier maintenance
// Detection checks home directory (agent installed globally) and cwd (local project)
// Supports all agents from the Agent Skills specification: https://agentskills.io
type AgentConfig = {
  readonly name: string;
  readonly dir: string;
  readonly homePaths: readonly string[];  // Paths to check in ~/
  readonly cwdPaths: readonly string[];   // Paths to check in ./
};

const AGENT_CONFIGS: readonly AgentConfig[] = [
  // === Primary Agents (widely used) ===
  { name: 'Claude Code', dir: '.claude/skills', homePaths: ['.claude/settings.json', '.claude/projects.json', '.claude/credentials.json'], cwdPaths: ['.claude'] },
  { name: 'Cursor', dir: '.cursor/skills', homePaths: ['.cursor/extensions', '.cursor/argv.json'], cwdPaths: ['.cursor'] },
  { name: 'Windsurf', dir: '.codeium/windsurf/skills', homePaths: ['.codeium/windsurf/config.json', '.codeium/windsurf/argv.json'], cwdPaths: ['.codeium/windsurf'] },
  { name: 'Codex', dir: '.codex/skills', homePaths: ['.codex/config.json', '.codex/settings.json', '.codex'], cwdPaths: ['.codex'] },
  { name: 'GitHub Copilot', dir: '.github/skills', homePaths: ['.copilot/config.json', '.copilot'], cwdPaths: ['.github/skills', '.github/copilot-instructions.md'] },
  { name: 'Gemini CLI', dir: '.gemini/skills', homePaths: ['.gemini'], cwdPaths: ['.gemini'] },
  { name: 'OpenCode', dir: '.opencode/skills', homePaths: ['.config/opencode', '.opencode'], cwdPaths: ['.opencode'] },
  { name: 'Goose', dir: '.goose/skills', homePaths: ['.config/goose'], cwdPaths: ['.goose'] },
  // === Secondary Agents ===
  { name: 'Amp', dir: '.agents/skills', homePaths: ['.config/amp'], cwdPaths: ['.agents'] },
  { name: 'Roo Code', dir: '.roo/skills', homePaths: ['.roo'], cwdPaths: ['.roo'] },
  { name: 'Kiro CLI', dir: '.kiro/skills', homePaths: ['.kiro'], cwdPaths: ['.kiro'] },
  { name: 'Kilo Code', dir: '.kilocode/skills', homePaths: ['.kilocode'], cwdPaths: ['.kilocode'] },
  { name: 'Trae', dir: '.trae/skills', homePaths: ['.trae'], cwdPaths: ['.trae'] },
  { name: 'Cline', dir: '.cline/skills', homePaths: ['.cline/settings.json', '.cline'], cwdPaths: ['.cline'] },
  // === Additional Agents ===
  { name: 'Antigravity', dir: '.gemini/antigravity/skills', homePaths: ['.gemini/antigravity'], cwdPaths: ['.agent'] },
  { name: 'Droid', dir: '.factory/skills', homePaths: ['.factory'], cwdPaths: ['.factory'] },
  { name: 'Clawdbot', dir: '.clawdbot/skills', homePaths: ['.clawdbot'], cwdPaths: ['.clawdbot'] },
];

/**
 * Check if an agent is detected on the system.
 * Checks home directory paths first, then current working directory paths.
 */
function detectAgent(config: AgentConfig): boolean {
  const home = homedir();
  const cwd = process.cwd();

  return config.homePaths.some(p => existsSync(join(home, p))) ||
         config.cwdPaths.some(p => existsSync(join(cwd, p)));
}

// Runtime agent type with detect function
type Agent = {
  readonly name: string;
  readonly dir: string;
  readonly detect: () => boolean;
};

// Build AGENTS array from config (preserves existing API)
const AGENTS: readonly Agent[] = AGENT_CONFIGS.map(config => ({
  name: config.name,
  dir: config.dir,
  detect: () => detectAgent(config),
}));

/**
 * Recursively copies a directory while skipping symlinks for security.
 * This prevents symlink attacks where malicious repos could link to sensitive files.
 *
 * SECURITY: Uses double-check pattern to minimize TOCTOU race window.
 * The second lstatSync check immediately before cpSync reduces (but doesn't
 * eliminate) the window for a race condition attack.
 */
function safeCopyDir(src: string, dest: string, warnings: string[] = []): string[] {
  mkdirSync(dest, { recursive: true, mode: 0o700 });

  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    // First check: Skip symlinks for security
    if (entry.isSymbolicLink()) {
      const warning = `Skipped symlink: ${entry.name}`;
      warnings.push(warning);
      if (!jsonMode) {
        console.log(`  ${pc.yellow('!')} ${warning}`);
      }
      continue;
    }

    if (entry.isDirectory()) {
      safeCopyDir(srcPath, destPath, warnings);
    } else if (entry.isFile()) {
      // SECURITY: Second check immediately before copy to minimize TOCTOU window
      // This doesn't eliminate the race but significantly reduces the attack window
      try {
        const stat = lstatSync(srcPath);
        if (stat.isSymbolicLink()) {
          const warning = `Skipped symlink (detected on copy): ${entry.name}`;
          warnings.push(warning);
          if (!jsonMode) {
            console.log(`  ${pc.yellow('!')} ${warning}`);
          }
          continue;
        }
        cpSync(srcPath, destPath);
      } catch (err) {
        // File may have been removed/changed between readdir and copy
        const warning = `Could not copy ${entry.name}: ${err instanceof Error ? err.message : 'unknown error'}`;
        warnings.push(warning);
        if (!jsonMode) {
          console.log(`  ${pc.yellow('!')} ${warning}`);
        }
      }
    }
  }

  return warnings;
}

/**
 * List installed skills for all detected agents.
 */
async function listInstalledSkills(baseDir: string): Promise<void> {
  const detected = AGENTS.filter(a => a.detect());

  if (detected.length === 0) {
    if (jsonMode) {
      jsonOutput.errors.push('No agents detected');
      outputJson();
    } else {
      p.log.error('No agents detected. Install Claude Code, Cursor, or another supported agent first.');
    }
    process.exit(EXIT_GENERAL_ERROR);
  }

  type InstalledSkill = { agent: string; skill: string; path: string };
  const installed: InstalledSkill[] = [];

  for (const agent of detected) {
    const skillDir = join(baseDir, agent.dir);
    if (existsSync(skillDir)) {
      try {
        const skills = readdirSync(skillDir, { withFileTypes: true })
          .filter(entry => entry.isDirectory())
          .map(entry => entry.name);

        for (const skill of skills) {
          const skillPath = join(skillDir, skill);
          const hasSkillMd = existsSync(join(skillPath, SKILL_FILENAME));
          if (hasSkillMd) {
            installed.push({
              agent: agent.name,
              skill,
              path: skillPath,
            });
          }
        }
      } catch {
        // Directory might not be readable, skip it
      }
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify({
      success: true,
      installed,
      agents_detected: detected.map(a => a.name),
    }, null, 2));
    return;
  }

  // Human-readable output
  if (installed.length === 0) {
    p.log.info('No skills installed');
    return;
  }

  console.log();
  p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim('Installed skills')}`);

  // Group by agent
  const byAgent = new Map<string, string[]>();
  for (const item of installed) {
    const list = byAgent.get(item.agent) || [];
    list.push(item.skill);
    byAgent.set(item.agent, list);
  }

  for (const [agent, skills] of byAgent) {
    console.log();
    console.log(pc.bold(agent));
    for (const skill of skills) {
      console.log(`  ${pc.green('•')} ${skill}`);
    }
  }

  console.log();
  p.outro(`${pc.cyan(installed.length.toString())} skill${installed.length === 1 ? '' : 's'} installed`);
}

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  // Check for --json flag early (affects all output)
  jsonMode = args.includes('--json') || command === '--json';
  if (jsonMode) {
    resetJsonOutput();
  }

  // Handle --version flag
  if (command === '--version' || command === '-v') {
    if (jsonMode) {
      console.log(JSON.stringify({ version: VERSION }));
    } else {
      console.log(`skillfish v${VERSION}`);
    }
    process.exit(EXIT_SUCCESS);
  }

  // Handle list subcommand
  if (command === 'list') {
    const projectFlag = args.includes('--project');
    const globalFlag = args.includes('--global');
    const baseDir = projectFlag ? process.cwd() : (globalFlag ? homedir() : homedir());
    await listInstalledSkills(baseDir);
    process.exit(EXIT_SUCCESS);
  }

  // Handle add subcommand
  if (command === 'add') {
    const [repoArg, ...flags] = args;
    if (!repoArg || repoArg.startsWith('--')) {
      const errorMsg = 'Missing repository. Usage: skillfish add <owner/repo>';
      if (jsonMode) {
        addJsonError(errorMsg);
        outputJson();
      } else {
        console.error(errorMsg);
      }
      process.exit(EXIT_INVALID_ARGS);
    }
    await installSkillFromRepo(repoArg, flags);
    return;
  }

  // Show help for no command, --help, -h, or unknown commands
  const helpText = `
${pc.bold('skillfish')} v${VERSION} - Install AI agent skills from GitHub

${pc.dim('Usage:')}
  skillfish add ${pc.cyan('<owner/repo>')} [options]
  skillfish add ${pc.cyan('<owner/repo/plugin/skill>')}
  skillfish list [--project|--global]

${pc.dim('Commands:')}
  add             Install a skill from GitHub
  list            List installed skills

${pc.dim('Options:')}
  --path <path>   Path to skill directory within repo
  --all           Install all skills (for repos with multiple skills)
  --force         Overwrite existing skills
  --yes, -y       Skip confirmation prompts (trust source)
  --project       Install to current project (./)
  --global        Install to home directory (~/)
  --json          Output in JSON format (for automation)
  --version, -v   Show version
  --help, -h      Show help

${pc.dim('Examples:')}
  skillfish add anthropics/claude-code
  skillfish add owner/repo --path skills/my-skill
  skillfish add owner/repo --all --yes
  skillfish add owner/repo --force --project
  skillfish add owner/repo --json
  skillfish list --global
`;
  if (jsonMode) {
    console.log(JSON.stringify({ help: helpText.replace(/\x1b\[[0-9;]*m/g, '') }));
  } else {
    console.log(helpText);
  }
  process.exit(command === '--help' || command === '-h' ? EXIT_SUCCESS : EXIT_INVALID_ARGS);
}

async function installSkillFromRepo(repoArg: string, flags: string[]): Promise<void> {

  // Show banner and intro (TTY only, not in JSON mode)
  if (process.stdout.isTTY && !jsonMode) {
    console.log();
    console.log(pc.cyan('     ≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋'));
    console.log(`       ${pc.cyan('><>')}  ${pc.bold('SKILL FISH')}  ${pc.cyan('><>')}`);
    console.log(pc.cyan('     ≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋'));
    console.log();
    p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim(`v${VERSION}`)}`);
  }

  const force = flags.includes('--force');
  const trustSource = flags.includes('--yes') || flags.includes('-y');
  const installAll = flags.includes('--all');
  const projectFlag = flags.includes('--project');
  const globalFlag = flags.includes('--global');
  const pathIdx = flags.indexOf('--path');
  let explicitPath: string | null = null;
  if (pathIdx !== -1) {
    if (pathIdx + 1 >= flags.length || flags[pathIdx + 1]?.startsWith('--')) {
      const errorMsg = '--path requires a value';
      if (jsonMode) {
        addJsonError(errorMsg);
        outputJson();
      } else {
        console.error(errorMsg);
      }
      process.exit(EXIT_INVALID_ARGS);
    }
    const pathValue = flags[pathIdx + 1];
    // Security: validate path to prevent directory traversal
    if (!isValidPath(pathValue)) {
      const errorMsg = 'Invalid --path value. Path must be relative and contain only safe characters.';
      if (jsonMode) {
        addJsonError(errorMsg);
        outputJson();
      } else {
        console.error(errorMsg);
      }
      process.exit(EXIT_INVALID_ARGS);
    }
    explicitPath = pathValue;
  }

  // Parse repo format - supports both owner/repo and owner/repo/plugin/skill
  const parts = repoArg.split('/');
  let owner: string;
  let repo: string;

  if (parts.length === 2) {
    [owner, repo] = parts;
  } else if (parts.length === 4) {
    const [o, r, plugin, skill] = parts;
    owner = o;
    repo = r;
    // Security: validate plugin and skill names
    if (!/^[\w.-]+$/.test(plugin) || !/^[\w.-]+$/.test(skill)) {
      const errorMsg = 'Invalid plugin or skill name. Use only alphanumeric characters, dots, hyphens, and underscores.';
      if (jsonMode) {
        addJsonError(errorMsg);
        outputJson();
      } else {
        console.error(errorMsg);
      }
      process.exit(EXIT_INVALID_ARGS);
    }
    explicitPath = explicitPath || `plugins/${plugin}/skills/${skill}`;
    if (!jsonMode) {
      console.log(`Installing skill from: ${plugin}/${skill}`);
    }
  } else {
    const errorMsg = 'Invalid format. Use: owner/repo or owner/repo/plugin/skill';
    if (jsonMode) {
      addJsonError(errorMsg);
      outputJson();
    } else {
      console.error(errorMsg);
    }
    process.exit(EXIT_INVALID_ARGS);
  }

  // Validate (security: prevent injection)
  if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    const errorMsg = 'Invalid repository format. Use: owner/repo';
    if (jsonMode) {
      addJsonError(errorMsg);
      outputJson();
    } else {
      console.error(errorMsg);
    }
    process.exit(EXIT_INVALID_ARGS);
  }

  // 1. Discover or select skills
  const skillPaths = explicitPath
    ? [explicitPath]
    : await discoverSkillPaths(owner, repo, installAll);

  if (!skillPaths || skillPaths.length === 0) {
    if (jsonMode) {
      outputJson();
    }
    process.exit(EXIT_NOT_FOUND);
  }

  // 2. Determine install location (global vs project)
  const baseDir = await selectInstallLocation(projectFlag, globalFlag);

  // 3. Select agents to install to
  const detected = AGENTS.filter(a => a.detect());

  if (detected.length === 0) {
    const errorMsg = 'No agents detected. Install Claude Code, Cursor, or another supported agent first.';
    if (jsonMode) {
      addJsonError(errorMsg);
      outputJson();
    } else {
      p.log.error(errorMsg);
      p.outro(pc.dim('https://skill.fish/agents'));
    }
    process.exit(EXIT_GENERAL_ERROR);
  }

  let targetAgents: readonly Agent[];

  if (!process.stdin.isTTY || jsonMode) {
    // Non-TTY or JSON mode: use all detected agents
    if (!jsonMode) {
      console.log(`Installing to ${detected.length} agent(s): ${detected.map(a => a.name).join(', ')}`);
    }
    targetAgents = detected;
  } else {
    // Interactive: let user choose from detected agents
    const isLocal = baseDir !== homedir();
    targetAgents = await selectAgents(detected, isLocal);
  }

  // Install each selected skill
  let totalInstalled = 0;
  let totalSkipped = 0;

  for (const skillPath of skillPaths) {
    const skillName = deriveSkillName(skillPath, repo);

    // SECURITY: Ask for confirmation before installation (unless --yes is used)
    if (!trustSource && !jsonMode && process.stdin.isTTY) {
      const shouldInstall = await confirmInstall(owner, repo, skillName);
      if (!shouldInstall) {
        if (!jsonMode) {
          p.log.warn(`Skipped ${pc.bold(skillName)} (not confirmed)`);
        }
        jsonOutput.skipped.push({ skill: skillName, agent: 'all', reason: 'User declined' });
        continue;
      }
    }

    const result = await installSkill(owner, repo, skillPath, skillName, targetAgents, force, baseDir);
    totalInstalled += result.installed;
    totalSkipped += result.skipped;

    // Track successful installs (fire-and-forget telemetry)
    if (result.installed > 0) {
      // Construct github value to match skills.github column format: owner/repo/path/to/skill
      const skillDir = skillPath.replace(/\/?SKILL\.md$/i, '').replace(/^\.?\/?/, '');
      const github = skillDir ? `${owner}/${repo}/${skillDir}` : `${owner}/${repo}`;
      trackInstall(github);
    }
  }

  // Summary
  if (jsonMode) {
    outputJson();
  } else {
    console.log();
    if (totalInstalled > 0) {
      p.outro(pc.green(`Done! Installed ${totalInstalled} skill${totalInstalled === 1 ? '' : 's'}`));
    } else if (totalSkipped > 0) {
      p.outro(pc.yellow(`Skipped ${totalSkipped} existing skill${totalSkipped === 1 ? '' : 's'} - use --force to overwrite`));
    } else {
      p.outro(pc.yellow('No skills installed'));
    }
  }
}

async function selectInstallLocation(projectFlag: boolean, globalFlag: boolean): Promise<string> {
  // If flag specified, use it
  if (projectFlag) {
    if (!jsonMode) {
      p.log.info(`Location: ${pc.cyan('Project')} ${pc.dim('(./')}${pc.dim(AGENTS[0].dir)}${pc.dim(')')}`);
    }
    return process.cwd();
  }
  if (globalFlag) {
    if (!jsonMode) {
      p.log.info(`Location: ${pc.cyan('Global')} ${pc.dim('(~/')}${pc.dim(AGENTS[0].dir)}${pc.dim(')')}`);
    }
    return homedir();
  }

  // Non-TTY or JSON mode defaults to global
  if (!process.stdin.isTTY || jsonMode) {
    return homedir();
  }

  // Interactive selection
  const location = await p.select({
    message: 'Install location',
    options: [
      {
        value: 'global',
        label: 'Global',
        hint: 'Available in all projects',
      },
      {
        value: 'project',
        label: 'Project',
        hint: 'For this project only',
      },
    ],
  });

  if (p.isCancel(location)) {
    p.cancel('Cancelled');
    process.exit(EXIT_CANCELLED);
  }

  return location === 'project' ? process.cwd() : homedir();
}

async function selectAgents(agents: readonly Agent[], isLocal: boolean): Promise<readonly Agent[]> {
  const pathPrefix = isLocal ? '.' : '~';

  // Show detected agents
  if (!jsonMode) {
    p.log.info(`Detected ${pc.cyan(agents.length.toString())} agent${agents.length === 1 ? '' : 's'}: ${agents.map(a => a.name).join(', ')}`);
  }

  const installAll = await p.confirm({
    message: 'Install to all detected agents?',
    initialValue: true,
  });

  if (p.isCancel(installAll)) {
    p.cancel('Cancelled');
    process.exit(EXIT_CANCELLED);
  }

  if (installAll) {
    return agents;
  }

  // User wants to choose specific agents
  const options = agents.map(a => ({
    value: a.name,
    label: a.name,
    hint: `${pathPrefix}/${a.dir}`,
  }));

  const selected = await p.multiselect({
    message: 'Select agents',
    options,
    required: true,
  });

  if (p.isCancel(selected)) {
    p.cancel('Cancelled');
    process.exit(EXIT_CANCELLED);
  }

  return agents.filter(a => selected.includes(a.name));
}

type SkillMetadata = {
  path: string;       // Full path to SKILL.md
  dir: string;        // Directory containing SKILL.md
  name: string;       // From frontmatter or folder name
  description: string; // From frontmatter or empty
};

async function discoverSkillPaths(owner: string, repo: string, installAll: boolean = false): Promise<string[] | null> {
  const skillPaths = await findAllSkillMdFiles(owner, repo);

  if (skillPaths.length === 0) {
    const errorMsg = `No ${SKILL_FILENAME} found in repository`;
    if (jsonMode) {
      addJsonError(errorMsg);
    } else {
      p.log.error(errorMsg);
    }
    return null;
  }

  // Fetch frontmatter metadata for all skills in parallel
  let spinner: ReturnType<typeof p.spinner> | null = null;
  if (!jsonMode) {
    spinner = p.spinner();
    spinner.start('Fetching skill metadata...');
  }

  // Fetch metadata with bounded concurrency (max 10 parallel requests)
  const skills = await batchMap(skillPaths, async (sp): Promise<SkillMetadata> => {
    const skillDir = sp === SKILL_FILENAME ? '.' : dirname(sp);
    const folderName = sp === SKILL_FILENAME ? repo : basename(skillDir);

    // Fetch raw content to parse frontmatter
    const content = await fetchSkillMdContent(owner, repo, sp);
    const frontmatter = content ? parseFrontmatter(content) : {};

    return {
      path: sp,
      dir: skillDir === '.' ? SKILL_FILENAME : skillDir,
      name: frontmatter.name || folderName,
      description: frontmatter.description || '',
    };
  }, 10);

  if (spinner) {
    spinner.stop(`Found ${pc.cyan(skills.length.toString())} skill${skills.length === 1 ? '' : 's'}`);
  }

  // Store found skills in JSON output
  jsonOutput.skills_found = skills.map(s => s.name);

  if (skills.length === 1) {
    const skill = skills[0];
    const displayName = toTitleCase(skill.name);
    const desc = skill.description ? truncate(skill.description, 60) : '';
    if (!jsonMode) {
      p.log.info(`${pc.bold(displayName)}${desc ? pc.dim(` - ${desc}`) : ''}`);
    }
    return [skill.dir];
  }

  // Build options for selection with frontmatter metadata
  // Title in label, description in hint (shows on focus)
  const options = skills.map(skill => ({
    value: skill.dir,
    label: pc.bold(toTitleCase(skill.name)),
    hint: skill.description || undefined,
  }));

  // Non-TTY or JSON mode: require --all or --path for multiple skills
  if (!process.stdin.isTTY || jsonMode) {
    // If --all flag is set, install all skills
    if (installAll) {
      if (!jsonMode) {
        console.log(`Installing all ${skills.length} skills`);
      }
      return skills.map(s => s.dir);
    }

    // Otherwise, list skills and exit with guidance
    if (jsonMode) {
      addJsonError('Multiple skills found. Use --path or --all to specify which one(s).');
    } else {
      console.log(`\nFound ${skills.length} skills in this repository:`);
      for (const skill of skills) {
        const displayName = toTitleCase(skill.name);
        const desc = skill.description ? pc.dim(` - ${truncate(skill.description, 80)}`) : '';
        console.log(`  - ${displayName}${desc}`);
      }
      console.error('\nMultiple skills found. Use --path or --all to specify which one(s) (non-interactive mode).');
    }
    return null;
  }

  // Interactive multi-select
  const selected = await p.multiselect({
    message: 'Select skills to install',
    options,
    required: true,
  });

  if (p.isCancel(selected)) {
    p.cancel('Cancelled');
    process.exit(EXIT_CANCELLED);
  }

  return selected;
}

type InstallResult = {
  installed: number;
  skipped: number;
  failed: boolean;
};

/**
 * SECURITY: Show warning and ask for user confirmation before installing.
 * This mitigates supply chain attacks by making users acknowledge the source.
 */
async function confirmInstall(
  owner: string,
  repo: string,
  skillName: string
): Promise<boolean> {
  console.log();
  p.log.warn(pc.yellow('Skills can instruct AI agents to perform actions on your behalf.'));
  console.log(pc.dim(`  Source: github.com/${owner}/${repo}`));
  console.log(pc.dim('  Use --yes to skip this prompt for trusted sources.'));
  console.log();

  const proceed = await p.confirm({
    message: `Install ${pc.bold(skillName)} from ${pc.cyan(`${owner}/${repo}`)}?`,
    initialValue: true,
  });

  if (p.isCancel(proceed)) {
    return false;
  }

  return proceed;
}

async function installSkill(
  owner: string,
  repo: string,
  skillPath: string,
  skillName: string,
  agents: readonly Agent[],
  force: boolean,
  baseDir: string
): Promise<InstallResult> {
  const result: InstallResult = { installed: 0, skipped: 0, failed: false };
  const isLocal = baseDir !== homedir();
  const pathPrefix = isLocal ? '.' : '~';

  if (!jsonMode) {
    p.log.step(`Installing ${pc.bold(skillName)}`);
  }

  const tmpDir = join(homedir(), '.cache', 'skillfish', `${owner}-${repo}-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });

  try {
    // Download skill
    const downloadPath = skillPath === SKILL_FILENAME ? '' : skillPath;
    const degitPath = downloadPath ? `${owner}/${repo}/${downloadPath}` : `${owner}/${repo}`;

    let spinner: ReturnType<typeof p.spinner> | null = null;
    if (!jsonMode) {
      spinner = p.spinner();
      spinner.start(`Downloading ${skillName}...`);
    }

    const emitter = degit(degitPath, { cache: false, force: true });
    await emitter.clone(tmpDir);

    // Validate download
    const skillMdPath = join(tmpDir, SKILL_FILENAME);
    if (!existsSync(skillMdPath)) {
      if (spinner) {
        spinner.stop(pc.red(`${SKILL_FILENAME} not found`));
      }
      const errorMsg = `${SKILL_FILENAME} not found in downloaded content. Path may be incorrect.`;
      if (jsonMode) {
        addJsonError(errorMsg);
      } else {
        console.error(`Error: ${errorMsg}`);
      }
      result.failed = true;
      return result;
    }

    if (spinner) {
      spinner.stop(pc.green('Downloaded'));
    }

    // Copy to each installed agent
    for (const agent of agents) {
      const destDir = join(baseDir, agent.dir, skillName);
      const displayPath = `${pathPrefix}/${agent.dir}/${skillName}`;

      if (existsSync(destDir) && !force) {
        if (!jsonMode) {
          console.log(`  ${pc.yellow('●')} ${agent.name} ${pc.dim('(exists)')}`);
        }
        jsonOutput.skipped.push({
          skill: skillName,
          agent: agent.name,
          reason: 'Already exists (use --force to overwrite)',
        });
        result.skipped++;
        continue;
      }

      mkdirSync(join(baseDir, agent.dir), { recursive: true, mode: 0o700 });
      if (existsSync(destDir)) rmSync(destDir, { recursive: true });
      // Use safe copy to skip symlinks (security: prevents symlink attacks)
      const warnings = safeCopyDir(tmpDir, destDir);

      if (!jsonMode) {
        console.log(`  ${pc.green('✓')} ${agent.name} ${pc.dim(`→ ${displayPath}`)}`);
      }

      jsonOutput.installed.push({
        skill: skillName,
        agent: agent.name,
        path: destDir,
      });

      // Include any warnings (e.g., skipped symlinks)
      if (warnings.length > 0) {
        for (const warning of warnings) {
          jsonOutput.errors.push(`${skillName}: ${warning}`);
        }
      }

      result.installed++;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      addJsonError(`Install failed: ${message}`);
    } else {
      console.error(pc.red(`Error: ${message}`));
    }
    result.failed = true;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  return result;
}

/**
 * Fetch raw SKILL.md content from GitHub.
 * Uses raw.githubusercontent.com which is not rate-limited like the API.
 * Tries both main and master branches in parallel for better performance.
 */
async function fetchSkillMdContent(
  owner: string,
  repo: string,
  path: string
): Promise<string | null> {
  const headers = { 'User-Agent': 'skillfish' };

  // Try both branches in parallel
  const results = await Promise.allSettled(
    DEFAULT_BRANCHES.map(async branch => {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
      const res = await fetchWithRetry(url, { headers }, 2);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
  );

  // Return first successful result
  for (const result of results) {
    if (result.status === 'fulfilled') {
      return result.value;
    }
  }

  return null;
}

/**
 * Find all SKILL.md files in a GitHub repository.
 * Uses sequential branch checking to conserve API rate limit (60/hr unauthenticated).
 */
async function findAllSkillMdFiles(owner: string, repo: string): Promise<string[]> {
  const headers: Record<string, string> = { 'User-Agent': 'skillfish' };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    // Try each branch sequentially to conserve rate limit
    for (const branch of DEFAULT_BRANCHES) {
      const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

      try {
        const res = await fetchWithRetry(url, { headers, signal: controller.signal });

        // Check for rate limiting
        if (res.status === 403) {
          const remaining = res.headers.get('X-RateLimit-Remaining');
          if (remaining === '0') {
            const errorMsg = 'GitHub API rate limit exceeded. Please try again later.';
            if (jsonMode) {
              addJsonError(errorMsg);
            } else {
              console.error(errorMsg);
            }
            return [];
          }
        }

        // 404 means branch doesn't exist, try next
        if (res.status === 404) {
          continue;
        }

        if (!res.ok) {
          continue;
        }

        const rawData: unknown = await res.json();

        if (!isGitTreeResponse(rawData)) {
          const errorMsg = 'Unexpected response format from GitHub API.';
          if (jsonMode) {
            addJsonError(errorMsg);
          } else {
            console.error(errorMsg);
          }
          return [];
        }

        return extractSkillPaths(rawData, SKILL_FILENAME);
      } catch (err) {
        // If this is the last branch, let the error propagate
        if (branch === DEFAULT_BRANCHES[DEFAULT_BRANCHES.length - 1]) {
          throw err;
        }
        // Otherwise try next branch
        continue;
      }
    }

    // No branch found
    const errorMsg = 'Repository not found. Check the owner/repo name.';
    if (jsonMode) {
      addJsonError(errorMsg);
    } else {
      console.error(errorMsg);
    }
    return [];
  } catch (err: unknown) {
    let errorMsg: string;
    if (err instanceof Error && err.name === 'AbortError') {
      errorMsg = 'Request timed out. Check your network connection.';
    } else {
      errorMsg = `Network error: ${err instanceof Error ? err.message : 'unknown error'}`;
    }

    if (jsonMode) {
      addJsonError(errorMsg);
    } else {
      console.error(errorMsg);
    }
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

main().catch(err => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Error:', message);
  process.exit(1);
});
