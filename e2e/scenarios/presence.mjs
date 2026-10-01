// Presence: waving across the office, raised hands, status notes, dancing, the minimap and the touch pad.
import { check, resetChecks, summary, launch, joinAs, waitFor, walkTo, pos, sleep } from "../lib.mjs";

const read = (u, fn, ...args) => u.page.evaluate(fn, ...args);
const click = (u, text, selector = "button") => u.page.evaluate((text, selector) => {
  const b = [...document.querySelectorAll(selector)].find((x) => x.textContent.trim() === text || x.getAttribute("aria-label") === text);
  b?.click(); return !!b;
}, text, selector);
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const toast = (u) => read(u, () => document.querySelector(".toast")?.textContent ?? "");

export async function run(ctx) {
  resetChecks();
  const browser = await launch();
  try {
    const sfx = Date.now() % 10000;
    const a = await joinAs(browser, "Waver" + sfx);
    const b = await joinAs(browser, "Desk" + sfx);
    await walkTo(a, 8 * 16 + 8, 28 * 16 + 8); // social area
    await walkTo(b, 9 * 16 + 8, 6 * 16 + 8); // reception, behind a wall and out of a's area of interest

    // ---- wave, answered by walking over ----
    await click(a, "Wave at " + b.name, ".people button");
    await waitFor(() => read(b, () => !!document.querySelector(".wave-card")), { what: "wave card" });
    check("a wave reaches somebody anywhere in the office", (await read(b, () => document.querySelector(".wave-card").textContent)).includes(a.name));
    await waitFor(async () => (await toast(a)).includes("You waved at"), { what: "wave confirmation" });
    check("the sender is told the wave arrived", true);
    await click(b, "Walk to them", ".wave-card button");
    await waitFor(async () => dist(await pos(a), await pos(b)) < 40 && !(await read(b, () => window.__og.view.guided)), { timeout: 30000, what: "walk back to the waver" });
    check("Walk to them runs to the person who waved", true);
    await read(b, () => window.__og.session.setStatus("busy"));
    await sleep(2200); // wave cooldown
    await click(a, "Wave at " + b.name, ".people button");
    await waitFor(async () => (await toast(a)).includes("busy"), { what: "busy answer" });
    check("busy people are not disturbed and the sender learns why", !(await read(b, () => !!document.querySelector(".wave-card"))));
    await read(b, () => window.__og.session.setStatus("available"));

    // ---- raised hand (H) and a status note, seen by the other person ----
    await a.page.keyboard.press("h");
    await waitFor(() => read(b, (id) => window.__og.state.roster.get(id)?.h === 1 && !!window.__og.view.ents.get(id)?.hand, a.id), { what: "hand raised" });
    check("H raises a hand that others see over the avatar and in the roster", true);
    await a.page.keyboard.press("h");
    await waitFor(() => read(b, (id) => !window.__og.state.roster.get(id)?.h && !window.__og.view.ents.get(id)?.hand, a.id), { what: "hand lowered" });
    check("pressing H again lowers it", true);
    await a.page.click(".status-menu > .btn");
    await a.page.type(".note-form input", "Deep work until 4");
    await a.page.click(".note-form button[type=submit]");
    await waitFor(() => read(b, (n) => [...document.querySelectorAll(".people .note")].some((el) => el.textContent === n), "Deep work until 4"), { what: "note in people panel" });
    check("a status note set in the status menu shows in everyone's people panel", true);

    // ---- dance (Z) ----
    await a.page.keyboard.press("z");
    await waitFor(() => read(b, (id) => window.__og.view.ents.get(id)?.danceUntil > performance.now(), a.id), { what: "dance seen" });
    check("Z makes the avatar dance for the people nearby", true);

    // ---- minimap ----
    await waitFor(() => read(a, () => !!document.querySelector(".minimap canvas") && window.__og.state.areaCounts.some((n) => n > 0)), { what: "minimap with counts" });
    const counts = await read(a, () => window.__og.state.areaCounts);
    check("the minimap shows head counts per area from the server", counts.reduce((x, y) => x + y, 0) >= 2, JSON.stringify(counts));
    const start = await pos(a);
    const box = await read(a, () => { const r = document.querySelector(".minimap canvas").getBoundingClientRect(); const m = window.__og.view.currentMap(); return { x: r.left + (4.5 * 16) * (r.width / (m.w * 16)), y: r.top + (30.5 * 16) * (r.width / (m.w * 16)) }; });
    await a.page.mouse.click(box.x, box.y);
    await waitFor(async () => { const p = await pos(a); return Math.floor(p.x / 16) === 4 && Math.floor(p.y / 16) === 30; }, { timeout: 20000, what: "minimap walk" });
    check("clicking the minimap runs there", dist(start, await pos(a)) > 16);
    await a.page.keyboard.press("m");

    // ---- keyboard help and an administrator announcement ----
    await a.page.keyboard.press("?");
    await waitFor(() => a.page.$("table.keys"), { what: "shortcuts dialog" });
    await a.page.keyboard.press("Escape");
    check("? opens the keyboard shortcuts and Escape closes them", await read(a, () => !document.querySelector("table.keys")));
    const admin = await joinAs(browser, "Admin", { cookie: ctx.adminCookie });
    await waitFor(() => click(admin, "Admin"), { what: "admin button" });
    await waitFor(() => click(admin, "Announce", '[role="tab"]'), { what: "announce tab" });
    await admin.page.type("#announce-text", "Standup in the Horizon room in 5 minutes");
    await click(admin, "Announce", "form button");
    await waitFor(() => read(a, () => document.querySelector(".announce")?.textContent.includes("Standup in the Horizon room")), { what: "banner for a" });
    await waitFor(() => read(b, () => document.querySelector(".announce")?.textContent.includes("Standup in the Horizon room")), { what: "banner for b" });
    check("an administrator's announcement shows as a banner to everybody online", true);
    await click(a, "Dismiss announcement");
    check("the banner can be dismissed", await read(a, () => !document.querySelector(".announce")));
    const log = await read(admin, () => fetch("/api/admin/audit").then((r) => r.text()));
    check("the activity log records the announcement without its text", log.includes('"announce"') && !log.includes("Standup"));
    await admin.page.keyboard.press("Escape");
    check("M hides the minimap", await read(a, () => !document.querySelector(".minimap")));
    await a.page.keyboard.press("m");

    // ---- touch pad on a phone-sized touch screen ----
    const pctx = await browser.createBrowserContext();
    const phone = await pctx.newPage();
    await phone.emulate({ viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36" });
    await phone.goto(process.env.OG_APP + "/", { waitUntil: "domcontentloaded" });
    await phone.waitForSelector("input");
    await phone.type("input", "Phone" + sfx);
    await phone.click("button.primary");
    await waitFor(() => phone.evaluate(() => window.__og?.state?.conn === "open"), { timeout: 30000, what: "phone connected" });
    const pad = await waitFor(() => phone.$(".touchpad .tp-right"), { what: "touch pad" });
    const p0 = await phone.evaluate(() => window.__og.view.position());
    const r = await pad.boundingBox();
    await phone.touchscreen.touchStart(r.x + r.width / 2, r.y + r.height / 2);
    await sleep(700);
    await phone.touchscreen.touchEnd();
    await sleep(200);
    const p1 = await phone.evaluate(() => window.__og.view.position());
    check("on a touch screen the on-screen pad walks the avatar", p1.x - p0.x > 10, (p1.x - p0.x).toFixed(1) + " px");
    await pctx.close();

    check("no console errors", a.logs.length + b.logs.length === 0, [...a.logs, ...b.logs].join(" | ").slice(0, 300));
  } catch (e) {
    check("scenario completed", false, e.message);
  } finally {
    await browser.close();
  }
  return summary();
}
