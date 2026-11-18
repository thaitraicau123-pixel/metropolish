import { GRID_SIZE, TILE_WORLD_SIZE } from './catalog';
import type { CitizenAgent, CityWorld, SignalPhase, VehicleAgent } from './types';

export const SIDEWALK_CURB_OFFSET = 0.8; // meters from tile center (asphalt is ±0.64m)
const SIGNAL_CYCLE_SEC = 10.0;

export function gridToWorldCenter(gx: number, gz: number): { x: number; z: number } {
  const halfSpan = (GRID_SIZE * TILE_WORLD_SIZE) / 2;
  return {
    x: -halfSpan + (gx + 0.5) * TILE_WORLD_SIZE,
    z: -halfSpan + (gz + 0.5) * TILE_WORLD_SIZE,
  };
}

export function cornerToWorldPos(
  gx: number,
  gz: number,
  sx: number,
  sz: number,
): { x: number; z: number } {
  const c = gridToWorldCenter(gx, gz);
  return {
    x: c.x + sx * SIDEWALK_CURB_OFFSET,
    z: c.z + sz * SIDEWALK_CURB_OFFSET,
  };
}

function isWalkableOrRoad(world: CityWorld, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= world.size || z >= world.size) return false;
  const k = world.tiles[x][z].kind;
  return k === 'road' || k === 'park';
}

function isRoadTile(world: CityWorld, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= world.size || z >= world.size) return false;
  return world.tiles[x][z].kind === 'road';
}

export function isIntersectionTile(world: CityWorld, x: number, z: number): boolean {
  if (!isRoadTile(world, x, z)) return false;
  let neighbors = 0;
  if (isRoadTile(world, x + 1, z)) neighbors++;
  if (isRoadTile(world, x - 1, z)) neighbors++;
  if (isRoadTile(world, x, z + 1)) neighbors++;
  if (isRoadTile(world, x, z - 1)) neighbors++;
  return neighbors >= 3;
}

export function computeSignalPhase(simTimeSec: number): SignalPhase {
  const t = ((simTimeSec % SIGNAL_CYCLE_SEC) + SIGNAL_CYCLE_SEC) % SIGNAL_CYCLE_SEC;
  if (t < 4.0) return 'ns_green';
  if (t < 5.0) return 'ns_clear';
  if (t < 9.0) return 'ew_green';
  return 'ew_clear';
}

export function isAxisGreen(phase: SignalPhase, dirX: number, dirZ: number): boolean {
  if (Math.abs(dirZ) > Math.abs(dirX)) {
    return phase === 'ns_green';
  }
  return phase === 'ew_green';
}

export function pickNextRoadTile(
  world: CityWorld,
  cx: number,
  cz: number,
  prevDx: number,
  prevDz: number,
  vehicles?: VehicleAgent[],
  rng: () => number = Math.random,
): { tx: number; tz: number; dx: number; dz: number } {
  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const valid = dirs.filter(([dx, dz]) => isRoadTile(world, cx + dx, cz + dz));
  if (valid.length === 0) return { tx: cx, tz: cz, dx: prevDx, dz: prevDz };

  const nonReverse = valid.filter(([dx, dz]) => !(dx === -prevDx && dz === -prevDz));
  const pool = nonReverse.length > 0 ? nonReverse : valid;

  if (vehicles && pool.length > 1) {
    // Score each branch by congestion so vehicles spread across open streets
    let minLoad = Infinity;
    const scored = pool.map(([dx, dz]) => {
      const tx = cx + dx;
      const tz = cz + dz;
      let load = 0;
      for (const other of vehicles) {
        if ((other.x === tx && other.z === tz) || (other.targetX === tx && other.targetZ === tz)) {
          load += other.stopped ? 2.5 : 1;
        }
      }
      if (load < minLoad) minLoad = load;
      return { dx, dz, load };
    });
    const leastBusy = scored.filter((s) => s.load <= minLoad + 0.5);
    const chosen = leastBusy[Math.floor(rng() * leastBusy.length)];
    return { tx: cx + chosen.dx, tz: cz + chosen.dz, dx: chosen.dx, dz: chosen.dz };
  }

  const chosen = pool[Math.floor(rng() * pool.length)];
  return { tx: cx + chosen[0], tz: cz + chosen[1], dx: chosen[0], dz: chosen[1] };
}

