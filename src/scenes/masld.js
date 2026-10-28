import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { tissue, membrane } from '../engine/materials.js';
import { surfaceNets, sdf, displace, smoothSphere, redCellGeometry, variableTube } from '../engine/shapes.js';
import { macrophageGeometry } from '../engine/cells.js';
import { noise, rng, smoothstep, lerp } from '../engine/noise.js';

// Fatty liver (MASLD): the whole organ, plus a zoomed-in liver lobule whose cells fill with fat.
export default function build() {
  const root = new THREE.Group();
  const r = rng(81);

  // ================= Organ =================
  const organ = new THREE.Group();
  root.add(organ);
  const liverSDF = (x, y, z) => {
    let d = sdf.ellipsoid(x, y, z, -0.5, 0.0, 0.0, 1.08, 0.74, 0.8);
    d = sdf.smin(d, sdf.ellipsoid(x, y, z, 0.62, 0.16, 0.08, 1.02, 0.36, 0.62), 0.5);
    d = sdf.smax(d, -0.44 + 0.24 * x - y, 0.22); // flatter underside
    d = sdf.smax(d, -sdf.ellipsoid(x, y, z, 0.12, 0.62, 0.0, 0.08, 0.2, 0.9), 0.05); // falciform notch
    return d;
  };
  const liverGeo = surfaceNets(liverSDF, [-1.7, -0.95, -0.95], [1.75, 0.95, 0.95], 96);
  displace(liverGeo, (x, y, z) => noise.noise3(x * 1.5, y * 1.5, z * 1.5) * 0.03, true);
  {
    const p = liverGeo.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const v = 0.92 + noise.noise3(p.getX(i) * 4, p.getY(i) * 4, p.getZ(i) * 4) * 0.08;
      col.set([v, v, v], i * 3);
    }
    liverGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const LU = { uFat: { value: 0 } };
  const liverMat = tissue({ color: '#7a2018', sheen: '#ff8f7a', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, normal: null, vertexColors: true, sheenAmount: 0.5 });
  liverMat.onBeforeCompile = (sh) => {
    sh.uniforms.uFat = LU.uFat;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObjP; uniform float uFat;
        float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        float vn3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float mott = vn3(vObjP * 9.0) * 0.6 + vn3(vObjP * 23.0) * 0.4;
        vec3 fatty = mix(vec3(0.80, 0.58, 0.32), vec3(0.93, 0.78, 0.48), mott);
        diffuseColor.rgb = mix(diffuseColor.rgb, fatty, smoothstep(0.0, 1.0, uFat) * (0.75 + 0.25 * mott));`);
  };
  liverMat.customProgramCacheKey = () => 'liver-fat';
  const liver = new THREE.Mesh(liverGeo, liverMat);
  liver.castShadow = true;
  liver.receiveShadow = true;
  organ.add(liver);
  // Gallbladder and the vessels at the liver's "doorway".
  const gb = new THREE.Mesh(smoothSphere(4), tissue({ color: '#4f7d36', sheen: '#b5e08a', roughness: 0.18, clearcoat: 1, normal: null }));
  gb.scale.set(0.15, 0.13, 0.32);
  gb.position.set(-0.32, -0.52, 0.42);
  gb.rotation.set(0.3, 0.4, 0.2);
  organ.add(gb);
  const vessel = (pts, rad, color) => {
    const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const m = new THREE.Mesh(variableTube(c, (t) => rad * (1 - t * 0.25), 60, 18), tissue({ color, roughness: 0.3, clearcoat: 1, normal: null }));
    organ.add(m);
  };
  vessel([[0.05, -1.05, 0.15], [0.02, -0.75, 0.12], [-0.05, -0.45, 0.05]], 0.1, '#5a3f8f'); // portal vein
  vessel([[0.22, -1.05, 0.25], [0.15, -0.78, 0.22], [0.05, -0.48, 0.12]], 0.045, '#c0262c'); // hepatic artery
  vessel([[-0.18, -1.05, 0.32], [-0.22, -0.85, 0.35], [-0.28, -0.62, 0.38]], 0.04, '#5d8a3a'); // bile duct
  vessel([[-0.25, 0.95, -0.6], [-0.25, 0.3, -0.64], [-0.25, -0.5, -0.62], [-0.25, -1.05, -0.58]], 0.14, '#3f4f9a'); // inferior vena cava

  // ================= Cells (a liver lobule, far away in the same scene) =================
  const CELLS_X = 40;
  const lob = new THREE.Group();
  lob.position.x = CELLS_X;
  root.add(lob);
  const cells = [];
  // Hex-packed liver cells in a lobule, with radial channels (sinusoids) running to the central vein.
  const SPOKES = 12, PITCH = 0.4;
  for (let j = -10; j <= 10; j++) {
    for (let i = -10; i <= 10; i++) {
      const x = (i + (j % 2) * 0.5) * PITCH, z = j * PITCH * 0.866;
      const d = Math.hypot(x, z);
      if (d < 0.58 || d > 3.3) continue;
      const a = Math.atan2(z, x);
      const sector = (2 * Math.PI) / SPOKES;
      const off = Math.abs(((a % sector) + sector) % sector - sector / 2) * d;
      if (off < 0.11) continue;
      for (const layer of [-0.19, 0.19]) {
        cells.push({ x: x + (r() - 0.5) * 0.03, y: layer + (r() - 0.5) * 0.03, z: z + (r() - 0.5) * 0.03, rot: (r() - 0.5) * 0.5, size: 0.33 + r() * 0.03, thr: 0.12 + r() * 0.5, balloon: r() < 0.22, ph: r() * 6, nd: new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.4, r() - 0.5).normalize() });
      }
    }
  }
  const CN = cells.length;
  const cellGeo = new RoundedBoxGeometry(1, 1, 1, 3, 0.18);
  const cellMat = membrane({ color: '#ffc4cf', minAlpha: 0.32, maxAlpha: 0.9, roughness: 0.3 });
  const cellMesh = new THREE.InstancedMesh(cellGeo, cellMat, CN);
  cellMesh.renderOrder = 3;
  const nucMesh = new THREE.InstancedMesh(smoothSphere(3), tissue({ color: '#5b2f86', sheen: '#a77ae0', roughness: 0.35, normal: null }), CN);
  const fatMat = new THREE.MeshPhysicalMaterial({ color: '#ffd35a', roughness: 0.08, clearcoat: 1, emissive: '#b37a00', emissiveIntensity: 0.25 });
  const fatMesh = new THREE.InstancedMesh(smoothSphere(4), fatMat, CN);
  const MICRO = 4;
  const microMesh = new THREE.InstancedMesh(smoothSphere(2), fatMat, CN * MICRO);
  const microOff = Array.from({ length: CN * MICRO }, () => new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.55));
  lob.add(cellMesh, nucMesh, fatMesh, microMesh);

  // Central vein and portal triads at the corners.
  const cv = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.8, 40, 1, true), tissue({ color: '#5a4aa0', roughness: 0.3, clearcoat: 1, normal: null, side: THREE.DoubleSide }));
  lob.add(cv);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const R = 3.55;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
    const tri = [['#5a3f8f', 0.16, -0.12, 0], ['#c0262c', 0.08, 0.14, 0.05], ['#5d8a3a', 0.07, 0.04, -0.16]];
    for (const [c, rr, ox, oz] of tri) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, 0.8, 20), tissue({ color: c, roughness: 0.3, clearcoat: 1, normal: null }));
      m.position.set(ox, 0, oz);
      g.add(m);
    }
    lob.add(g);
  }
  // Blood flowing between the cords toward the central vein.
  const BN = 110;
  const blood = new THREE.InstancedMesh(redCellGeometry(16), tissue({ color: '#b5111f', roughness: 0.3, clearcoat: 0.8, normal: null }), BN);
  const bSeeds = Array.from({ length: BN }, () => ({ a: (Math.floor(r() * SPOKES) / SPOKES) * Math.PI * 2 + Math.PI / SPOKES, ph: r(), y: (r() - 0.5) * 0.5, rot: r() * 6 }));
  lob.add(blood);
  // Inflammation (late stage).
  const IN = 26;
  const imm = new THREE.InstancedMesh(macrophageGeometry(3), tissue({ color: '#8f7ad6', sheen: '#d0c2ff', roughness: 0.4, normal: null, emissive: '#4a2aa0', emissiveIntensity: 0.3 }), IN);
  const iSeeds = Array.from({ length: IN }, () => ({ c: Math.floor(r() * CN), off: new THREE.Vector3(r() - 0.5, 0.35 + r() * 0.1, r() - 0.5), thr: 0.82 + r() * 0.15 }));
  lob.add(imm);
  const FN = 40;
  const fib = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 6), new THREE.MeshStandardMaterial({ color: '#f1f4ff', roughness: 0.5, emissive: '#8aa0ff', emissiveIntensity: 0.15 }), FN);
  const fSeeds = Array.from({ length: FN }, () => ({ a: r() * Math.PI * 2, rad: 0.45 + r() * 3, len: 0.4 + r() * 0.8, tilt: (r() - 0.5) * 0.6, y: (r() - 0.5) * 0.5, thr: 0.88 + r() * 0.1 }));
  lob.add(fib);

  // ================= Labels =================
  const near = 12;
  const labels = [
    { text: 'Liver', at: [0.9, 0.42, 0.3], near, when: (s) => s <= 0.55 },
    { text: 'Fatty liver', at: [-1.0, 0.45, 0.5], side: 'left', near, when: (s) => s > 0.55 },
    { text: 'Liver cells', at: [CELLS_X + Math.cos(0.2) * 2.5, 0.42, Math.sin(0.2) * 2.5], near },
    { text: 'Fat', at: [CELLS_X + 1.6, 0.4, 1.4], near, when: (s) => s > 0.35 },
    { text: 'Scarring', at: [CELLS_X - 1.8, 0.45, 1.5], side: 'left', near, when: (s) => s > 0.88 },
  ];

  const dummy = new THREE.Object3D();
  const tc = new THREE.Color();
  const cHealthy = new THREE.Color('#ffc4cf'), cStressed = new THREE.Color('#ffe0b8');
  function update(t, dt, s) {
    LU.uFat.value = smoothstep(0.15, 0.95, s);
    organ.scale.setScalar(1 + smoothstep(0.3, 1, s) * 0.08);
    liverMat.roughness = lerp(0.22, 0.32, s);

    for (let i = 0; i < CN; i++) {
      const c = cells[i];
      const fat = smoothstep(c.thr, c.thr + 0.35, s);
      const balloon = c.balloon ? smoothstep(0.85, 1, s) : 0;
      const sz = c.size * (1 + fat * 0.12 + balloon * 0.18);
      dummy.position.set(c.x, c.y, c.z);
      dummy.rotation.set(0, c.rot, 0);
      dummy.scale.set(sz, sz * 1.05, sz);
      dummy.updateMatrix();
      cellMesh.setMatrixAt(i, dummy.matrix);
      tc.copy(cHealthy).lerp(cStressed, fat * 0.5);
      cellMesh.setColorAt(i, tc);
      // Big droplet pushes the nucleus to the side.
      const dropR = 0.15 * fat * sz / 0.33;
      dummy.position.set(c.x, c.y, c.z);
      dummy.scale.setScalar(dropR + 0.0001);
      dummy.updateMatrix();
      fatMesh.setMatrixAt(i, dummy.matrix);
      const push = 0.05 + fat * 0.08;
      dummy.position.set(c.x + c.nd.x * push, c.y + c.nd.y * push, c.z + c.nd.z * push);
      dummy.scale.setScalar(0.065 * (1 - fat * 0.25));
      dummy.updateMatrix();
      nucMesh.setMatrixAt(i, dummy.matrix);
      const micro = smoothstep(c.thr - 0.1, c.thr + 0.15, s) * (1 - fat * 0.8);
      for (let m = 0; m < MICRO; m++) {
        const o = microOff[i * MICRO + m];
        dummy.position.set(c.x + o.x * sz, c.y + o.y * sz, c.z + o.z * sz);
        dummy.scale.setScalar(0.035 * micro + 0.0001);
        dummy.updateMatrix();
        microMesh.setMatrixAt(i * MICRO + m, dummy.matrix);
      }
    }
    cellMesh.instanceMatrix.needsUpdate = true;
    cellMesh.instanceColor.needsUpdate = true;
    fatMesh.instanceMatrix.needsUpdate = true;
    nucMesh.instanceMatrix.needsUpdate = true;
    microMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < BN; i++) {
      const b = bSeeds[i];
      const f = (b.ph + t * 0.12) % 1;
      const rad = lerp(3.3, 0.35, f);
      dummy.position.set(Math.cos(b.a) * rad, b.y * (1 - f), Math.sin(b.a) * rad);
      dummy.rotation.set(b.rot + t, b.rot, 0);
      dummy.scale.setScalar(0.07 * smoothstep(0, 0.08, f) * (1 - smoothstep(0.92, 1, f)));
      dummy.updateMatrix();
      blood.setMatrixAt(i, dummy.matrix);
    }
    blood.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < IN; i++) {
      const im = iSeeds[i];
      const c = cells[im.c];
      const g = smoothstep(im.thr, im.thr + 0.08, s);
      dummy.position.set(c.x + im.off.x * 0.3, c.y + im.off.y, c.z + im.off.z * 0.3);
      dummy.rotation.set(t * 0.3 + i, i, 0);
      dummy.scale.setScalar(0.12 * g);
      dummy.updateMatrix();
      imm.setMatrixAt(i, dummy.matrix);
    }
    imm.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < FN; i++) {
      const f = fSeeds[i];
      const g = smoothstep(f.thr, f.thr + 0.06, s);
      dummy.position.set(Math.cos(f.a) * f.rad, f.y, Math.sin(f.a) * f.rad);
      dummy.rotation.set(Math.PI / 2, 0, -f.a + f.tilt);
      dummy.scale.set(1, f.len * g + 0.0001, 1);
      dummy.updateMatrix();
      fib.setMatrixAt(i, dummy.matrix);
    }
    fib.instanceMatrix.needsUpdate = true;
  }
  update(0, 0, 0);

  return {
    root,
    update,
    labels,
    env: {
      background: ['#24141a', '#060304', '#4d2632'],
      exposure: 1.0,
      envIntensity: 0.7,
      bloom: { strength: 0.3, threshold: 0.96, radius: 0.5 },
      lights: { hemi: 0.45, sky: '#fff0ea', ground: '#3a1a1a', key: 2.6, keyPos: [3, 7, 6], shadowSize: 6, rim: 2.0, rimColor: '#a8c8ff', rimPos: [-5, 3, -6], fill: 0, head: 0.6 },
    },
    controls: { minDistance: 1.5, maxDistance: 16 },
    views: {
      organ: { pos: [2.4, 1.5, 4.4], target: [0, -0.1, 0] },
      cells: { pos: [CELLS_X + 3.6, 4.4, 4.6], target: [CELLS_X, -0.2, 0] },
      overview: { pos: [2.4, 1.5, 4.4], target: [0, -0.1, 0] },
    },
  };
}
