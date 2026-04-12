/**
 * Full-screen WebGL backup dancers behind the dare (wave clear) UI.
 * Uses Hip Hop clip from kolbash + in-game dance FBXs (no jump / dive).
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/** Dance-only lineup: Hip Hop hero + two flanking enemies (no center figure behind the hero). */
export const DARE_DANCER_MODELS = [
  { path: '/models/dare/HipHopDancing.fbx', faceDeg: 0, scale: 1 },
  { path: '/models/alon_dancing.fbx', faceDeg: -90, scale: 1 },
  { path: '/models/marcell_dancing.fbx', faceDeg: -90, scale: 1.12 }
];

const TARGET_HEIGHT = 1.45;
/** Side spacing for the two backup dancers behind the hero. */
const BACKUP_ROW_SPACING = 1.42;
/** Hero closer to camera (+Z); backups further into the stage (-Z). */
const HERO_Z = 0.72;
const BACKUP_Z = -1.05;

function pickDanceClip(animations) {
  if (!animations?.length) return null;
  const lower = (n) => (n || '').toLowerCase();
  return (
    animations.find(a => lower(a.name).includes('hip')) ||
    animations.find(a => lower(a.name).includes('dance')) ||
    animations.find(a => lower(a.name).includes('groove')) ||
    animations.find(a => lower(a.name).includes('idle')) ||
    animations[0]
  );
}

export class DareBackupDancers {
  constructor() {
    this.loader = new FBXLoader();
    this.cache = new Map();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.2, 60);
    this.clock = new THREE.Clock();
    this.renderer = null;
    this.mixers = [];
    this.rows = [];
    this._running = false;
    this._raf = 0;
    this._onResize = () => this._resize();

    this.scene.add(new THREE.AmbientLight(0xffccff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(0, 5, 6);
    this.scene.add(key);
    const pink = new THREE.PointLight(0xff00aa, 0.6, 20);
    pink.position.set(-4, 2, 4);
    this.scene.add(pink);
    const cyan = new THREE.PointLight(0x00ffff, 0.45, 18);
    cyan.position.set(4, 2, 4);
    this.scene.add(cyan);
  }

  async preload() {
    await Promise.all(
      DARE_DANCER_MODELS.map(async (def) => {
        if (this.cache.has(def.path)) return;
        try {
          const data = await new Promise((resolve, reject) => {
            this.loader.load(def.path, resolve, undefined, reject);
          });
          let animations = data.animations || [];
          data.traverse((ch) => {
            if (ch.animations?.length) animations = animations.concat(ch.animations);
          });
          const box = new THREE.Box3().setFromObject(data);
          const size = box.getSize(new THREE.Vector3());
          this.cache.set(def.path, {
            source: data,
            originalHeight: size.y || 1,
            animations
          });
        } catch (e) {
          console.warn('DareBackupDancers: skip', def.path, e);
        }
      })
    );
  }

  _resize() {
    const canvas = document.getElementById('dare-dancers-canvas');
    if (!canvas || !this.renderer) return;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (w < 2 || h < 2) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    const mobile = typeof window !== 'undefined' && 'ontouchstart' in window && window.innerWidth < 1200;
    const pr = mobile ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(pr);
  }

  show() {
    const canvas = document.getElementById('dare-dancers-canvas');
    if (!canvas) return;

    this.hide();

    const loaded = DARE_DANCER_MODELS.filter(d => this.cache.has(d.path));
    if (loaded.length === 0) return;

    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: true,
        powerPreference: 'low-power'
      });
      if ('outputColorSpace' in this.renderer) {
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      }
      this.renderer.setClearColor(0x000000, 0);
    }

    this._resize();
    window.addEventListener('resize', this._onResize);

    this.mixers = [];
    this.rows = [];

    const n = loaded.length;
    const backupCount = Math.max(0, n - 1);
    const backupHalf = backupCount > 1 ? (backupCount - 1) * 0.5 : 0;

    for (let i = 0; i < n; i++) {
      const def = loaded[i];
      const meta = this.cache.get(def.path);
      const model = SkeletonUtils.clone(meta.source);
      const scale = (TARGET_HEIGHT / meta.originalHeight) * def.scale;
      model.scale.setScalar(scale);

      const box = new THREE.Box3().setFromObject(model);
      const minY = box.min.y;

      if (i === 0) {
        model.position.set(0, -minY, HERO_Z);
      } else {
        const bi = i - 1;
        const x = (bi - backupHalf) * BACKUP_ROW_SPACING;
        model.position.set(x, -minY, BACKUP_Z);
      }

      const faceRad = ((def.faceDeg ?? 0) * Math.PI) / 180;
      // Previous build used Math.PI + faceRad (everyone showed their back). +180° → 2π + faceRad ≡ faceRad.
      model.rotation.y = faceRad;

      const clip = pickDanceClip(meta.animations);
      if (clip) {
        const mixer = new THREE.AnimationMixer(model);
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
        this.mixers.push(mixer);
      }

      this.scene.add(model);
      this.rows.push(model);
    }

    this.camera.position.set(0, 1.18, 5.55);
    this.camera.lookAt(0, 0.92, 0.15);

    this._running = true;
    this.clock.start();
    this._tick();
  }

  _tick() {
    if (!this._running) return;
    this._raf = requestAnimationFrame(() => this._tick());
    const delta = Math.min(this.clock.getDelta(), 0.1);
    for (const m of this.mixers) m.update(delta);
    if (this.renderer) this.renderer.render(this.scene, this.camera);
  }

  hide() {
    this._running = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    window.removeEventListener('resize', this._onResize);

    for (const m of this.mixers) {
      m.stopAllAction();
    }
    this.mixers = [];

    for (const row of this.rows) {
      this.scene.remove(row);
      row.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach(mat => mat.dispose?.());
        }
      });
    }
    this.rows = [];
  }
}
