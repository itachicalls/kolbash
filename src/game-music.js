/**
 * Background music: main disco bed + optional urgent boss bed.
 *
 * Main: `/public/audio/disco-floor.mp3` then Kevin MacLeod — Funkorama (CC BY 4.0).
 * Boss: `/public/audio/boss-fight.mp3` then Kevin MacLeod — Volatile Reaction (CC BY 4.0).
 * Credits: https://incompetech.com/music/royalty-free/music.html
 */

const LOCAL_FIRST = '/audio/disco-floor.mp3';
const FALLBACK_STREAM =
  'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Funkorama.mp3';

const BOSS_LOCAL_FIRST = '/audio/boss-fight.mp3';
const BOSS_FALLBACK_STREAM =
  'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Volatile%20Reaction.mp3';

export class GameMusic {
  constructor() {
    this.audio = new Audio();
    this.audio.loop = true;
    this.audio.volume = 0.3;
    this.audio.preload = 'auto';
    this._started = false;
    this._userPaused = false;
    this._isBossTrack = false;
    this._onStateChange = null;
    this.audio.addEventListener('play', () => this._emit());
    this.audio.addEventListener('pause', () => this._emit());
  }

  setStateChangeHandler(fn) {
    this._onStateChange = typeof fn === 'function' ? fn : null;
  }

  _emit() {
    try {
      this._onStateChange?.();
    } catch (e) {}
  }

  _applyMainLevelBed() {
    const playFallback = () => {
      this.audio.onerror = null;
      this.audio.src = FALLBACK_STREAM;
      this.audio.load();
      if (!this._userPaused) this.audio.play().catch(() => {});
      this._emit();
    };

    this.audio.onerror = () => {
      if (this.audio.src && this.audio.src.includes('disco-floor')) {
        this.audio.onerror = null;
        playFallback();
      }
    };

    this.audio.src = LOCAL_FIRST;
    this.audio.load();
    if (!this._userPaused) this.audio.play().catch(() => {});
    this._emit();
  }

  start() {
    if (this._started) return;
    this._started = true;
    this._userPaused = false;
    this._isBossTrack = false;
    this._applyMainLevelBed();
  }

  /** Pause background bed so another element (e.g. cutscene video) can use audio. */
  pauseBedForCutscene() {
    if (!this._started) return;
    try {
      this.audio.pause();
    } catch (e) {}
  }

  /** Swap to boss fight bed while a run is active (call after `start()`). */
  enterBossFight() {
    if (!this._started) return;
    this._isBossTrack = true;
    /** Boss bed is mastered hot — keep clearly under the main 0.3 bed so the swap is not a jump scare. */
    this.audio.volume = 0.16;

    const playFallback = () => {
      this.audio.onerror = null;
      this.audio.src = BOSS_FALLBACK_STREAM;
      this.audio.load();
      this.audio.volume = 0.16;
      if (!this._userPaused) this.audio.play().catch(() => {});
      this._emit();
    };

    this.audio.onerror = () => {
      if (this.audio.src && this.audio.src.includes('boss-fight')) {
        this.audio.onerror = null;
        playFallback();
      }
    };

    this.audio.src = BOSS_LOCAL_FIRST;
    this.audio.load();
    if (!this._userPaused) this.audio.play().catch(() => {});
    this._emit();
  }

  /** Restore main level music (e.g. boss cleared or aborted). */
  leaveBossFight() {
    if (!this._started || !this._isBossTrack) return;
    this._isBossTrack = false;
    this.audio.volume = 0.3;
    this._applyMainLevelBed();
  }

  /** True if the bed is running and not user-paused. */
  isAudiblyPlaying() {
    return this._started && !this._userPaused && !this.audio.paused;
  }

  toggle() {
    if (!this._started) return;
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
    this.audio.pause();
    this.audio.currentTime = 0;
    this._started = false;
    this._userPaused = false;
    this._isBossTrack = false;
    this.audio.onerror = null;
    this.audio.volume = 0.3;
    this._emit();
  }

  /** Pause when tab hidden (saves CPU / audio on mobile). */
  suspendForBackground() {
    try {
      this.audio.pause();
    } catch (e) {}
  }

  /** Resume after tab visible if the bed was running and user did not pause. */
  resumeIfRunning() {
    if (!this._started || this._userPaused) return;
    this.audio.play().catch(() => {});
  }
}
