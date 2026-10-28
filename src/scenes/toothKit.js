import * as THREE from 'three';
import { surfaceNets, cutByPlane, sdf } from '../engine/shapes.js';
import { tissue } from '../engine/materials.js';
import { smoothstep } from '../engine/noise.js';

// Shared lower-molar model, cut in half (cut plane z = 0, viewer on the +z side),
// with enamel, dentin and pulp layers plus gum and jaw bone around it.

const { smin, smax, sphere, roundBox, roundCone } = sdf;

export function toothSDF(x, y, z) {
  // Crown: four cusps on a rounded body.
  let d = roundBox(x, y, z, 0, 0.42, 0, 0.5, 0.36, 0.43, 0.24);
  for (const [cx, cz] of [[-0.25, -0.2], [0.25, -0.2], [-0.25, 0.2], [0.25, 0.2]]) d = smin(d, sphere(x, y, z, cx, 0.72, cz, 0.3), 0.2);
  // Neck narrows toward the root trunk.
  d = smin(d, roundCone(x, y, z, 0, 0.15, 0, 0, -0.38, 0, 0.4, 0.33), 0.16);
  // Two roots (wider front-to-back than side-to-side), gently curved.
  const zr = z / 1.45;
  for (const sgn of [-1, 1]) {
    const a = roundCone(x, y, zr, sgn * 0.2, -0.25, 0, sgn * 0.3, -1.1, 0, 0.22, 0.15);
    const b = roundCone(x, y, zr, sgn * 0.3, -1.1, 0, sgn * 0.22, -1.9, 0, 0.15, 0.05);
    d = smin(d, smin(a, b, 0.08), 0.1);
  }
  return d;
}

const enamelThick = (y) => smoothstep(-0.02, 0.22, y) * (0.08 + 0.09 * smoothstep(0.3, 0.9, y)) + 0.028;

export function dentinSDF(x, y, z) {
  return toothSDF(x, y, z) + enamelThick(y);
}

export function pulpSDF(x, y, z) {
  let d = roundBox(x, y, z, 0, 0.36, 0, 0.24, 0.12, 0.19, 0.1);
  for (const [cx, cz] of [[-0.2, -0.13], [0.2, -0.13], [-0.2, 0.13], [0.2, 0.13]]) d = smin(d, sphere(x, y, z, cx, 0.53, cz, 0.06), 0.1);
  const zr = z / 1.2;
  for (const sgn of [-1, 1]) {
    const a = roundCone(x, y, zr, sgn * 0.17, 0.3, 0, sgn * 0.29, -1.05, 0, 0.09, 0.055);
    const b = roundCone(x, y, zr, sgn * 0.29, -1.05, 0, sgn * 0.22, -1.82, 0, 0.055, 0.02);
    d = smin(d, smin(a, b, 0.05), 0.08);
  }
  return d;
}

const BONE_TOP = -0.22;
export function boneSDF(x, y, z) {
  let d = roundBox(x, y, z, 0, -1.32, 0, 1.25, 1.1, 0.95, 0.18);
  d = smax(d, -(toothSDF(x, y, z) - 0.035), 0.02);
  return d;
}
export function gumSDF(x, y, z) {
  const near = Math.max(0, 1 - Math.hypot(x / 0.9, z / 0.7));
  const topY = 0.02 + near * 0.12;
  let d = roundBox(x, y, z, 0, -0.55, 0, 1.32, 0.6, 1.02, 0.22);
  d = smax(d, y - topY, 0.12);
  d = smax(d, -(toothSDF(x, y, z) - 0.012), 0.02);
  d = smax(d, -boneSDF(x, y, z), 0.01);
  return d;
}
export { BONE_TOP };

/** Polygonise an SDF, then slice it exactly at z = offset (keeping z <= offset) and cap it (aCut = 1 on the cap). */
export function halfMesh(fn, offset, bounds, res) {
  return cutByPlane(surfaceNets(fn, bounds[0], bounds[1], res), 'z', offset, true);
}

/**
 * Layer material: surface colour vs. cut-face colour, an optional spherical "cavity"
 * carved in the vertex shader (decay), and a brown stain around it.
 */
