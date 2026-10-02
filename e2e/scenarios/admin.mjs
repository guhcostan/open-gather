// Administration: members, roles, removal, invites and the activity log, driven through the real UI.
import { check, summary, resetChecks, launch, joinAs, waitFor, sleep, API } from "../lib.mjs";

const click = (u, selector, text) => u.page.evaluate((selector, text) => {
  const b = [...document.querySelectorAll(selector)].find((x) => x.textContent.trim() === text);
  b?.click();
  return !!b;
}, selector, text);
const cookieOf = async (u) => (await u.ctx.cookies()).find((c) => c.name === "tilework_session").value;
const api = (cookie, method, path, body) => fetch(API + path, { method, headers: { "Content-Type": "application/json", Cookie: "tilework_session=" + cookie }, body: body ? JSON.stringify(body) : undefined });

export async function run(ctx) {
  resetChecks();
  const browser = await launch();
  try {
    const t = String(Date.now() % 10000);
    const admin = await joinAs(browser, "Admin", { cookie: ctx.adminCookie });
    const mia = await joinAs(browser, "Mia" + t);
    const rem = await joinAs(browser, "Rem" + t);
    const miaCookie = await cookieOf(mia);
    const remCookie = await cookieOf(rem);

    check("a member does not see the Admin button", !(await click(mia, ".topbar button", "Admin")));

    // ---- members tab
    await waitFor(() => click(admin, ".topbar button", "Admin"), { what: "Admin button" });
    await waitFor(() => admin.page.$(".modal .admin-table"), { what: "members table" });
    const names = await admin.page.evaluate(() => [...document.querySelectorAll(".modal .admin-table tbody tr td:first-child")].map((x) => x.textContent));
    check("the members tab lists everybody, with the admin marked as you", names.some((n) => n.startsWith("Admin") && n.includes("(you)")) && names.some((n) => n === "Mia" + t) && names.some((n) => n === "Rem" + t), names.join());
    check("the admin cannot remove themselves from the UI", await admin.page.evaluate(() => ![...document.querySelectorAll(".modal .admin-table tbody tr")].find((r) => r.textContent.startsWith("Admin"))?.querySelector("button")));

    // ---- promote Mia: she is disconnected, reconnects and gets the new role
    await admin.page.select('.modal select[aria-label="Role of Mia' + t + '"]', "admin");
    await waitFor(() => mia.page.evaluate(() => window.__tilework.state.role === "admin" && window.__tilework.state.conn === "open"), { timeout: 20000, what: "Mia reconnects as admin" });
    check("a role change reaches the online member without a reload (evict, reconnect, new role)", true);
    check("the new admin now sees the Admin button", await waitFor(() => click(mia, ".topbar button", "Admin"), { timeout: 5000 }).then(() => true).catch(() => false));
    await mia.page.keyboard.press("Escape");
    await admin.page.select('.modal select[aria-label="Role of Mia' + t + '"]', "member");
    await waitFor(() => mia.page.evaluate(() => window.__tilework.state.role === "member" && window.__tilework.state.conn === "open"), { timeout: 20000, what: "Mia back to member" });
    check("demoting works the same way", true);
    // earlier scenarios may have minted other admins in this shared office: demote them, so that ours is the last one
    const all = await (await api(ctx.adminCookie, "GET", "/api/admin/members")).json();
    for (const m of all.members) if (m.role === "admin" && m.id !== ctx.adminId) await api(ctx.adminCookie, "PATCH", "/api/admin/members/" + m.id, { role: "member" });
    const selfDemote = await api(ctx.adminCookie, "PATCH", "/api/admin/members/" + ctx.adminId, { role: "member" });
    check("the last admin cannot be demoted (409)", selfDemote.status === 409);
    check("a member cannot call the admin API (403)", (await api(miaCookie, "GET", "/api/admin/members")).status === 403);

    // ---- invites tab
    await click(admin, ".modal [role=tab]", "Invites");
    await waitFor(() => click(admin, ".modal .admin-form button", "Create invite link"), { what: "invite form" });
    const link = await waitFor(() => admin.page.evaluate(() => document.querySelector(".modal .composer input")?.value), { what: "invite link" });
    const token = new URL(link).searchParams.get("invite");
    check("creating an invite shows its link once", link.includes("?invite=") && token.length > 20);
    await waitFor(() => admin.page.evaluate(() => [...document.querySelectorAll(".modal .admin-table tbody tr")].some((r) => r.textContent.includes("Active"))), { what: "active invite listed" });
    const listed = await (await api(ctx.adminCookie, "GET", "/api/admin/invites")).text();
    check("the invite list never contains the secret", !listed.includes(token));
    await click(admin, ".modal .admin-table button", "Revoke");
    await waitFor(() => admin.page.evaluate(() => [...document.querySelectorAll(".modal .admin-table tbody tr")].some((r) => r.textContent.includes("Revoked"))), { what: "revoked status" });
    const use = await fetch(API + "/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Late" + t, invite: token }) });
    check("a revoked invite link stops working (403)", use.status === 403);

    // ---- activity tab
    await click(admin, ".modal [role=tab]", "Activity");
    await waitFor(() => admin.page.$(".modal .audit li"), { what: "activity list" });
    const audit = await admin.page.evaluate(() => document.querySelector(".modal .audit").textContent);
    check("the activity log records role changes and invite actions, by name", audit.includes("Admin changed the role of Mia" + t) && audit.includes("created an invite") && audit.includes("revoked an invite"), audit.slice(0, 160));

    // ---- removal
    await click(admin, ".modal [role=tab]", "Members");
    await waitFor(() => admin.page.$(".modal .admin-table"), { what: "members again" });
    await admin.page.evaluate((n) => document.querySelector('.modal button[aria-label="Remove ' + n + '"]').click(), "Rem" + t);
    await waitFor(() => click(admin, ".modal button", "Confirm removal"), { what: "confirm button" });
    await waitFor(() => rem.page.evaluate(() => !!document.querySelector(".join-card")), { timeout: 20000, what: "removed member lands on the join screen" });
    const note = await rem.page.evaluate(() => document.querySelector(".join-card .error")?.textContent ?? "");
    check("a removed member is disconnected at once and told why", note.includes("removed from this office"), note);
    const me = await (await fetch(API + "/api/me", { headers: { Cookie: "tilework_session=" + remCookie } })).json();
    check("the removed member's session no longer works", me.authenticated === false);
    await waitFor(() => admin.page.evaluate((n) => ![...window.__tilework.state.roster.values()].some((p) => p.n === n && p.s !== "offline"), "Rem" + t), { what: "roster no longer shows Rem online" });
    check("everybody sees the removed member leave", true);
    const ws = await api(remCookie, "GET", "/api/admin/members");
    check("the removed session cannot use the admin API either (401)", ws.status === 401);
    await sleep(200);
    return summary();
  } finally {
    await browser.close();
  }
}
