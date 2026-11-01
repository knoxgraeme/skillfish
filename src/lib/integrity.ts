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
 * Check whether an installed skill differs from what skillfish installed.
 * Unreadable directories count as modified, so callers err on the side of keeping files.
 *
 * @param skillDir - Installed skill directory
 * @param manifest - The skill's .skillfish.json manifest
 * @returns true if the files on disk no longer match the installed version
 */
export function isSkillModified(skillDir: string, manifest: SkillManifest): boolean {
  try {
    const localSha = computeTreeSha(skillDir);
    if (manifest.contentSha) {
      return localSha !== manifest.contentSha;
    }

    // Legacy manifest: sha is the GitHub tree SHA of the skill directory...
    if (localSha === manifest.sha) {
      return false;
    }
    // ...or, for root-level skills, the blob SHA of SKILL.md alone.
    if (manifest.path === '.') {
      const skillMd = readFileSync(join(skillDir, SKILL_FILENAME));
      return gitObjectHash('blob', skillMd).toString('hex') !== manifest.sha;
    }
    // shortcut: on Windows, executable bits are invisible, so legacy skills with
    // scripts read as modified until the next update (or --force) records contentSha.
    return true;
  } catch {
    return true;
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
