import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityWorld, getConnectedRoadTiles, placeBuilding } from './simulation';
import {
  computeSignalPhase,
  computeVehicleWorldPos,
  cornerToWorldPos,
  createInitialCitizenOnCorner,
  isIntersectionTile,
  stepCitizensPhysics,
  stepVehiclesPhysics,
} from './traffic';
import type { VehicleAgent } from './types';

function makeVehicle(overrides: Partial<VehicleAgent>): VehicleAgent {
  return {
    id: 'v',
    x: 4,
    z: 5,
    targetX: 5,
    targetZ: 5,
    dirX: 1,
    dirZ: 0,
    progress: 0.1,
    maxSpeed: 2.5,
    currentSpeed: 2.5,
    colorHex: 0xff0000,
    kind: 'sedan',
    worldX: 0,
    worldZ: 0,
    yaw: 0,
    stopped: false,
    waitTime: 0,
    ...overrides,
  };
}

test('trailing vehicle brakes and stops cleanly without overlapping lead vehicle', () => {
  const world = createCityWorld(false);
  for (let x = 2; x <= 10; x++) {
    placeBuilding(world, 'road', x, 5);
  }
  const roadTiles = getConnectedRoadTiles(world);

  const lead = makeVehicle({
    id: 'v_lead',
    x: 6,
    z: 5,
    targetX: 7,
    targetZ: 5,
    progress: 0.2,
    maxSpeed: 0,
    currentSpeed: 0,
    stopped: true,
  });
  const trail = makeVehicle({
    id: 'v_trail',
    x: 5,
    z: 5,
    targetX: 6,
    targetZ: 5,
    progress: 0.1,
    maxSpeed: 3.0,
    currentSpeed: 3.0,
    kind: 'taxi',
  });

  const vehicles = [lead, trail];
  for (let step = 0; step < 60; step++) {
    stepVehiclesPhysics(world, vehicles, [], 0.05, roadTiles, 1.0);
  }

  const pLead = computeVehicleWorldPos(lead);
  const pTrail = computeVehicleWorldPos(trail);
  const dist = Math.hypot(pLead.x - pTrail.x, pLead.z - pTrail.z);
  assert.ok(dist >= 0.85, `Expected safe vehicle spacing >= 0.85m, got ${dist.toFixed(3)}m`);
  assert.equal(trail.stopped, true, 'Trailing vehicle should stop behind lead vehicle');
});

test('signalized intersection halts cross-traffic on red phase and clears on green', () => {
  const world = createCityWorld(false);
  for (let x = 3; x <= 7; x++) placeBuilding(world, 'road', x, 5);
  for (let z = 3; z <= 7; z++) {
    if (z !== 5) placeBuilding(world, 'road', 5, z);
  }
  const roadTiles = getConnectedRoadTiles(world);
  assert.equal(isIntersectionTile(world, 5, 5), true);
  assert.equal(computeSignalPhase(6.0), 'ew_green');
  assert.equal(computeSignalPhase(1.0), 'ns_green');

  // Northbound-southbound car approaching intersection (5,5) from (5,4) during EW green (simTime=6.0)
  const nsCar = makeVehicle({
    id: 'v_ns',
    x: 5,
    z: 4,
    targetX: 5,
    targetZ: 5,
    dirX: 0,
    dirZ: 1,
    progress: 0.35,
    maxSpeed: 2.5,
    currentSpeed: 2.5,
  });

  for (let step = 0; step < 25; step++) {
    stepVehiclesPhysics(world, [nsCar], [], 0.05, roadTiles, 6.0);
  }
  assert.equal(nsCar.stopped, true, 'NS vehicle should stop at red light during EW green');
  assert.equal(nsCar.x, 5);
  assert.equal(nsCar.z, 4);

  // Switch signal to NS green (simTime=1.0) and verify vehicle proceeds cleanly
  for (let step = 0; step < 40; step++) {
    stepVehiclesPhysics(world, [nsCar], [], 0.05, roadTiles, 1.0);
  }
  assert.ok(nsCar.currentSpeed > 1.0, 'NS vehicle should accelerate through green light');
});

test('vehicle yields when a pedestrian is directly ahead in its path', () => {
  const world = createCityWorld(false);
  for (let x = 2; x <= 8; x++) {
    placeBuilding(world, 'road', x, 5);
  }
  const roadTiles = getConnectedRoadTiles(world);

  const car = makeVehicle({
    id: 'v1',
    x: 4,
    z: 5,
    targetX: 5,
    targetZ: 5,
    progress: 0.0,
    maxSpeed: 3.0,
    currentSpeed: 3.0,
  });
  const carPos = computeVehicleWorldPos(car);

  const pedestrian = createInitialCitizenOnCorner(world, 'c1', 4, 5, 1, 1, 0xffffff, 0x000000, 0);
  pedestrian.worldX = carPos.x + 0.8;
  pedestrian.worldZ = carPos.z;
  pedestrian.waiting = true;

  for (let step = 0; step < 25; step++) {
    stepVehiclesPhysics(world, [car], [pedestrian], 0.05, roadTiles, 1.0);
  }

  assert.ok(car.currentSpeed < 0.2, `Expected car to brake for pedestrian, got speed ${car.currentSpeed}`);
});

