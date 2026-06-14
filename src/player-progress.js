/**
 * Local player profile: callsign, speed-run leaderboard, KOL wallet vault.
 * Persisted in localStorage — no server required.
 */

import { KOL_WALLET_POOL } from './kol-wallets.js';

const LS_USERNAME = 'kolbash_username_v1';
const LS_LEADERBOARD = 'kolbash_leaderboard_v1';
const LS_VAULT = 'kolbash_wallet_vault_v1';
const LS_CLAIMED = 'kolbash_claimed_wallets_v1';

const MAX_LEADERBOARD = 50;
const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

export function formatRunTime(ms) {
  const safe = Math.max(0, Math.floor(ms));
  const totalSec = Math.floor(safe / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const cs = Math.floor((safe % 1000) / 10);
  return `${min}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function normalizeUsername(raw) {
  const s = String(raw || '').trim();
  if (!USERNAME_RE.test(s)) return null;
  return s;
}

export function getUsername() {
  try {
    const u = localStorage.getItem(LS_USERNAME);
    return u && USERNAME_RE.test(u) ? u : null;
  } catch (e) {
    return null;
  }
}

export function setUsername(raw) {
  const u = normalizeUsername(raw);
  if (!u) return false;
  try {
    localStorage.setItem(LS_USERNAME, u);
    return true;
  } catch (e) {
    return false;
  }
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

export function getLeaderboardEntries(limit = 10) {
  const rows = readJson(LS_LEADERBOARD, []);
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r.timeMs === 'number' && r.username)
    .sort((a, b) => a.timeMs - b.timeMs)
    .slice(0, limit);
}

/**
 * @param {{ username: string; timeMs: number; score: number; characterId: string }} run
 */
export function submitLeaderboardRun(run) {
  const username = normalizeUsername(run?.username) || getUsername();
  if (!username || typeof run?.timeMs !== 'number' || run.timeMs < 1000) return null;

  const entry = {
    username,
    timeMs: Math.floor(run.timeMs),
    score: Math.floor(run.score || 0),
    characterId: String(run.characterId || 'unknown'),
    at: new Date().toISOString()
  };

  const rows = readJson(LS_LEADERBOARD, []);
  const list = Array.isArray(rows) ? rows : [];
  list.push(entry);
  list.sort((a, b) => a.timeMs - b.timeMs);
  writeJson(LS_LEADERBOARD, list.slice(0, MAX_LEADERBOARD));

  const rank = list.findIndex(
    (r) => r.username === entry.username && r.timeMs === entry.timeMs && r.at === entry.at
  );
  return { entry, rank: rank >= 0 ? rank + 1 : list.length };
}

export function getVaultWallets() {
  const rows = readJson(LS_VAULT, []);
  if (!Array.isArray(rows)) return [];
  return rows.filter((w) => w && w.address);
}

export function isWalletInVault(address) {
  const a = String(address || '').trim();
  return getVaultWallets().some((w) => w.address === a);
}

/**
 * @param {{ address: string; label: string; runTimeMs?: number; score?: number }} wallet
 */
export function saveWalletToVault(wallet) {
  const address = String(wallet?.address || '').trim();
  if (!address) return false;
  const vault = getVaultWallets();
  if (vault.some((w) => w.address === address)) return true;
  vault.unshift({
    address,
    label: String(wallet.label || 'KOL operative'),
    savedAt: new Date().toISOString(),
    runTimeMs: wallet.runTimeMs ?? null,
    score: wallet.score ?? null
  });
  return writeJson(LS_VAULT, vault.slice(0, 200));
}

function getClaimedAddresses() {
  const rows = readJson(LS_CLAIMED, []);
  return Array.isArray(rows) ? rows.filter((a) => typeof a === 'string') : [];
}

function markWalletClaimed(address) {
  const claimed = getClaimedAddresses();
  if (!claimed.includes(address)) {
    claimed.push(address);
    writeJson(LS_CLAIMED, claimed);
  }
}

/** Pick a wallet this player has not unlocked yet; marks it claimed for this device. */
export function rollWalletReward() {
  const claimed = new Set(getClaimedAddresses());
  const unclaimed = KOL_WALLET_POOL.filter((w) => !claimed.has(w.address));
  const pool = unclaimed.length ? unclaimed : KOL_WALLET_POOL;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (pick && !claimed.has(pick.address)) markWalletClaimed(pick.address);
  return { ...pick, isFreshUnlock: unclaimed.length > 0 };
}

export async function copyTextToClipboard(text) {
  const s = String(text || '');
  if (!s) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(s);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}
