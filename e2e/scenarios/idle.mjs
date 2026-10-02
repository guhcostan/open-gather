// Render on demand: an idle office is not redrawn 60 times a second, and anything that changes on
// screen is still drawn at once. Reports frames drawn and the renderer + GPU process CPU time.
import { check, resetChecks, summary, launch, joinAs, walkTo, sleep } from "../lib.mjs";

const read = (u, fn, ...args) => u.page.evaluate(fn, ...args);

/** CPU seconds of every renderer and GPU process (CDP SystemInfo), summed. */
async function cpu(browser) {
  const s = await browser.target().createCDPSession();
  const { processInfo } = await s.send("SystemInfo.getProcessInfo");
  await s.detach();
  const out = { renderer: 0, GPU: 0 };
  for (const p of processInfo) if (p.type in out) out[p.type] += p.cpuTime;
  return out;
}

async function window_(browser, u, ms, during = async () => {}) {
  const c0 = await cpu(browser);
  const n0 = await read(u, () => window.__tilework.view.rendersTotal);
  const t0 = Date.now();
  await during();
  const left = ms - (Date.now() - t0);
  if (left > 0) await sleep(left);
  const secs = (Date.now() - t0) / 1000;
  const c1 = await cpu(browser);
  const n1 = await read(u, () => window.__tilework.view.rendersTotal);
  return { draws: (n1 - n0) / secs, renderer: ((c1.renderer - c0.renderer) / secs) * 100, gpu: ((c1.GPU - c0.GPU) / secs) * 100 };
}

export async function run() {
  resetChecks();
  const browser = await launch();
  try {
    const a = await joinAs(browser, "Still" + (Date.now() % 10000));
    const b = await joinAs(browser, "Mover" + (Date.now() % 10000));
    await walkTo(a, 8 * 16 + 8, 28 * 16 + 8);
    await walkTo(b, 12 * 16 + 8, 28 * 16 + 8);
    await sleep(1500);
    const idle = await window_(browser, a, 8000);
    check("an idle office is drawn a few times a second, not every frame", idle.draws <= 6, idle.draws.toFixed(1) + " draws/s; CPU renderers " + idle.renderer.toFixed(1) + " %, GPU " + idle.gpu.toFixed(1) + " % (both pages)");
    const fps = await read(a, () => window.__tilework.view.stats.fps);
    check("the frame loop itself keeps running (input, extrapolation)", fps >= 25, fps + " fps");
    // somebody else walking in view is drawn every frame
    const shot0 = await a.page.screenshot({ encoding: "base64" });
    // frame by frame on the observer: every frame where the other person's sprite moved or changed
    // picture must have been drawn (rAF callbacks run before Pixi's ticker, so look one frame back)
    const watch = read(a, (id) => new Promise((resolve) => {
      const v = window.__tilework.view;
      let seen = 0, drawn = 0, last = v.rendersTotal, prev = "";
      const t0 = performance.now();
      const tick = (now) => {
        const e = v.ents.get(id);
        const cur = e ? e.spr.x + "," + e.spr.y + "," + e.spr.texture.uid : "";
        if (prev && cur !== prev) { seen++; if (v.rendersTotal !== last) drawn++; }
        prev = cur;
        last = v.rendersTotal;
        if (now - t0 < 2500) requestAnimationFrame(tick); else resolve({ seen, drawn });
      };
      requestAnimationFrame(tick);
    }), b.id);
    await read(b, () => { const v = window.__tilework.view; v.setDirection(0, -1); setTimeout(() => v.setDirection(0, 0), 1200); });
    const moving = await watch;
    const shot1 = await a.page.screenshot({ encoding: "base64" });
    check("a person walking in view is drawn on every frame it changes", moving.seen > 20 && moving.drawn === moving.seen, moving.drawn + " of " + moving.seen + " changed frames drawn");
    check("...and the picture really changed", shot0 !== shot1);
    // my own walk, a status change of somebody else, and an emote are drawn too
    const walk = await window_(browser, a, 1000, () => read(a, () => { const v = window.__tilework.view; v.setDirection(1, 0); setTimeout(() => v.setDirection(0, 0), 800); }));
    check("my own walk is drawn at full rate", walk.draws >= Math.min(45, fps * 0.8), walk.draws.toFixed(1) + " draws/s");
    await sleep(800);
    const before = await a.page.screenshot({ encoding: "base64" });
    await read(b, () => window.__tilework.session.setStatus?.("busy"));
    await sleep(600);
    const after = await a.page.screenshot({ encoding: "base64" });
    check("a status change seen while everybody stands still shows up within a moment", before !== after);
    check("no console errors", a.logs.length + b.logs.length === 0, [...a.logs, ...b.logs].join(" | ").slice(0, 300));
  } catch (e) {
    check("scenario completed", false, e.message);
  } finally {
    await browser.close();
  }
  return summary();
}
