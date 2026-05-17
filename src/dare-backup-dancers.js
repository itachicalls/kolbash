/**
 * Full-screen WebGL backup dancers behind the dare (wave clear) UI.
 * Uses Hip Hop clip from kolbash + in-game dance FBXs (no jump / dive).
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applyFbxTextureBudget } from './fbx-texture-budget.js';

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

function disposeModelGraph(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => m.dispose?.());
    }
  });
}

function pickDanceClip(animations) {
  if (!animations?.length) return null;
  const lower = (n) => (n || '').toLowerCase();
  return (
    animations.find(a => lower(a.name).includes('chicken')) ||
    animations.find(a => lower(a.name).includes('samba')) ||
    animations.find(a => lower(a.name).includes('hip')) ||
    animations.find(a => lower(a.name).includes('dance')) ||
    animations.find(a => lower(a.name).includes('groove')) ||
    animations.find(a => lower(a.name).includes('idle')) ||
    animations[0]
  );
}

export class DareBackupDancers {
  /**
   * @param {{ useWebGlRenderer?: boolean; textureBudgetMax?: number }} [opts] Pass `useWebGlRenderer: false` on mobile — a second
   * WebGL context behind the dare UI reliably blows iOS WebKit memory limits (tab reload / “restart”).
   */
  constructor(opts = {}) {
    /** When false, skip extra WebGL + FBX clones; CSS overlay only (see main Game.isMobile). */
    this.useWebGlRenderer = opts.useWebGlRenderer !== false;
    this._textureBudgetMax = typeof opts.textureBudgetMax === 'number' ? opts.textureBudgetMax : 0;
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

    /** Mutable copy — index 0 is the spotlight hero; flanking backups stay shared. */
    this._lineup = DARE_DANCER_MODELS.map((d) => ({
      path: d.path,
      faceDeg: d.faceDeg ?? 0,
      scale: d.scale ?? 1
    }));
  }

  /**
   * Swap the center dare-stage dancer clip (e.g. Serena hip-hop vs Timmy samba).
   * @param {string} path
   */
  setHeroPath(path) {
    const next = String(path || '').trim();
    if (!next || !this._lineup.length) return;
    const prev = this._lineup[0].path;
    if (prev === next) return;
    this._lineup[0] = { ...this._lineup[0], path: next };
    const stillUsed = this._lineup.some((d, i) => i > 0 && d.path === prev);
    if (!stillUsed && this.cache.has(prev)) {
      const meta = this.cache.get(prev);
      this.cache.delete(prev);
      if (meta?.source) {
        try {
          disposeModelGraph(meta.source);
        } catch (e) {
          console.warn('DareBackupDancers: hero dispose', e);
        }
      }
    }
  }

  /** True when every dancer path in the current lineup is cached (after `preload`). */
  isLineupCached() {
    if (!this.useWebGlRenderer) return true;
    return this._lineup.every((d) => this.cache.has(d.path));
  }

  /**
   * Wait until lineup FBXs exist — blocks only if background prefetch missed (finishes before dare UI).
   */
  async ensureLoaded(options = {}) {
    if (!this.useWebGlRenderer) return;
    if (this.isLineupCached()) return;
    await this.preload(options);
  }

  async preload(options = {}) {
    if (!this.useWebGlRenderer) return;

    const serial = options.serial === true;

    const loadOne = async (def) => {
      if (this.cache.has(def.path)) return;
      try {
        const data = await new Promise((resolve, reject) => {
          this.loader.load(def.path, resolve, undefined, reject);
        });
        if (this._textureBudgetMax > 0) {
          try {
            applyFbxTextureBudget(data, { maxSize: this._textureBudgetMax });
          } catch (e) {
            console.warn('DareBackupDancers: texture budget', e);
          }
        }
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
    };

    if (serial) {
      for (const def of this._lineup) {
        await loadOne(def);
        await new Promise((r) => requestAnimationFrame(r));
      }
    } else {
      await Promise.all(this._lineup.map((def) => loadOne(def)));
    }
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
    const touch = typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0);
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const mobile = touch && (coarse || window.innerWidth < 1400);
    const pr = mobile ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(pr);
  }

  show() {
    const canvas = document.getElementById('dare-dancers-canvas');
    if (!canvas) return;

    this.hide();

    if (!this.useWebGlRenderer) {
      canvas.style.display = 'none';
      canvas.setAttribute('aria-hidden', 'true');
      return;
    }

    canvas.style.display = '';
    canvas.removeAttribute('aria-hidden');

    const loaded = this._lineup.filter((d) => this.cache.has(d.path));
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

    if (this.renderer) {
      try {
        this.renderer.dispose();
        if (typeof this.renderer.forceContextLoss === 'function') this.renderer.forceContextLoss();
      } catch (e) {
        console.warn('DareBackupDancers: renderer dispose', e);
      }
      this.renderer = null;
    }
  }
}
