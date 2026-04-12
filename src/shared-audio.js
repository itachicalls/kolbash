/**
 * Single Web Audio context for all SFX. Safari/iOS limits multiple AudioContexts
 * and extra instances increase crash risk during gameplay.
 */

let _ctx = undefined;

export function getSharedAudioContext() {
  if (_ctx !== undefined) return _ctx;
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    _ctx = C ? new C() : null;
  } catch {
    _ctx = null;
  }
  return _ctx;
}

/** Call after a user gesture so iOS allows playback (start / tap-to-play). */
export function resumeSharedAudioContext() {
  const c = getSharedAudioContext();
  if (!c || c.state !== 'suspended') return;
  try {
    const p = c.resume();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) {}
}
