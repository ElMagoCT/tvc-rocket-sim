// Flight simulation: rigid-body physics + a model of the flight computer.
// Pure module (no DOM) so it runs in the browser and in Node (tools/sim-check.mjs).
//
// Frames: world x east, y north, z up (m). Body z = rocket axis (nose), body x/y = CAD x/y.
// The two gimbal axes sit at 45 deg in the airframe: u = (1,1,0)/sqrt2, v = (-1,1,0)/sqrt2.
// Servo A (lower SG90) swings the motor about v, servo B (upper SG90) about u.

const D2R = Math.PI / 180, R2D = 180 / Math.PI, G0 = 9.80665;
const S2 = Math.SQRT1_2;
const U = [S2, S2, 0], V = [-S2, S2, 0];

// ---------------------------------------------------------------- small vector / quaternion kit
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
function qmul(a, b) {               // [w,x,y,z]
  return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
          a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
          a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
          a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
}
function qnorm(q) { const n = Math.hypot(q[0], q[1], q[2], q[3]); return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; }
function qrot(q, v) {               // body -> world
  const p = qmul(qmul(q, [0, v[0], v[1], v[2]]), [q[0], -q[1], -q[2], -q[3]]);
  return [p[1], p[2], p[3]];
}
const qinv = (q) => [q[0], -q[1], -q[2], -q[3]];
const qrotInv = (q, v) => qrot(qinv(q), v);         // world -> body
function qint(q, w, dt) {           // integrate body rate w (rad/s)
  const a = len(w) * dt;
  if (a < 1e-12) return q;
  const s = Math.sin(a / 2) / len(w);
  return qnorm(qmul(q, [Math.cos(a / 2), w[0] * s, w[1] * s, w[2] * s]));
}
function qaxis(axis, ang) { const s = Math.sin(ang / 2); return [Math.cos(ang / 2), axis[0] * s, axis[1] * s, axis[2] * s]; }

// seeded RNG + gaussian, so every run with the same seed is identical
function rng(seed) {
  let a = seed >>> 0;
  const u = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = () => { let x = 0; for (let i = 0; i < 6; i++) x += u(); return (x - 3) / Math.SQRT2; };  // ~N(0,1)
  return { u, n };
}

export function thrustAt(curve, t) {
  if (t <= 0 || t >= curve[curve.length - 1][0]) return 0;
  let p = [0, 0];
  for (const q of curve) { if (t <= q[0]) return p[1] + (q[1] - p[1]) * (t - p[0]) / (q[0] - p[0]); p = q; }
  return 0;
}
export function impulse(curve) {
  let I = 0, p = [0, 0];
  for (const q of curve) { I += (q[0] - p[0]) * (q[1] + p[1]) / 2; p = q; }
  return I;
}

// servo horn angle (deg from centre) -> gimbal angle (deg), through his arm + pushrod linkage
export const hornToGimbal = (h, arm, stud) => Math.asin(Math.max(-1, Math.min(1, arm / stud * Math.sin(h * D2R)))) * R2D;
export const gimbalToHorn = (g, arm, stud) => Math.asin(Math.max(-1, Math.min(1, stud / arm * Math.sin(g * D2R)))) * R2D;
export const servoUs = (deg) => 500 + deg * 2000 / 180;          // firmware: 500..2500 us over 0..180 deg

// ---------------------------------------------------------------- the simulation
export const PHASES = ["PAD", "BOOST", "COAST", "DESCENT", "LANDED"];

