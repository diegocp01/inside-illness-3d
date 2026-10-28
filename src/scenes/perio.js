import * as THREE from 'three';
import { glowPoints } from '../engine/materials.js';
import { smoothSphere, displace } from '../engine/shapes.js';
import { noise, rng, smoothstep, lerp } from '../engine/noise.js';
import { buildTooth, buildGumBone, makeToothUniforms, toothSDF, BONE_TOP } from './toothKit.js';

// Severe periodontitis: plaque and tartar under the gum, a deepening pocket, bone loss and a loose tooth.
export default function build() {
  const root = new THREE.Group();
  const r = rng(111);
  const U = makeToothUniforms();
  const tooth = buildTooth(U);
  const { bone, gum } = buildGumBone(U);
  const toothPivot = new THREE.Group();
  toothPivot.position.y = -1.0;
  tooth.group.position.y = 1.0;
  toothPivot.add(tooth.group);
  root.add(toothPivot, bone, gum);

  // Root surface point at height y on the cut plane (marching in from the side).
  function rootSurfaceX(y, sgn, z = -0.02) {
    let x = sgn * 1.0;
    for (let i = 0; i < 120; i++) {
      const d = toothSDF(x, y, z);
      if (d < 0.001) return x;
      x -= sgn * Math.max(d * 0.8, 0.002);
      if (Math.abs(x) < 0.01) break;
    }
    return x;
  }

  // ---------- Ligament fibres between root and bone ----------
  const FN = 70;
  const fibers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 5), new THREE.MeshStandardMaterial({ color: '#ffd9d0', roughness: 0.6, emissive: '#ff9a8a', emissiveIntensity: 0.15 }), FN);
  const fSeeds = [];
  for (let i = 0; i < FN; i++) {
    const sgn = i % 2 ? 1 : -1;
    const y = -0.28 - (i / FN) * 1.5;
    const x = rootSurfaceX(y, sgn);
    fSeeds.push({ x, y, sgn, z: -0.03 - r() * 0.15 });
  }
  toothPivot.add(fibers);

  // ---------- Tartar (calculus) and plaque on the root ----------
  const TN = 70;
  const tartarGeo = smoothSphere(2);
  displace(tartarGeo, (x, y, z) => noise.noise3(x * 3, y * 3, z * 3) * 0.25);
  const tartar = new THREE.InstancedMesh(tartarGeo, new THREE.MeshPhysicalMaterial({ color: '#cfae5c', roughness: 0.75, clearcoat: 0.2 }), TN);
  const tSeeds = [];
  for (let i = 0; i < TN; i++) {
    const sgn = r() < 0.5 ? -1 : 1;
    const y = 0.12 - r() * 1.1;
    const z = -0.01 - r() * 0.2;
    const x = rootSurfaceX(y, sgn, z);
    tSeeds.push({ x, y, z, sgn, size: 0.025 + r() * 0.03 });
  }
  tooth.group.add(tartar);

  // ---------- Bacteria in the pocket (wiggly spirochetes) ----------
  const BN = 60;
  const spiral = (() => {
    const pts = [];
    for (let i = 0; i <= 24; i++) pts.push(new THREE.Vector3(Math.sin(i * 0.9) * 0.15, i * 0.07 - 0.84, Math.cos(i * 0.9) * 0.15));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.05, 6, false);
  })();
  const bugs = new THREE.InstancedMesh(spiral, new THREE.MeshPhysicalMaterial({ color: '#4d3a8f', roughness: 0.4, clearcoat: 0.8, emissive: '#2a1a6a', emissiveIntensity: 0.4 }), BN);
  const bSeeds = Array.from({ length: BN }, () => ({ sgn: r() < 0.5 ? -1 : 1, f: r(), z: -0.02 - r() * 0.12, ph: r() * 6, rot: r() * 6 }));
  root.add(bugs);
  // Defender cells and bleeding.
  const IN = 70;
  const defend = glowPoints(IN, { color: '#ff6a5a', size: 0.07 });
  const iSeeds = Array.from({ length: IN }, () => ({ sgn: r() < 0.5 ? -1 : 1, f: r(), dx: 0.05 + r() * 0.35, z: r() * 0.02, ph: r() }));
  root.add(defend);

  // ---------- Labels ----------
  const labels = [
    { text: 'Gum', at: [-0.82, 0.02, 0.0], side: 'left', when: (s) => s < 0.45 },
    { text: 'Swollen gum', at: [-0.82, 0.0, 0.0], side: 'left', when: (s) => s >= 0.45 },
    { text: 'Bone', at: [-0.95, -1.15, 0.0], side: 'left', when: (s) => s < 0.7 },
    { text: 'Bone loss', at: [-0.8, BONE_TOP - 0.9, 0.0], side: 'left', when: (s) => s >= 0.7 },
    { text: 'Tartar', at: [0.47, -0.05, -0.05], when: (s) => s > 0.3 },
    { text: 'Pocket', at: [0.62, -0.55, 0.0], when: (s) => s > 0.72 },
  ];

  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  function update(t, dt, s) {
    U.uTime.value = t;
    const crest = lerp(BONE_TOP, BONE_TOP - 1.0, smoothstep(0.55, 1.0, s));
    U.uCrest.value = crest;
    U.uPocket.value = smoothstep(0.55, 0.9, s) * 0.16;
    U.uRecede.value = smoothstep(0.6, 1.0, s) * 0.16;
    U.uInflame.value = smoothstep(0.3, 0.6, s);
    // A loose tooth wobbles.
    const loose = smoothstep(0.8, 1.0, s);
    toothPivot.rotation.z = Math.sin(t * 3.2) * 0.035 * loose;

    for (let i = 0; i < FN; i++) {
      const f = fSeeds[i];
      const len = 0.06;
      dummy.position.set(f.x + f.sgn * len * 0.5, f.y + 1.0, f.z);
      dummy.quaternion.setFromUnitVectors(up, new THREE.Vector3(f.sgn * 0.8, 0.6, 0).normalize());
      dummy.scale.set(1, len * (f.y < crest - 0.05 ? 1 : 0.0001), 1);
      dummy.updateMatrix();
      fibers.setMatrixAt(i, dummy.matrix);
    }
    fibers.instanceMatrix.needsUpdate = true;

    const tartarOn = smoothstep(0.2, 0.5, s);
    for (let i = 0; i < TN; i++) {
      const tt = tSeeds[i];
      const reach = lerp(0.1, crest + 0.05, smoothstep(0.3, 1, s));
      const g = tartarOn * (tt.y > reach ? 1 : 0);
      dummy.position.set(tt.x + tt.sgn * 0.012, tt.y, tt.z);
      dummy.quaternion.identity();
      dummy.scale.setScalar(tt.size * g);
      dummy.updateMatrix();
      tartar.setMatrixAt(i, dummy.matrix);
    }
    tartar.instanceMatrix.needsUpdate = true;

    const bugsOn = smoothstep(0.55, 0.85, s);
    for (let i = 0; i < BN; i++) {
      const b = bSeeds[i];
      const y = lerp(0.1, crest + 0.05, b.f);
      const x = rootSurfaceXCached(y, b.sgn) + b.sgn * (0.04 + U.uPocket.value * 0.5);
      dummy.position.set(x, y, b.z);
      dummy.rotation.set(b.rot + Math.sin(t * 3 + b.ph) * 0.4, b.rot + t, 0);
      dummy.scale.setScalar(0.05 * bugsOn);
      dummy.updateMatrix();
      bugs.setMatrixAt(i, dummy.matrix);
    }
    bugs.instanceMatrix.needsUpdate = true;

    const dp = defend.geometry.attributes.position.array;
    const da = defend.geometry.attributes.aAlpha.array;
    const inflame = U.uInflame.value;
    for (let i = 0; i < IN; i++) {
      const d = iSeeds[i];
      const f = (d.ph + t * 0.15) % 1;
      const y = lerp(0.05, crest + 0.1, d.f);
      const x = rootSurfaceXCached(y, d.sgn) + d.sgn * (d.dx * (1 - f) + 0.05);
      dp.set([x, y, 0.03], i * 3);
      da[i] = inflame * Math.sin(f * Math.PI) * 0.8;
    }
    defend.geometry.attributes.position.needsUpdate = true;
    defend.geometry.attributes.aAlpha.needsUpdate = true;
  }
  const rsCache = new Map();
  function rootSurfaceXCached(y, sgn) {
    const k = `${Math.round(y * 100)}:${sgn}`;
    if (!rsCache.has(k)) rsCache.set(k, rootSurfaceX(Math.round(y * 100) / 100, sgn));
    return rsCache.get(k);
  }
  update(0, 0, 0);

  return {
    root,
    update,
    labels,
    env: {
      background: ['#1c1520', '#050406', '#3c2a45'],
      exposure: 0.9,
      envIntensity: 0.55,
      bloom: { strength: 0.18, threshold: 0.96, radius: 0.45 },
      lights: { hemi: 0.4, sky: '#fff2f2', ground: '#2a1a1a', key: 2.0, keyPos: [3, 6, 6], shadowSize: 3.5, rim: 2.0, rimColor: '#9fc4ff', rimPos: [-5, 3, -5], fill: 0, head: 0.65 },
    },
    controls: { minDistance: 1.2, maxDistance: 14 },
    views: {
      overview: { pos: [2.2, 0.6, 6.6], target: [0, -0.6, 0] },
      gumline: { pos: [1.5, 0.6, 2.8], target: [0.45, -0.05, 0] },
      pocket: { pos: [1.7, -0.2, 3.0], target: [0.5, -0.55, 0] },
    },
  };
}
