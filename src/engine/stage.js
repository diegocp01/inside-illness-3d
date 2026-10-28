import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { easeInOut, clamp } from './noise.js';

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.012 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uGrain; uniform float uTime;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(d * vec2(1.1, 1.0)));
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      // Static grain: animated noise shimmers badly in screen recordings.
      c.rgb += (hash(floor(gl_FragCoord.xy)) - 0.5) * uGrain;
      gl_FragColor = c;
    }`,
};

export class Stage {
  constructor(host) {
    this.host = host;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envs = {
      studio: pmrem.fromScene(new RoomEnvironment(), 0.04).texture,
      body: pmrem.fromScene(bodyEnvironment(), 0.03).texture,
    };
    this.scene.environment = this.envs.body;
    this.scene.environmentIntensity = 0.8;

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.02, 400);
    this.camera.position.set(0, 1, 8);

    const controls = (this.controls = new OrbitControls(this.camera, renderer.domElement));
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.rotateSpeed = 0.7;
    controls.zoomSpeed = 0.8;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.addEventListener('start', () => {
      this.userInteracting = true;
      this.cancelFlight();
      this.lastInteraction = performance.now();
    });
    controls.addEventListener('end', () => {
      this.userInteracting = false;
      this.lastInteraction = performance.now();
    });

    // Lights
    this.hemi = new THREE.HemisphereLight('#ffffff', '#442222', 0.6);
    this.key = new THREE.DirectionalLight('#ffffff', 2.4);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 4;
    this.rim = new THREE.DirectionalLight('#9fc7ff', 1.2);
    this.fill = new THREE.PointLight('#ffb0a0', 0, 30, 1.5);
    // Soft "headlight" that follows the camera so cut faces never fall into darkness.
    this.head = new THREE.DirectionalLight('#fff6f0', 0.5);
    this.scene.add(this.hemi, this.key, this.key.target, this.rim, this.fill, this.head, this.head.target);

    // Gradient backdrop
    this.bgUniforms = {
      uTop: { value: new THREE.Color('#1a1d26') },
      uBottom: { value: new THREE.Color('#07080b') },
      uGlow: { value: new THREE.Color('#2a3350') },
    };
    const bg = new THREE.Mesh(
      new THREE.SphereGeometry(180, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.bgUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uGlow; varying vec3 vDir;
          void main(){
            float t = smoothstep(-0.6, 0.8, vDir.y);
            vec3 c = mix(uBottom, uTop, t);
            float g = pow(max(0.0, 1.0 - abs(vDir.y - 0.1)), 6.0);
            c += uGlow * g * 0.35;
            gl_FragColor = vec4(c, 1.0);
          }`,
      })
    );
    bg.renderOrder = -10;
    bg.frustumCulled = false;
    this.backdrop = bg;
    this.scene.add(bg);

    // Post-processing
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);

    // Labels
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer';
    host.appendChild(this.labelRenderer.domElement);
    this.labels = [];
    this.labelsVisible = true;

    this.active = null;
    this.sick = 0;
    this.sickTarget = 0;
    this.clock = new THREE.Clock();
    this.time = 0;
    this.flight = null;
    this.lastInteraction = 0;
    this.onFrame = null;

    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
    renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    // Keep framing comfortable on tall/narrow viewports.
    this.camera.zoom = w / h < 1 ? Math.max(0.62, w / h) : 1;
    this.camera.updateProjectionMatrix();
  }

  /** Mount a built scene object (see scenes/*). */
  mount(built) {
    if (this.active) {
      this.scene.remove(this.active.root);
      for (const l of this.labels) l.obj.parent?.remove(l.obj);
    }
    this.active = built;
    this.scene.add(built.root);
    const env = built.env || {};
    const bg = env.background || ['#1a1d26', '#07080b', '#2a3350'];
    this.bgUniforms.uTop.value.set(bg[0]);
    this.bgUniforms.uBottom.value.set(bg[1]);
    this.bgUniforms.uGlow.value.set(bg[2] || bg[0]);
    this.scene.fog = env.fog ? new THREE.FogExp2(env.fog.color, env.fog.density) : null;
    this.renderer.toneMappingExposure = env.exposure ?? 1;
    this.scene.environment = this.envs[env.envMap || 'body'];
    this.scene.environmentIntensity = env.envIntensity ?? 0.8;
    this.bloom.strength = env.bloom?.strength ?? 0.35;
    this.bloom.radius = env.bloom?.radius ?? 0.55;
    this.bloom.threshold = env.bloom?.threshold ?? 0.82;
    const L = env.lights || {};
    this.hemi.color.set(L.sky || '#ffffff');
    this.hemi.groundColor.set(L.ground || '#3a2222');
    this.hemi.intensity = L.hemi ?? 0.6;
    this.key.color.set(L.keyColor || '#fff4ea');
    this.key.intensity = L.key ?? 2.4;
    this.key.position.fromArray(L.keyPos || [4, 8, 6]);
    this.key.target.position.fromArray(L.keyTarget || [0, 0, 0]);
    const sc = this.key.shadow.camera;
    const s = L.shadowSize ?? 6;
    sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s; sc.near = 0.5; sc.far = 40;
    sc.updateProjectionMatrix();
    this.key.castShadow = L.shadows !== false;
    this.rim.color.set(L.rimColor || '#9fc7ff');
    this.rim.intensity = L.rim ?? 1.2;
    this.rim.position.fromArray(L.rimPos || [-6, 3, -6]);
    this.fill.color.set(L.fillColor || '#ffb0a0');
    this.fill.intensity = L.fill ?? 0;
    this.fill.position.fromArray(L.fillPos || [0, 2, 4]);
    this.head.intensity = L.head ?? 0.55;

    const c = built.controls || {};
    this.controls.minDistance = c.minDistance ?? 1;
    this.controls.maxDistance = c.maxDistance ?? 30;
    this.controls.enablePan = c.pan ?? true;

    this.labels = [];
    for (const def of built.labels || []) this.addLabel(def);
  }

  addLabel(def) {
    const el = document.createElement('div');
    el.className = `tag ${def.side === 'left' ? 'tag-left' : ''}`;
    el.innerHTML = `<span class="tag-dot"></span><span class="tag-line"></span><span class="tag-pill">${def.text}</span>`;
    const obj = new CSS2DObject(el);
    const parent = def.parent || this.active.root;
    if (def.at) obj.position.fromArray(def.at);
    parent.add(obj);
    const label = { def, el, obj, shown: false };
    this.labels.push(label);
    return label;
  }

  setLabelsVisible(v) {
    this.labelsVisible = v;
  }

  /** Smoothly move the camera to a {pos, target} view. */
  flyTo(view, duration = 1.6) {
    if (!view) return;
    const from = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    const to = { pos: new THREE.Vector3().fromArray(view.pos), target: new THREE.Vector3().fromArray(view.target) };
    if (duration <= 0) {
      this.camera.position.copy(to.pos);
      this.controls.target.copy(to.target);
      this.flight = null;
      return;
    }
    // Arc through a slightly pulled-back midpoint for a cinematic feel.
    const mid = from.pos.clone().lerp(to.pos, 0.5);
    const dir = mid.clone().sub(from.target.clone().lerp(to.target, 0.5));
    const dist = from.pos.distanceTo(to.pos);
    mid.addScaledVector(dir.normalize(), Math.min(dist * 0.25, 4));
    this.flight = { from, to, mid, t: 0, duration };
  }

  cancelFlight() {
    this.flight = null;
  }

  currentView() {
    return { pos: this.camera.position.toArray(), target: this.controls.target.toArray() };
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    // Ease the illness amount toward its target.
    const k = 1 - Math.exp(-dt * 2.2);
    this.sick += (this.sickTarget - this.sick) * k;
    if (Math.abs(this.sickTarget - this.sick) < 0.0005) this.sick = this.sickTarget;

    if (this.flight) {
      const f = this.flight;
      f.t += dt / f.duration;
      const e = easeInOut(clamp(f.t));
      const a = f.from.pos.clone().lerp(f.mid, e);
      const b = f.mid.clone().lerp(f.to.pos, e);
      this.camera.position.copy(a.lerp(b, e));
      this.controls.target.copy(f.from.target.clone().lerp(f.to.target, e));
      if (f.t >= 1) this.flight = null;
    }
    // Pause auto-rotation while flying or shortly after the user touched the view.
    const idle = performance.now() - this.lastInteraction > 6000;
    this.controls.autoRotate = this.autoRotateEnabled !== false && !this.flight && !this.userInteracting && idle;
    this.controls.update();
    this.head.position.copy(this.camera.position);
    this.head.target.position.copy(this.controls.target);

    if (this.active?.update) this.active.update(this.time, dt, this.sick);

    const camPos = this.camera.position;
    for (const l of this.labels) {
      const d = l.def;
      let on = this.labelsVisible;
      if (on && d.when) on = d.when(this.sick, this.time);
      if (on && d.near) {
        const wp = l.obj.getWorldPosition(_v);
        on = wp.distanceTo(camPos) < d.near;
      }
      if (on && d.follow) d.follow(l.obj.position);
      if (on !== l.shown) {
        l.shown = on;
        l.el.classList.toggle('on', on);
      }
    }

    this.finish.uniforms.uTime.value = this.time;
    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);
    if (this.onFrame) this.onFrame(this.sick, this.time);
  }
}

const _v = new THREE.Vector3();

/** A dim, warm "inside the body" reflection environment with a few soft light panels. */
function bodyEnvironment() {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const col = [];
  const p = geo.attributes.position;
  const top = new THREE.Color('#5a3a3a'), bottom = new THREE.Color('#0c0606'), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    c.copy(bottom).lerp(top, THREE.MathUtils.smoothstep(p.getY(i), -6, 8));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const panel = (w, h, color, intensity, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.fromArray(pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  panel(6, 3, '#fff1e6', 4.5, [2, 7, 5]);
  panel(3, 5, '#9cc0ff', 2.2, [-8, 2, -4]);
  panel(4, 2, '#ffb3a3', 1.4, [6, -1, 3]);
  return scene;
}
