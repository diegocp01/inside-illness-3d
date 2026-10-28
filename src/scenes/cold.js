import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { tissue, membrane, glowPoints } from '../engine/materials.js';
import { virusGeometry, whiteCellGeometry, redCellGeometry, smoothSphere } from '../engine/shapes.js';
import { noise, rng, smoothstep, lerp, clamp } from '../engine/noise.js';

// Common cold: a slab of nasal lining — cilia, mucus, lining cells, and blood vessels beneath.
export default function build() {
  const root = new THREE.Group();
  const r = rng(11);
  const W = 8, D = 4, LP = 1.4; // width, depth, lamina propria height
  const cellH = 0.6;

  // ---------- Lamina propria (translucent connective tissue) ----------
  const lpMat = new THREE.MeshPhysicalMaterial({ color: '#f2a7a0', roughness: 0.6, transparent: true, opacity: 0.3, envMapIntensity: 0.3, depthWrite: false, clearcoat: 0.4, side: THREE.DoubleSide });
  const lp = new THREE.Mesh(new THREE.BoxGeometry(W, LP, D), lpMat);
  lp.geometry.translate(0, -LP / 2, 0);
  lp.renderOrder = 3;
  root.add(lp);
  // Base plate so the slab reads as a solid specimen.
  const base = new THREE.Mesh(new RoundedBoxGeometry(W + 0.1, 0.12, D + 0.1, 2, 0.05), tissue({ color: '#9a4a48', roughness: 0.6, clearcoat: 0.2 }));
  base.position.y = -LP - 0.06;
  base.receiveShadow = true;
  root.add(base);

  // Collagen fibres inside the connective tissue.
  const fiberGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 6, 1);
  const fibers = new THREE.InstancedMesh(fiberGeo, new THREE.MeshStandardMaterial({ color: '#d99085', roughness: 0.9, envMapIntensity: 0.2 }), 60);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  for (let i = 0; i < 60; i++) {
    e.set(r() * Math.PI, r() * Math.PI, Math.PI / 2 + (r() - 0.5) * 0.8);
    q.setFromEuler(e);
    v3.set((r() - 0.5) * (W - 0.4), -0.15 - r() * (LP - 0.3), (r() - 0.5) * (D - 0.4));
    s3.set(1, 0.25 + r() * 0.6, 1);
    fibers.setMatrixAt(i, m4.compose(v3, q, s3));
  }
  root.add(fibers);

  // ---------- Blood vessels ----------
  const vessels = [];
  const vesselRBC = [];
  const rbcGeo = redCellGeometry(24);
  for (const [z, y] of [[-0.8, -0.75], [1.05, -0.62]]) {
    const g = new THREE.Group();
    g.position.set(0, y, z);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, W, 40, 1, true).rotateZ(Math.PI / 2), membrane({ color: '#ff6a5c', minAlpha: 0.18, maxAlpha: 0.85, roughness: 0.45, clearcoat: 0.25 }));
    wall.renderOrder = 2;
    g.add(wall);
    const n = 46;
    const rbc = new THREE.InstancedMesh(rbcGeo, tissue({ color: '#c3142a', sheen: '#ff8a8a', roughness: 0.35, normal: null, clearcoat: 0.8 }), n);
    const seeds = [];
    for (let i = 0; i < n; i++) seeds.push({ x: r() * W - W / 2, a: r() * Math.PI * 2, rr: Math.sqrt(r()) * 0.55, rot: r() * 6, sp: 0.6 + r() * 0.4 });
    g.add(rbc);
    vesselRBC.push({ mesh: rbc, seeds });
    root.add(g);
    vessels.push({ g, wall });
  }
  const baseVesselR = 0.17;

  // ---------- Epithelium (upper group moves up as tissue swells) ----------
  const upper = new THREE.Group();
  root.add(upper);
  const NX = 32, NZ = 16;
  const pitch = W / NX;
  const cellGeo = new RoundedBoxGeometry(pitch * 0.9, cellH, pitch * 0.9, 2, 0.05);
  cellGeo.translate(0, cellH / 2, 0);
  const cellMat = tissue({ color: '#ffffff', sheen: '#ffd0c8', roughness: 0.42, clearcoat: 0.3, normal: 'organic', normalScale: 0.25 });
  const cells = new THREE.InstancedMesh(cellGeo, cellMat, NX * NZ);
  cells.castShadow = true;
  cells.receiveShadow = true;
  const cellInfo = [];
  let ci = 0;
  for (let iz = 0; iz < NZ; iz++) {
    for (let ix = 0; ix < NX; ix++) {
      const x = -W / 2 + pitch * (ix + 0.5) + (r() - 0.5) * 0.02;
      const z = -D / 2 + pitch * (iz + 0.5) + (r() - 0.5) * 0.02;
      const h = 0.92 + r() * 0.12;
      const goblet = r() < 0.12;
      cells.setMatrixAt(ci, m4.compose(v3.set(x, 0, z), q.identity(), s3.set(1, h, 1)));
      cellInfo.push({ x, z, h, goblet, infected: 0 });
      ci++;
    }
  }
  upper.add(cells);
  const colHealthy = new THREE.Color('#d9766c'), colGoblet = new THREE.Color('#ead2c6'), colSwollen = new THREE.Color('#c93a35'), colInfected = new THREE.Color('#7fe0c8');
  const tmpC = new THREE.Color();

  // ---------- Cilia ----------
  const PER = 6;
  const cilGeo = new THREE.CylinderGeometry(0.011, 0.014, 0.16, 5, 4);
  cilGeo.translate(0, 0.08, 0);
  const cilU = { uTime: { value: 0 }, uAmp: { value: 1 } };
  const cilMat = new THREE.MeshStandardMaterial({ color: '#eaaea3', roughness: 0.85 });
  cilMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, cilU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uAmp; attribute float aPhase;')
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        float hh = clamp(position.y / 0.16, 0.0, 1.0);
        float ph = uTime * 8.0 - instanceMatrix[3].x * 2.6 + aPhase;
        float bb = (sin(ph) + 0.35 * sin(ph * 2.0)) * hh * hh * 0.08 * uAmp;
        transformed.x += bb; transformed.y -= abs(bb) * 0.3;`
      );
  };
  const nonGoblet = cellInfo.filter((c) => !c.goblet);
  const cilia = new THREE.InstancedMesh(cilGeo, cilMat, nonGoblet.length * PER);
  const phases = new Float32Array(nonGoblet.length * PER);
  let k = 0;
  for (const c of nonGoblet) {
    for (let j = 0; j < PER; j++) {
      const ox = (r() - 0.5) * pitch * 0.7, oz = (r() - 0.5) * pitch * 0.7;
      cilia.setMatrixAt(k, m4.compose(v3.set(c.x + ox, cellH * c.h, c.z + oz), q.identity(), s3.set(1, 0.85 + r() * 0.3, 1)));
      phases[k] = r() * 0.6;
      k++;
    }
  }
  cilGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  upper.add(cilia);

  // ---------- Mucus layer ----------
  const MX = 90, MZ = 45;
  const mucusGeo = new THREE.BufferGeometry();
  const top = (MX + 1) * (MZ + 1);
  const edgeCount = 2 * (MX + 1) + 2 * (MZ + 1);
  const mpos = new Float32Array((top + edgeCount * 2) * 3);
  const midx = [];
  for (let j = 0; j < MZ; j++)
    for (let i = 0; i < MX; i++) {
      const a = j * (MX + 1) + i, b = a + 1, c = a + MX + 1, d = c + 1;
      midx.push(a, c, b, b, c, d);
    }
  // skirts: pairs (top edge vertex copy, bottom vertex)
  const edgeList = [];
  for (let i = 0; i <= MX; i++) edgeList.push(MZ * (MX + 1) + i); // front (z+)
  for (let j = MZ; j >= 0; j--) edgeList.push(j * (MX + 1) + MX); // right
  for (let i = MX; i >= 0; i--) edgeList.push(i); // back
  for (let j = 0; j <= MZ; j++) edgeList.push(j * (MX + 1)); // left
  for (let e2 = 0; e2 < edgeList.length - 1; e2++) {
    const t0 = top + e2 * 2, t1 = top + (e2 + 1) * 2;
    midx.push(t0, t0 + 1, t1, t1, t0 + 1, t1 + 1);
  }
  mucusGeo.setAttribute('position', new THREE.BufferAttribute(mpos, 3));
  mucusGeo.setIndex(midx);
  const mucusMat = new THREE.MeshPhysicalMaterial({
    color: '#eef6ff', roughness: 0.42, metalness: 0, transmission: 1, thickness: 0.35, ior: 1.34, envMapIntensity: 0.12, specularIntensity: 0.05,
    clearcoat: 0.0, attenuationColor: new THREE.Color('#e9f2ff'), attenuationDistance: 2.5, side: THREE.DoubleSide,
  });
  const mucus = new THREE.Mesh(mucusGeo, mucusMat);
  mucus.renderOrder = 4;
  upper.add(mucus);
  const mucusBase = cellH + 0.02;
  const mucusHealthy = new THREE.Color('#eef6ff'), mucusSick = new THREE.Color('#e7eaa8');

  function mucusHeight(x, z, t, s) {
    const thick = lerp(0.24, 0.62, s);
    const flow = t * 0.25;
    const n1 = noise.noise3((x - flow) * 0.7, z * 0.7, t * 0.08) * 0.07;
    const n2 = noise.noise3((x - flow) * 2.2, z * 2.2, t * 0.15) * 0.025 * (1 + s);
    const blob = Math.max(0, noise.noise3((x - flow * 1.2) * 0.45 + 3, z * 0.45, 1)) * 0.35 * s;
    return mucusBase + thick + n1 + n2 + blob;
  }
  function updateMucus(t, s) {
    for (let j = 0; j <= MZ; j++) {
      const z = -D / 2 + (j / MZ) * D;
      for (let i = 0; i <= MX; i++) {
        const x = -W / 2 + (i / MX) * W;
        const o = (j * (MX + 1) + i) * 3;
        mpos[o] = x;
        mpos[o + 1] = mucusHeight(x, z, t, s);
        mpos[o + 2] = z;
      }
    }
    for (let e2 = 0; e2 < edgeList.length; e2++) {
      const src = edgeList[e2] * 3;
      const o = (top + e2 * 2) * 3;
      mpos[o] = mpos[src]; mpos[o + 1] = mpos[src + 1]; mpos[o + 2] = mpos[src + 2];
      mpos[o + 3] = mpos[src]; mpos[o + 4] = mucusBase; mpos[o + 5] = mpos[src + 2];
    }
    mucusGeo.attributes.position.needsUpdate = true;
    mucusGeo.computeVertexNormals();
  }

  // Dust and pollen caught in the mucus.
  const dustN = 46;
  const dust = new THREE.InstancedMesh(smoothSphere(1), new THREE.MeshStandardMaterial({ color: '#8c6a3c', roughness: 0.8 }), dustN);
  const dustSeeds = Array.from({ length: dustN }, () => ({ x: r() * W, z: (r() - 0.5) * (D - 0.4), s: 0.025 + r() * 0.04, y: r() }));
  upper.add(dust);

  // ---------- Viruses ----------
  const VN = 70;
  const virusMat = new THREE.MeshPhysicalMaterial({ color: '#36d6b0', roughness: 0.3, clearcoat: 1, emissive: '#0f6b58', emissiveIntensity: 0.9 });
  const viruses = new THREE.InstancedMesh(virusGeometry({ knobs: 'rhino', detail: 3 }), virusMat, VN);
  viruses.castShadow = true;
  const vSeeds = [];
  for (let i = 0; i < VN; i++) {
    const target = cellInfo[Math.floor(r() * cellInfo.length)];
    vSeeds.push({
      thr: 0.12 + r() * 0.42,
      from: new THREE.Vector3((r() - 0.5) * W * 0.9, 2.2 + r() * 1.4, (r() - 0.5) * D * 0.9),
      cell: target,
      rot: new THREE.Euler(r() * 6, r() * 6, r() * 6),
      ph: r() * 6,
    });
  }
  upper.add(viruses);

  // ---------- White blood cells ----------
  const WN = 18;
  const wbcMat = tissue({ color: '#f4efe9', sheen: '#ffffff', roughness: 0.45, normal: 'organic', normalScale: 0.4, repeat: [1, 1], clearcoat: 0.5 });
  const wbc = new THREE.InstancedMesh(whiteCellGeometry(2, 4), wbcMat, WN);
  wbc.castShadow = true;
  const wSeeds = [];
  for (let i = 0; i < WN; i++) {
    const vi = r() < 0.5 ? 0 : 1;
    wSeeds.push({ thr: 0.45 + r() * 0.35, vi, x: (r() - 0.5) * (W - 1), z: (r() - 0.5) * (D - 1), ph: r() * 6, size: 0.1 + r() * 0.04 });
  }
  root.add(wbc);

  // ---------- Alarm signals (cytokines) ----------
  const SIG = 160;
  const signals = glowPoints(SIG, { color: '#ffb347', size: 0.09 });
  const sigSeeds = Array.from({ length: SIG }, () => ({ c: Math.floor(r() * cellInfo.length), ph: r(), vz: r() < 0.5 ? -0.8 : 1.05 }));
  root.add(signals);

  // ---------- Labels ----------
  const lblVirus = new THREE.Object3D(), lblWbc = new THREE.Object3D(), lblInf = new THREE.Object3D(), lblMucus = new THREE.Object3D();
  upper.add(lblVirus, lblInf, lblMucus);
  root.add(lblWbc);
  const labels = [
    { text: 'Mucus', parent: lblMucus },
    { text: 'Cilia', at: [2.6, cellH + 0.16, D / 2], parent: upper },
    { text: 'Vessel', at: [2.2, -0.62 + 0.18, 1.05], when: (s) => s < 0.5 },
    { text: 'Swollen vessel', at: [2.2, -0.62 + 0.3, 1.05], when: (s) => s >= 0.5 },
    { text: 'Virus', parent: lblVirus, when: (s) => s > 0.2 && s < 0.95 },
    { text: 'White cells', parent: lblWbc, when: (s) => s > 0.7 },
  ];

  const dummy = new THREE.Object3D();

  function update(t, dt, s) {
    const swell = smoothstep(0.35, 0.9, s);
    // Tissue swelling lifts the lining.
    // Bottom stays at -LP while the top rises by `lift`.
    const lpScale = 1 + swell * 0.32;
    const lift = LP * (lpScale - 1);
    lp.scale.y = lpScale;
    lp.position.y = lift;
    upper.position.y = lift;
    lpMat.color.set('#f2a7a0').lerp(tmpC.set('#ff6f61'), swell * 0.6);
    fibers.position.y = lift * 0.5;

    // Vessels widen and glow.
    for (const [vi, vs] of vessels.entries()) {
      const rad = baseVesselR * (1 + swell * 0.75) * (1 + Math.sin(t * 6.3 + vi) * 0.03);
      vs.wall.scale.set(1, rad, rad);
      vs.g.position.y = (vi === 0 ? -0.75 : -0.62) + lift * 0.45;
      const rb = vesselRBC[vi];
      const speed = lerp(0.9, 0.55, swell);
      for (let i = 0; i < rb.seeds.length; i++) {
        const sd = rb.seeds[i];
        let x = ((sd.x + t * speed * sd.sp + W / 2) % W + W) % W - W / 2;
        const rr = sd.rr * rad;
        dummy.position.set(x, Math.cos(sd.a + t * 0.3) * rr, Math.sin(sd.a + t * 0.3) * rr);
        dummy.rotation.set(sd.rot + t * 0.8, sd.rot * 2, sd.rot + t * 0.5);
        const sc = Math.min(rad * 0.62, 0.12);
        dummy.scale.setScalar(sc);
        const fade = smoothstep(W / 2, W / 2 - 0.25, Math.abs(x));
        dummy.scale.multiplyScalar(fade);
        dummy.updateMatrix();
        rb.mesh.setMatrixAt(i, dummy.matrix);
      }
      rb.mesh.instanceMatrix.needsUpdate = true;
    }

    // Cilia: a sick lining beats less well.
    cilU.uTime.value = t;
    cilU.uAmp.value = lerp(1, 0.55, swell);

    // Mucus (rebuilt every frame; cheap at this resolution).
    updateMucus(t, s);
    mucusMat.color.copy(mucusHealthy).lerp(mucusSick, smoothstep(0.55, 1, s));
    mucusMat.attenuationColor.copy(mucusMat.color);
    mucusMat.roughness = lerp(0.06, 0.18, s);
    lblMucus.position.set(-2.8, mucusHeight(-2.8, 1.2, t, s) + 0.02, 1.2);

    // Dust drifts with the mucus flow.
    for (let i = 0; i < dustN; i++) {
      const d = dustSeeds[i];
      const x = ((d.x + t * 0.25) % W) - W / 2;
      const y = mucusHeight(x, d.z, t, s) - 0.05 - d.y * 0.12;
      dummy.position.set(x, y, d.z);
      dummy.scale.setScalar(d.s * smoothstep(W / 2, W / 2 - 0.2, Math.abs(x)));
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      dust.setMatrixAt(i, dummy.matrix);
    }
    dust.instanceMatrix.needsUpdate = true;

    // Viruses rain down and latch onto cells.
    for (const c of cellInfo) c.infected = 0;
    let firstVisible = null, firstInfected = null;
    for (let i = 0; i < VN; i++) {
      const v = vSeeds[i];
      const p = smoothstep(v.thr, v.thr + 0.22, s);
      const vis = smoothstep(v.thr - 0.08, v.thr, s) * (1 - smoothstep(0.92, 1.0, s) * 0.6);
      const target = v.tmp || (v.tmp = new THREE.Vector3());
      target.set(v.cell.x, cellH * v.cell.h + 0.05, v.cell.z);
      const e3 = p * p * (3 - 2 * p);
      dummy.position.copy(v.from).lerp(target, e3);
      const wob = (1 - p) * 0.12;
      dummy.position.x += Math.sin(t * 0.9 + v.ph) * wob;
      dummy.position.z += Math.cos(t * 0.7 + v.ph) * wob;
      dummy.rotation.set(v.rot.x + t * 0.4 * (1 - p), v.rot.y + t * 0.3, v.rot.z);
      dummy.scale.setScalar(0.06 * vis);
      dummy.updateMatrix();
      viruses.setMatrixAt(i, dummy.matrix);
      if (p > 0.98) {
        v.cell.infected = Math.max(v.cell.infected, smoothstep(v.thr + 0.22, v.thr + 0.4, s));
        if (!firstInfected) firstInfected = v.cell;
      }
      if (vis > 0.5 && p > 0.2 && p < 0.9 && !firstVisible) firstVisible = dummy.position.clone();
    }
    viruses.instanceMatrix.needsUpdate = true;
    if (firstVisible) lblVirus.position.copy(firstVisible);
    else lblVirus.position.set(vSeeds[0].cell.x, cellH + 0.1, vSeeds[0].cell.z);
    if (firstInfected) lblInf.position.set(firstInfected.x, cellH * firstInfected.h + 0.02, firstInfected.z);

    // Cell colours: swollen redness + infected glow.
    for (let i = 0; i < cellInfo.length; i++) {
      const c = cellInfo[i];
      tmpC.copy(c.goblet ? colGoblet : colHealthy).lerp(colSwollen, swell * 0.45);
      if (c.infected > 0) tmpC.lerp(colInfected, c.infected * (0.55 + 0.25 * Math.sin(t * 4 + i)));
      cells.setColorAt(i, tmpC);
    }
    cells.instanceColor.needsUpdate = true;

    // White blood cells crawl out of the vessels toward the lining.
    let wl = null;
    for (let i = 0; i < WN; i++) {
      const w = wSeeds[i];
      const p = smoothstep(w.thr, w.thr + 0.3, s);
      const vy = (w.vi === 0 ? -0.75 : -0.62) + lift * 0.45;
      const vz = w.vi === 0 ? -0.8 : 1.05;
      const fromY = vy, toY = lift + cellH + 0.25;
      dummy.position.set(w.x + Math.sin(t * 0.4 + w.ph) * 0.15, lerp(fromY, toY, p) + Math.sin(t * 1.3 + w.ph) * 0.03, lerp(vz, w.z, p));
      const vis = smoothstep(w.thr - 0.05, w.thr + 0.05, s);
      dummy.scale.setScalar(w.size * vis);
      dummy.rotation.set(t * 0.2 + w.ph, t * 0.3, 0);
      dummy.updateMatrix();
      wbc.setMatrixAt(i, dummy.matrix);
      if (!wl && p > 0.5 && p < 0.97) wl = dummy.position.clone();
    }
    wbc.instanceMatrix.needsUpdate = true;
    if (wl) lblWbc.position.copy(wl);
    else lblWbc.position.set(wSeeds[0].x, lift + cellH + 0.2, wSeeds[0].z);

    // Cytokine signals flow from infected cells down to the vessels.
    const pos = signals.geometry.attributes.position.array;
    const alp = signals.geometry.attributes.aAlpha.array;
    const sigOn = smoothstep(0.35, 0.6, s) * (1 - smoothstep(0.95, 1, s) * 0.3);
    for (let i = 0; i < SIG; i++) {
      const sd = sigSeeds[i];
      const c = cellInfo[sd.c];
      const f = (sd.ph + t * 0.25) % 1;
      const vy = (sd.vz < 0 ? -0.75 : -0.62) + lift * 0.45;
      pos[i * 3] = c.x + Math.sin(f * 6 + i) * 0.08;
      pos[i * 3 + 1] = lerp(lift + cellH * 0.5, vy, f);
      pos[i * 3 + 2] = lerp(c.z, sd.vz, f * f);
      alp[i] = Math.sin(f * Math.PI) * sigOn;
    }
    signals.geometry.attributes.position.needsUpdate = true;
    signals.geometry.attributes.aAlpha.needsUpdate = true;
  }

  update(0, 0, 0);

  return {
    root,
    update,
    labels,
    env: {
      background: ['#24121a', '#070405', '#5a2430'],
      exposure: 0.95,
      envIntensity: 0.35,
      bloom: { strength: 0.12, threshold: 0.98, radius: 0.4 },
      lights: { hemi: 0.35, sky: '#ffe9e4', ground: '#3a1414', key: 2.2, keyPos: [3, 9, 6], shadowSize: 6.5, rim: 0.9, rimColor: '#a5c8ff', rimPos: [-6, 4, -7], fill: 1.5, fillColor: '#ff8a7a', fillPos: [0, -0.5, 4], head: 0.25 },
    },
    controls: { minDistance: 2, maxDistance: 22 },
    views: {
      overview: { pos: [6.2, 4.2, 8.4], target: [0, 0.1, 0] },
      close: { pos: [1.6, 2.1, 3.6], target: [0.4, 0.75, 0.6] },
      vessel: { pos: [-3.2, 0.9, 5.6], target: [-0.8, -0.2, 0.6] },
      wide: { pos: [8.5, 6.2, 11.5], target: [0, -0.2, 0] },
    },
  };
}
