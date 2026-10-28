import * as THREE from 'three';
import { tissue, glowMaterial } from '../engine/materials.js';
import { surfaceNets, sdf, smoothSphere, displace } from '../engine/shapes.js';
import { noise, smoothstep } from '../engine/noise.js';

// A head cut down the middle (sagittal section, viewer on the +x side): skin, fat, skull,
// brain, sinuses, nasal cavity with turbinates, palate, teeth, tongue, airway, spine.
// The outer shape and the airways are written once as a list of primitives and turned into
// both a JS signed-distance function (for the mesh) and GLSL (for the per-pixel cut face).

// [primitive, params, op, k]   ops: 'first' | 'smin' | 'ssub'
const OUTER = [
  ['ell', [0, 0.38, -0.12, 0.74, 0.8, 0.95], 'first'], // cranium
  ['ell', [0, 0.04, 0.36, 0.6, 0.74, 0.56], 'smin', 0.25], // face
  ['ell', [0, 0.24, 0.76, 0.48, 0.1, 0.17], 'smin', 0.1], // brow ridge
  ['cone', [0, 0.12, 0.9, 0, -0.27, 1.15, 0.045, 0.075], 'smin', 0.06], // nasal bridge to tip
  ['ell', [0, -0.08, 0.88, 0.12, 0.22, 0.15], 'smin', 0.08], // body of the nose (fills behind the bridge)
  ['ell', [0, -0.31, 1.06, 0.15, 0.065, 0.11], 'smin', 0.06], // base of the nose
  ['ell', [0, -0.27, 0.96, 0.17, 0.09, 0.13], 'smin', 0.08], // nostril wings
  ['ell', [0, -0.5, 0.9, 0.22, 0.065, 0.085], 'smin', 0.06], // upper lip
  ['ell', [0, -0.665, 0.88, 0.2, 0.06, 0.085], 'smin', 0.05], // lower lip
  ['box', [0, -0.585, 0.97, 0.17, 0.007, 0.08, 0.004], 'ssub', 0.02], // lip line
  ['ell', [0, -0.88, 0.8, 0.28, 0.17, 0.18], 'smin', 0.1], // chin
  ['ell', [0, -0.6, 0.38, 0.56, 0.48, 0.5], 'smin', 0.25], // jaw
  ['cone', [0, -0.85, -0.2, 0, -1.8, -0.24, 0.46, 0.48], 'smin', 0.25], // neck
  ['ell', [0, -1.14, 0.24, 0.08, 0.08, 0.06], 'smin', 0.08], // Adam's apple
  ['ell', [-0.74, 0.0, -0.12, 0.07, 0.21, 0.13], 'smin', 0.05], // ear
  ['ell', [-0.32, 0.08, 0.84, 0.13, 0.07, 0.09], 'ssub', 0.08], // eye socket
  ['ell', [-0.3, 0.07, 0.8, 0.11, 0.055, 0.07], 'smin', 0.04], // closed eyelid
];

const CAVITY = [
  ['ell', [-0.1, -0.11, 0.43, 0.2, 0.28, 0.4], 'first'], // nasal cavity
  ['box', [-0.1, -0.3, 0.42, 0.11, 0.08, 0.3, 0.07], 'smin', 0.1], // its floor
  ['cone', [-0.12, -0.24, 0.8, -0.1, -0.39, 1.03, 0.05, 0.04], 'smin', 0.04], // nostril (just off the midline)
  ['cone', [-0.08, -0.12, 0.04, -0.08, -0.55, -0.1, 0.12, 0.1], 'smin', 0.08], // nasopharynx
  ['cone', [-0.08, -0.55, -0.1, -0.06, -1.0, -0.08, 0.1, 0.075], 'smin', 0.06], // throat
  ['cone', [-0.06, -0.95, -0.06, -0.05, -1.06, 0.02, 0.06, 0.06], 'smin', 0.04], // laryngeal inlet
  ['cone', [-0.05, -1.0, 0.03, -0.05, -1.68, 0.08, 0.07, 0.065], 'smin', 0.04], // larynx & trachea
  ['cone', [-0.05, -1.04, -0.12, -0.05, -1.68, -0.15, 0.055, 0.05], 'smin', 0.04], // oesophagus
  ['ell', [-0.14, -0.52, 0.5, 0.26, 0.03, 0.34], 'smin', 0.03], // mouth: a thin gap above the tongue
  ['cone', [-0.12, -0.52, 0.18, -0.09, -0.6, -0.05, 0.035, 0.035], 'smin', 0.03], // back of the mouth
  ['ell', [-0.06, 0.36, 0.72, 0.08, 0.07, 0.05], 'smin', 0.02], // frontal sinus
  ['ell', [-0.06, 0.12, -0.12, 0.075, 0.065, 0.075], 'smin', 0.02], // sphenoid sinus
];

