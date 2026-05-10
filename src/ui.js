/**
 * UI System - HUD, wave announcements, level effects, store, dare screen
 */

import { TOTAL_WAVES, REGULAR_WAVES, BOSS_TRIGGER_AFTER_WAVE } from './waves.js';
import { SPECIAL_CHARGE_KILLS } from './special-attack.js';
import { resumeSharedAudioContext } from './shared-audio.js';
import { getFinaleBossIntroClip, DEFAULT_CHARACTER_ID } from './characters.js';

export const STORE_ITEMS = [
  { id: 'gatling', name: 'GATLING GUN', cost: 200, type: 'weapon', desc: 'Rapid bullet storm' },
  { id: 'laser', name: 'LASER CANNON', cost: 300, type: 'weapon', desc: 'High-damage beam' },
  { id: 'rocket', name: 'ROCKET LAUNCHER', cost: 400, type: 'weapon', desc: 'AoE explosive rounds' },
  { id: 'maxHp', name: 'HP BOOST +50', cost: 100, type: 'upgrade', desc: '+50 Max Health', repeatable: true },
  { id: 'allyDur', name: 'ALLY UPGRADE', cost: 150, type: 'upgrade', desc: '+5s Ship Duration', repeatable: true }
];

/** Single callback per tap — avoids iOS/WebKit firing touchend and a delayed click on the same gesture. */
function bindPrimaryPointerUpOnce(el, onAction) {
  if (!el || typeof onAction !== 'function') return;
  const handler = (e) => {
    if (e.button > 0) return;
    try {
      e.preventDefault();
    } catch (err) {}
    onAction(e);
  };
  el.addEventListener('pointerup', handler, { once: true, capture: true });
}

