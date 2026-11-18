import * as THREE from 'three';
import { TILE_WORLD_SIZE } from './catalog';
import type { CityTextureSet } from './textures';
import type { InteriorTheme, PlacedBuilding, RoadMask, VehicleKind } from './types';

export interface BuiltBuildingVisual {
  root: THREE.Group;
  roofGroup: THREE.Group;
  upperShellGroup: THREE.Group;
  interiorGroup: THREE.Group;
  windowMaterials: THREE.MeshStandardMaterial[];
  lampMaterials: THREE.MeshStandardMaterial[];
  snowMeshes: THREE.Mesh[];
  foliageMeshes: THREE.Mesh[];
  nsSignalMat?: THREE.MeshStandardMaterial;
  ewSignalMat?: THREE.MeshStandardMaterial;
  baseScaleY: number;
  popProgress: number;
}

export interface BuiltVehicleVisual {
  root: THREE.Group;
  headlightMat: THREE.MeshStandardMaterial;
  beaconMat?: THREE.MeshStandardMaterial;
}

export interface BuiltCitizenVisual {
  root: THREE.Group;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
}

export class CityModelFactory {
  private textures: CityTextureSet;
  private sharedMaterials: Map<string, THREE.Material> = new Map();
  private sharedGeos: Map<string, THREE.BufferGeometry> = new Map();

  constructor(textures: CityTextureSet) {
    this.textures = textures;
  }

  private box(w: number, h: number, d: number): THREE.BoxGeometry {
    const key = `box_${w}_${h}_${d}`;
    let g = this.sharedGeos.get(key);
    if (!g) {
      g = new THREE.BoxGeometry(w, h, d);
      this.sharedGeos.set(key, g);
    }
    return g as THREE.BoxGeometry;
  }

  private cyl(rt: number, rb: number, h: number, seg = 10): THREE.CylinderGeometry {
    const key = `cyl_${rt}_${rb}_${h}_${seg}`;
    let g = this.sharedGeos.get(key);
    if (!g) {
      g = new THREE.CylinderGeometry(rt, rb, h, seg);
      this.sharedGeos.set(key, g);
    }
    return g as THREE.CylinderGeometry;
  }

  private cone(r: number, h: number, seg = 4): THREE.ConeGeometry {
    const key = `cone_${r}_${h}_${seg}`;
    let g = this.sharedGeos.get(key);
    if (!g) {
      g = new THREE.ConeGeometry(r, h, seg);
      this.sharedGeos.set(key, g);
    }
    return g as THREE.ConeGeometry;
  }

