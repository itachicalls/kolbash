/**
 * Physics System - cannon-es integration
 */

import * as CANNON from 'cannon-es';

export class PhysicsWorld {
  constructor() {
    this.world = new CANNON.World();
    this.world.gravity.set(0, -20, 0);
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.friction = 0.3;
    this.world.defaultContactMaterial.restitution = 0.1;

    // Materials
    this.groundMaterial = new CANNON.Material('ground');
    this.playerMaterial = new CANNON.Material('player');

    // Contact materials
    const playerGroundContact = new CANNON.ContactMaterial(
      this.playerMaterial,
      this.groundMaterial,
      {
        friction: 0.0,
        restitution: 0.0
      }
    );
    this.world.addContactMaterial(playerGroundContact);

    this.bodies = [];
    this.meshBodyPairs = [];
  }

  createGround(size = 100) {
    const groundShape = new CANNON.Box(new CANNON.Vec3(size / 2, 0.5, size / 2));
    const groundBody = new CANNON.Body({
      mass: 0,
      shape: groundShape,
      material: this.groundMaterial,
      position: new CANNON.Vec3(0, -0.5, 0)
    });
    this.world.addBody(groundBody);
    return groundBody;
  }

  createPlayerBody(position = { x: 0, y: 2, z: 0 }) {
    // Capsule approximation using cylinder + spheres
    const radius = 0.4;
    const height = 1.7;
    
    const playerBody = new CANNON.Body({
      mass: 80,
      position: new CANNON.Vec3(position.x, position.y, position.z),
      fixedRotation: true,
      material: this.playerMaterial,
      linearDamping: 0.2,
      angularDamping: 1.0,
      sleepSpeedLimit: 0,
      sleepTimeLimit: 0
    });

    // Main cylinder
    const cylinderShape = new CANNON.Cylinder(radius, radius, height - radius * 2, 8);
    playerBody.addShape(cylinderShape);

    // Bottom sphere
    const bottomSphere = new CANNON.Sphere(radius);
    playerBody.addShape(bottomSphere, new CANNON.Vec3(0, -(height / 2 - radius), 0));

    // Top sphere
    const topSphere = new CANNON.Sphere(radius);
    playerBody.addShape(topSphere, new CANNON.Vec3(0, height / 2 - radius, 0));

    this.world.addBody(playerBody);
    return playerBody;
  }

  createEnemyBody(position, radius = 0.5, height = 1.8) {
    const enemyBody = new CANNON.Body({
      mass: 0, // Kinematic
      type: CANNON.Body.KINEMATIC,
      position: new CANNON.Vec3(position.x, position.y, position.z)
    });

    const shape = new CANNON.Cylinder(radius, radius, height, 8);
    enemyBody.addShape(shape);

    this.world.addBody(enemyBody);
    return enemyBody;
  }

  createItemBody(position, radius = 0.3) {
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      position: new CANNON.Vec3(position.x, position.y, position.z),
      collisionResponse: false // Trigger only
    });

    const shape = new CANNON.Sphere(radius);
    body.addShape(shape);

    this.world.addBody(body);
    return body;
  }

  createWall(position, size) {
    const wallShape = new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2));
    const wallBody = new CANNON.Body({
      mass: 0,
      shape: wallShape,
      position: new CANNON.Vec3(position.x, position.y, position.z),
      material: this.groundMaterial
    });
    this.world.addBody(wallBody);
    return wallBody;
  }

  removeBody(body) {
    if (body) {
      this.world.removeBody(body);
      const pairIndex = this.meshBodyPairs.findIndex(pair => pair.body === body);
      if (pairIndex !== -1) {
        this.meshBodyPairs.splice(pairIndex, 1);
      }
    }
  }

  linkMeshToBody(mesh, body) {
    this.meshBodyPairs.push({ mesh, body });
  }

  update(deltaTime) {
    const fixedTimeStep = 1 / 60;
    const maxSubSteps = 1;
    
    this.world.step(fixedTimeStep, deltaTime, maxSubSteps);

    // Update linked meshes
    for (const pair of this.meshBodyPairs) {
      if (pair.mesh && pair.body) {
        pair.mesh.position.copy(pair.body.position);
        pair.mesh.quaternion.copy(pair.body.quaternion);
      }
    }
  }

  raycast(from, direction, maxDistance = 100) {
    const to = new CANNON.Vec3(
      from.x + direction.x * maxDistance,
      from.y + direction.y * maxDistance,
      from.z + direction.z * maxDistance
    );

    const result = new CANNON.RaycastResult();
    const ray = new CANNON.Ray(
      new CANNON.Vec3(from.x, from.y, from.z),
      to
    );

    ray.intersectWorld(this.world, {
      result,
      skipBackfaces: true,
      collisionFilterMask: -1,
      collisionFilterGroup: -1
    });

    return result;
  }
}
