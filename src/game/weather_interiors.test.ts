import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIndoorActorsForBuilding,
  getInteriorStations,
  stepIndoorActors,
} from './interiors';
import { createCityWorld, placeBuilding } from './simulation';
import { resolveTargetWeather, stepWeatherAmounts, type WeatherAmounts } from './weather';

test('weather transitions smoothly between clear, rain, and snow presets', () => {
  assert.equal(resolveTargetWeather('rain', 1, 0.4), 'rain');
  assert.equal(resolveTargetWeather('snow', 1, 0.4), 'snow');
  assert.equal(resolveTargetWeather('clear', 4, 0.4), 'clear');

  let state: WeatherAmounts = { weather: 'clear', rain: 0, snow: 0 };
  for (let i = 0; i < 40; i++) {
    state = stepWeatherAmounts(state, 'rain', 0.1);
  }
  assert.equal(state.weather, 'rain');
  assert.ok(state.rain > 0.85, `Expected rain intensity to ramp up, got ${state.rain}`);
  assert.ok(state.snow < 0.05, 'Snow should remain 0 during rain');

  for (let i = 0; i < 60; i++) {
    state = stepWeatherAmounts(state, 'snow', 0.1);
  }
  assert.equal(state.weather, 'snow');
  assert.ok(state.snow > 0.85, `Expected snow intensity to ramp up, got ${state.snow}`);
  assert.ok(state.rain < 0.05, 'Rain should fade out when snowing');
});

test('residential interiors include full room amenities (bed, bath, living, kitchen)', () => {
  for (const kind of ['cottage', 'townhouse', 'apartment', 'villa'] as const) {
    const stations = getInteriorStations(kind, 2);
    const kinds = new Set(stations.map((s) => s.kind));
    assert.ok(kinds.has('bed'), `${kind} should include a bed`);
    assert.ok(kinds.has('sofa'), `${kind} should include a living sofa`);
    assert.ok(kinds.has('bath'), `${kind} should include a bathroom`);
    assert.ok(kinds.has('kitchen'), `${kind} should include a kitchen`);
  }
});

test('indoor actors only spawn when powered and walk through doorways to use furniture', () => {
  const world = createCityWorld(false);
  placeBuilding(world, 'road', 5, 8);
  placeBuilding(world, 'road', 6, 8);
  const homeRes = placeBuilding(world, 'cottage', 6, 7);
  assert.equal(homeRes.ok, true);
  assert.ok(homeRes.building);

  // Without power plant, building is unpowered -> 0 indoor actors
  assert.equal(createIndoorActorsForBuilding(homeRes.building).length, 0);

  // Add power plant adjacent to road (occupies 4..5, 6..7)
  const plantRes = placeBuilding(world, 'powerplant', 4, 6);
  assert.equal(plantRes.ok, true);
  assert.equal(homeRes.building.powered, true);

  const actors = createIndoorActorsForBuilding(homeRes.building);
  assert.ok(actors.length >= 1, 'Powered cottage should spawn indoor residents');

  const stations = getInteriorStations('cottage', homeRes.building.interiorLevel);
  const startStation = actors[0].stationId;
  actors[0].timer = 0.05; // Trigger immediate room transition

  let sawWalking = false;
  for (let step = 0; step < 45; step++) {
    stepIndoorActors(actors, stations, 0.08, () => 0.1);
    if (actors[0].pose === 'walking') sawWalking = true;
  }

  assert.equal(sawWalking, true, 'Indoor resident should walk across rooms');
  assert.notEqual(actors[0].stationId, startStation, 'Indoor resident should switch to another station');
  assert.notEqual(actors[0].pose, 'walking', 'Indoor resident should settle into furniture pose after arriving');
});
