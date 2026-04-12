/**
 * Items System - OPTIMIZED for performance
 */

import * as THREE from 'three';
import { getSharedAudioContext } from './shared-audio.js';

export class ItemManager {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.coins = [];
    this.powerups = [];
    
    this.coinValue = 10;
    this.coinPickupRadius = 2.0;
    this.coinMagnetRadius = 3.5;
    this.coinDespawnTime = 20000;
    this.powerupPickupRadius = 2.0;
    this.powerupDespawnTime = 15000;
    
    this.powerupTypes = [
      { name: 'Health', effect: 'heal', value: 100, duration: 0, color: 0xff4444 },
      { name: 'Rapid Fire', effect: 'rapidFire', value: 0, duration: 10000, color: 0xff6600 },
      { name: 'Slow Motion', effect: 'slowMotion', value: 0, duration: 8000, color: 0x00aaff },
      { name: 'Alien Ship', effect: 'alienShip', value: 0, duration: 18000, color: 0x00ff88 }
    ];
    
    this.doubleCoinsMult = 1;
    this.doubleCoinsEndTime = 0;

    this.maxCoinsAlive = opts.maxCoinsAlive ?? 110;
    this.maxPowerupsAlive = opts.maxPowerupsAlive ?? 10;
    
    this.audioContext = null;
    this.initAudio();
    
    this.coinGeo = new THREE.IcosahedronGeometry(0.16, 0);
    this.coinRingGeo = new THREE.TorusGeometry(0.22, 0.015, 4, 12);
    this.powerupGeos = [
      new THREE.IcosahedronGeometry(0.28, 1),
      new THREE.OctahedronGeometry(0.32, 0),
      new THREE.DodecahedronGeometry(0.26, 0),
      new THREE.IcosahedronGeometry(0.3, 0)
    ];
    this.powerupRingGeo = new THREE.TorusGeometry(0.42, 0.018, 4, 16);

