// Media isolation attacks against the real SFU: replayed, tampered and expired tokens.
import { check, summary, resetChecks, launch, joinAs, waitFor, walkTo, st, sleep, lkParticipants, metrics } from "../lib.mjs";

const prefixOf = (room) => room.split(".").slice(0, 2).join(".");
const TTL = Number(process.env.OG_MEDIA_TOKEN_TTL_SECONDS ?? 20);

export async function run(ctx) {
  resetChecks();
  const browser = await launch();
  try {
    const t = String(Date.now() % 10000);
    const a = await joinAs(browser, "Xa" + t);
    const b = await joinAs(browser, "Xb" + t);
    await a.page.evaluate(() => {
      const m = window.__og.media;
      const j = m.join.bind(m);
      m.join = (i) => { window.__stale = i; window.__RoomCtor = null; return j(i).then(() => { window.__RoomCtor = m.room.constructor; }); };
    });
    await walkTo(a, 12 * 16 + 8, 30 * 16 + 8);
    await walkTo(b, 12 * 16 + 40, 30 * 16 + 8);
    await Promise.all([a, b].map((u) => u.page.evaluate(() => window.__og.session.setConsent(true))));
    await waitFor(async () => (await st(a)).conv?.state === "live" && (await st(b)).conv?.state === "live", { timeout: 20000, what: "conversation" });
    await waitFor(() => a.page.evaluate(() => !!window.__RoomCtor), { what: "room constructor captured" });
    const room = await a.page.evaluate(() => window.__og.media.currentRoom);
    await a.page.evaluate((r) => { window.__privateRoom = r; }, prefixOf(room) + ".r.diretoria");
    const issued = Date.now();

    // Everyone leaves the group; the server revokes A's access.
    const before = await metrics();
    await walkTo(b, 34 * 16 + 8, 30 * 16 + 8);
    await waitFor(async () => (await st(a)).conv === null, { timeout: 15000, what: "conversation ends" });
    await waitFor(async () => (await lkParticipants(room)).length === 0, { timeout: 8000, what: "SFU room empty" });
    check("after leaving, the SFU room is empty (server-side revocation)", true);

    // Attack 1: replay A's still-valid token from a "hacked" client after leaving the group.
    const attack = (tokenTweak) => a.page.evaluate(async (tweak) => {
      const s = window.__stale;
      const r = new window.__RoomCtor();
      window.__attacker = r;
      let token = s.token;
      if (tweak === "room") {
        const [h, p, sg] = token.split(".");
        const payload = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
        payload.video.room = window.__privateRoom;
        token = h + "." + btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") + "." + sg;
      }
      try {
        await r.connect(s.url, token, { autoSubscribe: true });
        return "connected";
      } catch (e) {
        return "rejected: " + String(e?.message ?? e).slice(0, 80);
      }
    }, tokenTweak);

    let replay = await attack("none");
    // "could not establish pc connection" is an ICE/DTLS setup flake of the headless browser, not a token verdict
    // (a rejected token fails at the signal step). Retry it once so the check measures the token.
    if (/pc connection/.test(replay)) replay = await attack("none");
    check("a replayed token can still connect inside its validity window (known, bounded)", replay === "connected", replay);
    const t0 = Date.now();
    const evicted = await waitFor(async () => (await lkParticipants(room)).length === 0, { timeout: 15000, every: 250, what: "attacker evicted" }).then(() => true).catch(() => false);
    const rm = await metrics();
    check("the reconciler evicts the replayed connection within seconds", evicted, ((Date.now() - t0) / 1000).toFixed(1) + " s");
    check("the eviction is counted (og_media_reconcile_removals_total)", rm.og_media_reconcile_removals_total > (before.og_media_reconcile_removals_total ?? 0));
    await a.page.evaluate(() => window.__attacker?.disconnect());

    // Attack 2: change the room inside the token (private room) without the signing secret.
    const tamper = await attack("room");
    check("a token whose room claim was edited is rejected by the SFU (signature)", tamper.startsWith("rejected"), tamper);
    check("the private room stayed empty", (await lkParticipants(prefixOf(room) + ".r.diretoria")).length === 0);

    // Attack 3: token past its validity. LiveKit's JWT library tolerates 60 s of clock skew (measured: a token
    // 12 s past its exp was still accepted), so the effective lifetime is TTL + 60 s.
    const LEEWAY = 60;
    const wait = Math.max(0, TTL + LEEWAY + 8 - (Date.now() - issued) / 1000);
    await sleep(wait * 1000);
    const expired = await attack("none");
    check("an expired token is rejected once LiveKit\'s 60 s clock-skew leeway has passed", expired.startsWith("rejected"), expired + " (" + TTL + " s validity + " + LEEWAY + " s leeway)");
    check("no unauthorised participant remains in the SFU room", (await lkParticipants(room)).length === 0);

    const errs = [a, b].flatMap((u) => u.logs).filter((l) => !/WebSocket|ERR_|net::|closed|401|Unauthorized|validation|token|Failed to load/i.test(l));
    check("no unexpected console errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }
  return summary();
}
