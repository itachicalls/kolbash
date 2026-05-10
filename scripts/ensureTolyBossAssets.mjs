/**
 * Boss FBX must live under public/models/boss/toly/ for the browser to load them.
 * Your rig lives on OneDrive; this script links that folder here (no multi‑GB copy).
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
        '\nSet TOLY_BOSS_SRC or copy FBX into public/models/boss/toly/ (see boss-encounter.js).'
    );
    return;
  }

  fs.mkdirSync(path.dirname(linkPath), { recursive: true });

  if (fs.existsSync(linkPath)) {
    try {
      const st = fs.lstatSync(linkPath);
      if (st.isSymbolicLink() || st.isDirectory()) {
        if (hasMarker()) return;
        fs.rmSync(linkPath, { recursive: true, force: true });
      }
    } catch {
      fs.rmSync(linkPath, { recursive: true, force: true });
    }
  }

  const type = os.platform() === 'win32' ? 'junction' : 'dir';
  try {
    fs.symlinkSync(target, linkPath, type);
  } catch (e) {
    console.warn('[ensure-toly-boss] Could not create symlink/junction:', e?.message || e);
    return;
  }

  if (hasMarker()) {
    console.info('[ensure-toly-boss] Linked boss assets:\n  ' + linkPath + ' -> ' + target);
  } else {
    console.warn('[ensure-toly-boss] Link created but Idle.fbx not found under:\n  ' + linkPath);
  }
}

main();
