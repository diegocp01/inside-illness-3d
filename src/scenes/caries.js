import * as THREE from 'three';
import { glowPoints } from '../engine/materials.js';
import { smoothSphere } from '../engine/shapes.js';
import { rng, smoothstep, lerp } from '../engine/noise.js';
import { buildTooth, buildGumBone, makeToothUniforms, toothTop } from './toothKit.js';

// Tooth decay: a molar cut in half; plaque bacteria make acid that carves a cavity toward the nerve.
export default function build() {
  const root = new THREE.Group();
  const r = rng(101);
  const U = makeToothUniforms();
  const tooth = buildTooth(U);
  const { bone, gum } = buildGumBone(U);
  root.add(tooth.group, bone, gum);

  const topY = toothTop(0.0, -0.01);
  const fissure = new THREE.Vector3(0, topY, 0);

  // ---------- Plaque bacteria (Streptococcus mutans: chains of round cells) ----------
  const CHAINS = 26, PER = 5;
  const bact = new THREE.InstancedMesh(smoothSphere(2), new THREE.MeshPhysicalMaterial({ color: '#7b5bd6', roughness: 0.35, clearcoat: 1, emissive: '#3b1f90', emissiveIntensity: 0.35 }), CHAINS * PER);
  bact.castShadow = true;
  const chains = [];
  for (let c = 0; c < CHAINS; c++) {
    const x = (r() - 0.5) * 0.7, z = -0.02 - r() * 0.45;
    const y = toothTop(x, z);
    const dir = new THREE.Vector3(r() - 0.5, 0, r() - 0.5).normalize();
    chains.push({ x, y, z, dir, thr: 0.05 + r() * 0.35, ph: r() * 6 });
  }
  root.add(bact);

  // ---------- Sugar and acid ----------
  const SN = 40;
  const sugar = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.25, clearcoat: 1, emissive: '#ffffff', emissiveIntensity: 0.15 }), SN);
  const sSeeds = Array.from({ length: SN }, () => ({ x: (r() - 0.5) * 0.8, z: -r() * 0.5, ph: r(), rot: new THREE.Euler(r() * 6, r() * 6, r() * 6), size: 0.03 + r() * 0.02 }));
  root.add(sugar);
  const AN = 160;
  const acid = glowPoints(AN, { color: '#d6ff4a', size: 0.06 });
  const aSeeds = Array.from({ length: AN }, () => ({ c: Math.floor(r() * CHAINS), ph: r(), dx: (r() - 0.5) * 0.2, dz: (r() - 0.5) * 0.2 }));
  root.add(acid);
  // Pain signals running down the root canals.
  const PN = 50;
  const pain = glowPoints(PN, { color: '#ff4a3a', size: 0.08 });
  const pSeeds = Array.from({ length: PN }, () => ({ side: r() < 0.5 ? -1 : 1, ph: r() }));
  root.add(pain);

  // ---------- Labels ----------
  const labels = [
    { text: 'Enamel', at: [0.52, 0.72, 0.0] },
    { text: 'Dentin', at: [0.36, 0.2, 0.01] },
    { text: 'Nerve', at: [-0.08, 0.3, 0.012], side: 'left' },
    { text: 'Bacteria', at: [0.28, topY - 0.02, -0.25], when: (s) => s > 0.15 && s < 0.45 },
    { text: 'White spot', at: [0.05, topY, 0.0], when: (s) => s >= 0.3 && s < 0.5 },
    { text: 'Cavity', at: [0.0, topY - 0.08, 0.0], when: (s) => s >= 0.5 && s < 0.85 },
    { text: 'Toothache', at: [0.0, 0.5, 0.015], when: (s) => s >= 0.85 },
  ];

  const dummy = new THREE.Object3D();
  const tmp = new THREE.Vector3();
  const pulpHorn = new THREE.Vector3(0, 0.5, 0);
  function update(t, dt, s) {
    U.uTime.value = t;
    // Cavity grows and deepens from the fissure toward the pulp.
    const decay = smoothstep(0.35, 1.0, s);
    const R = lerp(0.0, 0.36, decay);
    U.uCavR.value = decay > 0.001 ? Math.max(0.02, R) : 0;
    U.uCavC.value.copy(fissure).lerp(pulpHorn, lerp(0.05, 0.62, decay));
    U.uCavC.value.y += 0.04;
    U.uStain.value = smoothstep(0.4, 0.6, s);
    U.uChalk.value = smoothstep(0.15, 0.4, s) * (1 - smoothstep(0.45, 0.6, s));
    U.uPain.value = smoothstep(0.82, 1.0, s);

    const plaque = smoothstep(0.05, 0.35, s);
    for (let c = 0; c < CHAINS; c++) {
      const ch = chains[c];
      const g = smoothstep(ch.thr, ch.thr + 0.15, s) * plaque;
      for (let k = 0; k < PER; k++) {
        const wob = Math.sin(t * 2 + ch.ph + k) * 0.004;
        dummy.position.set(ch.x + ch.dir.x * k * 0.034, ch.y + 0.018 + wob, ch.z + ch.dir.z * k * 0.034);
        dummy.scale.setScalar(0.018 * g);
        dummy.updateMatrix();
        bact.setMatrixAt(c * PER + k, dummy.matrix);
      }
    }
    bact.instanceMatrix.needsUpdate = true;

    // Sugar falls during the "eating" part, then dissolves.
    const eat = smoothstep(0.1, 0.25, s) * (1 - smoothstep(0.7, 0.9, s));
    for (let i = 0; i < SN; i++) {
      const sd = sSeeds[i];
      const f = (sd.ph + t * 0.25) % 1;
      const y0 = toothTopCached(sd);
      dummy.position.set(sd.x, lerp(y0 + 1.0, y0 + 0.02, smoothstep(0, 0.6, f)), sd.z);
      dummy.rotation.set(sd.rot.x + t, sd.rot.y, sd.rot.z);
      dummy.scale.setScalar(sd.size * eat * (1 - smoothstep(0.65, 1, f)));
      dummy.updateMatrix();
      sugar.setMatrixAt(i, dummy.matrix);
    }
    sugar.instanceMatrix.needsUpdate = true;

    const ap = acid.geometry.attributes.position.array;
    const aa = acid.geometry.attributes.aAlpha.array;
    const acidOn = smoothstep(0.15, 0.35, s) * (1 - smoothstep(0.9, 1, s) * 0.5);
    for (let i = 0; i < AN; i++) {
      const a = aSeeds[i];
      const ch = chains[a.c];
      const f = (a.ph + t * 0.5) % 1;
      tmp.set(ch.x + a.dx * f, ch.y + 0.04 - f * 0.05, ch.z + a.dz * f);
      tmp.lerp(U.uCavC.value, decay * f * 0.6);
      ap.set([tmp.x, tmp.y, tmp.z], i * 3);
      aa[i] = acidOn * Math.sin(f * Math.PI) * 0.8;
    }
    acid.geometry.attributes.position.needsUpdate = true;
    acid.geometry.attributes.aAlpha.needsUpdate = true;

    const pp = pain.geometry.attributes.position.array;
    const pa = pain.geometry.attributes.aAlpha.array;
    for (let i = 0; i < PN; i++) {
      const p = pSeeds[i];
      const f = (p.ph + t * 0.6) % 1;
      const y = lerp(0.45, -1.75, f);
      const x = p.side * lerp(0.17, 0.25, smoothstep(0.3, -1.8, y));
      pp.set([x, y, 0.02], i * 3);
      pa[i] = U.uPain.value * Math.sin(f * Math.PI);
    }
    pain.geometry.attributes.position.needsUpdate = true;
    pain.geometry.attributes.aAlpha.needsUpdate = true;
  }
  const topCache = new Map();
  function toothTopCached(sd) {
    if (!topCache.has(sd)) topCache.set(sd, toothTop(sd.x, sd.z));
    return topCache.get(sd);
  }
  update(0, 0, 0);

  return {
    root,
    update,
    labels,
    env: {
      background: ['#151a24', '#040507', '#2a3550'],
      exposure: 0.9,
      envIntensity: 0.55,
      bloom: { strength: 0.18, threshold: 0.96, radius: 0.45 },
      lights: { hemi: 0.4, sky: '#f4f7ff', ground: '#2a1a1a', key: 2.0, keyPos: [3, 6, 6], shadowSize: 3, rim: 2.0, rimColor: '#9fc4ff', rimPos: [-5, 3, -5], fill: 0, head: 0.6 },
    },
    controls: { minDistance: 1.2, maxDistance: 12 },
    views: {
      overview: { pos: [1.9, 0.9, 5.4], target: [0, -0.35, 0] },
      top: { pos: [1.2, 2.6, 2.2], target: [0, 0.75, -0.2] },
      close: { pos: [0.75, 1.15, 2.2], target: [0, 0.65, 0] },
    },
  };
}
