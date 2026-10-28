import * as THREE from 'three';
import { tissue, membrane } from '../engine/materials.js';
import { surfaceNets, sdf, variableTube, smoothSphere, displace } from '../engine/shapes.js';
import { noise, rng, smoothstep, lerp } from '../engine/noise.js';

// "Where is this?" views: a see-through body with the relevant organs and a glowing
// square marking the spot the close-up simulation zooms into. Each close-up scene
// places one of these far from its own content and flies the camera between them.

const { ellipsoid, roundCone, smin } = sdf;

function bodySDF(x, y, z) {
  let d = ellipsoid(x, y, z, 0, 2.62, 0.02, 0.36, 0.46, 0.42);
  d = smin(d, roundCone(x, y, z, 0, 2.25, -0.02, 0, 1.85, 0, 0.16, 0.2), 0.12);
  d = smin(d, ellipsoid(x, y, z, 0, 1.2, 0, 0.78, 0.72, 0.42), 0.35);
  d = smin(d, ellipsoid(x, y, z, 0, 0.2, 0.02, 0.64, 0.78, 0.4), 0.35);
  d = smin(d, ellipsoid(x, y, z, 0, -0.5, 0, 0.7, 0.42, 0.38), 0.3);
  d = smin(d, roundCone(x, y, z, -0.8, 1.72, 0, 0.8, 1.72, 0, 0.2, 0.2), 0.3);
  for (const sx of [-1, 1]) {
    d = smin(d, roundCone(x, y, z, sx * 0.9, 1.68, 0, sx * 1.04, 0.62, 0.02, 0.17, 0.13), 0.12);
    d = smin(d, roundCone(x, y, z, sx * 0.32, -0.6, 0, sx * 0.34, -1.75, 0.02, 0.27, 0.2), 0.2);
  }
  return Math.max(d, -1.72 - y);
}

let bodyGeo = null;
function bodyGeometry() {
  if (!bodyGeo) bodyGeo = surfaceNets(bodySDF, [-1.3, -1.76, -0.62], [1.3, 3.15, 0.62], 112);
  return bodyGeo;
}

let markerTex = null;
function markerTexture() {
  if (markerTex) return markerTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = '#ffffff';
  g.shadowColor = '#ffffff';
  g.shadowBlur = 14;
  g.lineWidth = 7;
  g.beginPath();
  g.roundRect(26, 26, 76, 76, 12);
  g.stroke();
  g.stroke();
  markerTex = new THREE.CanvasTexture(c);
  markerTex.colorSpace = THREE.SRGBColorSpace;
  return markerTex;
}

const tube = (pts, r0, r1, mat, seg = 60) => {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const m = new THREE.Mesh(variableTube(curve, (t) => lerp(r0, r1, t), seg, 10), mat);
  m.userData.curve = curve;
  return m;
};

const ARTERIES = [
  { p: [[0.1, 1.18, 0.12], [0.06, 1.45, 0.05], [-0.02, 1.52, -0.02], [-0.03, 1.3, -0.1], [0, 0.6, -0.1], [0, -0.42, -0.08]], r: [0.05, 0.04] },
  { p: [[0, -0.42, -0.08], [0.18, -0.62, 0], [0.3, -1.0, 0.03], [0.33, -1.7, 0.03]], r: [0.035, 0.024] },
  { p: [[0, -0.42, -0.08], [-0.18, -0.62, 0], [-0.3, -1.0, 0.03], [-0.33, -1.7, 0.03]], r: [0.035, 0.024] },
  { p: [[0.03, 1.5, 0], [0.35, 1.63, 0], [0.8, 1.67, 0], [0.93, 1.3, 0.03], [1.02, 0.68, 0.03]], r: [0.032, 0.02] },
  { p: [[-0.02, 1.5, 0], [-0.35, 1.63, 0], [-0.8, 1.67, 0], [-0.93, 1.3, 0.03], [-1.02, 0.68, 0.03]], r: [0.032, 0.02] },
  { p: [[0.04, 1.5, 0.01], [0.08, 1.9, 0.03], [0.1, 2.42, 0.06]], r: [0.026, 0.018] },
  { p: [[-0.02, 1.5, 0.01], [-0.08, 1.9, 0.03], [-0.1, 2.42, 0.06]], r: [0.026, 0.018] },
];

