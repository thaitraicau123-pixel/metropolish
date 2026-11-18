export type GameScreenState = 'title' | 'playing' | 'paused' | 'gameover';

export type GameOutcome = 'victory' | 'bankrupt' | null;

export type BuildingKind =
  | 'road'
  | 'park'
  | 'cottage'
  | 'townhouse'
  | 'apartment'
  | 'villa'
  | 'diner'
  | 'cafe'
  | 'supermarket'
  | 'cinema'
  | 'office'
  | 'powerplant'
  | 'police'
  | 'hospital';

export type ToolId = 'inspect' | BuildingKind | 'bulldoze';

export type BuildingCategory = 'infra' | 'residential' | 'commercial' | 'civic';

export type InteriorTheme = 'classic' | 'warm' | 'metro';

export type TimePreset = 'auto' | 'day' | 'dusk' | 'night';

export type WeatherKind = 'clear' | 'rain' | 'snow';

export type WeatherPreset = 'auto' | WeatherKind;

export type TaxRate = 'low' | 'standard' | 'high';

export type VehicleKind = 'sedan' | 'taxi' | 'van' | 'police' | 'ambulance';

export interface BuildingDefinition {
  kind: BuildingKind;
  name: string;
  shortName: string;
  shortDesc: string;
  category: BuildingCategory;
  width: number;
  depth: number;
  cost: number;
  upkeep: number;
  baseIncome: number;
  residents: number;
  jobs: number;
  powerDelta: number; // positive = generates, negative = consumes
  happinessBonus: number;
  safetyBonus?: number;
  healthBonus?: number;
  hotkey: string;
  accentHex: string;
  upgradeName: string;
  upgradeCost: number;
  upgradeDesc: string;
}

export interface PlacedBuilding {
  id: string;
  kind: BuildingKind;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number; // 0, 1, 2, 3 (multiples of 90 deg)
  powered: boolean;
  roadAccess: boolean;
  interiorLevel: number; // 1 = standard, 2 = upgraded, 3 = flagship
  interiorTheme: InteriorTheme;
  occupants: number;
  dailyRevenue: number;
  placedAtTick: number;
}

export interface GridTile {
  x: number;
  z: number;
  buildingId: string | null;
  kind: BuildingKind | null;
  isOrigin: boolean;
}

export interface RoadMask {
  north: boolean;
  south: boolean;
  east: boolean;
  west: boolean;
}

export type SignalPhase = 'ns_green' | 'ns_clear' | 'ew_green' | 'ew_clear';

export interface VehicleAgent {
  id: string;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  dirX: number;
  dirZ: number;
  progress: number;
  maxSpeed: number;
  currentSpeed: number;
  colorHex: number;
  kind: VehicleKind;
  worldX: number;
  worldZ: number;
  yaw: number;
  stopped: boolean;
  waitTime: number;
}

export interface CitizenAgent {
  id: string;
  // Current sidewalk corner node: tile (gx, gz) and corner sign (sx, sz) in {-1, +1}
  gx: number;
  gz: number;
  sx: number;
  sz: number;
  // Next target sidewalk corner node
  nextGx: number;
  nextGz: number;
  nextSx: number;
  nextSz: number;
  // Previous travel direction to prefer forward continuity
  prevDirX: number;
  prevDirZ: number;
  // Smooth continuous world coordinates
  worldX: number;
  worldZ: number;
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  segProgress: number;
  segLength: number;
  crossingRoad: boolean;
  maxSpeed: number;
  currentSpeed: number;
  shirtHex: number;
  pantsHex: number;
  lateralAvoid: number;
  walkPhase: number;
  yaw: number;
  waiting: boolean;
}

export type IndoorStationKind =
  | 'bed'
  | 'sofa'
  | 'dining'
  | 'kitchen'
  | 'bath'
  | 'desk'
  | 'counter'
  | 'seat'
  | 'patio';

export interface IndoorStation {
  id: string;
  kind: IndoorStationKind;
  label: string;
  x: number;
  z: number;
  facingYaw: number;
  doorX?: number;
  doorZ?: number;
}

export type IndoorPose = 'walking' | 'sitting' | 'sleeping' | 'working' | 'standing';

export interface IndoorActor {
  id: string;
  buildingId: string;
  shirtHex: number;
  pantsHex: number;
  x: number;
  z: number;
  yaw: number;
  stationId: string;
  activityLabel: string;
  pose: IndoorPose;
  waypoints: Array<{ x: number; z: number }>;
  timer: number;
  walkPhase: number;
  speed: number;
}

export interface CityMilestone {
  id: string;
  title: string;
  reward: number;
  completed: boolean;
}

export interface CityMetrics {
  funds: number;
  population: number;
  jobs: number;
  powerSupply: number;
  powerDemand: number;
  happiness: number; // 0..100
  safety: number; // 0..100
  health: number; // 0..100
  dailyNet: number;
  day: number;
  timeOfDay: number; // 0..1
  demandRes: number; // -100..100
  demandCom: number; // -100..100
  demandCivic: number; // -100..100
  buildingCount: number;
  taxRate: TaxRate;
  activeVehicles: number;
  activeCitizens: number;
  weather: WeatherKind;
}

export interface HudSnapshot {
  screen: GameScreenState;
  outcome: GameOutcome;
  metrics: CityMetrics;
  activeTool: ToolId;
  cutaway: boolean;
  simSpeed: 0 | 1 | 2 | 4;
  timePreset: TimePreset;
  weatherPreset: WeatherPreset;
  selectedBuilding: PlacedBuilding | null;
  selectedIndoorSummary: string[];
  milestones: CityMilestone[];
  lastEventBanner: string | null;
  endlessMode: boolean;
  muted: boolean;
  hasSavedCity: boolean;
}

export interface SerializedBuilding {
  kind: BuildingKind;
  x: number;
  z: number;
  rotation: number;
  interiorLevel: number;
  interiorTheme: InteriorTheme;
}

export interface SerializedCity {
  version: 1;
  funds: number;
  day: number;
  timeOfDay: number;
  taxRate: TaxRate;
  endlessMode: boolean;
  completedMilestones: string[];
  buildings: SerializedBuilding[];
}

export interface CityWorld {
  size: number;
  tiles: GridTile[][];
  buildings: Map<string, PlacedBuilding>;
  nextBuildingId: number;
  metrics: CityMetrics;
  milestones: CityMilestone[];
  tickCount: number;
  dayAccumulator: number;
  endlessMode: boolean;
  outcome: GameOutcome;
}
