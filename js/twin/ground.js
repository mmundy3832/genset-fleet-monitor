// Ground: real aerial imagery (keyless Esri World Imagery tiles, CORS enabled) stitched into
// canvases at three zoom levels around the site pin, over a procedural fallback plane.
// World frame: +X east, -Z north; the pin is the origin.
import * as THREE from 'three';

const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const IMAGERY_ATTRIBUTION = 'Imagery: Esri, Maxar, Earthstar Geographics';
const TILE = 256;
const EARTH = 156543.03392;   // meters per pixel at zoom 0 on the equator

export function metersPerPixel(lat, zoom) {
  return (EARTH * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

function project(lat, lon, zoom) {
  const n = Math.pow(2, zoom);
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n * TILE, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * TILE };
}

function loadTile(z, x, y, timeoutMs) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => { img.src = ''; reject(new Error('tile timeout')); }, timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('tile error')); };
    img.src = TILE_URL.replace('{z}', z).replace('{y}', y).replace('{x}', x);
  });
}

// One stitched layer: n x n tiles around the pin at a zoom level.
async function loadLayer(lat, lon, zoom, n, timeoutMs) {
  const c = project(lat, lon, zoom);
  const tx0 = Math.round(c.x / TILE - n / 2), ty0 = Math.round(c.y / TILE - n / 2);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n * TILE;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const jobs = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    jobs.push(loadTile(zoom, tx0 + i, ty0 + j, timeoutMs).then((img) => { ctx.drawImage(img, i * TILE, j * TILE); return true; }));
  }
  const res = await Promise.allSettled(jobs);
  const ok = res.filter((r) => r.status === 'fulfilled').length;
  if (ok < jobs.length * 0.9) throw new Error('imagery layer z' + zoom + ' incomplete (' + ok + '/' + jobs.length + ')');
  // throws SecurityError here if a tile tainted the canvas
  const probe = ctx.getImageData(0, 0, 4, 4).data;
  if (!probe) throw new Error('canvas unreadable');
  const mpp = metersPerPixel(lat, zoom);
  const size = n * TILE * mpp;
  // offset of the canvas center from the pin, in meters (pixel y grows south = +Z)
  const ox = ((tx0 + n / 2) * TILE - c.x) * mpp, oz = ((ty0 + n / 2) * TILE - c.y) * mpp;
  return { canvas, ctx, size, ox, oz, zoom };
}

function averageColor(layer) {
  const s = 16;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  x.drawImage(layer.canvas, 0, 0, s, s);
  const d = x.getImageData(0, 0, s, s).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
}

function layerMesh(layer, y, maxAniso) {
  const tex = new THREE.CanvasTexture(layer.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, envMapIntensity: 0.55 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(layer.size, layer.size), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(layer.ox, y, layer.oz);
  m.receiveShadow = true;
  m.userData.noAO = false;
  return m;
}

// Value noise, a few octaves, deterministic.
function makeNoise(seed) {
  const N = 64, g = new Float32Array(N * N);
  let s = seed >>> 0;
  for (let i = 0; i < g.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; g[i] = s / 4294967296; }
  const at = (x, y) => g[((y % N + N) % N) * N + ((x % N + N) % N)];
  const smooth = (t) => t * t * (3 - 2 * t);
  const one = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y, oct) => { let v = 0, amp = 0.5, f = 1, n = 0; for (let o = 0; o < oct; o++) { v += one(x * f, y * f) * amp; n += amp; amp *= 0.5; f *= 2.03; } return v / n; };
}

