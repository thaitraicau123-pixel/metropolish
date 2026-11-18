import {
  BANKRUPT_THRESHOLD,
  BUILDING_CATALOG,
  GRID_SIZE,
  INITIAL_MILESTONES,
  SECONDS_PER_DAY,
  STARTER_TOWN_LAYOUT,
  STARTING_FUNDS,
  VICTORY_HAPPINESS,
  VICTORY_POPULATION,
} from './catalog';
import type {
  BuildingKind,
  CityMetrics,
  CityWorld,
  GridTile,
  InteriorTheme,
  PlacedBuilding,
  RoadMask,
  SerializedCity,
  TaxRate,
} from './types';

function createEmptyGrid(size: number): GridTile[][] {
  const grid: GridTile[][] = [];
  for (let x = 0; x < size; x++) {
    const col: GridTile[] = [];
    for (let z = 0; z < size; z++) {
      col.push({ x, z, buildingId: null, kind: null, isOrigin: false });
    }
    grid.push(col);
  }
  return grid;
}

export function createCityWorld(withStarterTown = true): CityWorld {
  const world: CityWorld = {
    size: GRID_SIZE,
    tiles: createEmptyGrid(GRID_SIZE),
    buildings: new Map(),
    nextBuildingId: 1,
    metrics: {
      funds: STARTING_FUNDS,
      population: 0,
      jobs: 0,
      powerSupply: 0,
      powerDemand: 0,
      happiness: 78,
      safety: 75,
      health: 75,
      dailyNet: 0,
      day: 1,
      timeOfDay: 0.38,
      demandRes: 45,
      demandCom: 35,
      demandCivic: 20,
      buildingCount: 0,
      taxRate: 'standard',
      activeVehicles: 0,
      activeCitizens: 0,
      weather: 'clear',
    },
    milestones: INITIAL_MILESTONES.map((m) => ({ ...m })),
    tickCount: 0,
    dayAccumulator: 0,
    endlessMode: false,
    outcome: null,
  };

  if (withStarterTown) {
    for (const item of STARTER_TOWN_LAYOUT) {
      placeBuildingFree(
        world,
        item.kind,
        item.x,
        item.z,
        item.rotation ?? 0,
        item.interiorLevel ?? 1,
        'classic',
      );
    }
    recomputeCityState(world);
  }

  return world;
}

export function isInBounds(world: CityWorld, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < world.size && z < world.size;
}

export function getFootprint(
  kind: BuildingKind,
  rotation: number,
): { width: number; depth: number } {
  const def = BUILDING_CATALOG[kind];
  const rotated = Math.abs(rotation) % 2 === 1;
  return {
    width: rotated ? def.depth : def.width,
    depth: rotated ? def.width : def.depth,
  };
}

export function canPlaceBuilding(
  world: CityWorld,
  kind: BuildingKind,
  x: number,
  z: number,
  rotation = 0,
  checkFunds = true,
): { ok: boolean; reason?: string } {
  const def = BUILDING_CATALOG[kind];
  if (checkFunds && world.metrics.funds < def.cost) {
    return { ok: false, reason: 'Insufficient funds' };
  }

  const { width, depth } = getFootprint(kind, rotation);
  for (let dx = 0; dx < width; dx++) {
    for (let dz = 0; dz < depth; dz++) {
      const tx = x + dx;
      const tz = z + dz;
      if (!isInBounds(world, tx, tz)) {
        return { ok: false, reason: 'Out of city limits' };
      }
      if (world.tiles[tx][tz].buildingId !== null) {
        return { ok: false, reason: 'Tile already occupied' };
      }
    }
  }
  return { ok: true };
}

function placeBuildingFree(
  world: CityWorld,
  kind: BuildingKind,
  x: number,
  z: number,
  rotation = 0,
  interiorLevel = 1,
  interiorTheme: InteriorTheme = 'classic',
): PlacedBuilding | null {
  const check = canPlaceBuilding(world, kind, x, z, rotation, false);
  if (!check.ok) return null;

  const { width, depth } = getFootprint(kind, rotation);
  const id = `b_${world.nextBuildingId++}`;
  const building: PlacedBuilding = {
    id,
    kind,
    x,
    z,
    width,
    depth,
    rotation: ((rotation % 4) + 4) % 4,
    powered: false,
    roadAccess: false,
    interiorLevel,
    interiorTheme,
    occupants: 0,
    dailyRevenue: 0,
    placedAtTick: world.tickCount,
  };

  world.buildings.set(id, building);
  for (let dx = 0; dx < width; dx++) {
    for (let dz = 0; dz < depth; dz++) {
      world.tiles[x + dx][z + dz] = {
        x: x + dx,
        z: z + dz,
        buildingId: id,
        kind,
        isOrigin: dx === 0 && dz === 0,
      };
    }
  }
  return building;
}

