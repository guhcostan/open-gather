// Shared helpers for real-browser end-to-end tests (Chrome + fake camera/mic).
import puppeteer from "puppeteer-core";
import crypto from "node:crypto";

export const APP = process.env.OG_APP ?? "http://127.0.0.1:5173";
export const API = process.env.OG_API ?? "http://127.0.0.1:8080";
export const LK = process.env.OG_LK_HTTP ?? "http://127.0.0.1:7880";
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
  await waitFor(async () => (await metrics()).og_players === 0, { timeout: 30000, every: 500, what: "empty office" });
}

export async function launch(extra = []) {
  await waitForEmptyOffice();
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--no-first-run", "--enable-unsafe-swiftshader", ...extra],
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
export async function joinAs(browser, name, { path = "/", avatar = null, viewport = { width: 1280, height: 720 }, cookie = null } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (cookie) await ctx.setCookie({ name: "og_session", value: cookie, url: APP, httpOnly: true, sameSite: "Lax" });
  await page.setViewport(viewport);
  if (avatar) await page.evaluateOnNewDocument((a) => localStorage.setItem("og.avatar", JSON.stringify(a)), avatar);
  const logs = [];
  // livekit-client logs these two as errors when WE close a call on purpose (user-initiated abort of its data channels)
  const benign = /DataChannel error on (lossy|reliable): User-Initiated Abort|publisher data channel '(LOSSY|RELIABLE)' closed unexpectedly/i;
  page.on("console", (m) => { if (m.type() === "error" && !benign.test(m.text())) logs.push(m.text()); });
  page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  await page.goto(APP + path, { waitUntil: "domcontentloaded" });
  if (!cookie) {
    await page.waitForSelector("input", { timeout: 10000 });
    await page.type("input", name);
    await page.click("button.primary");
  }
  await waitFor(() => page.evaluate(() => window.__og?.state?.meId > 0 && window.__og.state.conn === "open"), { what: name + " connected" });
  return { ctx, page, name, logs, id: await page.evaluate(() => window.__og.state.meId) };
}

export const pos = (u) => u.page.evaluate(() => window.__og.view.position());
export const others = (u) => u.page.evaluate(() => window.__og.view.debugEntities());
export const st = (u) => u.page.evaluate(() => ({ conv: window.__og.state.conv, mic: window.__og.state.mic, cam: window.__og.state.cam, status: window.__og.state.status, consent: window.__og.state.consent }));

/** BFS over the map's solid grid, then walk waypoint by waypoint using the real input path. */
export async function walkTo(u, tx, ty, { timeout = 60000 } = {}) {
  const grid = await u.page.evaluate(() => ({ w: window.__og.view.map.w, h: window.__og.view.map.h, solid: window.__og.view.map.solid, deny: [...window.__og.view.deny] }));
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
    const wx = cx * T + 8, wy = cy * T + 8;
    for (;;) {
      const p = await pos(u);
      const dx = Math.abs(wx - p.x) > 2 ? Math.sign(wx - p.x) : 0;
      const dy = Math.abs(wy - p.y) > 2 ? Math.sign(wy - p.y) : 0;
      if (!dx && !dy) break;
      await u.page.evaluate((a, b) => window.__og.view.setDirection(a, b), dx, dy);
      await sleep(30);
      if (Date.now() - t0 > timeout) {
        const d = await u.page.evaluate(() => ({ hidden: document.hidden, conn: window.__og.state.conn, pos: window.__og.view.position(), fps: window.__og.view.stats.fps })).catch(() => ({}));
        throw new Error("walk timeout to " + [cx, cy] + " (" + u.name + ") " + JSON.stringify(d));
      }
    }
  }
  // land exactly at the requested pixel inside the goal tile
  for (let i = 0; i < 200; i++) {
    const p = await pos(u);
    const dx = Math.abs(tx - p.x) > 2 ? Math.sign(tx - p.x) : 0;
    const dy = Math.abs(ty - p.y) > 2 ? Math.sign(ty - p.y) : 0;
    if (!dx && !dy) break;
    await u.page.evaluate((a, b) => window.__og.view.setDirection(a, b), dx, dy);
    await sleep(25);
  }
  await u.page.evaluate(() => window.__og.view.setDirection(0, 0));
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
    const pm = window.__og.media.room.engine.pcManager;
    const pc = pm.subscriber?.pc ?? pm.publisher.pc;
    let total = 0;
    (await pc.getStats()).forEach((s) => {
      if (s.kind === kind && s.type === (dir === "inbound" ? "inbound-rtp" : "outbound-rtp")) total += dir === "inbound" ? s.bytesReceived : s.bytesSent;
    });
    return total;
  }, dir, kind);
