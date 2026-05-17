/**
 * Secret boss: shoot the disco clock tower → shielded adds phase + vulnerable windows
 * + toxic artillery. On death, the run can hand off to the finale Toly boss.
 */

import * as THREE from 'three';

const PHASE = {
  IDLE: 'idle',
  ADDS: 'adds',
  VULNERABLE: 'vulnerable',
  DEAD: 'dead'
};

export class ClockTowerEasterEgg {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./enemy.js').EnemyManager} enemyManager
   * @param {import('./arena.js').Arena} arena
   * @param {{ isMobile?: boolean; getWaveManager?: () => import('./waves.js').WaveManager | null; onUiUpdate?: (p: object) => void; onDefeated?: () => void | Promise<void> }} opts
   */
  constructor(scene, enemyManager, arena, opts = {}) {
    this.scene = scene;
    this.enemyManager = enemyManager;
    this.arena = arena;
    this.isMobile = opts.isMobile === true;
    this._getWaveManager = typeof opts.getWaveManager === 'function' ? opts.getWaveManager : () => null;
    this.onUiUpdate = typeof opts.onUiUpdate === 'function' ? opts.onUiUpdate : null;
    this.onDefeated = typeof opts.onDefeated === 'function' ? opts.onDefeated : null;

    this.phase = PHASE.IDLE;
    this.roundIndex = 0;
    /** World-space aim point for hitscans (tower mass). */
    this._hitCenter = new THREE.Vector3(-46, 20, -8);
    this.maxHp = this.isMobile ? 52000 : 95000;
    this.hp = this.maxHp;

    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = 260;

    this._fwd = new THREE.Vector3();
    this._scratch = new THREE.Vector3();

    this._nextSpawnAt = 0;
    this._nextProjAt = 0;
    this._vulnerableEndsAt = 0;
    this._closingVulnerable = false;
    this._projOrigin = new THREE.Vector3(-46, 38, -8);

    /** @type {{ mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[]} */
    this._projectiles = [];
    /** @type {{ x: number; z: number; r: number; until: number; ring: THREE.Mesh }[]} */
    this._toxicPools = [];

    this._toxicScratch = 0;
    this._towerProjGeo = null;
    this._towerProjMat = null;
    /** One ring geo + mat for all toxic pools (was N× new RingGeometry per shot — WebKit OOM). */
    this._toxicRingGeo = null;
    this._toxicRingMat = null;
    this._maxToxicPools = this.isMobile ? 10 : 28;
    /** Avoid instant vulnerable before first adds spawn. */
    this._addsPhaseStartedAt = 0;
    /** @type {((damage: number) => void) | null} */
    this._onPlayerHit = null;
  }

  isActive() {
    return this.phase !== PHASE.IDLE && this.phase !== PHASE.DEAD;
  }

  /** Player weapons can only damage the tower in this phase. */
  isVulnerableForDamage() {
    return this.phase === PHASE.VULNERABLE;
  }

  reset() {
    this.phase = PHASE.IDLE;
    this.roundIndex = 0;
    this.hp = this.maxHp;
    this._clearProjectiles();
    this._clearPools();
    this._closingVulnerable = false;
  }

  _clearProjectiles() {
    for (const p of this._projectiles) {
      this.scene.remove(p.mesh);
    }
    this._projectiles = [];
  }

  _clearPools() {
    for (const pool of this._toxicPools) {
      this.scene.remove(pool.ring);
    }
    this._toxicPools = [];
  }

