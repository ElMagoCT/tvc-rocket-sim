// Small canvas line charts for the flight log: shared time window, phase bands, event lines,
// a playhead synced to the 3D replay, hover crosshair + tooltip, click to seek. No library.

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => span / s <= n + 0.5) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return { ticks: out, step };
}
const fmt = (v, step) => {
  const d = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  return v.toFixed(d).replace(/^-0(\.0+)?$/, "0");
};

export class LineChart {
  constructor(host, { title, unit, series, digits = 1, fixed = null }) {
    this.series = series; this.unit = unit; this.digits = digits; this.fixed = fixed;
    host.classList.add("chart");
    host.innerHTML = `
      <header><h4>${title} <small>${unit}</small></h4><ul class="legend"></ul></header>
      <div class="plot"><canvas class="base"></canvas><canvas class="over"></canvas><div class="tip" hidden></div></div>`;
    this.host = host;
    this.legend = host.querySelector(".legend");
    this.legendVals = series.map((s) => {
      const li = document.createElement("li");
      li.innerHTML = `<i style="--c:${s.color}" class="${s.thin ? "thin" : ""}"></i>${s.label} <b>–</b>`;
      this.legend.appendChild(li);
      return li.querySelector("b");
    });
    this.plot = host.querySelector(".plot");
    this.base = host.querySelector(".base"); this.over = host.querySelector(".over");
    this.tip = host.querySelector(".tip");
    this.t = null; this.cols = []; this.bands = []; this.events = []; this.win = [0, 1]; this.now = 0; this.hoverX = null;
    this.m = { l: 46, r: 10, t: 10, b: 22 };
    new ResizeObserver(() => this.resize()).observe(this.plot);
    this.plot.addEventListener("pointermove", (e) => { this.hoverX = e.offsetX; this.drawOverlay(); });
    this.plot.addEventListener("pointerleave", () => { this.hoverX = null; this.tip.hidden = true; this.drawOverlay(); });
    this.plot.addEventListener("click", (e) => this.onSeek?.(this.xToT(e.offsetX)));
  }
  setData(t, cols) { this.t = t; this.cols = cols; this.draw(); }
  setBands(b) { this.bands = b; }
  setEvents(e) { this.events = e; }
  setWindow(a, b) { this.win = [a, b]; this.draw(); }
  setTime(t) {
    this.now = t;
    const i = this.idx(t);
    if (i != null) this.series.forEach((s, k) => { this.legendVals[k].textContent = this.cols[k][i].toFixed(this.digits); });
    this.drawOverlay();
  }
  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1), w = this.plot.clientWidth, h = this.plot.clientHeight;
    for (const c of [this.base, this.over]) { c.width = w * dpr; c.height = h * dpr; c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0); }
    this.W = w; this.H = h; this.draw();
  }
  xToT(x) { const { l, r } = this.m; return this.win[0] + (x - l) / (this.W - l - r) * (this.win[1] - this.win[0]); }
  tToX(t) { const { l, r } = this.m; return l + (t - this.win[0]) / (this.win[1] - this.win[0]) * (this.W - l - r); }
  yToPx(v) { const { t, b } = this.m; return t + (1 - (v - this.y0) / (this.y1 - this.y0)) * (this.H - t - b); }
  idx(t) {
    const T = this.t; if (!T || !T.length) return null;
    let lo = 0, hi = T.length - 1;
    if (t <= T[0]) return 0; if (t >= T[hi]) return hi;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] < t) lo = m; else hi = m; }
    return t - T[lo] < T[hi] - t ? lo : hi;
  }
  draw() {
    if (!this.t || !this.W) return;
    const g = this.base.getContext("2d"), { l, r, t: mt, b } = this.m, W = this.W, H = this.H;
    g.clearRect(0, 0, W, H);
    const [a, z] = this.win, i0 = Math.max(0, this.idx(a) - 1), i1 = Math.min(this.t.length - 1, this.idx(z) + 1);
    // y range over the visible window
    let lo = Infinity, hi = -Infinity;
    if (this.fixed) [lo, hi] = this.fixed;
    else for (const c of this.cols) for (let i = i0; i <= i1; i++) { const v = c[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const { ticks, step } = niceTicks(lo, hi, this.H < 150 ? 3 : 4);
    this.y0 = lo; this.y1 = hi; this.step = step;
    const ink2 = css("--muted"), grid = css("--grid"), band = (k) => css(k);
    // phase bands
    for (const bd of this.bands) {
      const x0 = Math.max(l, this.tToX(bd.t0)), x1 = Math.min(W - r, this.tToX(bd.t1));
      if (x1 <= x0) continue;
      g.fillStyle = band(bd.fill); g.fillRect(x0, mt, x1 - x0, H - mt - b);
      if (x1 - x0 > 46) { g.fillStyle = css("--faint"); g.font = "600 9px Inter, system-ui"; g.fillText(bd.label, x0 + 5, mt + 11); }
    }
    // grid + y labels
    g.font = "10.5px 'JetBrains Mono', ui-monospace, monospace"; g.textBaseline = "middle";
    for (const v of ticks) {
      const y = this.yToPx(v);
      g.strokeStyle = Math.abs(v) < step / 2 ? css("--grid-strong") : grid; g.lineWidth = 1;
      g.beginPath(); g.moveTo(l, Math.round(y) + 0.5); g.lineTo(W - r, Math.round(y) + 0.5); g.stroke();
      g.fillStyle = ink2; g.textAlign = "right"; g.fillText(fmt(v, step), l - 6, y);
    }
    // x labels
    const xt = niceTicks(a, z, Math.max(3, Math.floor((W - l - r) / 80)));
    g.textAlign = "center"; g.textBaseline = "top";
    for (const v of xt.ticks) { const x = this.tToX(v); if (x < l + 8 || x > W - r - 4) continue; g.fillStyle = ink2; g.fillText(fmt(v, xt.step) + "s", x, H - b + 6); }
    // events
    g.setLineDash([3, 4]); g.strokeStyle = css("--grid-strong");
    for (const e of this.events) { const x = this.tToX(e.t); if (x < l || x > W - r) continue; g.beginPath(); g.moveTo(x + 0.5, mt); g.lineTo(x + 0.5, H - b); g.stroke(); }
    g.setLineDash([]);
    // series
    g.save(); g.beginPath(); g.rect(l, mt, W - l - r, H - mt - b); g.clip();
    g.lineJoin = "round"; g.lineCap = "round";
    this.series.forEach((s, k) => {
      const c = this.cols[k];
      g.strokeStyle = s.color; g.globalAlpha = s.thin ? 0.55 : 1; g.lineWidth = s.thin ? 1 : 2;
      g.beginPath();
      // min/max per pixel column keeps noise honest without drawing thousands of overlapping segments
      let px = -1, mn = 0, mx = 0, first = true;
      const flush = () => { if (px < 0) return; const y1 = this.yToPx(mn), y2 = this.yToPx(mx);
        if (first) { g.moveTo(px, y1); first = false; } else g.lineTo(px, y1); if (y2 !== y1) g.lineTo(px, y2); };
      for (let i = i0; i <= i1; i++) {
        const x = Math.round(this.tToX(this.t[i]) * 2) / 2, v = c[i];
        if (x !== px) { flush(); px = x; mn = mx = v; } else { if (v < mn) mn = v; if (v > mx) mx = v; }
      }
      flush(); g.stroke();
    });
    g.restore(); g.globalAlpha = 1;
    this.drawOverlay();
  }
  drawOverlay() {
    if (!this.W) return;
    const g = this.over.getContext("2d"), { l, r, t: mt, b } = this.m, W = this.W, H = this.H;
    g.clearRect(0, 0, W, H);
    const x = this.tToX(this.now);
    if (x >= l && x <= W - r) {
      g.strokeStyle = css("--text"); g.globalAlpha = 0.7; g.lineWidth = 1;
      g.beginPath(); g.moveTo(Math.round(x) + 0.5, mt); g.lineTo(Math.round(x) + 0.5, H - b); g.stroke(); g.globalAlpha = 1;
    }
    if (this.hoverX == null || !this.t) return;
    const hx = Math.max(l, Math.min(W - r, this.hoverX)), ht = this.xToT(hx), i = this.idx(ht);
    g.strokeStyle = css("--muted"); g.setLineDash([2, 3]);
    g.beginPath(); g.moveTo(Math.round(hx) + 0.5, mt); g.lineTo(Math.round(hx) + 0.5, H - b); g.stroke(); g.setLineDash([]);
    const sx = this.tToX(this.t[i]);
    const rows = this.series.map((s, k) => {
      const v = this.cols[k][i], y = this.yToPx(v);
      if (y >= mt && y <= H - b) {
        g.fillStyle = css("--panel"); g.beginPath(); g.arc(sx, y, 5, 0, Math.PI * 2); g.fill();
        g.fillStyle = s.color; g.beginPath(); g.arc(sx, y, 3.5, 0, Math.PI * 2); g.fill();
      }
      return `<div><i style="--c:${s.color}"></i>${s.label}<b>${v.toFixed(this.digits)}</b></div>`;
    }).join("");
    this.tip.innerHTML = `<div class="tt">T${this.t[i] >= 0 ? "+" : "−"}${Math.abs(this.t[i]).toFixed(2)} s</div>${rows}`;
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth;
    this.tip.style.transform = `translate(${hx + 12 + tw > W ? hx - tw - 12 : hx + 12}px, ${mt + 4}px)`;
  }
}
