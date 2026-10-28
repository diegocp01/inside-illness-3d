import * as THREE from 'three';
import { tissue, glowPoints } from '../engine/materials.js';
import { smoothSphere, displace } from '../engine/shapes.js';
import { eosinophilGeometry } from '../engine/cells.js';
import { tubeLayer } from '../engine/tube.js';
import { noise, rng, smoothstep, lerp } from '../engine/noise.js';
import { buildContext } from './context.js';

// Asthma: a cut-open airway. In an attack the muscle squeezes, the lining swells and mucus clogs it.
export default function build() {
  const root = new THREE.Group();
  const r = rng(51);
  const L = 11;

  const U = { uTime: { value: 0 }, uSick: { value: 0 } };
  const radii = `
    float breath() { return 1.0 + 0.025 * sin(uTime * 1.6); }
    float squeeze() { return smoothstep(0.15, 0.85, uSick); }
    float lining(float th, float u) {
      float q = squeeze();
      float folds = 1.0 + 0.17 * q * sin(th * 9.0 + 1.5 * sin(u * 9.0));
      return mix(1.0, 0.5, q) * folds * breath();
    }
    float muscleIn(float th, float u) { return mix(1.24, 0.98, squeeze()) * breath(); }
    float muscleOut(float th, float u) { return muscleIn(th, u) + mix(0.1, 0.17, squeeze()); }
    float advOut(float th, float u) { return muscleOut(th, u) + 0.14; }
  `;
  const geom = { radial: 160, lengthSegs: 150, thetaStart: Math.PI / 2 + 0.9, thetaLength: Math.PI * 2 - 1.8, wallSegs: 5, uvRepeat: [8, 4] };

  const mucosa = tubeLayer({
    geometry: geom,
    material: tissue({ color: '#f0a6a0', sheen: '#ffe0dc', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.15, normal: 'cells', normalScale: 0.4 }),
    uniforms: U,
    length: L,
    cutColor: '#f4c2b8',
    radiusGLSL: radii + 'float rIn(float th, float u) { return lining(th, u); } float rOut(float th, float u) { return muscleIn(th, u); }',
    fragGLSL: 'float squeeze() { return smoothstep(0.15, 0.85, uSick); }',
    colorGLSL: `
      if (isCut) diffuseColor.rgb = mix(vec3(0.98, 0.78, 0.74), vec3(0.95, 0.62, 0.58), smoothstep(0.0, 0.25, vS));
      else diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.38, 0.36), squeeze() * 0.6);`,
  });
  const muscle = tubeLayer({
    geometry: geom,
    material: tissue({ color: '#b8323a', sheen: '#ff8a80', roughness: 0.4, clearcoat: 0.6, normal: 'organic', normalScale: 0.5 }),
    uniforms: U,
    length: L,
    cutColor: '#a82a32',
    radiusGLSL: radii + 'float rIn(float th, float u) { return muscleIn(th, u); } float rOut(float th, float u) { return muscleOut(th, u); }',
    fragGLSL: 'float squeeze() { return smoothstep(0.15, 0.85, uSick); }',
    colorGLSL: `
      if (!isCut) {
        float band = smoothstep(0.3, 0.7, abs(fract(vTU.y * 34.0 + vTU.x * 0.6) - 0.5) * 2.0);
        diffuseColor.rgb = mix(vec3(0.72, 0.16, 0.2), vec3(0.88, 0.32, 0.32), band);
      } else diffuseColor.rgb = mix(vec3(0.66, 0.15, 0.19), vec3(0.8, 0.26, 0.28), step(0.5, fract(vS * 4.0)));`,
    emissiveGLSL: 'totalEmissiveRadiance += vec3(0.5, 0.05, 0.05) * squeeze() * (0.5 + 0.5 * sin(uTime * 5.0)) * 0.35;',
  });
  const adv = tubeLayer({
    geometry: geom,
    material: tissue({ color: '#f1d9c8', sheen: '#ffffff', roughness: 0.5, clearcoat: 0.3, normal: 'organic', normalScale: 0.5 }),
    uniforms: U,
    length: L,
    cutColor: '#f5e2d2',
    radiusGLSL: radii + 'float rIn(float th, float u) { return muscleOut(th, u); } float rOut(float th, float u) { return advOut(th, u); }',
  });
  root.add(mucosa, muscle, adv);

  // Cartilage plates (bluish-white, glassy) wrapped around the outside.
  const plateMat = tissue({ color: '#d9e7f2', sheen: '#ffffff', roughness: 0.25, clearcoat: 1, normal: 'organic', normalScale: 0.2 });
  const plates = [];
  for (let i = 0; i < 6; i++) {
    const x = -4.6 + i * 1.85 + (r() - 0.5) * 0.3;
    const arc = 1.6 + r() * 0.8;
    const start = Math.PI / 2 + 1.0 + r() * (Math.PI * 2 - 2.0 - arc);
    const g = new THREE.CylinderGeometry(1, 1, 0.42 + r() * 0.2, 48, 1, true, start, arc);
    g.rotateZ(Math.PI / 2);
    const m = new THREE.Mesh(g, plateMat);
    m.material.side = THREE.DoubleSide;
    m.position.x = x;
    plates.push(m);
    root.add(m);
  }
  const breathJS = (t) => 1 + 0.025 * Math.sin(t * 1.6);
  const squeezeJS = (s) => smoothstep(0.15, 0.85, s);
  const liningJS = (t, s) => lerp(1, 0.5, squeezeJS(s)) * breathJS(t);

  // ---------- Air ----------
  const AN = 420;
  const air = glowPoints(AN, { color: '#cfefff', size: 0.07 });
  const aSeeds = Array.from({ length: AN }, () => ({ x: (r() - 0.5) * L, rr: Math.sqrt(r()) * 0.8, a: r() * Math.PI * 2, k: r(), sp: 0.7 + r() * 0.6 }));
  root.add(air);

  // ---------- Mucus plugs ----------
  const MN = 22;
  const mucGeo = smoothSphere(4);
  displace(mucGeo, (x, y, z) => noise.noise3(x * 2.5, y * 2.5, z * 2.5) * 0.18);
  const mucus = new THREE.InstancedMesh(mucGeo, new THREE.MeshPhysicalMaterial({ color: '#efe6b8', roughness: 0.15, transmission: 0.6, thickness: 0.6, clearcoat: 1, ior: 1.36, attenuationColor: new THREE.Color('#e6d98a'), attenuationDistance: 0.8 }), MN);
  const mSeeds = Array.from({ length: MN }, () => ({ x: (r() - 0.5) * (L - 1), a: Math.PI / 2 + 1.3 + r() * (Math.PI * 2 - 2.6), thr: 0.45 + r() * 0.4, size: 0.14 + r() * 0.16 }));
  root.add(mucus);

  // ---------- Inflammatory cells in the wall ----------
  const EN = 60;
  const eos = new THREE.InstancedMesh(eosinophilGeometry(), new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, clearcoat: 0.6 }), EN);
  const eSeeds = Array.from({ length: EN }, () => ({ x: (r() - 0.5) * (L - 1), a: Math.PI / 2 + 0.95 + r() * (Math.PI * 2 - 1.9), d: r(), thr: 0.2 + r() * 0.5, rot: r() * 6 }));
  root.add(eos);

  // ---------- Context: where in the body this close-up is ----------
  const CTX_X = -40;
  const ctx = buildContext('airway');
  ctx.group.position.x = CTX_X;
  root.add(ctx.group);

  // ---------- Labels ----------
  const onCut = (x, rad) => [x, 0.78 * rad, 0.62 * rad];
  const labels = [
    { text: 'Lining', at: onCut(-2.4, 1.05), side: 'left' },
    { text: 'Muscle', at: onCut(-0.4, 1.3), when: (s) => s < 0.45 },
    { text: 'Air', at: [1.5, 0, 0], when: (s) => s < 0.4 },
    { text: 'Squeezing', at: onCut(-0.4, 1.12), when: (s) => s >= 0.45 },
    { text: 'Swelling', at: [2.2, -0.42, -0.15], when: (s) => s > 0.55 },
    { text: 'Mucus', at: [-3.0, -0.4, 0.1], when: (s) => s > 0.75 },
  ];
  labels.push(...ctx.labels);

  const dummy = new THREE.Object3D();
  function update(t, dt, s) {
    ctx.update(t, s);
    U.uTime.value = t;
    U.uSick.value = s;
    const q = squeezeJS(s);
    const lin = liningJS(t, s);
    for (const p of plates) p.scale.set(1, (lerp(1.24, 0.98, q) + lerp(0.1, 0.17, q) + 0.15) * breathJS(t), (lerp(1.24, 0.98, q) + lerp(0.1, 0.17, q) + 0.15) * breathJS(t));

    // Air: brisk and plentiful when open, slow and sparse when narrowed.
    const pos = air.geometry.attributes.position.array;
    const al = air.geometry.attributes.aAlpha.array;
    const flow = Math.sin(t * 1.6) >= 0 ? 1 : -1;
    for (let i = 0; i < AN; i++) {
      const a = aSeeds[i];
      a.x += flow * lerp(2.2, 0.5, q) * a.sp * dt;
      if (a.x > L / 2) a.x -= L;
      if (a.x < -L / 2) a.x += L;
      const rr = a.rr * lin * 0.82;
      pos.set([a.x, Math.cos(a.a) * rr, Math.sin(a.a) * rr], i * 3);
      al[i] = (a.k < lerp(1, 0.3, q) ? 0.85 : 0) * smoothstep(L / 2, L / 2 - 0.8, Math.abs(a.x));
    }
    air.geometry.attributes.position.needsUpdate = true;
    air.geometry.attributes.aAlpha.needsUpdate = true;

    for (let i = 0; i < MN; i++) {
      const m = mSeeds[i];
      const g = smoothstep(m.thr, m.thr + 0.25, s);
      const rr = lin * 0.88;
      dummy.position.set(m.x, Math.cos(m.a) * rr, Math.sin(m.a) * rr);
      dummy.scale.setScalar(m.size * g * (1 + 0.05 * Math.sin(t * 2 + i)));
      dummy.rotation.set(i, i * 2, 0);
      dummy.updateMatrix();
      mucus.setMatrixAt(i, dummy.matrix);
    }
    mucus.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < EN; i++) {
      const e = eSeeds[i];
      const g = smoothstep(e.thr, e.thr + 0.2, s);
      const rIn = lin * 1.02;
      const rOut = lerp(1.24, 0.98, q) * breathJS(t);
      const rr = lerp(rIn, rOut, 0.25 + e.d * 0.5);
      dummy.position.set(e.x, Math.cos(e.a) * rr, Math.sin(e.a) * rr);
      dummy.rotation.set(e.rot + t * 0.3, e.rot, 0);
      dummy.scale.setScalar(0.07 * g);
      dummy.updateMatrix();
      eos.setMatrixAt(i, dummy.matrix);
    }
    eos.instanceMatrix.needsUpdate = true;
  }
  update(0, 0, 0);

  return {
    root,
    update,
    labels,
    env: {
      background: ['#1c1622', '#050407', '#3a2a48'],
      exposure: 1.0,
      envIntensity: 0.5,
      fog: { color: '#08060b', density: 0.03 },
      bloom: { strength: 0.4, threshold: 0.96, radius: 0.55 },
      lights: { hemi: 0.45, sky: '#f2eaff', ground: '#2a1520', key: 2.4, keyPos: [3, 8, 7], shadowSize: 7, rim: 1.8, rimColor: '#9fd0ff', rimPos: [-6, 3, -6], fill: 4, fillColor: '#ff9a9a', fillPos: [0, 0, 2.5] },
    },
    controls: { minDistance: 1.5, maxDistance: 18 },
    labelNear: 26,
    views: {
      context: { pos: [CTX_X + ctx.view.pos[0], ctx.view.pos[1], ctx.view.pos[2]], target: [CTX_X + ctx.view.target[0], ctx.view.target[1], ctx.view.target[2]] },
      overview: { pos: [4.6, 3.0, 8.4], target: [0, -0.2, 0] },
      close: { pos: [1.4, 0.5, 3.4], target: [0.4, -0.1, -0.1] },
      end: { pos: [8.4, 1.0, 2.0], target: [4.5, -0.1, 0] },
    },
  };
}
