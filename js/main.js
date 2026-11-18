import { loadRocketAssets } from "./rig.js";
import { createModelView } from "./model-view.js";
import { createFlightView } from "./flight-view.js";
import { simulate } from "./sim.js";
import { LineChart } from "./charts.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const f1 = (x, d = 1) => (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toFixed(d);
const STATUS = {
  official: ["Official", "measured or confirmed"],
  cad: ["CAD", "computed from the v7 model"],
  spec: ["Datasheet", "manufacturer number"],
  sim: ["Sim", "tuned in this simulator"],
  estimate: ["Placeholder", "until the real number arrives"],
};

function segmented(el, attr, onPick) {
  el.addEventListener("click", (e) => {
    const b = e.target.closest(`button[data-${attr}]`); if (!b) return;
    $$("button", el).forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    onPick(b.dataset[attr]);
  });
}

const cfg = await fetch("data/rocket.json").then((r) => r.json());
for (const el of $$("[data-bind]")) el.textContent = cfg[el.dataset.bind];
for (const el of $$("[data-bind-href]")) el.href = cfg[el.dataset.bindHref];
document.title = cfg.name;

// ------------------------------------------------------------------ specs + systems (no WebGL needed)
const spec = (label) => cfg.specs.find((s) => s.label === label);
function renderSpecs() {
  $("#statusLegend").innerHTML = Object.entries(STATUS).map(([k, [n, d]]) => `<span><span class="pill ${k}">${n}</span> ${d}</span>`).join("");
  const groups = [...new Set(cfg.specs.map((s) => s.group))];
  $("#specTable").innerHTML = groups.map((g) => `<div class="spec-group"><h3>${g}</h3>${cfg.specs.filter((s) => s.group === g).map((s) => `
    <div class="spec-row"><span class="k">${s.label}</span><span class="v">${s.value}<small>${s.unit}</small></span>
    ${s.note ? `<span class="n">${s.note}</span>` : "<span></span>"}<span class="pill ${s.status}">${STATUS[s.status][0]}</span></div>`).join("")}</div>`).join("");
}
renderSpecs();

