/**
 * Background music: main disco bed + optional boss bed.
 *
 * **Local files only** (no CDN/stream fallbacks) — avoids stalls and unpredictable decode cost.
 * Prefer **WebM/Opus** or **OGG**, then MP3 under `public/audio/`.
 *
 * Example:
 * `ffmpeg -i disco-floor.mp3 -c:a libopus -b:a 64k public/audio/disco-floor.webm`
 * `ffmpeg -i boss-fight.mp3 -c:a libopus -b:a 64k public/audio/boss-fight.webm`
 */

const MAIN_BEDS = ['/audio/disco-floor.webm', '/audio/disco-floor.ogg', '/audio/disco-floor.mp3'];
const BOSS_BEDS = ['/audio/boss-fight.webm', '/audio/boss-fight.ogg', '/audio/boss-fight.mp3'];

export class GameMusic {
  /**
   * @param {{ enabled?: boolean }} opts `enabled: false` — no `<audio>` (nobgm / lowperf).
   */
  constructor(opts = {}) {
    this.enabled = opts.enabled !== false;
    /** @type {HTMLAudioElement | null} */
    this.audio = this.enabled ? new Audio() : null;
    if (this.audio) {
      this.audio.loop = true;
      this.audio.volume = 0.3;
      this.audio.preload = 'none';
      this.audio.addEventListener('play', () => this._emit());
      this.audio.addEventListener('pause', () => this._emit());
    }
    this._started = false;
    this._userPaused = false;
    this._isBossTrack = false;
    this._mainPick = 0;
    this._bossPick = 0;
    this._onStateChange = null;
  }

  isFeatureEnabled() {
    return this.enabled;
  }

  setStateChangeHandler(fn) {
    this._onStateChange = typeof fn === 'function' ? fn : null;
  }

  _emit() {
    try {
      this._onStateChange?.();
    } catch (e) {}
  }

  /**
   * @param {string[]} paths
   * @param {{ v: number }} pick in/out — start index hint, then last success
   */
  async _tryPlayPathList(paths, pick, volume) {
    if (!this.enabled || !this.audio) return false;
    const a = this.audio;

    for (let i = Math.max(0, Math.min(pick.v, paths.length - 1)); i < paths.length; i++) {
      const path = paths[i];
      const ok = await new Promise((resolve) => {
        let settled = false;
        const to = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve(false);
        }, 12000);
        const finish = (v) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(to);
          resolve(v);
        };
        const bad = () => finish(false);

        try {
          a.onerror = bad;
          a.src = path;
          a.volume = volume;
          a.load();
        } catch {
          finish(false);
          return;
        }

        if (a.readyState >= 3) finish(true);
        else {
          a.addEventListener('canplaythrough', () => finish(true), { once: true });
          a.addEventListener('loadeddata', () => finish(true), { once: true });
          a.addEventListener('error', bad, { once: true });
        }
      });

      a.onerror = null;

      if (!ok) continue;

      pick.v = i;
      if (!this._userPaused) {
        try {
          await a.play();
        } catch {
          /* autoplay blocked until gesture */
        }
      }
      this._emit();
      return true;
    }

    console.warn(
      '[KOL BASH] Background music: no playable file — add disco-floor / boss-fight as .webm, .ogg, or .mp3 under public/audio/'
    );
    return false;
  }

  start() {
    if (!this.enabled) return;
    if (this._started) return;
    this._started = true;
    this._userPaused = false;
    this._isBossTrack = false;
    void (async () => {
      const pick = { v: this._mainPick };
      await this._tryPlayPathList(MAIN_BEDS, pick, 0.3);
      this._mainPick = pick.v;
    })();
  }

  pauseBedForCutscene() {
    if (!this._started || !this.audio) return;
    try {
      this.audio.pause();
    } catch (e) {}
  }

  enterBossFight() {
    if (!this._started || !this.enabled || !this.audio) return;
    this._isBossTrack = true;
    void (async () => {
      const pick = { v: this._bossPick };
      await this._tryPlayPathList(BOSS_BEDS, pick, 0.16);
      this._bossPick = pick.v;
    })();
  }

  leaveBossFight() {
    if (!this._started || !this._isBossTrack || !this.audio) return;
    this._isBossTrack = false;
    void (async () => {
      const pick = { v: this._mainPick };
      await this._tryPlayPathList(MAIN_BEDS, pick, 0.3);
      this._mainPick = pick.v;
    })();
  }

  isAudiblyPlaying() {
    return !!(
      this.enabled &&
      this.audio &&
      this._started &&
      !this._userPaused &&
      !this.audio.paused
    );
  }

  toggle() {
    if (!this._started || !this.enabled || !this.audio) return;
    if (this._userPaused || this.audio.paused) {
      this._userPaused = false;
      this.audio.play().catch(() => {});
    } else {
      this._userPaused = true;
      this.audio.pause();
    }
    this._emit();
  }

  stop() {
    if (!this.audio) {
      this._started = false;
      this._userPaused = false;
      this._isBossTrack = false;
      return;
    }
    this.audio.pause();
    try {
      this.audio.removeAttribute('src');
      this.audio.load();
    } catch (e) {}
    this.audio.onerror = null;
    this._started = false;
    this._userPaused = false;
    this._isBossTrack = false;
    this.audio.volume = 0.3;
    this._emit();
  }

  suspendForBackground() {
    try {
      this.audio?.pause();
    } catch (e) {}
  }

  resumeIfRunning() {
    if (!this._started || this._userPaused || !this.enabled || !this.audio) return;
    this.audio.play().catch(() => {});
  }
}
