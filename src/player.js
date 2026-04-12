/**
 * Player System - FPS Controller with mobile touch support
 */

import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import * as CANNON from 'cannon-es';

export class Player {
  constructor(camera, physicsWorld, domElement) {
    this.camera = camera;
    this.physicsWorld = physicsWorld;

    this.maxHealth = 300;
    this.health = this.maxHealth;
    this.isDead = false;

    this.moveSpeed = 8;
    this.jumpForce = 8;
    this.canJump = true;
    this.isOnGround = false;

    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;
    this.wantsToJump = false;

    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();

    this.isMobile = ('ontouchstart' in window) && (window.innerWidth < 1200);

    if (this.isMobile) {
      this.cameraYaw = 0;
      this.cameraPitch = 0;
      this.controls = {
        isLocked: false,
        lock: () => { this.controls.isLocked = true; },
        unlock: () => { this.controls.isLocked = false; }
      };
      this.setupMobileTouch();
    } else {
      this.controls = new PointerLockControls(camera, domElement);
    }

    this.body = physicsWorld.createPlayerBody({ x: 0, y: 3, z: 0 });
    this.groundRayResult = new CANNON.RaycastResult();
    this.setupControls();

    this.rapidFire = false;
    this.rapidFireEndTime = 0;

    this.inputFrozen = false;
  }

