/**
 * KOL BASH: Disco Mayhem
 * Store, dare screen, multi-weapon, ally ships, level effects, mobile
 */

import * as THREE from 'three';
import { PhysicsWorld } from './physics.js';
import { Player } from './player.js';
import { EnemyManager } from './enemy.js';
import { Weapon, WEAPON_DEFS } from './weapon.js';
import { ItemManager } from './items.js';
import { WaveManager, TOTAL_WAVES } from './waves.js';
import { UIManager, STORE_ITEMS } from './ui.js';
import { Arena, LEVELS } from './arena.js';
import { DeathScene } from './death-scene.js';
import { DareBackupDancers } from './dare-backup-dancers.js';
import { SpecialAttackController, SPECIAL_CHARGE_KILLS } from './special-attack.js';
import { GameMusic } from './game-music.js';
import { WaveClearCinematic } from './wave-clear-cinematic.js';
import { resumeSharedAudioContext } from './shared-audio.js';

class Game {
  constructor() {
    this.isRunning = false;
    this.modelsReady = false;
    this.score = 0;
    this.coins = 0;
    this.kills = 0;
    this.damageDealt = 0;
    this.screenShake = 0;
    this.clock = new THREE.Clock();

    const touchCapable =
      ('ontouchstart' in window) || (typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0);
    const coarsePointer =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const narrowViewport = typeof window !== 'undefined' && window.innerWidth < 1400;
    this.isMobile = touchCapable && (coarsePointer || narrowViewport);
    const dm = typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined;
    const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
    this.isLowTierMobile =
      this.isMobile && (((dm != null && dm <= 4) || (hc != null && hc <= 4)));
    /** Plenty of RAM + cores (e.g. recent iPhone) — still mobile, but avoid over-throttling. */
    this.isHighEndMobile =
      this.isMobile &&
      !this.isLowTierMobile &&
      ((dm != null && dm >= 6) || (hc != null && hc >= 5));

    this.perf = this._buildPerfProfile();

    this.currentLevelEffect = null;
    this.poisonTickTime = 0;

    this.allyShips = [];
    this.allyProjectiles = [];
    this.allyBoltGeo = null;
    this.allyBoltMat = null;
    this.gameMusic = null;
    this.allyShipDuration = 18000;
    this.allyDurUpgrades = 0;

    this.unlockedWeapons = ['disco'];
    this.currentWeapon = 'disco';
    this.healthUpgrades = 0;

    this.deathScene = null;
    this.deathSequenceActive = false;
    this.dareDancers = null;

    this.specialAttack = null;
    this.specialAttackActive = false;
    this.specialCharge = 0;
    this.specialReady = false;

    this._waveCountdownRunning = false;
    /** Blocks double resume from touch + synthetic click on dare / store close. */
    this._overlayResumeBusy = false;

    /** Mobile-only: continuous fire without holding FIRE (persisted). */
    this.mobileAutoFire = false;
    try {
      if (this.isMobile) this.mobileAutoFire = localStorage.getItem('kolbash_mobile_autofire') === '1';
    } catch (e) {}

    this._glContextLost = false;
    /** Throttles rapid special taps while not charged (avoids iOS jank / audio spikes). */
    this._lastSpecialRejectMs = 0;
  }

  _buildPerfProfile() {
    const m = this.isMobile;
    const low = this.isLowTierMobile;
    const high = this.isHighEndMobile;
    return {
      /** iOS WebKit: DPR>1 multiplies VRAM ~×4 per step — keep draw buffer tiny on phones. */
      maxPixelRatio: m ? 1 : Math.min(1.75, window.devicePixelRatio || 1),
      powerPreference: m ? (low ? 'low-power' : 'default') : 'high-performance',
      floorTextureSize: m ? (low ? 448 : 512) : 1024,
      wallDecalWidth: m ? (low ? 280 : 320) : 512,
      wallDecalHeight: m ? (low ? 140 : 160) : 256,
      floorAnisotropy: m ? 2 : 12,
      maxPlayerProjectiles: m ? (low ? 10 : 12) : 34,
      maxEnemyProjectiles: m ? (low ? 3 : 4) : 10,
      maxEnemiesPerWave: m ? (low ? 8 : 9) : 16,
      cylinderSegments: m ? (low ? 5 : 6) : 8,
      poolClonesPerModel: m ? 1 : 3,
      maxShootersPerWave: m ? 2 : 3,
      maxCoinsAlive: m ? (low ? 40 : 65) : 110,
      allyBoltGeometryDetail: m ? 0 : 1,
      frameDeltaCap: m ? 0.052 : 0.06
    };
  }

