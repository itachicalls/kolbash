/**
 * Full-screen death cinematic: plays Dying.fbx once, then signals completion.
 * Camera + spotlight track the animated bounds so she stays centered while falling.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const MODEL_PATH = '/models/Dying.fbx';
const TARGET_HEIGHT = 1.75;

function pickDeathClip(animations) {
  if (!animations || animations.length === 0) return null;
  const lower = (n) => (n || '').toLowerCase();
  let clip =
    animations.find(a => lower(a.name).includes('dying')) ||
    animations.find(a => lower(a.name).includes('death')) ||
    animations.find(a => lower(a.name).includes('die')) ||
    animations[0];
  return clip;
}

export class DeathScene {
  constructor() {
    this.loader = new FBXLoader();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030208);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
    this.clock = new THREE.Clock();

    this._box = new THREE.Box3();
    this._size = new THREE.Vector3();
    this._focus = new THREE.Vector3();

    // Dim fill so the spotlight reads clearly
    this.ambient = new THREE.AmbientLight(0x334455, 0.09);
    this.scene.add(this.ambient);
    const fill = new THREE.DirectionalLight(0x446688, 0.12);
    fill.position.set(-3, 2, -2);
    this.scene.add(fill);

    this.spotLight = new THREE.SpotLight(0xfff2e6, 220, 0, Math.PI * 0.19, 0.42, 1.85);
    this.spotLight.castShadow = false;
    this.scene.add(this.spotLight);
    this.scene.add(this.spotLight.target);

    this._cache = null;
    this._loading = null;
    this.active = false;
    /** World XZ where death anim started — camera stays over this spot while she falls “in place”. */
    this._framingAnchor = new THREE.Vector3();
    this._framingReady = false;
    this.model = null;
    this.mixer = null;
    this.action = null;
    this.clip = null;
    this._onFinished = null;
    this._finished = false;
    this._maxTime = 12;
    this._elapsed = 0;
  }

  preload() {
    if (this._cache) return Promise.resolve(this._cache);
    if (this._loading) return this._loading;

    this._loading = new Promise((resolve, reject) => {
      this.loader.load(
        MODEL_PATH,
        (fbx) => {
          let animations = fbx.animations || [];
          fbx.traverse((child) => {
            if (child.animations?.length) animations = animations.concat(child.animations);
          });
          const box = new THREE.Box3().setFromObject(fbx);
          const size = box.getSize(new THREE.Vector3());
          this._cache = { fbx, originalHeight: size.y || 1, animations };
          this._loading = null;
          resolve(this._cache);
        },
        undefined,
        (err) => {
          this._loading = null;
          console.warn('DeathScene: failed to load', MODEL_PATH, err);
          reject(err);
        }
      );
    });
    return this._loading;
  }

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} aspect
   * @param {number} deathYaw radians — player / camera facing on XZ
   * @param {() => void} onComplete
   */
  start(renderer, aspect, deathYaw, onComplete) {
    this._deathYaw = deathYaw;
    this._onFinished = onComplete;
    this._finished = false;
    this._elapsed = 0;
    this._framingReady = false;
    this.active = true;

    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    this._clearNonLights();

    if (!this._cache) {
      this.active = false;
      queueMicrotask(() => onComplete?.());
      return;
    }

    const root = SkeletonUtils.clone(this._cache.fbx);
    this.model = root;

    const h = this._cache.originalHeight || 1;
    const scale = TARGET_HEIGHT / h;
    root.scale.setScalar(scale);

    const box = new THREE.Box3().setFromObject(root);
    const minY = box.min.y;
    root.position.set(0, -minY, 0);

    root.rotation.y = deathYaw + Math.PI * 0.12;

    this.scene.add(root);

    const clip = pickDeathClip(this._cache.animations);
    if (clip) {
      this.clip = clip;
      this.mixer = new THREE.AnimationMixer(root);
      this.action = this.mixer.clipAction(clip);
      this.action.reset();
      this.action.setLoop(THREE.LoopOnce, 1);
      this.action.clampWhenFinished = true;
      this.action.play();
      this._maxTime = Math.min(clip.duration + 1.8, 16);
    } else {
      this._maxTime = 3;
    }

    if (this.mixer) this.mixer.update(0.0001);
    this._frameCameraAndSpot();
    renderer.setClearColor(0x030208, 1);
    renderer.render(this.scene, this.camera);
  }

  _clearNonLights() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.action = null;
    this.clip = null;
    for (let i = this.scene.children.length - 1; i >= 0; i--) {
      const ch = this.scene.children[i];
      if (ch.isLight) continue;
      if (ch === this.spotLight?.target) continue;
      this.scene.remove(ch);
      ch.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach(m => m.dispose?.());
        }
      });
    }
    this.model = null;
  }

  /**
   * Recompute bounds after animation so she stays centered; spotlight + camera follow.
   */
  _frameCameraAndSpot() {
    if (!this.model) return;

    this._box.setFromObject(this.model);
    if (this._box.isEmpty()) return;

    this._box.getCenter(this._focus);
    this._box.getSize(this._size);
    const sy = this._size.y;

    if (!this._framingReady) {
      this._framingAnchor.copy(this._focus);
      this._framingReady = true;
    }

    const ax = this._framingAnchor.x;
    const az = this._framingAnchor.z;
    const bodyY = THREE.MathUtils.lerp(this._framingAnchor.y, this._focus.y, 0.42);

    // Aim spotlight at upper torso (stays readable while crumpling)
    const aimY = this._focus.y + sy * 0.18;
    this.spotLight.target.position.set(this._focus.x, aimY, this._focus.z);
    this.spotLight.target.updateMatrixWorld();

    // Overhead-front beam (classic stage death)
    const yaw = this._deathYaw ?? 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const side = 0.35;
    const back = 2.1;
    const lift = Math.max(5.2, sy * 2.9);
    this.spotLight.position.set(
      ax + sin * side + cos * back,
      this._focus.y + lift,
      az + cos * side - sin * back
    );
    this.spotLight.distance = Math.max(26, sy * 11);
    this.spotLight.updateMatrixWorld();

    // Camera: stay over the death spot (anchor XZ); high rig so she reads upper frame while collapsing.
    const camDist = Math.max(3.15, sy * 1.72);
    const camHeight = sy * 1.12 + 0.85;
    this.camera.position.set(
      ax + sin * 0.12 + cos * camDist,
      bodyY + camHeight,
      az + cos * 0.12 - sin * camDist
    );
    // Look slightly below blended torso height so the figure sits higher in the viewport.
    this.camera.lookAt(ax, bodyY - sy * 0.22, az);
  }

  update(renderer, delta) {
    if (!this.active) return false;

    this._elapsed += delta;
    if (this.mixer) this.mixer.update(delta);

    if (this.action && this.clip && this.clip.duration > 0.05 && this.action.time >= this.clip.duration - 0.04) {
      this._finished = true;
    }

    this._frameCameraAndSpot();

    renderer.render(this.scene, this.camera);

    const timeDone = this._elapsed >= this._maxTime;
    if (this._finished || timeDone) {
      const cb = this._onFinished;
      this.stop();
      cb?.();
      return false;
    }
    return true;
  }

  stop() {
    this._clearNonLights();
    this.active = false;
    this._onFinished = null;
  }
}
