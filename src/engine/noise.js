// Small, dependency-free noise toolkit: seeded random, 3D/4D simplex noise and fBm helpers.

export function rng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const grad3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

const grad4 = new Float32Array([
  0, 1, 1, 1, 0, 1, 1, -1, 0, 1, -1, 1, 0, 1, -1, -1, 0, -1, 1, 1, 0, -1, 1, -1, 0, -1, -1, 1, 0, -1, -1, -1, 1, 0, 1, 1,
  1, 0, 1, -1, 1, 0, -1, 1, 1, 0, -1, -1, -1, 0, 1, 1, -1, 0, 1, -1, -1, 0, -1, 1, -1, 0, -1, -1, 1, 1, 0, 1, 1, 1, 0,
  -1, 1, -1, 0, 1, 1, -1, 0, -1, -1, 1, 0, 1, -1, 1, 0, -1, -1, -1, 0, 1, -1, -1, 0, -1, 1, 1, 1, 0, 1, 1, -1, 0, 1, -1,
  1, 0, 1, -1, -1, 0, -1, 1, 1, 0, -1, 1, -1, 0, -1, -1, 1, 0, -1, -1, -1, 0,
]);

function buildPerm(seed) {
  const r = rng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }
  return { perm, permMod12 };
}

const F3 = 1 / 3;
const G3 = 1 / 6;
const F4 = (Math.sqrt(5) - 1) / 4;
const G4 = (5 - Math.sqrt(5)) / 20;

export function createNoise(seed = 7) {
  const { perm, permMod12 } = buildPerm(seed);

  function noise3(xin, yin, zin) {
    let n0, n1, n2, n3;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 < 0) n0 = 0;
    else {
      const gi = permMod12[ii + perm[jj + perm[kk]]] * 3;
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi] * x0 + grad3[gi + 1] * y0 + grad3[gi + 2] * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 < 0) n1 = 0;
    else {
      const gi = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi] * x1 + grad3[gi + 1] * y1 + grad3[gi + 2] * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 < 0) n2 = 0;
    else {
      const gi = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi] * x2 + grad3[gi + 1] * y2 + grad3[gi + 2] * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 < 0) n3 = 0;
    else {
      const gi = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
      t3 *= t3;
      n3 = t3 * t3 * (grad3[gi] * x3 + grad3[gi + 1] * y3 + grad3[gi + 2] * z3);
    }
    return 32 * (n0 + n1 + n2 + n3);
  }

  function noise4(x, y, z, w) {
    let n0, n1, n2, n3, n4;
    const s = (x + y + z + w) * F4;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s), l = Math.floor(w + s);
    const t = (i + j + k + l) * G4;
    const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t), w0 = w - (l - t);
    let rankx = 0, ranky = 0, rankz = 0, rankw = 0;
    if (x0 > y0) rankx++; else ranky++;
    if (x0 > z0) rankx++; else rankz++;
    if (x0 > w0) rankx++; else rankw++;
    if (y0 > z0) ranky++; else rankz++;
    if (y0 > w0) ranky++; else rankw++;
    if (z0 > w0) rankz++; else rankw++;
    const i1 = rankx >= 3 ? 1 : 0, j1 = ranky >= 3 ? 1 : 0, k1 = rankz >= 3 ? 1 : 0, l1 = rankw >= 3 ? 1 : 0;
    const i2 = rankx >= 2 ? 1 : 0, j2 = ranky >= 2 ? 1 : 0, k2 = rankz >= 2 ? 1 : 0, l2 = rankw >= 2 ? 1 : 0;
    const i3 = rankx >= 1 ? 1 : 0, j3 = ranky >= 1 ? 1 : 0, k3 = rankz >= 1 ? 1 : 0, l3 = rankw >= 1 ? 1 : 0;
    const x1 = x0 - i1 + G4, y1 = y0 - j1 + G4, z1 = z0 - k1 + G4, w1 = w0 - l1 + G4;
    const x2 = x0 - i2 + 2 * G4, y2 = y0 - j2 + 2 * G4, z2 = z0 - k2 + 2 * G4, w2 = w0 - l2 + 2 * G4;
    const x3 = x0 - i3 + 3 * G4, y3 = y0 - j3 + 3 * G4, z3 = z0 - k3 + 3 * G4, w3 = w0 - l3 + 3 * G4;
    const x4 = x0 - 1 + 4 * G4, y4 = y0 - 1 + 4 * G4, z4 = z0 - 1 + 4 * G4, w4 = w0 - 1 + 4 * G4;
    const ii = i & 255, jj = j & 255, kk = k & 255, ll = l & 255;
    const g = (gi, a, b, c, d) => grad4[gi] * a + grad4[gi + 1] * b + grad4[gi + 2] * c + grad4[gi + 3] * d;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0 - w0 * w0;
    if (t0 < 0) n0 = 0;
    else { t0 *= t0; n0 = t0 * t0 * g((perm[ii + perm[jj + perm[kk + perm[ll]]]] % 32) * 4, x0, y0, z0, w0); }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1 - w1 * w1;
    if (t1 < 0) n1 = 0;
    else { t1 *= t1; n1 = t1 * t1 * g((perm[ii + i1 + perm[jj + j1 + perm[kk + k1 + perm[ll + l1]]]] % 32) * 4, x1, y1, z1, w1); }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2 - w2 * w2;
    if (t2 < 0) n2 = 0;
    else { t2 *= t2; n2 = t2 * t2 * g((perm[ii + i2 + perm[jj + j2 + perm[kk + k2 + perm[ll + l2]]]] % 32) * 4, x2, y2, z2, w2); }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3 - w3 * w3;
    if (t3 < 0) n3 = 0;
    else { t3 *= t3; n3 = t3 * t3 * g((perm[ii + i3 + perm[jj + j3 + perm[kk + k3 + perm[ll + l3]]]] % 32) * 4, x3, y3, z3, w3); }
    let t4 = 0.6 - x4 * x4 - y4 * y4 - z4 * z4 - w4 * w4;
    if (t4 < 0) n4 = 0;
    else { t4 *= t4; n4 = t4 * t4 * g((perm[ii + 1 + perm[jj + 1 + perm[kk + 1 + perm[ll + 1]]]] % 32) * 4, x4, y4, z4, w4); }
    return 27 * (n0 + n1 + n2 + n3 + n4);
  }

  function fbm3(x, y, z, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise3(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  return { noise3, noise4, fbm3 };
}

export const noise = createNoise(7);

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
