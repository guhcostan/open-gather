// Shared helpers for real-browser end-to-end tests (Chrome + fake camera/mic).
import puppeteer from "puppeteer-core";
import crypto from "node:crypto";

export const APP = process.env.TILEWORK_APP ?? "http://127.0.0.1:5173";
export const API = process.env.TILEWORK_API ?? "http://127.0.0.1:8080";
export const LK = process.env.TILEWORK_LK_HTTP ?? "http://127.0.0.1:7880";
const KEY = process.env.LIVEKIT_API_KEY ?? "devkey";
const SECRET = process.env.LIVEKIT_API_SECRET ?? "secret";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let results = [];
export const resetChecks = () => { results = []; };
export function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : ""));
}
export function summary() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  return failed.length === 0;
}

/** Tests share one office: wait until players from a previous run have left (reconnect grace). */
export async function waitForEmptyOffice() {
  await waitFor(async () => (await metrics()).tilework_players === 0, { timeout: 30000, every: 500, what: "empty office" });
}

export async function launch(extra = [], { waitEmpty = true } = {}) {
  // TILEWORK_SHARED_OFFICE=1: a public instance (the demo) may have real visitors and no /metrics; do not wait.
  if (waitEmpty && !process.env.TILEWORK_SHARED_OFFICE) await waitForEmptyOffice();
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--no-first-run", "--enable-unsafe-swiftshader",
      // GitHub's Ubuntu runners forbid the Chrome sandbox (AppArmor); the browser only ever loads our own test pages.
      ...(process.env.CI ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] : []),
      ...extra,
    ],
  });
}

export async function waitFor(fn, { timeout = 15000, every = 100, what = "condition" } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = await fn(); } catch { v = false; }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error("timeout waiting for " + what);
    await sleep(every);
  }
}

/** Opens an isolated browser context (own cookies) and joins as name. */
export async function joinAs(browser, name, { path = "/", avatar = null, viewport = process.env.CI ? { width: 800, height: 450 } : { width: 1280, height: 720 }, cookie = null } = {}) {
  // CI runners render in software (SwiftShader) on 2 cores; a smaller canvas keeps the browsers near 30 fps.
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (cookie) await ctx.setCookie({ name: "tilework_session", value: cookie, url: APP, httpOnly: true, sameSite: "Lax" });
  await page.setViewport(viewport);
  if (avatar) await page.evaluateOnNewDocument((a) => localStorage.setItem("tilework.avatar", JSON.stringify(a)), avatar);
  const logs = [];
  // livekit-client logs these two as errors when WE close a call on purpose (user-initiated abort of its data channels)
  const benign = /DataChannel error on (lossy|reliable): User-Initiated Abort|publisher data channel '(DATA_TRACK_)?(LOSSY|RELIABLE)' closed unexpectedly|error reading from signal stream/i; // the last one: LiveKit's signal socket dropped on a loaded runner; the client reconnects on its own
  page.on("console", (m) => { if (m.type() === "error" && !benign.test(m.text())) logs.push(m.text()); });
  page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  await page.goto(APP + path, { waitUntil: "domcontentloaded" });
  if (!cookie) {
    await page.waitForSelector("input", { timeout: 10000 });
    await page.type("input", name);
    await page.click("button.primary");
  }
  await waitFor(() => page.evaluate(() => window.__tilework?.state?.meId > 0 && window.__tilework.state.conn === "open"), { timeout: 30000, what: name + " connected" });
  return { ctx, page, name, logs, id: await page.evaluate(() => window.__tilework.state.meId) };
}

export const pos = (u) => u.page.evaluate(() => window.__tilework.view.position());
export const others = (u) => u.page.evaluate(() => window.__tilework.view.debugEntities());
export const st = (u) => u.page.evaluate(() => ({ conv: window.__tilework.state.conv, mic: window.__tilework.state.mic, cam: window.__tilework.state.cam, status: window.__tilework.state.status, consent: window.__tilework.state.consent }));

