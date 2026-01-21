#!/usr/bin/env node
import { existsSync, mkdirSync, cpSync, rmSync, lstatSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join, basename, dirname, normalize, isAbsolute } from 'path';
import { randomUUID } from 'crypto';
import degit from 'degit';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { trackInstall } from './telemetry.js';

const VERSION = '1.0.0';

// Agent configuration
type Agent = {
  readonly name: string;
  readonly dir: string;
  readonly detect: () => boolean;
};

// Detection checks for:
// 1. Agent config files in home directory (agent is installed globally)
// 2. Existing skill directories in current project (agent was used locally before)
// Supports all agents from the Agent Skills specification: https://agentskills.io
const AGENTS: readonly Agent[] = [
  // === Primary Agents (widely used) ===
  {
    name: 'Claude Code',
    dir: '.claude/skills',
    detect: () =>
      existsSync(join(homedir(), '.claude', 'settings.json')) ||
      existsSync(join(homedir(), '.claude', 'projects.json')) ||
      existsSync(join(homedir(), '.claude', 'credentials.json')) ||
      existsSync(join(process.cwd(), '.claude')),
  },
  {
    name: 'Cursor',
    dir: '.cursor/skills',
    detect: () =>
      existsSync(join(homedir(), '.cursor', 'extensions')) ||
      existsSync(join(homedir(), '.cursor', 'argv.json')) ||
      existsSync(join(process.cwd(), '.cursor')),
  },
  {
    name: 'Windsurf',
    dir: '.codeium/windsurf/skills',
    detect: () =>
      existsSync(join(homedir(), '.codeium', 'windsurf', 'config.json')) ||
      existsSync(join(homedir(), '.codeium', 'windsurf', 'argv.json')) ||
      existsSync(join(process.cwd(), '.codeium', 'windsurf')),
  },
  {
    name: 'Codex',
    dir: '.codex/skills',
    detect: () =>
      existsSync(join(homedir(), '.codex', 'config.json')) ||
      existsSync(join(homedir(), '.codex', 'settings.json')) ||
      existsSync(join(homedir(), '.codex')) ||
      existsSync(join(process.cwd(), '.codex')),
  },
  {
    name: 'GitHub Copilot',
    dir: '.github/skills',
    detect: () =>
      existsSync(join(homedir(), '.copilot', 'config.json')) ||
      existsSync(join(homedir(), '.copilot')) ||
      existsSync(join(process.cwd(), '.github', 'skills')) ||
      existsSync(join(process.cwd(), '.github', 'copilot-instructions.md')),
  },
  {
    name: 'Gemini CLI',
    dir: '.gemini/skills',
    detect: () =>
      existsSync(join(homedir(), '.gemini')) ||
      existsSync(join(process.cwd(), '.gemini')),
  },
  {
    name: 'OpenCode',
    dir: '.opencode/skills',
    detect: () =>
      existsSync(join(homedir(), '.config', 'opencode')) ||
      existsSync(join(homedir(), '.opencode')) ||
      existsSync(join(process.cwd(), '.opencode')),
  },
  {
    name: 'Goose',
    dir: '.goose/skills',
    detect: () =>
      existsSync(join(homedir(), '.config', 'goose')) ||
      existsSync(join(process.cwd(), '.goose')),
  },
  // === Secondary Agents ===
  {
    name: 'Amp',
    dir: '.agents/skills',
    detect: () =>
      existsSync(join(homedir(), '.config', 'amp')) ||
      existsSync(join(process.cwd(), '.agents')),
  },
  {
    name: 'Roo Code',
    dir: '.roo/skills',
    detect: () =>
      existsSync(join(homedir(), '.roo')) ||
      existsSync(join(process.cwd(), '.roo')),
  },
  {
    name: 'Kiro CLI',
    dir: '.kiro/skills',
    detect: () =>
      existsSync(join(homedir(), '.kiro')) ||
      existsSync(join(process.cwd(), '.kiro')),
  },
  {
    name: 'Kilo Code',
    dir: '.kilocode/skills',
    detect: () =>
      existsSync(join(homedir(), '.kilocode')) ||
      existsSync(join(process.cwd(), '.kilocode')),
  },
  {
    name: 'Trae',
    dir: '.trae/skills',
    detect: () =>
      existsSync(join(homedir(), '.trae')) ||
      existsSync(join(process.cwd(), '.trae')),
  },
  {
    name: 'Cline',
    dir: '.cline/skills',
    detect: () =>
      existsSync(join(homedir(), '.cline', 'settings.json')) ||
      existsSync(join(homedir(), '.cline')) ||
      existsSync(join(process.cwd(), '.cline')),
  },
  // === Additional Agents ===
  {
    name: 'Antigravity',
    dir: '.gemini/antigravity/skills',
    detect: () =>
      existsSync(join(homedir(), '.gemini', 'antigravity')) ||
      existsSync(join(process.cwd(), '.agent')),
  },
  {
    name: 'Droid',
    dir: '.factory/skills',
    detect: () =>
      existsSync(join(homedir(), '.factory')) ||
      existsSync(join(process.cwd(), '.factory')),
  },
  {
    name: 'Clawdbot',
    dir: '.clawdbot/skills',
    detect: () =>
      existsSync(join(homedir(), '.clawdbot')) ||
      existsSync(join(process.cwd(), '.clawdbot')),
  },
];