const { ellipsoid, roundCone, roundBox, smin, smax } = sdf;

// Turn a primitive list into a fast JS distance function. Each primitive also gets a bounding
// sphere so far-away primitives are skipped (they can't change the smooth union / subtraction).
function compile(list) {
  const prims = list.map(([f, a, op, k]) => {
    let fn, b;
    if (f === 'ell') {
      const [cx, cy, cz, rx, ry, rz] = a;
      fn = (x, y, z) => ellipsoid(x, y, z, cx, cy, cz, rx, ry, rz);
      b = [cx, cy, cz, Math.max(rx, ry, rz) * 1.05];
    } else if (f === 'cone') {
      const [ax, ay, az, bx, by, bz, r1, r2] = a;
      fn = (x, y, z) => roundCone(x, y, z, ax, ay, az, bx, by, bz, r1, r2);
      b = [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, Math.hypot(bx - ax, by - ay, bz - az) / 2 + Math.max(r1, r2) + 0.01];
    } else {
      const [cx, cy, cz, hx, hy, hz, r] = a;
      fn = (x, y, z) => roundBox(x, y, z, cx, cy, cz, hx, hy, hz, r);
      b = [cx, cy, cz, Math.hypot(hx, hy, hz) + 0.01];
    }
    return { fn, sub: op === 'ssub', k, bx: b[0], by: b[1], bz: b[2], br: b[3] };
  });
  const first = prims[0].fn;
  const rest = prims.slice(1);
  return (x, y, z) => {
    let d = first(x, y, z);
    for (let i = 0; i < rest.length; i++) {
      const p = rest[i];
      const dx = x - p.bx, dy = y - p.by, dz = z - p.bz;
      const lb = Math.sqrt(dx * dx + dy * dy + dz * dz) - p.br;
      if (p.sub ? lb > -d + p.k : lb > d + p.k) continue;
      const v = p.fn(x, y, z);
      d = p.sub ? smax(d, -v, p.k) : smin(d, v, p.k);
    }
    return d;
  };
}
const outerList = compile(OUTER);
const outerSDF = (x, y, z) => Math.max(outerList(x, y, z), -1.74 - y);
const cavitySDF = compile(CAVITY);
const solidSDF = (x, y, z) => smax(outerSDF(x, y, z), -cavitySDF(x, y, z), 0.03);

const f = (n) => (Number.isInteger(n) ? `${n}.0` : `${n}`);
function glslList(name, list) {
  const lines = list.map(([fn, a, op, k]) => {
    const v = fn === 'ell'
      ? `sdEll(p, vec3(${a.slice(0, 3).map(f)}), vec3(${a.slice(3).map(f)}))`
      : fn === 'cone'
        ? `sdCone(p, vec3(${a.slice(0, 3).map(f)}), vec3(${a.slice(3, 6).map(f)}), ${f(a[6])}, ${f(a[7])})`
        : `sdRBox(p, vec3(${a.slice(0, 3).map(f)}), vec3(${a.slice(3, 6).map(f)}), ${f(a[6])})`;
    return op === 'first' ? `d = ${v};` : op === 'smin' ? `d = sminK(d, ${v}, ${f(k)});` : `d = smaxK(d, -${v}, ${f(k)});`;
  });
  return `float ${name}(vec3 p) { float d; ${lines.join(' ')} return d; }`;
}