export function computeVehicleWorldPos(v: VehicleAgent): { x: number; z: number; yaw: number } {
  const fromW = gridToWorldCenter(v.x, v.z);
  const toW = gridToWorldCenter(v.targetX, v.targetZ);
  const lx = fromW.x + (toW.x - fromW.x) * v.progress;
  const lz = fromW.z + (toW.z - fromW.z) * v.progress;
  const laneOffset = 0.30;
  const rx = -v.dirZ * laneOffset;
  const rz = v.dirX * laneOffset;
  return {
    x: lx + rx,
    z: lz + rz,
    yaw: Math.atan2(v.dirX, v.dirZ),
  };
}

interface SidewalkEdge {
  gx: number;
  gz: number;
  sx: number;
  sz: number;
  crossingRoad: boolean;
}

function getValidSidewalkNeighbors(world: CityWorld, c: CitizenAgent): SidewalkEdge[] {
  const { gx, gz, sx, sz } = c;
  const edges: SidewalkEdge[] = [];

  // 1. Bridge X across tile boundary onto adjacent walkable tile (pure sidewalk)
  if (isWalkableOrRoad(world, gx + sx, gz)) {
    edges.push({ gx: gx + sx, gz, sx: -sx, sz, crossingRoad: false });
  }

  // 2. Bridge Z across tile boundary onto adjacent walkable tile (pure sidewalk)
  if (isWalkableOrRoad(world, gx, gz + sz)) {
    edges.push({ gx, gz: gz + sz, sx, sz: -sz, crossingRoad: false });
  }

  // 3. Walk along X curb edge of current tile (or cross street via crosswalk if road joins on sz side)
  const armAtSz = isRoadTile(world, gx, gz + sz);
  const selfIsRoad = isRoadTile(world, gx, gz);
  edges.push({
    gx,
    gz,
    sx: -sx,
    sz,
    crossingRoad: selfIsRoad && armAtSz,
  });

  // 4. Walk along Z curb edge of current tile (or cross street via crosswalk if road joins on sx side)
  const armAtSx = isRoadTile(world, gx + sx, gz);
  edges.push({
    gx,
    gz,
    sx,
    sz: -sz,
    crossingRoad: selfIsRoad && armAtSx,
  });

  return edges;
}

export function pickNextSidewalkCorner(
  world: CityWorld,
  c: CitizenAgent,
  rng: () => number = Math.random,
): SidewalkEdge {
  const edges = getValidSidewalkNeighbors(world, c);
  const curPos = cornerToWorldPos(c.gx, c.gz, c.sx, c.sz);

  // Filter out direct 180-degree U-turn unless no other choice
  const scored = edges.map((e) => {
    const p = cornerToWorldPos(e.gx, e.gz, e.sx, e.sz);
    const dx = p.x - curPos.x;
    const dz = p.z - curPos.z;
    const len = Math.hypot(dx, dz) || 1;
    const dot = (dx / len) * c.prevDirX + (dz / len) * c.prevDirZ;
    return { e, dot, len };
  });

  // Prefer staying on sidewalk (non-crosswalk) most of the time, or crossing at intersections cleanly
  const nonReverse = scored.filter((s) => s.dot > -0.85);
  const pool = nonReverse.length > 0 ? nonReverse : scored;

  // Bias toward forward continuity and sidewalk edges over frequent street crossings
  const weighted: SidewalkEdge[] = [];
  for (const item of pool) {
    let w = item.e.crossingRoad ? 1 : 3;
    if (item.dot > 0.5) w += 3;
    else if (item.dot > -0.1) w += 1;
    for (let k = 0; k < w; k++) weighted.push(item.e);
  }
  return weighted[Math.floor(rng() * weighted.length)];
}