export function placeBuilding(
  world: CityWorld,
  kind: BuildingKind,
  x: number,
  z: number,
  rotation = 0,
): { ok: boolean; building?: PlacedBuilding; reason?: string; unlockedMilestone?: string } {
  const check = canPlaceBuilding(world, kind, x, z, rotation, true);
  if (!check.ok) return { ok: false, reason: check.reason };

  const def = BUILDING_CATALOG[kind];
  const building = placeBuildingFree(world, kind, x, z, rotation, 1, 'classic');
  if (!building) return { ok: false, reason: 'Placement failed' };

  world.metrics.funds -= def.cost;
  recomputeCityState(world);
  const unlockedMilestone = evaluateMilestones(world);
  return { ok: true, building, unlockedMilestone: unlockedMilestone ?? undefined };
}

export function bulldozeAt(
  world: CityWorld,
  x: number,
  z: number,
): { ok: boolean; removed?: PlacedBuilding } {
  if (!isInBounds(world, x, z)) return { ok: false };
  const tile = world.tiles[x][z];
  if (!tile.buildingId) return { ok: false };

  const building = world.buildings.get(tile.buildingId);
  if (!building) return { ok: false };

  for (let dx = 0; dx < building.width; dx++) {
    for (let dz = 0; dz < building.depth; dz++) {
      world.tiles[building.x + dx][building.z + dz] = {
        x: building.x + dx,
        z: building.z + dz,
        buildingId: null,
        kind: null,
        isOrigin: false,
      };
    }
  }
  world.buildings.delete(building.id);
  const refund = Math.round(BUILDING_CATALOG[building.kind].cost * 0.25);
  world.metrics.funds += refund;
  recomputeCityState(world);
  return { ok: true, removed: building };
}

export function getBuildingAt(
  world: CityWorld,
  x: number,
  z: number,
): PlacedBuilding | null {
  if (!isInBounds(world, x, z)) return null;
  const id = world.tiles[x][z].buildingId;
  if (!id) return null;
  return world.buildings.get(id) ?? null;
}

export function upgradeBuildingInterior(
  world: CityWorld,
  buildingId: string,
): { ok: boolean; reason?: string; building?: PlacedBuilding } {
  const building = world.buildings.get(buildingId);
  if (!building) return { ok: false, reason: 'Building not found' };
  if (building.interiorLevel >= 3) {
    return { ok: false, reason: 'Max interior level reached' };
  }
  const def = BUILDING_CATALOG[building.kind];
  const cost = building.interiorLevel === 1 ? def.upgradeCost : Math.round(def.upgradeCost * 1.35);
  if (world.metrics.funds < cost) {
    return { ok: false, reason: 'Insufficient funds' };
  }
  world.metrics.funds -= cost;
  building.interiorLevel += 1;
  recomputeCityState(world);
  evaluateMilestones(world);
  return { ok: true, building };
}

export function setBuildingInteriorTheme(
  world: CityWorld,
  buildingId: string,
  theme: InteriorTheme,
): boolean {
  const building = world.buildings.get(buildingId);
  if (!building) return false;
  building.interiorTheme = theme;
  return true;
}

export function setTaxRate(world: CityWorld, rate: TaxRate): void {
  world.metrics.taxRate = rate;
  recomputeCityState(world);
}

export function getRoadMask(world: CityWorld, x: number, z: number): RoadMask {
  const isRoad = (tx: number, tz: number) =>
    isInBounds(world, tx, tz) && world.tiles[tx][tz].kind === 'road';
  return {
    north: isRoad(x, z - 1),
    south: isRoad(x, z + 1),
    east: isRoad(x + 1, z),
    west: isRoad(x - 1, z),
  };
}

