// Layout check: full-page screenshots at desktop and phone width, plus horizontal-overflow test.
//   node tools/check-layout.cjs <outdir> [url]
const path = require("path");
let puppeteer;
try { puppeteer = require("puppeteer"); } catch { puppeteer = require(process.env.PUPPETEER_PATH); }   // any local Puppeteer install
const out = process.argv[2] || ".";
const url = process.argv[3] || "http://127.0.0.1:5391/index.html";
(async () => {
  const browser = await puppeteer.launch({ headless: "new", protocolTimeout: 120000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  for (const [w, h, name, mobile] of [[1400, 900, "desktop", false], [390, 844, "phone", true]]) {
    const page = await browser.newPage();
    const msgs = [];
    page.on("pageerror", (e) => msgs.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") msgs.push(m.text()); });
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    await page.goto(url, { waitUntil: "networkidle0", timeout: 90000 });
    await page.waitForFunction(() => window.__tvc && document.querySelector("#modelLoading.done"), { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    const over = await page.evaluate(() => {
      const wide = [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== "fixed")
        .slice(0, 6).map((e) => `${e.tagName}.${e.className}`);
      return { scrollW: document.documentElement.scrollWidth, innerW: innerWidth, wide };
    });
    console.log(name, JSON.stringify(over), msgs.join(" | ") || "no errors");
    if (name === "phone") {
      await page.screenshot({ path: path.join(out, `layout-${name}-top.png`) });
      await page.evaluate(() => document.querySelector("#sim").scrollIntoView());
      await new Promise((r) => setTimeout(r, 2500));
      await page.screenshot({ path: path.join(out, `layout-${name}-sim.png`) });
      await page.evaluate(() => document.querySelector("#chartsSensors").scrollIntoView());
      await new Promise((r) => setTimeout(r, 600));
      await page.screenshot({ path: path.join(out, `layout-${name}-charts.png`) });
    }
    await page.evaluate(() => document.querySelector("#systems").scrollIntoView());
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(out, `layout-${name}-systems.png`) });
    await page.evaluate(() => document.querySelector("#specs").scrollIntoView());
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(out, `layout-${name}-specs.png`) });
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
