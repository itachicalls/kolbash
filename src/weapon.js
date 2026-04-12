/**
 * Weapon System - Multiple weapons with unique projectiles
 */

import * as THREE from 'three';

export const WEAPON_DEFS = {
  disco: {
    name: 'DISCO BLASTER', damage: 25, fireRate: 150, rapidRate: 60,
    colors: [0xff0088, 0x00ff88, 0x8800ff, 0xffff00, 0xff6600, 0x00ffff],
    projDuration: 0.12,
    sound: { freq: 120, end: 40, dur: 0.08, type: 'sawtooth' }
  },
  gatling: {
    name: 'GATLING GUN', damage: 10, fireRate: 55, rapidRate: 30,
    colors: [0xffdd00, 0xffaa00],
    projDuration: 0.07,
    sound: { freq: 300, end: 150, dur: 0.04, type: 'square' }
  },
  laser: {
    name: 'LASER CANNON', damage: 50, fireRate: 450, rapidRate: 250,
    colors: [0x00ffff, 0x00aaff],
    projDuration: 0.05,
    sound: { freq: 1200, end: 600, dur: 0.1, type: 'sine' }
  },
  rocket: {
    name: 'ROCKET LAUNCHER', damage: 55, fireRate: 900, rapidRate: 600,
    colors: [0xff4400, 0xff2200],
    projDuration: 0.18,
    aoeRadius: 5, aoeDamage: 25,
    sound: { freq: 80, end: 30, dur: 0.15, type: 'sawtooth' }
  }
};

export class Weapon {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;

    this.currentType = 'disco';
    this.isHolding = false;
    this.lastFireTime = 0;
    this.recoil = 0;
    this.fireFlashUntil = 0;

    this.raycaster = new THREE.Raycaster();
    this.weaponGroup = new THREE.Group();
    this.weaponGroup.visible = false;
    this.barrelTip = new THREE.Vector3(0, 0, -0.5);

    this.geos = {
      disco: new THREE.IcosahedronGeometry(0.12, 0),
      gatling: new THREE.CylinderGeometry(0.02, 0.025, 0.14, 5),
      laser: new THREE.BoxGeometry(0.03, 0.03, 1.4),
      rocket: new THREE.ConeGeometry(0.07, 0.28, 6)
    };

    this.projectiles = [];
    this.maxProjectiles = 34;
    this._lastShootSoundMs = 0;
    this._lastHitSoundMs = 0;
    this._vel = new THREE.Vector3();
    this._trailTmp = new THREE.Vector3();

