// Headless run of the flight simulation: prints the event timeline and the numbers that matter.
//   node tools/sim-check.mjs [seed] [wind m/s]
import { readFileSync } from "node:fs";
import { simulate, impulse } from "../js/sim.js";

const cfg = JSON.parse(readFileSync(new URL("../data/rocket.json", import.meta.url)));
const seed = Number(process.argv[2] ?? cfg.sim.seed), wind = Number(process.argv[3] ?? cfg.sim.wind_mps);
const t0 = performance.now();
const r = simulate(cfg, { seed, wind });
const ms = performance.now() - t0;
const L = r.log, T = r.truth;
const f = (x, d = 2) => (x == null ? "-" : x.toFixed(d));
console.log(`seed ${seed}, wind ${wind} m/s, ${L.length} samples, ${ms.toFixed(0)} ms`);
console.log(`impulse ${f(impulse(cfg.motor.curve))} N s, liftoff T+${f(T.liftoff, 3)}, apogee ${f(T.apogeeAlt, 1)} m @ T+${f(T.apogee)}, max speed ${f(T.maxV, 1)} m/s`);
console.log(`max tilt during burn ${f(T.maxTilt, 1)} deg, landing T+${f(T.landing)} at ${f(T.landingSpeed, 1)} m/s`);
for (const e of r.events) console.log(`  ${e.label.padEnd(30)} T+${f(e.t, 3)}${e.truth != null ? `   (truth T+${f(e.truth, 3)}, lag ${f((e.t - e.truth) * 1000, 0)} ms)` : ""}`);
const last = L[L.length - 1];
console.log(`drift ${f(Math.hypot(last.x, last.y), 1)} m, final phase ${last.phase}`);
const burn = L.filter((s) => s.t > 0.1 && s.t < 1.6);
const pk = (k) => Math.max(...burn.map((s) => Math.abs(s[k])));
console.log(`burn: |gimA| max ${f(pk("gimA"))} deg, |gimB| max ${f(pk("gimB"))} deg, |eU| ${f(pk("eU"))}, |eV| ${f(pk("eV"))}, |gx| ${f(pk("gx"))} dps`);
// coarse trace
for (const s of L.filter((_, i) => i % 50 === 0)) {
  if (s.t > 12 && Math.round(s.t * 2) % 6) continue;
  console.log(`${f(s.t).padStart(6)} ${s.phase.padEnd(7)} alt ${f(s.alt, 1).padStart(6)} vz ${f(s.vz, 1).padStart(6)} tilt ${f(s.tilt, 1).padStart(5)} gA ${f(s.gimA).padStart(5)} gB ${f(s.gimB).padStart(5)} az ${f(s.az).padStart(6)} chute ${f(s.chute)}`);
}
