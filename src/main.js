/**
 * KOL BASH: Disco Mayhem
 * Store, dare screen, multi-weapon, ally ships, level effects, mobile
 */

import * as THREE from 'three';
import { PhysicsWorld } from './physics.js';
import { Player } from './player.js';
import { EnemyManager } from './enemy.js';
import { Weapon, WEAPON_DEFS } from './weapon.js';
import { ItemManager } from './items.js';
import { WaveManager } from './waves.js';
import { UIManager, STORE_ITEMS } from './ui.js';
import { Arena, LEVELS } from './arena.js';

class Game {
  constructor() {
    this.isRunning = false;
    this.modelsReady = false;
    this.score = 0;
    this.coins = 0;
    this.kills = 0;
    this.damageDealt = 0;
    this.screenShake = 0;
    this.clock = new THREE.Clock();

    this.isMobile = ('ontouchstart' in window) && (window.innerWidth < 1200);

    this.currentLevelEffect = null;
    this.poisonTickTime = 0;

    this.allyShips = [];
    this.allyProjectiles = [];
    this.allyProjGeo = new THREE.SphereGeometry(0.06, 4, 3);
    this.allyShipDuration = 18000;
    this.allyDurUpgrades = 0;

    this.unlockedWeapons = ['disco'];
    this.currentWeapon = 'disco';
    this.healthUpgrades = 0;
  }

