// Admin map editor: real UI clicks, server-side validation, live update for others, persistence.
import { check, summary, resetChecks, launch, joinAs, waitFor, walkTo, pos, st, sleep, API } from "../lib.mjs";

const tileToClient = (u, tx, ty) =>
  u.page.evaluate((tx, ty) => {
    const v = window.__og.view;
    const r = v.app.canvas.getBoundingClientRect();
    return { x: r.left + v.camX + (tx * 16 + 8) * v.S, y: r.top + v.camY + (ty * 16 + 8) * v.S };
  }, tx, ty);

async function drag(u, from, to) {
  const a = await tileToClient(u, ...from), b = await tileToClient(u, ...to);
  await u.page.mouse.move(a.x, a.y);
  await u.page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) await u.page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
  await u.page.mouse.up();
}
const chip = (u, text) => u.page.evaluate((text) => { const b = [...document.querySelectorAll(".editor .chip")].find((x) => x.textContent === text); b?.click(); return !!b; }, text);

export async function run(ctx) {
  resetChecks();
  const browser = await launch();
  try {
    const t = String(Date.now() % 10000);
    const admin = await joinAs(browser, "Admin", { cookie: ctx.adminCookie });
    const mem = await joinAs(browser, "Ed" + t);
    const areas0 = await mem.page.evaluate(() => window.__og.view.map.areas.length);

    // non-admins and invalid maps are refused by the server
    const memCookie = (await mem.ctx.cookies()).find((c) => c.name === "og_session").value;
    const map = await admin.page.evaluate(() => JSON.parse(JSON.stringify(window.__og.view.map)));
    const put = (cookie, body) => fetch(API + "/api/map", { method: "PUT", headers: { "Content-Type": "application/json", Cookie: "og_session=" + cookie }, body: JSON.stringify(body) });
    check("a member cannot replace the map (admin-only endpoint)", (await put(memCookie, map)).status === 403);
    const badSpawn = { ...map, spawn: { x: 0, y: 0 } }; // (0,0) is a wall
    check("the server rejects a map whose spawn is inside a wall", (await put(ctx.adminCookie, badSpawn)).status === 422);
    const badSize = { ...map, walls: map.walls.slice(1), h: map.h - 1 };
    check("the server refuses to change the map size on the fly", [409, 422].includes((await put(ctx.adminCookie, badSize)).status));

    // ---- drive the real editor UI (the camera follows the admin: walk next to what is being edited)
    await walkTo(admin, 32 * 16 + 8, 22 * 16 + 8);
    await admin.page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Edit office")?.click());
    await waitFor(() => admin.page.$(".editor"), { what: "editor open" });
    await drag(admin, [35, 20], [35, 24]); // default tool: Paredes
    check("painting walls updates the local preview immediately", await admin.page.evaluate(() => [20, 21, 22, 23, 24].every((y) => window.__og.view.map.walls[y][35] === "#")));
    await admin.page.evaluate(() => [...document.querySelectorAll(".editor button")].find((b) => b.textContent === "Save")?.click());
    await waitFor(() => mem.page.evaluate(() => window.__og.view.map.walls[22][35] === "#"), { what: "member receives the new wall" });
    await walkTo(admin, 12 * 16 + 8, 30 * 16 + 8);
    await chip(admin, "Nova sala");
    await drag(admin, [14, 28], [19, 32]);
    await admin.page.type('.editor input[placeholder]', "Test room");
    await admin.page.select(".editor select[aria-label]", "admins");
    await admin.page.evaluate(() => [...document.querySelectorAll(".editor button")].find((b) => b.textContent === "Create room")?.click());
    await admin.page.evaluate(() => [...document.querySelectorAll(".editor button")].find((b) => b.textContent === "Save")?.click());

    await waitFor(() => mem.page.evaluate((n) => window.__og.view.map.areas.length === n, areas0 + 1), { what: "member receives the new room" });
    check("saved edits reach other connected users live", true);

    // ---- authority: the member cannot walk through the new wall or into the new admins-only room
    await walkTo(mem, 34 * 16 + 8, 22 * 16 + 8);
    await mem.page.evaluate(() => { const s = window.__og.session.socket; for (let i = 0; i < 30; i++) setTimeout(() => s.send({ t: "in", s: 100 + i, x: 1, y: 0 }), i * 60); });
    await sleep(2200);
    await mem.page.evaluate((id) => window.__og.session.locate(id), mem.id);
    const loc = await waitFor(() => mem.page.evaluate(() => window.__og.view.locate), { what: "server position" });
    check("the new wall blocks movement on the server", loc.x < 35 * 16, "server x=" + loc.x.toFixed(1));
    await mem.page.evaluate(() => window.__og.session.socket.send({ t: "in", s: 999, x: 0, y: 0 }));

    await walkTo(mem, 16 * 16 + 8, 27 * 16 + 8);
    await mem.page.evaluate(() => { window.__og.view.locate = null; const s = window.__og.session.socket; for (let i = 0; i < 30; i++) setTimeout(() => s.send({ t: "in", s: 300 + i, x: 0, y: 1 }), i * 60); });
    await sleep(2200);
    await mem.page.evaluate((id) => window.__og.session.locate(id), mem.id);
    const loc2 = await waitFor(() => mem.page.evaluate(() => window.__og.view.locate), { what: "server position 2" });
    check("a member is kept out of the newly created admins-only room", loc2.y < 28 * 16, "server y=" + loc2.y.toFixed(1));

    await admin.page.evaluate(() => window.__og.session.setConsent(true));
    await walkTo(admin, 16 * 16 + 8, 30 * 16 + 8);
    await waitFor(async () => (await st(admin)).conv?.name === "Test room", { timeout: 15000, what: "admin joins the new room call" });
    check("the new room is a real meeting room with its own call", true);

    // ---- persistence across restart
    await sleep(500);
    await ctx.stopServer();
    await ctx.startServer();
    const again = await joinAs(browser, "Ed", { cookie: memCookie });
    const persisted = await again.page.evaluate(() => ({ wall: window.__og.view.map.walls[22][35], room: window.__og.view.map.areas.some((a) => a.name === "Test room" && a.access.mode === "admins") }));
    check("edited walls and rooms persist across a server restart", persisted.wall === "#" && persisted.room, JSON.stringify(persisted));
    // Leave the shared office as we found it so later scenarios do not depend on this one.
    const restore = await put(ctx.adminCookie, map);
    check("the original map can be restored by the administrator", restore.status === 200);
    const errs = [admin, mem, again].flatMap((u) => u.logs).filter((l) => !/WebSocket|ERR_|net::|closed/.test(l));
    check("no unexpected console errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }
  return summary();
}
