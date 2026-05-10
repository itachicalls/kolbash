/**
 * Wave System - Spawn spacing, level progression, pool replenishment
 */

import * as THREE from 'three';
import { LEVELS } from './arena.js';
import { getSharedAudioContext } from './shared-audio.js';

/** Campaign waves (6 arenas × 2). */
export const REGULAR_WAVES = LEVELS.length * 2;
export const TOTAL_WAVES = REGULAR_WAVES;

/**
 * After clearing this wave, dare/store → countdown starts the finale boss.
 * Use `REGULAR_WAVES` for endgame finale; lower values are for faster local/Pages QA.
 */
export const BOSS_TRIGGER_AFTER_WAVE = 1;

const WAVE_TAUNTS = [
  "WARM UP IS OVER",
  "THEY'RE NOT DANCING FOR FUN",
  "THE FLOOR HUNGERS",
  "YOU WON'T LAST LONG",
  "FEEL THE BASS DROP",
  "NO ESCAPE FROM THE GROOVE",
  "DANCE OR DIE",
  "THE BEAT GOES ON... YOU WON'T",
  "THEY SMELL YOUR FEAR",
  "LAST DANCE, MAYBE",
  "THE FLOOR IS PATIENT. YOU AREN'T.",
  "EVERY STEP COULD BE YOUR LAST",
  "THE MUSIC NEVER STOPS",
  "THEY FEED ON YOUR PANIC",
  "RUN ALL YOU WANT",
  "THE DISCO REMEMBERS",
  "YOUR TOMBSTONE READS: SKILL ISSUE",
  "HARDER. FASTER. DEADLIER.",
  "NO MERCY ON THE DANCE FLOOR",
  "TICK TOCK. TICK TOCK.",
  "THEY'RE GETTING FASTER",
  "PRAY TO THE BASS GOD",
  "THE WALLS ARE CLOSING IN",
  "CAN YOU FEEL IT? THAT'S DOOM."
];

export class WaveManager {
  constructor(enemyManager, opts = {}) {
    this.enemyManager = enemyManager;

    this.currentWave = 0;
    this.currentLevelIndex = -1;
    this.isWaveActive = false;
    this.waveStartTime = 0;
    this.timeBetweenWaves = 2500;
    this.lastWaveEndTime = 0;

    this.baseEnemyCount = 6;
    this.enemiesPerWaveIncrease = 2;
    this.maxEnemiesPerWave = opts.maxEnemiesPerWave ?? 16;
    this.healthMultiplierPerWave = 1.06;
    this.speedMultiplierPerWave = 1.02;

    this.spawnRadiusMin = 12;
    this.spawnRadiusMax = 22;
    this.spawnDelay = opts.spawnDelay ?? 400;
    /** Tighter cadence for the first few waves (more bodies on the floor early). */
    this.earlySpawnDelay = opts.earlySpawnDelay ?? 300;
    /** Spawn gap after wave 4+ (defaults to 400). */
    this.lateSpawnDelay = opts.lateSpawnDelay ?? 400;
    this.minSpawnSpacing = 3;

    this.spawnQueue = [];
    this.lastSpawnTime = 0;
    this.playerCamera = null;

    this._fwdScratch = new THREE.Vector3(0, 0, -1);
    this._spawnDirScratch = new THREE.Vector3();
    this._yAxis = new THREE.Vector3(0, 1, 0);

    /** When true, enemies animate in place but do not move or shoot (pre-GO countdown priming). */
    this.combatHoldActive = false;
    this._deferredWaveAnnounce = null;

    this.audioContext = null;
    this.initAudio();

    this.onWaveStart = null;
    this.onWaveComplete = null;
    this.onLevelChange = null;

    /** When set, wave-end cinematic waits until this returns false (e.g. player projectiles). */
    this._hasActivePlayerProjectiles = opts.hasActivePlayerProjectiles ?? null;
  }

  setPlayerCamera(camera) {
    this.playerCamera = camera;
  }

  initAudio() {
    this.audioContext = getSharedAudioContext();
  }

