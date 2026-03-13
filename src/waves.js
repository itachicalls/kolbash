/**
 * Wave System - Spawn spacing, level progression, pool replenishment
 */

import * as THREE from 'three';

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
  constructor(enemyManager) {
    this.enemyManager = enemyManager;

    this.currentWave = 0;
    this.currentLevelIndex = -1;
    this.isWaveActive = false;
    this.waveStartTime = 0;
    this.timeBetweenWaves = 2500;
    this.lastWaveEndTime = 0;

    this.baseEnemyCount = 4;
    this.enemiesPerWaveIncrease = 2;
    this.maxEnemiesPerWave = 14;
    this.healthMultiplierPerWave = 1.06;
    this.speedMultiplierPerWave = 1.02;

    this.spawnRadiusMin = 12;
    this.spawnRadiusMax = 22;
    this.spawnDelay = 400;
    this.minSpawnSpacing = 3;

    this.spawnQueue = [];
    this.lastSpawnTime = 0;
    this.playerCamera = null;

    this.audioContext = null;
    this.initAudio();

    this.onWaveStart = null;
    this.onWaveComplete = null;
    this.onLevelChange = null;
  }

  setPlayerCamera(camera) {
    this.playerCamera = camera;
  }

  initAudio() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {}
  }

  playWaveStartSound() {
    if (!this.audioContext) return;
    try {
      if (this.audioContext.state === 'suspended') this.audioContext.resume();
      const now = this.audioContext.currentTime;
      [80, 100, 80, 120, 440, 554, 659].forEach((freq, i) => {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        osc.connect(gain);
        gain.connect(this.audioContext.destination);
        osc.type = i < 4 ? 'sawtooth' : 'square';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(i < 4 ? 0.12 : 0.08, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.08 + 0.12);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.12);
      });
    } catch (e) {}
  }

  playLevelChangeSound() {
    if (!this.audioContext) return;
    try {
      if (this.audioContext.state === 'suspended') this.audioContext.resume();
      const now = this.audioContext.currentTime;
      [220, 330, 440, 554, 660, 880].forEach((freq, i) => {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        osc.connect(gain);
        gain.connect(this.audioContext.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.06);
        gain.gain.setValueAtTime(0.1, now + i * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.06 + 0.15);
        osc.start(now + i * 0.06);
        osc.stop(now + i * 0.06 + 0.15);
      });
    } catch (e) {}
  }

  getLevelForWave(wave) {
    return Math.floor((wave - 1) / 2);
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

  startNextWave(playerPosition) {
    this.currentWave++;
    this.isWaveActive = true;
    this.waveStartTime = performance.now();

    const newLevelIndex = this.getLevelForWave(this.currentWave);
    const levelChanged = newLevelIndex !== this.currentLevelIndex;
    this.currentLevelIndex = newLevelIndex;

    if (levelChanged && this.onLevelChange) {
      this.playLevelChangeSound();
      this.onLevelChange(newLevelIndex);
    }

    this.playWaveStartSound();

    let forwardDir = new THREE.Vector3(0, 0, -1);
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
    const bossPos = new THREE.Vector3(
      playerPosition.x + forwardDir.x * bossDistance,
      0,
      playerPosition.z + forwardDir.z * bossDistance
    );
    bossPos.x = Math.max(-23, Math.min(23, bossPos.x));
    bossPos.z = Math.max(-23, Math.min(23, bossPos.z));
    this.spawnQueue.push({ typeIndex: bossIndex, position: bossPos, isBoss: true });

    const enemyCount = Math.min(
      this.baseEnemyCount + Math.floor((this.currentWave - 1) * this.enemiesPerWaveIncrease),
      this.maxEnemiesPerWave
    );

    const useCircle = this.currentWave % 2 === 0;

    for (let i = 0; i < enemyCount; i++) {
      let spawnPos;

      if (useCircle) {
        const angle = (i / enemyCount) * Math.PI * 2;
        const distance = this.spawnRadiusMin + Math.random() * 4;
        spawnPos = new THREE.Vector3(
          playerPosition.x + Math.cos(angle) * distance,
          0,
          playerPosition.z + Math.sin(angle) * distance
        );
      } else {
        const spreadAngle = Math.PI * 1.4;
        const angleOffset = ((i / (enemyCount - 1 || 1)) - 0.5) * spreadAngle;

        const spawnDir = forwardDir.clone();
        const cos = Math.cos(angleOffset);
        const sin = Math.sin(angleOffset);
        spawnDir.x = forwardDir.x * cos - forwardDir.z * sin;
        spawnDir.z = forwardDir.x * sin + forwardDir.z * cos;

        const distance = this.spawnRadiusMin + Math.random() * (this.spawnRadiusMax - this.spawnRadiusMin);
        const jitter = (Math.random() - 0.5) * Math.PI * 0.3;
        spawnDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), jitter);

        spawnPos = new THREE.Vector3(
          playerPosition.x + spawnDir.x * distance,
          0,
          playerPosition.z + spawnDir.z * distance
        );
      }

      spawnPos.x = Math.max(-23, Math.min(23, spawnPos.x));
      spawnPos.z = Math.max(-23, Math.min(23, spawnPos.z));

      this.enforceSpacing(spawnPos, this.spawnQueue);

      let typeIndex = i % 6;
      if (typeIndex === 3 && this.jumpAttackSpawned >= this.maxJumpAttackPerWave) {
        typeIndex = (i + 1) % 6;
      }
      if (typeIndex === 3) this.jumpAttackSpawned++;

      this.spawnQueue.push({ typeIndex, position: spawnPos, isBoss: false });
    }

    const taunt = WAVE_TAUNTS[Math.floor(Math.random() * WAVE_TAUNTS.length)];
    if (this.onWaveStart) this.onWaveStart(this.currentWave, taunt, levelChanged);
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
        enemy.userData.type = {
          ...enemy.userData.type,
          speed: enemy.userData.type.speed * mods.speed
        };
      }

      this.lastSpawnTime = now;
    }

    if (this.isWaveActive && this.spawnQueue.length === 0) {
      if (this.enemyManager.getAliveCount() === 0) {
        this.isWaveActive = false;
        this.lastWaveEndTime = now;
        if (this.onWaveComplete) this.onWaveComplete(this.currentWave);
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
  }
}