const ICONS = {
  tvc: '<svg viewBox="0 0 24 24"><path d="M12 3v9"/><path d="M8 21l4-9 4 9"/><path d="M5 9a7 7 0 0 1 14 0"/></svg>',
  cpu: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/></svg>',
  logic: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6.5 10.5l4-4M13.5 6.5l4 4M17.5 13.5l-4 4"/></svg>',
  chute: '<svg viewBox="0 0 24 24"><path d="M3 10a9 7 0 0 1 18 0"/><path d="M3 10l9 11 9-11M8 10l4 11 4-11"/></svg>',
  power: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
};
function renderSystems(run) {
  const S = cfg.sim, T = run?.truth, ev = (k) => run?.events.find((e) => e.key === k);
  const lag = (k) => { const e = ev(k); return e && e.truth != null ? `${Math.round((e.t - e.truth) * 1000)} ms` : "–"; };
  const cards = [
    { ico: "tvc", t: "Thrust vector control", p: "No fins, so the gimbal does all the steering while the motor burns. Two SG90s push the motor sleeve around a ball joint through pushrods at 45° and 135°.",
      rows: [["Gimbal range", "±6°"], ["Linkage", "1.89 : 1"], ["Control law", "PID, D on gyro"], ["Loop / servo frames", `${S.loop_hz} / ${S.pwm_hz} Hz`], ["Gains (servo °/°)", `${S.control.kp} · ${S.control.ki} · ${S.control.kd}`]] },
    { ico: "cpu", t: "Flight computer", p: "A XIAO ESP32-S3 reads an MPU6050 and a BMP280. Attitude is integrated from the gyro; the accelerometer only corrects it while it reads close to 1 g, so thrust can't drag the estimate.",
      rows: [["IMU", "MPU6050 ±16 g"], ["Barometer", "BMP280, 50 Hz"], ["Attitude filter", `complementary, ${S.comp_filter}`], ["Ground station", "Wi-Fi, in the browser"]] },
    { ico: "logic", t: "Flight logic", p: "Four checks move the flight computer through its states. Each one needs a few samples in a row, so one noisy reading can't trigger it.",
      states: [["BOOST", `axial accel > ${S.ignition_g} g × ${S.ignition_samples} samples`, lag("ignition")], ["COAST", `accel < ${S.burnout_g} g for ${S.burnout_samples * 1000 / S.loop_hz} ms`, lag("burnout")],
        ["DESCENT", `baro ${S.apogee_drop_m} m under its peak`, lag("apogee")], ["LANDED", `baro still for ${S.landed_hold_s} s at 1 g`, lag("landed")]] },
    { ico: "chute", t: "Recovery", p: "A third SG90 holds a latch key that hangs from the nose. At apogee its horn swings clear, the printed spring throws the nose and the canopy follows on the shock cord.",
      rows: [["Canopy", `${S.chute_diameter_mm} mm, Cd ${S.chute_cd}`], ["Latch servo", `${S.chute_stow_deg}° → ${S.chute_fire_deg}°`], ["Descent rate", T ? `${f1(T.landingSpeed)} m/s` : "–"], ["Drift", run ? `${f1(Math.hypot(run.log.at(-1).x, run.log.at(-1).y), 0)} m` : "–"]] },
    { ico: "power", t: "Power", p: "One 1S LiPo. A boost converter lifts it to 5 V for the servos. Three servos starting together can brown out the board, so the 5 V rail gets a big capacitor at the servo plugs.",
      rows: [["Battery", "1S 300 mAh"], ["Servo rail", "5 V boost"], ["Servo pulse", "500–2500 µs"]] },
  ];
  $("#systemCards").innerHTML = cards.map((c) => `<article class="card"><div class="ico">${ICONS[c.ico]}</div><h3>${c.t}</h3><p>${c.p}</p>
    ${c.rows ? `<ul>${c.rows.map(([k, v]) => `<li>${k}<b>${v}</b></li>`).join("")}</ul>` : ""}
    ${c.states ? `<ul class="states">${c.states.map(([s, w, l]) => `<li><span class="st">${s}</span><span class="why">${w} · detected ${l} after the real event</span></li>`).join("")}</ul>` : ""}
  </article>`).join("");
}

function renderHero(run) {
  const T = run.truth;
  const items = [
    [spec("Liftoff mass").value, "g", "liftoff mass"],
    ["D12", "", "Estes motor"],
    ["±6", "°", "gimbal"],
    [cfg.sim.loop_hz, "Hz", "control loop"],
    [f1(T.apogeeAlt, 0), "m", "simulated apogee"],
    [f1(T.maxV, 0), "m/s", "top speed"],
  ];
  $("#heroStats").innerHTML = items.map(([v, u, l]) => `<li><b>${v}<small>${u}</small></b><span>${l}</span></li>`).join("");
}

// ------------------------------------------------------------------ the simulation run + charts
let wind = cfg.sim.wind_mps, seed = cfg.sim.seed;
let run = simulate(cfg, { seed, wind });
renderHero(run); renderSystems(run);