export function layerMaterial({ surface, cut, cutPattern = '', roughness = 0.3, eps = 0, uniforms, extraColor = '', emissiveGLSL = '', clearcoat = 0.8, carve = 'push' }) {
  const m = tissue({ color: '#ffffff', sheen: '#ffffff', roughness, clearcoat, clearcoatRoughness: 0.15, normal: null, sheenAmount: 0.3 });
  const own = { uSurf: { value: new THREE.Color(surface) }, uCutC: { value: new THREE.Color(cut) }, uEps: { value: eps } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, own);
    const decl = `uniform vec3 uCavC; uniform float uCavR; uniform float uStain; uniform float uChalk; uniform float uTime; uniform float uPain; uniform vec3 uSurf; uniform vec3 uCutC; uniform float uEps;
      varying float vCut; varying vec3 vP; varying float vCarved;`;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${decl}\nattribute float aCut;`)
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal = vec3(normal);
        vec3 cP = position;
        vCarved = 0.0;
        float R = uCavR * (1.0 + uEps);
        vec3 dC = position - uCavC;
        float L = length(dC);
        if (${carve === 'push' ? 'true' : 'false'} && uCavR > 0.001 && L < R) {
          // Push the surface inward (against its normal) until it meets the ball's far side:
          // this turns the ball into a hollow pit instead of a bump.
          vec3 nn = normalize(normal);
          float dn = dot(dC, nn);
          float tt = dn + sqrt(max(dn * dn - L * L + R * R, 0.0));
          cP = position - nn * tt;
          objectNormal = -normalize(cP - uCavC);
          vCarved = 1.0;
        }
        vCut = aCut;
        vP = cP;
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = cP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${decl}
        float th(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        float tn(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(th(i),th(i+vec3(1,0,0)),f.x),mix(th(i+vec3(0,1,0)),th(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(th(i+vec3(0,0,1)),th(i+vec3(1,0,1)),f.x),mix(th(i+vec3(0,1,1)),th(i+vec3(1,1,1)),f.x),f.y),f.z); }`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float isCut = smoothstep(0.5, 0.9, vCut) * (1.0 - vCarved);
        vec3 base = mix(uSurf, uCutC, isCut);
        ${cutPattern}
        diffuseColor.rgb = base;
        ${carve === 'discard' ? 'if (uCavR > 0.001 && distance(vP, uCavC) < uCavR * (1.0 + uEps)) discard;' : ''}
        ${extraColor}
        float dd = distance(vP, uCavC);
        float Rr = max(uCavR, 0.0001);
        float stain = (1.0 - smoothstep(Rr, Rr * 1.7 + 0.07, dd)) * uStain;
        float n = tn(vP * 28.0);
        vec3 brown = mix(vec3(0.36, 0.22, 0.1), vec3(0.16, 0.09, 0.04), smoothstep(Rr * 1.15, Rr * 0.95, dd));
        float decayMask = clamp(stain * (0.75 + 0.25 * n) + vCarved * uStain, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, brown, decayMask);
        float chalk = (1.0 - smoothstep(0.08, 0.26, dd)) * uChalk * (1.0 - vCarved);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.98, 0.97, 0.94), chalk * 0.85);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.62, smoothstep(0.5, 0.9, vCut));
        roughnessFactor = mix(roughnessFactor, 0.9, clamp(vCarved + (1.0 - smoothstep(max(uCavR,0.0001), max(uCavR,0.0001) * 1.5 + 0.05, distance(vP, uCavC))) * uStain, 0.0, 1.0));`
      )
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${emissiveGLSL}`)
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        // Decayed tissue is dull: no glossy coat or sheen.
        #ifdef USE_CLEARCOAT
          material.clearcoat *= 1.0 - decayMask;
        #endif
        #ifdef USE_SHEEN
          material.sheenColor *= 1.0 - decayMask;
        #endif`
      );
  };
  m.customProgramCacheKey = () => `tooth-${surface}-${cut}-${eps}-${carve}`;
  return m;
}

export function makeToothUniforms() {
  return {
    uCavC: { value: new THREE.Vector3(0, 0.9, 0) },
    uCavR: { value: 0 },
    uStain: { value: 0 },
    uChalk: { value: 0 },
    uTime: { value: 0 },
    uPain: { value: 0 },
    uCrest: { value: BONE_TOP },
    uPocket: { value: 0 },
    uRecede: { value: 0 },
    uInflame: { value: 0 },
  };
}

