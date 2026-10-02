// A real speaker and listeners in different private calls: the extra SFU room permits publishing only for the speaker.
import { check, summary, resetChecks, launch, joinAs, waitFor, walkTo, sleep, lkParticipants } from "../lib.mjs";

const state = (u) => u.page.evaluate(() => window.__tilework.state.spotlight);
const rtp = (u, kind) => u.page.evaluate(async (kind) => {
  const pm = window.__tilework.spotlightMedia.room.engine.pcManager;
  const pc = pm.subscriber?.pc ?? pm.publisher.pc;
  let bytes = 0;
  (await pc.getStats()).forEach((s) => { if (s.type === "inbound-rtp" && s.kind === kind) bytes += s.bytesReceived; });
  return bytes;
}, kind);

export async function run(ctx) {
  resetChecks();
  const browser = await launch(["--auto-select-desktop-capture-source=Entire screen", "--enable-features=GetDisplayMediaSetAutoSelectAllScreens"]);
  try {
    const speaker = await joinAs(browser, "Speaker" + Date.now() % 10000);
    const listener = await joinAs(browser, "Admin", { cookie: ctx.adminCookie });
    const quiet = await joinAs(browser, "Quiet" + Date.now() % 10000);
    for (const u of [speaker, listener]) await u.page.evaluate(() => {
      const m = window.__tilework.spotlightMedia, join = m.join.bind(m);
      m.join = (info, publish) => { window.__spotInfo = info; return join(info, publish); };
    });
    await walkTo(listener, 47 * 16 + 8, 12 * 16 + 8); // admins-only room
    await listener.page.evaluate(() => window.__tilework.session.setConsent(true));
    await waitFor(() => listener.page.evaluate(() => window.__tilework.state.conv?.state === "live"), { what: "private room call" });
    const privateRoom = await listener.page.evaluate(() => window.__tilework.media.currentRoom);
    await speaker.page.evaluate(() => window.__tilework.session.setConsent(true));
    // Stand still ON the pad (tile 34,19); a slow CI browser would otherwise walk past it.
    await walkTo(speaker, 34 * 16 + 8, 19 * 16 + 8);
    await waitFor(async () => (await state(speaker))?.state === "live" && (await state(listener))?.state === "live", { timeout: 45000, what: "spotlight speaker and listener connected" }).catch(async (e) => {
      const diag = await speaker.page.evaluate(() => ({ pos: window.__tilework.view.position(), spot: window.__tilework.state.spotlight, consent: window.__tilework.state.consent, conn: window.__tilework.state.conn, fps: window.__tilework.view.stats.fps }));
      const ldiag = await listener.page.evaluate(() => ({ spot: window.__tilework.state.spotlight, conv: window.__tilework.state.conv?.state }));
      throw new Error(e.message + " speaker=" + JSON.stringify(diag) + " listener=" + JSON.stringify(ldiag));
    });
    check("stepping onto the pad goes on air only with consent", (await state(speaker)).me === true);
    check("listener keeps their isolated private call", await listener.page.evaluate((r) => window.__tilework.media.currentRoom === r && window.__tilework.state.conv.state === "live", privateRoom));
    const room = await speaker.page.evaluate(() => window.__tilework.spotlightMedia.currentRoom);
    const claims = await listener.page.evaluate(() => JSON.parse(atob(window.__spotInfo.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))));
    check("the audience token is subscribe-only and scoped to the broadcast", claims.video.canPublish === false && claims.video.room === room && claims.video.canSubscribe === true);
    await waitFor(async () => await rtp(listener, "audio") > 0, { timeout: 15000, what: "real broadcast audio RTP" });
    check("a listener in a private room receives broadcast audio RTP", await rtp(listener, "audio") > 0);
    await speaker.page.evaluate(() => window.__tilework.spotlightMedia.setCam(true));
    await waitFor(async () => await rtp(listener, "video") > 0, { timeout: 15000, what: "real broadcast video RTP" });
    check("the speaker's camera reaches the listener", await rtp(listener, "video") > 0);
    check("no consent means no extra connection and no local capture", await quiet.page.evaluate(() => window.__tilework.state.spotlight !== null && window.__tilework.spotlightMedia.currentRoom === "" && !window.__tilework.state.mic && !window.__tilework.state.cam));
    await speaker.page.evaluate(() => window.__tilework.spotlightMedia.setShare(true));
    await waitFor(() => listener.page.evaluate(() => window.__tilework.spotlightMedia.tiles.some((t) => !!t.screen)), { timeout: 15000, what: "broadcast screen share" });
    check("screen sharing is received in the broadcast", true);
    await speaker.page.evaluate(() => window.__tilework.spotlightMedia.setShare(false));
    await listener.page.evaluate(() => window.__tilework.session.setConsent(false));
    await waitFor(() => listener.page.evaluate(() => window.__tilework.spotlightMedia.currentRoom === ""), { what: "withdraw broadcast consent" });
    await waitFor(async () => !(await lkParticipants(room)).includes(String(listener.id)), { what: "audience SFU access revoked" });
    check("withdrawing consent disconnects and revokes the audience", true);
    await speaker.page.evaluate(() => window.__tilework.view.setDirection(-1, 0));
    await waitFor(async () => await state(speaker) === null && await state(quiet) === null, { timeout: 10000, what: "spotlight ends on exit" });
    await speaker.page.evaluate(() => window.__tilework.view.setDirection(0, 0));
    await waitFor(async () => (await lkParticipants(room)).length === 0, { what: "broadcast SFU room is empty" });
    check("stepping off revokes the speaker and stops broadcast capture", await speaker.page.evaluate(() => window.__tilework.spotlightMedia.currentRoom === ""));
    const errors = [speaker, listener, quiet].flatMap((u) => u.logs).filter((x) => !/getDisplayMedia|display-capture/.test(x));
    check("broadcast flows have no browser errors", errors.length === 0, errors.join(" | "));
    return summary();
  } finally { await browser.close(); }
}