  _ensureToxicRingShared() {
    if (this._toxicRingGeo) return;
    const r = 2.6;
    const segs = this.isMobile ? 10 : 20;
    this._toxicRingGeo = new THREE.RingGeometry(r * 0.35, r, segs);
    this._toxicRingMat = new THREE.MeshBasicMaterial({
      color: 0x22ff44,
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this._toxicRingMat.userData.skipDispose = true;
  }

  _evictOldestToxicPool() {
    if (this._toxicPools.length === 0) return;
    const pool = this._toxicPools.shift();
    if (pool?.ring) this.scene.remove(pool.ring);
  }

  /**
   * First bullet that strikes tower geometry arms the encounter.
   * @returns {boolean} true if this shot triggered the start
   */
  tryActivateFromShot(origin, direction) {
    if (this.phase !== PHASE.IDLE) return false;
    const meshes = this.arena.clockTowerRaycastMeshes;
    if (!meshes?.length) return false;
    const dir = direction.clone();
    const len = dir.length();
    if (len < 1e-6) return false;
    dir.multiplyScalar(1 / len);
    this._raycaster.set(origin, dir);
    const hits = this._raycaster.intersectObjects(meshes, false);
    if (!hits.length) return false;
    if (hits[0].distance > 240) return false;
    this._armEncounter();
    return true;
  }

  _armEncounter() {
    this.phase = PHASE.ADDS;
    this.roundIndex = 0;
    this.hp = this.maxHp;
    this._nextSpawnAt = performance.now() + 600;
    this._nextProjAt = performance.now() + 900;
    this._vulnerableEndsAt = 0;
    this._closingVulnerable = false;

    this.enemyManager.clear();
    const wm = this._getWaveManager();
    if (wm) {
      wm.spawnQueue = [];
      wm.isWaveActive = false;
    }

    this._addsPhaseStartedAt = performance.now();
    this._spawnAddsBurst();

    if (this.onUiUpdate) {
      this.onUiUpdate({
        bossKind: 'clock',
        phase: 'adds',
        hpPct: 1,
        windowSec: 0
      });
    }
  }

  tryHitscan(muzzle, dir, damage) {
    if (this.phase !== PHASE.VULNERABLE) return 0;
    this._fwd.copy(dir).normalize();
    this._scratch.copy(this._hitCenter).sub(muzzle);
    const dist = this._scratch.length();
    if (dist < 8 || dist > 200) return 0;
    this._scratch.multiplyScalar(1 / dist);
    const dot = this._scratch.dot(this._fwd);
    if (dot < 0.82) return 0;

    const d = Math.max(1, Math.round(damage));
    this.hp = Math.max(0, this.hp - d);
    if (this.onUiUpdate) {
      this.onUiUpdate({
        bossKind: 'clock',
        phase: 'vulnerable',
        hpPct: this.hp / this.maxHp,
        windowSec: Math.max(0, (this._vulnerableEndsAt - performance.now()) / 1000)
      });
    }
    if (this.hp <= 0) {
      void this._onTowerDestroyed();
      return d;
    }
    return d;
  }

  tryAoE(centerX, centerZ, radius, damage) {
    if (this.phase !== PHASE.VULNERABLE) return 0;
    const dx = centerX - this._hitCenter.x;
    const dz = centerZ - this._hitCenter.z;
    if (dx * dx + dz * dz > (radius + 14) ** 2) return 0;
    const d = Math.max(1, Math.round(damage * 0.72));
    this.hp = Math.max(0, this.hp - d);
    if (this.onUiUpdate) {
      this.onUiUpdate({
        bossKind: 'clock',
        phase: 'vulnerable',
        hpPct: this.hp / this.maxHp,
        windowSec: Math.max(0, (this._vulnerableEndsAt - performance.now()) / 1000)
      });
    }
    if (this.hp <= 0) void this._onTowerDestroyed();
    return d;
  }

  trySpecialHit(kind, px, py, pz, damage) {
    if (this.phase !== PHASE.VULNERABLE) return 0;
    const dx = px - this._hitCenter.x;
    const dz = pz - this._hitCenter.z;
    if (dx * dx + dz * dz > 16 * 16 || Math.abs(py - this._hitCenter.y) > 22) return 0;
    const d = Math.max(1, Math.round(damage * 0.55));
    this.hp = Math.max(0, this.hp - d);
    if (this.onUiUpdate) {
      this.onUiUpdate({
        bossKind: 'clock',
        phase: 'vulnerable',
        hpPct: this.hp / this.maxHp,
        windowSec: Math.max(0, (this._vulnerableEndsAt - performance.now()) / 1000)
      });
    }
    if (this.hp <= 0) void this._onTowerDestroyed();
    return d;
  }

  _countAdds() {
    let n = 0;
    for (const e of this.enemyManager.enemies) {
      if (!e.userData.isDead && e.userData.isClockTowerAdd) n++;
    }
    return n;
  }

  _spawnAddsBurst() {
    const maxConc = this.isMobile ? 7 : 11;
    if (this._countAdds() >= maxConc) return;

    const n = Math.min(maxConc - this._countAdds(), 2 + (this.roundIndex % 3));
    const playerApprox = { x: 0, z: 1 };
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 9 + Math.random() * 12;
      let x = playerApprox.x + Math.cos(angle) * r;
      let z = playerApprox.z + Math.sin(angle) * r;
      x = Math.max(-22, Math.min(22, x));
      z = Math.max(-22, Math.min(22, z));
      const typeIndex = (i + this.roundIndex * 2) % 6;
      const enemy = this.enemyManager.spawnEnemySync(typeIndex, { x, y: 0, z }, false);
      if (enemy) {
        enemy.userData.isClockTowerAdd = true;
        const mul = 1.45 + this.roundIndex * 0.11;
        enemy.userData.health *= mul;
        enemy.userData.maxHealth = enemy.userData.health;
        enemy.userData.waveSpeedMul = (enemy.userData.waveSpeedMul || 1) * (1.05 + this.roundIndex * 0.04);
        enemy.userData.clockEggDmgMul = 1.15 + this.roundIndex * 0.06;
      }
    }
  }

  _openVulnerableWindow() {
    this.phase = PHASE.VULNERABLE;
    this._vulnerableEndsAt = performance.now() + (this.isMobile ? 4800 : 5500);
    if (this.onUiUpdate) {
      this.onUiUpdate({
        bossKind: 'clock',
        phase: 'vulnerable',
        hpPct: this.hp / this.maxHp,
        windowSec: (this._vulnerableEndsAt - performance.now()) / 1000
      });
    }
  }

  _closeVulnerableWindow() {
    if (this._closingVulnerable) return;
    this._closingVulnerable = true;
    this.phase = PHASE.ADDS;
    this.roundIndex++;
    this._nextSpawnAt = performance.now() + 700;
    this._addsPhaseStartedAt = performance.now();
    if (this.onUiUpdate) {
      this.onUiUpdate({
        bossKind: 'clock',
        phase: 'adds',
        hpPct: this.hp / this.maxHp,
        windowSec: 0
      });
    }
    requestAnimationFrame(() => {
      this._closingVulnerable = false;
    });
  }

  _fireProjectile(playerPos) {
    if (!this._towerProjGeo) {
      this._towerProjGeo = new THREE.SphereGeometry(0.42, this.isMobile ? 6 : 10, this.isMobile ? 5 : 8);
      this._towerProjMat = new THREE.MeshStandardMaterial({
        color: 0x22ff66,
        emissive: 0x00aa44,
        emissiveIntensity: 0.65,
        metalness: 0.35,
        roughness: 0.35
      });
    }
    const mesh = new THREE.Mesh(this._towerProjGeo, this._towerProjMat);
    mesh.position.copy(this._projOrigin);
    const target = new THREE.Vector3(playerPos.x, 1.15, playerPos.z);
    const vel = target.clone().sub(this._projOrigin);
    const L = vel.length() || 1;
    vel.multiplyScalar(34 / L);
    this.scene.add(mesh);
    this._projectiles.push({ mesh, vel, life: 4.5 });
  }

  _spawnToxicPool(x, z) {
    this._ensureToxicRingShared();
    while (this._toxicPools.length >= this._maxToxicPools) this._evictOldestToxicPool();
    const r = 2.6;
    const ring = new THREE.Mesh(this._toxicRingGeo, this._toxicRingMat);
    ring.userData.sharedRingPool = true;
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.03, z);
    this.scene.add(ring);
    this._toxicPools.push({ x, z, r, until: performance.now() + 10000, ring });
  }