export function simulate(cfg, opts = {}) {
  const P = cfg.sim;
  const seed = opts.seed ?? P.seed;
  const wind = opts.wind ?? P.wind_mps;
  const misalign = (opts.misalign ?? P.thrust_misalign_deg) * D2R;
  const R = rng(seed), Rs = rng(seed * 7 + 1);

  const mm = (x) => x / 1000;
  const zPivot = mm(P.pivot_z_mm), zTail = mm(P.tail_z_mm), zNose = mm(P.nose_z_mm);
  const zNoseCP = mm(P.nose_cp_z_mm), zAttach = mm(P.chute_attach_z_mm), zImu = mm(P.imu_z_mm);
  const dBody = mm(P.diameter_mm), Aref = Math.PI * dBody * dBody / 4;
  const m0 = P.mass_g / 1000, mProp = P.propellant_g / 1000, zProp = mm(P.propellant_z_mm);
  const cog0 = mm(P.cog_z_mm), I0 = P.pitch_inertia_g_mm2 * 1e-9, Iroll = P.roll_inertia_g_mm2 * 1e-9;
  const curve = cfg.motor.curve, Itot = impulse(curve), tBurn = curve[curve.length - 1][0];
  const chuteA = Math.PI * (P.chute_diameter_mm / 2000) ** 2;
  const ARM = P.arm_mm, STUD = P.stud_mm, GLIM = P.gimbal_limit_deg;
  const hornLim = Math.min(P.max_servo_deflection_deg, gimbalToHorn(GLIM, ARM, STUD));
  const C = P.control;

  // body stations for cross-flow (normal) force: tail .. nose
  const NS = 10, stations = [];
  for (let i = 0; i < NS; i++) {
    const z0 = zTail + (zNose - zTail) * i / NS, z1 = zTail + (zNose - zTail) * (i + 1) / NS;
    const zc = (z0 + z1) / 2;
    const taper = zc > mm(P.nose_base_z_mm) ? Math.max(0.15, (zNose - zc) / (zNose - mm(P.nose_base_z_mm))) : 1;
    stations.push({ z: zc, area: dBody * taper * (z1 - z0) });
  }

  // ---- state
  let t = -P.pad_time_s;
  let pos = [0, 0, -zTail];                         // tail on the pad
  let vel = [0, 0, 0], w = [0, 0, 0];
  const tilt0 = (P.pad_tilt_deg || 0) * D2R;
  let q = qaxis([Math.cos(0.7), Math.sin(0.7), 0], tilt0);
  let onPad = true, landed = false, landedAt = null;
  let chuteFrac = 0, chuteOpenAt = null, noseOff = 0;

  // gust state (Ornstein-Uhlenbeck around the mean wind)
  const windDir = (P.wind_from_deg ?? 270) * D2R;        // blowing toward -from
  let gust = [0, 0];

  // ---- flight computer state
  const fc = {
    phase: "PAD", q: [1, 0, 0, 0], gyroBias: [R.n() * 0.08 * D2R, R.n() * 0.08 * D2R, R.n() * 0.08 * D2R],
    iU: 0, iV: 0, cmdA: 0, cmdB: 0, latchedA: 0, latchedB: 0, hornA: 0, hornB: 0,
    chuteCmd: P.chute_stow_deg, chuteHorn: P.chute_stow_deg,
    altF: 0, altMax: -1e9, vzF: 0, altPrev: 0, lastBaro: -1, baroRaw: 0,
    ignCount: 0, boCount: 0, apoCount: 0, landCount: 0,
    nextCtl: t, nextPwm: t, nextBaro: t, nextLog: t,
  };
  const events = [];
  const ev = (key, label, truth) => events.push({ key, label, t, truth });
  const truth = { ignition: 0, liftoff: null, burnout: tBurn, apogee: null, apogeeAlt: 0, landing: null, maxV: 0, maxTilt: 0 };

  const log = [];
  const dt = P.dt_s;
  let aSpec = [0, 0, G0];                         // specific force at the IMU (body), m/s2
  let alt = 0, vz = 0;

  while (t < P.max_time_s) {
    // ---------------- motor
    const tb = t;
    const T = thrustAt(curve, tb);
    const burnt = tb <= 0 ? 0 : Math.min(1, impulseUpTo(curve, tb) / Itot);
    const m = m0 - mProp * burnt;
    const cog = (m0 * cog0 - mProp * burnt * zProp) / m;
    const I = I0 - mProp * burnt * (zProp - cog0) ** 2 + 0;          // propellant leaves far below the COG
    const L = cog - zPivot;                                          // pivot is below the COG

    // ---------------- servos -> gimbal (actual horn positions)
    const gV = hornToGimbal(fc.hornA, ARM, STUD) * D2R;              // servo A: about v
    const gU = hornToGimbal(fc.hornB, ARM, STUD) * D2R;              // servo B: about u
    // thrust direction in body: motor axis rotated about u then v, plus fixed misalignment
    let dirB = [0, 0, 1];
    dirB = qrot(qaxis(V, gV + misalign * 0.6), dirB);
    dirB = qrot(qaxis(U, gU + misalign * 0.8), dirB);
    const Fthr = mul(dirB, T);

    // ---------------- air
    const g = [gust[0] + Math.cos(windDir + Math.PI) * wind, gust[1] + Math.sin(windDir + Math.PI) * wind];
    const windW = [g[0] * Math.min(1, Math.max(0, pos[2]) / 2 + 0.2), g[1] * Math.min(1, Math.max(0, pos[2]) / 2 + 0.2), 0];
    const rho = P.air_density;
    let Fb = [0, 0, 0], Mb = [0, 0, 0];             // body-frame aero force + moment about COG
    const vAirW = sub(vel, windW);
    const vAirB = qrotInv(q, vAirW);
    if (!onPad || len(vAirW) > 0) {
      // axial drag
      const va = vAirB[2];
      Fb[2] += -0.5 * rho * P.cd_axial * Aref * va * Math.abs(va);
      // cross-flow drag along the body (gives damping and the broadside drag when it tumbles)
      for (const s of stations) {
        const r = [0, 0, s.z - cog];
        const vl = add(vAirB, cross(w, r));
        const vn = [vl[0], vl[1], 0], vnm = len(vn);
        if (vnm < 1e-6) continue;
        const f = mul(vn, -0.5 * rho * P.cd_crossflow * s.area * vnm);
        Fb = add(Fb, f); Mb = add(Mb, cross(r, f));
      }
      // nose-cone potential lift (Barrowman CNa = 2/rad), acts at the nose CP: this is what makes a finless rocket unstable
      {
        const r = [0, 0, zNoseCP - cog];
        const vl = add(vAirB, cross(w, r));
        const sp = len(vl);
        if (sp > 0.5) {
          const vn = [vl[0], vl[1], 0];
          const f = mul(vn, -0.5 * rho * Aref * P.cn_alpha_nose * sp * Math.max(0, Math.sign(vl[2])));
          Fb = add(Fb, f); Mb = add(Mb, cross(r, f));
        }
      }
    }
    // chute: drag on the canopy pulls the shock cord at the tube top
    if (chuteOpenAt !== null) {
      chuteFrac = Math.min(1, (t - chuteOpenAt) / P.chute_inflation_s);
      const k = chuteFrac * chuteFrac * (3 - 2 * chuteFrac);
      const sp = len(vAirW);
      if (sp > 0.01) {
        const Fw = mul(vAirW, -0.5 * rho * P.chute_cd * chuteA * k * sp);
        const fB = qrotInv(q, Fw);
        const r = [0, 0, zAttach - cog];
        Fb = add(Fb, fB); Mb = add(Mb, cross(r, fB));
        // pendulum damping of the hanging body
        Mb = add(Mb, mul([w[0], w[1], 0], -P.chute_swing_damping * k));
      }
    }

    // thrust moment (applied at the gimbal pivot) + a little roll torque from asymmetry
    const rP = [0, 0, zPivot - cog];
    const Mthr = cross(rP, Fthr);
    const Mroll = [0, 0, T > 0 ? P.roll_torque_nm : 0];
    const Mtot = add(add(Mb, Mthr), Mroll);

    // ---------------- translational dynamics
    const Fworld = add(qrot(q, add(Fb, Fthr)), [0, 0, -m * G0]);
    let acc = mul(Fworld, 1 / m);
    if (onPad) {
      if (Fworld[2] > 0 && T > 0) { onPad = false; truth.liftoff = t; }
      else acc = [0, 0, 0];
    }
    if (landed) acc = [0, 0, 0];

    // specific force at the IMU (what the accelerometer reads), body frame
    const angAcc = [Mtot[0] / I, Mtot[1] / I, Mtot[2] / Iroll];
    if (onPad || landed) aSpec = qrotInv(q, [0, 0, G0]);
    else {
      const rI = [0, 0, zImu - cog];
      aSpec = add(mul(add(Fb, Fthr), 1 / m), add(cross(angAcc, rI), cross(w, cross(w, rI))));
    }

    // ---------------- integrate
    if (!onPad && !landed) {
      vel = add(vel, mul(acc, dt));
      pos = add(pos, mul(vel, dt));
      w = add(w, mul(angAcc, dt));
      q = qint(q, w, dt);
      // ground
      const tailW = add(pos, qrot(q, [0, 0, zTail]));
      if (tailW[2] <= 0 && vel[2] < 0 && truth.apogee !== null) {
        landed = true; truth.landing = t; truth.landingSpeed = len(vel);
        vel = [0, 0, 0]; w = [0, 0, 0];
      }
    }
    if (landed) {                                   // tip over onto its side (visual + IMU)
      const up = qrot(q, [0, 0, 1]);
      const tiltNow = Math.acos(Math.max(-1, Math.min(1, up[2])));
      if (tiltNow < 85 * D2R) {
        const ax = len([-up[1], up[0], 0]) > 1e-6 ? mul([-up[1], up[0], 0], 1 / len([-up[1], up[0], 0])) : [1, 0, 0];
        q = qnorm(qmul(qaxis(ax, Math.min(85 * D2R - tiltNow, 2.2 * dt)), q));
      }
      pos[2] = Math.max(pos[2] - 0.0, dBody / 2 - 0.0);
      const tailW = add(pos, qrot(q, [0, 0, zTail]));
      const low = Math.min(tailW[2], add(pos, qrot(q, [0, 0, zNose]))[2]);
      if (low < dBody / 2) pos[2] += dBody / 2 - low;
    }
    if (onPad) { /* sitting on the stand */ }

    alt = pos[2] + zTail; vz = vel[2];
    if (!onPad && truth.apogee === null && vel[2] < 0 && t > 0.2) { truth.apogee = t; truth.apogeeAlt = alt; }
    truth.maxV = Math.max(truth.maxV, len(vel));

    // gusts
    const gk = dt / P.gust_tau_s;
    gust = [gust[0] + (-gust[0]) * gk + R.n() * P.gust_mps * Math.sqrt(2 * gk),
            gust[1] + (-gust[1]) * gk + R.n() * P.gust_mps * Math.sqrt(2 * gk)];

    // ---------------- flight computer (200 Hz loop, 50 Hz servo frames, baro at 50 Hz)
    if (t >= fc.nextBaro) {
      fc.nextBaro += 1 / P.baro_hz;
      fc.baroRaw = alt + Rs.n() * P.baro_noise_m;
      const a = 1 / (1 + P.baro_hz * P.baro_filter_s);
      const prev = fc.altF;
      fc.altF += (fc.baroRaw - fc.altF) * a;
      fc.vzF += ((fc.altF - prev) * P.baro_hz - fc.vzF) * 0.15;
      if (fc.phase !== "PAD") fc.altMax = Math.max(fc.altMax, fc.altF);
      // apogee: filtered baro altitude has dropped below its peak (and it is falling)
      if (fc.phase === "COAST") {
        fc.apoCount = (fc.altF < fc.altMax - P.apogee_drop_m && fc.vzF < 0) ? fc.apoCount + 1 : 0;
        if (fc.apoCount >= 2) {
          fc.phase = "DESCENT"; ev("apogee", "Apogee detected · chute servo fired", truth.apogee);
          fc.chuteCmd = P.chute_fire_deg; ev("deploy", "Chute servo fired");
        }
      }
      if (fc.phase === "DESCENT") {
        // landed: baro altitude has stopped changing (spread over the hold window) and the IMU reads ~1 g
        fc.altHist = fc.altHist || [];
        fc.altHist.push(fc.altF);
        if (fc.altHist.length > P.baro_hz * P.landed_hold_s) fc.altHist.shift();
        const spread = Math.max(...fc.altHist) - Math.min(...fc.altHist);
        const still = fc.altHist.length >= P.baro_hz * P.landed_hold_s && spread < P.landed_spread_m &&
                      Math.abs(len(aSpec) / G0 - 1) < 0.15;
        if (still) { fc.phase = "LANDED"; ev("landed", "Landing detected", truth.landing); fc.chuteCmd = P.chute_stow_deg; }
      }
    }

    if (t >= fc.nextCtl) {
      const cdt = 1 / P.loop_hz;
      fc.nextCtl += cdt;
      // sensors
      const gmax = 2000 * D2R;                         // MPU6050 full scale
      const clampG = (x) => Math.max(-gmax, Math.min(gmax, x));
      const gyro = [clampG(w[0] + fc.gyroBias[0] + Rs.n() * P.gyro_noise_dps * D2R),
                    clampG(w[1] + fc.gyroBias[1] + Rs.n() * P.gyro_noise_dps * D2R),
                    clampG(w[2] + fc.gyroBias[2] + Rs.n() * P.gyro_noise_dps * D2R)];
      const vib = T > 0 ? P.motor_vibration_g * G0 : 0;
      const clampA = (x) => Math.max(-16 * G0, Math.min(16 * G0, x));
      const accl = [clampA(aSpec[0] + Rs.n() * (P.accel_noise_g * G0 + vib)),
                    clampA(aSpec[1] + Rs.n() * (P.accel_noise_g * G0 + vib)),
                    clampA(aSpec[2] + Rs.n() * (P.accel_noise_g * G0 + vib * 0.5))];
      fc.gyro = gyro; fc.accl = accl;

      // attitude: gyro integration, pulled toward the accelerometer only when it reads ~1 g (firmware rule)
      fc.q = qint(fc.q, gyro, cdt);
      const am = len(accl) / G0;
      if (am > 0.75 && am < 1.25 && fc.phase === "PAD") {
        const upB = qrotInv(fc.q, [0, 0, 1]);
        const meas = mul(accl, 1 / len(accl));
        const corr = cross(upB, meas);
        fc.q = qint(fc.q, mul(corr, -(1 - P.comp_filter) * P.loop_hz * 0.5), cdt);   // rotate the estimate so its 'up' meets the measured one
      }

      // ignition detection: axial acceleration above threshold for N consecutive samples
      if (fc.phase === "PAD") {
        fc.ignCount = accl[2] / G0 > P.ignition_g ? fc.ignCount + 1 : 0;
        if (fc.ignCount >= P.ignition_samples) {
          fc.phase = "BOOST"; fc.iU = fc.iV = 0; fc.tIgn = t;
          ev("ignition", "Ignition detected", 0);
        }
      } else if (fc.phase === "BOOST") {
        fc.boCount = accl[2] / G0 < P.burnout_g ? fc.boCount + 1 : 0;
        if (fc.boCount >= P.burnout_samples) {
          fc.phase = "COAST"; fc.tBo = t; ev("burnout", "Burnout detected", tBurn);
        }
      }

      // TVC: PID on the attitude error, D on the gyro (firmware PID structure), in the servo (u/v) frame
      if (fc.phase === "BOOST") {
        const upB = qrotInv(fc.q, [0, 0, 1]);
        const e = cross([0, 0, 1], upB);                   // rotation (body) that would bring the nose to vertical
        const eU = Math.asin(Math.max(-1, Math.min(1, dot(e, U)))) * R2D;
        const eV = Math.asin(Math.max(-1, Math.min(1, dot(e, V)))) * R2D;
        const wU = dot(gyro, U) * R2D, wV = dot(gyro, V) * R2D;
        // thrust scheduling: same torque per degree of error whether the motor makes 29 N or 8 N
        const Test = Math.max(3, m * len(accl) * (C.thrust_schedule ? 1 : 0) || C.nominal_thrust_n);
        const sched = C.thrust_schedule ? Math.min(2.5, C.nominal_thrust_n / Test) : 1;
        fc.iU = Math.max(-hornLim, Math.min(hornLim, fc.iU + eU * C.ki * cdt));
        fc.iV = Math.max(-hornLim, Math.min(hornLim, fc.iV + eV * C.ki * cdt));
        // torque about an axis needs a gimbal swing about that same axis, opposite sign (tail kicks out)
        const dB = -(C.kp * eU + fc.iU - C.kd * wU) * sched;     // servo B -> about u
        const dA = -(C.kp * eV + fc.iV - C.kd * wV) * sched;     // servo A -> about v
        const lim = (x) => Math.max(-hornLim, Math.min(hornLim, x));
        const slew = P.servo_slew_dps * cdt;
        fc.cmdA += Math.max(-slew, Math.min(slew, lim(dA) - fc.cmdA));
        fc.cmdB += Math.max(-slew, Math.min(slew, lim(dB) - fc.cmdB));
        fc.eU = eU; fc.eV = eV;
      } else {
        const slew = P.servo_slew_dps * cdt;                  // centre the gimbal outside the burn
        fc.cmdA += Math.max(-slew, Math.min(slew, -fc.cmdA));
        fc.cmdB += Math.max(-slew, Math.min(slew, -fc.cmdB));
        const upB = qrotInv(fc.q, [0, 0, 1]);
        const e = cross([0, 0, 1], upB);
        fc.eU = Math.asin(Math.max(-1, Math.min(1, dot(e, U)))) * R2D;
        fc.eV = Math.asin(Math.max(-1, Math.min(1, dot(e, V)))) * R2D;
      }
    }
    if (t >= fc.nextPwm) {                       // a new 50 Hz PWM frame latches the command
      fc.nextPwm += 1 / P.pwm_hz;
      fc.latchedA = fc.cmdA; fc.latchedB = fc.cmdB;
    }
    // SG90 horns chase the latched pulse at their own top speed
    const hs = P.sg90_speed_dps * dt;
    fc.hornA += Math.max(-hs, Math.min(hs, fc.latchedA - fc.hornA));
    fc.hornB += Math.max(-hs, Math.min(hs, fc.latchedB - fc.hornB));
    fc.chuteHorn += Math.max(-hs, Math.min(hs, fc.chuteCmd - fc.chuteHorn));
    // the latch lets go once the chute horn has swung past the key; spring throws the nose
    if (chuteOpenAt === null && fc.chuteHorn - P.chute_stow_deg > P.chute_release_deg) {
      chuteOpenAt = t + P.chute_extract_s; ev("release", "Latch released, nose ejected");
    }
    if (chuteOpenAt !== null) noseOff = Math.min(1, noseOff + dt / 0.35);

    // ---------------- log (100 Hz)
    if (t >= fc.nextLog) {
      fc.nextLog += 1 / P.log_hz;
      const up = qrot(q, [0, 0, 1]);
      const tilt = Math.acos(Math.max(-1, Math.min(1, up[2]))) * R2D;
      if (!onPad && !chuteOpenAt) truth.maxTilt = Math.max(truth.maxTilt, t < tBurn ? tilt : truth.maxTilt);
      log.push({
        t, phase: fc.phase, thrust: T, mass: m * 1000,
        x: pos[0], y: pos[1], z: pos[2], alt, vz, speed: len(vel),
        q: [q[0], q[1], q[2], q[3]], tilt,
        baro: fc.baroRaw, altF: fc.altF, vzF: fc.vzF,
        ax: (fc.accl ? fc.accl[0] : 0) / G0, ay: (fc.accl ? fc.accl[1] : 0) / G0, az: (fc.accl ? fc.accl[2] : G0) / G0,
        gx: (fc.gyro ? fc.gyro[0] : 0) * R2D, gy: (fc.gyro ? fc.gyro[1] : 0) * R2D, gz: (fc.gyro ? fc.gyro[2] : 0) * R2D,
        eU: fc.eU || 0, eV: fc.eV || 0,
        hornA: fc.hornA, hornB: fc.hornB, gimA: hornToGimbal(fc.hornA, ARM, STUD), gimB: hornToGimbal(fc.hornB, ARM, STUD),
        usA: servoUs(90 + fc.latchedA), usB: servoUs(90 + fc.latchedB), usC: servoUs(fc.chuteCmd), chuteHorn: fc.chuteHorn,
        chute: chuteFrac, nose: noseOff, landed,
      });
    }

    if (landed && landedAt === null) landedAt = t;
    if (fc.phase === "LANDED" && t - (landedAt ?? t) > P.after_landing_s) break;
    t += dt;
  }

  return { log, events, truth: { ...truth, impulse: Itot, burnTime: tBurn }, params: { seed, wind, misalign: misalign * R2D, hornLim } };
}

