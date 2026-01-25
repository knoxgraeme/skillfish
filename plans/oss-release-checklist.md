# Open Source Release Checklist for skillfish

> **License:** AGPL-3.0 (prevents proprietary SaaS forks)
> **Contribution Model:** Accept external PRs with maintainer approval
> **Created:** 2026-01-24

---

## Phase 1: Legal & Security (Do First)

### License Verification
- [x] LICENSE file contains AGPL-3.0 ✓
- [x] package.json `license` field is `AGPL-3.0` ✓
- [x] Verify README.md license section is accurate ✓
- [x] Add license badge to README ✓

### Security Policy
- [ ] Create `SECURITY.md` with:
  - Supported versions table
  - Private disclosure email (e.g., security@skill.fish)
  - Expected response timeline (48-72 hours)
  - What to include in reports
  - Security measures already in place (path validation, symlink protection)

### Telemetry Transparency
- [x] Telemetry opt-out documented in README ✓
- [ ] Verify `mcpmarket.com` domain ownership is documented/stable
- [ ] Consider adding privacy policy link

---

## Phase 2: Community Health Files

### Code of Conduct
- [ ] Create `CODE_OF_CONDUCT.md` using [Contributor Covenant v2.1](https://www.contributor-covenant.org/)
- [ ] Add enforcement contact email

### Changelog
- [ ] Create `CHANGELOG.md` using [Keep a Changelog](https://keepachangelog.com/) format
- [ ] Backfill entries for versions 1.0.0 through 1.0.8
- [ ] Include git commit hashes for reference

### Contributing Guide Enhancement
- [x] Fix incorrect path reference in CONTRIBUTING.md line 48 ✓
  - Change `src/index.ts` → `src/lib/agents.ts` for AGENT_CONFIGS location
- [x] Add DCO (Developer Certificate of Origin) section ✓
- [x] Add "First-Time Contributors" section with step-by-step guide ✓
- [x] Add testing instructions (`npm test`, `npm run build`) ✓
- [x] Add code style expectations (will be enforced by ESLint/Prettier) ✓

---

## Phase 3: GitHub Infrastructure

### Issue Templates
Create `.github/ISSUE_TEMPLATE/` directory with:

- [x] `bug_report.yml` - Bug reports with version, OS, reproduction steps ✓
- [x] `feature_request.yml` - Feature requests with problem/solution format ✓
- [x] `agent_support.yml` - Requests to add new AI agent support ✓
- [x] `config.yml` - Disable blank issues, link to discussions ✓

### Pull Request Template
- [x] Create `.github/PULL_REQUEST_TEMPLATE.md` with: ✓
  - Summary section
  - Related issue link
  - Type of change checkboxes
  - Testing checklist
  - Contributor checklist (tests pass, docs updated)

### Repository Configuration
- [x] Create `.github/CODEOWNERS` assigning @knoxgraeme as owner ✓
- [ ] Create `.github/FUNDING.yml` for GitHub Sponsors (optional)
- [ ] Enable GitHub Discussions for Q&A (manual step in GitHub settings)
- [ ] Configure branch protection on `main` (manual step in GitHub settings):
  - Require PR reviews before merge
  - Require status checks to pass
  - Prevent force-push
  - Require signed commits (optional)

---

## Phase 4: Code Quality Tooling

### ESLint Setup
- [x] Install dependencies ✓
  ```bash
  npm install -D eslint @eslint/js typescript-eslint eslint-config-prettier
  ```
- [x] Create `eslint.config.mjs` with TypeScript strict rules ✓
- [x] Add `npm run lint` script to package.json ✓
- [x] Add `npm run lint:fix` script ✓

### Prettier Setup
- [x] Install Prettier ✓
  ```bash
  npm install -D prettier
  ```
- [x] Create `.prettierrc` with project style preferences ✓
- [x] Create `.prettierignore` (dist, node_modules, coverage) ✓
- [x] Add `npm run format` and `npm run format:check` scripts ✓

### Pre-commit Hooks
- [x] Install husky and lint-staged ✓
  ```bash
  npm install -D husky lint-staged
  npx husky init
  ```
- [x] Configure `.husky/pre-commit` to run lint-staged ✓
- [x] Add `lint-staged` config to package.json ✓

### Initial Formatting Pass
- [x] Run `npm run format` to apply consistent formatting ✓
- [x] Run `npm run lint:fix` to fix any lint issues ✓
- [ ] Commit as "chore: apply consistent code formatting"

---

## Phase 5: CI/CD Pipeline

### GitHub Actions - CI Workflow
Create `.github/workflows/ci.yml`:
- [x] Trigger on push to main and PRs ✓
- [x] Matrix test on Node.js 18, 20, 22 ✓
- [x] Run linting (`npm run lint`) ✓
- [x] Run type checking (`npm run typecheck`) ✓
- [x] Run tests (`npm test`) ✓
- [x] Run build (`npm run build`) ✓
- [ ] Upload test coverage to Codecov (optional)

### GitHub Actions - Release Workflow
Create `.github/workflows/release.yml`:
- [x] Trigger on GitHub Release published ✓
- [x] Run full CI checks ✓
- [x] Publish to npm with `--provenance` flag ✓
- [x] Use `NPM_TOKEN` secret for authentication ✓

### Dependency Updates
- [x] Create `.github/dependabot.yml` ✓
- [x] Configure weekly update schedule ✓
- [ ] Auto-merge patch updates (requires GitHub settings)
- [x] Group related dependencies ✓

---

## Phase 6: Documentation Polish

### README Enhancements
- [x] Add status badges ✓
  - npm version: `[![npm](https://img.shields.io/npm/v/skillfish)](https://npmjs.com/package/skillfish)`
  - npm downloads: `[![downloads](https://img.shields.io/npm/dm/skillfish)](https://npmjs.com/package/skillfish)`
  - License: `[![license](https://img.shields.io/npm/l/skillfish)](LICENSE)`
  - Node version: `[![node](https://img.shields.io/node/v/skillfish)](package.json)`
  - CI status: `[![CI](https://github.com/knoxgraeme/skillfish/actions/workflows/ci.yml/badge.svg)](https://github.com/knoxgraeme/skillfish/actions)`
- [x] Add "Contributing" section linking to CONTRIBUTING.md ✓
- [x] Add "Security" section linking to SECURITY.md ✓
- [x] Add "Changelog" section linking to CHANGELOG.md ✓

### package.json Enhancements
- [x] Add `funding` field for GitHub Sponsors ✓
- [x] Add `publishConfig.access: "public"` ✓
- [x] Verify `repository`, `bugs`, `homepage` URLs are correct ✓
- [ ] Add `types` field pointing to declaration files (if generating)

---

## Phase 7: Cleanup Before Release

### Remove Tracked Artifacts
- [ ] Remove `docs/solutions/.DS_Store` from git:
  ```bash
  git rm --cached docs/solutions/.DS_Store
  ```
- [ ] Verify `.gitignore` catches all OS-specific files

### Update .gitignore
- [x] Add `*.tgz` (npm pack output) ✓
- [x] Add `coverage/` (if adding test coverage) ✓
- [x] Add `.npm/` cache directory ✓

### Verify package.json files Field
- [ ] Ensure only necessary files are published:
  - `dist/` (compiled code)
  - `README.md`
  - `LICENSE`
  - `CHANGELOG.md`
- [ ] Exclude test files from dist

---

## Phase 8: Release Announcement

### Pre-Release Checklist
- [ ] All CI checks pass
- [ ] CHANGELOG.md updated for this version
- [ ] README badges show correct status
- [ ] Test `npx skillfish --help` works
- [ ] Test `npx skillfish add` flow works

### Release Steps
1. [ ] Create git tag: `git tag v1.1.0`
2. [ ] Push tag: `git push origin v1.1.0`
3. [ ] Create GitHub Release with changelog notes
4. [ ] Verify npm publish succeeded (via CI workflow)
5. [ ] Announce on relevant channels (Twitter/X, Discord, Reddit r/programming)

---

## Ongoing Maintenance Workflow

### For Each Contribution

```
1. Contributor opens Issue or PR
        ↓
2. Triage: Label appropriately (bug, enhancement, good first issue)
        ↓
3. If PR: CI runs automatically
        ↓
4. Review: Request changes or approve
        ↓
5. Merge: Squash and merge to main
        ↓
6. Update CHANGELOG.md (in next release)
```

### Release Process

```
1. Collect merged PRs since last release
        ↓
2. Update CHANGELOG.md with changes
        ↓
3. Bump version in package.json
        ↓
4. Commit: "chore: release v1.x.x"
        ↓
5. Create GitHub Release (triggers npm publish)
        ↓
6. Verify npm package published correctly
```

### Recommended Labels

| Label | Color | Use |
|-------|-------|-----|
| `bug` | `#d73a4a` | Something isn't working |
| `enhancement` | `#a2eeef` | New feature request |
| `good first issue` | `#7057ff` | Good for newcomers |
| `help wanted` | `#008672` | Extra attention needed |
| `documentation` | `#0075ca` | Docs improvements |
| `duplicate` | `#cfd3d7` | Duplicate issue |
| `wontfix` | `#ffffff` | Won't be implemented |
| `new-agent` | `#1d76db` | Request for new agent support |

---

## Security Considerations

### What's Already Good
- Path traversal prevention in `src/utils.ts:12-27`
- Symlink attack protection in `src/lib/installer.ts:78-119`
- User confirmation before installation
- `execFileSync` with array args prevents shell injection

### Monitor For
- Dependency vulnerabilities (Dependabot/Renovate will alert)
- npm account security (enable 2FA)
- GitHub Actions permissions (use minimal permissions)

### Skill Security Warning
Consider adding to README:
> **Security Note:** Skills are markdown files that provide instructions to AI agents. Always review skills before installing. skillfish does not vet third-party skills.

---

## File Checklist Summary

### Files to Create
| File | Priority |
|------|----------|
| `SECURITY.md` | Critical |
| `CODE_OF_CONDUCT.md` | High |
| `CHANGELOG.md` | High |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | High |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | High |
| `.github/ISSUE_TEMPLATE/agent_support.yml` | Medium |
| `.github/ISSUE_TEMPLATE/config.yml` | Medium |
| `.github/PULL_REQUEST_TEMPLATE.md` | High |
| `.github/CODEOWNERS` | Medium |
| `.github/FUNDING.yml` | Low |
| `.github/workflows/ci.yml` | Critical |
| `.github/workflows/release.yml` | High |
| `eslint.config.mjs` | High |
| `.prettierrc` | High |
| `.prettierignore` | High |
| `renovate.json` or `.github/dependabot.yml` | Medium |

### Files to Update
| File | Changes |
|------|---------|
| `README.md` | Add badges, contributing section |
| `CONTRIBUTING.md` | Fix path reference, add DCO, enhance |
| `package.json` | Add funding, scripts, publishConfig |
| `.gitignore` | Add coverage/, *.tgz |

### Files to Remove
| File | Reason |
|------|--------|
| `docs/solutions/.DS_Store` | OS artifact committed by mistake |

---

## Quick Start Commands

```bash
# Install dev dependencies for code quality
npm install -D eslint @eslint/js typescript-eslint eslint-config-prettier prettier husky lint-staged

# Initialize husky
npx husky init

# Remove .DS_Store from git
git rm --cached docs/solutions/.DS_Store

# Create .github directory structure
mkdir -p .github/ISSUE_TEMPLATE .github/workflows
```

---

## References

- [GitHub Community Health Files](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions)
- [Contributor Covenant](https://www.contributor-covenant.org/)
- [Keep a Changelog](https://keepachangelog.com/)
- [npm Publishing Best Practices](https://docs.npmjs.com/cli/v10/using-npm/scripts/)
- [typescript-eslint](https://typescript-eslint.io/)
- [Husky](https://typicode.github.io/husky/)
