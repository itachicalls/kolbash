/**
 * Enemy System - Model pool, per-type AI, spawn animation, leap attacks
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { getSharedAudioContext } from './shared-audio.js';

export class EnemyManager {
  constructor(scene, physicsWorld, opts = {}) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.enemies = [];
    this.fbxLoader = new FBXLoader();

    this.targetHeight = 1.8;
    this.bossHeight = 2.5;

    // behavior: standard | flanker | charger | jumper | tank | erratic
    this.enemyTypes = [
      { name: 'Alon', model: '/models/alon_dancing.fbx', speed: 1.3, swayAmplitude: 0.5, health: 80, damage: 5, color: 0xff4488, isBoss: false, canShoot: true, faceOffset: -90, behavior: 'standard', shootInterval: 3000 },
      { name: 'Slingoor', model: '/models/slingoor_dance.fbx', speed: 1.5, swayAmplitude: 0.7, health: 65, damage: 6, color: 0x44ff88, isBoss: false, canShoot: true, faceOffset: -90, behavior: 'flanker', shootInterval: 2800 },
      { name: 'Pow Dive', model: '/models/pow_dive.fbx', speed: 2.2, swayAmplitude: 0.1, health: 70, damage: 6, color: 0xff8844, isBoss: false, diveDamage: 12, faceOffset: -90, behavior: 'charger' },
      { name: 'Jump Attack', model: '/models/jump_attack.fbx', speed: 1.4, swayAmplitude: 0.3, health: 350, damage: 15, color: 0xaa66ff, isBoss: false, jumpDamage: 30, scaleMultiplier: 2, isJumpAttack: true, faceOffset: 0, behavior: 'jumper' },
      { name: 'Marcell', model: '/models/marcell_dancing.fbx', speed: 1.1, swayAmplitude: 0.2, health: 100, damage: 6, color: 0xffaa44, isBoss: false, canShoot: true, faceOffset: -90, scaleMultiplier: 1.35, behavior: 'tank', shootInterval: 2500 },
      { name: 'Thriller', model: '/models/thriller_part3.fbx', speed: 1.6, swayAmplitude: 0.6, health: 75, damage: 7, color: 0x9933ff, isBoss: false, canShoot: true, faceOffset: -90, behavior: 'erratic', shootInterval: 2600 }
    ];

    this.bossTypes = [
      { name: 'MEGA Alon', model: '/models/alon_dancing.fbx', speed: 1.8, swayAmplitude: 0.6, health: 350, damage: 10, color: 0xff0000, isBoss: true, canShoot: true, faceOffset: -90, behavior: 'standard', shootInterval: 2200 },
      { name: 'MEGA Slingoor', model: '/models/slingoor_dance.fbx', speed: 2.0, swayAmplitude: 0.8, health: 400, damage: 12, color: 0x00ff00, isBoss: true, canShoot: true, faceOffset: -90, behavior: 'flanker', shootInterval: 2000 },
      { name: 'MEGA Pow Dive', model: '/models/pow_dive.fbx', speed: 2.6, swayAmplitude: 0.1, health: 380, damage: 10, color: 0xff6600, isBoss: true, diveDamage: 20, faceOffset: -90, behavior: 'charger' },
      { name: 'MEGA Jump Attack', model: '/models/jump_attack.fbx', speed: 1.8, swayAmplitude: 0.4, health: 900, damage: 20, color: 0x8844ff, isBoss: true, jumpDamage: 50, scaleMultiplier: 2.5, isJumpAttack: true, faceOffset: 0, behavior: 'jumper' },
      { name: 'MEGA Marcell', model: '/models/marcell_dancing.fbx', speed: 1.5, swayAmplitude: 0.3, health: 450, damage: 10, color: 0xff8800, isBoss: true, canShoot: true, faceOffset: -90, scaleMultiplier: 1.4, behavior: 'tank', shootInterval: 1800 },
      { name: 'MEGA Thriller', model: '/models/thriller_part3.fbx', speed: 2.0, swayAmplitude: 0.7, health: 320, damage: 10, color: 0xbb66ff, isBoss: true, canShoot: true, faceOffset: -90, behavior: 'erratic', shootInterval: 1800 }
    ];

    this.modelCache = new Map();
    this.loadPromises = new Map();
    this.modelPool = new Map();
    this.modelOffsetCache = new Map();

    this.slowMotion = false;
    this.slowMotionEndTime = 0;

    this.enemyProjectiles = [];
    this.maxEnemyProjectiles = opts.maxEnemyProjectiles ?? 10;
    this._projDirScratch = new THREE.Vector3();
    this.enemyProjectileGeo = new THREE.TorusGeometry(0.08, 0.025, 6, 8);
    /** Recycled enemy bolt meshes (same geo + shared mat per color). */
    this._enemyProjPool = [];
    /** Reuse MeshBasicMaterials by enemy color — never dispose per shot (mobile). */
    this._enemyProjMatByColor = new Map();

    /** Shared health bar plate (was one MeshBasicMaterial per enemy — VRAM + dispose hazards). */
    this._hbBgSharedMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthTest: false
    });
    this._hbBgSharedMat.userData.skipDispose = true;

    /** Reused when computing model bounds on first spawn of each FBX type. */
    this._spawnBounds = new THREE.Box3();
    this._spawnCenter = new THREE.Vector3();

    /** Mobile: halves AnimationMixer CPU (30Hz effective) + staggers health-bar lookAt. */
    this._updateFrame = 0;
    this.shootersThisWave = 0;
    this.maxShootersPerWave = opts.maxShootersPerWave ?? 3;
    this.poolReplenishTo = opts.poolReplenishTo ?? 3;
    /**
     * When true (mobile), never SkeletonUtils.clone during combat — use pool or spawn fallback mesh.
     * Runtime FBX clones are a top cause of WebKit tab kills under load.
     */
    this.preferPoolOnly = opts.preferPoolOnly === true;
    /** Stagger skinned mixer updates across enemies (2× delta when sampled) to cut CPU on phones. */
    this._mixerHalfRateMobile = opts.mixerHalfRateMobile === true;

    this.audioContext = null;
    this.initAudio();

    this.waveManager = null;

    /** Lazily built shared meshes for pool-miss fallback (mobile preferPoolOnly). */
    this._fallbackSharedReady = false;
    this._fbBodyGeo = null;
    this._fbBodyGeoBoss = null;
    this._fbHeadGeo = null;
    this._fbHeadGeoBoss = null;
    this._fallbackBodyMatByColor = new Map();
    this._fallbackHeadMat = null;

    this._healthBarGeosReady = false;
    this._hbBgGeoN = null;
    this._hbBgGeoB = null;
    this._hbFillGeoN = null;
    this._hbFillGeoB = null;
  }

  _ensureHealthBarGeometries() {
    if (this._healthBarGeosReady) return;
    this._healthBarGeosReady = true;
    this._hbBgGeoN = new THREE.PlaneGeometry(1.0, 0.15);
    this._hbBgGeoB = new THREE.PlaneGeometry(1.8, 0.15);
    this._hbFillGeoN = new THREE.PlaneGeometry(0.9, 0.1);
    this._hbFillGeoB = new THREE.PlaneGeometry(1.7, 0.1);
  }

  setWaveManager(waveManager) {
    this.waveManager = waveManager;
  }

  // ── Audio ──

  initAudio() {
    this.audioContext = getSharedAudioContext();
  }

  playDeathSound(isBoss = false) {
    if (!this.audioContext) return;
    try {
      if (this.audioContext.state === 'suspended') this.audioContext.resume();
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.type = isBoss ? 'square' : 'sawtooth';
      osc.frequency.setValueAtTime(isBoss ? 100 : 200, this.audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(isBoss ? 30 : 50, this.audioContext.currentTime + (isBoss ? 0.5 : 0.2));
      gain.gain.setValueAtTime(isBoss ? 0.2 : 0.1, this.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + (isBoss ? 0.5 : 0.2));
      osc.start();
      osc.stop(this.audioContext.currentTime + (isBoss ? 0.5 : 0.2));
    } catch (e) {}
  }

  /**
   * Yaw-only toward player plus model faceOffset. Full lookAt + Euler Y tweaks
   * mis-orients FBX roots when the player moves behind the enemy.
   */
  /** @returns {number} Delta to pass to `AnimationMixer.update`, or 0 to skip this frame. */
  _effectiveMixerDelta(enemyIndex, mixerDelta, isBoss) {
    if (isBoss || !this._mixerHalfRateMobile || mixerDelta <= 0) return mixerDelta;
    if (((this._updateFrame + enemyIndex) & 1) !== 0) return 0;
    return mixerDelta * 2;
  }

  applyEnemyFaceYaw(enemy, data, dirXZ, dist, now) {
    if (dist < 0.02) return;
    const off = (data.type.faceOffset ?? 0) * Math.PI / 180;
    const yaw = Math.atan2(dirXZ.x, dirXZ.z) + off;
    enemy.rotation.order = 'YXZ';
    enemy.rotation.y = yaw;
    enemy.rotation.x = 0;
    const b = data.type.behavior || 'standard';
    if (b === 'jumper' && !data.isLeaping) {
      const bt = (now - data.spawnTime) / 1000;
      enemy.rotation.z = Math.sin(bt * 8) * 0.03;
    } else {
      enemy.rotation.z = 0;
    }
  }

  // ── Model Loading & Pool ──

  async loadFBX(path) {
    if (this.modelCache.has(path)) return this.modelCache.get(path);
    if (this.loadPromises.has(path)) return this.loadPromises.get(path);

    const promise = new Promise((resolve, reject) => {
      this.fbxLoader.load(
        path,
        (fbx) => {
          const box = new THREE.Box3().setFromObject(fbx);
          const size = box.getSize(new THREE.Vector3());

          let animations = fbx.animations || [];
          if (animations.length === 0) {
            fbx.traverse((child) => {
              if (child.animations && child.animations.length > 0) {
                animations = animations.concat(child.animations);
              }
            });
          }

          const modelData = { fbx, originalHeight: size.y, animations };
          this.modelCache.set(path, modelData);
          resolve(modelData);
        },
        undefined,
        (error) => {
          console.warn(`Failed to load ${path}:`, error);
          reject(error);
        }
      );
    });

    this.loadPromises.set(path, promise);
    return promise;
  }

  warmPool(clonesPerModel = 3) {
    for (const [path, modelData] of this.modelCache) {
      if (!this.modelPool.has(path)) this.modelPool.set(path, []);
      const pool = this.modelPool.get(path);
      while (pool.length < clonesPerModel) {
        try {
          pool.push(SkeletonUtils.clone(modelData.fbx));
        } catch (e) {}
      }
    }
  }

  /**
   * Pre-compile skinned FBX shader programs during loading so the first real spawn
   * does not hitch the frame (especially on mobile).
   */
  prewarmSkinnedMaterials(renderer, camera) {
    if (!renderer?.compile || !camera || this.modelCache.size === 0) return;

    const warmScene = new THREE.Scene();
    const amb = new THREE.AmbientLight(0xffffff, 1.05);
    const dir = new THREE.DirectionalLight(0xffffff, 0.72);
    dir.position.set(3, 10, 6);
    warmScene.add(amb, dir);

    const group = new THREE.Group();
    const paths = [];
    for (const t of this.enemyTypes) {
      if (!paths.includes(t.model)) paths.push(t.model);
    }

    const taken = [];
    for (let pi = 0; pi < paths.length; pi++) {
      const path = paths[pi];
      const modelData = this.modelCache.get(path);
      if (!modelData) continue;
      const m = this.getPooledClone(path);
      if (!m) continue;
      const scale = this.targetHeight / modelData.originalHeight;
      m.scale.setScalar(scale);
      m.position.set((pi - paths.length * 0.5) * 1.25, 0, 0);
      m.userData._warmReturnPath = path;
      group.add(m);
      taken.push(m);
    }
    if (taken.length === 0) return;

    warmScene.add(group);
    group.updateMatrixWorld(true);

    const cam = new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
    cam.position.set(0, 1.15, 5.2);
    cam.lookAt(0, 0.85, 0);

    try {
      renderer.compile(warmScene, cam);
    } catch (e) {}

    warmScene.remove(group);
    for (const m of taken) {
      const path = m.userData._warmReturnPath;
      delete m.userData._warmReturnPath;
      m.scale.setScalar(1);
      m.position.set(0, 0, 0);
      const pool = this.modelPool.get(path);
      if (pool) pool.push(m);
    }
  }

  /**
   * Refill all model pools up to poolReplenishTo (may clone many FBXs in one frame — avoid on low-tier mobile).
   */
  replenishPool() {
    while (this.replenishPoolStep()) {
      /* sync drain */
    }
  }

  /**
   * Clone at most one pooled enemy model, for the first path that is below poolReplenishTo.
   * @returns {boolean} true if any pool is still below target (caller should schedule another step).
   */
  replenishPoolStep() {
    const target = this.poolReplenishTo;
    for (const [path, modelData] of this.modelCache) {
      const pool = this.modelPool.get(path) || [];
      this.modelPool.set(path, pool);
      if (pool.length < target) {
        try {
          pool.push(SkeletonUtils.clone(modelData.fbx));
        } catch (e) {}
        break;
      }
    }
    for (const [path] of this.modelCache) {
      const pool = this.modelPool.get(path) || [];
      if (pool.length < target) return true;
    }
    return false;
  }

  getPooledClone(path) {
    const pool = this.modelPool.get(path);
    if (pool && pool.length > 0) return pool.pop();
    if (this.preferPoolOnly) return null;
    const modelData = this.modelCache.get(path);
    if (modelData) return SkeletonUtils.clone(modelData.fbx);
    return null;
  }

  // ── Visual Helpers ──

  createHealthBar(isBoss = false) {
    this._ensureHealthBarGeometries();
    const group = new THREE.Group();
    const width = isBoss ? 1.8 : 1.0;

    const bgGeo = isBoss ? this._hbBgGeoB : this._hbBgGeoN;
    const fillGeo = isBoss ? this._hbFillGeoB : this._hbFillGeoN;

    const bg = new THREE.Mesh(bgGeo, this._hbBgSharedMat);
    bg.userData.sharedPoolGeometry = true;
    bg.renderOrder = 999;
    group.add(bg);

    const fill = new THREE.Mesh(
      fillGeo,
      new THREE.MeshBasicMaterial({ color: isBoss ? 0xff0000 : 0x00ff00, side: THREE.DoubleSide, depthTest: false })
    );
    fill.userData.sharedPoolGeometry = true;
    fill.position.z = 0.01;
    fill.renderOrder = 1000;
    group.add(fill);

    group.userData.fill = fill;
    group.userData.fillMat = fill.material;
    group.userData.width = width - 0.1;

    return group;
  }

  _ensureFallbackSharedAssets() {
    if (this._fallbackSharedReady) return;
    this._fallbackSharedReady = true;
    this._fbBodyGeo = new THREE.CapsuleGeometry(0.3, 0.9, 4, 8);
    this._fbBodyGeoBoss = new THREE.CapsuleGeometry(0.42, 1.26, 4, 8);
    this._fbHeadGeo = new THREE.SphereGeometry(0.2, 8, 6);
    this._fbHeadGeoBoss = new THREE.SphereGeometry(0.28, 8, 6);
    this._fallbackHeadMat = new THREE.MeshBasicMaterial({ color: 0xffccaa });
  }

  _fallbackBodyMaterial(color) {
    let m = this._fallbackBodyMatByColor.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color });
      this._fallbackBodyMatByColor.set(color, m);
    }
    return m;
  }

  createFallbackModel(type) {
    this._ensureFallbackSharedAssets();
    const group = new THREE.Group();
    const isBoss = !!type.isBoss;
    const scale = isBoss ? 1.4 : 1;

    const bodyGeo = isBoss ? this._fbBodyGeoBoss : this._fbBodyGeo;
    const headGeo = isBoss ? this._fbHeadGeoBoss : this._fbHeadGeo;

    const body = new THREE.Mesh(bodyGeo, this._fallbackBodyMaterial(type.color));
    body.position.y = 0.8 * scale;
    group.add(body);

    const head = new THREE.Mesh(headGeo, this._fallbackHeadMat);
    head.position.y = 1.5 * scale;
    group.add(head);

    group.userData.isFallback = true;
    group.userData.bodyMesh = body;

    return group;
  }

  // ── Spawning ──

  spawnEnemySync(typeIndex, position, isBoss = false) {
    const typeArray = isBoss ? this.bossTypes : this.enemyTypes;
    const type = typeArray[typeIndex % typeArray.length];
    const baseH = isBoss ? this.bossHeight : this.targetHeight;
    const scaleMult = type.scaleMultiplier ?? 1;
    const targetH = baseH * scaleMult;

    const enemy = new THREE.Group();
    enemy.position.set(position.x, 0, position.z);

    let model;
    let mixer = null;
    let action = null;
    let scaledHeight = targetH;

    const modelData = this.modelCache.get(type.model);
    if (modelData) {
      model = this.getPooledClone(type.model);
      if (!model) model = this.createFallbackModel(type);

      if (!model.userData.isFallback) {
        const scale = targetH / modelData.originalHeight;
        model.scale.setScalar(scale);

        let offsets = this.modelOffsetCache.get(type.model);
        if (!offsets) {
          this._spawnBounds.setFromObject(model);
          const center = this._spawnBounds.getCenter(this._spawnCenter);
          const box = this._spawnBounds;
          offsets = {
            minY: box.min.y / scale,
            cx: center.x / scale,
            cz: center.z / scale,
            h: (box.max.y - box.min.y) / scale
          };
          this.modelOffsetCache.set(type.model, offsets);
        }

        model.position.y = -offsets.minY * scale;
        model.position.x = -offsets.cx * scale;
        model.position.z = -offsets.cz * scale;
        scaledHeight = offsets.h * scale;

        if (modelData.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model);
          action = mixer.clipAction(modelData.animations[0]);
          action.setLoop(THREE.LoopRepeat);
          action.play();
        } else {
          model.userData.noAnimations = true;
        }
      }
    } else {
      model = this.createFallbackModel(type);
    }

    enemy.add(model);

    const healthBar = this.createHealthBar(isBoss || (scaleMult > 1));
    healthBar.position.y = scaledHeight + 0.3;
    enemy.add(healthBar);

    enemy.scale.setScalar(0.01);

    const now = performance.now();
    const poolPath = modelData && model && !model.userData.isFallback ? type.model : null;

    enemy.userData = {
      type, health: type.health, maxHealth: type.health,
      model, mixer, action, healthBar,
      poolPath,
      isDead: false, deathTime: 0,
      spawnTime: now,
      swayOffset: Math.random() * Math.PI * 2,
      lastAttackTime: 0, lastShotTime: 0,
      isFlashing: false, scaledHeight,
      canShootThisWave: false,
      spawnAnimating: true,
      nextLeapTime: now + 2000 + Math.random() * 2000,
      isLeaping: false
    };

    if (type.canShoot && !isBoss && this.shootersThisWave < this.maxShootersPerWave) {
      enemy.userData.canShootThisWave = true;
      this.shootersThisWave++;
    }
    if (type.canShoot && isBoss) enemy.userData.canShootThisWave = true;

    this.scene.add(enemy);
    this.enemies.push(enemy);
    return enemy;
  }

  async spawnEnemy(typeIndex, position, isBoss = false) {
    return this.spawnEnemySync(typeIndex, position, isBoss);
  }

  async spawnBoss(bossIndex, position) {
    return this.spawnEnemy(bossIndex, position, true);
  }

  // ── Damage ──

  damageEnemy(enemy, damage, options = {}) {
    if (!enemy || enemy.userData.isDead) return false;

    enemy.userData.health -= damage;

    const pct = Math.max(0, enemy.userData.health / enemy.userData.maxHealth);
    const fill = enemy.userData.healthBar.userData.fill;
    const fillMat = enemy.userData.healthBar.userData.fillMat;
    const width = enemy.userData.healthBar.userData.width;

    fill.scale.x = pct;
    fill.position.x = (1 - pct) * -width / 2;

    if (enemy.userData.type.isBoss) {
      fillMat.color.setHex(pct > 0.3 ? 0xff0000 : 0xff4400);
    } else {
      if (pct > 0.6) fillMat.color.setHex(0x00ff00);
      else if (pct > 0.3) fillMat.color.setHex(0xffff00);
      else fillMat.color.setHex(0xff0000);
    }

    if (!options.skipFlash) this.flashEnemy(enemy);

    if (enemy.userData.health <= 0) {
      this.killEnemy(enemy);
      return true;
    }

    return false;
  }

  flashEnemy(enemy) {
    if (this.preferPoolOnly) return;
    if (enemy.userData.isFlashing) return;
    enemy.userData.isFlashing = true;

    const saved = [];
    enemy.userData.model.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(mat => {
          if (mat.color) {
            saved.push({ mat, color: mat.color.getHex() });
            mat.color.setHex(0xffffff);
          }
        });
      }
    });

    setTimeout(() => {
      saved.forEach(({ mat, color }) => mat.color.setHex(color));
      enemy.userData.isFlashing = false;
    }, 50);
  }

  killEnemy(enemy) {
    if (enemy.userData.isDead) return;

    enemy.userData.isDead = true;
    enemy.userData.deathTime = performance.now();

    if (enemy.userData.action) enemy.userData.action.stop();
    enemy.userData.healthBar.visible = false;

    this.playDeathSound(enemy.userData.type.isBoss);

    if (this.onEnemyDeath) this.onEnemyDeath(enemy);
  }

  removeEnemy(enemy) {
    const idx = this.enemies.indexOf(enemy);
    if (idx === -1) return;

    this.enemies.splice(idx, 1);

    const data = enemy.userData;
    const model = data?.model;
    const healthBar = data?.healthBar;
    const poolPath = data?.poolPath;

    if (data?.mixer) {
      try {
        data.mixer.stopAllAction();
      } catch (e) {}
      data.mixer = null;
    }

    const disposeMeshSubtree = (root) => {
      root.traverse((child) => {
        if (!child.isMesh) return;
        if (!child.userData?.sharedPoolGeometry) child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => {
            if (!m?.userData?.skipDispose) m?.dispose?.();
          });
        } else if (!child.material?.userData?.skipDispose) {
          child.material?.dispose?.();
        }
      });
    };

    if (healthBar) {
      enemy.remove(healthBar);
      disposeMeshSubtree(healthBar);
    }

    if (poolPath && model && !model.userData?.isFallback) {
      enemy.remove(model);
      model.scale.setScalar(1);
      model.position.set(0, 0, 0);
      model.rotation.set(0, 0, 0);
      const pool = this.modelPool.get(poolPath) || [];
      if (pool.length < this.poolReplenishTo) {
        pool.push(model);
      } else {
        disposeMeshSubtree(model);
      }
      this.modelPool.set(poolPath, pool);
      this.scene.remove(enemy);
      return;
    }

    this.scene.remove(enemy);
    // Fallback uses shared Capsule/Sphere geoms + shared materials — never dispose them here.
    if (model && !model.userData?.isFallback) disposeMeshSubtree(model);
  }

  // ── Main Update Loop ──

  update(deltaTime, playerPosition) {
    const now = performance.now();

    if (this.slowMotion && now > this.slowMotionEndTime) {
      this.slowMotion = false;
    }

    const speedMult = this.slowMotion ? 0.25 : 1.0;
    this._updateFrame++;
    const mixerDelta = deltaTime * speedMult;
    this._toPlayer = this._toPlayer || new THREE.Vector3();
    this._perp = this._perp || new THREE.Vector3();
    const doHealthBillboard = !this.preferPoolOnly || this._updateFrame % 2 === 0;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      const data = enemy.userData;

      // ── Death animation ──
      if (data.isDead) {
        const timeDead = now - data.deathTime;
        if (timeDead > 500) {
          this.removeEnemy(enemy);
        } else {
          const t = timeDead / 500;
          enemy.scale.setScalar(1 - t * 0.9);
          enemy.position.y = -t * 0.5;
        }
        continue;
      }

      // ── Spawn scale-in animation ──
      if (data.spawnAnimating) {
        const age = (now - data.spawnTime) / 400;
        if (age >= 1) {
          data.spawnAnimating = false;
          enemy.scale.setScalar(1);
        } else {
          const s = age * age * (3 - 2 * age);
          enemy.scale.setScalar(Math.max(0.01, s));
        }
        const md0 = this._effectiveMixerDelta(i, mixerDelta, !!data.type?.isBoss);
        if (md0 > 0 && data.mixer) data.mixer.update(md0);
        const toPlayer = this._toPlayer;
        toPlayer.subVectors(playerPosition, enemy.position);
        toPlayer.y = 0;
        const sd = toPlayer.length();
        this.applyEnemyFaceYaw(enemy, data, toPlayer, sd, now);
        continue;
      }

      if (this.waveManager?.combatHoldActive) {
        const md1 = this._effectiveMixerDelta(i, mixerDelta, !!data.type?.isBoss);
        if (md1 > 0 && data.mixer) data.mixer.update(md1);
        const toPlayer = this._toPlayer;
        toPlayer.subVectors(playerPosition, enemy.position);
        toPlayer.y = 0;
        this.applyEnemyFaceYaw(enemy, data, toPlayer, toPlayer.length(), now);
        continue;
      }

      // ── Animation mixer ──
      const md2 = this._effectiveMixerDelta(i, mixerDelta, !!data.type?.isBoss);
      if (md2 > 0 && data.mixer) data.mixer.update(md2);

      // ── Fallback model animation ──
      if (data.model.userData.isFallback) {
        const t = (now - data.spawnTime) / 1000;
        const body = data.model.userData.bodyMesh;
        if (body) {
          body.rotation.y = t * 3;
          body.position.y = (data.type.isBoss ? 1.1 : 0.8) + Math.sin(t * 5) * 0.05;
        }
      } else if (data.model.userData.noAnimations) {
        const t = (now - data.spawnTime) / 1000;
        data.model.position.y = Math.sin(t * 4) * 0.1;
        data.model.rotation.y = Math.sin(t * 2) * 0.15;
      }

      // ── Direction to player ──
      const toPlayer = this._toPlayer;
      toPlayer.subVectors(playerPosition, enemy.position);
      toPlayer.y = 0;
      let dist = toPlayer.length();

      // ── Jump Attack leap mechanic ──
      if (data.type.isJumpAttack && !data.isLeaping) {
        if (now > data.nextLeapTime && dist < 15 && dist > 3) {
          data.isLeaping = true;
          data.leapStartTime = now;
          data.leapDuration = 600;
          data.leapStartX = enemy.position.x;
          data.leapStartZ = enemy.position.z;
          data.leapTargetX = playerPosition.x;
          data.leapTargetZ = playerPosition.z;
          data.nextLeapTime = now + 4000 + Math.random() * 2000;
        }
      }

      if (data.isLeaping) {
        const lp = Math.min(1, (now - data.leapStartTime) / data.leapDuration);
        if (lp >= 1) {
          data.isLeaping = false;
          enemy.position.y = 0;
        } else {
          enemy.position.x = data.leapStartX + (data.leapTargetX - data.leapStartX) * lp;
          enemy.position.z = data.leapStartZ + (data.leapTargetZ - data.leapStartZ) * lp;
          enemy.position.y = Math.sin(lp * Math.PI) * 3;
        }
      } else if (dist > 1.5) {
        // ── Behavior-based movement ──
        toPlayer.normalize();
        const perp = this._perp;
        perp.set(-toPlayer.z, 0, toPlayer.x);

        const spdMul = (data.waveSpeedMul ?? 1) * (data.levelSpeedMul ?? 1);
        const spd = data.type.speed * spdMul * speedMult * deltaTime;
        const behavior = data.type.behavior || 'standard';
        let mx = 0, mz = 0;

        switch (behavior) {
          case 'flanker': {
            if (dist > 18) {
              mx = toPlayer.x * spd * 1.55;
              mz = toPlayer.z * spd * 1.55;
            } else if (dist > 8) {
              const a = Math.PI * 0.3;
              const ca = Math.cos(a), sa = Math.sin(a);
              const blend = Math.min(1, (18 - dist) / 10);
              const tx = toPlayer.x * ca - toPlayer.z * sa;
              const tz = toPlayer.x * sa + toPlayer.z * ca;
              mx = (tx * blend + toPlayer.x * (1 - blend)) * spd * 1.25;
              mz = (tz * blend + toPlayer.z * (1 - blend)) * spd * 1.25;
            } else {
              mx = perp.x * spd * 1.3 + toPlayer.x * spd * 0.2;
              mz = perp.z * spd * 1.3 + toPlayer.z * spd * 0.2;
            }
            break;
          }
          case 'charger': {
            const boost = dist < 10 ? 2.0 : dist > 18 ? 1.55 : 1.15;
            mx = toPlayer.x * spd * boost;
            mz = toPlayer.z * spd * boost;
            break;
          }
          case 'tank': {
            const boost = dist > 16 ? 1.35 : 1;
            mx = toPlayer.x * spd * 0.75 * boost;
            mz = toPlayer.z * spd * 0.75 * boost;
            break;
          }
          case 'erratic': {
            const zig = Math.sin((now - data.spawnTime) / 400) * 0.8;
            const towardW = dist > 16 ? 0.92 : dist > 10 ? 0.78 : 0.6;
            const sideW = 1 - towardW;
            mx = (toPlayer.x * towardW + perp.x * zig * sideW) * spd * 1.2;
            mz = (toPlayer.z * towardW + perp.z * zig * sideW) * spd * 1.2;
            break;
          }
          case 'jumper': {
            const bt = (now - data.spawnTime) / 1000;
            enemy.position.y = Math.sin(bt * 2.5) * 0.15;
            const boost = dist > 16 ? 1.35 : 1;
            mx = toPlayer.x * spd * 0.95 * boost;
            mz = toPlayer.z * spd * 0.95 * boost;
            break;
          }
          default: {
            const t = (now - data.spawnTime) / 1000;
            const sway = Math.sin(t * 3 + data.swayOffset) * data.type.swayAmplitude;
            const farBoost = 1 + Math.min(1.15, Math.max(0, dist - 8) * 0.045);
            const sideMag = Math.min(0.22, 2.8 / Math.max(dist, 3)) * sway * spd;
            mx = toPlayer.x * spd * farBoost + perp.x * sideMag;
            mz = toPlayer.z * spd * farBoost + perp.z * sideMag;
            break;
          }
        }

        enemy.position.x += mx;
        enemy.position.z += mz;
      }

      // ── Clamp to arena ──
      enemy.position.x = Math.max(-24, Math.min(24, enemy.position.x));
      enemy.position.z = Math.max(-24, Math.min(24, enemy.position.z));
      if (enemy.position.y < 0 && !data.isLeaping) enemy.position.y = 0;

      toPlayer.subVectors(playerPosition, enemy.position);
      toPlayer.y = 0;
      dist = toPlayer.length();

      this.applyEnemyFaceYaw(enemy, data, toPlayer, dist, now);

      // ── Health bar billboard (lookAt every skinned mesh frame is costly on iOS) ──
      if (data.healthBar.visible && doHealthBillboard) {
        data.healthBar.lookAt(playerPosition);
      }

      // ── Shooting ──
      const si = data.type.shootInterval || 0;
      if (si > 0 && data.type.canShoot && data.canShootThisWave && dist > 3 && dist < 16 && now - data.lastShotTime > si) {
        data.lastShotTime = now;
        this.spawnEnemyProjectile(enemy, playerPosition);
      }
    }

    // ── Update projectiles ──
    const velMult = deltaTime * speedMult;
    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      const proj = this.enemyProjectiles[i];
      const v = proj.userData.velocity;
      proj.position.x += v.x * velMult;
      proj.position.y += v.y * velMult;
      proj.position.z += v.z * velMult;
      proj.rotation.y += deltaTime * 12;
      proj.rotation.x += deltaTime * 6;
      proj.userData.life -= deltaTime;
      if (proj.userData.life <= 0) {
        this.scene.remove(proj);
        this.enemyProjectiles.splice(i, 1);
        if (this._enemyProjPool.length < 48) this._enemyProjPool.push(proj);
      }
    }
  }

  // ── Projectiles ──

  spawnEnemyProjectile(enemy, playerPosition) {
    if (this.enemyProjectiles.length >= this.maxEnemyProjectiles) return;

    const dir = this._projDirScratch.subVectors(playerPosition, enemy.position);
    dir.y = 0;
    if (dir.lengthSq() < 0.01) return;
    dir.normalize().multiplyScalar(6);

    const colorKey = enemy.userData.type.color;
    let mat = this._enemyProjMatByColor.get(colorKey);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: colorKey, side: THREE.DoubleSide });
      this._enemyProjMatByColor.set(colorKey, mat);
    }
    let proj = this._enemyProjPool.pop();
    if (!proj) {
      proj = new THREE.Mesh(this.enemyProjectileGeo, mat);
      proj.rotation.x = Math.PI / 2;
      proj.rotation.z = Math.PI / 2;
    } else {
      proj.material = mat;
    }
    proj.position.copy(enemy.position);
    proj.position.y = enemy.userData.scaledHeight * 0.6;
    const baseDmg = enemy.userData.type.isBoss ? 8 : 4;
    const dmg = Math.round(baseDmg * (enemy.userData.chaosMeleeMul ?? 1) * (enemy.userData.finaleDmgMul ?? 1));
    const vel = proj.userData.velocity || (proj.userData.velocity = { x: 0, y: 0, z: 0 });
    vel.x = dir.x;
    vel.y = dir.y;
    vel.z = dir.z;
    proj.userData.damage = dmg;
    proj.userData.life = 3;
    proj.userData.sharedEnemyProjMat = true;
    this.scene.add(proj);
    this.enemyProjectiles.push(proj);
  }

  getEnemyProjectiles() {
    return this.enemyProjectiles;
  }

  getAliveCount() {
    let count = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      if (!this.enemies[i].userData.isDead) count++;
    }
    return count;
  }

  /** True when no enemy meshes (incl. death animation) and no enemy shots remain. */
  isWaveClearForCinematic() {
    if (this.enemies.length > 0) return false;
    if (this.enemyProjectiles.length > 0) return false;
    return true;
  }

  activateSlowMotion(duration) {
    this.slowMotion = true;
    this.slowMotionEndTime = performance.now() + duration;
  }

  clear() {
    for (const e of [...this.enemies]) this.removeEnemy(e);
    this.enemies = [];
    this.shootersThisWave = 0;
    for (const p of [...this.enemyProjectiles]) {
      this.scene.remove(p);
      if (this._enemyProjPool.length < 48) this._enemyProjPool.push(p);
    }
    this.enemyProjectiles = [];
  }
}
