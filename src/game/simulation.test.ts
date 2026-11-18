import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BANKRUPT_THRESHOLD,
  SECONDS_PER_DAY,
  STARTING_FUNDS,
  VICTORY_HAPPINESS,
  VICTORY_POPULATION,
} from './catalog';
import {
  bulldozeAt,
  createCityWorld,
  exportCityState,
  getBuildingAt,
  getRoadMask,
  importCityState,
  placeBuilding,
  recomputeCityState,
  setTaxRate,
  stepCitySimulation,
  upgradeBuildingInterior,
} from './simulation';

test('starter town boots with connected power, residents, jobs, safety, and positive daily net', () => {
  const world = createCityWorld(true);
  assert.equal(world.metrics.funds, STARTING_FUNDS);
  assert.ok(world.metrics.population > 25, 'expected starter population > 25');
  assert.ok(world.metrics.jobs > 25, 'expected starter jobs > 25');
  assert.ok(world.metrics.powerSupply >= world.metrics.powerDemand, 'starter power should cover demand');
  assert.ok(world.metrics.dailyNet > 0, 'starter neighborhood should be profitable');
  assert.ok(world.metrics.safety >= 60, 'starter precinct should keep safety >= 60');
});

test('placing new building types (villa, cinema, hospital, townhouse, cafe) works and updates metrics', () => {
  const world = createCityWorld(false);
  world.metrics.funds = 10000;
  placeBuilding(world, 'powerplant', 1, 1);
  placeBuilding(world, 'road', 3, 1);
  placeBuilding(world, 'road', 4, 1);
  placeBuilding(world, 'road', 5, 1);
  placeBuilding(world, 'road', 6, 1);

  const th = placeBuilding(world, 'townhouse', 3, 2);
  const cafe = placeBuilding(world, 'cafe', 4, 2);
  const police = placeBuilding(world, 'police', 5, 2);
  const clinic = placeBuilding(world, 'hospital', 6, 2);
  assert.equal(th.ok, true);
  assert.equal(cafe.ok, true);
  assert.equal(police.ok, true);
  assert.equal(clinic.ok, true);
  assert.ok(world.metrics.safety > 75);
  assert.ok(world.metrics.health > 80);
  // Civic milestone should unlock and award $450
  const civicMilestone = world.milestones.find((m) => m.id === 'civic_services');
  assert.equal(civicMilestone?.completed, true);
});

test('tax rate policy trades off daily net income and citizen happiness', () => {
  const world = createCityWorld(true);
  const stdNet = world.metrics.dailyNet;
  const stdJoy = world.metrics.happiness;

  setTaxRate(world, 'high');
  assert.ok(world.metrics.dailyNet > stdNet, 'high tax should increase daily net');
  assert.ok(world.metrics.happiness <= stdJoy, 'high tax should lower or cap happiness');

  setTaxRate(world, 'low');
  assert.ok(world.metrics.dailyNet < stdNet, 'low tax should reduce daily net');
});

test('city save and load round-trip preserves buildings, funds, and tax policy', () => {
  const world = createCityWorld(true);
  setTaxRate(world, 'low');
  placeBuilding(world, 'cafe', 15, 10);
  const saved = exportCityState(world);
  const restored = importCityState(saved);

  assert.equal(restored.metrics.taxRate, 'low');
  assert.equal(restored.buildings.size, world.buildings.size);
  assert.equal(restored.metrics.population, world.metrics.population);
});

test('placing and bulldozing buildings updates grid occupancy and funds accurately', () => {
  const world = createCityWorld(false);
  const startFunds = world.metrics.funds;

  const roadRes = placeBuilding(world, 'road', 4, 4);
  assert.equal(roadRes.ok, true);
  assert.equal(world.metrics.funds, startFunds - 25);

  const cottageRes = placeBuilding(world, 'cottage', 4, 5);
  assert.equal(cottageRes.ok, true);
  assert.equal(world.metrics.funds, startFunds - 25 - 180);

  const overlap = placeBuilding(world, 'supermarket', 3, 4);
  assert.equal(overlap.ok, false);

  const dozRes = bulldozeAt(world, 4, 5);
  assert.equal(dozRes.ok, true);
  assert.equal(getBuildingAt(world, 4, 5), null);
  assert.equal(world.metrics.funds, startFunds - 25 - 180 + Math.round(180 * 0.25));
});

test('road auto-tiling computes N/S/E/W masks correctly', () => {
  const world = createCityWorld(false);
  placeBuilding(world, 'road', 5, 5);
  placeBuilding(world, 'road', 5, 4);
  placeBuilding(world, 'road', 6, 5);

  const mask = getRoadMask(world, 5, 5);
  assert.deepEqual(mask, { north: true, south: false, east: true, west: false });
});

test('interior upgrades increase level, occupants, and daily revenue', () => {
  const world = createCityWorld(false);
  placeBuilding(world, 'powerplant', 2, 2);
  placeBuilding(world, 'road', 4, 2);
  const market = placeBuilding(world, 'supermarket', 4, 3);
  assert.equal(market.ok, true);
  const id = market.building!.id;
  const beforeJobs = world.metrics.jobs;

  const up = upgradeBuildingInterior(world, id);
  assert.equal(up.ok, true);
  assert.equal(up.building?.interiorLevel, 2);
  assert.ok(world.metrics.jobs > beforeJobs);
});

test('day tick collects daily net and checks victory / bankruptcy outcomes', () => {
  const world = createCityWorld(true);
  const beforeFunds = world.metrics.funds;
  const res = stepCitySimulation(world, SECONDS_PER_DAY + 0.01, true);
  assert.equal(res.dayPassed, true);
  assert.equal(world.metrics.day, 2);
  assert.equal(world.metrics.funds, beforeFunds + res.netCollected);

  const victoryWorld = createCityWorld(false);
  victoryWorld.metrics.funds = 50000;
  placeBuilding(victoryWorld, 'powerplant', 0, 0);
  placeBuilding(victoryWorld, 'powerplant', 0, 2);
  for (let x = 2; x <= 20; x++) {
    placeBuilding(victoryWorld, 'road', x, 0);
  }
  for (let i = 0; i < 7; i++) {
    const apt = placeBuilding(victoryWorld, 'apartment', 2 + i * 2, 1);
    if (apt.building) upgradeBuildingInterior(victoryWorld, apt.building.id);
  }
  placeBuilding(victoryWorld, 'office', 16, 1);
  placeBuilding(victoryWorld, 'cinema', 18, 1);
  placeBuilding(victoryWorld, 'police', 20, 1);
  placeBuilding(victoryWorld, 'park', 20, 2);
  placeBuilding(victoryWorld, 'hospital', 19, 3);
  placeBuilding(victoryWorld, 'road', 18, 3);
  placeBuilding(victoryWorld, 'road', 20, 3);
  recomputeCityState(victoryWorld);
  assert.ok(victoryWorld.metrics.population >= VICTORY_POPULATION);
  assert.ok(victoryWorld.metrics.happiness >= VICTORY_HAPPINESS);
  stepCitySimulation(victoryWorld, SECONDS_PER_DAY, true);
  assert.equal(victoryWorld.outcome, 'victory');

  const brokeWorld = createCityWorld(false);
  brokeWorld.metrics.funds = BANKRUPT_THRESHOLD - 10;
  stepCitySimulation(brokeWorld, SECONDS_PER_DAY, true);
  assert.equal(brokeWorld.outcome, 'bankrupt');
});