function impulseUpTo(curve, t) {
  let I = 0, p = [0, 0];
  for (const q of curve) {
    if (q[0] >= t) { const f = p[1] + (q[1] - p[1]) * (t - p[0]) / (q[0] - p[0]); I += (t - p[0]) * (p[1] + f) / 2; return I; }
    I += (q[0] - p[0]) * (q[1] + p[1]) / 2; p = q;
  }
  return I;
}

// sample the log at time t (linear interpolation; quaternions nlerp)
export function sampleAt(log, t) {
  if (t <= log[0].t) return log[0];
  if (t >= log[log.length - 1].t) return log[log.length - 1];
  const dt = log[1].t - log[0].t;
  let i = Math.min(log.length - 2, Math.max(0, Math.floor((t - log[0].t) / dt)));
  while (i > 0 && log[i].t > t) i--;
  while (i < log.length - 2 && log[i + 1].t < t) i++;
  const a = log[i], b = log[i + 1], f = (t - a.t) / (b.t - a.t);
  const o = {};
  for (const k in a) {
    const va = a[k], vb = b[k];
    if (typeof va === "number") o[k] = va + (vb - va) * f;
    else o[k] = f < 0.5 ? va : vb;
  }
  let qb = b.q; if (a.q[0] * qb[0] + a.q[1] * qb[1] + a.q[2] * qb[2] + a.q[3] * qb[3] < 0) qb = qb.map((x) => -x);
  o.q = qnorm(a.q.map((x, j) => x + (qb[j] - x) * f));
  return o;
}

export { qrot, D2R, R2D };
