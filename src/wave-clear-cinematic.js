/**
 * After each cleared wave (before the dare UI): zoom out and play one of three
 * Mixamo victory-style clips, rotating which clip plays each wave.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applyFbxTextureBudget } from './fbx-texture-budget.js';

/** Default (Serena V.) wave-clear clips — copied into each instance; roster may replace paths. */
export const WAVE_CLEAR_MODELS = [
  '/models/wave-clear/aiming-gun.fbx',
  '/models/wave-clear/baseball-hit.fbx',
  '/models/wave-clear/hit-side.fbx'
];

const TARGET_HEIGHT = 1.62;
const ZOOM_DURATION = 1.05;
const ZOOM_BACK = 6.25;
const ZOOM_LIFT = 2.35;
const TARGET_FOV = 92;

function collectAnimations(fbx) {
  let list = [...(fbx.animations || [])];
  if (list.length === 0) {
    fbx.traverse((ch) => {
      if (ch.animations?.length) list = list.concat(ch.animations);
    });
  }
  return list;
}

function skelTrackScore(clip) {
  if (!clip?.tracks?.length) return 0;
  let s = 0;
  for (const t of clip.tracks) {
    const n = (t.name || '').toLowerCase();
    if (n.includes('morph')) continue;
    if (n.includes('mixamorig') || n.includes('.bones[')) s += 2;
    else if (n.includes('quaternion')) s += 1;
  }
  return s;
}

function pickClip(animations) {
  if (!animations?.length) return null;
  const viable = animations.filter(a => a && a.duration > 0.08);
  if (!viable.length) return animations[0];
  const ranked = viable.map(a => ({
    a,
    score: skelTrackScore(a) * 3 + (a.duration > 0.5 ? 2 : 0)
  }));
  ranked.sort((x, y) => y.score - x.score || y.a.duration - x.a.duration);
  return ranked[0].a;
}

function smoothstep(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function disposeModelGraph(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => m.dispose?.());
    }
  });
}

export class WaveClearCinematic {
  /**
   * @param {{ skipFbx?: boolean; deferSkinned?: boolean; textureBudgetMax?: number }} [opts]
   *   skipFbx: no victory FBX — short camera zoom only.
   *   deferSkinned: split clone / mixer across frames (mobile).
   */
  constructor(scene, camera, opts = {}) {
    this.scene = scene;
    this.camera = camera;
    this._skipFbx = opts.skipFbx === true;
    this._deferSkinned = opts.deferSkinned === true;
    this._textureBudgetMax = typeof opts.textureBudgetMax === 'number' ? opts.textureBudgetMax : 0;
    /** Saved look target when `_skipFbx` zoom runs without a clip model. */
    this._liteLook = new THREE.Vector3();
    this.loader = new FBXLoader();
    this.cache = new Map();
    /** One pooled clone per clip path — avoids per-wave SkeletonUtils.clone + dispose (iOS GPU churn). */
    this._instancePool = new Map();
    /** Active FBX list for the selected fighter (default: Serena). */
    this._wavePaths = [...WAVE_CLEAR_MODELS];

    this.active = false;
    this.model = null;
    this.mixer = null;
    this.action = null;
    this.clipDuration = 2.8;

    this.savedPos = new THREE.Vector3();
    this.savedQuat = new THREE.Quaternion();
    this.savedFov = 75;

    this.zoomElapsed = 0;
    this.totalElapsed = 0;

    this._zoomPos = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._look = new THREE.Vector3();

    this._onDone = null;
    this._wcBootQueue = null;
  }

  /** True when every wave-clear file for the active path list is cached. */
  isFullyLoaded() {
    if (this._skipFbx) return true;
    return this._wavePaths.every((p) => this.cache.has(p));
  }

  /** Free wave-clear FBX data so another fighter's set can load. */
  purgeCaches() {
    for (const [, meta] of this.cache) {
      if (meta?.fbx) {
        try {
          disposeModelGraph(meta.fbx);
        } catch (e) {}
      }
    }
    this.cache.clear();
    for (const [, arr] of this._instancePool) {
      if (!arr) continue;
      for (const clone of arr) {
        try {
          disposeModelGraph(clone);
        } catch (e) {}
      }
    }
    this._instancePool.clear();
  }

  /**
   * Replace which three victory clips rotate per wave; purges any cached FBX not in the new list.
   * @param {string[]} paths
   */
  setWavePaths(paths) {
    const next = (paths || []).filter(Boolean);
    if (next.length === 0) return;
    if (next.length === this._wavePaths.length && next.every((p, i) => p === this._wavePaths[i])) {
      return;
    }
    this.purgeCaches();
    this._wavePaths = next.slice();
  }

