// Getting around faster, and companions: running, double-click "walk to", walk to a person, pets.
import { check, resetChecks, summary, launch, joinAs, waitFor, walkTo, pos, sleep } from "../lib.mjs";

const read = (u, fn, ...args) => u.page.evaluate(fn, ...args);
const click = (u, text, selector = "button") => u.page.evaluate((text, selector) => {
  const b = [...document.querySelectorAll(selector)].find((x) => x.textContent.trim() === text || x.getAttribute("aria-label") === text);
  b?.click(); return !!b;
}, text, selector);
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

/** Distance covered in ~1.5 s of holding "right", measured in the page (frame-rate independent). */
const stride = (u) => read(u, () => new Promise((resolve) => {
  const v = window.__og.view;
  const p0 = v.position();
  v.setDirection(1, 0);
  const t0 = performance.now();
  setTimeout(() => {
    const p1 = v.position();
    v.setDirection(0, 0);
    resolve((p1.x - p0.x) / ((performance.now() - t0) / 1000));
  }, 1500);
}));

export async function run() {
  resetChecks();
  const browser = await launch();
  try {
    const a = await joinAs(browser, "Runner" + (Date.now() % 10000), { avatar: { sk: 1, hs: 0, hc: 1, sh: 4, pa: 1, pt: 2 } });
    const b = await joinAs(browser, "Watcher" + (Date.now() % 10000));
    check("the pet picked before joining is stored in the profile", (await a.page.evaluate(() => fetch("/api/me").then((r) => r.json()))).avatar.pt === 2);

    // ---- pets ----
    // social area, open floor: x 6..18, y 26..30 is clear
    await walkTo(a, 8 * 16 + 8, 28 * 16 + 8);
    await walkTo(b, 8 * 16 + 8, 31 * 16 + 8);
    await waitFor(() => read(b, (id) => window.__og.view.ents.get(id)?.petKind === 2 && !!window.__og.view.ents.get(id)?.pet, a.id), { what: "remote pet sprite" });
    check("other people see my pet (dog) next to my avatar", true);
    // Pet feel, recorded frame by frame on the observer while the owner walks an L (right, down, left):
    // the pet walks the owner's own trail some way behind, never cuts the corner, never outruns a
    // walker, and rests behind the owner instead of on top of them.
    await walkTo(a, 7 * 16 + 8, 27 * 16 + 8);
    await sleep(1200);
    const rec = read(b, (id) => new Promise((resolve) => {
      const out = [];
      const t0 = performance.now();
      const tick = (now) => {
        const e = window.__og.view.ents.get(id);
        if (e) out.push([now - t0, e.x, e.y, e.ps.px, e.ps.py]);
        if (now - t0 < 4200) requestAnimationFrame(tick); else resolve(out);
      };
      requestAnimationFrame(tick);
    }), a.id);
    await read(a, async () => {
      const v = window.__og.view, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(300);
      v.setDirection(1, 0); await wait(1200);
      v.setDirection(0, 1); await wait(500);
      v.setDirection(-1, 0); await wait(800);
      v.setDirection(0, 0);
    });
    const S = await rec;
    const trail = [];
    let walkGaps = [], offTrail = 0, fastest = 0;
    for (let i = 1; i < S.length; i++) {
      const [t, ox, oy, px, py] = S[i], [t1, ox1, oy1, px1, py1] = S[i - 1];
      if (Math.hypot(ox - ox1, oy - oy1) > 0.2) trail.push([ox, oy]);
      const moving = Math.hypot(ox - ox1, oy - oy1) > 0.2;
      if (moving && t > 900) walkGaps.push(Math.hypot(px - ox, py - oy));
      const dt = (t - t1) / 1000;
      if (t > 600 && dt > 0) fastest = Math.max(fastest, Math.hypot(px - px1, py - py1) / dt);
      if (t > 900 && trail.length > 2) {
        let best = Infinity; // distance from the pet to the owner's trail so far (polyline)
        for (let k = 1; k < trail.length; k++) {
          const [x1, y1] = trail[k - 1], [x2, y2] = trail[k];
          const L = (x2 - x1) ** 2 + (y2 - y1) ** 2 || 1;
          const u = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / L));
          best = Math.min(best, Math.hypot(px - (x1 + u * (x2 - x1)), py - (y1 + u * (y2 - y1))));
        }
        offTrail = Math.max(offTrail, best);
      }
    }
    walkGaps.sort((x, y) => x - y);
    const med = walkGaps[walkGaps.length >> 1] ?? 0, minGap = walkGaps[0] ?? 0;
    const [, ox, oy, px, py] = S[S.length - 1];
    const rest = Math.hypot(px - ox, py - oy);
    check("the pet follows behind while walking, not glued to the owner", med >= 14 && med <= 30 && minGap >= 10, "median " + med.toFixed(1) + " px, min " + minGap.toFixed(1) + " px");
    check("the pet walks the owner's trail and never cuts the corner", offTrail <= 3, "max " + offTrail.toFixed(1) + " px off the trail");
    check("the pet never outruns a walking owner (no jumps when turning)", fastest <= 72 * 1.35, fastest.toFixed(0) + " px/s");
    check("the pet rests behind its owner, not on top", rest >= 14 && rest <= 26, rest.toFixed(1) + " px");
    // Running: the observer sees the run bit and the pet keeps up. (Owner jumps are covered by
    // web/test/petFollow.test.ts: a jump injected here is undone by the next server record.)
    const leg = (dx, ms) => Promise.all([
      read(b, (id, ms) => new Promise((resolve) => {
        const out = [];
        const t0 = performance.now();
        const tick = (now) => {
          const e = window.__og.view.ents.get(id);
          out.push([now - t0, Math.hypot(e.ps.px - e.x, e.ps.py - e.y)]);
          if (now - t0 < ms) requestAnimationFrame(tick); else resolve(out);
        };
        requestAnimationFrame(tick);
      }), a.id, ms),
      read(a, async (dx, ms) => { const v = window.__og.view; v.setDirection(dx, 0); await new Promise((r) => setTimeout(r, ms)); v.setDirection(0, 0); }, dx, ms),
    ]).then(([g]) => g);
    await walkTo(a, 7 * 16 + 8, 28 * 16 + 8);
    await read(a, () => window.__og.view.toggleRun(true));
    const runG = (await leg(1, 900)).filter(([t]) => t > 400).map(([, d]) => d).sort((x, y) => x - y);
    await read(a, () => window.__og.view.toggleRun(false));
    check("the pet keeps up with a running owner", (runG[runG.length >> 1] ?? 99) <= 30, "median " + (runG[runG.length >> 1] ?? 0).toFixed(1) + " px");
    // switching pets is a profile change: everybody sees it live
    const put = await read(b, () => fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: document.title && window.__og.state.roster.get(window.__og.state.meId).n, avatar: { sk: 0, hs: 1, hc: 2, sh: 3, pa: 2, pt: 6 } }) }).then((r) => r.status));
    await waitFor(() => read(a, (id) => window.__og.view.ents.get(id)?.petKind === 6, b.id), { what: "pet change propagates" });
    check("choosing a pet in the profile shows it to others without reloading", put === 200);
    const bad = await read(b, () => fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: window.__og.state.roster.get(window.__og.state.meId).n, avatar: { pt: 999 } }) }).then((r) => r.json()));
    check("the server rejects unknown pets (normalised to none)", bad.avatar?.pt === 0);

    // ---- running ----
    await walkTo(a, 3 * 16 + 8, 28 * 16 + 8);
    const walkV = await stride(a);
    await walkTo(a, 3 * 16 + 8, 28 * 16 + 8);
    await read(a, () => window.__og.view.toggleRun(true));
    const runV = await stride(a);
    check("walking speed is ~72 px/s", walkV > 55 && walkV < 85, walkV.toFixed(1));
    check("running (R / Shift) is about twice as fast", runV / walkV > 1.7 && runV / walkV < 2.3, runV.toFixed(1) + " px/s");
    await read(a, () => window.__og.view.setDirection(1, 0));
    await waitFor(() => read(b, (id) => window.__og.view.ents.get(id)?.run === true, a.id), { what: "remote sees running" });
    await sleep(500);
    await read(a, () => window.__og.view.setDirection(0, 0));
    const truth = await pos(a);
    await sleep(600);
    const seen = await read(b, (id) => { const e = window.__og.view.ents.get(id); return { x: e.x, y: e.y }; }, a.id);
    check("others extrapolate a runner at run speed and agree on where it stops", dist(seen, truth) < 6, dist(seen, truth).toFixed(1) + " px");
    check("the HUD shows the run toggle state", await read(a, () => document.querySelector(".run-toggle")?.getAttribute("aria-pressed") === "true"));
    await read(a, () => window.__og.view.toggleRun(false));
    check("Shift held while walking runs too", await read(a, () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
      const on = window.__og.view.running;
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift" }));
      return on && !window.__og.view.running;
    }));

    // ---- double-click to walk ----
    await walkTo(a, 4 * 16 + 8, 27 * 16 + 8);
    const target = { tx: 12, ty: 29 };
    const box = await read(a, (t) => {
      const v = window.__og.view, r = v.app.canvas.getBoundingClientRect();
      return { x: r.left + v.camX + (t.tx * 16 + 8) * v.S, y: r.top + v.camY + (t.ty * 16 + 8) * v.S };
    }, target);
    await a.page.mouse.click(box.x, box.y, { count: 2 });
    await waitFor(async () => { const p = await pos(a); return Math.floor(p.x / 16) === target.tx && Math.floor(p.y / 16) === target.ty; }, { timeout: 20000, what: "double-click walk arrives" });
    await sleep(400);
    check("double-clicking the map runs there along a server path and stops", await read(a, () => window.__og.view.dx === 0 && window.__og.view.dy === 0 && !window.__og.view.guided));

    // ---- walk to a person, across the wall into the reception ----
    await walkTo(b, 9 * 16 + 8, 6 * 16 + 8);
    const t0 = Date.now();
    await click(a, "Walk to " + b.name, ".people button");
    await waitFor(async () => dist(await pos(a), await pos(b)) < 40 && !(await read(a, () => window.__og.view.guided)), { timeout: 30000, what: "walk to person arrives" });
    check("Walk to (people panel) runs next to the person around walls", true, ((Date.now() - t0) / 1000).toFixed(1) + " s");

    // ---- refused targets ----
    await read(a, () => window.__og.view.goTo(50, 10)); // admin-only boardroom
    await waitFor(() => read(a, () => document.querySelector(".toast")?.textContent.includes("no way")), { what: "unreachable toast" });
    check("the server refuses to route a member into an admin-only room", true);

    check("no console errors", a.logs.length + b.logs.length === 0, [...a.logs, ...b.logs].join(" | ").slice(0, 300));
  } catch (e) {
    check("scenario completed", false, e.message);
  } finally {
    await browser.close();
  }
  return summary();
}
