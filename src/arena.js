/**
 * Arena - Level-based themed environments
 * ZERO per-frame canvas work on walls. Wall decals redraw only on level change.
 */

import * as THREE from 'three';

export const LEVELS = [
  {
    name: 'NEON INFERNO',
    bg: 0x1a0a2e,
    tiles: ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#00bcd4', '#ff5722', '#f44336', '#ff9800'],
    wallTint: '#2a1040',
    neon: 0xff00ff,
    sparkles: ['#ff0088', '#ff00ff', '#ff6600', '#ff3366'],
    mantraColors: ['#ff0088', '#ff00ff', '#00ffff'],
    effect: { type: 'playerDmgBoost', value: 1.15, label: '+15% PLAYER DMG' }
  },
  {
    name: 'TOXIC RAVE',
    bg: 0x0a1a0a,
    tiles: ['#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#00e676', '#76ff03', '#69f0ae', '#b2ff59'],
    wallTint: '#0a2010',
    neon: 0x00ff00,
    sparkles: ['#00ff88', '#88ff00', '#ffff00', '#00ff00'],
    mantraColors: ['#00ff88', '#88ff00', '#ffff00'],
    effect: { type: 'poisonDOT', value: 2, interval: 2000, label: 'ENEMIES TAKE POISON' }
  },
  {
    name: 'CRIMSON PULSE',
    bg: 0x1a0505,
    tiles: ['#f44336', '#e91e63', '#ff5722', '#ff9800', '#d32f2f', '#c62828', '#ff7043', '#ff8a65'],
    wallTint: '#2a0808',
    neon: 0xff0000,
    sparkles: ['#ff0044', '#ff4400', '#ff0000', '#ff6600'],
    mantraColors: ['#ff0044', '#ff4400', '#ffaa00'],
    effect: { type: 'scoreBoost', value: 1.5, label: '+50% SCORE' }
  },
  {
    name: 'ICE CAGE',
    bg: 0x051a2a,
    tiles: ['#00bcd4', '#03a9f4', '#2196f3', '#00acc1', '#0097a7', '#00838f', '#4dd0e1', '#80deea'],
    wallTint: '#081828',
    neon: 0x00ffff,
    sparkles: ['#00ffff', '#00ccff', '#0088ff', '#00aaff'],
    mantraColors: ['#00ffff', '#0088ff', '#88ffff'],
    effect: { type: 'enemySlow', value: 0.75, label: 'ENEMIES SLOWED' }
  },
  {
    name: 'VOID CHAMBER',
    bg: 0x0a0515,
    tiles: ['#4a148c', '#6a1b9a', '#7b1fa2', '#8e24aa', '#311b92', '#4527a0', '#512da8', '#5e35b1'],
    wallTint: '#100520',
    neon: 0xaa00ff,
    sparkles: ['#aa00ff', '#7700ff', '#dd00ff', '#9900ff'],
    mantraColors: ['#aa00ff', '#dd00ff', '#ff00ff'],
    effect: { type: 'doubleCoins', value: 2, label: '2X COINS' }
  },
  {
    name: 'CHAOS CORE',
    bg: 0x150a0a,
    tiles: ['#ff0088', '#00ff88', '#ffff00', '#00ffff', '#ff6600', '#ff00ff', '#ff0000', '#00ff00'],
    wallTint: '#1a0a1a',
    neon: 0xffffff,
    sparkles: ['#ff0088', '#00ff88', '#ffff00', '#00ffff', '#ff6600', '#ff00ff'],
    mantraColors: ['#ff0088', '#00ff88', '#ffff00', '#00ffff'],
    effect: { type: 'chaosMode', playerDmg: 1.25, enemyDmg: 1.25, label: 'CHAOS: ALL BUFFED' }
  }
];

export class Arena {
  constructor(scene, physicsWorld, opts = {}) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this._floorTexSize = opts.floorTextureSize ?? 1024;
    this._wallDecalW = opts.wallDecalWidth ?? 512;
    this._wallDecalH = opts.wallDecalHeight ?? 256;
    this._floorAniso = opts.floorAnisotropy ?? 12;
    this.currentLevel = 0;
    this.wallDecals = [];
    this.wallMeshes = [];
    this.neonTrimMeshes = [];
    this.planets = [];

    this.hazardGroup = new THREE.Group();
    this.scene.add(this.hazardGroup);
    this.spikeZones = [];
    this.asteroids = [];
    this.hazardCooldownUntil = 0;