    this.coinMat = new THREE.MeshBasicMaterial({ color: 0xffd700 });
    this.coinRingMat = new THREE.MeshBasicMaterial({ color: 0xffee88, transparent: true, opacity: 0.5 });
    this.powerupMats = this.powerupTypes.map(t => new THREE.MeshBasicMaterial({
      color: t.color,
      transparent: true,
      opacity: 1
    }));
    this.powerupRingMats = this.powerupTypes.map(t => new THREE.MeshBasicMaterial({
      color: t.color,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide
    }));
  }
  
  initAudio() {
    this.audioContext = getSharedAudioContext();
  }
  
  playCoinSound() {
    if (!this.audioContext) return;
    try {
      if (this.audioContext.state === 'suspended') this.audioContext.resume();
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, this.audioContext.currentTime);
      osc.frequency.setValueAtTime(1320, this.audioContext.currentTime + 0.05);
      gain.gain.setValueAtTime(0.15, this.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.15);
      osc.start();
      osc.stop(this.audioContext.currentTime + 0.15);
    } catch (e) {}
  }
  
  playPowerupSound() {
    if (!this.audioContext) return;
    try {
      if (this.audioContext.state === 'suspended') this.audioContext.resume();
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523, this.audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1047, this.audioContext.currentTime + 0.2);
      gain.gain.setValueAtTime(0.15, this.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.25);
      osc.start();
      osc.stop(this.audioContext.currentTime + 0.25);
    } catch (e) {}
  }
  
  spawnCoin(position) {
    while (this.coins.length >= this.maxCoinsAlive) {
      const oldest = this.coins.shift();
      if (oldest) {
        this.scene.remove(oldest);
      }
    }

    const group = new THREE.Group();
    const core = new THREE.Mesh(this.coinGeo, this.coinMat);
    group.add(core);
    const ring = new THREE.Mesh(this.coinRingGeo, this.coinRingMat);
    group.add(ring);

    group.position.copy(position);
    group.position.x += (Math.random() - 0.5) * 1.2;
    group.position.z += (Math.random() - 0.5) * 1.2;
    group.position.y = 0.6 + Math.random() * 0.2;

    group.userData = {
      spawnTime: performance.now(),
      baseY: group.position.y,
      rotSpeed: 2.5 + Math.random() * 1.5,
      collected: false,
      isGroup: true
    };

    this.scene.add(group);
    this.coins.push(group);
    return group;
  }
  
  spawnCoins(position, count = 3) {
    for (let i = 0; i < count; i++) this.spawnCoin(position);
  }
  
  spawnPowerup(position, typeIndex = -1) {
    if (typeIndex < 0) typeIndex = Math.floor(Math.random() * this.powerupTypes.length);
    const type = this.powerupTypes[typeIndex];

    while (this.powerups.length >= this.maxPowerupsAlive) {
      const old = this.powerups.shift();
      if (old) this.scene.remove(old);
    }

    const group = new THREE.Group();
    group.position.copy(position);
    group.position.y = 1.0;

    const core = new THREE.Mesh(this.powerupGeos[typeIndex % this.powerupGeos.length], this.powerupMats[typeIndex % this.powerupMats.length]);
    group.add(core);

    const ring = new THREE.Mesh(this.powerupRingGeo, this.powerupRingMats[typeIndex % this.powerupRingMats.length]);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const ring2 = new THREE.Mesh(this.powerupRingGeo, this.powerupRingMats[typeIndex % this.powerupRingMats.length]);
    ring2.rotation.z = Math.PI / 2;
    group.add(ring2);

    group.userData = {
      powerupType: type,
      typeIndex,
      spawnTime: performance.now(),
      baseY: 1.0,
      collected: false
    };

    this.scene.add(group);
    this.powerups.push(group);
    return group;
  }
  
  checkCoinPickup(playerPosition) {
    let totalValue = 0;
    const px = playerPosition.x, pz = playerPosition.z;
    
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      if (coin.userData.collected) continue;
      
      const dx = coin.position.x - px, dz = coin.position.z - pz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < this.coinPickupRadius) {
        coin.userData.collected = true;
        totalValue += this.coinValue * this.doubleCoinsMult;
        this.playCoinSound();
        this.removeCoin(coin);
      }
    }
    
    return totalValue;
  }
  
  checkPowerupPickup(playerPosition) {
    const collected = [];
    const px = playerPosition.x, py = playerPosition.y, pz = playerPosition.z;
    
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      if (p.userData.collected) continue;
      
      const dx = p.position.x - px, dy = p.position.y - py, dz = p.position.z - pz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < this.powerupPickupRadius) {
        p.userData.collected = true;
        collected.push(p.userData.powerupType);
        this.playPowerupSound();
        this.removePowerup(p);
      }
    }
    
    return collected;
  }
  
  removeCoin(coin) {
    const idx = this.coins.indexOf(coin);
    if (idx !== -1) {
      this.coins.splice(idx, 1);
      this.scene.remove(coin);
    }
  }
  
  removePowerup(powerup) {
    const idx = this.powerups.indexOf(powerup);
    if (idx !== -1) {
      this.powerups.splice(idx, 1);
      powerup.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
      this.scene.remove(powerup);
    }
  }
  
  update(deltaTime, playerPosition) {
    const now = performance.now();
    const time = now / 1000;
    
    if (this.doubleCoinsMult > 1 && now > this.doubleCoinsEndTime) {
      this.doubleCoinsMult = 1;
    }
    
    // Update coins
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      if (coin.userData.collected) continue;
      
      if (now - coin.userData.spawnTime > this.coinDespawnTime) {
        this.removeCoin(coin);
        continue;
      }
      
      coin.rotation.y += coin.userData.rotSpeed * deltaTime;
      coin.rotation.x = Math.sin(time * 2 + i) * 0.3;
      coin.position.y = coin.userData.baseY + Math.sin(time * 4 + i * 0.5) * 0.12;
      
      if (playerPosition) {
        const dx = playerPosition.x - coin.position.x;
        const dz = playerPosition.z - coin.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < this.coinMagnetRadius && dist > this.coinPickupRadius) {
          const m = (6 * deltaTime) / dist;
          coin.position.x += dx * m;
          coin.position.z += dz * m;
        }
      }
    }
    
    // Update powerups
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      if (p.userData.collected) continue;
      
      if (now - p.userData.spawnTime > this.powerupDespawnTime) {
        this.removePowerup(p);
        continue;
      }
      
      p.rotation.y += deltaTime * 2.5;
      const pulse = 1.0 + Math.sin(time * 5 + i) * 0.12;
      p.scale.setScalar(pulse);
      p.position.y = p.userData.baseY + Math.sin(time * 2.5 + i * 0.3) * 0.15;
      if (p.children.length > 1) {
        p.children[1].rotation.z += deltaTime * 3;
        if (p.children[2]) p.children[2].rotation.x += deltaTime * 2.5;
      }
    }
  }
  
  getDoubleCoinsTimeRemaining() {
    return this.doubleCoinsMult > 1 ? Math.max(0, this.doubleCoinsEndTime - performance.now()) : 0;
  }
  
  clear() {
    for (const c of [...this.coins]) this.removeCoin(c);
    for (const p of [...this.powerups]) this.removePowerup(p);
    this.coins = [];
    this.powerups = [];
    this.doubleCoinsMult = 1;
  }
}
