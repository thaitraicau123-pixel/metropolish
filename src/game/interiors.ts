import type {
  BuildingKind,
  IndoorActor,
  IndoorPose,
  IndoorStation,
  PlacedBuilding,
} from './types';

const SHIRT_PALETTE = [0xd65a47, 0x457bb8, 0xe0b248, 0x4fa36b, 0x9c6ab5, 0xe27c5c];
const PANT_PALETTE = [0x2a3545, 0x3b424d, 0x52463a];

/**
 * Returns local-space interior furniture stations (aligned with CityModelFactory)
 * with doorway routing points so actors walk cleanly between rooms without clipping walls.
 */
export function getInteriorStations(
  kind: BuildingKind,
  interiorLevel: number,
): IndoorStation[] {
  switch (kind) {
    case 'cottage': {
      const list: IndoorStation[] = [
        {
          id: 'bed',
          kind: 'bed',
          label: 'Sleeping',
          x: -0.44,
          z: -0.34,
          facingYaw: Math.PI,
          doorX: -0.22,
          doorZ: 0.16,
        },
        {
          id: 'sofa',
          kind: 'sofa',
          label: 'Watching TV',
          x: 0.36,
          z: -0.34,
          facingYaw: 0,
          doorX: 0.15,
          doorZ: 0.12,
        },
        {
          id: 'bath',
          kind: 'bath',
          label: 'Washing up',
          x: 0.48,
          z: 0.42,
          facingYaw: Math.PI / 2,
          doorX: 0.12,
          doorZ: 0.25,
        },
      ];
      if (interiorLevel >= 2) {
        list.push({
          id: 'kitchen',
          kind: 'kitchen',
          label: 'Cooking',
          x: -0.4,
          z: 0.3,
          facingYaw: 0,
        });
        list.push({
          id: 'dining',
          kind: 'dining',
          label: 'Dining',
          x: -0.1,
          z: 0.42,
          facingYaw: -Math.PI / 2,
        });
      }
      return list;
    }

    case 'townhouse': {
      const list: IndoorStation[] = [
        {
          id: 'sofa',
          kind: 'sofa',
          label: 'Relaxing in parlor',
          x: 0.36,
          z: 0.38,
          facingYaw: Math.PI,
          doorX: 0,
          doorZ: 0.14,
        },
        {
          id: 'kitchen',
          kind: 'kitchen',
          label: 'Making dinner',
          x: -0.4,
          z: 0.34,
          facingYaw: 0,
          doorX: 0,
          doorZ: 0.14,
        },
        {
          id: 'bed',
          kind: 'bed',
          label: 'Resting in bedroom',
          x: -0.42,
          z: -0.42,
          facingYaw: 0,
          doorX: 0,
          doorZ: -0.18,
        },
        {
          id: 'bath',
          kind: 'bath',
          label: 'In bathroom',
          x: 0.5,
          z: -0.46,
          facingYaw: Math.PI / 2,
          doorX: 0.08,
          doorZ: -0.18,
        },
      ];
      if (interiorLevel >= 2) {
        list.push({
          id: 'desk',
          kind: 'desk',
          label: 'Working at PC',
          x: 0.32,
          z: -0.22,
          facingYaw: Math.PI,
          doorX: 0.08,
          doorZ: -0.18,
        });
      }
      return list;
    }

    case 'apartment': {
      // 4 separate suites with doorway entry from central hall intersection (0,0)
      const suites: IndoorStation[] = [
        // NW Suite
        { id: 'nw_bed', kind: 'bed', label: 'Apt 1 · Sleeping', x: -1.24, z: -1.08, facingYaw: 0, doorX: -0.35, doorZ: -0.24 },
        { id: 'nw_sofa', kind: 'sofa', label: 'Apt 1 · Lounge', x: -0.56, z: -0.52, facingYaw: 0, doorX: -0.35, doorZ: -0.24 },
        { id: 'nw_bath', kind: 'bath', label: 'Apt 1 · Bath', x: -1.32, z: -0.42, facingYaw: -Math.PI / 2, doorX: -0.35, doorZ: -0.24 },
        // NE Suite
        { id: 'ne_bed', kind: 'bed', label: 'Apt 2 · Sleeping', x: 0.48, z: -1.08, facingYaw: 0, doorX: 0.35, doorZ: -0.24 },
        { id: 'ne_sofa', kind: 'sofa', label: 'Apt 2 · Lounge', x: 1.15, z: -0.52, facingYaw: 0, doorX: 0.35, doorZ: -0.24 },
        { id: 'ne_kitchen', kind: 'kitchen', label: 'Apt 2 · Cooking', x: 0.54, z: -0.42, facingYaw: 0, doorX: 0.35, doorZ: -0.24 },
        // SW Suite
        { id: 'sw_bed', kind: 'bed', label: 'Apt 3 · Sleeping', x: -1.24, z: 0.52, facingYaw: 0, doorX: -0.35, doorZ: 0.24 },
        { id: 'sw_sofa', kind: 'sofa', label: 'Apt 3 · Lounge', x: -0.56, z: 1.08, facingYaw: 0, doorX: -0.35, doorZ: 0.24 },
        // SE Suite
        { id: 'se_bed', kind: 'bed', label: 'Apt 4 · Sleeping', x: 0.48, z: 0.52, facingYaw: 0, doorX: 0.35, doorZ: 0.24 },
        { id: 'se_dining', kind: 'dining', label: 'Apt 4 · Dining', x: 1.15, z: 1.08, facingYaw: Math.PI, doorX: 0.35, doorZ: 0.24 },
      ];
      return suites;
    }

    case 'villa':
      return [
        { id: 'master_bed', kind: 'bed', label: 'Master Suite · Resting', x: 0.96, z: -0.68, facingYaw: 0, doorX: 0.12, doorZ: -0.26 },
        { id: 'master_bath', kind: 'bath', label: 'En-suite Bath', x: 1.28, z: -0.24, facingYaw: Math.PI / 2, doorX: 0.22, doorZ: -0.26 },
        { id: 'guest_bed', kind: 'bed', label: 'Guest Room', x: -0.96, z: -0.68, facingYaw: 0, doorX: -0.45, doorZ: -0.05 },
        { id: 'living', kind: 'sofa', label: 'Living Lounge', x: 0.76, z: 0.46, facingYaw: 0, doorX: 0.12, doorZ: 0.25 },
        { id: 'kitchen', kind: 'kitchen', label: 'Gourmet Kitchen', x: -0.82, z: 0.62, facingYaw: 0, doorX: -0.45, doorZ: 0.2 },
        { id: 'dining', kind: 'dining', label: 'Dining Hall', x: -0.85, z: 0.12, facingYaw: -Math.PI / 2, doorX: -0.45, doorZ: 0.15 },
        { id: 'patio', kind: 'patio', label: 'Poolside Patio', x: 0.25, z: -1.42, facingYaw: Math.PI / 2, doorX: 0.0, doorZ: -1.1 },
      ];

    case 'cafe':
      return [
        { id: 'barista', kind: 'counter', label: 'Brewing espresso', x: 0.24, z: -0.24, facingYaw: Math.PI },
        { id: 'baker', kind: 'kitchen', label: 'Baking pastries', x: -0.28, z: -0.24, facingYaw: Math.PI },
        { id: 'table_l', kind: 'dining', label: 'Enjoying coffee', x: -0.42, z: 0.34, facingYaw: 0 },
        { id: 'table_r', kind: 'dining', label: 'Pastry break', x: 0.42, z: 0.34, facingYaw: 0 },
      ];

    case 'diner':
      return [
        { id: 'grill', kind: 'kitchen', label: 'Cooking on grill', x: 0, z: -0.24, facingYaw: Math.PI },
        { id: 'booth_l', kind: 'dining', label: 'Diner booth', x: -0.38, z: 0.32, facingYaw: -Math.PI / 2 },
        { id: 'booth_r', kind: 'dining', label: 'Milkshake booth', x: 0.38, z: 0.32, facingYaw: Math.PI / 2 },
        { id: 'jukebox', kind: 'counter', label: 'Picking a 98 track', x: 0.45, z: -0.42, facingYaw: Math.PI / 2 },
      ];

    case 'supermarket':
      return [
        { id: 'aisle_1', kind: 'counter', label: 'Browsing produce', x: -0.52, z: -0.35, facingYaw: -Math.PI / 2 },
        { id: 'aisle_2', kind: 'counter', label: 'Stocking shelves', x: 0.44, z: -0.25, facingYaw: Math.PI / 2 },
        { id: 'dairy', kind: 'counter', label: 'Dairy section', x: 0.1, z: -1.1, facingYaw: Math.PI },
        { id: 'checkout', kind: 'desk', label: 'Cashier lane', x: 0, z: 0.98, facingYaw: 0 },
      ];

    case 'cinema':
      return [
        { id: 'popcorn', kind: 'counter', label: 'Popcorn stand', x: -0.45, z: 1.12, facingYaw: -Math.PI / 2, doorX: 0, doorZ: 0.72 },
        { id: 'seat_1', kind: 'seat', label: 'Watching film', x: -0.48, z: -0.23, facingYaw: Math.PI, doorX: 0, doorZ: 0.36 },
        { id: 'seat_2', kind: 'seat', label: 'Watching film', x: 0.48, z: -0.65, facingYaw: Math.PI, doorX: 0, doorZ: 0.36 },
        { id: 'seat_3', kind: 'seat', label: 'Watching film', x: 0, z: 0.19, facingYaw: Math.PI, doorX: 0, doorZ: 0.36 },
        { id: 'restroom', kind: 'bath', label: 'Lobby restroom', x: 1.15, z: 1.05, facingYaw: Math.PI / 2, doorX: 0.65, doorZ: 0.75 },
      ];

    case 'office':
      return [
        { id: 'desk_1', kind: 'desk', label: 'Spreadsheet work', x: -0.82, z: 0.46, facingYaw: Math.PI },
        { id: 'desk_2', kind: 'desk', label: 'CAD drafting', x: 0.82, z: 0.46, facingYaw: Math.PI },
        { id: 'desk_3', kind: 'desk', label: 'Client call', x: 0.82, z: 1.12, facingYaw: Math.PI },
        { id: 'boardroom', kind: 'dining', label: 'Board meeting', x: 0.35, z: -0.44, facingYaw: Math.PI },
        { id: 'breakroom', kind: 'kitchen', label: 'Coffee break', x: -0.92, z: -0.45, facingYaw: 0 },
      ];

    case 'police':
      return [
        { id: 'dispatch', kind: 'desk', label: 'Radio dispatch', x: 0.26, z: 0.36, facingYaw: Math.PI },
        { id: 'lockers', kind: 'counter', label: 'Gear lockers', x: -0.32, z: -0.24, facingYaw: -Math.PI / 2 },
        { id: 'lobby', kind: 'dining', label: 'Case briefing', x: -0.24, z: 0.35, facingYaw: 0 },
      ];

    case 'hospital':
      return [
        { id: 'reception', kind: 'counter', label: 'Check-in desk', x: -0.75, z: 0.65, facingYaw: 0, doorX: -0.2, doorZ: 0.35 },
        { id: 'waiting', kind: 'seat', label: 'Waiting lounge', x: 0.85, z: 1.05, facingYaw: Math.PI, doorX: 0.2, doorZ: 0.35 },
        { id: 'ward_1', kind: 'bed', label: 'Exam Bay 1', x: -1.0, z: -0.52, facingYaw: 0, doorX: -1.0, doorZ: -0.05 },
        { id: 'ward_2', kind: 'desk', label: 'Doctor rounds', x: 0.0, z: -0.35, facingYaw: Math.PI, doorX: 0, doorZ: -0.05 },
        { id: 'ward_3', kind: 'bed', label: 'Exam Bay 3', x: 1.0, z: -0.52, facingYaw: 0, doorX: 1.0, doorZ: -0.05 },
      ];

    case 'powerplant':
      return [
        { id: 'console', kind: 'desk', label: 'Grid control panel', x: 0.55, z: 0.92, facingYaw: 0 },
        { id: 'turbine_1', kind: 'counter', label: 'Checking turbine', x: -0.9, z: 0.35, facingYaw: Math.PI },
        { id: 'turbine_2', kind: 'counter', label: 'Monitoring load', x: 0.0, z: 0.35, facingYaw: Math.PI },
      ];

    default:
      return [];
  }
}

