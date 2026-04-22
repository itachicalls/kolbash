/**
 * UI System - HUD, wave announcements, level effects, store, dare screen
 */

import { TOTAL_WAVES } from './waves.js';
import { SPECIAL_CHARGE_KILLS } from './special-attack.js';

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

      healthBar: document.getElementById('health-bar'),
      healthText: document.getElementById('health-text'),
      coinCount: document.getElementById('coin-count'),
      scoreValue: document.getElementById('score-value'),
      waveNumber: document.getElementById('wave-number'),
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
      waveCountdownDigit: document.getElementById('wave-countdown-digit')
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

  showGameOver(stats, onRetry) {
    this.setVisibility('gameover');
    if (this.elements.finalWave) this.elements.finalWave.textContent = stats.wave;
    if (this.elements.finalScore) this.elements.finalScore.textContent = stats.score.toLocaleString();
    if (this.elements.finalKills) this.elements.finalKills.textContent = (stats.kills ?? 0).toLocaleString();
    if (this.elements.finalDamage) this.elements.finalDamage.textContent = (stats.damageDealt ?? 0).toLocaleString();
    if (this.elements.finalCoins) this.elements.finalCoins.textContent = stats.coins.toLocaleString();

    const btn = this.elements.gameRetryBtn;
    if (btn && onRetry) {
      const clone = btn.cloneNode(true);
      btn.replaceWith(clone);
      this.elements.gameRetryBtn = document.getElementById('game-retry-btn');
      bindPrimaryPointerUpOnce(this.elements.gameRetryBtn, () => onRetry());
    }
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
      if (this.elements.specialVortexOrb) {
        this.elements.specialVortexOrb.style.display = 'none';
        this.elements.specialVortexOrb.classList.remove('special-vortex-ready');
      }
      if (this.elements.musicToggleBtn) this.elements.musicToggleBtn.style.display = 'none';
    } else     if (this.elements.musicToggleBtn) {
      this.elements.musicToggleBtn.style.display = 'flex';
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

  showDareScreen(wave, onContinue, onStore) {
    if (!this.elements.dareScreen) return;
    const msg = DARE_MESSAGES[Math.floor(Math.random() * DARE_MESSAGES.length)];
    if (this.elements.dareWaveCleared) this.elements.dareWaveCleared.textContent = `WAVE ${wave} CLEARED`;
    if (this.elements.dareText) this.elements.dareText.textContent = msg;

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

    const contBtn = this.elements.dareContinue;
    const storeBtn = this.elements.dareStore;

    const cleanup = () => {
      contBtn.replaceWith(contBtn.cloneNode(true));
      storeBtn.replaceWith(storeBtn.cloneNode(true));
      this.elements.dareContinue = document.getElementById('dare-continue');
      this.elements.dareStore = document.getElementById('dare-store');
    };

    const hideDare = () => {
      this.elements.dareScreen.style.display = 'none';
      this.elements.dareScreen.style.opacity = '';
      this.elements.dareScreen.style.transition = '';
    };
    bindPrimaryPointerUpOnce(contBtn, () => {
      cleanup();
      hideDare();
      onContinue();
    });
    bindPrimaryPointerUpOnce(storeBtn, () => {
      cleanup();
      hideDare();
      onStore();
    });
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