const GLSL_SDF = `
  float sdEll(vec3 p, vec3 c, vec3 r) { vec3 q = (p - c) / r; float k0 = length(q); float k1 = length(q / r); return k0 * (k0 - 1.0) / max(k1, 1e-6); }
  float sdRBox(vec3 p, vec3 c, vec3 b, float r) { vec3 q = abs(p - c) - b + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
  float sdCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
    vec3 ba = b - a; float l2 = dot(ba, ba); float rr = r1 - r2; float a2 = l2 - rr * rr; float il2 = 1.0 / l2;
    vec3 pa = p - a; float y = dot(pa, ba); float z = y - l2;
    vec3 xv = pa * l2 - ba * y; float x2 = dot(xv, xv); float y2 = y * y * l2; float z2 = z * z * l2;
    float k = sign(rr) * rr * rr * x2;
    if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
    if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
    return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
  }
  float sminK(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
  float smaxK(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return max(a, b) + h * h * k * 0.25; }
  ${glslList('outerD', OUTER)}
  ${glslList('cavD', CAVITY)}
  float solidD(vec3 p) { return smaxK(max(outerD(p), -1.74 - p.y), -cavD(p), 0.03); }
  // 2D helpers on the cut plane (q = (z, y))
  float sdSeg(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
  float sdE2(vec2 p, vec2 c, vec2 r) { return (length((p - c) / r) - 1.0) * min(r.x, r.y); }
  float sdB2(vec2 p, vec2 c, vec2 b, float r) { vec2 q = abs(p - c) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  float fillAA(float d) { float w = max(fwidth(d), 1e-5) * 0.8; return 1.0 - smoothstep(-w, w, d); }
  float hs2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hs2(i), hs2(i + vec2(1, 0)), f.x), mix(hs2(i + vec2(0, 1)), hs2(i + vec2(1, 1)), f.x), f.y); }
`;

