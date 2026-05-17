/**
 * Disco Vortex special: third-person dance + spiral projectiles + radial damage.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applyFbxTextureBudget } from './fbx-texture-budget.js';

export const SPECIAL_CHARGE_KILLS = 11;

export const DEFAULT_SPECIAL_MODEL = '/models/special/NorthernSoulSpin.fbx';
const TARGET_HEIGHT = 1.65;

function disposeModelGraph(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => m.dispose?.());
    }
  });
}

const RADIAL_INTERVAL = 0.14;
const RADIAL_RADIUS = 8.5;
const RADIAL_DAMAGE = 22;
const ORB_SPAWN_PER_SEC = 14;
const ORB_SPEED = 24;
const ORB_LIFETIME = 0.55;
const ORB_HIT_RADIUS = 1.15;
const ORB_DAMAGE = 34;

function collectAnimations(fbx) {
  let list = [...(fbx.animations || [])];
  if (list.length === 0) {
    fbx.traverse((ch) => {
      if (ch.animations?.length) list = list.concat(ch.animations);
    });
  }
  const seen = new Set();
  const out = [];
  for (const clip of list) {
    if (!clip) continue;
    const key = `${clip.name}|${clip.duration}|${clip.tracks?.length ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clip);
  }
  return out;
}

/** Prefer clips that actually drive the Mixamo / bone rig (avoids morph-only or empty stacks → T-pose). */
function skelTrackScore(clip) {
  if (!clip?.tracks?.length) return 0;
  let s = 0;
  for (const t of clip.tracks) {
    const n = (t.name || '').toLowerCase();
    if (n.includes('morph')) continue;
    if (n.includes('mixamorig') || n.includes('.bones[')) s += 2;
    else if (n.includes('quaternion') && (n.includes('spine') || n.includes('hips') || n.includes('arm') || n.includes('leg'))) s += 1;
  }
  return s;
}

function pickClip(animations) {
  if (!animations?.length) return null;
  const lower = (n) => (n || '').toLowerCase();
  const viable = animations.filter(a => a && a.duration > 0.08);
  if (!viable.length) return animations[0] || null;

  const badName = (name) => {
    const n = lower(name);
    return n.includes('t-pose') || n.includes('tpose') || n.includes('bind') || n.includes('reference');
  };

  const pool = viable.filter(a => !badName(a.name));
  const use = pool.length ? pool : viable;

  const ranked = use.map(a => {
    const n = lower(a.name);
    let score = skelTrackScore(a) * 3;
    if (n.includes('take')) score += 25;
    if (n.includes('spin') || n.includes('soul') || n.includes('northern')) score += 40;
    if (n.includes('gangnam') || n.includes('style')) score += 42;
    if (n.includes('thriller')) score += 44;
    if (n.includes('dance') || n.includes('combo')) score += 12;
    return { a, score };
  });
  ranked.sort((x, y) => y.score - x.score || y.a.duration - x.a.duration);
  return ranked[0].a;
}

export class SpecialAttackController {
  /**
   * @param {THREE.Scene} scene
   * @param {{ maxOrbs?: number; lightMode?: boolean; lowTierSpecial?: boolean; textureBudgetMax?: number }} [opts]
   *   lightMode throttles burst work per frame (mobile).
   *   lowTierSpecial: same hero FBX + vortex look; shared orb GPU buffers + slightly lighter sphere mesh.
   *   skipHeroFbx: no NorthernSoul FBX — cheap placeholder mesh + vortex only (mobile tab survival).
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this._skipHeroFbx = opts.skipHeroFbx === true;
    this._textureBudgetMax = typeof opts.textureBudgetMax === 'number' ? opts.textureBudgetMax : 0;
    this.loader = new FBXLoader();
    this.cache = null;
    this.loading = null;
    /** Third-person special dance FBX — swapped per selected fighter. */
    this._modelPath = DEFAULT_SPECIAL_MODEL;

    this.active = false;
    this.heroGroup = new THREE.Group();
    this.heroModel = null;
    this.mixer = null;
    this.action = null;
    this.clipDuration = 4.5;

