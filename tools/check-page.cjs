// Headless check of the site: console errors, both WebGL windows, charts. Screenshots to argv[2].
//   node tools/check-page.cjs <outdir> [url]
const path = require("path");
let puppeteer;
try { puppeteer = require("puppeteer"); } catch { puppeteer = require(process.env.PUPPETEER_PATH); }   // any local Puppeteer install
const out = process.argv[2] || ".";
const url = process.argv[3] || "http://127.0.0.1:5391/index.html";
(async () => {
  const browser = await puppeteer.launch({ headless: "new", protocolTimeout: 120000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl"] });
  const page = await browser.newPage();
  const msgs = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) msgs.push(`${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => msgs.push("pageerror: " + e.message));
  page.on("requestfailed", (r) => msgs.push("failed: " + r.url()));
  await page.setViewport({ width: Number(process.env.W || 1400), height: Number(process.env.H || 900), deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 90000 });
  try { await page.waitForFunction(() => window.__tvc && document.querySelector("#modelLoading.done"), { timeout: 60000 }); }
  catch (e) { await page.screenshot({ path: path.join(out, "00-fail.png") }); console.log(msgs.join(" | ") || "no messages"); throw e; }
  await new Promise((r) => setTimeout(r, 2500));
  const shot = async (sel, name) => { const el = await page.$(sel); await el.screenshot({ path: path.join(out, name) }); };
  await page.screenshot({ path: path.join(out, "00-top.png") });
  const mode = process.env.MODE;
  if (mode) { await page.click(`#modeSeg button[data-mode="${mode}"]`); await new Promise((r) => setTimeout(r, Number(process.env.WAIT || 3000))); await shot("#model", `01-model-${mode}.png`); }
  await page.evaluate(() => document.querySelector("#sim").scrollIntoView());
  for (const [t, name] of (process.env.TIMES || "0.5,2.0,6.0,27.0").split(",").map((t, i) => [Number(t), `02-sim-${i}.png`])) {
    await page.evaluate((t) => { window.__tvc.flight.pause(); window.__tvc.flight.seek(t); }, t);
    await new Promise((r) => setTimeout(r, 900));
    await shot("#sim .stage", name);
  }
  // real-time playback: the chase camera must keep the rocket in frame during the burn
  await page.evaluate(() => { window.__tvc.flight.setSpeed(1); window.__tvc.flight.seek(-0.2); window.__tvc.flight.play(); });
  await new Promise((r) => setTimeout(r, 1300));
  await shot("#sim .stage", "02-sim-playing.png");
  const tPlay = await page.evaluate(() => window.__tvc.flight.time);
  console.log("playing, t =", tPlay.toFixed(2));
  await page.evaluate(() => window.__tvc.flight.pause());
  await page.evaluate(() => document.querySelector("#chartsSensors").scrollIntoView());
  await new Promise((r) => setTimeout(r, 500));
  await shot("#sim", "03-sim-full.png");
  const info = await page.evaluate(() => ({ events: window.__tvc.run.events.map((e) => `${e.key}@${e.t.toFixed(2)}`).join(" "),
    gl: !!document.querySelector("#modelCanvas").getContext, charts: window.__tvc.charts.length, docH: document.body.scrollHeight, overflowX: document.documentElement.scrollWidth > innerWidth }));
  console.log(JSON.stringify(info));
  console.log(msgs.length ? msgs.join("\n") : "no console errors");
  await browser.close();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