    this.audioContext = null;
    this.initAudio();
    this.setWeapon('disco');
    this.setupInput();
  }

  setWeapon(type) {
    const def = WEAPON_DEFS[type];
    if (!def) return;
    this.currentType = type;
    this.damage = def.damage;
    this.normalFireRate = def.fireRate;
    this.rapidFireRate = def.rapidRate;
    this.projDuration = def.projDuration;
    this.projColors = def.colors;
    this.soundDef = def.sound;

    for (const p of this.projectiles) {
      p.visible = false;
      p.userData.active = false;
      this.scene.remove(p);
      if (p.isMesh) p.material?.dispose();
      else p.traverse(c => { if (c.isMesh) c.material?.dispose(); });
    }
    this.projectiles = [];
  }

  initAudio() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {}
  }

  playShootSound(rapidFire = false) {
    if (!this.audioContext) return;
    const now = performance.now();
    const minGap = rapidFire ? 58 : 0;
    if (now - this._lastShootSoundMs < minGap) return;
    this._lastShootSoundMs = now;
    try {
      if (this.audioContext.state === 'suspended') this.audioContext.resume();
      const s = this.soundDef;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.type = s.type;
      osc.frequency.setValueAtTime(s.freq, this.audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(s.end, 1), this.audioContext.currentTime + s.dur);
      gain.gain.setValueAtTime(0.15, this.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + s.dur);
      osc.start();
      osc.stop(this.audioContext.currentTime + s.dur);
    } catch (e) {}
  }

  playHitSound() {
    if (!this.audioContext) return;
    const now = performance.now();
    if (now - this._lastHitSoundMs < 48) return;
    this._lastHitSoundMs = now;
    try {
      if (this.audioContext.state === 'suspended') this.audioContext.resume();
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1000, this.audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, this.audioContext.currentTime + 0.05);
      gain.gain.setValueAtTime(0.1, this.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.06);
      osc.start();
      osc.stop(this.audioContext.currentTime + 0.06);
    } catch (e) {}
  }

  setupInput() {
    document.addEventListener('mousedown', (e) => { if (e.button === 0) this.isHolding = true; });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.isHolding = false; });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement) this.isHolding = false;
    });

    const fireBtn = document.getElementById('fire-btn');
    if (fireBtn) {
      fireBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.isHolding = true; }, { passive: false });
      fireBtn.addEventListener('touchend', (e) => { e.preventDefault(); this.isHolding = false; }, { passive: false });
      fireBtn.addEventListener('touchcancel', () => { this.isHolding = false; });
    }
  }

  getMuzzleWorldPosition() {
    const pos = this.camera.position.clone();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return pos.add(dir.multiplyScalar(0.8));
  }

  tryFire(rapidFire = false) {
    if (!this.isHolding) return null;
    const now = performance.now();
    const rate = rapidFire ? this.rapidFireRate : this.normalFireRate;
    if (now - this.lastFireTime < rate) return null;

    this.lastFireTime = now;
    this.fireFlashUntil = now + 80;
    this.playShootSound(rapidFire);
    this.recoil = 0.03;
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);

    return {
      ray: this.raycaster.ray,
      origin: this.raycaster.ray.origin.clone(),
      direction: this.raycaster.ray.direction.clone()
    };
  }

  _makeGlowSphere(radius, color, opacity) {
    return new THREE.Mesh(
      new THREE.SphereGeometry(radius, 10, 8),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
  }

  createProjectile() {
    const colors = this.projColors;
    const color = colors[Math.floor(Math.random() * colors.length)];

    if (this.currentType === 'rocket') {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.07, 0.24, 8),
        new THREE.MeshBasicMaterial({ color: 0xff3300 })
      );
      const nose = new THREE.Mesh(
        new THREE.ConeGeometry(0.06, 0.12, 8),
        new THREE.MeshBasicMaterial({ color: 0xff1100 })
      );
      nose.position.y = 0.17;
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.055, 0.012, 6, 16),
        new THREE.MeshBasicMaterial({ color: 0xffcc00 })
      );
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.02;
      const exhaust = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      exhaust.position.y = -0.16;
      const trailA = this._makeGlowSphere(0.09, 0xff6600, 0.35);
      trailA.position.y = -0.32;
      const trailB = this._makeGlowSphere(0.06, 0xff3300, 0.22);
      trailB.position.y = -0.48;
      group.add(body, nose, band, exhaust, trailA, trailB);
      group.rotation.x = Math.PI / 2;
      group.visible = false;
      group.userData = { active: false, isGroup: true, trails: [trailA, trailB] };
      this.scene.add(group);
      return group;
    }

    if (this.currentType === 'disco') {
      const group = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.1, 1),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.98 })
      );
      const ringColor = colors[1] ?? color;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.11, 0.018, 6, 20),
        new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      ring.rotation.x = Math.PI / 2.2;
      const glow = this._makeGlowSphere(0.16, color, 0.28);
      const t1 = this._makeGlowSphere(0.07, colors[1] ?? color, 0.2);
      t1.position.z = 0.22;
      const t2 = this._makeGlowSphere(0.05, colors[2] ?? color, 0.14);
      t2.position.z = 0.38;
      group.add(core, ring, glow, t1, t2);
      group.visible = false;
      group.userData = { active: false, isGroup: true, core, ring, glow, trails: [t1, t2] };
      this.scene.add(group);
      return group;
    }

    if (this.currentType === 'gatling') {
      const group = new THREE.Group();
      const slug = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.022, 0.22, 6),
        new THREE.MeshBasicMaterial({ color: 0xffee88, transparent: true, opacity: 0.98 })
      );
      slug.rotation.x = Math.PI / 2;
      const jacket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.032, 0.14, 6),
        new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      jacket.rotation.x = Math.PI / 2;
      const t1 = this._makeGlowSphere(0.04, 0xffcc44, 0.35);
      t1.position.z = 0.16;
      const t2 = this._makeGlowSphere(0.028, 0xff8800, 0.22);
      t2.position.z = 0.28;
      group.add(slug, jacket, t1, t2);
      group.visible = false;
      group.userData = { active: false, isGroup: true, trails: [t1, t2] };
      this.scene.add(group);
      return group;
    }

    if (this.currentType === 'laser') {
      const group = new THREE.Group();
      const bolt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.035, 1.5, 8),
        new THREE.MeshBasicMaterial({ color: 0x88ffff, transparent: true, opacity: 0.95 })
      );
      bolt.rotation.x = Math.PI / 2;
      const sheath = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.055, 1.35, 8),
        new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      sheath.rotation.x = Math.PI / 2;
      const cap = this._makeGlowSphere(0.08, 0xffffff, 0.42);
      cap.position.z = -0.78;
      const tail = this._makeGlowSphere(0.06, 0x00ccff, 0.28);
      tail.position.z = 0.62;
      group.add(bolt, sheath, cap, tail);
      group.visible = false;
      group.userData = { active: false, isGroup: true, trails: [tail] };
      this.scene.add(group);
      return group;
    }

    const geo = this.geos[this.currentType];
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const proj = new THREE.Mesh(geo, mat);
    proj.visible = false;
    proj.userData = { active: false };
    this.scene.add(proj);
    return proj;
  }

  spawnProjectile(origin, targetPosition, onHit) {
    let proj = this.projectiles.find(p => !p.userData.active);
    if (!proj) {
      if (this.projectiles.length >= this.maxProjectiles) return;
      proj = this.createProjectile();
      this.projectiles.push(proj);
    }

    proj.position.copy(origin);
    proj.visible = true;
    proj.userData.active = true;
    proj.userData.startTime = performance.now();
    proj.userData.origin = origin.clone();
    proj.userData.target = targetPosition instanceof THREE.Vector3 ? targetPosition.clone() : new THREE.Vector3(targetPosition.x, targetPosition.y, targetPosition.z);
    proj.userData.onHit = onHit;
    proj.userData.duration = this.projDuration;
    proj.userData.weaponType = this.currentType;

    this._vel.subVectors(proj.userData.target, proj.userData.origin);
    if (this._vel.lengthSq() < 1e-6) this._vel.set(0, 0, -1);
    else this._vel.normalize();
    proj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this._vel);
  }

  update(deltaTime) {
    if (this.recoil > 0) {
      this.recoil -= deltaTime * 8;
      if (this.recoil < 0) this.recoil = 0;
    }

    const now = performance.now();

    for (const p of this.projectiles) {
      if (!p.userData.active) continue;

      const elapsed = (now - p.userData.startTime) / 1000;
      const t = Math.min(elapsed / p.userData.duration, 1);
      p.position.lerpVectors(p.userData.origin, p.userData.target, t);

      this._vel.subVectors(p.userData.target, p.userData.origin);
      if (this._vel.lengthSq() > 1e-6) {
        this._vel.normalize();
        p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this._vel);
      }

      const wt = p.userData.weaponType;
      if (p.userData.isGroup) {
        if (wt === 'disco') {
          const ring = p.userData.ring;
          if (ring) {
            ring.rotation.z += deltaTime * 14;
            ring.rotation.x += deltaTime * 6;
          }
          const core = p.userData.core;
          if (core) {
            core.rotation.y += deltaTime * 11;
            core.rotation.x += deltaTime * 7;
          }
          const pulse = 1 + Math.sin(now * 0.02) * 0.08;
          if (p.userData.glow) p.userData.glow.scale.setScalar(pulse);
        } else if (wt === 'gatling') {
          p.rotation.z += deltaTime * 22;
        } else if (wt === 'laser') {
          const flick = 0.92 + Math.sin(now * 0.045) * 0.08;
          p.scale.setScalar(flick);
        } else if (wt === 'rocket') {
          p.rotation.z += deltaTime * 5;
          const tr = p.userData.trails;
          if (tr) {
            tr[0].scale.setScalar(0.85 + Math.sin(now * 0.05) * 0.2);
            tr[1].scale.setScalar(0.75 + Math.cos(now * 0.06) * 0.15);
          }
        }
      } else if (wt === 'gatling') {
        p.rotation.z += deltaTime * 20;
      }

      if (t >= 1) {
        p.visible = false;
        p.userData.active = false;
        p.scale.setScalar(1);
        if (p.userData.onHit) p.userData.onHit();
      }
    }
  }
}