function hasAdjacentRoad(world: CityWorld, b: PlacedBuilding): boolean {
  for (let dx = 0; dx < b.width; dx++) {
    if (
      (isInBounds(world, b.x + dx, b.z - 1) && world.tiles[b.x + dx][b.z - 1].kind === 'road') ||
      (isInBounds(world, b.x + dx, b.z + b.depth) &&
        world.tiles[b.x + dx][b.z + b.depth].kind === 'road')
    ) {
      return true;
    }
  }
  for (let dz = 0; dz < b.depth; dz++) {
    if (
      (isInBounds(world, b.x - 1, b.z + dz) && world.tiles[b.x - 1][b.z + dz].kind === 'road') ||
      (isInBounds(world, b.x + b.width, b.z + dz) &&
        world.tiles[b.x + b.width][b.z + dz].kind === 'road')
    ) {
      return true;
    }
  }
  return false;
}

function computePowerNetwork(world: CityWorld): { supply: number; demand: number } {
  const visited = new Set<string>();
  const queue: Array<[number, number]> = [];
  let totalSupply = 0;
  let totalDemand = 0;

  for (const b of world.buildings.values()) {
    b.powered = false;
    const def = BUILDING_CATALOG[b.kind];
    if (def.powerDelta > 0) {
      const levelBonus = b.interiorLevel > 1 ? (b.interiorLevel - 1) * 20 : 0;
      totalSupply += def.powerDelta + levelBonus;
      b.powered = true;
      for (let dx = 0; dx < b.width; dx++) {
        for (let dz = 0; dz < b.depth; dz++) {
          const key = `${b.x + dx},${b.z + dz}`;
          visited.add(key);
          queue.push([b.x + dx, b.z + dz]);
        }
      }
    } else if (def.powerDelta < 0) {
      totalDemand += Math.abs(def.powerDelta);
    }
  }

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (queue.length > 0) {
    const [cx, cz] = queue.shift()!;
    for (const [dx, dz] of dirs) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!isInBounds(world, nx, nz)) continue;
      const key = `${nx},${nz}`;
      if (visited.has(key)) continue;
      const tile = world.tiles[nx][nz];
      if (!tile.buildingId) continue;
      visited.add(key);
      queue.push([nx, nz]);
      const b = world.buildings.get(tile.buildingId);
      if (b && totalSupply >= totalDemand) {
        b.powered = true;
      }
    }
  }

  if (totalSupply < totalDemand && totalSupply > 0) {
    let remaining = totalSupply;
    const poweredReachable = new Set<string>();
    const pQueue: Array<[number, number]> = [];
    for (const b of world.buildings.values()) {
      if (BUILDING_CATALOG[b.kind].powerDelta > 0) {
        pQueue.push([b.x, b.z]);
        poweredReachable.add(`${b.x},${b.z}`);
      }
    }
    while (pQueue.length > 0) {
      const [cx, cz] = pQueue.shift()!;
      for (const [dx, dz] of dirs) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (!isInBounds(world, nx, nz)) continue;
        const k = `${nx},${nz}`;
        if (poweredReachable.has(k)) continue;
        const tile = world.tiles[nx][nz];
        if (!tile.buildingId) continue;
        poweredReachable.add(k);
        pQueue.push([nx, nz]);
        const b = world.buildings.get(tile.buildingId);
        if (b && !b.powered) {
          const req = Math.abs(BUILDING_CATALOG[b.kind].powerDelta);
          if (req === 0 || remaining >= req) {
            b.powered = true;
            remaining -= req;
          }
        }
      }
    }
  }

  return { supply: totalSupply, demand: totalDemand };
}

