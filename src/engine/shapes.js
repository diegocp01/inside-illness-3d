import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { noise, rng } from './noise.js';

// ---------- SDF primitives (plain JS, used to build organic meshes) ----------

export const sdf = {
  sphere: (x, y, z, cx, cy, cz, r) => Math.hypot(x - cx, y - cy, z - cz) - r,
  ellipsoid(x, y, z, cx, cy, cz, rx, ry, rz) {
    const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
    const k0 = Math.hypot(px, py, pz);
    const k1 = Math.hypot(px / rx, py / ry, pz / rz);
    return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
  },
  roundBox(x, y, z, cx, cy, cz, bx, by, bz, r) {
    const qx = Math.abs(x - cx) - bx + r, qy = Math.abs(y - cy) - by + r, qz = Math.abs(z - cz) - bz + r;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
  },
  // Cone between two spheres (iq's round cone), a -> b with radii r1 -> r2.
  roundCone(x, y, z, ax, ay, az, bx, by, bz, r1, r2) {
    const bax = bx - ax, bay = by - ay, baz = bz - az;
    const l2 = bax * bax + bay * bay + baz * baz;
    const rr = r1 - r2;
    const a2 = l2 - rr * rr;
    const il2 = 1 / l2;
    const pax = x - ax, pay = y - ay, paz = z - az;
    const yv = pax * bax + pay * bay + paz * baz;
    const zv = yv - l2;
    const xx = pax * l2 - bax * yv, xy = pay * l2 - bay * yv, xz = paz * l2 - baz * yv;
    const x2 = xx * xx + xy * xy + xz * xz;
    const y2 = yv * yv * l2;
    const z2 = zv * zv * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - r1;
  },
  smin(a, b, k) {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  },
  smax(a, b, k) {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.max(a, b) + h * h * k * 0.25;
  },
};

/**
 * Naive surface nets: polygonises a signed distance function (negative = inside).
 * Returns an indexed BufferGeometry with gradient-based normals.
 */
export function surfaceNets(fn, min, max, res = 96) {
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const step = Math.max(...size) / res;
  const nx = Math.ceil(size[0] / step) + 1;
  const ny = Math.ceil(size[1] / step) + 1;
  const nz = Math.ceil(size[2] / step) + 1;
  const field = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const z = min[2] + k * step;
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * step;
      let o = (k * ny + j) * nx;
      for (let i = 0; i < nx; i++) field[o++] = fn(min[0] + i * step, y, z);
    }
  }
  const at = (i, j, k) => field[(k * ny + j) * nx + i];
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const positions = [];
  const cornerOff = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const v = new Float32Array(8);
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const o = cornerOff[c];
          v[c] = at(i + o[0], j + o[1], k + o[2]);
          if (v[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of edges) {
          const va = v[a], vb = v[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const oa = cornerOff[a], ob = cornerOff[b];
          sx += oa[0] + (ob[0] - oa[0]) * t;
          sy += oa[1] + (ob[1] - oa[1]) * t;
          sz += oa[2] + (ob[2] - oa[2]) * t;
          n++;
        }
        cellVert[(k * cy + j) * cx + i] = positions.length / 3;
        positions.push(min[0] + (i + sx / n) * step, min[1] + (j + sy / n) * step, min[2] + (k + sz / n) * step);
      }
    }
  }
  const cell = (i, j, k) => cellVert[(k * cy + j) * cx + i];
  const index = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) index.push(a, c, b, a, d, c);
    else index.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        const inside = at(i, j, k) < 0;
        // edge along +x (shared by 4 cells around it)
        if (j > 0 && k > 0 && inside !== at(i + 1, j, k) < 0)
          quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), !inside);
        // edge along +y
        if (i > 0 && k > 0 && inside !== at(i, j + 1, k) < 0)
          quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), !inside);
        // edge along +z
        if (i > 0 && j > 0 && inside !== at(i, j, k + 1) < 0)
          quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), !inside);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
  // Normals from the SDF gradient for silky shading.
  const nrm = new Float32Array(positions.length);
  const e = step * 0.5;
  for (let p = 0; p < positions.length; p += 3) {
    const x = positions[p], y = positions[p + 1], z = positions[p + 2];
    let gx = fn(x + e, y, z) - fn(x - e, y, z);
    let gy = fn(x, y + e, z) - fn(x, y - e, z);
    let gz = fn(x, y, z + e) - fn(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    nrm[p] = gx / l;
    nrm[p + 1] = gy / l;
    nrm[p + 2] = gz / l;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return geo;
}

/** Push every vertex along its normal by fn(x, y, z, nx, ny, nz). */
export function displace(geo, fn, recomputeNormals = true) {
  const p = geo.attributes.position;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    const d = fn(x, y, z, nx, ny, nz);
    p.setXYZ(i, x + nx * d, y + ny * d, z + nz * d);
  }
  p.needsUpdate = true;
  if (recomputeNormals) geo.computeVertexNormals();
  return geo;
}

