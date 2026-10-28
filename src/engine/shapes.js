import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { noise, rng } from './noise.js';

// ---------- SDF primitives (plain JS, used to build organic meshes) ----------

export const sdf = {
  sphere: (x, y, z, cx, cy, cz, r) => Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) - r,
  ellipsoid(x, y, z, cx, cy, cz, rx, ry, rz) {
    const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
    const k0 = Math.sqrt(px * px + py * py + pz * pz);
    const qx = px / rx, qy = py / ry, qz = pz / rz;
    const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
    return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
  },
  roundBox(x, y, z, cx, cy, cz, bx, by, bz, r) {
    const qx = Math.abs(x - cx) - bx + r, qy = Math.abs(y - cy) - by + r, qz = Math.abs(z - cz) - bz + r;
    const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
    return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0) - r;
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

const QEF_REG = 0.05;

/**
 * Surface nets with dual-contouring vertex placement: polygonises a signed distance
 * function (negative = inside), keeping sharp edges sharp.
 * Returns an indexed BufferGeometry with gradient-based normals.
 */
export function surfaceNets(fn, min, max, res = 96) {
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const step = Math.max(...size) / res;
  const nx = Math.ceil(size[0] / step) + 1;
  const ny = Math.ceil(size[1] / step) + 1;
  const nz = Math.ceil(size[2] / step) + 1;
  const field = new Float32Array(nx * ny * nz);
  // Narrow band: sample a coarse grid first and only evaluate the full-resolution field in
  // blocks that may contain the surface; far blocks are filled by interpolation (same sign).
  const S = 3;
  const gx = Math.ceil((nx - 1) / S) + 1, gy = Math.ceil((ny - 1) / S) + 1, gz = Math.ceil((nz - 1) / S) + 1;
  const coarse = new Float32Array(gx * gy * gz);
  const fi = (c, n) => Math.min(c * S, n - 1);
  for (let k = 0; k < gz; k++)
    for (let j = 0; j < gy; j++)
      for (let i = 0; i < gx; i++) coarse[(k * gy + j) * gx + i] = fn(min[0] + fi(i, nx) * step, min[1] + fi(j, ny) * step, min[2] + fi(k, nz) * step);
  const band = S * step * Math.sqrt(3) * 1.25;
  for (let bk = 0; bk < gz - 1; bk++) {
    for (let bj = 0; bj < gy - 1; bj++) {
      for (let bi = 0; bi < gx - 1; bi++) {
        const c = (i, j, k) => coarse[((bk + k) * gy + bj + j) * gx + bi + i];
        const c000 = c(0, 0, 0), c100 = c(1, 0, 0), c010 = c(0, 1, 0), c110 = c(1, 1, 0);
        const c001 = c(0, 0, 1), c101 = c(1, 0, 1), c011 = c(0, 1, 1), c111 = c(1, 1, 1);
        const near = Math.min(Math.abs(c000), Math.abs(c100), Math.abs(c010), Math.abs(c110), Math.abs(c001), Math.abs(c101), Math.abs(c011), Math.abs(c111)) < band;
        const i0 = fi(bi, nx), i1 = fi(bi + 1, nx), j0 = fi(bj, ny), j1 = fi(bj + 1, ny), k0 = fi(bk, nz), k1 = fi(bk + 1, nz);
        for (let k = k0; k <= k1; k++) {
          const z = min[2] + k * step, tz = (k - k0) / Math.max(1, k1 - k0);
          for (let j = j0; j <= j1; j++) {
            const y = min[1] + j * step, ty = (j - j0) / Math.max(1, j1 - j0);
            for (let i = i0; i <= i1; i++) {
              const o = (k * ny + j) * nx + i;
              if (near) field[o] = fn(min[0] + i * step, y, z);
              else {
                const tx = (i - i0) / Math.max(1, i1 - i0);
                const a = c000 + (c100 - c000) * tx, b = c010 + (c110 - c010) * tx;
                const d = c001 + (c101 - c001) * tx, e = c011 + (c111 - c011) * tx;
                const p0 = a + (b - a) * ty, p1 = d + (e - d) * ty;
                field[o] = p0 + (p1 - p0) * tz;
              }
            }
          }
        }
      }
    }
  }
  const at = (i, j, k) => field[(k * ny + j) * nx + i];
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const positions = [];
  const normals = [];
  const cornerOff = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const v = new Float32Array(8);
  const cross = new Float64Array(36);
  const ge = step * 0.05;
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
        // Dual contouring: put the vertex where the tangent planes of the edge crossings
        // meet, so sharp creases (cut planes, rims) stay crisp instead of stair-stepping.
        const ox = min[0] + i * step, oy = min[1] + j * step, oz = min[2] + k * step;
        let n = 0, mx = 0, my = 0, mz = 0;
        for (const [a, b] of edges) {
          const va = v[a], vb = v[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const oa = cornerOff[a], ob = cornerOff[b];
          const px = ox + (oa[0] + (ob[0] - oa[0]) * t) * step;
          const py = oy + (oa[1] + (ob[1] - oa[1]) * t) * step;
          const pz = oz + (oa[2] + (ob[2] - oa[2]) * t) * step;
          cross[n * 3] = px; cross[n * 3 + 1] = py; cross[n * 3 + 2] = pz;
          mx += px; my += py; mz += pz;
          n++;
        }
        mx /= n; my /= n; mz /= n;
        let a00 = 0, a01 = 0, a02 = 0, a11 = 0, a12 = 0, a22 = 0, b0 = 0, b1 = 0, b2 = 0, snx = 0, sny = 0, snz = 0;
        for (let c = 0; c < n; c++) {
          const px = cross[c * 3], py = cross[c * 3 + 1], pz = cross[c * 3 + 2];
          const f0 = fn(px, py, pz);
          let gx = fn(px + ge, py, pz) - f0;
          let gy = fn(px, py + ge, pz) - f0;
          let gz = fn(px, py, pz + ge) - f0;
          const gl = Math.hypot(gx, gy, gz) || 1;
          gx /= gl; gy /= gl; gz /= gl;
          const d = gx * (px - mx) + gy * (py - my) + gz * (pz - mz);
          a00 += gx * gx; a01 += gx * gy; a02 += gx * gz; a11 += gy * gy; a12 += gy * gz; a22 += gz * gz;
          snx += gx; sny += gy; snz += gz;
          b0 += gx * d; b1 += gy * d; b2 += gz * d;
        }
        const m00 = a00 + QEF_REG, m11 = a11 + QEF_REG, m22 = a22 + QEF_REG;
        const det = m00 * (m11 * m22 - a12 * a12) - a01 * (a01 * m22 - a12 * a02) + a02 * (a01 * a12 - m11 * a02);
        let vx = mx, vy = my, vz = mz;
        if (Math.abs(det) > 1e-12) {
          vx += (b0 * (m11 * m22 - a12 * a12) - a01 * (b1 * m22 - a12 * b2) + a02 * (b1 * a12 - m11 * b2)) / det;
          vy += (m00 * (b1 * m22 - a12 * b2) - b0 * (a01 * m22 - a12 * a02) + a02 * (a01 * b2 - b1 * a02)) / det;
          vz += (m00 * (m11 * b2 - b1 * a12) - a01 * (a01 * b2 - b1 * a02) + b0 * (a01 * a12 - m11 * a02)) / det;
        }
        // If the sharp-feature solution leaves the cell, fall back to the mass point so the
        // mesh can't fold over itself (clamping instead would create stair steps).
        const m = step * 0.15;
        if (vx < ox - m || vx > ox + step + m || vy < oy - m || vy > oy + step + m || vz < oz - m || vz > oz + step + m) {
          vx = mx; vy = my; vz = mz;
        }
        cellVert[(k * cy + j) * cx + i] = positions.length / 3;
        positions.push(vx, vy, vz);
        const sl = Math.hypot(snx, sny, snz) || 1;
        normals.push(snx / sl, sny / sl, snz / sl);
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
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
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

/**
 * Slice a closed mesh with an axis-aligned plane and cap the opening.
 * Keeps the side where p[axis] <= offset (keepBelow) or >= offset. The cut edge lies exactly on
 * the plane and the cap is triangulated from the exact slice outline (holes included), so the
 * border is smooth instead of following the sampling grid. Adds aCut = 1 on cap vertices.
 */
export function cutByPlane(geo, axis, offset, keepBelow = true) {
  const ax = { x: 0, y: 1, z: 2 }[axis];
  const pos = geo.attributes.position.array, nrm = geo.attributes.normal.array, idx = geo.index.array;
  const N = geo.attributes.position.count;
  const s = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    s[i] = keepBelow ? offset - pos[i * 3 + ax] : pos[i * 3 + ax] - offset;
    if (s[i] === 0) s[i] = 1e-9;
  }
  const oP = [], oN = [], oI = [];
  const map = new Int32Array(N).fill(-1);
  const keep = (i) => {
    if (map[i] < 0) {
      map[i] = oP.length / 3;
      oP.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      oN.push(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
    }
    return map[i];
  };
  const edgeMap = new Map();
  const cut = (a, b) => {
    const key = a < b ? a * N + b : b * N + a;
    let v = edgeMap.get(key);
    if (v !== undefined) return v;
    const t = s[a] / (s[a] - s[b]);
    const p = [0, 1, 2].map((c) => pos[a * 3 + c] + (pos[b * 3 + c] - pos[a * 3 + c]) * t);
    p[ax] = offset;
    const n = [0, 1, 2].map((c) => nrm[a * 3 + c] + (nrm[b * 3 + c] - nrm[a * 3 + c]) * t);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    v = oP.length / 3;
    oP.push(...p);
    oN.push(n[0] / l, n[1] / l, n[2] / l);
    edgeMap.set(key, v);
    return v;
  };
  const next = new Map(); // cap boundary: entry cut vertex -> exit cut vertex
  for (let f = 0; f < idx.length; f += 3) {
    const tri = [idx[f], idx[f + 1], idx[f + 2]];
    const inside = tri.map((v) => s[v] >= 0);
    if (inside[0] && inside[1] && inside[2]) { oI.push(keep(tri[0]), keep(tri[1]), keep(tri[2])); continue; }
    if (!inside[0] && !inside[1] && !inside[2]) continue;
    const poly = [];
    let exitV = -1, entryV = -1;
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const ia = inside[e], ib = inside[(e + 1) % 3];
      if (ia) poly.push(keep(a));
      if (ia !== ib) {
        const c = cut(a, b);
        poly.push(c);
        if (ia) exitV = c;
        else entryV = c;
      }
    }
    for (let k = 1; k < poly.length - 1; k++) oI.push(poly[0], poly[k], poly[k + 1]);
    if (exitV >= 0 && entryV >= 0) next.set(entryV, exitV);
  }
  // Link the boundary into loops.
  const loops = [];
  const used = new Set();
  for (const startV of next.keys()) {
    if (used.has(startV)) continue;
    const loop = [];
    let v = startV;
    while (v !== undefined && !used.has(v)) {
      used.add(v);
      loop.push(v);
      v = next.get(v);
    }
    if (loop.length >= 3) loops.push(loop);
  }
  const [ua, va] = [[1, 2], [0, 2], [0, 1]][ax];
  const to2 = (v) => new THREE.Vector2(oP[v * 3 + ua], oP[v * 3 + va]);
  const area = (pts) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  };
  const inPoly = (pt, pts) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  const L = loops.map((l) => ({ l, pts: l.map(to2) }));
  L.forEach((o) => (o.area = area(o.pts)));
  const outerSign = Math.sign(L.reduce((m, o) => (Math.abs(o.area) > Math.abs(m.area) ? o : m), { area: 0 }).area) || 1;
  const outers = L.filter((o) => Math.sign(o.area) === outerSign).map((o) => ({ ...o, holes: [] }));
  for (const h of L.filter((o) => Math.sign(o.area) !== outerSign)) {
    let best = null;
    for (const o of outers) if (inPoly(h.pts[0], o.pts) && (!best || Math.abs(o.area) < Math.abs(best.area))) best = o;
    if (best) best.holes.push(h);
  }
  const capN = [0, 0, 0];
  capN[ax] = keepBelow ? 1 : -1;
  const aCut = new Float32Array(oP.length / 3);
  const cutFlags = [];
  for (const o of outers) {
    const verts = [o.l, ...o.holes.map((h) => h.l)].flat();
    const faces = THREE.ShapeUtils.triangulateShape(o.pts, o.holes.map((h) => h.pts));
    const base = oP.length / 3;
    for (const v of verts) {
      oP.push(oP[v * 3], oP[v * 3 + 1], oP[v * 3 + 2]);
      oN.push(...capN);
      cutFlags.push(1);
    }
    for (const [a, b, c] of faces) {
      // Make every cap triangle face outward.
      const A = verts[a], B = verts[b], C = verts[c];
      const e1 = [0, 1, 2].map((k) => oP[B * 3 + k] - oP[A * 3 + k]);
      const e2 = [0, 1, 2].map((k) => oP[C * 3 + k] - oP[A * 3 + k]);
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const facing = cr[0] * capN[0] + cr[1] * capN[1] + cr[2] * capN[2];
      if (facing >= 0) oI.push(base + a, base + b, base + c);
      else oI.push(base + a, base + c, base + b);
    }
  }
  const flags = new Float32Array(oP.length / 3);
  flags.set(aCut);
  flags.set(cutFlags, aCut.length);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(oP, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(oN, 3));
  out.setAttribute('aCut', new THREE.BufferAttribute(flags, 1));
  out.setIndex(oI);
  return out;
}
