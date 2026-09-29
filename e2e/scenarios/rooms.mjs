// Meeting rooms: explicit access rules, server-side enforcement, SFU isolation and revocation, screen share.
import { check, summary, resetChecks, launch, joinAs, waitFor, walkTo, pos, st, sleep, lkParticipants, metrics } from "../lib.mjs";

const b64json = (tok) => JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString());

export async function run(ctx) {
  resetChecks();
  const browser = await launch(["--auto-select-desktop-capture-source=Entire screen", "--enable-features=GetDisplayMediaSetAutoSelectAllScreens"]);
  try {
    const t = String(Date.now() % 10000);
    const admin = await joinAs(browser, "Admin", { cookie: ctx.adminCookie });
    const mem = await joinAs(browser, "Mem" + t);
    check("first member of the office is admin, the next is member", admin.id === ctx.adminId && (await admin.page.evaluate(() => window.__og.state.role)) === "admin" && (await mem.page.evaluate(() => window.__og.state.role)) === "member");
    await Promise.all([admin, mem].map((u) => u.page.evaluate(() => { window.__og.media.join0 = window.__og.media.join.bind(window.__og.media); window.__og.media.join = (i) => { window.__lastJoin = i; return window.__og.media.join0(i); }; })));

    // --- member is stopped at the door of the admins-only room by the SERVER (bypassing client-side prediction)
    await walkTo(mem, 43 * 16 + 8, 10 * 16 + 8);
    await mem.page.evaluate(() => window.__og.session.setConsent(true));
    await mem.page.evaluate(() => { const s = window.__og.session.socket; for (let i = 0; i < 40; i++) setTimeout(() => s.send({ t: "in", s: 1000 + i, x: 1, y: 0 }), i * 60); });
    await sleep(2800);
    await mem.page.evaluate((id) => window.__og.session.locate(id), mem.id);
    const loc = await waitFor(() => mem.page.evaluate(() => window.__og.view.locate), { what: "server location" });
    check("server refuses to move a member into the admins-only room (authoritative collision)", loc.x < 45 * 16, "server x=" + loc.x.toFixed(1) + " (room starts at 720)");
    await mem.page.evaluate(() => window.__og.session.socket.send({ t: "in", s: 2000, x: 0, y: 0 }));
    check("member has no conversation for the room and cannot request a token", (await st(mem)).conv === null);
    await mem.page.evaluate(() => window.__og.session.socket.send({ t: "tok" }));
    await sleep(700);
    check("requesting a media token outside any group yields nothing", (await st(mem)).conv === null && (await mem.page.evaluate(() => window.__lastJoin ?? null)) === null);

    // --- admin enters and gets the room media group
    await admin.page.evaluate(() => window.__og.session.setConsent(true));
    await walkTo(admin, 47 * 16 + 8, 12 * 16 + 8);
    await waitFor(async () => (await st(admin)).conv?.state === "live", { timeout: 15000, what: "admin live in room" });
    const conv = (await st(admin)).conv;
    check("admin joins the private room call", conv.kind === "r" && conv.name === "Boardroom", JSON.stringify({ k: conv.kind, n: conv.name }));
    const room = await admin.page.evaluate(() => window.__og.media.currentRoom);
    const claims = b64json(await admin.page.evaluate(() => window.__lastJoin.token));
    check("token is scoped to exactly this room, this identity and a short validity", claims.video.room === room && claims.sub === String(admin.id) && claims.exp - claims.nbf <= 330 && claims.video.roomJoin === true && !claims.video.roomAdmin, JSON.stringify({ room: claims.video.room, sub: claims.sub, ttl: claims.exp - claims.nbf, admin: claims.video.roomAdmin }));
    check("SFU room contains only the admin", (await lkParticipants(room)).join() === String(admin.id));

    // --- a member in a proximity call elsewhere gets a token for THAT group only
    const m2 = await joinAs(browser, "Mem2" + t);
    await Promise.all([m2].map((u) => u.page.evaluate(() => { window.__og.session.setConsent(true); window.__og.media.join0 = window.__og.media.join.bind(window.__og.media); window.__og.media.join = (i) => { window.__lastJoin = i; return window.__og.media.join0(i); }; })));
    await walkTo(mem, 12 * 16 + 8, 24 * 16 + 8);
    await walkTo(m2, 12 * 16 + 40, 24 * 16 + 8);
    await waitFor(async () => (await st(mem)).conv?.state === "live" && (await st(m2)).conv?.state === "live", { timeout: 15000, what: "members converse" });
    const memClaims = b64json(await mem.page.evaluate(() => window.__lastJoin.token));
    const memRoom = await mem.page.evaluate(() => window.__og.media.currentRoom);
    check("member token grants only the proximity group room, never the private room", memClaims.video.room === memRoom && memRoom !== room && !memRoom.includes("boardroom"));
    check("private room still contains only the admin while others talk elsewhere", (await lkParticipants(room)).join() === String(admin.id) && (await lkParticipants(memRoom)).length === 2);

    // --- screen sharing inside the admin room requires a second participant: use m2? not allowed. Share inside the member call.
    await mem.page.evaluate(() => window.__og.media.setShare(true));
    const shared = await waitFor(() => m2.page.evaluate(() => window.__og.media.tiles.some((tl) => !tl.local && tl.screen)), { timeout: 15000, what: "m2 sees screen share" }).catch(() => false);
    check("screen share published by one participant is received by the other", !!shared);
    if (shared) await mem.page.evaluate(() => window.__og.media.setShare(false));

    // --- leaving the private room revokes SFU access
    const before = await metrics();
    await walkTo(admin, 43 * 16 + 8, 10 * 16 + 8);
    await waitFor(async () => (await st(admin)).conv === null, { timeout: 10000, what: "admin leaves room call" });
    await sleep(1500);
    const after = await metrics();
    check("leaving the private room ends the call and the server revokes SFU access", after.og_media_revocations_total > before.og_media_revocations_total && (await lkParticipants(room)).length === 0);

    const errs = [admin, mem, m2].flatMap((u) => u.logs).filter((l) => !/getDisplayMedia|display-capture/.test(l));
    check("no console errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }
  return summary();
}
