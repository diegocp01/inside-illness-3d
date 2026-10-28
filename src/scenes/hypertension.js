import * as THREE from 'three';
import { tissue } from '../engine/materials.js';
import { redCellGeometry, mergeGeometries } from '../engine/shapes.js';
import { tubeLayer } from '../engine/tube.js';
import { rng, smoothstep, lerp } from '../engine/noise.js';
import { buildContext } from './context.js';

// High blood pressure: a cut-open artery whose wall thickens and stiffens as pressure rises.
export default function build() {
  const root = new THREE.Group();
  const r = rng(41);
  const L = 12;
  const RATE = 1.15; // heartbeats per second

  const U = { uTime: { value: 0 }, uSick: { value: 0 }, uRate: { value: RATE } };
  const pulseGLSL = `
    float pulseAt(float u) {
      float ph = fract(uTime * uRate - u * 0.9);
      return smoothstep(0.0, 0.06, ph) * exp(-ph * 6.0);
    }
    float kPulse(float u) { return 1.0 + mix(0.075, 0.025, uSick) * pulseAt(u); }
    float lumen(float th, float u) { return (mix(1.0, 0.7, uSick) + 0.008 * sin(th * 11.0 + u * 40.0)) * kPulse(u); }
    float intimaOut(float th, float u) { return lumen(th, u) + mix(0.045, 0.07, uSick) * kPulse(u); }
    float mediaOut(float th, float u) { return (mix(1.33, 1.38, uSick)) * kPulse(u); }
    float advOut(float th, float u) { return (mix(1.5, 1.55, uSick)) * kPulse(u); }
  `;
  const noiseGLSL = `
    float hsh(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
    float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
  `;
  const geom = { radial: 150, lengthSegs: 160, thetaStart: Math.PI / 2 + 0.95, thetaLength: Math.PI * 2 - 1.9, wallSegs: 4, uvRepeat: [8, 3] };

  const intima = tubeLayer({
    geometry: geom,
    material: tissue({ color: '#e3a49b', sheen: '#ffd6cf', roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.12, normal: 'cells', normalScale: 0.3 }),
    uniforms: U,
    length: L,
    cutColor: '#fbe3dc',
    radiusGLSL: pulseGLSL + `float rIn(float th, float u) { return lumen(th, u); } float rOut(float th, float u) { return intimaOut(th, u); }`,
    fragGLSL: noiseGLSL,
    colorGLSL: `
      if (!isCut && vSide < 0.5) {
        float n = vn(vec2(vTU.x * 9.0, vTU.y * 60.0));
        float spot = smoothstep(0.82, 0.93, n) * smoothstep(0.55, 1.0, uSick);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.18, 0.12), spot);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.55, 0.5), uSick * 0.35);
      }`,
    emissiveGLSL: `
      if (!isCut && vSide < 0.5) {
        float n2 = vn(vec2(vTU.x * 9.0, vTU.y * 60.0));
        totalEmissiveRadiance += vec3(1.0, 0.25, 0.1) * smoothstep(0.86, 0.95, n2) * smoothstep(0.6, 1.0, uSick) * 0.8;
      }`,
  });
  const media = tubeLayer({
    geometry: geom,
    material: tissue({ color: '#c74a4a', sheen: '#ff9c8c', roughness: 0.4, clearcoat: 0.5, normal: 'organic', normalScale: 0.4 }),
    uniforms: U,
    length: L,
    cutColor: '#c4423f',
    radiusGLSL: pulseGLSL + `float rIn(float th, float u) { return intimaOut(th, u); } float rOut(float th, float u) { return mediaOut(th, u); }`,
    colorGLSL: `
      if (isCut) {
        float band = smoothstep(0.35, 0.5, abs(fract(vS * mix(7.0, 11.0, uSick)) - 0.5) * 2.0);
        diffuseColor.rgb = mix(vec3(0.80, 0.30, 0.30), vec3(0.62, 0.18, 0.2), band);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.42, 0.38), uSick * 0.35);
      }`,
  });
  const adventitia = tubeLayer({
    geometry: geom,
    material: tissue({ color: '#d7ab86', sheen: '#ffe2c8', roughness: 0.5, clearcoat: 0.4, normal: 'organic', normalScale: 0.6, repeat: [6, 3] }),
    uniforms: U,
    length: L,
    cutColor: '#f3dcc0',
    radiusGLSL: pulseGLSL + `float rIn(float th, float u) { return mediaOut(th, u); } float rOut(float th, float u) { return advOut(th, u); }`,
    colorGLSL: `if (isCut) diffuseColor.rgb = mix(vec3(0.96, 0.86, 0.74), vec3(0.9, 0.74, 0.6), step(0.5, fract(vS * 5.0 + vTU.y * 30.0)));`,
  });
  root.add(intima, media, adventitia);

  const pulseJS = (t, u) => {
    const ph = (((t * RATE - u * 0.9) % 1) + 1) % 1;
    return smoothstep(0, 0.06, ph) * Math.exp(-ph * 6);
  };
  const lumenJS = (t, u, s) => lerp(1, 0.7, s) * (1 + lerp(0.075, 0.025, s) * pulseJS(t, u));

  // ---------- Blood ----------
  const N = 300;
  const rbc = new THREE.InstancedMesh(redCellGeometry(28), tissue({ color: '#b5111f', sheen: '#ff8a80', roughness: 0.3, clearcoat: 0.8, normal: null }), N);
  rbc.castShadow = true;
  const seeds = Array.from({ length: N }, () => ({ x: (r() - 0.5) * L, rr: Math.sqrt(r()) * 0.82, a: r() * Math.PI * 2, rot: new THREE.Vector3(r() * 6, r() * 6, r() * 6), sp: 0.5 + r() * 0.6 }));
  root.add(rbc);

  // ---------- Pressure arrows ----------
  const shaft = new THREE.CylinderGeometry(0.03, 0.03, 0.7, 10).translate(0, 0.35, 0);
  const head = new THREE.ConeGeometry(0.09, 0.2, 14).translate(0, 0.8, 0);
  const arrowGeo = mergeGeometries([shaft, head]);
  const arrowMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.6, roughness: 0.3, transparent: true, opacity: 0.92 });
  const rings = [-3.6, -1.2, 1.2, 3.6];
  const ANG = [];
  for (let a = -2.2; a <= 2.21; a += 0.55) ANG.push(Math.PI + a); // the half of the ring facing away from the opening
  const arrows = new THREE.InstancedMesh(arrowGeo, arrowMat, rings.length * ANG.length);
  root.add(arrows);
  const cLow = new THREE.Color('#7ee0a0'), cHigh = new THREE.Color('#ff4d3d');

  // ---------- Context: where in the body this close-up is ----------
  const CTX_X = -40;
  const ctx = buildContext('artery');
  ctx.group.position.x = CTX_X;
  root.add(ctx.group);

  // ---------- Labels ----------
  // Anchors sit on the upper cut face (theta = 0.62 rad: y = 0.81r, z = 0.58r).
  const onCut = (x, rad) => [x, 0.81 * rad, 0.585 * rad];
  const labels = [
    { text: 'Lining', at: onCut(-3.2, 1.02), side: 'left' },
    { text: 'Muscle', at: onCut(-1.2, 1.18) },
    { text: 'Pressure', at: [1.2, -0.55, -0.25], when: (s) => s < 0.5 },
    { text: 'High pressure', at: [1.2, -0.5, -0.25], when: (s) => s >= 0.5 },
    { text: 'Thick wall', at: onCut(4.0, 1.07), when: (s) => s > 0.6 },
    { text: 'Damage', at: [3.0, 0.05, -0.72], when: (s) => s > 0.75 },
  ];
  labels.push(...ctx.labels);

  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  const tc = new THREE.Color();
  function update(t, dt, s) {
    ctx.update(t, s);
    U.uTime.value = t;
    U.uSick.value = s;

    // Blood surges with each beat.
    const beat = pulseJS(t, 0.5);
    for (let i = 0; i < N; i++) {
      const sd = seeds[i];
      const u = sd.x / L + 0.5;
      const lum = lumenJS(t, u, s);
      const v = (0.55 + 2.4 * pulseJS(t, u)) * (1 - sd.rr * sd.rr * 0.7) * lerp(1, 1.25, s);
      sd.x += v * dt * sd.sp;
      if (sd.x > L / 2) sd.x -= L;
      const rr = sd.rr * (lum - 0.14);
      dummy.position.set(sd.x, Math.cos(sd.a) * rr, Math.sin(sd.a) * rr);
      dummy.rotation.set(sd.rot.x + t * 0.7, sd.rot.y + t * 0.4, sd.rot.z);
      dummy.scale.setScalar(0.13 * smoothstep(L / 2, L / 2 - 0.5, Math.abs(sd.x)));
      dummy.updateMatrix();
      rbc.setMatrixAt(i, dummy.matrix);
    }
    rbc.instanceMatrix.needsUpdate = true;

    // Arrows grow with pressure and turn red.
    let k = 0;
    const pressure = lerp(0.55, 1.0, s) * (0.75 + 0.35 * beat);
    tc.copy(cLow).lerp(cHigh, smoothstep(0.25, 0.8, s));
    arrowMat.color.copy(tc);
    arrowMat.emissive.copy(tc);
    for (const x of rings) {
      const u = x / L + 0.5;
      const lum = lumenJS(t, u, s);
      for (const a of ANG) {
        dir.set(0, Math.cos(a), Math.sin(a));
        const len = pressure * lum * 0.85;
        dummy.position.set(x, 0, 0).addScaledVector(dir, lum - len * 0.98 - 0.02);
        dummy.quaternion.setFromUnitVectors(up, dir);
        dummy.scale.set(1 + s * 0.5, len, 1 + s * 0.5);
        dummy.updateMatrix();
        arrows.setMatrixAt(k++, dummy.matrix);
      }
    }
    arrows.instanceMatrix.needsUpdate = true;
  }
  update(0, 0, 0);

  return {
    root,
    update,
    labels,
    env: {
      background: ['#2a0f16', '#060204', '#5e2030'],
      exposure: 0.95,
      envIntensity: 0.6,
      fog: { color: '#0c0406', density: 0.03 },
      bloom: { strength: 0.3, threshold: 0.96, radius: 0.5 },
      lights: { hemi: 0.3, sky: '#ffe6e0', ground: '#3a1010', key: 2.2, keyPos: [3, 7, 8], shadowSize: 7, rim: 1.6, rimColor: '#a8c8ff', rimPos: [-6, 3, -6], fill: 2.5, fillColor: '#ff7060', fillPos: [0, 0, 2.5] },
    },
    controls: { minDistance: 1.5, maxDistance: 18 },
    labelNear: 26,
    views: {
      context: { pos: [CTX_X + ctx.view.pos[0], ctx.view.pos[1], ctx.view.pos[2]], target: [CTX_X + ctx.view.target[0], ctx.view.target[1], ctx.view.target[2]] },
      overview: { pos: [4.6, 2.2, 9.6], target: [0, -0.1, 0] },
      close: { pos: [2.0, 0.8, 4.8], target: [0.6, -0.2, -0.2] },
      cut: { pos: [-9.6, 1.4, 4.6], target: [-5.0, -0.2, 0] },
    },
  };
}