  private mat(
    key: string,
    params: THREE.MeshStandardMaterialParameters,
  ): THREE.MeshStandardMaterial {
    let m = this.sharedMaterials.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial(params);
      this.sharedMaterials.set(key, m);
    }
    return m as THREE.MeshStandardMaterial;
  }

  private makeWindowMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0x3b4d63,
      roughness: 0.18,
      metalness: 0.25,
      emissive: new THREE.Color(0xffc86b),
      emissiveIntensity: 0,
    });
  }

  private makeLampMaterial(hex = 0xffd27a): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0xfff3d1,
      roughness: 0.2,
      metalness: 0.1,
      emissive: new THREE.Color(hex),
      emissiveIntensity: 0.15,
    });
  }

  private addMesh(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    castShadow = true,
    receiveShadow = true,
    rotY = 0,
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rotY !== 0) m.rotation.y = rotY;
    m.castShadow = castShadow;
    m.receiveShadow = receiveShadow;
    parent.add(m);
    return m;
  }

  public createContactShadow(width: number, depth: number): THREE.Mesh {
    const planeGeo = this.sharedGeos.get('shadow_plane') ?? new THREE.PlaneGeometry(1, 1);
    this.sharedGeos.set('shadow_plane', planeGeo);
    const mat = this.mat('contact_shadow_mat', {
      map: this.textures.contactShadow,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
      roughness: 1,
    });
    const m = new THREE.Mesh(planeGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(width, depth, 1);
    m.position.y = 0.015;
    m.receiveShadow = false;
    m.castShadow = false;
    return m;
  }

  // ---- Composite Interior Furniture Helpers ----

  private addBed(
    parent: THREE.Object3D,
    x: number,
    z: number,
    rotY: number,
    woodMat: THREE.Material,
    sheetMat: THREE.Material,
    blanketMat: THREE.Material,
    lampMat?: THREE.Material,
  ): void {
    const g = new THREE.Group();
    g.position.set(x, 0.09, z);
    g.rotation.y = rotY;
    // Frame + headboard
    this.addMesh(g, this.box(0.42, 0.09, 0.52), woodMat, 0, 0.045, 0);
    this.addMesh(g, this.box(0.42, 0.24, 0.05), woodMat, 0, 0.12, -0.24);
    // Mattress + folded blanket + 2 pillows
    this.addMesh(g, this.box(0.36, 0.07, 0.44), sheetMat, 0, 0.11, 0.01);
    this.addMesh(g, this.box(0.37, 0.04, 0.26), blanketMat, 0, 0.14, 0.1);
    this.addMesh(g, this.box(0.14, 0.04, 0.09), sheetMat, -0.09, 0.16, -0.15);
    this.addMesh(g, this.box(0.14, 0.04, 0.09), sheetMat, 0.09, 0.16, -0.15);
    // Nightstand + bedside lamp
    if (lampMat) {
      this.addMesh(g, this.box(0.14, 0.14, 0.14), woodMat, 0.3, 0.07, -0.18);
      this.addMesh(g, this.cyl(0.04, 0.055, 0.08, 6), lampMat, 0.3, 0.18, -0.18, false, false);
    }
    parent.add(g);
  }

  private addSofaSet(
    parent: THREE.Object3D,
    x: number,
    z: number,
    rotY: number,
    sofaMat: THREE.Material,
    woodMat: THREE.Material,
    rugMat: THREE.Material,
    screenMat?: THREE.Material,
  ): void {
    const g = new THREE.Group();
    g.position.set(x, 0.09, z);
    g.rotation.y = rotY;
    // Area rug
    this.addMesh(g, this.box(0.68, 0.015, 0.54), rugMat, 0, 0.008, 0.08, false, true);
    // Sofa base, back, and armrests
    this.addMesh(g, this.box(0.52, 0.1, 0.22), sofaMat, 0, 0.05, -0.1);
    this.addMesh(g, this.box(0.52, 0.18, 0.06), sofaMat, 0, 0.14, -0.18);
    this.addMesh(g, this.box(0.06, 0.15, 0.22), sofaMat, -0.23, 0.11, -0.1);
    this.addMesh(g, this.box(0.06, 0.15, 0.22), sofaMat, 0.23, 0.11, -0.1);
    // Coffee table
    this.addMesh(g, this.box(0.28, 0.08, 0.16), woodMat, 0, 0.05, 0.12);
    // Optional TV stand
    if (screenMat) {
      this.addMesh(g, this.box(0.36, 0.12, 0.12), woodMat, 0, 0.06, 0.32);
      this.addMesh(g, this.box(0.26, 0.14, 0.03), screenMat, 0, 0.18, 0.32);
    }
    parent.add(g);
  }

  private addDiningSet(
    parent: THREE.Object3D,
    x: number,
    z: number,
    woodMat: THREE.Material,
    chairMat: THREE.Material,
  ): void {
    const g = new THREE.Group();
    g.position.set(x, 0.09, z);
    this.addMesh(g, this.box(0.34, 0.04, 0.26), woodMat, 0, 0.14, 0);
    this.addMesh(g, this.cyl(0.03, 0.04, 0.12, 6), woodMat, 0, 0.06, 0);
    const chairs: Array<[number, number]> = [
      [-0.2, 0],
      [0.2, 0],
      [0, -0.17],
      [0, 0.17],
    ];
    chairs.forEach(([cx, cz]) => {
      this.addMesh(g, this.box(0.09, 0.1, 0.09), chairMat, cx, 0.05, cz);
    });
    parent.add(g);
  }

  private addKitchenCounter(
    parent: THREE.Object3D,
    x: number,
    z: number,
    rotY: number,
    cabinetMat: THREE.Material,
    steelMat: THREE.Material,
  ): void {
    const g = new THREE.Group();
    g.position.set(x, 0.09, z);
    g.rotation.y = rotY;
    this.addMesh(g, this.box(0.56, 0.18, 0.18), cabinetMat, -0.06, 0.09, 0);
    this.addMesh(g, this.box(0.58, 0.03, 0.2), steelMat, -0.06, 0.19, 0);
    // Fridge
    this.addMesh(g, this.box(0.2, 0.34, 0.2), steelMat, 0.34, 0.17, 0);
    parent.add(g);
  }

  private addOfficeDesk(
    parent: THREE.Object3D,
    x: number,
    z: number,
    rotY: number,
    woodMat: THREE.Material,
    chairMat: THREE.Material,
    monitorMat: THREE.Material,
  ): void {
    const g = new THREE.Group();
    g.position.set(x, 0.09, z);
    g.rotation.y = rotY;
    this.addMesh(g, this.box(0.52, 0.16, 0.26), woodMat, 0, 0.08, 0);
    this.addMesh(g, this.box(0.2, 0.14, 0.03), monitorMat, 0, 0.23, -0.06);
    this.addMesh(g, this.box(0.14, 0.14, 0.14), chairMat, 0, 0.07, 0.2);
    parent.add(g);
  }

  private addBathroomSet(
    parent: THREE.Object3D,
    x: number,
    z: number,
    rotY: number,
    tileMat: THREE.Material,
    porcelainMat: THREE.Material,
    chromeMat: THREE.Material,
  ): void {
    const g = new THREE.Group();
    g.position.set(x, 0.09, z);
    g.rotation.y = rotY;
    // Ceramic tile pad
    this.addMesh(g, this.box(0.54, 0.016, 0.48), tileMat, 0, 0.008, 0, false, true);
    // Compact toilet (bowl + tank)
    this.addMesh(g, this.box(0.14, 0.11, 0.14), porcelainMat, -0.15, 0.06, -0.1);
    this.addMesh(g, this.box(0.14, 0.2, 0.07), porcelainMat, -0.15, 0.11, -0.18);
    // Pedestal vanity sink + chrome faucet
    this.addMesh(g, this.box(0.18, 0.16, 0.14), porcelainMat, 0.14, 0.09, -0.14);
    this.addMesh(g, this.box(0.05, 0.05, 0.04), chromeMat, 0.14, 0.19, -0.17);
    // Compact bathtub / shower tray
    this.addMesh(g, this.box(0.46, 0.12, 0.18), porcelainMat, 0, 0.07, 0.13);
    this.addMesh(g, this.box(0.38, 0.03, 0.12), chromeMat, 0, 0.135, 0.13);
    parent.add(g);
  }

  private addSnowCap(
    parent: THREE.Object3D,
    snowMeshes: THREE.Mesh[],
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    rotX = 0,
    rotY = 0,
  ): THREE.Mesh {
    const snowMat = this.mat('snow_cap_mat', {
      color: 0xf1f5f9,
      roughness: 0.72,
      metalness: 0.02,
    });
    const m = this.addMesh(parent, this.box(w, h, d), snowMat, x, y, z, false, true, rotY);
    if (rotX !== 0) m.rotation.x = rotX;
    m.visible = false;
    snowMeshes.push(m);
    return m;
  }

  public buildTree(scale = 1, variant = 0, foliageTarget?: THREE.Mesh[]): THREE.Group {
    const g = new THREE.Group();
    const trunkMat = this.mat('tree_trunk', { color: 0x6b4a35, roughness: 0.9, metalness: 0.0 });
    const leafColors = [0x3d7d3a, 0x4b8f42, 0x2f6a34];
    const leafMat = new THREE.MeshStandardMaterial({
      color: leafColors[variant % 3],
      roughness: 0.85,
      metalness: 0.0,
    });
    leafMat.userData.baseHex = leafColors[variant % 3];

    g.add(this.createContactShadow(1.1 * scale, 1.1 * scale));
    this.addMesh(g, this.cyl(0.08 * scale, 0.13 * scale, 0.55 * scale, 7), trunkMat, 0, 0.275 * scale, 0);
    const meshes: THREE.Mesh[] = [];
    if (variant % 2 === 0) {
      meshes.push(this.addMesh(g, this.cyl(0.28 * scale, 0.42 * scale, 0.45 * scale, 7), leafMat, 0, 0.68 * scale, 0));
      meshes.push(this.addMesh(g, this.cyl(0.18 * scale, 0.34 * scale, 0.38 * scale, 7), leafMat, 0.04 * scale, 0.98 * scale, -0.02 * scale));
      meshes.push(this.addMesh(g, this.cyl(0.06 * scale, 0.2 * scale, 0.25 * scale, 6), leafMat, 0, 1.2 * scale, 0));
    } else {
      meshes.push(this.addMesh(g, this.cone(0.42 * scale, 0.6 * scale, 6), leafMat, 0, 0.72 * scale, 0));
      meshes.push(this.addMesh(g, this.cone(0.32 * scale, 0.5 * scale, 6), leafMat, 0, 1.05 * scale, 0));
      meshes.push(this.addMesh(g, this.cone(0.2 * scale, 0.38 * scale, 6), leafMat, 0, 1.32 * scale, 0));
    }
    if (foliageTarget) {
      foliageTarget.push(...meshes);
    }
    return g;
  }

  public buildRoadTile(mask: RoadMask, upgraded: boolean): BuiltBuildingVisual {
    const root = new THREE.Group();
    const roofGroup = new THREE.Group();
    const upperShellGroup = new THREE.Group();
    const interiorGroup = new THREE.Group();
    const windowMaterials: THREE.MeshStandardMaterial[] = [];
    const lampMaterials: THREE.MeshStandardMaterial[] = [];
    const snowMeshes: THREE.Mesh[] = [];
    const foliageMeshes: THREE.Mesh[] = [];
    let nsSignalMat: THREE.MeshStandardMaterial | undefined;
    let ewSignalMat: THREE.MeshStandardMaterial | undefined;

    const T = TILE_WORLD_SIZE;
    const sidewalkMat = this.mat('sidewalk_mat', {
      map: this.textures.sidewalk,
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0.02,
    });
    const asphaltMat = this.mat('asphalt_mat', {
      map: this.textures.asphalt,
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.04,
    });
    const stripeYellow = this.mat('stripe_yellow', { color: 0xe6b83c, roughness: 0.7 });
    const stripeWhite = this.mat('stripe_white', { color: 0xe8eaed, roughness: 0.7 });

    this.addMesh(root, this.box(T, 0.06, T), sidewalkMat, 0, 0.03, 0, false, true);

    const roadW = 1.28;
    this.addMesh(root, this.box(roadW, 0.065, roadW), asphaltMat, 0, 0.033, 0, false, true);

    const armLen = (T - roadW) / 2;
    const armOffset = roadW / 2 + armLen / 2;
    if (mask.north) {
      this.addMesh(root, this.box(roadW, 0.065, armLen), asphaltMat, 0, 0.033, -armOffset, false, true);
      this.addMesh(root, this.box(0.06, 0.072, 0.36), stripeYellow, 0, 0.034, -0.68, false, false);
    }
    if (mask.south) {
      this.addMesh(root, this.box(roadW, 0.065, armLen), asphaltMat, 0, 0.033, armOffset, false, true);
      this.addMesh(root, this.box(0.06, 0.072, 0.36), stripeYellow, 0, 0.034, 0.68, false, false);
    }
    if (mask.east) {
      this.addMesh(root, this.box(armLen, 0.065, roadW), asphaltMat, armOffset, 0.033, 0, false, true);
      this.addMesh(root, this.box(0.36, 0.072, 0.06), stripeYellow, 0.68, 0.034, 0, false, false);
    }
    if (mask.west) {
      this.addMesh(root, this.box(armLen, 0.065, roadW), asphaltMat, -armOffset, 0.033, 0, false, true);
      this.addMesh(root, this.box(0.36, 0.072, 0.06), stripeYellow, -0.68, 0.034, 0, false, false);
    }

    const connCount = Number(mask.north) + Number(mask.south) + Number(mask.east) + Number(mask.west);
    if (connCount <= 2) {
      if (mask.north || mask.south) {
        this.addMesh(root, this.box(0.06, 0.072, 0.34), stripeYellow, 0, 0.034, 0, false, false);
      } else if (mask.east || mask.west) {
        this.addMesh(root, this.box(0.34, 0.072, 0.06), stripeYellow, 0, 0.034, 0, false, false);
      }
    }

    if (connCount >= 3) {
      for (let i = -2; i <= 2; i++) {
        if (mask.north) {
          this.addMesh(root, this.box(0.11, 0.074, 0.22), stripeWhite, i * 0.22, 0.034, -0.72, false, false);
        }
        if (mask.south) {
          this.addMesh(root, this.box(0.11, 0.074, 0.22), stripeWhite, i * 0.22, 0.034, 0.72, false, false);
        }
        if (mask.east) {
          this.addMesh(root, this.box(0.22, 0.074, 0.11), stripeWhite, 0.72, 0.034, i * 0.22, false, false);
        }
        if (mask.west) {
          this.addMesh(root, this.box(0.22, 0.074, 0.11), stripeWhite, -0.72, 0.034, i * 0.22, false, false);
        }
      }

      // Corner Traffic Signal Standards for NS & EW phases
      const poleMat = this.mat('signal_pole', { color: 0x1e2530, roughness: 0.45, metalness: 0.72 });
      nsSignalMat = new THREE.MeshStandardMaterial({
        color: 0x22c55e,
        emissive: new THREE.Color(0x22c55e),
        emissiveIntensity: 1.5,
        roughness: 0.25,
      });
      ewSignalMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: new THREE.Color(0xef4444),
        emissiveIntensity: 1.5,
        roughness: 0.25,
      });

      const corners: Array<[number, number]> = [
        [0.82, 0.82],
        [-0.82, 0.82],
      ];
      corners.forEach(([sx, sz]) => {
        this.addMesh(root, this.cyl(0.03, 0.042, 0.72, 6), poleMat, sx, 0.4, sz);
        this.addMesh(root, this.box(0.12, 0.16, 0.12), poleMat, sx, 0.8, sz);
        // NS indicator lenses (north/south faces)
        this.addMesh(root, this.box(0.07, 0.07, 0.14), nsSignalMat!, sx, 0.8, sz, false, false);
        // EW indicator lenses (east/west faces)
        this.addMesh(root, this.box(0.14, 0.07, 0.07), ewSignalMat!, sx, 0.8, sz, false, false);
      });
    }

    if (connCount >= 2 || upgraded) {
      const ironMat = this.mat('iron_lamp', { color: 0x262d38, roughness: 0.45, metalness: 0.7 });
      const bulbMat = this.makeLampMaterial();
      lampMaterials.push(bulbMat);
      const lx = -0.82;
      const lz = -0.82;
      this.addMesh(root, this.cyl(0.035, 0.055, 0.95, 6), ironMat, lx, 0.52, lz);
      this.addMesh(root, this.box(0.22, 0.04, 0.04), ironMat, lx + 0.09, 0.98, lz + 0.09, true, false, -Math.PI / 4);
      this.addMesh(root, this.box(0.11, 0.09, 0.11), bulbMat, lx + 0.15, 0.92, lz + 0.15, false, false);

      const poolGeo = this.sharedGeos.get('lamp_pool_geo') ?? new THREE.CircleGeometry(1.15, 16);
      this.sharedGeos.set('lamp_pool_geo', poolGeo);
      const poolMat = new THREE.MeshBasicMaterial({
        color: 0xffc766,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      poolMat.userData.isLampPool = true;
      lampMaterials.push(poolMat as unknown as THREE.MeshStandardMaterial);
      const pool = new THREE.Mesh(poolGeo, poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(lx + 0.35, 0.078, lz + 0.35);
      root.add(pool);
    }

    root.add(interiorGroup);
    root.add(upperShellGroup);
    root.add(roofGroup);

    return {
      root,
      roofGroup,
      upperShellGroup,
      interiorGroup,
      windowMaterials,
      lampMaterials,
      snowMeshes,
      foliageMeshes,
      nsSignalMat,
      ewSignalMat,
      baseScaleY: 1,
      popProgress: 1,
    };
  }

  private getThemePalette(theme: InteriorTheme) {
    if (theme === 'warm') {
      return { rug: 0xb84a39, accent: 0xd99b43, blanket: 0xc95f49, desk: 0x7c4e32 };
    }
    if (theme === 'metro') {
      return { rug: 0x3b6e8c, accent: 0x5ab2b0, blanket: 0x4b7ea1, desk: 0x3c4654 };
    }
    return { rug: 0x4f745c, accent: 0xc97b42, blanket: 0x588267, desk: 0x8a5b3b };
  }

  public buildBuilding(building: PlacedBuilding): BuiltBuildingVisual {
    const root = new THREE.Group();
    const roofGroup = new THREE.Group();
    const upperShellGroup = new THREE.Group();
    const interiorGroup = new THREE.Group();
    const windowMaterials: THREE.MeshStandardMaterial[] = [];
    const lampMaterials: THREE.MeshStandardMaterial[] = [];
    const snowMeshes: THREE.Mesh[] = [];
    const foliageMeshes: THREE.Mesh[] = [];

    const W = building.width * TILE_WORLD_SIZE;
    const D = building.depth * TILE_WORLD_SIZE;
    const theme = this.getThemePalette(building.interiorTheme);

    const concreteMat = this.mat('lot_concrete', {
      map: this.textures.sidewalk,
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0.02,
    });
    const grassPatchMat = this.mat('lot_grass_trim', { color: 0x4a8943, roughness: 0.92 });
    const brickRedMat = this.mat('brick_red_mat', {
      map: this.textures.brickRed,
      color: 0xffffff,
      roughness: 0.84,
      metalness: 0.02,
    });
    const brickTanMat = this.mat('brick_tan_mat', {
      map: this.textures.brickTan,
      color: 0xffffff,
      roughness: 0.82,
      metalness: 0.02,
    });
    const shingleBlueMat = this.mat('shingle_blue_mat', {
      map: this.textures.shingleBlue,
      color: 0xffffff,
      roughness: 0.78,
    });
    const shingleRedMat = this.mat('shingle_red_mat', {
      map: this.textures.shingleRed,
      color: 0xffffff,
      roughness: 0.78,
    });
    const trimMat = this.mat('trim_cream', { color: 0xe6dfd1, roughness: 0.65 });
    const darkMetalMat = this.mat('dark_metal', { color: 0x323945, roughness: 0.42, metalness: 0.65 });
    const chromeMat = this.mat('chrome_mat', { color: 0xd0d6dc, roughness: 0.18, metalness: 0.85 });
    const woodMat = this.mat(`furn_wood_${building.interiorTheme}`, { color: theme.desk, roughness: 0.7 });
    const rugMat = this.mat(`furn_rug_${building.interiorTheme}`, { color: theme.rug, roughness: 0.95 });
    const accentMat = this.mat(`furn_accent_${building.interiorTheme}`, { color: theme.accent, roughness: 0.55 });
    const blanketMat = this.mat(`furn_blanket_${building.interiorTheme}`, { color: theme.blanket, roughness: 0.85 });
    const bedSheetMat = this.mat('bed_sheet', { color: 0xedeae2, roughness: 0.85 });
    const stuccoMat = this.mat('stucco_cream', { color: 0xe8dcc4, roughness: 0.8 });

    const winMat = this.makeWindowMaterial();
    windowMaterials.push(winMat);
    const indoorLampMat = this.makeLampMaterial();
    lampMaterials.push(indoorLampMat);

    const addCutawayWalls = (
      bw: number,
      bd: number,
      wallH: number,
      wallMat: THREE.Material,
      floorMat: THREE.Material,
      offsetY = 0.05,
    ) => {
      this.addMesh(root, this.box(bw - 0.14, 0.04, bd - 0.14), floorMat, 0, offsetY + 0.02, 0, false, true);
      const t = 0.11;
      const lowH = 0.34;
      const upH = Math.max(0.2, wallH - lowH);

      // Low cutaway walls + front doorway notch
      this.addMesh(root, this.box(bw, lowH, t), wallMat, 0, offsetY + lowH / 2, -bd / 2 + t / 2);
      // Front wall split around doorway opening
      const segW = (bw - 0.42) / 2;
      if (segW > 0.1) {
        this.addMesh(root, this.box(segW, lowH, t), wallMat, -(bw / 2 - segW / 2), offsetY + lowH / 2, bd / 2 - t / 2);
        this.addMesh(root, this.box(segW, lowH, t), wallMat, bw / 2 - segW / 2, offsetY + lowH / 2, bd / 2 - t / 2);
      }
      this.addMesh(root, this.box(t, lowH, bd - t * 2), wallMat, -bw / 2 + t / 2, offsetY + lowH / 2, 0);
      this.addMesh(root, this.box(t, lowH, bd - t * 2), wallMat, bw / 2 - t / 2, offsetY + lowH / 2, 0);

      // Upper facade walls
      const uy = offsetY + lowH + upH / 2;
      this.addMesh(upperShellGroup, this.box(bw, upH, t), wallMat, 0, uy, -bd / 2 + t / 2);
      this.addMesh(upperShellGroup, this.box(bw, upH, t), wallMat, 0, uy, bd / 2 - t / 2);
      this.addMesh(upperShellGroup, this.box(t, upH, bd - t * 2), wallMat, -bw / 2 + t / 2, uy, 0);
      this.addMesh(upperShellGroup, this.box(t, upH, bd - t * 2), wallMat, bw / 2 - t / 2, uy, 0);
    };

    const woodFloorMat = this.mat('wood_floor_mat', { map: this.textures.woodFloor, color: 0xffffff, roughness: 0.72 });
    const marketFloorMat = this.mat('market_floor_mat', { map: this.textures.marketFloor, color: 0xffffff, roughness: 0.45 });
    const dinerFloorMat = this.mat('diner_floor_mat', { map: this.textures.dinerFloor, color: 0xffffff, roughness: 0.45 });

    const bathTileMat = this.mat('bath_tile_mat', { color: 0xcbe3ea, roughness: 0.38 });
    const porcelainMat = this.mat('porcelain_mat', { color: 0xf8fafc, roughness: 0.25 });

    if (building.kind === 'park') {
      const parkGrassMat = new THREE.MeshStandardMaterial({ color: 0x4a8943, roughness: 0.92 });
      parkGrassMat.userData.baseHex = 0x4a8943;
      const gPad = this.addMesh(root, this.box(W, 0.05, D), parkGrassMat, 0, 0.025, 0, false, true);
      foliageMeshes.push(gPad);
      this.addMesh(root, this.box(0.45, 0.065, D - 0.1), concreteMat, 0, 0.032, 0, false, true);
      this.addMesh(root, this.box(W - 0.1, 0.065, 0.45), concreteMat, 0, 0.032, 0, false, true);

      const t1 = this.buildTree(0.85, 0, foliageMeshes);
      t1.position.set(-0.55, 0.04, -0.55);
      root.add(t1);
      const t2 = this.buildTree(0.75, 1, foliageMeshes);
      t2.position.set(0.58, 0.04, 0.55);
      root.add(t2);

      this.addMesh(root, this.box(0.45, 0.08, 0.16), woodMat, -0.5, 0.15, 0.48);
      this.addMesh(root, this.box(0.45, 0.12, 0.04), woodMat, -0.5, 0.24, 0.54);
      this.addSnowCap(roofGroup, snowMeshes, 0.45, 0.035, 0.16, -0.5, 0.2, 0.48);

      if (building.interiorLevel >= 2) {
        const waterMat = this.mat('park_water', { color: 0x4ca3c9, roughness: 0.12, metalness: 0.1 });
        this.addMesh(root, this.cyl(0.36, 0.4, 0.16, 10), concreteMat, 0, 0.12, 0);
        this.addMesh(root, this.cyl(0.28, 0.28, 0.12, 10), waterMat, 0, 0.16, 0);
        this.addMesh(root, this.cyl(0.08, 0.12, 0.36, 8), concreteMat, 0, 0.32, 0);
      }
    } else if (building.kind === 'cottage') {
      const yardMat = new THREE.MeshStandardMaterial({ color: 0x4a8943, roughness: 0.92 });
      yardMat.userData.baseHex = 0x4a8943;
      foliageMeshes.push(this.addMesh(root, this.box(W, 0.05, D), yardMat, 0, 0.025, 0, false, true));
      this.addMesh(root, this.box(0.4, 0.06, 0.42), concreteMat, 0, 0.03, 0.72, false, true);

      const bw = 1.56;
      const bd = 1.42;
      addCutawayWalls(bw, bd, 0.88, brickTanMat, woodFloorMat, 0.05);

      const doorMat = this.mat('door_wood', { color: 0x6f3926, roughness: 0.65 });
      this.addMesh(upperShellGroup, this.box(0.28, 0.48, 0.05), doorMat, 0, 0.34, bd / 2 + 0.01);
      this.addMesh(upperShellGroup, this.box(0.28, 0.28, 0.05), winMat, -0.46, 0.52, bd / 2 + 0.01);
      this.addMesh(upperShellGroup, this.box(0.28, 0.28, 0.05), winMat, 0.46, 0.52, bd / 2 + 0.01);
      this.addMesh(upperShellGroup, this.box(0.05, 0.28, 0.32), winMat, bw / 2 + 0.01, 0.52, 0);
      this.addMesh(upperShellGroup, this.box(0.05, 0.28, 0.32), winMat, -bw / 2 - 0.01, 0.52, 0);

      // Pitched Roof + Chimney + Snow Caps
      const roofLeft = new THREE.Mesh(this.box(bw + 0.22, 0.1, 0.95), shingleRedMat);
      roofLeft.position.set(0, 1.15, -0.35);
      roofLeft.rotation.x = -0.52;
      roofLeft.castShadow = true;
      roofGroup.add(roofLeft);

      const roofRight = new THREE.Mesh(this.box(bw + 0.22, 0.1, 0.95), shingleRedMat);
      roofRight.position.set(0, 1.15, 0.35);
      roofRight.rotation.x = 0.52;
      roofRight.castShadow = true;
      roofGroup.add(roofRight);

      this.addSnowCap(roofGroup, snowMeshes, bw + 0.24, 0.055, 0.96, 0, 1.21, -0.35, -0.52);
      this.addSnowCap(roofGroup, snowMeshes, bw + 0.24, 0.055, 0.96, 0, 1.21, 0.35, 0.52);

      this.addMesh(roofGroup, this.box(bw + 0.24, 0.12, 0.14), trimMat, 0, 1.35, 0);
      this.addMesh(roofGroup, this.box(0.22, 0.46, 0.22), brickRedMat, -0.44, 1.38, -0.2);

      // Complete Multi-Room Interior: Bedroom (NW), Living/TV (NE), Bathroom (SE), Kitchen/Dining (SW)
      this.addMesh(interiorGroup, this.box(0.06, 0.26, 0.56), trimMat, -0.05, 0.22, -0.38);
      this.addMesh(interiorGroup, this.box(0.42, 0.26, 0.06), trimMat, 0.5, 0.22, 0.1);
      this.addBed(interiorGroup, -0.44, -0.34, 0, woodMat, bedSheetMat, blanketMat, indoorLampMat);
      this.addSofaSet(interiorGroup, 0.36, -0.34, 0, accentMat, woodMat, rugMat, winMat);
      this.addBathroomSet(interiorGroup, 0.48, 0.42, Math.PI, bathTileMat, porcelainMat, chromeMat);
      if (building.interiorLevel >= 2) {
        this.addKitchenCounter(interiorGroup, -0.4, 0.48, 0, trimMat, chromeMat);
        this.addDiningSet(interiorGroup, -0.1, 0.42, woodMat, accentMat);
      } else {
        this.addKitchenCounter(interiorGroup, -0.42, 0.48, 0, trimMat, chromeMat);
      }
      if (building.interiorLevel >= 3) {
        const yardTree = this.buildTree(0.55, 0, foliageMeshes);
        yardTree.position.set(0.72, 0.04, -0.74);
        root.add(yardTree);
      }
    } else if (building.kind === 'townhouse') {
      this.addMesh(root, this.box(W, 0.05, D), concreteMat, 0, 0.025, 0, false, true);
      const bw = 1.62;
      const bd = 1.56;
      addCutawayWalls(bw, bd, 1.48, brickRedMat, woodFloorMat, 0.05);

      this.addMesh(root, this.box(0.52, 0.08, 0.22), concreteMat, 0, 0.06, bd / 2 + 0.08);
      this.addMesh(upperShellGroup, this.box(0.32, 0.5, 0.05), darkMetalMat, -0.34, 0.35, bd / 2 + 0.01);
      for (let f = 0; f < 2; f++) {
        const wy = 0.52 + f * 0.58;
        this.addMesh(upperShellGroup, this.box(0.3, 0.34, 0.05), winMat, 0.36, wy, bd / 2 + 0.01);
        if (f === 1) {
          this.addMesh(upperShellGroup, this.box(0.3, 0.34, 0.05), winMat, -0.36, wy, bd / 2 + 0.01);
        }
        this.addMesh(upperShellGroup, this.box(0.3, 0.34, 0.05), winMat, 0, wy, -bd / 2 - 0.01);
      }

      this.addMesh(roofGroup, this.box(bw + 0.12, 0.14, bd + 0.12), trimMat, 0, 1.58, 0);
      this.addMesh(roofGroup, this.box(bw - 0.12, 0.06, bd - 0.12), darkMetalMat, 0, 1.66, 0);
      this.addSnowCap(roofGroup, snowMeshes, bw - 0.04, 0.06, bd - 0.04, 0, 1.71, 0);
      this.addMesh(roofGroup, this.box(0.45, 0.12, 0.45), winMat, 0.2, 1.72, -0.1);

      // Partition with central doorway gap (x in [-0.18..0.18]) + Bathroom partition
      this.addMesh(interiorGroup, this.box(0.48, 0.26, 0.06), trimMat, -0.46, 0.22, -0.05);
      this.addMesh(interiorGroup, this.box(0.48, 0.26, 0.06), trimMat, 0.46, 0.22, -0.05);
      this.addMesh(interiorGroup, this.box(0.06, 0.26, 0.56), trimMat, 0.08, 0.22, -0.44);
      this.addSofaSet(interiorGroup, 0.36, 0.38, Math.PI, accentMat, woodMat, rugMat);
      this.addKitchenCounter(interiorGroup, -0.38, 0.48, 0, trimMat, chromeMat);
      this.addBed(interiorGroup, -0.42, -0.42, 0, woodMat, bedSheetMat, blanketMat, indoorLampMat);
      this.addBathroomSet(interiorGroup, 0.48, -0.46, 0, bathTileMat, porcelainMat, chromeMat);
      if (building.interiorLevel >= 2) {
        this.addOfficeDesk(interiorGroup, 0.34, -0.2, 0, woodMat, accentMat, winMat);
      }
    } else if (building.kind === 'villa') {
      const yardMat = new THREE.MeshStandardMaterial({ color: 0x4a8943, roughness: 0.92 });
      yardMat.userData.baseHex = 0x4a8943;
      foliageMeshes.push(this.addMesh(root, this.box(W, 0.05, D), yardMat, 0, 0.025, 0, false, true));
      this.addMesh(root, this.box(1.15, 0.06, 1.15), concreteMat, -1.18, 0.03, 1.28, false, true);
      const bw = 3.2;
      const bd = 2.45;
      addCutawayWalls(bw, bd, 1.12, stuccoMat, woodFloorMat, 0.05);

      this.addMesh(upperShellGroup, this.box(0.95, 0.64, 0.06), trimMat, -0.95, 0.42, bd / 2 + 0.01);
      this.addMesh(upperShellGroup, this.box(0.55, 0.42, 0.06), winMat, 0.25, 0.56, bd / 2 + 0.01);
      this.addMesh(upperShellGroup, this.box(0.55, 0.42, 0.06), winMat, 1.05, 0.56, bd / 2 + 0.01);

      this.addMesh(roofGroup, this.cone(2.25, 0.85, 4), shingleRedMat, 0, 1.58, 0, true, true, Math.PI / 4);
      const roofSnowCone = new THREE.Mesh(
        this.cone(2.22, 0.85, 4),
        this.mat('snow_cap_mat', { color: 0xf1f5f9, roughness: 0.72, metalness: 0.02 }),
      );
      roofSnowCone.position.set(0, 1.63, 0);
      roofSnowCone.rotation.y = Math.PI / 4;
      roofSnowCone.visible = false;
      roofGroup.add(roofSnowCone);
      snowMeshes.push(roofSnowCone);
      this.addMesh(roofGroup, this.box(0.28, 0.45, 0.28), brickRedMat, 0.85, 1.65, -0.35);

      const poolWater = this.mat('villa_pool', { color: 0x38bdf8, roughness: 0.1, metalness: 0.15 });
      this.addMesh(root, this.box(1.55, 0.07, 0.95), concreteMat, 0.65, 0.04, -1.42);
      this.addMesh(root, this.box(1.3, 0.08, 0.7), poolWater, 0.65, 0.045, -1.42);
      // Patio lounge chair
      this.addMesh(root, this.box(0.32, 0.1, 0.52), accentMat, 0.22, 0.1, -1.42);

      // Multi-room partitions with open doorways for resident movement
      this.addMesh(interiorGroup, this.box(0.08, 0.28, 0.95), trimMat, -0.15, 0.22, -0.65);
      this.addMesh(interiorGroup, this.box(0.08, 0.28, 0.75), trimMat, -0.15, 0.22, 0.72);
      this.addMesh(interiorGroup, this.box(1.15, 0.28, 0.08), trimMat, 0.9, 0.22, -0.05);
      this.addBed(interiorGroup, 0.96, -0.68, 0, woodMat, bedSheetMat, blanketMat, indoorLampMat);
      this.addBathroomSet(interiorGroup, 1.24, -0.28, Math.PI / 2, bathTileMat, porcelainMat, chromeMat);
      this.addBed(interiorGroup, -0.96, -0.68, 0, woodMat, bedSheetMat, blanketMat);
      this.addSofaSet(interiorGroup, 0.76, 0.56, 0, accentMat, woodMat, rugMat, winMat);
      this.addKitchenCounter(interiorGroup, -0.82, 0.78, 0, trimMat, chromeMat);
      this.addDiningSet(interiorGroup, -0.85, 0.12, woodMat, accentMat);
    } else if (building.kind === 'cafe') {
      this.addMesh(root, this.box(W, 0.05, D), concreteMat, 0, 0.025, 0, false, true);
      const bw = 1.64;
      const bd = 1.48;
      addCutawayWalls(bw, bd, 1.0, brickTanMat, dinerFloorMat, 0.05);

      const cafeBrown = this.mat('cafe_brown', { color: 0x7c452b, roughness: 0.55 });
      const awningGreen = this.mat('cafe_green', { color: 0x2f6e49, roughness: 0.65 });
      this.addMesh(upperShellGroup, this.box(1.35, 0.14, 0.34), awningGreen, 0, 0.76, bd / 2 + 0.14);
      this.addMesh(upperShellGroup, this.box(1.25, 0.42, 0.05), winMat, 0, 0.44, bd / 2 + 0.01);

      this.addMesh(roofGroup, this.box(bw + 0.12, 0.12, bd + 0.12), cafeBrown, 0, 1.1, 0);
      this.addSnowCap(roofGroup, snowMeshes, bw + 0.1, 0.06, bd + 0.1, 0, 1.18, 0);
      this.addMesh(roofGroup, this.box(0.82, 0.22, 0.12), awningGreen, 0, 1.28, 0.4);

      this.addMesh(interiorGroup, this.box(1.1, 0.24, 0.26), cafeBrown, 0, 0.21, -0.45);
      this.addMesh(interiorGroup, this.box(0.32, 0.18, 0.22), winMat, -0.28, 0.36, -0.45);
      this.addMesh(interiorGroup, this.box(0.24, 0.2, 0.18), chromeMat, 0.25, 0.38, -0.45);
      this.addDiningSet(interiorGroup, -0.42, 0.28, woodMat, awningGreen);
      this.addDiningSet(interiorGroup, 0.42, 0.28, woodMat, awningGreen);
    } else if (building.kind === 'diner') {
      this.addMesh(root, this.box(W, 0.05, D), concreteMat, 0, 0.025, 0, false, true);
      const bw = 1.66;
      const bd = 1.56;
      addCutawayWalls(bw, bd, 0.96, trimMat, dinerFloorMat, 0.05);

      const dinerRed = this.mat('diner_red', { color: 0xc23e32, roughness: 0.4 });
      this.addMesh(upperShellGroup, this.box(bw + 0.04, 0.12, bd + 0.04), dinerRed, 0, 0.88, 0);
      this.addMesh(upperShellGroup, this.box(1.1, 0.08, 0.26), dinerRed, 0, 0.66, bd / 2 + 0.12);
      this.addMesh(upperShellGroup, this.box(1.22, 0.32, 0.05), winMat, 0, 0.46, bd / 2 + 0.01);
      this.addMesh(upperShellGroup, this.box(0.05, 0.32, 1.0), winMat, bw / 2 + 0.01, 0.46, 0);

      this.addMesh(roofGroup, this.box(bw + 0.14, 0.1, bd + 0.14), darkMetalMat, 0, 1.05, 0);
      this.addSnowCap(roofGroup, snowMeshes, bw + 0.1, 0.06, bd + 0.1, 0, 1.12, 0);
      this.addMesh(roofGroup, this.box(0.92, 0.24, 0.1), dinerRed, 0, 1.24, 0.35);
      this.addMesh(roofGroup, this.box(0.76, 0.12, 0.12), indoorLampMat, 0, 1.24, 0.35);
      this.addMesh(roofGroup, this.box(0.36, 0.18, 0.32), chromeMat, -0.38, 1.18, -0.3);

      this.addMesh(interiorGroup, this.box(1.12, 0.24, 0.24), chromeMat, 0, 0.21, -0.45);
      this.addMesh(interiorGroup, this.box(1.14, 0.05, 0.28), dinerRed, 0, 0.34, -0.45);
      for (let i = -1; i <= 1; i++) {
        this.addMesh(interiorGroup, this.cyl(0.07, 0.07, 0.18, 8), dinerRed, i * 0.32, 0.18, -0.18);
      }
      this.addMesh(interiorGroup, this.box(0.34, 0.22, 0.42), dinerRed, -0.52, 0.2, 0.32);
      this.addMesh(interiorGroup, this.box(0.24, 0.18, 0.26), trimMat, -0.22, 0.18, 0.32);
      this.addMesh(interiorGroup, this.box(0.34, 0.22, 0.42), dinerRed, 0.52, 0.2, 0.32);
      this.addMesh(interiorGroup, this.box(0.24, 0.18, 0.26), trimMat, 0.22, 0.18, 0.32);
      this.addMesh(interiorGroup, this.box(0.2, 0.38, 0.18), indoorLampMat, 0.62, 0.28, -0.52);
    } else if (building.kind === 'apartment') {
      this.addMesh(root, this.box(W, 0.05, D), concreteMat, 0, 0.025, 0, false, true);
      const bw = 3.4;
      const bd = 3.2;
      const wallH = building.interiorLevel >= 2 ? 2.45 : 1.95;
      addCutawayWalls(bw, bd, wallH, brickRedMat, woodFloorMat, 0.05);

      const floors = building.interiorLevel >= 2 ? 3 : 2;
      for (let f = 0; f < floors; f++) {
        const wy = 0.52 + f * 0.68;
        for (let col = -1; col <= 1; col++) {
          this.addMesh(upperShellGroup, this.box(0.46, 0.34, 0.06), winMat, col * 0.95, wy, bd / 2 + 0.01);
          this.addMesh(upperShellGroup, this.box(0.46, 0.34, 0.06), winMat, col * 0.95, wy, -bd / 2 - 0.01);
          this.addMesh(upperShellGroup, this.box(0.06, 0.34, 0.46), winMat, bw / 2 + 0.01, wy, col * 0.9);
          this.addMesh(upperShellGroup, this.box(0.06, 0.34, 0.46), winMat, -bw / 2 - 0.01, wy, col * 0.9);
        }
      }
      this.addMesh(upperShellGroup, this.box(0.68, 0.56, 0.08), darkMetalMat, 0, 0.35, bd / 2 + 0.02);
      this.addMesh(upperShellGroup, this.box(0.9, 0.12, 0.36), shingleBlueMat, 0, 0.72, bd / 2 + 0.18);

      this.addMesh(roofGroup, this.box(bw + 0.16, 0.14, bd + 0.16), trimMat, 0, wallH + 0.09, 0);
      this.addMesh(roofGroup, this.box(bw - 0.1, 0.08, bd - 0.1), darkMetalMat, 0, wallH + 0.17, 0);
      this.addSnowCap(roofGroup, snowMeshes, bw + 0.08, 0.06, bd + 0.08, 0, wallH + 0.22, 0);
      this.addMesh(roofGroup, this.cyl(0.32, 0.34, 0.5, 10), woodMat, -0.95, wallH + 0.54, -0.85);
      this.addMesh(roofGroup, this.cone(0.38, 0.22, 10), shingleBlueMat, -0.95, wallH + 0.88, -0.85);

      // 4-Unit Floorplan with central corridor doorways + Bathroom/Bed/Sofa/Kitchen per unit
      this.addMesh(interiorGroup, this.box(0.1, 0.28, 0.95), trimMat, 0, 0.22, -0.98);
      this.addMesh(interiorGroup, this.box(0.1, 0.28, 0.95), trimMat, 0, 0.22, 0.98);
      this.addMesh(interiorGroup, this.box(1.05, 0.28, 0.1), trimMat, -1.02, 0.22, 0);
      this.addMesh(interiorGroup, this.box(1.05, 0.28, 0.1), trimMat, 1.02, 0.22, 0);

      const roomOffsets: Array<[number, number]> = [
        [-0.85, -0.8],
        [0.85, -0.8],
        [-0.85, 0.8],
        [0.85, 0.8],
      ];
      roomOffsets.forEach(([rx, rz], idx) => {
        this.addBed(interiorGroup, rx - 0.42, rz - 0.32, 0, woodMat, bedSheetMat, blanketMat, idx % 2 === 0 ? indoorLampMat : undefined);
        this.addSofaSet(interiorGroup, rx + 0.28, rz + 0.25, 0, accentMat, woodMat, rugMat);
        this.addKitchenCounter(interiorGroup, rx - 0.32, rz + 0.42, 0, trimMat, chromeMat);
        this.addBathroomSet(interiorGroup, rx + 0.42, rz - 0.34, 0, bathTileMat, porcelainMat, chromeMat);
      });
    } else if (building.kind === 'supermarket') {
      this.addMesh(root, this.box(W, 0.05, D), concreteMat, 0, 0.025, 0, false, true);
      const bw = 3.55;
      const bd = 3.35;
      addCutawayWalls(bw, bd, 1.35, brickTanMat, marketFloorMat, 0.05);

      const brandBlue = this.mat('market_blue', { color: 0x2e6a9e, roughness: 0.45 });
      const produceGreen = this.mat('produce_green', { color: 0x56a34a, roughness: 0.7 });
      const shelfOrange = this.mat('shelf_orange', { color: 0xd98038, roughness: 0.6 });
      const boxRed = this.mat('shelf_red', { color: 0xc94438, roughness: 0.65 });

      this.addMesh(upperShellGroup, this.box(bw + 0.06, 0.26, bd + 0.06), brandBlue, 0, 1.24, 0);
      this.addMesh(upperShellGroup, this.box(2.4, 0.56, 0.06), winMat, 0, 0.44, bd / 2 + 0.01);
      this.addMesh(upperShellGroup, this.box(2.5, 0.12, 0.34), brandBlue, 0, 0.78, bd / 2 + 0.16);

      this.addMesh(roofGroup, this.box(bw + 0.14, 0.1, bd + 0.14), trimMat, 0, 1.44, 0);
      this.addSnowCap(roofGroup, snowMeshes, bw + 0.1, 0.06, bd + 0.1, 0, 1.51, 0);
      this.addMesh(roofGroup, this.box(1.5, 0.28, 0.14), brandBlue, 0, 1.63, bd / 2 - 0.18);
      this.addMesh(roofGroup, this.box(0.55, 0.24, 0.55), darkMetalMat, -0.9, 1.6, -0.8);
      this.addMesh(roofGroup, this.box(0.55, 0.24, 0.55), darkMetalMat, 0.9, 1.6, -0.8);

      for (let aisle = -1; aisle <= 1; aisle++) {
        const ax = aisle * 0.88;
        this.addMesh(interiorGroup, this.box(0.32, 0.38, 1.55), shelfOrange, ax, 0.28, -0.35);
        this.addMesh(interiorGroup, this.box(0.34, 0.08, 0.65), produceGreen, ax, 0.51, -0.75);
        this.addMesh(interiorGroup, this.box(0.34, 0.08, 0.65), boxRed, ax, 0.51, 0.05);
      }
      this.addMesh(interiorGroup, this.box(2.9, 0.44, 0.26), trimMat, 0, 0.31, -1.42);
      this.addMesh(interiorGroup, this.box(2.75, 0.28, 0.04), winMat, 0, 0.34, -1.28);
      const lanes = building.interiorLevel >= 2 ? 3 : 2;
      for (let c = 0; c < lanes; c++) {
        const cx = -0.85 + c * 0.85;
        this.addMesh(interiorGroup, this.box(0.32, 0.24, 0.62), brandBlue, cx, 0.21, 0.98);
        this.addMesh(interiorGroup, this.box(0.16, 0.14, 0.16), darkMetalMat, cx, 0.39, 0.85);
      }
      for (let sc = 0; sc < 3; sc++) {
        this.addMesh(interiorGroup, this.box(0.16, 0.18, 0.22), chromeMat, -1.38, 0.18, 0.72 + sc * 0.26);
      }
    } else if (building.kind === 'cinema') {
      this.addMesh(root, this.box(W, 0.05, D), concreteMat, 0, 0.025, 0, false, true);
      const bw = 3.5;
      const bd = 3.35;
      const cinemaRed = this.mat('cinema_red', { color: 0x8f2424, roughness: 0.65 });
      const velvetMat = this.mat('cinema_velvet', { color: 0xb82828, roughness: 0.9 });
      addCutawayWalls(bw, bd, 1.85, brickRedMat, marketFloorMat, 0.05);

      this.addMesh(upperShellGroup, this.box(2.2, 0.42, 0.35), cinemaRed, 0, 1.35, bd / 2 + 0.18);
      this.addMesh(upperShellGroup, this.box(2.0, 0.24, 0.38), indoorLampMat, 0, 1.35, bd / 2 + 0.18);
      this.addMesh(upperShellGroup, this.box(0.55, 0.52, 0.32), trimMat, 0, 0.36, bd / 2 + 0.14);

      this.addMesh(roofGroup, this.box(bw + 0.14, 0.14, bd + 0.14), darkMetalMat, 0, 1.96, 0);
      this.addSnowCap(roofGroup, snowMeshes, bw + 0.1, 0.06, bd + 0.1, 0, 2.04, 0);
      this.addMesh(roofGroup, this.box(1.4, 0.34, 1.4), trimMat, 0, 2.15, -0.3);

      // Lobby Carpet, Popcorn Stand, Restroom, Split Auditorium Wall (central doorway!), Screen, Seats
      this.addMesh(interiorGroup, this.box(0.65, 0.02, 1.25), velvetMat, 0, 0.1, 0.95, false, true);
      this.addMesh(interiorGroup, this.box(0.95, 0.26, 0.32), cinemaRed, -0.95, 0.22, 1.15);
      this.addBathroomSet(interiorGroup, 1.15, 1.05, Math.PI, bathTileMat, porcelainMat, chromeMat);
      this.addMesh(interiorGroup, this.box(1.25, 0.32, 0.1), trimMat, -0.98, 0.25, 0.45);
      this.addMesh(interiorGroup, this.box(1.25, 0.32, 0.1), trimMat, 0.98, 0.25, 0.45);
      this.addMesh(interiorGroup, this.box(2.75, 0.72, 0.08), winMat, 0, 0.48, -1.42);
      for (let row = 0; row < 3; row++) {
        const rz = -0.65 + row * 0.42;
        const ry = 0.16 + row * 0.06;
        for (let s = -2; s <= 2; s++) {
          this.addMesh(interiorGroup, this.box(0.32, 0.22, 0.26), velvetMat, s * 0.48, ry, rz);
        }
      }
    } else if (building.kind === 'office') {
      this.addMesh(root, this.box(W, 0.05, D), concreteMat, 0, 0.025, 0, false, true);
      const steelClad = this.mat('office_steel', { color: 0x4d5d73, roughness: 0.45, metalness: 0.35 });
      const bw = 3.25;
      const bd = 3.25;
      const wallH = building.interiorLevel >= 2 ? 3.2 : 2.55;
      addCutawayWalls(bw, bd, wallH, steelClad, marketFloorMat, 0.05);

      const floors = building.interiorLevel >= 2 ? 4 : 3;
      for (let f = 0; f < floors; f++) {
        const wy = 0.56 + f * 0.68;
        this.addMesh(upperShellGroup, this.box(bw - 0.35, 0.38, 0.06), winMat, 0, wy, bd / 2 + 0.01);
        this.addMesh(upperShellGroup, this.box(bw - 0.35, 0.38, 0.06), winMat, 0, wy, -bd / 2 - 0.01);
        this.addMesh(upperShellGroup, this.box(0.06, 0.38, bd - 0.35), winMat, bw / 2 + 0.01, wy, 0);
        this.addMesh(upperShellGroup, this.box(0.06, 0.38, bd - 0.35), winMat, -bw / 2 - 0.01, wy, 0);
      }

      this.addMesh(roofGroup, this.box(bw + 0.12, 0.16, bd + 0.12), trimMat, 0, wallH + 0.1, 0);
      this.addSnowCap(roofGroup, snowMeshes, bw + 0.06, 0.06, bd + 0.06, 0, wallH + 0.2, 0);
      this.addMesh(roofGroup, this.box(1.5, 0.42, 1.5), steelClad, 0, wallH + 0.38, 0);
      this.addMesh(roofGroup, this.cyl(0.03, 0.06, 0.9, 6), darkMetalMat, 0.4, wallH + 0.95, -0.3);

      // Boardroom + Workstations + Breakroom Kitchen + Server Racks
      this.addMesh(interiorGroup, this.box(1.3, 0.22, 0.62), woodMat, 0.35, 0.2, -0.82);
      for (let c = -1; c <= 1; c++) {
        this.addMesh(interiorGroup, this.box(0.16, 0.16, 0.16), accentMat, 0.35 + c * 0.38, 0.16, -0.4);
        this.addMesh(interiorGroup, this.box(0.16, 0.16, 0.16), accentMat, 0.35 + c * 0.38, 0.16, -1.24);
      }
      this.addKitchenCounter(interiorGroup, -0.92, -0.45, 0, trimMat, chromeMat);
      for (let dx = -1; dx <= 1; dx += 2) {
        for (let dz = 0; dz <= 1; dz++) {
          this.addOfficeDesk(interiorGroup, dx * 0.82, 0.28 + dz * 0.78, 0, woodMat, accentMat, winMat);
        }
      }
      if (building.interiorLevel >= 2) {
        this.addMesh(interiorGroup, this.box(0.36, 0.56, 0.36), darkMetalMat, -1.15, 0.36, -1.1);
        this.addMesh(interiorGroup, this.box(0.36, 0.56, 0.36), darkMetalMat, -0.7, 0.36, -1.1);
      }
    } else if (building.kind === 'police') {
      this.addMesh(root, this.box(W, 0.05, D), concreteMat, 0, 0.025, 0, false, true);
      const policeBlue = this.mat('police_blue', { color: 0x264878, roughness: 0.45 });
      const bw = 1.64;
      const bd = 1.56;
      addCutawayWalls(bw, bd, 1.15, brickTanMat, marketFloorMat, 0.05);

      this.addMesh(upperShellGroup, this.box(bw + 0.04, 0.18, bd + 0.04), policeBlue, 0, 1.05, 0);
      this.addMesh(upperShellGroup, this.box(0.95, 0.32, 0.05), winMat, 0, 0.52, bd / 2 + 0.01);
      this.addMesh(roofGroup, this.box(bw + 0.12, 0.1, bd + 0.12), trimMat, 0, 1.2, 0);
      this.addSnowCap(roofGroup, snowMeshes, bw + 0.08, 0.06, bd + 0.08, 0, 1.27, 0);
      this.addMesh(roofGroup, this.cyl(0.03, 0.05, 0.5, 6), darkMetalMat, 0.4, 1.48, -0.3);

      this.addOfficeDesk(interiorGroup, 0.26, 0.22, 0, woodMat, policeBlue, winMat);
      this.addMesh(interiorGroup, this.box(0.45, 0.42, 0.25), darkMetalMat, -0.48, 0.3, -0.45);
      this.addMesh(interiorGroup, this.box(0.55, 0.36, 0.06), chromeMat, 0.42, 0.27, -0.25);
      this.addBed(interiorGroup, 0.46, -0.48, 0, darkMetalMat, bedSheetMat, policeBlue);
    } else if (building.kind === 'hospital') {
      this.addMesh(root, this.box(W, 0.05, D), concreteMat, 0, 0.025, 0, false, true);
      const clinicTeal = this.mat('clinic_teal', { color: 0x3b8c8c, roughness: 0.4 });
      const crossRed = this.mat('cross_red', { color: 0xd63636, roughness: 0.45 });
      const bw = 3.45;
      const bd = 3.25;
      addCutawayWalls(bw, bd, 1.75, trimMat, marketFloorMat, 0.05);

      this.addMesh(upperShellGroup, this.box(bw + 0.04, 0.2, bd + 0.04), clinicTeal, 0, 1.56, 0);
      this.addMesh(upperShellGroup, this.box(2.2, 0.42, 0.06), winMat, 0, 0.72, bd / 2 + 0.01);
      this.addMesh(roofGroup, this.box(bw + 0.12, 0.12, bd + 0.12), trimMat, 0, 1.82, 0);
      this.addSnowCap(roofGroup, snowMeshes, bw + 0.08, 0.055, bd + 0.08, 0, 1.89, 0);
      this.addMesh(roofGroup, this.box(0.9, 0.1, 0.28), crossRed, 0, 1.94, 0);
      this.addMesh(roofGroup, this.box(0.28, 0.1, 0.9), crossRed, 0, 1.94, 0);

      this.addMesh(interiorGroup, this.box(1.15, 0.26, 0.3), clinicTeal, -0.75, 0.22, 0.95);
      this.addMesh(interiorGroup, this.box(0.24, 0.14, 0.04), winMat, -0.75, 0.42, 0.95);
      for (let w = 0; w < 3; w++) {
        this.addMesh(interiorGroup, this.box(0.22, 0.16, 0.22), clinicTeal, 0.55 + w * 0.36, 0.17, 1.05);
      }
      for (let b = -1; b <= 1; b++) {
        const bx = b * 1.0;
        this.addBed(interiorGroup, bx, -0.72, 0, chromeMat, bedSheetMat, clinicTeal, indoorLampMat);
        if (b < 1) {
          this.addMesh(interiorGroup, this.box(0.05, 0.32, 0.95), trimMat, bx + 0.5, 0.25, -0.72);
        }
      }
    } else if (building.kind === 'powerplant') {
      this.addMesh(root, this.box(W, 0.05, D), concreteMat, 0, 0.025, 0, false, true);
      const industrialFloor = this.mat('ind_floor', { color: 0x5d646e, roughness: 0.85 });
      const hazardYellow = this.mat('hazard_yellow', { color: 0xdca02e, roughness: 0.5 });
      const copperMat = this.mat('copper_coil', { color: 0xb86f3d, roughness: 0.32, metalness: 0.75 });
      const bw = 3.4;
      const bd = 3.2;
      addCutawayWalls(bw, bd, 1.5, brickRedMat, industrialFloor, 0.05);

      this.addMesh(upperShellGroup, this.box(bw + 0.05, 0.14, bd + 0.05), hazardYellow, 0, 1.46, 0);
      this.addMesh(upperShellGroup, this.box(1.8, 0.36, 0.06), winMat, 0, 0.95, bd / 2 + 0.01);

      this.addMesh(roofGroup, this.box(bw + 0.12, 0.12, bd + 0.12), darkMetalMat, 0, 1.6, 0);
      this.addSnowCap(roofGroup, snowMeshes, bw + 0.08, 0.06, bd + 0.08, 0, 1.68, 0);
      this.addMesh(roofGroup, this.cyl(0.26, 0.34, 1.45, 10), brickRedMat, -0.95, 2.25, -0.85);
      this.addMesh(roofGroup, this.cyl(0.26, 0.34, 1.45, 10), brickRedMat, 0.25, 2.25, -0.85);
      this.addMesh(roofGroup, this.cyl(0.28, 0.28, 0.18, 10), hazardYellow, -0.95, 2.86, -0.85);
      this.addMesh(roofGroup, this.cyl(0.28, 0.28, 0.18, 10), hazardYellow, 0.25, 2.86, -0.85);

      const turbines = building.interiorLevel >= 2 ? 3 : 2;
      for (let t = 0; t < turbines; t++) {
        const tx = -0.9 + t * 0.9;
        this.addMesh(interiorGroup, this.cyl(0.32, 0.32, 1.2, 10), darkMetalMat, tx, 0.42, -0.3, true, true, Math.PI / 2);
        this.addMesh(interiorGroup, this.box(0.45, 0.42, 0.45), copperMat, tx, 0.32, 0.65);
      }
      this.addMesh(interiorGroup, this.box(1.1, 0.3, 0.28), indoorLampMat, 0.6, 0.24, 1.12);
    }

    root.add(interiorGroup);
    root.add(upperShellGroup);
    root.add(roofGroup);

    root.rotation.y = (building.rotation * Math.PI) / 2;

    return {
      root,
      roofGroup,
      upperShellGroup,
      interiorGroup,
      windowMaterials,
      lampMaterials,
      snowMeshes,
      foliageMeshes,
      baseScaleY: 1,
      popProgress: 0,
    };
  }

  public buildVehicle(colorHex: number, kind: VehicleKind): BuiltVehicleVisual {
    const root = new THREE.Group();
    const isEmergency = kind === 'police' || kind === 'ambulance';
    const bodyColor = kind === 'police' ? 0x1e293b : kind === 'ambulance' ? 0xf8fafc : colorHex;
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.35, metalness: 0.25 });
    const glassMat = this.mat('car_glass', { color: 0x263547, roughness: 0.12, metalness: 0.3 });
    const tireMat = this.mat('car_tire', { color: 0x1e2229, roughness: 0.9 });
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xfff6d1,
      emissive: new THREE.Color(0xffe082),
      emissiveIntensity: 0.15,
      roughness: 0.2,
    });
    const tailMat = this.mat('car_tail', {
      color: 0xd93829,
      emissive: new THREE.Color(0xd93829),
      emissiveIntensity: 0.35,
      roughness: 0.3,
    });

    root.add(this.createContactShadow(0.52, 0.88));

    const bodyLen = kind === 'van' || kind === 'ambulance' ? 0.82 : 0.72;
    const bodyH = kind === 'van' || kind === 'ambulance' ? 0.26 : 0.18;
    const cabH = kind === 'van' || kind === 'ambulance' ? 0.2 : 0.16;

    this.addMesh(root, this.box(0.38, bodyH, bodyLen), bodyMat, 0, 0.08 + bodyH / 2, 0);
    this.addMesh(
      root,
      this.box(0.32, cabH, kind === 'van' || kind === 'ambulance' ? 0.62 : 0.4),
      glassMat,
      0,
      0.08 + bodyH + cabH / 2 - 0.02,
      kind === 'van' || kind === 'ambulance' ? -0.04 : -0.05,
    );
    this.addMesh(
      root,
      this.box(0.33, 0.04, kind === 'van' || kind === 'ambulance' ? 0.63 : 0.38),
      kind === 'police' ? this.mat('police_roof', { color: 0xf8fafc, roughness: 0.4 }) : bodyMat,
      0,
      0.08 + bodyH + cabH,
      kind === 'van' || kind === 'ambulance' ? -0.04 : -0.05,
    );

    if (kind === 'taxi') {
      const signMat = this.mat('taxi_sign', {
        color: 0xffd54f,
        emissive: new THREE.Color(0xffca28),
        emissiveIntensity: 0.5,
      });
      this.addMesh(root, this.box(0.14, 0.06, 0.08), signMat, 0, 0.08 + bodyH + cabH + 0.05, -0.04);
    }

    let beaconMat: THREE.MeshStandardMaterial | undefined;
    if (isEmergency) {
      beaconMat = new THREE.MeshStandardMaterial({
        color: kind === 'police' ? 0x3b82f6 : 0xef4444,
        emissive: new THREE.Color(kind === 'police' ? 0x3b82f6 : 0xef4444),
        emissiveIntensity: 1.5,
        roughness: 0.2,
      });
      this.addMesh(root, this.box(0.22, 0.06, 0.08), beaconMat, 0, 0.08 + bodyH + cabH + 0.05, 0.02, false, false);
      if (kind === 'ambulance') {
        const stripeMat = this.mat('amb_stripe', { color: 0xd63636, roughness: 0.4 });
        this.addMesh(root, this.box(0.39, 0.06, 0.68), stripeMat, 0, 0.08 + bodyH * 0.55, 0);
      }
    }

    const wheelOffsets: Array<[number, number]> = [
      [-0.18, 0.22],
      [0.18, 0.22],
      [-0.18, -0.22],
      [0.18, -0.22],
    ];
    wheelOffsets.forEach(([wx, wz]) => {
      const w = this.addMesh(root, this.cyl(0.08, 0.08, 0.06, 8), tireMat, wx, 0.08, wz);
      w.rotation.z = Math.PI / 2;
    });

    this.addMesh(root, this.box(0.08, 0.05, 0.03), headlightMat, -0.11, 0.16, bodyLen / 2 + 0.01, false, false);
    this.addMesh(root, this.box(0.08, 0.05, 0.03), headlightMat, 0.11, 0.16, bodyLen / 2 + 0.01, false, false);
    this.addMesh(root, this.box(0.08, 0.05, 0.03), tailMat, -0.11, 0.16, -bodyLen / 2 - 0.01, false, false);
    this.addMesh(root, this.box(0.08, 0.05, 0.03), tailMat, 0.11, 0.16, -bodyLen / 2 - 0.01, false, false);

    return { root, headlightMat, beaconMat };
  }

  public buildCitizen(shirtHex: number, pantsHex: number): BuiltCitizenVisual {
    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    const shirtMat = new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.8 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: pantsHex, roughness: 0.85 });
    const skinMat = this.mat('citizen_skin', { color: 0xe6baa0, roughness: 0.75 });
    const hairMat = this.mat('citizen_hair', { color: 0x3b2a1e, roughness: 0.9 });

    root.add(this.createContactShadow(0.24, 0.24));

    const leftLeg = this.addMesh(root, this.box(0.055, 0.14, 0.055), pantsMat, -0.04, 0.08, 0);
    const rightLeg = this.addMesh(root, this.box(0.055, 0.14, 0.055), pantsMat, 0.04, 0.08, 0);
    this.addMesh(root, this.box(0.14, 0.16, 0.09), shirtMat, 0, 0.22, 0);
    const leftArm = this.addMesh(root, this.box(0.045, 0.13, 0.045), shirtMat, -0.095, 0.21, 0);
    const rightArm = this.addMesh(root, this.box(0.045, 0.13, 0.045), shirtMat, 0.095, 0.21, 0);
    this.addMesh(root, this.box(0.1, 0.1, 0.1), skinMat, 0, 0.35, 0);
    this.addMesh(root, this.box(0.105, 0.04, 0.105), hairMat, 0, 0.41, 0);

    return { root, leftLeg, rightLeg, leftArm, rightArm };
  }

  public setWeatherSurfaceState(rainAmount: number, snowAmount: number): void {
    const asphalt = this.sharedMaterials.get('asphalt_mat') as THREE.MeshStandardMaterial | undefined;
    if (asphalt) {
      // Wet asphalt becomes dark and mirror-glossy during rain
      asphalt.roughness = THREE.MathUtils.lerp(0.92, 0.14, Math.min(1, rainAmount + snowAmount * 0.35));
      asphalt.metalness = THREE.MathUtils.lerp(0.04, 0.34, rainAmount);
      const shade = 1 - rainAmount * 0.32 + snowAmount * 0.1;
      asphalt.color.setRGB(shade, shade, shade + snowAmount * 0.08 + rainAmount * 0.04);
    }

    const sidewalk = this.sharedMaterials.get('sidewalk_mat') as THREE.MeshStandardMaterial | undefined;
    if (sidewalk) {
      sidewalk.roughness = THREE.MathUtils.lerp(0.88, 0.42, rainAmount * 0.7);
      const s = 1 - rainAmount * 0.14 + snowAmount * 0.18;
      sidewalk.color.setRGB(s, s, Math.min(1, s + snowAmount * 0.2));
    }

    const lotConcrete = this.sharedMaterials.get('lot_concrete') as THREE.MeshStandardMaterial | undefined;
    if (lotConcrete) {
      const s = 1 - rainAmount * 0.1 + snowAmount * 0.16;
      lotConcrete.color.setRGB(s, s, Math.min(1, s + snowAmount * 0.18));
    }
  }

  public dispose(): void {
    this.sharedGeos.forEach((g) => g.dispose());
    this.sharedGeos.clear();
    this.sharedMaterials.forEach((m) => m.dispose());
    this.sharedMaterials.clear();
  }
}
