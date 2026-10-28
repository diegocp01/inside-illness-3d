import * as THREE from 'three';

/*
 * GPU-shaped tubes (vessels, airways, the oesophagus...).
 * The geometry only stores (theta, u, side, s); the vertex shader builds the real
 * position from per-layer radius functions written in GLSL, so walls can pulse,
 * swell, fold or narrow every frame for free.
 *
 * side: 0 inner wall, 1 outer wall, 2 cut face at thetaStart, 3 cut face at thetaEnd,
 *       4 ring at u = 0, 5 ring at u = 1.
 */
export function tubeGeometry({
  radial = 128,
  lengthSegs = 160,
  thetaStart = 0,
  thetaLength = Math.PI * 2,
  wallSegs = 4,
  uvRepeat = [6, 3],
} = {}) {
  const full = thetaLength >= Math.PI * 2 - 1e-4;
  const pos = [];
  const at = [];
  const uv = [];
  const index = [];
  function grid(nu, nv, map, flip) {
    const base = pos.length / 3;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const r = map(i / nu, j / nv);
        pos.push(0, 0, 0);
        at.push(r[0], r[1], r[2], r[3]);
        uv.push(r[4], r[5]);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
        if (flip) index.push(a, c, b, b, c, d);
        else index.push(a, b, c, b, d, c);
      }
    }
  }
  const th = (v) => thetaStart + v * thetaLength;
  const tr = thetaLength / (Math.PI * 2);
  // inner wall: faces the axis
  grid(lengthSegs, radial, (u, v) => [th(v), u, 0, 0, u * uvRepeat[0], v * uvRepeat[1] * tr], false);
  // outer wall
  grid(lengthSegs, radial, (u, v) => [th(v), u, 1, 1, u * uvRepeat[0], v * uvRepeat[1] * tr], true);
  if (!full) {
    grid(lengthSegs, wallSegs, (u, s) => [thetaStart, u, 2, s, u * uvRepeat[0], s], true);
    grid(lengthSegs, wallSegs, (u, s) => [thetaStart + thetaLength, u, 3, s, u * uvRepeat[0], s], false);
  }
  grid(radial, wallSegs, (v, s) => [th(v), 0, 4, s, v, s], false);
  grid(radial, wallSegs, (v, s) => [th(v), 1, 5, s, v, s], true);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 4));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

let keySeq = 0;

/**
 * Patch a MeshPhysicalMaterial so it renders a tube layer.
 * radiusGLSL must define: float rIn(float th, float u) and float rOut(float th, float u).
 * colorGLSL (optional) runs after <color_fragment>; it can read vSide, vS, vTU, vWorld, uSick, uTime.
 * fragGLSL (optional) declares helper functions for the fragment stage.
 * emissiveGLSL (optional) runs after <emissivemap_fragment>.
 */
export function tubeMaterial(material, { uniforms, length, radiusGLSL, colorGLSL = '', emissiveGLSL = '', cutColor = '#ffffff', bendGLSL = '', fragGLSL = '' }) {
  const key = `tube-${keySeq++}`;
  material.userData.tubeUniforms = uniforms;
  const own = { uLength: { value: length }, uCutColor: { value: new THREE.Color(cutColor) } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, own);
    const uniformDecl = Object.keys(uniforms)
      .map((k) => {
        const v = uniforms[k].value;
        const t = typeof v === 'number' ? 'float' : v.isColor ? 'vec3' : v.isVector3 ? 'vec3' : v.isVector2 ? 'vec2' : v.isVector4 ? 'vec4' : 'float';
        return `uniform ${t} ${k};`;
      })
      .join('\n');
    const header = `
      ${uniformDecl}
      uniform float uLength;
      uniform vec3 uCutColor;
      varying float vSide;
      varying float vS;
      varying vec2 vTU;
      varying vec3 vWorld;
    `;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        ${header}
        attribute vec4 aT;
        ${radiusGLSL}
        vec3 tubeP(float th, float u, float r) {
          vec3 p = vec3((u - 0.5) * uLength, cos(th) * r, sin(th) * r);
          ${bendGLSL}
          return p;
        }`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `float tbTh = aT.x; float tbU = aT.y; float tbSide = aT.z; float tbS = aT.w;
        float tbRi = rIn(tbTh, tbU); float tbRo = rOut(tbTh, tbU);
        float tbR = tbSide < 0.5 ? tbRi : (tbSide < 1.5 ? tbRo : mix(tbRi, tbRo, tbS));
        vec3 tbP = tubeP(tbTh, tbU, tbR);
        vec3 objectNormal;
        if (tbSide < 1.5) {
          float e = 0.003;
          float r1 = tbSide < 0.5 ? rIn(tbTh + e, tbU) : rOut(tbTh + e, tbU);
          float r2 = tbSide < 0.5 ? rIn(tbTh, tbU + e) : rOut(tbTh, tbU + e);
          vec3 dT = tubeP(tbTh + e, tbU, r1) - tbP;
          vec3 dU = tubeP(tbTh, tbU + e, r2) - tbP;
          objectNormal = normalize(cross(dU, dT));
          if (tbSide > 0.5) objectNormal = -objectNormal;
        } else if (tbSide < 3.5) {
          float e = 0.003;
          vec3 a = tubeP(tbTh, tbU, tbR);
          vec3 b = tubeP(tbTh, tbU + e, tbR);
          vec3 c = tubeP(tbTh, tbU, tbR + e);
          objectNormal = normalize(cross(b - a, c - a));
          if (tbSide < 2.5) objectNormal = -objectNormal;
        } else {
          float e = 0.003;
          float uu = tbSide < 4.5 ? 0.0 : 1.0;
          vec3 a = tubeP(tbTh, uu, tbR);
          vec3 b = tubeP(tbTh, uu + e, tbR);
          objectNormal = normalize(b - a) * (tbSide < 4.5 ? -1.0 : 1.0);
        }
        vSide = tbSide; vS = tbS; vTU = vec2(tbTh, tbU);
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = tbP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${header}\n${fragGLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        bool isCut = vSide > 1.5;
        if (isCut) diffuseColor.rgb = uCutColor;
        ${colorGLSL}`
      )
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${emissiveGLSL}`);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

/** Convenience: build one tube layer mesh. */
export function tubeLayer(opts) {
  const geo = tubeGeometry(opts.geometry || {});
  const mat = tubeMaterial(opts.material, opts);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return mesh;
}