/**
 * Validates a path to prevent directory traversal attacks.
 * Ensures path doesn't escape the intended directory.
 */
function isValidPath(pathStr: string): boolean {
  // Reject absolute paths
  if (isAbsolute(pathStr)) return false;

  // Normalize and check for directory traversal
  const normalized = normalize(pathStr);
  if (normalized.startsWith('..') || normalized.includes('/../')) return false;

  // Only allow alphanumeric, dots, hyphens, underscores, and forward slashes
  if (!/^[\w./-]+$/.test(pathStr)) return false;

  // Reject paths that could be problematic
  if (pathStr.includes('//') || pathStr.startsWith('/')) return false;

  return true;
}

/**
 * Recursively copies a directory while skipping symlinks for security.
 * This prevents symlink attacks where malicious repos could link to sensitive files.
 */
function safeCopyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });

  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    // Skip symlinks for security
    if (entry.isSymbolicLink()) {
      console.log(`  ${pc.yellow('!')} Skipped symlink: ${pc.dim(entry.name)}`);
      continue;
    }

    if (entry.isDirectory()) {
      safeCopyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      cpSync(srcPath, destPath);
    }
  }
}

async function main(): Promise<void> {
  const [, , repoArg, ...flags] = process.argv;

  // Handle --version flag
  if (repoArg === '--version' || repoArg === '-v') {
    console.log(`skillfish v${VERSION}`);
    process.exit(0);
  }

  if (!repoArg || repoArg === '--help' || repoArg === '-h') {
    console.log(`
${pc.bold('skillfish')} v${VERSION} - Install AI agent skills from GitHub

${pc.dim('Usage:')}
  skillfish ${pc.cyan('<owner/repo>')} [options]
  skillfish ${pc.cyan('<owner/repo/path/to/skill>')}

${pc.dim('Options:')}
  --path <path>   Path to skill directory within repo
  --force         Overwrite existing skills
  --project       Install to current project (./)
  --global        Install to home directory (~/)
  --version, -v   Show version
  --help, -h      Show help

${pc.dim('Examples:')}
  skillfish anthropics/claude-code
  skillfish f/awesome-chatgpt-prompts
  skillfish owner/repo --path skills/my-skill
  skillfish owner/repo --force --project
`);
    process.exit(repoArg ? 0 : 1);
  }

  // Show banner and intro (TTY only)
  if (process.stdout.isTTY) {
    console.log();
    console.log(pc.cyan('     ≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋'));
    console.log(`       ${pc.cyan('><>')}  ${pc.bold('SKILL FISH')}  ${pc.cyan('><>')}`);
    console.log(pc.cyan('     ≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋'));
    console.log();
    p.intro(`${pc.bgCyan(pc.black(' skillfish '))} ${pc.dim(`v${VERSION}`)}`);
  }

  const force = flags.includes('--force');
  const projectFlag = flags.includes('--project');
  const globalFlag = flags.includes('--global');
  const pathIdx = flags.indexOf('--path');
  let explicitPath: string | null = null;
  if (pathIdx !== -1) {
    if (pathIdx + 1 >= flags.length || flags[pathIdx + 1]?.startsWith('--')) {
      console.error('--path requires a value');
      process.exit(1);
    }
    const pathValue = flags[pathIdx + 1];
    // Security: validate path to prevent directory traversal
    if (!isValidPath(pathValue)) {
      console.error('Invalid --path value. Path must be relative and contain only safe characters.');
      process.exit(1);
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
      console.error('Invalid plugin or skill name. Use only alphanumeric characters, dots, hyphens, and underscores.');
      process.exit(1);
    }
    explicitPath = explicitPath || `plugins/${plugin}/skills/${skill}`;
    console.log(`Detected full path format: ${plugin}/${skill}`);
  } else {
    console.error('Invalid format. Use: owner/repo or owner/repo/plugin/skill');
    process.exit(1);
  }

  // Validate (security: prevent injection)
  if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    console.error('Invalid repository format. Use: owner/repo');
    process.exit(1);
  }

  // 1. Discover or select skills
  const skillPaths = explicitPath
    ? [explicitPath]
    : await discoverSkillPaths(owner, repo);

  if (!skillPaths || skillPaths.length === 0) {
    process.exit(1);
  }

  // 2. Determine install location (global vs project)
  const baseDir = await selectInstallLocation(projectFlag, globalFlag);

  // 3. Select agents to install to
  const detected = AGENTS.filter(a => a.detect());

  if (detected.length === 0) {
    p.log.error('No agents detected. Install Claude Code, Cursor, or another supported agent first.');
    p.outro(pc.dim('https://skill.fish/agents'));
    process.exit(1);
  }

  let targetAgents: readonly Agent[];

  if (!process.stdin.isTTY) {
    // Non-TTY: use all detected agents
    console.log(`Installing to ${detected.length} agent(s): ${detected.map(a => a.name).join(', ')}`);
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
  console.log();
  if (totalInstalled > 0) {
    p.outro(pc.green(`Done! Installed ${totalInstalled} skill${totalInstalled === 1 ? '' : 's'}`));
  } else if (totalSkipped > 0) {
    p.outro(pc.yellow(`Skipped ${totalSkipped} existing skill${totalSkipped === 1 ? '' : 's'} - use --force to overwrite`));
  } else {
    p.outro(pc.yellow('No skills installed'));
  }
}