  /**
   * @returns {number} damage dealt this frame
   */
  pollToxicDamage(px, pz, deltaSec) {
    if (!this._toxicPools.length) return 0;
    const now = performance.now();
    this._toxicScratch += deltaSec;
    let tick = false;
    if (this._toxicScratch >= 0.32) {
      tick = true;
      this._toxicScratch = 0;
    }

    let dmg = 0;
    for (let i = this._toxicPools.length - 1; i >= 0; i--) {
      const p = this._toxicPools[i];
      if (now > p.until) {
        this.scene.remove(p.ring);
        this._toxicPools.splice(i, 1);
        continue;
      }
      if (!tick) continue;
      const dx = px - p.x;
      const dz = pz - p.z;
      if (dx * dx + dz * dz < p.r * p.r) {
        dmg += this.isMobile ? 9 : 11;
      }
    }
    return dmg;
  }

  update(delta, playerPos) {
    if (this.phase === PHASE.IDLE || this.phase === PHASE.DEAD) return;

    const now = performance.now();

    if (this.phase === PHASE.ADDS) {
      if (now >= this._nextSpawnAt) {
        this._nextSpawnAt = now + (this.isMobile ? 3200 : 2600);
        this._spawnAddsBurst();
      }
      const addsMinTime = 3800;
      if (now - this._addsPhaseStartedAt >= addsMinTime && this._countAdds() === 0) {
        this._openVulnerableWindow();
      }
    }

    if (this.phase === PHASE.VULNERABLE) {
      if (!this._closingVulnerable && now >= this._vulnerableEndsAt) {
        if (this.hp > 0) this._closeVulnerableWindow();
      }
      if (this.onUiUpdate && now % 450 < 40) {
        this.onUiUpdate({
          bossKind: 'clock',
          phase: 'vulnerable',
          hpPct: this.hp / this.maxHp,
          windowSec: Math.max(0, (this._vulnerableEndsAt - now) / 1000)
        });
      }
    }

    if (this.phase === PHASE.ADDS || this.phase === PHASE.VULNERABLE) {
      if (now >= this._nextProjAt) {
        this._nextProjAt = now + (this.isMobile ? 1750 : 1350);
        this._fireProjectile(playerPos);
      }
    }

    this._integrateProjectiles(delta, playerPos);
  }

