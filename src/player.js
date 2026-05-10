/**
 * Player System - FPS Controller with mobile touch support
 */

import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import * as CANNON from 'cannon-es';

/** Half-size of playable floor (walls at ±25); keep body center inside with margin. */
const MAP_HALF = 23.55;
const BODY_RADIUS = 0.4;

export class Player {
  constructor(camera, physicsWorld, domElement) {
    this.camera = camera;
    this.physicsWorld = physicsWorld;

    this.maxHealth = 300;
    this.health = this.maxHealth;
    this.isDead = false;

    this.moveSpeed = 8;
    /** Sprint burst: ~4% faster while draining; refills from 0 to 100 in 10s when not sprinting. */
    this.stamina = 100;
    this.staminaMax = 100;
    this.sprintHeld = false;
    this._sprintConsuming = false;
    this.staminaBoostActive = false;
    this.jumpForce = 8;
    /** Extra jumps while airborne (1 = double jump total: ground + one mid-air). */
    this.airJumpsLeft = 0;
    this.isOnGround = false;
    /** Ignore floor ray briefly after jumping so two quick taps are not both ground jumps. */
    this.groundSuppressUntil = 0;

    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;
    /** True for one frame after Space / mobile jump (prevents infinite jumps while key held). */
    this.pendingJump = false;

    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    /** Reused in update / mobile camera — avoid per-frame allocations. */
    this._mobileEulerScratch = new THREE.Euler(0, 0, 0, 'YXZ');
    this._camMoveDir = new THREE.Vector3();
    this._worldUp = new THREE.Vector3(0, 1, 0);
    this._rightMoveVec = new THREE.Vector3();
    this._getDirCache = new THREE.Vector3();

    const touchCapable =
      ('ontouchstart' in window) || (typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0);
    const coarsePointer =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const narrowViewport = typeof window !== 'undefined' && window.innerWidth < 1400;
    this.isMobile = touchCapable && (coarsePointer || narrowViewport);

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
    this.airJumpsLeft = 1;

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
  }

  onKeyDown(event) {
    if (this.isDead) return;
    switch (event.code) {
      case 'KeyW': case 'ArrowUp': this.moveForward = true; break;
      case 'KeyS': case 'ArrowDown': this.moveBackward = true; break;
      case 'KeyA': case 'ArrowLeft': this.moveLeft = true; break;
      case 'KeyD': case 'ArrowRight': this.moveRight = true; break;
      case 'Space':
        if (!event.repeat) this.pendingJump = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.sprintHeld = true;
        break;
    }
  }

  onKeyUp(event) {
    switch (event.code) {
      case 'KeyW': case 'ArrowUp': this.moveForward = false; break;
      case 'KeyS': case 'ArrowDown': this.moveBackward = false; break;
      case 'KeyA': case 'ArrowLeft': this.moveLeft = false; break;
      case 'KeyD': case 'ArrowRight': this.moveRight = false; break;
      case 'Space': break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.sprintHeld = false;
        break;
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
    const now = performance.now();
    const hitGround = this.groundRayResult.hasHit && this.groundRayResult.distance < 1.15;
    const suppressed = now < this.groundSuppressUntil;
    if (hitGround && !suppressed) {
      this.isOnGround = true;
      this.airJumpsLeft = 1;
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
      this._mobileEulerScratch.set(this.cameraPitch, this.cameraYaw, 0);
      this.camera.quaternion.setFromEuler(this._mobileEulerScratch);
    }

    this.checkGroundContact();

    const cameraDirection = this._camMoveDir;
    this.camera.getWorldDirection(cameraDirection);
    cameraDirection.y = 0;
    cameraDirection.normalize();

    const rightVector = this._rightMoveVec;
    rightVector.crossVectors(cameraDirection, this._worldUp).normalize();

    this.direction.set(0, 0, 0);
    if (this.moveForward) this.direction.add(cameraDirection);
    if (this.moveBackward) this.direction.sub(cameraDirection);
    if (this.moveLeft) this.direction.sub(rightVector);
    if (this.moveRight) this.direction.add(rightVector);

    const hasInput = this.direction.x !== 0 || this.direction.z !== 0;
    if (hasInput) this.direction.normalize();

    const wantSprint = this.sprintHeld && hasInput;
    if (!wantSprint) this._sprintConsuming = false;
    else if (this.stamina >= 100) this._sprintConsuming = true;
    if (this.stamina <= 0) this._sprintConsuming = false;

    const boosted = wantSprint && this._sprintConsuming && this.stamina > 0;
    this.staminaBoostActive = boosted;
    const speed = this.moveSpeed * (boosted ? 1.04 : 1);
    if (boosted) {
      this.stamina = Math.max(0, this.stamina - 40 * deltaTime);
    } else if (this.stamina < this.staminaMax) {
      this.stamina = Math.min(this.staminaMax, this.stamina + 10 * deltaTime);
    }

    this.body.velocity.x = hasInput ? this.direction.x * speed : 0;
    this.body.velocity.z = hasInput ? this.direction.z * speed : 0;

    if (this.pendingJump) {
      this.pendingJump = false;
      if (this.isOnGround) {
        this.body.velocity.y = this.jumpForce;
        this.isOnGround = false;
        this.groundSuppressUntil = performance.now() + 90;
      } else if (this.airJumpsLeft > 0) {
        this.body.velocity.y = this.jumpForce;
        this.airJumpsLeft--;
        this.groundSuppressUntil = performance.now() + 90;
      }
    }

    const lim = MAP_HALF - BODY_RADIUS;
    let { x, z } = this.body.position;
    if (x < -lim || x > lim || z < -lim || z > lim) {
      x = Math.max(-lim, Math.min(lim, x));
      z = Math.max(-lim, Math.min(lim, z));
      this.body.position.x = x;
      this.body.position.z = z;
      this.body.velocity.x = 0;
      this.body.velocity.z = 0;
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

  /** Returns reused vector; copy if you need to keep it past the caller's synchronous use. */
  getDirection() {
    this.camera.getWorldDirection(this._getDirCache);
    return this._getDirCache;
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
    this.airJumpsLeft = 1;
    this.pendingJump = false;
    this.groundSuppressUntil = 0;
    this.rapidFire = false;
    this.stamina = this.staminaMax;
    this.sprintHeld = false;
    this._sprintConsuming = false;
    this.staminaBoostActive = false;
    if (this.isMobile) {
      this.cameraYaw = 0;
      this.cameraPitch = 0;
    }
  }
}
