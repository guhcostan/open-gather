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
  const v = window.__tilework.view;
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
    await waitFor(() => read(b, (id) => window.__tilework.view.ents.get(id)?.petKind === 2 && !!window.__tilework.view.ents.get(id)?.pet, a.id), { what: "remote pet sprite" });
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
        const e = window.__tilework.view.ents.get(id);
        if (e) out.push([now - t0, e.x, e.y, e.ps.px, e.ps.py]);
        if (now - t0 < 4200) requestAnimationFrame(tick); else resolve(out);
      };
      requestAnimationFrame(tick);
    }), a.id);
    await read(a, async () => {
      const v = window.__tilework.view, wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
    const tail = S.filter(([t]) => t > S[S.length - 1][0] - 600).map(([, ox, oy, px, py]) => Math.hypot(px - ox, py - oy)).sort((x, y) => x - y);
    const rest = tail[tail.length >> 1] ?? 0; // median over the final 600 ms, not one frame: a single sample can catch the pet mid-settle on a slow machine
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
          const e = window.__tilework.view.ents.get(id);
          out.push([now - t0, Math.hypot(e.ps.px - e.x, e.ps.py - e.y)]);
          if (now - t0 < ms) requestAnimationFrame(tick); else resolve(out);
        };
        requestAnimationFrame(tick);
      }), a.id, ms),
      read(a, async (dx, ms) => { const v = window.__tilework.view; v.setDirection(dx, 0); await new Promise((r) => setTimeout(r, ms)); v.setDirection(0, 0); }, dx, ms),
    ]).then(([g]) => g);
    await walkTo(a, 7 * 16 + 8, 28 * 16 + 8);
    await read(a, () => window.__tilework.view.toggleRun(true));
    const runG = (await leg(1, 900)).filter(([t]) => t > 400).map(([, d]) => d).sort((x, y) => x - y);
    await read(a, () => window.__tilework.view.toggleRun(false));
    check("the pet keeps up with a running owner", (runG[runG.length >> 1] ?? 99) <= 30, "median " + (runG[runG.length >> 1] ?? 0).toFixed(1) + " px");
    // switching pets is a profile change: everybody sees it live
    const put = await read(b, () => fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: document.title && window.__tilework.state.roster.get(window.__tilework.state.meId).n, avatar: { sk: 0, hs: 1, hc: 2, sh: 3, pa: 2, pt: 6 } }) }).then((r) => r.status));
    await waitFor(() => read(a, (id) => window.__tilework.view.ents.get(id)?.petKind === 6, b.id), { what: "pet change propagates" });
    check("choosing a pet in the profile shows it to others without reloading", put === 200);
    const bad = await read(b, () => fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: window.__tilework.state.roster.get(window.__tilework.state.meId).n, avatar: { pt: 999 } }) }).then((r) => r.json()));
    check("the server rejects unknown pets (normalised to none)", bad.avatar?.pt === 0);

    // ---- running ----
    await walkTo(a, 3 * 16 + 8, 28 * 16 + 8);
    const walkV = await stride(a);
    await walkTo(a, 3 * 16 + 8, 28 * 16 + 8);
    await read(a, () => window.__tilework.view.toggleRun(true));
    const runV = await stride(a);
    check("walking speed is ~72 px/s", walkV > 55 && walkV < 85, walkV.toFixed(1));
    check("running (R / Shift) is about twice as fast", runV / walkV > 1.7 && runV / walkV < 2.3, runV.toFixed(1) + " px/s");
    await read(a, () => window.__tilework.view.setDirection(1, 0));
    await waitFor(() => read(b, (id) => window.__tilework.view.ents.get(id)?.run === true, a.id), { what: "remote sees running" });
    await sleep(500);
    await read(a, () => window.__tilework.view.setDirection(0, 0));
    const truth = await pos(a);
    await sleep(600);
    const seen = await read(b, (id) => { const e = window.__tilework.view.ents.get(id); return { x: e.x, y: e.y }; }, a.id);
    check("others extrapolate a runner at run speed and agree on where it stops", dist(seen, truth) < 6, dist(seen, truth).toFixed(1) + " px");
    check("the HUD shows the run toggle state", await read(a, () => document.querySelector(".run-toggle")?.getAttribute("aria-pressed") === "true"));
    await read(a, () => window.__tilework.view.toggleRun(false));
    check("Shift held while walking runs too", await read(a, () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
      const on = window.__tilework.view.running;
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift" }));
      return on && !window.__tilework.view.running;
    }));

    // ---- double-click to walk ----
    // ---- prediction under network jitter, and at walls ----
    // Every input leaves the page 0-120 ms late (in order), like a bad Wi-Fi. While "right" is held
    // at run speed, the own avatar must never be drawn stepping back, and it must end where the server says.
    await walkTo(a, 4 * 16 + 8, 28 * 16 + 8);
    await read(a, () => {
      const orig = WebSocket.prototype.send;
      let last = 0;
      window.__origSend = orig;
      WebSocket.prototype.send = function (d) {
        const at = Math.max(last, performance.now() + Math.random() * 120);
        last = at;
        setTimeout(() => orig.call(this, d), at - performance.now());
      };
    });
    const jitter = await read(a, () => new Promise((resolve) => {
      const v = window.__tilework.view;
      v.toggleRun(true);
      v.setDirection(1, 0);
      const xs = [];
      const t0 = performance.now();
      const tick = (now) => {
        xs.push(v.ents.get(v.meId).x);
        if (now - t0 < 1300) requestAnimationFrame(tick);
        else { v.setDirection(0, 0); v.toggleRun(false); resolve(xs); }
      };
      requestAnimationFrame(tick);
    }));
    let back = 0;
    for (let i = 1; i < jitter.length; i++) back = Math.max(back, jitter[i - 1] - jitter[i]);
    check("with 0-120 ms of input jitter, a runner is never drawn stepping back", back <= 0.1 && jitter.at(-1) - jitter[0] > 120, "max step back " + back.toFixed(2) + " px over " + jitter.length + " frames, ran " + (jitter.at(-1) - jitter[0]).toFixed(0) + " px");
    // convergence is polled, not slept: a loaded machine may take longer than 900 ms to deliver the stop
    // convergence is polled with a generous timeout: a loaded software renderer can take seconds
    // to deliver the stop. The trajectory is reported, so a real never-converges bug is told apart
    // from a slow machine.
    const tc0 = Date.now();
    let mine = null, theirs = null, gap = Infinity;
    const gtrail = [];
    let converged = false;
    try {
      await waitFor(async () => {
        mine = await read(a, () => { const v = window.__tilework.view, e = v.ents.get(v.meId); return { x: e.x, y: e.y }; });
        theirs = await read(b, (id) => { const e = window.__tilework.view.ents.get(id); return { x: e.x, y: e.y }; }, a.id);
        gap = dist(mine, theirs);
        gtrail.push(+gap.toFixed(1));
        return gap < 1;
      }, { timeout: 20000, every: 500, what: "observer converges on the stopped runner" });
      converged = true;
    } catch { /* reported below with the trajectory */ }
    check("...and stops where the server and other people see it", converged && gap < 1, gap.toFixed(2) + " px after " + ((Date.now() - tc0) / 1000).toFixed(1) + " s, trail " + gtrail.join("->") + ", mine " + JSON.stringify(mine) + " theirs " + JSON.stringify(theirs));
    await read(a, () => { WebSocket.prototype.send = window.__origSend; });
    // the same on a diagonal at walking speed, where each axis moves slowest (51 px/s): both axes monotonic
    await walkTo(a, 6 * 16 + 8, 30 * 16 + 8);
    await read(a, () => {
      const orig = WebSocket.prototype.send;
      let last = 0;
      WebSocket.prototype.send = function (d) {
        const at = Math.max(last, performance.now() + Math.random() * 120);
        last = at;
        setTimeout(() => orig.call(this, d), at - performance.now());
      };
    });
    const diag = await read(a, () => new Promise((resolve) => {
      const v = window.__tilework.view;
      v.setDirection(1, -1);
      const pts = [];
      const t0 = performance.now();
      const tick = (now) => {
        const e = v.ents.get(v.meId);
        pts.push([e.x, e.y]);
        if (now - t0 < 1300) requestAnimationFrame(tick); else { v.setDirection(0, 0); resolve(pts); }
      };
      requestAnimationFrame(tick);
    }));
    let backX = 0, backY = 0;
    for (let i = 1; i < diag.length; i++) { backX = Math.max(backX, diag[i - 1][0] - diag[i][0]); backY = Math.max(backY, diag[i][1] - diag[i - 1][1]); }
    check("...and walking diagonally neither axis is drawn stepping back", backX <= 0.1 && backY <= 0.1 && diag.at(-1)[0] - diag[0][0] > 40, "max back x " + backX.toFixed(2) + " y " + backY.toFixed(2) + " px");
    await read(a, () => { WebSocket.prototype.send = window.__origSend; });
    // A 1-tile wall above (5, 15): run into it, then nothing may pull the avatar away from it.
    await walkTo(a, 5 * 16 + 8, 16 * 16 + 8);
    const wall = await read(a, async () => {
      const v = window.__tilework.view, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      v.toggleRun(true);
      v.setDirection(0, -1);
      await wait(700);
      v.setDirection(0, 0);
      v.toggleRun(false);
      const e = v.ents.get(v.meId), at = e.y;
      await wait(900);
      return { at, after: e.y, x: e.x };
    });
    const seenAtWall = await read(b, (id) => window.__tilework.view.ents.get(id).y, a.id);
    check("running into a wall stops touching it, with no pull-back afterwards", wall.at === 15 * 16 + 3 && wall.after === wall.at, "y " + wall.at + " -> " + wall.after);
    check("...and others see it touching the wall too", Math.abs(seenAtWall - wall.after) < 0.5, "observer y " + seenAtWall.toFixed(2));

    await walkTo(a, 4 * 16 + 8, 27 * 16 + 8);
    const target = { tx: 12, ty: 29 };
    const box = await read(a, (t) => {
      const v = window.__tilework.view, r = v.app.canvas.getBoundingClientRect();
      return { x: r.left + v.camX + (t.tx * 16 + 8) * v.S, y: r.top + v.camY + (t.ty * 16 + 8) * v.S };
    }, target);
    await a.page.mouse.click(box.x, box.y, { count: 2 });
    await waitFor(async () => { const p = await pos(a); return Math.floor(p.x / 16) === target.tx && Math.floor(p.y / 16) === target.ty; }, { timeout: 20000, what: "double-click walk arrives" });
    await sleep(400);
    check("double-clicking the map runs there along a server path and stops", await read(a, () => window.__tilework.view.dx === 0 && window.__tilework.view.dy === 0 && !window.__tilework.view.guided));

    // ---- walk to a person, across the wall into the reception ----
    await walkTo(b, 9 * 16 + 8, 6 * 16 + 8);
    const t0 = Date.now();
    await click(a, "Walk to " + b.name, ".people button");
    await waitFor(async () => dist(await pos(a), await pos(b)) < 40 && !(await read(a, () => window.__tilework.view.guided)), { timeout: 30000, what: "walk to person arrives" });
    check("Walk to (people panel) runs next to the person around walls", true, ((Date.now() - t0) / 1000).toFixed(1) + " s");

    // ---- refused targets ----
    await read(a, () => window.__tilework.view.goTo(50, 10)); // admin-only boardroom
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