function poseForStation(kind: IndoorStation['kind']): IndoorPose {
  if (kind === 'bed') return 'sleeping';
  if (kind === 'sofa' || kind === 'seat' || kind === 'dining' || kind === 'patio') return 'sitting';
  if (kind === 'desk' || kind === 'kitchen' || kind === 'counter') return 'working';
  return 'standing';
}

export function createIndoorActorsForBuilding(
  building: PlacedBuilding,
): IndoorActor[] {
  if (!building.powered || building.kind === 'road' || building.kind === 'park') {
    return [];
  }
  const stations = getInteriorStations(building.kind, building.interiorLevel);
  if (stations.length === 0) return [];

  const desiredCount =
    building.width >= 2
      ? Math.min(4, Math.max(2, building.interiorLevel + 1))
      : Math.min(2, Math.max(1, building.interiorLevel));

  const actors: IndoorActor[] = [];
  for (let i = 0; i < desiredCount; i++) {
    const stationIdx = Math.floor((i * stations.length) / desiredCount) % stations.length;
    const st = stations[stationIdx];
    actors.push({
      id: `${building.id}_ia_${i}`,
      buildingId: building.id,
      shirtHex: SHIRT_PALETTE[(i + building.x) % SHIRT_PALETTE.length],
      pantsHex: PANT_PALETTE[(i + building.z) % PANT_PALETTE.length],
      x: st.x,
      z: st.z,
      yaw: st.facingYaw,
      stationId: st.id,
      activityLabel: st.label,
      pose: poseForStation(st.kind),
      waypoints: [],
      timer: 2.0 + ((i * 1.37) % 3.2),
      walkPhase: i * 1.1,
      speed: 0.55 + (i % 2) * 0.12,
    });
  }
  return actors;
}

