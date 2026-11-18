import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { retroAudio } from './audio';
import { BUILDING_CATALOG, GRID_SIZE, TILE_WORLD_SIZE } from './catalog';
import {
  createIndoorActorsForBuilding,
  getInteriorStations,
  stepIndoorActors,
} from './interiors';
import {
  type BuiltBuildingVisual,
  type BuiltCitizenVisual,
  type BuiltVehicleVisual,
  CityModelFactory,
} from './models';
import {
  bulldozeAt,
  canPlaceBuilding,
  createCityWorld,
  exportCityState,
  getBuildingAt,
  getConnectedRoadTiles,
  getFootprint,
  getRoadMask,
  importCityState,
  isInBounds,
  placeBuilding,
  setBuildingInteriorTheme,
  setTaxRate,
  stepCitySimulation,
  upgradeBuildingInterior,
} from './simulation';
import { createCityTextures, type CityTextureSet } from './textures';
import {
  computeSignalPhase,
  computeVehicleWorldPos,
  createInitialCitizenOnCorner,
  pickNextRoadTile,
  stepCitizensPhysics,
  stepVehiclesPhysics,
} from './traffic';
import type {
  BuildingKind,
  CityWorld,
  CitizenAgent,
  GameScreenState,
  HudSnapshot,
  IndoorActor,
  InteriorTheme,
  PlacedBuilding,
  SerializedCity,
  TaxRate,
  TimePreset,
  ToolId,
  VehicleAgent,
  VehicleKind,
  WeatherPreset,
} from './types';
import {
  resolveTargetWeather,
  stepWeatherAmounts,
  type WeatherAmounts,
} from './weather';

const SAVE_STORAGE_KEY = 'metropolis1998_save_v1';

const _vec3 = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _colorA = new THREE.Color();
const _colorB = new THREE.Color();

interface ParticleSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
}

const PARTICLE_POOL_SIZE = 48;
const RAIN_COUNT = 460;
const SNOW_COUNT = 420;

export class CityEngine {
  private container: HTMLElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private textures!: CityTextureSet;
  private factory!: CityModelFactory;
  private isSoftwareGl = false;

  private sunLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private nightLights: THREE.PointLight[] = [];
  private outerGroundMat!: THREE.MeshStandardMaterial;
  private playGroundMat!: THREE.MeshStandardMaterial;
  private snowOverlayMesh!: THREE.Mesh;
  private snowOverlayMat!: THREE.MeshStandardMaterial;
  private perimeterCanopies!: THREE.InstancedMesh;
  private perimeterTreeCount = 88;
  private gridHelper!: THREE.GridHelper;
  private ghostMesh!: THREE.Mesh;
  private ghostMat!: THREE.MeshBasicMaterial;
  private selectionRing!: THREE.Mesh;

  private particleMesh!: THREE.InstancedMesh;
  private particles: ParticleSlot[] = [];
  private particleCursor = 0;

  private rainMesh!: THREE.InstancedMesh;
  private rainData = new Float32Array(RAIN_COUNT * 3);
  private snowMesh!: THREE.InstancedMesh;
  private snowData = new Float32Array(SNOW_COUNT * 4);

  private world: CityWorld;
  private buildingVisuals: Map<string, BuiltBuildingVisual> = new Map();
  private indoorActors: Map<string, Array<{ state: IndoorActor; visual: BuiltCitizenVisual }>> = new Map();
  private vehicles: Array<{ state: VehicleAgent; visual: BuiltVehicleVisual }> = [];
  private citizens: Array<{ state: CitizenAgent; visual: BuiltCitizenVisual }> = [];

  private screen: GameScreenState = 'title';
  private activeTool: ToolId = 'inspect';
  private placementRotation = 0;
  private cutaway = false;
  private simSpeed: 0 | 1 | 2 | 4 = 1;
  private timePreset: TimePreset = 'auto';
  private weatherPreset: WeatherPreset = 'auto';
  private weatherAmounts: WeatherAmounts = { weather: 'clear', rain: 0, snow: 0 };
  private lastSnowVisualLevel = -1;
  private simTimeSec = 0;
  private selectedBuildingId: string | null = null;
  private lastEventBanner: string | null = null;
  private eventBannerTimer = 0;

  // Camera Rig (Isometric Orthographic)
  private camTarget = new THREE.Vector3(0, 0, 0);
  private camTargetGoal = new THREE.Vector3(0, 0, 0);
  private camYawIndex = 0; // 0..3 -> 45, 135, 225, 315 deg
  private camYawRad = Math.PI / 4;
  private camZoom = 1.05;
  private camZoomGoal = 1.05;
  private frustumHeight = 26;

  // Input state
  private keysHeld = new Set<string>();
  private pointerNdc = new THREE.Vector2(99, 99);
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hoverTile: { x: number; z: number } | null = null;
  private isPanDragging = false;
  private isPaintDragging = false;
  private pointerDownPos = { x: 0, y: 0 };
  private panLastPos = { x: 0, y: 0 };
  private dragMovedPx = 0;
  private lastPaintedTileKey = '';