  playWaveStartSound() {
    if (!this.audioContext) return;
    try {
      if (this.audioContext.state === 'suspended') this.audioContext.resume();
      const now = this.audioContext.currentTime;
      [80, 100, 120, 440, 554].forEach((freq, i) => {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        osc.connect(gain);
        gain.connect(this.audioContext.destination);
        osc.type = i < 3 ? 'sawtooth' : 'square';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(i < 3 ? 0.11 : 0.07, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.08 + 0.11);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.11);
      });
    } catch (e) {}
  }

  playLevelChangeSound() {
    if (!this.audioContext) return;
    try {
      if (this.audioContext.state === 'suspended') this.audioContext.resume();
      const now = this.audioContext.currentTime;
      [220, 440, 660, 880].forEach((freq, i) => {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        osc.connect(gain);
        gain.connect(this.audioContext.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.07);
        gain.gain.setValueAtTime(0.09, now + i * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.07 + 0.14);
        osc.start(now + i * 0.07);
        osc.stop(now + i * 0.07 + 0.14);
      });
    } catch (e) {}
  }

  /** Short pre-wave tick (3, 2, 1) — Web Audio only, no external file. */
  playCountdownTick(n) {
    if (!this.audioContext) return;
    try {
      if (this.audioContext.state === 'suspended') this.audioContext.resume();
      const now = this.audioContext.currentTime;
      const base = n === 3 ? 196 : n === 2 ? 262 : 330;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(base, now);
      osc.frequency.exponentialRampToValueAtTime(base * 1.55, now + 0.04);
      gain.gain.setValueAtTime(0.075, now);
      gain.gain.exponentialRampToValueAtTime(0.0015, now + 0.085);
      osc.start(now);
      osc.stop(now + 0.09);
    } catch (e) {}
  }

  /** Short “GO!” sting — layered disco stab. */
  playCountdownGo() {
    if (!this.audioContext) return;
    try {
      if (this.audioContext.state === 'suspended') this.audioContext.resume();
      const now = this.audioContext.currentTime;
      const freqs = [392, 523.25, 659.25];
      freqs.forEach((freq, i) => {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        osc.connect(gain);
        gain.connect(this.audioContext.destination);
        osc.type = i === 0 ? 'sawtooth' : 'square';
        osc.frequency.setValueAtTime(freq, now + i * 0.012);
        gain.gain.setValueAtTime(i === 0 ? 0.06 : 0.045, now + i * 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0015, now + i * 0.012 + 0.14);
        osc.start(now + i * 0.012);
        osc.stop(now + i * 0.012 + 0.16);
      });
    } catch (e) {}
  }

  getLevelForWave(wave) {
    return Math.min(Math.floor((wave - 1) / 2), LEVELS.length - 1);
  }

  enforceSpacing(pos, existing) {
    let attempts = 0;
    while (attempts < 5) {
      let tooClose = false;
      for (const other of existing) {
        const dx = pos.x - other.position.x;
        const dz = pos.z - other.position.z;
        if (Math.sqrt(dx * dx + dz * dz) < this.minSpawnSpacing) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) break;
      const angle = Math.random() * Math.PI * 2;
      pos.x += Math.cos(angle) * this.minSpawnSpacing;
      pos.z += Math.sin(angle) * this.minSpawnSpacing;
      pos.x = Math.max(-23, Math.min(23, pos.x));
      pos.z = Math.max(-23, Math.min(23, pos.z));
      attempts++;
    }
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.deferAnnouncement] If true, wave HUD/audio runs at releaseDeferredWaveStart();
   *   spawn queue begins immediately (use during pre-GO countdown so GPU cost lands while input is frozen).
   */
  startNextWave(playerPosition, options = {}) {
    const deferAnnouncement = options.deferAnnouncement === true;

    if (!deferAnnouncement) {
      this.combatHoldActive = false;
      this._deferredWaveAnnounce = null;
    }

    this.currentWave++;
    this.isWaveActive = true;
    this.waveStartTime = performance.now();

    const newLevelIndex = this.getLevelForWave(this.currentWave);
    const levelChanged = newLevelIndex !== this.currentLevelIndex;
    this.currentLevelIndex = newLevelIndex;

    if (levelChanged && this.onLevelChange) {
      this.onLevelChange(newLevelIndex);
      requestAnimationFrame(() => this.playLevelChangeSound());
    }

    this.spawnDelay = this.currentWave <= 4 ? this.earlySpawnDelay : this.lateSpawnDelay;

    const forwardDir = this._fwdScratch;
    forwardDir.set(0, 0, -1);
    if (this.playerCamera) {
      this.playerCamera.getWorldDirection(forwardDir);
      forwardDir.y = 0;
      forwardDir.normalize();
    }

    this.spawnQueue = [];
    this.jumpAttackSpawned = 0;
    this.maxJumpAttackPerWave = 1;

    const bossIndex = (this.currentWave - 1) % 6;
    const bossDistance = 14 + Math.random() * 5;
    let bx = playerPosition.x + forwardDir.x * bossDistance;
    let bz = playerPosition.z + forwardDir.z * bossDistance;
    bx = Math.max(-23, Math.min(23, bx));
    bz = Math.max(-23, Math.min(23, bz));
    this.spawnQueue.push({ typeIndex: bossIndex, position: { x: bx, y: 0, z: bz }, isBoss: true });

    const earlyExtra = this.currentWave <= 3 ? 1 : 0;
    const enemyCount = Math.min(
      this.baseEnemyCount + Math.floor((this.currentWave - 1) * this.enemiesPerWaveIncrease) + earlyExtra,
      this.maxEnemiesPerWave
    );

    const useCircle = this.currentWave % 2 === 0;

    for (let i = 0; i < enemyCount; i++) {
      let spawnPos;

      if (useCircle) {
        const angle = (i / enemyCount) * Math.PI * 2;
        const distance = this.spawnRadiusMin + Math.random() * 4;
        let sx = playerPosition.x + Math.cos(angle) * distance;
        let sz = playerPosition.z + Math.sin(angle) * distance;
        sx = Math.max(-23, Math.min(23, sx));
        sz = Math.max(-23, Math.min(23, sz));
        spawnPos = { x: sx, y: 0, z: sz };
      } else {
        const spreadAngle = Math.PI * 1.4;
        const angleOffset = ((i / (enemyCount - 1 || 1)) - 0.5) * spreadAngle;

        const spawnDir = this._spawnDirScratch.copy(forwardDir);
        const cos = Math.cos(angleOffset);
        const sin = Math.sin(angleOffset);
        spawnDir.x = forwardDir.x * cos - forwardDir.z * sin;
        spawnDir.z = forwardDir.x * sin + forwardDir.z * cos;

        const distance = this.spawnRadiusMin + Math.random() * (this.spawnRadiusMax - this.spawnRadiusMin);
        const jitter = (Math.random() - 0.5) * Math.PI * 0.3;
        spawnDir.applyAxisAngle(this._yAxis, jitter);

        let sx = playerPosition.x + spawnDir.x * distance;
        let sz = playerPosition.z + spawnDir.z * distance;
        sx = Math.max(-23, Math.min(23, sx));
        sz = Math.max(-23, Math.min(23, sz));
        spawnPos = { x: sx, y: 0, z: sz };
      }

      this.enforceSpacing(spawnPos, this.spawnQueue);

      let typeIndex = i % 6;
      if (typeIndex === 3 && this.jumpAttackSpawned >= this.maxJumpAttackPerWave) {
        typeIndex = (i + 1) % 6;
      }
      if (typeIndex === 3) this.jumpAttackSpawned++;

      this.spawnQueue.push({ typeIndex, position: spawnPos, isBoss: false });
    }

    const taunt = WAVE_TAUNTS[Math.floor(Math.random() * WAVE_TAUNTS.length)];
    const waveNum = this.currentWave;
    const onStart = this.onWaveStart;

    if (deferAnnouncement) {
      this.combatHoldActive = true;
      this._deferredWaveAnnounce = { waveNum, taunt, levelChanged, onStart };
      this.lastSpawnTime = performance.now() - this.spawnDelay - 1;
    } else {
      this.lastSpawnTime = performance.now();
      requestAnimationFrame(() => {
        this.playWaveStartSound();
        requestAnimationFrame(() => {
          if (onStart) onStart(waveNum, taunt, levelChanged);
        });
      });
    }
  }

  /**
   * Clears combat hold so enemies can engage.
   * @param {{ silent?: boolean }} [options] If silent, skip sound + HUD announcement (aborted countdown).
   */
  releaseDeferredWaveStart(options = {}) {
    const silent = options.silent === true;
    const payload = this._deferredWaveAnnounce;
    this._deferredWaveAnnounce = null;
    this.combatHoldActive = false;
    if (!payload || silent) return;
    const { waveNum, taunt, levelChanged, onStart } = payload;
    requestAnimationFrame(() => {
      this.playWaveStartSound();
      requestAnimationFrame(() => {
        if (onStart) onStart(waveNum, taunt, levelChanged);
      });
    });
  }

  getWaveModifiers() {
    return {
      health: Math.pow(this.healthMultiplierPerWave, this.currentWave - 1),
      speed: Math.pow(this.speedMultiplierPerWave, this.currentWave - 1)
    };
  }

  update(deltaTime, playerPosition) {
    const now = performance.now();

    if (this.spawnQueue.length > 0 && now - this.lastSpawnTime > this.spawnDelay) {
      const data = this.spawnQueue.shift();
      const mods = this.getWaveModifiers();

      const enemy = this.enemyManager.spawnEnemySync(data.typeIndex, data.position, data.isBoss);
      if (enemy && !data.isBoss) {
        enemy.userData.health *= mods.health;
        enemy.userData.maxHealth = enemy.userData.health;
        enemy.userData.waveSpeedMul = mods.speed;
      }

      this.lastSpawnTime = now;
    }

    if (this.isWaveActive && this.spawnQueue.length === 0) {
      if (this.enemyManager.getAliveCount() === 0) {
        const visualsClear = this.enemyManager.isWaveClearForCinematic();
        const playerShotsDone =
          !this._hasActivePlayerProjectiles || !this._hasActivePlayerProjectiles();
        if (visualsClear && playerShotsDone) {
          this.isWaveActive = false;
          this.lastWaveEndTime = now;
          if (this.onWaveComplete) this.onWaveComplete(this.currentWave);
        }
      }
    }
  }

  shouldStartNextWave() {
    return false;
  }

  reset() {
    this.currentWave = 0;
    this.currentLevelIndex = -1;
    this.isWaveActive = false;
    this.jumpAttackSpawned = 0;
    this.waveStartTime = 0;
    this.lastWaveEndTime = 0;
    this.spawnQueue = [];
    this.lastSpawnTime = 0;
    this.combatHoldActive = false;
    this._deferredWaveAnnounce = null;
  }
}
