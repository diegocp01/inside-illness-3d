import * as THREE from 'three';
import { smoothSphere, displace, paint, clean, mergeGeometries } from './shapes.js';
import { noise, rng } from './noise.js';

/** Eosinophil: pale cell speckled with bright orange-red granules (vertex-coloured, radius ≈ 1). */
export function eosinophilGeometry(seed = 5) {
  const r = rng(seed);
  const body = smoothSphere(3);
  displace(body, (x, y, z) => noise.noise3(x * 2.5 + seed, y * 2.5, z * 2.5) * 0.08);
  const parts = [clean(paint(body, '#f6c3b4'))];
  const g = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 60; i++) {
    const d = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    const gr = g.clone().scale(0.13, 0.13, 0.13).translate(d.x * 0.96, d.y * 0.96, d.z * 0.96);
    parts.push(clean(paint(gr, i % 5 === 0 ? '#ff9a3d' : '#ff5a2a')));
  }
  return mergeGeometries(parts);
}

/** Macrophage: big, lumpy immune cell with ruffled edges. */
export function macrophageGeometry(seed = 9) {
  const g = smoothSphere(4);
  displace(g, (x, y, z) => {
    const a = noise.noise3(x * 1.6 + seed, y * 1.6, z * 1.6) * 0.22;
    const b = Math.max(0, noise.noise3(x * 5 + seed, y * 5, z * 5)) * 0.12;
    return a + b;
  });
  return g;
}
