---
title: Migrating from degit to giget for GitHub repository downloads
date: 2026-01-23
category: dependency-issues
tags:
  - dependencies
  - github-downloads
  - tarball
  - security
  - giget
  - degit
severity: high
status: resolved
components:
  - src/lib/installer.ts
  - package.json
  - src/__tests__/installer.test.ts
  - src/degit.d.ts
  - CLAUDE.md
---

# Migrating from degit to giget for GitHub Repository Downloads

## Problem Summary

The skillfish CLI originally used **degit** for downloading skill repositories from GitHub. Two critical issues were discovered:

1. **Reliability**: degit failed on large repositories (e.g., `electron/electron`) with "could not find commit hash" errors due to git ref resolution timeouts
2. **Security**: After initial migration to giget 1.x, `npm audit` revealed 2 high-severity vulnerabilities in the transitive `tar` dependency

### Symptoms

- `skillfish add electron/electron/.claude/skills/...` failed with timeout
- `npm audit` showed vulnerabilities:
  - GHSA-8qq5-rm4j-mr97: Arbitrary File Overwrite and Symlink Poisoning (CWE-22)
  - GHSA-r6q2-hw4h-h46w: Race Condition via Unicode Ligature Collisions on macOS APFS (CVSS 8.8)

## Root Cause

1. **degit limitation**: Uses git ref resolution which times out on repositories with many refs
2. **giget 1.x vulnerability**: Shipped with tar@6.2.1 containing known CVEs

## Solution

Replace degit with giget 3.x, which:
- Uses tarball-based downloads (more reliable than git ref resolution)
- Works consistently on repositories of all sizes
- Includes patched tar dependency (0 vulnerabilities)

### Code Changes

#### 1. Update package.json

```diff
- "degit": "^2.8.4",
+ "giget": "^3.1.1",
```

#### 2. Update installer.ts imports and download logic

**Before (degit):**
```typescript
import degit from 'degit';

let degitPath = downloadPath ? `${owner}/${repo}/${downloadPath}` : `${owner}/${repo}`;
if (branch) {
  degitPath = `${degitPath}#${branch}`;
}

const emitter = degit(degitPath, { cache: false, force: true });
await emitter.clone(tmpDir);
```

**After (giget):**
```typescript
import { downloadTemplate } from 'giget';

let source = downloadPath
  ? `github:${owner}/${repo}/${downloadPath}`
  : `github:${owner}/${repo}`;

if (branch) {
  source = `${source}#${branch}`;
}

await downloadTemplate(source, {
  dir: tmpDir,
  forceClean: true,
});
```

**Key differences:**
- Source format: `owner/repo` → `github:owner/repo`
- API: `degit().clone()` → `downloadTemplate(source, options)`
- Options: `{ cache: false, force: true }` → `{ dir, forceClean: true }`

#### 3. Update test mocks

**Before:**
```typescript
vi.mock('degit', () => ({ default: vi.fn() }));
mockDegit.mockReturnValue({
  clone: vi.fn().mockImplementation(async (destDir) => { ... })
});
```

**After:**
```typescript
vi.mock('giget', () => ({ downloadTemplate: vi.fn() }));
mockDownloadTemplate.mockImplementation(async (_source, options) => {
  // Create files in options.dir
  return { dir: options.dir, source: _source, url: '...' };
});
```

#### 4. Delete dead type declaration file

```bash
rm src/degit.d.ts
```

#### 5. Update comments and documentation

- `src/lib/installer.ts:47`: Changed "degit parsing" → "giget parsing"
- `CLAUDE.md:38`: Changed "downloads via degit" → "downloads via giget tarball"

## Verification Steps

```bash
# 1. Install dependencies
npm install

# 2. Check for vulnerabilities
npm audit  # Should show: found 0 vulnerabilities

# 3. Build project
npm run build

# 4. Run tests
npm test  # All 105 tests should pass

# 5. Manual test
npm link
skillfish add anthropics/courses/prompt-evaluations
```

## Prevention Strategies

### Pre-Migration Checklist

- [ ] Run `npm audit` baseline before changes
- [ ] Search for all usages: `grep -r "degit\|oldpackage" src/`
- [ ] Check for type declaration files: `find . -name "*.d.ts" | xargs grep "oldpackage"`
- [ ] Review breaking changes in new package changelog
- [ ] Run full test suite as baseline

### Post-Migration Checklist

- [ ] Run `npm audit` - must show 0 vulnerabilities
- [ ] Search for dead references: `grep -r "oldpackage" .`
- [ ] Delete unused `.d.ts` files
- [ ] Update comments referencing old package
- [ ] Update project documentation (CLAUDE.md, README)
- [ ] Run full test suite
- [ ] Test manually with edge cases (large repos, branches)

### CI/CD Integration

Add to CI pipeline:
```yaml
- name: Security Audit
  run: npm audit --audit-level=high
```

## Lessons Learned

1. **Always run `npm audit` after dependency changes** - caught 2 high-severity vulnerabilities
2. **Search for dead `.d.ts` files when removing dependencies** - found orphaned `src/degit.d.ts`
3. **Grep for old library names in comments** - found stale "degit" reference
4. **Update project documentation** - CLAUDE.md had outdated reference
5. **Major version upgrades may be required for security** - giget 1.x → 3.x
6. **Test with large repositories** - degit failure only manifested on large repos

## Files Changed

| File | Change |
|------|--------|
| `package.json` | degit → giget ^3.1.1 |
| `package-lock.json` | Updated lockfile |
| `src/lib/installer.ts` | New download logic, removed ~100 lines of fallback |
| `src/__tests__/installer.test.ts` | Updated mocks |
| `src/degit.d.ts` | **Deleted** |
| `CLAUDE.md` | Updated documentation |

## Metrics

| Metric | Before | After |
|--------|--------|-------|
| Download library | degit 2.8.4 | giget 3.1.1 |
| Vulnerabilities | 2 high | 0 |
| installer.ts lines | ~330 (with fallback) | ~227 |
| Large repo support | Fails | Works |
| Type declarations | Custom file | Built-in |

## Related Resources

- [giget on npm](https://www.npmjs.com/package/giget)
- [UnJS giget repo](https://github.com/unjs/giget)
- [GHSA-8qq5-rm4j-mr97](https://github.com/advisories/GHSA-8qq5-rm4j-mr97)
- [GHSA-r6q2-hw4h-h46w](https://github.com/advisories/GHSA-r6q2-hw4h-h46w)