async function selectInstallLocation(projectFlag: boolean, globalFlag: boolean): Promise<string> {
  // If flag specified, use it
  if (projectFlag) {
    p.log.info(`Location: ${pc.cyan('Project')} ${pc.dim('(./')}${pc.dim(AGENTS[0].dir)}${pc.dim(')')}`);
    return process.cwd();
  }
  if (globalFlag) {
    p.log.info(`Location: ${pc.cyan('Global')} ${pc.dim('(~/')}${pc.dim(AGENTS[0].dir)}${pc.dim(')')}`);
    return homedir();
  }

  // Non-TTY defaults to global
  if (!process.stdin.isTTY) {
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
    process.exit(0);
  }

  return location === 'project' ? process.cwd() : homedir();
}

async function selectAgents(agents: readonly Agent[], isLocal: boolean): Promise<readonly Agent[]> {
  const pathPrefix = isLocal ? '.' : '~';

  // Show detected agents
  p.log.info(`Detected ${pc.cyan(agents.length.toString())} agent${agents.length === 1 ? '' : 's'}: ${agents.map(a => a.name).join(', ')}`);

  const installAll = await p.confirm({
    message: 'Install to all detected agents?',
    initialValue: true,
  });

  if (p.isCancel(installAll)) {
    p.cancel('Cancelled');
    process.exit(0);
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
    process.exit(0);
  }

  return agents.filter(a => selected.includes(a.name));
}

