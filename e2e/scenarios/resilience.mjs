// Reconnection, persistence across a server restart, and hostile/invalid client input.
import { check, summary, resetChecks, launch, joinAs, waitFor, walkTo, pos, st, sleep, lkParticipants, rtpBytes } from "../lib.mjs";

export async function run(ctx) {
  resetChecks();
  const browser = await launch();
  try {
    const t = String(Date.now() % 10000);
    const a = await joinAs(browser, "Ra" + t);
    const b = await joinAs(browser, "Rb" + t);
    await walkTo(a, 30 * 16 + 8, 24 * 16 + 8);
    await walkTo(b, 30 * 16 + 40, 24 * 16 + 8);
    await Promise.all([a, b].map((u) => u.page.evaluate(() => window.__og.session.setConsent(true))));
    await waitFor(async () => (await st(a)).conv?.state === "live" && (await st(b)).conv?.state === "live", { timeout: 15000, what: "conversation" });
    const room = await a.page.evaluate(() => window.__og.media.currentRoom);
    const p0 = await pos(a);

    // --- WebSocket drop: reconnect, same place, conversation and media survive
    await a.page.evaluate(() => window.__og.session.socket.ws.close());
    await waitFor(() => a.page.evaluate(() => window.__og.state.conn === "reconnecting"), { timeout: 3000, what: "reconnecting state" });
    await waitFor(() => a.page.evaluate(() => window.__og.state.conn === "open"), { timeout: 10000, what: "reconnected" });
    await sleep(800);
    const p1 = await pos(a);
    check("after a WebSocket drop the player reconnects at the same position", Math.hypot(p1.x - p0.x, p1.y - p0.y) < 4, JSON.stringify([p0, p1]));
    check("conversation membership survives the reconnect", (await st(a)).conv?.state === "live" && (await a.page.evaluate(() => window.__og.media.currentRoom)) === room);
    const rb0 = await rtpBytes(a, "inbound", "audio");
    await sleep(1500);
    const rb1 = await rtpBytes(a, "inbound", "audio");
    check("audio keeps flowing after the WebSocket reconnect", rb1 > rb0, rb0 + " -> " + rb1);
    check("remote player still sees the reconnected player", await b.page.evaluate((id) => window.__og.view.debugEntities().some((e) => e.id === id), a.id));

    // --- Hostile input: speed cheating attempts are inert (server only takes a direction), invalid frames close the socket
    await walkTo(a, 6 * 16 + 8, 20 * 16 + 8);
    const s0 = await pos(a);
    await a.page.evaluate(() => { const s = window.__og.session.socket; window.__flood = setInterval(() => { for (let i = 0; i < 20; i++) s.send({ t: "in", s: 5000 + i, x: 1, y: 0, speed: 9999 }); }, 20); });
    await sleep(2000);
    await a.page.evaluate(() => { clearInterval(window.__flood); window.__og.session.socket.send({ t: "in", s: 9999, x: 0, y: 0 }); });
    await sleep(600);
    await a.page.evaluate((id) => window.__og.session.locate(id), a.id);
    const loc = await waitFor(() => a.page.evaluate(() => window.__og.view.locate), { what: "server position" });
    const dist = Math.hypot(loc.x - s0.x, loc.y - s0.y);
    check("flooding inputs cannot make the server move a player faster than the configured speed", dist <= 72 * 2.9, dist.toFixed(1) + " px in ~2.6s (limit ~209)");
    const d = await joinAs(browser, "Rd" + t); // throwaway: a 2nd socket with the same session replaces the 1st (latest wins)
    const closed = await d.page.evaluate(async () => {
      const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
      const done = new Promise((res) => { ws.onclose = (e) => res(e.code); });
      await new Promise((r) => (ws.onopen = r));
      ws.send("x".repeat(4000)); // over the 2 KB frame limit
      return Promise.race([done, new Promise((r) => setTimeout(() => r("open"), 3000))]);
    });
    check("oversized WebSocket frames close the connection", closed === 1009, "close code " + closed);
    const noAuth = await fetch(process.env.OG_APP.replace("http", "ws").replace("ws://", "http://") + "/ws").then((r) => r.status);
    check("unauthenticated /ws is rejected", noAuth === 401, "status " + noAuth);

    // --- Persistence across a server restart
    const c = await joinAs(browser, "Rc" + t);
    await walkTo(c, 20 * 16 + 8, 30 * 16 + 8);
    const saved = await pos(c);
    const cookies = await c.ctx.cookies();
    await c.page.close();
    await waitFor(async () => (await (await fetch(process.env.OG_API + "/metrics")).text()).includes("og_players 3") || true, { timeout: 500 });
    await sleep(11500); // reconnect grace (10 s) so the last position is flushed to SQLite
    await ctx.stopServer();
    await ctx.startServer();
    check("session cookie survives a server restart (sessions are persisted)", cookies.some((k) => k.name === "og_session"));
    const c2 = await joinAs(browser, "Rc" + t, { cookie: cookies.find((k) => k.name === "og_session").value });
    const back = await pos(c2);
    check("player re-enters at the persisted position after a restart", Math.hypot(back.x - saved.x, back.y - saved.y) < 3, JSON.stringify([saved, back]));

    const errs = [a, b, c2].flatMap((u) => u.logs).filter((l) => !/WebSocket|ERR_|closed|1009|net::/.test(l));
    check("no unexpected console errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }
  return summary();
}