  // Loop & callbacks
  private frameId = 0;
  private lastTimestamp = 0;
  private lastHudPush = 0;
  private disposed = false;
  private onHudUpdate: (snapshot: HudSnapshot) => void;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    container: HTMLElement,
    onHudUpdate: (snapshot: HudSnapshot) => void,
    autostart = false,
  ) {
    this.container = container;
    this.onHudUpdate = onHudUpdate;
    this.world = createCityWorld(true);
    if (autostart) {
      this.screen = 'playing';
      document.body.dataset.state = 'playing';
    } else {
      document.body.dataset.state = 'title';
    }

    this.initRendererAndScene();
    this.rebuildAllVisuals();
    this.spawnInitialAgents();
    this.bindEvents();
    this.pushHud(true);

    this.lastTimestamp = performance.now();
    this.scheduleNextFrame();
  }

  private detectSoftwareGl(): boolean {
    try {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    } catch {
      return true;
    }
  }

  private initRendererAndScene(): void {
    this.isSoftwareGl = this.detectSoftwareGl();
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9bc4d9);
    this.scene.fog = new THREE.FogExp2(0x9bc4d9, 0.0085);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const aspect = width / height;
    this.camera = new THREE.OrthographicCamera(
      (-this.frustumHeight * aspect) / 2,
      (this.frustumHeight * aspect) / 2,
      this.frustumHeight / 2,
      -this.frustumHeight / 2,
      0.1,
      240,
    );
    this.updateCameraTransform();

    // Lighting rig: warm key sun + cool hemisphere fill
    this.hemiLight = new THREE.HemisphereLight(0xbbe0ff, 0x3b4f34, 0.75);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff1d6, 1.85);
    this.sunLight.position.set(28, 38, 20);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    const d = 28;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.camera.near = 5;
    this.sunLight.shadow.camera.far = 95;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);

    // 4 warm city-corner PointLights that ignite at dusk/night
    const nightAnchors: Array<[number, number]> = [
      [-3, -2],
      [3, -2],
      [-2, 4],
      [8, 0],
    ];
    nightAnchors.forEach(([nx, nz]) => {
      const pl = new THREE.PointLight(0xffb85c, 0, 14, 1.6);
      pl.position.set(nx, 2.6, nz);
      this.scene.add(pl);
      this.nightLights.push(pl);
    });

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createCityTextures(maxAniso);
    this.factory = new CityModelFactory(this.textures);

    this.buildTerrainAndCountryside();
    this.buildHelpersAndParticles();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }
  }

  private buildTerrainAndCountryside(): void {
    const playSpan = GRID_SIZE * TILE_WORLD_SIZE; // 44m

    // Extended surrounding countryside ground so there is never an abrupt void
    const outerGeo = new THREE.PlaneGeometry(240, 240);
    this.outerGroundMat = new THREE.MeshStandardMaterial({
      color: 0x447d3d,
      roughness: 0.96,
      metalness: 0.0,
    });
    const outerGround = new THREE.Mesh(outerGeo, this.outerGroundMat);
    outerGround.rotation.x = -Math.PI / 2;
    outerGround.position.y = -0.02;
    outerGround.receiveShadow = true;
    this.scene.add(outerGround);

    // Playable city parcel terrain with crisp retro checkerboard grass texture
    const playGeo = new THREE.PlaneGeometry(playSpan, playSpan);
    this.playGroundMat = new THREE.MeshStandardMaterial({
      map: this.textures.grass,
      bumpMap: this.textures.grassBump,
      bumpScale: 0.04,
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.0,
    });
    const playGround = new THREE.Mesh(playGeo, this.playGroundMat);
    playGround.rotation.x = -Math.PI / 2;
    playGround.position.y = 0;
    playGround.receiveShadow = true;
    this.scene.add(playGround);

    // Winter snow ground overlay that blends seamlessly over playable grass during snowfall
    this.snowOverlayMat = new THREE.MeshStandardMaterial({
      map: this.textures.snowGrass,
      color: 0xffffff,
      roughness: 0.84,
      metalness: 0.0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.snowOverlayMesh = new THREE.Mesh(playGeo, this.snowOverlayMat);
    this.snowOverlayMesh.rotation.x = -Math.PI / 2;
    this.snowOverlayMesh.position.y = 0.002;
    this.snowOverlayMesh.receiveShadow = true;
    this.snowOverlayMesh.visible = false;
    this.scene.add(this.snowOverlayMesh);

    // Subtle city boundary stone curb
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x5c6458, roughness: 0.9 });
    const half = playSpan / 2;
    const borderBars: Array<[number, number, number, number]> = [
      [playSpan + 0.4, 0.2, 0, -half - 0.1],
      [playSpan + 0.4, 0.2, 0, half + 0.1],
      [0.2, playSpan + 0.4, -half - 0.1, 0],
      [0.2, playSpan + 0.4, half + 0.1, 0],
    ];
    borderBars.forEach(([w, d, bx, bz]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), curbMat);
      m.position.set(bx, 0.02, bz);
      m.receiveShadow = true;
      this.scene.add(m);
    });

    // Natural perimeter tree groves outside the playable grid (InstancedMesh)
    const treeCount = 88;
    const trunkGeo = new THREE.CylinderGeometry(0.11, 0.16, 0.7, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x674732, roughness: 0.92 });
    const canopyGeo = new THREE.ConeGeometry(0.55, 1.35, 6);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x3f7b3c, roughness: 0.85 });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
    this.perimeterCanopies = canopies;
    canopies.castShadow = !this.isSoftwareGl;

    for (let i = 0; i < treeCount; i++) {
      const angle = (i / treeCount) * Math.PI * 2 + (i % 3) * 0.04;
      const ringDist = half + 3.5 + ((i * 19) % 18);
      const tx = Math.cos(angle) * ringDist;
      const tz = Math.sin(angle) * ringDist;
      const sc = 0.85 + ((i * 7) % 10) * 0.035;

      _scale.set(sc, sc, sc);
      _quat.setFromAxisAngle(_vec3.set(0, 1, 0), i * 1.1);

      _vec3.set(tx, 0.35 * sc, tz);
      _mat4.compose(_vec3, _quat, _scale);
      trunks.setMatrixAt(i, _mat4);

      _vec3.set(tx, 1.12 * sc, tz);
      _mat4.compose(_vec3, _quat, _scale);
      canopies.setMatrixAt(i, _mat4);

      _colorA.setHex(i % 2 === 0 ? 0x3b7838 : 0x4b8d43);
      canopies.setColorAt(i, _colorA);
    }
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
    trunks.computeBoundingSphere();
    canopies.computeBoundingSphere();
    this.scene.add(trunks);
    this.scene.add(canopies);
  }

  private buildHelpersAndParticles(): void {
    const playSpan = GRID_SIZE * TILE_WORLD_SIZE;
    this.gridHelper = new THREE.GridHelper(playSpan, GRID_SIZE, 0x223026, 0x223026);
    this.gridHelper.position.y = 0.012;
    const gridMat = this.gridHelper.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.16;
    gridMat.polygonOffset = true;
    gridMat.polygonOffsetFactor = -1;
    gridMat.polygonOffsetUnits = -1;
    this.gridHelper.visible = false;
    this.scene.add(this.gridHelper);

    // Placement hover ghost footprint
    this.ghostMat = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.ghostMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.25, 1), this.ghostMat);
    this.ghostMesh.visible = false;
    this.ghostMesh.renderOrder = 5;
    this.scene.add(this.ghostMesh);

    // Selection highlight border
    const selGeo = new THREE.BoxGeometry(1, 0.14, 1);
    const selMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      wireframe: true,
    });
    this.selectionRing = new THREE.Mesh(selGeo, selMat);
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    // Pooled instanced particle ring buffer
    const pGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    const pMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    this.particleMesh = new THREE.InstancedMesh(pGeo, pMat, PARTICLE_POOL_SIZE);
    this.particleMesh.frustumCulled = false;
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 0,
        color: 0xffffff,
      });
      _scale.set(0, 0, 0);
      _vec3.set(0, -50, 0);
      _quat.identity();
      _mat4.compose(_vec3, _quat, _scale);
      this.particleMesh.setMatrixAt(i, _mat4);
      this.particleMesh.setColorAt(i, _colorA.setHex(0xffffff));
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.particleMesh);

    // Pooled Rain & Snow InstancedMeshes (zero-GC precipitation)
    const rainGeo = new THREE.BoxGeometry(0.068, 1.15, 0.068);
    const rainMat = new THREE.MeshBasicMaterial({
      color: 0xc2dcff,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
    });
    this.rainMesh = new THREE.InstancedMesh(rainGeo, rainMat, RAIN_COUNT);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    for (let i = 0; i < RAIN_COUNT; i++) {
      this.rainData[i * 3] = (Math.random() - 0.5) * 34;
      this.rainData[i * 3 + 1] = Math.random() * 14;
      this.rainData[i * 3 + 2] = (Math.random() - 0.5) * 34;
    }
    this.scene.add(this.rainMesh);

    const snowGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const snowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
    });
    this.snowMesh = new THREE.InstancedMesh(snowGeo, snowMat, SNOW_COUNT);
    this.snowMesh.frustumCulled = false;
    this.snowMesh.visible = false;
    for (let i = 0; i < SNOW_COUNT; i++) {
      this.snowData[i * 4] = (Math.random() - 0.5) * 34;
      this.snowData[i * 4 + 1] = Math.random() * 14;
      this.snowData[i * 4 + 2] = (Math.random() - 0.5) * 34;
      this.snowData[i * 4 + 3] = Math.random() * Math.PI * 2;
    }
    this.scene.add(this.snowMesh);
  }

  private gridToWorld(gx: number, gz: number, width = 1, depth = 1): { x: number; z: number } {
    const halfSpan = (GRID_SIZE * TILE_WORLD_SIZE) / 2;
    return {
      x: -halfSpan + (gx + width / 2) * TILE_WORLD_SIZE,
      z: -halfSpan + (gz + depth / 2) * TILE_WORLD_SIZE,
    };
  }

  private worldToGrid(wx: number, wz: number): { x: number; z: number } | null {
    const halfSpan = (GRID_SIZE * TILE_WORLD_SIZE) / 2;
    const gx = Math.floor((wx + halfSpan) / TILE_WORLD_SIZE);
    const gz = Math.floor((wz + halfSpan) / TILE_WORLD_SIZE);
    if (!isInBounds(this.world, gx, gz)) return null;
    return { x: gx, z: gz };
  }

  private applyIndoorActorPose(
    s: IndoorActor,
    visual: BuiltCitizenVisual,
  ): void {
    if (s.pose === 'sleeping') {
      visual.root.position.set(s.x, 0.25, s.z);
      visual.root.rotation.set(-Math.PI / 2, s.yaw, 0);
      visual.leftLeg.rotation.x = 0;
      visual.rightLeg.rotation.x = 0;
      visual.leftArm.rotation.x = 0;
      visual.rightArm.rotation.x = 0;
    } else if (s.pose === 'sitting') {
      visual.root.position.set(s.x, 0.03, s.z);
      visual.root.rotation.set(0, s.yaw, 0);
      visual.leftLeg.rotation.x = -1.35;
      visual.rightLeg.rotation.x = -1.35;
      visual.leftArm.rotation.x = -0.3;
      visual.rightArm.rotation.x = -0.3;
    } else if (s.pose === 'working') {
      visual.root.position.set(s.x, 0.08, s.z);
      visual.root.rotation.set(0, s.yaw, 0);
      visual.leftLeg.rotation.x = 0;
      visual.rightLeg.rotation.x = 0;
      const swing = Math.sin(s.walkPhase) * 0.28;
      visual.leftArm.rotation.x = -0.55 + swing;
      visual.rightArm.rotation.x = -0.55 - swing;
    } else if (s.pose === 'walking') {
      visual.root.position.set(s.x, 0.08, s.z);
      visual.root.rotation.set(0, s.yaw, 0);
      const stride = Math.sin(s.walkPhase) * 0.45;
      visual.leftLeg.rotation.x = stride;
      visual.rightLeg.rotation.x = -stride;
      visual.leftArm.rotation.x = -stride * 0.7;
      visual.rightArm.rotation.x = stride * 0.7;
    } else {
      visual.root.position.set(s.x, 0.08, s.z);
      visual.root.rotation.set(0, s.yaw, 0);
      visual.leftLeg.rotation.x = 0;
      visual.rightLeg.rotation.x = 0;
      visual.leftArm.rotation.x = 0;
      visual.rightArm.rotation.x = 0;
    }
  }

  private syncIndoorActorsForAllBuildings(): void {
    for (const b of this.world.buildings.values()) {
      const vis = this.buildingVisuals.get(b.id);
      if (!vis) continue;
      const shouldHave = b.powered && b.kind !== 'road' && b.kind !== 'park';
      const current = this.indoorActors.get(b.id);
      if (shouldHave && !current) {
        const actors = createIndoorActorsForBuilding(b);
        if (actors.length > 0) {
          const list = actors.map((state) => {
            const visual = this.factory.buildCitizen(state.shirtHex, state.pantsHex);
            this.applyIndoorActorPose(state, visual);
            vis.interiorGroup.add(visual.root);
            return { state, visual };
          });
          this.indoorActors.set(b.id, list);
        }
      } else if (!shouldHave && current) {
        current.forEach((item) => vis.interiorGroup.remove(item.visual.root));
        this.indoorActors.delete(b.id);
      }
    }
  }

  private rebuildAllVisuals(): void {
    for (const vis of this.buildingVisuals.values()) {
      this.scene.remove(vis.root);
    }
    this.buildingVisuals.clear();
    this.indoorActors.clear();

    for (const b of this.world.buildings.values()) {
      this.createVisualForBuilding(b, true);
    }
    this.lastSnowVisualLevel = -1;
  }

  private createVisualForBuilding(b: PlacedBuilding, instant = false): void {
    const existing = this.buildingVisuals.get(b.id);
    if (existing) {
      this.scene.remove(existing.root);
      this.buildingVisuals.delete(b.id);
    }
    this.indoorActors.delete(b.id);

    let vis: BuiltBuildingVisual;
    if (b.kind === 'road') {
      const mask = getRoadMask(this.world, b.x, b.z);
      vis = this.factory.buildRoadTile(mask, b.interiorLevel > 1);
    } else {
      vis = this.factory.buildBuilding(b);
    }

    const pos = this.gridToWorld(b.x, b.z, b.width, b.depth);
    vis.root.position.set(pos.x, 0, pos.z);
    vis.popProgress = instant ? 1 : 0;
    if (!instant) {
      vis.root.scale.set(1, 0.15, 1);
    }

    const actors = createIndoorActorsForBuilding(b);
    if (actors.length > 0) {
      const list = actors.map((state) => {
        const visual = this.factory.buildCitizen(state.shirtHex, state.pantsHex);
        this.applyIndoorActorPose(state, visual);
        vis.interiorGroup.add(visual.root);
        return { state, visual };
      });
      this.indoorActors.set(b.id, list);
    }

    this.scene.add(vis.root);
    this.buildingVisuals.set(b.id, vis);
    this.lastSnowVisualLevel = -1;
  }

  private refreshNeighborRoads(gx: number, gz: number): void {
    const offsets = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dz] of offsets) {
      const nx = gx + dx;
      const nz = gz + dz;
      const b = getBuildingAt(this.world, nx, nz);
      if (b && b.kind === 'road') {
        this.createVisualForBuilding(b, true);
      }
    }
  }

  private spawnBurst(wx: number, wz: number, count: number, colorHex: number): void {
    for (let i = 0; i < count; i++) {
      const slot = this.particles[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL_SIZE;
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const spd = 1.2 + Math.random() * 2.4;
      slot.active = true;
      slot.x = wx + (Math.random() - 0.5) * 0.6;
      slot.y = 0.25 + Math.random() * 0.4;
      slot.z = wz + (Math.random() - 0.5) * 0.6;
      slot.vx = Math.cos(angle) * spd;
      slot.vy = 2.2 + Math.random() * 2.5;
      slot.vz = Math.sin(angle) * spd;
      slot.life = 0;
      slot.maxLife = 0.38 + Math.random() * 0.25;
      slot.size = 0.85 + Math.random() * 0.65;
      slot.color = colorHex;
    }
  }

  private spawnSingleVehicle(
    index: number,
    kind: VehicleKind,
    roads: Array<{ x: number; z: number }>,
  ): void {
    if (roads.length === 0) return;
    const carColors = [0xd94b3d, 0x3b78b8, 0xe8b938, 0xe4e8ec, 0x4c9665, 0x8a5b9c];
    const tile = roads[(index * 3) % roads.length];
    const color =
      kind === 'taxi'
        ? 0xf2b729
        : kind === 'police'
          ? 0x1e293b
          : kind === 'ambulance'
            ? 0xf8fafc
            : carColors[index % carColors.length];
    const visual = this.factory.buildVehicle(color, kind);
    const next = pickNextRoadTile(this.world, tile.x, tile.z, 1, 0);
    const maxSpeed = kind === 'police' || kind === 'ambulance' ? 2.75 : 2.0 + (index % 3) * 0.25;
    const state: VehicleAgent = {
      id: `v_${Date.now()}_${index}_${Math.floor(Math.random() * 1000)}`,
      x: tile.x,
      z: tile.z,
      targetX: next.tx,
      targetZ: next.tz,
      dirX: next.dx,
      dirZ: next.dz,
      progress: ((index * 0.23) % 0.7) + 0.05,
      maxSpeed,
      currentSpeed: maxSpeed,
      colorHex: color,
      kind,
      worldX: 0,
      worldZ: 0,
      yaw: 0,
      stopped: false,
      waitTime: 0,
    };
    const pos = computeVehicleWorldPos(state);
    state.worldX = pos.x;
    state.worldZ = pos.z;
    state.yaw = pos.yaw;
    visual.root.position.set(pos.x, 0.068, pos.z);
    visual.root.rotation.y = pos.yaw;
    this.scene.add(visual.root);
    this.vehicles.push({ state, visual });
  }

  private spawnSingleCitizen(index: number, roads: Array<{ x: number; z: number }>): void {
    if (roads.length === 0) return;
    const shirtColors = [0xd65a47, 0x457bb8, 0xe0b248, 0x4fa36b, 0x9c6ab5, 0xe27c5c];
    const pantColors = [0x2a3545, 0x3b424d, 0x52463a];
    const tile = roads[(index * 2 + 1) % roads.length];
    const shirtHex = shirtColors[index % shirtColors.length];
    const pantsHex = pantColors[index % pantColors.length];
    const visual = this.factory.buildCitizen(shirtHex, pantsHex);
    const maxSpeed = 0.78 + (index % 4) * 0.09;
    const sx = index % 2 === 0 ? 1 : -1;
    const sz = index % 3 === 0 ? 1 : -1;
    const state = createInitialCitizenOnCorner(
      this.world,
      `c_${Date.now()}_${index}_${Math.floor(Math.random() * 1000)}`,
      tile.x,
      tile.z,
      sx,
      sz,
      shirtHex,
      pantsHex,
      maxSpeed,
    );
    state.walkPhase = index * 0.9;
    visual.root.position.set(state.worldX, 0.068, state.worldZ);
    visual.root.rotation.y = state.yaw;
    this.scene.add(visual.root);
    this.citizens.push({ state, visual });
  }

  private spawnInitialAgents(): void {
    this.clearAgents();
    const roads = getConnectedRoadTiles(this.world);
    if (roads.length === 0) {
      this.world.metrics.activeVehicles = 0;
      this.world.metrics.activeCitizens = 0;
      return;
    }

    const baseKinds: VehicleKind[] = ['sedan', 'taxi', 'van', 'sedan'];
    const targetVehicles = Math.min(11, Math.max(4, Math.floor(roads.length / 3)));
    for (let i = 0; i < targetVehicles; i++) {
      this.spawnSingleVehicle(i, baseKinds[i % baseKinds.length], roads);
    }

    let policeStations = 0;
    let hospitals = 0;
    for (const b of this.world.buildings.values()) {
      if (b.kind === 'police') policeStations++;
      if (b.kind === 'hospital') hospitals++;
    }
    for (let i = 0; i < Math.min(2, policeStations); i++) {
      this.spawnSingleVehicle(targetVehicles + i, 'police', roads);
    }
    for (let i = 0; i < Math.min(2, hospitals); i++) {
      this.spawnSingleVehicle(targetVehicles + 2 + i, 'ambulance', roads);
    }

    const targetCitizens = Math.min(18, Math.max(6, Math.floor(roads.length * 0.7)));
    for (let i = 0; i < targetCitizens; i++) {
      this.spawnSingleCitizen(i, roads);
    }

    this.world.metrics.activeVehicles = this.vehicles.length;
    this.world.metrics.activeCitizens = this.citizens.length;
  }

  private syncEmergencyAndTrafficAgents(): void {
    const roads = getConnectedRoadTiles(this.world);
    if (roads.length === 0) {
      this.clearAgents();
      this.world.metrics.activeVehicles = 0;
      this.world.metrics.activeCitizens = 0;
      return;
    }

    let policeStations = 0;
    let hospitals = 0;
    for (const b of this.world.buildings.values()) {
      if (b.kind === 'police') policeStations++;
      if (b.kind === 'hospital') hospitals++;
    }
    const desiredPolice = Math.min(2, policeStations);
    const desiredAmb = Math.min(2, hospitals);

    let currentPolice = this.vehicles.filter((v) => v.state.kind === 'police').length;
    let currentAmb = this.vehicles.filter((v) => v.state.kind === 'ambulance').length;

    while (currentPolice < desiredPolice) {
      this.spawnSingleVehicle(this.vehicles.length + 1, 'police', roads);
      currentPolice++;
    }
    while (currentAmb < desiredAmb) {
      this.spawnSingleVehicle(this.vehicles.length + 2, 'ambulance', roads);
      currentAmb++;
    }

    // Trim excess emergency vehicles if station/clinic was bulldozed
    for (let i = this.vehicles.length - 1; i >= 0 && currentPolice > desiredPolice; i--) {
      if (this.vehicles[i].state.kind === 'police') {
        this.scene.remove(this.vehicles[i].visual.root);
        this.vehicles.splice(i, 1);
        currentPolice--;
      }
    }
    for (let i = this.vehicles.length - 1; i >= 0 && currentAmb > desiredAmb; i--) {
      if (this.vehicles[i].state.kind === 'ambulance') {
        this.scene.remove(this.vehicles[i].visual.root);
        this.vehicles.splice(i, 1);
        currentAmb--;
      }
    }

    const baseTarget = Math.min(11, Math.max(4, Math.floor(roads.length / 3)));
    const civilianCount = this.vehicles.filter(
      (v) => v.state.kind !== 'police' && v.state.kind !== 'ambulance',
    ).length;
    const baseKinds: VehicleKind[] = ['sedan', 'taxi', 'van', 'sedan'];
    for (let i = civilianCount; i < baseTarget; i++) {
      this.spawnSingleVehicle(i, baseKinds[i % baseKinds.length], roads);
    }

    const citizenTarget = Math.min(18, Math.max(6, Math.floor(roads.length * 0.7)));
    for (let i = this.citizens.length; i < citizenTarget; i++) {
      this.spawnSingleCitizen(i, roads);
    }

    this.world.metrics.activeVehicles = this.vehicles.length;
    this.world.metrics.activeCitizens = this.citizens.length;
  }

  private clearAgents(): void {
    this.vehicles.forEach((v) => this.scene.remove(v.visual.root));
    this.vehicles = [];
    this.citizens.forEach((c) => this.scene.remove(c.visual.root));
    this.citizens = [];
  }

  private updateAgents(dt: number, nightFactor: number): void {
    this.simTimeSec += dt;
    const roads = getConnectedRoadTiles(this.world);
    const vehicleStates = this.vehicles.map((v) => v.state);
    const citizenStates = this.citizens.map((c) => c.state);

    stepVehiclesPhysics(this.world, vehicleStates, citizenStates, dt, roads, this.simTimeSec);
    stepCitizensPhysics(this.world, citizenStates, vehicleStates, dt, roads);

    const nowMs = performance.now();
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      const s = v.state;
      v.visual.root.position.set(s.worldX, 0.068, s.worldZ);
      v.visual.root.rotation.y = s.yaw;
      v.visual.headlightMat.emissiveIntensity =
        0.2 + nightFactor * 2.4 + this.weatherAmounts.rain * 0.7;
      if (v.visual.beaconMat) {
        const pulse = Math.sin(nowMs * 0.015 + i * 1.7) > 0 ? 2.4 : 0.25;
        v.visual.beaconMat.emissiveIntensity = pulse;
      }
    }

    for (let i = 0; i < this.citizens.length; i++) {
      const c = this.citizens[i];
      const s = c.state;
      c.visual.root.position.set(s.worldX, 0.068, s.worldZ);
      c.visual.root.rotation.y = s.yaw;
      const stride = s.waiting ? 0 : Math.sin(s.walkPhase) * 0.52;
      c.visual.leftLeg.rotation.x = stride;
      c.visual.rightLeg.rotation.x = -stride;
      c.visual.leftArm.rotation.x = -stride * 0.7;
      c.visual.rightArm.rotation.x = stride * 0.7;
    }

    // Animate indoor residents & staff inside every powered building
    for (const [bId, list] of this.indoorActors.entries()) {
      const b = this.world.buildings.get(bId);
      if (!b || !b.powered) continue;
      const stations = getInteriorStations(b.kind, b.interiorLevel);
      const actorStates = list.map((item) => item.state);
      stepIndoorActors(actorStates, stations, dt);
      for (let k = 0; k < list.length; k++) {
        this.applyIndoorActorPose(list[k].state, list[k].visual);
      }
    }

    this.world.metrics.activeVehicles = this.vehicles.length;
    this.world.metrics.activeCitizens = this.citizens.length;
  }

  private getEffectiveTimeOfDay(): number {
    if (this.timePreset === 'day') return 0.42;
    if (this.timePreset === 'dusk') return 0.74;
    if (this.timePreset === 'night') return 0.94;
    return this.world.metrics.timeOfDay;
  }

  private updateWeatherParticles(dt: number): void {
    const rainAmt = this.weatherAmounts.rain;
    const snowAmt = this.weatherAmounts.snow;

    if (rainAmt > 0.03) {
      this.rainMesh.visible = true;
      (this.rainMesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.85, rainAmt * 0.85);
      const cx = this.camTarget.x;
      const cz = this.camTarget.z;
      const activeCount = Math.max(40, Math.floor(RAIN_COUNT * rainAmt));
      _quat.setFromAxisAngle(_vec3.set(0, 0, 1), -0.16);
      _scale.set(1, 1, 1);
      for (let i = 0; i < RAIN_COUNT; i++) {
        if (i >= activeCount) {
          _scale.set(0, 0, 0);
          _vec3.set(0, -40, 0);
          _mat4.compose(_vec3, _quat, _scale);
          this.rainMesh.setMatrixAt(i, _mat4);
          continue;
        }
        const idx = i * 3;
        this.rainData[idx] -= 2.2 * dt;
        this.rainData[idx + 1] -= 18.0 * dt;
        if (this.rainData[idx + 1] < 0.08) {
          this.rainData[idx + 1] += 14;
          this.rainData[idx] = ((i * 73) % 34) - 17;
        }
        _scale.set(1, 1, 1);
        _vec3.set(cx + this.rainData[idx], this.rainData[idx + 1], cz + this.rainData[idx + 2]);
        _mat4.compose(_vec3, _quat, _scale);
        this.rainMesh.setMatrixAt(i, _mat4);
      }
      this.rainMesh.instanceMatrix.needsUpdate = true;
    } else {
      this.rainMesh.visible = false;
    }

    if (snowAmt > 0.03) {
      this.snowMesh.visible = true;
      (this.snowMesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.95, snowAmt * 0.95);
      const cx = this.camTarget.x;
      const cz = this.camTarget.z;
      const activeCount = Math.max(40, Math.floor(SNOW_COUNT * snowAmt));
      _quat.identity();
      for (let i = 0; i < SNOW_COUNT; i++) {
        if (i >= activeCount) {
          _scale.set(0, 0, 0);
          _vec3.set(0, -40, 0);
          _mat4.compose(_vec3, _quat, _scale);
          this.snowMesh.setMatrixAt(i, _mat4);
          continue;
        }
        const idx = i * 4;
        this.snowData[idx + 3] += dt * 2.1;
        this.snowData[idx] += Math.sin(this.snowData[idx + 3]) * 0.65 * dt;
        this.snowData[idx + 1] -= 2.4 * dt;
        this.snowData[idx + 2] += Math.cos(this.snowData[idx + 3] * 0.8) * 0.45 * dt;
        if (this.snowData[idx + 1] < 0.06) {
          this.snowData[idx + 1] += 14;
          this.snowData[idx] = ((i * 67) % 34) - 17;
          this.snowData[idx + 2] = ((i * 41) % 34) - 17;
        }
        _scale.set(1, 1, 1);
        _vec3.set(cx + this.snowData[idx], this.snowData[idx + 1], cz + this.snowData[idx + 2]);
        _mat4.compose(_vec3, _quat, _scale);
        this.snowMesh.setMatrixAt(i, _mat4);
      }
      this.snowMesh.instanceMatrix.needsUpdate = true;
    } else {
      this.snowMesh.visible = false;
    }
  }

  private updateAtmosphereAndCutaway(dt: number): void {
    const tod = this.getEffectiveTimeOfDay();
    const targetWeather = resolveTargetWeather(
      this.weatherPreset,
      this.world.metrics.day,
      tod,
    );
    this.weatherAmounts = stepWeatherAmounts(this.weatherAmounts, targetWeather, dt);
    this.world.metrics.weather = this.weatherAmounts.weather;

    const rainAmt = this.weatherAmounts.rain;
    const snowAmt = this.weatherAmounts.snow;

    // Daylight curve: 0.2..0.68 = day, 0.68..0.82 = dusk, 0.82..0.18 = night
    let nightFactor = 0;
    let duskFactor = 0;
    if (tod >= 0.66 && tod < 0.82) {
      duskFactor = Math.sin(((tod - 0.66) / 0.16) * Math.PI);
      nightFactor = THREE.MathUtils.smoothstep(tod, 0.7, 0.82);
    } else if (tod >= 0.82 || tod < 0.18) {
      nightFactor = 1;
    } else if (tod >= 0.18 && tod < 0.28) {
      nightFactor = 1 - THREE.MathUtils.smoothstep(tod, 0.18, 0.28);
      duskFactor = Math.sin(((tod - 0.18) / 0.1) * Math.PI) * 0.6;
    }

    // Blend sky / fog color: sunny blue -> overcast rain / frosty snow -> warm dusk -> indigo night
    _colorA.setHex(0x9bc4d9);
    if (rainAmt > 0.01) {
      _colorB.setHex(0x435368);
      _colorA.lerp(_colorB, rainAmt * 0.82);
    }
    if (snowAmt > 0.01) {
      _colorB.setHex(0xd2dfec);
      _colorA.lerp(_colorB, snowAmt * 0.72);
    }
    _colorB.setHex(0x0c1120);
    _colorA.lerp(_colorB, nightFactor);
    if (duskFactor > 0.05) {
      _colorB.setHex(0xd47c5b);
      _colorA.lerp(_colorB, duskFactor * 0.55 * (1 - rainAmt * 0.6));
    }
    (this.scene.background as THREE.Color).copy(_colorA);
    if (this.scene.fog) {
      this.scene.fog.color.copy(_colorA);
    }

    // Scale IBL environment reflections down at night
    const dayEnv = 0.85 * (1 - rainAmt * 0.25);
    this.scene.environmentIntensity = THREE.MathUtils.lerp(dayEnv, 0.13, nightFactor);

    // Sun & Hemisphere intensities
    const weatherDim = 1 - rainAmt * 0.55 - snowAmt * 0.2;
    this.sunLight.intensity = THREE.MathUtils.lerp(1.95 * weatherDim, 0.24, nightFactor);
    _colorA.setHex(0xfff1d6);
    if (snowAmt > 0.01) {
      _colorB.setHex(0xe8f3ff);
      _colorA.lerp(_colorB, snowAmt * 0.65);
    }
    _colorB.setHex(0x637ec9);
    _colorA.lerp(_colorB, nightFactor);
    if (duskFactor > 0.05) {
      _colorB.setHex(0xff9c63);
      _colorA.lerp(_colorB, duskFactor * 0.6);
    }
    this.sunLight.color.copy(_colorA);
    this.hemiLight.intensity = THREE.MathUtils.lerp(0.8, 0.2, nightFactor);
    _colorA.setHex(0xbbe0ff);
    if (rainAmt > 0.01) {
      _colorB.setHex(0x6c8099);
      _colorA.lerp(_colorB, rainAmt * 0.68);
    }
    _colorB.setHex(0x1e2c4d);
    this.hemiLight.color.copy(_colorA.lerp(_colorB, nightFactor));
    _colorA.setHex(0x3b4f34);
    if (snowAmt > 0.01) {
      _colorB.setHex(0xb8cadc);
      _colorA.lerp(_colorB, snowAmt * 0.8);
    }
    _colorB.setHex(0x0b101a);
    this.hemiLight.groundColor.copy(_colorA.lerp(_colorB, nightFactor));

    for (const pl of this.nightLights) {
      pl.intensity = (nightFactor + rainAmt * 0.3) * 7.5;
    }

    // Terrain & Material weather states (wet asphalt in rain, snowy ground/trees in snow)
    this.factory.setWeatherSurfaceState(rainAmt, snowAmt);
    _colorA.setHex(0x447d3d);
    if (rainAmt > 0.01) {
      _colorB.setHex(0x315e2e);
      _colorA.lerp(_colorB, rainAmt * 0.68);
    }
    if (snowAmt > 0.01) {
      _colorB.setHex(0xdce8f4);
      _colorA.lerp(_colorB, snowAmt * 0.94);
    }
    this.outerGroundMat.color.copy(_colorA);

    _colorA.setHex(0xffffff);
    if (rainAmt > 0.01) {
      _colorB.setHex(0xcfdce8);
      _colorA.lerp(_colorB, rainAmt * 0.45);
    }
    this.playGroundMat.color.copy(_colorA);
    this.playGroundMat.roughness = THREE.MathUtils.lerp(0.92, 0.55, rainAmt);

    // Seamless winter snow checkerboard overlay across playable terrain
    if (snowAmt > 0.02) {
      this.snowOverlayMesh.visible = true;
      this.snowOverlayMat.opacity = Math.min(0.98, THREE.MathUtils.smoothstep(snowAmt, 0.02, 0.68) * 0.98);
    } else {
      this.snowOverlayMesh.visible = false;
    }

    // Frost perimeter tree canopies & building foliage when snow amount shifts
    if (Math.abs(snowAmt - this.lastSnowVisualLevel) > 0.025) {
      this.lastSnowVisualLevel = snowAmt;
      _colorB.setHex(0xe6eff7);
      for (let i = 0; i < this.perimeterTreeCount; i++) {
        _colorA.setHex(i % 2 === 0 ? 0x3b7838 : 0x4b8d43);
        _colorA.lerp(_colorB, Math.min(0.92, snowAmt * 0.92));
        this.perimeterCanopies.setColorAt(i, _colorA);
      }
      if (this.perimeterCanopies.instanceColor) {
        this.perimeterCanopies.instanceColor.needsUpdate = true;
      }

      for (const vis of this.buildingVisuals.values()) {
        for (const fm of vis.foliageMeshes) {
          const mat = fm.material as THREE.MeshStandardMaterial;
          const base = (mat.userData.baseHex as number | undefined) ?? 0x3d7d3a;
          mat.color.setHex(base).lerp(_colorB, Math.min(0.92, snowAmt * 0.92));
        }
      }
    }

    // Sun angle arc
    const sunAngle = (tod - 0.25) * Math.PI * 2;
    this.sunLight.position.set(
      Math.cos(sunAngle) * 36,
      Math.max(12, Math.sin(sunAngle) * 42 + 18),
      22,
    );

    // Intersection Traffic Signal phase update
    const signalPhase = computeSignalPhase(this.simTimeSec);
    const nsHex =
      signalPhase === 'ns_green' ? 0x22c55e : signalPhase === 'ns_clear' ? 0xf59e0b : 0xef4444;
    const ewHex =
      signalPhase === 'ew_green' ? 0x22c55e : signalPhase === 'ew_clear' ? 0xf59e0b : 0xef4444;

    // Update building pop-in spring, cutaway roofs, snow caps, signals, and night window glow
    const roofTargetY = this.cutaway ? 2.4 : 0;
    const dampK = 1 - Math.exp(-12 * dt);

    for (const [id, vis] of this.buildingVisuals.entries()) {
      const b = this.world.buildings.get(id);
      if (!b) continue;

      if (vis.popProgress < 1) {
        vis.popProgress = Math.min(1, vis.popProgress + dt * 4.5);
        const s = 0.2 + 0.8 * (1 - Math.pow(1 - vis.popProgress, 3));
        vis.root.scale.set(1, s, 1);
      }

      if (this.cutaway) {
        vis.roofGroup.visible = false;
        vis.upperShellGroup.visible = false;
        vis.interiorGroup.visible = true;
      } else {
        vis.roofGroup.visible = true;
        vis.upperShellGroup.visible = true;
        vis.roofGroup.position.y = THREE.MathUtils.lerp(vis.roofGroup.position.y, roofTargetY, dampK);
      }

      // Snow cap thickness on roofs
      const showSnowCaps = snowAmt > 0.05;
      for (const sm of vis.snowMeshes) {
        sm.visible = showSnowCaps;
        if (showSnowCaps) {
          sm.scale.y = THREE.MathUtils.lerp(0.15, 1.0, snowAmt);
        }
      }

      // Intersection traffic light bulbs
      if (vis.nsSignalMat) {
        vis.nsSignalMat.color.setHex(nsHex);
        vis.nsSignalMat.emissive.setHex(nsHex);
      }
      if (vis.ewSignalMat) {
        vis.ewSignalMat.color.setHex(ewHex);
        vis.ewSignalMat.emissive.setHex(ewHex);
      }

      const glow = b.powered ? 0.08 + nightFactor * 2.5 + rainAmt * 0.45 : 0.0;
      for (const wm of vis.windowMaterials) {
        wm.emissiveIntensity = glow;
      }
      const lampGlow =
        b.powered || b.kind === 'road' ? 0.15 + nightFactor * 2.6 + rainAmt * 0.65 : 0.0;
      for (const lm of vis.lampMaterials) {
        if ((lm as unknown as THREE.MeshBasicMaterial).userData?.isLampPool) {
          (lm as unknown as THREE.MeshBasicMaterial).opacity =
            (nightFactor + rainAmt * 0.25) * 0.24;
        } else {
          lm.emissiveIntensity = lampGlow;
        }
      }
    }

    this.updateWeatherParticles(dt);

    // Update pooled particles
    let anyParticle = false;
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyParticle = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        _scale.set(0, 0, 0);
        _vec3.set(0, -50, 0);
        _quat.identity();
        _mat4.compose(_vec3, _quat, _scale);
        this.particleMesh.setMatrixAt(i, _mat4);
        continue;
      }
      p.vy -= 9.5 * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.05, p.y + p.vy * dt);
      p.z += p.vz * dt;
      const t = 1 - p.life / p.maxLife;
      const sc = p.size * t;
      _scale.set(sc, sc, sc);
      _vec3.set(p.x, p.y, p.z);
      _quat.identity();
      _mat4.compose(_vec3, _quat, _scale);
      this.particleMesh.setMatrixAt(i, _mat4);
      this.particleMesh.setColorAt(i, _colorA.setHex(p.color));
    }
    if (anyParticle) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    }
  }

  private updateCameraTransform(): void {
    const dist = 42;
    const pitch = Math.atan(1 / Math.SQRT2); // true isometric 35.264°
    const horiz = Math.cos(pitch) * dist;
    const vert = Math.sin(pitch) * dist;

    this.camera.position.set(
      this.camTarget.x + Math.sin(this.camYawRad) * horiz,
      vert,
      this.camTarget.z + Math.cos(this.camYawRad) * horiz,
    );
    this.camera.lookAt(this.camTarget);
    this.camera.zoom = this.camZoom;
    this.camera.updateProjectionMatrix();
  }

  private updateHoverGhost(): void {
    if (this.screen !== 'playing' || !this.hoverTile) {
      this.ghostMesh.visible = false;
      this.gridHelper.visible = false;
      return;
    }

    const showGrid = this.activeTool !== 'inspect';
    this.gridHelper.visible = showGrid;

    if (this.activeTool === 'inspect') {
      this.ghostMesh.visible = false;
      return;
    }

    if (this.activeTool === 'bulldoze') {
      const b = getBuildingAt(this.world, this.hoverTile.x, this.hoverTile.z);
      const gx = b ? b.x : this.hoverTile.x;
      const gz = b ? b.z : this.hoverTile.z;
      const bw = b ? b.width : 1;
      const bd = b ? b.depth : 1;
      const wp = this.gridToWorld(gx, gz, bw, bd);
      this.ghostMesh.scale.set(bw * TILE_WORLD_SIZE - 0.08, 0.3, bd * TILE_WORLD_SIZE - 0.08);
      this.ghostMesh.position.set(wp.x, 0.16, wp.z);
      this.ghostMat.color.setHex(b ? 0xef4444 : 0x94a3b8);
      this.ghostMesh.visible = true;
      return;
    }

    const kind = this.activeTool as BuildingKind;
    const { width, depth } = getFootprint(kind, this.placementRotation);
    const check = canPlaceBuilding(
      this.world,
      kind,
      this.hoverTile.x,
      this.hoverTile.z,
      this.placementRotation,
      true,
    );
    const wp = this.gridToWorld(this.hoverTile.x, this.hoverTile.z, width, depth);
    this.ghostMesh.scale.set(width * TILE_WORLD_SIZE - 0.06, 0.35, depth * TILE_WORLD_SIZE - 0.06);
    this.ghostMesh.position.set(wp.x, 0.18, wp.z);
    this.ghostMat.color.setHex(check.ok ? 0x4ade80 : 0xef4444);
    this.ghostMesh.visible = true;
  }

  private updateSelectionHighlight(): void {
    if (!this.selectedBuildingId) {
      this.selectionRing.visible = false;
      return;
    }
    const b = this.world.buildings.get(this.selectedBuildingId);
    if (!b) {
      this.selectedBuildingId = null;
      this.selectionRing.visible = false;
      return;
    }
    const wp = this.gridToWorld(b.x, b.z, b.width, b.depth);
    this.selectionRing.scale.set(b.width * TILE_WORLD_SIZE + 0.08, 0.18, b.depth * TILE_WORLD_SIZE + 0.08);
    this.selectionRing.position.set(wp.x, 0.11, wp.z);
    this.selectionRing.visible = true;
  }

  private raycastGround(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    if (this.raycaster.ray.intersectPlane(this.groundPlane, _vec3)) {
      return this.worldToGrid(_vec3.x, _vec3.z);
    }
    return null;
  }

  private handleTileAction(gx: number, gz: number): void {
    if (this.screen !== 'playing') return;

    if (this.activeTool === 'inspect') {
      const b = getBuildingAt(this.world, gx, gz);
      this.selectedBuildingId = b ? b.id : null;
      retroAudio.playUiClick();
      this.pushHud(true);
      return;
    }

    if (this.activeTool === 'bulldoze') {
      const res = bulldozeAt(this.world, gx, gz);
      if (res.ok && res.removed) {
        const vis = this.buildingVisuals.get(res.removed.id);
        if (vis) {
          this.scene.remove(vis.root);
          this.buildingVisuals.delete(res.removed.id);
        }
        if (this.selectedBuildingId === res.removed.id) {
          this.selectedBuildingId = null;
        }
        if (res.removed.kind === 'road') {
          this.refreshNeighborRoads(res.removed.x, res.removed.z);
        }
        if (
          res.removed.kind === 'road' ||
          res.removed.kind === 'police' ||
          res.removed.kind === 'hospital'
        ) {
          this.syncEmergencyAndTrafficAgents();
        }
        this.syncIndoorActorsForAllBuildings();
        const wp = this.gridToWorld(res.removed.x, res.removed.z, res.removed.width, res.removed.depth);
        this.spawnBurst(wp.x, wp.z, 14, 0xc2855a);
        retroAudio.playBulldoze();
        this.pushHud(true);
      }
      return;
    }

    const kind = this.activeTool as BuildingKind;
    const res = placeBuilding(this.world, kind, gx, gz, this.placementRotation);
    if (res.ok && res.building) {
      this.createVisualForBuilding(res.building, false);
      if (kind === 'road') {
        this.refreshNeighborRoads(gx, gz);
      }
      if (kind === 'road' || kind === 'police' || kind === 'hospital' || kind === 'park') {
        this.syncEmergencyAndTrafficAgents();
      }
      this.syncIndoorActorsForAllBuildings();
      if (res.unlockedMilestone) {
        this.showBanner(`Milestone: ${res.unlockedMilestone}`);
        retroAudio.playFanfare();
      }
      const wp = this.gridToWorld(res.building.x, res.building.z, res.building.width, res.building.depth);
      this.spawnBurst(wp.x, wp.z, kind === 'road' ? 6 : 12, 0xe8dfd0);
      retroAudio.playPlace(kind === 'road');
      this.pushHud(true);
    } else if (res.reason) {
      this.showBanner(res.reason);
      this.pushHud(true);
    }
  }

  private bindEvents(): void {
    const canvas = this.renderer.domElement;

    const onPointerDown = (e: PointerEvent) => {
      if (this.screen !== 'playing') return;
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
      this.panLastPos = { x: e.clientX, y: e.clientY };
      this.dragMovedPx = 0;

      if (e.button === 1 || e.button === 2) {
        this.isPanDragging = true;
        return;
      }

      if (e.button === 0) {
        if (this.activeTool === 'road' || this.activeTool === 'bulldoze') {
          this.isPaintDragging = true;
          const tile = this.raycastGround(e.clientX, e.clientY);
          if (tile) {
            this.lastPaintedTileKey = `${tile.x},${tile.z}`;
            this.handleTileAction(tile.x, tile.z);
          }
        } else if (this.activeTool === 'inspect') {
          this.isPanDragging = true;
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (this.screen !== 'playing') return;
      const dx = e.clientX - this.panLastPos.x;
      const dy = e.clientY - this.panLastPos.y;
      this.dragMovedPx += Math.hypot(dx, dy);
      this.panLastPos = { x: e.clientX, y: e.clientY };

      if (this.isPanDragging && this.dragMovedPx > 4) {
        const panScale = 0.045 / this.camZoom;
        const cos = Math.cos(this.camYawRad);
        const sin = Math.sin(this.camYawRad);
        // Move camera target relative to isometric screen axes
        this.camTargetGoal.x -= (dx * cos + dy * sin) * panScale;
        this.camTargetGoal.z -= (-dx * sin + dy * cos) * panScale;
        const limit = 20;
        this.camTargetGoal.x = THREE.MathUtils.clamp(this.camTargetGoal.x, -limit, limit);
        this.camTargetGoal.z = THREE.MathUtils.clamp(this.camTargetGoal.z, -limit, limit);
      }

      const tile = this.raycastGround(e.clientX, e.clientY);
      this.hoverTile = tile;

      if (this.isPaintDragging && tile) {
        const key = `${tile.x},${tile.z}`;
        if (key !== this.lastPaintedTileKey) {
          this.lastPaintedTileKey = key;
          this.handleTileAction(tile.x, tile.z);
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (this.screen === 'playing' && e.button === 0 && !this.isPaintDragging) {
        if (this.dragMovedPx < 7) {
          const tile = this.raycastGround(e.clientX, e.clientY);
          if (tile) this.handleTileAction(tile.x, tile.z);
        }
      }
      this.isPanDragging = false;
      this.isPaintDragging = false;
      this.lastPaintedTileKey = '';
    };

    const onWheel = (e: WheelEvent) => {
      if (this.screen !== 'playing') return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      this.camZoomGoal = THREE.MathUtils.clamp(this.camZoomGoal * factor, 0.58, 2.35);
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      this.keysHeld.add(e.code);

      if (this.screen === 'title' && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        this.startGame();
        return;
      }

      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.screen === 'playing') {
          this.setPaused(true);
        } else if (this.screen === 'paused') {
          this.setPaused(false);
        }
        return;
      }

      if (e.code === 'KeyM') {
        this.toggleMute();
        return;
      }

      if (this.screen !== 'playing') return;

      if (e.code === 'KeyQ') this.rotateCamera(-1);
      else if (e.code === 'KeyE') this.rotateCamera(1);
      else if (e.code === 'KeyR') this.rotatePlacement();
      else if (e.code === 'KeyX') this.toggleCutaway();
      else if (e.code === 'KeyT') this.cycleTimePreset();
      else if (e.code === 'KeyV') this.cycleWeatherPreset();
      else if (e.code === 'Digit1') this.setTool('inspect');
      else if (e.code === 'Digit2') this.setTool('road');
      else if (e.code === 'Digit3') this.setTool('park');
      else if (e.code === 'Digit4') this.setTool('cottage');
      else if (e.code === 'Digit5') this.setTool('townhouse');
      else if (e.code === 'Digit6') this.setTool('apartment');
      else if (e.code === 'Digit7') this.setTool('villa');
      else if (e.code === 'Digit8') this.setTool('cafe');
      else if (e.code === 'Digit9') this.setTool('diner');
      else if (e.code === 'Digit0' || e.code === 'Backspace' || e.code === 'Delete') {
        this.setTool('bulldoze');
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      this.keysHeld.delete(e.code);
    };

    const onBlur = () => {
      this.keysHeld.clear();
      this.isPanDragging = false;
      this.isPaintDragging = false;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    // Store cleanup on instance
    this.cleanupListeners = () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      this.resizeObserver?.disconnect();
    };
  }

  private cleanupListeners: () => void = () => {};

  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const aspect = width / height;
    this.camera.left = (-this.frustumHeight * aspect) / 2;
    this.camera.right = (this.frustumHeight * aspect) / 2;
    this.camera.top = this.frustumHeight / 2;
    this.camera.bottom = -this.frustumHeight / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private tick = (now = performance.now()): void => {
    if (this.disposed) return;
    const rawDt = Math.max(0.001, (now - this.lastTimestamp) / 1000);
    this.lastTimestamp = now;
    const dt = Math.min(rawDt, 0.05);

    if (this.screen === 'title') {
      // Atmospheric gentle live diorama pan over Oakwood Block
      const t = now * 0.00018;
      this.camTargetGoal.set(Math.sin(t) * 3.5, 0, Math.cos(t * 0.8) * 3.0);
      this.camYawRad = Math.PI / 4 + Math.sin(t * 0.6) * 0.14;
      this.camZoomGoal = 1.15;
      this.updateAgents(dt, 0.15);
    } else if (this.screen === 'playing') {
      // Keyboard WASD/Arrows pan relative to isometric camera angle
      const panSpeed = 14 * dt;
      let fwd = 0;
      let right = 0;
      if (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp')) fwd -= 1;
      if (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown')) fwd += 1;
      if (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft')) right -= 1;
      if (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight')) right += 1;

      if (fwd !== 0 || right !== 0) {
        const cos = Math.cos(this.camYawRad);
        const sin = Math.sin(this.camYawRad);
        this.camTargetGoal.x += (right * cos + fwd * sin) * panSpeed;
        this.camTargetGoal.z += (-right * sin + fwd * cos) * panSpeed;
        this.camTargetGoal.x = THREE.MathUtils.clamp(this.camTargetGoal.x, -20, 20);
        this.camTargetGoal.z = THREE.MathUtils.clamp(this.camTargetGoal.z, -20, 20);
      }

      if (this.eventBannerTimer > 0) {
        this.eventBannerTimer -= dt;
        if (this.eventBannerTimer <= 0) {
          this.eventBannerTimer = 0;
          this.lastEventBanner = null;
          this.pushHud(true);
        }
      }

      const simDt = dt * this.simSpeed;
      if (this.simSpeed > 0) {
        const step = stepCitySimulation(this.world, simDt, true);
        if (step.unlockedMilestone) {
          this.showBanner(`Milestone: ${step.unlockedMilestone}`);
          retroAudio.playFanfare();
        }
        if (step.dayPassed) {
          retroAudio.playCashTick();
          if (this.world.outcome) {
            this.screen = 'gameover';
            document.body.dataset.state = 'gameover';
            if (this.world.outcome === 'victory') retroAudio.playFanfare();
          }
          this.pushHud(true);
        }
        this.updateAgents(simDt, this.getNightFactorQuick());
      }
    }

    // Exponential damping on camera target, zoom, and yaw
    const camDamp = 1 - Math.exp(-9 * dt);
    this.camTarget.lerp(this.camTargetGoal, camDamp);
    this.camZoom = THREE.MathUtils.lerp(this.camZoom, this.camZoomGoal, camDamp);
    if (this.screen !== 'title') {
      const targetYaw = Math.PI / 4 + this.camYawIndex * (Math.PI / 2);
      this.camYawRad = THREE.MathUtils.lerp(this.camYawRad, targetYaw, camDamp);
    }
    this.updateCameraTransform();

    this.updateAtmosphereAndCutaway(dt);
    this.updateHoverGhost();
    this.updateSelectionHighlight();

    this.renderer.render(this.scene, this.camera);

    if (now - this.lastHudPush > 240) {
      this.pushHud(false);
    }

    this.scheduleNextFrame();
  };

  private getNightFactorQuick(): number {
    const tod = this.getEffectiveTimeOfDay();
    if (tod >= 0.82 || tod < 0.18) return 1;
    if (tod >= 0.68 && tod < 0.82) return (tod - 0.68) / 0.14;
    return 0;
  }

  private scheduleNextFrame(): void {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(() => this.tick(performance.now()));
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private showBanner(msg: string): void {
    this.lastEventBanner = msg;
    this.eventBannerTimer = 4.2;
  }

  private hasSavedCity(): boolean {
    try {
      return window.localStorage.getItem(SAVE_STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  }

  private pushHud(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastHudPush < 180) return;
    this.lastHudPush = now;
    const selected = this.selectedBuildingId
      ? this.world.buildings.get(this.selectedBuildingId) ?? null
      : null;
    const actorList = selected ? this.indoorActors.get(selected.id) : undefined;
    const selectedIndoorSummary = actorList
      ? actorList.map((item) => item.state.activityLabel)
      : [];

    this.onHudUpdate({
      screen: this.screen,
      outcome: this.world.outcome,
      metrics: { ...this.world.metrics },
      activeTool: this.activeTool,
      cutaway: this.cutaway,
      simSpeed: this.simSpeed,
      timePreset: this.timePreset,
      weatherPreset: this.weatherPreset,
      selectedBuilding: selected ? { ...selected } : null,
      selectedIndoorSummary,
      milestones: this.world.milestones.map((m) => ({ ...m })),
      lastEventBanner: this.lastEventBanner,
      endlessMode: this.world.endlessMode,
      muted: retroAudio.muted,
      hasSavedCity: this.hasSavedCity(),
    });
  }

  // Public Controls called from React HUD
  public startGame(): void {
    this.screen = 'playing';
    document.body.dataset.state = 'playing';
    this.camTargetGoal.set(0, 0, 0);
    this.camZoomGoal = 1.05;
    this.keysHeld.clear();
    retroAudio.playUiClick();
    this.pushHud(true);
  }

  public setPaused(paused: boolean): void {
    if (this.screen === 'title' || this.screen === 'gameover') return;
    this.screen = paused ? 'paused' : 'playing';
    document.body.dataset.state = this.screen;
    this.keysHeld.clear();
    retroAudio.playUiClick();
    this.pushHud(true);
  }

  public returnToTitle(): void {
    this.screen = 'title';
    document.body.dataset.state = 'title';
    this.selectedBuildingId = null;
    this.keysHeld.clear();
    retroAudio.playUiClick();
    this.pushHud(true);
  }

  public resetCity(withStarterTown: boolean): void {
    this.world = createCityWorld(withStarterTown);
    this.selectedBuildingId = null;
    this.cutaway = false;
    this.screen = 'playing';
    document.body.dataset.state = 'playing';
    this.camTargetGoal.set(0, 0, 0);
    this.rebuildAllVisuals();
    this.spawnInitialAgents();
    retroAudio.playUiClick();
    this.pushHud(true);
  }

  public continueEndless(): void {
    this.world.endlessMode = true;
    this.world.outcome = null;
    this.screen = 'playing';
    document.body.dataset.state = 'playing';
    retroAudio.playUiClick();
    this.pushHud(true);
  }

  public setTool(tool: ToolId): void {
    this.activeTool = tool;
    if (tool !== 'inspect') this.selectedBuildingId = null;
    retroAudio.playUiClick();
    this.pushHud(true);
  }

  public rotatePlacement(): void {
    this.placementRotation = (this.placementRotation + 1) % 4;
    retroAudio.playUiClick();
  }

  public rotateCamera(dir: -1 | 1): void {
    this.camYawIndex += dir;
    retroAudio.playUiClick();
  }

  public toggleCutaway(): void {
    this.cutaway = !this.cutaway;
    retroAudio.playCutaway(this.cutaway);
    this.pushHud(true);
  }

  public setSimSpeed(speed: 0 | 1 | 2 | 4): void {
    this.simSpeed = speed;
    retroAudio.playUiClick();
    this.pushHud(true);
  }

  public cycleTimePreset(): void {
    const order: TimePreset[] = ['auto', 'day', 'dusk', 'night'];
    const next = order[(order.indexOf(this.timePreset) + 1) % order.length];
    this.timePreset = next;
    retroAudio.playUiClick();
    this.pushHud(true);
  }

  public cycleWeatherPreset(): void {
    const order: WeatherPreset[] = ['auto', 'clear', 'rain', 'snow'];
    const next = order[(order.indexOf(this.weatherPreset) + 1) % order.length];
    this.weatherPreset = next;
    const label =
      next === 'auto'
        ? 'Weather: Dynamic Forecast'
        : next === 'rain'
          ? 'Weather: Rainstorm'
          : next === 'snow'
            ? 'Weather: Snowfall'
            : 'Weather: Clear Sky';
    this.showBanner(label);
    retroAudio.playUiClick();
    this.pushHud(true);
  }

  public toggleMute(): void {
    retroAudio.muted = !retroAudio.muted;
    this.pushHud(true);
  }

  public upgradeSelectedBuilding(): void {
    if (!this.selectedBuildingId) return;
    const res = upgradeBuildingInterior(this.world, this.selectedBuildingId);
    if (res.ok && res.building) {
      this.createVisualForBuilding(res.building, false);
      const wp = this.gridToWorld(
        res.building.x,
        res.building.z,
        res.building.width,
        res.building.depth,
      );
      this.spawnBurst(wp.x, wp.z, 16, 0xfbbf24);
      retroAudio.playUpgrade();
      this.pushHud(true);
    }
  }

  public setSelectedBuildingTheme(theme: InteriorTheme): void {
    if (!this.selectedBuildingId) return;
    if (setBuildingInteriorTheme(this.world, this.selectedBuildingId, theme)) {
      const b = this.world.buildings.get(this.selectedBuildingId);
      if (b) {
        this.createVisualForBuilding(b, true);
        retroAudio.playUiClick();
        this.pushHud(true);
      }
    }
  }

  public setTaxPolicy(rate: TaxRate): void {
    setTaxRate(this.world, rate);
    const label = rate === 'low' ? 'Low (5%)' : rate === 'high' ? 'High (13%)' : 'Standard (9%)';
    this.showBanner(`Tax rate set to ${label}`);
    retroAudio.playUiClick();
    this.pushHud(true);
  }

  public saveCityToStorage(): void {
    try {
      const payload = exportCityState(this.world);
      window.localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(payload));
      this.showBanner('City saved to Mayor Archive');
      retroAudio.playUpgrade();
      this.pushHud(true);
    } catch {
      this.showBanner('Unable to save city');
      this.pushHud(true);
    }
  }

  public loadCityFromStorage(): void {
    try {
      const raw = window.localStorage.getItem(SAVE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SerializedCity;
      this.world = importCityState(parsed);
      this.selectedBuildingId = null;
      this.cutaway = false;
      this.screen = 'playing';
      document.body.dataset.state = 'playing';
      this.camTargetGoal.set(0, 0, 0);
      this.rebuildAllVisuals();
      this.spawnInitialAgents();
      this.showBanner(`Loaded saved city (Day ${this.world.metrics.day})`);
      retroAudio.playUiClick();
      this.pushHud(true);
    } catch {
      this.showBanner('Failed to load saved city');
      this.pushHud(true);
    }
  }

  public bulldozeSelectedBuilding(): void {
    if (!this.selectedBuildingId) return;
    const b = this.world.buildings.get(this.selectedBuildingId);
    if (!b) return;
    const res = bulldozeAt(this.world, b.x, b.z);
    if (res.ok && res.removed) {
      const vis = this.buildingVisuals.get(res.removed.id);
      if (vis) {
        this.scene.remove(vis.root);
        this.buildingVisuals.delete(res.removed.id);
      }
      if (res.removed.kind === 'road') {
        this.refreshNeighborRoads(res.removed.x, res.removed.z);
      }
      if (
        res.removed.kind === 'road' ||
        res.removed.kind === 'police' ||
        res.removed.kind === 'hospital'
      ) {
        this.syncEmergencyAndTrafficAgents();
      }
      this.syncIndoorActorsForAllBuildings();
      this.selectedBuildingId = null;
      const wp = this.gridToWorld(res.removed.x, res.removed.z, res.removed.width, res.removed.depth);
      this.spawnBurst(wp.x, wp.z, 14, 0xc2855a);
      retroAudio.playBulldoze();
      this.pushHud(true);
    }
  }

  public clearSelection(): void {
    this.selectedBuildingId = null;
    this.pushHud(true);
  }

  public getDebugStats(): { buildings: number; vehicles: number; citizens: number } {
    return {
      buildings: this.world.buildings.size,
      vehicles: this.vehicles.length,
      citizens: this.citizens.length,
    };
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.cleanupListeners();
    this.clearAgents();
    this.factory.dispose();
    this.textures.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
