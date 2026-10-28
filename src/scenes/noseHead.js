import * as THREE from 'three';
import { tissue, glowMaterial } from '../engine/materials.js';
import { surfaceNets, sdf, smoothSphere, displace } from '../engine/shapes.js';
import { noise, smoothstep, lerp } from '../engine/noise.js';

// A head cut down the middle (viewer on the +x side) that shows the nasal cavity,
// its turbinates, the mouth and throat — plus a marker for the patch of lining the
// close-up simulation shows.

const { ellipsoid, roundCone, roundBox, smin, smax } = sdf;

function outerSDF(x, y, z) {
  let d = ellipsoid(x, y, z, 0, 0.35, -0.1, 0.75, 0.82, 0.95);
  d = smin(d, ellipsoid(x, y, z, 0, -0.3, 0.32, 0.6, 0.72, 0.62), 0.3);
  d = smin(d, roundCone(x, y, z, 0, 0.1, 0.8, 0, -0.32, 1.02, 0.07, 0.14), 0.12);
  d = smin(d, ellipsoid(x, y, z, 0, -0.86, 0.48, 0.42, 0.3, 0.36), 0.25);
  d = smin(d, roundCone(x, y, z, 0, -0.85, -0.2, 0, -1.7, -0.25, 0.38, 0.4), 0.3);
  return Math.max(d, -1.62 - y);
}

function cavitySDF(x, y, z) {
  // Nasal cavity: tall and tapered, wider at the floor than at the roof.
  let d = ellipsoid(x, y, z, -0.1, -0.12, 0.45, 0.2, 0.29, 0.53);
  d = smin(d, roundBox(x, y, z, -0.1, -0.3, 0.45, 0.17, 0.08, 0.44, 0.07), 0.12);
  d = smin(d, roundCone(x, y, z, -0.1, -0.3, 0.86, -0.06, -0.44, 1.12, 0.06, 0.05), 0.06); // nostril
  d = smin(d, roundCone(x, y, z, -0.1, -0.15, -0.02, -0.1, -1.7, -0.06, 0.13, 0.11), 0.1); // throat
  d = smin(d, ellipsoid(x, y, z, -0.1, -0.62, 0.45, 0.3, 0.1, 0.38), 0.08); // mouth
  return d;
}

const headSDF = (x, y, z) => Math.max(smax(outerSDF(x, y, z), -cavitySDF(x, y, z), 0.04), x);

