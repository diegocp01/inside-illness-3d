import * as THREE from 'three';
import { tissue, membrane, glowPoints } from '../engine/materials.js';
import { smoothSphere, displace, redCellGeometry } from '../engine/shapes.js';
import { macrophageGeometry } from '../engine/cells.js';
import { noise, rng, smoothstep, lerp } from '../engine/noise.js';

// Obesity: a cluster of fat cells that swell, get stressed and attract immune cells.
export default function build() {
  const root = new THREE.Group();
  const r = rng(91);

  // ---------- Pack fat cells inside an ellipsoid ----------
  const cells = [];
  const E = [3.0, 1.9, 2.3];
  let tries = 0;
  while (cells.length < 64 && tries < 20000) {
    tries++;
    const p = new THREE.Vector3((r() * 2 - 1) * E[0], (r() * 2 - 1) * E[1], (r() * 2 - 1) * E[2]);
    if ((p.x / E[0]) ** 2 + (p.y / E[1]) ** 2 + (p.z / E[2]) ** 2 > 1) continue;
    const rad = 0.42 + r() * 0.16;
    if (cells.some((c) => c.p.distanceTo(p) < (c.rad + rad) * 0.98)) continue;
    cells.push({ p, rad, ph: r() * 6, nucDir: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), dies: false, grow: 1.45 + r() * 0.3 });
  }
  // Relax into a snug packing.
  for (let it = 0; it < 60; it++) {
    for (const a of cells) {
      for (const b of cells) {
        if (a === b) continue;
        const d = a.p.distanceTo(b.p);
        const want = (a.rad + b.rad) * 1.02;
        if (d < want) {
          const push = b.p.clone().sub(a.p).normalize().multiplyScalar((want - d) * 0.5);
          b.p.add(push);
          a.p.sub(push);
        }
      }
      a.p.multiplyScalar(0.995);
    }
  }
  // A few cells will become overstuffed and die.
  const dying = cells.slice().sort((a, b) => b.p.z + b.p.y * 0.4 - (a.p.z + a.p.y * 0.4)).slice(0, 14).filter((_, i) => i % 2 === 0);
  dying.forEach((c) => (c.dies = true));
  const N = cells.length;

  const memGeo = smoothSphere(4);
  displace(memGeo, (x, y, z) => noise.noise3(x * 2, y * 2, z * 2) * 0.03);
  const mem = new THREE.InstancedMesh(memGeo, membrane({ color: '#fff1c9', minAlpha: 0.06, maxAlpha: 0.65, roughness: 0.12 }), N);
  mem.renderOrder = 3;
  const dropMat = new THREE.MeshPhysicalMaterial({ color: '#f6c445', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.4, sheenColor: new THREE.Color('#fff2b0'), emissive: '#7a4a00', emissiveIntensity: 0.18 });
  const drop = new THREE.InstancedMesh(smoothSphere(4), dropMat, N);
  drop.castShadow = true;
  drop.receiveShadow = true;
  const nuc = new THREE.InstancedMesh(smoothSphere(3), tissue({ color: '#6b3a96', sheen: '#b48ae0', roughness: 0.35, normal: null }), N);
  root.add(drop, nuc, mem);

  // ---------- Capillaries weaving between cells ----------
  const capMat = tissue({ color: '#c1272d', sheen: '#ff8f8f', roughness: 0.3, clearcoat: 0.9, normal: null, emissive: '#ff2020', emissiveIntensity: 0.05 });
  const caps = [];
  for (let k = 0; k < 6; k++) {
    const pts = [];
    let p = new THREE.Vector3(-E[0] - 0.8, (r() - 0.5) * 2.4, (r() - 0.5) * 2.6);
    for (let i = 0; i < 9; i++) {
      pts.push(p.clone());
      p = p.clone().add(new THREE.Vector3(0.95, (r() - 0.5) * 0.9, (r() - 0.5) * 0.9));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    caps.push(curve);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.055, 10, false), capMat);
    root.add(m);
  }
  const RN = 90;
  const rbc = new THREE.InstancedMesh(redCellGeometry(16), tissue({ color: '#b5111f', roughness: 0.3, clearcoat: 0.8, normal: null }), RN);
  const rSeeds = Array.from({ length: RN }, () => ({ c: Math.floor(r() * caps.length), ph: r(), rot: r() * 6 }));
  root.add(rbc);

  // ---------- Macrophages forming crowns around dying cells ----------
  const PER = 9;
  const mac = new THREE.InstancedMesh(macrophageGeometry(4), tissue({ color: '#9a86d8', sheen: '#e0d6ff', roughness: 0.42, normal: 'organic', normalScale: 0.4, emissive: '#3a2080', emissiveIntensity: 0.25 }), dying.length * PER);
  mac.castShadow = true;
  const macSeeds = [];
  dying.forEach((c, k) => {
    for (let j = 0; j < PER; j++) {
      const a = (j / PER) * Math.PI * 2;
      macSeeds.push({ cell: c, a, tilt: (r() - 0.5) * 0.7, thr: 0.68 + k * 0.03 + r() * 0.08, start: new THREE.Vector3((r() - 0.5) * 8, (r() - 0.5) * 6, (r() - 0.5) * 6), size: 0.13 + r() * 0.04 });
    }
  });
  root.add(mac);

  // ---------- Inflammation signals ----------
  const SN = 180;
  const sig = glowPoints(SN, { color: '#ff5a3a', size: 0.09 });
  const sSeeds = Array.from({ length: SN }, () => ({ c: dying[Math.floor(r() * dying.length)], cap: Math.floor(r() * caps.length), ph: r(), u: r() }));
  root.add(sig);

  // ---------- Labels ----------
  const lc = cells.slice().sort((a, b) => b.p.z + b.p.x * 0.3 - (a.p.z + a.p.x * 0.3))[2];
  const lFat = new THREE.Object3D(), lNuc = new THREE.Object3D(), lMac = new THREE.Object3D(), lBig = new THREE.Object3D();
  root.add(lFat, lNuc, lMac, lBig);
  const labels = [
    { text: 'Fat cell', parent: lBig, when: (s) => s < 0.45 },
    { text: 'Swollen fat cell', parent: lBig, when: (s) => s >= 0.45 },
    { text: 'Immune cells', parent: lMac, when: (s) => s > 0.78 },
  ];

  const dummy = new THREE.Object3D();
  const tc = new THREE.Color();
  const cGold = new THREE.Color('#f6c445'), cDying = new THREE.Color('#a8784a');
  const tmp = new THREE.Vector3();
  function update(t, dt, s) {
    const grow = smoothstep(0.05, 0.75, s);
    const spread = 1 + grow * 0.42;
    const die = smoothstep(0.62, 0.95, s);
    for (let i = 0; i < N; i++) {
      const c = cells[i];
      const breathe = 1 + Math.sin(t * 0.8 + c.ph) * 0.006;
      const rad = c.rad * lerp(1, c.grow, grow) * breathe * (c.dies ? 1 - die * 0.18 : 1);
      dummy.position.copy(c.p).multiplyScalar(spread);
      dummy.rotation.set(c.ph, c.ph * 2, 0);
      dummy.scale.setScalar(rad);
      dummy.updateMatrix();
      mem.setMatrixAt(i, dummy.matrix);
      tc.set(c.dies ? '#ffd7c2' : '#fff1c9').lerp(new THREE.Color('#ffb0a0'), c.dies ? die * 0.7 : grow * 0.15);
      mem.setColorAt(i, tc);
      dummy.scale.setScalar(rad * (c.dies ? lerp(0.92, 0.7, die) : 0.92));
      dummy.updateMatrix();
      drop.setMatrixAt(i, dummy.matrix);
      tc.copy(cGold);
      if (c.dies) tc.lerp(cDying, die);
      drop.setColorAt(i, tc);
      // Nucleus squeezed flat against the membrane.
      tmp.copy(c.p).multiplyScalar(spread).addScaledVector(c.nucDir, rad * 0.93);
      dummy.position.copy(tmp);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.nucDir);
      dummy.scale.set(0.16 * (1 + grow * 0.2), 0.06, 0.12);
      dummy.updateMatrix();
      nuc.setMatrixAt(i, dummy.matrix);
      if (c === lc) {
        lBig.position.copy(c.p).multiplyScalar(spread).add(new THREE.Vector3(0, rad * 0.95, 0));
        lFat.position.copy(c.p).multiplyScalar(spread).add(new THREE.Vector3(-rad * 0.3, -rad * 0.2, rad * 0.8));
        lNuc.position.copy(tmp);
      }
    }
    mem.instanceMatrix.needsUpdate = true;
    mem.instanceColor.needsUpdate = true;
    drop.instanceMatrix.needsUpdate = true;
    drop.instanceColor.needsUpdate = true;
    nuc.instanceMatrix.needsUpdate = true;
    dummy.rotation.set(0, 0, 0);
    dummy.quaternion.identity();

    for (let i = 0; i < RN; i++) {
      const b = rSeeds[i];
      const f = (b.ph + t * 0.06) % 1;
      caps[b.c].getPointAt(f, dummy.position);
      dummy.rotation.set(b.rot + t, b.rot, 0);
      dummy.scale.setScalar(0.045);
      dummy.updateMatrix();
      rbc.setMatrixAt(i, dummy.matrix);
    }
    rbc.instanceMatrix.needsUpdate = true;
    capMat.emissiveIntensity = 0.05 + die * 0.25;

    let ml = false;
    for (let i = 0; i < macSeeds.length; i++) {
      const m = macSeeds[i];
      const g = smoothstep(m.thr, m.thr + 0.18, s);
      const c = m.cell;
      const rad = c.rad * lerp(1, c.grow, grow) * (1 - die * 0.18);
      tmp.set(Math.cos(m.a + t * 0.05), m.tilt, Math.sin(m.a + t * 0.05)).normalize().multiplyScalar(rad + m.size * 0.6);
      tmp.add(c.p.clone().multiplyScalar(spread));
      dummy.position.copy(m.start).lerp(tmp, g);
      dummy.rotation.set(t * 0.2 + i, i, 0);
      dummy.scale.setScalar(m.size * smoothstep(m.thr - 0.05, m.thr + 0.05, s));
      dummy.updateMatrix();
      mac.setMatrixAt(i, dummy.matrix);
      if (!ml && g > 0.9 && c === dying[0]) { lMac.position.copy(dummy.position); ml = true; }
    }
    mac.instanceMatrix.needsUpdate = true;

    const sp = sig.geometry.attributes.position.array;
    const sa = sig.geometry.attributes.aAlpha.array;
    const on = smoothstep(0.8, 1, s);
    for (let i = 0; i < SN; i++) {
      const g = sSeeds[i];
      const f = (g.ph + t * 0.18) % 1;
      const a = g.c.p.clone().multiplyScalar(spread);
      const b = caps[g.cap].getPointAt(g.u);
      a.lerp(b, f);
      sp.set([a.x, a.y, a.z], i * 3);
      sa[i] = on * Math.sin(f * Math.PI);
    }
    sig.geometry.attributes.position.needsUpdate = true;
    sig.geometry.attributes.aAlpha.needsUpdate = true;
  }
  update(0, 0, 0);

  return {
    root,
    update,
    labels,
    env: {
      background: ['#251c12', '#060403', '#55402a'],
      exposure: 1.0,
      envIntensity: 0.7,
      fog: { color: '#0a0705', density: 0.02 },
      bloom: { strength: 0.32, threshold: 0.96, radius: 0.5 },
      lights: { hemi: 0.45, sky: '#fff6e6', ground: '#3a2a1a', key: 2.4, keyPos: [4, 8, 6], shadowSize: 7, rim: 2.0, rimColor: '#a8c8ff', rimPos: [-6, 3, -6], fill: 0, head: 0.6 },
    },
    controls: { minDistance: 2, maxDistance: 26 },
    views: {
      overview: { pos: [6.5, 4.2, 10.5], target: [0, 0, 0] },
      close: { pos: [dying[0].p.x * 1.42 + 1.6, dying[0].p.y * 1.42 + 1.4, dying[0].p.z * 1.42 + 4.2], target: [dying[0].p.x * 1.42, dying[0].p.y * 1.42, dying[0].p.z * 1.42] },
      wide: { pos: [9, 6, 14], target: [0, 0, 0] },
    },
  };
}
