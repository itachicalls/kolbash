/**
 * Background disco bed: tries /public/audio/disco-floor.mp3 first, then streams
 * Kevin MacLeod — Funkorama (CC BY 4.0 — credit on title screen; see https://incompetech.com/music/royalty-free/music.html).
 */

const LOCAL_FIRST = '/audio/disco-floor.mp3';
const FALLBACK_STREAM =
  'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Funkorama.mp3';

export class GameMusic {
  constructor() {
    this.audio = new Audio();
    this.audio.loop = true;
    this.audio.volume = 0.3;
    this.audio.preload = 'auto';
    this._started = false;
    this._userPaused = false;
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

  start() {
    if (this._started) return;
    this._started = true;
    this._userPaused = false;

    const playFallback = () => {
      this.audio.onerror = null;
      this.audio.src = FALLBACK_STREAM;
      this.audio.load();
      this.audio.play().catch(() => {});
      this._emit();
    };

    this.audio.onerror = () => {
      if (this.audio.src.includes('disco-floor')) {
        this.audio.onerror = null;
        playFallback();
      }
    };

    this.audio.src = LOCAL_FIRST;
    this.audio.load();
    this.audio.play().catch(() => {});
    this._emit();
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
