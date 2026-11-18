// RocketRig: the real v7 CAD parts, rigged so the gimbal, servo arms, pushrods, chute latch, nose and
// parachute can move, with a faint current running through the wiring. Used by both windows.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

const S2 = Math.SQRT1_2;
const U = new THREE.Vector3(S2, S2, 0), V = new THREE.Vector3(-S2, S2, 0), Z = new THREE.Vector3(0, 0, 1);
const D2R = Math.PI / 180;

export const PART_INFO = {
  structure: ["Structure", "Gimbal frame and e-bay, printed as one PETG part"],
  tube: ["Body tube", "Slides over the structure, held by 8 M2 screws into heat-set inserts"],
  nose: ["Nose cone", "Held down by the latch key until the chute servo lets go"],
  motor_sleeve: ["Motor sleeve", "Ball joint at the bottom of the frame; the whole motor swings on it"],
  REF_motor_D12: ["Estes D12 motor", "16.8 N s, 29.7 N peak, 1.65 s burn"],
  pushrod_low: ["Pushrod A", "Servo A to the 45° stud on the sleeve"],
  pushrod_high: ["Pushrod B", "Servo B to the 135° stud on the sleeve"],
  REF_arm_low_trimmed: ["Servo A arm", "7.78 mm hole: 1.89° of horn per degree of gimbal"],
  REF_arm_high_trimmed: ["Servo B arm", "7.78 mm hole: 1.89° of horn per degree of gimbal"],
  REF_SG90_low: ["Servo A · SG90", "Swings the motor about the 135° axis"],
  REF_SG90_high: ["Servo B · SG90", "Swings the motor about the 45° axis"],
  REF_SG90_chute: ["Chute servo · SG90", "Slid in from the side under the e-bay plate"],
  REF_horn_chute: ["Latch horn", "Holds the latch key; swings clear to release the nose"],
  latch_key: ["Latch key", "Hangs from the nose and hooks under the latch horn"],
  spring_pusher: ["Spring + pusher", "One printed part: compressed by the nose, throws it at deploy"],
  tuning_collar: ["Tuning collar", "Clamps on at the centre of gravity, pivot bosses for the test stand"],
  REF_xiao_esp32s3_sense: ["Flight computer", "Seeed XIAO ESP32-S3: 200 Hz control loop, Wi-Fi ground station"],
  REF_1S_lipo_300mAh: ["1S LiPo · 300 mAh", "Feeds the boost converter and the flight computer"],
  REF_boost_5V: ["5 V boost", "Lifts 3.7 V to 5 V for the three servos"],
  CABLE_servo_low: ["Servo A lead", "Signal + 5 V, runs up the frame's cable groove"],
  CABLE_servo_high: ["Servo B lead", "Signal + 5 V, runs up the frame's cable groove"],
  CABLE_servo_chute: ["Chute servo lead", ""],
  CABLE_battery: ["Battery lead", ""],
  CABLE_5V: ["5 V rail", ""],
};

// part -> look
const LOOK = {
  structure: { color: 0xdfe3e8, roughness: 0.62 },
  tube: { color: 0xf0712b, roughness: 0.45 },
  nose: { color: 0xff7a2f, roughness: 0.42 },
  motor_sleeve: { color: 0x2b3038, roughness: 0.55 },
  REF_motor_D12: { color: 0xc49a6c, roughness: 0.85 },
  pushrod_low: { color: 0x49b6ff, roughness: 0.4 },
  pushrod_high: { color: 0x49b6ff, roughness: 0.4 },
  REF_arm_low_trimmed: { color: 0xf4f4f2, roughness: 0.5 },
  REF_arm_high_trimmed: { color: 0xf4f4f2, roughness: 0.5 },
  REF_SG90_low: { color: 0x2f62d9, roughness: 0.3, transparent: true, opacity: 0.88 },
  REF_SG90_high: { color: 0x2f62d9, roughness: 0.3, transparent: true, opacity: 0.88 },
  REF_SG90_chute: { color: 0x2f62d9, roughness: 0.3, transparent: true, opacity: 0.88 },
  REF_horn_chute: { color: 0xf4f4f2, roughness: 0.5 },
  latch_key: { color: 0xf5c400, roughness: 0.45 },
  spring_pusher: { color: 0x19c39b, roughness: 0.5 },
  tuning_collar: { color: 0x3a4049, roughness: 0.5, metalness: 0.2 },
  REF_xiao_esp32s3_sense: { color: 0x22272e, roughness: 0.4, metalness: 0.35 },
  REF_1S_lipo_300mAh: { color: 0xb9c0c9, roughness: 0.35, metalness: 0.55 },
  REF_boost_5V: { color: 0x5b3fa8, roughness: 0.45, metalness: 0.2 },
};
const CABLES = {   // dir: +1 current flows up the cable (toward the e-bay), -1 down to the servos
  CABLE_servo_low: { color: 0x6b4a2f, dir: -1 }, CABLE_servo_high: { color: 0x6b4a2f, dir: -1 },
  CABLE_servo_chute: { color: 0x6b4a2f, dir: -1 }, CABLE_battery: { color: 0xb3352a, dir: 1 }, CABLE_5V: { color: 0xb3352a, dir: -1 },
};

