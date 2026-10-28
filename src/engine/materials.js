import * as THREE from 'three';
import { noise, rng } from './noise.js';

// ---------- Procedural textures (generated once, cached) ----------

const cache = new Map();

function tileableHeight(size, scale, octaves, seedOffset = 0) {
  const h = new Float32Array(size * size);
  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    const cy = Math.cos(v * TAU), sy = Math.sin(v * TAU);
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const cx = Math.cos(u * TAU), sx = Math.sin(u * TAU);
      let amp = 1, freq = scale, sum = 0, norm = 0;
      for (let o = 0; o < octaves; o++) {
        sum += amp * noise.noise4(cx * freq + seedOffset, sx * freq, cy * freq, sy * freq);
        norm += amp;
        amp *= 0.5;
        freq *= 2;
      }
      h[y * size + x] = sum / norm;
    }
  }
  return h;
}

function cellularHeight(size, cells, seed = 3) {
  // Tileable Worley noise (F2 - F1) – reads as cobblestone / cell borders.
  const r = rng(seed);
  const pts = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([(i + r()) / cells, (j + r()) / cells]);
  const h = new Float32Array(size * size);
  const cellSize = 1 / cells;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const ci = Math.floor(u * cells), cj = Math.floor(v * cells);
      let f1 = 9, f2 = 9;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = (ci + di + cells) % cells, jj = (cj + dj + cells) % cells;
          const p = pts[jj * cells + ii];
          let dx = p[0] + (ci + di - ((ci + di + cells) % cells)) * cellSize - u;
          let dy = p[1] + (cj + dj - ((cj + dj + cells) % cells)) * cellSize - v;
          const d = Math.sqrt(dx * dx + dy * dy) / cellSize;
          if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
        }
      }
      h[y * size + x] = Math.min(1, (f2 - f1) * 2.2);
    }
  }
  return h;
}

function heightToNormalTexture(h, size, strength) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const d = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function organicNormalMap() {
  if (!cache.has('organic')) {
    const size = 256;
    cache.set('organic', heightToNormalTexture(tileableHeight(size, 1.6, 5), size, 6));
  }
  return cache.get('organic');
}

export function cellNormalMap() {
  if (!cache.has('cells')) {
    const size = 256;
    const h = cellularHeight(size, 9);
    const o = tileableHeight(size, 2.5, 3, 11);
    for (let i = 0; i < h.length; i++) h[i] = h[i] * 0.85 + o[i] * 0.15;
    cache.set('cells', heightToNormalTexture(h, size, 3.2));
  }
  return cache.get('cells');
}

export function glowTexture() {
  if (!cache.has('glow')) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    cache.set('glow', tex);
  }
  return cache.get('glow');
}

// ---------- Material factories ----------

/** Wet, velvety living tissue. */
export function tissue({
  color = '#d9817a',
  sheen = '#ffc2b8',
  roughness = 0.42,
  clearcoat = 0.6,
  clearcoatRoughness = 0.28,
  normal = 'organic',
  normalScale = 0.5,
  repeat = [2, 2],
  emissive = '#000000',
  emissiveIntensity = 1,
  sheenAmount = 0.6,
  ...rest
} = {}) {
  const map = normal === 'cells' ? cellNormalMap() : normal === 'organic' ? organicNormalMap() : null;
  const m = new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0,
    clearcoat,
    clearcoatRoughness,
    sheen: sheenAmount,
    sheenColor: new THREE.Color(sheen),
    sheenRoughness: 0.55,
    emissive,
    emissiveIntensity,
    ...rest,
  });
  if (map) {
    m.normalMap = map.clone();
    m.normalMap.repeat.set(repeat[0], repeat[1]);
    m.normalMap.needsUpdate = true;
    m.normalScale = new THREE.Vector2(normalScale, normalScale);
  }
  return m;
}

/** Translucent cell membrane: lit like glass, alpha rises at grazing angles (fresnel). */
export function membrane({ color = '#ffe7c2', minAlpha = 0.08, maxAlpha = 0.75, roughness = 0.18, ...rest } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.15,
    transparent: true,
    depthWrite: false,
    ...rest,
  });
  m.userData.fresnel = { minAlpha, maxAlpha };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uMinA = { value: minAlpha };
    shader.uniforms.uMaxA = { value: maxAlpha };
    m.userData.shader = shader;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uMinA;\nuniform float uMaxA;')
      .replace(
        '#include <opaque_fragment>',
        `float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);
        diffuseColor.a = mix(uMinA, uMaxA, fr) * opacity;
        #include <opaque_fragment>`
      );
  };
  m.customProgramCacheKey = () => 'membrane';
  return m;
}

/** Additive glowing sprite material. */
export function glowMaterial(color = '#ffffff', opacity = 1) {
  return new THREE.SpriteMaterial({
    map: glowTexture(),
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Instanced additive glowing points (camera-facing quads via THREE.Points). */
export function glowPoints(count, { color = '#ffffff', size = 0.2, opacity = 1 } = {}) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: glowTexture() },
      uColor: { value: new THREE.Color(color) },
      uSize: { value: size },
      uOpacity: { value: opacity },
      uScale: { value: 600 },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha; attribute float aSize;
      uniform float uSize; uniform float uScale;
      varying float vAlpha;
      void main(){
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * aSize * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity;
      varying float vAlpha;
      void main(){
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(uColor * t.rgb, t.a * vAlpha * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}