const C1 = "var(--s1)", C2 = "var(--s2)", C3 = "var(--s3)";
const cssColor = (v) => getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim();
const series = (arr) => arr.map((s) => ({ ...s, color: cssColor(s.color) }));
const CHARTS = [
  { host: "#chartsSensors", title: "Barometer altitude", unit: "m", digits: 1, s: [
    { label: "True", key: "alt", color: C1 }, { label: "Raw", key: "baro", color: C2, thin: true }, { label: "Filtered", key: "altF", color: C3 }] },
  { host: "#chartsSensors", title: "Vertical speed", unit: "m/s", digits: 1, s: [
    { label: "True", key: "vz", color: C1 }, { label: "From baro", key: "vzF", color: C2 }] },
  { host: "#chartsSensors", title: "Accelerometer", unit: "g", digits: 2, s: [
    { label: "X", key: "ax", color: C1 }, { label: "Y", key: "ay", color: C2 }, { label: "Z (axial)", key: "az", color: C3 }] },
  { host: "#chartsSensors", title: "Gyroscope", unit: "°/s", digits: 1, s: [
    { label: "X", key: "gx", color: C1 }, { label: "Y", key: "gy", color: C2 }, { label: "Z (roll)", key: "gz", color: C3 }] },
  { host: "#chartsOutputs", title: "Tilt and attitude error", unit: "°", digits: 2, s: [
    { label: "Tilt", key: "tilt", color: C1 }, { label: "Error A", key: "eV", color: C2 }, { label: "Error B", key: "eU", color: C3 }] },
  { host: "#chartsOutputs", title: "Gimbal servo commands", unit: "µs", digits: 0, s: [
    { label: "Servo A", key: "usA", color: C1 }, { label: "Servo B", key: "usB", color: C2 }] },
  { host: "#chartsOutputs", title: "Gimbal deflection", unit: "°", digits: 2, s: [
    { label: "Axis A", key: "gimA", color: C1 }, { label: "Axis B", key: "gimB", color: C2 }] },
  { host: "#chartsOutputs", title: "Chute servo command", unit: "µs", digits: 0, s: [
    { label: "Latch", key: "usC", color: C1 }] },
];
const charts = CHARTS.map((d) => {
  const el = document.createElement("figure"); el.style.margin = 0; $(d.host).appendChild(el);
  const c = new LineChart(el, { title: d.title, unit: d.unit, series: series(d.s), digits: d.digits });
  c.def = d; return c;
});
let winMode = "all";
function windowFor(m) {
  const L = run.log, ev = (k) => run.events.find((e) => e.key === k)?.t, end = L.at(-1).t;
  if (m === "boost") return [-0.3, (ev("burnout") ?? 1.7) + 0.6];
  if (m === "apogee") { const a = ev("apogee") ?? 4; return [a - 2.0, a + 3.0]; }
  if (m === "landing") { const l = run.truth.landing ?? end; return [l - 4, end]; }
  return [L[0].t, end];
}
function feedCharts() {
  const L = run.log, t = Float64Array.from(L, (s) => s.t);
  const ev = (k) => run.events.find((e) => e.key === k)?.t;
  const bands = [
    { t0: ev("ignition") ?? 0, t1: ev("burnout") ?? 1.7, label: "BURN", fill: "--band-boost" },
    { t0: ev("deploy") ?? 5, t1: ev("landed") ?? L.at(-1).t, label: "UNDER CANOPY", fill: "--band-desc" },
  ];
  const events = run.events.filter((e) => e.key !== "release" && e.key !== "deploy");
  for (const c of charts) {
    c.setBands(bands); c.setEvents(events);
    c.win = windowFor(winMode);
    c.setData(t, c.def.s.map((s) => Float64Array.from(L, (x) => x[s.key])));
  }
}
feedCharts();
segmented($("#winSeg"), "win", (m) => { winMode = m; const w = windowFor(m); charts.forEach((c) => c.setWindow(...w)); });

