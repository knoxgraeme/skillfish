# Plan: Rename skillfish → sswskills

## Summary

Rename the CLI tool from "skillfish" to "sswskills", update manifest filenames, add
`GITHUB_TOKEN`-based auth for private repo support, and point registry/telemetry URLs to
internal placeholder endpoints.

---

## Phase 1: Core Branding Rename

1. **`package.json`** — Change `name` to `sswskills`, `bin.sswskills`, update `repository.url`,
   `bugs.url`, `homepage` to placeholder `https://github.com/SSWSydney/sswskills`
2. **`src/index.ts`** — Change `.name('skillfish')` → `.name('sswskills')`, update all CLI
   example strings and doc URL
3. **`src/lib/banner.ts`** — Update JSDoc comment; update `LOGO_LINES` ASCII art (or replace
   with a text placeholder if new art is not ready)
4. **`src/commands/add.ts`, `bundle.ts`, `install.ts`, `update.ts`** — Change `' skillfish '`
   intro string → `' sswskills '` in `p.intro()`; update all command examples and help text
5. **`src/commands/init.ts`, `search.ts`, `submit.ts`, `list.ts`, `remove.ts`** — Replace
   `skill.fish`/`skillfish` references in help text and outros
6. **`src/lib/constants.ts`**, **`src/utils.ts`** — Update JSDoc comments

---

## Phase 2: Manifest & File Renames

7. **`src/lib/manifest.ts`** — `MANIFEST_FILENAME` constant: `.skillfish.json` → `.sswskills.json`
8. **`src/lib/project-manifest.ts`** — `PROJECT_MANIFEST_FILENAME`: `skillfish.json` →
   `sswskills.json`; update all user-visible strings referencing the filename
9. **`src/lib/installer.ts`** — Cache dir: `~/.cache/skillfish` → `~/.cache/sswskills`; backup
   dir suffix: `.skillfish-backup` → `.sswskills-backup`; update manifest filename references
   in user-facing messages

---

## Phase 3: Private Repo Authentication

10. **`src/lib/github.ts`** — In every function that builds `headers`, add:
    ```ts
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    ```
    Covers `fetchDefaultBranch`, `fetchSkillMdContent`, `fetchTreeSha`, and any other API
    calls. Also update User-Agent: `'skillfish'` → `'sswskills'`.
11. **`src/lib/installer.ts`** — Pass `auth: process.env.GITHUB_TOKEN` to `downloadTemplate()`
    options (giget v3 supports this natively for private repos).

---

## Phase 4: Registry / Telemetry Endpoints

12. **`src/lib/registry.ts`** — Replace `REGISTRY_API_URL` and `REGISTRY_SEARCH_URL` with
    placeholder `https://api.sswskills.internal/...`; update User-Agent to `sswskills`; remove
    `mcpmarket.com` Referer header.
13. **`src/telemetry.ts`** — Replace `TELEMETRY_URL` with
    `https://api.sswskills.internal/telemetry` (or disable telemetry entirely by returning
    early — simplest for demo).

---

## Phase 5: Documentation & Config

14. **`README.md`** — Replace all `skillfish`/`skill.fish` references with `sswskills`
    equivalents
15. **`CLAUDE.md`** — Update architecture notes (manifest filenames, CLI name, overview)
16. **`CONTRIBUTING.md`** — Update clone URL and setup instructions
17. **`.gitignore`** — `skillfish.json` → `sswskills.json` (two occurrences)
18. **`.github/ISSUE_TEMPLATE/bug_report.yml`** — Update CLI name references
19. **`src/__tests__/installer.test.ts`** — Temp dir prefixes `skillfish-test-` →
    `sswskills-test-` for consistency

---

## Affected Files

| File | Changes |
|------|---------|
| `package.json` | name, bin, URLs |
| `src/index.ts` | CLI entry, name, examples |
| `src/lib/banner.ts` | ASCII art logo |
| `src/lib/manifest.ts` | `MANIFEST_FILENAME` constant |
| `src/lib/project-manifest.ts` | `PROJECT_MANIFEST_FILENAME` constant |
| `src/lib/installer.ts` | cache dir, backup suffix, giget auth |
| `src/lib/github.ts` | User-Agent, Authorization header |
| `src/lib/registry.ts` | API URLs, User-Agent |
| `src/telemetry.ts` | telemetry URL |
| `src/commands/add.ts` | intro banner, examples |
| `src/commands/bundle.ts` | intro banner, manifest filename strings |
| `src/commands/install.ts` | intro banner, manifest filename strings |
| `src/commands/update.ts` | intro banner, examples |
| `src/commands/init.ts` | outro URL |
| `src/commands/search.ts` | skill.fish URL references |
| `src/commands/submit.ts` | registry references |
| `README.md` | all user-facing docs |
| `CLAUDE.md` | architecture notes |
| `CONTRIBUTING.md` | setup instructions |
| `.gitignore` | manifest filename entry |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | CLI name |
| `src/__tests__/installer.test.ts` | temp dir prefix strings |

---

## Decisions

| Topic | Decision |
|-------|----------|
| Manifest filenames | `.sswskills.json` (per-skill) and `sswskills.json` (project) |
| Private repo auth | `GITHUB_TOKEN` env var only — no runtime prompts, no hardcoded tokens |
| Registry endpoints | Placeholder `https://api.sswskills.internal/...` — replace when internal registry is ready |
| Telemetry | Replace with internal placeholder URL (or disable for demo) |
| Default skill repo | No change — always specify `owner/repo` explicitly in `sswskills add` |
| Banner ASCII art | The current art spells "SKILL FISH" — needs regenerating for "SSW SKILLS"; can be deferred for demo |

---

## Verification Checklist

1. `npm run build` — TypeScript compiles without errors
2. `npm link` — registers `sswskills` binary locally
3. `sswskills --help` — binary name and all examples show `sswskills`
4. `export GITHUB_TOKEN=<pat> && sswskills add SSWSydney/<private-repo> --yes` — confirm private
   repo download works
5. `npm test` — no test regressions
6. After a successful install: confirm `.sswskills.json` is written inside the skill directory

---

## Local Demo (once rename is complete)

```bash
# 1. Build & register the binary
npm run build
npm link

# 2. Authenticate against the private GitHub repo
export GITHUB_TOKEN=<your-personal-access-token>   # needs `repo` (read) scope

# 3. Install a skill from your private repo
sswskills add SSWSydney/<your-private-repo>

# 4. Inspect what was installed
sswskills list

# 5. Clean up
sswskills remove <skill-name>
```
