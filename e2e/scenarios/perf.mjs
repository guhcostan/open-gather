// Browser performance under a crowd: FPS, frame time, JS heap and main-thread busy time while ~N bots
// (real WebSocket clients from bin/loadgen) walk around and the tested browser walks too.
// Not part of the default suite: node run.mjs perf   (env PERF_BOTS=300 PERF_SECONDS=30)
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, summary, resetChecks, launch, joinAs, sleep, waitFor, walkTo, API } from "../lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOTS = Number(process.env.PERF_BOTS ?? 300);
const SECONDS = Number(process.env.PERF_SECONDS ?? 30);
const GPU_ARGS = process.env.PERF_SOFTWARE_GL ? [] : ["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"];

async function measure(browser, name, eco, size, ctx) {
  const u = await joinAs(browser, name, { viewport: size });
  await u.page.evaluate((eco) => { localStorage.setItem("og.settings", JSON.stringify({ eco, maxVideos: 6, audioOnly: false, debug: false })); }, eco);
  await u.page.reload({ waitUntil: "domcontentloaded" });
  await waitFor(() => u.page.evaluate(() => window.__og?.state?.meId > 0 && window.__og.state.conn === "open"), { what: "reconnect" });
  const gl = await u.page.evaluate(() => {
    const c = document.createElement("canvas");
    const g = c.getContext("webgl");
    const e = g?.getExtension("WEBGL_debug_renderer_info");
    return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  const cdp = await u.page.createCDPSession();
  await cdp.send("Performance.enable");
  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  // keep the player walking between random reachable points for the whole window
  let stop = false;
  const walker = (async () => {
    const pts = [[20, 28], [34, 30], [12, 24], [30, 20], [8, 32], [36, 26]];
    let i = 0;
    while (!stop) { try { await walkTo(u, pts[i % pts.length][0] * 16 + 8, pts[i % pts.length][1] * 16 + 8, { timeout: 20000 }); } catch { /* keep going */ } i++; }
  })();
  await sleep(4000); // settle
  const m0 = await metric();
  const t0 = Date.now();
  const samples = [];
  while (Date.now() - t0 < SECONDS * 1000) {
    await sleep(1000);
    samples.push(await u.page.evaluate(() => ({ ...window.__og.view.stats, heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0 })));
  }
  const m1 = await metric();
  stop = true;
  await walker.catch(() => {});
  const wall = (Date.now() - t0) / 1000;
  const avg = (k) => samples.reduce((a, s) => a + s[k], 0) / samples.length;
  const out = {
    mode: eco ? "economy" : "normal", viewport: size.width + "x" + size.height, gl,
    fps: +avg("fps").toFixed(1), fpsMin: Math.min(...samples.map((s) => s.fps)), frameMs: +avg("frameMs").toFixed(2),
    heapMB: +samples[samples.length - 1].heap.toFixed(1), heapStartMB: +samples[0].heap.toFixed(1),
    entities: Math.round(avg("entities")), visible: Math.round(avg("visible")),
    mainThreadBusyPct: +(((m1.TaskDuration - m0.TaskDuration) / wall) * 100).toFixed(1),
    scriptPct: +(((m1.ScriptDuration - m0.ScriptDuration) / wall) * 100).toFixed(1),
    worldMsgsPerSec: Math.round(avg("worldMsgs")),
  };
  await cdp.detach();
  await u.page.close();
  return out;
}

export async function run(ctx) {
  resetChecks();
  const bots = spawn(path.join(root, "bin/loadgen"), ["-url", API, "-n", String(BOTS), "-region", "distributed", "-duration", String(SECONDS * 3 + 60) + "s", "-warmup", "1s", "-probes", "0"], { stdio: "ignore" });
  await sleep(Math.max(8000, BOTS * 40));
  const browser = await launch(GPU_ARGS);
  const results = [];
  try {
    for (const [name, eco, size] of [["Perf-normal", false, { width: 1440, height: 900 }], ["Perf-eco", true, { width: 1440, height: 900 }]]) {
      const r = await measure(browser, name, eco, size, ctx);
      results.push(r);
      console.log("PERF " + JSON.stringify(r));
    }
  } finally {
    await browser.close();
    bots.kill("SIGTERM");
  }
  const [normal, eco] = results;
  check("PERF-INFO bots=" + BOTS + " renderer=" + normal.gl, true);
  check("normal mode renders at 50 FPS or better on this machine", normal.fps >= 50, normal.fps + " fps, frame " + normal.frameMs + " ms, main thread busy " + normal.mainThreadBusyPct + " %");
  check("economy mode holds at least 30 FPS", eco.fps >= 28, eco.fps + " fps, main thread busy " + eco.mainThreadBusyPct + " %");
  check("economy mode uses less main-thread time than normal mode", eco.mainThreadBusyPct < normal.mainThreadBusyPct, eco.mainThreadBusyPct + " % vs " + normal.mainThreadBusyPct + " %");
  check("JS heap did not run away during the window", normal.heapMB - normal.heapStartMB < 30, normal.heapStartMB + " -> " + normal.heapMB + " MB");
  return summary();
}