// Colours of a midline section, painted per pixel so every boundary stays sharp.
const GLSL_CUT = `
  float edgeL(float d) { float w = max(fwidth(d), 1e-5); return 1.0 - smoothstep(0.0, w * 1.6, abs(d)); }
  vec3 paint(vec3 col, vec3 c, float d) { col = mix(col, c, fillAA(d)); return mix(col, col * 0.72, edgeL(d) * 0.55); }
  vec3 cutColour(vec2 q) {
    vec3 p3 = vec3(0.0, q.y, q.x);
    float od = max(outerD(p3), -1.74 - p3.y);
    float cd = cavD(p3);
    vec3 bone = vec3(0.94, 0.89, 0.78);
    vec3 cart = vec3(0.84, 0.9, 0.93);
    // muscle and connective tissue
    float fib = vn2(q * vec2(5.0, 34.0)) * 0.6 + vn2(q * 90.0) * 0.4;
    vec3 col = mix(vec3(0.66, 0.27, 0.26), vec3(0.76, 0.36, 0.34), fib);
    // brain parts
    float cere = max(sdE2(q, vec2(-0.12, 0.46), vec2(0.78, 0.62)), (0.24 - 0.5 * max(0.0, -0.1 - q.x)) - q.y);
    float cbl = sdE2(q, vec2(-0.6, -0.15), vec2(0.3, 0.2));
    float stem = min(sdSeg(q, vec2(-0.18, 0.22), vec2(-0.33, -0.42), 0.095), sdE2(q, vec2(-0.21, -0.05), vec2(0.13, 0.14)));
    float encl = min(cere, cbl);
    // skull: outer/inner compact bone with spongy bone between
    float skull = max(encl - 0.07, -encl);
    float inHead = fillAA(od + 0.035);
    col = mix(col, bone, fillAA(skull) * inHead);
    col = mix(col, vec3(0.83, 0.71, 0.55) * (0.88 + 0.24 * vn2(q * 70.0)), fillAA(max(encl - 0.05, 0.02 - encl)) * inHead);
    col = mix(col, col * 0.75, edgeL(encl - 0.07) * 0.5 * inHead);
    col = paint(col, bone, sdSeg(q, vec2(-0.04, 0.06), vec2(-0.3, -0.38), 0.045)); // clivus
    // a thin layer of fluid around the brain
    col = mix(col, vec3(0.74, 0.8, 0.86), fillAA(max(encl - 0.012, -encl)));
    // cerebrum: grey matter folds (gyri), corpus callosum, thalamus
    vec2 cq = (q - vec2(-0.12, 0.46)) / vec2(0.78, 0.62);
    float rr = length(cq), an = atan(cq.y, cq.x);
    // Midline brain pattern: one groove running parallel to the corpus callosum (cingulate),
    // then wiggly grooves radiating out to the edge, plus a few short side branches.
    float cingD = sdE2(q, vec2(-0.12, 0.42), vec2(0.5, 0.26));
    float wv = an * 2.3 + 0.22 * sin(rr * 15.0 + an * 4.0) + 0.5 * (vn2(q * 3.5) - 0.5);
    float radial = abs(fract(wv) - 0.5);
    float rw = fwidth(wv) + 0.03;
    float sulc = (1.0 - smoothstep(0.0, rw, radial)) * step(0.0, cingD) * smoothstep(0.0, 0.04, cingD);
    float cw = fwidth(cingD) * 1.5 + 0.006;
    sulc = max(sulc, 1.0 - smoothstep(0.0, cw, abs(cingD)));
    float sideN = vn2(q * 9.0 + 3.0);
    float side = (1.0 - smoothstep(0.0, fwidth(sideN) * 1.5 + 0.012, abs(sideN - 0.5))) * step(0.04, cingD) * step(rr, 0.92);
    sulc = max(sulc, side * 0.8);
    // rounded gyri: brighter in the middle of each fold, darker toward the grooves
    float ridge = smoothstep(0.0, 0.32, radial) * step(0.04, cingD) + (1.0 - step(0.04, cingD)) * smoothstep(0.0, 0.05, abs(cingD));
    float gyr = (0.8 + 0.2 * ridge) * (0.95 + 0.1 * vn2(q * 7.0));
    vec3 grey = mix(vec3(0.92, 0.74, 0.69) * gyr, vec3(0.56, 0.33, 0.32), sulc);
    col = mix(col, grey, fillAA(cere));
    col = mix(col, col * 0.78, edgeL(cere) * 0.5);
    float cc = max(abs(sdE2(q, vec2(-0.12, 0.4), vec2(0.36, 0.15))) - 0.028, 0.33 - q.y);
    col = mix(col, vec3(0.97, 0.93, 0.89), fillAA(cc) * fillAA(cere));
    col = paint(col, vec3(0.86, 0.64, 0.6), sdE2(q, vec2(-0.14, 0.26), vec2(0.15, 0.09)));
    // cerebellum with its white branching "tree"
    vec2 bq = (q - vec2(-0.6, -0.15)) / vec2(0.3, 0.2);
    float bl = length(bq);
    // folia: thin layered folds near the surface; white branching core inside
    float folia = smoothstep(0.32, 0.46, abs(fract(bl * 7.0 + 0.6 * vn2(q * 10.0)) - 0.5)) * smoothstep(0.45, 0.6, bl);
    float tree = smoothstep(0.36, 0.46, abs(fract(atan(bq.y, bq.x) * 2.6 + bl * 0.9 + 0.2 * vn2(q * 12.0)) - 0.5)) * smoothstep(0.7, 0.3, bl);
    vec3 cbc = mix(vec3(0.82, 0.57, 0.54), vec3(0.6, 0.36, 0.35), folia);
    col = paint(col, mix(cbc, vec3(0.96, 0.9, 0.86), max(tree, smoothstep(0.32, 0.1, bl))), cbl);
    col = paint(col, vec3(0.9, 0.73, 0.68), stem);
    // spinal cord in its fluid sleeve
    col = mix(col, vec3(0.72, 0.82, 0.89), fillAA(sdSeg(q, vec2(-0.36, -0.42), vec2(-0.44, -1.8), 0.062)));
    col = paint(col, vec3(0.95, 0.89, 0.84), sdSeg(q, vec2(-0.35, -0.42), vec2(-0.44, -1.8), 0.042));
    // neck vertebrae, discs and spinous processes
    float t = (-0.58 - q.y) / 0.15;
    float idx = floor(t);
    float yc = -0.58 - (idx + 0.55) * 0.15;
    float zc = -0.28 - 0.02 * idx;
    if (q.y < -0.56 && q.y > -1.78) {
      col = paint(col, vec3(0.78, 0.87, 0.92), sdB2(q, vec2(zc, yc + 0.07), vec2(0.075, 0.016), 0.01));
      float body = sdB2(q, vec2(zc, yc), vec2(0.08, 0.055), 0.022);
      col = paint(col, bone, body);
      col = mix(col, vec3(0.85, 0.74, 0.58) * (0.9 + 0.2 * vn2(q * 80.0)), fillAA(body + 0.018));
      col = paint(col, bone, sdSeg(q, vec2(zc - 0.24, yc + 0.01), vec2(zc - 0.34, yc - 0.04), 0.026));
    }
    col = paint(col, bone, sdE2(q, vec2(-0.25, -0.48), vec2(0.05, 0.04))); // front of the atlas
    // nose: nasal bone, then cartilage down to the tip
    col = paint(col, bone, sdSeg(q, vec2(0.86, 0.17), vec2(0.97, -0.03), 0.024));
    col = paint(col, cart, sdSeg(q, vec2(0.97, -0.03), vec2(1.08, -0.23), 0.026));
    // hard palate, upper jaw, soft palate, teeth
    col = paint(col, bone, sdB2(q, vec2(0.44, -0.435), vec2(0.4, 0.024), 0.02));
    col = paint(col, bone, sdE2(q, vec2(0.82, -0.43), vec2(0.06, 0.05)));
    col = paint(col, vec3(0.8, 0.4, 0.42), sdSeg(q, vec2(0.05, -0.44), vec2(-0.07, -0.6), 0.034));
    col = paint(col, vec3(0.98, 0.96, 0.92), sdSeg(q, vec2(0.86, -0.44), vec2(0.9, -0.575), 0.024));
    col = paint(col, vec3(0.98, 0.96, 0.92), sdSeg(q, vec2(0.85, -0.78), vec2(0.88, -0.625), 0.022));
    // tongue
    float tongue = min(sdE2(q, vec2(0.36, -0.7), vec2(0.42, 0.16)), sdSeg(q, vec2(0.12, -0.74), vec2(0.06, -0.95), 0.11));
    col = paint(col, mix(vec3(0.74, 0.3, 0.34), vec3(0.8, 0.37, 0.4), vn2(q * vec2(30.0, 8.0))), tongue);
    // lower jaw (mandible) with marrow, hyoid, epiglottis
    float jaw = min(sdE2(q, vec2(0.72, -0.9), vec2(0.11, 0.13)), sdSeg(q, vec2(0.62, -0.98), vec2(0.32, -1.0), 0.035));
    col = paint(col, bone, jaw);
    col = mix(col, vec3(0.88, 0.8, 0.66) * (0.92 + 0.16 * vn2(q * 80.0)), fillAA(sdE2(q, vec2(0.7, -0.9), vec2(0.07, 0.095))) * 0.8);
    col = paint(col, bone, sdE2(q, vec2(0.1, -1.0), vec2(0.045, 0.025)));
    col = paint(col, vec3(0.93, 0.85, 0.8), sdSeg(q, vec2(0.0, -0.86), vec2(-0.04, -1.0), 0.015));
    // larynx & tracheal rings
    col = paint(col, cart, sdSeg(q, vec2(0.17, -1.02), vec2(0.17, -1.28), 0.034));
    col = paint(col, cart, sdE2(q, vec2(0.14, -1.34), vec2(0.035, 0.03)));
    if (q.y < -1.4) col = paint(col, cart, sdE2(vec2(q.x, mod(q.y + 1.42, 0.075)), vec2(0.14, 0.035), vec2(0.024, 0.02)));
    // fat under the skin, then the skin
    col = mix(col, vec3(0.96, 0.84, 0.56), fillAA(max(-od - 0.048, od + 0.015)));
    col = mix(col, vec3(0.86, 0.6, 0.5), fillAA(max(-od - 0.015, od)));
    // pink lining around every airway and sinus
    col = mix(col, vec3(0.84, 0.38, 0.38), fillAA(max(cd - 0.02, -cd)) * fillAA(od + 0.01));
    return col;
  }
`;