  async init() {
    this.ui = new UIManager();
    this.ui.showLoading();
    this.ui.updateLoadingProgress('Booting renderer…');

    await new Promise(r => requestAnimationFrame(r));

    this.createScene();
    this.gameMusic.setStateChangeHandler(() => this.ui.syncMusicButton?.());
    this.ui.bindMusic(this.gameMusic);
    this.ui.updateLoadingProgress('Physics & arena…');
    this.createPhysics();
    this.createPlayer();
    this.createWeapon();
    this.createArena();
    this.createManagers();
    this.setupEventListeners();

    this.ui.onSpecialActivate = () => this.trySpecialAttack();

    const btn = document.querySelector('#start-screen .start-btn');
    if (btn) {
      btn.textContent = 'LOADING…';
      btn.style.opacity = '0.5';
      btn.style.cursor = 'wait';
    }

    try {
      this.ui.updateLoadingProgress('Loading character models…');
      await this.preloadModels((done, total) => {
        this.ui.updateLoadingProgress(`Models ${done} / ${total}`);
      });
      this.ui.updateLoadingProgress('Warming enemy pool…');
      this.enemyManager.warmPool(this.perf.poolClonesPerModel);
      if (!this.isMobile) {
        this.ui.updateLoadingProgress('Pre-compiling shaders…');
        this.enemyManager.prewarmSkinnedMaterials(this.renderer, this.camera);
      }
      this.ui.updateLoadingProgress('Baking arena visuals…');
      if (this.isMobile) {
        await this.arena.prebakeLevelTexturesAsync({ onlyLevels: [0, 1] });
      } else {
        await this.arena.prebakeLevelTexturesAsync();
      }
      this.ui.updateLoadingProgress('Starting…');
      if (this.isMobile) {
        await this.deathScene.preload().catch(() => {});
        await new Promise((r) => requestAnimationFrame(r));
        await this.waveClear.preload({ serial: true }).catch(() => {});
        await new Promise((r) => requestAnimationFrame(r));
        await this.specialAttack.preload().catch(() => {});
      } else {
        await Promise.all([
          this.deathScene.preload().catch(() => {}),
          this.dareDancers.preload().catch(() => {}),
          this.specialAttack.preload().catch(() => {}),
          this.waveClear.preload().catch(() => {})
        ]).catch(() => {});
      }
    } catch (e) {
      console.warn('Model loading issue:', e);
    }

    this.modelsReady = true;
    this.ui.showStartScreen();
    if (this.isMobile) {
      const rest = [];
      for (let L = 2; L < LEVELS.length; L++) rest.push(L);
      void this.arena.prebakeLevelTexturesAsync({ onlyLevels: rest }).catch(() => {});
    }
    if (btn) {
      btn.textContent = this.isMobile ? 'TAP TO PLAY' : 'ENTER THE FLOOR';
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    }

    if (this.isMobile) {
      document.getElementById('mobile-controls')?.style.setProperty('display', 'block');
    }
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a0a2e);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.5, 100);
    this.camera.position.set(0, 2, 0);
    this.scene.add(this.camera);

    const maxPR = this.perf.maxPixelRatio;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: this.perf.powerPreference,
      stencil: false,
      alpha: false,
      preserveDrawingBuffer: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPR));
    this.renderer.shadowMap.enabled = false;
    this.renderer.autoClear = true;
    if (this.isMobile) {
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.toneMappingExposure = 1;
    } else {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.08;
    }
    if ('outputColorSpace' in this.renderer) {
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    const canvas = this.renderer.domElement;
    canvas.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault();
        this._glContextLost = true;
        this.isRunning = false;
        this.clock.stop();
        if (this.weapon) {
          this.weapon.isHolding = false;
          this.weapon.mobileAutoFireActive = false;
        }
      },
      false
    );

    document.getElementById('game-container').appendChild(this.renderer.domElement);

    const d = this.perf.allyBoltGeometryDetail;
    this.allyBoltGeo = new THREE.IcosahedronGeometry(0.11, d);
    this.allyBoltMat = this.isMobile
      ? new THREE.MeshBasicMaterial({ color: 0x99ffee })
      : new THREE.MeshStandardMaterial({
          color: 0xccfff0,
          emissive: 0x00ffaa,
          emissiveIntensity: 0.95,
          metalness: 0.5,
          roughness: 0.22
        });
    this.createLighting();

    this.deathScene = new DeathScene();
    this.dareDancers = new DareBackupDancers({ useWebGlRenderer: !this.isMobile });
    this.specialAttack = new SpecialAttackController(this.scene, {
      maxOrbs: this.isMobile ? 40 : 90
    });
    this.gameMusic = new GameMusic();
    this.waveClear = new WaveClearCinematic(this.scene, this.camera);
  }

  createLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, this.isMobile ? 1.02 : 1.05);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, this.isMobile ? 0.68 : 0.72);
    sun.position.set(5, 15, 5);
    this.scene.add(sun);

    this.discoLight = new THREE.PointLight(0xff66aa, 0.5, 40);
    this.discoLight.position.set(15, 8, 15);
    this.scene.add(this.discoLight);
  }

  createPhysics() {
    this.physicsWorld = new PhysicsWorld({ cylinderSegments: this.perf.cylinderSegments });
    this.physicsWorld.createGround(100);
  }

  createPlayer() {
    this.player = new Player(this.camera, this.physicsWorld, document.body);
    this.player.onDeathCallback = () => this.beginDeathSequence();
  }

  createWeapon() {
    this.weapon = new Weapon(this.camera, this.scene, { maxProjectiles: this.perf.maxPlayerProjectiles });
  }

  createArena() {
    this.arena = new Arena(this.scene, this.physicsWorld, {
      floorTextureSize: this.perf.floorTextureSize,
      wallDecalWidth: this.perf.wallDecalWidth,
      wallDecalHeight: this.perf.wallDecalHeight,
      floorAnisotropy: this.perf.floorAnisotropy,
      liteMobileVisuals: this.isMobile,
      staggerPrebakeFrames: this.isMobile ? 2 : 1
    });
  }

  createManagers() {
    this.enemyManager = new EnemyManager(this.scene, this.physicsWorld, {
      maxEnemyProjectiles: this.perf.maxEnemyProjectiles,
      maxShootersPerWave: this.perf.maxShootersPerWave,
      poolReplenishTo: Math.max(2, this.perf.poolClonesPerModel + 1)
    });
    this.enemyManager.onEnemyDeath = (enemy) => this.onEnemyKilled(enemy);

    this.itemManager = new ItemManager(this.scene, { maxCoinsAlive: this.perf.maxCoinsAlive });

    this.waveManager = new WaveManager(this.enemyManager, {
      maxEnemiesPerWave: this.perf.maxEnemiesPerWave,
      hasActivePlayerProjectiles: () => this.weapon.hasActiveProjectiles()
    });
    this.waveManager.setPlayerCamera(this.camera);
    this.enemyManager.setWaveManager(this.waveManager);

    this.waveManager.onWaveStart = (wave, taunt, levelChanged) => {
      this.ui.updateWave(wave);
      const levelName = this.arena.getLevelName();
      const finalTaunt = wave === TOTAL_WAVES ? 'FINAL WAVE — END THE DISCO' : taunt;
      this.ui.showWaveAnnouncement(wave, finalTaunt, levelName, levelChanged);
      this.ui.updateLevelName(levelName);
    };

    this.waveManager.onLevelChange = (levelIndex) => {
      if (this.isMobile) {
        this.arena.ensureLevelTexturesReadySync(levelIndex);
      }
      const level = this.arena.setLevel(levelIndex);
      if (this.discoLight) this.discoLight.color.set(level.neon);
      this.applyLevelEffect(level);
      this.triggerLevelFlash();
    };

    this.waveManager.onWaveComplete = (wave) => {
      this.score += wave * 100;
      this.ui.updateScore(this.score);
      this.enemyManager.replenishPool();
      if (wave >= TOTAL_WAVES) {
        this.showVictory();
      } else {
        if (this.specialAttackActive) {
          this.specialAttack.stop();
          this.specialAttackActive = false;
          this.player.inputFrozen = false;
        }
        this.player.inputFrozen = true;
        this.weapon.isHolding = false;
        if (!this.isMobile && document.pointerLockElement) {
          document.exitPointerLock();
        }
        this.player.controls.unlock();
        const yaw = this.getPlayerYaw();
        const goDare = () => {
          this.player.inputFrozen = false;
          this.showDareScreen(wave);
        };
        (async () => {
          await this.waveClear.ensureLoaded().catch(() => {});
          this.waveClear.start(wave, this.player, yaw, goDare);
        })();
      }
    };
  }

  getBaseDamage() {
    return WEAPON_DEFS[this.currentWeapon]?.damage || 25;
  }

  applyLevelEffect(level) {
    this.currentLevelEffect = level.effect || null;
    this.poisonTickTime = 0;

    this.weapon.damage = this.getBaseDamage();
    this.itemManager.doubleCoinsMult = 1;

    if (!this.currentLevelEffect) return;

    const fx = this.currentLevelEffect;
    switch (fx.type) {
      case 'playerDmgBoost':
        this.weapon.damage = Math.round(this.getBaseDamage() * fx.value);
        break;
      case 'doubleCoins':
        this.itemManager.doubleCoinsMult = fx.value;
        this.itemManager.doubleCoinsEndTime = Infinity;
        break;
      case 'chaosMode':
        this.weapon.damage = Math.round(this.getBaseDamage() * fx.playerDmg);
        break;
    }

    this.ui.showLevelEffect(fx.label);
  }

  triggerLevelFlash() {
    const overlay = document.getElementById('damage-overlay');
    if (!overlay) return;
    const orig = overlay.style.background;
    overlay.style.background = 'radial-gradient(ellipse at center, rgba(255,255,255,0.6) 0%, transparent 70%)';
    overlay.style.opacity = '0.7';
    setTimeout(() => {
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.style.background = orig || 'radial-gradient(ellipse at center, transparent 0%, rgba(255,0,0,0.4) 100%)';
      }, 200);
    }, 250);
  }

  async preloadModels(onProgress) {
    const models = [
      '/models/alon_dancing.fbx',
      '/models/slingoor_dance.fbx',
      '/models/pow_dive.fbx',
      '/models/jump_attack.fbx',
      '/models/marcell_dancing.fbx',
      '/models/thriller_part3.fbx'
    ];
    let done = 0;
    const bump = () => {
      done++;
      onProgress?.(done, models.length);
    };
    await Promise.all(
      models.map((path) =>
        this.enemyManager.loadFBX(path).catch(() => {}).finally(bump)
      )
    );
  }

  setupEventListeners() {
    window.addEventListener('error', (ev) => {
      console.warn('[KOL BASH]', ev.error || ev.message);
    });
    window.addEventListener('unhandledrejection', (ev) => {
      console.warn('[KOL BASH] unhandled', ev.reason);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.clock.stop();
        this.gameMusic?.suspendForBackground();
        if (this.weapon) {
          this.weapon.isHolding = false;
          this.weapon.mobileAutoFireActive = false;
        }
      } else if (this.isRunning) {
        this.clock.start();
        this.gameMusic?.resumeIfRunning();
      }
    });

    window.addEventListener('resize', () => this.onWindowResize());

    const startScr = document.getElementById('start-screen');
    if (startScr) {
      startScr.addEventListener(
        'pointerup',
        (e) => {
          if (e.button > 0) return;
          e.preventDefault();
          this.startGame();
        },
        { passive: false }
      );
    }

    const jumpBtn = document.getElementById('jump-btn');
    if (jumpBtn) {
      jumpBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.player.pendingJump = true;
      }, { passive: false });
      jumpBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
      }, { passive: false });
    }

    this._setupMobileAutofireToggle();

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE' && this.isRunning) {
        this.trySpecialAttack();
      }
      const num = parseInt(e.key);
      if (num >= 1 && num <= 4) {
        const weapons = ['disco', 'gatling', 'laser', 'rocket'];
        const w = weapons[num - 1];
        if (this.unlockedWeapons.includes(w)) {
          this.switchWeapon(w);
        }
      }
    });
  }

  onWindowResize() {
    const w = Math.max(1, window.innerWidth || 1);
    const h = Math.max(1, window.innerHeight || 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.perf.maxPixelRatio));
    if (this.deathSequenceActive && this.deathScene) {
      this.deathScene.camera.aspect = this.camera.aspect;
      this.deathScene.camera.updateProjectionMatrix();
    }
  }

  _syncMobileAutofireFlag() {
    if (!this.weapon) return;
    const block =
      !this.isMobile ||
      !this.mobileAutoFire ||
      !this.isRunning ||
      this.player.inputFrozen ||
      this.player.isDead ||
      this.specialAttackActive ||
      this.waveManager?.combatHoldActive ||
      this.waveClear?.active;
    this.weapon.mobileAutoFireActive = !block;
  }

  _setupMobileAutofireToggle() {
    const btn = document.getElementById('mobile-autofire-toggle');
    if (!btn) return;
    const sync = () => {
      const on = !!this.mobileAutoFire;
      btn.textContent = on ? 'AUTO: ON' : 'AUTO: OFF';
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    sync();
    const onToggle = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.mobileAutoFire = !this.mobileAutoFire;
      try {
        localStorage.setItem('kolbash_mobile_autofire', this.mobileAutoFire ? '1' : '0');
      } catch (err) {}
      sync();
    };
    btn.addEventListener('pointerup', onToggle);
    this._syncMobileAutofireBtn = sync;
  }

  switchWeapon(type) {
    if (this.currentWeapon === type) return;
    this.currentWeapon = type;
    this.weapon.setWeapon(type);
    this.ui.updateWeaponName(WEAPON_DEFS[type].name);

    if (this.currentLevelEffect) {
      const fx = this.currentLevelEffect;
      if (fx.type === 'playerDmgBoost') this.weapon.damage = Math.round(this.getBaseDamage() * fx.value);
      else if (fx.type === 'chaosMode') this.weapon.damage = Math.round(this.getBaseDamage() * fx.playerDmg);
    }
  }

  // ── Dare Screen & Store ──

  showVictory() {
    this.isRunning = false;
    this.clearAllyShips();

    if (!this.isMobile && document.pointerLockElement) {
      document.exitPointerLock();
    }
    if (this.isMobile) {
      document.getElementById('mobile-controls')?.style.setProperty('display', 'none');
    }

    this.score += 5000;
    this.ui.updateScore(this.score);

    this.ui.showVictory({
      score: this.score,
      kills: this.kills,
      damageDealt: this.damageDealt,
      coins: this.coins
    }, () => this.returnToTitle());
  }

  returnToTitle() {
    this.isRunning = false;
    this.gameMusic?.stop();
    this.ui.syncMusicButton?.();
    if (!this.isMobile && document.pointerLockElement) {
      document.exitPointerLock();
    }
    if (this.isMobile) {
      document.getElementById('mobile-controls')?.style.setProperty('display', 'none');
    }
    this.ui.showStartScreen();
  }

  restartRun() {
    if (!this.modelsReady) return;
    resumeSharedAudioContext();
    this.deathSequenceActive = false;
    if (this.deathScene?.active) this.deathScene.stop();

    this.score = 0;
    this.coins = 0;
    this.kills = 0;
    this.damageDealt = 0;
    this.screenShake = 0;
    this.poisonTickTime = 0;
    this.currentLevelEffect = null;
    this.healthUpgrades = 0;
    this.allyDurUpgrades = 0;
    this.allyShipDuration = 18000;
    this.unlockedWeapons = ['disco'];
    this.currentWeapon = 'disco';
    this.weapon.setWeapon('disco');
    this.specialAttackActive = false;
    this.specialCharge = 0;
    this.specialReady = false;
    this.specialAttack?.stop();
    this.waveClear?.stop(false);
    this.ui.setSpecialReady(false);
    this.ui.updateSpecialCharge(0, SPECIAL_CHARGE_KILLS);

    this.player.maxHealth = 300;
    this.player.reset();
    this.enemyManager.clear();
    this.itemManager.clear();
    this.waveManager.reset();
    this.clearAllyShips();

    this.arena.setLevel(0);
    this.applyLevelEffect(LEVELS[0]);
    if (this.discoLight) this.discoLight.color.set(LEVELS[0].neon);

    this.ui.init();
    this.ui.showGame();
    this.ui.updateWeaponName('DISCO BLASTER');
    this._syncMobileAutofireBtn?.();

    if (this.isMobile) {
      this.player.controls.lock();
      document.getElementById('mobile-controls')?.style.setProperty('display', 'block');
    } else {
      this.player.controls.lock();
    }

    this.isRunning = true;
    this.clock.start();

    this.gameMusic?.stop();
    this.gameMusic?.start();
    this.ui.syncMusicButton?.();

    this.player.inputFrozen = true;
    this.weapon.isHolding = false;

    this.animate();
    void this.runWaveCountdownThenStartWave();
  }

  async runWaveCountdownThenStartWave() {
    try {
      if (this._waveCountdownRunning) return;
      this._waveCountdownRunning = true;
      this.player.inputFrozen = true;
      this.weapon.isHolding = false;

      const tickMs = 700;
      const goMs = 520;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      let wavePrimed = false;
      try {
        this.ui.showWaveCountdown();
        if (!this.isRunning || this.player.isDead) return;

        this.waveManager.startNextWave(this.player.getPosition(), { deferAnnouncement: true });
        wavePrimed = true;
        this.ui.updateWave(this.waveManager.currentWave);
        this.ui.updateLevelName(this.arena.getLevelName());

        for (const n of [3, 2, 1]) {
          if (!this.isRunning || this.player.isDead) return;
          this.ui.setWaveCountdownDigit(String(n), false);
          this.waveManager.playCountdownTick(n);
          await sleep(tickMs);
        }
        if (!this.isRunning || this.player.isDead) return;
        this.ui.setWaveCountdownDigit('GO!', true);
        this.waveManager.playCountdownGo();
        await sleep(goMs);
      } finally {
        this.ui.hideWaveCountdown();
        this._waveCountdownRunning = false;
        if (wavePrimed) {
          const ok = this.isRunning && !this.player.isDead;
          this.waveManager.releaseDeferredWaveStart({ silent: !ok });
        } else if (this.isRunning && !this.player.isDead) {
          this.waveManager.startNextWave(this.player.getPosition());
        }
        this.player.inputFrozen = false;
      }
    } finally {
      this._overlayResumeBusy = false;
    }
  }

  showDareScreen(wave) {
    this.isRunning = false;
    this.player.inputFrozen = false;

    if (!this.isMobile && document.pointerLockElement) {
      document.exitPointerLock();
    }

    this.ui.showDareScreen(wave,
      () => {
        this.dareDancers.hide();
        this.resumeNextWave();
      },
      () => {
        this.dareDancers.hide();
        this.showStore();
      }
    );
    if (this.dareDancers.useWebGlRenderer) {
      requestAnimationFrame(() => this.dareDancers.show());
    } else {
      this.dareDancers.show();
    }
  }

  showStore() {
    this.ui.showStore(this.coins, this.unlockedWeapons, this.currentWeapon, {
      onBuy: (id) => this.handlePurchase(id),
      onEquip: (id) => {
        this.switchWeapon(id);
      },
      onClose: () => this.resumeNextWave(),
      getCoins: () => this.coins,
      getUnlocked: () => this.unlockedWeapons,
      getCurrentWeapon: () => this.currentWeapon
    });
  }

  handlePurchase(id) {
    const item = STORE_ITEMS.find(i => i.id === id);
    if (!item || this.coins < item.cost) return false;

    if (item.type === 'weapon') {
      if (this.unlockedWeapons.includes(id)) return false;
      this.coins -= item.cost;
      this.unlockedWeapons.push(id);
      this.switchWeapon(id);
    } else if (id === 'maxHp') {
      this.coins -= item.cost;
      this.healthUpgrades++;
      this.player.maxHealth += 50;
      this.player.health = Math.min(this.player.health + 50, this.player.maxHealth);
      this.ui.updateHealth(this.player.health, this.player.maxHealth);
    } else if (id === 'allyDur') {
      this.coins -= item.cost;
      this.allyDurUpgrades++;
      this.allyShipDuration += 5000;
    }

    this.ui.updateCoins(this.coins);
    return true;
  }

  resumeNextWave() {
    if (this._overlayResumeBusy) return;
    this._overlayResumeBusy = true;

    this.dareDancers?.hide();
    this.ui.hideAllOverlays();
    this.isRunning = true;
    this.clock.start();

    if (this.isMobile) {
      this.player.controls.isLocked = true;
      document.getElementById('mobile-controls')?.style.setProperty('display', 'block');
    } else {
      this.player.controls.lock();
    }

    this.player.inputFrozen = true;
    this.weapon.isHolding = false;

    this.animate();
    void this.runWaveCountdownThenStartWave();
  }

  startGame() {
    if (this.isRunning) return;
    if (!this.modelsReady) return;
    resumeSharedAudioContext();
    this.restartRun();
  }

  onEnemyKilled(enemy) {
    this.kills++;

    if (!this.specialAttackActive && this.specialAttack?.cache && this.specialCharge < SPECIAL_CHARGE_KILLS) {
      this.specialCharge++;
      this.ui.updateSpecialCharge(this.specialCharge, SPECIAL_CHARGE_KILLS);
      if (this.specialCharge >= SPECIAL_CHARGE_KILLS && this.specialAttack.canStart()) {
        this.specialReady = true;
        this.ui.setSpecialReady(true);
      }
    }

    const isBoss = enemy.userData.type.isBoss;
    const scoreMultiplier = isBoss ? 5 : 1;
    const coinMultiplier = isBoss ? 3 : 1;

    let scoreMult = 1;
    if (this.currentLevelEffect?.type === 'scoreBoost') scoreMult = this.currentLevelEffect.value;

    this.score += Math.round((50 + this.waveManager.currentWave * 20) * scoreMultiplier * scoreMult);
    this.ui.updateScore(this.score);

    const coinCount = (2 + Math.floor(Math.random() * 3)) * coinMultiplier;
    this._spawnPos = this._spawnPos || new THREE.Vector3();
    this._spawnPos.copy(enemy.position);
    this.itemManager.spawnCoins(this._spawnPos, Math.min(coinCount, 10));

    if (isBoss) {
      this.itemManager.spawnPowerup(this._spawnPos, 3);
      if (Math.random() < 0.5) {
        this.itemManager.spawnPowerup(this._spawnPos);
      }
    } else if (Math.random() < 0.18) {
      this.itemManager.spawnPowerup(this._spawnPos);
    }
  }

  handleShooting(playerPos) {
    if (this.specialAttackActive) return;
    if (this.player.inputFrozen) return;
    if (!this.player.controls.isLocked) return;

    const shot = this.weapon.tryFire(this.player.rapidFire);
    if (!shot) return;

    const muzzlePos = this.weapon.getMuzzleWorldPosition();
    const dir = shot.direction;

    let closestEnemy = null;
    let closestDistSq = 60 * 60;
    const dx = dir.x, dz = dir.z;
    const dirLen = Math.sqrt(dx * dx + dz * dz) || 1;

    for (let i = 0; i < this.enemyManager.enemies.length; i++) {
      const enemy = this.enemyManager.enemies[i];
      if (enemy.userData.isDead) continue;
      const ex = enemy.position.x - muzzlePos.x;
      const ez = enemy.position.z - muzzlePos.z;
      const distSq = ex * ex + ez * ez;
      if (distSq > closestDistSq) continue;
      const dist = Math.sqrt(distSq);
      const dot = (ex * (dx / dirLen) + ez * (dz / dirLen)) / dist;
      if (dot > 0.94) {
        closestEnemy = enemy;
        closestDistSq = distSq;
      }
    }

    if (closestEnemy) {
      this.damageDealt += this.weapon.damage;
      this.enemyManager.damageEnemy(closestEnemy, this.weapon.damage);
      this.weapon.playHitSound();

      this._hitTarget = this._hitTarget || new THREE.Vector3();
      this._hitTarget.set(closestEnemy.position.x, 1.2, closestEnemy.position.z);
      this.weapon.spawnProjectile(muzzlePos, this._hitTarget, () => {
        if (this.currentWeapon === 'rocket') {
          this.rocketAOE(closestEnemy.position);
        }
      });
    } else {
      this._missTarget = this._missTarget || new THREE.Vector3();
      this._missTarget.set(muzzlePos.x + dir.x * 25, muzzlePos.y + dir.y * 25, muzzlePos.z + dir.z * 25);
      this.weapon.spawnProjectile(muzzlePos, this._missTarget, () => {
        if (this.currentWeapon === 'rocket') {
          this.rocketAOE(this._missTarget);
        }
      });
    }
  }

  rocketAOE(center) {
    const def = WEAPON_DEFS.rocket;
    for (const enemy of this.enemyManager.enemies) {
      if (enemy.userData.isDead) continue;
      const dx = enemy.position.x - center.x;
      const dz = enemy.position.z - center.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < def.aoeRadius) {
        const falloff = 1 - (dist / def.aoeRadius);
        const dmg = Math.round(def.aoeDamage * falloff);
        this.damageDealt += dmg;
        this.enemyManager.damageEnemy(enemy, dmg);
      }
    }
    this.screenShake = Math.min(this.screenShake + 0.6, 1.2);
  }

  handleItemPickups(playerPos) {
    const coinValue = this.itemManager.checkCoinPickup(playerPos);
    if (coinValue > 0) {
      this.coins += coinValue;
      this.score += coinValue;
      this.ui.updateCoins(this.coins);
      this.ui.updateScore(this.score);
    }

    const powerups = this.itemManager.checkPowerupPickup(playerPos);
    for (const p of powerups) this.applyPowerup(p);
  }

  applyPowerup(powerup) {
    switch (powerup.effect) {
      case 'heal':
        this.player.heal(powerup.value);
        this.ui.updateHealth(this.player.health, this.player.maxHealth);
        break;
      case 'rapidFire':
        this.player.activateRapidFire(powerup.duration);
        break;
      case 'slowMotion':
        this.enemyManager.activateSlowMotion(powerup.duration);
        break;
      case 'alienShip':
        this.spawnAllyShip();
        break;
    }
  }

  // ── Ally Ship System ──

  spawnAllyShip() {
    const ship = new THREE.Group();

    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x1a3048,
      metalness: 0.78,
      roughness: 0.26,
      emissive: 0x002830,
      emissiveIntensity: 0.32
    });
    const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.76, 0.15, 28, 1), hullMat);
    ship.add(saucer);

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x44ffcc,
      metalness: 0.55,
      roughness: 0.2,
      emissive: 0x00ffaa,
      emissiveIntensity: 0.55
    });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.042, 10, 52), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.04;
    ship.add(rim);

    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xaaeeff,
      metalness: 0.2,
      roughness: 0.06,
      emissive: 0x66ffff,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.74
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
    dome.position.y = 0.08;
    ship.add(dome);

    const innerRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.022, 6, 28),
      new THREE.MeshStandardMaterial({
        color: 0xff00aa,
        emissive: 0xff0088,
        emissiveIntensity: 0.85,
        metalness: 0.35,
        roughness: 0.38
      })
    );
    innerRing.rotation.x = Math.PI / 2;
    innerRing.position.y = 0.02;
    ship.add(innerRing);

    const navColors = [0xff0088, 0x00ff88, 0x8800ff, 0xffff00, 0x00ffff, 0xff6600];
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 6, 5),
        new THREE.MeshStandardMaterial({
          color: navColors[i],
          emissive: navColors[i],
          emissiveIntensity: 0.9,
          metalness: 0.2,
          roughness: 0.35
        })
      );
      dot.position.set(Math.cos(angle) * 0.62, -0.02, Math.sin(angle) * 0.62);
      ship.add(dot);
    }

    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(0.38, 1.55, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x00ffaa,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    beam.position.y = -0.88;
    beam.rotation.x = Math.PI;
    ship.add(beam);

    const engine = new THREE.PointLight(0x00ffcc, 0.62, 16);
    engine.position.y = -0.52;
    ship.add(engine);

    const cockpit = new THREE.PointLight(0xff66ff, 0.38, 9);
    cockpit.position.y = 0.32;
    ship.add(cockpit);

    const dur = this.allyShipDuration;
    ship.userData = {
      spawnTime: performance.now(),
      duration: dur,
      lastShot: 0,
      shotInterval: 400,
      orbitAngle: Math.random() * Math.PI * 2,
      orbitRadius: 4,
      orbitHeight: 3.5,
      orbitSpeed: 1.5,
      rim
    };

    this.scene.add(ship);
    this.allyShips.push(ship);
  }

  updateAllyShips(deltaTime, playerPos) {
    const now = performance.now();

    for (let i = this.allyShips.length - 1; i >= 0; i--) {
      const ship = this.allyShips[i];
      const data = ship.userData;

      if (now - data.spawnTime > data.duration) {
        this.scene.remove(ship);
        ship.traverse(c => {
          if (c.isMesh) {
            c.geometry?.dispose();
            if (c.material && !Array.isArray(c.material)) c.material.dispose();
            else if (Array.isArray(c.material)) c.material.forEach(m => m.dispose?.());
          }
          if (c.isLight) c.dispose?.();
        });
        this.allyShips.splice(i, 1);
        continue;
      }

      data.orbitAngle += data.orbitSpeed * deltaTime;
      ship.position.set(
        playerPos.x + Math.cos(data.orbitAngle) * data.orbitRadius,
        data.orbitHeight + Math.sin(now * 0.002) * 0.3,
        playerPos.z + Math.sin(data.orbitAngle) * data.orbitRadius
      );
      ship.rotation.y += deltaTime * 2;
      if (data.rim) {
        const pulse = 1 + Math.sin(now * 0.0035) * 0.05;
        data.rim.scale.setScalar(pulse);
      }

      let nearest = null;
      let nearestDist = 30;
      for (const enemy of this.enemyManager.enemies) {
        if (enemy.userData.isDead) continue;
        const edx = enemy.position.x - ship.position.x;
        const edz = enemy.position.z - ship.position.z;
        const d = Math.sqrt(edx * edx + edz * edz);
        if (d < nearestDist) { nearest = enemy; nearestDist = d; }
      }

      if (nearest && now - data.lastShot > data.shotInterval) {
        data.lastShot = now;
        this.allyShipFire(ship, nearest);
      }
    }

    for (let i = this.allyProjectiles.length - 1; i >= 0; i--) {
      const proj = this.allyProjectiles[i];
      const v = proj.userData.velocity;
      proj.position.x += v.x * deltaTime;
      proj.position.y += v.y * deltaTime;
      proj.position.z += v.z * deltaTime;
      proj.rotation.x += deltaTime * 11;
      proj.rotation.y += deltaTime * 8;
      proj.userData.life -= deltaTime;

      if (proj.userData.life <= 0) {
        this.scene.remove(proj);
        if (!proj.userData.sharedBoltMat) proj.material?.dispose();
        this.allyProjectiles.splice(i, 1);
        continue;
      }

      for (const enemy of this.enemyManager.enemies) {
        if (enemy.userData.isDead) continue;
        const edx = proj.position.x - enemy.position.x;
        const edz = proj.position.z - enemy.position.z;
        if (Math.sqrt(edx * edx + edz * edz) < 1.2) {
          this.damageDealt += proj.userData.damage;
          this.enemyManager.damageEnemy(enemy, proj.userData.damage);
          this.scene.remove(proj);
          if (!proj.userData.sharedBoltMat) proj.material?.dispose();
          this.allyProjectiles.splice(i, 1);
          break;
        }
      }
    }
  }

  allyShipFire(ship, target) {
    if (this.allyProjectiles.length >= 10) return;
    const dir = new THREE.Vector3().subVectors(target.position, ship.position).normalize();
    const proj = new THREE.Mesh(this.allyBoltGeo, this.allyBoltMat);
    proj.position.copy(ship.position);
    proj.userData = {
      velocity: dir.multiplyScalar(18),
      life: 2,
      damage: 15,
      sharedBoltMat: true
    };
    this.scene.add(proj);
    this.allyProjectiles.push(proj);
  }

  clearAllyShips() {
    for (const ship of this.allyShips) {
      this.scene.remove(ship);
      ship.traverse(c => {
        if (c.isMesh) { c.geometry?.dispose(); c.material?.dispose(); }
      });
    }
    this.allyShips = [];
    for (const p of this.allyProjectiles) {
      this.scene.remove(p);
    }
    this.allyProjectiles = [];
  }

  // ── Level Effects (per-frame) ──

  updateLevelEffects(deltaTime, playerPos) {
    if (!this.currentLevelEffect) return;
    const fx = this.currentLevelEffect;

    if (fx.type === 'poisonDOT') {
      this.poisonTickTime += deltaTime * 1000;
      if (this.poisonTickTime >= fx.interval) {
        this.poisonTickTime = 0;
        for (const enemy of this.enemyManager.enemies) {
          if (!enemy.userData.isDead) {
            this.enemyManager.damageEnemy(enemy, fx.value);
            this.damageDealt += fx.value;
          }
        }
      }
    }

    if (fx.type === 'enemySlow') {
      for (const enemy of this.enemyManager.enemies) {
        if (!enemy.userData.isDead && !enemy.userData._levelSlowed) {
          enemy.userData._levelSlowed = true;
          enemy.userData.type = { ...enemy.userData.type, speed: enemy.userData.type.speed * fx.value };
        }
      }
    }

    if (fx.type === 'chaosMode') {
      for (const enemy of this.enemyManager.enemies) {
        if (!enemy.userData.isDead && !enemy.userData._chaosBoosted) {
          enemy.userData._chaosBoosted = true;
          enemy.userData.type = { ...enemy.userData.type, damage: Math.round(enemy.userData.type.damage * fx.enemyDmg) };
        }
      }
    }
  }

  handleArenaTraps(playerPos) {
    if (this.specialAttackActive) return;
    if (this.waveManager?.combatHoldActive) return;
    if (!this.arena || !this.isRunning) return;
    const now = performance.now();
    const dmg = this.arena.pollTrapDamage(playerPos.x, playerPos.z, playerPos.y, now);
    if (dmg <= 0) return;
    this.player.takeDamage(dmg);
    this.ui.updateHealth(this.player.health, this.player.maxHealth);
    this.screenShake = Math.min(this.screenShake + 0.35, 1);
  }

  handleEnemyDamage(playerPos) {
    if (this.specialAttackActive) return;
    if (this.waveManager?.combatHoldActive) return;
    const now = performance.now();
    const px = playerPos.x, pz = playerPos.z;
    let tookDamage = false;

    for (const enemy of this.enemyManager.enemies) {
      if (enemy.userData.isDead) continue;
      const ex = enemy.position.x, ez = enemy.position.z;
      const dist = Math.sqrt((ex - px) ** 2 + (ez - pz) ** 2);
      if (dist < 2.0) {
        const lastAttack = enemy.userData.lastAttackTime || 0;
        if (now - lastAttack > 800) {
          const type = enemy.userData.type;
          const damage = type.diveDamage ?? type.jumpDamage ?? type.damage;
          this.player.takeDamage(damage);
          enemy.userData.lastAttackTime = now;
          this.ui.updateHealth(this.player.health, this.player.maxHealth);
          tookDamage = true;
        }
      }
    }

    const projs = this.enemyManager.getEnemyProjectiles();
    for (let j = 0; j < projs.length; j++) {
      const proj = projs[j];
      const pdx = proj.position.x - playerPos.x, pdz = proj.position.z - playerPos.z;
      if (Math.sqrt(pdx * pdx + pdz * pdz) < 1.2) {
        this.player.takeDamage(proj.userData.damage);
        this.ui.updateHealth(this.player.health, this.player.maxHealth);
        proj.userData.life = 0;
        tookDamage = true;
      }
    }

    if (tookDamage) {
      this.screenShake = Math.min(this.screenShake + 0.4, 1.0);
    }
  }

  updatePowerupUI() {
    const now = performance.now();
    this.ui.updatePowerup('rapidFire', this.player.rapidFire ? this.player.rapidFireEndTime - now : 0);
    this.ui.updatePowerup('slowMotion', this.enemyManager.slowMotion ? this.enemyManager.slowMotionEndTime - now : 0);

    let shipTime = 0;
    if (this.allyShips.length > 0) {
      const s = this.allyShips[0];
      shipTime = Math.max(0, s.userData.duration - (now - s.userData.spawnTime));
    }
    this.ui.updatePowerup('alienShip', shipTime);
  }

  getPlayerYaw() {
    if (this.player.isMobile) return this.player.cameraYaw;
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    euler.setFromQuaternion(this.camera.quaternion);
    return euler.y;
  }

  trySpecialAttack() {
    const now = performance.now();
    if (!this.isRunning || this.player.isDead || this.specialAttackActive) return;
    if (!this.specialReady || !this.specialAttack?.canStart()) {
      if (now - this._lastSpecialRejectMs < 320) return;
      this._lastSpecialRejectMs = now;
      return;
    }
    this._lastSpecialRejectMs = 0;

    this.specialReady = false;
    this.specialCharge = 0;
    this.ui.setSpecialReady(false);
    this.ui.updateSpecialCharge(0, SPECIAL_CHARGE_KILLS);

    this.specialAttackActive = true;
    this.player.inputFrozen = true;
    this.weapon.isHolding = false;
    if (!this.isMobile && document.pointerLockElement) {
      document.exitPointerLock();
    }
    this.player.controls.unlock();

    const yaw = this.getPlayerYaw();
    this.specialAttack.start(yaw, this.enemyManager, {
      onDamage: (amt) => {
        this.damageDealt += amt;
      },
      onEnd: () => {
        this.specialAttackActive = false;
        this.player.inputFrozen = false;
        this.screenShake = Math.min(this.screenShake + 0.4, 1.1);
        if (this.isRunning && !this.player.isDead) {
          if (this.isMobile) {
            this.player.controls.lock();
            document.getElementById('mobile-controls')?.style.setProperty('display', 'block');
          } else {
            this.player.controls.lock();
          }
        }
      }
    });
  }

  beginDeathSequence() {
    if (this.deathSequenceActive) return;
    if (this.specialAttackActive) {
      this.specialAttack.stop();
      this.specialAttackActive = false;
      this.player.inputFrozen = false;
    }
    this.waveClear?.stop(false);
    this.isRunning = false;
    this.deathSequenceActive = true;

    this.clearAllyShips();
    if (this.isMobile) {
      document.getElementById('mobile-controls')?.style.setProperty('display', 'none');
    }
    document.getElementById('hud-touch-layer')?.style.setProperty('display', 'none');
    document.getElementById('hud')?.style.setProperty('display', 'none');

    const yaw = this.getPlayerYaw();

    this.deathScene.clock.start();
    this.deathScene.clock.getDelta();

    this.deathScene.start(this.renderer, this.camera.aspect, yaw, () => {
      this.deathSequenceActive = false;
      if (this.scene.background instanceof THREE.Color) {
        this.renderer.setClearColor(this.scene.background, 1);
      } else {
        this.renderer.setClearColor(0x000000, 1);
      }
      this.showGameOverAfterDeath();
    });

    requestAnimationFrame(() => this.animateDeath());
  }

  showGameOverAfterDeath() {
    if (this.isMobile) {
      document.getElementById('mobile-controls')?.style.setProperty('display', 'none');
    }
    this.ui.showGameOver({
      wave: this.waveManager.currentWave,
      score: this.score,
      coins: this.coins,
      kills: this.kills,
      damageDealt: this.damageDealt
    }, () => this.restartRun());
  }

  animateDeath() {
    if (!this.deathSequenceActive) return;
    requestAnimationFrame(() => this.animateDeath());
    const delta = Math.min(this.deathScene.clock.getDelta(), 0.08);
    this.deathScene.update(this.renderer, delta);
  }

  animate() {
    if (this._glContextLost) return;

    if (this.isRunning && this.waveClear?.active) {
      requestAnimationFrame(() => this.animate());
      try {
        this._syncMobileAutofireFlag();
        const delta = Math.min(this.clock.getDelta(), this.perf.frameDeltaCap);
        const playerPos = this.player.getPosition();
        this.physicsWorld.update(delta);
        this.player.update(delta);
        this.updateAllyShips(delta, playerPos);
        this.waveClear.update(delta);
        this.renderer.render(this.scene, this.camera);
      } catch (err) {
        console.warn('[KOL BASH] frame (wave clear)', err);
      }
      return;
    }

    if (!this.isRunning) return;

    requestAnimationFrame(() => this.animate());

    try {
      this._syncMobileAutofireFlag();
      const delta = Math.min(this.clock.getDelta(), this.perf.frameDeltaCap);
      const playerPos = this.player.getPosition();

      this.physicsWorld.update(delta);
      this.player.update(delta);

      if (this.specialAttackActive) {
        this.specialAttack.update(delta, this.player, this.camera);
        this.weapon.update(delta);
        if (this.arena) this.arena.update(delta);
        this.enemyManager.update(delta, playerPos);
        this.itemManager.update(delta, playerPos);
        this.handleItemPickups(playerPos);
        this.waveManager.update(delta, playerPos);
        this.updateAllyShips(delta, playerPos);
        this.updateLevelEffects(delta, playerPos);

        if (this._uiTick === undefined) this._uiTick = 0;
        this._uiTick++;
        if (this._uiTick % 3 === 0) {
          this.updatePowerupUI();
          this.ui.updateStats(this.kills, this.damageDealt);
        }

        this.renderer.render(this.scene, this.camera);
        return;
      }

      this.weapon.update(delta);
      if (this.arena) this.arena.update(delta);
      this.handleShooting(playerPos);
      this.enemyManager.update(delta, playerPos);
      this.handleEnemyDamage(playerPos);
      this.handleArenaTraps(playerPos);
      this.itemManager.update(delta, playerPos);
      this.handleItemPickups(playerPos);
      this.waveManager.update(delta, playerPos);
      this.updateAllyShips(delta, playerPos);
      this.updateLevelEffects(delta, playerPos);

      if (this.screenShake > 0.01) {
        this.camera.position.x += (Math.random() - 0.5) * this.screenShake * 0.15;
        this.camera.position.y += (Math.random() - 0.5) * this.screenShake * 0.08;
        this.screenShake *= 0.82;
      } else {
        this.screenShake = 0;
      }

      if (this._uiTick === undefined) this._uiTick = 0;
      this._uiTick++;
      if (this._uiTick % 3 === 0) {
        this.updatePowerupUI();
        this.ui.updateCrosshair(this.weapon);
        this.ui.updateStats(this.kills, this.damageDealt);
      }

      this.renderer.render(this.scene, this.camera);
    } catch (err) {
      console.warn('[KOL BASH] frame', err);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  game.init().catch(err => console.error(err));
});
