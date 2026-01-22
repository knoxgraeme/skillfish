# skillfish

Install AI agent skills from GitHub with a single command.

```bash
npx skillfish owner/repo
```

## Overview

One command installs skills to **all detected agents**:

| Agent | Skills Directory |
|-------|------------------|
| Claude Code | `~/.claude/skills/` |
| Cursor | `~/.cursor/skills/` |
| Windsurf | `~/.codeium/windsurf/skills/` |
| Codex | `~/.codex/skills/` |
| GitHub Copilot | `~/.github/skills/` |
| Gemini CLI | `~/.gemini/skills/` |
| OpenCode | `~/.opencode/skills/` |
| Goose | `~/.goose/skills/` |
| Amp | `~/.agents/skills/` |
| Roo Code | `~/.roo/skills/` |
| Kiro CLI | `~/.kiro/skills/` |
| Kilo Code | `~/.kilocode/skills/` |
| Trae | `~/.trae/skills/` |
| Cline | `~/.cline/skills/` |
| Antigravity | `~/.gemini/antigravity/skills/` |
| Droid | `~/.factory/skills/` |
| Clawdbot | `~/.clawdbot/skills/` |

## Usage

### Install Skills

```bash
# Install a skill (auto-discovers SKILL.md location)
npx skillfish add owner/repo

# Full path from GitHub (plugin/skill syntax)
npx skillfish add owner/repo/plugin/skill

# Specify explicit path
npx skillfish add owner/repo --path path/to/skill

# Install all skills from a repo (non-interactive)
npx skillfish add owner/repo --all

# Overwrite existing skills
npx skillfish add owner/repo --force

# Skip confirmation prompt
npx skillfish add owner/repo --yes
```

### List Skills

```bash
# Interactive agent and location picker
npx skillfish list

# List global skills only
npx skillfish list --global

# List project skills only
npx skillfish list --project

# List skills for a specific agent
npx skillfish list --agent "Claude Code"
```

### Remove Skills

```bash
# Interactive skill picker
npx skillfish remove

# Remove a skill by name
npx skillfish remove my-skill

# Remove all installed skills
npx skillfish remove --all

# Remove from current project only
npx skillfish remove my-skill --project

# Remove from home directory only
npx skillfish remove my-skill --global

# Remove from specific agent
npx skillfish remove my-skill --agent "Claude Code"

# Skip confirmation prompt
npx skillfish remove my-skill --yes
```

## Interactive Selection

When a repo contains multiple skills, you'll get an interactive multi-select menu with skill names and descriptions from frontmatter:

```
◆  Select skills to install
│  ◻ Frontend Design - Create distinctive, production-grade frontend interfaces
│  ◻ Agent Browser - Browser automation using Vercel's agent-browser CLI
│  ◻ Git Worktree - Manage Git worktrees for isolated parallel development
│  ...
└
```

Use `--all` to install all skills non-interactively (useful for automation).

## Examples

```bash
# Install from a skill repo with SKILL.md at root
npx skillfish add user/my-skill

# Install using full path from GitHub
npx skillfish add EveryInc/compound-engineering-plugin/compound-engineering/frontend-design

# Install from a plugin repo with explicit path
npx skillfish add org/plugin-repo --path plugins/my-plugin/skills/skill-name

# Install all skills non-interactively
npx skillfish add org/plugin-repo --all --yes

# Force reinstall
npx skillfish add user/skill --force

# JSON output for automation
npx skillfish add owner/repo --json
```

## Discovery

The CLI searches these locations for `SKILL.md`:
1. Repository root
2. `.claude/skills/{repo}/`
3. `skills/{repo}/`
4. `plugins/{repo}/skills/{repo}/`

Use `--path` to skip discovery and specify the exact location.

## Telemetry

This CLI collects anonymous, aggregate install counts to understand skill popularity. No personally identifiable information is collected.

**What is collected:**
- Skill identifier (e.g., `owner/repo/skill-name`)
- Incremented install count

**What is NOT collected:**
- IP addresses
- User identifiers
- System information
- Usage patterns

To opt out, set `DO_NOT_TRACK=1` in your environment:

```bash
DO_NOT_TRACK=1 npx skillfish owner/repo
```

Telemetry is also automatically disabled in CI environments (`CI=true`).

## Exit Codes

Exit codes help agents and scripts understand command results without parsing error messages.

| Code | Name | Meaning |
|------|------|---------|
| 0 | Success | Command completed successfully |
| 1 | General Error | Unspecified error |
| 2 | Invalid Args | Invalid arguments or options provided |
| 3 | Network Error | Network failure (timeout, rate limit) |
| 4 | Not Found | Requested resource not found (skill, agent, repo) |

JSON output includes `exit_code` for programmatic access:

```bash
skillfish add owner/repo --json
# Output includes: "exit_code": 0 (or error code)
```

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

AGPL-3.0
