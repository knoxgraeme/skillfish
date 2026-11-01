/**
 * Local modification detection for installed skills.
 *
 * Hashes an installed skill directory the way git hashes a tree, so the result
 * is directly comparable to the GitHub tree SHA recorded at install time. That
 * makes edits detectable even for skills installed before `contentSha` existed.
 */

import { createHash } from 'crypto';
import { readdirSync, readFileSync, lstatSync } from 'fs';
import { join } from 'path';
import { MANIFEST_FILENAME, type SkillManifest } from './manifest.js';
import { SKILL_FILENAME } from './github.js';

// === Constants ===

/** Files skillfish or the OS write into skill directories that are not skill content */
const IGNORED_FILES = new Set([MANIFEST_FILENAME, '.DS_Store']);

// === Functions ===

/**
 * Compute the git tree SHA of a directory's contents.
 * Skips symlinks (the installer never copies them), ignored files, and empty
 * directories (git does not track them).
 *
 * @param dir - Directory to hash
 * @returns 40-character hex SHA-1, identical to `git write-tree` for the same files
 * @throws If the directory or any file cannot be read
 */
export function computeTreeSha(dir: string): string {
  return treeHash(dir)?.toString('hex') ?? gitObjectHash('tree', Buffer.alloc(0)).toString('hex');
}

/**
 * Whether an installed skill still matches what skillfish installed.
 * - `unchanged`: safe to overwrite
 * - `modified`: files changed since install
 * - `unknown`: files differ from an older manifest's sha, which may not reflect what was installed
 */
export type LocalEditStatus = 'unchanged' | 'modified' | 'unknown';

/**
 * Compare an installed skill with what skillfish installed.
 * Unreadable directories count as modified, so callers err on the side of keeping files.
 *
 * @param skillDir - Installed skill directory
 * @param manifest - The skill's .skillfish.json manifest
 */
export function getLocalEditStatus(skillDir: string, manifest: SkillManifest): LocalEditStatus {
  try {
    const localSha = computeTreeSha(skillDir);
    if (manifest.contentSha) {
      return localSha === manifest.contentSha ? 'unchanged' : 'modified';
    }

    // Older manifests have no contentSha. Their sha is usually the GitHub tree SHA
    // of the skill directory (equal to the local tree hash), or for root-level
    // skills the SKILL.md blob SHA. It can also be a commit SHA, and Windows can't
    // see executable bits, so a mismatch doesn't prove the user edited anything.
    if (localSha === manifest.sha) {
      return 'unchanged';
    }
    if (manifest.path === '.') {
      const skillMd = readFileSync(join(skillDir, SKILL_FILENAME));
      if (gitObjectHash('blob', skillMd).toString('hex') === manifest.sha) {
        return 'unchanged';
      }
    }
    return 'unknown';
  } catch {
    return 'modified';
  }
}

// === Helper Functions ===

function gitObjectHash(type: 'blob' | 'tree', content: Buffer): Buffer {
  return createHash('sha1').update(`${type} ${content.length}\0`).update(content).digest();
}

/** Returns the raw tree hash, or null for a directory with no tracked content. */
function treeHash(dir: string): Buffer | null {
  const entries: { mode: string; name: string; sortKey: string; sha: Buffer }[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      const sha = treeHash(path);
      if (sha) {
        // git orders directories as if their name ended with "/"
        entries.push({ mode: '40000', name: entry.name, sortKey: `${entry.name}/`, sha });
      }
    } else if (entry.isFile() && !IGNORED_FILES.has(entry.name)) {
      const executable = (lstatSync(path).mode & 0o100) !== 0;
      entries.push({
        mode: executable ? '100755' : '100644',
        name: entry.name,
        sortKey: entry.name,
        sha: gitObjectHash('blob', readFileSync(path)),
      });
    }
  }

  if (entries.length === 0) {
    return null;
  }

  entries.sort((a, b) => Buffer.compare(Buffer.from(a.sortKey), Buffer.from(b.sortKey)));
  const body = Buffer.concat(entries.flatMap((e) => [Buffer.from(`${e.mode} ${e.name}\0`), e.sha]));
  return gitObjectHash('tree', body);
}
