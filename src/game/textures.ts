import * as THREE from 'three';

export interface CityTextureSet {
  grass: THREE.CanvasTexture;
  snowGrass: THREE.CanvasTexture;
  grassBump: THREE.CanvasTexture;
  asphalt: THREE.CanvasTexture;
  sidewalk: THREE.CanvasTexture;
  brickRed: THREE.CanvasTexture;
  brickTan: THREE.CanvasTexture;
  shingleBlue: THREE.CanvasTexture;
  shingleRed: THREE.CanvasTexture;
  dinerFloor: THREE.CanvasTexture;
  woodFloor: THREE.CanvasTexture;
  marketFloor: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  dispose: () => void;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function finalizeColorTexture(
  canvas: HTMLCanvasElement,
  repeatX = 1,
  repeatY = 1,
  maxAnisotropy = 4,
  pixelated = true,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = maxAnisotropy;
  if (pixelated) {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
  }
  tex.needsUpdate = true;
  return tex;
}

function finalizeDataTexture(
  canvas: HTMLCanvasElement,
  repeatX = 1,
  repeatY = 1,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.needsUpdate = true;
  return tex;
}

export function createCityTextures(maxAnisotropy = 4): CityTextureSet {
  // 1. Retro 1998 Grass Tile (subtle grid parcel lines + pixel foliage dither)
  const [gCanvas, gCtx] = makeCanvas(128, 128);
  gCtx.fillStyle = '#4e8c45';
  gCtx.fillRect(0, 0, 128, 128);
  // Subtle two-tone checkerboard like Metropolis 1998
  gCtx.fillStyle = '#488340';
  gCtx.fillRect(0, 0, 64, 64);
  gCtx.fillRect(64, 64, 64, 64);
  // Pixel grass tufts
  for (let i = 0; i < 240; i++) {
    const px = Math.floor(((i * 53) % 128) / 2) * 2;
    const py = Math.floor(((i * 97) % 128) / 2) * 2;
    gCtx.fillStyle = i % 3 === 0 ? '#60a253' : '#3d7236';
    gCtx.fillRect(px, py, 2, 2);
  }
  // Subtle parcel border
  gCtx.strokeStyle = 'rgba(28, 56, 26, 0.22)';
  gCtx.lineWidth = 2;
  gCtx.strokeRect(1, 1, 62, 62);
  gCtx.strokeRect(65, 65, 62, 62);
  const grass = finalizeColorTexture(gCanvas, 11, 11, maxAnisotropy, true);

  // 1b. Frosted Winter Snow Ground Tile (matching 11x11 checkerboard parcel layout)
  const [sgCanvas, sgCtx] = makeCanvas(128, 128);
  sgCtx.fillStyle = '#e7eff7';
  sgCtx.fillRect(0, 0, 128, 128);
  sgCtx.fillStyle = '#dce7f2';
  sgCtx.fillRect(0, 0, 64, 64);
  sgCtx.fillRect(64, 64, 64, 64);
  for (let i = 0; i < 180; i++) {
    const px = Math.floor(((i * 53) % 128) / 2) * 2;
    const py = Math.floor(((i * 97) % 128) / 2) * 2;
    sgCtx.fillStyle = i % 2 === 0 ? '#ffffff' : '#cad9e8';
    sgCtx.fillRect(px, py, 2, 2);
  }
  sgCtx.strokeStyle = 'rgba(130, 152, 176, 0.28)';
  sgCtx.lineWidth = 2;
  sgCtx.strokeRect(1, 1, 62, 62);
  sgCtx.strokeRect(65, 65, 62, 62);
  const snowGrass = finalizeColorTexture(sgCanvas, 11, 11, maxAnisotropy, true);

  // Grass micro-bump
  const [gbCanvas, gbCtx] = makeCanvas(64, 64);
  gbCtx.fillStyle = '#808080';
  gbCtx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 180; i++) {
    const v = 100 + ((i * 37) % 55);
    gbCtx.fillStyle = `rgb(${v},${v},${v})`;
    gbCtx.fillRect((i * 19) % 64, (i * 29) % 64, 2, 2);
  }
  const grassBump = finalizeDataTexture(gbCanvas, 22, 22);

