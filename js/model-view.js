// Window 1: the real rocket, with the gimbal swinging, the recovery sequence, and power flowing.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RocketRig, PART_INFO } from "./rig.js";
import { gimbalToHorn, servoUs } from "./sim.js";

const MODES = {
  overview: { target: [0, 0.105, 0], dist: 0.78, power: 0.5, dur: 7,
    caption: "The real v7 CAD: a one-piece printed structure inside a 41 mm tube, a D12 on a ball-joint gimbal, and three SG90s. No fins anywhere." },
  gimbal: { target: [0, 0.05, 0], dist: 0.34, power: 0.55, dur: 10,
    caption: "Two SG90s push the motor sleeve around its ball joint. Each servo drives one 45° axis through an arm-and-pushrod linkage, ±6° of gimbal from ±11.4° of horn." },
  recovery: { target: [0, 0.37, 0], dist: 1.55, power: 0.55, dur: 10,
    caption: "At apogee the chute servo swings its horn off the latch key. The printed spring throws the nose, and the canopy pulls out on the shock cord." },
  power: { target: [0, 0.12, 0], dist: 0.36, power: 1.6, dur: 8,
    caption: "A 1S LiPo feeds a 5 V boost for the servos. The XIAO ESP32-S3 runs the 200 Hz loop and sends a pulse to each servo 50 times a second." },
};
const TOUR = ["overview", "gimbal", "recovery", "power"];

const CALLOUTS = {
  gimbal: [["Ball joint", [0, 0, 34.8], "left"], ["Servo A", [10, -6, 70]], ["Servo B", [-6, -10, 104]], ["Pushrods", [-11, 11, 58], "left"]],
  recovery: [["Latch horn", [6, 10, 162]], ["Spring", [-16, 0, 182], "left"], ["Nose", [0, 0, 240], "left"]],
  overview: [["Nose cone", [0, 14, 232]], ["E-bay", [0, -16, 140], "left"], ["Gimbal", [0, 12, 30]], ["D12 motor", [0, -12, -20], "left"]],
  power: [["1S LiPo", [0, -9, 152]], ["5 V boost", [12.5, -12, 127]], ["Flight computer", [-4, -17, 128], "left"], ["Servo leads", [4, -15, 100], "left"]],
};

