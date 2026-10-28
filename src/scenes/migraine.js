import * as THREE from 'three';
import { tissue, glowPoints, glowMaterial, membrane } from '../engine/materials.js';
import { variableTube, mergeVerticesSafe, surfaceNets, sdf } from '../engine/shapes.js';
import { noise, rng, smoothstep, lerp } from '../engine/noise.js';

// Migraine: a brain with a spreading wave of activity, the trigeminal nerve and inflamed vessels.
export default function build() {
  const root = new THREE.Group();
  const r = rng(71);
  const brain = new THREE.Group();
  root.add(brain);

  // ---------- Cerebral hemispheres (procedural gyri) ----------
  const sulcusColor = new THREE.Color('#8a4a4c'), gyrusColor = new THREE.Color('#e9b2a6');
  function hemisphere(side) {
    const g = new THREE.SphereGeometry(1, 340, 230);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    const CX = 0.42;
    for (let i = 0; i < p.count; i++) {
      const dx = p.getX(i), dy = p.getY(i), dz = p.getZ(i);
      const back = smoothstep(0.25, 1, -dz), front = smoothstep(0.35, 1, dz);
      const rx = 0.45 * (1 - back * 0.16);
      const ry = (dy > 0 ? 0.6 : 0.4) * (1 - back * 0.14 + front * 0.02);
      const rz = 0.96;
      // Lateral side is round; medial side is boxy so the hemispheres meet along a flat wall.
      const medialSide = dx * side < 0;
      let x = medialSide ? side * CX - side * Math.pow(Math.abs(dx), 0.42) * CX : side * CX + dx * rx;
      let y = dy * ry + 0.04;
      let z = dz * rz;
      // Temporal lobe hangs low at the sides, toward the front.
      const temporal = smoothstep(0.05, 0.7, -dy) * smoothstep(0.0, 0.6, dx * side) * smoothstep(-0.7, 0.0, dz) * smoothstep(0.85, 0.35, dz);
      y -= temporal * 0.15;
      x += side * temporal * 0.04;
      // Flat medial wall: the longitudinal fissure between the hemispheres.
      const medialDepth = side * x;
      const onMedial = medialDepth < 0.014;
      if (onMedial) x = side * 0.014;
      // Lateral (Sylvian) fissure.
      const fy = -0.1 - dz * 0.2;
      const lateral = smoothstep(0.45, 0.8, dx * side) * smoothstep(0.75, 0.15, dz) * smoothstep(-0.6, -0.1, dz);
      const fiss = Math.exp(-(((y - fy) / 0.03) ** 2)) * lateral;
      // Gyri: rounded ridges separated by narrow, meandering sulci.
      const F = 4.4;
      const wx = x * F + noise.noise3(x * 1.8, y * 1.8, z * 1.8) * 0.7;
      const wy = y * F + noise.noise3(y * 1.8 + 5, z * 1.8, x * 1.8) * 0.7;
      const wz = z * F + noise.noise3(z * 1.8 + 9, x * 1.8, y * 1.8) * 0.7;
      const nval = noise.noise3(wx, wy, wz);
      const groove = 1 - smoothstep(0.0, 0.32, Math.abs(nval));
      const fade = onMedial ? 0.25 : 1;
      const depth = (Math.pow(groove, 1.6) * 0.052 + fiss * 0.07) * fade;
      const cx = side * CX * 0.9;
      const len = Math.hypot(x - cx, y, z) || 1;
      const k = (len - depth) / len;
      if (!onMedial) x = cx + (x - cx) * k;
      y *= k;
      z *= k;
      p.setXYZ(i, x, y, z);
      c.copy(gyrusColor).lerp(sulcusColor, Math.min(1, Math.pow(groove, 1.6) * 0.9 + fiss));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return mergeVerticesSafe(g);
  }

  const U = { uTime: { value: 0 }, uWaveC: { value: new THREE.Vector3(0.42, 0.12, -0.86) }, uWaveR: { value: 0 }, uWaveA: { value: 0 } };
  const brainMat = tissue({ color: '#ffffff', sheen: '#ffe0d8', roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.3, normal: null, vertexColors: true });
  brainMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;\nuniform vec3 uWaveC; uniform float uWaveR; uniform float uWaveA; uniform float uTime;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float wd = distance(vObj, uWaveC);
        float band = exp(-pow((wd - uWaveR) / 0.035, 2.0));
        float behind = smoothstep(uWaveR, uWaveR - 0.4, wd) * step(0.01, uWaveR);
        totalEmissiveRadiance += vec3(0.45, 0.5, 1.0) * band * uWaveA * 0.6;
        diffuseColor.rgb *= 1.0 - behind * uWaveA * 0.25;`
      );
  };
  brainMat.customProgramCacheKey = () => 'brain-wave';
  const left = new THREE.Mesh(hemisphere(-1), brainMat);
  const right = new THREE.Mesh(hemisphere(1), brainMat);
  for (const m of [left, right]) { m.castShadow = true; m.receiveShadow = true; brain.add(m); }

  // ---------- Cerebellum & brainstem ----------
  const cb = new THREE.SphereGeometry(1, 160, 100);
  {
    const p = cb.attributes.position;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i) * 0.52, y = p.getY(i) * 0.3, z = p.getZ(i) * 0.36;
      x *= 1 - 0.15 * Math.exp(-((x / 0.08) ** 2)) * (y > 0 ? 0 : 1);
      const fol = Math.abs(Math.sin((y * 1.0 - z * 0.5) * 60));
      const d = (1 - smoothstep(0, 0.35, fol)) * 0.012;
      const l = Math.hypot(x, y, z);
      p.setXYZ(i, x * (1 - d / l), y * (1 - d / l), z * (1 - d / l));
      c.copy(gyrusColor).lerp(sulcusColor, (1 - smoothstep(0, 0.35, fol)) * 0.7);
      col.set([c.r, c.g, c.b], i * 3);
    }
    cb.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const cerebellum = new THREE.Mesh(mergeVerticesSafe(cb), brainMat);
  cerebellum.position.set(0, -0.34, -0.56);
  cerebellum.rotation.x = 0.35;
  brain.add(cerebellum);
  const stemCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.1, -0.15), new THREE.Vector3(0, -0.45, -0.22), new THREE.Vector3(0, -0.8, -0.32), new THREE.Vector3(0, -1.05, -0.4)]);
  const stem = new THREE.Mesh(variableTube(stemCurve, (t) => lerp(0.17, 0.1, t) + Math.exp(-(((t - 0.35) / 0.12) ** 2)) * 0.07, 60, 32), tissue({ color: '#e4b0a2', sheen: '#ffe0d8', roughness: 0.45, clearcoat: 0.5, normal: 'organic', normalScale: 0.3 }));
  brain.add(stem);

  // ---------- Blood vessels on the surface ----------
  const project = (p) => {
    const side = Math.sign(p.x) || 1;
    const c = new THREE.Vector3(side * 0.4, 0.04, 0);
    const d = p.clone().sub(c);
    const back = smoothstep(0.25, 1, -d.z / 0.96);
    const ry = (d.y > 0 ? 0.6 : 0.4) * (1 - back * 0.14);
    const k = 1 / Math.hypot(d.x / (0.45 * (1 - back * 0.16)), d.y / ry, d.z / 0.96);
    p.copy(c.add(d.multiplyScalar(k * 1.012)));
  };
  const vesselMat = tissue({ color: '#b1202a', sheen: '#ff8a8a', roughness: 0.25, clearcoat: 1, normal: null, emissive: '#ff2a1a', emissiveIntensity: 0 });
  const VU = { uDilate: { value: 0 } };
  vesselMat.onBeforeCompile = (sh) => {
    sh.uniforms.uDilate = VU.uDilate;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uDilate;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * uDilate;');
  };
  vesselMat.customProgramCacheKey = () => 'vessel-dilate';
  const vesselCurves = [];
  function grow(start, dir, steps, side, depth) {
    const pts = [start.clone()];
    const p = start.clone();
    const d = dir.clone();
    for (let i = 0; i < steps; i++) {
      d.x += (r() - 0.5) * 0.5; d.z += (r() - 0.5) * 0.5; d.y += (r() - 0.5) * 0.2; d.normalize();
      p.addScaledVector(d, 0.06);
      project(p);
      pts.push(p.clone());
      if (depth < 2 && i > 2 && i % 4 === 0 && r() < 0.8) {
        const bd = d.clone().applyAxisAngle(new THREE.Vector3(side, 0, 0).normalize(), (r() < 0.5 ? 1 : -1) * (0.7 + r() * 0.5));
        grow(p.clone(), bd, Math.max(4, steps - i - 2), side, depth + 1);
      }
    }
    vesselCurves.push({ side, curve: new THREE.CatmullRomCurve3(pts), w: depth === 0 ? 0.013 : depth === 1 ? 0.009 : 0.006 });
  }
  for (const side of [1, -1]) {
    for (let k = 0; k < 3; k++) {
      const start = new THREE.Vector3(side * 0.82, -0.14 - k * 0.02, 0.15 - k * 0.3);
      project(start);
      grow(start, new THREE.Vector3(side * -0.2, 1, (k - 1) * 0.35), 15, side, 0);
    }
  }
  for (const v of vesselCurves) {
    const m = new THREE.Mesh(new THREE.TubeGeometry(v.curve, 60, v.w, 8, false), vesselMat);
    brain.add(m);
  }

  // ---------- See-through head for context ----------
  const headSDF = (x, y, z) => {
    let d = sdf.ellipsoid(x, y, z, 0, 0.1, -0.04, 0.9, 0.86, 1.14);
    d = sdf.smin(d, sdf.ellipsoid(x, y, z, 0, -0.48, 0.42, 0.66, 0.7, 0.62), 0.3);
    d = sdf.smin(d, sdf.ellipsoid(x, y, z, 0, -0.95, 0.62, 0.42, 0.32, 0.38), 0.25);
    d = sdf.smin(d, sdf.ellipsoid(x, y, z, 0, -0.32, 1.06, 0.12, 0.2, 0.16), 0.12);
    d = sdf.smin(d, sdf.roundCone(x, y, z, 0, -0.7, -0.35, 0, -1.6, -0.45, 0.42, 0.44), 0.3);
    d = sdf.smin(d, sdf.ellipsoid(x, y, z, 0.86, -0.18, -0.12, 0.08, 0.22, 0.13), 0.06);
    d = sdf.smin(d, sdf.ellipsoid(x, y, z, -0.86, -0.18, -0.12, 0.08, 0.22, 0.13), 0.06);
    return Math.max(d, -1.55 - y);
  };
  const headGeo = surfaceNets(headSDF, [-1.1, -1.7, -1.35], [1.1, 1.05, 1.35], 84);
  const head = new THREE.Mesh(headGeo, membrane({ color: '#a9c9ff', minAlpha: 0.0, maxAlpha: 0.28, roughness: 0.25 }));
  head.renderOrder = 5;
  root.add(head);

  // ---------- Trigeminal nerve (both sides; the right one fires) ----------
  const nerveMat = tissue({ color: '#f4d58a', sheen: '#fff2c0', roughness: 0.35, clearcoat: 0.6, normal: null, emissive: '#ffb000', emissiveIntensity: 0 });
  const nerveCurves = [];
  for (const side of [1, -1]) {
    const gang = new THREE.Vector3(side * 0.3, -0.42, 0.18);
    const root0 = [new THREE.Vector3(side * 0.12, -0.45, -0.2), new THREE.Vector3(side * 0.22, -0.46, -0.02), gang];
    const branches = [
      [gang, new THREE.Vector3(side * 0.3, -0.3, 0.55), new THREE.Vector3(side * 0.3, -0.08, 0.86), new THREE.Vector3(side * 0.24, 0.12, 1.0)],
      [gang, new THREE.Vector3(side * 0.36, -0.46, 0.6), new THREE.Vector3(side * 0.36, -0.42, 0.9), new THREE.Vector3(side * 0.34, -0.4, 1.04)],
      [gang, new THREE.Vector3(side * 0.38, -0.6, 0.45), new THREE.Vector3(side * 0.4, -0.84, 0.72), new THREE.Vector3(side * 0.34, -1.0, 0.86)],
    ];
    const rootCurve = new THREE.CatmullRomCurve3(root0);
    brain.add(new THREE.Mesh(new THREE.TubeGeometry(rootCurve, 30, 0.028, 10, false), nerveMat));
    const g = new THREE.Mesh(new THREE.SphereGeometry(0.065, 20, 14), nerveMat);
    g.position.copy(gang);
    g.scale.set(1.3, 0.8, 1);
    brain.add(g);
    for (const b of branches) {
      const c = new THREE.CatmullRomCurve3(b);
      brain.add(new THREE.Mesh(new THREE.TubeGeometry(c, 40, 0.014, 8, false), nerveMat));
      if (side === 1) nerveCurves.push(c);
    }
    if (side === 1) nerveCurves.push(rootCurve);
  }

  // ---------- Neural sparkle ----------
  const SP = 700;
  const sparkle = glowPoints(SP, { color: '#9cc8ff', size: 0.05 });
  const spSeeds = [];
  {
    const src = [left, right].map((m) => m.geometry.attributes.position);
    for (let i = 0; i < SP; i++) {
      const a = src[i % 2];
      const k = Math.floor(r() * a.count);
      const v = new THREE.Vector3(a.getX(k), a.getY(k), a.getZ(k));
      v.multiplyScalar(1.004);
      spSeeds.push({ v, ph: r() * 20, rate: 0.6 + r() * 1.8 });
      sparkle.geometry.attributes.position.setXYZ(i, v.x, v.y, v.z);
    }
  }
  brain.add(sparkle);

  // ---------- Pain signals along the nerve, CGRP around vessels ----------
  const PN = 90;
  const pain = glowPoints(PN, { color: '#ff5a3a', size: 0.09 });
  const pSeeds = Array.from({ length: PN }, () => ({ c: Math.floor(r() * nerveCurves.length), ph: r() }));
  brain.add(pain);
  const CN = 160;
  const cgrp = glowPoints(CN, { color: '#d77bff', size: 0.06 });
  const rightVessels = vesselCurves.filter((v) => v.side === 1);
  const cSeeds = Array.from({ length: CN }, () => ({ v: Math.floor(r() * rightVessels.length), u: r(), off: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.08), ph: r() }));
  brain.add(cgrp);
  const painGlow = new THREE.Sprite(glowMaterial('#ff3b2a', 0));
  painGlow.position.set(0.62, 0.1, 0.55);
  painGlow.scale.setScalar(1.2);
  brain.add(painGlow);

  // ---------- Labels ----------
  const labels = [
    { text: 'Nerve', at: [0.36, -0.46, 0.55] },
    { text: 'Vessels', at: [0.66, 0.2, -0.05], when: (s) => s < 0.7 },
    { text: 'Aura wave', at: [0.55, 0.25, -0.7], when: (s) => s > 0.25 && s < 0.85 },
    { text: 'Swollen vessels', at: [0.66, 0.2, -0.05], when: (s) => s >= 0.7 },
    { text: 'Pain', at: [0.35, -0.2, 0.86], when: (s) => s > 0.6 },
  ];

  const tmp = new THREE.Vector3();
  function update(t, dt, s) {
    U.uTime.value = t;
    // Aura wave: repeating sweep from the back of the brain.
    const waveA = smoothstep(0.2, 0.45, s) * (1 - smoothstep(0.85, 1.0, s) * 0.55);
    U.uWaveA.value = waveA;
    U.uWaveR.value = waveA > 0.001 ? ((t * 0.16) % 1.9) : 0;

    const nerve = smoothstep(0.5, 0.8, s);
    const pain01 = smoothstep(0.75, 1, s);
    const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 1.1)), 6);
    nerveMat.emissiveIntensity = nerve * (0.5 + 0.4 * beat);
    VU.uDilate.value = pain01 * (0.006 + 0.004 * beat);
    vesselMat.emissiveIntensity = pain01 * (0.25 + 0.5 * beat);
    painGlow.material.opacity = pain01 * (0.25 + 0.35 * beat);

    const sp = sparkle.geometry.attributes.aAlpha.array;
    const waveC = U.uWaveC.value;
    for (let i = 0; i < SP; i++) {
      const p = spSeeds[i];
      const tw = Math.pow(Math.max(0, Math.sin(t * p.rate + p.ph)), 10);
      const d = p.v.distanceTo(waveC);
      const near = waveA * Math.exp(-(((d - U.uWaveR.value) / 0.08) ** 2));
      sp[i] = tw * 0.8 * (1 - waveA * 0.3) + near * 1.2;
    }
    sparkle.geometry.attributes.aAlpha.needsUpdate = true;

    const pp = pain.geometry.attributes.position.array;
    const pa = pain.geometry.attributes.aAlpha.array;
    for (let i = 0; i < PN; i++) {
      const ps = pSeeds[i];
      const f = 1 - ((ps.ph + t * 0.45) % 1);
      nerveCurves[ps.c].getPointAt(f, tmp);
      pp.set([tmp.x, tmp.y, tmp.z], i * 3);
      pa[i] = nerve * (0.5 + 0.5 * beat) * Math.sin(f * Math.PI);
    }
    pain.geometry.attributes.position.needsUpdate = true;
    pain.geometry.attributes.aAlpha.needsUpdate = true;

    const cp = cgrp.geometry.attributes.position.array;
    const ca = cgrp.geometry.attributes.aAlpha.array;
    for (let i = 0; i < CN; i++) {
      const c = cSeeds[i];
      const f = (c.ph + t * 0.2) % 1;
      rightVessels[c.v].curve.getPointAt(c.u, tmp);
      tmp.addScaledVector(c.off, 1 + f * 2);
      cp.set([tmp.x, tmp.y, tmp.z], i * 3);
      ca[i] = nerve * Math.sin(f * Math.PI) * 0.8;
    }
    cgrp.geometry.attributes.position.needsUpdate = true;
    cgrp.geometry.attributes.aAlpha.needsUpdate = true;
  }
  update(0, 0, 0);

  return {
    root,
    update,
    labels,
    env: {
      background: ['#161627', '#040409', '#2c2a55'],
      exposure: 1.0,
      envIntensity: 0.7,
      bloom: { strength: 0.4, threshold: 0.96, radius: 0.6 },
      lights: { hemi: 0.45, sky: '#eef0ff', ground: '#2a1a24', key: 2.6, keyPos: [3, 6, 5], shadowSize: 2.5, rim: 2.2, rimColor: '#8fb8ff', rimPos: [-5, 3, -5], fill: 0, head: 0.6 },
    },
    controls: { minDistance: 1.2, maxDistance: 10 },
    views: {
      overview: { pos: [3.3, 1.4, 3.3], target: [0, -0.2, 0] },
      back: { pos: [2.2, 1.6, -3.2], target: [0.1, -0.05, -0.3] },
      nerve: { pos: [2.6, -0.4, 2.4], target: [0.25, -0.4, 0.45] },
      wide: { pos: [4.6, 2.0, 4.6], target: [0, -0.3, 0] },
    },
  };
}