    this.lockYaw = 0;
    this.elapsed = 0;
    this.radialTimer = 0;
    this.spawnAcc = 0;
    this.vortexAngle = 0;
    this.emitRing = 0;

    this.orbs = [];
    this.orbPool = [];
    this._lightMode = opts.lightMode === true;
    this._lowTierSpecial = opts.lowTierSpecial === true;
    const cap = opts.maxOrbs ?? 90;
    const minOrbs = this._lowTierSpecial ? 4 : this._lightMode ? 5 : 16;
    this.maxOrbs = Math.max(minOrbs, Math.min(120, cap));
    if (!this._lightMode) {
      this._radialBurstCap = 14;
      this._spawnBurstCap = 16;
      this._orbSpawnMul = 1;
    } else if (this._lowTierSpecial) {
      this._radialBurstCap = 2;
      this._spawnBurstCap = 3;
      this._orbSpawnMul = 0.32;
    } else {
      this._radialBurstCap = 3;
      this._spawnBurstCap = 5;
      this._orbSpawnMul = 0.4;
    }

    const ow = this._lowTierSpecial ? 4 : 6;
    const oh = this._lowTierSpecial ? 4 : 5;
    this._orbSharedGeo = new THREE.SphereGeometry(0.11, ow, oh);
    this._orbSharedMat = new THREE.MeshBasicMaterial({
      color: 0xff00cc,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this._forward = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._look = new THREE.Vector3();

    this.onDamage = null;
    this.onEnd = null;
    this.enemyManager = null;

    /** Reuse one hero FBX clone between specials to avoid repeated clone/dispose GPU churn. */
    this._heroModelPool = [];
    /** Mobile: run clone / scene.add / mixer on separate frames (see `update`). */
    this._bootQueue = null;
  }

  _invalidateHeroCache() {
    if (this.loading) {
      this.loading.catch(() => {});
      this.loading = null;
    }
    if (this.cache?.fbx) {
      try {
        disposeModelGraph(this.cache.fbx);
      } catch (e) {}
      this.cache = null;
    }
    while (this._heroModelPool.length) {
      const m = this._heroModelPool.pop();
      if (m) {
        try {
          disposeModelGraph(m);
        } catch (e) {}
      }
    }
  }

  /**
   * @param {string} path e.g. `/models/characters/timmy/special/gangnam-style.fbx`
   */
  async setModelPath(path) {
    const next = String(path || '').trim() || DEFAULT_SPECIAL_MODEL;
    if (next === this._modelPath && this.cache) return;
    if (this.loading) {
      try {
        await this.loading;
      } catch (e) {}
    }
    this._invalidateHeroCache();
    this._modelPath = next;
  }

  canStart() {
    return !!this.cache && !this.active;
  }

  preload() {
    if (this.cache) return Promise.resolve(this.cache);
    if (this.loading) return this.loading;

    if (this._skipHeroFbx) {
      this.cache = { fbx: null, originalHeight: TARGET_HEIGHT, animations: [] };
      this.loading = null;
      return Promise.resolve(this.cache);
    }

    const url = this._modelPath;
    this.loading = new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (fbx) => {
          if (this._textureBudgetMax > 0) {
            try {
              applyFbxTextureBudget(fbx, { maxSize: this._textureBudgetMax });
            } catch (e) {
              console.warn('SpecialAttack: texture budget', e);
            }
          }
          fbx.updateMatrixWorld(true);
          const animations = collectAnimations(fbx);
          const box = new THREE.Box3().setFromObject(fbx);
          const size = box.getSize(new THREE.Vector3());
          this.cache = { fbx, originalHeight: size.y || 1, animations };
          this.loading = null;
          // Mobile (`lightMode`): pre-clone once at load so the first special tap never pays
          // a synchronous SkeletonUtils.clone on the input frame (iOS tab reload).
          if (this._lightMode && this._heroModelPool.length < 1) {
            try {
              const warm = SkeletonUtils.clone(this.cache.fbx);
              warm.updateMatrixWorld(true);
              this._heroModelPool.push(warm);
            } catch (e) {
              console.warn('SpecialAttack: hero prewarm clone failed', e);
            }
          }
          resolve(this.cache);
        },
        undefined,
        (err) => {
          this.loading = null;
          console.warn('SpecialAttack: failed to load', url, err);
          reject(err);
        }
      );
    });
    return this.loading;
  }

  /** Grow orb pool by at most `maxAdds` meshes (mobile spreads work across frames). */
  _growOrbPool(maxAdds = 1024) {
    let added = 0;
    while (this.orbPool.length < this.maxOrbs && added < maxAdds) {
      const mesh = new THREE.Mesh(this._orbSharedGeo, this._orbSharedMat);
      mesh.visible = false;
      mesh.userData = { active: false, life: 0, vx: 0, vy: 0, vz: 0, hitIds: null };
      this.scene.add(mesh);
      this.orbPool.push(mesh);
      added++;
    }
  }

  _ensureOrbPool() {
    this._growOrbPool(1024);
  }

  start(lockYaw, enemyManager, callbacks) {
    if (!this.cache || this.active) return;
    this._bootQueue = null;
    this.enemyManager = enemyManager;
    this.onDamage = callbacks.onDamage;
    this.onEnd = callbacks.onEnd;
    /** @type {((kind: string, px: number, py: number, pz: number, dmg: number) => number) | null} */
    this._tryDamageFinaleBoss = typeof callbacks.tryDamageFinaleBoss === 'function' ? callbacks.tryDamageFinaleBoss : null;
    this.lockYaw = lockYaw;
    this.elapsed = 0;
    this.radialTimer = 0;
    this.spawnAcc = 0;
    this.vortexAngle = 0;
    this.emitRing = 0;
    this.active = true;

    this.heroGroup.rotation.y = this.lockYaw;

    if (!this.cache.fbx) {
      const geo = new THREE.CylinderGeometry(0.32, 0.4, 1.15, 8, 1);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff22aa,
        transparent: true,
        opacity: 0.95
      });
      this.heroModel = new THREE.Mesh(geo, mat);
      this.heroModel.position.y = 0.58;
      this.heroModel.rotation.y = Math.PI;
      this.heroGroup.add(this.heroModel);
      this.scene.add(this.heroGroup);
      this.mixer = null;
      this.action = null;
      this.clipDuration = 3.85;
    } else if (this._lightMode) {
      this._bootQueue = [
        () => {
          this.heroModel = this._heroModelPool.length
            ? this._heroModelPool.pop()
            : SkeletonUtils.clone(this.cache.fbx);
          this.heroModel.updateMatrixWorld(true);
          const scale = TARGET_HEIGHT / (this.cache.originalHeight || 1);
          this.heroModel.scale.setScalar(scale);
          const box = new THREE.Box3().setFromObject(this.heroModel);
          this.heroModel.position.set(0, -box.min.y, 0);
          this.heroModel.rotation.y = Math.PI;
        },
        () => {
          this.heroGroup.add(this.heroModel);
          this.scene.add(this.heroGroup);
        },
        () => {
          const clip = pickClip(this.cache.animations);
          if (clip) {
            this.mixer = new THREE.AnimationMixer(this.heroModel);
            this.action = this.mixer.clipAction(clip);
            this.action.reset();
            this.action.setLoop(THREE.LoopOnce, 1);
            this.action.clampWhenFinished = true;
            this.action.enabled = true;
            this.action.setEffectiveWeight(1);
            this.action.play();
            this.mixer.update(0.001);
            this.clipDuration = Math.min(Math.max(clip.duration, 2.2), 9);
          } else {
            this.clipDuration = 4;
          }
        },
        () => {
          this._growOrbPool(this._lowTierSpecial ? 2 : 2);
        }
      ];
    } else {
      this.cache.fbx.updateMatrixWorld(true);
      this.heroModel = this._heroModelPool.length
        ? this._heroModelPool.pop()
        : SkeletonUtils.clone(this.cache.fbx);
      this.heroModel.updateMatrixWorld(true);
      const scale = TARGET_HEIGHT / (this.cache.originalHeight || 1);
      this.heroModel.scale.setScalar(scale);
      const box = new THREE.Box3().setFromObject(this.heroModel);
      this.heroModel.position.set(0, -box.min.y, 0);
      this.heroModel.rotation.y = Math.PI;

      this.heroGroup.add(this.heroModel);
      this.scene.add(this.heroGroup);

      const clip = pickClip(this.cache.animations);
      if (clip) {
        this.mixer = new THREE.AnimationMixer(this.heroModel);
        this.action = this.mixer.clipAction(clip);
        this.action.reset();
        this.action.setLoop(THREE.LoopOnce, 1);
        this.action.clampWhenFinished = true;
        this.action.enabled = true;
        this.action.setEffectiveWeight(1);
        this.action.play();
        this.mixer.update(0.001);
        this.clipDuration = Math.min(Math.max(clip.duration, 2.2), 9);
      } else {
        this.clipDuration = 4;
      }
    }

    if (!this._lightMode) {
      this._ensureOrbPool();
    }
  }

  _spawnOrb(px, py, pz, dirx, diry, dirz) {
    const mesh = this.orbPool.find(m => !m.userData.active);
    if (!mesh) return;
    const len = Math.sqrt(dirx * dirx + diry * diry + dirz * dirz) || 1;
    mesh.userData.active = true;
    mesh.userData.life = ORB_LIFETIME;
    mesh.userData.vx = (dirx / len) * ORB_SPEED;
    mesh.userData.vy = (diry / len) * ORB_SPEED;
    mesh.userData.vz = (dirz / len) * ORB_SPEED;
    let hid = mesh.userData.hitIds;
    if (!hid) {
      hid = new Set();
      mesh.userData.hitIds = hid;
    } else {
      hid.clear();
    }
    mesh.position.set(px, py, pz);
    mesh.visible = true;
    this.orbs.push(mesh);
  }

  _updateOrbs(delta) {
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const m = this.orbs[i];
      const u = m.userData;
      u.life -= delta;
      m.position.x += u.vx * delta;
      m.position.y += u.vy * delta;
      m.position.z += u.vz * delta;

      if (this.enemyManager) {
        for (const enemy of this.enemyManager.enemies) {
          if (enemy.userData.isDead) continue;
          if (u.hitIds.has(enemy.uuid)) continue;
          const dx = enemy.position.x - m.position.x;
          const dy = (enemy.position.y + 0.8) - m.position.y;
          const dz = enemy.position.z - m.position.z;
          if (dx * dx + dz * dz < ORB_HIT_RADIUS * ORB_HIT_RADIUS && Math.abs(dy) < 1.8) {
            u.hitIds.add(enemy.uuid);
            this.enemyManager.damageEnemy(enemy, ORB_DAMAGE, this._lightMode ? { skipFlash: true } : undefined);
            this.onDamage?.(ORB_DAMAGE);
            u.life = 0;
            break;
          }
        }
      }

      if (u.life > 0 && this._tryDamageFinaleBoss) {
        const bd = this._tryDamageFinaleBoss('orb', m.position.x, m.position.y, m.position.z, ORB_DAMAGE);
        if (bd > 0) {
          this.onDamage?.(bd);
          u.life = 0;
        }
      }

      if (u.life <= 0) {
        u.active = false;
        m.visible = false;
        this.orbs.splice(i, 1);
      }
    }
  }

  _radialBurst(px, py, pz) {
    if (!this.enemyManager) return;
    for (const enemy of this.enemyManager.enemies) {
      if (enemy.userData.isDead) continue;
      const dx = enemy.position.x - px;
      const dz = enemy.position.z - pz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < RADIAL_RADIUS) {
        const fall = 1 - d / RADIAL_RADIUS;
        const dmg = Math.round(RADIAL_DAMAGE * (0.45 + fall * 0.55));
        this.enemyManager.damageEnemy(enemy, dmg, this._lightMode ? { skipFlash: true } : undefined);
        this.onDamage?.(dmg);
      }
    }
    if (this._tryDamageFinaleBoss) {
      const bd = this._tryDamageFinaleBoss('radial', px, py, pz, RADIAL_DAMAGE);
      if (bd > 0) this.onDamage?.(bd);
    }
  }

  _updateCamera(camera, px, py, pz) {
    this._forward.set(-Math.sin(this.lockYaw), 0, -Math.cos(this.lockYaw));
    this._camPos.set(px, py, pz);
    this._camPos.addScaledVector(this._forward, -5.25);
    this._camPos.y += 2.38;
    camera.position.copy(this._camPos);
    this._look.set(px, py + 1.05, pz);
    camera.lookAt(this._look);
  }

  update(delta, player, camera) {
    if (!this.active) return;

    if (this._bootQueue?.length) {
      const job = this._bootQueue.shift();
      try {
        job();
      } catch (e) {
        console.warn('SpecialAttack boot step', e);
      }
      if (this._bootQueue.length === 0) this._bootQueue = null;
      return;
    }

    if (this._lightMode && this.orbPool.length < this.maxOrbs) {
      this._growOrbPool(this._lowTierSpecial ? 3 : 4);
    }

    const px = player.body.position.x;
    const py = player.body.position.y;
    const pz = player.body.position.z;

    this.heroGroup.position.set(px, py, pz);

    if (!this.cache?.fbx && this.heroModel) {
      this.heroModel.rotation.y += delta * 2.4;
    }

    if (this.mixer) this.mixer.update(delta);
    this.elapsed += delta;
    this.vortexAngle += delta * 7.5;

    this.radialTimer += delta;
    let radialBursts = this._radialBurstCap;
    while (this.radialTimer >= RADIAL_INTERVAL && radialBursts-- > 0) {
      this.radialTimer -= RADIAL_INTERVAL;
      this._radialBurst(px, py, pz);
    }

    this.spawnAcc += delta * ORB_SPAWN_PER_SEC * this._orbSpawnMul;
    let spawnBurst = this._spawnBurstCap;
    while (this.spawnAcc >= 1 && spawnBurst-- > 0) {
      this.spawnAcc -= 1;
      const ring = (this.emitRing++ % 5) * 0.14;
      const r = 0.35 + ring;
      const a = this.vortexAngle + this.emitRing * 0.55;
      const ox = Math.cos(a) * r;
      const oz = Math.sin(a) * r;
      const oy = 0.55 + (this.emitRing % 4) * 0.22;
      const dirx = Math.cos(a) * 0.85 + (Math.random() - 0.5) * 0.15;
      const dirz = Math.sin(a) * 0.85 + (Math.random() - 0.5) * 0.15;
      const diry = 0.35 + Math.random() * 0.55;
      this._spawnOrb(px + ox, py + oy, pz + oz, dirx, diry, dirz);
    }

    this._updateOrbs(delta);
    this._updateCamera(camera, px, py, pz);

    const done = this.elapsed >= this.clipDuration;
    if (done) {
      const endCb = this.onEnd;
      this.stop();
      endCb?.();
    }
  }

  stop() {
    this.active = false;

    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.action = null;

    if (this.heroModel) {
      this.heroGroup.remove(this.heroModel);
      if (this._skipHeroFbx) {
        this.heroModel.geometry?.dispose();
        const mats = Array.isArray(this.heroModel.material)
          ? this.heroModel.material
          : [this.heroModel.material];
        mats.forEach((m) => m?.dispose?.());
      } else if (this._heroModelPool.length < 1) {
        this._heroModelPool.push(this.heroModel);
      } else {
        this.heroModel.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => m.dispose?.());
          }
        });
      }
      this.heroModel = null;
    }
    if (this.heroGroup.parent) this.scene.remove(this.heroGroup);

    for (const m of this.orbs) {
      m.userData.active = false;
      m.visible = false;
    }
    this.orbs.length = 0;

    this.onDamage = null;
    this.onEnd = null;
    this._tryDamageFinaleBoss = null;
    this.enemyManager = null;
    this._bootQueue = null;
  }
}