const DARE_MESSAGES = [
  "YOU SURVIVED. BARELY. DARE TO GO AGAIN?",
  "THE DISCO ISN'T DONE WITH YOU YET",
  "SCARED? YOU SHOULD BE.",
  "STILL BREATHING? LET'S FIX THAT",
  "THE BEAT DROPS HARDER FROM HERE",
  "YOUR LUCK WON'T LAST FOREVER",
  "THE DANCE FLOOR CRAVES MORE",
  "THINK YOU'RE TOUGH? PROVE IT.",
  "EVERY WAVE GETS DEADLIER. READY?",
  "NO ONE ESCAPES THE DISCO. NO ONE.",
  "THE BASS IS ABOUT TO BREAK YOU",
  "CUTE. NOW TRY A REAL WAVE.",
  "THAT WAS THE WARM-UP, CHAMP."
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {HTMLVideoElement} video @param {{ mp4: string; mov: string }} clip */
function applyFinaleIntroSources(video, clip) {
  if (!video || !clip?.mp4 || !clip?.mov) return;
  while (video.firstChild) {
    video.removeChild(video.firstChild);
  }
  const mp4 = document.createElement('source');
  mp4.src = clip.mp4;
  mp4.type = 'video/mp4';
  video.appendChild(mp4);
  const mov = document.createElement('source');
  mov.src = clip.mov;
  mov.type = 'video/quicktime';
  video.appendChild(mov);
}

export class UIManager {
  constructor() {
    this.elements = {
      loadingScreen: document.getElementById('loading-screen'),
      loadingProgress: document.getElementById('loading-progress'),
      startScreen: document.getElementById('start-screen'),
      hud: document.getElementById('hud'),
      hudTouchLayer: document.getElementById('hud-touch-layer'),
      gameOver: document.getElementById('game-over'),
      gameRetryBtn: document.getElementById('game-retry-btn'),
      gameMainMenuBtn: document.getElementById('game-main-menu-btn'),
      gameChangeFighterBtn: document.getElementById('game-change-fighter-btn'),

      pauseMenu: document.getElementById('pause-menu'),
      pauseResumeBtn: document.getElementById('pause-resume-btn'),
      pauseQuitBtn: document.getElementById('pause-quit-btn'),

      healthBar: document.getElementById('health-bar'),
      healthText: document.getElementById('health-text'),
      staminaBar: document.getElementById('stamina-bar'),
      staminaBarBg: document.getElementById('stamina-bar-bg'),
      coinCount: document.getElementById('coin-count'),
      scoreValue: document.getElementById('score-value'),
      waveNumber: document.getElementById('wave-number'),
      bossEncounterHud: document.getElementById('boss-encounter-hud'),
      bossEncounterTitle: document.getElementById('boss-encounter-title'),
      bossEncounterSub: document.getElementById('boss-encounter-sub'),
      bossEncounterHpFill: document.getElementById('boss-encounter-hp-fill'),
      killsValue: document.getElementById('kills-value'),
      damageValue: document.getElementById('damage-value'),
      levelName: document.getElementById('level-name'),

      rapidFireIndicator: document.getElementById('rapid-fire-indicator'),
      slowMotionIndicator: document.getElementById('slow-motion-indicator'),
      alienShipIndicator: document.getElementById('alien-ship-indicator'),

      waveAnnouncement: document.getElementById('wave-announcement'),
      announceWaveNum: document.getElementById('announce-wave-num'),
      waveTaunt: document.getElementById('wave-taunt'),
      announceLevel: document.getElementById('announce-level'),
      levelEffect: document.getElementById('level-effect'),

      finalWave: document.getElementById('final-wave'),
      finalScore: document.getElementById('final-score'),
      finalCoins: document.getElementById('final-coins'),
      finalKills: document.getElementById('final-kills'),
      finalDamage: document.getElementById('final-damage'),

      dareScreen: document.getElementById('dare-screen'),
      dareText: document.getElementById('dare-text'),
      dareWaveCleared: document.getElementById('dare-wave-cleared'),
      dareContinue: document.getElementById('dare-continue'),
      dareStore: document.getElementById('dare-store'),
      dareBailBtn: document.getElementById('dare-bail-btn'),

      storeScreen: document.getElementById('store-screen'),
      storeCoins: document.getElementById('store-coins-value'),
      storeGrid: document.getElementById('store-grid'),
      storeClose: document.getElementById('store-close'),

      weaponName: document.getElementById('weapon-name'),

      victoryScreen: document.getElementById('victory-screen'),
      vicScore: document.getElementById('vic-score'),
      vicKills: document.getElementById('vic-kills'),
      vicDamage: document.getElementById('vic-damage'),
      vicCoins: document.getElementById('vic-coins'),
      victoryDone: document.getElementById('victory-done'),

      specialChargeFill: document.getElementById('special-charge-fill'),
      specialVortexOrb: document.getElementById('special-vortex-orb'),
      musicToggleBtn: document.getElementById('music-toggle-btn'),

      waveCountdownOverlay: document.getElementById('wave-countdown-overlay'),
      waveCountdownDigit: document.getElementById('wave-countdown-digit'),

      bossCutsceneOverlay: document.getElementById('boss-cutscene-overlay'),
      bossCutsceneVideo: document.getElementById('boss-cutscene-video')
    };

    this.onSpecialActivate = null;
    this._gameMusic = null;

    this.waveAnnouncementTimeout = null;
    this.levelEffectTimeout = null;
    this.crosshairEl = document.getElementById('crosshair');
    /** Avoid stacking many `setTimeout` callbacks when coin text updates in bursts (mobile). */
    this._coinBounceScheduled = false;
  }

  updateCrosshair(weapon) {
    if (!this.crosshairEl || !weapon) return;
    const now = performance.now();
    if (now < weapon.fireFlashUntil) {
      this.crosshairEl.classList.add('firing');
    } else {
      this.crosshairEl.classList.remove('firing');
    }
  }

  showLoading() {
    this.setVisibility('loading');
  }

  showVictory(stats, onDone) {
    if (this.elements.victoryScreen) {
      if (this.elements.hudTouchLayer) this.elements.hudTouchLayer.style.display = 'none';
      if (this.elements.hud) this.elements.hud.style.display = 'none';
      if (this.elements.dareScreen) this.elements.dareScreen.style.display = 'none';
      if (this.elements.storeScreen) this.elements.storeScreen.style.display = 'none';
      if (this.elements.gameOver) this.elements.gameOver.style.display = 'none';
      if (this.elements.startScreen) this.elements.startScreen.style.display = 'none';
      if (this.elements.loadingScreen) this.elements.loadingScreen.style.display = 'none';

      if (this.elements.vicScore) this.elements.vicScore.textContent = (stats.score ?? 0).toLocaleString();
      if (this.elements.vicKills) this.elements.vicKills.textContent = (stats.kills ?? 0).toLocaleString();
      if (this.elements.vicDamage) this.elements.vicDamage.textContent = (stats.damageDealt ?? 0).toLocaleString();
      if (this.elements.vicCoins) this.elements.vicCoins.textContent = (stats.coins ?? 0).toLocaleString();

      this.elements.victoryScreen.style.display = 'flex';

      const btn = this.elements.victoryDone;
      if (btn) {
        const clone = btn.cloneNode(true);
        btn.replaceWith(clone);
        this.elements.victoryDone = document.getElementById('victory-done');
        bindPrimaryPointerUpOnce(this.elements.victoryDone, () => onDone?.());
      }
    }
  }

  updateLoadingProgress(message) {
    if (this.elements.loadingProgress) this.elements.loadingProgress.textContent = message;
  }

  showStartScreen() { this.setVisibility('start'); }
  showGame() { this.setVisibility('game'); }

  /**
   * @param {object} stats
   * @param {(() => void) | { onRetry?: () => void; onMainMenu?: () => void; onChangeCharacter?: () => void }} callbacks
   */
  showGameOver(stats, callbacks) {
    this.setVisibility('gameover');
    if (this.elements.finalWave) this.elements.finalWave.textContent = stats.wave;
    if (this.elements.finalScore) this.elements.finalScore.textContent = stats.score.toLocaleString();
    if (this.elements.finalKills) this.elements.finalKills.textContent = (stats.kills ?? 0).toLocaleString();
    if (this.elements.finalDamage) this.elements.finalDamage.textContent = (stats.damageDealt ?? 0).toLocaleString();
    if (this.elements.finalCoins) this.elements.finalCoins.textContent = stats.coins.toLocaleString();

    let onRetry;
    let onMainMenu;
    let onChangeCharacter;
    if (typeof callbacks === 'function') {
      onRetry = callbacks;
    } else if (callbacks && typeof callbacks === 'object') {
      onRetry = callbacks.onRetry;
      onMainMenu = callbacks.onMainMenu;
      onChangeCharacter = callbacks.onChangeCharacter;
    }

    const wire = (id, handler) => {
      const el = document.getElementById(id);
      if (!el || typeof handler !== 'function') return el;
      const clone = el.cloneNode(true);
      el.replaceWith(clone);
      bindPrimaryPointerUpOnce(clone, () => handler());
      return clone;
    };

    this.elements.gameRetryBtn = wire('game-retry-btn', onRetry);
    this.elements.gameMainMenuBtn = wire('game-main-menu-btn', onMainMenu);
    this.elements.gameChangeFighterBtn = wire('game-change-fighter-btn', onChangeCharacter);
  }

  showPauseMenu(onResume, onQuitToTitle) {
    const root = this.elements.pauseMenu;
    if (!root) return;
    root.style.display = 'flex';
    root.setAttribute('aria-hidden', 'false');

    const resumeEl = document.getElementById('pause-resume-btn');
    if (resumeEl && typeof onResume === 'function') {
      const clone = resumeEl.cloneNode(true);
      resumeEl.replaceWith(clone);
      this.elements.pauseResumeBtn = document.getElementById('pause-resume-btn');
      bindPrimaryPointerUpOnce(this.elements.pauseResumeBtn, () => onResume());
    }

    const quitEl = document.getElementById('pause-quit-btn');
    if (quitEl && typeof onQuitToTitle === 'function') {
      const clone = quitEl.cloneNode(true);
      quitEl.replaceWith(clone);
      this.elements.pauseQuitBtn = document.getElementById('pause-quit-btn');
      bindPrimaryPointerUpOnce(this.elements.pauseQuitBtn, () => onQuitToTitle());
    }
  }

  hidePauseMenu() {
    const root = this.elements.pauseMenu;
    if (!root) return;
    root.style.display = 'none';
    root.setAttribute('aria-hidden', 'true');
  }

  updateStats(kills, damageDealt) {
    const k = (kills ?? 0).toLocaleString();
    const d = (damageDealt ?? 0).toLocaleString();
    if (this.elements.killsValue && this.elements.killsValue.textContent !== k) this.elements.killsValue.textContent = k;
    if (this.elements.damageValue && this.elements.damageValue.textContent !== d) this.elements.damageValue.textContent = d;
  }

  setVisibility(screen) {
    const screens = {
      loading: this.elements.loadingScreen,
      start: this.elements.startScreen,
      game: this.elements.hud,
      gameover: this.elements.gameOver
    };
    Object.entries(screens).forEach(([key, el]) => {
      if (el) el.style.display = (key === screen) ? (key === 'game' ? 'block' : 'flex') : 'none';
    });
    if (this.elements.dareScreen) this.elements.dareScreen.style.display = 'none';
    if (this.elements.storeScreen) this.elements.storeScreen.style.display = 'none';
    if (this.elements.victoryScreen) this.elements.victoryScreen.style.display = 'none';

    if (this.elements.hudTouchLayer) {
      this.elements.hudTouchLayer.style.display = screen === 'game' ? 'block' : 'none';
    }

    if (screen !== 'game') {
      this.hideWaveCountdown();
      this.hidePauseMenu();
      if (this.elements.specialVortexOrb) {
        this.elements.specialVortexOrb.style.display = 'none';
        this.elements.specialVortexOrb.classList.remove('special-vortex-ready');
      }
      if (this.elements.musicToggleBtn) this.elements.musicToggleBtn.style.display = 'none';
    } else {
      this.hidePauseMenu();
      if (this.elements.musicToggleBtn) {
        this.elements.musicToggleBtn.style.display = 'flex';
      }
    }

    const startBgVideo = document.getElementById('start-bg-video');
    if (startBgVideo) {
      if (screen === 'start') {
        void startBgVideo.play?.().catch(() => {});
      } else {
        startBgVideo.pause?.();
      }
    }
  }

  showWaveCountdown() {
    const o = this.elements.waveCountdownOverlay;
    if (!o) return;
    o.style.display = 'flex';
    o.setAttribute('aria-hidden', 'false');
  }

  hideWaveCountdown() {
    const o = this.elements.waveCountdownOverlay;
    if (o) {
      o.style.display = 'none';
      o.setAttribute('aria-hidden', 'true');
    }
    const d = this.elements.waveCountdownDigit;
    if (d) {
      d.classList.remove('wave-countdown-go', 'wave-countdown-flash');
    }
  }

  setWaveCountdownDigit(text, isGo) {
    const el = this.elements.waveCountdownDigit;
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('wave-countdown-go', !!isGo);
    el.classList.remove('wave-countdown-flash');
    void el.offsetWidth;
    el.classList.add('wave-countdown-flash');
  }

  /**
   * Finale cutscene: video (no intro title card) → bridge → fade → 3-2-1 in main.js.
   * @param {Promise<void>} bossLoadPromise from BossEncounter.begin()
   * @param {{ mp4: string; mov: string }} [introClip] per-fighter paths (`getFinaleBossIntroClip`)
   */
  async runBossCutsceneWithBossLoad(bossLoadPromise, introClip) {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      await bossLoadPromise;
      return;
    }

    const overlay = this.elements.bossCutsceneOverlay;
    const video = this.elements.bossCutsceneVideo;
    const hint = overlay?.querySelector?.('.boss-cutscene-hint') || null;
    if (!overlay || !video) {
      await bossLoadPromise;
      return;
    }

    const clip = introClip || getFinaleBossIntroClip(DEFAULT_CHARACTER_ID);
    applyFinaleIntroSources(video, clip);

    const setHint = (t) => {
      if (hint) hint.textContent = t;
    };

    const fadeOutOverlay = async () => {
      const vidWrap = overlay.querySelector('.boss-cutscene-vid-wrap');
      if (hint) {
        hint.style.opacity = '0';
        hint.style.transition = 'opacity 0.28s cubic-bezier(0.4, 0, 0.2, 1)';
      }
      if (vidWrap) vidWrap.classList.add('boss-cutscene-vid-wrap--exit');
      await sleep(320);
      overlay.classList.add('boss-cutscene-overlay--exit');
      await sleep(620);
    };

    resumeSharedAudioContext();

    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.remove('boss-cutscene-overlay--exit', 'is-video-phase', 'is-bridge-phase');
    const prerollEl = overlay.querySelector('.boss-cutscene-preroll');
    if (prerollEl) {
      prerollEl.style.visibility = '';
      prerollEl.style.opacity = '';
      prerollEl.style.transition = '';
      prerollEl.style.display = '';
    }
    if (hint) {
      hint.style.opacity = '';
      hint.style.transition = '';
    }
    const vidWrapEl = overlay.querySelector('.boss-cutscene-vid-wrap');
    if (vidWrapEl) vidWrapEl.classList.remove('boss-cutscene-vid-wrap--exit');

    video.pause();
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.volume = 1;
    video.currentTime = 0;
    video.muted = true;

    let finishVideo;
    let skipRequested = false;
    const videoDone = new Promise((resolve) => {
      finishVideo = resolve;
    });

    const onEnded = () => finishVideo();
    video.addEventListener('ended', onEnded, { once: true });

    video.addEventListener(
      'error',
      () => {
        setHint('CLIP ERROR — ESC / CLICK TO CONTINUE');
        console.warn('[KOL BASH] Cutscene video error', video.error);
      },
      { once: true }
    );

    const maybeFinish = () => finishVideo();

    const onPointerUp = (e) => {
      try {
        e.preventDefault();
      } catch (err) {}
      skipRequested = true;
      maybeFinish();
    };
    overlay.addEventListener('pointerup', onPointerUp);

    const escSkip = (e) => {
      if (e.key === 'Escape' || e.key === ' ') {
        try {
          e.preventDefault();
        } catch (err) {}
        skipRequested = true;
        maybeFinish();
      }
    };
    window.addEventListener('keydown', escSkip, true);

    const waitCanPlay = () =>
      new Promise((resolve, reject) => {
        if (video.readyState >= 3) {
          resolve();
          return;
        }
        const to = window.setTimeout(() => reject(new Error('cutscene_timeout')), 16000);
        const done = () => {
          window.clearTimeout(to);
          resolve();
        };
        video.addEventListener('canplay', done, { once: true });
        video.addEventListener(
          'error',
          () => {
            window.clearTimeout(to);
            reject(new Error('cutscene_error'));
          },
          { once: true }
        );
      });

    const tryUnmutedPlayback = async () => {
      resumeSharedAudioContext();
      video.volume = 1;
      video.muted = false;
      try {
        await video.play();
        return;
      } catch {
        /* fall through */
      }
      video.muted = true;
      try {
        await video.play();
      } catch {
        return;
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      video.muted = false;
      try {
        await video.play();
      } catch {
        video.muted = true;
        await video.play().catch(() => {});
      }
    };

    try {
      video.load();
      overlay.classList.add('is-video-phase');
      if (prerollEl) prerollEl.style.display = 'none';
      setHint('ESC OR CLICK TO SKIP');

      let loadFailed = false;
      try {
        await waitCanPlay();
      } catch {
        loadFailed = true;
        setHint('CLIP FAILED TO LOAD — ESC OR CLICK');
      }

      try {
        video.pause();
        video.currentTime = 0;
      } catch (e) {}

      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      try {
        video.currentTime = 0;
      } catch (e) {}

      if (!skipRequested && !loadFailed) {
        await tryUnmutedPlayback();
      }
    } catch (e) {
      console.warn('[KOL BASH] Cutscene play', e);
    }

    try {
      await videoDone;
      overlay.classList.add('is-bridge-phase');
      const minBridgeMs = skipRequested ? 220 : 480;
      await Promise.all([bossLoadPromise, sleep(minBridgeMs)]);
    } finally {
      video.removeEventListener('ended', onEnded);
      overlay.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', escSkip, true);
      try {
        video.pause();
      } catch (e) {}
      video.muted = true;

      await fadeOutOverlay();

      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.classList.remove('boss-cutscene-overlay--exit', 'is-video-phase', 'is-bridge-phase');
      const vw = overlay.querySelector('.boss-cutscene-vid-wrap');
      if (vw) vw.classList.remove('boss-cutscene-vid-wrap--exit');
      if (hint) {
        hint.style.opacity = '';
        hint.style.transition = '';
      }
    }

  }

  updateHealth(current, max) {
    const percent = Math.max(0, Math.min(100, (current / max) * 100));
    if (this.elements.healthBar) {
      this.elements.healthBar.style.width = `${percent}%`;
      let color;
      if (percent > 60) color = 'linear-gradient(90deg, #00ff44, #00ff88)';
      else if (percent > 30) color = 'linear-gradient(90deg, #ffaa00, #ffdd00)';
      else color = 'linear-gradient(90deg, #ff0044, #ff3366)';
      this.elements.healthBar.style.background = color;
    }
    if (this.elements.healthText) this.elements.healthText.textContent = `${Math.ceil(current)} / ${max}`;
  }

  updateStamina(current, max, boosting) {
    const percent = Math.max(0, Math.min(100, (current / max) * 100));
    if (this.elements.staminaBar) {
      this.elements.staminaBar.style.width = `${percent}%`;
      this.elements.staminaBar.style.background = boosting
        ? 'linear-gradient(90deg, #00ffff, #ff66ff)'
        : 'linear-gradient(90deg, #0088cc, #8866cc)';
    }
    if (this.elements.staminaBarBg) {
      this.elements.staminaBarBg.classList.toggle('stamina-boosting', !!boosting);
    }
  }

  updateCoins(count) {
    const el = this.elements.coinCount;
    if (!el) return;
    el.textContent = count.toLocaleString();
    if (this._coinBounceScheduled) return;
    this._coinBounceScheduled = true;
    el.style.transform = 'scale(1.3)';
    el.style.color = '#ffffff';
    setTimeout(() => {
      this._coinBounceScheduled = false;
      if (el) {
        el.style.transform = 'scale(1)';
        el.style.color = '#ffd700';
      }
    }, 150);
  }

  updateScore(score) {
    if (this.elements.scoreValue) this.elements.scoreValue.textContent = score.toLocaleString();
  }

  updateWave(wave) {
    if (this.elements.waveNumber) {
      this.elements.waveNumber.textContent = `${wave} / ${TOTAL_WAVES}`;
    }
  }

  /** @param {{ phase: string; hpPct: number; windowSec: number }} payload */
  setBossEncounterHud(payload) {
    const wrap = this.elements.bossEncounterHud;
    if (!wrap) return;
    wrap.style.display = 'flex';
    const title = this.elements.bossEncounterTitle;
    const sub = this.elements.bossEncounterSub;
    const fill = this.elements.bossEncounterHpFill;
    if (title) {
      if (payload.phase === 'intro') title.textContent = 'FINALE // SOMETHING OUTSIDE';
      else if (payload.phase === 'adds') title.textContent = 'CLEAR THE DANCE FLOOR';
      else if (payload.phase === 'vulnerable') title.textContent = 'NOW — HURT THE BOSS';
      else if (payload.phase === 'dead') title.textContent = 'DISCO TITAN DOWN';
      else title.textContent = 'BOSS';
    }
    if (sub) {
      if (payload.phase === 'vulnerable' && payload.windowSec > 0) {
        sub.textContent = `Damage window · ${payload.windowSec.toFixed(1)}s`;
      } else if (payload.phase === 'adds') {
        sub.textContent = 'Boss is shielded until every raver falls';
      } else if (payload.phase === 'intro') {
        sub.textContent = 'He has been watching through the wall';
      } else {
        sub.textContent = '';
      }
    }
    if (fill) {
      const w = Math.max(0, Math.min(1, payload.hpPct ?? 1));
      fill.style.transform = `scaleX(${w})`;
    }
    if (this.elements.waveNumber) {
      this.elements.waveNumber.textContent =
        payload.phase === 'dead' ? `★ WIN ★` : `FINALE / ${BOSS_TRIGGER_AFTER_WAVE}`;
    }
  }

  clearBossEncounterHud() {
    const wrap = this.elements.bossEncounterHud;
    if (wrap) wrap.style.display = 'none';
    if (this.elements.bossEncounterHpFill) this.elements.bossEncounterHpFill.style.transform = 'scaleX(1)';
  }

  updateLevelName(name) {
    if (this.elements.levelName) this.elements.levelName.textContent = name;
  }

  showLevelEffect(label) {
    if (this.levelEffectTimeout) clearTimeout(this.levelEffectTimeout);
    if (this.elements.levelEffect) {
      this.elements.levelEffect.textContent = label;
      this.elements.levelEffect.classList.add('show');
      this.levelEffectTimeout = setTimeout(() => {
        this.elements.levelEffect.classList.remove('show');
      }, 4000);
    }
  }

  showWaveAnnouncement(waveNumber, taunt, levelName, isLevelChange) {
    if (this.waveAnnouncementTimeout) clearTimeout(this.waveAnnouncementTimeout);
    if (this.elements.announceWaveNum) this.elements.announceWaveNum.textContent = waveNumber;
    if (this.elements.waveTaunt) this.elements.waveTaunt.textContent = taunt || '';
    if (this.elements.announceLevel) this.elements.announceLevel.textContent = isLevelChange ? `// ${levelName} //` : '';
    const ann = this.elements.waveAnnouncement;
    if (!ann) return;
    const duration = isLevelChange ? 3500 : 2500;
    ann.classList.remove('show');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ann.classList.add('show');
        this.waveAnnouncementTimeout = setTimeout(() => {
          ann.classList.remove('show');
        }, duration);
      });
    });
  }

  updatePowerup(type, remainingTime) {
    let indicator;
    switch (type) {
      case 'rapidFire': indicator = this.elements.rapidFireIndicator; break;
      case 'slowMotion': indicator = this.elements.slowMotionIndicator; break;
      case 'alienShip': indicator = this.elements.alienShipIndicator; break;
      default: return;
    }
    if (!indicator) return;
    if (remainingTime > 0) {
      indicator.classList.add('active');
      const timer = indicator.querySelector('.timer');
      if (timer) timer.textContent = (remainingTime / 1000).toFixed(1) + 's';
    } else {
      indicator.classList.remove('active');
    }
  }

  updateWeaponName(name) {
    if (this.elements.weaponName) this.elements.weaponName.textContent = name;
  }

  updateSpecialCharge(current, max) {
    const pct = Math.max(0, Math.min(100, (current / max) * 100));
    if (this.elements.specialChargeFill) {
      this.elements.specialChargeFill.style.width = `${pct}%`;
    }
  }

  setSpecialReady(ready) {
    const orb = this.elements.specialVortexOrb;
    if (orb) {
      orb.classList.toggle('special-vortex-ready', !!ready);
      orb.style.display = ready ? 'flex' : 'none';
      orb.setAttribute('aria-pressed', ready ? 'true' : 'false');
    }
  }

  bindMusic(gameMusic) {
    this._gameMusic = gameMusic;
    const b = this.elements.musicToggleBtn;
    if (!b || b.dataset.bound) return;
    b.dataset.bound = '1';
    const onTap = (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      this._gameMusic?.toggle();
      this.syncMusicButton();
    };
    b.addEventListener('pointerup', onTap, { passive: false });
    this.syncMusicButton();
  }

  syncMusicButton() {
    const b = this.elements.musicToggleBtn;
    if (!b || !this._gameMusic) return;
    const playing = this._gameMusic.isAudiblyPlaying();
    b.classList.toggle('music-off', !playing);
    b.setAttribute('aria-pressed', playing ? 'true' : 'false');
    b.title = playing ? 'Pause music' : 'Play music';
    b.textContent = playing ? '🎵' : '⏸';
    b.setAttribute('aria-label', playing ? 'Pause music' : 'Play music');
  }

  showDareScreen(wave, onContinue, onStore, onBailToTitle, opts = {}) {
    if (!this.elements.dareScreen) return;
    const msg = DARE_MESSAGES[Math.floor(Math.random() * DARE_MESSAGES.length)];
    const finale = !!(opts.finaleLeadIn || wave === BOSS_TRIGGER_AFTER_WAVE);
    if (this.elements.dareWaveCleared) {
      this.elements.dareWaveCleared.textContent = finale ? `WAVE ${wave} CLEARED — NOT OVER` : `WAVE ${wave} CLEARED`;
    }
    if (this.elements.dareText) {
      this.elements.dareText.textContent = finale
        ? 'The walls shook. A shape behind the neon is calling more bodies onto the floor. One last fight.'
        : msg;
    }

    this.elements.hud.style.display = 'none';
    const dare = this.elements.dareScreen;
    dare.style.display = 'flex';
    dare.style.opacity = '0';
    dare.style.transition = 'opacity 0.55s ease';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        dare.style.opacity = '1';
      });
    });

    const contBtn = document.getElementById('dare-continue');
    const storeBtn = document.getElementById('dare-store');
    const bailBtn = document.getElementById('dare-bail-btn');

    const cleanup = () => {
      for (const id of ['dare-continue', 'dare-store', 'dare-bail-btn']) {
        const el = document.getElementById(id);
        if (el) el.replaceWith(el.cloneNode(true));
      }
      this.elements.dareContinue = document.getElementById('dare-continue');
      this.elements.dareStore = document.getElementById('dare-store');
      this.elements.dareBailBtn = document.getElementById('dare-bail-btn');
    };

    const hideDare = () => {
      this.elements.dareScreen.style.display = 'none';
      this.elements.dareScreen.style.opacity = '';
      this.elements.dareScreen.style.transition = '';
    };
    if (contBtn) {
      bindPrimaryPointerUpOnce(contBtn, () => {
        cleanup();
        hideDare();
        onContinue();
      });
    }
    if (storeBtn) {
      bindPrimaryPointerUpOnce(storeBtn, () => {
        cleanup();
        hideDare();
        onStore();
      });
    }
    if (bailBtn && typeof onBailToTitle === 'function') {
      bindPrimaryPointerUpOnce(bailBtn, () => {
        cleanup();
        hideDare();
        onBailToTitle();
      });
    }
  }

  showStore(coins, unlockedWeapons, currentWeapon, callbacks) {
    if (!this.elements.storeScreen || !this.elements.storeGrid) return;
    this.elements.storeScreen.style.display = 'flex';
    this._renderStoreItems(coins, unlockedWeapons, currentWeapon, callbacks);

    const closeBtn = this.elements.storeClose;
    const doClose = (e) => {
      if (e) e.preventDefault();
      this.elements.storeScreen.style.display = 'none';
      callbacks.onClose();
    };
    closeBtn.replaceWith(closeBtn.cloneNode(true));
    this.elements.storeClose = document.getElementById('store-close');
    bindPrimaryPointerUpOnce(this.elements.storeClose, doClose);
  }

  _renderStoreItems(coins, unlockedWeapons, currentWeapon, callbacks) {
    const grid = this.elements.storeGrid;
    grid.innerHTML = '';
    if (this.elements.storeCoins) this.elements.storeCoins.textContent = coins;

    STORE_ITEMS.forEach(item => {
      const owned = item.type === 'weapon' && unlockedWeapons.includes(item.id);
      const equipped = item.id === currentWeapon;
      const canAfford = coins >= item.cost;

      const card = document.createElement('div');
      card.className = 'store-card' + (owned ? ' owned' : '') + (equipped ? ' equipped' : '') + (!canAfford && !owned ? ' expensive' : '');

      let statusText;
      if (equipped) statusText = 'EQUIPPED';
      else if (owned) statusText = 'OWNED - TAP TO EQUIP';
      else statusText = `${item.cost} COINS`;

      card.innerHTML = `<div class="item-icon">${this._getItemIcon(item.id)}</div><div class="item-name">${item.name}</div><div class="item-desc">${item.desc}</div><div class="item-cost">${statusText}</div>`;

      bindPrimaryPointerUpOnce(card, () => {
        if (owned && !equipped && item.type === 'weapon') {
          callbacks.onEquip(item.id);
          this._renderStoreItems(callbacks.getCoins(), callbacks.getUnlocked(), item.id, callbacks);
        } else if (!owned && canAfford) {
          if (callbacks.onBuy(item.id)) {
            this._renderStoreItems(callbacks.getCoins(), callbacks.getUnlocked(), callbacks.getCurrentWeapon(), callbacks);
          }
        }
      });

      grid.appendChild(card);
    });
  }

  _getItemIcon(id) {
    switch (id) {
      case 'gatling': return '<span style="font-size:1.8rem">🔫</span>';
      case 'laser': return '<span style="font-size:1.8rem">⚡</span>';
      case 'rocket': return '<span style="font-size:1.8rem">🚀</span>';
      case 'maxHp': return '<span style="font-size:1.8rem">❤️</span>';
      case 'allyDur': return '<span style="font-size:1.8rem">🛸</span>';
      default: return '';
    }
  }

  hideAllOverlays() {
    if (this.elements.dareScreen) {
      this.elements.dareScreen.style.display = 'none';
      this.elements.dareScreen.style.opacity = '';
      this.elements.dareScreen.style.transition = '';
    }
    if (this.elements.storeScreen) this.elements.storeScreen.style.display = 'none';
    if (this.elements.hud) this.elements.hud.style.display = 'block';
    if (this.elements.hudTouchLayer) this.elements.hudTouchLayer.style.display = 'block';
  }

  init() {
    this.updateHealth(300, 300);
    this.updateStamina(100, 100, false);
    this.updateCoins(0);
    this.updateScore(0);
    this.updateWave(1);
    this.updateStats(0, 0);
    this.updateLevelName('');
    this.updatePowerup('rapidFire', 0);
    this.updatePowerup('slowMotion', 0);
    this.updatePowerup('alienShip', 0);
    this.updateWeaponName('DISCO BLASTER');
    this.updateSpecialCharge(0, SPECIAL_CHARGE_KILLS);
    this.setSpecialReady(false);
    this.hideWaveCountdown();

    const orb = this.elements.specialVortexOrb;
    if (orb && !orb.dataset.bound) {
      orb.dataset.bound = '1';
      let lastFireMs = 0;
      const fire = (e) => {
        if (e && e.button > 0) return;
        if (e) {
          try {
            e.preventDefault();
          } catch (err) {}
        }
        const t = performance.now();
        if (t - lastFireMs < 380) return;
        lastFireMs = t;
        this.onSpecialActivate?.();
      };
      orb.addEventListener('pointerup', fire, { passive: false });
      orb.addEventListener(
        'touchend',
        (e) => {
          try {
            e.preventDefault();
          } catch (err) {}
          fire(e);
        },
        { passive: false }
      );
    }
  }
}
