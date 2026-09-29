// Chat scopes and privacy, chat history persistence, profile changes and desk labels.
import { check, summary, resetChecks, launch, joinAs, waitFor, walkTo, st, sleep, API } from "../lib.mjs";

const chatOf = (u) => u.page.evaluate(() => window.__og.state.chat.map((m) => ({ sc: m.sc, from: m.from, text: m.text, n: m.n })));
const send = (u, sc, text, id) => u.page.evaluate((sc, text, id) => window.__og.session.chat(sc, text, id), sc, text, id);

export async function run(ctx) {
  resetChecks();
  const browser = await launch();
  try {
    const t = String(Date.now() % 10000);
    const a = await joinAs(browser, "Sa" + t);
    const b = await joinAs(browser, "Sb" + t);
    const c = await joinAs(browser, "Sc" + t);

    // ---- office chat reaches everyone; text is trimmed and bounded server-side
    await send(a, "o", "  hello office  ");
    await waitFor(async () => (await chatOf(c)).some((m) => m.sc === "o" && m.text === "hello office"), { what: "office chat reaches C" });
    check("office chat reaches everybody (trimmed)", (await chatOf(b)).some((m) => m.sc === "o" && m.text === "hello office" && m.from === a.id));
    await sleep(700);
    await send(a, "o", "x".repeat(900));
    await waitFor(async () => (await chatOf(b)).some((m) => m.text.startsWith("xxxx")), { what: "long message" });
    check("messages are cut to 500 characters by the server", (await chatOf(b)).find((m) => m.text.startsWith("xxxx")).text.length === 500);

    // ---- rate limit: a burst of 30 cannot flood the office
    await sleep(3000);
    const before = (await chatOf(b)).length;
    await a.page.evaluate(() => { for (let i = 0; i < 30; i++) window.__og.session.chat("o", "flood " + i); });
    await sleep(1500);
    const got = (await chatOf(b)).filter((m) => m.text.startsWith("flood")).length;
    check("chat flooding is rate limited (30 sent, burst of ~8 accepted)", got > 0 && got <= 10, got + " delivered, " + (before) + " earlier");

    // ---- direct messages are private
    await send(a, "d", "secret between A and B", b.id);
    await waitFor(async () => (await chatOf(b)).some((m) => m.sc === "d"), { what: "DM to B" });
    await sleep(500);
    check("a direct message reaches only its recipient (and the sender)", (await chatOf(a)).some((m) => m.sc === "d") && !(await chatOf(c)).some((m) => m.text.includes("secret")));

    // ---- conversation chat: only members of the group, and only inside one
    await send(a, "g", "nobody should receive this");
    await sleep(600);
    check("conversation chat outside a conversation goes nowhere", !(await chatOf(b)).some((m) => m.sc === "g"));
    await walkTo(a, 12 * 16 + 8, 30 * 16 + 8);
    await walkTo(b, 12 * 16 + 40, 30 * 16 + 8);
    await walkTo(c, 30 * 16 + 8, 30 * 16 + 8);
    await Promise.all([a, b, c].map((u) => u.page.evaluate(() => window.__og.session.setConsent(true))));
    await waitFor(async () => (await st(a)).conv?.state === "live" && (await st(b)).conv?.state === "live", { timeout: 20000, what: "A and B converse" }).catch(async (e) => {
      console.log("DIAG", JSON.stringify(await Promise.all([a, b, c].map(async (u) => ({ st: await st(u), pos: await u.page.evaluate(() => window.__og.view.position()), conn: await u.page.evaluate(() => window.__og.state.conn) })))), JSON.stringify([a, b, c].map((u) => u.logs)));
      throw e;
    });
    await send(a, "g", "only for people in the conversation");
    await waitFor(async () => (await chatOf(b)).some((m) => m.sc === "g"), { what: "group chat to B" });
    await sleep(500);
    check("conversation chat reaches group members only", (await chatOf(b)).some((m) => m.sc === "g" && m.text.includes("conversation")) && !(await chatOf(c)).some((m) => m.sc === "g"));

    // ---- profile change through the real settings dialog
    await b.page.evaluate(() => document.querySelector(".bar-row .round.ghost")?.click());
    await waitFor(() => b.page.$('.modal input[aria-label]'), { what: "settings dialog" });
    await b.page.$eval('.modal input[aria-label]', (el) => el.select());
    await b.page.type('.modal input[aria-label]', "Novo" + t);
    await b.page.evaluate(() => [...document.querySelectorAll(".modal button")].find((x) => x.textContent === "Save profile")?.click());
    await waitFor(() => a.page.evaluate((n, id) => window.__og.state.roster.get(id)?.n === n, "Novo" + t, b.id), { what: "roster shows the new name" });
    check("a profile change reaches other people's roster live", true);
    const bad = await fetch(API + "/api/profile", { method: "PUT", headers: { "Content-Type": "application/json", Cookie: "og_session=" + (await c.ctx.cookies()).find((k) => k.name === "og_session").value }, body: JSON.stringify({ name: "   ", avatar: {} }) });
    check("an empty name is refused", bad.status === 400);
    const anon = await fetch(API + "/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "x" }) });
    check("anonymous profile changes are refused", anon.status === 401);

    // ---- desk assignment shows the owner's label
    // The world map redacts interactive-object content; editors round-trip through the full map.
    const map = await (await fetch(API + "/api/admin/map", { headers: { Cookie: "og_session=" + ctx.adminCookie } })).json();
    const desk = map.props.find((p) => p.t === "desk");
    desk.assign = b.id;
    desk.label = "New desk " + t;
    const put = await fetch(API + "/api/map", { method: "PUT", headers: { "Content-Type": "application/json", Cookie: "og_session=" + ctx.adminCookie }, body: JSON.stringify(map) });
    check("an admin can assign a desk to a person", put.status === 200);
    await waitFor(() => c.page.evaluate(() => window.__og.view.deskLabels.length > 0), { what: "desk label" });
    check("clients render the desk owner label", true);

    // ---- history: a newcomer sees the office chat; it survives a restart; DMs and group chat do not
    const d = await joinAs(browser, "Sd" + t);
    const hist = await chatOf(d);
    check("a newcomer receives the persisted office chat", hist.some((m) => m.text === "hello office" && m.n));
    check("history never contains direct or conversation messages", !hist.some((m) => m.sc !== "o") && !hist.some((m) => m.text.includes("secret") || m.text.includes("conversation")));
    await sleep(1500); // let the async writer flush
    await ctx.stopServer();
    await ctx.startServer();
    const e = await joinAs(browser, "Se" + t);
    check("office chat history survives a server restart", (await chatOf(e)).some((m) => m.text === "hello office"));
    const errs = [a, b, c, d, e].flatMap((u) => u.logs).filter((l) => !/WebSocket|ERR_|net::|closed/.test(l));
    check("no unexpected console errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }
  return summary();
}
