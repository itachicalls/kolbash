/**
 * Arena - Level-based themed environments
 * ZERO per-frame canvas work. Textures drawn once per level change.
 * Mantras redrawn only on text rotation (every 3s).
 */

import * as THREE from 'three';

const MOCKERY_MANTRAS = [
  'DANCE INTO OBLIVION',
  'YOUR SCORE MEANS NOTHING',
  'WEAK. PREDICTABLE. DEAD.',
  'DID YOU REALLY THINK YOU\'D WIN?',
  'YOUR REFLEXES ARE A JOKE',
  'THE DISCO DEMANDS SACRIFICE',
  'GIT GUD OR GET DUSTED',
  'WAVE 1? MORE LIKE WAVE GOODBYE',
  'EVEN THE BOSS PITIES YOU',
  'SKILL ISSUE DETECTED',
  'RAGE QUIT IN 3... 2...',
  'PATHETIC ATTEMPT',
  'L + RATIO + DISCO\'D',
  'CRY HARDER',
  'UNINSTALL RECOMMENDED',
  'THE DANCERS LAUGH AT YOU',
  'PRESS F TO PAY RESPECTS',
  'BETTER LUCK NEXT LIFE',
  'YOU DIED. AGAIN.',
  'SIT DOWN. YOU\'RE DONE.',
  'NICE TRY, LOSER',
  'THIS IS EMBARRASSING',
  'THE DISCO REJECTS YOU',
  'GOOD GAME. BAD PLAYER.',
  'TOUCH GRASS. THEN COME BACK.',
  'THE BOSS LAUGHED',
  '0 SKILL. 100% SALT.',
  'YOU GOT DISCO\'D',
  'NOT EVEN CLOSE',
  'YOUR AIM: TRASH',
  'DELETED.',
  'RIP BOZO',
  'COPE. SEETHE. MALD.',
  'GG EZ',
  'TAKE THE L',
  'BOT DIFFICULTY: YOU'
];

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
  constructor(scene, physicsWorld) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.currentLevel = 0;
    this.wallMantras = [];
    this.wallMeshes = [];
    this.neonTrimMeshes = [];
    this.planets = [];

    this.mantraRotateTime = 0;
    this.mantraRotateInterval = 3000;
    this.mantraDirty = true;

    this.createFloor();
    this.createSpaceSky();
    this.createWalls();
    this.setLevel(0);
  }

  createFloor() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    this.floorCanvas = canvas;
    this.floorCtx = canvas.getContext('2d');

    this.floorTexture = new THREE.CanvasTexture(canvas);
    this.floorTexture.wrapS = THREE.RepeatWrapping;
    this.floorTexture.wrapT = THREE.RepeatWrapping;
    this.floorTexture.repeat.set(4, 4);

    const floorGeo = new THREE.PlaneGeometry(50, 50);
    const floorMat = new THREE.MeshBasicMaterial({ map: this.floorTexture });
    this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.position.y = 0.01;
    this.scene.add(this.floorMesh);

    const baseMat = new THREE.MeshBasicMaterial({ color: 0x0d0a18 });
    this.baseMesh = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), baseMat);
    this.baseMesh.rotation.x = -Math.PI / 2;
    this.scene.add(this.baseMesh);
  }

  drawFloor(level) {
    const ctx = this.floorCtx;
    const ts = 64;
    const colors = level.tiles;

    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        const idx = (x + y) % colors.length;
        ctx.fillStyle = colors[idx];
        ctx.fillRect(x * ts, y * ts, ts, ts);

        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x * ts + 1, y * ts + 1, ts - 2, ts - 2);

        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(x * ts + 3, y * ts + 3, ts - 6, ts / 3);
      }
    }

    this.floorTexture.needsUpdate = true;
  }

  createSpaceSky() {
    const S = 1024;
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
    for (let i = 0; i < 500; i++) {
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
    const skyGeo = new THREE.SphereGeometry(85, 24, 16);
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
    planet3D.forEach((p, i) => {
      const geo = new THREE.SphereGeometry(p.r, 12, 8);
      const mat = new THREE.MeshBasicMaterial({ color: p.color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
      this.scene.add(mesh);
      this.planets.push(mesh);

      if (i < 2) {
        const ringGeo = new THREE.TorusGeometry(p.r * 1.6, 0.15, 4, 24);
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

      const mantraCanvas = document.createElement('canvas');
      mantraCanvas.width = 512;
      mantraCanvas.height = 256;
      const mantraCtx = mantraCanvas.getContext('2d');
      const mantraTex = new THREE.CanvasTexture(mantraCanvas);

      const mantraPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(size * 1.6, height * 0.7),
        new THREE.MeshBasicMaterial({ map: mantraTex, side: THREE.DoubleSide, transparent: true, depthTest: true })
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

      this.wallMantras.push({
        texture: mantraTex, ctx: mantraCtx, canvas: mantraCanvas,
        mantraIdx: Math.floor(Math.random() * MOCKERY_MANTRAS.length)
      });

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

  drawMantras() {
    const level = LEVELS[this.currentLevel] || LEVELS[0];
    const mColors = level.mantraColors;

    this.wallMantras.forEach((m, wallIdx) => {
      const msg = MOCKERY_MANTRAS[m.mantraIdx % MOCKERY_MANTRAS.length];
      const ctx = m.ctx;
      const w = m.canvas.width;
      const h = m.canvas.height;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(0, 0, w, h);

      ctx.font = 'bold 52px "Arial Black", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const words = msg.split(' ');
      const lines = [];
      let line = '';
      for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width < w - 60) {
          line = test;
        } else {
          if (line) lines.push(line);
          line = word;
        }
      }
      if (line) lines.push(line);

      const lineHeight = 62;
      const startY = (h - lines.length * lineHeight) / 2 + lineHeight / 2;

      lines.forEach((l, j) => {
        const x = w / 2;
        const y = startY + j * lineHeight;
        const color = mColors[(j + wallIdx) % mColors.length];

        ctx.shadowColor = color;
        ctx.shadowBlur = 20;

        ctx.strokeStyle = '#000';
        ctx.lineWidth = 8;
        ctx.strokeText(l, x, y);

        ctx.fillStyle = color;
        ctx.fillText(l, x, y);
      });

      ctx.shadowBlur = 0;
      m.texture.needsUpdate = true;
    });
  }

  setLevel(levelIndex) {
    this.currentLevel = levelIndex % LEVELS.length;
    const level = LEVELS[this.currentLevel];

    this.scene.background = new THREE.Color(level.bg);
    this.drawFloor(level);

    const wallColor = new THREE.Color(level.wallTint);
    this.wallMeshes.forEach(w => w.material.color.copy(wallColor));

    const neonColor = new THREE.Color(level.neon);
    this.neonTrimMeshes.forEach(n => n.material.color.copy(neonColor));

    if (this.baseMesh) this.baseMesh.material.color.set(level.bg);

    this.mantraDirty = true;
    return level;
  }

  getLevelName() {
    return LEVELS[this.currentLevel]?.name || 'UNKNOWN';
  }

  update(deltaTime) {
    const pulse = Math.sin(performance.now() / 400) * 0.5 + 0.5;
    const b = 0.85 + pulse * 0.15;
    this.floorMesh.material.color.setRGB(b, b, b);

    this.mantraRotateTime += deltaTime * 1000;
    if (this.mantraRotateTime > this.mantraRotateInterval) {
      this.mantraRotateTime = 0;
      this.wallMantras.forEach(m => {
        m.mantraIdx = Math.floor(Math.random() * MOCKERY_MANTRAS.length);
      });
      this.mantraDirty = true;
    }

    if (this.mantraDirty) {
      this.mantraDirty = false;
      this.drawMantras();
    }

    this.planets.forEach(p => p.rotation.y += deltaTime * 0.1);
  }
}
