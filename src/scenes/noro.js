import * as THREE from 'three';
import { tissue, glowPoints } from '../engine/materials.js';
import { virusGeometry, displace } from '../engine/shapes.js';
import { noise, rng, smoothstep, lerp } from '../engine/noise.js';

// Norovirus: the small-intestine lining — villi soak up water until the virus blunts them.
export default function build() {
  const root = new THREE.Group();
  const r = rng(21);
  const W = 9, D = 5;

  // ---------- Gut wall: mucosa / submucosa / muscle, shown as a cut slab ----------
  const layers = [
    { h: 0.22, color: '#e48f86', name: 'mucosa' },
    { h: 0.32, color: '#f3d2c4', name: 'submucosa' },
    { h: 0.42, color: '#b8463f', name: 'muscle' },
  ];
  let y0 = 0;
  for (const L of layers) {
    const g = new THREE.BoxGeometry(W, L.h, D, 1, 1, 1);
    g.translate(0, y0 - L.h / 2, 0);
    const m = new THREE.Mesh(g, tissue({ color: L.color, roughness: 0.55, clearcoat: 0.3, normal: 'organic', normalScale: 0.35, repeat: [4, 2] }));
    m.receiveShadow = true;
    root.add(m);
    y0 -= L.h;
  }
  // Mucosal surface between villi.
  const floorGeo = new THREE.PlaneGeometry(W, D, 140, 80).rotateX(-Math.PI / 2);
  displace(floorGeo, (x, y, z) => noise.noise3(x * 1.4, 0, z * 1.4) * 0.03 + Math.max(0, noise.noise3(x * 6, 1, z * 6)) * 0.015, true);
  const floor = new THREE.Mesh(floorGeo, tissue({ color: '#d77d72', sheen: '#ffc0b0', roughness: 0.4, clearcoat: 0.8, normal: 'cells', normalScale: 0.6, repeat: [14, 8] }));
  floor.position.y = 0.002;
  floor.receiveShadow = true;
  root.add(floor);

  // ---------- Villi ----------
  const prof = [];
  const n = 22;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let rad;
    if (t < 0.12) rad = lerp(0.15, 0.092, smoothstep(0, 0.12, t));
    else if (t < 0.86) rad = 0.092 + Math.sin(t * 9) * 0.004;
    else rad = 0.092 * Math.sqrt(Math.max(0, 1 - ((t - 0.86) / 0.14) ** 2));
    prof.push(new THREE.Vector2(Math.max(rad, 0.0005), t));
  }
  const villusGeo = new THREE.LatheGeometry(prof, 20);
  villusGeo.computeVertexNormals();
  displace(villusGeo, (x, y, z) => noise.noise3(x * 18, y * 6, z * 18) * 0.008 * smoothstep(0, 0.2, y));
  // Vertex colour: deeper red near the base, paler tips.
  {
    const p = villusGeo.attributes.position;
    const col = new Float32Array(p.count * 3);
    const a = new THREE.Color('#c9584f'), b = new THREE.Color('#ffd0c4'), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      c.copy(a).lerp(b, smoothstep(0.05, 1, p.getY(i)));
      col.set([c.r, c.g, c.b], i * 3);
    }
    villusGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const villusMat = tissue({ color: '#ffffff', sheen: '#ffd9cf', roughness: 0.36, clearcoat: 0.7, normal: 'cells', normalScale: 0.45, repeat: [3, 5], vertexColors: true, sheenAmount: 0.8 });
  const villi = [];
  const pitch = 0.3;
  for (let iz = 0; iz * pitch * 0.866 < D - 0.25; iz++) {
    for (let ix = 0; ix * pitch < W - 0.25; ix++) {
      const x = -W / 2 + 0.2 + ix * pitch + (iz % 2) * pitch * 0.5 + (r() - 0.5) * 0.08;
      const z = -D / 2 + 0.2 + iz * pitch * 0.866 + (r() - 0.5) * 0.08;
      villi.push({ x, z, h: 1.0 + r() * 0.35, w: 0.9 + r() * 0.25, lean: (r() - 0.5) * 0.18, leanZ: (r() - 0.5) * 0.18, blunt: 0.32 + r() * 0.2, thr: 0.25 + r() * 0.35, ph: r() * 6 });
    }
  }
  const villusMesh = new THREE.InstancedMesh(villusGeo, villusMat, villi.length);
  villusMesh.castShadow = true;
  villusMesh.receiveShadow = true;
  root.add(villusMesh);

  // ---------- Water, nutrients, virus ----------
  const WN = 300;
  const water = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 3),
    new THREE.MeshPhysicalMaterial({ color: '#5fc8ff', roughness: 0.05, clearcoat: 1, emissive: '#0b4a8a', emissiveIntensity: 0.7, transparent: true, opacity: 0.9 }),
    WN
  );
  const wSeeds = Array.from({ length: WN }, () => ({
    ph: r(), sp: 0.18 + r() * 0.12, v: Math.floor(r() * villi.length), x: (r() - 0.5) * W * 0.9, z: (r() - 0.5) * D * 0.9, y: 1.7 + r() * 1.4, k: r(), size: 0.03 + r() * 0.025,
  }));
  root.add(water);

  const NN = 140;
  const nutrients = glowPoints(NN, { color: '#ffc04d', size: 0.07 });
  const nSeeds = Array.from({ length: NN }, () => ({ ph: r(), sp: 0.12 + r() * 0.1, v: Math.floor(r() * villi.length), x: (r() - 0.5) * W, z: (r() - 0.5) * D * 0.9, y: 1.6 + r() * 1.4 }));
  root.add(nutrients);

  const VN = 150;
  const virus = new THREE.InstancedMesh(
    virusGeometry({ knobs: 'noro', detail: 3 }),
    new THREE.MeshPhysicalMaterial({ color: '#7be35a', roughness: 0.32, clearcoat: 1, emissive: '#2d6b1a', emissiveIntensity: 0.9 }),
    VN
  );
  virus.castShadow = true;
  const vSeeds = Array.from({ length: VN }, () => ({ v: Math.floor(r() * villi.length), thr: 0.1 + r() * 0.4, from: new THREE.Vector3((r() - 0.5) * W, 2 + r() * 1.5, (r() - 0.5) * D), ph: r() * 6, rot: r() * 6 }));
  root.add(virus);

  // ---------- Labels ----------
  const lv = new THREE.Object3D(), lw = new THREE.Object3D(), lvir = new THREE.Object3D(), lb = new THREE.Object3D(), lout = new THREE.Object3D();
  root.add(lv, lw, lvir, lb, lout);
  const labels = [
    { text: 'Villi', parent: lv, when: (s) => s < 0.55 },
    { text: 'Damaged villi', parent: lb, when: (s) => s >= 0.55 },
    { text: 'Water in', parent: lw, when: (s) => s < 0.45 },
    { text: 'Water out', parent: lout, when: (s) => s > 0.65 },
    { text: 'Virus', parent: lvir, when: (s) => s > 0.15 && s < 0.9 },
  ];
  const tipVillus = villi[Math.floor(villi.length * 0.55)];

  const dummy = new THREE.Object3D();
  const tmp = new THREE.Vector3();
  const cHealthy = new THREE.Color('#ffffff'), cSick = new THREE.Color('#d98e86'), cDead = new THREE.Color('#9b6a66');
  const tc = new THREE.Color();

  function villusTop(v, s) {
    const b = smoothstep(v.thr, v.thr + 0.35, s);
    const h = v.h * lerp(1, v.blunt, b);
    return { h, w: v.w * lerp(1, 1.45, b), b };
  }

  function update(t, dt, s) {
    // Villi sway gently and blunt as the infection takes hold.
    for (let i = 0; i < villi.length; i++) {
      const v = villi[i];
      const { h, w, b } = villusTop(v, s);
      dummy.position.set(v.x, 0, v.z);
      dummy.rotation.set(v.leanZ + Math.sin(t * 0.8 + v.ph) * 0.03, 0, v.lean + Math.cos(t * 0.7 + v.ph) * 0.03);
      dummy.scale.set(w, h, w);
      dummy.updateMatrix();
      villusMesh.setMatrixAt(i, dummy.matrix);
      tc.copy(cHealthy).lerp(cSick, smoothstep(0.2, 0.7, s) * 0.8).lerp(cDead, b * 0.35);
      villusMesh.setColorAt(i, tc);
      v.top = h;
    }
    villusMesh.instanceMatrix.needsUpdate = true;
    villusMesh.instanceColor.needsUpdate = true;

    // Water: soaked into villi when healthy, pouring out and rushing along when sick.
    const leak = smoothstep(0.45, 0.95, s);
    let lwSet = false, loSet = false;
    for (let i = 0; i < WN; i++) {
      const w = wSeeds[i];
      const out = w.k < leak * 0.85;
      const speed = out ? w.sp * 2.2 : w.sp;
      const f = (w.ph + t * speed) % 1;
      const vv = villi[w.v];
      if (!out) {
        tmp.set(vv.x, (vv.top || 1) * 0.75, vv.z);
        dummy.position.set(w.x, w.y, w.z).lerp(tmp, smoothstep(0, 1, f));
        const a = Math.sin(Math.PI * Math.min(1, f * 1.15)) * (1 - smoothstep(0.85, 1, f));
        dummy.scale.setScalar(w.size * Math.max(0, a));
        if (!lwSet && f > 0.3 && f < 0.6 && i % 3 === 0) { lw.position.copy(dummy.position); lwSet = true; }
      } else {
        const bx = vv.x, bz = vv.z;
        dummy.position.set(((bx + f * 5 + W / 2) % W) - W / 2, 0.15 + f * 2.2 + Math.sin(f * 8 + i) * 0.1, bz);
        dummy.scale.setScalar(w.size * 1.15 * Math.sin(Math.PI * f) * smoothstep(W / 2, W / 2 - 0.4, Math.abs(dummy.position.x)));
        if (!loSet && f > 0.35 && f < 0.6) { lout.position.copy(dummy.position); loSet = true; }
      }
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      water.setMatrixAt(i, dummy.matrix);
    }
    water.instanceMatrix.needsUpdate = true;

    // Nutrients: absorbed when healthy, swept away when sick.
    const pos = nutrients.geometry.attributes.position.array;
    const al = nutrients.geometry.attributes.aAlpha.array;
    for (let i = 0; i < NN; i++) {
      const nn = nSeeds[i];
      const f = (nn.ph + t * nn.sp) % 1;
      const vv = villi[nn.v];
      if (i / NN > leak * 0.8) {
        tmp.set(vv.x, (vv.top || 1) * 0.6, vv.z);
        const p = tmp.clone().lerp(new THREE.Vector3(nn.x, nn.y, nn.z), 1 - f);
        pos.set([p.x, p.y, p.z], i * 3);
        al[i] = Math.sin(Math.PI * f) * 0.9;
      } else {
        pos.set([((nn.x + f * 6 + W / 2) % W) - W / 2, nn.y * 0.8, nn.z], i * 3);
        al[i] = Math.sin(Math.PI * f) * 0.6;
      }
    }
    nutrients.geometry.attributes.position.needsUpdate = true;
    nutrients.geometry.attributes.aAlpha.needsUpdate = true;

    // Virus particles drift in and stick to villus tips.
    let lvSet = false;
    for (let i = 0; i < VN; i++) {
      const v = vSeeds[i];
      const vv = villi[v.v];
      const p = smoothstep(v.thr, v.thr + 0.25, s);
      const vis = smoothstep(v.thr - 0.08, v.thr, s);
      tmp.set(vv.x + Math.sin(vv.lean) * 0.0, (vv.top || 1) + 0.08, vv.z);
      dummy.position.copy(v.from).lerp(tmp, p * p * (3 - 2 * p));
      dummy.position.x += Math.sin(t + v.ph) * 0.15 * (1 - p);
      dummy.position.y += Math.cos(t * 0.8 + v.ph) * 0.1 * (1 - p);
      dummy.rotation.set(v.rot + t * 0.5, v.rot, 0);
      dummy.scale.setScalar(0.06 * vis);
      dummy.updateMatrix();
      virus.setMatrixAt(i, dummy.matrix);
      if (!lvSet && vis > 0.9 && p < 0.85 && p > 0.1) { lvir.position.copy(dummy.position); lvSet = true; }
    }
    if (!lvSet) lvir.position.set(vSeeds[0].from.x, 1.6, vSeeds[0].from.z);
    virus.instanceMatrix.needsUpdate = true;

    lv.position.set(tipVillus.x, tipVillus.top || 1.2, tipVillus.z);
    lb.position.set(tipVillus.x, (tipVillus.top || 0.5) + 0.05, tipVillus.z);
    if (!lwSet) lw.position.set(0, 1.5, 0);
    if (!loSet) lout.position.set(1, 1.2, 0);
  }
  update(0, 0, 0);

  return {
    root,
    update,
    labels,
    env: {
      background: ['#2a1418', '#080405', '#61303a'],
      exposure: 1.0,
      envIntensity: 0.45,
      fog: { color: '#12080a', density: 0.025 },
      bloom: { strength: 0.3, threshold: 0.96, radius: 0.5 },
      lights: { hemi: 0.4, sky: '#ffe6e0', ground: '#401818', key: 2.4, keyPos: [-3, 8, 5], shadowSize: 6, rim: 1.8, rimColor: '#9cc4ff', rimPos: [5, 3, -6], fill: 4, fillColor: '#ff9a88', fillPos: [0, 1, 4] },
    },
    controls: { minDistance: 1.5, maxDistance: 20 },
    views: {
      overview: { pos: [5.4, 3.8, 7.2], target: [0, 0.4, 0] },
      close: { pos: [1.2, 1.7, 2.9], target: [0.1, 0.7, 0.4] },
      wide: { pos: [7.5, 5.5, 9.5], target: [0, 0, 0] },
    },
  };
}