/**
 * kind: 'gut' | 'blood' | 'artery' | 'diabetes' | 'airway' | 'fat'
 * Returns { group, update(t, s), labels, view }.
 */
export function buildContext(kind) {
  const r = rng(201);
  const group = new THREE.Group();
  const U = { uBelly: { value: 0 } };
  const torsoMat = membrane({ color: '#a9c9ff', minAlpha: 0.02, maxAlpha: 0.32, roughness: 0.25 });
  const baseCompile = torsoMat.onBeforeCompile;
  torsoMat.onBeforeCompile = (sh) => {
    baseCompile(sh);
    sh.uniforms.uBelly = U.uBelly;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uBelly;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float bw = exp(-pow((position.y - 0.15) / 0.5, 2.0)) * step(abs(position.x), 0.75);
        transformed.x *= 1.0 + uBelly * 0.32 * bw;
        transformed.z *= 1.0 + uBelly * bw * (position.z > 0.0 ? 0.9 : 0.25);`
      );
  };
  torsoMat.customProgramCacheKey = () => 'context-torso';
  const torso = new THREE.Mesh(bodyGeometry(), torsoMat);
  torso.renderOrder = 5;
  group.add(torso);

  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(), color: '#7fe7ff', transparent: true, depthTest: false, depthWrite: false }));
  marker.renderOrder = 20;
  marker.scale.setScalar(0.32);
  group.add(marker);
  const markerAnchor = new THREE.Object3D();
  group.add(markerAnchor);
  const near = 9;
  const labels = [{ text: 'Zoomed-in area', parent: markerAnchor, near }];
  const anchor = (pos) => {
    const o = new THREE.Object3D();
    o.position.fromArray(pos);
    group.add(o);
    return o;
  };
  const setMarker = (pos) => {
    marker.position.fromArray(pos);
    markerAnchor.position.set(pos[0], pos[1] + 0.12, pos[2]);
  };

  const updaters = [(t) => {
    marker.material.opacity = 0.75 + 0.25 * Math.sin(t * 3);
  }];
  let view;

  // ---------- Shared organ builders ----------
  function heart() {
    const g = smoothSphere(4);
    displace(g, (x, y, z) => noise.noise3(x * 2, y * 2, z * 2) * 0.08);
    const m = new THREE.Mesh(g, tissue({ color: '#b3242c', sheen: '#ff9a9a', roughness: 0.3, clearcoat: 0.9, normal: null, emissive: '#ff2020', emissiveIntensity: 0 }));
    m.position.set(0.1, 1.12, 0.12);
    m.scale.set(0.17, 0.21, 0.15);
    m.rotation.z = -0.4;
    group.add(m);
    return m;
  }
  function arteries(color = '#c8202c') {
    const mat = tissue({ color, sheen: '#ff9a9a', roughness: 0.3, clearcoat: 0.9, normal: null, emissive: '#ff2020', emissiveIntensity: 0 });
    const meshes = ARTERIES.map((a) => {
      const m = tube(a.p, a.r[0], a.r[1], mat, 80);
      group.add(m);
      return m;
    });
    return { mat, meshes };
  }
  function digestive() {
    const stomachCurve = [[0.22, 0.48, 0.03], [0.42, 0.42, 0.05], [0.52, 0.22, 0.08], [0.44, 0.0, 0.1], [0.22, -0.07, 0.12], [0.02, 0.02, 0.12], [-0.1, 0.0, 0.1]];
    const sc = new THREE.CatmullRomCurve3(stomachCurve.map((p) => new THREE.Vector3(...p)));
    group.add(new THREE.Mesh(variableTube(sc, (t) => lerp(0.08, 0.22, smoothstep(0, 0.3, t)) * (1 - smoothstep(0.55, 1, t) * 0.75), 100, 24), tissue({ color: '#e88b84', sheen: '#ffc8c0', roughness: 0.3, clearcoat: 0.9, normal: null })));
    const coil = [];
    const p = new THREE.Vector3(-0.1, -0.02, 0.1);
    const v = new THREE.Vector3(-1, -0.2, 0.3).normalize();
    const C = new THREE.Vector3(0, -0.3, 0.06), E = new THREE.Vector3(0.36, 0.28, 0.14);
    for (let i = 0; i < 140; i++) {
      coil.push(p.clone());
      v.x += (r() - 0.5) * 0.9; v.y += (r() - 0.5) * 0.9; v.z += (r() - 0.5) * 0.9;
      const q = p.clone().sub(C);
      const out = (q.x / E.x) ** 2 + (q.y / E.y) ** 2 + (q.z / E.z) ** 2;
      if (out > 0.7) v.addScaledVector(q, -1.6 * (out - 0.6));
      v.normalize();
      p.addScaledVector(v, 0.035);
    }
    const intMat = tissue({ color: '#f0a08e', sheen: '#ffd2c4', roughness: 0.32, clearcoat: 0.8, normal: null, emissive: '#ff3010', emissiveIntensity: 0 });
    const coilCurve = new THREE.CatmullRomCurve3(coil);
    group.add(new THREE.Mesh(variableTube(coilCurve, () => 0.04, 900, 12), intMat));
    const colon = new THREE.CatmullRomCurve3([[-0.42, -0.62, 0.05], [-0.48, -0.2, 0.06], [-0.46, 0.18, 0.08], [0.0, 0.22, 0.16], [0.46, 0.2, 0.08], [0.5, -0.2, 0.05], [0.4, -0.62, 0.02], [0.1, -0.72, 0.0]].map((q) => new THREE.Vector3(...q)));
    group.add(new THREE.Mesh(variableTube(colon, (t) => 0.07 * (1 + 0.18 * Math.sin(t * 90)), 300, 16), tissue({ color: '#d99a7e', sheen: '#ffd8c0', roughness: 0.35, clearcoat: 0.7, normal: null })));
    // The coil point closest to the viewer makes a good marker spot.
    let best = coil[0];
    for (const c of coil) if (c.z + c.x * 0.3 > best.z + best.x * 0.3) best = c;
    return { intMat, front: best };
  }

  // ---------- Per-illness context ----------
  if (kind === 'gut') {
    const { intMat, front } = digestive();
    setMarker([front.x, front.y, front.z + 0.06]);
    labels.push({ text: 'Small intestine', parent: anchor([-0.3, -0.42, 0.2]), side: 'left', near });
    labels.push({ text: 'Stomach', parent: anchor([0.5, 0.3, 0.12]), near });
    updaters.push((t, s) => {
      intMat.emissiveIntensity = smoothstep(0.3, 1, s) * (0.25 + 0.15 * Math.sin(t * 4));
      intMat.color.set('#f0a08e').lerp(new THREE.Color('#d8564e'), smoothstep(0.3, 1, s) * 0.6);
    });
    view = { pos: [2.4, 0.75, 4.3], target: [0, 0.0, 0] };
  }

  if (kind === 'blood' || kind === 'artery' || kind === 'diabetes') {
    const h = heart();
    const art = arteries();
    labels.push({ text: 'Heart', parent: anchor([0.18, 1.22, 0.22]), near });
    if (kind === 'blood') {
      setMarker([1.0, 0.86, 0.06]);
      labels.push({ text: 'Blood vessels', parent: anchor([-0.32, -1.1, 0.06]), side: 'left', near });
      updaters.push((t, s) => {
        art.mat.color.set('#c8202c').lerp(new THREE.Color('#eba3a6'), s * 0.85);
        h.material.color.set('#b3242c').lerp(new THREE.Color('#e08c90'), s * 0.6);
        h.scale.set(0.17, 0.21, 0.15).multiplyScalar(1 + 0.04 * Math.max(0, Math.sin(t * (7 + s * 4))));
      });
      view = { pos: [2.6, 1.3, 5.8], target: [0.15, 0.55, 0] };
    }
    if (kind === 'artery') {
      setMarker([0.94, 1.28, 0.06]);
      labels.push({ text: 'Arteries', parent: anchor([-0.33, -1.1, 0.06]), side: 'left', near });
      updaters.push((t, s) => {
        const rate = 7.2;
        const beat = Math.pow(Math.max(0, Math.sin(t * rate)), 6);
        h.scale.set(0.17, 0.21, 0.15).multiplyScalar(1 + (0.04 + 0.06 * s) * beat);
        art.mat.emissiveIntensity = s * (0.15 + 0.5 * beat);
        h.material.emissiveIntensity = s * 0.4 * beat;
      });
      view = { pos: [2.2, 1.7, 4.4], target: [0.45, 1.15, 0] };
    }
    if (kind === 'diabetes') {
      const panMat = tissue({ color: '#e7b27a', sheen: '#fff0d0', roughness: 0.4, clearcoat: 0.6, normal: 'organic', normalScale: 0.6, emissive: '#ff9a20', emissiveIntensity: 0.15 });
      const pan = new THREE.Mesh(smoothSphere(4), panMat);
      displace(pan.geometry, (x, y, z) => noise.noise3(x * 4, y * 4, z * 4) * 0.12);
      pan.position.set(0.02, 0.5, 0.06);
      pan.scale.set(0.27, 0.06, 0.07);
      pan.rotation.z = 0.18;
      group.add(pan);
      const muscleMat = tissue({ color: '#b84a44', sheen: '#ff9a8a', roughness: 0.4, clearcoat: 0.5, normal: 'organic', normalScale: 0.6, repeat: [1, 4] });
      const muscle = new THREE.Mesh(smoothSphere(4), muscleMat);
      muscle.position.set(0.95, 1.2, 0.0);
      muscle.scale.set(0.1, 0.3, 0.09);
      muscle.rotation.z = 0.13;
      group.add(muscle);
      setMarker([0.97, 1.16, 0.12]);
      labels.push({ text: 'Pancreas', parent: anchor([-0.2, 0.52, 0.1]), side: 'left', near });
      labels.push({ text: 'Arm muscle', parent: anchor([0.9, 0.98, 0.08]), side: 'left', near });
      updaters.push((t, s) => {
        art.mat.color.set('#c8202c').lerp(new THREE.Color('#e0a020'), s * 0.75);
        art.mat.emissive.set('#ffb020');
        art.mat.emissiveIntensity = s * 0.25;
        panMat.emissiveIntensity = 0.15 + s * (0.3 + 0.25 * Math.sin(t * 5));
        h.scale.set(0.17, 0.21, 0.15).multiplyScalar(1 + 0.04 * Math.max(0, Math.sin(t * 7)));
      });
      view = { pos: [2.5, 1.5, 4.6], target: [0.45, 0.9, 0] };
    }
  }

  if (kind === 'airway') {
    const lungMat = membrane({ color: '#ff9ea6', minAlpha: 0.12, maxAlpha: 0.6, roughness: 0.3 });
    for (const sx of [-1, 1]) {
      const g = smoothSphere(4);
      displace(g, (x, y, z) => (x * sx < -0.2 ? -0.15 * (-x * sx - 0.2) : 0) + noise.noise3(x * 2, y * 2, z * 2) * 0.04);
      const m = new THREE.Mesh(g, lungMat);
      m.position.set(sx * 0.33, 1.22, 0.0);
      m.scale.set(0.28, 0.48, 0.28);
      m.renderOrder = 4;
      group.add(m);
    }
    const bU = { uShrink: { value: 0 } };
    const brMat = tissue({ color: '#f3c8c4', sheen: '#ffffff', roughness: 0.35, clearcoat: 0.6, normal: null, emissive: '#ff2a1a', emissiveIntensity: 0 });
    brMat.onBeforeCompile = (sh) => {
      sh.uniforms.uShrink = bU.uShrink;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uShrink;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed -= normal * uShrink;');
    };
    brMat.customProgramCacheKey = () => 'bronchi-shrink';
    group.add(tube([[0, 2.02, 0.05], [0, 1.75, 0.04], [0, 1.5, 0.02]], 0.045, 0.042, brMat, 30));
    let markerSpot = null;
    const branch = (start, dir, len, rad, depth, side) => {
      const end = start.clone().addScaledVector(dir, len);
      group.add(tube([start.toArray(), start.clone().lerp(end, 0.5).toArray(), end.toArray()], rad, rad * 0.8, brMat, 12));
      if (depth === 2 && side > 0 && !markerSpot) markerSpot = start.clone().lerp(end, 0.5);
      if (depth >= 4) return;
      for (const a of [-0.55, 0.5]) {
        const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), a + (r() - 0.5) * 0.3);
        d.z += (r() - 0.5) * 0.5;
        d.normalize();
        branch(end, d, len * 0.72, rad * 0.72, depth + 1, side);
      }
    };
    const carina = new THREE.Vector3(0, 1.5, 0.02);
    branch(carina, new THREE.Vector3(0.62, -0.78, 0).normalize(), 0.24, 0.032, 1, 1);
    branch(carina, new THREE.Vector3(-0.62, -0.78, 0).normalize(), 0.24, 0.032, 1, -1);
    setMarker([markerSpot.x, markerSpot.y, markerSpot.z + 0.1]);
    labels.push({ text: 'Lungs', parent: anchor([-0.5, 1.5, 0.15]), side: 'left', near });
    labels.push({ text: 'Airways', parent: anchor([0.02, 1.85, 0.08]), near });
    updaters.push((t, s) => {
      const q = smoothstep(0.15, 0.85, s);
      bU.uShrink.value = q * 0.009;
      brMat.color.set('#f3c8c4').lerp(new THREE.Color('#d4504a'), q * 0.8);
      brMat.emissiveIntensity = q * (0.2 + 0.1 * Math.sin(t * 5));
      lungMat.color.set('#ff9ea6').lerp(new THREE.Color('#b0707a'), q * 0.5);
    });
    view = { pos: [1.9, 1.75, 3.4], target: [0.05, 1.25, 0] };
  }

  if (kind === 'fat') {
    digestive();
    // A fat layer just under the belly skin, plus fat around the organs.
    const fatMat = membrane({ color: '#ffd35a', minAlpha: 0.04, maxAlpha: 0.5, roughness: 0.3 });
    const shell = new THREE.Mesh(smoothSphere(4), fatMat);
    shell.position.set(0, 0.14, 0.02);
    shell.renderOrder = 4;
    group.add(shell);
    const blobMat = tissue({ color: '#f5c64e', sheen: '#fff2b0', roughness: 0.25, clearcoat: 0.9, normal: null });
    const blobs = Array.from({ length: 16 }, () => {
      const m = new THREE.Mesh(smoothSphere(3), blobMat);
      const a = r() * Math.PI * 2;
      m.position.set(Math.cos(a) * (0.25 + r() * 0.2), -0.05 + (r() - 0.5) * 0.6, 0.05 + Math.sin(a) * 0.15);
      m.userData.size = 0.035 + r() * 0.035;
      group.add(m);
      return m;
    });
    setMarker([0.3, 0.05, 0.45]);
    labels.push({ text: 'Belly fat', parent: anchor([-0.45, 0.32, 0.36]), side: 'left', near });
    updaters.push((t, s) => {
      const g = smoothstep(0.05, 0.85, s);
      U.uBelly.value = g;
      shell.scale.set(0.6 * (1 + g * 0.3), 0.6 * (1 + g * 0.1), 0.37 * (1 + g * 0.75));
      if (fatMat.userData.shader) fatMat.userData.shader.uniforms.uMinA.value = 0.04 + g * 0.22;
      for (const b of blobs) b.scale.setScalar(b.userData.size * (1 + g * 1.8));
      marker.position.z = 0.45 + g * 0.3;
      markerAnchor.position.z = marker.position.z;
    });
    view = { pos: [2.2, 0.75, 3.8], target: [0, 0.2, 0] };
  }

  function update(t, s) {
    for (const u of updaters) u(t, s);
  }
  update(0, 0);
  return { group, update, labels, view };
}