  /** Await if mobile deferred preload — call before start(). */
  ensureLoaded() {
    if (this.isFullyLoaded()) return Promise.resolve();
    return this.preload();
  }

  /**
   * @param {{ serial?: boolean }} [options] Use `serial: true` on mobile to avoid parallel FBX decode spikes.
   */
  preload(options = {}) {
    if (this.isFullyLoaded()) return Promise.resolve();
    if (this._skipFbx) return Promise.resolve();

    const loadOne = (path) =>
      new Promise((resolve) => {
        if (this.cache.has(path)) return resolve();
        this.loader.load(
          path,
          (fbx) => {
            fbx.updateMatrixWorld(true);
            if (this._textureBudgetMax > 0) {
              try {
                applyFbxTextureBudget(fbx, { maxSize: this._textureBudgetMax });
              } catch (e) {
                console.warn('WaveClearCinematic: texture budget', e);
              }
            }
            const animations = collectAnimations(fbx);
            const box = new THREE.Box3().setFromObject(fbx);
            const size = box.getSize(new THREE.Vector3());
            this.cache.set(path, {
              fbx,
              animations,
              originalHeight: size.y || 1
            });
            try {
              const warm = SkeletonUtils.clone(fbx);
              const arr = this._instancePool.get(path) || [];
              if (arr.length < 1) {
                arr.push(warm);
                this._instancePool.set(path, arr);
              }
            } catch (e) {
              console.warn('WaveClearCinematic: pool warm failed', path, e);
            }
            resolve();
          },
          undefined,
          () => {
            console.warn('WaveClearCinematic: failed to load', path);
            resolve();
          }
        );
      });

    if (options.serial === true) {
      return (async () => {
        for (const path of this._wavePaths) {
          await loadOne(path);
          await new Promise((r) => requestAnimationFrame(r));
        }
      })();
    }

    return Promise.all(this._wavePaths.map((path) => loadOne(path)));
  }

  /**
   * @param {number} completedWave 1-based wave just cleared
   * @param {import('./player.js').Player} player
   * @param {number} playerYaw radians (camera facing on XZ)
   * @param {() => void} onComplete — show dare screen after this
   */
  start(completedWave, player, playerYaw, onComplete) {
    if (this.active) this.stop(false);

    const n = this._wavePaths.length || 1;
    const idx = (completedWave - 1) % n;
    const path = this._wavePaths[idx];
    const meta = this.cache.get(path);

    if (this._skipFbx) {
      this._onDone = onComplete;
      this.active = true;
      this.zoomElapsed = 0;
      this.totalElapsed = 0;
      this.model = null;
      this.mixer = null;
      this.action = null;
      this.savedPos.copy(this.camera.position);
      this.savedQuat.copy(this.camera.quaternion);
      if (this.camera.isPerspectiveCamera) this.savedFov = this.camera.fov;
      this._fwd.set(-Math.sin(playerYaw), 0, -Math.cos(playerYaw));
      this._zoomPos.copy(this.savedPos);
      this._zoomPos.addScaledVector(this._fwd, -ZOOM_BACK);
      this._zoomPos.y += ZOOM_LIFT;
      this._liteLook.set(player.body.position.x, player.body.position.y + 1.15, player.body.position.z);
      this.clipDuration = 0.95;
      return;
    }

    if (!meta) {
      queueMicrotask(() => onComplete?.());
      return;
    }

    this._onDone = onComplete;
    this.active = true;
    this.zoomElapsed = 0;
    this.totalElapsed = 0;

    this.savedPos.copy(this.camera.position);
    this.savedQuat.copy(this.camera.quaternion);
    if (this.camera.isPerspectiveCamera) this.savedFov = this.camera.fov;

    this._fwd.set(-Math.sin(playerYaw), 0, -Math.cos(playerYaw));
    this._zoomPos.copy(this.savedPos);
    this._zoomPos.addScaledVector(this._fwd, -ZOOM_BACK);
    this._zoomPos.y += ZOOM_LIFT;

    const px = player.body.position.x;
    const pz = player.body.position.z;
    const py = player.body.position.y;

    if (this._deferSkinned) {
      this._wcBootQueue = [
        () => {
          const pool = this._instancePool.get(path);
          let model = pool && pool.length ? pool.pop() : null;
          if (!model) model = SkeletonUtils.clone(meta.fbx);
          model.userData._waveClearPoolPath = path;
          this.model = model;
          const scale = TARGET_HEIGHT / (meta.originalHeight || 1);
          this.model.scale.setScalar(scale);
          const box = new THREE.Box3().setFromObject(this.model);
          this.model.position.set(px, py - box.min.y, pz);
          this.model.rotation.y = playerYaw + Math.PI;
          this.scene.add(this.model);
        },
        () => {
          const clip = pickClip(meta.animations);
          if (clip) {
            this.mixer = new THREE.AnimationMixer(this.model);
            this.action = this.mixer.clipAction(clip);
            this.action.reset();
            this.action.setLoop(THREE.LoopOnce, 1);
            this.action.clampWhenFinished = true;
            this.action.enabled = true;
            this.action.setEffectiveWeight(1);
            this.action.play();
            this.mixer.update(0.001);
            this.clipDuration = Math.min(Math.max(clip.duration, 1.2), 12);
          } else {
            this.clipDuration = 2.2;
          }
        }
      ];
      return;
    }

    const pool = this._instancePool.get(path);
    let model = pool && pool.length ? pool.pop() : null;
    if (!model) {
      model = SkeletonUtils.clone(meta.fbx);
    }
    model.userData._waveClearPoolPath = path;
    this.model = model;
    const scale = TARGET_HEIGHT / (meta.originalHeight || 1);
    this.model.scale.setScalar(scale);
    const box = new THREE.Box3().setFromObject(this.model);
    this.model.position.set(px, py - box.min.y, pz);
    this.model.rotation.y = playerYaw + Math.PI;

    this.scene.add(this.model);

    const clip = pickClip(meta.animations);
    if (clip) {
      this.mixer = new THREE.AnimationMixer(this.model);
      this.action = this.mixer.clipAction(clip);
      this.action.reset();
      this.action.setLoop(THREE.LoopOnce, 1);
      this.action.clampWhenFinished = true;
      this.action.enabled = true;
      this.action.setEffectiveWeight(1);
      this.action.play();
      this.mixer.update(0.001);
      this.clipDuration = Math.min(Math.max(clip.duration, 1.2), 12);
    } else {
      this.clipDuration = 2.2;
    }
  }