/** Unit sphere that welds its seam so displacement never tears it. */
export function smoothSphere(detail = 5) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  return mergeVerticesSafe(g);
}

export function mergeVerticesSafe(g) {
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeVertices(g, 1e-5);
  m.computeVertexNormals();
  return m;
}

/** Biconcave red blood cell (Evans–Fung profile), radius 1. */
export function redCellGeometry(segments = 40) {
  const pts = [];
  const c0 = 0.207, c2 = 2.003, c4 = -1.123;
  const n = 26;
  const half = (r) => 0.5 * Math.sqrt(Math.max(0, 1 - r * r)) * (c0 + c2 * r * r + c4 * r ** 4);
  for (let i = 0; i <= n; i++) {
    const r = Math.sin((i / n) * Math.PI * 0.5);
    pts.push(new THREE.Vector2(r * 0.999 + 0.0005, half(r) * 0.95 + (i === n ? 0 : 0)));
  }
  for (let i = n - 1; i >= 0; i--) {
    const r = Math.sin((i / n) * Math.PI * 0.5);
    pts.push(new THREE.Vector2(r * 0.999 + 0.0005, -half(r) * 0.95));
  }
  const g = new THREE.LatheGeometry(pts, segments);
  g.computeVertexNormals();
  return mergeVerticesSafe(g);
}

/** Virus capsid: sphere with protein knobs arranged with icosahedral symmetry. */
export function virusGeometry({ knobs = 'rhino', detail = 4 } = {}) {
  const g = smoothSphere(detail);
  const dirs = [];
  const ico = new THREE.IcosahedronGeometry(1, knobs === 'noro' ? 2 : 1);
  const pa = ico.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const v = new THREE.Vector3(pa.getX(i), pa.getY(i), pa.getZ(i)).normalize();
    if (!dirs.some((d) => d.distanceTo(v) < 1e-3)) dirs.push(v);
  }
  const width = knobs === 'noro' ? 0.2 : 0.32;
  const height = knobs === 'noro' ? 0.16 : 0.12;
  const tmp = new THREE.Vector3();
  displace(g, (x, y, z) => {
    tmp.set(x, y, z).normalize();
    let d = 0;
    for (const k of dirs) {
      const a = tmp.angleTo(k);
      if (a < width * 1.8) d = Math.max(d, Math.exp(-((a / width) ** 2) * 2.2));
    }
    return d * height + noise.noise3(x * 6, y * 6, z * 6) * 0.015;
  });
  return g;
}

/** Ruffled white blood cell surface. */
export function whiteCellGeometry(seed = 1, detail = 5) {
  const g = smoothSphere(detail);
  const o = seed * 13.1;
  displace(g, (x, y, z) => {
    const a = noise.noise3(x * 2.2 + o, y * 2.2, z * 2.2) * 0.12;
    const b = Math.max(0, noise.noise3(x * 7 + o, y * 7, z * 7)) * 0.08;
    return a + b;
  });
  return g;
}

/** Tube along a curve whose radius varies with t (0..1). */
export function variableTube(curve, radiusFn, tubular = 160, radial = 24) {
  const g = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  const p = g.attributes.position;
  const frames = curve.computeFrenetFrames(tubular, false);
  const P = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, P);
    const r = radiusFn(t);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      const x = p.getX(idx) - P.x, y = p.getY(idx) - P.y, z = p.getZ(idx) - P.z;
      p.setXYZ(idx, P.x + x * r, P.y + y * r, P.z + z * r);
    }
  }
  g.computeVertexNormals();
  void frames;
  return g;
}

/** Simple random-walk branching curves on/near a surface, used for vessels and nerves. */
export function wanderCurve(start, dir, steps, stepLen, project, seed = 1, wobble = 0.5) {
  const r = rng(seed);
  const pts = [start.clone()];
  const d = dir.clone().normalize();
  const p = start.clone();
  for (let i = 0; i < steps; i++) {
    d.x += (r() - 0.5) * wobble;
    d.y += (r() - 0.5) * wobble;
    d.z += (r() - 0.5) * wobble;
    d.normalize();
    p.addScaledVector(d, stepLen);
    if (project) project(p);
    pts.push(p.clone());
  }
  return new THREE.CatmullRomCurve3(pts);
}

export { mergeGeometries };

/** Paint a whole geometry one vertex colour (useful before merging multi-part instanced shapes). */
export function paint(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Strip a geometry down to position/normal(/color) so differently-built parts can be merged. */
export function clean(geo, keepColor = true) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) {
    if (k !== 'position' && k !== 'normal' && !(keepColor && k === 'color')) g.deleteAttribute(k);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