export function recomputeCityState(world: CityWorld): void {
  const power = computePowerNetwork(world);

  let population = 0;
  let jobs = 0;
  let dailyRevenue = 0;
  let dailyUpkeep = 0;
  let happinessAccum = 62;
  let safetyAccum = 58;
  let healthAccum = 60;
  let parkCount = 0;
  let unpoweredCount = 0;
  let isolatedCount = 0;

  const taxIncomeMult =
    world.metrics.taxRate === 'low' ? 0.74 : world.metrics.taxRate === 'high' ? 1.32 : 1.0;
  const taxJoyDelta =
    world.metrics.taxRate === 'low' ? 8 : world.metrics.taxRate === 'high' ? -12 : 0;

  for (const b of world.buildings.values()) {
    const def = BUILDING_CATALOG[b.kind];
    b.roadAccess =
      b.kind === 'road' || b.kind === 'park' || b.kind === 'powerplant'
        ? true
        : hasAdjacentRoad(world, b);

    const active = b.powered && b.roadAccess;
    const levelMult = 1 + (b.interiorLevel - 1) * 0.45;

    if (b.kind === 'park') {
      parkCount += b.interiorLevel;
      happinessAccum += def.happinessBonus * (b.interiorLevel > 1 ? 1.6 : 1);
      healthAccum += (def.healthBonus ?? 0) * (b.interiorLevel > 1 ? 1.4 : 1);
    } else if (def.happinessBonus !== 0) {
      happinessAccum += def.happinessBonus * (b.interiorLevel > 1 ? 1.25 : 1);
    }

    if (def.safetyBonus && active) {
      safetyAccum += def.safetyBonus + (b.interiorLevel - 1) * 14;
    }
    if (def.healthBonus && b.kind !== 'park' && active) {
      healthAccum += def.healthBonus + (b.interiorLevel - 1) * 18;
    }

    if (def.residents > 0) {
      const cap = Math.round(def.residents * levelMult);
      b.occupants = active ? cap : Math.round(cap * 0.25);
      population += b.occupants;
    } else if (def.jobs > 0) {
      const cap = Math.round(def.jobs * levelMult);
      b.occupants = active ? cap : 0;
      jobs += b.occupants;
    } else {
      b.occupants = 0;
    }

    if (!b.powered && def.powerDelta < 0) unpoweredCount++;
    if (!b.roadAccess) isolatedCount++;

    const rev = active ? Math.round(def.baseIncome * levelMult * taxIncomeMult) : 0;
    b.dailyRevenue = rev - def.upkeep;
    dailyRevenue += rev;
    dailyUpkeep += def.upkeep;
  }

  const popScalePenalty = Math.floor(population / 35) * 4;
  const safety = Math.max(15, Math.min(100, Math.round(safetyAccum - popScalePenalty)));
  const health = Math.max(15, Math.min(100, Math.round(healthAccum - popScalePenalty)));

  const jobRatio = population > 0 ? Math.min(1.25, jobs / Math.max(1, population * 0.7)) : 0.6;
  const happinessPenalty = unpoweredCount * 6 + isolatedCount * 5;
  const employmentBonus = population > 0 ? Math.round((jobRatio - 0.5) * 14) : 0;
  const serviceBonus = Math.round((safety - 60) * 0.15 + (health - 60) * 0.15);
  const happiness = Math.max(
    10,
    Math.min(
      100,
      Math.round(happinessAccum + employmentBonus + serviceBonus + taxJoyDelta - happinessPenalty),
    ),
  );

  const demandRes = Math.max(-100, Math.min(100, Math.round((jobs - population * 0.85) * 2.5 + 20)));
  const demandCom = Math.max(-100, Math.min(100, Math.round((population * 0.85 - jobs) * 2.5 + 15)));
  const demandCivic = Math.max(
    -100,
    Math.min(
      100,
      Math.round((power.demand - power.supply) * 4 + (3 - Math.min(3, parkCount)) * 12),
    ),
  );

  const metrics: CityMetrics = {
    ...world.metrics,
    population,
    jobs,
    powerSupply: power.supply,
    powerDemand: power.demand,
    happiness,
    safety,
    health,
    dailyNet: dailyRevenue - dailyUpkeep,
    demandRes,
    demandCom,
    demandCivic,
    buildingCount: world.buildings.size,
  };

  world.metrics = metrics;
}