export function stepIndoorActors(
  actors: IndoorActor[],
  stations: IndoorStation[],
  dt: number,
  rng: () => number = Math.random,
): void {
  if (stations.length === 0) return;

  for (const actor of actors) {
    if (actor.waypoints.length > 0) {
      actor.pose = 'walking';
      const target = actor.waypoints[0];
      const dx = target.x - actor.x;
      const dz = target.z - actor.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.04) {
        actor.x = target.x;
        actor.z = target.z;
        actor.waypoints.shift();
        if (actor.waypoints.length === 0) {
          const st = stations.find((s) => s.id === actor.stationId) ?? stations[0];
          actor.yaw = st.facingYaw;
          actor.pose = poseForStation(st.kind);
          actor.activityLabel = st.label;
          actor.timer = 2.8 + rng() * 3.4;
        }
      } else {
        const step = Math.min(dist, actor.speed * dt);
        actor.x += (dx / dist) * step;
        actor.z += (dz / dist) * step;
        actor.yaw = Math.atan2(dx, dz);
        actor.walkPhase += step * 11;
      }
      continue;
    }

    // Using furniture at current station
    actor.timer -= dt;
    if (actor.pose === 'working') {
      actor.walkPhase += dt * 4.5;
    }
    if (actor.timer <= 0 && stations.length > 1) {
      // Pick a different station not currently occupied by another actor if possible
      const occupied = new Set(
        actors.filter((o) => o.id !== actor.id).map((o) => o.stationId),
      );
      const candidates = stations.filter((s) => s.id !== actor.stationId && !occupied.has(s.id));
      const pool = candidates.length > 0 ? candidates : stations.filter((s) => s.id !== actor.stationId);
      const nextSt = pool[Math.floor(rng() * pool.length)];
      const curSt = stations.find((s) => s.id === actor.stationId);

      const route: Array<{ x: number; z: number }> = [];
      if (curSt?.doorX !== undefined && curSt.doorZ !== undefined) {
        route.push({ x: curSt.doorX, z: curSt.doorZ });
      }
      if (nextSt.doorX !== undefined && nextSt.doorZ !== undefined) {
        route.push({ x: nextSt.doorX, z: nextSt.doorZ });
      }
      route.push({ x: nextSt.x, z: nextSt.z });

      actor.stationId = nextSt.id;
      actor.activityLabel = `Walking to ${nextSt.label.toLowerCase()}`;
      actor.waypoints = route;
      actor.pose = 'walking';
    }
  }
}