export function createInitialCitizenOnCorner(
  world: CityWorld,
  id: string,
  gx: number,
  gz: number,
  sx: number,
  sz: number,
  shirtHex: number,
  pantsHex: number,
  maxSpeed: number,
): CitizenAgent {
  const start = cornerToWorldPos(gx, gz, sx, sz);
  const citizen: CitizenAgent = {
    id,
    gx,
    gz,
    sx,
    sz,
    nextGx: gx,
    nextGz: gz,
    nextSx: sx,
    nextSz: sz,
    prevDirX: 1,
    prevDirZ: 0,
    worldX: start.x,
    worldZ: start.z,
    startX: start.x,
    startZ: start.z,
    endX: start.x,
    endZ: start.z,
    segProgress: 0,
    segLength: 1,
    crossingRoad: false,
    maxSpeed,
    currentSpeed: maxSpeed,
    shirtHex,
    pantsHex,
    lateralAvoid: 0,
    walkPhase: 0,
    yaw: 0,
    waiting: false,
  };

  const next = pickNextSidewalkCorner(world, citizen);
  const end = cornerToWorldPos(next.gx, next.gz, next.sx, next.sz);
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const len = Math.max(0.05, Math.hypot(dx, dz));
  citizen.nextGx = next.gx;
  citizen.nextGz = next.gz;
  citizen.nextSx = next.sx;
  citizen.nextSz = next.sz;
  citizen.endX = end.x;
  citizen.endZ = end.z;
  citizen.segLength = len;
  citizen.crossingRoad = next.crossingRoad;
  citizen.prevDirX = dx / len;
  citizen.prevDirZ = dz / len;
  citizen.yaw = Math.atan2(dx, dz);
  return citizen;
}

/**
 * Steps all vehicles with anti-gridlock intersection signals, box clearance,
 * forward lane braking, and pedestrian crosswalk yielding.
 */
export function stepVehiclesPhysics(
  world: CityWorld,
  vehicles: VehicleAgent[],
  citizens: CitizenAgent[],
  dt: number,
  roadTiles: Array<{ x: number; z: number }>,
  simTimeSec = 0,
): void {
  const signalPhase = computeSignalPhase(simTimeSec);

  for (const v of vehicles) {
    const p = computeVehicleWorldPos(v);
    v.worldX = p.x;
    v.worldZ = p.z;
    v.yaw = p.yaw;
  }

  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    if (!isRoadTile(world, v.x, v.z)) {
      if (roadTiles.length > 0) {
        const r = roadTiles[i % roadTiles.length];
        v.x = r.x;
        v.z = r.z;
        const n = pickNextRoadTile(world, r.x, r.z, v.dirX, v.dirZ, vehicles);
        v.targetX = n.tx;
        v.targetZ = n.tz;
        v.dirX = n.dx;
        v.dirZ = n.dz;
        v.progress = 0;
        v.waitTime = 0;
      }
      continue;
    }

    const fwdX = v.dirX;
    const fwdZ = v.dirZ;
    const rightX = -fwdZ;
    const rightZ = fwdX;

    let desiredSpeed = v.maxSpeed;

    // 1. Signalized Intersection Stop-Line & "Don't Block the Box" Check
    const enteringIntersection = isIntersectionTile(world, v.targetX, v.targetZ);
    if (enteringIntersection && v.progress >= 0.25 && v.progress <= 0.66) {
      const green = isAxisGreen(signalPhase, fwdX, fwdZ);
      if (!green && v.kind !== 'police' && v.kind !== 'ambulance') {
        desiredSpeed = 0;
      } else {
        // Don't enter the intersection if another vehicle is stalled inside the box
        for (let j = 0; j < vehicles.length; j++) {
          if (i === j) continue;
          const other = vehicles[j];
          const inBox =
            (other.x === v.targetX && other.z === v.targetZ && other.progress < 0.72) ||
            (other.targetX === v.targetX &&
              other.targetZ === v.targetZ &&
              other.progress > 0.55 &&
              (other.dirX !== v.dirX || other.dirZ !== v.dirZ));
          if (inBox && other.currentSpeed < 0.45) {
            desiredSpeed = 0;
            break;
          }
        }
      }
    }

    // 2. Forward vehicle radar braking & deadlock check
    if (desiredSpeed > 0) {
      for (let j = 0; j < vehicles.length; j++) {
        if (i === j) continue;
        const other = vehicles[j];
        const dx = other.worldX - v.worldX;
        const dz = other.worldZ - v.worldZ;
        const distSq = dx * dx + dz * dz;
        if (distSq > 3.6) continue;

        const forwardDist = dx * fwdX + dz * fwdZ;
        const lateralDist = Math.abs(dx * rightX + dz * rightZ);

        if (forwardDist > 0.05 && forwardDist < 1.55 && lateralDist < 0.62) {
          if (forwardDist < 1.02) {
            desiredSpeed = 0;
            break;
          } else {
            const factor = (forwardDist - 1.02) / (1.55 - 1.02);
            desiredSpeed = Math.min(desiredSpeed, v.maxSpeed * factor);
          }
        }

        if (distSq < 0.72 && forwardDist >= 0) {
          desiredSpeed = 0;
          break;
        }
      }
    }

    // 3. Yield to pedestrians crossing or stepping in front of vehicle
    if (desiredSpeed > 0) {
      for (let cIdx = 0; cIdx < citizens.length; cIdx++) {
        const c = citizens[cIdx];
        const dx = c.worldX - v.worldX;
        const dz = c.worldZ - v.worldZ;
        const distSq = dx * dx + dz * dz;
        if (distSq > 2.5) continue;
        const forwardDist = dx * fwdX + dz * fwdZ;
        const lateralDist = Math.abs(dx * rightX + dz * rightZ);
        if (forwardDist > 0.08 && forwardDist < 1.32 && lateralDist < 0.58) {
          desiredSpeed = 0;
          break;
        }
      }
    }

    // Smooth acceleration & braking
    const accel = desiredSpeed < v.currentSpeed ? 9.5 : 4.5;
    if (v.currentSpeed < desiredSpeed) {
      v.currentSpeed = Math.min(desiredSpeed, v.currentSpeed + accel * dt);
    } else {
      v.currentSpeed = Math.max(desiredSpeed, v.currentSpeed - accel * dt);
    }
    v.stopped = v.currentSpeed < 0.06;
    v.waitTime = v.stopped ? v.waitTime + dt : 0;

    // Anti-gridlock tie-breaker: if stuck > 5.5s inside an intersection or dead-end, creep clear
    if (v.waitTime > 5.5 && isIntersectionTile(world, v.x, v.z)) {
      v.currentSpeed = Math.max(v.currentSpeed, 0.8);
      v.stopped = false;
    }

    v.progress += (v.currentSpeed / TILE_WORLD_SIZE) * dt;
    if (v.progress >= 1) {
      v.progress -= 1;
      v.x = v.targetX;
      v.z = v.targetZ;
      const n = pickNextRoadTile(world, v.x, v.z, v.dirX, v.dirZ, vehicles);
      v.targetX = n.tx;
      v.targetZ = n.tz;
      v.dirX = n.dx;
      v.dirZ = n.dz;
    }

    const pos = computeVehicleWorldPos(v);
    v.worldX = pos.x;
    v.worldZ = pos.z;
    v.yaw = pos.yaw;
  }
}