const TB = [[-0.72, -2.08, -0.62], [0.72, 1.12, 0.06]];
export function buildTooth(U, res = 140) {
  const group = new THREE.Group();
  const outer = new THREE.Mesh(
    halfMesh(toothSDF, 0, TB, res),
    layerMaterial({
      surface: '#f1ede4', cut: '#f2f5f9', uniforms: U, eps: 0, roughness: 0.2, clearcoat: 1,
      cutPattern: `
        float yy = vP.y;
        base = mix(mix(vec3(0.86, 0.78, 0.62), uSurf, smoothstep(-0.02, 0.06, yy)), mix(vec3(0.9, 0.84, 0.7), uCutC, smoothstep(-0.02, 0.06, yy)), isCut);
        base *= 0.96 + 0.04 * tn(vP * 60.0);`,
    })
  );
  const dentin = new THREE.Mesh(
    halfMesh(dentinSDF, 0.004, TB, res),
    layerMaterial({ surface: '#e6c98c', cut: '#ecd096', uniforms: U, eps: 0.0, roughness: 0.4, carve: 'discard', cutPattern: 'base *= 0.975 + 0.025 * sin(atan(vP.y - 0.4, vP.x) * 120.0);' })
  );
  const pulp = new THREE.Mesh(
    halfMesh(pulpSDF, 0.008, TB, res),
    layerMaterial({
      surface: '#d44a4a', cut: '#e0706c', uniforms: U, eps: 0.0, roughness: 0.35, carve: 'discard',
      cutPattern: 'base = mix(base, vec3(0.78, 0.2, 0.22), smoothstep(0.6, 0.85, tn(vP * 26.0)) * isCut * 0.6);',
      emissiveGLSL: 'totalEmissiveRadiance += vec3(1.0, 0.12, 0.08) * uPain * (0.6 + 0.4 * sin(uTime * 7.0));',
    })
  );
  for (const m of [outer, dentin, pulp]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return { group, outer, dentin, pulp };
}

const GB = [[-1.4, -2.55, -1.1], [1.4, 0.32, 0.06]];
export function buildGumBone(U0, { gumRes = 96, boneRes = 96 } = {}) {
  // Gum and bone never show decay, so they get their own zeroed cavity uniforms.
  const U = { ...U0, uCavR: { value: 0 }, uStain: { value: 0 }, uChalk: { value: 0 } };
  const boneGeo = halfMesh(boneSDF, 0, GB, boneRes);
  const gumGeo = halfMesh(gumSDF, 0.002, GB, gumRes);
  // For the gum: how far each vertex is from the tooth and which way is "away".
  const p = gumGeo.attributes.position;
  const dist = new Float32Array(p.count), away = new Float32Array(p.count * 3);
  const e = 0.01;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    dist[i] = toothSDF(x, y, z);
    let gx = toothSDF(x + e, y, z) - toothSDF(x - e, y, z);
    let gz = toothSDF(x, y, z + e) - toothSDF(x, y, z - e);
    const l = Math.hypot(gx, gz) || 1;
    away[i * 3] = gx / l;
    away[i * 3 + 2] = gz / l;
  }
  gumGeo.setAttribute('aDist', new THREE.BufferAttribute(dist, 1));
  gumGeo.setAttribute('aAway', new THREE.BufferAttribute(away, 3));

  const boneMat = layerMaterial({
    surface: '#cdbb9a', cut: '#d6c09a', uniforms: U, roughness: 0.6, clearcoat: 0.15,
    cutPattern: 'base *= mix(0.9, 1.03, smoothstep(0.3, 0.7, tn(vP * 34.0)));',
  });
  const bonePatch = boneMat.onBeforeCompile;
  boneMat.onBeforeCompile = (sh) => {
    bonePatch(sh);
    sh.uniforms.uCrest = U.uCrest;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uCrest;')
      .replace('vec3 transformed = cP;', `vec3 transformed = cP;
        float crestN = uCrest + 0.03 * sin(position.x * 9.0) * sin(position.z * 7.0);
        if (transformed.y > crestN) transformed.y = crestN;`);
  };
  boneMat.customProgramCacheKey = () => 'tooth-bone';
  const gumMat = layerMaterial({
    surface: '#de7f84', cut: '#e8999a', uniforms: U, roughness: 0.32, clearcoat: 0.8,
    extraColor: 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.2, 0.22), uInflame * (0.55 + 0.45 * smoothstep(-0.6, 0.1, vP.y)));',
  });
  const gumPatch = gumMat.onBeforeCompile;
  gumMat.onBeforeCompile = (sh) => {
    gumPatch(sh);
    Object.assign(sh.uniforms, { uCrest: U.uCrest, uPocket: U.uPocket, uRecede: U.uRecede, uInflame: U.uInflame });
    const decl = 'uniform float uCrest; uniform float uPocket; uniform float uRecede; uniform float uInflame;';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${decl}\nattribute float aDist; attribute vec3 aAway;`)
      .replace('vec3 transformed = cP;', `vec3 transformed = cP;
        float b0 = ${BONE_TOP.toFixed(3)}, bot = -1.17, top = 0.16;
        float yy = transformed.y;
        float ny = yy < b0 ? mix(bot, uCrest, (yy - bot) / (b0 - bot)) : mix(uCrest, top - uRecede, (yy - b0) / (top - b0));
        if (yy > bot) transformed.y = ny;
        float nearT = 1.0 - smoothstep(0.0, 0.32, aDist);
        float above = smoothstep(uCrest - 0.02, uCrest + 0.12, transformed.y);
        transformed += aAway * uPocket * nearT * above;
        transformed += normal * uInflame * 0.035 * (1.0 - smoothstep(0.5, 0.0, transformed.y + 0.5));`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${decl}`);
  };
  gumMat.customProgramCacheKey = () => 'tooth-gum';
  const bone = new THREE.Mesh(boneGeo, boneMat);
  const gum = new THREE.Mesh(gumGeo, gumMat);
  for (const m of [bone, gum]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  return { bone, gum };
}

/** Find the top surface height of the tooth above (x, z) by marching down. */
export function toothTop(x, z) {
  let y = 1.3;
  for (let i = 0; i < 200 && y > -2; i++) {
    const d = toothSDF(x, y, z);
    if (d < 0.0005) return y;
    y -= Math.max(d * 0.8, 0.002);
  }
  return y;
}