  // 2. Asphalt Road Aggregate
  const [aCanvas, aCtx] = makeCanvas(64, 64);
  aCtx.fillStyle = '#363b44';
  aCtx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 220; i++) {
    aCtx.fillStyle = i % 2 === 0 ? '#2f343d' : '#404652';
    aCtx.fillRect((i * 17) % 64, (i * 31) % 64, 2, 2);
  }
  const asphalt = finalizeColorTexture(aCanvas, 1, 1, maxAnisotropy, true);

  // 3. Sidewalk Concrete Slabs
  const [sCanvas, sCtx] = makeCanvas(64, 64);
  sCtx.fillStyle = '#9aa0a6';
  sCtx.fillRect(0, 0, 64, 64);
  sCtx.strokeStyle = '#7b8187';
  sCtx.lineWidth = 2;
  sCtx.strokeRect(1, 1, 30, 30);
  sCtx.strokeRect(33, 1, 30, 30);
  sCtx.strokeRect(1, 33, 30, 30);
  sCtx.strokeRect(33, 33, 30, 30);
  const sidewalk = finalizeColorTexture(sCanvas, 1, 1, maxAnisotropy, true);

  // 4. Brick Textures (Red & Tan)
  const makeBrick = (base: string, mortar: string, shade: string) => {
    const [c, ctx] = makeCanvas(64, 64);
    ctx.fillStyle = mortar;
    ctx.fillRect(0, 0, 64, 64);
    for (let row = 0; row < 8; row++) {
      const y = row * 8;
      const offset = (row % 2) * 8;
      for (let col = -1; col < 5; col++) {
        const x = col * 16 + offset;
        ctx.fillStyle = (row + col) % 3 === 0 ? shade : base;
        ctx.fillRect(x + 1, y + 1, 14, 6);
      }
    }
    return finalizeColorTexture(c, 2, 2, maxAnisotropy, true);
  };
  const brickRed = makeBrick('#9d4c3e', '#6f4b44', '#8b3f33');
  const brickTan = makeBrick('#c9a87c', '#9d8260', '#bc9a6e');

  // 5. Roof Shingles
  const makeShingles = (base: string, line: string, hi: string) => {
    const [c, ctx] = makeCanvas(64, 64);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 64, 64);
    for (let row = 0; row < 8; row++) {
      const y = row * 8;
      ctx.fillStyle = line;
      ctx.fillRect(0, y + 7, 64, 1);
      for (let col = 0; col < 4; col++) {
        const x = col * 16 + (row % 2) * 8;
        ctx.fillStyle = hi;
        ctx.fillRect((x + 2) % 64, y + 2, 10, 2);
      }
    }
    return finalizeColorTexture(c, 2, 2, maxAnisotropy, true);
  };
  const shingleBlue = makeShingles('#42566e', '#2d3b4d', '#506784');
  const shingleRed = makeShingles('#8f4539', '#662f26', '#a45345');

  // 6. Interior Floors (Diner Checkered, Warm Hardwood, Market Terrazzo)
  const [dfC, dfCtx] = makeCanvas(64, 64);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      dfCtx.fillStyle = (x + y) % 2 === 0 ? '#e8e0cf' : '#2a2f3a';
      dfCtx.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  const dinerFloor = finalizeColorTexture(dfC, 2, 2, maxAnisotropy, true);

  const [wfC, wfCtx] = makeCanvas(64, 64);
  wfCtx.fillStyle = '#b9895b';
  wfCtx.fillRect(0, 0, 64, 64);
  wfCtx.fillStyle = '#9e7045';
  for (let y = 0; y < 64; y += 8) {
    wfCtx.fillRect(0, y, 64, 1);
    wfCtx.fillRect(((y * 3) % 48) + 8, y, 1, 8);
  }
  const woodFloor = finalizeColorTexture(wfC, 2, 2, maxAnisotropy, true);

  const [mfC, mfCtx] = makeCanvas(64, 64);
  mfCtx.fillStyle = '#cfd7de';
  mfCtx.fillRect(0, 0, 64, 64);
  mfCtx.strokeStyle = '#aeb9c4';
  mfCtx.lineWidth = 1;
  for (let i = 0; i < 64; i += 16) {
    mfCtx.strokeRect(i, 0, 16, 64);
    mfCtx.strokeRect(0, i, 64, 16);
  }
  const marketFloor = finalizeColorTexture(mfC, 3, 3, maxAnisotropy, true);

  // 7. Soft Radial Contact Shadow
  const [csC, csCtx] = makeCanvas(64, 64);
  const grad = csCtx.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(12, 16, 22, 0.55)');
  grad.addColorStop(0.6, 'rgba(12, 16, 22, 0.22)');
  grad.addColorStop(1, 'rgba(12, 16, 22, 0)');
  csCtx.fillStyle = grad;
  csCtx.fillRect(0, 0, 64, 64);
  const contactShadow = new THREE.CanvasTexture(csC);
  contactShadow.needsUpdate = true;

  return {
    grass,
    snowGrass,
    grassBump,
    asphalt,
    sidewalk,
    brickRed,
    brickTan,
    shingleBlue,
    shingleRed,
    dinerFloor,
    woodFloor,
    marketFloor,
    contactShadow,
    dispose: () => {
      grass.dispose();
      snowGrass.dispose();
      grassBump.dispose();
      asphalt.dispose();
      sidewalk.dispose();
      brickRed.dispose();
      brickTan.dispose();
      shingleBlue.dispose();
      shingleRed.dispose();
      dinerFloor.dispose();
      woodFloor.dispose();
      marketFloor.dispose();
      contactShadow.dispose();
    },
  };
}
