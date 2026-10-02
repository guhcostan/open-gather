// Real UI and authoritative world: reactions, interactive notes, guided walking, portals, doors and boards.
import { API, check, resetChecks, summary, launch, joinAs, waitFor, walkTo, pos, sleep } from "../lib.mjs";

const click = (u, text, selector = "button") => u.page.evaluate((text, selector) => {
  const b = [...document.querySelectorAll(selector)].find((x) => x.textContent.trim() === text || x.getAttribute("aria-label") === text);
  b?.click(); return !!b;
}, text, selector);
const read = (u, fn, ...args) => u.page.evaluate(fn, ...args);
const close = (u) => u.page.keyboard.press("Escape");
const near = (p, x, y) => Math.hypot(p.x - x, p.y - y) < 10;

export async function run(ctx) {
  resetChecks();
  const browser = await launch();
  try {
    const a = await joinAs(browser, "Admin", { cookie: ctx.adminCookie });
    const b = await joinAs(browser, "Explorer" + Date.now() % 10000);
    await walkTo(a, 4 * 16 + 8, 6 * 16 + 8);
    await walkTo(b, 6 * 16 + 8, 6 * 16 + 8);
    await waitFor(() => read(a, () => window.__tilework.state.nearby?.t === "note"), { what: "nearby note hint" });
    await a.page.keyboard.press("1");
    await waitFor(() => read(b, (id) => window.__tilework.view.emotes.has(id), a.id), { what: "remote wave bubble" });
    check("number key sends an emote that the other avatar renders", true);
    await waitFor(async () => { await a.page.keyboard.press("x"); return a.page.$(".object-note"); }, { timeout: 20000, every: 700, what: "welcome note opens" });
    check("X opens the nearby note in a dialog", await read(a, () => document.querySelector(".object-note").textContent.includes("Welcome to Tilework!")));
    check("the public map omits object content", await read(b, () => !JSON.stringify(window.__tilework.view.map).includes("Welcome to Tilework!")));
    await close(a);

    await click(b, "Request to lead Admin", ".people button");
    await waitFor(() => read(a, () => !!window.__tilework.state.leadRequest), { what: "lead request arrives" });
    check("request to lead asks the other person before moving them", await read(a, () => !window.__tilework.state.following));
    await click(a, "Not now");
    await walkTo(b, 12 * 16 + 8, 9 * 16 + 8);
    await click(b, "Follow Admin", ".people button");
    await waitFor(async () => { const p = await pos(b), q = await pos(a); return Math.hypot(p.x - q.x, p.y - q.y) < 33; }, { timeout: 25000, what: "follower reaches leader" });
    check("Follow walks to the leader at server speed, around objects", true);
    await click(b, "Stop following");
    await waitFor(() => read(b, () => !window.__tilework.state.following), { what: "follow stops" });

    await walkTo(b, 16 * 16 + 8, 11 * 16 + 8);
    await read(b, () => window.__tilework.view.setDirection(0, 1));
    await waitFor(async () => near(await pos(b), 36 * 16 + 8, 32 * 16 + 8), { what: "portal arrival" });
    check("walking onto the portal teleports once and stops movement", await read(b, () => window.__tilework.view.dx === 0 && window.__tilework.view.dy === 0));

    await walkTo(a, 46 * 16 + 8, 5 * 16 + 8);
    await walkTo(b, 42 * 16 + 8, 4 * 16 + 8);
    await waitFor(() => click(a, "Lock room"), { what: "lock control" });
    await waitFor(() => read(b, () => window.__tilework.state.locked.includes(3)), { what: "room lock reaches other player" });
    await read(b, () => window.__tilework.view.setDirection(1, 0));
    await sleep(1400);
    await read(b, () => window.__tilework.view.setDirection(0, 0));
    check("a locked door blocks the other player", (await pos(b)).x < 45 * 16);
    await waitFor(() => click(b, "Knock · Aurora room"), { what: "knock control" });
    await waitFor(() => read(a, () => !!window.__tilework.state.knock), { what: "knock dialog" });
    await click(a, "Let in");
    await walkTo(b, 46 * 16 + 8, 5 * 16 + 8);
    check("Let in opens the door only for the accepted visitor", (await pos(b)).x > 45 * 16);
    await click(a, "Unlock room");

    // Editing existing content must use the authenticated full map, not the redacted world map.
    await walkTo(a, 4 * 16 + 8, 6 * 16 + 8);
    if (!(await click(a, "Edit office"))) throw new Error("admin editor button unavailable");
    await waitFor(() => a.page.$(".editor"), { what: "editor open" });
    await click(a, "Edit content", ".editor button");
    // Pick the note from the object list (works at any viewport; on small screens the panel covers the map corner).
    const noteOption = await waitFor(() => read(a, () => [...document.querySelectorAll('.editor select[aria-label="Interactive object to edit"] option')].find((o) => o.textContent.endsWith("(4, 5)"))?.value), { timeout: 20000, what: "object list with the note" });
    await a.page.select('.editor select[aria-label="Interactive object to edit"]', noteOption);
    await waitFor(() => a.page.$(".editor textarea"), { what: "note content editor" });
    check("editor restores hidden content before editing", await read(a, () => document.querySelector(".editor textarea").value.includes("Welcome to Tilework!")));
    await a.page.$eval(".editor textarea", (el) => { el.value = ""; });
    await a.page.type(".editor textarea", "A saved team note");
    await click(a, "Apply content", ".editor button");
    await click(a, "Save", ".editor button");
    await waitFor(() => read(a, () => document.querySelector(".toast")?.textContent === "Office saved"), { what: "edited note saved" });
    await click(a, "Close", ".editor button");
    await a.page.keyboard.press("x");
    await waitFor(() => read(a, () => document.querySelector(".object-note")?.textContent === "A saved team note"), { what: "updated note delivered" });
    check("saved note edits are delivered through the real interaction", true);
    await close(a);

    await walkTo(a, 49 * 16 + 8, 16 * 16 + 8);
    await walkTo(b, 50 * 16 + 8, 16 * 16 + 8);
    for (const u of [a, b]) {
      await waitFor(() => read(u, () => window.__tilework.state.nearby?.t === "whiteboard"), { what: "nearby whiteboard" });
      await u.page.keyboard.press("x");
      await waitFor(() => u.page.$("canvas.whiteboard"), { what: "whiteboard dialog" });
    }
    await click(a, "Text", ".board-tools button");
    await a.page.type('.modal input[maxlength="80"]', "Shared test text");
    await click(a, "Place text in centre");
    await waitFor(() => b.page.evaluate(() => document.querySelector("canvas.whiteboard").getContext("2d").getImageData(400, 270, 220, 40).data.some((v) => v < 200)), { what: "text appears on collaborator canvas" });
    check("whiteboard text appears on the other person's canvas", true);
    await a.page.screenshot({ path: "/tmp/tilework-whiteboard-qa.png" });
    await click(a, "Pen", ".board-tools button");
    const rect = await read(a, () => { const r = document.querySelector("canvas.whiteboard").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    await a.page.mouse.move(rect.x + 50, rect.y + 50); await a.page.mouse.down();
    await a.page.mouse.move(rect.x + 150, rect.y + 80, { steps: 12 }); await a.page.mouse.up();
    await sleep(250);
    check("pen drawing is rendered by the collaborator", await read(b, () => document.querySelector("canvas.whiteboard").getContext("2d").getImageData(30, 30, 220, 160).data.some((v) => v < 200)));
    await click(a, "Undo my last stroke");
    await click(a, "Clear board"); await click(a, "Confirm clear");
    await waitFor(() => read(b, () => !document.querySelector("canvas.whiteboard").getContext("2d").getImageData(0, 0, 1000, 600).data.some((v) => v < 200)), { what: "cleared on collaborator" });
    check("admin clear reaches both collaborators", true);
    check("members do not get a Clear board button", !(await click(b, "Clear board")));
    await click(a, "Text", ".board-tools button");
    await a.page.$eval('.modal input[maxlength="80"]', (el) => { el.value = ""; });
    await a.page.type('.modal input[maxlength="80"]', "Saved across restart");
    await click(a, "Place text in centre");
    await waitFor(() => read(b, () => window.__tilework.boardModel.strokes.some((s) => s.tx === "Saved across restart")), { what: "accepted stroke before restart" });
    const cookie = (await a.ctx.cookies()).find((c) => c.name === "tilework_session").value;
    await close(a); await close(b);
    check("Escape closes both boards", !(await a.page.$("canvas.whiteboard")) && !(await b.page.$("canvas.whiteboard")));
    await ctx.stopServer(); await ctx.startServer();
    await a.page.reload();
    await waitFor(() => read(a, () => window.__tilework?.state?.conn === "open"), { what: "reconnected after restart" });
    await walkTo(a, 49 * 16 + 8, 16 * 16 + 8);
    await a.page.keyboard.press("x");
    await waitFor(() => read(a, () => window.__tilework.boardModel.strokes.some((s) => s.tx === "Saved across restart")), { what: "whiteboard restores after restart" });
    check("whiteboard survives graceful restart without waiting for debounce", true);
    const fullMap = await (await fetch(API + "/api/admin/map", { headers: { Cookie: "tilework_session=" + cookie } })).json();
    check("interactive note edits persist across restart", fullMap.props.find((p) => p.t === "note" && p.x === 4 && p.y === 5).data === "A saved team note");
    check("new flows have no browser runtime errors", a.logs.length + b.logs.length === 0, [...a.logs, ...b.logs].join(" | "));
    return summary();
  } finally { await browser.close(); }
}
