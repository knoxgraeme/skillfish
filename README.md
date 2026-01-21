# skillfish

Install AI agent skills from GitHub with a single command.

```bash
npx skillfish owner/repo
```

## Overview

One command installs skills to **all detected agents**:
- Claude Code (`~/.claude/skills/`)
- Cursor (`~/.cursor/skills/`)
- Windsurf (`~/.codeium/windsurf/skills/`)
- Cline (`~/.cline/skills/`)
- Codex (`~/.codex/skills/`)
- GitHub Copilot (`~/.github/skills/`)

## Usage

```bash
# Auto-discover skill location (interactive if multiple found)
npx skillfish owner/repo

# Full path from GitHub
npx skillfish owner/repo/plugin/skill

# Specify explicit path
npx skillfish owner/repo --path path/to/skill

# Overwrite existing skills
npx skillfish owner/repo --force
```

## Interactive Selection

When a repo contains multiple skills, you'll get an interactive menu:

```
Found 15 skills in this repository:

  1) coding-tutor
  2) agent-browser
  3) agent-native-architecture
  ...

Select skill (1-15):
```

## Examples

```bash
# Install from a skill repo with SKILL.md at root
npx skillfish user/my-skill

# Install using full path from GitHub
npx skillfish EveryInc/compound-engineering-plugin/compound-engineering/frontend-design

# Install from a plugin repo with explicit path
npx skillfish org/plugin-repo --path plugins/my-plugin/skills/skill-name

# Force reinstall
npx skillfish user/skill --force
```

## Private Repos

Set `GITHUB_TOKEN` or `GH_TOKEN` environment variable:

```bash
GITHUB_TOKEN=ghp_xxx npx skillfish private-org/private-repo
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

## License

MIT