/** BFS over the map's solid grid, then walk waypoint by waypoint using the real input path. */
export async function walkTo(u, tx, ty, { timeout = 60000 } = {}) {
  const grid = await u.page.evaluate(() => ({ w: window.__tilework.view.map.w, h: window.__tilework.view.map.h, solid: window.__tilework.view.map.solid, deny: [...window.__tilework.view.deny] }));
  const T = 16;
  const p0 = await pos(u);
  const start = [Math.floor(p0.x / T), Math.floor(p0.y / T)];
  const goal = [Math.floor(tx / T), Math.floor(ty / T)];
  const key = (x, y) => y * grid.w + x;
  const prev = new Map([[key(...start), null]]);
  const q = [start];
  while (q.length) {
    const [x, y] = q.shift();
    if (x === goal[0] && y === goal[1]) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h || grid.solid[ny][nx] === "1" || prev.has(key(nx, ny))) continue;
      prev.set(key(nx, ny), [x, y]);
      q.push([nx, ny]);
    }
  }
  const path = [];
  for (let c = goal; c; c = prev.get(key(...c))) path.unshift(c);
  if (!prev.has(key(...goal))) throw new Error("no path");
  const t0 = Date.now();
  for (const [cx, cy] of path.slice(1)) {
    await steer(u, cx * T + 8, cy * T + 8, Math.max(1000, timeout - (Date.now() - t0)), "walk timeout to " + [cx, cy] + " (" + u.name + ")");
  }
  // land exactly at the requested pixel inside the goal tile
  await steer(u, tx, ty, 5000, "landing timeout (" + u.name + ")").catch(() => {});
  await u.page.evaluate(() => window.__tilework.view.setDirection(0, 0));
}

/**
 * Holds a direction until the avatar is at (wx, wy). The control loop runs inside the page on requestAnimationFrame,
 * so it reacts on the very frame that moves the avatar. Driving it from Node (one CDP round trip per decision)
 * overshoots on slow software-rendered CI browsers (~10-16 fps, i.e. 4-7 px per frame at 72 px/s).
 * Each axis stops once within max(1.5 px, half a frame of travel), so accuracy follows the frame rate.
 */
async function steer(u, wx, wy, timeoutMs, what) {
  const r = await u.page.evaluate((wx, wy, timeoutMs) => new Promise((resolve) => {
    const v = window.__tilework.view;
    const speed = 72; // world.Config.Speed, px/s
    const t0 = performance.now();
    let last = t0;
    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const tol = Math.max(1.5, speed * dt * 0.5);
      const p = v.position();
      const dx = Math.abs(wx - p.x) > tol ? Math.sign(wx - p.x) : 0;
      const dy = Math.abs(wy - p.y) > tol ? Math.sign(wy - p.y) : 0;
      if (!dx && !dy) { v.setDirection(0, 0); resolve({ ok: true }); return; }
      if (now - t0 > timeoutMs) {
        resolve({ ok: false, hidden: document.hidden, conn: window.__tilework.state.conn, pos: p, fps: v.stats.fps });
        return;
      }
      v.setDirection(dx, dy);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), wx, wy, timeoutMs);
  if (!r.ok) throw new Error(what + " " + JSON.stringify(r));
}

// ---- server-side checks ----
export async function metrics() {
  const txt = await (await fetch(API + "/metrics")).text();
  const m = {};
  for (const line of txt.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [k, v] = line.split(" ");
    m[k] = Number(v);
  }
  return m;
}

function jwt(video) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = b({ alg: "HS256", typ: "JWT" }) + "." + b({ iss: KEY, nbf: now - 10, exp: now + 60, video });
  return body + "." + crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
}
export async function lk(method, body, room) {
  const r = await fetch(LK + "/twirp/livekit.RoomService/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + jwt({ roomAdmin: true, roomList: true, room }) },
    body: JSON.stringify(body),
  });
  return r.ok ? r.json() : { error: r.status, text: await r.text() };
}
export const lkParticipants = async (room) => ((await lk("ListParticipants", { room }, room)).participants ?? []).map((p) => p.identity);

/** Sum of RTP bytes on the LiveKit peer connection (single-PC mode: publisher.pc carries both directions). */
export const rtpBytes = (u, dir, kind) =>
  u.page.evaluate(async (dir, kind) => {
    const pm = window.__tilework.media.room.engine.pcManager;
    const pc = pm.subscriber?.pc ?? pm.publisher.pc;
    let total = 0;
    (await pc.getStats()).forEach((s) => {
      if (s.kind === kind && s.type === (dir === "inbound" ? "inbound-rtp" : "outbound-rtp")) total += dir === "inbound" ? s.bytesReceived : s.bytesSent;
    });
    return total;
  }, dir, kind);
