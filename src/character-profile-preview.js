/**
 * Title-screen fighter preview: looping FBX, in-place grounding, OrbitControls (drag rotate, scroll zoom).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const TARGET_H = 1.35;

function disposeModelGraph(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => m.dispose?.());
    }
  });
}

function pickProfileClip(animations) {
  if (!animations?.length) return null;
  const lower = (n) => (n || '').toLowerCase();
  return (
    animations.find((a) => lower(a.name).includes('soccer') || lower(a.name).includes('receive')) ||
    animations.find((a) => lower(a.name).includes('taunt')) ||
    animations.find((a) => lower(a.name).includes('zombie')) ||
    animations.find((a) => lower(a.name).includes('walk')) ||
    animations.find((a) => lower(a.name).includes('idle')) ||
    animations[0]
  );
}

export class CharacterProfilePreview {
  /**
   * @param {HTMLElement | null} mount
   */
  constructor(mount) {
    this.mount = mount;
    this.loader = new FBXLoader();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    /** Holds the skinned root; we move this group to cancel root drift / keep feet grounded. */
    this.anchor = null;
    this.model = null;
    this.mixer = null;
    this.clock = new THREE.Clock();
    this._raf = 0;
    this._loadGen = 0;
    this._shownUrl = null;
    this._scratchCenter = new THREE.Vector3();
    this._scratchDesired = new THREE.Vector3();
    this._sizeScratch = new THREE.Vector3();
    this._onResize = () => this._resize();
  }

  /**
   * @param {{ profileSelectFbx?: string } | null} c roster entry
   */
  syncCharacter(c) {
    const url = c?.profileSelectFbx ? String(c.profileSelectFbx).trim() : '';
    if (!url) {
      this._teardown();
      this._shownUrl = null;
      return;
    }
    if (url === this._shownUrl && this.model) return;
    void this._load(url);
  }

  dispose() {
    this._teardown();
  }

  _teardown() {
    this._loadGen++;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    if (this.model && this.anchor) {
      this.anchor.remove(this.model);
      disposeModelGraph(this.model);
      this.model = null;
    }
    if (this.anchor && this.scene) {
      this.scene.remove(this.anchor);
      this.anchor = null;
    }
    if (this.renderer) {
      try {
        this.renderer.dispose();
      } catch (e) {}
      if (this.renderer.domElement?.parentElement) {
        this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
      }
    }
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    if (this.mount) this.mount.style.display = 'none';
    this._shownUrl = null;
    window.removeEventListener('resize', this._onResize);
  }

  async _load(url) {
    this._teardown();
    const gen = this._loadGen;
    if (!this.mount) return;

    try {
      const fbx = await new Promise((resolve, reject) => {
        this.loader.load(url, resolve, undefined, reject);
      });

      if (gen !== this._loadGen) {
        disposeModelGraph(fbx);
        return;
      }

      let animations = [...(fbx.animations || [])];
      fbx.traverse((ch) => {
        if (ch.animations?.length) animations = animations.concat(ch.animations);
      });

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(36, 1, 0.15, 48);
      this.camera.position.set(0, 1.05, 2.85);

      this.scene.add(new THREE.AmbientLight(0xffffff, 0.52));
      const k = new THREE.DirectionalLight(0xffffff, 0.88);
      k.position.set(2.2, 6.5, 4.5);
      this.scene.add(k);
      const rim = new THREE.DirectionalLight(0xffccff, 0.35);
      rim.position.set(-3, 2, -2);
      this.scene.add(rim);

      this.renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: true,
        powerPreference: 'low-power'
      });
      if ('outputColorSpace' in this.renderer) {
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      }
      this.renderer.setClearColor(0x000000, 0);
      const canvas = this.renderer.domElement;
      canvas.className = 'char-profile-canvas-el';
      canvas.style.cursor = 'grab';
      canvas.style.touchAction = 'none';
      this.mount.appendChild(canvas);
      this.mount.style.display = 'flex';

      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.enablePan = false;
      this.controls.rotateSpeed = 0.65;
      this.controls.zoomSpeed = 0.85;
      this.controls.minDistance = 1.35;
      this.controls.maxDistance = 5.8;
      this.controls.minPolarAngle = 0.38;
      this.controls.maxPolarAngle = Math.PI / 2 - 0.12;
      this.controls.target.set(0, 0.92, 0);
      this.controls.update();
      this.controls.addEventListener('start', () => {
        canvas.style.cursor = 'grabbing';
      });
      this.controls.addEventListener('end', () => {
        canvas.style.cursor = 'grab';
      });

      this.anchor = new THREE.Group();
      this.scene.add(this.anchor);

      const root = SkeletonUtils.clone(fbx);
      disposeModelGraph(fbx);

      const box0 = new THREE.Box3().setFromObject(root);
      box0.getSize(this._sizeScratch);
      const h = this._sizeScratch.y || 1;
      root.scale.setScalar(TARGET_H / h);
      root.updateMatrixWorld(true);
      const box1 = new THREE.Box3().setFromObject(root);
      root.position.y = -box1.min.y;
      root.rotation.y = Math.PI * 0.06;
      this.anchor.add(root);
      this.model = root;

      const clip = pickProfileClip(animations);
      if (clip) {
        this.mixer = new THREE.AnimationMixer(root);
        const action = this.mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
      }

      this._shownUrl = url;
      window.addEventListener('resize', this._onResize, { passive: true });
      this._resize();
      this._tick();
    } catch (e) {
      console.warn('CharacterProfilePreview: failed', url, e);
      this._teardown();
    }
  }

  _resize() {
    if (!this.mount || !this.renderer || !this.camera) return;
    const w = Math.max(200, Math.min(480, this.mount.clientWidth || 320));
    const h = Math.round(Math.min(w * 1.05, (this.mount.clientHeight || 360) || w * 1.05));
    this.camera.aspect = w / Math.max(140, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(w, Math.max(140, h), false);
    this.controls?.update();
  }

  _tick() {
    if (!this._shownUrl || !this.renderer || !this.scene || !this.camera || !this.anchor) return;
    this._raf = requestAnimationFrame(() => this._tick());
    const d = Math.min(this.clock.getDelta(), 0.08);
    if (this.mixer) this.mixer.update(d);

    this.anchor.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.anchor);
    if (!box.isEmpty()) {
      box.getCenter(this._scratchCenter);
      this._scratchDesired.set(-this._scratchCenter.x, -box.min.y, -this._scratchCenter.z);
      this.anchor.position.lerp(this._scratchDesired, 0.48);
      this.controls.target.lerp(this._scratchCenter, 0.28);
    }

    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  }
}