export function buildNoseHead(worldX = 0) {
  const group = new THREE.Group();
  group.position.x = worldX;
  // The 3D surface: meshed a little past the midline and clipped exactly at x = 0 on the GPU.
  const geo = surfaceNets(solidSDF, [-0.9, -1.76, -1.12], [0.06, 1.24, 1.24], 140);
  const p = geo.attributes.position;
  const kind = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    kind[i] = Math.abs(cavitySDF(x, y, z)) < Math.abs(outerSDF(x, y, z)) ? 1 : 0;
  }
  geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  const clip = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), worldX)];

  const U = { uSwell: { value: 0 } };
  const mat = tissue({ color: '#ffffff', sheen: '#ffd8cc', roughness: 0.5, clearcoat: 0.3, normal: null, sheenAmount: 0.4 });
  mat.clippingPlanes = clip;
  mat.side = THREE.DoubleSide;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSwell = U.uSwell;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aKind; varying float vKind; varying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKind = aKind; vObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vKind; varying vec3 vObj; uniform float uSwell;\nfloat hsS(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat vnS(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hsS(i), hsS(i + vec2(1, 0)), f.x), mix(hsS(i + vec2(0, 1)), hsS(i + vec2(1, 1)), f.x), f.y); }')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 col;
        if (vKind > 0.5) {
          col = mix(vec3(0.86, 0.46, 0.45), vec3(0.8, 0.26, 0.28), uSwell);
        } else {
          col = vec3(0.9, 0.69, 0.59) * (0.96 + 0.08 * vnS(vObj.yz * 30.0));
          float lips = smoothstep(0.04, 0.0, abs(vObj.y + 0.585) - 0.085) * smoothstep(0.8, 0.88, vObj.z) * smoothstep(0.24, 0.16, abs(vObj.x));
          col = mix(col, vec3(0.78, 0.43, 0.44), lips);
        }
        if (!gl_FrontFacing) col *= 0.55; // inside surfaces seen past the cut
        diffuseColor.rgb = col;`
      );
  };
  mat.customProgramCacheKey = () => 'nose-head-surface';
  const head = new THREE.Mesh(geo, mat);
  group.add(head);

  // The cut face: one flat quad whose shape and colours are computed per pixel from the same
  // signed-distance maths, with anti-aliased edges (alpha to coverage) — no stair steps.
  const capGeo = new THREE.PlaneGeometry(2.5, 3.1).rotateY(Math.PI / 2).translate(0, -0.26, 0.06);
  const capMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.62, sheen: 0.25, sheenColor: new THREE.Color('#ffe6dc'), alphaToCoverage: true });
  capMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vObj;\n${GLSL_SDF}\n${GLSL_CUT}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 q = vec2(vObj.z, vObj.y);
        float sd = solidD(vec3(0.0, q.y, q.x)) - 0.002;
        float cov = clamp(0.5 - sd / max(fwidth(sd), 1e-5), 0.0, 1.0);
        if (cov <= 0.0) discard;
        diffuseColor.rgb = cutColour(q);
        diffuseColor.a = cov;`
      );
  };
  capMat.customProgramCacheKey = () => 'nose-head-cap';
  const cap = new THREE.Mesh(capGeo, capMat);
  group.add(cap);

  // Turbinates: three curled shelves on the side wall of the nasal cavity. They swell during a cold.
  const turbMat = tissue({ color: '#dc7472', sheen: '#ffc6bd', roughness: 0.32, clearcoat: 0.8, normal: null });
  const turbs = [
    { c: [-0.25, 0.06, 0.34], r: [0.07, 0.04, 0.2] },
    { c: [-0.24, -0.08, 0.44], r: [0.085, 0.05, 0.3] },
    { c: [-0.23, -0.25, 0.48], r: [0.1, 0.06, 0.36] },
  ].map((t, k) => {
    const g = smoothSphere(5);
    displace(g, (x, y, z) => noise.noise3(x * 3 + k, y * 3, z * 3) * 0.08);
    const m = new THREE.Mesh(g, turbMat);
    m.position.fromArray(t.c);
    m.scale.fromArray(t.r);
    group.add(m);
    return { m, base: t };
  });
  const inferior = turbs[2];

  // "You are here": a glowing square on the lowest turbinate.
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.092, 4, 1).rotateZ(Math.PI / 4).rotateY(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#7fe7ff', side: THREE.DoubleSide, transparent: true, depthWrite: false })
  );
  const glow = new THREE.Sprite(glowMaterial('#5fd8ff', 0.5));
  glow.scale.setScalar(0.42);
  group.add(marker, glow);

  const drip = new THREE.Mesh(smoothSphere(3), new THREE.MeshPhysicalMaterial({ color: '#eef0c8', roughness: 0.1, transmission: 0.6, thickness: 0.1, clearcoat: 1 }));
  drip.position.set(-0.05, -0.42, 1.08);
  group.add(drip);

  const markerAnchor = new THREE.Object3D();
  group.add(markerAnchor);

  function update(t, s) {
    const swell = smoothstep(0.35, 0.9, s);
    U.uSwell.value = swell;
    turbMat.color.set('#dc7472').lerp(new THREE.Color('#c23a3a'), swell);
    for (const { m, base } of turbs) m.scale.set(base.r[0] * (1 + swell * 0.45), base.r[1] * (1 + swell * 0.6), base.r[2] * (1 + swell * 0.08));
    const mx = inferior.base.c[0] + inferior.base.r[0] * (1 + swell * 0.45) + 0.01;
    marker.position.set(mx, inferior.base.c[1], inferior.base.c[2]);
    glow.position.copy(marker.position);
    glow.material.opacity = 0.35 + 0.25 * Math.sin(t * 3);
    markerAnchor.position.copy(marker.position).add(new THREE.Vector3(0, 0.09, 0));
    const d = smoothstep(0.75, 1, s);
    drip.scale.set(0.04 * d, (0.08 + 0.03 * Math.sin(t * 2)) * d + 0.0001, 0.04 * d);
  }
  update(0, 0);

  return { group, update, markerAnchor };
}
