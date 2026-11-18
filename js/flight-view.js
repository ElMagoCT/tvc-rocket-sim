// Window 2: replays a simulated flight in 3D, from the pad through ignition, the TVC burn, coast,
// chute deployment and landing. The physics runs first (sim.js); this file only draws the log.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RocketRig } from "./rig.js";
import { sampleAt } from "./sim.js";

const C = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const Cinv = C.clone().invert();
const toThree = (x, y, z, out = new THREE.Vector3()) => out.set(x, z, -y);

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { sun: { value: new THREE.Vector3(-0.6, 0.12, -0.8).normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 sun;
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 zen = vec3(0.035, 0.07, 0.13), mid = vec3(0.11, 0.2, 0.33), hor = vec3(0.86, 0.52, 0.35);
        vec3 c = mix(mid, zen, smoothstep(0.05, 0.6, h));
        float s = max(dot(normalize(vDir), sun), 0.0);
        c = mix(c, hor, (1.0 - smoothstep(0.0, 0.22, h)) * (0.45 + 0.55 * pow(s, 3.0)));
        c += vec3(1.0, 0.62, 0.35) * pow(s, 60.0) * 0.8;
        if (h < 0.0) c = mix(hor * 0.5, vec3(0.08, 0.07, 0.07), smoothstep(0.0, -0.15, h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function gridTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#5e5044"; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "255,240,220"},${Math.random() * 0.05})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  g.strokeStyle = "rgba(255,235,210,0.2)"; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; return t;
}

function smokeMaterial() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d"), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(0.5, "rgba(255,255,255,0.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { map: { value: new THREE.CanvasTexture(c) }, now: { value: 0 }, scale: { value: 300 } },
    vertexShader: `attribute float birth; uniform float now; uniform float scale; varying float vA;
      void main(){ float age = now - birth; vA = age < 0.0 ? 0.0 : (1.0 - smoothstep(1.0, 9.0, age)) * smoothstep(0.0, 0.08, age);
        vec4 mv = modelViewMatrix * vec4(position + vec3(0.0, age * 0.15, 0.0), 1.0);
        gl_PointSize = (0.25 + age * 0.55) * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; varying float vA;
      void main(){ vec4 c = texture2D(map, gl_PointCoord); if (vA <= 0.0) discard; gl_FragColor = vec4(vec3(0.82, 0.8, 0.78), c.a * vA * 0.55); }`,
  });
}

export function createFlightView({ canvas, onFrame, onEvent, onEnd }, assets, cfg) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2a3140, 120, 1400);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMaterial());
  scene.add(sky);
  {
    const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMaterial()));
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(envScene, 0.02).texture;
  }
  scene.add(new THREE.HemisphereLight(0x8fb2d8, 0x3a2a20, 0.9));
  const sun = new THREE.DirectionalLight(0xffc49a, 2.2); sun.position.set(-60, 14, -80); scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 1 }));
  ground.material.map.repeat.set(400, 400);
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  // range rings every 25 m
  for (const r of [25, 50, 75, 100]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.08, r + 0.08, 128),
      new THREE.MeshBasicMaterial({ color: 0xffd9b0, transparent: true, opacity: 0.18, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; scene.add(ring);
  }
  // launch stand
  const pad = new THREE.Group();
  const padMat = new THREE.MeshStandardMaterial({ color: 0x8b939e, roughness: 0.5, metalness: 0.4 });
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.006, 40), padMat); plate.position.y = -0.003; pad.add(plate);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16), padMat);
    leg.position.set(Math.cos(a) * 0.09, -0.02, Math.sin(a) * 0.09); leg.rotation.z = Math.cos(a) * 0.5; leg.rotation.x = -Math.sin(a) * 0.5;
    pad.add(leg);
  }
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(0.5, 40), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }));
  scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.012; scene.add(scorch);
  scene.add(pad);

  const rig = new RocketRig(assets, { flight: true });
  rig.setPower(0.35);
  scene.add(rig.root);
  scene.add(rig.chute.group);
  scene.add(rig.cord);
  const flameLight = new THREE.PointLight(0xff8a3d, 0, 6, 1.6); scene.add(flameLight);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.02, 6000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.enabled = false;

  // ---------------------------------------------------------------- per-run objects
  let run = null, trail = null, smoke = null;
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
  function load(result) {
    run = result;
    const L = run.log;
    if (trail) { scene.remove(trail); trail.geometry.dispose(); }
    if (smoke) { scene.remove(smoke); smoke.geometry.dispose(); }
    const pos = new Float32Array(L.length * 3), col = new Float32Array(L.length * 3);
    const cBoost = new THREE.Color(0xff9a4a), cCoast = new THREE.Color(0xe8ebef), cDesc = new THREE.Color(0x57d2ff), cPad = new THREE.Color(0x777777);
    L.forEach((s, i) => {
      toThree(s.x, s.y, s.z + 0.03, tmpV); pos.set([tmpV.x, tmpV.y, tmpV.z], i * 3);
      const c = s.phase === "BOOST" ? cBoost : s.phase === "COAST" ? cCoast : s.phase === "PAD" ? cPad : cDesc;
      col.set([c.r, c.g, c.b], i * 3);
    });
    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.BufferAttribute(pos, 3)); tg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45 }));
    trail.frustumCulled = false; scene.add(trail);
    // exhaust smoke puffs at the nozzle, one per log sample while the motor burns
    const sp = [], sb = [];
    for (const s of L) {
      if (s.thrust <= 0.2) continue;
      const q = new THREE.Quaternion(s.q[1], s.q[2], s.q[3], s.q[0]);
      const tail = new THREE.Vector3(0, 0, cfg.sim.tail_z_mm / 1000 - 0.03).applyQuaternion(q);
      toThree(s.x + tail.x, s.y + tail.y, s.z + tail.z, tmpV);
      for (let k = 0; k < 3; k++) { sp.push(tmpV.x + (Math.random() - 0.5) * 0.05, tmpV.y - k * 0.12, tmpV.z + (Math.random() - 0.5) * 0.05); sb.push(s.t + k * 0.003); }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute("birth", new THREE.Float32BufferAttribute(sb, 1));
    smoke = new THREE.Points(sg, smokeMaterial()); smoke.frustumCulled = false; scene.add(smoke);
    t = L[0].t; evIdx = 0; landT = run.truth.landing ?? Infinity;
    chuteT = run.events.find((e) => e.key === "release")?.t ?? Infinity;
    windDir.set(-Math.cos((cfg.sim.wind_from_deg) * Math.PI / 180), 0, Math.sin((cfg.sim.wind_from_deg) * Math.PI / 180));
    apply(true);
  }

  // ---------------------------------------------------------------- playback
  let t = 0, playing = false, speedMode = "auto", camMode = "chase", evIdx = 0, landT = Infinity, chuteT = Infinity;
  const windDir = new THREE.Vector3(1, 0, 0);
  const camState = { dist: 1.3, look: new THREE.Vector3(), off: new THREE.Vector3(), first: true };
  const lastRocket = new THREE.Vector3();

  function speed() {
    if (speedMode !== "auto") return speedMode;
    if (t > chuteT + 2.2 && t < landT - 2.5) return 5;
    return 1;
  }

  function apply(force = false) {
    if (!run) return;
    const s = sampleAt(run.log, t);
    toThree(s.x, s.y, s.z, rig.root.position);
    tmpQ.set(s.q[1], s.q[2], s.q[3], s.q[0]);
    rig.root.quaternion.copy(C).multiply(tmpQ).multiply(Cinv);
    rig.setGimbal(s.gimA, s.gimB);
    rig.setLatch(Math.max(0, s.chuteHorn - cfg.sim.chute_stow_deg) * 0.35);
    rig.setNose(s.nose, 300, 20);
    rig.setFlame(s.thrust, 29.7, t);
    rig.update(t);
    rig.root.updateMatrixWorld(true);
    const tail = tmpV2.set(0, 0, cfg.sim.tail_z_mm - 15).applyMatrix4(rig.body.matrixWorld);
    flameLight.position.copy(tail); flameLight.intensity = s.thrust > 0.1 ? 1.5 + s.thrust * 0.25 : 0;
    scorch.material.opacity = Math.min(0.35, Math.max(0, t) * 0.6);
    // chute in the world, drifting slightly downwind of the anchor
    const anchor = rig.anchorWorld(new THREE.Vector3());
    const k = s.chute, e = k * k * (3 - 2 * k);
    const spill = t > landT ? Math.min(1, (t - landT) / 1.6) : 0;
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(windDir, 0.12 + 0.5 * spill).normalize();
    const L = 0.55 * e;
    rig.chute.group.position.copy(anchor).addScaledVector(up, L * (1 - 0.9 * spill));
    if (spill > 0) rig.chute.group.position.y = Math.max(0.03, rig.chute.group.position.y);
    rig.chute.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up.clone().lerp(windDir, spill * 0.9).normalize());
    rig.chute.set(e, spill);
    const nw = rig.noseWorld(new THREE.Vector3());
    const p = rig.cord.geometry.attributes.position;
    p.setXYZ(0, anchor.x, anchor.y, anchor.z); p.setXYZ(1, nw.x, nw.y, nw.z);
    const swv = rig.chute.group.position; p.setXYZ(2, swv.x, swv.y, swv.z); p.needsUpdate = true;
    rig.cord.visible = s.nose > 0.01;
    // trail + smoke up to now
    const i = Math.max(1, Math.min(run.log.length, Math.round((t - run.log[0].t) * cfg.sim.log_hz) + 1));
    trail.geometry.setDrawRange(0, i);
    smoke.material.uniforms.now.value = t;
    // events
    if (force) evIdx = run.events.filter((e) => e.t <= t).length;
    while (evIdx < run.events.length && run.events[evIdx].t <= t) onEvent?.(run.events[evIdx++], false);
    onFrame?.(s, t);
  }

  function updateCamera(dt, s) {
    const rocket = rig.root.position;
    const moved = tmpV.copy(rocket).sub(lastRocket);
    lastRocket.copy(rocket);
    if (camMode === "orbit") {
      if (camState.first) { controls.target.copy(rocket); camera.position.copy(rocket).add(new THREE.Vector3(-1.2, 0.5, 1.6)); }
      else { camera.position.add(moved); controls.target.add(moved); }
      controls.update(); camState.first = false; return;
    }
    camState.first = true;
    // what to frame: the rocket, and the canopy once it is out
    const look = rocket.clone();
    const descending = s.chute > 0.05;
    if (descending) look.lerp(rig.chute.group.position, 0.45);
    if (camMode === "pad") {
      camera.position.set(-9, 1.4, 11);
      camera.lookAt(look);
      const d = camera.position.distanceTo(look);
      const want = THREE.MathUtils.clamp(2 * Math.atan((descending ? 1.6 : 0.9) / d) * 180 / Math.PI, 1.2, 40);
      camera.fov += (want - camera.fov) * (1 - Math.exp(-dt * 6));
      camera.updateProjectionMatrix();
      return;
    }
    // chase: hold a fixed side-on direction, pull back with speed
    const want = descending ? 2.6 : s.landed ? 2.2 : 1.15 + Math.min(1.6, s.speed * 0.016);
    camState.dist += (want - camState.dist) * (1 - Math.exp(-dt * 1.5));
    const dir = new THREE.Vector3(-0.72, 0.18, 0.67).normalize();
    if (s.landed) dir.set(-0.6, 0.45, 0.66).normalize();
    const off = look.clone().sub(rocket);                      // framing offset (canopy etc), smoothed
    camState.off = camState.first2 ? camState.off.lerp(off, 1 - Math.exp(-dt * 3)) : off; camState.first2 = true;
    camState.look.copy(rocket).add(camState.off);
    camera.position.copy(camState.look).addScaledVector(dir, camState.dist);
    camera.position.y = Math.max(0.15, camera.position.y);
    camera.lookAt(camState.look);
    if (camera.fov !== 40) { camera.fov = 40; camera.updateProjectionMatrix(); }
  }

  let running = false, last = 0, raf = 0, endHold = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (run && playing) {
      t += dt * speed();
      const end = run.log[run.log.length - 1].t;
      if (t >= end) { t = end; playing = false; onEnd?.(); }
    }
    apply();
    const s = sampleAt(run.log, t);
    updateCamera(dt, s);
    renderer.render(scene, camera);
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas); resize();
  let visible = false;
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
    else if (!visible && running) { running = false; cancelAnimationFrame(raf); }
  }, { threshold: 0.15 }).observe(canvas);

  return {
    load,
    play() { if (run && t >= run.log[run.log.length - 1].t - 0.01) this.seek(run.log[0].t); playing = true; },
    pause() { playing = false; },
    get playing() { return playing; },
    get visible() { return visible; },
    seek(nt) { t = nt; camState.first2 = false; apply(true); },
    get time() { return t; },
    setSpeed(v) { speedMode = v; },
    setCamera(m) { camMode = m; controls.enabled = m === "orbit"; camState.first = true; camState.first2 = false; },
    get speedNow() { return speed(); },
    get scene() { return scene; },
  };
}
