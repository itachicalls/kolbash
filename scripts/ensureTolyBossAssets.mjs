/**
 * Ensures `public/models/boss/toly/idle/Idle.fbx` exists for Vite / static hosting.
 *
 * - If that file is already present (git clone, or previous copy), no-op.
 * - Otherwise, if `TOLY_BOSS_SRC` (or the default Windows OneDrive path) exists:
 *   - Default: create a directory junction/symlink (no duplicate disk use).
 *   - `TOLY_BOSS_MODE=copy` or `--copy`: recursive copy into `public/` (for authors
 *     shipping assets to GitHub — run once, then commit `public/models/boss/toly/`).
 *
 * Override source: TOLY_BOSS_SRC="C:\\path\\to\\Toly" npm run ensure-toly-boss
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const linkPath = path.join(repoRoot, 'public', 'models', 'boss', 'toly');
const marker = path.join(linkPath, 'idle', 'Idle.fbx');

const defaultWinSrc = path.join(
  'C:',
  'Users',
  'smyde',
  'OneDrive',
  'Desktop',
  'anim',
  'kolbash',
  'character options',
  'Toly'
);

const target = process.env.TOLY_BOSS_SRC
  ? path.resolve(process.env.TOLY_BOSS_SRC)
  : defaultWinSrc;

const wantCopy =
  process.env.TOLY_BOSS_MODE === 'copy' || process.argv.includes('--copy');

function hasMarker() {
  try {
    return fs.existsSync(marker);
  } catch {
    return false;
  }
}

function main() {
  if (hasMarker()) return;

  if (!fs.existsSync(target)) {
    console.warn(
      '[ensure-toly-boss] Toly source folder not found:\n  ' +
        target +
        '\nCommitted assets should ship in public/models/boss/toly/, or set TOLY_BOSS_SRC.'
    );
    return;
  }

  fs.mkdirSync(path.dirname(linkPath), { recursive: true });

  if (fs.existsSync(linkPath)) {
    fs.rmSync(linkPath, { recursive: true, force: true });
  }

  if (wantCopy) {
    try {
      fs.cpSync(target, linkPath, { recursive: true });
    } catch (e) {
      console.warn('[ensure-toly-boss] Copy failed:', e?.message || e);
      return;
    }
  } else {
    const type = os.platform() === 'win32' ? 'junction' : 'dir';
    try {
      fs.symlinkSync(target, linkPath, type);
    } catch (e) {
      console.warn('[ensure-toly-boss] Symlink/junction failed, trying recursive copy:', e?.message || e);
      try {
        fs.cpSync(target, linkPath, { recursive: true });
      } catch (e2) {
        console.warn('[ensure-toly-boss] Copy fallback failed:', e2?.message || e2);
        return;
      }
    }
  }

  if (hasMarker()) {
    console.info(
      wantCopy
        ? '[ensure-toly-boss] Copied boss assets into:\n  ' + linkPath
        : '[ensure-toly-boss] Linked boss assets:\n  ' + linkPath + ' -> ' + target
    );
  } else {
    console.warn('[ensure-toly-boss] Idle.fbx still missing under:\n  ' + linkPath);
  }
}

main();
