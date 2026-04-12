/**
 * After each cleared wave (before the dare UI): zoom out and play one of three
 * Mixamo victory-style clips, rotating which clip plays each wave.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

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

export class WaveClearCinematic {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.loader = new FBXLoader();
    this.cache = new Map();

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
  }

  /** True when every wave-clear file loaded successfully. */
  isFullyLoaded() {
    return WAVE_CLEAR_MODELS.every((p) => this.cache.has(p));
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

    const loadOne = (path) =>
      new Promise((resolve) => {
        if (this.cache.has(path)) return resolve();
        this.loader.load(
          path,
          (fbx) => {
            fbx.updateMatrixWorld(true);
            const animations = collectAnimations(fbx);
            const box = new THREE.Box3().setFromObject(fbx);
            const size = box.getSize(new THREE.Vector3());
            this.cache.set(path, {
              fbx,
              animations,
              originalHeight: size.y || 1
            });
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
        for (const path of WAVE_CLEAR_MODELS) {
          await loadOne(path);
          await new Promise((r) => requestAnimationFrame(r));
        }
      })();
    }

    return Promise.all(WAVE_CLEAR_MODELS.map((path) => loadOne(path)));
  }

  /**
   * @param {number} completedWave 1-based wave just cleared
   * @param {import('./player.js').Player} player
   * @param {number} playerYaw radians (camera facing on XZ)
   * @param {() => void} onComplete — show dare screen after this
   */
  start(completedWave, player, playerYaw, onComplete) {
    if (this.active) this.stop(false);

    const idx = (completedWave - 1) % WAVE_CLEAR_MODELS.length;
    const path = WAVE_CLEAR_MODELS[idx];
    const meta = this.cache.get(path);

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

    this.model = SkeletonUtils.clone(meta.fbx);
    const scale = TARGET_HEIGHT / (meta.originalHeight || 1);
    this.model.scale.setScalar(scale);
    const box = new THREE.Box3().setFromObject(this.model);
    const px = player.body.position.x;
    const pz = player.body.position.z;
    const py = player.body.position.y;
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
      this.scene.remove(this.model);
      this.model.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach(m => m.dispose?.());
        }
      });
      this.model = null;
    }

    const cb = this._onDone;
    this._onDone = null;
    this.active = false;

    if (callDone) cb?.();
  }
}

