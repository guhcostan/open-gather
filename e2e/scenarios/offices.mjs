// Private offices through the real UI: an administrator assigns one in the editor, a visitor knocks
// with the Knock button, the owner lets them in, and the two share the office's own call. A free
// office next door is open to anyone and can be locked.
import { check, summary, resetChecks, launch, joinAs, waitFor, walkTo, st, sleep, API } from "../lib.mjs";

const T = 16;
const at = (tx, ty) => [tx * T + 8, ty * T + 8];
const button = (u, re) => u.page.evaluate((src) => {
  const b = [...document.querySelectorAll("button")].find((x) => new RegExp(src).test(x.textContent.trim()));
  b?.click(); return !!b;
}, re.source);
const hasButton = (u, re) => u.page.evaluate((src) => [...document.querySelectorAll("button")].some((x) => new RegExp(src).test(x.textContent.trim())), re.source);
const areaOf = (u, id) => u.page.evaluate((id) => window.__tilework.view.map.areas.find((a) => a.id === id), id);
const areaIndex = (u, id) => u.page.evaluate((id) => window.__tilework.view.map.areas.findIndex((a) => a.id === id), id);
const here = (u) => u.page.evaluate(() => window.__tilework.view.mArea);

export async function run(ctx) {
  resetChecks();
  const browser = await launch();
  const cookie = ctx.adminCookie;
  const full = await (await fetch(API + "/api/admin/map", { headers: { Cookie: "tilework_session=" + cookie } })).json();
  try {
    const t = String(Date.now() % 10000);
    const boss = await joinAs(browser, "Admin", { cookie });
    const owner = await joinAs(browser, "Owner" + t);
    const guest = await joinAs(browser, "Guest" + t);
    const other = await joinAs(browser, "Other" + t);
    check("the default office has six private offices behind a hall", (await owner.page.evaluate(() => window.__tilework.view.map.areas.filter((a) => a.access.mode === "office").length)) === 6);

    // ---- the administrator assigns Office 2 to Owner in the editor (same tool as desks)
    await walkTo(boss, ...at(12, 37));
    await boss.page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Edit office")?.click());
    await waitFor(() => boss.page.$(".editor"), { what: "editor open" });
    await boss.page.evaluate(() => [...document.querySelectorAll(".editor .chip")].find((x) => x.textContent === "Assign desk or office")?.click());
    await waitFor(() => boss.page.$(".editor select"), { what: "person picker" });
    await boss.page.select(".editor select", String(owner.id));
    const p = await boss.page.evaluate((tx, ty) => { const v = window.__tilework.view, r = v.app.canvas.getBoundingClientRect(); return { x: r.left + v.camX + (tx * 16 + 8) * v.S, y: r.top + v.camY + (ty * 16 + 8) * v.S }; }, 13, 43);
    await boss.page.mouse.click(p.x, p.y);
    await waitFor(() => boss.page.evaluate(() => !document.querySelector(".editor .primary")?.disabled), { what: "editor dirty" });
    await boss.page.evaluate(() => document.querySelector(".editor .primary").click());
    await waitFor(async () => (await areaOf(guest, "office-2"))?.name === "Office 2 · " + owner.name, { what: "office label reaches others" });
    const office = await areaOf(guest, "office-2");
    check("the editor assigns the office and everybody sees its owner's name", office.access.users?.[0] === owner.id, office.name);
    await boss.page.evaluate(() => [...document.querySelectorAll(".editor button")].find((b) => b.textContent === "Close")?.click());
    const oi = await areaIndex(guest, "office-2");

    // ---- the owner walks in; strangers are kept out by the server
    await walkTo(owner, ...at(13, 42));
    check("the owner walks into their office", (await here(owner)) === oi);
    check("the owner gets no lock button in an assigned office", !(await hasButton(owner, /^(Lock|Unlock) room$/)));
    await walkTo(guest, ...at(15, 37));
    await walkTo(other, ...at(17, 37));
    await guest.page.evaluate(() => window.__tilework.view.setDirection(0, 1));
    await sleep(1500);
    await guest.page.evaluate(() => window.__tilework.view.setDirection(0, 0));
    check("a visitor cannot walk into somebody's office", (await here(guest)) !== oi);

    // ---- knock, let in, share the office call
    await waitFor(() => hasButton(guest, /^Knock · Office 2/), { what: "knock button" });
    check("standing at the door, the visitor sees a Knock button", true);
    await button(guest, /^Knock · Office 2/);
    await waitFor(() => owner.page.evaluate(() => !!window.__tilework.state.knock), { what: "owner asked" });
    await waitFor(() => owner.page.evaluate(() => [...document.querySelectorAll(".modal button")].some((b) => b.textContent === "Let in")), { what: "knock dialog" });
    check("the owner is asked who is knocking", await owner.page.evaluate((n) => document.querySelector(".modal")?.textContent.includes(n), guest.name));
    await owner.page.evaluate(() => [...document.querySelectorAll(".modal button")].find((b) => b.textContent === "Let in")?.click());
    await waitFor(() => guest.page.evaluate((oi) => !window.__tilework.view.deny.has(oi), oi), { what: "visitor admitted" }).catch(async (e) => {
      console.log("DIAG", JSON.stringify({ ownerKnock: await owner.page.evaluate(() => window.__tilework.state.knock), guestDeny: await guest.page.evaluate(() => [...window.__tilework.view.deny]), toast: await guest.page.evaluate(() => document.querySelector(".toast")?.textContent), ownerArea: await here(owner), oi }));
      throw e;
    });
    await walkTo(guest, ...at(15, 42));
    check("the admitted visitor walks in", (await here(guest)) === oi);
    await Promise.all([owner, guest, other].map((u) => u.page.evaluate(() => window.__tilework.session.setConsent(true))));
    await waitFor(async () => (await st(owner)).conv?.kind === "r" && (await st(guest)).conv?.kind === "r" && (await st(guest)).conv?.state === "live", { timeout: 30000, what: "office call" });
    const conv = (await st(owner)).conv;
    check("owner and visitor share the office's own call", conv.name?.startsWith("Office 2"), JSON.stringify(conv));
    check("somebody in the hall is not in that call", (await st(other)).conv?.kind !== "r");

    // ---- a free office: open to anyone, lockable
    await walkTo(other, ...at(23, 42));
    check("anybody walks into a free office", (await here(other)) === (await areaIndex(other, "office-3")));
    await waitFor(() => hasButton(other, /^Lock room$/), { what: "lock button" });
    check("a free office can be locked from inside", true);
    const errs = [boss, owner, guest, other].flatMap((u) => u.logs);
    check("no console errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  } catch (e) {
    check("scenario completed", false, e.message);
  } finally {
    const put = await fetch(API + "/api/map", { method: "PUT", headers: { "Content-Type": "application/json", Cookie: "tilework_session=" + cookie }, body: JSON.stringify(full) });
    if (!put.ok) console.log("could not restore the map", put.status);
    await browser.close();
  }
  return summary();
}