export function createModelView({ canvas, overlay, tooltip, onReadout, onCaption, onMode }, assets) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
  camera.position.set(0.42, 0.26, 0.5);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 0.12; controls.maxDistance = 2.5;
  controls.target.set(0, 0.1, 0);
  controls.autoRotate = true; controls.autoRotateSpeed = 0.6;

  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1, 2, 1.5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x57d2ff, 0.9); rim.position.set(-1.5, 0.6, -1); scene.add(rim);
  const warm = new THREE.DirectionalLight(0xff9a5a, 0.5); warm.position.set(1.2, -0.4, -1.2); scene.add(warm);

  // soft contact shadow
  const sc = document.createElement("canvas"); sc.width = sc.height = 128;
  const sx = sc.getContext("2d"), sg = sx.createRadialGradient(64, 64, 0, 64, 64, 64);
  sg.addColorStop(0, "rgba(0,0,0,0.55)"); sg.addColorStop(1, "rgba(0,0,0,0)"); sx.fillStyle = sg; sx.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -0.0455; scene.add(shadow);

  const rig = new RocketRig(assets);
  scene.add(rig.root);
  scene.add(rig.chute.group);
  scene.add(rig.cord);

  // ---------------------------------------------------------------- state
  let mode = "tour", seg = 0, segT = 0, lastUser = -1e9, clock = 0;
  let current = TOUR[0];
  const camGoal = { target: new THREE.Vector3(0, 0.1, 0), dist: 0.62 };
  const setGoal = (m) => { camGoal.target.set(...MODES[m].target); camGoal.dist = MODES[m].dist; };
  setGoal(current);
  let power = MODES[current].power;

  controls.addEventListener("start", () => { lastUser = clock; controls.autoRotate = false; });
  controls.addEventListener("end", () => { lastUser = clock; });

  function setMode(m) {
    mode = m; segT = 0;
    current = m === "tour" ? TOUR[(seg = 0)] : m;
    setGoal(current); lastUser = -1e9; controls.autoRotate = true;
    onCaption?.(MODES[current].caption, current);
    onMode?.(m, current);
  }

  // ---------------------------------------------------------------- callouts
  const calloutEls = [];
  function buildCallouts(m) {
    for (const el of calloutEls) el.remove();
    calloutEls.length = 0;
    for (const [label, p, side] of CALLOUTS[m] || []) {
      const el = document.createElement("div");
      el.className = "callout" + (side === "left" ? " left" : ""); el.innerHTML = `<i></i><span>${label}</span>`;
      el._p = new THREE.Vector3(...p);
      overlay.appendChild(el); calloutEls.push(el);
    }
  }
  let calloutMode = null;
  const tmp = new THREE.Vector3();
  function placeCallouts(alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    rig.root.updateMatrixWorld(true);
    for (const el of calloutEls) {
      tmp.copy(el._p).applyMatrix4(rig.body.matrixWorld).project(camera);
      const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
      el.style.opacity = vis ? alpha : 0;
      el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h}px)`;
    }
  }

  // ---------------------------------------------------------------- hover labels
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let hovered = null, hoverPending = null;
  canvas.addEventListener("pointermove", (e) => { hoverPending = e; });
  canvas.addEventListener("pointerleave", () => { hoverPending = null; setHover(null); tooltip.hidden = true; });
  function setHover(m) {
    if (hovered === m) return;
    if (hovered && hovered.material.emissive && !hovered.userData.cable) hovered.material.emissive.setHex(0x000000);
    hovered = m;
    if (m && m.material.emissive) m.material.emissive.setHex(0x1d3550);
  }
  function doHover() {
    if (!hoverPending) return;
    const e = hoverPending; hoverPending = null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(rig.pickables(), false).filter((h) => h.object.visible &&
      !(h.object.name === "tube" && rig.tubeMode === "glass"));
    const m = hits.length ? hits[0].object : null;
    setHover(m);
    if (m && PART_INFO[m.name]) {
      const [t, d] = PART_INFO[m.name];
      tooltip.innerHTML = `<b>${t}</b>${d ? `<span>${d}</span>` : ""}`;
      tooltip.hidden = false;
      tooltip.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 14}px)`;
    } else tooltip.hidden = true;
  }

  // ---------------------------------------------------------------- animation per mode
  function animate(m, t) {
    let gA = 0, gB = 0, latch = 0, nose = 0, chute = 0;
    if (m === "gimbal") {
      const ramp = Math.min(1, t / 0.8);
      gA = 5.6 * Math.sin(t * 1.9) * ramp;
      gB = 5.6 * Math.sin(t * 1.9 * 1.37 + 0.9) * ramp;
    } else if (m === "recovery") {
      const p = t % 10;
      const k = (a, b) => Math.max(0, Math.min(1, (p - a) / (b - a)));
      latch = 40 * (k(0.8, 1.15) - k(8.6, 9.2));
      nose = k(1.15, 1.7) - k(8.0, 8.9);
      chute = k(1.5, 2.6) - k(7.0, 8.2);
    } else if (m === "overview") {
      gA = 3.5 * Math.sin(t * 1.3); gB = 3.5 * Math.sin(t * 1.7 + 0.8);
    } else if (m === "power") {
      gA = 1.2 * Math.sin(t * 3.1); gB = 1.2 * Math.sin(t * 2.3 + 1);
    }
    rig.setGimbal(gA, gB);
    rig.setLatch(latch);
    rig.setNose(nose, 85, 10);
    // chute + cord in the world (the model stands upright, so "up" is +y)
    const anchor = rig.anchorWorld(new THREE.Vector3());
    const e = chute * chute * (3 - 2 * chute);
    rig.chute.group.position.copy(anchor).add(new THREE.Vector3(0.012 * e, 0.16 * e, 0));
    rig.chute.set(e);
    const nw = rig.noseWorld(new THREE.Vector3());
    const pts = rig.cord.geometry.attributes.position;
    pts.setXYZ(0, anchor.x, anchor.y, anchor.z); pts.setXYZ(1, nw.x, nw.y, nw.z);
    const sw = rig.chute.group.position;
    pts.setXYZ(2, sw.x, sw.y, sw.z); pts.needsUpdate = true;
    rig.cord.visible = nose > 0.02;
    const hA = gimbalToHorn(gA, rig.armLen, rig.studR), hB = gimbalToHorn(gB, rig.armLen, rig.studR);
    onReadout?.({ mode: m, gA, gB, usA: servoUs(90 + hA), usB: servoUs(90 + hB), latch, usC: servoUs(20 + latch * 3), chute: e });
  }

  // ---------------------------------------------------------------- loop
  let running = false, last = performance.now(), raf = 0;
  const spher = new THREE.Spherical();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
    segT += dt;
    if (mode === "tour" && segT > MODES[current].dur) {
      seg = (seg + 1) % TOUR.length; current = TOUR[seg]; segT = 0; setGoal(current);
      onCaption?.(MODES[current].caption, current); onMode?.(mode, current);
    }
    if (calloutMode !== current) { buildCallouts(current); calloutMode = current; }
    // ease the camera toward the mode's framing unless the viewer is driving
    if (clock - lastUser > 6) {
      controls.target.lerp(camGoal.target, 1 - Math.exp(-dt * 2.2));
      const off = camera.position.clone().sub(controls.target);
      spher.setFromVector3(off);
      spher.radius += (camGoal.dist - spher.radius) * (1 - Math.exp(-dt * 2.2));
      spher.phi += (1.18 - spher.phi) * (1 - Math.exp(-dt * 0.8));
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spher));
      if (!controls.autoRotate) controls.autoRotate = true;
    }
    power += (MODES[current].power - power) * (1 - Math.exp(-dt * 3));
    rig.setPower(power);
    // in power mode the plastic fades back so the wiring shows
    const fade = current === "power" ? 1 : 0;
    for (const n of ["structure", "nose", "spring_pusher", "tuning_collar", "motor_sleeve"]) {
      const mt = rig.materials[n];
      const target = 1 - 0.72 * fade;
      mt.opacity += (target - mt.opacity) * (1 - Math.exp(-dt * 4));
      const tr = mt.opacity < 0.99;
      if (mt.transparent !== tr) { mt.transparent = tr; mt.depthWrite = !tr; mt.needsUpdate = true; }
    }
    animate(current, segT);
    rig.update(clock);
    controls.update();
    doHover();
    placeCallouts(Math.min(1, segT / 0.6) * (clock - lastUser > 1.5 ? 1 : 0.5));
    renderer.render(scene, camera);
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.9 ? 44 : 32;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  const io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
    else if (!e.isIntersecting && running) { running = false; cancelAnimationFrame(raf); }
  });
  io.observe(canvas);
  setMode("tour");

  return {
    setMode,
    setTube: (m) => rig.setTube(m),
    get mode() { return mode; },
  };
}