    /** True once every level index has a cached floor + wall row (fast swaps in setLevel). */
    this.levelAssetsPrebaked = false;
    this._floorTexturesByLevel = [];
    this._wallTexturesByLevel = [];
    this._hazardBuildRaf = null;
    this._liteMobile = opts.liteMobileVisuals === true;
    this._prebakeStaggerFrames = Math.max(1, Math.min(4, opts.staggerPrebakeFrames ?? 1));
    /** When true, drop baked arena textures for levels not adjacent to the active one (mobile VRAM). */
    this._evictRemoteTexturesOnMobile = opts.evictRemoteTexturesOnMobile === true;

    this.createFloor();
    this.createSpaceSky();
    this.createWalls();
    this.setLevel(0);
  }

  createFloor() {
    const W = this._floorTexSize;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = W;
    this.floorCanvas = canvas;
    this.floorCtx = canvas.getContext('2d');

    this.floorTexture = new THREE.CanvasTexture(canvas);
    this.floorTexture.wrapS = THREE.RepeatWrapping;
    this.floorTexture.wrapT = THREE.RepeatWrapping;
    this.floorTexture.repeat.set(2.5, 2.5);
    this.floorTexture.anisotropy = this._floorAniso;

    const floorGeo = new THREE.PlaneGeometry(50, 50);
    this.floorMat = new THREE.MeshStandardMaterial({
      map: this.floorTexture,
      roughness: 0.42,
      metalness: 0.38,
      envMapIntensity: 0
    });
    this.floorMesh = new THREE.Mesh(floorGeo, this.floorMat);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.position.y = 0.01;
    this.scene.add(this.floorMesh);

    const baseMat = new THREE.MeshStandardMaterial({ color: 0x0a0814, roughness: 0.95, metalness: 0.1 });
    this.baseMesh = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), baseMat);
    this.baseMesh.rotation.x = -Math.PI / 2;
    this.baseMesh.position.y = -0.02;
    this.scene.add(this.baseMesh);
  }

  clearHazards() {
    const materials = new Set();
    this.hazardGroup.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry?.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        if (m) materials.add(m);
      }
    });
    for (const m of materials) {
      m.dispose?.();
    }
    while (this.hazardGroup.children.length) {
      this.hazardGroup.remove(this.hazardGroup.children[0]);
    }
    this.spikeZones = [];
    this.asteroids = [];
  }

  /** Spikes + asteroids only; call after clearHazards (used deferred on level change to avoid frame spikes). */
  fillHazardMeshes(levelIndex) {
    if (levelIndex < 2) return;

    const level = LEVELS[levelIndex];
    const spikeNeon = new THREE.Color(level.neon);
    const spikeMat = new THREE.MeshStandardMaterial({
      color: spikeNeon.clone().multiplyScalar(0.22),
      emissive: spikeNeon,
      emissiveIntensity: 0.22,
      metalness: 0.65,
      roughness: 0.32
    });

    const spots = [
      { x: 11, z: -9, r: 2.25 },
      { x: -12, z: 10, r: 2.05 },
      { x: -9, z: -12, r: 2.15 },
      { x: 13, z: 11, r: 1.95 }
    ];
    const patchCount = levelIndex >= 4 ? 4 : 3;

    for (let s = 0; s < patchCount; s++) {
      const spot = spots[s];
      const n = 7 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + Math.random() * 0.45;
        const rad = spot.r * (0.32 + Math.random() * 0.58);
        const sx = spot.x + Math.cos(ang) * rad;
        const sz = spot.z + Math.sin(ang) * rad;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.52 + Math.random() * 0.12, 5), spikeMat);
        spike.position.set(sx, 0.26 + Math.random() * 0.04, sz);
        const lean = 0.06 + Math.random() * 0.1;
        spike.rotation.x = (Math.random() - 0.5) * lean;
        spike.rotation.z = (Math.random() - 0.5) * lean;
        spike.rotation.y = Math.random() * Math.PI * 2;
        this.hazardGroup.add(spike);
      }
      this.spikeZones.push({ x: spot.x, z: spot.z, r: spot.r + 0.45, dmg: 12 });
    }

    if (levelIndex >= 4) {
      const rockMat = new THREE.MeshStandardMaterial({
        color: 0x4a4a55,
        metalness: 0.5,
        roughness: 0.48,
        emissive: 0x120810,
        emissiveIntensity: 0.12
      });
      for (let i = 0; i < 5; i++) {
        const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38 + Math.random() * 0.42, 1), rockMat);
        const orbitR = 6.5 + Math.random() * 13;
        const speed = 0.2 + Math.random() * 0.38;
        const height = 1.35 + Math.random() * 2.35;
        this.hazardGroup.add(mesh);
        this.asteroids.push({
          mesh,
          angle: Math.random() * Math.PI * 2,
          orbitR,
          speed,
          height,
          wobble: Math.random() * Math.PI * 2,
          hitR: 1.08,
          dmg: 19
        });
      }
    }
  }

  scheduleHazardMeshes(levelIndex) {
    if (this._hazardBuildRaf != null) {
      cancelAnimationFrame(this._hazardBuildRaf);
      this._hazardBuildRaf = null;
    }
    const captured = levelIndex;
    this._hazardBuildRaf = requestAnimationFrame(() => {
      this._hazardBuildRaf = null;
      if (this.currentLevel !== captured) return;
      this.fillHazardMeshes(captured);
    });
  }

  buildHazards(levelIndex) {
    this.clearHazards();
    if (levelIndex < 2) return;
    this.fillHazardMeshes(levelIndex);
  }

  updateHazards(deltaTime) {
    const t = performance.now() * 0.001;
    for (const a of this.asteroids) {
      a.angle += deltaTime * a.speed;
      const wx = Math.sin(t * 0.72 + a.wobble) * 0.85;
      const wz = Math.cos(t * 0.58 + a.wobble * 1.2) * 0.65;
      a.mesh.position.set(
        Math.cos(a.angle) * a.orbitR + wx,
        a.height + Math.sin(t * 1.05 + a.wobble) * 0.28,
        Math.sin(a.angle) * a.orbitR + wz
      );
      a.mesh.rotation.x += deltaTime * 1.15;
      a.mesh.rotation.y += deltaTime * 1.75;
    }
  }

  pollTrapDamage(px, pz, py, nowMs) {
    if (nowMs < this.hazardCooldownUntil) return 0;
    let dmg = 0;
    for (const z of this.spikeZones) {
      const dx = px - z.x;
      const dz = pz - z.z;
      if (dx * dx + dz * dz <= z.r * z.r) dmg = Math.max(dmg, z.dmg);
    }
    for (const a of this.asteroids) {
      const m = a.mesh.position;
      const dx = px - m.x;
      const dy = (py - 0.9) - m.y;
      const dz = pz - m.z;
      if (dx * dx + dy * dy + dz * dz <= a.hitR * a.hitR) dmg = Math.max(dmg, a.dmg);
    }
    if (dmg > 0) {
      this.hazardCooldownUntil = nowMs + 440;
      return dmg;
    }
    return 0;
  }

  drawFloorToContext(ctx, level, sizePx) {
    const tiles = 16;
    const ts = sizePx / tiles;
    const colors = level.tiles;

    ctx.fillStyle = '#030208';
    ctx.fillRect(0, 0, sizePx, sizePx);

    for (let x = 0; x < tiles; x++) {
      for (let y = 0; y < tiles; y++) {
        const idx = (x + y) % colors.length;
        const px = x * ts;
        const py = y * ts;
        const g = ctx.createLinearGradient(px, py, px + ts, py + ts);
        g.addColorStop(0, colors[idx]);
        g.addColorStop(0.55, colors[(idx + 1) % colors.length]);
        g.addColorStop(1, colors[(idx + colors.length - 1) % colors.length]);
        ctx.fillStyle = g;
        ctx.fillRect(px, py, ts + 0.5, ts + 0.5);

        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1.75;
        ctx.strokeRect(px + 0.5, py + 0.5, ts - 1, ts - 1);

        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px + 4, py + ts - 5);
        ctx.lineTo(px + ts - 4, py + 5);
        ctx.stroke();

        const gloss = ctx.createLinearGradient(px, py, px, py + ts * 0.45);
        gloss.addColorStop(0, 'rgba(255,255,255,0.14)');
        gloss.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gloss;
        ctx.fillRect(px + 2, py + 2, ts - 4, ts * 0.38);

        if (((x + y) & 3) === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.04)';
          ctx.fillRect(px, py + ts * 0.5, ts, 1);
        }
      }
    }

    const cx = sizePx / 2;
    const cy = sizePx / 2;
    const ring = ctx.createRadialGradient(cx, cy, ts * 0.5, cx, cy, cx * 0.95);
    ring.addColorStop(0, 'rgba(255,255,255,0)');
    ring.addColorStop(0.72, 'rgba(0,0,0,0)');
    ring.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = ring;
    ctx.fillRect(0, 0, sizePx, sizePx);
  }

  drawFloor(level) {
    this.drawFloorToContext(this.floorCtx, level, this.floorCanvas.width);
    this.floorTexture.needsUpdate = true;
  }

  _isLevelPrebaked(L) {
    const f = this._floorTexturesByLevel[L];
    const w = this._wallTexturesByLevel[L];
    return !!(f && w && w.length === 4);
  }

  _allLevelsPrebaked() {
    for (let i = 0; i < LEVELS.length; i++) {
      if (!this._isLevelPrebaked(i)) return false;
    }
    return true;
  }

  _disposeLevelBakedTextures(L) {
    if (L < 0 || L >= LEVELS.length) return;
    const ft = this._floorTexturesByLevel[L];
    if (ft) {
      ft.dispose();
      delete this._floorTexturesByLevel[L];
    }
    const row = this._wallTexturesByLevel[L];
    if (row && row.length) {
      for (const t of row) {
        t?.dispose?.();
      }
      delete this._wallTexturesByLevel[L];
    }
  }

  /**
   * Mobile: free GPU memory for arena levels that are not the active level or its neighbors (wrapping).
   * Re-bakes on demand via ensureLevelTexturesReadySync when returning to an evicted level.
   */
  evictRemoteLevelTextures(anchorLevel) {
    if (!this._evictRemoteTexturesOnMobile) return;
    const n = LEVELS.length;
    const L0 = ((anchorLevel % n) + n) % n;
    const keep = new Set();
    for (let d = -1; d <= 1; d++) {
      let L = L0 + d;
      L = ((L % n) + n) % n;
      keep.add(L);
    }
    for (let L = 0; L < n; L++) {
      if (keep.has(L)) continue;
      this._disposeLevelBakedTextures(L);
    }
    this.levelAssetsPrebaked = this._allLevelsPrebaked();
  }

  /** Synchronous bake for one level (used when entering a level before background prebake finished). */
  _bakeLevelTexturesSync(L) {
    if (L < 0 || L >= LEVELS.length || this._isLevelPrebaked(L)) return;
    const W = this.floorCanvas.width;
    const cw = this._wallDecalW;
    const ch = this._wallDecalH;
    const level = LEVELS[L];

    const fc = document.createElement('canvas');
    fc.width = W;
    fc.height = W;
    this.drawFloorToContext(fc.getContext('2d'), level, W);
    const floorTex = new THREE.CanvasTexture(fc);
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.copy(this.floorTexture.repeat);
    floorTex.anisotropy = this.floorTexture.anisotropy;
    if ('colorSpace' in floorTex && 'colorSpace' in this.floorTexture) {
      floorTex.colorSpace = this.floorTexture.colorSpace;
    }
    this._floorTexturesByLevel[L] = floorTex;

    const wallRow = [];
    for (let wi = 0; wi < 4; wi++) {
      const dc = document.createElement('canvas');
      dc.width = cw;
      dc.height = ch;
      const dctx = dc.getContext('2d');
      this.drawDiscoWallPanel(level, L, wi, dctx, cw, ch);
      wallRow.push(new THREE.CanvasTexture(dc));
    }
    this._wallTexturesByLevel[L] = wallRow;
  }

  /**
   * Ensure level `levelIndex` has baked textures (mobile lazy path). Safe no-op when already baked.
   */
  ensureLevelTexturesReadySync(levelIndex) {
    const L = ((levelIndex % LEVELS.length) + LEVELS.length) % LEVELS.length;
    this._bakeLevelTexturesSync(L);
    if (this._allLevelsPrebaked()) this.levelAssetsPrebaked = true;
  }

  /**
   * Rasterize arena floors + disco walls. Desktop: all levels at load. Mobile: pass onlyLevels for a subset.
   * @param {{ onlyLevels?: number[] }} [options]
   */
  async prebakeLevelTexturesAsync(options = {}) {
    if (this.levelAssetsPrebaked) return;

    const explicit = options.onlyLevels;
    let levelsToBake;
    if (explicit != null && explicit.length) {
      levelsToBake = explicit.filter((L) => L >= 0 && L < LEVELS.length && !this._isLevelPrebaked(L));
    } else {
      levelsToBake = [];
      for (let L = 0; L < LEVELS.length; L++) {
        if (!this._isLevelPrebaked(L)) levelsToBake.push(L);
      }
    }

    if (levelsToBake.length === 0) {
      if (this._allLevelsPrebaked()) this.levelAssetsPrebaked = true;
      return;
    }

    for (const L of levelsToBake) {
      for (let s = 0; s < this._prebakeStaggerFrames; s++) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      this._bakeLevelTexturesSync(L);
    }

    if (this._allLevelsPrebaked()) this.levelAssetsPrebaked = true;
    this.setLevel(this.currentLevel);
  }

  createSpaceSky() {
    const lite = this._liteMobile === true;
    const S = lite ? 512 : 1024;
    const starCount = lite ? 220 : 500;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');

    const bg = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.7);
    bg.addColorStop(0, '#0c0428');
    bg.addColorStop(0.4, '#06021a');
    bg.addColorStop(0.7, '#030010');
    bg.addColorStop(1, '#000005');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, S, S);

    const nebulae = [
      { x: 200, y: 300, rx: 220, ry: 120, color: 'rgba(100,0,180,0.06)' },
      { x: 700, y: 200, rx: 180, ry: 160, color: 'rgba(0,60,180,0.05)' },
      { x: 500, y: 750, rx: 250, ry: 100, color: 'rgba(180,0,80,0.05)' },
      { x: 150, y: 800, rx: 200, ry: 140, color: 'rgba(0,120,100,0.04)' }
    ];
    nebulae.forEach(n => {
      for (let layer = 0; layer < 5; layer++) {
        const ng = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.rx + layer * 20);
        ng.addColorStop(0, n.color);
        ng.addColorStop(1, 'transparent');
        ctx.fillStyle = ng;
        ctx.beginPath();
        ctx.ellipse(n.x, n.y, n.rx + layer * 20, n.ry + layer * 15, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    const starColors = ['#ffffff', '#fff8e0', '#e0f0ff', '#ffe8cc', '#d0e8ff', '#ffd0e0'];
    for (let i = 0; i < starCount; i++) {
      const sx = (i * 1337 + 29) % S;
      const sy = (i * 2111 + 53) % S;
      const size = i < 20 ? (2.5 + (i % 3)) : (i < 80 ? (1.5 + (i % 2)) : (0.5 + (i % 2) * 0.5));
      const alpha = i < 20 ? (0.8 + (i % 3) * 0.07) : (0.25 + ((i * 7) % 10) / 14);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = starColors[i % starColors.length];
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fill();

      if (i < 30) {
        ctx.globalAlpha = alpha * 0.15;
        ctx.beginPath();
        ctx.arc(sx, sy, size * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    const planetDefs = [
      { x: 180, y: 130, r: 55, colors: ['#ff5544', '#cc2200', '#881100', '#440800'], ring: true, ringColor: 'rgba(255,100,50,0.2)' },
      { x: 780, y: 200, r: 42, colors: ['#4488ff', '#2266dd', '#1144aa', '#002266'], ring: false },
      { x: 400, y: 850, r: 65, colors: ['#aa44ff', '#8822dd', '#6600aa', '#330066'], ring: true, ringColor: 'rgba(170,70,255,0.15)' },
      { x: 850, y: 700, r: 35, colors: ['#ffcc00', '#ff9900', '#cc6600', '#884400'], ring: false },
      { x: 120, y: 650, r: 80, colors: ['#22ccaa', '#118866', '#006644', '#003322'], ring: true, ringColor: 'rgba(0,200,160,0.1)' }
    ];
    planetDefs.forEach(p => {
      const pg = ctx.createRadialGradient(p.x - p.r * 0.25, p.y - p.r * 0.25, p.r * 0.05, p.x, p.y, p.r);
      pg.addColorStop(0, p.colors[0]);
      pg.addColorStop(0.4, p.colors[1]);
      pg.addColorStop(0.75, p.colors[2]);
      pg.addColorStop(1, p.colors[3]);
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.15;
      const atmo = ctx.createRadialGradient(p.x, p.y, p.r * 0.9, p.x, p.y, p.r * 1.2);
      atmo.addColorStop(0, p.colors[0]);
      atmo.addColorStop(1, 'transparent');
      ctx.fillStyle = atmo;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      if (p.ring) {
        ctx.strokeStyle = p.ringColor;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.r * 1.8, p.r * 0.35, -0.3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.r * 2.1, p.r * 0.4, -0.3, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    const skyTexture = new THREE.CanvasTexture(canvas);
    const skySegX = lite ? 16 : 24;
    const skySegY = lite ? 12 : 16;
    const skyGeo = new THREE.SphereGeometry(85, skySegX, skySegY);
    const skyMat = new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide });
    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyMesh);

    const planet3D = [
      { pos: [25, 35, -45], r: 4, color: 0xff4466, emissive: 0x661122 },
      { pos: [-35, 45, 25], r: 5, color: 0x4488ff, emissive: 0x112244 },
      { pos: [15, 55, 35], r: 3.5, color: 0xaa44ff, emissive: 0x441166 },
      { pos: [-20, 50, -40], r: 6, color: 0x22ccaa, emissive: 0x0a4433 },
      { pos: [40, 30, 20], r: 2.5, color: 0xffcc44, emissive: 0x443300 }
    ];
    const pSeg = lite ? 8 : 12;
    const pRing = lite ? 6 : 8;
    const torTube = lite ? 3 : 4;
    const torRadial = lite ? 12 : 24;
    planet3D.forEach((p, i) => {
      const geo = new THREE.SphereGeometry(p.r, pSeg, pRing);
      const mat = new THREE.MeshBasicMaterial({ color: p.color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
      this.scene.add(mesh);
      this.planets.push(mesh);

      if (i < 2) {
        const ringGeo = new THREE.TorusGeometry(p.r * 1.6, 0.15, torTube, torRadial);
        const ringMat = new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2.5;
        mesh.add(ring);
      }
    });
  }

  createWalls() {
    const size = 25;
    const height = 6;

    const wallData = [
      { pos: [0, height / 2, -size], rot: 0, mantraRot: 0 },
      { pos: [0, height / 2, size], rot: 0, mantraRot: Math.PI },
      { pos: [-size, height / 2, 0], rot: Math.PI / 2, mantraRot: Math.PI / 2 },
      { pos: [size, height / 2, 0], rot: Math.PI / 2, mantraRot: Math.PI / 2 }
    ];

    wallData.forEach((w, i) => {
      const geo = new THREE.BoxGeometry(size * 2, height, 1);
      const wallMat = new THREE.MeshBasicMaterial({ color: 0x1a0a2e });
      const wall = new THREE.Mesh(geo, wallMat);
      wall.position.set(...w.pos);
      wall.rotation.y = w.rot;
      this.scene.add(wall);
      this.wallMeshes.push(wall);

      if (this.physicsWorld) {
        this.physicsWorld.createWall(
          { x: w.pos[0], y: w.pos[1], z: w.pos[2] },
          { x: w.rot === 0 ? size * 2 : 1, y: height, z: w.rot === 0 ? 1 : size * 2 }
        );
      }

      const decalCanvas = document.createElement('canvas');
      decalCanvas.width = this._wallDecalW;
      decalCanvas.height = this._wallDecalH;
      const decalCtx = decalCanvas.getContext('2d');
      const decalTex = new THREE.CanvasTexture(decalCanvas);

      const mantraPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(size * 1.6, height * 0.7),
        new THREE.MeshBasicMaterial({ map: decalTex, side: THREE.DoubleSide, transparent: true, depthTest: true })
      );
      mantraPlane.renderOrder = 100;
      const inset = 0.6;
      mantraPlane.position.set(
        w.pos[0] + (w.pos[0] < 0 ? inset : w.pos[0] > 0 ? -inset : 0),
        w.pos[1],
        w.pos[2] + (w.pos[2] < 0 ? inset : w.pos[2] > 0 ? -inset : 0)
      );
      mantraPlane.rotation.y = w.mantraRot ?? w.rot;
      this.scene.add(mantraPlane);

      this.wallDecals.push({ texture: decalTex, ctx: decalCtx, canvas: decalCanvas, plane: mantraPlane });

      const neon = new THREE.Mesh(
        new THREE.BoxGeometry(size * 2, 0.12, 0.12),
        new THREE.MeshBasicMaterial({ color: 0xff00ff })
      );
      neon.position.set(w.pos[0], height - 0.3, w.pos[2]);
      neon.rotation.y = w.rot;
      this.scene.add(neon);
      this.neonTrimMeshes.push(neon);
    });
  }

  drawDiscoWallPanel(level, levelIndex, wallIdx, ctx, w, h) {
    const colors = level.sparkles;
    const accents = level.mantraColors;
    const seed = (wallIdx + 1) * 1337 + (levelIndex + 1) * 911;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(6, 0, 14, 0.94)';
    ctx.fillRect(0, 0, w, h);

    const stripes = 18;
    for (let s = 0; s < stripes; s++) {
      const x = (s / stripes) * w;
      const bw = w / stripes + 1.5;
      const c1 = colors[(s + wallIdx) % colors.length];
      const c2 = colors[(s + 2 + wallIdx) % colors.length];
      const g = ctx.createLinearGradient(x, 0, x + bw * 0.6, h);
      g.addColorStop(0, c1 + '66');
      g.addColorStop(0.45, c2 + '33');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, bw, h);
    }

    ctx.globalAlpha = 0.07;
    for (let y = 0; y < h; y += 5) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, y, w, 1);
    }
    ctx.globalAlpha = 1;

    const spotCount = 14;
    for (let i = 0; i < spotCount; i++) {
      const sx = ((seed * (i + 3)) % 1000) / 1000 * (w - 48) + 24;
      const sy = ((seed * (i + 7) + i * 19) % 1000) / 1000 * (h - 48) + 24;
      const rad = 14 + ((seed + i * 37) % 36);
      const ac = accents[i % accents.length];
      const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad);
      rg.addColorStop(0, ac + 'dd');
      rg.addColorStop(0.35, ac + '55');
      rg.addColorStop(1, 'transparent');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(sx, sy, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = accents[wallIdx % accents.length] + '99';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(6, 6, w - 12, h - 12);
  }

  drawDiscoWalls(level) {
    this.wallDecals.forEach((m, wallIdx) => {
      this.drawDiscoWallPanel(level, this.currentLevel, wallIdx, m.ctx, m.canvas.width, m.canvas.height);
      m.texture.needsUpdate = true;
    });
  }

  setLevel(levelIndex) {
    this.currentLevel = levelIndex % LEVELS.length;
    const level = LEVELS[this.currentLevel];

    this.scene.background = new THREE.Color(level.bg);

    if (this._isLevelPrebaked(this.currentLevel)) {
      this.floorMesh.material.map = this._floorTexturesByLevel[this.currentLevel];
      this.floorMesh.material.needsUpdate = true;
      const row = this._wallTexturesByLevel[this.currentLevel];
      for (let i = 0; i < this.wallDecals.length; i++) {
        if (row[i]) {
          this.wallDecals[i].plane.material.map = row[i];
          this.wallDecals[i].plane.material.needsUpdate = true;
        }
      }
    } else {
      this.drawFloor(level);
    }

    const wallColor = new THREE.Color(level.wallTint);
    this.wallMeshes.forEach(w => w.material.color.copy(wallColor));

    const neonColor = new THREE.Color(level.neon);
    this.neonTrimMeshes.forEach(n => n.material.color.copy(neonColor));

    if (this.baseMesh) this.baseMesh.material.color.set(level.bg);

    if (!this._isLevelPrebaked(this.currentLevel)) {
      this.drawDiscoWalls(level);
    }

    const neon = new THREE.Color(level.neon);
    if (this.floorMat) {
      this.floorMat.emissive.copy(neon);
      this.floorMat.emissiveIntensity = 0.04;
    }

    this.clearHazards();
    if (this.currentLevel < 2) {
      if (this._hazardBuildRaf != null) {
        cancelAnimationFrame(this._hazardBuildRaf);
        this._hazardBuildRaf = null;
      }
    } else {
      this.scheduleHazardMeshes(this.currentLevel);
    }
    return level;
  }

  getLevelName() {
    return LEVELS[this.currentLevel]?.name || 'UNKNOWN';
  }

  update(deltaTime) {
    if (this.asteroids.length) this.updateHazards(deltaTime);

    const pulse = Math.sin(performance.now() / 400) * 0.5 + 0.5;
    if (this.floorMat) {
      this.floorMat.emissiveIntensity = 0.03 + pulse * 0.09;
    }

    this.planets.forEach(p => p.rotation.y += deltaTime * 0.1);
  }
}
