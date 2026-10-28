import * as THREE from 'three';
import { tissue, glowPoints, membrane } from '../engine/materials.js';
import { surfaceNets, sdf, variableTube, smoothSphere, displace } from '../engine/shapes.js';
import { eosinophilGeometry } from '../engine/cells.js';
import { tubeLayer } from '../engine/tube.js';
import { noise, rng, smoothstep, lerp } from '../engine/noise.js';

// Eosinophilic esophagitis: a glass body showing the digestive tract, plus a cut-open close-up of the esophagus.
export default function build() {
  const root = new THREE.Group();
  const r = rng(121);

  // ================= Body view =================
  const body = new THREE.Group();
  root.add(body);
  const torsoSDF = (x, y, z) => {
    let d = sdf.ellipsoid(x, y, z, 0, 2.62, 0.02, 0.36, 0.46, 0.42);
    d = sdf.smin(d, sdf.roundCone(x, y, z, 0, 2.25, -0.02, 0, 1.85, 0, 0.16, 0.2), 0.12);
    d = sdf.smin(d, sdf.ellipsoid(x, y, z, 0, 1.2, 0, 0.78, 0.72, 0.42), 0.35);
    d = sdf.smin(d, sdf.ellipsoid(x, y, z, 0, 0.2, 0.02, 0.64, 0.78, 0.4), 0.35);
    d = sdf.smin(d, sdf.ellipsoid(x, y, z, 0, -0.5, 0, 0.7, 0.42, 0.38), 0.3);
    d = sdf.smin(d, sdf.roundCone(x, y, z, -0.8, 1.72, 0, 0.8, 1.72, 0, 0.2, 0.2), 0.3);
    for (const sx of [-1, 1]) d = sdf.smin(d, sdf.roundCone(x, y, z, sx * 0.9, 1.68, 0, sx * 1.04, 0.62, 0.02, 0.17, 0.13), 0.12);
    return Math.max(d, -0.86 - y);
  };
  const torso = new THREE.Mesh(
    surfaceNets(torsoSDF, [-1.3, -0.95, -0.6], [1.3, 3.15, 0.6], 110),
    membrane({ color: '#a9c9ff', minAlpha: 0.02, maxAlpha: 0.34, roughness: 0.25 })
  );
  torso.renderOrder = 5;
  body.add(torso);

  const pinkTract = tissue({ color: '#e07b78', sheen: '#ffc0b8', roughness: 0.3, clearcoat: 0.9, normal: null, emissive: '#ff2a1a', emissiveIntensity: 0 });
  const esoCurve = new THREE.CatmullRomCurve3([
    [0, 2.42, 0.22], [0, 2.22, 0.05], [0, 1.9, -0.02], [0.01, 1.4, -0.06], [0.04, 0.95, -0.05], [0.13, 0.6, -0.01], [0.24, 0.46, 0.03],
  ].map((p) => new THREE.Vector3(...p)));
  const eso = new THREE.Mesh(variableTube(esoCurve, () => 0.05, 160, 20), pinkTract);
  body.add(eso);
  const stomachCurve = new THREE.CatmullRomCurve3([
    [0.22, 0.48, 0.03], [0.42, 0.42, 0.05], [0.52, 0.22, 0.08], [0.44, 0.0, 0.1], [0.22, -0.07, 0.12], [0.02, 0.02, 0.12], [-0.1, 0.0, 0.1],
  ].map((p) => new THREE.Vector3(...p)));
  const stomach = new THREE.Mesh(variableTube(stomachCurve, (t) => lerp(0.08, 0.22, smoothstep(0, 0.3, t)) * (1 - smoothstep(0.55, 1, t) * 0.75), 120, 28), tissue({ color: '#e88b84', sheen: '#ffc8c0', roughness: 0.3, clearcoat: 0.9, normal: null }));
  body.add(stomach);
  // Small intestine: a smooth random walk folded inside the belly.
  const coil = [];
  {
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
  }
  body.add(new THREE.Mesh(variableTube(new THREE.CatmullRomCurve3(coil), () => 0.04, 900, 12), tissue({ color: '#f0a08e', sheen: '#ffd2c4', roughness: 0.32, clearcoat: 0.8, normal: null })));
  const colonCurve = new THREE.CatmullRomCurve3([[-0.42, -0.62, 0.05], [-0.48, -0.2, 0.06], [-0.46, 0.18, 0.08], [0.0, 0.22, 0.16], [0.46, 0.2, 0.08], [0.5, -0.2, 0.05], [0.4, -0.62, 0.02], [0.1, -0.72, 0.0]].map((p) => new THREE.Vector3(...p)));
  body.add(new THREE.Mesh(variableTube(colonCurve, (t) => 0.07 * (1 + 0.18 * Math.sin(t * 90)), 300, 16), tissue({ color: '#d99a7e', sheen: '#ffd8c0', roughness: 0.35, clearcoat: 0.7, normal: null })));

  const bolus = new THREE.Mesh(smoothSphere(3), tissue({ color: '#c99a5a', roughness: 0.6, clearcoat: 0.3, normal: null }));
  bolus.scale.setScalar(0.062);
  body.add(bolus);
  const EGN = 90;
  const eosGlow = glowPoints(EGN, { color: '#ff7a2a', size: 0.12 });
  const egSeeds = Array.from({ length: EGN }, () => ({ u: 0.15 + r() * 0.75, off: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.07), ph: r() * 6 }));
  body.add(eosGlow);

  // ================= Inside view: a cut-open esophagus =================
  const IN_X = 30;
  const inside = new THREE.Group();
  inside.position.x = IN_X;
  inside.rotation.z = Math.PI / 2; // tube axis vertical; u = 1 is the top
  root.add(inside);
  const L = 8;
  const U = { uTime: { value: 0 }, uSick: { value: 0 }, uWave: { value: 0 }, uBolus: { value: 0.5 } };
  const radiusGLSL = `
    float lumenR(float th, float u) {
      float s = uSick;
      float stricture = 1.0 - 0.3 * s * smoothstep(0.25, 0.45, u) * smoothstep(0.65, 0.45, u);
      float rings = 1.0 - 0.07 * s * pow(0.5 + 0.5 * sin(u * uLength * 4.2), 4.0);
      float furrow = 1.0 + 0.035 * s * (smoothstep(0.75, 1.0, sin(th * 12.0)) );
      float wave = 1.0 - 0.32 * exp(-pow((u - uWave) / 0.05, 2.0));
      float bol = 1.0 + 0.25 * exp(-pow((u - uBolus) / 0.06, 2.0));
      return 0.62 * stricture * rings * furrow * wave * bol;
    }
    float muscleIn(float th, float u) { return 0.62 * (1.0 - 0.1 * s0()) + 0.2 + 0.06 * uSick; }
  `;
  const s0 = 'float s0(){ return uSick; }';
  const geom = { radial: 150, lengthSegs: 200, thetaStart: Math.PI / 2 + 0.95, thetaLength: Math.PI * 2 - 1.9, wallSegs: 5, uvRepeat: [8, 4] };
  const mucosa = tubeLayer({
    geometry: geom,
    material: tissue({ color: '#ec9f97', sheen: '#ffd6cf', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, normal: 'cells', normalScale: 0.3 }),
    uniforms: U,
    length: L,
    cutColor: '#f2b8ae',
    radiusGLSL: s0 + radiusGLSL + 'float rIn(float th, float u) { return lumenR(th, u); } float rOut(float th, float u) { return muscleIn(th, u); }',
    fragGLSL: `float hs(vec2 p){ return fract(sin(dot(p, vec2(27.1, 61.7))) * 43758.5); }
      float vn2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hs(i),hs(i+vec2(1,0)),f.x),mix(hs(i+vec2(0,1)),hs(i+vec2(1,1)),f.x),f.y); }`,
    colorGLSL: `
      if (!isCut && vSide < 0.5) {
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.36, 0.34), uSick * 0.7);
        float sp = smoothstep(0.78, 0.86, vn2(vec2(vTU.x * 14.0, vTU.y * 70.0)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.95, 0.88), sp * smoothstep(0.5, 0.9, uSick));
      } else if (isCut) {
        diffuseColor.rgb = mix(vec3(0.97, 0.78, 0.74), vec3(0.94, 0.66, 0.62), smoothstep(0.0, 0.3, vS));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.52, 0.5), uSick * 0.5);
      }`,
  });
  const muscle = tubeLayer({
    geometry: geom,
    material: tissue({ color: '#b83a3e', sheen: '#ff9a8a', roughness: 0.4, clearcoat: 0.5, normal: 'organic', normalScale: 0.5 }),
    uniforms: U,
    length: L,
    cutColor: '#b33a3c',
    radiusGLSL: s0 + radiusGLSL + 'float rIn(float th, float u) { return muscleIn(th, u); } float rOut(float th, float u) { return muscleIn(th, u) + 0.26; }',
    colorGLSL: 'if (isCut) diffuseColor.rgb = mix(vec3(0.72, 0.2, 0.22), vec3(0.62, 0.15, 0.18), step(0.5, fract(vS * 3.0)));',
  });
  inside.add(mucosa, muscle);
  const insideBolus = new THREE.Mesh(smoothSphere(4), tissue({ color: '#c79a5c', sheen: '#ffe0b0', roughness: 0.55, clearcoat: 0.4, normal: 'organic', normalScale: 0.6 }));
  displace(insideBolus.geometry, (x, y, z) => noise.noise3(x * 3, y * 3, z * 3) * 0.08);
  inside.add(insideBolus);

  // Eosinophils packed into the lining.
  const EN = 90;
  const eos = new THREE.InstancedMesh(eosinophilGeometry(7), new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, clearcoat: 0.6, emissive: '#ff4a10', emissiveIntensity: 0.12 }), EN);
  eos.castShadow = true;
  const TH0 = Math.PI / 2 + 0.95, TH1 = TH0 + Math.PI * 2 - 1.9;
  const eSeeds = Array.from({ length: EN }, (_, i) => {
    const onCut = r() < 0.45;
    return { u: 0.06 + r() * 0.88, th: onCut ? (r() < 0.5 ? TH0 + 0.02 : TH1 - 0.02) : TH0 + 0.3 + r() * (TH1 - TH0 - 0.6), onCut, d: r(), thr: (i / EN) * 0.85 + 0.1, rot: r() * 6 };
  });
  inside.add(eos);
  const lumenJS = (th, u, s, t, wave, bolusU) => {
    const stricture = 1 - 0.3 * s * smoothstep(0.25, 0.45, u) * smoothstep(0.65, 0.45, u);
    const rings = 1 - 0.07 * s * Math.pow(0.5 + 0.5 * Math.sin(u * L * 4.2), 4);
    const w = 1 - 0.32 * Math.exp(-(((u - wave) / 0.05) ** 2));
    const b = 1 + 0.25 * Math.exp(-(((u - bolusU) / 0.06) ** 2));
    return 0.62 * stricture * rings * w * b;
  };

  // ================= Labels =================
  const near = 9;
  const labels = [
    { text: 'Esophagus', at: [0.02, 1.55, -0.05], near, when: (s) => s <= 0.5 },
    { text: 'Stomach', at: [0.5, 0.25, 0.1], near },
    { text: 'Inflamed', at: [0.02, 1.25, -0.05], side: 'left', near, when: (s) => s > 0.5 },
    { text: 'Lining', at: [IN_X + 0.0, 2.0, -0.55], near, when: (s) => s < 0.5 },
    { text: 'Muscle', at: [IN_X - 0.7, -2.6, 0.55], side: 'left', near },
    { text: 'Allergy cells', at: [IN_X + 0.62, 1.2, 0.5], near, when: (s) => s >= 0.35 },
    { text: 'Rings & spots', at: [IN_X - 0.1, 2.6, -0.5], side: 'left', near, when: (s) => s >= 0.7 },
    { text: 'Narrowing', at: [IN_X + 0.2, 0.3, -0.3], near, when: (s) => s >= 0.8 },
  ];

  const dummy = new THREE.Object3D();
  const tmp = new THREE.Vector3();
  const inflamed = new THREE.Color('#d24a44');
  let bolusU = 1;
  function update(t, dt, s) {
    U.uTime.value = t;
    U.uSick.value = s;
    // Swallow cycle (body view): bolus slides down; it lingers at the narrow part when sick.
    const cyc = (t * 0.22) % 1;
    const stuck = smoothstep(0.75, 1, s);
    let f = cyc;
    if (stuck > 0) {
      const hold = 0.5;
      f = cyc < hold ? cyc * (0.55 / hold) : lerp(0.55, 1, (cyc - hold) / (1 - hold));
      f = lerp(cyc, f, stuck);
    }
    esoCurve.getPointAt(Math.min(0.999, f), bolus.position);
    bolus.scale.setScalar(0.062 * (1 - smoothstep(0.92, 1, f)));
    pinkTract.emissiveIntensity = smoothstep(0.3, 1, s) * (0.55 + 0.2 * Math.sin(t * 3));
    pinkTract.color.set('#e07b78').lerp(inflamed, s * 0.7);
    const ep = eosGlow.geometry.attributes.position.array;
    const ea = eosGlow.geometry.attributes.aAlpha.array;
    for (let i = 0; i < EGN; i++) {
      const e = egSeeds[i];
      esoCurve.getPointAt(e.u, tmp);
      tmp.add(e.off);
      ep.set([tmp.x, tmp.y, tmp.z], i * 3);
      ea[i] = smoothstep(0.3, 0.8, s) * (0.6 + 0.4 * Math.sin(t * 3 + e.ph));
    }
    eosGlow.geometry.attributes.position.needsUpdate = true;
    eosGlow.geometry.attributes.aAlpha.needsUpdate = true;

    // Inside view: peristaltic wave pushes the bite down; it jams at the stricture when sick.
    const speed = lerp(0.18, 0.12, s);
    bolusU -= dt * speed;
    const jam = smoothstep(0.75, 1, s);
    if (jam > 0.5 && bolusU < 0.62 && bolusU > 0.5) bolusU += dt * speed * 0.85;
    if (bolusU < -0.1) bolusU = 1.1;
    U.uBolus.value = bolusU;
    U.uWave.value = bolusU + 0.1;
    insideBolus.position.set((bolusU - 0.5) * L, 0, 0);
    const bR = 0.62 * 0.9 * (1 - jam * 0.1);
    insideBolus.scale.set(bR * 1.35, bR, bR);
    insideBolus.visible = bolusU > 0.0 && bolusU < 1.0;

    for (let i = 0; i < EN; i++) {
      const e = eSeeds[i];
      const g = smoothstep(e.thr, e.thr + 0.1, s);
      const rIn = lumenJS(e.th, e.u, s, t, U.uWave.value, bolusU);
      const rad = e.onCut ? rIn + 0.04 + e.d * 0.16 : rIn - 0.02;
      dummy.position.set((e.u - 0.5) * L, Math.cos(e.th) * rad, Math.sin(e.th) * rad);
      dummy.rotation.set(e.rot + t * 0.2, e.rot, 0);
      dummy.scale.setScalar((e.onCut ? 0.06 : 0.08) * g);
      dummy.updateMatrix();
      eos.setMatrixAt(i, dummy.matrix);
    }
    eos.instanceMatrix.needsUpdate = true;
  }
  update(0, 0.016, 0);

  return {
    root,
    update,
    labels,
    env: {
      background: ['#141b26', '#04060a', '#283a55'],
      exposure: 1.0,
      envIntensity: 0.7,
      bloom: { strength: 0.32, threshold: 0.96, radius: 0.5 },
      lights: { hemi: 0.45, sky: '#f0f6ff', ground: '#2a1a1a', key: 2.4, keyPos: [3, 7, 6], shadowSize: 5, rim: 2.0, rimColor: '#9fc4ff', rimPos: [-5, 3, -5], fill: 0, head: 0.6 },
    },
    controls: { minDistance: 1.2, maxDistance: 14 },
    views: {
      body: { pos: [3.0, 2.2, 6.6], target: [0, 1.05, 0] },
      inside: { pos: [IN_X + 3.2, 1.2, 6.6], target: [IN_X, 0.3, 0] },
      overview: { pos: [3.0, 2.2, 6.6], target: [0, 1.05, 0] },
    },
  };
}
