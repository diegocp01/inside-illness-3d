import * as THREE from 'three';
import { tissue, membrane, glowPoints } from '../engine/materials.js';
import { redCellGeometry, smoothSphere, displace } from '../engine/shapes.js';
import { tubeLayer } from '../engine/tube.js';
import { noise, rng, smoothstep, lerp } from '../engine/noise.js';

// Iron-deficiency anaemia: a cut-open blood vessel full of red cells delivering oxygen to body cells.
export default function build() {
  const root = new THREE.Group();
  const r = rng(31);
  const L = 16, R = 1.2;

  // ---------- Vessel wall ----------
  const U = { uTime: { value: 0 }, uSick: { value: 0 } };
  const wall = tubeLayer({
    geometry: { radial: 140, lengthSegs: 180, thetaStart: Math.PI / 2 + 1.05, thetaLength: Math.PI * 2 - 2.2, wallSegs: 6, uvRepeat: [10, 4] },
    material: tissue({ color: '#b32a2e', sheen: '#ff9a8a', roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.2, normal: 'cells', normalScale: 0.35 }),
    uniforms: U,
    length: L,
    cutColor: '#e7a49a',
    radiusGLSL: `
      float rIn(float th, float u) { return ${R.toFixed(3)} * (1.0 + 0.012 * sin(uTime * 6.0 - u * 20.0)) + 0.01 * sin(th * 7.0 + u * 30.0); }
      float rOut(float th, float u) { return rIn(th, u) + 0.2; }`,
    bendGLSL: 'p.y += sin(u * 3.0) * 0.18;',
    colorGLSL: `
      if (isCut) {
        vec3 intima = vec3(0.98, 0.82, 0.78);
        vec3 media = vec3(0.78, 0.30, 0.30);
        vec3 adv = vec3(0.95, 0.80, 0.62);
        diffuseColor.rgb = vS < 0.12 ? intima : (vS < 0.72 ? mix(media, media * 0.82, step(0.5, fract(vS * 14.0))) : adv);
      } else if (vSide > 0.5) {
        diffuseColor.rgb = vec3(0.86, 0.52, 0.44);
      }`,
  });
  root.add(wall);
  const centerY = (u) => Math.sin(u * 3) * 0.18; // must match bendGLSL

  // ---------- Red blood cells ----------
  const N = 460;
  const rbcGeo = redCellGeometry(36);
  const rbcU = { uPallor: { value: 0.15 } };
  const rbcMat = tissue({ color: '#ffffff', sheen: '#ff8a80', roughness: 0.3, clearcoat: 0.85, clearcoatRoughness: 0.25, normal: null, sheenAmount: 0.7 });
  rbcMat.onBeforeCompile = (sh) => {
    sh.uniforms.uPallor = rbcU.uPallor;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRad;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRad = length(position.xz);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRad;\nuniform float uPallor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.78, 0.74), (1.0 - smoothstep(0.1, 0.62, vRad)) * uPallor);');
  };
  rbcMat.customProgramCacheKey = () => 'rbc-pallor';
  const rbc = new THREE.InstancedMesh(rbcGeo, rbcMat, N);
  rbc.castShadow = true;
  const seeds = [];
  for (let i = 0; i < N; i++) {
    const rr = Math.sqrt(r()) * (R - 0.22);
    seeds.push({ x: (r() - 0.5) * L, rr, a: r() * Math.PI * 2, rot: new THREE.Vector3(r() * 6, r() * 6, r() * 6), spin: 0.3 + r() * 0.8, keep: r(), o2: r() });
  }
  root.add(rbc);
  const cRed = new THREE.Color('#b0101e'), cPale = new THREE.Color('#e3868a');

  // Oxygen carried by red cells.
  const carried = glowPoints(N, { color: '#bfe9ff', size: 0.12 });
  root.add(carried);

  // ---------- Body cells next to the vessel ----------
  const tissueGroup = new THREE.Group();
  tissueGroup.position.y = -2.55;
  root.add(tissueGroup);
  const bed = new THREE.Mesh(new THREE.BoxGeometry(L, 0.6, 4.5), tissue({ color: '#8f3a3a', roughness: 0.6, clearcoat: 0.3, normal: 'cells', normalScale: 0.5, repeat: [12, 4] }));
  bed.position.y = -0.75;
  bed.receiveShadow = true;
  tissueGroup.add(bed);
  const cellsData = [];
  const CN = 22;
  for (let i = 0; i < CN; i++) {
    cellsData.push({ x: -7 + (i / (CN - 1)) * 14 + (r() - 0.5) * 0.3, z: (r() - 0.5) * 2.6, rad: 0.42 + r() * 0.12, ph: r() * 6 });
  }
  const cellGeo = smoothSphere(4);
  displace(cellGeo, (x, y, z) => noise.noise3(x * 2, y * 2, z * 2) * 0.06);
  const cellMem = new THREE.InstancedMesh(cellGeo, membrane({ color: '#ffd7b5', minAlpha: 0.1, maxAlpha: 0.7 }), CN);
  cellMem.renderOrder = 2;
  const nuc = new THREE.InstancedMesh(smoothSphere(3), tissue({ color: '#6a3c8a', sheen: '#b48ae0', roughness: 0.4, normal: null }), CN);
  const MITO = 5;
  const mitoGeo = new THREE.CapsuleGeometry(0.05, 0.14, 4, 8);
  const mitoMat = new THREE.MeshStandardMaterial({ color: '#ff9b3d', emissive: '#ff7a1a', emissiveIntensity: 1.5, roughness: 0.4 });
  const mito = new THREE.InstancedMesh(mitoGeo, mitoMat, CN * MITO);
  const mitoSeeds = Array.from({ length: CN * MITO }, () => ({ d: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(0.5 + r() * 0.2), rot: new THREE.Euler(r() * 6, r() * 6, r() * 6) }));
  tissueGroup.add(cellMem, nuc, mito);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < CN; i++) {
    const c = cellsData[i];
    dummy.position.set(c.x, 0, c.z);
    dummy.scale.setScalar(c.rad);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    cellMem.setMatrixAt(i, dummy.matrix);
    dummy.position.set(c.x + 0.08, 0.02, c.z);
    dummy.scale.setScalar(c.rad * 0.36);
    dummy.updateMatrix();
    nuc.setMatrixAt(i, dummy.matrix);
  }
  const cellEnergy = glowPoints(CN, { color: '#ffb35c', size: 1.4 });
  tissueGroup.add(cellEnergy);
  {
    const p = cellEnergy.geometry.attributes.position.array;
    cellsData.forEach((c, i) => p.set([c.x, 0, c.z], i * 3));
  }

  // Oxygen hopping from the vessel to the cells.
  const ON = 150;
  const o2 = glowPoints(ON, { color: '#c8f0ff', size: 0.16 });
  const oSeeds = Array.from({ length: ON }, () => ({ c: Math.floor(r() * CN), ph: r(), sp: 0.22 + r() * 0.15, a: (r() - 0.5) * 1.6, k: r() }));
  root.add(o2);

  // ---------- Labels ----------
  const lr = new THREE.Object3D(), lo = new THREE.Object3D();
  root.add(lr, lo);
  const labels = [
    { text: 'Red cells', parent: lr, when: (s) => s < 0.6 },
    { text: 'Pale cells', parent: lr, when: (s) => s >= 0.6 },
    { text: 'Oxygen', parent: lo, when: (s) => s < 0.7 },
    { text: 'Body cells', at: [2.4, -2.1, 0.6], when: (s) => s < 0.6 },
    { text: 'Tired cells', at: [2.4, -2.1, 0.6], when: (s) => s >= 0.6 },
  ];

  const tc = new THREE.Color();
  const q = new THREE.Quaternion();
  function update(t, dt, s) {
    U.uTime.value = t;
    U.uSick.value = s;
    rbcU.uPallor.value = lerp(0.18, 0.6, s);
    const keepFrac = lerp(1, 0.52, s);
    const size = lerp(0.2, 0.155, s);
    const cp = carried.geometry.attributes.position.array;
    const ca = carried.geometry.attributes.aAlpha.array;
    let labelled = false;
    for (let i = 0; i < N; i++) {
      const sd = seeds[i];
      const speed = 1.1 * (1 - (sd.rr / R) ** 2) + 0.15;
      sd.x += speed * dt;
      if (sd.x > L / 2) sd.x -= L;
      const u = sd.x / L + 0.5;
      const vis = smoothstep(keepFrac + 0.04, keepFrac - 0.04, sd.keep);
      dummy.position.set(sd.x, centerY(u) + Math.cos(sd.a) * sd.rr, Math.sin(sd.a) * sd.rr);
      dummy.rotation.set(sd.rot.x + t * sd.spin * 0.6, sd.rot.y + t * sd.spin * 0.3, sd.rot.z);
      dummy.scale.setScalar(size * vis * smoothstep(L / 2, L / 2 - 0.6, Math.abs(sd.x)));
      dummy.updateMatrix();
      rbc.setMatrixAt(i, dummy.matrix);
      tc.copy(cRed).lerp(cPale, s * 0.85);
      tc.offsetHSL(0, 0, (sd.keep - 0.5) * 0.04);
      rbc.setColorAt(i, tc);
      // An oxygen glint riding on most cells (fewer when sick).
      const hasO2 = sd.o2 < lerp(0.95, 0.4, s) ? 1 : 0;
      q.setFromEuler(dummy.rotation);
      const off = new THREE.Vector3(0, 0.12, 0).applyQuaternion(q).multiplyScalar(size * 5);
      cp.set([dummy.position.x + off.x, dummy.position.y + off.y, dummy.position.z + off.z], i * 3);
      ca[i] = vis * hasO2 * 0.5;
      if (!labelled && vis > 0.9 && sd.x > 0.5 && sd.x < 2.5 && Math.sin(sd.a) > 0.4) {
        lr.position.copy(dummy.position);
        labelled = true;
      }
    }
    rbc.instanceMatrix.needsUpdate = true;
    rbc.instanceColor.needsUpdate = true;
    carried.geometry.attributes.position.needsUpdate = true;
    carried.geometry.attributes.aAlpha.needsUpdate = true;

    // Oxygen leaves the vessel and enters the body cells.
    const delivery = lerp(1, 0.25, s);
    const op = o2.geometry.attributes.position.array;
    const oa = o2.geometry.attributes.aAlpha.array;
    let lset = false;
    for (let i = 0; i < ON; i++) {
      const o = oSeeds[i];
      const f = (o.ph + t * o.sp) % 1;
      const c = cellsData[o.c];
      const sx = c.x + o.a, sy = centerY(c.x / L + 0.5) - 0.7, sz = 0.2 + o.a * 0.3;
      const ex = c.x, ey = tissueGroup.position.y, ez = c.z;
      const e = f * f * (3 - 2 * f);
      op.set([lerp(sx, ex, e), lerp(sy, ey, e) + Math.sin(f * Math.PI) * 0.2, lerp(sz, ez, e)], i * 3);
      oa[i] = Math.sin(Math.PI * f) * (o.k < delivery ? 1 : 0);
      if (!lset && oa[i] > 0.6 && c.x > -1 && c.x < 3) {
        lo.position.set(op[i * 3], op[i * 3 + 1], op[i * 3 + 2]);
        lset = true;
      }
    }
    o2.geometry.attributes.position.needsUpdate = true;
    o2.geometry.attributes.aAlpha.needsUpdate = true;

    // Body-cell energy: bright and busy when healthy, dim when starved of oxygen.
    const ea = cellEnergy.geometry.attributes.aAlpha.array;
    for (let i = 0; i < CN; i++) ea[i] = lerp(0.55, 0.12, s) * (0.8 + 0.2 * Math.sin(t * 3 + cellsData[i].ph));
    cellEnergy.geometry.attributes.aAlpha.needsUpdate = true;
    mitoMat.emissiveIntensity = lerp(1.8, 0.25, s);
    mitoMat.color.set('#ff9b3d').lerp(tc.set('#6f6aa0'), s * 0.7);
    for (let i = 0; i < CN * MITO; i++) {
      const c = cellsData[Math.floor(i / MITO)];
      const m = mitoSeeds[i];
      dummy.position.set(c.x + m.d.x * c.rad, m.d.y * c.rad, c.z + m.d.z * c.rad);
      dummy.rotation.set(m.rot.x + t * 0.2, m.rot.y, m.rot.z);
      dummy.scale.setScalar(c.rad * 1.3);
      dummy.updateMatrix();
      mito.setMatrixAt(i, dummy.matrix);
    }
    mito.instanceMatrix.needsUpdate = true;
  }
  update(0, 0, 0);

  return {
    root,
    update,
    labels,
    env: {
      background: ['#2a0d12', '#060203', '#5c1a24'],
      exposure: 1.0,
      envIntensity: 0.45,
      fog: { color: '#0d0405', density: 0.045 },
      bloom: { strength: 0.4, threshold: 0.96, radius: 0.55 },
      lights: { hemi: 0.45, sky: '#ffe2dc', ground: '#3a1010', key: 2.3, keyPos: [2, 8, 7], shadowSize: 8, rim: 1.6, rimColor: '#ffb0a0', rimPos: [-6, 2, -6], fill: 5, fillColor: '#ff6a5a', fillPos: [0, 0, 3] },
    },
    controls: { minDistance: 1.5, maxDistance: 18 },
    views: {
      overview: { pos: [3.4, 0.9, 8.6], target: [0, -0.9, 0] },
      tissue: { pos: [1.8, -0.9, 5.4], target: [0.4, -1.9, 0] },
      close: { pos: [0.9, 0.35, 2.7], target: [0.4, 0, 0] },
    },
  };
}
