<p align="center">
  <img src="https://raw.githubusercontent.com/knoxgraeme/skillfish/main/assets/logo.png" alt="skillfish" width="600">
</p>

<p align="center">
  <a href="https://npmjs.com/package/skillfish"><img src="https://img.shields.io/npm/v/skillfish" alt="npm"></a>
  <a href="https://npmjs.com/package/skillfish"><img src="https://img.shields.io/npm/dm/skillfish" alt="downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/skillfish" alt="license"></a>
  <a href="package.json"><img src="https://img.shields.io/node/v/skillfish" alt="node"></a>
  <a href="https://github.com/knoxgraeme/skillfish/actions"><img src="https://github.com/knoxgraeme/skillfish/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

<p align="center">
  <strong>The skill manager for AI coding agents.</strong><br>
  Install, update, and sync skills across Claude Code, Cursor, Copilot + more.
</p>

---

## Quick Start

```bash
# One-off skill installation
npx skillfish add owner/repo

# For skill management (list, update, remove), install globally
npm i -g skillfish
```

One command installs to **all detected agents** on your system.

> [!TIP]
> **New:** [Sync skills across your team](#team-skill-sync) with `skillfish bundle`.

## What Are Agent Skills?

Agent Skills are portable packages of instructions, prompts, scripts, and resources that AI coding agents can discover and use. They give agents like Claude Code, Cursor, and Copilot domain expertise, reusable workflows, and team-specific context - loaded on demand to extend capabilities.

Each skill contains a `SKILL.md` file with structured prompts and instructions the agent can follow.

Learn more at [agentskills.io](https://agentskills.io).

## Find Skills

- **[skill.fish](https://skill.fish)** - Browse and discover community skills
- **[MCP Market](https://mcpmarket.com/tools/skills)** - Skills directory
- **`skillfish search <query>`** - Search from the command line

## Commands

| Command | Description |
|---------|-------------|
| `skillfish add <owner/repo>` | Install skills |
| `skillfish init` | Create a new skill |
| `skillfish list` | View installed skills |
| `skillfish remove [name]` | Remove skills |
| `skillfish search <query>` | Search for skills on skill.fish |
| `skillfish update` | Update installed skills |
| `skillfish bundle` | Create a manifest from installed skills |
| `skillfish install` | Install skills from a manifest |
| `skillfish submit <repo>` | Submit skills to skill.fish |

All commands support `--json` for automation.

## Examples

```bash
skillfish add owner/repo             # Install from a repository
skillfish add owner/repo --all       # Install all skills from repo
skillfish init                       # Create a new skill (interactive)
skillfish init --name my-skill       # Create with a specified name
skillfish list                       # See what's installed
skillfish search github              # Search for skills
skillfish update                     # Update all skills
skillfish remove old-skill           # Remove a skill
skillfish submit owner/repo          # Submit your skills to skill.fish
skillfish bundle                     # Create skillfish.json from installed skills
skillfish install                    # Sync skills from manifest
skillfish install --dry-run          # Preview what would change
```

## Team Skill Sync

Share skills across your team by committing a `skillfish.json` manifest to your repository.

**Setup (one developer):**
```bash
skillfish add owner/repo             # Install skills your team needs
skillfish bundle                     # Create skillfish.json manifest
git add skillfish.json && git commit -m "Add skill manifest"
```

**Sync (other developers):**
```bash
skillfish install                    # Install skills from manifest
```

The manifest tracks external skills only. Local skills (created with `skillfish init`) are version-controlled directly in your project.

### How It Works

1. `skillfish bundle` scans your installed skills and creates `skillfish.json`
2. `skillfish install` reads the manifest and syncs your local skills to match:
   - **Installs** skills listed in the manifest
   - **Updates** skills when the ref changes
   - **Removes** manifest-managed skills that are no longer listed
3. Manually installed skills (`skillfish add`) are protected from removal

### Manifest Format

```json
{
  "version": 1,
  "skills": [
    "owner/repo",
    "owner/repo@v1.0.0",
    "owner/repo/path/to/skill",
    "owner/repo@main/skills/my-skill"
  ]
}
```

Skills can be pinned to a specific ref (tag, branch, or commit) using `@ref` syntax.

## Supported Agents

Works with 32 agents including:

**Claude Code** · **Cursor** · **Windsurf** · **Codex** · **GitHub Copilot** · **Gemini CLI** · **OpenCode** · **Goose** · **Amp** · **Roo Code** · **Kiro CLI** · **Kilo Code** · **Trae** · **Cline** · **Antigravity** · **Droid** · **Augment** · **OpenClaw** · **CodeBuddy** · **Command Code** · **Crush** · **Kode** · **Mistral Vibe** · **Mux** · **OpenClaude IDE** · **OpenHands** · **Qoder** · **Qwen Code** · **Replit** · **Trae CN** · **Neovate** · **AdaL**

<details>
<summary>All supported agents</summary>

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
| Augment | `~/.augment/rules/` |
| OpenClaw | `~/.moltbot/skills/` |
| CodeBuddy | `~/.codebuddy/skills/` |
| Command Code | `~/.commandcode/skills/` |
| Crush | `~/.config/crush/skills/` |
| Kode | `~/.kode/skills/` |
| Mistral Vibe | `~/.vibe/skills/` |
| Mux | `~/.mux/skills/` |
| OpenClaude IDE | `~/.openclaude/skills/` |
| OpenHands | `~/.openhands/skills/` |
| Qoder | `~/.qoder/skills/` |
| Qwen Code | `~/.qwen/skills/` |
| Replit | `.agent/skills/` (project-only) |
| Trae CN | `~/.trae-cn/skills/` |
| Neovate | `~/.neovate/skills/` |
| AdaL | `~/.adal/skills/` |

</details>

---

## Command Reference

### add

Install skills from a repository.

```bash
skillfish add owner/repo                    # Auto-discover SKILL.md
skillfish add owner/repo my-skill           # Install by skill name
skillfish add owner/repo/path/to/skill      # Full path syntax
skillfish add owner/repo --path skills/foo  # Explicit path
skillfish add owner/repo --all              # Install all skills
skillfish add owner/repo --force            # Overwrite existing
skillfish add owner/repo --yes              # Skip confirmation
skillfish add owner/repo --project          # Project only (./)
skillfish add owner/repo --global           # Global only (~/)
```

### init

Create a new skill template with `SKILL.md` and optional directories.

```bash
skillfish init                                  # Interactive skill creation
skillfish init --name my-skill                  # Specify skill name
skillfish init --name my-skill --description "Does a thing"  # Non-interactive
skillfish init --project                        # Create in current project (./)
skillfish init --global                         # Create in home directory (~/)
skillfish init --name my-skill --yes            # Skip all prompts
skillfish init --author "your-name"             # Set author metadata
skillfish init --license MIT                    # Set license
```

Interactive mode prompts for name, description, optional metadata (author, license), optional directories (`scripts/`, `references/`, `assets/`), install location, and target agents.

### list

View installed skills.

```bash
skillfish list                       # List all installed skills
skillfish list --global              # Global skills only (~/)
skillfish list --project             # Project skills only (./)
skillfish list --agent "Claude Code" # Specific agent
```

### remove

Remove installed skills.

```bash
skillfish remove                          # Interactive picker
skillfish remove my-skill                 # By name
skillfish remove --all                    # Remove all
skillfish remove my-skill --project       # Project only
skillfish remove my-skill --global        # Global only
skillfish remove my-skill --agent "Cursor" # Specific agent
skillfish remove my-skill --yes           # Skip confirmation
```

### search

Search for skills on [skill.fish](https://skill.fish).

```bash
skillfish search github              # Search for skills
skillfish search "code review"       # Search with multiple words
skillfish search git --limit 10      # Limit results (default: 5, max: 50)
```

### update

Update installed skills to latest version.

```bash
skillfish update                     # Check for updates interactively
skillfish update --yes               # Update all without prompting
skillfish update --json              # Check for updates (JSON output)
```

### bundle

Create a `skillfish.json` manifest from currently installed skills.

```bash
skillfish bundle                     # Bundle project skills to ./skillfish.json
skillfish bundle --global            # Bundle global skills to ~/skillfish.json
skillfish bundle --json              # Output bundled skills as JSON
```

Local skills (created with `skillfish init`) are excluded from the manifest since they're version-controlled with your project.

### install

Install skills from a `skillfish.json` manifest.

```bash
skillfish install                    # Install from manifest (auto-detects location)
skillfish install --project          # Install from ./skillfish.json
skillfish install --global           # Install from ~/skillfish.json
skillfish install --dry-run          # Preview changes without installing
skillfish install --yes              # Skip confirmation prompts
```

When a skill is removed from the manifest, `skillfish install` removes it from your system. Manually installed skills are never removed automatically.

### submit

Submit your skills to [skill.fish](https://skill.fish) for others to discover. Just paste a GitHub URL.

```bash
skillfish submit https://github.com/owner/repo   # Paste any GitHub URL
skillfish submit owner/repo                      # Or use owner/repo format
skillfish submit owner/repo --yes                # Skip confirmation
```

Your submission will be reviewed and added to [skill.fish](https://skill.fish) and [MCP Market](https://mcpmarket.com).

---

## Non-Interactive Mode

All commands work without prompts for use in scripts, CI pipelines, and automation. Non-interactive mode activates when:

- The `--json` flag is passed, or
- stdin is not a TTY (piped input, CI runners, cron jobs)

In non-interactive mode, commands use default values where possible and error with guidance when required flags are missing.

### Required flags

| Command | Required | Defaults |
|---------|----------|----------|
| `add` | `<owner/repo>` + skill name, `--path`, or `--all` if repo has multiple skills | Location: global (`~/`), Agents: all detected |
| `init` | `--name`, `--description` | Location: project (`./`), Agents: all detected |
| `list` | (none) | Both locations, all agents |
| `remove` | Skill name or `--all` | Both locations, all agents |
| `update` | `--yes` to apply updates | All tracked skills |
| `bundle` | (none) | Location: project (`./`) |
| `install` | (none) | Location: project (`./`), `--yes` to apply |

All commands accept `--project` or `--global` to override the default location.

### Confirmation behavior

Confirmation prompts are skipped in non-interactive mode. Commands that modify skills (`add`, `init`, `remove`) proceed automatically. The `update` command is the exception: `--json` without `--yes` runs in **check-only mode**, reporting outdated skills without applying changes.

Use `--yes` to explicitly skip confirmations in interactive mode.

### JSON output

Pass `--json` to get structured output on stdout. All commands return a common shape:

```json
{
  "success": true,
  "exit_code": 0,
  "errors": []
}
```

Each command adds its own fields: `installed` and `skipped` (add), `created` and `skipped` (init), `removed` (remove), `outdated` and `updated` (update), `installed` and `agents_detected` (list).

### Exit codes

Exit codes are consistent across all commands:

| Code | Name | Meaning |
|------|------|---------|
| 0 | Success | Command completed successfully |
| 1 | General Error | Unspecified error |
| 2 | Invalid Args | Invalid arguments or options provided |
| 3 | Network Error | Network failure (timeout, rate limit) |
| 4 | Not Found | Requested resource not found (skill, agent, repo) |

### CI example

```bash
# Install skills in CI (non-interactive, JSON output)
skillfish add owner/repo --yes --json

# Create a skill template in CI
skillfish init --name my-skill --description "My skill" --project --json

# Check for outdated skills without applying
skillfish update --json

# Apply updates
skillfish update --yes --json
```

---

## Security

Skills are markdown files that provide instructions to AI agents. Always review skills before installing. skillfish does not vet third-party skills.

To report vulnerabilities, email security@skill.fish. See [SECURITY.md](SECURITY.md).

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

<details>
<summary>Telemetry</summary>

Anonymous, aggregate install counts only. No PII collected.

To opt out: `DO_NOT_TRACK=1` or `CI=true`.

</details>

## License

[AGPL-3.0](LICENSE) - Graeme Knox