  setupMobileTouch() {
    this.touchLookId = null;
    this.lastTouchX = 0;
    this.lastTouchY = 0;

    const lookArea = document.getElementById('touch-look-area');
    if (!lookArea) return;

    lookArea.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this.touchLookId = t.identifier;
      this.lastTouchX = t.clientX;
      this.lastTouchY = t.clientY;
    }, { passive: false });

    lookArea.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === this.touchLookId) {
          const dx = t.clientX - this.lastTouchX;
          const dy = t.clientY - this.lastTouchY;
          this.lastTouchX = t.clientX;
          this.lastTouchY = t.clientY;
          this.cameraYaw -= dx * 0.004;
          this.cameraPitch -= dy * 0.004;
          this.cameraPitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.cameraPitch));
        }
      }
    }, { passive: false });

    lookArea.addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touchLookId) this.touchLookId = null;
      }
    });

    this.setupMobileJoystick();
  }

  setupMobileJoystick() {
    const base = document.getElementById('joystick-base');
    const stick = document.getElementById('joystick-stick');
    if (!base || !stick) return;

    let joyTouchId = null;
    const baseRect = () => base.getBoundingClientRect();
    const maxDist = 40;

    base.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const t = e.changedTouches[0];
      joyTouchId = t.identifier;
    }, { passive: false });

    const handleMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== joyTouchId) continue;
        const r = baseRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        let dx = t.clientX - cx;
        let dy = t.clientY - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxDist) { dx = dx / dist * maxDist; dy = dy / dist * maxDist; }
        stick.style.transform = `translate(${dx}px, ${dy}px)`;
        const nx = dx / maxDist;
        const ny = dy / maxDist;
        this.moveForward = ny < -0.3;
        this.moveBackward = ny > 0.3;
        this.moveLeft = nx < -0.3;
        this.moveRight = nx > 0.3;
      }
    };

    const handleEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== joyTouchId) continue;
        joyTouchId = null;
        stick.style.transform = 'translate(0,0)';
        this.moveForward = false;
        this.moveBackward = false;
        this.moveLeft = false;
        this.moveRight = false;
      }
    };

    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
    document.addEventListener('touchcancel', handleEnd);
  }

  setupControls() {
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));

    this.body.addEventListener('collide', (event) => {
      const contact = event.contact;
      if (contact.ni.y > 0.5) {
        this.isOnGround = true;
        this.canJump = true;
      }
    });
  }

  onKeyDown(event) {
    if (this.isDead) return;
    switch (event.code) {
      case 'KeyW': case 'ArrowUp': this.moveForward = true; break;
      case 'KeyS': case 'ArrowDown': this.moveBackward = true; break;
      case 'KeyA': case 'ArrowLeft': this.moveLeft = true; break;
      case 'KeyD': case 'ArrowRight': this.moveRight = true; break;
      case 'Space': this.wantsToJump = true; break;
    }
  }

  onKeyUp(event) {
    switch (event.code) {
      case 'KeyW': case 'ArrowUp': this.moveForward = false; break;
      case 'KeyS': case 'ArrowDown': this.moveBackward = false; break;
      case 'KeyA': case 'ArrowLeft': this.moveLeft = false; break;
      case 'KeyD': case 'ArrowRight': this.moveRight = false; break;
      case 'Space': this.wantsToJump = false; break;
    }
  }

  takeDamage(amount) {
    if (this.isDead) return;
    this.health -= amount;
    const overlay = document.getElementById('damage-overlay');
    if (overlay) {
      overlay.style.opacity = '0.5';
      setTimeout(() => { overlay.style.opacity = '0'; }, 100);
    }
    if (this.health <= 0) {
      this.health = 0;
      this.isDead = true;
      this.onDeath();
    }
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  onDeath() {
    if (this.body) {
      this.body.velocity.set(0, 0, 0);
      if (this.body.angularVelocity) this.body.angularVelocity.set(0, 0, 0);
    }
    this.controls.unlock();
    if (this.onDeathCallback) this.onDeathCallback();
  }

  checkGroundContact() {
    const start = new CANNON.Vec3(this.body.position.x, this.body.position.y, this.body.position.z);
    const end = new CANNON.Vec3(this.body.position.x, this.body.position.y - 1.2, this.body.position.z);
    const ray = new CANNON.Ray(start, end);
    ray.intersectWorld(this.physicsWorld.world, { result: this.groundRayResult, skipBackfaces: true });
    if (this.groundRayResult.hasHit && this.groundRayResult.distance < 1.15) {
      this.isOnGround = true;
      this.canJump = true;
    } else {
      this.isOnGround = false;
    }
    this.groundRayResult.reset();
  }

  update(deltaTime) {
    if (this.isDead) return;

    if (this.inputFrozen) {
      this.body.velocity.set(0, 0, 0);
      return;
    }

    if (!this.controls.isLocked) return;

    if (this.isMobile) {
      const euler = new THREE.Euler(this.cameraPitch, this.cameraYaw, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(euler);
    }

    this.checkGroundContact();

    const cameraDirection = new THREE.Vector3();
    this.camera.getWorldDirection(cameraDirection);
    cameraDirection.y = 0;
    cameraDirection.normalize();

    const rightVector = new THREE.Vector3();
    rightVector.crossVectors(cameraDirection, new THREE.Vector3(0, 1, 0)).normalize();

    this.direction.set(0, 0, 0);
    if (this.moveForward) this.direction.add(cameraDirection);
    if (this.moveBackward) this.direction.sub(cameraDirection);
    if (this.moveLeft) this.direction.sub(rightVector);
    if (this.moveRight) this.direction.add(rightVector);

    const hasInput = this.direction.x !== 0 || this.direction.z !== 0;
    if (hasInput) this.direction.normalize();

    this.body.velocity.x = hasInput ? this.direction.x * this.moveSpeed : 0;
    this.body.velocity.z = hasInput ? this.direction.z * this.moveSpeed : 0;

    if (this.wantsToJump && this.canJump && this.isOnGround) {
      this.body.velocity.y = this.jumpForce;
      this.canJump = false;
      this.isOnGround = false;
    }

    this.camera.position.set(this.body.position.x, this.body.position.y + 0.6, this.body.position.z);

    const now = performance.now();
    if (this.rapidFire && now > this.rapidFireEndTime) {
      this.rapidFire = false;
    }
  }

  getPosition() {
    if (!this._posCache) this._posCache = new THREE.Vector3();
    this._posCache.set(this.body.position.x, this.body.position.y, this.body.position.z);
    return this._posCache;
  }

  getDirection() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return dir;
  }

  activateRapidFire(duration) {
    this.rapidFire = true;
    this.rapidFireEndTime = performance.now() + duration;
  }

  reset() {
    this.health = this.maxHealth;
    this.isDead = false;
    this.inputFrozen = false;
    this.body.position.set(0, 3, 0);
    this.body.velocity.set(0, 0, 0);
    this.rapidFire = false;
    if (this.isMobile) {
      this.cameraYaw = 0;
      this.cameraPitch = 0;
    }
  }
}