/**
 * Steps pedestrians along continuous sidewalk corner paths and zebra crosswalks:
 * - Zero teleportation at corners (strictly continuous segment endpoints)
 * - Hugs sidewalks around corners and crosses asphalt only along crosswalks
 * - Waits at the curb when a moving car is crossing the crosswalk ahead
 * - Steers laterally around approaching pedestrians without clipping
 */
export function stepCitizensPhysics(
  world: CityWorld,
  citizens: CitizenAgent[],
  vehicles: VehicleAgent[],
  dt: number,
  roadTiles: Array<{ x: number; z: number }>,
): void {
  for (let i = 0; i < citizens.length; i++) {
    const c = citizens[i];
    if (!isWalkableOrRoad(world, c.gx, c.gz)) {
      if (roadTiles.length > 0) {
        const r = roadTiles[i % roadTiles.length];
        const fresh = createInitialCitizenOnCorner(
          world,
          c.id,
          r.x,
          r.z,
          i % 2 === 0 ? 1 : -1,
          i % 3 === 0 ? 1 : -1,
          c.shirtHex,
          c.pantsHex,
          c.maxSpeed,
        );
        Object.assign(c, fresh);
      }
      continue;
    }

    const segDx = c.endX - c.startX;
    const segDz = c.endZ - c.startZ;
    const segLen = Math.max(0.05, Math.hypot(segDx, segDz));
    const fwdX = segDx / segLen;
    const fwdZ = segDz / segLen;
    const rightX = -fwdZ;
    const rightZ = fwdX;

    let desiredSpeed = c.maxSpeed;
    let targetAvoid = 0;

    // 1. Crosswalk safety check: wait at curb before entering asphalt if a moving car is close
    if (c.crossingRoad && c.segProgress < 0.25) {
      for (let vIdx = 0; vIdx < vehicles.length; vIdx++) {
        const v = vehicles[vIdx];
        if (v.stopped) continue;
        const dx = c.worldX - v.worldX;
        const dz = c.worldZ - v.worldZ;
        const distSq = dx * dx + dz * dz;
        if (distSq < 4.4) {
          const carApproach = dx * v.dirX + dz * v.dirZ;
          if (carApproach > 0 && carApproach < 2.0) {
            desiredSpeed = 0;
            break;
          }
        }
      }
    }

    // 2. Pedestrian-to-pedestrian separation steering along sidewalk
    if (desiredSpeed > 0) {
      for (let j = 0; j < citizens.length; j++) {
        if (i === j) continue;
        const other = citizens[j];
        const dx = other.worldX - c.worldX;
        const dz = other.worldZ - c.worldZ;
        const distSq = dx * dx + dz * dz;
        if (distSq > 0.64) continue;

        const forwardDist = dx * fwdX + dz * fwdZ;
        const latSigned = dx * rightX + dz * rightZ;
        const latAbs = Math.abs(latSigned);

        if (forwardDist > -0.08 && forwardDist < 0.65 && latAbs < 0.34) {
          const pushDir = latSigned >= 0 ? -1 : 1;
          targetAvoid = pushDir * 0.14;
          if (forwardDist > 0 && forwardDist < 0.35 && latAbs < 0.22) {
            desiredSpeed = Math.min(desiredSpeed, c.maxSpeed * 0.25);
          }
        }
      }
    }

    c.lateralAvoid += (targetAvoid - c.lateralAvoid) * Math.min(1, 7 * dt);
    c.currentSpeed += (desiredSpeed - c.currentSpeed) * Math.min(1, 9 * dt);
    c.waiting = c.currentSpeed < 0.05;

    c.segProgress += (c.currentSpeed / segLen) * dt;
    if (!c.waiting) {
      c.walkPhase += c.currentSpeed * dt * 8.5;
    }

    if (c.segProgress >= 1) {
      // Advance seamlessly to the exact corner endpoint (zero jump!)
      c.gx = c.nextGx;
      c.gz = c.nextGz;
      c.sx = c.nextSx;
      c.sz = c.nextSz;
      c.prevDirX = fwdX;
      c.prevDirZ = fwdZ;

      const exactCorner = cornerToWorldPos(c.gx, c.gz, c.sx, c.sz);
      c.startX = exactCorner.x;
      c.startZ = exactCorner.z;

      const next = pickNextSidewalkCorner(world, c);
      const nextCorner = cornerToWorldPos(next.gx, next.gz, next.sx, next.sz);
      c.nextGx = next.gx;
      c.nextGz = next.gz;
      c.nextSx = next.sx;
      c.nextSz = next.sz;
      c.endX = nextCorner.x;
      c.endZ = nextCorner.z;
      c.segLength = Math.max(0.05, Math.hypot(c.endX - c.startX, c.endZ - c.startZ));
      c.crossingRoad = next.crossingRoad;
      c.segProgress = 0;
    }

    const baseX = c.startX + (c.endX - c.startX) * c.segProgress;
    const baseZ = c.startZ + (c.endZ - c.startZ) * c.segProgress;
    const newSegDx = c.endX - c.startX;
    const newSegDz = c.endZ - c.startZ;
    const newLen = Math.max(0.05, Math.hypot(newSegDx, newSegDz));
    const nRightX = -(newSegDz / newLen);
    const nRightZ = newSegDx / newLen;

    // Fade lateral avoid gently near corners so endpoints stay strictly flush on sidewalk
    const avoidWeight = Math.sin(Math.min(1, Math.max(0, c.segProgress)) * Math.PI);
    c.worldX = baseX + nRightX * c.lateralAvoid * avoidWeight;
    c.worldZ = baseZ + nRightZ * c.lateralAvoid * avoidWeight;

    // Smooth yaw turn toward heading
    const targetYaw = Math.atan2(newSegDx, newSegDz);
    let diff = targetYaw - c.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    c.yaw += diff * Math.min(1, 12 * dt);
  }
}