type SkillMetadata = {
  path: string;       // Full path to SKILL.md
  dir: string;        // Directory containing SKILL.md
  name: string;       // From frontmatter or folder name
  description: string; // From frontmatter or empty
};

async function discoverSkillPaths(owner: string, repo: string): Promise<string[] | null> {
  const skillPaths = await findAllSkillMdFiles(owner, repo);

  if (skillPaths.length === 0) {
    p.log.error('No SKILL.md found in repository');
    return null;
  }

  // Fetch frontmatter metadata for all skills in parallel
  const s = p.spinner();
  s.start('Fetching skill metadata...');

  const metadataPromises = skillPaths.map(async (sp): Promise<SkillMetadata> => {
    const skillDir = sp === 'SKILL.md' ? '.' : dirname(sp);
    const folderName = sp === 'SKILL.md' ? repo : basename(skillDir);

    // Fetch raw content to parse frontmatter
    const content = await fetchSkillMdContent(owner, repo, sp);
    const frontmatter = content ? parseFrontmatter(content) : {};

    return {
      path: sp,
      dir: skillDir === '.' ? 'SKILL.md' : skillDir,
      name: frontmatter.name || folderName,
      description: frontmatter.description || '',
    };
  });

  const skills = await Promise.all(metadataPromises);
  s.stop(`Found ${pc.cyan(skills.length.toString())} skill${skills.length === 1 ? '' : 's'}`);

  if (skills.length === 1) {
    const skill = skills[0];
    const displayName = toTitleCase(skill.name);
    const desc = skill.description ? truncate(skill.description, 60) : '';
    p.log.info(`${pc.bold(displayName)}${desc ? pc.dim(` - ${desc}`) : ''}`);
    return [skill.dir];
  }

  // Build options for selection with frontmatter metadata
  // Title in label, description in hint (shows on focus)
  const options = skills.map(skill => ({
    value: skill.dir,
    label: pc.bold(toTitleCase(skill.name)),
    hint: skill.description || undefined,
  }));

  // Non-TTY: list skills and exit with guidance
  if (!process.stdin.isTTY) {
    console.log(`\nFound ${skills.length} skills in this repository:`);
    for (const skill of skills) {
      const displayName = toTitleCase(skill.name);
      const desc = skill.description ? pc.dim(` - ${truncate(skill.description, 80)}`) : '';
      console.log(`  - ${displayName}${desc}`);
    }
    console.error('\nMultiple skills found. Use --path to specify which one (non-interactive mode).');
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
    process.exit(0);
  }

  return selected;
}