// ------------------------------------------------------------------ timeline, HUD, summary
const EVENT_ORDER = [["ignition", "Ignition detected"], ["burnout", "Burnout"], ["apogee", "Apogee"], ["release", "Chute out"], ["landed", "Landed"]];
function renderTimeline() {
  const L = run.log, t0 = L[0].t, t1 = L.at(-1).t, x = (t) => ((t - t0) / (t1 - t0)) * 100;
  const segs = []; let cur = L[0].phase, start = t0;
  for (const s of L) if (s.phase !== cur) { segs.push([cur, start, s.t]); cur = s.phase; start = s.t; }
  segs.push([cur, start, t1]);
  $("#tlTrack").innerHTML = segs.filter(([p]) => p !== "PAD").map(([p, a, b]) => `<div class="tl-seg ${p}" style="left:${x(a)}%;width:${x(b) - x(a)}%"></div>`).join("") +
    (() => { let lastX = -99; return EVENT_ORDER.map(([k, n]) => { const e = run.events.find((e) => e.key === k); if (!e) return "";
      const px = x(e.t), lbl = px - lastX > 7 ? `<span>${n.split(" ")[0]}</span>` : ""; if (lbl) lastX = px;
      return `<div class="tl-ev" style="left:${px}%">${lbl}</div>`; }).join(""); })();
  $("#hudEvents").innerHTML = EVENT_ORDER.map(([k, n]) => { const e = run.events.find((e) => e.key === k);
    return `<li data-k="${k}"><span>${n}</span><small>${e ? "T+" + e.t.toFixed(2) : "–"}</small></li>`; }).join("");
  const T = run.truth, ign = run.events.find((e) => e.key === "ignition");
  $("#summary").innerHTML = `<span>Apogee<b>${f1(T.apogeeAlt)} m</b></span><span>Top speed<b>${f1(T.maxV)} m/s</b></span>
    <span>Max tilt in burn<b>${f1(T.maxTilt)}°</b></span><span>Ignition seen<b>+${Math.round(ign.t * 1000)} ms</b></span>
    <span>Flight<b>${f1(T.landing ?? 0)} s</b></span>`;
}
renderTimeline();

const gaugeDefs = [
  ["Altitude", (s) => f1(s.alt), "m"], ["Speed", (s) => f1(s.speed), "m/s"], ["Thrust", (s) => f1(s.thrust), "N"],
  ["Tilt", (s) => f1(s.tilt), "°"], ["Gimbal A", (s) => f1(s.gimA, 2), "°"], ["Gimbal B", (s) => f1(s.gimB, 2), "°"],
  ["Servo A", (s) => f1(s.usA, 0), "µs"], ["Servo B", (s) => f1(s.usB, 0), "µs"], ["Chute", (s) => f1(s.usC, 0), "µs"],
];
$("#hudGauges").innerHTML = gaugeDefs.map(([n]) => `<div><dt>${n}</dt><dd>–</dd></div>`).join("");
const gaugeEls = $$("#hudGauges dd");