test('pedestrians hug sidewalk corners smoothly with zero corner teleportation', () => {
  const world = createCityWorld(false);
  // Build an intersection & loop of sidewalks
  for (let x = 3; x <= 7; x++) placeBuilding(world, 'road', x, 5);
  for (let z = 3; z <= 7; z++) {
    if (z !== 5) placeBuilding(world, 'road', 5, z);
  }
  const roadTiles = getConnectedRoadTiles(world);

  const c = createInitialCitizenOnCorner(world, 'c_corner', 4, 5, -1, 1, 0xff0000, 0x111111, 0.9);
  let prevX = c.worldX;
  let prevZ = c.worldZ;
  let maxStepDist = 0;

  const dt = 0.04;
  for (let step = 0; step < 220; step++) {
    stepCitizensPhysics(world, [c], [], dt, roadTiles);
    const d = Math.hypot(c.worldX - prevX, c.worldZ - prevZ);
    if (d > maxStepDist) maxStepDist = d;
    prevX = c.worldX;
    prevZ = c.worldZ;
  }

  const maxAllowed = c.maxSpeed * dt + 0.06;
  assert.ok(
    maxStepDist <= maxAllowed,
    `Expected continuous corner motion <= ${maxAllowed.toFixed(3)}m/step without teleporting, saw ${maxStepDist.toFixed(3)}m`,
  );
});

test('pedestrian waits at curb when an active vehicle approaches crosswalk', () => {
  const world = createCityWorld(false);
  for (let x = 3; x <= 7; x++) placeBuilding(world, 'road', x, 5);
  for (let z = 3; z <= 7; z++) {
    if (z !== 5) placeBuilding(world, 'road', 5, z);
  }
  const roadTiles = getConnectedRoadTiles(world);

  const c = createInitialCitizenOnCorner(world, 'c_cross', 5, 5, -1, 1, 0xff0000, 0x111111, 0.9);
  // Force next segment to be a crosswalk across South arm of intersection
  const start = cornerToWorldPos(5, 5, -1, 1);
  const end = cornerToWorldPos(5, 5, 1, 1);
  c.gx = 5;
  c.gz = 5;
  c.sx = -1;
  c.sz = 1;
  c.nextGx = 5;
  c.nextGz = 5;
  c.nextSx = 1;
  c.nextSz = 1;
  c.startX = start.x;
  c.startZ = start.z;
  c.endX = end.x;
  c.endZ = end.z;
  c.worldX = start.x;
  c.worldZ = start.z;
  c.segProgress = 0.05;
  c.crossingRoad = true;

  const approachingCar = makeVehicle({
    id: 'v_fast',
    x: 4,
    z: 5,
    targetX: 5,
    targetZ: 5,
    dirX: 1,
    dirZ: 0,
    progress: 0.75,
    currentSpeed: 2.4,
    stopped: false,
  });
  const carPos = computeVehicleWorldPos(approachingCar);
  approachingCar.worldX = carPos.x;
  approachingCar.worldZ = carPos.z;

  for (let step = 0; step < 20; step++) {
    stepCitizensPhysics(world, [c], [approachingCar], 0.05, roadTiles);
  }
  assert.equal(c.waiting, true, 'Pedestrian should wait at the curb for approaching traffic');
});

test('two pedestrians walking toward each other steer aside and maintain separation', () => {
  const world = createCityWorld(false);
  for (let x = 2; x <= 8; x++) {
    placeBuilding(world, 'road', x, 5);
  }
  const roadTiles = getConnectedRoadTiles(world);

  const c1 = createInitialCitizenOnCorner(world, 'c1', 4, 5, -1, 1, 0xff0000, 0x111111, 0.9);
  const c2 = createInitialCitizenOnCorner(world, 'c2', 5, 5, -1, 1, 0x00ff00, 0x111111, 0.9);
  // Head them directly toward each other along South sidewalk of x=4..5
  const p1 = cornerToWorldPos(4, 5, -1, 1);
  const p2 = cornerToWorldPos(5, 5, 1, 1);
  c1.startX = p1.x;
  c1.startZ = p1.z;
  c1.endX = p2.x;
  c1.endZ = p2.z;
  c1.worldX = p1.x + 1.0;
  c1.worldZ = p1.z;
  c1.segProgress = 0.25;
  c1.crossingRoad = false;

  c2.startX = p2.x;
  c2.startZ = p2.z;
  c2.endX = p1.x;
  c2.endZ = p1.z;
  c2.worldX = p2.x - 1.0;
  c2.worldZ = p2.z;
  c2.segProgress = 0.25;
  c2.crossingRoad = false;

  let minDist = Infinity;
  for (let step = 0; step < 40; step++) {
    stepCitizensPhysics(world, [c1, c2], [], 0.05, roadTiles);
    const d = Math.hypot(c1.worldX - c2.worldX, c1.worldZ - c2.worldZ);
    if (d < minDist) minDist = d;
  }

  assert.ok(minDist >= 0.18, `Expected pedestrians to steer apart, minDist was ${minDist.toFixed(3)}m`);
});
