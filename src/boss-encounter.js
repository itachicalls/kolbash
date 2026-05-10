/**
 * Finale boss behind the north wall. Uses your skinned FBX (not the procedural fallback).
 *
 * Assets must be visible at `/models/boss/toly/...` (under `public/models/boss/toly/`).
 * Run `npm run ensure-toly-boss` to junction-link your OneDrive Toly folder, or copy
 * FBX there manually. Paths use your real subfolders (spaces OK — URL-encoded on load).
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/** Encode each path segment so Mixamo names with spaces work in fetch(). */
export function encodeBossAssetUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const q = url.indexOf('?');
  const path = q >= 0 ? url.slice(0, q) : url;
  const query = q >= 0 ? url.slice(q) : '';
  if (!path.startsWith('/')) return encodeURI(url);
  const encoded =
    '/' +
    path
      .slice(1)
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
  return encoded + query;
}

/**
 * Tried in order until one loads. Toly folder in `public/models/boss/toly/` is checked first.
 * Add your main skinned mesh filename here if it differs.
 */
/** Primary mesh + idle (Mixamo export under your Toly tree). */
export const BOSS_MODEL_CANDIDATES = [
  '/models/boss/toly/idle/Idle.fbx',
  '/models/boss/toly/toly.fbx',
  '/models/boss/toly/Toly.fbx',
  '/models/boss/toly/TOLY.fbx',
  '/models/boss/toly/character.fbx'
];

/**
 * Extra clips (same rig). Loaded after the mesh; tracks must match Mixamo bone names.
 */
export const BOSS_ANIM_EXTRA_PATHS = [
  '/models/boss/toly/laugh animation/Laughing.fbx',
  '/models/boss/toly/hurt animation/Pain Gesture.fbx',
  '/models/boss/toly/death/Death From Front Headshot.fbx',
  '/models/boss/toly/attack animations/Brutal Assassination.fbx',
  '/models/boss/toly/attack animations/Dancing.fbx',
  '/models/boss/toly/attack animations/Jump Attack.fbx',
  '/models/boss/toly/attack animations/Macarena Dance.fbx',
  '/models/boss/toly/attack animations/Wave Hip Hop Dance.fbx'
];

/** @deprecated first candidate for preload list */
export const BOSS_MODEL_PATH = BOSS_MODEL_CANDIDATES[0];

const PHASE = {
  INACTIVE: 'inactive',
  INTRO: 'intro',
  /** Playing summon attack clip before first spawn (avoid empty-floor → vulnerable bug). */
  SPAWN_ANTIC: 'spawn_antic',
  ADDS: 'adds',
  VULNERABLE: 'vulnerable',
  DEAD: 'dead'
};

function collectAnimations(fbx) {
  let list = [...(fbx.animations || [])];
  if (list.length === 0) {
    fbx.traverse((ch) => {
      if (ch.animations?.length) list = list.concat(ch.animations);
    });
  }
  return list;
}

function classifyClip(name) {
  const n = (name || '').toLowerCase();
  if (/(laugh|cackle|chuckle|giggle|taunt|mock)/.test(n)) return 'laugh';
  if (/(hurt|hit|damag|flinch|stagger|pain|recoil|react|death|headshot|shot|fall)/.test(n)) return 'hurt';
  if (
    /(attack|punch|cast|summon|throw|swipe|slam|kick|spell|strike|swing|danc|macarena|hip hop|assassin|brutal|jump)/.test(
      n
    )
  ) {
    return 'attack';
  }
  if (/(expose|weak|break|stun|vulnerable|collapse)/.test(n)) return 'expose';
  if (/(idle|stand|breath|wait|neutral)/.test(n)) return 'idle';
  if (/(t-pose|tpose|bind)/.test(n)) return 'skip';
  return 'misc';
}

