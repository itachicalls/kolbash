/**
 * UI System - HUD, wave announcements, level effects, store, dare screen
 */

export const STORE_ITEMS = [
  { id: 'gatling', name: 'GATLING GUN', cost: 200, type: 'weapon', desc: 'Rapid bullet storm' },
  { id: 'laser', name: 'LASER CANNON', cost: 300, type: 'weapon', desc: 'High-damage beam' },
  { id: 'rocket', name: 'ROCKET LAUNCHER', cost: 400, type: 'weapon', desc: 'AoE explosive rounds' },
  { id: 'maxHp', name: 'HP BOOST +50', cost: 100, type: 'upgrade', desc: '+50 Max Health', repeatable: true },
  { id: 'allyDur', name: 'ALLY UPGRADE', cost: 150, type: 'upgrade', desc: '+5s Ship Duration', repeatable: true }
];

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
      gameOver: document.getElementById('game-over'),

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

      weaponName: document.getElementById('weapon-name')
    };

    this.waveAnnouncementTimeout = null;
    this.levelEffectTimeout = null;
    this.crosshairEl = document.getElementById('crosshair');
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

  showLoading() { this.setVisibility('loading'); }

  updateLoadingProgress(message) {
    if (this.elements.loadingProgress) this.elements.loadingProgress.textContent = message;
  }

  showStartScreen() { this.setVisibility('start'); }
  showGame() { this.setVisibility('game'); }

  showGameOver(stats) {
    this.setVisibility('gameover');
    if (this.elements.finalWave) this.elements.finalWave.textContent = stats.wave;
    if (this.elements.finalScore) this.elements.finalScore.textContent = stats.score.toLocaleString();
    if (this.elements.finalKills) this.elements.finalKills.textContent = (stats.kills ?? 0).toLocaleString();
    if (this.elements.finalDamage) this.elements.finalDamage.textContent = (stats.damageDealt ?? 0).toLocaleString();
    if (this.elements.finalCoins) this.elements.finalCoins.textContent = stats.coins.toLocaleString();
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
    if (this.elements.coinCount) {
      this.elements.coinCount.textContent = count.toLocaleString();
      this.elements.coinCount.style.transform = 'scale(1.3)';
      this.elements.coinCount.style.color = '#ffffff';
      setTimeout(() => {
        this.elements.coinCount.style.transform = 'scale(1)';
        this.elements.coinCount.style.color = '#ffd700';
      }, 150);
    }
  }

  updateScore(score) {
    if (this.elements.scoreValue) this.elements.scoreValue.textContent = score.toLocaleString();
  }

  updateWave(wave) {
    if (this.elements.waveNumber) this.elements.waveNumber.textContent = wave;
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
    if (this.elements.waveAnnouncement) {
      this.elements.waveAnnouncement.classList.remove('show');
      void this.elements.waveAnnouncement.offsetWidth;
      this.elements.waveAnnouncement.classList.add('show');
      const duration = isLevelChange ? 3500 : 2500;
      this.waveAnnouncementTimeout = setTimeout(() => {
        this.elements.waveAnnouncement.classList.remove('show');
      }, duration);
    }
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

  showDareScreen(wave, onContinue, onStore) {
    if (!this.elements.dareScreen) return;
    const msg = DARE_MESSAGES[Math.floor(Math.random() * DARE_MESSAGES.length)];
    if (this.elements.dareWaveCleared) this.elements.dareWaveCleared.textContent = `WAVE ${wave} CLEARED`;
    if (this.elements.dareText) this.elements.dareText.textContent = msg;

    this.elements.hud.style.display = 'none';
    this.elements.dareScreen.style.display = 'flex';

    const contBtn = this.elements.dareContinue;
    const storeBtn = this.elements.dareStore;

    const cleanup = () => {
      contBtn.replaceWith(contBtn.cloneNode(true));
      storeBtn.replaceWith(storeBtn.cloneNode(true));
      this.elements.dareContinue = document.getElementById('dare-continue');
      this.elements.dareStore = document.getElementById('dare-store');
    };

    contBtn.addEventListener('click', () => { cleanup(); this.elements.dareScreen.style.display = 'none'; onContinue(); }, { once: true });
    contBtn.addEventListener('touchend', (e) => { e.preventDefault(); cleanup(); this.elements.dareScreen.style.display = 'none'; onContinue(); }, { once: true });
    storeBtn.addEventListener('click', () => { cleanup(); this.elements.dareScreen.style.display = 'none'; onStore(); }, { once: true });
    storeBtn.addEventListener('touchend', (e) => { e.preventDefault(); cleanup(); this.elements.dareScreen.style.display = 'none'; onStore(); }, { once: true });
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
    this.elements.storeClose.addEventListener('click', doClose, { once: true });
    this.elements.storeClose.addEventListener('touchend', doClose, { once: true });
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

      card.addEventListener('click', () => {
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
    if (this.elements.dareScreen) this.elements.dareScreen.style.display = 'none';
    if (this.elements.storeScreen) this.elements.storeScreen.style.display = 'none';
    if (this.elements.hud) this.elements.hud.style.display = 'block';
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
  }
}
