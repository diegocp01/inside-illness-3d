import * as THREE from 'three';
import { tissue } from '../engine/materials.js';
import { redCellGeometry, mergeGeometries, displace } from '../engine/shapes.js';
import { tubeLayer } from '../engine/tube.js';
import { noise, rng, smoothstep, lerp, clamp } from '../engine/noise.js';

// Type 2 diabetes: insulin keys, receptor locks and GLUT4 doors on a body cell next to a blood vessel.
export default function build() {
  const root = new THREE.Group();
  const r = rng(61);
  const CR = 6, CY = -6.3; // body cell sphere
  const surfY = (x, z) => CY + Math.sqrt(Math.max(0, CR * CR - x * x - z * z));
  const normalAt = (x, z, out) => out.set(x, surfY(x, z) - CY, z).normalize();

  // ---------- Body cell ----------
  const cellGeo = new THREE.SphereGeometry(CR, 220, 110, 0, Math.PI * 2, 0, 0.95);
  displace(cellGeo, (x, y, z) => noise.noise3(x * 0.8, y * 0.8, z * 0.8) * 0.05);
  const cellMat = tissue({ color: '#f0a582', sheen: '#ffd9c2', roughness: 0.32, clearcoat: 0.8, normal: 'cells', normalScale: 0.5, repeat: [10, 4], emissive: '#ff7a2a', emissiveIntensity: 0 });
  const cell = new THREE.Mesh(cellGeo, cellMat);
  cell.position.y = CY;
  cell.receiveShadow = true;
  root.add(cell);

  // ---------- Blood vessel ----------
  const VL = 14, VR = 1.05, VY = 2.5;
  const U = { uTime: { value: 0 }, uSick: { value: 0 } };
  const vessel = tubeLayer({
    geometry: { radial: 120, lengthSegs: 120, thetaStart: Math.PI / 2 + 1.0, thetaLength: Math.PI * 2 - 2.0, wallSegs: 4, uvRepeat: [8, 3] },
    material: tissue({ color: '#c0463f', sheen: '#ff9a8a', roughness: 0.3, clearcoat: 0.9, normal: 'cells', normalScale: 0.3 }),
    uniforms: U,
    length: VL,
    cutColor: '#e8a294',
    radiusGLSL: `float rIn(float th, float u) { return ${VR.toFixed(2)} + 0.01 * sin(uTime * 6.0 - u * 20.0); } float rOut(float th, float u) { return rIn(th, u) + 0.12; }`,
    colorGLSL: 'if (isCut) diffuseColor.rgb = mix(vec3(0.97,0.8,0.76), vec3(0.8,0.36,0.34), smoothstep(0.1,0.4,vS));',
  });
  vessel.position.y = VY;
  root.add(vessel);
  const RN = 90;
  const rbc = new THREE.InstancedMesh(redCellGeometry(24), tissue({ color: '#b3101e', sheen: '#ff8a80', roughness: 0.3, clearcoat: 0.8, normal: null }), RN);
  const rSeeds = Array.from({ length: RN }, () => ({ x: (r() - 0.5) * VL, rr: Math.sqrt(r()) * 0.75, a: r() * 6.28, rot: r() * 6 }));
  root.add(rbc);

  // ---------- Receptors (locks) and GLUT4 doors ----------
  const recGeo = (() => {
    const stem = new THREE.CylinderGeometry(0.045, 0.06, 0.42, 10).translate(0, 0.21, 0);
    const armL = new THREE.CylinderGeometry(0.035, 0.04, 0.3, 10).translate(0, 0.15, 0).rotateZ(0.55).translate(0, 0.4, 0);
    const armR = new THREE.CylinderGeometry(0.035, 0.04, 0.3, 10).translate(0, 0.15, 0).rotateZ(-0.55).translate(0, 0.4, 0);
    const cupL = new THREE.SphereGeometry(0.07, 14, 10).translate(-0.16, 0.65, 0);
    const cupR = new THREE.SphereGeometry(0.07, 14, 10).translate(0.16, 0.65, 0);
    return mergeGeometries([stem, armL, armR, cupL, cupR]);
  })();
  const recMat = new THREE.MeshPhysicalMaterial({ color: '#9b7bf0', roughness: 0.3, clearcoat: 1, emissive: '#7c5cff', emissiveIntensity: 0 });
  const doorGeo = new THREE.TorusGeometry(0.17, 0.075, 16, 32).rotateX(Math.PI / 2).translate(0, 0.04, 0);
  const doorMat = new THREE.MeshPhysicalMaterial({ color: '#2fc6a0', roughness: 0.3, clearcoat: 1, emissive: '#1fe0a8', emissiveIntensity: 0.2 });
  const plugGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.08, 20).translate(0, 0.04, 0);
  const plugMat = new THREE.MeshPhysicalMaterial({ color: '#2a7f6a', roughness: 0.4 });

  const spots = [];
  for (let i = 0; i < 9; i++) {
    const x = -3.6 + i * 0.9 + (r() - 0.5) * 0.2;
    const z = (i % 2 ? 0.7 : -0.3) + (r() - 0.5) * 0.3;
    spots.push({ rec: [x, z], door: [x + 0.42, z + 0.42 * (i % 2 ? -1 : 1)], ph: r() * 6, open: 0, bound: 0 });
  }
  const recs = new THREE.InstancedMesh(recGeo, recMat, spots.length);
  const doors = new THREE.InstancedMesh(doorGeo, doorMat, spots.length);
  const plugs = new THREE.InstancedMesh(plugGeo, plugMat, spots.length);
  recs.castShadow = doors.castShadow = true;
  root.add(recs, doors, plugs);
  const up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3(), dummy = new THREE.Object3D();
  function placeOnCell(x, z, lift = 0) {
    normalAt(x, z, n);
    dummy.position.set(x, surfY(x, z), z).addScaledVector(n, lift);
    dummy.quaternion.setFromUnitVectors(up, n);
  }
  spots.forEach((sp, i) => {
    placeOnCell(sp.rec[0], sp.rec[1], -0.02);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    recs.setMatrixAt(i, dummy.matrix);
    placeOnCell(sp.door[0], sp.door[1], -0.03);
    dummy.updateMatrix();
    doors.setMatrixAt(i, dummy.matrix);
    sp.recTop = new THREE.Vector3().copy(dummy.position);
    placeOnCell(sp.rec[0], sp.rec[1], 0.68);
    sp.dock = dummy.position.clone();
    placeOnCell(sp.door[0], sp.door[1], 0.0);
    sp.doorPos = dummy.position.clone();
    sp.doorN = normalAt(sp.door[0], sp.door[1], new THREE.Vector3());
  });

  // ---------- Glucose (hexagon rings) ----------
  const GN = 280;
  const gluGeo = new THREE.TorusGeometry(0.075, 0.028, 6, 6);
  const glu = new THREE.InstancedMesh(gluGeo, new THREE.MeshPhysicalMaterial({ color: '#ffb52e', roughness: 0.25, clearcoat: 1, emissive: '#ff8a00', emissiveIntensity: 0.35 }), GN);
  const gs = Array.from({ length: GN }, (_, i) => ({ mode: 0, x: (r() - 0.5) * VL, rr: Math.sqrt(r()) * 0.8, a: r() * 6.28, timer: r() * 6, k: i / GN, p: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, spot: 0, rot: new THREE.Euler(r() * 6, r() * 6, r() * 6), wait: 0 }));
  root.add(glu);

  // ---------- Insulin (keys) ----------
  const keyGeo = (() => {
    const bow = new THREE.TorusGeometry(0.06, 0.022, 10, 20);
    const shaft = new THREE.BoxGeometry(0.035, 0.2, 0.03).translate(0, -0.15, 0);
    const t1 = new THREE.BoxGeometry(0.05, 0.025, 0.03).translate(0.035, -0.2, 0);
    const t2 = new THREE.BoxGeometry(0.04, 0.025, 0.03).translate(0.03, -0.24, 0);
    return mergeGeometries([bow, shaft, t1, t2].map((g) => { g.deleteAttribute('uv'); return g; }));
  })();
  const KN = 22;
  const keys = new THREE.InstancedMesh(keyGeo, new THREE.MeshPhysicalMaterial({ color: '#4aa8ff', roughness: 0.2, clearcoat: 1, metalness: 0.2, emissive: '#1a6dff', emissiveIntensity: 0.5 }), KN);
  const ks = Array.from({ length: KN }, (_, i) => ({ spot: i % spots.length, ph: r(), k: i / KN, rot: r() * 6 }));
  root.add(keys);

  // ---------- Labels ----------
  const lGlu = new THREE.Object3D(), lKey = new THREE.Object3D();
  root.add(lGlu, lKey);
  const s0 = spots[4];
  const labels = [
    { text: 'Sugar', parent: lGlu, when: (s) => s < 0.6 },
    { text: 'Too much sugar', parent: lGlu, when: (s) => s >= 0.6 },
    { text: 'Insulin', parent: lKey },
    { text: 'Lock', at: s0.dock.toArray(), side: 'left', when: (s) => s < 0.6 },
    { text: 'Stuck lock', at: s0.dock.toArray(), side: 'left', when: (s) => s >= 0.6 },
    { text: 'Door', at: s0.doorPos.toArray() },
  ];

  const tc = new THREE.Color();
  const vesselPoint = (x, rr, a, out) => out.set(x, VY + Math.cos(a) * rr * VR, Math.sin(a) * rr * VR);
  let absorbed = 0;

  function update(t, dt, s) {
    U.uTime.value = t;
    U.uSick.value = s;
    dt = Math.min(dt, 0.05);

    // Red cells drift through the vessel.
    for (let i = 0; i < RN; i++) {
      const c = rSeeds[i];
      c.x += dt * 0.8;
      if (c.x > VL / 2) c.x -= VL;
      vesselPoint(c.x, c.rr, c.a, dummy.position);
      dummy.rotation.set(c.rot + t * 0.5, c.rot, t * 0.3);
      dummy.scale.setScalar(0.15 * smoothstep(VL / 2, VL / 2 - 0.5, Math.abs(c.x)));
      dummy.updateMatrix();
      rbc.setMatrixAt(i, dummy.matrix);
    }
    rbc.instanceMatrix.needsUpdate = true;

    // Insulin keys dock onto receptors; receptors respond strongly when healthy, weakly when resistant.
    const response = lerp(1, 0.15, smoothstep(0.2, 0.9, s));
    const activeKeys = Math.round(lerp(10, KN, s));
    for (const sp of spots) sp.bound = 0;
    let keyLabelled = false;
    for (let i = 0; i < KN; i++) {
      const k = ks[i];
      const sp = spots[k.spot];
      const cyc = (k.ph + t * 0.09) % 1;
      const on = i < activeKeys ? 1 : 0;
      let pos;
      if (cyc < 0.45) {
        const f = smoothstep(0, 0.45, cyc);
        pos = new THREE.Vector3(sp.dock.x - 2.5 + f * 2.5, lerp(VY, sp.dock.y + 0.12, f), lerp(0, sp.dock.z, f));
        pos.y += Math.sin(f * Math.PI) * 0.3;
      } else if (cyc < 0.8) {
        pos = sp.dock.clone().add(new THREE.Vector3(0, 0.12, 0));
        sp.bound = Math.max(sp.bound, on);
      } else {
        const f = smoothstep(0.8, 1, cyc);
        pos = sp.dock.clone().add(new THREE.Vector3(f * 1.5, 0.12 + f * 1.8, 0));
      }
      dummy.position.copy(pos);
      dummy.rotation.set(0, cyc < 0.8 && cyc >= 0.45 ? 0 : k.rot + t, cyc < 0.8 && cyc >= 0.45 ? Math.PI : Math.PI + Math.sin(t + k.rot) * 0.4);
      const fade = smoothstep(0, 0.05, cyc) * (1 - smoothstep(0.95, 1, cyc));
      dummy.scale.setScalar(1.25 * on * fade);
      dummy.updateMatrix();
      keys.setMatrixAt(i, dummy.matrix);
      if (!keyLabelled && on && cyc > 0.1 && cyc < 0.4 && sp === spots[2]) { lKey.position.copy(pos); keyLabelled = true; }
    }
    if (!keyLabelled) lKey.position.copy(spots[2].dock).add(new THREE.Vector3(0, 0.3, 0));
    keys.instanceMatrix.needsUpdate = true;

    // Doors open when their lock is turned.
    let openSum = 0;
    spots.forEach((sp, i) => {
      const target = sp.bound * response * (0.8 + 0.2 * Math.sin(t * 2 + sp.ph));
      sp.open += (target - sp.open) * Math.min(1, dt * 3);
      openSum += sp.open;
      placeOnCell(sp.door[0], sp.door[1], 0.0);
      dummy.scale.set(1 - sp.open * 0.85, 1, 1 - sp.open * 0.85);
      dummy.updateMatrix();
      plugs.setMatrixAt(i, dummy.matrix);
    });
    plugs.instanceMatrix.needsUpdate = true;
    recMat.emissiveIntensity = 0.15 + 1.2 * response * (spots.reduce((a, b) => a + b.bound, 0) / spots.length);
    doorMat.emissiveIntensity = 0.15 + 1.2 * (openSum / spots.length);

    // Glucose: flows in the vessel, drifts down to a door, and enters only if the door is open.
    const active = Math.round(lerp(120, GN, s));
    absorbed *= Math.exp(-dt * 0.8);
    let gl = false;
    for (let i = 0; i < GN; i++) {
      const g = gs[i];
      const on = i < active;
      if (g.mode === 0) {
        g.x += dt * 0.9;
        if (g.x > VL / 2) g.x -= VL;
        vesselPoint(g.x, g.rr, g.a, g.p);
        g.timer -= dt;
        if (g.timer <= 0 && on && Math.abs(g.x) < 4.5) {
          g.mode = 1;
          g.spot = Math.floor(r() * spots.length);
          g.from.copy(g.p);
          const sp = spots[g.spot];
          g.to.copy(sp.doorPos).addScaledVector(sp.doorN, 0.35 + r() * 0.4);
          g.to.x += (r() - 0.5) * 0.5;
          g.to.z += (r() - 0.5) * 0.5;
          g.t = 0;
        }
      } else if (g.mode === 1) {
        g.t += dt / 2.6;
        const f = smoothstep(0, 1, g.t);
        g.p.copy(g.from).lerp(g.to, f);
        g.p.y += Math.sin(f * Math.PI) * 0.25;
        if (g.t >= 1) { g.mode = 2; g.wait = 0; }
      } else if (g.mode === 2) {
        const sp = spots[g.spot];
        g.wait += dt;
        g.p.x += Math.sin(t * 1.3 + i) * dt * 0.15;
        g.p.z += Math.cos(t * 1.1 + i) * dt * 0.15;
        if (sp.open > 0.55 && g.wait > 0.3) {
          g.mode = 3;
          g.t = 0;
          g.from.copy(g.p);
          g.to.copy(sp.doorPos).addScaledVector(sp.doorN, -0.45);
        } else if (g.wait > 2.5) {
          // try another door
          g.spot = Math.floor(r() * spots.length);
          const sp2 = spots[g.spot];
          g.from.copy(g.p);
          g.to.copy(sp2.doorPos).addScaledVector(sp2.doorN, 0.35 + r() * 0.5);
          g.mode = 1;
          g.t = 0;
        }
      } else if (g.mode === 3) {
        g.t += dt / 1.0;
        const f = smoothstep(0, 1, g.t);
        g.p.copy(g.from).lerp(g.to, f);
        if (g.t >= 1) {
          absorbed += 1;
          g.mode = 0;
          g.x = -VL / 2 + r() * 2;
          g.timer = 1 + r() * 5;
        }
      }
      dummy.position.copy(g.p);
      dummy.rotation.set(g.rot.x + t * 0.6, g.rot.y + t * 0.4, g.rot.z);
      let sc = on ? 1 : 0;
      if (g.mode === 0) sc *= smoothstep(VL / 2, VL / 2 - 0.5, Math.abs(g.x));
      if (g.mode === 3) sc *= 1 - smoothstep(0.6, 1, g.t);
      dummy.scale.setScalar(sc * 1.2);
      dummy.updateMatrix();
      glu.setMatrixAt(i, dummy.matrix);
      if (!gl && on && g.mode === 2 && Math.abs(g.p.x - 0.5) < 2) { lGlu.position.copy(g.p); gl = true; }
    }
    if (!gl) lGlu.position.set(1, VY, 0.4);
    glu.instanceMatrix.needsUpdate = true;

    // The cell glows warm when it is getting fuel.
    const fuel = clamp(absorbed / 6);
    cellMat.emissiveIntensity = 0.04 + fuel * 0.25;
    tc.set('#f0a582').lerp(new THREE.Color('#c99a8c'), s * 0.5);
    cellMat.color.copy(tc);
  }
  update(0, 0.016, 0);

  return {
    root,
    update,
    labels,
    env: {
      background: ['#1b1626', '#050409', '#3b2a55'],
      exposure: 1.0,
      envIntensity: 0.6,
      fog: { color: '#07060c', density: 0.025 },
      bloom: { strength: 0.4, threshold: 0.96, radius: 0.55 },
      lights: { hemi: 0.4, sky: '#f0eaff', ground: '#2a1520', key: 2.4, keyPos: [3, 9, 6], shadowSize: 7, rim: 1.8, rimColor: '#9fd0ff', rimPos: [-6, 3, -6], fill: 3, fillColor: '#ffb28a', fillPos: [0, 1, 4] },
    },
    controls: { minDistance: 1.5, maxDistance: 20 },
    views: {
      overview: { pos: [1.0, 3.6, 10.5], target: [0, 0.9, 0] },
      close: { pos: [1.6, 1.4, 4.2], target: [0.4, 0.1, 0.2] },
    },
  };
}