/** Mixamo FBX clips often use `Armature|mixamorig:Hips.position` while the skinned clone uses `mixamorig:Hips.position`. */
function boneNameSetFromSkinned(skinned) {
  const s = new Set();
  if (skinned?.skeleton?.bones) {
    for (const b of skinned.skeleton.bones) {
      if (b?.name) s.add(b.name);
    }
  }
  skinned?.traverse((o) => {
    if (o?.name) s.add(o.name);
  });
  return s;
}

function resolveTrackNodeName(nodePath, boneNames) {
  const short = nodePath.includes('|') ? nodePath.split('|').pop() : nodePath;
  if (!short) return null;
  if (boneNames.has(short)) return short;
  const noColon = short.replace(/:/g, '');
  if (noColon !== short && boneNames.has(noColon)) return noColon;
  for (const b of boneNames) {
    if (b.replace(/:/g, '') === noColon) return b;
  }
  return null;
}

/**
 * @param {THREE.AnimationClip} clip
 * @param {Set<string>} boneNames
 */
function retargetBossClipTracks(clip, boneNames) {
  if (!clip?.tracks?.length || boneNames.size === 0) return clip;
  const newTracks = [];
  let anyRenamed = false;
  for (const track of clip.tracks) {
    const m = track.name.match(/^(.+)\.(position|quaternion|scale|rotation)$/);
    if (!m) {
      newTracks.push(track);
      continue;
    }
    const nodePath = m[1];
    const prop = m[2];
    const resolved = resolveTrackNodeName(nodePath, boneNames);
    if (resolved && resolved !== nodePath) {
      const nt = track.clone();
      nt.name = `${resolved}.${prop}`;
      newTracks.push(nt);
      anyRenamed = true;
    } else {
      newTracks.push(track);
    }
  }
  if (!anyRenamed) return clip;
  return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
}

function yieldToBrowser() {
  return new Promise((r) => setTimeout(r, 0));
}