  async init() {
    this.ui = new UIManager();

    this.createScene();
    this.createPhysics();
    this.createPlayer();
    this.createWeapon();
    this.createArena();
    this.createManagers();
    this.setupEventListeners();

    this.ui.showStartScreen();
    const btn = document.querySelector('#start-screen .start-btn');
    if (btn) {
      btn.textContent = 'LOADING...';
      btn.style.opacity = '0.5';
      btn.style.cursor = 'wait';
    }

    try {
      await this.preloadModels();
      await this.enemyManager.warmPool(4);
    } catch (e) {
      console.warn('Model loading issue:', e);
    }

    this.modelsReady = true;
    if (btn) {
      btn.textContent = this.isMobile ? 'TAP TO PLAY' : 'ENTER THE FLOOR';
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    }

    if (this.isMobile) {
      document.getElementById('mobile-controls')?.style.setProperty('display', 'block');
    }
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a0a2e);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.5, 100);
    this.camera.position.set(0, 2, 0);
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.5 : 1));
    this.renderer.shadowMap.enabled = false;
    this.renderer.autoClear = true;

    document.getElementById('game-container').appendChild(this.renderer.domElement);
    this.createLighting();
  }

  createLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 1.0);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(5, 15, 5);
    this.scene.add(sun);

    this.discoLight = new THREE.PointLight(0xff66aa, 0.5, 40);
    this.discoLight.position.set(15, 8, 15);
    this.scene.add(this.discoLight);
  }

  createPhysics() {
    this.physicsWorld = new PhysicsWorld();
    this.physicsWorld.createGround(100);
  }

  createPlayer() {
    this.player = new Player(this.camera, this.physicsWorld, document.body);
    this.player.onDeathCallback = () => this.gameOver();
  }

  createWeapon() {
    this.weapon = new Weapon(this.camera, this.scene);
  }

  createArena() {
    this.arena = new Arena(this.scene, this.physicsWorld);
  }

  createManagers() {
    this.enemyManager = new EnemyManager(this.scene, this.physicsWorld);
    this.enemyManager.onEnemyDeath = (enemy) => this.onEnemyKilled(enemy);

    this.itemManager = new ItemManager(this.scene);

    this.waveManager = new WaveManager(this.enemyManager);
    this.waveManager.setPlayerCamera(this.camera);

    this.waveManager.onWaveStart = (wave, taunt, levelChanged) => {
      this.ui.updateWave(wave);
      const levelName = this.arena.getLevelName();
      this.ui.showWaveAnnouncement(wave, taunt, levelName, levelChanged);
      this.ui.updateLevelName(levelName);
    };

    this.waveManager.onLevelChange = (levelIndex) => {
      const level = this.arena.setLevel(levelIndex);
      if (this.discoLight) this.discoLight.color.set(level.neon);
      this.applyLevelEffect(level);
      this.triggerLevelFlash();
    };

    this.waveManager.onWaveComplete = (wave) => {
      this.score += wave * 100;
      this.ui.updateScore(this.score);
      this.enemyManager.replenishPool();
      this.showDareScreen(wave);
    };
  }

  getBaseDamage() {
    return WEAPON_DEFS[this.currentWeapon]?.damage || 25;
  }

  applyLevelEffect(level) {
    this.currentLevelEffect = level.effect || null;
    this.poisonTickTime = 0;

    this.weapon.damage = this.getBaseDamage();
    this.itemManager.doubleCoinsMult = 1;

    if (!this.currentLevelEffect) return;

    const fx = this.currentLevelEffect;
    switch (fx.type) {
      case 'playerDmgBoost':
        this.weapon.damage = Math.round(this.getBaseDamage() * fx.value);
        break;
      case 'doubleCoins':
        this.itemManager.doubleCoinsMult = fx.value;
        this.itemManager.doubleCoinsEndTime = Infinity;
        break;
      case 'chaosMode':
        this.weapon.damage = Math.round(this.getBaseDamage() * fx.playerDmg);
        break;
    }

    this.ui.showLevelEffect(fx.label);
  }

  triggerLevelFlash() {
    const overlay = document.getElementById('damage-overlay');
    if (!overlay) return;
    const orig = overlay.style.background;
    overlay.style.background = 'radial-gradient(ellipse at center, rgba(255,255,255,0.6) 0%, transparent 70%)';
    overlay.style.opacity = '0.7';
    setTimeout(() => {
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.style.background = orig || 'radial-gradient(ellipse at center, transparent 0%, rgba(255,0,0,0.4) 100%)';
      }, 200);
    }, 250);
  }

  async preloadModels() {
    const models = [
      '/models/alon_dancing.fbx',
      '/models/slingoor_dance.fbx',
      '/models/pow_dive.fbx',
      '/models/jump_attack.fbx',
      '/models/marcell_dancing.fbx',
      '/models/thriller_part3.fbx'
    ];
    await Promise.all(models.map(path =>
      this.enemyManager.loadFBX(path).catch(() => {})
    ));
  }

  setupEventListeners() {
    window.addEventListener('resize', () => this.onWindowResize());
    document.getElementById('start-screen').addEventListener('click', () => this.startGame());
    document.getElementById('start-screen').addEventListener('touchend', (e) => {
      e.preventDefault();
      this.startGame();
    });

    const jumpBtn = document.getElementById('jump-btn');
    if (jumpBtn) {
      jumpBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.player.wantsToJump = true;
      }, { passive: false });
      jumpBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.player.wantsToJump = false;
      }, { passive: false });
    }

    document.addEventListener('keydown', (e) => {
      const num = parseInt(e.key);
      if (num >= 1 && num <= 4) {
        const weapons = ['disco', 'gatling', 'laser', 'rocket'];
        const w = weapons[num - 1];
        if (this.unlockedWeapons.includes(w)) {
          this.switchWeapon(w);
        }
      }
    });
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  switchWeapon(type) {
    if (this.currentWeapon === type) return;
    this.currentWeapon = type;
    this.weapon.setWeapon(type);
    this.ui.updateWeaponName(WEAPON_DEFS[type].name);

    if (this.currentLevelEffect) {
      const fx = this.currentLevelEffect;
      if (fx.type === 'playerDmgBoost') this.weapon.damage = Math.round(this.getBaseDamage() * fx.value);
      else if (fx.type === 'chaosMode') this.weapon.damage = Math.round(this.getBaseDamage() * fx.playerDmg);
    }
  }

  // ── Dare Screen & Store ──

  showDareScreen(wave) {
    this.isRunning = false;

    if (!this.isMobile && document.pointerLockElement) {
      document.exitPointerLock();
    }

    this.ui.showDareScreen(wave,
      () => this.resumeNextWave(),
      () => this.showStore()
    );
  }

  showStore() {
    this.ui.showStore(this.coins, this.unlockedWeapons, this.currentWeapon, {
      onBuy: (id) => this.handlePurchase(id),
      onEquip: (id) => {
        this.switchWeapon(id);
      },
      onClose: () => this.resumeNextWave(),
      getCoins: () => this.coins,
      getUnlocked: () => this.unlockedWeapons,
      getCurrentWeapon: () => this.currentWeapon
    });
  }

  handlePurchase(id) {
    const item = STORE_ITEMS.find(i => i.id === id);
    if (!item || this.coins < item.cost) return false;

    if (item.type === 'weapon') {
      if (this.unlockedWeapons.includes(id)) return false;
      this.coins -= item.cost;
      this.unlockedWeapons.push(id);
      this.switchWeapon(id);
    } else if (id === 'maxHp') {
      this.coins -= item.cost;
      this.healthUpgrades++;
      this.player.maxHealth += 50;
      this.player.health = Math.min(this.player.health + 50, this.player.maxHealth);
      this.ui.updateHealth(this.player.health, this.player.maxHealth);
    } else if (id === 'allyDur') {
      this.coins -= item.cost;
      this.allyDurUpgrades++;
      this.allyShipDuration += 5000;
    }

    this.ui.updateCoins(this.coins);
    return true;
  }

  resumeNextWave() {
    this.ui.hideAllOverlays();
    this.isRunning = true;
    this.clock.start();

    if (this.isMobile) {
      this.player.controls.isLocked = true;
      document.getElementById('mobile-controls')?.style.setProperty('display', 'block');
    } else {
      this.player.controls.lock();
    }

    this.waveManager.startNextWave(this.player.getPosition());
    this.animate();
  }

  startGame() {
    if (this.isRunning) return;
    if (!this.modelsReady) return;

    this.score = 0;
    this.coins = 0;
    this.kills = 0;
    this.damageDealt = 0;
    this.screenShake = 0;
    this.poisonTickTime = 0;
    this.currentLevelEffect = null;
    this.healthUpgrades = 0;
    this.allyDurUpgrades = 0;
    this.allyShipDuration = 18000;
    this.unlockedWeapons = ['disco'];
    this.currentWeapon = 'disco';
    this.weapon.setWeapon('disco');
    this.player.maxHealth = 300;
    this.player.reset();
    this.enemyManager.clear();
    this.itemManager.clear();
    this.waveManager.reset();
    this.clearAllyShips();

    this.arena.setLevel(0);
    this.applyLevelEffect(LEVELS[0]);
    if (this.discoLight) this.discoLight.color.set(LEVELS[0].neon);

    this.ui.init();
    this.ui.showGame();
    this.ui.updateWeaponName('DISCO BLASTER');

    if (this.isMobile) {
      this.player.controls.lock();
      document.getElementById('mobile-controls')?.style.setProperty('display', 'block');
    } else {
      this.player.controls.lock();
    }

    this.isRunning = true;
    this.clock.start();

    setTimeout(() => {
      if (this.isRunning) this.waveManager.startNextWave(this.player.getPosition());
    }, 1000);

    this.animate();
  }

  onEnemyKilled(enemy) {
    this.kills++;

    const isBoss = enemy.userData.type.isBoss;
    const scoreMultiplier = isBoss ? 5 : 1;
    const coinMultiplier = isBoss ? 3 : 1;

    let scoreMult = 1;
    if (this.currentLevelEffect?.type === 'scoreBoost') scoreMult = this.currentLevelEffect.value;

    this.score += Math.round((50 + this.waveManager.currentWave * 20) * scoreMultiplier * scoreMult);
    this.ui.updateScore(this.score);

    const coinCount = (2 + Math.floor(Math.random() * 3)) * coinMultiplier;
    this._spawnPos = this._spawnPos || new THREE.Vector3();
    this._spawnPos.copy(enemy.position);
    this.itemManager.spawnCoins(this._spawnPos, Math.min(coinCount, 10));

    if (isBoss) {
      this.itemManager.spawnPowerup(this._spawnPos, 3);
      if (Math.random() < 0.5) {
        this.itemManager.spawnPowerup(this._spawnPos);
      }
    } else if (Math.random() < 0.18) {
      this.itemManager.spawnPowerup(this._spawnPos);
    }
  }

  handleShooting(playerPos) {
    if (!this.player.controls.isLocked) return;

    const shot = this.weapon.tryFire(this.player.rapidFire);
    if (!shot) return;

    const muzzlePos = this.weapon.getMuzzleWorldPosition();
    const dir = shot.direction;

    let closestEnemy = null;
    let closestDist = 60;
    const dx = dir.x, dz = dir.z;
    const dirLen = Math.sqrt(dx * dx + dz * dz) || 1;

    for (let i = 0; i < this.enemyManager.enemies.length; i++) {
      const enemy = this.enemyManager.enemies[i];
      if (enemy.userData.isDead) continue;
      const ex = enemy.position.x - muzzlePos.x;
      const ez = enemy.position.z - muzzlePos.z;
      const dist = Math.sqrt(ex * ex + ez * ez);
      if (dist > closestDist) continue;
      const dot = (ex * (dx / dirLen) + ez * (dz / dirLen)) / dist;
      if (dot > 0.94) {
        closestEnemy = enemy;
        closestDist = dist;
      }
    }

    if (closestEnemy) {
      this.damageDealt += this.weapon.damage;
      this.enemyManager.damageEnemy(closestEnemy, this.weapon.damage);
      this.weapon.playHitSound();

      this._hitTarget = this._hitTarget || new THREE.Vector3();
      this._hitTarget.set(closestEnemy.position.x, 1.2, closestEnemy.position.z);
      this.weapon.spawnProjectile(muzzlePos, this._hitTarget, () => {
        if (this.currentWeapon === 'rocket') {
          this.rocketAOE(closestEnemy.position);
        }
      });
    } else {
      this._missTarget = this._missTarget || new THREE.Vector3();
      this._missTarget.set(muzzlePos.x + dir.x * 25, muzzlePos.y + dir.y * 25, muzzlePos.z + dir.z * 25);
      this.weapon.spawnProjectile(muzzlePos, this._missTarget, () => {
        if (this.currentWeapon === 'rocket') {
          this.rocketAOE(this._missTarget);
        }
      });
    }
  }

  rocketAOE(center) {
    const def = WEAPON_DEFS.rocket;
    for (const enemy of this.enemyManager.enemies) {
      if (enemy.userData.isDead) continue;
      const dx = enemy.position.x - center.x;
      const dz = enemy.position.z - center.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < def.aoeRadius) {
        const falloff = 1 - (dist / def.aoeRadius);
        const dmg = Math.round(def.aoeDamage * falloff);
        this.damageDealt += dmg;
        this.enemyManager.damageEnemy(enemy, dmg);
      }
    }
    this.screenShake = Math.min(this.screenShake + 0.6, 1.2);
  }

  handleItemPickups(playerPos) {
    const coinValue = this.itemManager.checkCoinPickup(playerPos);
    if (coinValue > 0) {
      this.coins += coinValue;
      this.score += coinValue;
      this.ui.updateCoins(this.coins);
      this.ui.updateScore(this.score);
    }

    const powerups = this.itemManager.checkPowerupPickup(playerPos);
    for (const p of powerups) this.applyPowerup(p);
  }

  applyPowerup(powerup) {
    switch (powerup.effect) {
      case 'heal':
        this.player.heal(powerup.value);
        this.ui.updateHealth(this.player.health, this.player.maxHealth);
        break;
      case 'rapidFire':
        this.player.activateRapidFire(powerup.duration);
        break;
      case 'slowMotion':
        this.enemyManager.activateSlowMotion(powerup.duration);
        break;
      case 'alienShip':
        this.spawnAllyShip();
        break;
    }
  }

  // ── Ally Ship System ──

  spawnAllyShip() {
    const ship = new THREE.Group();

    const bodyMat = new THREE.MeshBasicMaterial({ color: 0x44ffaa });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.12, 12), bodyMat);
    ship.add(body);

    const domeMat = new THREE.MeshBasicMaterial({ color: 0x88ffdd, transparent: true, opacity: 0.7 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    dome.position.y = 0.06;
    ship.add(dome);

    const rimColors = [0xff0088, 0x00ff88, 0x8800ff, 0xffff00, 0x00ffff, 0xff6600];
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 4, 3),
        new THREE.MeshBasicMaterial({ color: rimColors[i] })
      );
      dot.position.set(Math.cos(angle) * 0.65, -0.02, Math.sin(angle) * 0.65);
      ship.add(dot);
    }

    const beamMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.15 });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.5, 6), beamMat);
    beam.position.y = -0.85;
    beam.rotation.x = Math.PI;
    ship.add(beam);

    const light = new THREE.PointLight(0x00ff88, 0.4, 8);
    light.position.y = -0.3;
    ship.add(light);

    const dur = this.allyShipDuration;
    ship.userData = {
      spawnTime: performance.now(),
      duration: dur,
      lastShot: 0,
      shotInterval: 400,
      orbitAngle: Math.random() * Math.PI * 2,
      orbitRadius: 4,
      orbitHeight: 3.5,
      orbitSpeed: 1.5
    };

    this.scene.add(ship);
    this.allyShips.push(ship);
  }

  updateAllyShips(deltaTime, playerPos) {
    const now = performance.now();

    for (let i = this.allyShips.length - 1; i >= 0; i--) {
      const ship = this.allyShips[i];
      const data = ship.userData;

      if (now - data.spawnTime > data.duration) {
        this.scene.remove(ship);
        ship.traverse(c => {
          if (c.isMesh) { c.geometry?.dispose(); c.material?.dispose(); }
          if (c.isLight) c.dispose?.();
        });
        this.allyShips.splice(i, 1);
        continue;
      }

      data.orbitAngle += data.orbitSpeed * deltaTime;
      ship.position.set(
        playerPos.x + Math.cos(data.orbitAngle) * data.orbitRadius,
        data.orbitHeight + Math.sin(now * 0.002) * 0.3,
        playerPos.z + Math.sin(data.orbitAngle) * data.orbitRadius
      );
      ship.rotation.y += deltaTime * 2;

      let nearest = null;
      let nearestDist = 30;
      for (const enemy of this.enemyManager.enemies) {
        if (enemy.userData.isDead) continue;
        const edx = enemy.position.x - ship.position.x;
        const edz = enemy.position.z - ship.position.z;
        const d = Math.sqrt(edx * edx + edz * edz);
        if (d < nearestDist) { nearest = enemy; nearestDist = d; }
      }

      if (nearest && now - data.lastShot > data.shotInterval) {
        data.lastShot = now;
        this.allyShipFire(ship, nearest);
      }
    }

    for (let i = this.allyProjectiles.length - 1; i >= 0; i--) {
      const proj = this.allyProjectiles[i];
      const v = proj.userData.velocity;
      proj.position.x += v.x * deltaTime;
      proj.position.y += v.y * deltaTime;
      proj.position.z += v.z * deltaTime;
      proj.userData.life -= deltaTime;

      if (proj.userData.life <= 0) {
        this.scene.remove(proj);
        proj.material.dispose();
        this.allyProjectiles.splice(i, 1);
        continue;
      }

      for (const enemy of this.enemyManager.enemies) {
        if (enemy.userData.isDead) continue;
        const edx = proj.position.x - enemy.position.x;
        const edz = proj.position.z - enemy.position.z;
        if (Math.sqrt(edx * edx + edz * edz) < 1.2) {
          this.damageDealt += proj.userData.damage;
          this.enemyManager.damageEnemy(enemy, proj.userData.damage);
          this.scene.remove(proj);
          proj.material.dispose();
          this.allyProjectiles.splice(i, 1);
          break;
        }
      }
    }
  }

  allyShipFire(ship, target) {
    if (this.allyProjectiles.length >= 8) return;
    const dir = new THREE.Vector3().subVectors(target.position, ship.position).normalize();
    const proj = new THREE.Mesh(
      this.allyProjGeo,
      new THREE.MeshBasicMaterial({ color: 0x00ff88 })
    );
    proj.position.copy(ship.position);
    proj.userData = {
      velocity: dir.multiplyScalar(18),
      life: 2,
      damage: 15
    };
    this.scene.add(proj);
    this.allyProjectiles.push(proj);
  }

  clearAllyShips() {
    for (const ship of this.allyShips) {
      this.scene.remove(ship);
      ship.traverse(c => {
        if (c.isMesh) { c.geometry?.dispose(); c.material?.dispose(); }
      });
    }
    this.allyShips = [];
    for (const p of this.allyProjectiles) {
      this.scene.remove(p);
      p.material?.dispose();
    }
    this.allyProjectiles = [];
  }

  // ── Level Effects (per-frame) ──

  updateLevelEffects(deltaTime, playerPos) {
    if (!this.currentLevelEffect) return;
    const fx = this.currentLevelEffect;

    if (fx.type === 'poisonDOT') {
      this.poisonTickTime += deltaTime * 1000;
      if (this.poisonTickTime >= fx.interval) {
        this.poisonTickTime = 0;
        for (const enemy of this.enemyManager.enemies) {
          if (!enemy.userData.isDead) {
            this.enemyManager.damageEnemy(enemy, fx.value);
            this.damageDealt += fx.value;
          }
        }
      }
    }

    if (fx.type === 'enemySlow') {
      for (const enemy of this.enemyManager.enemies) {
        if (!enemy.userData.isDead && !enemy.userData._levelSlowed) {
          enemy.userData._levelSlowed = true;
          enemy.userData.type = { ...enemy.userData.type, speed: enemy.userData.type.speed * fx.value };
        }
      }
    }

    if (fx.type === 'chaosMode') {
      for (const enemy of this.enemyManager.enemies) {
        if (!enemy.userData.isDead && !enemy.userData._chaosBoosted) {
          enemy.userData._chaosBoosted = true;
          enemy.userData.type = { ...enemy.userData.type, damage: Math.round(enemy.userData.type.damage * fx.enemyDmg) };
        }
      }
    }
  }

  handleEnemyDamage(playerPos) {
    const now = performance.now();
    const px = playerPos.x, pz = playerPos.z;
    let tookDamage = false;

    for (const enemy of this.enemyManager.enemies) {
      if (enemy.userData.isDead) continue;
      const ex = enemy.position.x, ez = enemy.position.z;
      const dist = Math.sqrt((ex - px) ** 2 + (ez - pz) ** 2);
      if (dist < 2.0) {
        const lastAttack = enemy.userData.lastAttackTime || 0;
        if (now - lastAttack > 800) {
          const type = enemy.userData.type;
          const damage = type.diveDamage ?? type.jumpDamage ?? type.damage;
          this.player.takeDamage(damage);
          enemy.userData.lastAttackTime = now;
          this.ui.updateHealth(this.player.health, this.player.maxHealth);
          tookDamage = true;
        }
      }
    }

    const projs = this.enemyManager.getEnemyProjectiles();
    for (let j = 0; j < projs.length; j++) {
      const proj = projs[j];
      const pdx = proj.position.x - playerPos.x, pdz = proj.position.z - playerPos.z;
      if (Math.sqrt(pdx * pdx + pdz * pdz) < 1.2) {
        this.player.takeDamage(proj.userData.damage);
        this.ui.updateHealth(this.player.health, this.player.maxHealth);
        proj.userData.life = 0;
        tookDamage = true;
      }
    }

    if (tookDamage) {
      this.screenShake = Math.min(this.screenShake + 0.4, 1.0);
    }
  }

  updatePowerupUI() {
    const now = performance.now();
    this.ui.updatePowerup('rapidFire', this.player.rapidFire ? this.player.rapidFireEndTime - now : 0);
    this.ui.updatePowerup('slowMotion', this.enemyManager.slowMotion ? this.enemyManager.slowMotionEndTime - now : 0);

    let shipTime = 0;
    if (this.allyShips.length > 0) {
      const s = this.allyShips[0];
      shipTime = Math.max(0, s.userData.duration - (now - s.userData.spawnTime));
    }
    this.ui.updatePowerup('alienShip', shipTime);
  }

  gameOver() {
    this.isRunning = false;
    this.clearAllyShips();
    if (this.isMobile) {
      document.getElementById('mobile-controls')?.style.setProperty('display', 'none');
    }
    this.ui.showGameOver({
      wave: this.waveManager.currentWave,
      score: this.score,
      coins: this.coins,
      kills: this.kills,
      damageDealt: this.damageDealt
    });
  }

  animate() {
    if (!this.isRunning) return;

    requestAnimationFrame(() => this.animate());

    const delta = Math.min(this.clock.getDelta(), 0.05);
    const playerPos = this.player.getPosition();

    this.physicsWorld.update(delta);
    this.player.update(delta);
    this.weapon.update(delta);
    if (this.arena) this.arena.update(delta);
    this.handleShooting(playerPos);
    this.enemyManager.update(delta, playerPos);
    this.handleEnemyDamage(playerPos);
    this.itemManager.update(delta, playerPos);
    this.handleItemPickups(playerPos);
    this.waveManager.update(delta, playerPos);
    this.updateAllyShips(delta, playerPos);
    this.updateLevelEffects(delta, playerPos);

    if (this.screenShake > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.screenShake * 0.15;
      this.camera.position.y += (Math.random() - 0.5) * this.screenShake * 0.08;
      this.screenShake *= 0.82;
    } else {
      this.screenShake = 0;
    }

    if (this._uiTick === undefined) this._uiTick = 0;
    this._uiTick++;
    if (this._uiTick % 3 === 0) {
      this.updatePowerupUI();
      this.ui.updateCrosshair(this.weapon);
      this.ui.updateStats(this.kills, this.damageDealt);
    }

    this.renderer.render(this.scene, this.camera);
  }
}

document.addEventListener('DOMContentLoaded', () => new Game().init());
