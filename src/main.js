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
import { WaveManager, BOSS_TRIGGER_AFTER_WAVE } from './waves.js';
import { BossEncounter } from './boss-encounter.js';
import { UIManager, STORE_ITEMS } from './ui.js';
import { Arena, LEVELS } from './arena.js';
import { DeathScene } from './death-scene.js';
import { DareBackupDancers } from './dare-backup-dancers.js';
import { SpecialAttackController, SPECIAL_CHARGE_KILLS, DEFAULT_SPECIAL_MODEL } from './special-attack.js';
import { GameMusic } from './game-music.js';
import { WaveClearCinematic } from './wave-clear-cinematic.js';
import { resumeSharedAudioContext } from './shared-audio.js';
import { attachMobileDebug } from './mobile-debug.js';
import { CharacterSelectController } from './character-select.js';
import { CharacterProfilePreview } from './character-profile-preview.js';
import { firstPlayableCharacterId, getCharacter, getFinaleBossIntroClip } from './characters.js';

// #region agent log
/** Off by default — agent logging does two fetch() + sessionStorage per event (bad on mobile WebKit). Enable with ?agentdebug=1 or localStorage kolbash_debug_agent=1 */
function _agentLogEnabled() {
  try {
    if (typeof window === 'undefined' || !window.location) return false;
    const q = new URLSearchParams(window.location.search);
    if (q.get('agentdebug') === '1') return true;
    return window.localStorage?.getItem('kolbash_debug_agent') === '1';
  } catch (e) {
    return false;
  }
}
function _agentIngestUrl() {
  try {
    const h = typeof window !== 'undefined' && window.location?.hostname;
    if (h && h !== '127.0.0.1' && h !== 'localhost') {
      return `http://${h}:7334/ingest/ba5b9fd7-2887-44ab-9059-b67c504f3752`;
    }
  } catch (e) {}
  return 'http://127.0.0.1:7334/ingest/ba5b9fd7-2887-44ab-9059-b67c504f3752';
}
function _agentLog(location, message, data, hypothesisId, runId) {
  if (!_agentLogEnabled()) return;
  const payload = {
    sessionId: '8b5196',
    location,
    message,
    data: data || {},
    timestamp: Date.now(),
    hypothesisId: hypothesisId || '',
    runId: runId || 'pre'
  };
  try {
    const key = 'kolbash_agent_debug_8b5196';
    const raw = sessionStorage.getItem(key);
    let arr = [];
    try {
      const o = JSON.parse(raw || '[]');
      if (Array.isArray(o)) arr = o;
    } catch (e2) {}
    arr.push(payload);
    while (arr.length > 120) arr.shift();
    sessionStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {}
  const line = JSON.stringify(payload);
  // Same-origin: Vite middleware writes workspace debug-8b5196.log (works from phone on LAN).
  fetch('/__agent-debug', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '8b5196' },
    body: line
  }).catch(() => {});
  fetch(_agentIngestUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '8b5196' },
    body: line
  }).catch(() => {});
}
// #endregion

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

    this.perf = this._buildPerfProfile();

    this.currentLevelEffect = null;
    this.poisonTickTime = 0;

    this.allyShips = [];
    this.allyProjectiles = [];
    /** Shared GPU assets; ships are `clone(true)` — do not dispose per ship. */
    this._allyShipTemplate = null;
    this.allyBoltGeo = null;
    this.allyBoltMat = null;
    /** Recycled meshes for ally shots — avoids `new Mesh` per bolt (GC on mobile). */
    this._allyBoltPool = [];
    this._allyDirScratch = new THREE.Vector3();
    /** Desktop yaw from quaternion without allocating each aim/special. */
    this._yawEulerScratch = new THREE.Euler(0, 0, 0, 'YXZ');
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
    /** Incremented on restart so in-flight countdown async cannot release the wrong wave. */
    this._waveCountdownSerial = 0;
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
    /** @type {{ yaw: number; callbacks: object } | null} — flushed at start of `animate()` so special never starts mid–rAF stack. */
    this._pendingSpecialStart = null;
    /** @type {ReturnType<typeof attachMobileDebug>} */
    this._mobileDbg = null;

    /** Mobile: coalesce rapid orientation/address-bar resize to avoid GL buffer realloc storms. */
    this._resizeDebounceT = null;
    this._lastResizeW = -1;
    this._lastResizeH = -1;
    this._lastResizePR = -1;

    /** Title-screen roster choice; cinematics will follow this id when extra fighters ship. */
    this.selectedCharacterId = firstPlayableCharacterId();
    /** @type {CharacterSelectController | null} */
    this._characterSelect = null;
    /** @type {CharacterProfilePreview | null} */
    this.profilePreview = null;
    /** Which fighter's death / wave-clear / dare FBX set is currently resident in GPU caches. */
    this._cinematicReadyForId = null;
    /** @type {Promise<void> | null} */
    this._cinematicEnsurePromise = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this._cinematicEnsureDebounce = null;

    /** After clearing wave `BOSS_TRIGGER_AFTER_WAVE` (see waves.js), countdown starts the finale boss. */
    this._pendingBossAfterDare = false;
    /** @type {BossEncounter | null} */
    this.bossEncounter = null;

    /** Desktop: ESC/P pause overlay */
    this.pauseMenuActive = false;
    this._pauseSavedInputFrozen = false;
    /** @type {((e: KeyboardEvent) => void) | null} */
    this._boundDesktopKeydown = null;
  }

  isCinematicReadyForSelection() {
    const ch = getCharacter(this.selectedCharacterId);
    if (!ch.playable || !ch.cinematic) return true;
    return this._cinematicReadyForId === this.selectedCharacterId;
  }

  scheduleCinematicPreloadForSelection() {
    if (this._cinematicEnsureDebounce) clearTimeout(this._cinematicEnsureDebounce);
    this._cinematicEnsureDebounce = setTimeout(() => {
      this._cinematicEnsureDebounce = null;
      void this.ensureCinematicsForSelection();
    }, 70);
  }

  /**
   * Loads only the selected fighter's death, wave-clear, and dare-hero FBX (purges the previous fighter's clips).
   */
  async ensureCinematicsForSelection() {
    const targetId = this.selectedCharacterId;
    const ch = getCharacter(targetId);

    if (!ch.playable || !ch.cinematic) {
      this._cinematicReadyForId = targetId;
      this._characterSelect?.refreshStartButton();
      return;
    }

    if (this._cinematicReadyForId === targetId) {
      this._characterSelect?.refreshStartButton();
      return;
    }

    if (this._cinematicEnsurePromise) {
      try {
        await this._cinematicEnsurePromise;
      } catch (e) {}
      if (this._cinematicReadyForId === targetId) {
        this._characterSelect?.refreshStartButton();
        return;
      }
    }

    this._characterSelect?.refreshStartButton();

    const c = ch.cinematic;
    this._cinematicEnsurePromise = (async () => {
      try {
        await this.deathScene.setModelPath(c.deathModel);
        await this.deathScene.preload().catch(() => {});
        this.waveClear.setWavePaths(c.waveClearModels);
        await this.waveClear.preload(this.isMobile ? { serial: true } : {}).catch(() => {});
        this.dareDancers.setHeroPath(c.dareHeroModel);
        await this.dareDancers.preload(this.isMobile ? { serial: true } : {}).catch(() => {});
        const sp = ch.specialAttackModel || DEFAULT_SPECIAL_MODEL;
        await this.specialAttack.setModelPath(sp);
        await this.specialAttack.preload().catch(() => {});
        if (this.selectedCharacterId === targetId) {
          this._cinematicReadyForId = targetId;
        } else {
          void this.ensureCinematicsForSelection();
        }
      } catch (e) {
        console.warn('ensureCinematicsForSelection failed', e);
        if (this.selectedCharacterId === targetId) this._cinematicReadyForId = null;
      } finally {
        this._cinematicEnsurePromise = null;
        this._characterSelect?.refreshStartButton();
      }
    })();

    await this._cinematicEnsurePromise;
  }

  _buildPerfProfile() {
    const m = this.isMobile;
    const low = this.isLowTierMobile;
    return {
      /** iOS WebKit: DPR>1 multiplies VRAM ~×4 per step — keep draw buffer tiny on phones. */
      maxPixelRatio: m ? 1 : Math.min(1.75, window.devicePixelRatio || 1),
      /** Prefer integrated/low-power GPU path on phones to reduce driver OOM / context loss. */
      powerPreference: m ? 'low-power' : 'high-performance',
      /**
       * Procedural arena CanvasTextures (see arena.js). Keep ≤512 on phone GPUs; FBX maps in /public/models
       * must be re-exported small in Blender — Three does not downscale embedded textures automatically.
       */
      floorTextureSize: m ? 256 : 1024,
      wallDecalWidth: m ? 224 : 512,
      wallDecalHeight: m ? 112 : 256,
      floorAnisotropy: m ? 1 : 12,
      maxPlayerProjectiles: m ? (low ? 4 : 5) : 34,
      maxEnemyProjectiles: m ? 2 : 10,
      /** Fewer simultaneous skinned rigs = fewer mixers + GPU skinning passes (WebKit tab survival). */
      maxEnemiesPerWave: m ? 3 : 16,
      cylinderSegments: m ? (low ? 4 : 5) : 8,
      /** Mobile: 2 warmed clones/type after serial load — enough variety without VRAM like desktop×3. */
      poolClonesPerModel: m ? 1 : 3,
      maxShootersPerWave: m ? 1 : 3,
      maxCoinsAlive: m ? (low ? 12 : 14) : 110,
      maxPowerupsAlive: m ? 2 : 10,
      allyBoltGeometryDetail: m ? 0 : 1,
      frameDeltaCap: m ? 0.048 : 0.06,
      /** Fewer GPU particles for disco special (mobile). */
      specialMaxOrbs: m ? (low ? 6 : 10) : 90
    };
  }

  _showFatalError(message) {
    const wrap = document.getElementById('fatal-error');
    const msg = document.getElementById('fatal-error-msg');
    if (msg) msg.textContent = String(message || 'Unknown error');
    if (wrap) wrap.style.display = 'block';
    try {
      document.getElementById('loading-screen')?.style.setProperty('display', 'none');
    } catch (e) {}
    try {
      document.getElementById('start-screen')?.style.setProperty('display', 'none');
    } catch (e) {}
  }

  async init() {
    this.ui = new UIManager();
    this.ui.showLoading();
    this.ui.updateLoadingProgress('Booting renderer…');

    await new Promise(r => requestAnimationFrame(r));

    try {
      this.createScene();
    } catch (err) {
      console.error(err);
      this._showFatalError(err?.message || err);
      return;
    }
    try {
    this.gameMusic.setStateChangeHandler(() => this.ui.syncMusicButton?.());
    this.ui.bindMusic(this.gameMusic);
    this.ui.updateLoadingProgress('Physics & arena…');
    this.createPhysics();
    this.createPlayer();
    this.createWeapon();
    this.createArena();
    this.createManagers();
    this.setupEventListeners();

    this._mobileDbg = attachMobileDebug({ getGame: () => this });
    this._mobileDbg?.mark('INIT', 'createManagers done');

    this.ui.onSpecialActivate = () => this.trySpecialAttack();

    try {
      this.ui.updateLoadingProgress('Loading character models…');
      await this.preloadModels((done, total) => {
        this.ui.updateLoadingProgress(`Models ${done} / ${total}`);
      });
      if (this.isMobile) await new Promise((r) => requestAnimationFrame(r));
      this.ui.updateLoadingProgress('Warming enemy pool…');
      {
        const warmTarget = this.isMobile ? this.enemyManager.poolReplenishTo : this.perf.poolClonesPerModel;
        this.enemyManager.warmPool(warmTarget);
      }
      if (!this.isMobile) {
        this.ui.updateLoadingProgress('Pre-compiling shaders…');
        this.enemyManager.prewarmSkinnedMaterials(this.renderer, this.camera);
      }
      this.ui.updateLoadingProgress('Baking arena visuals…');
      if (!this.isMobile) {
        await this.arena.prebakeLevelTexturesAsync();
      }
      this.ui.updateLoadingProgress('Starting…');
      await this.ensureCinematicsForSelection();
      if (this.isMobile) await new Promise((r) => requestAnimationFrame(r));
    } catch (e) {
      console.warn('Model loading issue:', e);
    }

    this.modelsReady = true;
    // #region agent log
    _agentLog(
      'main.js:init',
      'boot_complete',
      {
        isMobile: this.isMobile,
        isLowTierMobile: this.isLowTierMobile,
        maxPixelRatio: this.perf?.maxPixelRatio,
        floorTextureSize: this.perf?.floorTextureSize,
        glLost: this._glContextLost
      },
      'F',
      'pre'
    );
    // #endregion
    this.ui.showStartScreen();
    this._characterSelect?.refreshStartButton();
    this._characterSelect?.relayout();

    if (this.isMobile) {
      document.getElementById('mobile-controls')?.style.setProperty('display', 'block');
    }
    } catch (bootErr) {
      console.error(bootErr);
      this._showFatalError(bootErr?.message || bootErr);
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
      precision: this.isMobile ? 'mediump' : 'highp',
      stencil: false,
      alpha: false,
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPR));
    const gl = this.renderer.getContext();
    if (!gl) {
      throw new Error('WebGL is not available (blocked GPU or unsupported browser).');
    }
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
    if (this.isMobile) {
      this.renderer.sortObjects = false;
    }

    const canvas = this.renderer.domElement;
    canvas.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault();
        // #region agent log
        _agentLog(
          'main.js:webglcontextlost',
          'context_lost',
          { statusMessage: e.statusMessage || '' },
          'A',
          'pre'
        );
        // #endregion
        this._glContextLost = true;
        this.isRunning = false;
        this.clock.stop();
        this._mobileDbg?.mark('WEBGL_CONTEXT_LOST', 'stopping loop');
        if (this.weapon) {
          this.weapon.isHolding = false;
          this.weapon.mobileAutoFireActive = false;
        }
        try {
          this.specialAttack?.stop();
          this.specialAttackActive = false;
        } catch (err) {}
      },
      false
    );
    canvas.addEventListener(
      'webglcontextrestored',
      () => {
        // #region agent log
        _agentLog('main.js:webglcontextrestored', 'context_restored', {}, 'A', 'pre');
        // #endregion
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

    this.deathScene = new DeathScene({ deferSkinned: this.isMobile });
    this.dareDancers = new DareBackupDancers({ useWebGlRenderer: !this.isMobile });
    this.specialAttack = new SpecialAttackController(this.scene, {
      maxOrbs: this.perf.specialMaxOrbs ?? (this.isMobile ? 12 : 90),
      lightMode: this.isMobile,
      lowTierSpecial: this.isLowTierMobile
    });
    this.gameMusic = new GameMusic();
    this.waveClear = new WaveClearCinematic(this.scene, this.camera, { deferSkinned: this.isMobile });
    this._buildAllyShipTemplate();
  }

  /**
   * One-time ally UFO mesh graph: shared geometries/materials, no per-ship PointLights
   * (mobile WebGL: dynamic lights + dispose loops fragment VRAM / risk context loss).
   */
  _buildAllyShipTemplate() {
    if (this._allyShipTemplate) return;
    const ship = new THREE.Group();
    const low = this.isLowTierMobile;
    const hullSeg = this.isMobile ? (low ? 10 : 16) : 28;
    const rimT = this.isMobile ? (low ? 6 : 8) : 10;
    const rimP = this.isMobile ? (low ? 20 : 32) : 52;
    const domeSeg = this.isMobile ? (low ? 10 : 14) : 18;
    const domeRings = this.isMobile ? (low ? 8 : 10) : 12;
    const innerT = this.isMobile ? (low ? 4 : 5) : 6;
    const innerP = this.isMobile ? (low ? 16 : 22) : 28;
    const navCount = this.isMobile ? (low ? 3 : 4) : 6;
    const beamSeg = this.isMobile ? (low ? 6 : 8) : 10;
    const glowSeg = this.isMobile ? (low ? 6 : 6) : 8;
    const glowRings = this.isMobile ? (low ? 4 : 5) : 6;

    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x1a3048,
      metalness: 0.78,
      roughness: 0.26,
      emissive: 0x003840,
      emissiveIntensity: this.isMobile ? 0.55 : 0.32
    });
    const hullGeo = new THREE.CylinderGeometry(0.52, 0.76, 0.15, hullSeg, 1);
    ship.add(new THREE.Mesh(hullGeo, hullMat));

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x44ffcc,
      metalness: 0.55,
      roughness: 0.2,
      emissive: 0x00ffaa,
      emissiveIntensity: this.isMobile ? 0.72 : 0.55
    });
    const rimGeo = new THREE.TorusGeometry(0.66, 0.042, rimT, rimP);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.name = 'allyRim';
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
    const domeGeo = new THREE.SphereGeometry(0.34, domeSeg, domeRings, 0, Math.PI * 2, 0, Math.PI / 2);
    const dome = new THREE.Mesh(domeGeo, glassMat);
    dome.position.y = 0.08;
    ship.add(dome);

    const innerRingGeo = new THREE.TorusGeometry(0.2, 0.022, innerT, innerP);
    const innerRingMat = new THREE.MeshStandardMaterial({
      color: 0xff00aa,
      emissive: 0xff0088,
      emissiveIntensity: 0.85,
      metalness: 0.35,
      roughness: 0.38
    });
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRing.rotation.x = Math.PI / 2;
    innerRing.position.y = 0.02;
    ship.add(innerRing);

    const navColors = [0xff0088, 0x00ff88, 0x8800ff, 0xffff00, 0x00ffff, 0xff6600];
    const navDotGeo = new THREE.SphereGeometry(0.045, this.isMobile ? 5 : 6, this.isMobile ? 4 : 5);
    for (let i = 0; i < navCount; i++) {
      const angle = (i / navCount) * Math.PI * 2;
      const dotMat = new THREE.MeshStandardMaterial({
        color: navColors[i],
        emissive: navColors[i],
        emissiveIntensity: 0.9,
        metalness: 0.2,
        roughness: 0.35
      });
      const dot = new THREE.Mesh(navDotGeo, dotMat);
      dot.position.set(Math.cos(angle) * 0.62, -0.02, Math.sin(angle) * 0.62);
      ship.add(dot);
    }

    const beamGeo = new THREE.ConeGeometry(0.38, 1.55, beamSeg, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x00ffaa,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = -0.88;
    beam.rotation.x = Math.PI;
    ship.add(beam);

    const glowGeo = new THREE.SphereGeometry(0.14, glowSeg, glowRings);
    const engineGlowMat = new THREE.MeshBasicMaterial({
      color: 0x00ffcc,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const engineGlow = new THREE.Mesh(glowGeo, engineGlowMat);
    engineGlow.position.y = -0.52;
    ship.add(engineGlow);

    const cockpitGlowMat = new THREE.MeshBasicMaterial({
      color: 0xff66ff,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const cockpitGlow = new THREE.Mesh(glowGeo, cockpitGlowMat);
    cockpitGlow.position.set(0, 0.32, 0);
    cockpitGlow.scale.setScalar(0.65);
    ship.add(cockpitGlow);

    this._allyShipTemplate = ship;
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
    this.weapon = new Weapon(this.camera, this.scene, {
      maxProjectiles: this.perf.maxPlayerProjectiles,
      mobileSimplifyProjectiles: this.isMobile
    });
  }

  createArena() {
    this.arena = new Arena(this.scene, this.physicsWorld, {
      floorTextureSize: this.perf.floorTextureSize,
      wallDecalWidth: this.perf.wallDecalWidth,
      wallDecalHeight: this.perf.wallDecalHeight,
      floorAnisotropy: this.perf.floorAnisotropy,
      liteMobileVisuals: this.isMobile,
      ultraLiteSky: this.isMobile,
      staggerPrebakeFrames: this.isMobile ? 3 : 1,
      /** Low-tier: live floor/walls only — no eviction of baked levels (none used). */
      evictRemoteTexturesOnMobile: false,
      /** All phones: skip huge prebaked canvas atlases — lower VRAM spikes when changing floors. */
      liveLevelTexturesOnly: this.isMobile,
      /** Hazards = dozens of extra meshes + materials per floor; skip on mobile. */
      disableHazardMeshes: this.isMobile
    });
  }

  createManagers() {
    this.enemyManager = new EnemyManager(this.scene, this.physicsWorld, {
      maxEnemyProjectiles: this.perf.maxEnemyProjectiles,
      maxShootersPerWave: this.perf.maxShootersPerWave,
      /** One warmed clone per enemy FBX on phones — extras use cheap fallback (stable VRAM). */
      poolReplenishTo: this.isMobile ? 1 : Math.max(2, this.perf.poolClonesPerModel + 1),
      /** Never clone skinned FBX during combat on phones — pool + cheap fallback only. */
      preferPoolOnly: this.isMobile,
      /** Halves AnimationMixer CPU on phones (staggered 2× delta when sampled). */
      mixerHalfRateMobile: this.isMobile
    });
    this.enemyManager.onEnemyDeath = (enemy) => this.onEnemyKilled(enemy);

    this.itemManager = new ItemManager(this.scene, {
      maxCoinsAlive: this.perf.maxCoinsAlive,
      maxPowerupsAlive: this.perf.maxPowerupsAlive,
      singlePowerupRing: this.isMobile
    });

    this.waveManager = new WaveManager(this.enemyManager, {
      maxEnemiesPerWave: this.perf.maxEnemiesPerWave,
      hasActivePlayerProjectiles: () => this.weapon.hasActiveProjectiles(),
      ...(this.isMobile
        ? { spawnDelay: 520, earlySpawnDelay: 420, lateSpawnDelay: 560 }
        : {})
    });
    this.waveManager.setPlayerCamera(this.camera);
    this.enemyManager.setWaveManager(this.waveManager);

    this.bossEncounter = new BossEncounter(this.scene, this.enemyManager, { isMobile: this.isMobile });
    this.bossEncounter.onVictory = () => {
      this.gameMusic?.leaveBossFight();
      this.ui.clearBossEncounterHud();
      this.ui.updateWave(BOSS_TRIGGER_AFTER_WAVE);
      this.bossEncounter.reset();
      this.showVictory();
    };
    this.bossEncounter.onUiUpdate = (payload) => this.ui.setBossEncounterHud(payload);

    this.waveManager.onWaveStart = (wave, taunt, levelChanged) => {
      this.ui.updateWave(wave);
      const levelName = this.arena.getLevelName();
      const finalTaunt = wave === BOSS_TRIGGER_AFTER_WAVE ? 'FINAL WAVE — END THE DISCO' : taunt;
      this.ui.showWaveAnnouncement(wave, finalTaunt, levelName, levelChanged);
      this.ui.updateLevelName(levelName);
    };

    this.waveManager.onLevelChange = (levelIndex) => {
      if (this.isMobile && !this.arena.liveLevelTexturesOnly) {
        this.arena.ensureLevelTexturesReadySync(levelIndex);
      }
      const level = this.arena.setLevel(levelIndex);
      if (this.isMobile && !this.arena.liveLevelTexturesOnly) {
        this.arena.evictRemoteLevelTextures(levelIndex);
      }
      this._mobileDbg?.mark('LEVEL_CHANGE', String(levelIndex));
      if (this.discoLight) this.discoLight.color.set(level.neon);
      this.applyLevelEffect(level);
      this.triggerLevelFlash();
    };

    this.waveManager.onWaveComplete = (wave) => {
      this.score += wave * 100;
      this.ui.updateScore(this.score);
      if (this.isMobile) {
        const drainPool = () => {
          // Must NOT gate on isRunning — dare/store sets isRunning false and would abort
          // after one clone, leaving pools empty for the next wave (wave 4+ crash pattern).
          if (!this.modelsReady || !this.enemyManager) return;
          if (!this.enemyManager.replenishPoolStep()) return;
          requestAnimationFrame(drainPool);
        };
        requestAnimationFrame(drainPool);
      } else {
        this.enemyManager.replenishPool();
      }
      if (wave === BOSS_TRIGGER_AFTER_WAVE) {
        this._pendingBossAfterDare = true;
      }
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
        if (this.isMobile) {
          await new Promise((r) => requestAnimationFrame(r));
        }
        this.waveClear.start(wave, this.player, yaw, goDare);
      })();
    };
  }

  getBaseDamage() {
    return WEAPON_DEFS[this.currentWeapon]?.damage || 25;
  }

  applyLevelEffect(level) {
    this.currentLevelEffect = level.effect || null;
    if (this.currentLevelEffect && this.isMobile && this.currentLevelEffect.type === 'poisonDOT') {
      this.currentLevelEffect = {
        ...this.currentLevelEffect,
        interval: Math.max(this.currentLevelEffect.interval || 2000, this.isLowTierMobile ? 2800 : 2400)
      };
    }
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
    /** Boss FBX are huge — loaded when the finale starts (`BossEncounter.begin`), not here. */
    const models = [
      '/models/alon_dancing.fbx',
      '/models/slingoor_dance.fbx',
      '/models/pow_dive.fbx',
      '/models/jump_attack.fbx',
      '/models/marcell_dancing.fbx',
      '/models/thriller_part3.fbx'
    ];
    let done = 0;
    const total = models.length;
    const bump = () => {
      done++;
      onProgress?.(done, total);
    };
    /** Parallel FBX decode spikes memory / main thread on iOS — load one file per frame on mobile. */
    if (this.isMobile) {
      for (const path of models) {
        await this.enemyManager.loadFBX(path).catch(() => {});
        bump();
        await new Promise((r) => requestAnimationFrame(r));
      }
      return;
    }
    await Promise.all(
      models.map((path) =>
        this.enemyManager.loadFBX(path).catch(() => {}).finally(bump)
      )
    );
  }

  setupEventListeners() {
    window.addEventListener('error', (ev) => {
      console.warn('[KOL BASH]', ev.error || ev.message);
      // #region agent log
      _agentLog(
        'main.js:window.error',
        'window_error',
        {
          msg: String(ev.message || '').slice(0, 240),
          name: ev.error?.name,
          stack: typeof ev.error?.stack === 'string' ? ev.error.stack.slice(0, 500) : ''
        },
        'B',
        'pre'
      );
      // #endregion
    });
    window.addEventListener('unhandledrejection', (ev) => {
      console.warn('[KOL BASH] unhandled', ev.reason);
      // #region agent log
      const r = ev.reason;
      _agentLog(
        'main.js:unhandledrejection',
        'unhandled_rejection',
        {
          reason: typeof r === 'string' ? r.slice(0, 400) : (r?.message || String(r)).slice(0, 400)
        },
        'B',
        'pre'
      );
      // #endregion
    });

    document.addEventListener('visibilitychange', () => {
      // #region agent log
      _agentLog(
        'main.js:visibilitychange',
        'visibility',
        { hidden: document.hidden, isRunning: this.isRunning, glLost: this._glContextLost },
        'C',
        'pre'
      );
      // #endregion
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

    window.addEventListener('pagehide', (e) => {
      // #region agent log
      _agentLog(
        'main.js:pagehide',
        'pagehide',
        { persisted: !!e.persisted, isRunning: this.isRunning, glLost: this._glContextLost },
        'C',
        'pre'
      );
      // #endregion
    });

    window.addEventListener('resize', () => {
      if (this.isMobile) {
        if (this._resizeDebounceT) clearTimeout(this._resizeDebounceT);
        this._resizeDebounceT = setTimeout(() => {
          this._resizeDebounceT = null;
          this.onWindowResize();
        }, 200);
      } else {
        this.onWindowResize();
      }
    });

    this.profilePreview = new CharacterProfilePreview(document.getElementById('char-profile-preview-mount'));
    this._characterSelect = new CharacterSelectController(this);

    const jumpBtn = document.getElementById('jump-btn');
    if (jumpBtn) {
      let jumpTouchHeld = false;
      const clearJumpHold = (e) => {
        e.preventDefault();
        jumpTouchHeld = false;
      };
      jumpBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (jumpTouchHeld) return;
        jumpTouchHeld = true;
        this.player.pendingJump = true;
      }, { passive: false });
      jumpBtn.addEventListener('touchend', clearJumpHold, { passive: false });
      jumpBtn.addEventListener('touchcancel', clearJumpHold, { passive: false });
    }

    this._setupMobileAutofireToggle();

    this._boundDesktopKeydown = this._handleDesktopGameplayKeydown.bind(this);
    window.addEventListener('keydown', this._boundDesktopKeydown, { capture: true });

    const hudMenuBtn = document.getElementById('hud-menu-btn');
    if (hudMenuBtn) {
      hudMenuBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (this.canOpenPauseMenu()) this.openPauseMenu();
      });
    }
  }

  onWindowResize() {
    const w = Math.max(1, window.innerWidth || 1);
    const h = Math.max(1, window.innerHeight || 1);
    const pr = Math.min(window.devicePixelRatio || 1, this.perf.maxPixelRatio);
    if (w === this._lastResizeW && h === this._lastResizeH && pr === this._lastResizePR) {
      return;
    }
    this._lastResizeW = w;
    this._lastResizeH = h;
    this._lastResizePR = pr;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(pr);
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

  returnToTitle(opts = {}) {
    this.pauseMenuActive = false;
    this.ui.hidePauseMenu();
    this._pendingBossAfterDare = false;
    this.bossEncounter?.reset();
    this.ui.clearBossEncounterHud();
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
    void this.ensureCinematicsForSelection();
    this._characterSelect?.refreshStartButton();
    this._characterSelect?.relayout();
    if (opts.focusCarousel) {
      requestAnimationFrame(() => {
        document.querySelector('.dossier-roster')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }

  canOpenPauseMenu() {
    if (this.isMobile || !this.modelsReady) return false;
    if (this.pauseMenuActive) return false;
    if (!this.isRunning || this.player?.isDead) return false;
    if (this.specialAttackActive || this._pendingSpecialStart) return false;
    if (this._waveCountdownRunning) return false;
    if (this.waveClear?.active) return false;
    return true;
  }

  openPauseMenu() {
    if (!this.canOpenPauseMenu()) return;
    this.pauseMenuActive = true;
    this._pauseSavedInputFrozen = !!this.player?.inputFrozen;
    this.player.inputFrozen = true;
    this.weapon.isHolding = false;
    this.isRunning = false;
    this.clock.stop();
    this._pendingSpecialStart = null;
    if (!this.isMobile && document.pointerLockElement) {
      document.exitPointerLock();
    }
    this.player.controls.unlock();
    this.ui.showPauseMenu(
      () => this.closePauseMenuResume(),
      () => this.quitRunToTitleFromPause()
    );
  }

  closePauseMenuResume() {
    if (!this.pauseMenuActive) return;
    this.pauseMenuActive = false;
    this.ui.hidePauseMenu();
    this.isRunning = true;
    this.player.inputFrozen = this._pauseSavedInputFrozen;
    this.clock.start();
    if (this.isMobile) {
      this.player.controls.lock();
      document.getElementById('mobile-controls')?.style.setProperty('display', 'block');
    } else {
      this.player.controls.lock();
    }
    this.animate();
  }

  quitRunToTitleFromPause() {
    if (!this.pauseMenuActive) return;
    this.pauseMenuActive = false;
    this.ui.hidePauseMenu();
    this._waveCountdownSerial = (this._waveCountdownSerial || 0) + 1;
    this._waveCountdownRunning = false;
    this.ui.hideWaveCountdown();
    this.player.inputFrozen = false;
    this.weapon.isHolding = false;
    this._pendingSpecialStart = null;
    this.specialAttackActive = false;
    this.specialAttack?.stop();
    this.waveClear?.stop(false);
    this.clock.stop();
    this._pendingBossAfterDare = false;
    this.bossEncounter?.reset();
    this.ui.clearBossEncounterHud();
    this.gameMusic?.leaveBossFight();
    if (!this.isMobile && document.pointerLockElement) {
      document.exitPointerLock();
    }
    this.player.controls.unlock();
    this.returnToTitle();
  }

  /** After game-over: back to dossier without starting a new run. */
  leaveRunToTitleFromGameOver(opts = {}) {
    this.player.reset();
    this.player.controls.unlock();
    this.deathSequenceActive = false;
    this.deathScene?.stop?.();
    this.specialAttackActive = false;
    this.specialAttack?.stop();
    this._pendingSpecialStart = null;
    this.waveClear?.stop(false);
    this._waveCountdownSerial = (this._waveCountdownSerial || 0) + 1;
    this._waveCountdownRunning = false;
    this.ui.hideWaveCountdown();
    this.isRunning = false;
    this.clock.stop();
    this._pendingBossAfterDare = false;
    this.bossEncounter?.reset();
    this.ui.clearBossEncounterHud();
    this.gameMusic?.leaveBossFight();
    this.returnToTitle(opts);
  }

  _handleDesktopGameplayKeydown(e) {
    if (!this.isMobile && this.pauseMenuActive) {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (!e.repeat) {
          try {
            e.preventDefault();
          } catch (err) {}
          this.closePauseMenuResume();
        }
        return;
      }
      return;
    }

    if (!this.isMobile && this.canOpenPauseMenu()) {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (!e.repeat) {
          try {
            e.preventDefault();
          } catch (err) {}
          this.openPauseMenu();
        }
        return;
      }
    }

    if (this.isMobile) return;

    if (e.code === 'KeyE' && this.isRunning && !e.repeat) {
      try {
        e.preventDefault();
      } catch (err) {}
      this.trySpecialAttack();
      return;
    }

    if (!this.isRunning) return;

    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 4) {
      const weapons = ['disco', 'gatling', 'laser', 'rocket'];
      const w = weapons[num - 1];
      if (this.unlockedWeapons.includes(w)) {
        this.switchWeapon(w);
      }
    }
  }

  restartRun() {
    if (!this.modelsReady) return;
    this.pauseMenuActive = false;
    this.ui.hidePauseMenu();
    if (this._resizeDebounceT) {
      clearTimeout(this._resizeDebounceT);
      this._resizeDebounceT = null;
    }
    // #region agent log
    _agentLog(
      'main.js:restartRun',
      'restart_run',
      {
        waveBeforeReset: this.waveManager?.currentWave,
        countdownBusy: !!this._waveCountdownRunning,
        tex: this.renderer?.info?.memory?.textures ?? 0,
        geom: this.renderer?.info?.memory?.geometries ?? 0
      },
      'K',
      'pre'
    );
    // #endregion
    this._waveCountdownSerial = (this._waveCountdownSerial || 0) + 1;
    this._waveCountdownRunning = false;
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
    this._pendingSpecialStart = null;
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
    this._pendingBossAfterDare = false;
    this.bossEncounter?.reset();
    this.ui.clearBossEncounterHud();
    this.gameMusic?.leaveBossFight();
    this.clearAllyShips();

    this.arena.setLevel(0);
    if (this.isMobile && !this.arena.liveLevelTexturesOnly) {
      this.arena.evictRemoteLevelTextures(0);
    }
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
    const serial = this._waveCountdownSerial;
    try {
      if (this._waveCountdownRunning) return;
      this._waveCountdownRunning = true;
      if (serial !== this._waveCountdownSerial) {
        this._waveCountdownRunning = false;
        return;
      }
      this.player.inputFrozen = true;
      this.weapon.isHolding = false;

      const tickMs = 700;
      const goMs = 520;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      let wavePrimed = false;
      let bossAfter = false;
      try {
        if (serial !== this._waveCountdownSerial) return;
        bossAfter = this._pendingBossAfterDare;
        this.ui.showWaveCountdown();
        if (!this.isRunning || this.player.isDead) return;

        if (!bossAfter) {
          this.waveManager.startNextWave(this.player.getPosition(), { deferAnnouncement: true });
          wavePrimed = true;
          this.ui.updateWave(this.waveManager.currentWave);
          this.ui.updateLevelName(this.arena.getLevelName());
        }

        for (const n of [3, 2, 1]) {
          if (serial !== this._waveCountdownSerial) return;
          if (!this.isRunning || this.player.isDead) return;
          this.ui.setWaveCountdownDigit(String(n), false);
          this.waveManager.playCountdownTick(n);
          await sleep(tickMs);
        }
        if (serial !== this._waveCountdownSerial) return;
        if (!this.isRunning || this.player.isDead) return;
        this.ui.setWaveCountdownDigit('GO!', true);
        this.waveManager.playCountdownGo();
        await sleep(goMs);

        if (bossAfter) resumeSharedAudioContext();

        if (bossAfter && serial === this._waveCountdownSerial && this.isRunning && !this.player.isDead) {
          this._pendingBossAfterDare = false;
          try {
            this.gameMusic?.pauseBedForCutscene();
            const bossLoad = this.bossEncounter.begin();
            const introClip = getFinaleBossIntroClip(this.selectedCharacterId);
            await this.ui.runBossCutsceneWithBossLoad(bossLoad, introClip);
            if (serial !== this._waveCountdownSerial || !this.isRunning || this.player.isDead) {
              this.bossEncounter.reset();
              this.gameMusic?.leaveBossFight();
            } else {
              await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
              if (this.isRunning && !this.player.isDead) {
                this.gameMusic?.enterBossFight();
              }
            }
          } catch (err) {
            console.warn('[KOL BASH] Boss begin failed', err);
            this.gameMusic?.leaveBossFight();
            this.bossEncounter.reset();
          }
          if (this.isRunning && !this.player.isDead) {
            this.ui.showWaveAnnouncement(
              BOSS_TRIGGER_AFTER_WAVE,
              'FINALE — HE OWNS THE WALLS',
              this.arena.getLevelName(),
              false
            );
          }
        }
      } finally {
        if (serial === this._waveCountdownSerial) {
          this.ui.hideWaveCountdown();
          this._waveCountdownRunning = false;
          if (wavePrimed) {
            const ok = this.isRunning && !this.player.isDead;
            this.waveManager.releaseDeferredWaveStart({ silent: !ok });
          } else if (this.isRunning && !this.player.isDead && !bossAfter) {
            this.waveManager.startNextWave(this.player.getPosition());
          }
          this.player.inputFrozen = false;
        }
      }
    } finally {
      this._overlayResumeBusy = false;
    }
  }

  /** Chicken out on the between-waves dare screen — back to dossier. */
  bailFromDareToTitle() {
    this._overlayResumeBusy = false;
    this._waveCountdownSerial = (this._waveCountdownSerial || 0) + 1;
    this._waveCountdownRunning = false;
    this.ui.hideWaveCountdown();
    this.waveManager?.releaseDeferredWaveStart?.({ silent: true });
    this.clearAllyShips();
    this.specialAttackActive = false;
    this.specialAttack?.stop();
    this._pendingSpecialStart = null;
    this.waveClear?.stop(false);
    this._pendingBossAfterDare = false;
    this.bossEncounter?.reset();
    this.ui.clearBossEncounterHud();
    this.gameMusic?.leaveBossFight();
    this.player.inputFrozen = false;
    this.weapon.isHolding = false;
    this.clock.stop();
    if (!this.isMobile && document.pointerLockElement) {
      document.exitPointerLock();
    }
    this.player.controls.unlock();
    this.returnToTitle();
  }

  showDareScreen(wave) {
    this._mobileDbg?.mark('DARE_SCREEN', `wave=${wave}`);
    this.isRunning = false;
    this.player.inputFrozen = false;

    if (!this.isMobile && document.pointerLockElement) {
      document.exitPointerLock();
    }

    this.ui.showDareScreen(
      wave,
      () => {
        this.dareDancers.hide();
        this.resumeNextWave();
      },
      () => {
        this.dareDancers.hide();
        this.showStore();
      },
      () => {
        this.dareDancers.hide();
        this.bailFromDareToTitle();
      },
      { finaleLeadIn: wave === BOSS_TRIGGER_AFTER_WAVE }
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
      /** Flat + % of new max so buys feel good when hurt, still capped at max. */
      const replenish = 60 + Math.round(this.player.maxHealth * 0.12);
      this.player.heal(replenish);
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
    this._mobileDbg?.mark('RESUME_NEXT_WAVE', '');
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
    const ch = getCharacter(this.selectedCharacterId);
    if (!ch.playable) return;
    if (!this.isCinematicReadyForSelection()) return;
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
    const coinCap = this.isMobile ? (this.isLowTierMobile ? 4 : 6) : 10;
    this.itemManager.spawnCoins(this._spawnPos, Math.min(coinCount, coinCap));

    if (isBoss) {
      this.itemManager.spawnPowerup(this._spawnPos, 3);
      if (!this.isMobile && Math.random() < 0.5) {
        this.itemManager.spawnPowerup(this._spawnPos);
      }
    } else if (Math.random() < (this.isMobile ? 0.12 : 0.18)) {
      this.itemManager.spawnPowerup(this._spawnPos);
    }
  }

  handleShooting(playerPos) {
    if (this.specialAttackActive) return;
    if (this.player.inputFrozen) return;
    if (!this.player.controls.isLocked) return;

    const dir = this.weapon.tryFire(this.player.rapidFire);
    if (!dir) return;

    const muzzlePos = this.weapon.getMuzzleWorldPosition();

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
    } else if (this.bossEncounter?.isActive()) {
      const dealt = this.bossEncounter.tryHitscan(muzzlePos, dir, this.weapon.damage);
      if (dealt > 0) {
        this.damageDealt += dealt;
        this.weapon.playHitSound();
        this._hitTarget = this._hitTarget || new THREE.Vector3();
        this.bossEncounter.getFxHitTarget(this._hitTarget);
        this.weapon.spawnProjectile(muzzlePos, this._hitTarget, () => {
          if (this.currentWeapon === 'rocket') {
            this.rocketAOE(this._hitTarget);
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
    if (this.bossEncounter?.isActive()) {
      const bd = this.bossEncounter.tryAoE(center.x, center.z, def.aoeRadius, def.aoeDamage);
      if (bd > 0) this.damageDealt += bd;
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
    if (this.isMobile && this.allyShips.length >= 1) return;
    this._buildAllyShipTemplate();
    const ship = this._allyShipTemplate.clone(true);
    const rim = ship.getObjectByName('allyRim');

    const dur = this.allyShipDuration;
    ship.userData = {
      spawnTime: performance.now(),
      duration: dur,
      lastShot: 0,
      shotInterval: this.isMobile ? (this.isLowTierMobile ? 620 : 520) : 400,
      orbitAngle: Math.random() * Math.PI * 2,
      orbitRadius: 4,
      orbitHeight: 3.5,
      orbitSpeed: 1.5,
      rim: rim || null
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
        this.allyProjectiles.splice(i, 1);
        if (this._allyBoltPool.length < 32) this._allyBoltPool.push(proj);
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
          this.allyProjectiles.splice(i, 1);
          if (this._allyBoltPool.length < 32) this._allyBoltPool.push(proj);
          break;
        }
      }
    }
  }

  allyShipFire(ship, target) {
    const maxBolt = this.isMobile ? 4 : 10;
    if (this.allyProjectiles.length >= maxBolt) return;
    const dir = this._allyDirScratch.subVectors(target.position, ship.position);
    if (dir.lengthSq() < 1e-8) return;
    dir.normalize();

    let proj = this._allyBoltPool.pop();
    if (!proj) {
      proj = new THREE.Mesh(this.allyBoltGeo, this.allyBoltMat);
    }
    proj.position.copy(ship.position);
    const vel = proj.userData.velocity || (proj.userData.velocity = { x: 0, y: 0, z: 0 });
    vel.x = dir.x * 18;
    vel.y = dir.y * 18;
    vel.z = dir.z * 18;
    proj.userData.life = 2;
    proj.userData.damage = 15;
    proj.userData.sharedBoltMat = true;
    this.scene.add(proj);
    this.allyProjectiles.push(proj);
  }

  clearAllyShips() {
    for (const ship of this.allyShips) {
      this.scene.remove(ship);
    }
    this.allyShips = [];
    for (const p of this.allyProjectiles) {
      this.scene.remove(p);
      if (this._allyBoltPool.length < 32) this._allyBoltPool.push(p);
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
            this.enemyManager.damageEnemy(enemy, fx.value, { skipFlash: true });
            this.damageDealt += fx.value;
          }
        }
      }
    }

    if (fx.type === 'enemySlow') {
      for (const enemy of this.enemyManager.enemies) {
        if (!enemy.userData.isDead && !enemy.userData._levelSlowed) {
          enemy.userData._levelSlowed = true;
          enemy.userData.levelSpeedMul = fx.value;
        }
      }
    }

    if (fx.type === 'chaosMode') {
      for (const enemy of this.enemyManager.enemies) {
        if (!enemy.userData.isDead && !enemy.userData._chaosBoosted) {
          enemy.userData._chaosBoosted = true;
          enemy.userData.chaosMeleeMul = fx.enemyDmg;
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
          const base = type.diveDamage ?? type.jumpDamage ?? type.damage;
          const damage = Math.round(
            base * (enemy.userData.chaosMeleeMul ?? 1) * (enemy.userData.finaleDmgMul ?? 1)
          );
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
    this._yawEulerScratch.setFromQuaternion(this.camera.quaternion);
    return this._yawEulerScratch.y;
  }

  trySpecialAttack() {
    const now = performance.now();
    if (!this.isRunning || this.player.isDead || this.specialAttackActive || this._pendingSpecialStart) return;
    if (!this.specialReady || !this.specialAttack?.canStart()) {
      if (now - this._lastSpecialRejectMs < 320) return;
      this._lastSpecialRejectMs = now;
      return;
    }
    this._lastSpecialRejectMs = 0;
    // #region agent log
    _agentLog(
      'main.js:trySpecialAttack',
      'special_start',
      {
        wave: this.waveManager?.currentWave,
        level: this.arena?.currentLevel,
        tex: this.renderer?.info?.memory?.textures ?? 0,
        geom: this.renderer?.info?.memory?.geometries ?? 0
      },
      'J',
      'pre'
    );
    // #endregion
    this._mobileDbg?.mark('SPECIAL_START', '');

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
    const specialCallbacks = {
      onDamage: (amt) => {
        this.damageDealt += amt;
      },
      tryDamageFinaleBoss: (kind, px, py, pz, dmg) =>
        this.bossEncounter?.isActive() && this.bossEncounter.isVulnerable()
          ? this.bossEncounter.trySpecialHit(kind, px, py, pz, dmg)
          : 0,
      onEnd: () => {
        this.specialAttackActive = false;
        this._mobileDbg?.mark('SPECIAL_END', '');
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
    };
    this._pendingSpecialStart = { yaw, callbacks: specialCallbacks };
  }

  beginDeathSequence() {
    if (this.deathSequenceActive) return;
    this._pendingSpecialStart = null;
    this._pendingBossAfterDare = false;
    this.bossEncounter?.reset();
    this.ui.clearBossEncounterHud();
    this.gameMusic?.leaveBossFight();
    this._mobileDbg?.mark('DEATH_SEQUENCE', '');
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
    this.ui.showGameOver(
      {
        wave: this.waveManager.currentWave,
        score: this.score,
        coins: this.coins,
        kills: this.kills,
        damageDealt: this.damageDealt
      },
      {
        onRetry: () => this.restartRun(),
        onMainMenu: () => this.leaveRunToTitleFromGameOver({ focusCarousel: false }),
        onChangeCharacter: () => this.leaveRunToTitleFromGameOver({ focusCarousel: true })
      }
    );
  }

  animateDeath() {
    if (!this.deathSequenceActive) return;
    const skipHidden = this.isMobile && typeof document !== 'undefined' && document.hidden;
    if (!skipHidden) {
      const delta = Math.min(this.deathScene.clock.getDelta(), 0.08);
      this.deathScene.update(this.renderer, delta);
    }
    if (this.deathSequenceActive) {
      requestAnimationFrame(() => this.animateDeath());
    }
  }

  animate() {
    // #region agent log
    if (_agentLogEnabled()) {
      this.__animDepth = (this.__animDepth || 0) + 1;
      if (this.__animDepth > 1) {
        _agentLog('main.js:animate', 'reentrant_animate', { depth: this.__animDepth }, 'E', 'pre');
      }
    }
    // #endregion
    try {
    if (this._glContextLost) return;

    const skipFrameHidden = this.isMobile && typeof document !== 'undefined' && document.hidden;

    if (this.isRunning && this.waveClear?.active) {
      requestAnimationFrame(() => this.animate());
      if (skipFrameHidden) return;
      try {
        this._syncMobileAutofireFlag();
        const delta = Math.min(this.clock.getDelta(), this.perf.frameDeltaCap);
        this._mobileDbg?.tickFrame(delta * 1000);
        const playerPos = this.player.getPosition();
        this.physicsWorld.update(delta);
        this.player.update(delta);
        this.ui.updateStamina(this.player.stamina, this.player.staminaMax, this.player.staminaBoostActive);
        this.updateAllyShips(delta, playerPos);
        this.waveClear.update(delta);
        this.renderer.render(this.scene, this.camera);
      } catch (err) {
        this._mobileDbg?.mark('FRAME_ERR_WAVECLEAR', String(err?.message || err));
        console.warn('[KOL BASH] frame (wave clear)', err);
        // #region agent log
        _agentLog(
          'main.js:animate',
          'frame_err_waveclear',
          { err: String(err?.message || err).slice(0, 400) },
          'D',
          'pre'
        );
        // #endregion
      }
      return;
    }

    if (!this.isRunning) {
      if (this._pendingSpecialStart) {
        this._pendingSpecialStart = null;
        this.specialAttackActive = false;
        this.player.inputFrozen = false;
      }
      return;
    }

    requestAnimationFrame(() => this.animate());

    if (skipFrameHidden) return;

    try {
      this._syncMobileAutofireFlag();
      const delta = Math.min(this.clock.getDelta(), this.perf.frameDeltaCap);
      this._mobileDbg?.tickFrame(delta * 1000);
      const playerPos = this.player.getPosition();

      if (this._pendingSpecialStart) {
        const p = this._pendingSpecialStart;
        this._pendingSpecialStart = null;
        if (this.specialAttackActive && this.isRunning && !this.player.isDead) {
          this.specialAttack.start(p.yaw, this.enemyManager, p.callbacks);
        } else {
          this.specialAttackActive = false;
          this.player.inputFrozen = false;
        }
      }

      // #region agent log
      if (_agentLogEnabled() && this.isMobile) {
        const now = performance.now();
        if (now - (this._lastAgentHeartbeat || 0) > 12000) {
          this._lastAgentHeartbeat = now;
          _agentLog(
            'main.js:animate',
            'heartbeat',
            {
              wave: this.waveManager?.currentWave,
              level: this.arena?.currentLevel,
              glLost: this._glContextLost,
              tex: this.renderer?.info?.memory?.textures ?? 0,
              geom: this.renderer?.info?.memory?.geometries ?? 0,
              death: !!this.deathSequenceActive,
              spc: !!this.specialAttackActive,
              wc: !!this.waveClear?.active,
              allies: this.allyShips?.length ?? 0,
              running: !!this.isRunning
            },
            'H',
            'pre'
          );
        }
      }
      // #endregion

      this.physicsWorld.update(delta);
      this.player.update(delta);
      this.ui.updateStamina(this.player.stamina, this.player.staminaMax, this.player.staminaBoostActive);

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
      if (this.bossEncounter?.isActive()) this.bossEncounter.update(delta);
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
      this._mobileDbg?.mark('FRAME_ERR_MAIN', String(err?.message || err));
      console.warn('[KOL BASH] frame', err);
      // #region agent log
      _agentLog(
        'main.js:animate',
        'frame_err_main',
        { err: String(err?.message || err).slice(0, 400) },
        'D',
        'pre'
      );
      // #endregion
    }
    } finally {
      // #region agent log
      if (_agentLogEnabled()) this.__animDepth--;
      // #endregion
    }
  }
}

function showFatalFromMain(err) {
  const wrap = document.getElementById('fatal-error');
  const msg = document.getElementById('fatal-error-msg');
  if (msg) msg.textContent = String(err?.message || err || 'Unknown error');
  if (wrap) wrap.style.display = 'block';
  document.getElementById('loading-screen')?.style.setProperty('display', 'none');
}

document.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  game.init().catch((err) => {
    console.error(err);
    showFatalFromMain(err);
  });
});