let toastTimer = 0;
function toast(e) {
  const lag = e.truth != null ? `${Math.round((e.t - e.truth) * 1000)} ms after the real event` : "";
  const el = $("#toast");
  const NOTE = { ignition: "TVC loop takes over", burnout: "Gimbal centres. No thrust means no steering, so the finless airframe flips",
    apogee: "Latch horn swings, spring throws the nose", landed: "Chute servo back to safe" };
  el.innerHTML = `<b>${e.label}</b>${NOTE[e.key] ? `<span>${NOTE[e.key]}</span>` : ""}<small>T+${e.t.toFixed(3)} s${lag ? " · " + lag : ""}</small>`;
  el.hidden = false; el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

// ------------------------------------------------------------------ the 3D windows
const assets = await loadRocketAssets(".");
$("#modelLoading").classList.add("done");

const readout = $("#modelReadout");
const model = createModelView({
  canvas: $("#modelCanvas"), overlay: $("#modelOverlay"), tooltip: $("#modelTip"),
  onReadout(r) {
    let cells;
    if (r.mode === "recovery") cells = [["Latch horn", `${f1(r.latch, 0)}°`], ["Chute servo", `${f1(r.usC, 0)} µs`], ["Canopy", `${f1(r.chute * 100, 0)}%`]];
    else cells = [["Gimbal A", `${f1(r.gA)}°`], ["Gimbal B", `${f1(r.gB)}°`], ["Servo A", `${f1(r.usA, 0)} µs`], ["Servo B", `${f1(r.usB, 0)} µs`]];
    readout.innerHTML = cells.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
  },
  onCaption(text, sub) { $("#modelCaption").innerHTML = `<b>${sub[0].toUpperCase() + sub.slice(1)}.</b> ${text}`; },
  onMode(m, sub) { $$("#modeSeg button").forEach((b) => b.classList.toggle("touring", m === "tour" && b.dataset.mode === sub)); },
}, assets);
segmented($("#modeSeg"), "mode", (m) => model.setMode(m));
segmented($("#tubeSeg"), "tube", (m) => model.setTube(m));

const scrub = $("#scrub");
let lastPhase = "", scrubbing = false;
const flight = createFlightView({
  canvas: $("#flightCanvas"),
  onFrame(s, t) {
    $("#hudClock").textContent = `T${t >= 0 ? "+" : "−"}${Math.abs(t).toFixed(2)}`;
    if (s.phase !== lastPhase) { const p = $("#hudPhase"); p.textContent = s.phase; p.dataset.phase = s.phase; lastPhase = s.phase; }
    gaugeDefs.forEach(([, fn, u], i) => { gaugeEls[i].innerHTML = `${fn(s)}<small>${u}</small>`; });
    for (const li of $$("#hudEvents li")) { const e = run.events.find((e) => e.key === li.dataset.k); li.classList.toggle("done", !!e && e.t <= t); }
    const L = run.log; if (!scrubbing) scrub.value = Math.round(((t - L[0].t) / (L.at(-1).t - L[0].t)) * 1000);
    for (const c of charts) c.setTime(t);
  },
  onEvent(e) { if (e.key !== "release" && e.key !== "deploy") toast(e); },
  onEnd() { setPlayIcon(false); },
}, assets, cfg);
flight.load(run);

const playBtn = $("#playBtn");
function setPlayIcon(p) {
  playBtn.innerHTML = p ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>';
  playBtn.setAttribute("aria-label", p ? "Pause" : "Play");
}
playBtn.addEventListener("click", () => { if (flight.playing) flight.pause(); else flight.play(); setPlayIcon(flight.playing); });
scrub.addEventListener("input", () => { scrubbing = true; const L = run.log; flight.seek(L[0].t + (scrub.value / 1000) * (L.at(-1).t - L[0].t)); });
scrub.addEventListener("change", () => { scrubbing = false; });
for (const c of charts) c.onSeek = (t) => flight.seek(t);
segmented($("#speedSeg"), "speed", (v) => flight.setSpeed(v === "auto" ? "auto" : Number(v)));
segmented($("#camSeg"), "cam", (m) => flight.setCamera(m));

function rerun() {
  const wasPlaying = flight.playing;
  run = simulate(cfg, { seed, wind });
  feedCharts(); renderTimeline(); renderHero(run); renderSystems(run);
  flight.load(run);
  if (wasPlaying) flight.play();
}
let windTimer = 0;
$("#wind").addEventListener("input", (e) => {
  wind = Number(e.target.value); $("#windOut").textContent = `${wind.toFixed(1)} m/s`;
  clearTimeout(windTimer); windTimer = setTimeout(rerun, 160);
});
$("#gustBtn").addEventListener("click", () => { seed += 1; rerun(); });

$("#csvBtn").addEventListener("click", () => {
  const keys = ["t", "phase", "alt", "baro", "altF", "vz", "vzF", "speed", "thrust", "mass", "ax", "ay", "az", "gx", "gy", "gz", "tilt", "eU", "eV", "gimA", "gimB", "usA", "usB", "usC", "x", "y"];
  const rows = [keys.join(",")].concat(run.log.map((s) => keys.map((k) => (typeof s[k] === "number" ? +s[k].toFixed(4) : s[k])).join(",")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
  a.download = `tvc-flight-seed${seed}-wind${wind}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// start the replay the first time the sim window comes into view
let started = false;
new IntersectionObserver(([e]) => {
  if (e.isIntersecting && !started) { started = true; flight.play(); setPlayIcon(true); }
}, { threshold: 0.5 }).observe($("#flightCanvas"));

window.__tvc = { cfg, get run() { return run; }, flight, model, charts };