type InstallResult = {
  installed: number;
  skipped: number;
  failed: boolean;
};

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

  p.log.step(`Installing ${pc.bold(skillName)}`);

  const tmpDir = join(homedir(), '.cache', 'skillfish', `${owner}-${repo}-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    // Download skill
    const downloadPath = skillPath === 'SKILL.md' ? '' : skillPath;
    const degitPath = downloadPath ? `${owner}/${repo}/${downloadPath}` : `${owner}/${repo}`;

    const s = p.spinner();
    s.start(`Downloading ${skillName}...`);

    const emitter = degit(degitPath, { cache: false, force: true });
    await emitter.clone(tmpDir);

    // Validate download
    const skillMdPath = join(tmpDir, 'SKILL.md');
    if (!existsSync(skillMdPath)) {
      s.stop(pc.red('SKILL.md not found'));
      console.error(`Error: SKILL.md not found in downloaded content. Path may be incorrect.`);
      result.failed = true;
      return result;
    }

    s.stop(pc.green('Downloaded'));

    // Copy to each installed agent
    for (const agent of agents) {
      const destDir = join(baseDir, agent.dir, skillName);

      if (existsSync(destDir) && !force) {
        console.log(`  ${pc.yellow('●')} ${agent.name} ${pc.dim('(exists)')}`);
        result.skipped++;
        continue;
      }

      mkdirSync(join(baseDir, agent.dir), { recursive: true });
      if (existsSync(destDir)) rmSync(destDir, { recursive: true });
      // Use safe copy to skip symlinks (security: prevents symlink attacks)
      safeCopyDir(tmpDir, destDir);
      console.log(`  ${pc.green('✓')} ${agent.name} ${pc.dim(`→ ${pathPrefix}/${agent.dir}/${skillName}`)}`);
      result.installed++;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`Error: ${message}`));
    result.failed = true;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  return result;
}

function deriveSkillName(skillPath: string, repoName: string): string {
  if (skillPath === 'SKILL.md' || skillPath === './SKILL.md') {
    return repoName;
  }

  const normalized = skillPath.replace(/\/SKILL\.md$/i, '');
  const name = basename(normalized);

  if (!/^[\w.-]+$/.test(name)) {
    return repoName;
  }

  return name;
}

/**
 * Convert kebab-case or snake_case to Title Case.
 * "skill-lookup" → "Skill Lookup"
 * "my_cool_skill" → "My Cool Skill"
 */
function toTitleCase(str: string): string {
  return str
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Truncate text to a maximum length, adding ellipsis if needed.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trim() + '…';
}

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Extracts name and description fields with fallbacks.
 */
function parseFrontmatter(content: string): { name?: string; description?: string } {
  // Match frontmatter block: ---\n...\n---
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const yaml = match[1];

  // Extract name (handles quoted and unquoted values)
  const nameMatch = yaml.match(/^name:\s*["']?(.+?)["']?\s*$/m);
  const name = nameMatch?.[1]?.trim();

  // Extract description (handles quoted and unquoted values)
  const descMatch = yaml.match(/^description:\s*["']?(.+?)["']?\s*$/m);
  const description = descMatch?.[1]?.trim();

  return { name, description };
}

/**
 * Fetch raw SKILL.md content from GitHub.
 * Uses raw.githubusercontent.com which is not rate-limited like the API.
 */
async function fetchSkillMdContent(
  owner: string,
  repo: string,
  path: string,
  branch: string = 'main'
): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'skillfish' },
    });

    if (!res.ok) {
      // Try master branch if main fails
      if (branch === 'main') {
        return fetchSkillMdContent(owner, repo, path, 'master');
      }
      return null;
    }

    return await res.text();
  } catch {
    return null;
  }
}

async function findAllSkillMdFiles(owner: string, repo: string): Promise<string[]> {
  const headers: Record<string, string> = { 'User-Agent': 'skillfish' };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`,
      { headers, signal: controller.signal }
    );

    if (!res.ok) {
      // Check for rate limiting
      if (res.status === 403) {
        const remaining = res.headers.get('X-RateLimit-Remaining');
        if (remaining === '0') {
          console.error('GitHub API rate limit exceeded. Please try again later.');
          return [];
        }
      }

      // Try 'master' branch if 'main' fails
      const res2 = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/master?recursive=1`,
        { headers, signal: controller.signal }
      );
      if (!res2.ok) {
        if (res2.status === 404) {
          console.error('Repository not found. Check the owner/repo name.');
        }
        return [];
      }
      const data = await res2.json() as { tree?: Array<{ path: string; type: string }> };
      return (data.tree || [])
        .filter(item => item.type === 'blob' && item.path.endsWith('SKILL.md'))
        .map(item => item.path);
    }

    const data = await res.json() as { tree?: Array<{ path: string; type: string }> };
    return (data.tree || [])
      .filter(item => item.type === 'blob' && item.path.endsWith('SKILL.md'))
      .map(item => item.path);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('Request timed out. Check your network connection.');
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