function pickRandom(arr) {
  if (!arr?.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export class BossEncounter {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./enemy.js').EnemyManager} enemyManager
   * @param {{ isMobile?: boolean }} [opts]
   */
  constructor(scene, enemyManager, opts = {}) {
    this.scene = scene;
    this.enemyManager = enemyManager;
    this.isMobile = opts.isMobile === true;

    this.phase = PHASE.INACTIVE;
    this.roundIndex = 0;
    this.hp = 1;
    this.maxHp = 1;

    this.root = new THREE.Group();
    this.root.name = 'FinaleBoss';
    this._bossModel = null;
    this._mixer = null;
    this._skinnedRoot = null;

    this._idleClip = null;
    this._laughClips = [];
    this._hurtClips = [];
    this._attackClips = [];
    this._exposeClips = [];
    this._miscClips = [];

    this._currentLoopAction = null;
    this._clipActionCache = new Map();
    this._animTimeouts = [];

    this._vulnerableEndsAt = 0;
    this._windowDurationMs = 6500;
    this._introEndsAt = 0;
    this._closingVulnerable = false;
    this._usingProceduralFallback = false;

    this._fwd = new THREE.Vector3();
    this._hitCenter = new THREE.Vector3(0, 9, 1.5);
    this._scratchV = new THREE.Vector3();

    this._pulseT = 0;
    this._emissiveMeshes = [];

    this.onVictory = null;
    this.onUiUpdate = null;

    this.loader = new FBXLoader();
    this._spawnScratch = [];

    /** During ADDS, occasional dance / attack clip so the boss is not stuck on idle only. */
    this._addsDanceBusy = false;
    this._addsDanceNextAt = 0;
  }

  isActive() {
    return this.phase !== PHASE.INACTIVE && this.phase !== PHASE.DEAD;
  }

  isVulnerable() {
    return this.phase === PHASE.VULNERABLE && performance.now() < this._vulnerableEndsAt;
  }

  getFxHitTarget(target) {
    target.copy(this._hitCenter);
    this.root.localToWorld(target);
    return target;
  }

  _clearAnimTimeouts() {
    for (const id of this._animTimeouts) {
      try {
        clearTimeout(id);
      } catch (e) {}
    }
    this._animTimeouts.length = 0;
  }

  _schedule(fn, ms) {
    const id = setTimeout(fn, ms);
    this._animTimeouts.push(id);
    return id;
  }

  async begin() {
    this._clearAnimTimeouts();
    this.enemyManager.shootersThisWave = 0;
    this.phase = PHASE.INTRO;
    this.roundIndex = 0;
    this.maxHp = this.isMobile ? 5200 : 9200;
    this.hp = this.maxHp;
    this._introEndsAt = performance.now() + 2200;
    this._pulseT = 0;
    this._emissiveMeshes.length = 0;
    this._closingVulnerable = false;
    this._clipActionCache.clear();
    this._currentLoopAction = null;

    this.root.position.set(0, 0, -40);
    this.root.rotation.y = 0;
    this.scene.add(this.root);

    await this._ensureBossVisual();
    await yieldToBrowser();
    this._setShieldedLook(true);
    if (this.onUiUpdate) this.onUiUpdate({ phase: 'intro', hpPct: 1, windowSec: 0 });

    await this._loadAllAnimationsAndMixer();

    this._addsDanceBusy = false;
    this._addsDanceNextAt = performance.now() + 2800;

    this._fadeToLoopIdleOrLaugh(false);
  }

  async _loadFbxUrl(url) {
    const src = encodeBossAssetUrl(url);
    return new Promise((resolve, reject) => {
      this.loader.load(src, resolve, undefined, reject);
    });
  }

  async _ensureBossVisual() {
    if (this._bossModel) return;

    let mesh = null;
    let lastErr = null;
    for (const url of BOSS_MODEL_CANDIDATES) {
      try {
        const fbx = await this._loadFbxUrl(url);
        mesh = SkeletonUtils.clone(fbx);
        console.info('[Boss] Loaded character mesh:', url);
        break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!mesh) {
      console.warn(
        '[Boss] No character FBX found — copy Toly FBXs to public/models/boss/toly/ (see boss-encounter.js header). Using placeholder.',
        lastErr
      );
      mesh = this._proceduralBossMesh();
      this._usingProceduralFallback = true;
    } else {
      this._usingProceduralFallback = false;
    }

    const box = new THREE.Box3().setFromObject(mesh);
    const h = box.getSize(this._scratchV).y || 1.8;
    const targetH = this.isMobile ? 14 : 18;
    mesh.scale.setScalar(targetH / h);
    mesh.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(mesh);
    mesh.position.set(0, -b2.min.y, 0);
    // Face the arena (+Z where the player stands); Math.PI had him moonwalking away from the camera.
    mesh.rotation.y = 0;

    this._bossModel = mesh;
    this.root.add(mesh);

    mesh.traverse((ch) => {
      if (ch.isMesh && ch.material) {
        const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
        for (const m of mats) {
          if (m && 'emissive' in m) this._emissiveMeshes.push(m);
        }
      }
    });
  }

  _proceduralBossMesh() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x3a2060,
      emissive: 0x6600aa,
      emissiveIntensity: 0.35,
      roughness: 0.55,
      metalness: 0.25
    });
    const robe = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.8, 11, 10, 2), bodyMat);
    robe.position.y = 5.5;
    g.add(robe);
    const head = new THREE.Mesh(new THREE.SphereGeometry(2.1, 14, 12), bodyMat);
    head.position.set(0, 12.2, 0.4);
    g.add(head);
    return g;
  }

  async _loadAllAnimationsAndMixer() {
    if (!this._bossModel || this._mixer) return;

    this._skinnedRoot = null;
    this._bossModel.traverse((ch) => {
      if (ch.isSkinnedMesh && ch.skeleton && !this._skinnedRoot) this._skinnedRoot = ch;
    });
    this._mixer = new THREE.AnimationMixer(this._skinnedRoot || this._bossModel);

    const boneNames = boneNameSetFromSkinned(this._skinnedRoot || this._bossModel);
    const retarget = (c) => retargetBossClipTracks(c, boneNames);

    const allClips = collectAnimations(this._bossModel).map(retarget);

    for (const url of BOSS_ANIM_EXTRA_PATHS) {
      try {
        const fbx = await this._loadFbxUrl(url);
        for (const raw of collectAnimations(fbx)) {
          allClips.push(retarget(raw));
        }
      } catch (e) {
        console.warn('[Boss] Optional anim FBX skipped:', url);
      }
      await yieldToBrowser();
    }

    this._idleClip = null;
    this._laughClips = [];
    this._hurtClips = [];
    this._attackClips = [];
    this._exposeClips = [];
    this._miscClips = [];

    for (const clip of allClips) {
      if (!clip || clip.duration <= 0.04) continue;
      const kind = classifyClip(clip.name);
      if (kind === 'skip') continue;
      if (kind === 'laugh') this._laughClips.push(clip);
      else if (kind === 'hurt') this._hurtClips.push(clip);
      else if (kind === 'attack') this._attackClips.push(clip);
      else if (kind === 'expose') this._exposeClips.push(clip);
      else if (kind === 'idle') {
        if (!this._idleClip) this._idleClip = clip;
      } else {
        this._miscClips.push(clip);
      }
    }

    if (!this._idleClip && this._miscClips.length) this._idleClip = this._miscClips.shift();
    if (!this._idleClip && allClips[0]) this._idleClip = allClips[0];

    if (this._hurtClips.length === 0 && this._exposeClips.length) {
      this._hurtClips.push(...this._exposeClips.splice(0, Math.min(2, this._exposeClips.length)));
    }
    if (this._attackClips.length === 0 && this._miscClips.length) {
      this._attackClips.push(...this._miscClips.splice(0, Math.min(4, this._miscClips.length)));
    }
  }

  _actionFor(clip) {
    if (!clip || !this._mixer) return null;
    let a = this._clipActionCache.get(clip);
    if (!a) {
      a = this._mixer.clipAction(clip);
      this._clipActionCache.set(clip, a);
    }
    return a;
  }

  _fadeOutCurrent(fade = 0.22) {
    if (this._currentLoopAction && this._currentLoopAction.isRunning()) {
      this._currentLoopAction.fadeOut(fade);
    }
    this._currentLoopAction = null;
  }

  _fadeToLoopIdleOrLaugh(invulnerableAddsPhase) {
    if (!this._mixer || this._usingProceduralFallback) return;

    const laugh = invulnerableAddsPhase && this._laughClips.length > 0 ? pickRandom(this._laughClips) : null;
    const clip = laugh || this._idleClip;
    if (!clip) return;

    const next = this._actionFor(clip);
    if (!next) return;
    next.enabled = true;
    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    next.setEffectiveWeight(1);

    if (this._currentLoopAction && this._currentLoopAction !== next) {
      this._currentLoopAction.crossFadeTo(next, 0.32, false);
    } else {
      next.fadeIn(0.28).play();
    }
    this._currentLoopAction = next;
  }

  _playOneShot(clip, onDone, fadeIn = 0.18, fadeOut = 0.22) {
    if (!this._mixer || !clip || this._usingProceduralFallback) {
      onDone?.();
      return;
    }
    const act = this._actionFor(clip);
    act.enabled = true;
    act.reset();
    act.setLoop(THREE.LoopOnce, 1);
    act.clampWhenFinished = true;
    act.setEffectiveWeight(1);
    if (this._currentLoopAction) {
      this._currentLoopAction.fadeOut(fadeIn);
      this._currentLoopAction = null;
    }
    act.fadeIn(fadeIn).play();

    const durMs = Math.max(380, (clip.duration || 1) * 1000 - fadeOut * 180);
    this._schedule(() => {
      try {
        act.fadeOut(fadeOut);
      } catch (e) {}
      onDone?.();
    }, durMs);
  }

  _fadeToExposeOrIdleVulnerable() {
    if (!this._mixer || this._usingProceduralFallback) return;
    const clip = pickRandom(this._exposeClips) || this._idleClip;
    if (!clip) return;
    const next = this._actionFor(clip);
    next.enabled = true;
    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.setEffectiveWeight(1);
    if (this._currentLoopAction && this._currentLoopAction !== next) {
      this._currentLoopAction.crossFadeTo(next, 0.28, false);
    } else {
      next.fadeIn(0.25).play();
    }
    this._currentLoopAction = next;
  }

  _spawnAddsWave() {
    const base = this.isMobile ? 4 : 5;
    const count = Math.min(12, base + Math.min(6, this.roundIndex));
    const playerApprox = { x: 0, z: 2 };
    const existing = this._spawnScratch;
    existing.length = 0;

    const hpMul = Math.pow(1.24, this.roundIndex) * (1 + this.roundIndex * 0.06);
    const spdMul = Math.pow(1.1, this.roundIndex) * (1 + this.roundIndex * 0.035);
    const dmgMul = Math.pow(1.18, this.roundIndex);

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + this.roundIndex * 0.37;
      const r = 9 + Math.random() * 11;
      let x = playerApprox.x + Math.cos(angle) * r;
      let z = playerApprox.z + Math.sin(angle) * r;
      x = Math.max(-22, Math.min(22, x));
      z = Math.max(-22, Math.min(22, z));
      const pos = { x, y: 0, z };
      this._enforceSpacing(pos, existing);
      existing.push({ position: { ...pos } });

      const typeIndex = (i + this.roundIndex) % 6;
      const enemy = this.enemyManager.spawnEnemySync(typeIndex, pos, false);
      if (enemy) {
        enemy.userData.isFinaleAdd = true;
        enemy.userData.health *= hpMul;
        enemy.userData.maxHealth = enemy.userData.health;
        enemy.userData.waveSpeedMul = (enemy.userData.waveSpeedMul || 1) * spdMul;
        enemy.userData.finaleDmgMul = dmgMul;
      }
    }
  }

  _enforceSpacing(pos, existing) {
    let attempts = 0;
    while (attempts < 6) {
      let bad = false;
      for (const o of existing) {
        const dx = pos.x - o.position.x;
        const dz = pos.z - o.position.z;
        if (dx * dx + dz * dz < 9) {
          bad = true;
          break;
        }
      }
      if (!bad) break;
      const a = Math.random() * Math.PI * 2;
      pos.x += Math.cos(a) * 3;
      pos.z += Math.sin(a) * 3;
      pos.x = Math.max(-22, Math.min(22, pos.x));
      pos.z = Math.max(-22, Math.min(22, pos.z));
      attempts++;
    }
  }

  _setShieldedLook(shielded) {
    const t = shielded ? 0.12 : 0.85;
    for (const m of this._emissiveMeshes) {
      if (!m.emissive) continue;
      m.emissiveIntensity = t * (this.isMobile ? 0.85 : 1);
      if (shielded) m.emissive?.setHex?.(0x220044);
      else m.emissive?.setHex?.(0xff00aa);
    }
  }

  tryHitscan(muzzle, dir, damage) {
    if (!this.isActive() || !this.isVulnerable()) return 0;
    this._fwd.copy(dir).normalize();
    this._scratchV.copy(this._hitCenter);
    this.root.localToWorld(this._scratchV);

    const to = this._scratchV.sub(muzzle);
    const dist = to.length();
    if (dist < 4 || dist > 140) return 0;
    to.normalize();
    const dot = to.dot(this._fwd);
    if (dot < 0.78) return 0;

    return this._applyDamage(damage);
  }

  tryAoE(centerX, centerZ, radius, damage) {
    if (!this.isActive() || !this.isVulnerable()) return 0;
    this._scratchV.copy(this._hitCenter);
    this.root.localToWorld(this._scratchV);
    const dx = centerX - this._scratchV.x;
    const dz = centerZ - this._scratchV.z;
    const extend = 9 + radius;
    if (dx * dx + dz * dz > extend * extend) return 0;
    return this._applyDamage(Math.round(damage * 0.85));
  }

  trySpecialHit(kind, px, py, pz, damage) {
    if (!this.isActive() || !this.isVulnerable()) return 0;
    this._scratchV.copy(this._hitCenter);
    this.root.localToWorld(this._scratchV);
    if (kind === 'orb') {
      const dx = px - this._scratchV.x;
      const dy = py - this._scratchV.y;
      const dz = pz - this._scratchV.z;
      if (dx * dx + dz * dz < 14 * 14 && Math.abs(dy) < 16) {
        return this._applyDamage(damage);
      }
      return 0;
    }
    if (kind === 'radial') {
      const dx = px - this._scratchV.x;
      const dz = pz - this._scratchV.z;
      if (dx * dx + dz * dz < 12 * 12) {
        return this._applyDamage(Math.round(damage * 0.55));
      }
    }
    return 0;
  }

  _applyDamage(dmg) {
    const d = Math.max(1, Math.round(dmg));
    this.hp = Math.max(0, this.hp - d);
    if (this.onUiUpdate) this.onUiUpdate({ phase: 'vulnerable', hpPct: this.hp / this.maxHp, windowSec: this._windowSecondsLeft() });
    if (this.hp <= 0) {
      this._onDefeated();
      return d;
    }
    this._pulseT = 0.35;
    return d;
  }

  _windowSecondsLeft() {
    if (!this.isVulnerable()) return 0;
    return Math.max(0, (this._vulnerableEndsAt - performance.now()) / 1000);
  }

  _onDefeated() {
    this._clearAnimTimeouts();
    this.phase = PHASE.DEAD;
    this._setShieldedLook(true);
    if (this._mixer) {
      try {
        this._mixer.stopAllAction();
      } catch (e) {}
    }
    this._currentLoopAction = null;
    if (this.onUiUpdate) this.onUiUpdate({ phase: 'dead', hpPct: 0, windowSec: 0 });
    if (this.onVictory) this.onVictory();
  }

  update(deltaTime) {
    if (this.phase === PHASE.INACTIVE || this.phase === PHASE.DEAD) return;

    const now = performance.now();
    if (this._mixer) this._mixer.update(deltaTime);

    if (this._pulseT > 0) {
      this._pulseT -= deltaTime;
      const s = 1 + Math.sin(now * 0.05) * 0.04;
      this.root.scale.setScalar(s);
    } else {
      this.root.scale.setScalar(1);
    }

    if (this.phase === PHASE.INTRO && now >= this._introEndsAt) {
      this.phase = PHASE.SPAWN_ANTIC;
      const atk = pickRandom(this._attackClips) || pickRandom(this._miscClips);
      if (atk && !this._usingProceduralFallback) {
        this._playOneShot(atk, () => {
          this.phase = PHASE.ADDS;
          this._spawnAddsWave();
          if (this.onUiUpdate) this.onUiUpdate({ phase: 'adds', hpPct: this.hp / this.maxHp, windowSec: 0 });
          this._fadeToLoopIdleOrLaugh(true);
        });
      } else {
        this.phase = PHASE.ADDS;
        this._spawnAddsWave();
        if (this.onUiUpdate) this.onUiUpdate({ phase: 'adds', hpPct: this.hp / this.maxHp, windowSec: 0 });
        this._fadeToLoopIdleOrLaugh(true);
      }
    }

    if (this.phase === PHASE.ADDS) {
      this._maybePlayAddsShowcase(now);
      if (this.enemyManager.getAliveCount() === 0 && this.enemyManager.isWaveClearForCinematic()) {
        this._openVulnerabilityWindow();
      }
      return;
    }

    if (this.phase === PHASE.VULNERABLE) {
      if (now >= this._vulnerableEndsAt && !this._closingVulnerable) {
        this._closeVulnerabilityWindow();
      } else if (this.onUiUpdate && Math.random() < 0.04) {
        this.onUiUpdate({ phase: 'vulnerable', hpPct: this.hp / this.maxHp, windowSec: this._windowSecondsLeft() });
      }
    }
  }

  _maybePlayAddsShowcase(now) {
    if (this._usingProceduralFallback || !this._mixer || this._addsDanceBusy) return;
    if (now < this._addsDanceNextAt) return;
    const pool = [];
    for (const c of this._attackClips) if (c && c !== this._idleClip) pool.push(c);
    for (const c of this._miscClips) if (c && c !== this._idleClip) pool.push(c);
    for (const c of this._laughClips) if (c && c !== this._idleClip) pool.push(c);
    const clip = pickRandom(pool);
    if (!clip) {
      this._addsDanceNextAt = now + 2200;
      return;
    }
    this._addsDanceBusy = true;
    this._addsDanceNextAt = now + 9e8;
    this._playOneShot(clip, () => {
      this._addsDanceBusy = false;
      this._fadeToLoopIdleOrLaugh(true);
      this._addsDanceNextAt = performance.now() + 3600 + Math.random() * 4800;
    });
  }

  _openVulnerabilityWindow() {
    this.phase = PHASE.VULNERABLE;
    this._windowDurationMs = 5000 + Math.random() * 3000;
    this._vulnerableEndsAt = performance.now() + this._windowDurationMs;
    this._setShieldedLook(false);
    this._fadeToExposeOrIdleVulnerable();
    if (this.onUiUpdate) {
      this.onUiUpdate({
        phase: 'vulnerable',
        hpPct: this.hp / this.maxHp,
        windowSec: this._windowDurationMs / 1000
      });
    }
  }

  _closeVulnerabilityWindow() {
    if (this.phase !== PHASE.VULNERABLE || this._closingVulnerable) return;
    this._closingVulnerable = true;
    this.roundIndex++;
    this._vulnerableEndsAt = Number.POSITIVE_INFINITY;
    this._setShieldedLook(true);

    const hurtClip = pickRandom(this._hurtClips) || pickRandom(this._exposeClips) || this._idleClip;
    const laughClip = pickRandom(this._laughClips);
    const atkClip = pickRandom(this._attackClips) || pickRandom(this._miscClips);
    const hurtDurMs = hurtClip ? Math.max(420, hurtClip.duration * 1000 * 0.88) : 520;

    this._playOneShot(hurtClip || this._idleClip, null, 0.14, 0.2);

    this._schedule(() => {
      this._spawnAddsWave();
    }, hurtDurMs * 0.32);

    this._schedule(() => {
      if (laughClip) {
        this._playOneShot(laughClip, () => {
          if (atkClip) {
            this._playOneShot(atkClip, () => this._finishAddsPhaseEntry());
          } else {
            this._finishAddsPhaseEntry();
          }
        });
      } else if (atkClip) {
        this._playOneShot(atkClip, () => this._finishAddsPhaseEntry());
      } else {
        this._finishAddsPhaseEntry();
      }
    }, hurtDurMs * 0.9);
  }

  _finishAddsPhaseEntry() {
    this.phase = PHASE.ADDS;
    this._closingVulnerable = false;
    if (this.onUiUpdate) this.onUiUpdate({ phase: 'adds', hpPct: this.hp / this.maxHp, windowSec: 0 });
    this._fadeToLoopIdleOrLaugh(true);
  }

  reset() {
    this._clearAnimTimeouts();
    this.phase = PHASE.INACTIVE;
    this._closingVulnerable = false;
    if (this._mixer) {
      try {
        this._mixer.stopAllAction();
      } catch (e) {}
      this._mixer = null;
    }
    this._currentLoopAction = null;
    this._clipActionCache.clear();
    this._idleClip = null;
    this._laughClips = [];
    this._hurtClips = [];
    this._attackClips = [];
    this._exposeClips = [];
    this._miscClips = [];
    this._skinnedRoot = null;

    if (this.root.parent) this.root.parent.remove(this.root);
    this.root.clear();
    this._bossModel = null;
    this._emissiveMeshes.length = 0;
    this._usingProceduralFallback = false;

    this.root = new THREE.Group();
    this.root.name = 'FinaleBoss';
    this._addsDanceBusy = false;
    this._addsDanceNextAt = 0;
  }
}