// Paints graded, compacted ground (caliche and dust with darker patches, scuffs and fine grit)
// into a canvas. One canvas spans the whole surface, so nothing tiles. The tonal noise is
// computed small and scaled up by the canvas, and the grit is a multiplied pattern, so even a
// 2048 px surface costs a few milliseconds.
let gritTile = null;
function gritPattern(ctx) {
  if (!gritTile) {
    gritTile = document.createElement('canvas');
    gritTile.width = gritTile.height = 256;
    const g = gritTile.getContext('2d');
    const img = g.createImageData(256, 256);
    let seed = 4242;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 256 * 256; i++) {
      const r = rnd();
      const v = r > 0.985 ? 150 : 205 + (rnd() - 0.5) * 100;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  return ctx.createPattern(gritTile, 'repeat');
}

export function paintGround(size, color, opts) {
  opts = opts || {};
  const L = 192;
  const low = document.createElement('canvas');
  low.width = low.height = L;
  const lctx = low.getContext('2d');
  const img = lctx.createImageData(L, L);
  const noise = makeNoise(opts.seed || 7);
  const toS = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) {
    const u = x / L, v = y / L;
    const broad = noise(u * 5, v * 5, 4);                 // large tonal patches
    const mid = noise(u * 24 + 9, v * 24 + 3, 2);         // scuffs
    const k = 0.9 + (broad - 0.5) * 0.5 + (mid - 0.5) * 0.24;
    const warm = (noise(u * 3 + 40, v * 3 + 17, 2) - 0.5) * 0.08;
    const i = (y * L + x) * 4;
    img.data[i] = toS(Math.max(0, color.r * k * (1 + warm)));
    img.data[i + 1] = toS(Math.max(0, color.g * k));
    img.data[i + 2] = toS(Math.max(0, color.b * k * (1 - warm)));
    img.data[i + 3] = 255;
  }
  lctx.putImageData(img, 0, 0);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(low, 0, 0, size, size);
  const grit = opts.grit != null ? opts.grit : 0.16;
  if (grit > 0) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = Math.min(1, grit * 3);
    ctx.fillStyle = gritPattern(ctx);
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 1;
  }
  if (opts.feather) {
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.5 * opts.feather[0], size / 2, size / 2, size * 0.5 * opts.feather[1]);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.5, 'rgba(0,0,0,0.62)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Soft-edged graded apron under the modeled site so real rooftops in the imagery do not
// show through the model. Tinted from the imagery so it reads as cleared ground.
function apronMesh(radius, color, center) {
  const map = paintGround(2048, color, { feather: [0.6, 0.98], seed: 11, grit: 0.07 });
  const mat = new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 1, metalness: 0, envMapIntensity: 0.55 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(center.x, 0, center.z);
  m.renderOrder = 1;
  m.receiveShadow = true;
  m.userData.keepInAO = true;
  return m;
}

// Builds the ground for a site. Resolves once the base plane exists and imagery has either
// loaded or failed; opts.timeoutMs bounds the wait.
// Returns { group, imagery: boolean, attribution, dispose() }.
export async function buildGround(opts) {
  const group = new THREE.Group();
  group.name = 'ground';
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(60000, 60000),
    new THREE.MeshStandardMaterial({ color: opts.kind === 'wellpad' ? 0x9c8b6c : 0x7f806a, roughness: 1, metalness: 0, envMapIntensity: 0.55 })
  );
  base.rotation.x = -Math.PI / 2;
  base.position.y = -1.8;
  base.receiveShadow = false;
  group.add(base);
  const disposables = [base.geometry, base.material];
  const out = { group, imagery: false, attribution: '', dispose() { disposables.forEach((d) => d.dispose()); } };
  const maxAniso = opts.maxAnisotropy || 8;

  let layers = null;
  if (opts.imagery !== false && isFinite(opts.lat) && isFinite(opts.lon)) {
    const t = opts.timeoutMs || 5000;
    try {
      // near: about 380 m at 0.25 m/px. mid: about 1.2 km. far: about 9 km for the high fly-in.
      layers = await Promise.all([
        opts.near === false ? loadLayer(opts.lat, opts.lon, 17, 6, t) : loadLayer(opts.lat, opts.lon, 19, 6, t),
        opts.near === false ? null : loadLayer(opts.lat, opts.lon, 17, 5, t),
        loadLayer(opts.lat, opts.lon, 14, 4, t)
      ]);
      layers = layers.filter(Boolean);
    } catch (err) {
      console.info('[twin] aerial imagery unavailable, using procedural ground (' + err.message + ')');
      layers = null;
    }
  }

  let tint = new THREE.Color(opts.kind === 'wellpad' ? 0xb09c7c : 0x9a917c);
  if (layers) {
    const ys = [-0.5, -0.8, -1.2];     // well under the site ground; invisible from the air
    layers.forEach((l, i) => {
      const m = layerMesh(l, ys[i + (3 - layers.length)], maxAniso);
      group.add(m);
      disposables.push(m.geometry, m.material, m.material.map);
    });
    const far = averageColor(layers[layers.length - 1]);
    base.material.color.copy(far);
    out.horizonTint = far;
    out.nearTint = averageColor(layers[layers.length - 2]);
    tint = averageColor(layers[layers.length - 2]).lerp(new THREE.Color(0xb3a78f), 0.6);
    out.imagery = true;
    out.attribution = IMAGERY_ATTRIBUTION;
  }
  if (!layers) base.position.y = Math.min(base.position.y, -0.12);

  // The apron needs the site footprint, which is known only after the site is built.
  out.addApron = (siteRadius, center) => {
    if (opts.apron === false) return;
    const a = apronMesh(Math.max(70, siteRadius * 1.1), tint, center || new THREE.Vector3());
    a.position.y = -0.04;
    group.add(a);
    disposables.push(a.geometry, a.material, a.material.map);
  };
  return out;
}