  _integrateProjectiles(delta, playerPos) {
    const px = playerPos.x;
    const pz = playerPos.z;
    const py = playerPos.y;

    for (let i = this._projectiles.length - 1; i >= 0; i--) {
      const p = this._projectiles[i];
      p.life -= delta;
      p.mesh.position.x += p.vel.x * delta;
      p.mesh.position.y += p.vel.y * delta;
      p.mesh.position.z += p.vel.z * delta;
      p.vel.y -= 9.2 * delta;

      const dx = p.mesh.position.x - px;
      const dz = p.mesh.position.z - pz;
      const dy = p.mesh.position.y - py;
      if (dx * dx + dy * dy + dz * dz < 1.15 * 1.15) {
        this.scene.remove(p.mesh);
        this._projectiles.splice(i, 1);
        if (this._onPlayerHit) this._onPlayerHit(this.isMobile ? 22 : 28);
        continue;
      }

      if (p.mesh.position.y < 0.2 || p.life <= 0) {
        this._spawnToxicPool(p.mesh.position.x, p.mesh.position.z);
        this.scene.remove(p.mesh);
        this._projectiles.splice(i, 1);
      }
    }
  }

  /** Wired from Game so projectiles can damage the player. */
  setPlayerHitCallback(fn) {
    this._onPlayerHit = typeof fn === 'function' ? fn : null;
  }

  getFxHitTarget(target) {
    if (!target) return target;
    target.copy(this._hitCenter);
    return target;
  }

  async _onTowerDestroyed() {
    if (this.phase === PHASE.DEAD) return;
    this.phase = PHASE.DEAD;
    this._clearProjectiles();
    this.enemyManager.clear();
    this._clearPools();

    if (this.onUiUpdate) {
      this.onUiUpdate({
        bossKind: 'clock',
        phase: 'dead',
        hpPct: 0,
        windowSec: 0
      });
    }

    try {
      if (this.onDefeated) await this.onDefeated();
    } catch (e) {
      console.warn('[ClockTowerEgg] onDefeated', e);
    }
  }
}
