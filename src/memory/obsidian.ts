/**
 * Obsidian vault compatibility.
 *
 * Creates a minimal `.obsidian/` config so the memories directory
 * opens as a vault in Obsidian without manual setup.
 */

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OBSIDIAN_APP_JSON = JSON.stringify(
  {
    alwaysUpdateLinks: true,
    newFileLocation: 'current',
    attachmentFolderPath: '.attachments',
  },
  null,
  2,
);

/**
 * Ensure the given directory has an `.obsidian/` folder with minimal config.
 * Best-effort — errors are logged to stderr and swallowed.
 *
 * @param memoriesBaseDir The vault root (e.g. `~/.eidetic/memories/`)
 */
export function ensureObsidianVault(memoriesBaseDir: string): void {
  try {
    const obsidianDir = path.join(memoriesBaseDir, '.obsidian');
    if (existsSync(obsidianDir)) return;

    mkdirSync(obsidianDir, { recursive: true });
    writeFileSync(path.join(obsidianDir, 'app.json'), OBSIDIAN_APP_JSON);
  } catch (err) {
    console.error('[eidetic] Failed to create .obsidian vault config:', err);
  }
}
