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

## What Are Agent Skills?

Agent Skills are portable packages of instructions, prompts, scripts, and resources that AI coding agents can discover and use. They give agents like Claude Code, Cursor, and Copilot domain expertise, reusable workflows, and team-specific context - loaded on demand to extend capabilities.

Each skill contains a `SKILL.md` file with structured prompts and instructions the agent can follow.

Learn more at [agentskills.io](https://agentskills.io).

## Find Skills

- **[skill.fish](https://skill.fish)** - Browse and discover community skills
- **[MCP Market](https://mcpmarket.com/tools/skills)** - Skills directory

## Commands

| Command | Description |
|---------|-------------|
| `skillfish add <owner/repo>` | Install skills |
| `skillfish init` | Create a new skill |
| `skillfish list` | View installed skills |
| `skillfish remove [name]` | Remove skills |
| `skillfish update` | Update installed skills |

All commands support `--json` for automation.

## Examples

```bash
skillfish add owner/repo             # Install from a repository
skillfish add owner/repo --all       # Install all skills from repo
skillfish init                       # Create a new skill (interactive)
skillfish init --name my-skill       # Create with a specified name
skillfish list                       # See what's installed
skillfish update                     # Update all skills
skillfish remove old-skill           # Remove a skill
```

## Supported Agents

Works with 17+ agents including:

**Claude Code** · **Cursor** · **Windsurf** · **Codex** · **GitHub Copilot** · **Gemini CLI** · **OpenCode** · **Goose** · **Amp** · **Roo Code** · **Kiro CLI** · **Kilo Code** · **Trae** · **Cline** · **Antigravity** · **Droid** · **Clawdbot**

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
| Clawdbot | `~/.clawdbot/skills/` |

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

### update

Update installed skills to latest version.

```bash
skillfish update                     # Check for updates interactively
skillfish update --yes               # Update all without prompting
skillfish update --json              # Check for updates (JSON output)
```

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