  update(delta) {
    if (!this.active) return false;

    if (this._wcBootQueue?.length) {
      const job = this._wcBootQueue.shift();
      try {
        job();
      } catch (e) {
        console.warn('WaveClearCinematic boot step', e);
      }
      if (this._wcBootQueue.length === 0) this._wcBootQueue = null;
      return false;
    }

    this.totalElapsed += delta;
    this.zoomElapsed += delta;

    const zt = smoothstep(this.zoomElapsed / ZOOM_DURATION);
    this.camera.position.lerpVectors(this.savedPos, this._zoomPos, zt);

    if (this.model) {
      this._look.set(
        this.model.position.x,
        this.model.position.y + TARGET_HEIGHT * 0.42,
        this.model.position.z
      );
      this.camera.lookAt(this._look);
    } else if (this._skipFbx) {
      this.camera.lookAt(this._liteLook);
    }

    if (this.camera.isPerspectiveCamera) {
      this.camera.fov = THREE.MathUtils.lerp(this.savedFov, TARGET_FOV, zt);
      this.camera.updateProjectionMatrix();
    }

    if (this.mixer) this.mixer.update(delta);

    const animDone =
      (this.action && this.action.time >= this.clipDuration - 0.05) ||
      this.totalElapsed >= this.clipDuration + 0.25;

    if (animDone) {
      this.stop(true);
      return true;
    }
    return false;
  }

  stop(callDone) {
    if (!this.active && !this.model && !this.mixer) return;

    this._wcBootQueue = null;

    if (this.camera.isPerspectiveCamera) {
      this.camera.fov = this.savedFov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.copy(this.savedPos);
    this.camera.quaternion.copy(this.savedQuat);

    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.action = null;

    if (this.model) {
      const path = this.model.userData._waveClearPoolPath;
      this.scene.remove(this.model);
      if (path) {
        const arr = this._instancePool.get(path) || [];
        if (arr.length < 1) {
          arr.push(this.model);
          this._instancePool.set(path, arr);
        } else {
          disposeModelGraph(this.model);
        }
      } else {
        disposeModelGraph(this.model);
      }
      this.model = null;
    }

    const cb = this._onDone;
    this._onDone = null;
    this.active = false;

    if (callDone) cb?.();
  }
}