export function evaluateMilestones(world: CityWorld): string | null {
  let hasPolice = false;
  let hasHospital = false;
  let hasCinema = false;

  for (const b of world.buildings.values()) {
    if (b.kind === 'police' && b.powered) hasPolice = true;
    if (b.kind === 'hospital' && b.powered) hasHospital = true;
    if (b.kind === 'cinema' && b.powered) hasCinema = true;
  }

  let unlocked: string | null = null;
  for (const m of world.milestones) {
    if (m.completed) continue;
    if (m.id === 'civic_services' && hasPolice && hasHospital) {
      m.completed = true;
      world.metrics.funds += m.reward;
      unlocked = `${m.title} (+$${m.reward})`;
    } else if (m.id === 'culture_boom' && hasCinema && world.metrics.population >= 100) {
      m.completed = true;
      world.metrics.funds += m.reward;
      unlocked = `${m.title} (+$${m.reward})`;
    } else if (
      m.id === 'charter_goal' &&
      world.metrics.population >= VICTORY_POPULATION &&
      world.metrics.happiness >= VICTORY_HAPPINESS
    ) {
      m.completed = true;
      world.metrics.funds += m.reward;
      unlocked = `${m.title} (+$${m.reward})`;
    }
  }
  return unlocked;
}

export function stepCitySimulation(
  world: CityWorld,
  dt: number,
  advanceTime: boolean,
): { dayPassed: boolean; netCollected: number; unlockedMilestone: string | null } {
  world.tickCount += 1;
  if (!advanceTime) {
    return { dayPassed: false, netCollected: 0, unlockedMilestone: null };
  }

  world.dayAccumulator += dt;
  world.metrics.timeOfDay = (world.metrics.timeOfDay + dt / SECONDS_PER_DAY) % 1;

  if (world.dayAccumulator < SECONDS_PER_DAY) {
    return { dayPassed: false, netCollected: 0, unlockedMilestone: null };
  }

  world.dayAccumulator -= SECONDS_PER_DAY;
  world.metrics.day += 1;
  recomputeCityState(world);
  const unlockedMilestone = evaluateMilestones(world);
  const net = world.metrics.dailyNet;
  world.metrics.funds += net;

  if (world.metrics.funds < BANKRUPT_THRESHOLD) {
    world.outcome = 'bankrupt';
  } else if (
    !world.endlessMode &&
    world.metrics.population >= VICTORY_POPULATION &&
    world.metrics.happiness >= VICTORY_HAPPINESS
  ) {
    world.outcome = 'victory';
  }

  return { dayPassed: true, netCollected: net, unlockedMilestone };
}

export function getConnectedRoadTiles(world: CityWorld): Array<{ x: number; z: number }> {
  const roads: Array<{ x: number; z: number }> = [];
  for (let x = 0; x < world.size; x++) {
    for (let z = 0; z < world.size; z++) {
      if (world.tiles[x][z].kind === 'road') {
        roads.push({ x, z });
      }
    }
  }
  return roads;
}

export function exportCityState(world: CityWorld): SerializedCity {
  return {
    version: 1,
    funds: world.metrics.funds,
    day: world.metrics.day,
    timeOfDay: world.metrics.timeOfDay,
    taxRate: world.metrics.taxRate,
    endlessMode: world.endlessMode,
    completedMilestones: world.milestones.filter((m) => m.completed).map((m) => m.id),
    buildings: Array.from(world.buildings.values()).map((b) => ({
      kind: b.kind,
      x: b.x,
      z: b.z,
      rotation: b.rotation,
      interiorLevel: b.interiorLevel,
      interiorTheme: b.interiorTheme,
    })),
  };
}

export function importCityState(data: SerializedCity): CityWorld {
  const world = createCityWorld(false);
  world.metrics.funds = Number.isFinite(data.funds) ? data.funds : STARTING_FUNDS;
  world.metrics.day = Math.max(1, data.day || 1);
  world.metrics.timeOfDay = typeof data.timeOfDay === 'number' ? data.timeOfDay : 0.38;
  world.metrics.taxRate = data.taxRate ?? 'standard';
  world.endlessMode = Boolean(data.endlessMode);

  const doneSet = new Set(data.completedMilestones ?? []);
  for (const m of world.milestones) {
    m.completed = doneSet.has(m.id);
  }

  for (const item of data.buildings ?? []) {
    if (BUILDING_CATALOG[item.kind]) {
      placeBuildingFree(
        world,
        item.kind,
        item.x,
        item.z,
        item.rotation ?? 0,
        item.interiorLevel ?? 1,
        item.interiorTheme ?? 'classic',
      );
    }
  }
  recomputeCityState(world);
  return world;
}