export function buildNoseHead() {
  const group = new THREE.Group();
  const geo = surfaceNets(headSDF, [-0.9, -1.72, -1.1], [0.02, 1.22, 1.28], 124);
  // Tag each vertex: 0 = skin, 1 = cut face, 2 = airway lining.
  const p = geo.attributes.position, n = geo.attributes.normal;
  const kind = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (Math.abs(x) < 0.004 && n.getX(i) > 0.8) kind[i] = 1;
    else kind[i] = Math.abs(cavitySDF(x, y, z)) < Math.abs(outerSDF(x, y, z)) ? 2 : 0;
  }
  geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));

  const U = { uSwell: { value: 0 } };
  const mat = tissue({ color: '#ffffff', sheen: '#ffd8cc', roughness: 0.45, clearcoat: 0.35, normal: null, sheenAmount: 0.4 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSwell = U.uSwell;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aKind; varying float vKind; varying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKind = aKind; vObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vKind; varying vec3 vObj; uniform float uSwell;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 col = vec3(0.90, 0.69, 0.59);
        if (vKind > 1.5) {
          col = mix(vec3(0.86, 0.46, 0.45), vec3(0.80, 0.24, 0.26), uSwell);
        } else if (vKind > 0.5) {
          float y = vObj.y, z = vObj.z;
          vec3 bone = vec3(0.94, 0.89, 0.78);
          col = vec3(0.89, 0.6, 0.54);
          float es = length(vec2((y - 0.38) / 0.75, (z + 0.1) / 0.92));
          float eb = length(vec2((y - 0.38) / 0.66, (z + 0.1) / 0.83));
          if (es < 1.0) col = bone;
          if (eb < 1.0) col = vec3(0.88, 0.7, 0.67) * (0.95 + 0.05 * sin(y * 48.0 + sin(z * 31.0) * 2.6));
          if (z > -0.5 && z < -0.31 && y < -0.42 && y > -1.62) col = fract(y * 7.0) < 0.8 ? bone : vec3(0.86, 0.74, 0.7);
          if (y > -0.48 && y < -0.42 && z > 0.06 && z < 0.82) col = bone;
          if (length(vec2((y + 0.76) / 0.13, (z - 0.36) / 0.33)) < 1.0) col = vec3(0.84, 0.4, 0.42);
        }
        diffuseColor.rgb = col;`
      );
  };
  mat.customProgramCacheKey = () => 'nose-head';
  const head = new THREE.Mesh(geo, mat);
  group.add(head);

  // Turbinates: three curled shelves on the side wall. They swell during a cold.
  const turbMat = tissue({ color: '#dc7472', sheen: '#ffc6bd', roughness: 0.32, clearcoat: 0.8, normal: null });
  const turbs = [
    { c: [-0.25, 0.06, 0.34], r: [0.07, 0.04, 0.2] },
    { c: [-0.24, -0.08, 0.44], r: [0.085, 0.05, 0.3] },
    { c: [-0.23, -0.25, 0.48], r: [0.1, 0.06, 0.38] },
  ].map((t, k) => {
    const g = smoothSphere(4);
    displace(g, (x, y, z) => noise.noise3(x * 3 + k, y * 3, z * 3) * 0.08);
    const m = new THREE.Mesh(g, turbMat);
    m.position.fromArray(t.c);
    m.scale.fromArray(t.r);
    group.add(m);
    return { m, base: t };
  });
  const inferior = turbs[2];

  // "You are here": a glowing square on the lowest turbinate.
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.092, 4, 1).rotateZ(Math.PI / 4).rotateY(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#7fe7ff', side: THREE.DoubleSide, transparent: true, depthWrite: false })
  );
  const glow = new THREE.Sprite(glowMaterial('#5fd8ff', 0.5));
  glow.scale.setScalar(0.42);
  group.add(marker, glow);

  // A runny-nose drip when sick.
  const drip = new THREE.Mesh(smoothSphere(3), new THREE.MeshPhysicalMaterial({ color: '#eef0c8', roughness: 0.1, transmission: 0.6, thickness: 0.1, clearcoat: 1 }));
  drip.position.set(-0.06, -0.5, 1.1);
  group.add(drip);

  const markerAnchor = new THREE.Object3D();
  group.add(markerAnchor);

  function update(t, s) {
    const swell = smoothstep(0.35, 0.9, s);
    U.uSwell.value = swell;
    turbMat.color.set('#dc7472').lerp(new THREE.Color('#c23a3a'), swell);
    for (const { m, base } of turbs) m.scale.set(base.r[0] * (1 + swell * 0.45), base.r[1] * (1 + swell * 0.6), base.r[2] * (1 + swell * 0.08));
    const mx = inferior.base.c[0] + inferior.base.r[0] * (1 + swell * 0.45) + 0.01;
    marker.position.set(mx, inferior.base.c[1], inferior.base.c[2]);
    glow.position.copy(marker.position);
    glow.material.opacity = 0.35 + 0.25 * Math.sin(t * 3);
    markerAnchor.position.copy(marker.position).add(new THREE.Vector3(0, 0.09, 0));
    const d = smoothstep(0.75, 1, s);
    drip.scale.set(0.045 * d, (0.09 + 0.03 * Math.sin(t * 2)) * d + 0.0001, 0.045 * d);
  }
  update(0, 0);

  return { group, update, markerAnchor };
}