let _assets = null;
export async function loadRocketAssets(base = ".") {
  if (_assets) return _assets;
  const [gltf, geo] = await Promise.all([
    new GLTFLoader().loadAsync(`${base}/assets/rocket.glb`),
    fetch(`${base}/assets/rocket-geometry.json`).then((r) => r.json()),
  ]);
  const geoms = {};
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    let name = o.name;
    if (!(name in PART_INFO) && o.parent && o.parent.name in PART_INFO) name = o.parent.name;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    g.deleteAttribute("normal");
    geoms[name] = toCreasedNormals(g, 32 * D2R);
    geoms[name].computeBoundingBox();
  });
  _assets = { geoms, geo };
  return _assets;
}

// an electric pulse that runs along a cable (object-space z), mixed into the standard material
function cableMaterial(color, dir, uniforms) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uPower = uniforms.uPower;
    sh.uniforms.uDir = { value: dir };
    sh.uniforms.uGlow = { value: new THREE.Color(0x57d2ff) };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjPos = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;\nuniform float uTime;\nuniform float uPower;\nuniform float uDir;\nuniform vec3 uGlow;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        float ph = fract(vObjPos.z * 0.045 * uDir * -1.0 + uTime * 0.9 + vObjPos.x * 0.01);
        float pulse = smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.06, 0.22, ph));
        totalEmissiveRadiance += uGlow * (pulse * 1.6 + 0.06) * uPower;`);
  };
  return m;
}

function glowTexture(inner = "rgba(255,255,255,1)", mid = "rgba(255,255,255,0.35)") {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner); g.addColorStop(0.35, mid); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// parachute: 8 gores, shroud lines to a swivel, built in a local frame (y up, swivel at origin, metres)
export class Chute {
  constructor(diameter = 0.3) {
    this.group = new THREE.Group();
    const R = diameter / 2, H = R * 0.62, gores = 8;
    const pos = [], col = [], idx = [];
    const ca = new THREE.Color(0xff7a2f), cb = new THREE.Color(0xf2f2ee);
    const rings = 7, seg = 6;
    for (let g = 0; g < gores; g++) {
      const c = g % 2 ? ca : cb;
      const base = pos.length / 3;
      for (let i = 0; i <= rings; i++) {
        const f = i / rings, r = R * Math.sin(f * Math.PI / 2) * 1.0, y = H * Math.cos(f * Math.PI / 2);
        for (let j = 0; j <= seg; j++) {
          const a = (g + j / seg) / gores * Math.PI * 2;
          const bulge = 1 + 0.06 * Math.sin((j / seg) * Math.PI) * f;          // gores puff out between seams
          pos.push(Math.cos(a) * r * bulge, y, Math.sin(a) * r * bulge);
          col.push(c.r, c.g, c.b);
        }
      }
      for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
        const a = base + i * (seg + 1) + j, b = a + seg + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    this.canopyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
    this.canopy = new THREE.Mesh(geo, this.canopyMat);
    this.canopy.position.y = R * 1.9;                  // shroud line length ~ 1.9 R
    this.group.add(this.canopy);
    // shroud lines
    const lp = [];
    for (let g = 0; g < gores; g++) {
      const a = g / gores * Math.PI * 2;
      lp.push(0, 0, 0, Math.cos(a) * R, R * 1.9, Math.sin(a) * R);
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xd8dde3, transparent: true, opacity: 0.7 }));
    this.group.add(this.lines);
    this.R = R;
    this.set(0);
  }
  // k: 0 packed .. 1 fully open; spill: 0..1 collapse after landing
  set(k, spill = 0) {
    const s = Math.max(0.001, k);
    const open = 0.25 + 0.75 * k;
    this.canopy.scale.set(open * (1 + 0.15 * spill), Math.max(0.05, (0.6 + 0.4 * k) * (1 - 0.85 * spill)), open * (1 + 0.15 * spill));
    this.canopy.position.y = this.R * 1.9 * s * (1 - 0.8 * spill);
    this.lines.scale.set(open, s * (1 - 0.8 * spill), open);
    this.group.visible = k > 0.001;
  }
}

export class RocketRig {
  constructor(assets, { flight = false } = {}) {
    const { geoms, geo } = assets;
    this.geo = geo;
    this.root = new THREE.Group();          // three.js frame, metres, y up
    this.body = new THREE.Group();          // CAD frame, mm, z up
    this.body.rotation.x = -Math.PI / 2;
    this.body.scale.setScalar(0.001);
    this.root.add(this.body);
    this.uniforms = { uTime: { value: 0 }, uPower: { value: 0.6 } };
    this.meshes = {};
    this.materials = {};
    const P = new THREE.Vector3(...geo.pivot);
    this.pivot = P;

    const mk = (name) => {
      const g = geoms[name]; if (!g) return null;
      let mat;
      if (CABLES[name]) mat = cableMaterial(CABLES[name].color, CABLES[name].dir, this.uniforms);
      else mat = new THREE.MeshStandardMaterial({ metalness: 0, ...LOOK[name] });
      const m = new THREE.Mesh(g, mat);
      m.name = name; m.userData.part = name;
      this.meshes[name] = m; this.materials[name] = mat;
      return m;
    };
    const pivotGroup = (point, parent = this.body) => {
      const outer = new THREE.Group(); outer.position.copy(point);
      const inner = new THREE.Group(); inner.position.copy(point).multiplyScalar(-1);
      outer.add(inner); parent.add(outer);
      return { outer, inner };
    };

    // gimbal: sleeve + motor swing about the ball centre
    this.gimbal = pivotGroup(P);
    for (const n of ["motor_sleeve", "REF_motor_D12"]) this.gimbal.inner.add(mk(n));
    // pushrods ride with their studs
    this.pushA = new THREE.Group(); this.pushA.add(mk("pushrod_low")); this.body.add(this.pushA);
    this.pushB = new THREE.Group(); this.pushB.add(mk("pushrod_high")); this.body.add(this.pushB);
    // servo arms turn about their shafts (A: shaft along u at v=-7.78; B: along v at u=-7.78)
    const sA = geo.servo_low.shaft, sB = geo.servo_high.shaft;
    this.armA = pivotGroup(V.clone().multiplyScalar(sA.v).setZ(sA.z));
    this.armA.inner.add(mk("REF_arm_low_trimmed"));
    this.armB = pivotGroup(U.clone().multiplyScalar(sB.u).setZ(sB.z));
    this.armB.inner.add(mk("REF_arm_high_trimmed"));
    this.armLen = Math.abs(sA.v); this.studR = geo.stud_radius;
    // chute latch horn turns about a vertical shaft
    const hc = geo.chute_horn_shaft;
    this.horn = pivotGroup(new THREE.Vector3(hc[0], hc[1], 0));
    this.horn.inner.add(mk("REF_horn_chute"));
    // nose + latch key leave together; the spring pusher follows a little way
    this.nose = new THREE.Group(); this.nose.add(mk("nose")); this.nose.add(mk("latch_key")); this.body.add(this.nose);
    this.spring = new THREE.Group(); this.spring.add(mk("spring_pusher")); this.body.add(this.spring);
    // everything else is fixed to the structure
    for (const n of ["structure", "REF_SG90_low", "REF_SG90_high", "REF_SG90_chute", "tuning_collar",
      "REF_xiao_esp32s3_sense", "REF_1S_lipo_300mAh", "REF_boost_5V",
      "CABLE_servo_low", "CABLE_servo_high", "CABLE_servo_chute", "CABLE_battery", "CABLE_5V"]) {
      const m = mk(n); if (m) this.body.add(m);
    }
    const tube = mk("tube"); this.body.add(tube);
    this.tubeEdges = new THREE.LineSegments(new THREE.EdgesGeometry(geoms.tube, 40),
      new THREE.LineBasicMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.35 }));
    this.body.add(this.tubeEdges);
    this.setTube(flight ? "solid" : "glass");

    // flight-computer status LED (blinks) and a soft glow on the board
    const led = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x57d2ff, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    led.position.set(4.5, -18.4, 138); led.scale.setScalar(7);
    this.led = led; this.body.add(led);

    // motor flame (used in the flight view, off by default)
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa04a, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false });
    const flameGeo = new THREE.ConeGeometry(7, 60, 20, 1, true); flameGeo.rotateX(-Math.PI / 2); flameGeo.translate(0, 0, -30);   // wide at the nozzle, tip 60 mm aft
    this.flame = new THREE.Group();
    const f1 = new THREE.Mesh(flameGeo, flameMat);
    const f2 = new THREE.Mesh(flameGeo, flameMat.clone()); f2.material.color.set(0xfff1c2); f2.scale.set(0.45, 0.45, 0.6);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff8a3d, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.setScalar(80); glow.position.z = -10;
    this.flame.add(f1, f2, glow);
    this.flame.position.z = geo.parts.REF_motor_D12.min[2];
    this.flame.visible = false;
    this.gimbal.inner.add(this.flame);
    this.flameParts = [f1, f2, glow];

    // chute: lives in the body frame for the model view; the flight view re-parents it to the world
    this.chute = new Chute(0.3);
    this.chuteAnchor = new THREE.Vector3(0, 0, geo.tube_top_z);       // shock-cord attach, CAD mm
    this.cord = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xf5c400, transparent: true, opacity: 0.85 }));
    this.cord.frustumCulled = false;
    this.chuteK = 0;
    this.noseK = 0;
    this.setGimbal(0, 0);
  }

  pickables() { return Object.values(this.meshes); }

  setTube(mode) {
    const m = this.materials.tube, t = this.meshes.tube;
    this.tubeMode = mode;
    t.visible = mode !== "hidden";
    this.tubeEdges.visible = mode === "glass";
    if (mode === "glass") { Object.assign(m, { transparent: true, opacity: 0.13, depthWrite: false }); m.color.set(0xa9c4dd); m.roughness = 0.15; }
    else { Object.assign(m, { transparent: false, opacity: 1, depthWrite: true }); m.color.set(0xf0712b); m.roughness = 0.45; }
    m.side = mode === "glass" ? THREE.DoubleSide : THREE.FrontSide;
    m.needsUpdate = true;
  }

  // gA: servo A swing about v, gB: servo B swing about u (degrees, same convention as the sim)
  setGimbal(gA, gB) {
    const qU = new THREE.Quaternion().setFromAxisAngle(U, gB * D2R);
    const qV = new THREE.Quaternion().setFromAxisAngle(V, gA * D2R);
    this.gimbal.outer.quaternion.multiplyQuaternions(qU, qV);
    const q = this.gimbal.outer.quaternion;
    const studA = U.clone().multiplyScalar(this.studR), studB = V.clone().multiplyScalar(this.studR);
    const dA = studA.clone().applyQuaternion(q).sub(studA), dB = studB.clone().applyQuaternion(q).sub(studB);
    this.pushA.position.copy(dA); this.pushB.position.copy(dB);
    const a = Math.asin(Math.max(-1, Math.min(1, dA.z / this.armLen)));
    const b = -Math.asin(Math.max(-1, Math.min(1, dB.z / this.armLen)));
    this.armA.outer.quaternion.setFromAxisAngle(U, a);
    this.armB.outer.quaternion.setFromAxisAngle(V, b);
    this.hornA = a / D2R; this.hornB = -b / D2R;
  }

  setLatch(deg) { this.horn.outer.rotation.z = -deg * D2R; }

  // nose: 0 seated .. 1 thrown clear (along the body axis). spring follows for the first 9 mm.
  setNose(k, dist = 70, tilt = 0) {
    this.noseK = k;
    const e = k * k * (3 - 2 * k);
    this.nose.position.set(0, 0, e * dist);
    this.nose.rotation.set(0, 0, 0);
    if (tilt) { this.nose.position.x = e * tilt * 0.6; this.nose.rotation.y = e * tilt * D2R * 0.4; }
    this.spring.position.z = Math.min(9, e * 40);
  }

  setPower(level) { this.uniforms.uPower.value = level; }

  setFlame(thrust, peak = 29.7, t = 0) {
    this.flame.visible = thrust > 0.05;
    if (!this.flame.visible) return;
    const k = Math.min(1.4, 0.35 + thrust / peak);
    const flick = 1 + 0.12 * Math.sin(t * 91) + 0.08 * Math.sin(t * 57 + 1);
    this.flameParts[0].scale.set(k * 0.9, k * 0.9, k * flick * 1.3);
    this.flameParts[1].scale.set(0.45 * k, 0.45 * k, 0.6 * k * flick * 1.3);
    this.flameParts[2].scale.setScalar(70 + 50 * k);
  }

  update(time) {
    this.uniforms.uTime.value = time;
    const p = this.uniforms.uPower.value;
    const blink = (time % 1.0) < 0.12 || ((time % 1.0) > 0.22 && (time % 1.0) < 0.3) ? 1 : 0.25;
    this.led.material.opacity = Math.min(1, 0.25 + p) * blink;
  }

  // world-space point of the shock-cord anchor
  anchorWorld(out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    return out.copy(this.chuteAnchor).applyMatrix4(this.body.matrixWorld);
  }
  noseWorld(out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    return out.set(0, 0, this.geo.nose_bottom_z + 6).applyMatrix4(this.nose.matrixWorld);
  }
}
